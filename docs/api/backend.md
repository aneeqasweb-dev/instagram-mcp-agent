# Backend API

All `/api/*` endpoints require a configured bearer session. Errors use `{ "error": { "code", "message", "requestId" } }`. Collection responses use `{ "data", "page": { "cursor", "nextCursor", "total" } }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Process liveness |
| GET | `/ready` | MongoDB/dependency readiness |
| POST | `/api/agent/tasks` | Persist and enqueue a goal (1–4,000 characters) |
| GET | `/api/agent/tasks/:taskId` | User-scoped task snapshot |
| GET | `/api/agent/tasks/:taskId/status` | Compact current status |
| GET | `/api/agent/tasks/:taskId/steps` | Ordered, cursor-paginated steps |
| GET | `/api/agent/tasks/:taskId/approval` | Current pending approval and risk detail |
| POST | `/api/agent/tasks/:taskId/cancel` | Optimistic, idempotency-safe cancellation |
| POST | `/api/agent/tasks/:taskId/approvals/:requestId` | Approve or reject with the bound token |
| GET | `/api/posts` | Date-filtered, cursor-paginated posts |
| GET | `/api/comments` | Post/sentiment-filtered comments |
| GET | `/api/analytics/summary` | Current-user post, comment, and sentiment counts |
| GET | `/api/analytics/complaints` | Filtered sentiment and evidence-linked complaint groups |
| GET | `/api/reviews` | Low-confidence human-review queue |
| PATCH | `/api/reviews/:commentId` | Validate and audit a reviewer correction |
| GET | `/api/diagnostics` | Redacted counters, gauges, and latency summaries |
| GET | `/api/agent/tasks/:taskId/events` | Authenticated SSE replay/live stream |

Analytics counts cover only currently stored records owned by the authenticated user. Comments without sentiment are grouped under `unknown`.

SSE frames have durable IDs and task-local ordering. On reconnect, send the last processed ID in `Last-Event-ID`; the server returns only later persisted events and continues sending heartbeats every 15 seconds.

Diagnostics never include goals, prompts, approval tokens, tool arguments, or result content. Task creation, cancellation, approval decisions, model decisions, tool calls, and terminal outcomes are recorded in the scoped audit repository with centrally redacted metadata.
