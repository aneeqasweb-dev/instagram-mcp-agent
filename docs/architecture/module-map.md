# Module and verification map

| Layer | Source | Responsibility | Primary verification |
|---|---|---|---|
| Contracts | `packages/contracts` | Provider-neutral goals, decisions, tools, observations, repositories, and events | Agent-core schema and MCP contract tests |
| Agent harness | `packages/agent-core` | Dynamic decision loop, state transitions, policies, retries, recovery, security, metrics, and audit | `src/*.test.ts` plus enforced coverage |
| Local model | `packages/ollama-adapter` | Ollama configuration, structured decisions, correction, fallback, and comment analysis | Provider, prompt, configuration, and optional integration tests |
| MCP client/server | `packages/mcp-client`, `packages/mcp-server` | Tool discovery/invocation and least-privilege process boundary | Production stdio integration tests |
| Browser | `packages/playwright-adapter` | Allowlisted navigation, protected session loading, bounded Instagram normalization | Local fixture tests and opt-in authorized smoke |
| Persistence | `packages/mongodb-adapter` | Migrations, scoped repositories, memory, audit, recovery, export/deletion | Isolated MongoDB adapter tests |
| Analysis | `packages/comment-analysis` | Multilingual sentiment, complaint grouping, severity, confidence, corrections | Batch, malformed-output, evidence, and correction tests |
| API | `apps/api` | Authentication, limits, tasks, approvals, SSE, analytics, diagnostics | Fastify injection, Mongo integration, and collector tests |
| Dashboard | `apps/dashboard` | Goal supervision, approvals, analytics, evidence, corrections, connections | Component/client tests and real Chromium fixture smoke |

API routes are documented in `docs/api/backend.md`; persistent schemas in `docs/architecture/mongodb-data-model.md`; permission and threat controls in `docs/security`; runtime operations in `docs/reliability` and `docs/operations`.
