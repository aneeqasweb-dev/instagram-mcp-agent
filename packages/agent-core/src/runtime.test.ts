import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDecision, LlmProvider, ToolDefinition, ToolGateway, ToolInvocation, ToolObservation } from "@instagram-agent/contracts";
import { AgentRuntime, ConcurrentTaskError } from "./runtime.js";
import { createTaskState, transitionTask, type AgentTaskState } from "./state.js";

const rationaleSummary = "A concise reason";
const userMessage = "Working";
const tool: ToolDefinition = { name: "lookup", version: "1.0.0", description: "Look up a value", inputSchema: { type: "object" }, outputSchema: {}, risk: "read", timeoutMs: 1_000 };
const goal = { taskId: "task-runtime", userId: "user-1", text: "Find the answer" };

class SequenceLlm implements LlmProvider {
  constructor(readonly decisions: AgentDecision[]) {}
  async generateDecision() {
    const decision = this.decisions.shift();
    if (!decision) throw new Error("No fake decision remains");
    return { decision, model: "fake", usage: {} };
  }
}

class FakeTools implements ToolGateway {
  readonly invocations: ToolInvocation[] = [];
  constructor(readonly observe: (invocation: ToolInvocation) => ToolObservation = (invocation) => ({ invocationId: invocation.invocationId, ok: true, value: "found" })) {}
  async listTools() { return [tool]; }
  async invoke(_userId: string, invocation: ToolInvocation) { this.invocations.push(invocation); return this.observe(invocation); }
}

const invoke = (id: string, args: Record<string, unknown> = {}): AgentDecision => ({
  kind: "invoke_tool", tool: { invocationId: id, name: "lookup", arguments: args }, rationaleSummary, userMessage,
});
const complete = (evidence: string[]): AgentDecision => ({
  kind: "complete", summary: "Goal satisfied", evidence, rationaleSummary, userMessage: "The answer is ready.",
});

test("uses an observation to select a different second action and complete", async () => {
  const tools = new FakeTools();
  const runtime = new AgentRuntime({ llm: new SequenceLlm([invoke("inv-1", { query: "first" }), invoke("inv-2", { query: "refined" }), complete(["inv-1", "inv-2"])]), tools });
  const state = await runtime.run(goal);
  assert.equal(state.status, "completed");
  assert.deepEqual(tools.invocations.map(({ arguments: args }) => args), [{ query: "first" }, { query: "refined" }]);
  assert.equal(state.finalResponse, "The answer is ready.");
});

test("rejects completion without successful supporting evidence", async () => {
  const runtime = new AgentRuntime({ llm: new SequenceLlm([complete([])]), tools: new FakeTools() });
  const state = await runtime.run({ ...goal, taskId: "no-evidence" });
  assert.equal(state.status, "failed");
  assert.match(state.terminalReason ?? "", /lacks valid.*evidence/i);
});

test("stops on maximum iterations", async () => {
  const runtime = new AgentRuntime({ llm: new SequenceLlm([invoke("i1", { n: 1 }), invoke("i2", { n: 2 })]), tools: new FakeTools(), maxIterations: 2 });
  const state = await runtime.run({ ...goal, taskId: "iterations" });
  assert.equal(state.status, "failed");
  assert.match(state.terminalReason ?? "", /Maximum iterations/);
});

test("stops repeated no-progress actions", async () => {
  const runtime = new AgentRuntime({
    llm: new SequenceLlm([invoke("i1", { same: true }), invoke("i2", { same: true }), invoke("i3", { same: true })]),
    tools: new FakeTools((invocation) => ({ invocationId: invocation.invocationId, ok: false, error: { code: "temporary", message: "failed", retryable: true } })),
    noProgressLimit: 3,
  });
  const state = await runtime.run({ ...goal, taskId: "no-progress" });
  assert.equal(state.status, "safely_blocked");
  assert.match(state.terminalReason ?? "", /repeated the same action/);
});

test("honors cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const runtime = new AgentRuntime({ llm: new SequenceLlm([]), tools: new FakeTools() });
  const state = await runtime.run({ ...goal, taskId: "cancelled" }, controller.signal);
  assert.equal(state.status, "cancelled");
});

test("stops at the wall-clock deadline", async () => {
  const llm: LlmProvider = {
    generateDecision: async (_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  };
  const runtime = new AgentRuntime({ llm, tools: new FakeTools(), timeoutMs: 5 });
  const state = await runtime.run({ ...goal, taskId: "deadline" });
  assert.equal(state.status, "failed");
  assert.match(state.terminalReason ?? "", /deadline exceeded/i);
});

test("blocks unavailable tools before execution", async () => {
  const tools = new FakeTools();
  const decision: AgentDecision = { kind: "invoke_tool", tool: { invocationId: "bad", name: "delete_all", arguments: {} }, rationaleSummary, userMessage };
  const state = await new AgentRuntime({ llm: new SequenceLlm([decision]), tools }).run({ ...goal, taskId: "blocked-tool" });
  assert.equal(state.status, "safely_blocked");
  assert.equal(tools.invocations.length, 0);
});

test("explains when the model cannot continue safely", async () => {
  const decision: AgentDecision = { kind: "cannot_continue", reason: "The goal requires a capability that is not available", rationaleSummary, userMessage: "I cannot complete this goal with the available tools." };
  const state = await new AgentRuntime({ llm: new SequenceLlm([decision]), tools: new FakeTools() }).run({ ...goal, taskId: "impossible" });
  assert.equal(state.status, "safely_blocked");
  assert.match(state.terminalReason ?? "", /capability.*not available/i);
});

test("prevents concurrent execution of the same task", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const slowTools = new FakeTools(asyncObservation);
  function asyncObservation(invocation: ToolInvocation): ToolObservation { return { invocationId: invocation.invocationId, ok: true }; }
  const llm: LlmProvider = { generateDecision: async () => { await waiting; return { decision: complete(["never"]), model: "fake", usage: {} }; } };
  const runtime = new AgentRuntime({ llm, tools: slowTools });
  const first = runtime.run({ ...goal, taskId: "same-task" });
  await assert.rejects(runtime.run({ ...goal, taskId: "same-task" }), ConcurrentTaskError);
  release();
  await first;
});

test("resumes a queued snapshot after its existing steps and persists every new transition", async () => { const saved: AgentTaskState[] = []; let snapshot = createTaskState({ ...goal, taskId: "resume" }, "2026-08-25T00:00:00.000Z"); snapshot = transitionTask(snapshot, { type: "started", at: "2026-08-25T00:00:01.000Z" }); snapshot = transitionTask(snapshot, { type: "step_started", at: "2026-08-25T00:00:02.000Z", stepId: "old-step", iteration: 1, action: "lookup" }); snapshot = transitionTask(snapshot, { type: "step_observed", at: "2026-08-25T00:00:03.000Z", stepId: "old-step", observation: { invocationId: "old-inv", ok: true } }); snapshot = { ...snapshot, status: "queued", revision: snapshot.revision + 1 }; const runtime = new AgentRuntime({ llm: new SequenceLlm([invoke("new-inv"), complete(["old-inv", "new-inv"])]), tools: new FakeTools(), repository: { get: async () => null, save: async (state) => { saved.push(state); } }, id: () => "new-step" }); const completed = await runtime.resume(snapshot); assert.equal(completed.status, "completed"); assert.deepEqual(completed.steps.map(({ stepId, iteration }) => ({ stepId, iteration })), [{ stepId: "old-step", iteration: 1 }, { stepId: "new-step", iteration: 2 }]); assert.ok(saved.length >= 4); assert.equal(saved.at(-1)?.status, "completed"); });
