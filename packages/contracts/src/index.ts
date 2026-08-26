export type TaskId = string;
export type UserId = string;

export interface AgentGoal {
  readonly taskId: TaskId;
  readonly userId: UserId;
  readonly sessionId?: string;
  readonly text: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly risk: "read" | "write" | "sensitive" | "prohibited";
  readonly timeoutMs: number;
}

export interface ToolInvocation {
  readonly invocationId: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ToolObservation {
  readonly invocationId: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export interface AgentContext {
  readonly goal: AgentGoal;
  readonly iteration: number;
  readonly observations: readonly ToolObservation[];
  readonly availableTools: readonly ToolDefinition[];
}

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string;
}

export interface LlmDecisionRequest {
  readonly messages: readonly LlmMessage[];
  readonly decisionSchema: Readonly<Record<string, unknown>>;
  readonly temperature?: number;
}

export interface LlmUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalDurationMs?: number;
}

export interface LlmDecisionResponse {
  readonly decision: AgentDecision;
  readonly model: string;
  readonly usage: LlmUsage;
}

export type AgentDecision =
  | { readonly kind: "invoke_tool"; readonly tool: ToolInvocation; readonly rationaleSummary: string; readonly userMessage: string }
  | { readonly kind: "complete"; readonly summary: string; readonly evidence: readonly string[]; readonly rationaleSummary: string; readonly userMessage: string }
  | { readonly kind: "cannot_continue"; readonly reason: string; readonly rationaleSummary: string; readonly userMessage: string };

export interface LlmProvider {
  generateDecision(request: LlmDecisionRequest, signal?: AbortSignal): Promise<LlmDecisionResponse>;
}

export interface ToolGateway {
  listTools(userId: UserId): Promise<readonly ToolDefinition[]>;
  invoke(userId: UserId, invocation: ToolInvocation, signal?: AbortSignal): Promise<ToolObservation>;
}

export interface TaskRepository<TState> {
  get(taskId: TaskId, userId: UserId): Promise<TState | null>;
  save(state: TState): Promise<void>;
}

export interface DomainEvent<TPayload = unknown> {
  readonly id: string;
  readonly taskId: TaskId;
  readonly type: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
