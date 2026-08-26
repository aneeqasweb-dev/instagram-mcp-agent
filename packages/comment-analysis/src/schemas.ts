import { z } from "zod";

export const sentimentSchema = z.enum(["positive", "neutral", "negative", "mixed", "unknown"]);
export const severitySchema = z.enum(["none", "low", "medium", "high", "critical"]);
export const reviewStatusSchema = z.enum(["auto_accepted", "needs_review", "reviewed"]);
export const complaintCategorySchema = z.enum(["product_quality", "delivery", "pricing", "customer_service", "availability", "safety", "other", "unknown"]);
export const languageSchema = z.enum(["english", "roman_urdu", "mixed", "other", "unknown"]);

export const commentAnalysisSchema = z.object({
  commentId: z.string().min(1), taxonomyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  sentiment: sentimentSchema, confidence: z.number().min(0).max(1), reason: z.string().min(1).max(500),
  complaintCategory: complaintCategorySchema, severity: severitySchema, language: languageSchema,
  reviewStatus: reviewStatusSchema, complaint: z.string().max(500).nullable(),
});
export type CommentAnalysis = z.infer<typeof commentAnalysisSchema>;
export interface CommentInput { readonly commentId: string; readonly text: string }

export const TAXONOMY_VERSION = "1.0.0";
export interface QualityRules { readonly autoAcceptConfidence: number; readonly highSeverityReviewConfidence: number }
export const defaultQualityRules: QualityRules = { autoAcceptConfidence: 0.8, highSeverityReviewConfidence: 0.9 };

export function applyQualityRules(analysis: CommentAnalysis, rules = defaultQualityRules): CommentAnalysis {
  const needsReview = analysis.confidence < rules.autoAcceptConfidence || ((analysis.severity === "high" || analysis.severity === "critical") && analysis.confidence < rules.highSeverityReviewConfidence);
  return { ...analysis, reviewStatus: needsReview ? "needs_review" : "auto_accepted" };
}
