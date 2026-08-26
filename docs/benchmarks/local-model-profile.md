# Local model hardware and benchmark profile

Captured and verified: 2026-08-24.

## Runtime and hardware

- CPU: Intel Core i5-8265U, 4 cores / 8 threads, 1.60 GHz base
- System memory: 15 GiB total; approximately 6.7 GiB available at initial capture
- Swap: 4 GiB
- Discrete NVIDIA GPU: not detected; inference is CPU-only
- Ollama: official Linux standalone v0.1.48, installed project-locally at `.local/ollama/bin/ollama`
- Runtime checksum: the official binary matched SHA-256 `7641b21e9d0822ba44e494f5ed3d3796d9e9fcdf4dbb66064f8c34c865bbec0b`
- Service boundary: verified on `127.0.0.1:11434`; it is not exposed on a public interface

This Ollama version accepts `format: "json"` but not a JSON Schema object. The adapter detects that specific legacy response, retries with explicit decision shapes, and still validates every result locally with the provider-neutral Zod schema.

## Evaluation method

Prompt set v1 contains the same five deterministic cases for every model: English no-tool refusal, Roman Urdu no-tool refusal, calculator invocation, evidence-backed completion, and prohibited-operation refusal. A pass requires valid decision JSON; semantic accuracy additionally requires the expected decision kind, calculator name, and completion evidence ID where applicable. Temperature is zero and one bounded correction retry is permitted.

```bash
OLLAMA_HOST=http://127.0.0.1:11434 \
OLLAMA_MODELS="$PWD/.local/ollama/models" \
.local/ollama/bin/ollama serve

OLLAMA_BASE_URL=http://127.0.0.1:11434 \
npm run benchmark -w @instagram-agent/ollama-adapter -- \
qwen2:1.5b qwen2:1.5b-instruct-q3_K_M
```

## Final measured selection

| Role | Model/tag | Quantization | Size | Schema validity | Semantic accuracy | Median / p95 | Observed free-memory decrease | Roman Urdu case |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Default | `qwen2:1.5b` | Q4_0 | 934 MB | 5/5 (100%) | 5/5 (100%) | 4.70 s / 10.33 s | 229 MiB | Passed |
| Smaller fallback | `qwen2:1.5b-instruct-q3_K_M` | Q3_K_M | 824 MB | 5/5 (100%) | 3/5 (60%) | 10.16 s / 12.10 s | 16 MiB | Passed |

The default is the only tested candidate that repeatedly achieved both 100% schema validity and 100% semantic accuracy. The smaller fallback is operational and schema-safe but deliberately reduced-capability: it refused the invocation and completion cases. Use it only when memory pressure prevents loading the default, with harness validation and human review retained; it must not silently replace the default for autonomous task execution.

Memory figures are the benchmark process's observed decrease in system free memory during each five-case run, not isolated model RSS. They are workload-sensitive and are recorded for comparison on this laptop.

## Rejected or limited candidates

- `qwen2:1.5b-instruct-q4_K_M` (986 MB): 100% schema validity, 60% semantic accuracy; refused invocation and evidence-backed completion.
- `qwen2:1.5b-instruct-q8_0` (1.65 GB): 100% schema validity, repeatedly 80% semantic accuracy; refused evidence-backed completion.
- `qwen2.5:1.5b` Q4_K_M (986 MB): 100% schema validity, 60% semantic accuracy.
- Q2 variants and `qwen2:0.5b`: materially worse semantic behavior; the final 0.5B run also fell to 80% schema validity.

Candidate model blobs were SHA-256 checked against their Ollama registry manifests before use. These failures are selection evidence, not adapter acceptance: invalid outputs remain contained by local schema validation.

## Live acceptance

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
OLLAMA_INTEGRATION_MODEL=qwen2:1.5b \
npm test -w @instagram-agent/ollama-adapter
```
