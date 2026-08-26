import { applyQualityRules, commentAnalysisSchema, type CommentAnalysis, type CommentInput, type QualityRules } from "./schemas.js";

export interface CommentAnalysisProvider { analyze(comments: readonly CommentInput[], signal?: AbortSignal): Promise<unknown> }
export interface AnalysisFailure { readonly commentId: string; readonly code: "invalid_output" | "provider_error"; readonly message: string }
export interface AnalysisRun { readonly analyses: readonly CommentAnalysis[]; readonly failures: readonly AnalysisFailure[]; readonly batches: number }

export function createBatches(comments: readonly CommentInput[], maximumBatchBytes = 12_000, maximumItems = 50): readonly CommentInput[][] {
  const batches: CommentInput[][] = []; let current: CommentInput[] = []; let bytes = 2;
  for (const comment of comments) {
    const itemBytes = Buffer.byteLength(JSON.stringify(comment)) + 1;
    if (itemBytes > maximumBatchBytes) throw new Error(`Comment '${comment.commentId}' exceeds the batch byte limit`);
    if (current.length > 0 && (current.length >= maximumItems || bytes + itemBytes > maximumBatchBytes)) { batches.push(current); current = []; bytes = 2; }
    current.push(comment); bytes += itemBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function parseItems(value: unknown, expected: readonly CommentInput[], rules?: QualityRules) {
  const raw = Array.isArray(value) ? value : typeof value === "object" && value !== null && "analyses" in value && Array.isArray(value.analyses) ? value.analyses : [];
  const expectedIds = new Set(expected.map(({ commentId }) => commentId)); const valid = new Map<string, CommentAnalysis>();
  for (const item of raw) { const parsed = commentAnalysisSchema.safeParse(item); if (parsed.success && expectedIds.has(parsed.data.commentId) && !valid.has(parsed.data.commentId)) valid.set(parsed.data.commentId, applyQualityRules(parsed.data, rules)); }
  return valid;
}

export class CommentAnalysisEngine {
  constructor(private readonly provider: CommentAnalysisProvider, private readonly options: { maximumBatchBytes?: number; maximumItems?: number; qualityRules?: QualityRules } = {}) {}
  async run(comments: readonly CommentInput[], signal?: AbortSignal): Promise<AnalysisRun> {
    if (new Set(comments.map(({ commentId }) => commentId)).size !== comments.length) throw new Error("Comment IDs must be unique");
    const batches = createBatches(comments, this.options.maximumBatchBytes, this.options.maximumItems); const analyses = new Map<string, CommentAnalysis>(); const failures: AnalysisFailure[] = [];
    for (const batch of batches) {
      let first: Map<string, CommentAnalysis>;
      try { first = parseItems(await this.provider.analyze(batch, signal), batch, this.options.qualityRules); }
      catch { first = new Map(); }
      first.forEach((value, key) => analyses.set(key, value));
      for (const comment of batch.filter(({ commentId }) => !first.has(commentId))) {
        try { const retry = parseItems(await this.provider.analyze([comment], signal), [comment], this.options.qualityRules).get(comment.commentId); if (retry) analyses.set(comment.commentId, retry); else failures.push({ commentId: comment.commentId, code: "invalid_output", message: "Analysis remained invalid after retry" }); }
        catch (error) { failures.push({ commentId: comment.commentId, code: "provider_error", message: error instanceof Error ? error.message : "Provider failed" }); }
      }
    }
    return { analyses: comments.flatMap(({ commentId }) => analyses.get(commentId) ?? []), failures, batches: batches.length };
  }
}
