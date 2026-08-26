import { buildApi } from "./index.js";
import { McpToolGateway, createLocalStdioTransport } from "@instagram-agent/mcp-client";
import { FollowingCommentsCollector } from "./following-comments.js";
import { InMemoryApiStore, MongoApiStore, StaticAuthenticator } from "./index.js";
import { migrateDatabase, MongoAuditRepository, MongoRecoveryStore, MongoTaskRepository } from "@instagram-agent/mongodb-adapter";
import { MongoClient } from "mongodb";
import { AgentRuntime, InMemoryAuditRepository, InstrumentedLlmProvider, InstrumentedToolGateway, MetricsRegistry, StructuredLogger, recoverInterruptedTasks, redact, type AuditRepository } from "@instagram-agent/agent-core";
import { createConfiguredOllamaProvider } from "@instagram-agent/ollama-adapter";
import type { AgentTaskState } from "@instagram-agent/agent-core";
import type { LlmProvider, TaskRepository, ToolGateway } from "@instagram-agent/contracts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const envFile = path.join(projectRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const host = process.env.API_HOST ?? "127.0.0.1";
const parsedPort = Number.parseInt(process.env.API_PORT ?? "3000", 10);
const port = Number.isSafeInteger(parsedPort) ? parsedPort : 3000;
const gateway = new McpToolGateway({ transportFactory: () => createLocalStdioTransport({ cwd: projectRoot, env: { ...process.env as Record<string, string>, MCP_INSTAGRAM_ENABLED: "true", INSTAGRAM_STORAGE_STATE_PATH: process.env.INSTAGRAM_STORAGE_STATE_PATH ?? path.join(projectRoot, "playwright", ".auth", "instagram.json"), PLAYWRIGHT_EXECUTABLE_PATH: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/usr/bin/google-chrome" } }) });
const token = process.env.API_SESSION_TOKEN;
const auth = new StaticAuthenticator(token ? new Map([[token, { userId: process.env.API_USER_ID ?? "local-user", sessionId: "local-session", expiresAt: Number.MAX_SAFE_INTEGER }]]) : new Map());
let mongo: MongoClient | undefined;
let store: InMemoryApiStore | MongoApiStore;
let taskRepository: TaskRepository<AgentTaskState>;
let audit: AuditRepository;
if (process.env.MONGODB_URI) {
  mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 }); await mongo.connect(); const db = mongo.db(); await migrateDatabase(db); store = new MongoApiStore(db); taskRepository = new MongoTaskRepository(db); audit = new MongoAuditRepository(db);
} else { const memory = new InMemoryApiStore(); store = memory; taskRepository = memory; audit = new InMemoryAuditRepository(); }
const metrics = new MetricsRegistry();
const active = new Map<string, AbortController>();
const logger = new StructuredLogger("api-runtime", { write: (record) => process.stdout.write(`${JSON.stringify(record)}\n`) });
const leastPrivilegeGateway: ToolGateway = { listTools: async (userId) => (await gateway.listTools(userId)).filter(({ risk }) => risk === "read" || risk === "write"), invoke: async (userId, invocation, signal) => { const permitted = (await leastPrivilegeGateway.listTools(userId)).some(({ name }) => name === invocation.name); return permitted ? gateway.invoke(userId, invocation, signal) : { invocationId: invocation.invocationId, ok: false, error: { code: "permission_denied", message: "Tool is outside the server grant", retryable: false } }; } };
const enqueue = async (state: AgentTaskState) => { const key = `${state.userId}\0${state.taskId}`; if (active.has(key)) return; const controller = new AbortController(); active.set(key, controller); metrics.setGauge("queue_depth", active.size); const baseLlm: LlmProvider = process.env.OLLAMA_MODEL ? createConfiguredOllamaProvider(process.env) : { generateDecision: async () => { throw new Error("OLLAMA_MODEL is not configured"); } }; const instrumentation = { logger, metrics, audit, id: () => crypto.randomUUID() }; const runtime = new AgentRuntime({ llm: new InstrumentedLlmProvider(baseLlm, state.userId, state.taskId, instrumentation), tools: new InstrumentedToolGateway(leastPrivilegeGateway, state.taskId, instrumentation), repository: taskRepository, events: { publish: async (event) => { await store.append(state.userId, { ...event, payload: redact(event.payload) }); await audit.append({ auditId: crypto.randomUUID(), userId: state.userId, taskId: state.taskId, occurredAt: event.occurredAt, actor: "harness", action: event.type, status: event.type, data: redact({ payload: event.payload }) }); const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {}; logger.log("task.transition", { level: event.type === "failed" ? "error" : "info", taskId: state.taskId, ...(typeof payload.stepId === "string" ? { stepId: payload.stepId } : {}), ...(payload.observation && typeof payload.observation === "object" && typeof (payload.observation as Record<string, unknown>).invocationId === "string" ? { invocationId: String((payload.observation as Record<string, unknown>).invocationId) } : {}), status: event.type }); } } }); try { await runtime.resume(state, controller.signal); } catch (error) { metrics.increment("errors_total", { component: "runtime", code: error instanceof Error ? error.name : "unknown" }); logger.log("task.runtime_error", { level: "error", taskId: state.taskId, status: "failed", fields: { error: error instanceof Error ? error.message : "Unknown runtime failure" } }); } finally { active.delete(key); metrics.setGauge("queue_depth", active.size); } };
const cancel = (userId: string, taskId: string) => active.get(`${userId}\0${taskId}`)?.abort(new Error("Cancelled by user"));
const app = buildApi({ collector: new FollowingCommentsCollector(gateway), platform: { auth, tasks: store, events: store, data: store, approvals: store, metrics, audit, enqueue, cancel, ready: async () => mongo ? (await mongo.db().command({ ping: 1 }), true) : true, allowedOrigins: [process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173"] } });
if (mongo) await recoverInterruptedTasks(new MongoRecoveryStore(mongo.db()), enqueue, new Date().toISOString());

const shutdown = async () => {
  await app.close();
  await mongo?.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host, port });
