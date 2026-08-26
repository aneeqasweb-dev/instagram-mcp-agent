import type { CommentAnalysis } from "./schemas.js";

export interface ComplaintGroup { readonly category: CommentAnalysis["complaintCategory"]; readonly severity: CommentAnalysis["severity"]; readonly count: number; readonly commentIds: readonly string[] }
export function groupComplaints(analyses: readonly CommentAnalysis[]): readonly ComplaintGroup[] {
  const groups = new Map<string, { category: CommentAnalysis["complaintCategory"]; severity: CommentAnalysis["severity"]; commentIds: string[] }>();
  for (const item of analyses.filter(({ sentiment, complaint }) => sentiment === "negative" && complaint !== null)) { const key = `${item.complaintCategory}:${item.severity}`; const group = groups.get(key) ?? { category: item.complaintCategory, severity: item.severity, commentIds: [] }; if (!group.commentIds.includes(item.commentId)) group.commentIds.push(item.commentId); groups.set(key, group); }
  return [...groups.values()].map((group) => ({ ...group, count: group.commentIds.length }));
}
export function validateGroundedSummary(summary: { text: string; evidence: readonly string[] }, analyses: readonly CommentAnalysis[]) { const available = new Set(analyses.map(({ commentId }) => commentId)); if (!summary.text.trim() || summary.evidence.length === 0 || summary.evidence.some((id) => !available.has(id))) throw new Error("Summary is not grounded in available comment evidence"); return summary; }
