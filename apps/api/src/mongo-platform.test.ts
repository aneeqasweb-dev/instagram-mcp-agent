import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTaskState } from "@instagram-agent/agent-core";
import { migrateDatabase } from "@instagram-agent/mongodb-adapter";
import { MongoClient } from "mongodb";
import { MongoApiStore } from "./mongo-platform.js";

const client = new MongoClient(process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 2_000 });
const databaseName = `instagram_api_test_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`;
let store: MongoApiStore;
before(async () => { await client.connect(); const db = client.db(databaseName); await migrateDatabase(db); store = new MongoApiStore(db); });
after(async () => { await client.db(databaseName).dropDatabase(); await client.close(); });

test("Mongo API store persists scoped task state, ordered events, data queries, analytics, and approvals", async () => {
  const db = client.db(databaseName); const state = createTaskState({ taskId: "task", userId: "user-a", text: "persist" }, "2026-08-24T12:00:00.000Z"); await store.create(state); assert.equal((await store.get("user-a", "task"))?.goal, "persist"); assert.equal(await store.get("user-b", "task"), null);
  const updated = await store.update("user-a", "task", 0, (current) => ({ ...current, status: "cancelled", terminalReason: "test", revision: 1 })); assert.equal(updated?.revision, 1); assert.equal(await store.update("user-a", "task", 0, (current) => current), null);
  await store.append("user-a", { id: "e1", taskId: "task", type: "queued", occurredAt: state.createdAt, payload: {} }); await store.append("user-a", { id: "e2", taskId: "task", type: "cancelled", occurredAt: state.createdAt, payload: {} }); assert.deepEqual((await store.after("user-a", "task", "e1")).map(({ id }) => id), ["e2"]);
  const date = new Date("2026-08-24T12:00:00.000Z"); await db.collection("instagram_posts").insertOne({ userId: "user-a", postId: "p1", publishedAt: date, collectedAt: date }); await db.collection("instagram_comments").insertOne({ userId: "user-a", postId: "p1", commentId: "c1", text: "bad", sentiment: "negative", collectedAt: date }); assert.equal((await store.posts("user-a", { cursor: 0, limit: 10 })).total, 1); assert.deepEqual((await store.analytics("user-a")).sentiment, { negative: 1 });
  await db.collection("approvals").insertOne({ userId: "user-a", taskId: "task", requestId: "approval", token: "secret", status: "pending", expiresAt: new Date(Date.now() + 60_000) }); assert.equal(await store.decide({ userId: "user-a", taskId: "task", requestId: "approval", token: "secret", decision: "approve" }), "approved"); assert.equal(await store.decide({ userId: "user-a", taskId: "task", requestId: "approval", token: "secret", decision: "reject" }), "duplicate");
  await db.collection("comment_analysis").insertOne({ userId: "user-a", postId: "p1", commentId: "review", taxonomyVersion: "1.0.0", sentiment: "negative", confidence: .5, reason: "late", complaintCategory: "delivery", severity: "high", language: "english", reviewStatus: "needs_review", analyzedAt: date }); assert.equal((await store.reviews("user-a", 10)).length, 1); const correction = await store.correct("user-a", "review", { sentiment: "mixed" }, "user-a"); assert.equal(correction?.sentiment, "mixed"); assert.equal((correction?.history as unknown[]).length, 1); assert.equal(((await store.complaintGroups("user-a", {})).groups as unknown[]).length, 1);
});
