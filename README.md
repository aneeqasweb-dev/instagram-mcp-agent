# Instagram MCP Agent

A local-first, dynamic AI agent for authorized Instagram data collection and comment analysis using Ollama, MCP, Playwright, MongoDB, Node.js, and React.

The project is being implemented incrementally from [`AIagent.md`](./AIagent.md). Progress and acceptance checkpoints live in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md); technical boundaries are documented in [`docs/architecture/overview.md`](./docs/architecture/overview.md).

## Current status

Phases 1–11 are complete and verified. Phase 12 release automation, coverage enforcement, clean installation, documentation, packaging, and the bounded authorized Instagram MCP smoke are passing. The final live dynamic analysis/save/display acceptance scenario remains pending.

Start with [local setup](docs/setup.md), review the [module map](docs/architecture/module-map.md), and run `npm run verify:release` for the mandatory local release gate. Live Instagram validation remains explicitly opt-in and requires a protected user-authorized session.

The dashboard also includes a bounded followers/following explorer. It pages through both authorized connection lists and groups each following account's visible posts and comments by proper display name and username. Large lists are processed with continuation cursors rather than one unbounded browser request.

Start it with `npm run dev`, then open `http://localhost:5173` and select **Collect first batch**. If port 3000 is occupied, use:

```bash
API_PORT=3100 API_PROXY_TARGET=http://127.0.0.1:3100 npm run dev
```

Continue selecting **Load next batch** until no continuation button remains to traverse all currently accessible followers/following accounts within the configured per-request limits.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Ollama for live local-model use (a verified project-local runtime and model store are present in this development workspace but ignored by Git)

## Install and verify

```bash
npm install
npm run check
```

## Development scaffold

Copy `.env.example` to `.env` and adjust local-only values. Never commit the resulting `.env` or Playwright authentication state.

Set `API_SESSION_TOKEN` to a long random local bearer token. Protected routes deny access when it is absent. Enter the same value in the dashboard's local session screen (stored in `sessionStorage`), or set `VITE_API_TOKEN` for a local-only build.

```bash
npm run dev
```

The scaffold starts the API on `http://127.0.0.1:3000` and dashboard on `http://localhost:5173`. The MCP server can register MongoDB tools when `MCP_DATABASE_ENABLED=true`; Instagram capabilities still require an authorized local session and their later implementation phase.

## Ollama configuration

The provider adapter, legacy JSON-mode compatibility, live integration test, and repeatable model benchmark are implemented. The verified default is `qwen2:1.5b` (Q4_0); `qwen2:1.5b-instruct-q3_K_M` is a smaller, explicitly reduced-capability fallback. Configure them with `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_FALLBACK_MODEL`, and `OLLAMA_TIMEOUT_MS`. See [`docs/benchmarks/local-model-profile.md`](./docs/benchmarks/local-model-profile.md) for measured results, limitations, and reproduction commands.

The Phase 8 comment analyzer adds versioned schemas, configurable confidence/severity review rules, size-aware batching, per-comment retry isolation, evidence-linked complaint groups, grounded summaries, and audited human corrections. Its live quality-gate evidence and reproduction command are in [`docs/benchmarks/comment-analysis-evaluation.md`](./docs/benchmarks/comment-analysis-evaluation.md).

## Authorized Instagram browser session

Phase 7 browser primitives and fixture-tested read tools are available. The authorized headed browser smoke test has passed on this workspace. Bootstrap or refresh a session interactively—credentials are entered only in the visible Instagram browser, never in the terminal, agent prompt, source, or logs:

```bash
npm run bootstrap:instagram -w @instagram-agent/playwright-adapter
npm run smoke:instagram -w @instagram-agent/playwright-adapter
```

The resulting state is stored at `INSTAGRAM_STORAGE_STATE_PATH`, forced to owner-only permissions, and ignored by Git. After a real authorized account smoke test, set `MCP_INSTAGRAM_ENABLED=true` to expose the bounded read tools through MCP. Expired sessions return an authentication-required error and are never bypassed.

## Backend API and events

Phase 9 provides health/readiness, task creation/detail/status/steps, cancellation, approval decisions, posts/comments queries, analytics, and authenticated SSE task events. All `/api/*` routes require `Authorization: Bearer <API_SESSION_TOKEN>`. SSE reconnects use `Last-Event-ID`; events are persisted before publication and replay in task sequence order. See [`docs/api/backend.md`](./docs/api/backend.md).

## React dashboard

The routed dashboard provides Tasks, Analytics, Human review, and Connections views. It supports explicit approval pauses, live activity reconciliation, complaint filters and evidence records, audited reviewer corrections, accessible keyboard controls, responsive layouts, and normalized API failures. See [`docs/dashboard.md`](./docs/dashboard.md).
