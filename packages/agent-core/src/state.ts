import type { AgentGoal, ToolObservation } from "@instagram-agent/contracts";
import { z } from "zod";

export const taskStatusSchema = z.enum([
  "queued", "running", "approval_required", "completed", "failed", "cancelled", "safely_blocked",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

const observationErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });
const observationSchema = z.object({
  invocationId: z.string().min(1), ok: z.boolean(), value: z.unknown().optional(), error: observationErrorSchema.optional(),
});

export const agentStepSchema = z.object({
  stepId: z.string().min(1), iteration: z.number().int().positive(), action: z.string().min(1),
  startedAt: z.string().datetime(), completedAt: z.string().datetime().optional(), observation: observationSchema.optional(),
});
export type AgentStep = z.infer<typeof agentStepSchema>;

export const agentTaskStateSchema = z.object({
  taskId: z.string().min(1), userId: z.string().min(1), goal: z.string().min(1), status: taskStatusSchema,
  currentAction: z.string().nullable(), iteration: z.number().int().nonnegative(),
  steps: z.array(agentStepSchema), observations: z.array(observationSchema), errors: z.array(observationErrorSchema),
  remainingWork: z.array(z.string()), terminalReason: z.string().optional(), finalResponse: z.string().optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), revision: z.number().int().nonnegative(),
});
export type AgentTaskState = z.infer<typeof agentTaskStateSchema>;

export type TaskTransition =
  | { readonly type: "started"; readonly at: string }
  | { readonly type: "step_started"; readonly at: string; readonly stepId: string; readonly iteration: number; readonly action: string }
  | { readonly type: "step_observed"; readonly at: string; readonly stepId: string; readonly observation: ToolObservation }
  | { readonly type: "completed"; readonly at: string; readonly response: string; readonly reason: string }
  | { readonly type: "approval_required"; readonly at: string; readonly reason: string }
  | { readonly type: "failed" | "cancelled" | "safely_blocked"; readonly at: string; readonly reason: string };

const terminalStatuses: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled", "safely_blocked"]);

export function createTaskState(goal: AgentGoal, at = new Date().toISOString()): AgentTaskState {
  return agentTaskStateSchema.parse({
    taskId: goal.taskId, userId: goal.userId, goal: goal.text, status: "queued", currentAction: null,
    iteration: 0, steps: [], observations: [], errors: [], remainingWork: [goal.text], createdAt: at, updatedAt: at, revision: 0,
  });
}

function assertTransitionAllowed(state: AgentTaskState, transition: TaskTransition): void {
  if (terminalStatuses.has(state.status)) throw new Error(`Task '${state.taskId}' is already terminal`);
  if (transition.type === "started" && state.status !== "queued") throw new Error("Only queued tasks can start");
  if (transition.type !== "started" && state.status !== "running") throw new Error(`Transition '${transition.type}' requires a running task`);
  if (transition.type === "step_started" && transition.iteration !== state.iteration + 1) throw new Error("Step iteration must be sequential");
  if (transition.type === "step_observed") {
    const step = state.steps.find(({ stepId }) => stepId === transition.stepId);
    if (!step || step.completedAt) throw new Error("Observation requires one matching incomplete step");
    if (state.observations.some(({ invocationId }) => invocationId === transition.observation.invocationId)) throw new Error("Duplicate invocation observation");
  }
}

export function transitionTask(state: AgentTaskState, transition: TaskTransition): AgentTaskState {
  if (transition.type === "step_started") {
    const existing = state.steps.find(({ stepId }) => stepId === transition.stepId);
    if (existing && existing.iteration === transition.iteration && existing.action === transition.action) return state;
  }
  if (transition.type === "step_observed") {
    const existing = state.observations.find(({ invocationId }) => invocationId === transition.observation.invocationId);
    const step = state.steps.find(({ stepId }) => stepId === transition.stepId);
    if (existing && step?.completedAt && JSON.stringify(existing) === JSON.stringify(transition.observation)) return state;
  }
  assertTransitionAllowed(state, transition);
  const base = { ...state, updatedAt: transition.at, revision: state.revision + 1 };
  switch (transition.type) {
    case "started": return agentTaskStateSchema.parse({ ...base, status: "running" });
    case "step_started": return agentTaskStateSchema.parse({
      ...base, iteration: transition.iteration, currentAction: transition.action,
      steps: [...state.steps, { stepId: transition.stepId, iteration: transition.iteration, action: transition.action, startedAt: transition.at }],
    });
    case "step_observed": return agentTaskStateSchema.parse({
      ...base, currentAction: null,
      steps: state.steps.map((step) => step.stepId === transition.stepId ? { ...step, completedAt: transition.at, observation: transition.observation } : step),
      observations: [...state.observations, transition.observation],
      errors: transition.observation.error ? [...state.errors, transition.observation.error] : state.errors,
    });
    case "completed": return agentTaskStateSchema.parse({ ...base, status: "completed", currentAction: null, remainingWork: [], terminalReason: transition.reason, finalResponse: transition.response });
    case "approval_required": return agentTaskStateSchema.parse({ ...base, status: "approval_required", currentAction: null, terminalReason: transition.reason });
    case "failed": return agentTaskStateSchema.parse({ ...base, status: "failed", currentAction: null, terminalReason: transition.reason });
    case "cancelled": return agentTaskStateSchema.parse({ ...base, status: "cancelled", currentAction: null, terminalReason: transition.reason });
    case "safely_blocked": return agentTaskStateSchema.parse({ ...base, status: "safely_blocked", currentAction: null, terminalReason: transition.reason });
  }
}

export function replayTask(initial: AgentTaskState, transitions: readonly TaskTransition[]): AgentTaskState {
  return transitions.reduce(transitionTask, initial);
}

export function compactObservation(
  observation: ToolObservation,
  maximumBytes: number,
  createReference: (observation: ToolObservation) => string,
): ToolObservation {
  const encoded = JSON.stringify(observation.value);
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") <= maximumBytes) return observation;
  return { ...observation, value: { reference: createReference(observation), compacted: true, originalBytes: Buffer.byteLength(encoded, "utf8") } };
}
