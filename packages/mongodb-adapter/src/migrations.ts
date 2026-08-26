import type { Db, Document, IndexDescription } from "mongodb";

export const SCHEMA_VERSION = 3;

const indexes: Record<string, IndexDescription[]> = {
  schema_versions: [{ key: { version: 1 }, name: "version_unique", unique: true }],
  users: [{ key: { userId: 1 }, name: "user_unique", unique: true }],
  agent_sessions: [{ key: { sessionId: 1 }, name: "session_unique", unique: true }, { key: { expiresAt: 1 }, name: "session_expiry_ttl", expireAfterSeconds: 0 }],
  agent_tasks: [{ key: { userId: 1, taskId: 1 }, name: "user_task_unique", unique: true }, { key: { userId: 1, status: 1, updatedAt: -1 }, name: "user_status_updated" }],
  agent_steps: [{ key: { userId: 1, taskId: 1, stepId: 1 }, name: "user_task_step_unique", unique: true }, { key: { userId: 1, taskId: 1, iteration: 1 }, name: "task_iteration" }],
  agent_events: [{ key: { userId: 1, taskId: 1, sequence: 1 }, name: "user_task_event_sequence", unique: true }, { key: { userId: 1, taskId: 1, id: 1 }, name: "user_task_event_id", unique: true }],
  agent_audit: [{ key: { userId: 1, taskId: 1, occurredAt: 1 }, name: "user_task_audit_time" }, { key: { auditId: 1 }, name: "audit_id_unique", unique: true }],
  instagram_posts: [{ key: { userId: 1, postId: 1 }, name: "user_post_unique", unique: true }, { key: { userId: 1, publishedAt: -1 }, name: "user_posts_recent" }],
  instagram_comments: [{ key: { userId: 1, commentId: 1 }, name: "user_comment_unique", unique: true }, { key: { userId: 1, postId: 1, publishedAt: -1 }, name: "post_comments_recent" }],
  comment_analysis: [{ key: { userId: 1, commentId: 1, taxonomyVersion: 1 }, name: "analysis_version_unique", unique: true, partialFilterExpression: { commentId: { $type: "string" }, taxonomyVersion: { $type: "string" } } }, { key: { userId: 1, sentiment: 1, severity: 1 }, name: "analysis_sentiment_severity" }],
  agent_memory: [{ key: { userId: 1, memoryId: 1 }, name: "user_memory_unique", unique: true }, { key: { userId: 1, sourceTaskId: 1, createdAt: -1 }, name: "memory_source" }, { key: { expiresAt: 1 }, name: "memory_expiry_ttl", expireAfterSeconds: 0 }, { key: { text: "text" }, name: "memory_text" }],
  approvals: [{ key: { userId: 1, requestId: 1 }, name: "user_approval_unique", unique: true }, { key: { userId: 1, taskId: 1, status: 1 }, name: "task_approval_status" }, { key: { expiresAt: 1 }, name: "approval_expiry_ttl", expireAfterSeconds: 0 }],
  tool_invocations: [{ key: { userId: 1, invocationId: 1 }, name: "user_invocation_unique", unique: true }, { key: { expiresAt: 1 }, name: "invocation_expiry_ttl", expireAfterSeconds: 0 }],
};

const required = (...fields: string[]): Document => ({ $jsonSchema: { bsonType: "object", required: fields } });
const validators: Record<string, Document> = {
  schema_versions: required("version", "appliedAt"),
  users: required("userId"),
  agent_sessions: required("sessionId", "userId", "expiresAt"),
  agent_tasks: required("userId", "taskId", "goal", "status", "createdAt", "updatedAt"),
  agent_steps: required("userId", "taskId", "stepId", "iteration", "action", "startedAt"),
  agent_events: required("userId", "taskId", "id", "sequence", "type", "occurredAt", "payload"),
  agent_audit: required("auditId", "userId", "taskId", "occurredAt", "actor", "action", "status", "data"),
  instagram_posts: required("userId", "postId", "publishedAt", "collectedAt"),
  instagram_comments: required("userId", "postId", "commentId", "text", "collectedAt"),
  comment_analysis: required("userId"),
  agent_memory: required("userId", "memoryId", "sourceTaskId", "text", "createdAt"),
  approvals: required("userId", "requestId", "taskId", "status", "expiresAt"),
  tool_invocations: required("userId", "invocationId", "result", "expiresAt"),
};

export async function migrateDatabase(db: Db): Promise<void> {
  const existing = await db.collection<{ version: number }>("schema_versions").findOne({}, { sort: { version: -1 } });
  if (existing && existing.version > SCHEMA_VERSION) throw new Error(`Database schema ${existing.version} is newer than supported schema ${SCHEMA_VERSION}`);
  for (const [name, collectionIndexes] of Object.entries(indexes)) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    const validation = { validator: validators[name]!, validationLevel: "strict" as const, validationAction: "error" as const };
    if (!exists) await db.createCollection(name, validation);
    else await db.command({ collMod: name, ...validation });
    await db.collection(name).createIndexes(collectionIndexes);
  }
  await db.collection("schema_versions").updateOne(
    { version: SCHEMA_VERSION },
    { $setOnInsert: { version: SCHEMA_VERSION, appliedAt: new Date() } },
    { upsert: true },
  );
}
