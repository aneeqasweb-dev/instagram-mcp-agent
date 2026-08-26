import assert from "node:assert/strict";
import test from "node:test";
import type { LlmProvider } from "@instagram-agent/contracts";
import { createConfiguredOllamaProvider } from "./config.js";
import { OllamaProvider } from "./ollama-provider.js";

test("creates interchangeable primary and fallback providers from configuration", () => {
  const environment = {
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    OLLAMA_MODEL: "qwen2:1.5b",
    OLLAMA_FALLBACK_MODEL: "qwen2:1.5b-instruct-q3_K_M",
    OLLAMA_TIMEOUT_MS: "90000",
  };
  const primary: LlmProvider = createConfiguredOllamaProvider(environment);
  const fallback: LlmProvider = createConfiguredOllamaProvider(environment, true);
  assert.ok(primary instanceof OllamaProvider);
  assert.ok(fallback instanceof OllamaProvider);
});

test("rejects missing models and invalid timeouts", () => {
  assert.throws(() => createConfiguredOllamaProvider({}), /OLLAMA_MODEL/);
  assert.throws(
    () => createConfiguredOllamaProvider({ OLLAMA_MODEL: "qwen2:1.5b" }, true),
    /OLLAMA_FALLBACK_MODEL/,
  );
  assert.throws(
    () => createConfiguredOllamaProvider({ OLLAMA_MODEL: "qwen2:1.5b", OLLAMA_TIMEOUT_MS: "zero" }),
    /positive number/,
  );
});
