import type { Db, Document, Filter } from "mongodb";

export interface InstagramPostRecord {
  readonly userId: string; readonly postId: string; readonly permalink?: string; readonly caption?: string;
  readonly publishedAt: Date; readonly collectedAt: Date;
}
export interface InstagramCommentRecord {
  readonly userId: string; readonly postId: string; readonly commentId: string; readonly text: string;
  readonly author?: string; readonly publishedAt?: Date; readonly collectedAt: Date;
}
export interface CommentAnalysisRecord {
  readonly userId: string; readonly postId: string; readonly commentId: string; readonly taxonomyVersion: string;
  readonly sentiment: "positive" | "negative" | "neutral"; readonly confidence: number;
  readonly category?: string; readonly severity?: "low" | "medium" | "high"; readonly reason: string; readonly analyzedAt: Date;
}

export class InstagramRepository {
  constructor(readonly db: Db) {}

  async upsertPost(record: InstagramPostRecord): Promise<void> {
    await this.db.collection("instagram_posts").updateOne({ userId: record.userId, postId: record.postId }, { $set: record }, { upsert: true });
  }
  async upsertComment(record: InstagramCommentRecord): Promise<void> {
    await this.db.collection("instagram_comments").updateOne({ userId: record.userId, commentId: record.commentId }, { $set: record }, { upsert: true });
  }
  async upsertAnalysis(record: CommentAnalysisRecord): Promise<void> {
    await this.db.collection("comment_analysis").updateOne(
      { userId: record.userId, commentId: record.commentId, taxonomyVersion: record.taxonomyVersion }, { $set: record }, { upsert: true },
    );
  }
  async commentsForPost(userId: string, postId: string, limit = 100): Promise<InstagramCommentRecord[]> {
    return this.db.collection<InstagramCommentRecord & Document>("instagram_comments")
      .find({ userId, postId }, { projection: { _id: 0 } }).sort({ publishedAt: -1 }).limit(Math.min(Math.max(limit, 1), 500)).toArray();
  }
}

export type SafeEntity = "comment_analysis" | "agent_memory";

export class ScopedDocumentRepository {
  constructor(readonly db: Db) {}

  async save(userId: string, entity: SafeEntity, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const idField = entity === "comment_analysis" ? "analysisId" : "memoryId";
    const now = new Date();
    const document = { ...data, userId, [idField]: id, ...(entity === "agent_memory" && !("createdAt" in data) ? { createdAt: now } : {}), updatedAt: now };
    await this.db.collection(entity).updateOne({ userId, [idField]: id }, { $set: document }, { upsert: true });
    return document;
  }

  async update(userId: string, entity: SafeEntity, id: string, changes: Record<string, unknown>): Promise<boolean> {
    if ("userId" in changes || "_id" in changes) throw new Error("Ownership and database identity fields cannot be updated");
    const idField = entity === "comment_analysis" ? "analysisId" : "memoryId";
    const result = await this.db.collection(entity).updateOne({ userId, [idField]: id }, { $set: { ...changes, updatedAt: new Date() } });
    return result.matchedCount === 1;
  }

  async search(userId: string, entity: SafeEntity, field: string | undefined, equals: unknown, limit: number): Promise<Record<string, unknown>[]> {
    const allowedFields = entity === "comment_analysis" ? ["sentiment", "severity", "category", "commentId"] : ["sourceTaskId", "kind", "memoryId"];
    if (field && !allowedFields.includes(field)) throw new Error(`Field '${field}' is not searchable for ${entity}`);
    const filter: Filter<Document> = { userId, ...(field ? { [field]: equals } : {}) };
    return this.db.collection(entity).find(filter, { projection: { _id: 0 } }).limit(Math.min(Math.max(limit, 1), 100)).toArray() as Promise<Record<string, unknown>[]>;
  }
}
