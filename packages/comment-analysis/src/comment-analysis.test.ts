import assert from "node:assert/strict";
import test from "node:test";
import { CommentAnalysisEngine, createBatches, type CommentAnalysisProvider } from "./engine.js";
import { correctAnalysis } from "./review.js";
import { applyQualityRules, commentAnalysisSchema, TAXONOMY_VERSION, type CommentAnalysis, type CommentInput } from "./schemas.js";
import { groupComplaints, validateGroundedSummary } from "./summary.js";

const analysis = (commentId: string, overrides: Partial<CommentAnalysis> = {}): CommentAnalysis => ({ commentId, taxonomyVersion: TAXONOMY_VERSION, sentiment: "negative", confidence: 0.95, reason: "Complaint is explicit", complaintCategory: "product_quality", severity: "medium", language: "english", reviewStatus: "auto_accepted", complaint: "Quality issue", ...overrides });

test("validates multilingual, ambiguous, unknown-category, confidence, and severity boundaries", () => {
  for (const [id, language] of [["en", "english"], ["ur", "roman_urdu"], ["mix", "mixed"], ["slang", "other"], ["ambiguous", "unknown"]] as const) assert.equal(commentAnalysisSchema.parse(analysis(id, { language, complaintCategory: id === "ambiguous" ? "unknown" : "other" })).language, language);
  assert.equal(applyQualityRules(analysis("a", { confidence: 0.79 })).reviewStatus, "needs_review");
  assert.equal(applyQualityRules(analysis("b", { confidence: 0.8 })).reviewStatus, "auto_accepted");
  assert.equal(applyQualityRules(analysis("c", { confidence: 0.89, severity: "high" })).reviewStatus, "needs_review");
  assert.throws(() => commentAnalysisSchema.parse(analysis("bad", { confidence: 1.1 })));
});

test("batches 2,000 stable IDs without loss or duplication", async () => {
  const comments = Array.from({ length: 2_000 }, (_, index) => ({ commentId: `comment-${index}`, text: `Fixture comment ${index}` }));
  const batches = createBatches(comments, 2_000, 25);
  assert.deepEqual(batches.flat().map(({ commentId }) => commentId), comments.map(({ commentId }) => commentId));
  const provider: CommentAnalysisProvider = { analyze: async (items) => items.map(({ commentId }) => analysis(commentId)) };
  const result = await new CommentAnalysisEngine(provider, { maximumBatchBytes: 2_000, maximumItems: 25 }).run(comments);
  assert.equal(result.analyses.length, 2_000); assert.equal(result.failures.length, 0); assert.ok(result.batches >= 80);
});

test("retries malformed items individually and preserves successful batch results", async () => {
  const attempts = new Map<string, number>();
  const provider: CommentAnalysisProvider = { analyze: async (items: readonly CommentInput[]) => items.map(({ commentId }) => { const count = (attempts.get(commentId) ?? 0) + 1; attempts.set(commentId, count); return commentId === "retry" && count === 1 ? { commentId } : commentId === "fail" ? { bad: true } : analysis(commentId); }) };
  const result = await new CommentAnalysisEngine(provider).run([{ commentId: "ok", text: "good" }, { commentId: "retry", text: "retry" }, { commentId: "fail", text: "fail" }]);
  assert.deepEqual(result.analyses.map(({ commentId }) => commentId), ["ok", "retry"]); assert.deepEqual(result.failures.map(({ commentId }) => commentId), ["fail"]);
});

test("isolates a failed batch by retrying every comment individually", async () => {
  const provider: CommentAnalysisProvider = { analyze: async (items) => {
    if (items.length > 1) throw new Error("batch unavailable");
    return items[0]?.commentId === "bad" ? [{ bad: true }] : items.map(({ commentId }) => analysis(commentId));
  } };
  const result = await new CommentAnalysisEngine(provider).run([{ commentId: "one", text: "one" }, { commentId: "bad", text: "bad" }, { commentId: "two", text: "two" }]);
  assert.deepEqual(result.analyses.map(({ commentId }) => commentId), ["one", "two"]);
  assert.deepEqual(result.failures, [{ commentId: "bad", code: "invalid_output", message: "Analysis remained invalid after retry" }]);
});

test("groups traceable complaints, rejects unsupported summaries, and audits corrections", () => {
  const items = [analysis("one"), analysis("two"), analysis("positive", { sentiment: "positive", complaint: null, severity: "none" })];
  assert.deepEqual(groupComplaints(items)[0], { category: "product_quality", severity: "medium", count: 2, commentIds: ["one", "two"] });
  assert.deepEqual(validateGroundedSummary({ text: "Two quality complaints", evidence: ["one", "two"] }, items).evidence, ["one", "two"]);
  assert.throws(() => validateGroundedSummary({ text: "Unsupported", evidence: ["missing"] }, items));
  const first = correctAnalysis(undefined, items[0]!, { severity: "high" }, "reviewer-1", "2026-08-24T10:00:00Z");
  const second = correctAnalysis(first, items[0]!, { complaintCategory: "safety" }, "reviewer-2", "2026-08-24T11:00:00Z");
  assert.equal(second.original.severity, "medium"); assert.equal(second.current.severity, "high"); assert.equal(second.current.complaintCategory, "safety"); assert.equal(second.history.length, 2);
  assert.throws(() => correctAnalysis(second, items[0]!, { confidence: 2 }, "reviewer-3"));
});
