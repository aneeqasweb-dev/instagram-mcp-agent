import type { AgentDecision, LlmDecisionRequest, LlmDecisionResponse, LlmMessage, LlmProvider } from "@instagram-agent/contracts";
import { agentDecisionSchema } from "./decision-schema.js";
import { LlmProviderError } from "./errors.js";
import { buildCorrectionMessage } from "./prompt.js";

interface OllamaChatResponse {
  readonly model?: string;
  readonly message?: { readonly content?: string };
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
  readonly total_duration?: number;
}

export interface OllamaProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly correctionRetries?: number;
  readonly fetch?: typeof fetch;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

function mapTransportError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new LlmProviderError("timeout", "Ollama request timed out or was cancelled", true, { cause: error });
  }
  return new LlmProviderError("offline", "Could not connect to the local Ollama service", true, { cause: error });
}

export class OllamaProvider implements LlmProvider {
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #correctionRetries: number;
  readonly #fetch: typeof fetch;

  constructor(options: OllamaProviderOptions) {
    if (!options.model.trim()) throw new Error("Ollama model must be configured");
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#correctionRetries = options.correctionRetries ?? 1;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async generateDecision(request: LlmDecisionRequest, signal?: AbortSignal): Promise<LlmDecisionResponse> {
    let messages = [...request.messages];
    let invalidOutput = "";
    for (let attempt = 0; attempt <= this.#correctionRetries; attempt += 1) {
      if (attempt > 0) messages = [...messages, { role: "assistant", content: invalidOutput }, { role: "user", content: buildCorrectionMessage(invalidOutput) }];
      const raw = await this.#chat(messages, request, signal);
      invalidOutput = raw.message?.content ?? "";
      const decision = this.#parseDecision(invalidOutput);
      if (decision) {
        return {
          decision,
          model: raw.model ?? this.#model,
          usage: {
            ...(raw.prompt_eval_count === undefined ? {} : { inputTokens: raw.prompt_eval_count }),
            ...(raw.eval_count === undefined ? {} : { outputTokens: raw.eval_count }),
            ...(raw.total_duration === undefined ? {} : { totalDurationMs: raw.total_duration / 1_000_000 }),
          },
        };
      }
    }
    throw new LlmProviderError("invalid_response", "Ollama did not return a valid agent decision", false);
  }

  #parseDecision(content: string): AgentDecision | null {
    try {
      const result = agentDecisionSchema.safeParse(JSON.parse(content) as unknown);
      return result.success ? result.data : null;
    } catch { return null; }
  }

  async #chat(messages: readonly LlmMessage[], request: LlmDecisionRequest, signal?: AbortSignal): Promise<OllamaChatResponse> {
    try {
      const call = (format: unknown, requestMessages = messages) => this.#fetch(`${this.#baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.#model, messages: requestMessages, stream: false, format, options: { temperature: request.temperature ?? 0 } }),
        signal: combinedSignal(signal, this.#timeoutMs),
      });
      let response = await call(request.decisionSchema);
      if (response.status === 400) {
        const detail = (await response.text()).slice(0, 500);
        if (/cannot unmarshal object.*format.*string/i.test(detail)) {
          const schemaInstruction: LlmMessage = { role: "system", content: `Legacy JSON mode. Return exactly one JSON object and no prose. Property names and kind values are case-sensitive. Use one of these shapes:
{"kind":"cannot_continue","reason":"brief reason","rationaleSummary":"brief reason","userMessage":"brief explanation"}
{"kind":"complete","summary":"brief result","evidence":["successful-invocation-id"],"rationaleSummary":"brief reason","userMessage":"brief result"}
{"kind":"invoke_tool","tool":{"invocationId":"unique-id","name":"available-tool-name","arguments":{}},"rationaleSummary":"brief reason","userMessage":"brief update"}
Decision rules: return complete when successful observations already satisfy the goal, using their real invocation IDs as evidence. Return invoke_tool only when an available tool is needed next. Return cannot_continue only when the goal is not already satisfied and no safe available action can make progress.
Every string must be non-empty. Never copy placeholder values. Use only an explicitly available tool name and never invent evidence.` };
          response = await call("json", [schemaInstruction, ...messages]);
        }
        else throw new LlmProviderError("transport", `Ollama returned HTTP 400: ${detail}`, false);
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        if (response.status === 404) throw new LlmProviderError("missing_model", `Ollama model '${this.#model}' is unavailable: ${detail}`, false);
        throw new LlmProviderError("transport", `Ollama returned HTTP ${response.status}: ${detail}`, response.status >= 500);
      }
      return (await response.json()) as OllamaChatResponse;
    } catch (error) { throw mapTransportError(error); }
  }
}
