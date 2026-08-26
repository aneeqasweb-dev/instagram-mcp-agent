import assert from "node:assert/strict";
import test from "node:test";
import { createTaskState, MetricsRegistry } from "@instagram-agent/agent-core";
import { buildApi } from "./index.js";
import { InMemoryApiStore, StaticAuthenticator, type ApiPlatformOptions } from "./platform.js";

const authorization = (token = "token-a") => ({ authorization: `Bearer ${token}` });
function fixture(overrides: Partial<ApiPlatformOptions> = {}) {
  const store = new InMemoryApiStore(); let sequence = 0;
  const platform: ApiPlatformOptions = { auth: new StaticAuthenticator(new Map([
    ["token-a", { userId: "user-a", sessionId: "session-a", expiresAt: Number.MAX_SAFE_INTEGER }],
    ["token-b", { userId: "user-b", sessionId: "session-b", expiresAt: Number.MAX_SAFE_INTEGER }],
  ])), tasks: store, events: store, data: store, approvals: store, now: () => "2026-08-24T12:00:00.000Z", id: () => `id-${++sequence}`, ...overrides };
  return { store, app: buildApi({ platform }) };
}

test("health, readiness, validation, authentication, CORS, and typed errors are stable", async () => {
  const { app } = fixture({ ready: async () => false, allowedOrigins: ["https://dashboard.test"] });
  try {
    assert.deepEqual((await app.inject({ method: "GET", url: "/health" })).json(), { status: "ok" });
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 503);
    const unauthenticated = await app.inject({ method: "POST", url: "/api/agent/tasks", payload: { goal: "work" } });
    assert.equal(unauthenticated.statusCode, 401); assert.equal(unauthenticated.json().error.code, "authentication_required"); assert.ok(unauthenticated.json().error.requestId);
    const malformed = await app.inject({ method: "POST", url: "/api/agent/tasks", headers: authorization(), payload: { goal: "" } });
    assert.equal(malformed.statusCode, 400); assert.equal(malformed.json().error.code, "invalid_goal");
    const allowed = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://dashboard.test" } });
    assert.equal(allowed.headers["access-control-allow-origin"], "https://dashboard.test"); assert.equal(allowed.headers["x-frame-options"], "DENY");
    assert.equal((await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.test" } })).statusCode, 403);
  } finally { await app.close(); }
});

test("rate and body limits cover public and authenticated endpoints", async () => {
  const limited = fixture({ rateLimit: 1 });
  try { assert.equal((await limited.app.inject({ method: "GET", url: "/health" })).statusCode, 200); assert.equal((await limited.app.inject({ method: "GET", url: "/health" })).statusCode, 429); } finally { await limited.app.close(); }
  const normal = fixture();
  try { const response = await normal.app.inject({ method: "POST", url: "/api/agent/tasks", headers: { ...authorization(), "content-type": "application/json" }, payload: JSON.stringify({ goal: "x".repeat(1_100_000) }) }); assert.equal(response.statusCode, 413); assert.equal(response.json().error.code, "body_too_large"); } finally { await normal.app.close(); }
});

test("authenticated diagnostics expose controlled API failures and latency without payloads", async () => { const metrics = new MetricsRegistry(); const { app } = fixture({ metrics }); try { await app.inject({ method: "POST", url: "/api/agent/tasks", headers: authorization(), payload: { goal: "" } }); const diagnostics = (await app.inject({ method: "GET", url: "/api/diagnostics", headers: authorization() })).json().data; assert.equal(diagnostics.counters["errors_total{component=api,status=400}"], 1); assert.equal(diagnostics.durations["http_request_duration_ms{route=/api/agent/tasks}"].count, 1); assert.doesNotMatch(JSON.stringify(diagnostics), /goal/); } finally { await app.close(); } });

test("creates, scopes, inspects, paginates, and cancels durable task state", async () => {
  let enqueuedAfterPersist = false; let backing!: InMemoryApiStore;
  const { app, store } = fixture({ enqueue: async (state) => { enqueuedAfterPersist = (await backing.get(state.userId, state.taskId)) !== null; } }); backing = store;
  try {
    const created = await app.inject({ method: "POST", url: "/api/agent/tasks", headers: authorization(), payload: { goal: "Analyze my comments" } });
    assert.equal(created.statusCode, 202); const task = created.json().data; assert.equal(task.status, "queued"); assert.ok(await store.get("user-a", task.taskId)); await new Promise((resolve) => setImmediate(resolve)); assert.equal(enqueuedAfterPersist, true);
    assert.equal((await app.inject({ method: "GET", url: `/api/agent/tasks/${task.taskId}`, headers: authorization("token-b") })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: `/api/agent/tasks/${task.taskId}/status`, headers: authorization() })).json().data.status, "queued");
    const steps = await app.inject({ method: "GET", url: `/api/agent/tasks/${task.taskId}/steps?limit=1`, headers: authorization() }); assert.deepEqual(steps.json().data, []);
    const cancelled = await app.inject({ method: "POST", url: `/api/agent/tasks/${task.taskId}/cancel`, headers: authorization() }); assert.equal(cancelled.json().data.status, "cancelled");
    assert.equal((await app.inject({ method: "POST", url: `/api/agent/tasks/${task.taskId}/cancel`, headers: authorization() })).statusCode, 409);
  } finally { await app.close(); }
});

test("cancellation detects revision races and approval decisions reject expiry and duplicates", async () => {
  const store = new InMemoryApiStore(); const originalUpdate = store.update.bind(store); let conflict = true;
  const { app } = fixture({ tasks: { create: store.create.bind(store), get: store.get.bind(store), update: async (...args) => conflict ? (conflict = false, null) : originalUpdate(...args) }, events: store, data: store, approvals: store });
  try {
    const state = createTaskState({ taskId: "race", userId: "user-a", text: "race" }, "2026-08-24T12:00:00.000Z"); await store.create(state);
    assert.equal((await app.inject({ method: "POST", url: "/api/agent/tasks/race/cancel", headers: authorization() })).statusCode, 409);
    store.approvalRecords.set("pending", { userId: "user-a", taskId: "race", token: "secret", expiresAt: Number.MAX_SAFE_INTEGER, status: "pending" });
    const approved = await app.inject({ method: "POST", url: "/api/agent/tasks/race/approvals/pending", headers: authorization(), payload: { token: "secret", decision: "approve" } }); assert.equal(approved.json().data.status, "approved");
    assert.equal((await app.inject({ method: "POST", url: "/api/agent/tasks/race/approvals/pending", headers: authorization(), payload: { token: "secret", decision: "reject" } })).statusCode, 409);
    store.approvalRecords.set("expired", { userId: "user-a", taskId: "race", token: "old", expiresAt: 1, status: "pending" });
    assert.equal((await app.inject({ method: "POST", url: "/api/agent/tasks/race/approvals/expired", headers: authorization(), payload: { token: "old", decision: "approve" } })).statusCode, 410);
    store.approvalRecords.set("rejected", { userId: "user-a", taskId: "race", token: "no", expiresAt: Number.MAX_SAFE_INTEGER, status: "pending" });
    assert.equal((await app.inject({ method: "POST", url: "/api/agent/tasks/race/approvals/rejected", headers: authorization(), payload: { token: "no", decision: "reject" } })).json().data.task.status, "cancelled");
    assert.equal((await app.inject({ method: "POST", url: "/api/agent/tasks/race/approvals/rejected", headers: authorization(), payload: { token: "no", decision: "reject" } })).json().error.code, "task_terminal");
  } finally { await app.close(); }
});

test("post/comment queries and analytics are filtered, paginated, and user scoped", async () => {
  const { app, store } = fixture(); store.postRecords.push({ userId: "user-a", postId: "p2", publishedAt: "2026-08-24" }, { userId: "user-a", postId: "p1", publishedAt: "2026-08-23" }, { userId: "user-b", postId: "private", publishedAt: "2026-08-25" }); store.commentRecords.push({ userId: "user-a", commentId: "c1", postId: "p1", sentiment: "negative", collectedAt: "2026-08-24" }, { userId: "user-a", commentId: "c2", postId: "p2", sentiment: "positive", collectedAt: "2026-08-23" }, { userId: "user-b", commentId: "private", postId: "private", sentiment: "negative" });
  try {
    const posts = (await app.inject({ method: "GET", url: "/api/posts?limit=1", headers: authorization() })).json(); assert.equal(posts.data[0].postId, "p2"); assert.equal(posts.page.total, 2); assert.equal(posts.page.nextCursor, 1);
    const comments = (await app.inject({ method: "GET", url: "/api/comments?sentiment=negative", headers: authorization() })).json(); assert.deepEqual(comments.data.map((item: { commentId: string }) => item.commentId), ["c1"]);
    const analytics = (await app.inject({ method: "GET", url: "/api/analytics/summary", headers: authorization() })).json().data; assert.deepEqual(analytics, { posts: 2, comments: 2, sentiment: { negative: 1, positive: 1 }, semantics: "Counts include the current user's stored records; missing sentiment is grouped as unknown." });
  } finally { await app.close(); }
});

test("complaint evidence and review corrections are user-scoped and audit preserving", async () => {
  const { app, store } = fixture(); store.analysisRecords.push({ userId: "user-a", commentId: "c1", sentiment: "negative", confidence: .55, reason: "Late", complaintCategory: "delivery", severity: "high", language: "english", reviewStatus: "needs_review", complaint: "Late delivery" }, { userId: "user-a", commentId: "c2", sentiment: "negative", confidence: .9, reason: "Late", complaintCategory: "delivery", severity: "high", language: "english", reviewStatus: "auto_accepted", complaint: "Late delivery" }, { userId: "user-b", commentId: "private", sentiment: "negative", complaintCategory: "delivery", severity: "high", reviewStatus: "needs_review" });
  try {
    const groups = (await app.inject({ method: "GET", url: "/api/analytics/complaints?category=delivery", headers: authorization() })).json().data; assert.deepEqual(groups.groups[0], { category: "delivery", severity: "high", count: 2, commentIds: ["c1", "c2"] });
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/reviews", headers: authorization() })).json().data.map((item: { commentId: string }) => item.commentId), ["c1"]);
    assert.equal((await app.inject({ method: "PATCH", url: "/api/reviews/c1", headers: authorization(), payload: { correction: { sentiment: "impossible" } } })).statusCode, 400);
    const corrected = (await app.inject({ method: "PATCH", url: "/api/reviews/c1", headers: authorization(), payload: { correction: { sentiment: "mixed" } } })).json().data; assert.equal(corrected.sentiment, "mixed"); assert.equal(corrected.original.sentiment, "negative"); assert.equal(corrected.history.length, 1); assert.equal(corrected.reviewStatus, "reviewed");
    assert.equal((await app.inject({ method: "PATCH", url: "/api/reviews/private", headers: authorization(), payload: { correction: { sentiment: "mixed" } } })).statusCode, 404);
  } finally { await app.close(); }
});

test("persisted event replay resumes after an exact ID without duplicates or cross-user leakage", async () => {
  const store = new InMemoryApiStore(); await store.create(createTaskState({ taskId: "task", userId: "user-a", text: "events" })); await store.create(createTaskState({ taskId: "task", userId: "user-b", text: "private" }));
  await store.append("user-a", { id: "e1", taskId: "task", type: "task.queued", occurredAt: "2026-08-24T12:00:00.000Z", payload: {} }); await store.append("user-a", { id: "e2", taskId: "task", type: "task.running", occurredAt: "2026-08-24T12:00:01.000Z", payload: {} }); await store.append("user-b", { id: "private", taskId: "task", type: "private", occurredAt: "2026-08-24T12:00:02.000Z", payload: {} });
  assert.deepEqual((await store.after("user-a", "task", "e1")).map(({ id }) => id), ["e2"]); assert.deepEqual((await store.after("user-a", "task", "e2")), []);
});

test("authenticated SSE emits persisted frames, heartbeats, and resumes with Last-Event-ID", async () => {
  const { app, store } = fixture({ heartbeatMs: 25 }); await store.create(createTaskState({ taskId: "stream", userId: "user-a", text: "stream" })); await store.append("user-a", { id: "e1", taskId: "stream", type: "task.queued", occurredAt: "2026-08-24T12:00:00.000Z", payload: {} }); await store.append("user-a", { id: "e2", taskId: "stream", type: "task.running", occurredAt: "2026-08-24T12:00:01.000Z", payload: {} });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 }); const address = app.server.address(); assert.ok(address && typeof address === "object"); const url = `http://127.0.0.1:${address.port}/api/agent/tasks/stream/events`;
    const firstAbort = new AbortController(); const first = await fetch(url, { headers: authorization(), signal: firstAbort.signal }); assert.equal(first.status, 200); const firstChunk = new TextDecoder().decode((await first.body!.getReader().read()).value); firstAbort.abort(); assert.match(firstChunk, /id: e1[\s\S]*id: e2[\s\S]*heartbeat/);
    const resumeAbort = new AbortController(); const resumed = await fetch(url, { headers: { ...authorization(), "last-event-id": "e1" }, signal: resumeAbort.signal }); const resumedChunk = new TextDecoder().decode((await resumed.body!.getReader().read()).value); resumeAbort.abort(); assert.doesNotMatch(resumedChunk, /id: e1/); assert.match(resumedChunk, /id: e2[\s\S]*heartbeat/);
    const liveAbort = new AbortController(); const live = await fetch(url, { headers: { ...authorization(), "last-event-id": "e2" }, signal: liveAbort.signal }); const reader = live.body!.getReader(); await reader.read(); await store.append("user-a", { id: "e3", taskId: "stream", type: "task.completed", occurredAt: "2026-08-24T12:00:02.000Z", payload: {} }); const liveChunk = new TextDecoder().decode((await reader.read()).value); liveAbort.abort(); assert.match(liveChunk, /id: e3[\s\S]*heartbeat/);
  } finally { await app.close(); }
});
