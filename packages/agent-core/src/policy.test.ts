import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDecision, LlmProvider, ToolDefinition, ToolGateway, ToolInvocation } from "@instagram-agent/contracts";
import { ApprovalManager, PermissionPolicy } from "./policy.js";
import { AgentRuntime } from "./runtime.js";

const definition = (name: string, risk: ToolDefinition["risk"]): ToolDefinition => ({
  name, risk, version: "1.0.0", description: name, timeoutMs: 1_000, inputSchema: { type: "object" }, outputSchema: {},
});
const invokeDecision = (name: string): AgentDecision => ({
  kind: "invoke_tool", tool: { invocationId: `inv-${name}`, name, arguments: {} }, rationaleSummary: "Use requested tool", userMessage: "Working",
});

test("classifies allow, deny, prohibited, and approval-required actions", () => {
  const approvals = new ApprovalManager();
  const policy = new PermissionPolicy(approvals);
  policy.setGrant({ userId: "user-1", allowedTools: ["read_tool", "write_tool", "sensitive_tool", "forbidden"], allowedRisks: ["read", "write", "sensitive", "prohibited"] });
  assert.equal(policy.authorize("task", "user-1", definition("read_tool", "read"), { invocationId: "1", name: "read_tool", arguments: {} }).kind, "allow");
  assert.equal(policy.authorize("task", "user-1", definition("write_tool", "write"), { invocationId: "2", name: "write_tool", arguments: {} }).kind, "allow");
  assert.equal(policy.authorize("task", "user-1", definition("sensitive_tool", "sensitive"), { invocationId: "3", name: "sensitive_tool", arguments: {} }).kind, "approval_required");
  assert.equal(policy.authorize("task", "user-1", definition("forbidden", "prohibited"), { invocationId: "4", name: "forbidden", arguments: {} }).kind, "deny");
  assert.equal(policy.authorize("task", "other", definition("read_tool", "read"), { invocationId: "5", name: "read_tool", arguments: {} }).kind, "deny");
  assert.deepEqual(policy.filterTools("user-1", [definition("read_tool", "read"), definition("unknown", "read"), definition("forbidden", "prohibited")]).map(({ name }) => name), ["read_tool"]);
  assert.deepEqual(policy.filterTools("other", [definition("read_tool", "read")]), []);
});

test("approval tokens are task/user bound, rejectable, and expiring", () => {
  let now = 1_000;
  let sequence = 0;
  const approvals = new ApprovalManager(100, () => now, () => `id-${++sequence}`);
  const first = approvals.request("task-1", "user-1", { invocationId: "inv-1", name: "sensitive", arguments: {} });
  assert.throws(() => approvals.decide({ requestId: first.requestId, token: first.token, taskId: "wrong", userId: "user-1", decision: "approve" }), /not valid/);
  assert.equal(approvals.decide({ requestId: first.requestId, token: first.token, taskId: "task-1", userId: "user-1", decision: "approve" }).status, "approved");
  assert.throws(() => approvals.decide({ requestId: first.requestId, token: first.token, taskId: "task-1", userId: "user-1", decision: "reject" }), /approved/);
  const second = approvals.request("task-2", "user-1", { invocationId: "inv-2", name: "sensitive", arguments: {} });
  assert.equal(approvals.decide({ requestId: second.requestId, token: second.token, taskId: "task-2", userId: "user-1", decision: "reject" }).status, "rejected");
  const third = approvals.request("task-3", "user-1", { invocationId: "inv-3", name: "sensitive", arguments: {} });
  now = 1_101;
  assert.equal(approvals.get(third.requestId)?.status, "expired");
});

test("session-specific grants do not leak to another session", () => {
  const policy = new PermissionPolicy(new ApprovalManager());
  policy.setGrant({ userId: "user-1", sessionId: "session-a", allowedTools: ["read_tool"], allowedRisks: ["read"] });
  assert.deepEqual(policy.filterTools("user-1", [definition("read_tool", "read")], "session-a").map(({ name }) => name), ["read_tool"]);
  assert.deepEqual(policy.filterTools("user-1", [definition("read_tool", "read")], "session-b"), []);
});

test("denied and sensitive actions never reach the executor", async () => {
  const decisions = [invokeDecision("write_tool"), invokeDecision("sensitive_tool")];
  const llm: LlmProvider = { generateDecision: async () => ({ decision: decisions.shift()!, model: "fake", usage: {} }) };
  const invoked: ToolInvocation[] = [];
  const tools: ToolGateway = {
    listTools: async () => [definition("write_tool", "write"), definition("sensitive_tool", "sensitive")],
    invoke: async (_userId, invocation) => { invoked.push(invocation); return { invocationId: invocation.invocationId, ok: true }; },
  };
  const approvals = new ApprovalManager();
  const policy = new PermissionPolicy(approvals);
  const events: string[] = [];
  const publisher = { publish: async (event: { readonly type: string }) => { events.push(event.type); } };
  policy.setGrant({ userId: "user-1", allowedTools: ["sensitive_tool"], allowedRisks: ["sensitive"] });
  const denied = await new AgentRuntime({ llm, tools, permissions: policy, events: publisher }).run({ taskId: "denied", userId: "user-1", text: "write" });
  assert.equal(denied.status, "safely_blocked");
  const sensitive = await new AgentRuntime({ llm, tools, permissions: policy, events: publisher }).run({ taskId: "approval", userId: "user-1", text: "sensitive" });
  assert.equal(sensitive.status, "approval_required");
  assert.equal(invoked.length, 0);
  assert.ok(events.includes("safely_blocked"));
  assert.ok(events.includes("approval_required"));
});
