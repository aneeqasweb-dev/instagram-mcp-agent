import Fastify from "fastify";
import type { ConnectionListResult, CollectionRequest, FollowingCommentsResult, ProfileContentResult } from "./following-comments.js";
import { InMemoryApiStore, StaticAuthenticator, registerPlatform, type ApiPlatformOptions } from "./platform.js";

export interface CollectorPort { collect(request: CollectionRequest): Promise<FollowingCommentsResult>; listConnections(list: "followers" | "following", cursor?: string, signal?: AbortSignal): Promise<ConnectionListResult>; collectProfile(username: string, cursor?: string): Promise<ProfileContentResult>; close(): Promise<void> }

export function buildApi(options: { collector?: CollectorPort; platform?: ApiPlatformOptions } = {}) {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  app.get("/health", async () => ({ status: "ok" }));
  const fallback = new InMemoryApiStore();
  const localToken = process.env.API_SESSION_TOKEN;
  const sessions = localToken ? new Map([[localToken, { userId: process.env.API_USER_ID ?? "local-user", sessionId: "local-session", expiresAt: Number.MAX_SAFE_INTEGER }]]) : new Map();
  registerPlatform(app, options.platform ?? { auth: new StaticAuthenticator(sessions), tasks: fallback, events: fallback, data: fallback, approvals: fallback });
  app.post("/api/instagram/following-comments", async (request, reply) => {
    if (!options.collector) return reply.code(503).send({ error: { code: "collector_unavailable", message: "Instagram collector is not configured" } });
    const body = request.body as Record<string, unknown> | null;
    const accountsPerBatch = Number(body?.accountsPerBatch ?? 5);
    const postsPerAccount = Number(body?.postsPerAccount ?? 2);
    const commentsPerPost = Number(body?.commentsPerPost ?? 10);
    const cursor = body?.cursor;
    const followerCursor = body?.followerCursor;
    if (!Number.isInteger(accountsPerBatch) || accountsPerBatch < 1 || accountsPerBatch > 20 || !Number.isInteger(postsPerAccount) || postsPerAccount < 1 || postsPerAccount > 5 || !Number.isInteger(commentsPerPost) || commentsPerPost < 1 || commentsPerPost > 50 || (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor))) || (followerCursor !== undefined && (typeof followerCursor !== "string" || !/^\d+$/.test(followerCursor)))) {
      return reply.code(400).send({ error: { code: "invalid_collection_request", message: "Collection bounds or cursor are invalid" } });
    }
    return { data: await options.collector.collect({ accountsPerBatch, postsPerAccount, commentsPerPost, ...(typeof cursor === "string" ? { cursor } : {}), ...(typeof followerCursor === "string" ? { followerCursor } : {}) }) };
  });
  app.post("/api/instagram/profile-content", async (request, reply) => {
    if (!options.collector) return reply.code(503).send({ error: { code: "collector_unavailable", message: "Instagram collector is not configured" } });
    const body = request.body as Record<string, unknown> | null;
    const username = typeof body?.username === "string" ? body.username.replace(/^@/, "").trim() : "";
    const cursor = body?.cursor;
    if (!/^[A-Za-z0-9._ -]{1,64}$/.test(username) || (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor)))) return reply.code(400).send({ error: { code: "invalid_profile_request", message: "Instagram username, friend name, or cursor is invalid" } });
    try { return { data: await options.collector.collectProfile(username, typeof cursor === "string" ? cursor : undefined) }; }
    catch (error) { return reply.code(502).send({ error: { code: "profile_collection_failed", message: error instanceof Error ? error.message : "Profile collection failed" } }); }
  });
  app.post("/api/instagram/connections", async (request, reply) => {
    if (!options.collector) return reply.code(503).send({ error: { code: "collector_unavailable", message: "Instagram collector is not configured" } });
    const body = request.body as Record<string, unknown> | null;
    const list = body?.list;
    const cursor = body?.cursor;
    if ((list !== "followers" && list !== "following") || (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor)))) return reply.code(400).send({ error: { code: "invalid_connections_request", message: "Connection list or cursor is invalid" } });
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("Connection collection stopped"));
    request.raw.once("aborted", abort); reply.raw.once("close", abort);
    try { return { data: await options.collector.listConnections(list, typeof cursor === "string" ? cursor : undefined, controller.signal) }; }
    finally { request.raw.off("aborted", abort); reply.raw.off("close", abort); }
  });
  app.addHook("onClose", async () => options.collector?.close());
  return app;
}

export * from "./platform.js";
export { MongoApiStore } from "./mongo-platform.js";
