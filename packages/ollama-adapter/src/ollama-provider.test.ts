import assert from "node:assert/strict";
import test from "node:test";
import type { LlmDecisionRequest } from "@instagram-agent/contracts";
import { agentDecisionJsonSchema } from "./decision-schema.js";
import { LlmProviderError } from "./errors.js";
import { OllamaProvider } from "./ollama-provider.js";

const request: LlmDecisionRequest = {
  messages: [{ role: "user", content: "Choose the next action" }],
  decisionSchema: agentDecisionJsonSchema,
  temperature: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("returns a provider-neutral validated decision", async () => {
  let options: Record<string, unknown> | undefined;
  const provider = new OllamaProvider({
    baseUrl: "http://ollama.test", model: "test-model",
    fetch: async (_url, init) => {
      options = (JSON.parse(String(init?.body)) as { options: Record<string, unknown> }).options;
      return jsonResponse({
        model: "test-model",
        message: { content: JSON.stringify({ kind: "complete", summary: "Done", evidence: ["step-1"], rationaleSummary: "Evidence satisfies the goal", userMessage: "Done" }) },
        prompt_eval_count: 12, eval_count: 8, total_duration: 25_000_000,
      });
    },
  });
  const result = await provider.generateDecision(request);
  assert.deepEqual(result.decision, { kind: "complete", summary: "Done", evidence: ["step-1"], rationaleSummary: "Evidence satisfies the goal", userMessage: "Done" });
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8, totalDurationMs: 25 });
  assert.deepEqual(options, { temperature: 0, num_predict: 192 });
});

test("falls back to legacy JSON mode while retaining local schema validation", async () => {
  const formats: unknown[] = [];
  const bodies: Array<{ format: unknown; messages: Array<{ content: string }> }> = [];
  const provider = new OllamaProvider({
    baseUrl: "http://ollama.test", model: "legacy-model",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { format: unknown; messages: Array<{ content: string }> };
      bodies.push(body);
      formats.push(body.format);
      return formats.length === 1
        ? jsonResponse({ error: "json: cannot unmarshal object into Go struct field ChatRequest.format of type string" }, 400)
        : jsonResponse({ model: "legacy-model", message: { content: JSON.stringify({ kind: "cannot_continue", reason: "No tool", rationaleSummary: "No permitted tool exists", userMessage: "I cannot continue safely." }) } });
    },
  });
  const result = await provider.generateDecision(request);
  assert.deepEqual(formats, [agentDecisionJsonSchema, "json"]);
  assert.match(bodies[1]!.messages[0]!.content, /Legacy JSON mode.*invoke_tool.*cannot_continue/s);
  assert.match(bodies[1]!.messages[0]!.content, /successful observations already satisfy the goal/);
  assert.equal(result.decision.kind, "cannot_continue");
});

test("corrects one malformed response", async () => {
  const bodies: unknown[] = [];
  let calls = 0;
  const provider = new OllamaProvider({
    baseUrl: "http://ollama.test", model: "test-model", correctionRetries: 1,
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as unknown);
      calls += 1;
      return calls === 1
        ? jsonResponse({ message: { content: "not-json" } })
        : jsonResponse({ message: { content: JSON.stringify({ kind: "cannot_continue", reason: "No permitted tool", rationaleSummary: "Required capability is unavailable", userMessage: "I cannot continue safely." }) } });
    },
  });
  const result = await provider.generateDecision(request);
  assert.equal(calls, 2);
  assert.deepEqual(result.decision, { kind: "cannot_continue", reason: "No permitted tool", rationaleSummary: "Required capability is unavailable", userMessage: "I cannot continue safely." });
  assert.match(JSON.stringify(bodies[1]), /previous response was invalid/i);
});

test("fails safely after the correction budget", async () => {
  const provider = new OllamaProvider({
    baseUrl: "http://ollama.test", model: "test-model", correctionRetries: 1,
    fetch: async () => jsonResponse({ message: { content: "{}" } }),
  });
  await assert.rejects(provider.generateDecision(request), (error: unknown) =>
    error instanceof LlmProviderError && error.code === "invalid_response" && !error.retryable);
});

test("normalizes missing-model and offline failures", async () => {
  const missing = new OllamaProvider({
    baseUrl: "http://ollama.test", model: "absent",
    fetch: async () => new Response("model not found", { status: 404 }),
  });
  await assert.rejects(missing.generateDecision(request), (error: unknown) =>
    error instanceof LlmProviderError && error.code === "missing_model");

  const offline = new OllamaProvider({
    baseUrl: "http://ollama.test", model: "test-model",
    fetch: async () => { throw new TypeError("connection refused"); },
  });
  await assert.rejects(offline.generateDecision(request), (error: unknown) =>
    error instanceof LlmProviderError && error.code === "offline" && error.retryable);
});

test("normalizes request timeout", async () => {
  const provider = new OllamaProvider({
    baseUrl: "http://ollama.test", model: "slow-model", timeoutMs: 5,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });
  await assert.rejects(provider.generateDecision(request), (error: unknown) =>
    error instanceof LlmProviderError && error.code === "timeout" && error.retryable);
});
