# Threat model

| Threat | Risk | Mitigation and verification | Status |
|---|---|---|---|
| Prompt injection in comments/posts | High | Source text is untrusted data; system prompts prohibit following embedded instructions, LLM output is schema-validated, and the harness alone authorizes tools. Prompt/tool tests verify unavailable and prohibited actions never execute. | Mitigated |
| Tool abuse or privilege escalation | High | Server-owned tool registry, JSON-schema validation, user/session grants, risk classification, explicit approvals, and prohibited-risk denial. Permission and cross-session tests pass. | Mitigated |
| SSRF and unsafe browser navigation | High | Playwright origin allowlist, protocol checks, bounded selectors/timeouts, and no model-controlled arbitrary origin. Unsafe-origin fixture tests pass. | Mitigated |
| Private-data leakage through logs/audits | High | Central recursive redaction removes secrets and content-bearing fields before structured logs or audit persistence. Seeded-secret controlled-failure tests pass. | Mitigated |
| Session theft | High | Browser state is owner-only and ignored by Git; API bearer tokens are opt-in, stored in `sessionStorage`, never given to the model, and all API data is user scoped. Authentication/CORS tests pass. | Mitigated |
| Retry amplification/duplicate writes | High | Retry allowlist, capped budgeted backoff, cancellation, invocation idempotency, optimistic recovery, and stable step IDs. Fake-clock and crash-recovery tests pass. | Mitigated |
| Local machine compromise | High | Local files, browser state, database, and in-memory tokens are accessible to a fully compromised OS account. Host encryption, account security, and encrypted backup media are operator responsibilities. | Accepted operational risk |

No unresolved critical or high application finding is accepted without an explicit record in this table.
