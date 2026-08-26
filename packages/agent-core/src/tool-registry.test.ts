import assert from "node:assert/strict";
import test from "node:test";
import { createStarterTools } from "./starter-tools.js";
import { ToolRegistry } from "./tool-registry.js";
import type { AgentDecision, LlmProvider } from "@instagram-agent/contracts";
import { AgentRuntime } from "./runtime.js";

function registryWithStarters() {
  const registry = new ToolRegistry();
  const starters = createStarterTools(100);
  starters.tools.forEach((tool) => registry.register(tool));
  return { registry, starters };
}

test("registers and exposes stable versioned machine-readable contracts", async () => {
  const { registry, starters } = registryWithStarters();
  const definitions = await registry.listTools("user-1");
  assert.deepEqual(definitions.map(({ name }) => name), ["calculator", "diagnostic_echo", "memory_save", "memory_search"]);
  assert.ok(definitions.every(({ version, inputSchema, outputSchema, timeoutMs, risk }) => version === "1.0.0" && inputSchema && outputSchema && timeoutMs > 0 && risk));
  assert.throws(() => registry.register(starters.tools[0]!), /already registered/);
});

test("validates calculator input/output and never evaluates code", async () => {
  const { registry } = registryWithStarters();
  const result = await registry.invoke("user-1", { invocationId: "calc-1", name: "calculator", arguments: { expression: "2 + 3 * (4 - 1)" } });
  assert.deepEqual(result, { invocationId: "calc-1", ok: true, value: { result: 11 } });
  const injection = await registry.invoke("user-1", { invocationId: "calc-2", name: "calculator", arguments: { expression: "process.exit()" } });
  assert.equal(injection.error?.code, "invalid_expression");
  const invalid = await registry.invoke("user-1", { invocationId: "calc-3", name: "calculator", arguments: {} });
  assert.equal(invalid.error?.code, "invalid_tool_input");
});

test("enforces echo payload size", async () => {
  const { registry } = registryWithStarters();
  const result = await registry.invoke("user-1", { invocationId: "echo-1", name: "diagnostic_echo", arguments: { payload: { text: "ok" } } });
  assert.deepEqual(result.value, { payload: { text: "ok" } });
  const large = await registry.invoke("user-1", { invocationId: "echo-2", name: "diagnostic_echo", arguments: { payload: "x".repeat(200) } });
  assert.equal(large.error?.code, "payload_too_large");
});

test("saves, searches, rejects duplicates, and validates repository input", async () => {
  const { registry } = registryWithStarters();
  assert.equal((await registry.invoke("user-1", { invocationId: "save-1", name: "memory_save", arguments: { id: "one", data: { category: "delivery" } } })).ok, true);
  const duplicate = await registry.invoke("user-1", { invocationId: "save-2", name: "memory_save", arguments: { id: "one", data: {} } });
  assert.equal(duplicate.error?.code, "duplicate_record");
  const search = await registry.invoke("user-1", { invocationId: "search-1", name: "memory_search", arguments: { field: "category", equals: "delivery" } });
  assert.deepEqual(search.value, { records: [{ id: "one", data: { category: "delivery" } }] });
  const invalid = await registry.invoke("user-1", { invocationId: "search-2", name: "memory_search", arguments: { field: "category" } });
  assert.equal(invalid.error?.code, "invalid_tool_input");
});

test("bounds tool execution time", async () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: { name: "slow_tool", version: "1.0.0", description: "Never finishes", risk: "read", timeoutMs: 5, inputSchema: { type: "object" }, outputSchema: {} },
    execute: async () => new Promise(() => undefined),
  });
  const result = await registry.invoke("user-1", { invocationId: "slow-1", name: "slow_tool", arguments: {} });
  assert.equal(result.error?.code, "tool_timeout");
  assert.equal(result.error?.retryable, true);
});

test("rejects malformed tool output", async () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: { name: "broken_output", version: "1.0.0", description: "Returns the wrong type", risk: "read", timeoutMs: 100, inputSchema: { type: "object" }, outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } },
    execute: () => ({ ok: "not-a-boolean" }),
  });
  const result = await registry.invoke("user-1", { invocationId: "broken-1", name: "broken_output", arguments: {} });
  assert.equal(result.error?.code, "invalid_tool_output");
});

test("dynamic loop uses multiple starter tools and their observations", async () => {
  const { registry } = registryWithStarters();
  const decisions: AgentDecision[] = [
    { kind: "invoke_tool", tool: { invocationId: "calc-flow", name: "calculator", arguments: { expression: "6 * 7" } }, rationaleSummary: "Calculate first", userMessage: "Calculating" },
    { kind: "invoke_tool", tool: { invocationId: "save-flow", name: "memory_save", arguments: { id: "answer", data: { value: 42 } } }, rationaleSummary: "Persist the observed answer", userMessage: "Saving" },
    { kind: "complete", summary: "Calculated and saved", evidence: ["calc-flow", "save-flow"], rationaleSummary: "Both tool observations succeeded", userMessage: "The answer was calculated and saved." },
  ];
  const llm: LlmProvider = { generateDecision: async () => ({ decision: decisions.shift()!, model: "fake", usage: {} }) };
  const state = await new AgentRuntime({ llm, tools: registry }).run({ taskId: "starter-flow", userId: "user-1", text: "Calculate and save the answer" });
  assert.equal(state.status, "completed");
  assert.deepEqual(state.observations.map(({ invocationId }) => invocationId), ["calc-flow", "save-flow"]);
});
