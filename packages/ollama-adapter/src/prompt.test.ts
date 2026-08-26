import assert from "node:assert/strict";
import test from "node:test";
import type { AgentContext } from "@instagram-agent/contracts";
import { buildDecisionRequest } from "./prompt.js";

test("prompt exposes only supplied tools and excludes user ID", () => {
  const context: AgentContext = {
    goal: { taskId: "task-1", userId: "private-user", text: "Find negative comments" },
    iteration: 1, observations: [],
    availableTools: [{ name: "get_comments", version: "1.0.0", description: "Read comments", inputSchema: { type: "object" }, outputSchema: { type: "array" }, risk: "read", timeoutMs: 5_000 }],
  };
  const request = buildDecisionRequest(context);
  const snapshot = JSON.stringify(request);
  assert.match(snapshot, /get_comments/);
  assert.doesNotMatch(snapshot, /private-user/);
  assert.doesNotMatch(snapshot, /delete_comment/);
  assert.equal(request.temperature, 0);
});

test("prompt bounds observations to the latest twenty", () => {
  const context: AgentContext = {
    goal: { taskId: "task-1", userId: "user-1", text: "Inspect observations" }, iteration: 21,
    observations: Array.from({ length: 25 }, (_, index) => ({ invocationId: `inv-${index}`, ok: true, value: index })),
    availableTools: [],
  };
  const content = buildDecisionRequest(context).messages[1]?.content ?? "";
  assert.doesNotMatch(content, /inv-0/);
  assert.match(content, /inv-24/);
});
