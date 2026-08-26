# Comment-analysis evaluation

## Phase 8 acceptance result

The live evaluation passed on 2026-08-24 against the locally installed `qwen2.5:1.5b` model:

- Schema-valid analyses: 5/5
- Provider failures: 0
- Expected sentiment and language classifications: 5/5 (100%)
- Coverage: English negative, Roman Urdu negative, mixed-language complaint, English positive, and ambiguous English

The deterministic fixture suite also processed 2,000 comments with stable IDs, no loss or duplication, bounded batches, and no failures. Separate tests prove malformed-item retry, whole-batch outage isolation, evidence validation, confidence boundaries, and correction audit history.

## Reproduce

Start Ollama with the model installed, then run:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
OLLAMA_MODEL=qwen2.5:1.5b \
npm run evaluate:comments -w @instagram-agent/ollama-adapter
```

The command exits unsuccessfully unless all five outputs pass the strict local schema and at least three match both expected sentiment and language. Model output remains probabilistic; production results below configured confidence thresholds or with high severity are sent to human review.
