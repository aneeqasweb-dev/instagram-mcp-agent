# Requirements traceability

Source of truth: [`../../AIagent.md`](../../AIagent.md). The MVP is a local-first, read-oriented Instagram analysis agent. The task references point to [`../../IMPLEMENTATION_PLAN.md`](../../IMPLEMENTATION_PLAN.md).

| Requirement                                                                 | Planned tasks | MVP acceptance evidence                                                        |
| --------------------------------------------------------------------------- | ------------: | ------------------------------------------------------------------------------ |
| Natural-language goals and a dynamic reason/action/observation loop         |         06–09 | An observation changes the model's next selected action in an integration test |
| Local, replaceable Ollama model                                             |         04–06 | Fake and Ollama providers pass the same contract suite                         |
| Harness-owned state, validation, retries, stop rules, and permissions       | 07–09, 12, 31 | State/policy/failure-injection tests                                           |
| Typed custom MCP client/server and tools                                    |         10–15 | Harness-to-MCP integration suite                                               |
| Authorized Instagram reads through Playwright                               |         19–21 | Fixture tests plus an authorized limited smoke run                             |
| Comment sentiment, complaints, severity, confidence, and multilingual input |         22–24 | Versioned evaluation set and review workflow                                   |
| MongoDB persistence and memory                                              |         16–18 | Restart/recovery and user-isolation tests                                      |
| Node.js API and live task events                                            |         25–27 | Authenticated lifecycle and reconnect tests                                    |
| React goal, activity, results, and review dashboard                         |         28–30 | Browser-level primary journey test                                             |
| Security, approvals, observability, and recovery                            |     12, 31–33 | Approval, audit, secret scan, threat-model, and recovery evidence              |
| Incremental testing and release documentation                               |         34–36 | Repeatable full-suite command and clean-machine walkthrough                    |

## Primary MVP journeys

1. A user submits a natural-language read/analysis goal.
2. The harness asks the configured model for a structured next action.
3. The harness validates permission and input before invoking an MCP tool.
4. Observations update durable state and are returned to the reasoning loop.
5. Instagram comments are retrieved from an explicitly authorized local session.
6. Analysis produces confidence-scored, source-linked results; low-confidence items enter review.
7. The dashboard shows live activity and durable results.
8. The task ends with a validated completion, failure, cancellation, or approval-required state.

## MVP scope

Included:

- One local user profile and an authenticated, user-created Instagram browser session.
- Read-only post, post-detail, and comment retrieval.
- English, Roman Urdu, and mixed-language comment analysis.
- Dynamic tool selection, bounded retries, cancellation, approval infrastructure, task history, and live SSE updates.
- Local Ollama, MongoDB, Node.js, MCP, Playwright, and React.

Deferred:

- Multi-tenant production deployment and third-party identity providers.
- Instagram write actions such as like, comment, message, edit, or delete.
- Mobile applications, cloud-hosted inference, vector databases, and autonomous scheduling.
- Model training/fine-tuning and guarantees of perfect sarcasm detection.

## Non-goals and constraints

- No CAPTCHA, anti-bot, rate-limit, or access-control bypass.
- No password, cookie, session state, or API secret in source code, prompts, logs, or MongoDB documents.
- No unrestricted browser, database, filesystem, shell, or network tool exposed to the model.
- No fixed `get posts -> get comments -> analyze -> save` production pipeline.
- No assumption that an LLM classification is correct; confidence, validation, provenance, and human review are required.

## Open decisions tracked for later phases

- The Ollama default/fallback models depend on the Phase 2 hardware benchmark.
- Exact MCP SDK/version is selected and pinned in Phase 5 after compatibility validation.
- Instagram selectors and supported surfaces are validated against the authorized account in Phase 7.
