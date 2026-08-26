export type LlmErrorCode =
  "offline" | "missing_model" | "timeout" | "transport" | "invalid_response";

export class LlmProviderError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LlmProviderError";
  }
}
