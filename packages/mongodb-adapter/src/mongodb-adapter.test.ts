import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ToolRegistry, createTaskState, recoverInterruptedTasks, transitionTask } from "@instagram-agent/agent-core";
import { MongoClient, type Db } from "mongodb";
import { createDatabaseTools } from "./database-tools.js";
import { InstagramRepository } from "./data-repositories.js";
import { assembleShortTermContext, MongoMemoryRepository } from "./memory.js";
import { migrateDatabase, SCHEMA_VERSION } from "./migrations.js";
import { MongoTaskRepository } from "./task-repository.js";
import { MongoAuditRepository, MongoRecoveryStore, UserDataLifecycle } from "./operations.js";

const client = new MongoClient(process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 2_000 });
const databaseName = `instagram_agent_test_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`;
let db: Db;

before(async () => {
  await client.connect();
  db = client.db(databaseName);
  await migrateDatabase(db);
});

after(async () => {
  await client.db(databaseName).dropDatabase();
  await client.close();
});

test("migration is idempotent and creates schema/index contracts", async () => {
  await migrateDatabase(db);
  assert.equal((await db.collection("schema_versions").findOne({ version: SCHEMA_VERSION }))?.version, SCHEMA_VERSION);
  const taskIndexes = await db.collection("agent_tasks").indexExists(["user_task_unique", "user_status_updated"]);
  const stepIndexes = await db.collection("agent_steps").indexExists(["user_task_step_unique", "task_iteration"]);
  assert.equal(taskIndexes && stepIndexes, true);
  await assert.rejects(db.collection("agent_tasks").insertOne({ userId: "invalid-without-task-contract" }));
  await db.collection("schema_versions").insertOne({ version: SCHEMA_VERSION + 1, appliedAt: new Date() });
  await assert.rejects(migrateDatabase(db), /newer than supported/);
  await db.collection("schema_versions").deleteOne({ version: SCHEMA_VERSION + 1 });
});

test("task state and separated step evidence survive repository restart", async () => {
  const time = (seconds: number) => `2026-08-24T10:00:0${seconds}.000Z`;
  let state = createTaskState({ taskId: "task-1", userId: "user-1", text: "Persist me" }, time(0));
  state = transitionTask(state, { type: "started", at: time(1) });
  state = transitionTask(state, { type: "step_started", at: time(2), stepId: "step-1", iteration: 1, action: "lookup" });
  state = transitionTask(state, { type: "step_observed", at: time(3), stepId: "step-1", observation: { invocationId: "inv-1", ok: true, value: { result: 42 } } });
  await new MongoTaskRepository(db).save(state);
  const recovered = await new MongoTaskRepository(client.db(databaseName)).get("task-1", "user-1");
  assert.deepEqual(recovered, state);
  assert.equal(await new MongoTaskRepository(db).get("task-1", "user-2"), null);
  const storedTask = await db.collection("agent_tasks").findOne({ taskId: "task-1" });
  assert.equal("steps" in (storedTask ?? {}), false);
  assert.equal(await db.collection("agent_steps").countDocuments({ taskId: "task-1" }), 1);
});

test("Instagram repositories upsert without duplicates and enforce user scope", async () => {
  const repository = new InstagramRepository(db);
  const collectedAt = new Date();
  await repository.upsertPost({ userId: "user-1", postId: "post-1", caption: "first", publishedAt: collectedAt, collectedAt });
  await repository.upsertPost({ userId: "user-1", postId: "post-1", caption: "updated", publishedAt: collectedAt, collectedAt });
  await repository.upsertComment({ userId: "user-1", postId: "post-1", commentId: "comment-1", text: "late delivery", collectedAt });
  await repository.upsertComment({ userId: "user-2", postId: "post-1", commentId: "comment-2", text: "private", collectedAt });
  assert.equal(await db.collection("instagram_posts").countDocuments({ userId: "user-1", postId: "post-1" }), 1);
  assert.equal((await repository.commentsForPost("user-1", "post-1")).length, 1);
  assert.equal((await repository.commentsForPost("user-2", "post-1")).length, 1);
});

test("database tools scope data, reject unsafe fields, and persist idempotency", async () => {
  const registry = new ToolRegistry();
  createDatabaseTools(db).forEach((tool) => registry.register(tool));
  const saveInvocation = { invocationId: "db-save-1", name: "database_save", arguments: { entity: "agent_memory", id: "memory-1", data: { kind: "application", sourceTaskId: "task-1", text: "delivery issue" } } };
  assert.equal((await registry.invoke("user-1", saveInvocation)).ok, true);
  assert.equal((await registry.invoke("user-1", saveInvocation)).ok, true);
  assert.equal(await db.collection("agent_memory").countDocuments({ userId: "user-1", memoryId: "memory-1" }), 1);
  const own = await registry.invoke("user-1", { invocationId: "db-search-1", name: "database_search", arguments: { entity: "agent_memory", field: "kind", equals: "application" } });
  const foreign = await registry.invoke("user-2", { invocationId: "db-search-2", name: "database_search", arguments: { entity: "agent_memory" } });
  assert.equal((own.value as { records: unknown[] }).records.length, 1);
  assert.equal((foreign.value as { records: unknown[] }).records.length, 0);
  const unsafe = await registry.invoke("user-1", { invocationId: "db-search-3", name: "database_search", arguments: { entity: "agent_memory", field: "$where", equals: "bad" } });
  assert.equal(unsafe.error?.code, "unsafe_database_query");
});

test("short-term context is bounded and long-term memory is provenance/user scoped", async () => {
  const state = createTaskState({ taskId: "context-task", userId: "user-1", text: "x".repeat(2_000) });
  assert.ok(Buffer.byteLength(JSON.stringify(assembleShortTermContext(state, 500))) <= 500);
  const memory = new MongoMemoryRepository(db);
  await memory.save({ userId: "user-1", memoryId: "long-1", sourceTaskId: "context-task", kind: "task_summary", text: "delivery complaints were severe", createdAt: new Date() });
  await memory.save({ userId: "user-2", memoryId: "long-2", sourceTaskId: "other-task", kind: "task_summary", text: "delivery secret", createdAt: new Date() });
  const own = await memory.retrieve("user-1", "delivery");
  assert.ok(own.some(({ memoryId }) => memoryId === "long-1"));
  assert.ok(own.every(({ userId, sourceTaskId }) => userId === "user-1" && typeof sourceTaskId === "string" && sourceTaskId.length > 0));
  assert.equal((await memory.retrieve("user-3", "delivery")).length, 0);
  await memory.save({ userId: "session-user", sessionId: "session-a", memoryId: "session-a-memory", sourceTaskId: "task-a", kind: "task_summary", text: "shared phrase alpha", createdAt: new Date() });
  await memory.save({ userId: "session-user", sessionId: "session-b", memoryId: "session-b-memory", sourceTaskId: "task-b", kind: "task_summary", text: "shared phrase beta", createdAt: new Date() });
  const sessionA = await memory.retrieve("session-user", "shared phrase", 5, "session-a");
  assert.deepEqual(sessionA.map(({ memoryId }) => memoryId), ["session-a-memory"]);
});

test("restart recovery is optimistic, idempotent, and preserves step evidence", async () => { await db.collection("agent_tasks").deleteMany({ status: { $in: ["running", "approval_required"] } }); const old = "2026-08-24T00:00:00.000Z"; let running = transitionTask(createTaskState({ taskId: "recover-running", userId: "recover-user", text: "resume" }, old), { type: "started", at: "2026-08-24T00:00:01.000Z" }); running = transitionTask(running, { type: "step_started", at: "2026-08-24T00:00:02.000Z", stepId: "existing-step", iteration: 1, action: "read" }); let approval = transitionTask(createTaskState({ taskId: "recover-approval", userId: "recover-user", text: "wait" }, old), { type: "started", at: "2026-08-24T00:00:01.000Z" }); approval = transitionTask(approval, { type: "approval_required", at: "2026-08-24T00:00:02.000Z", reason: "waiting" }); const repository = new MongoTaskRepository(db); await repository.save(running); await repository.save(approval); const queued: string[] = []; const at = "2026-08-25T00:00:00.000Z"; assert.deepEqual(await recoverInterruptedTasks(new MongoRecoveryStore(db), async (state) => { queued.push(state.taskId); }, at), { resumed: ["recover-running"], awaitingApproval: ["recover-approval"], conflicts: [] }); assert.deepEqual(queued, ["recover-running"]); assert.equal((await repository.get("recover-running", "recover-user"))?.steps.length, 1); assert.deepEqual(await recoverInterruptedTasks(new MongoRecoveryStore(db), async () => { throw new Error("must not enqueue twice"); }, at), { resumed: [], awaitingApproval: [], conflicts: [] }); });

test("audit reconstruction and export/delete cover every scoped privacy collection", async () => { const userId = "privacy-user"; const taskId = "privacy-task"; await db.collection("users").insertOne({ userId }); await db.collection("agent_tasks").insertOne({ ...createTaskState({ taskId, userId, text: "private goal" }) , steps: undefined, observations: undefined, errors: undefined }); const audit = new MongoAuditRepository(db); await audit.append({ auditId: "privacy-audit", userId, taskId, occurredAt: "2026-08-25T00:00:00.000Z", actor: "user", action: "created", status: "succeeded", data: { goal: "[REDACTED_PRIVATE_DATA]" } }); assert.deepEqual((await audit.forTask(userId, taskId)).map(({ action }) => action), ["created"]); const lifecycle = new UserDataLifecycle(db, () => new Date("2026-08-25T01:00:00.000Z")); const exported = await lifecycle.export(userId); assert.equal(exported.collections.agent_tasks?.length, 1); assert.equal(exported.collections.agent_audit?.length, 1); assert.equal((await lifecycle.backup(userId)).encrypted, false); const removed = await lifecycle.delete(userId); assert.equal(removed.agent_tasks, 1); assert.equal(removed.agent_audit, 1); assert.equal(removed.users, 1); assert.equal((await lifecycle.export(userId)).collections.agent_tasks?.length, 0); });
