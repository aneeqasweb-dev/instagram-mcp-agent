# Troubleshooting

| Symptom | Check | Safe action |
|---|---|---|
| API `/ready` returns 503 | MongoDB URI and process | Start MongoDB or correct `MONGODB_URI`; do not weaken readiness checks. |
| Ollama model is unavailable | `ollama list`, configured model names | Pull the configured small model or change `OLLAMA_MODEL`; no harness changes are needed. |
| Instagram redirects to login | Storage-state path, permissions, session age | Re-run the visible session bootstrap. Never paste credentials into config, prompts, or logs. |
| Browser does not open | Chrome/Chromium path and desktop session | Set `PLAYWRIGHT_EXECUTABLE_PATH`; use headed mode for authorization. |
| Task pauses | Approval endpoint and displayed risk | Review the exact action and approve or reject; never bypass the policy layer. |
| Task remains running after a crash | MongoDB connectivity | Restart the API. Recovery safely requeues running tasks and preserves approval pauses. |
| Secret scan fails | Reported file and line only | Remove/rotate the secret. The scanner intentionally never prints its value. |

Model providers implement the common `LlmProvider` contract. To swap models, update Ollama model environment variables and rerun the optional local-model smoke; tool, policy, runtime, and dashboard code should not change.
