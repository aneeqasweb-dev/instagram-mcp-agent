import type { TaskId, ToolDefinition, ToolInvocation, UserId } from "@instagram-agent/contracts";

export interface PermissionGrant {
  readonly userId: UserId;
  readonly sessionId?: string;
  readonly allowedTools: readonly string[];
  readonly allowedRisks: readonly ToolDefinition["risk"][];
}

export interface ApprovalRequest {
  readonly requestId: string;
  readonly token: string;
  readonly taskId: TaskId;
  readonly userId: UserId;
  readonly invocationId: string;
  readonly toolName: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: "pending" | "approved" | "rejected" | "expired";
}

export type AuthorizationDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "approval_required"; readonly request: ApprovalRequest };

export class ApprovalManager {
  readonly #requests = new Map<string, ApprovalRequest>();
  constructor(readonly ttlMs = 300_000, readonly now: () => number = Date.now, readonly id: () => string = () => crypto.randomUUID()) {}

  request(taskId: TaskId, userId: UserId, invocation: ToolInvocation): ApprovalRequest {
    const createdAt = this.now();
    const request: ApprovalRequest = {
      requestId: this.id(), token: this.id(), taskId, userId, invocationId: invocation.invocationId, toolName: invocation.name,
      createdAt, expiresAt: createdAt + this.ttlMs, status: "pending",
    };
    this.#requests.set(request.requestId, request);
    return request;
  }

  get(requestId: string): ApprovalRequest | null {
    const request = this.#requests.get(requestId);
    if (!request) return null;
    if (request.status === "pending" && request.expiresAt <= this.now()) {
      const expired = { ...request, status: "expired" as const };
      this.#requests.set(requestId, expired);
      return expired;
    }
    return request;
  }

  decide(input: { readonly requestId: string; readonly token: string; readonly taskId: TaskId; readonly userId: UserId; readonly decision: "approve" | "reject" }): ApprovalRequest {
    const request = this.get(input.requestId);
    if (!request) throw new Error("Approval request not found");
    if (request.taskId !== input.taskId || request.userId !== input.userId || request.token !== input.token) throw new Error("Approval token is not valid for this task and user");
    if (request.status !== "pending") throw new Error(`Approval request is ${request.status}`);
    const decided = { ...request, status: input.decision === "approve" ? "approved" as const : "rejected" as const };
    this.#requests.set(request.requestId, decided);
    return decided;
  }
}

export class PermissionPolicy {
  readonly #grants = new Map<string, PermissionGrant>();
  constructor(readonly approvals: ApprovalManager) {}

  #key(userId: UserId, sessionId?: string): string { return `${userId}\u0000${sessionId ?? "*"}`; }

  setGrant(grant: PermissionGrant): void { this.#grants.set(this.#key(grant.userId, grant.sessionId), structuredClone(grant)); }

  filterTools(userId: UserId, tools: readonly ToolDefinition[], sessionId?: string): readonly ToolDefinition[] {
    const grant = this.#grants.get(this.#key(userId, sessionId)) ?? this.#grants.get(this.#key(userId));
    if (!grant) return [];
    return tools.filter((tool) => tool.risk !== "prohibited" && grant.allowedTools.includes(tool.name) && grant.allowedRisks.includes(tool.risk));
  }

  authorize(taskId: TaskId, userId: UserId, tool: ToolDefinition, invocation: ToolInvocation, sessionId?: string): AuthorizationDecision {
    if (tool.risk === "prohibited") return { kind: "deny", reason: `Tool '${tool.name}' is prohibited` };
    const grant = this.#grants.get(this.#key(userId, sessionId)) ?? this.#grants.get(this.#key(userId));
    if (!grant || !grant.allowedTools.includes(tool.name) || !grant.allowedRisks.includes(tool.risk)) {
      return { kind: "deny", reason: `User is not permitted to use tool '${tool.name}'` };
    }
    if (tool.risk === "sensitive") return { kind: "approval_required", request: this.approvals.request(taskId, userId, invocation) };
    return { kind: "allow" };
  }
}
