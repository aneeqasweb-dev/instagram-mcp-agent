import assert from "node:assert/strict";
import test from "node:test";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpGatewayError, McpToolGateway } from "./mcp-tool-gateway.js";
import { AgentRuntime } from "@instagram-agent/agent-core";
import type { AgentDecision, LlmProvider } from "@instagram-agent/contracts";
import { MongoClient } from "mongodb";
import { createServer } from "node:http";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const tsxCommand = path.join(projectRoot, "node_modules", ".bin", "tsx");
const productionServer = path.join(projectRoot, "packages", "mcp-server", "src", "stdio.ts");
const fixtureServer = path.join(projectRoot, "packages", "mcp-server", "src", "test-fixture-stdio.ts");

function stdio(server: string, stderr: "pipe" | "ignore" = "ignore", env?: Record<string, string>) {
  return () => new StdioClientTransport({ command: tsxCommand, args: [server], cwd: projectRoot, stderr, ...(env ? { env } : {}) });
}

test("discovers, invokes, reconnects, and preserves idempotent writes over stdio", async () => {
  const transports: StdioClientTransport[] = [];
  let diagnostics = "";
  const gateway = new McpToolGateway({
    transportFactory: () => {
      const transport = stdio(productionServer, "pipe")();
      transport.stderr?.on("data", (chunk) => { diagnostics += String(chunk); });
      transports.push(transport);
      return transport;
    },
  });
  try {
    const tools = await gateway.listTools("user-1");
    assert.deepEqual(tools.map(({ name }) => name), ["calculator", "diagnostic_echo", "memory_save", "memory_search"]);
    assert.ok(tools.every(({ version, timeoutMs, inputSchema, outputSchema }) => version === "1.0.0" && timeoutMs > 0 && inputSchema && outputSchema));

    const calculation = await gateway.invoke("user-1", { invocationId: "calc-mcp", name: "calculator", arguments: { expression: "8 * 7" } });
    assert.deepEqual(calculation.value, { result: 56 });

    const diagnostic = await gateway.invoke("user-1", { invocationId: "echo-mcp", name: "diagnostic_echo", arguments: { payload: { healthy: true } } });
    assert.deepEqual(diagnostic.value, { payload: { healthy: true } });

    const write = { invocationId: "save-mcp", name: "memory_save", arguments: { id: "mcp-record", data: { value: 56 } } };
    const first = await gateway.invoke("user-1", write);
    const retry = await gateway.invoke("user-1", write);
    assert.equal(first.ok, true);
    assert.deepEqual(retry, first);
    const duplicate = await gateway.invoke("user-1", { ...write, invocationId: "different-invocation" });
    assert.equal(duplicate.error?.code, "duplicate_record");
    const search = await gateway.invoke("user-1", { invocationId: "search-mcp", name: "memory_search", arguments: {} });
    assert.deepEqual(search.value, { records: [{ id: "mcp-record", data: { value: 56 } }] });

    const conflict = await gateway.invoke("user-1", { invocationId: "save-mcp", name: "memory_save", arguments: { id: "changed", data: {} } });
    assert.equal(conflict.error?.code, "invocation_id_conflict");

    const invalid = await gateway.invoke("user-1", { invocationId: "invalid-mcp", name: "calculator", arguments: {} });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error?.code, "mcp_validation_error");

    await gateway.reconnect();
    assert.equal((await gateway.listTools("user-1")).length, 4);
    assert.ok(transports.length >= 2);
    assert.match(diagnostics, /MCP stdio server ready/);
    await gateway.close();
    assert.ok(transports.every(({ pid }) => pid === null));
  } finally { await gateway.close(); }
});

test("registers and invokes MongoDB tools through the production MCP process", async () => {
  const databaseName = `instagram_mcp_test_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`;
  const uri = `mongodb://127.0.0.1:27017/${databaseName}`;
  const cleanupClient = new MongoClient(uri, { serverSelectionTimeoutMS: 2_000 });
  const gateway = new McpToolGateway({
    transportFactory: stdio(productionServer, "ignore", { ...process.env as Record<string, string>, MCP_DATABASE_ENABLED: "true", MONGODB_URI: uri }),
  });
  try {
    const tools = await gateway.listTools("user-1");
    assert.ok(["database_save", "database_search", "database_update"].every((name) => tools.some((tool) => tool.name === name)));
    const saved = await gateway.invoke("user-1", { invocationId: "mcp-db-save", name: "database_save", arguments: { entity: "agent_memory", id: "mcp-memory", data: { sourceTaskId: "mcp-task", kind: "application", text: "MCP persistence" } } });
    assert.equal(saved.ok, true);
    const found = await gateway.invoke("user-1", { invocationId: "mcp-db-search", name: "database_search", arguments: { entity: "agent_memory", field: "memoryId", equals: "mcp-memory" } });
    assert.equal((found.value as { records: unknown[] }).records.length, 1);
  } finally {
    await gateway.close();
    await cleanupClient.connect();
    await cleanupClient.db(databaseName).dropDatabase();
    await cleanupClient.close();
  }
});

test("registers and invokes bounded Instagram read tools through production MCP", async () => {
  const fixture = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<article data-ig-post-id="mcp-post" data-ig-url="/p/mcp-post" data-ig-published-at="2026-08-24T10:00:00Z"><span data-ig-caption>MCP fixture</span></article>');
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind");
  const origin = `http://127.0.0.1:${address.port}`;
  const gateway = new McpToolGateway({
    transportFactory: stdio(productionServer, "ignore", {
      ...process.env as Record<string, string>,
      MCP_INSTAGRAM_ENABLED: "true",
      INSTAGRAM_ALLOWED_ORIGIN: origin,
      PLAYWRIGHT_EXECUTABLE_PATH: "/usr/bin/google-chrome",
      PLAYWRIGHT_HEADLESS: "true",
    }),
  });
  try {
    const tools = await gateway.listTools("user-1");
    assert.ok(["instagram_get_posts", "instagram_get_post_details", "instagram_get_comments"].every((name) => tools.some((tool) => tool.name === name)));
    const result = await gateway.invoke("user-1", { invocationId: "mcp-instagram-posts", name: "instagram_get_posts", arguments: { profilePath: "/authorized-profile", limit: 10 } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.value, { posts: [{ postId: "mcp-post", url: "/p/mcp-post", publishedAt: "2026-08-24T10:00:00Z", caption: "MCP fixture" }], nextCursor: null });
  } finally {
    await gateway.close();
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()));
  }
});

test("runs the harness through MCP rather than direct starter-tool calls", async () => {
  const gateway = new McpToolGateway({ transportFactory: stdio(productionServer) });
  const decisions: AgentDecision[] = [
    { kind: "invoke_tool", tool: { invocationId: "harness-calc", name: "calculator", arguments: { expression: "9 * 9" } }, rationaleSummary: "Calculate through MCP", userMessage: "Calculating" },
    { kind: "complete", summary: "Calculation complete", evidence: ["harness-calc"], rationaleSummary: "MCP observation succeeded", userMessage: "The result is 81." },
  ];
  const llm: LlmProvider = { generateDecision: async () => ({ decision: decisions.shift()!, model: "fake", usage: {} }) };
  try {
    const state = await new AgentRuntime({ llm, tools: gateway }).run({ taskId: "harness-mcp", userId: "user-1", text: "Calculate 9 * 9" });
    assert.equal(state.status, "completed");
    assert.deepEqual(state.observations[0]?.value, { result: 81 });
  } finally { await gateway.close(); }
});

test("enforces payload limits before sending", async () => {
  const gateway = new McpToolGateway({ transportFactory: stdio(productionServer), maximumPayloadBytes: 80 });
  const result = await gateway.invoke("user-1", { invocationId: "large", name: "diagnostic_echo", arguments: { payload: "x".repeat(500) } });
  assert.equal(result.error?.code, "mcp_payload_too_large");
  assert.equal(gateway.connected, false);
});

test("normalizes protocol timeout and connection errors", async () => {
  const slow = new McpToolGateway({ transportFactory: stdio(fixtureServer) });
  try {
    const result = await slow.invoke("user-1", { invocationId: "slow", name: "slow_tool", arguments: {} });
    assert.equal(result.error?.code, "mcp_timeout");
    assert.equal(result.error?.retryable, true);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const cancelled = await slow.invoke("user-1", { invocationId: "cancelled", name: "cancellable_tool", arguments: {} }, controller.signal);
    assert.equal(cancelled.error?.code, "mcp_cancelled");
    assert.equal(cancelled.error?.retryable, false);

    const badOutput = await slow.invoke("user-1", { invocationId: "bad-output", name: "bad_output", arguments: {} });
    assert.equal(badOutput.ok, false);
    assert.equal(badOutput.error?.code, "mcp_validation_error");
  } finally { await slow.close(); }

  const unavailable = new McpToolGateway({ transportFactory: () => new StdioClientTransport({ command: path.join(projectRoot, "missing-command") }) });
  await assert.rejects(unavailable.listTools("user-1"), (error: unknown) => error instanceof McpGatewayError && error.code === "mcp_connect_failed" && error.retryable);
  await unavailable.close();
});
