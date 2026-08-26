import type { AgentDecision, AgentGoal, EventPublisher, LlmDecisionRequest, LlmProvider, TaskRepository, ToolGateway, ToolObservation } from "@instagram-agent/contracts";
import { compactObservation, createTaskState, transitionTask, type AgentTaskState, type TaskTransition } from "./state.js";
import type { PermissionPolicy } from "./policy.js";

export interface AgentRuntimeOptions {
  readonly llm: LlmProvider;
  readonly tools: ToolGateway;
  readonly events?: EventPublisher;
  readonly decisionSchema?: Readonly<Record<string, unknown>>;
  readonly maxIterations?: number;
  readonly timeoutMs?: number;
  readonly maxObservationBytes?: number;
  readonly noProgressLimit?: number;
  readonly permissions?: PermissionPolicy;
  readonly repository?: TaskRepository<AgentTaskState>;
  readonly now?: () => string;
  readonly id?: () => string;
}

export class ConcurrentTaskError extends Error {
  constructor(taskId: string) { super(`Task '${taskId}' is already running`); this.name = "ConcurrentTaskError"; }
}

const activeTasks = new Set<string>();

export class AgentRuntime {
  readonly #options: Required<Pick<AgentRuntimeOptions, "maxIterations" | "timeoutMs" | "maxObservationBytes" | "noProgressLimit" | "now" | "id">> & AgentRuntimeOptions;

  constructor(options: AgentRuntimeOptions) {
    this.#options = {
      ...options,
      maxIterations: options.maxIterations ?? 25,
      timeoutMs: options.timeoutMs ?? 300_000,
      maxObservationBytes: options.maxObservationBytes ?? 32_000,
      noProgressLimit: options.noProgressLimit ?? 3,
      now: options.now ?? (() => new Date().toISOString()),
      id: options.id ?? (() => crypto.randomUUID()),
    };
  }

  async run(goal: AgentGoal, signal?: AbortSignal): Promise<AgentTaskState> {
    return this.#execute(goal, createTaskState(goal, this.#options.now()), signal);
  }

  async resume(snapshot: AgentTaskState, signal?: AbortSignal): Promise<AgentTaskState> {
    if (snapshot.status !== "queued") throw new Error("Only queued tasks can resume");
    return this.#execute({ taskId: snapshot.taskId, userId: snapshot.userId, text: snapshot.goal }, snapshot, signal);
  }

  async #execute(goal: AgentGoal, initial: AgentTaskState, signal?: AbortSignal): Promise<AgentTaskState> {
    if (activeTasks.has(goal.taskId)) throw new ConcurrentTaskError(goal.taskId);
    activeTasks.add(goal.taskId);
    const timeoutSignal = AbortSignal.timeout(this.#options.timeoutMs);
    const runSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let state = await this.#apply(initial, { type: "started", at: this.#options.now() });
    let previousSignature = "";
    let repeatedActions = 0;
    try {
      while (state.iteration < this.#options.maxIterations) {
        if (runSignal.aborted) return this.#abort(state, signal?.aborted === true);
        const discoveredTools = await this.#options.tools.listTools(goal.userId);
        const availableTools = this.#options.permissions ? this.#options.permissions.filterTools(goal.userId, discoveredTools, goal.sessionId) : discoveredTools.filter(({ risk }) => risk !== "prohibited");
        const decision = (await this.#options.llm.generateDecision(this.#request(state, goal, availableTools), runSignal)).decision;
        const terminal = this.#validateTerminal(state, decision);
        if (terminal) return await this.#apply(state, terminal);
        if (decision.kind !== "invoke_tool") throw new Error("Unexpected non-tool decision");
        const selected = availableTools.find(({ name }) => name === decision.tool.name);
        if (!selected || selected.risk === "prohibited") {
          return await this.#apply(state, { type: "safely_blocked", at: this.#options.now(), reason: `Tool '${decision.tool.name}' is unavailable or prohibited` });
        }
        const authorization = this.#options.permissions?.authorize(goal.taskId, goal.userId, selected, decision.tool, goal.sessionId);
        if (authorization?.kind === "deny") {
          return await this.#apply(state, { type: "safely_blocked", at: this.#options.now(), reason: authorization.reason });
        }
        if (authorization?.kind === "approval_required") {
          return await this.#apply(state, { type: "approval_required", at: this.#options.now(), reason: `Approval request ${authorization.request.requestId} is required for '${selected.name}'` });
        }
        const signature = `${decision.tool.name}:${JSON.stringify(decision.tool.arguments)}`;
        repeatedActions = signature === previousSignature ? repeatedActions + 1 : 1;
        previousSignature = signature;
        if (repeatedActions >= this.#options.noProgressLimit) {
          return await this.#apply(state, { type: "safely_blocked", at: this.#options.now(), reason: "Agent repeated the same action without progress" });
        }
        const stepId = this.#options.id();
        state = await this.#apply(state, { type: "step_started", at: this.#options.now(), stepId, iteration: state.iteration + 1, action: decision.tool.name });
        const raw = await this.#options.tools.invoke(goal.userId, decision.tool, runSignal);
        const observation = compactObservation(raw, this.#options.maxObservationBytes, () => `observation://${goal.taskId}/${raw.invocationId}`);
        state = await this.#apply(state, { type: "step_observed", at: this.#options.now(), stepId, observation });
      }
      return await this.#apply(state, { type: "failed", at: this.#options.now(), reason: `Maximum iterations (${this.#options.maxIterations}) reached` });
    } catch (error) {
      if (runSignal.aborted) return this.#abort(state, signal?.aborted === true);
      return await this.#apply(state, { type: "failed", at: this.#options.now(), reason: error instanceof Error ? error.message : "Unknown agent failure" });
    } finally { activeTasks.delete(goal.taskId); }
  }

  #request(state: AgentTaskState, goal: AgentGoal, availableTools: Awaited<ReturnType<ToolGateway["listTools"]>>): LlmDecisionRequest {
    return {
      messages: [{ role: "system", content: "Propose one schema-valid next action. The harness executes and validates tools." }, { role: "user", content: JSON.stringify({ goal: goal.text, iteration: state.iteration, observations: state.observations, availableTools }) }],
      decisionSchema: this.#options.decisionSchema ?? {}, temperature: 0,
    };
  }

  #validateTerminal(state: AgentTaskState, decision: AgentDecision): TaskTransition | null {
    if (decision.kind === "cannot_continue") return { type: "safely_blocked", at: this.#options.now(), reason: decision.reason };
    if (decision.kind !== "complete") return null;
    const successful = new Set(state.observations.filter(({ ok }) => ok).map(({ invocationId }) => invocationId));
    if (decision.evidence.length === 0 || decision.evidence.some((id) => !successful.has(id))) {
      return { type: "failed", at: this.#options.now(), reason: "Completion claim lacks valid successful observation evidence" };
    }
    return { type: "completed", at: this.#options.now(), response: decision.userMessage || decision.summary, reason: decision.summary };
  }

  async #abort(state: AgentTaskState, cancelled: boolean): Promise<AgentTaskState> {
    return this.#apply(state, { type: cancelled ? "cancelled" : "failed", at: this.#options.now(), reason: cancelled ? "Task cancelled" : "Task deadline exceeded" });
  }

  async #apply(state: AgentTaskState, transition: TaskTransition): Promise<AgentTaskState> {
    const next = transitionTask(state, transition);
    await this.#options.repository?.save(next);
    await this.#options.events?.publish({ id: this.#options.id(), taskId: state.taskId, type: transition.type, occurredAt: transition.at, payload: transition });
    return next;
  }
}
