import assert from "node:assert/strict";
import test from "node:test";
import { agentDecisionJsonSchema } from "./decision-schema.js";
import { OllamaProvider } from "./ollama-provider.js";

const model = process.env.OLLAMA_INTEGRATION_MODEL;

test("returns a schema-valid decision from a real local Ollama model", { skip: !model }, async () => {
  const provider = new OllamaProvider({
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    model: model!,
    timeoutMs: 180_000,
  });
  const response = await provider.generateDecision({
    messages: [
      { role: "system", content: "Choose the next safe agent action and return only the requested JSON." },
      { role: "user", content: "There are no tools available. Return cannot_continue and explain this briefly." },
    ],
    decisionSchema: agentDecisionJsonSchema,
    temperature: 0,
  });
  assert.equal(response.model, model);
  assert.equal(response.decision.kind, "cannot_continue");
});
