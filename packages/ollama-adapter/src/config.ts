import { OllamaProvider } from "./ollama-provider.js";

export interface OllamaEnvironment {
  readonly OLLAMA_BASE_URL?: string;
  readonly OLLAMA_MODEL?: string;
  readonly OLLAMA_FALLBACK_MODEL?: string;
  readonly OLLAMA_TIMEOUT_MS?: string;
}

export function createConfiguredOllamaProvider(
  environment: OllamaEnvironment = process.env,
  useFallback = false,
): OllamaProvider {
  const primaryModel = environment.OLLAMA_MODEL?.trim();
  const fallbackModel = environment.OLLAMA_FALLBACK_MODEL?.trim();
  const model = useFallback ? fallbackModel : primaryModel;
  if (!model) {
    throw new Error(useFallback
      ? "OLLAMA_FALLBACK_MODEL must be configured"
      : "OLLAMA_MODEL must be configured");
  }

  const timeoutText = environment.OLLAMA_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutText === undefined || timeoutText === "" ? undefined : Number(timeoutText);
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("OLLAMA_TIMEOUT_MS must be a positive number");
  }

  return new OllamaProvider({
    baseUrl: environment.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    model,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}
