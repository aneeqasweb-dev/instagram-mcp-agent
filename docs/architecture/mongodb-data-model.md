# MongoDB data model

Schema version `3` uses separate collections for unbounded histories and source records.

| Collection | Ownership / purpose | Retention and key indexes |
|---|---|---|
| `schema_versions` | Applied local migrations | Permanent; unique `version` |
| `users` | Local application users | Until user deletion; unique `userId` |
| `agent_sessions` | Login/application sessions | TTL on `expiresAt`; unique `sessionId` |
| `agent_tasks` | Bounded current task snapshot | User retention policy; unique `(userId, taskId)` |
| `agent_steps` | Append/upsert task transition evidence | User retention policy; unique `(userId, taskId, stepId)`, ordered iteration |
| `agent_events` | Durable SSE replay log | User retention policy; unique task sequence and event ID |
| `agent_audit` | Redacted decision/action causality | User retention policy; task/time and unique audit ID indexes |
| `instagram_posts` | Authorized source posts | Source retention policy; unique `(userId, postId)` |
| `instagram_comments` | Authorized source comments | Source retention policy; unique `(userId, commentId)`, lookup by post/time |
| `comment_analysis` | Versioned model/reviewer results | Source retention policy; unique `(userId, commentId, taxonomyVersion)` |
| `agent_memory` | Provenance-linked durable summaries | Optional expiry; user/text/source indexes |
| `approvals` | Sensitive-action audit state | TTL after expiry; task/status index |
| `tool_invocations` | Durable write idempotency results | TTL; unique `(userId, invocationId)` |

All application queries include `userId`. Passwords, cookies, browser storage state, and API secrets are prohibited. Task steps and observations are not embedded as unbounded arrays in `agent_tasks`; the repository reconstructs task state from `agent_steps`.

Migration policy: migrations are monotonic, idempotent functions recorded in `schema_versions`. Index changes are applied with explicit names. The application refuses unknown future schema versions rather than silently downgrading.
