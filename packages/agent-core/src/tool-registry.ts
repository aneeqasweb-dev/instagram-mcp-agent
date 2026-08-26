import type { ToolDefinition, ToolGateway, ToolInvocation, ToolObservation, UserId } from "@instagram-agent/contracts";
import { Ajv, type ValidateFunction } from "ajv/dist/ajv.js";

export interface ToolExecutionContext {
  readonly userId: UserId;
  readonly invocationId: string;
  readonly signal: AbortSignal;
}

export interface RegisteredTool {
  readonly definition: ToolDefinition;
  execute(arguments_: Readonly<Record<string, unknown>>, context: ToolExecutionContext): Promise<unknown> | unknown;
}

interface CompiledTool extends RegisteredTool {
  readonly validateInput: ValidateFunction;
  readonly validateOutput: ValidateFunction;
}

export class ToolValidationError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message);
    this.name = "ToolValidationError";
  }
}

function observationError(invocationId: string, error: unknown): ToolObservation {
  if (error instanceof ToolValidationError) {
    return { invocationId, ok: false, error: { code: error.code, message: error.message, retryable: error.retryable } };
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { invocationId, ok: false, error: { code: "tool_timeout", message: "Tool execution timed out or was cancelled", retryable: true } };
  }
  return { invocationId, ok: false, error: { code: "tool_execution_failed", message: error instanceof Error ? error.message : "Unknown tool error", retryable: false } };
}

export class ToolRegistry implements ToolGateway {
  readonly #tools = new Map<string, CompiledTool>();
  readonly #ajv = new Ajv({ allErrors: true, strict: false });

  register(tool: RegisteredTool): void {
    const { definition } = tool;
    if (this.#tools.has(definition.name)) throw new Error(`Tool '${definition.name}' is already registered`);
    if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) throw new Error("Tool names must use lower snake_case");
    if (!/^\d+\.\d+\.\d+$/.test(definition.version)) throw new Error(`Tool '${definition.name}' must use a semantic version`);
    if (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0) throw new Error(`Tool '${definition.name}' requires a positive timeout`);
    this.#tools.set(definition.name, {
      ...tool,
      validateInput: this.#ajv.compile(definition.inputSchema),
      validateOutput: this.#ajv.compile(definition.outputSchema),
    });
  }

  async listTools(_userId: UserId): Promise<readonly ToolDefinition[]> {
    return [...this.#tools.values()].map(({ definition }) => structuredClone(definition));
  }

  async invoke(userId: UserId, invocation: ToolInvocation, signal?: AbortSignal): Promise<ToolObservation> {
    const tool = this.#tools.get(invocation.name);
    if (!tool) return observationError(invocation.invocationId, new ToolValidationError("tool_not_found", `Tool '${invocation.name}' is not registered`));
    if (!tool.validateInput(invocation.arguments)) {
      return observationError(invocation.invocationId, new ToolValidationError("invalid_tool_input", this.#ajv.errorsText(tool.validateInput.errors)));
    }
    const timeoutSignal = AbortSignal.timeout(tool.definition.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const value = await Promise.race([
        Promise.resolve(tool.execute(invocation.arguments, { userId, invocationId: invocation.invocationId, signal: combined })),
        new Promise<never>((_resolve, reject) => combined.addEventListener("abort", () => reject(combined.reason), { once: true })),
      ]);
      if (!tool.validateOutput(value)) throw new ToolValidationError("invalid_tool_output", this.#ajv.errorsText(tool.validateOutput.errors));
      return { invocationId: invocation.invocationId, ok: true, value };
    } catch (error) { return observationError(invocation.invocationId, error); }
  }
}
