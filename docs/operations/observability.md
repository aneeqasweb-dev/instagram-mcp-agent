# Observability and audit reconstruction

Structured runtime records use task, step, and invocation identifiers so one execution can be followed across the API, agent harness, MCP boundary, and browser tool. Records also carry duration, status, and retry fields. Private goal, prompt, comment, caption, message, argument, and result content is centrally redacted before logging or audit persistence.

`GET /api/diagnostics` requires the configured bearer session and returns aggregate counters, gauges, and duration summaries. The service records API latency and errors, retry outcomes, queue depth, tool and model latency, failures, and model usage. Metrics contain labels and numbers only—not user content.

Audit reconstruction is ordered by `occurredAt` and correlates:

1. the user task-creation record;
2. model decisions and redacted tool invocations;
3. approval decisions and their task revision;
4. terminal completion, failure, or cancellation.

MongoDB stores durable audit records in `agent_audit`; local-memory mode provides the same interface for tests. User export includes scoped audit records, while deletion and retention purges apply to them with the other user-owned collections.
