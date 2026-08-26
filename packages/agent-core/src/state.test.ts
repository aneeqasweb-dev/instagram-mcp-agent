import assert from "node:assert/strict";
import test from "node:test";
import { compactObservation, createTaskState, replayTask, transitionTask, type TaskTransition } from "./state.js";

const goal = { taskId: "task-1", userId: "user-1", text: "Analyze comments" };
const t0 = "2026-08-24T10:00:00.000Z";
const t1 = "2026-08-24T10:00:01.000Z";
const t2 = "2026-08-24T10:00:02.000Z";
const t3 = "2026-08-24T10:00:03.000Z";
const t4 = "2026-08-24T10:00:04.000Z";

test("replays a task lifecycle deterministically without mutating prior state", () => {
  const initial = createTaskState(goal, t0);
  const transitions: TaskTransition[] = [
    { type: "started", at: t1 },
    { type: "step_started", at: t2, stepId: "step-1", iteration: 1, action: "get_comments" },
    { type: "step_observed", at: t3, stepId: "step-1", observation: { invocationId: "inv-1", ok: true, value: ["comment"] } },
    { type: "completed", at: t4, response: "Complete", reason: "Evidence collected" },
  ];
  const final = replayTask(initial, transitions);
  assert.equal(initial.status, "queued");
  assert.equal(initial.steps.length, 0);
  assert.equal(final.status, "completed");
  assert.equal(final.revision, 4);
  assert.equal(final.steps[0]?.observation?.invocationId, "inv-1");
});

test("rejects illegal and duplicate transitions", () => {
  const queued = createTaskState(goal, t0);
  assert.throws(() => transitionTask(queued, { type: "completed", at: t1, response: "bad", reason: "bad" }), /requires a running task/);
  const running = transitionTask(queued, { type: "started", at: t1 });
  assert.throws(() => transitionTask(running, { type: "step_started", at: t2, stepId: "step-2", iteration: 2, action: "bad" }), /sequential/);
});

test("applies duplicate step transitions idempotently", () => {
  const running = transitionTask(createTaskState(goal, t0), { type: "started", at: t1 });
  const start: TaskTransition = { type: "step_started", at: t2, stepId: "stable-step", iteration: 1, action: "lookup" };
  const started = transitionTask(running, start);
  assert.equal(transitionTask(started, start), started);
  const observedTransition: TaskTransition = { type: "step_observed", at: t3, stepId: "stable-step", observation: { invocationId: "stable-invocation", ok: true, value: 42 } };
  const observed = transitionTask(started, observedTransition);
  assert.equal(transitionTask(observed, observedTransition), observed);
  assert.equal(observed.observations.length, 1);
});

test("models every terminal and pause outcome", () => {
  const running = () => transitionTask(createTaskState(goal, t0), { type: "started", at: t1 });
  assert.equal(transitionTask(running(), { type: "completed", at: t2, response: "done", reason: "done" }).status, "completed");
  assert.equal(transitionTask(running(), { type: "failed", at: t2, reason: "failed" }).status, "failed");
  assert.equal(transitionTask(running(), { type: "cancelled", at: t2, reason: "cancelled" }).status, "cancelled");
  assert.equal(transitionTask(running(), { type: "safely_blocked", at: t2, reason: "blocked" }).status, "safely_blocked");
  assert.equal(transitionTask(running(), { type: "approval_required", at: t2, reason: "approval" }).status, "approval_required");
});

test("compacts oversized observations into durable references", () => {
  const original = { invocationId: "inv-large", ok: true, value: "x".repeat(1_000) };
  const compacted = compactObservation(original, 50, ({ invocationId }) => `observation://task/${invocationId}`);
  assert.deepEqual(compacted.value, { reference: "observation://task/inv-large", compacted: true, originalBytes: 1002 });
  assert.equal(original.value.length, 1_000);
});
