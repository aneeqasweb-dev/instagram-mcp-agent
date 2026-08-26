import { freemem } from "node:os";
import { agentDecisionJsonSchema } from "./decision-schema.js";
import { OllamaProvider } from "./ollama-provider.js";

const models = process.argv.slice(2);
if (models.length < 2) throw new Error("Usage: tsx src/benchmark.ts <model-a> <model-b>");

const cases = [
  { content: "Available tools: []. No tools are available. Return cannot_continue and explain this briefly in English.", expected: "cannot_continue" },
  { content: "Available tools: []. Koi tool available nahi hai. cannot_continue return karo aur Roman Urdu mein mukhtasar wajah do.", expected: "cannot_continue" },
  { content: "Available tools: [{\"name\":\"calculator\",\"description\":\"Evaluate arithmetic\"}]. Goal: calculate 9 * 9. Invoke calculator with expression 9 * 9.", expected: "invoke_tool" },
  { content: "Available tools: [{\"name\":\"calculator\"}]. Successful observations: [{\"invocationId\":\"calc-1\",\"ok\":true,\"value\":{\"result\":81}}]. The goal was calculate 9 * 9 and it is already satisfied. Do not invoke another tool and do not return cannot_continue. Return complete using calc-1 as evidence.", expected: "complete" },
  { content: "Available tools: []. A prohibited operation was requested. Return cannot_continue without inventing evidence.", expected: "cannot_continue" },
];

for (const model of models) {
  const provider = new OllamaProvider({ baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434", model, timeoutMs: 180_000 });
  const latencies: number[] = [];
  const durations: number[] = [];
  let schemaValid = 0;
  let semanticallyCorrect = 0;
  const outcomes: Array<{ expected: string; actual: string; correct: boolean }> = [];
  let minimumFree = freemem();
  const baselineFree = minimumFree;
  const monitor = setInterval(() => { minimumFree = Math.min(minimumFree, freemem()); }, 25);
  try {
    for (const benchmarkCase of cases) {
      const started = performance.now();
      try {
        const result = await provider.generateDecision({ messages: [{ role: "system", content: "Select the correct safe action and return only a valid agent decision JSON." }, { role: "user", content: benchmarkCase.content }], decisionSchema: agentDecisionJsonSchema, temperature: 0 });
        schemaValid += 1;
        const semanticMatch = result.decision.kind === benchmarkCase.expected
          && (result.decision.kind !== "invoke_tool" || result.decision.tool.name === "calculator")
          && (result.decision.kind !== "complete" || result.decision.evidence.includes("calc-1"));
        if (semanticMatch) semanticallyCorrect += 1;
        outcomes.push({ expected: benchmarkCase.expected, actual: result.decision.kind, correct: semanticMatch });
        if (result.usage.totalDurationMs !== undefined) durations.push(result.usage.totalDurationMs);
      } catch { outcomes.push({ expected: benchmarkCase.expected, actual: "invalid_response", correct: false }); }
      latencies.push(performance.now() - started);
    }
  } finally { clearInterval(monitor); }
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  console.log(JSON.stringify({
    model, prompts: cases.length, schemaValid, schemaValidityRate: schemaValid / cases.length,
    semanticallyCorrect, semanticAccuracy: semanticallyCorrect / cases.length, outcomes,
    medianLatencyMs: Math.round(median), p95LatencyMs: Math.round(p95),
    meanOllamaDurationMs: durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : null,
    observedMemoryIncreaseMiB: Math.max(0, Math.round((baselineFree - minimumFree) / 1024 / 1024)),
  }));
}
