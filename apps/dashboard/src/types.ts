export type TaskStatus = "queued" | "running" | "approval_required" | "completed" | "failed" | "cancelled" | "safely_blocked";
export interface TaskStep { stepId: string; iteration: number; action: string; startedAt: string; completedAt?: string }
export interface Task { taskId: string; goal: string; status: TaskStatus; currentAction: string | null; revision: number; updatedAt: string; createdAt: string; steps: TaskStep[]; terminalReason?: string; finalResponse?: string }
export interface TaskEvent { id: string; taskId: string; type: string; occurredAt: string; payload: Record<string, unknown> }
export interface Approval { requestId: string; token: string; expiresAt: number; risk: string; explanation: string }
export interface ComplaintGroup { category: string; severity: string; count: number; commentIds: string[] }
export interface Analytics { sentiment: Record<string, number>; groups: ComplaintGroup[] }
export interface ReviewItem { commentId: string; sentiment: string; confidence: number; reason: string; complaintCategory: string; severity: string; language: string; reviewStatus: string; complaint?: string | null; original?: Record<string, unknown>; history?: Array<Record<string, unknown>> }
export interface ConnectionResult { followers: Array<{ username: string; displayName: string }>; accounts: Array<{ username: string; displayName: string; error?: string; posts: Array<{ postId: string; url: string; comments: Array<{ commentId: string; text: string; author?: string }> }> }>; nextCursor: string | null; followersNextCursor: string | null; collectedAt: string }
export interface ProfileContent { username: string; displayName: string; posts: Array<{ postId: string; url: string; publishedAt: string; caption?: string; mediaUrl?: string; comments: Array<{ commentId: string; text: string; author?: string; publishedAt?: string }> }>; nextCursor: string | null; collectedAt: string }
export interface ConnectionList { accounts: Array<{ username: string; displayName: string; profilePath: string }>; nextCursor: string | null }
