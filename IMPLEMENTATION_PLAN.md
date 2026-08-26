# Instagram MCP Agent — Phased Implementation Plan

This roadmap converts [`AIagent.md`](./AIagent.md) into an incremental delivery plan for a real, dynamic, tool-using AI agent. It deliberately avoids a fixed `collect -> analyze -> save` workflow: the LLM proposes actions, while the harness validates, authorizes, executes, observes, and decides when to stop.

## How to use this plan

- `[ ]` means not verified; `[x]` means completed and verified.
- Check a subtask only after its immediately following **Checkpoint** passes.
- Check a task only when all of its subtasks and the **Task exit checkpoint** pass.
- Check a phase only when every task in it and the **Phase exit checkpoint** pass.
- Record evidence beside a checkpoint (test command, log/task ID, screenshot, or short note).
- Do not advance past a failed phase exit checkpoint; fix or explicitly document the blocker first.

## Architectural boundaries

| Layer | Owns | Must not own |
|---|---|---|
| React dashboard | Goal entry, status, approvals, results | Agent reasoning or browser automation |
| Backend API | HTTP/SSE boundary, auth, request orchestration | LLM decisions or Instagram selectors |
| Agent harness | State, loop, policy, validation, retries, stop rules | Model internals or tool implementations |
| LLM adapter | Ollama communication and structured decisions | Direct tool execution or permission decisions |
| MCP client/server | Typed tool discovery and invocation | Agent goal-completion policy |
| Playwright tools | Authorized browser interaction and extraction | Reasoning, sentiment policy, or secrets in code |
| MongoDB | Durable application data, task history, memory | Runtime decision-making |

## Global definition of done

- [ ] A natural-language goal can cause different next actions based on observations.
- [ ] The LLM cannot execute tools except through harness validation and permissions.
- [ ] All schemas, timeouts, retries, iteration limits, and stop conditions are enforced.
- [ ] Sensitive actions pause for explicit human approval.
- [ ] Instagram access uses an authorized local session without credentials in source, prompts, or logs.
- [ ] Unit, integration, and end-to-end tests pass, and setup/run documentation is current.

## Latest QA gate — 2026-08-24

- [x] Full workspace typecheck, lint, 53 automated tests (52 passed; one live Ollama test intentionally opt-in), and production builds pass (`npm run check`). Coverage includes Chrome/MCP integration plus followers/following collector and API bounds.
- [x] Production and development dependency audit reports zero known vulnerabilities.
- [x] Credential-pattern scan finds no embedded password, cookie, API key, or private key.
- [x] MCP integration leaves no child server process running after tests.
- [x] MongoDB integration leaves no UUID-named test database after cleanup.
- [x] Real Ollama integration and same-prompt multi-model benchmark pass: selected `qwen2:1.5b` Q4_0 achieved 5/5 schema validity and 5/5 semantic accuracy; the smaller Q3_K_M fallback achieved 5/5 schema validity and is explicitly restricted after 3/5 semantic accuracy. Evidence: `docs/benchmarks/local-model-profile.md` and the 11/11 opt-in live adapter suite.

### Phase 1–6 audit corrections

- [x] Corrected the Phase 1 workspace count from seven to eight.
- [x] Added session IDs to goals and permission grants, with a regression test proving grants do not leak between sessions.
- [x] Invoked diagnostic and search tools over the production stdio MCP boundary, matching the Phase 5 checkpoint claim.
- [x] Registered MongoDB tools in the production MCP process behind `MCP_DATABASE_ENABLED=true` and verified save/search through stdio.
- [x] Added strict collection validators plus integration checks for invalid documents and unsupported future schema versions.
- [x] Added same-user, cross-session memory-isolation coverage.
- [x] Re-ran dependency audits, secret scan, orphan-process check, and isolated test-database cleanup check.
- [x] Closed Phase 2 by installing a checksum-verified localhost Ollama runtime, benchmarking eight quantized candidates, adding legacy JSON compatibility, adding live integration and benchmark coverage, and wiring tested primary/fallback environment configuration.

**QA progression gate:** Phase 12 is in progress. Tasks 34 and 36 pass, and the bounded authorized Instagram MCP smoke passes in headed Chrome. Task 35's complete live dynamic analysis/save/display acceptance scenario remains unfinished.

**Phase 7 authorized smoke update — 2026-08-24:** Interactive login was completed and stored at the ignored project path with mode `0600`. A visible headed Playwright run restored the session, remained on the allowed Instagram origin, found four accessible post/reel links, opened one, and validated a normalized post ID and timestamp without logging private content.

---

# Phase 1 — Foundation and architecture

## Task 01 — Confirm requirements and non-goals

- [x] Extract functional requirements and primary user journeys from `AIagent.md`.
  - **Checkpoint:** A traceability table maps every major requirement to a planned task. Evidence: `docs/requirements/traceability.md`.
- [x] Document non-goals: CAPTCHA bypass, anti-bot bypass, credential hardcoding, and unrestricted autonomous writes.
  - **Checkpoint:** Non-goals are visible in architecture documentation and planned security tests. Evidence: traceability non-goals and Task 33 mapping.
- [x] Define MVP boundaries and deferred capabilities.
  - **Checkpoint:** MVP has an explicit included/deferred list accepted before scaffolding. Evidence: scope sections in `docs/requirements/traceability.md`.

**Task exit checkpoint:** [x] Requirements, constraints, and MVP scope have no unresolved critical ambiguity; model/SDK/selector decisions are explicitly deferred to their evidence-gathering phases.

## Task 02 — Record architecture decisions

- [x] Create ADRs for monorepo layout, TypeScript, package manager, API framework, and SSE versus WebSocket.
  - **Checkpoint:** Each ADR states context, decision, alternatives, and consequences. Evidence: `docs/adr/0001` through `0003`.
- [x] Define dependency direction between dashboard, API, harness, LLM adapter, MCP, tools, and storage.
  - **Checkpoint:** A dependency diagram contains no circular ownership. Evidence: `docs/architecture/overview.md`.
- [x] Define replaceable interfaces for LLM, persistence, event transport, and tools.
  - **Checkpoint:** Structurally typed fake implementations can satisfy each interface contract. Evidence: provider, repository, publisher, and gateway interfaces compile in `packages/contracts`.

**Task exit checkpoint:** [x] Architectural decisions support replacing Ollama/model, event transport, persistence, or tool gateway without rewriting the harness.

## Task 03 — Scaffold the monorepo

- [x] Create workspaces for shared contracts, agent core, Ollama adapter, MCP client, MCP server/tools, API, and React app.
  - **Checkpoint:** The original eight workspaces and the Phase 7 Playwright adapter (nine total) install and resolve local package imports. Evidence: `npm install` and `npm run check` passed on 2026-08-24.
- [x] Add root scripts for build, typecheck, lint, test, and development.
  - **Checkpoint:** Root typecheck, lint, test, production build, and development scripts run successfully. Evidence: `npm run check` passed; API `/health` and Vite HTML returned successfully under `npm run dev` on 2026-08-24.
- [x] Add environment templates and ignore rules without real secrets.
  - **Checkpoint:** Secret scan finds no credentials, cookies, or browser state. Evidence: `.env.example`, `.gitignore`, and repository regex scan on 2026-08-24.

**Task exit checkpoint:** [x] The dependency lockfile supports deterministic installation and the scaffold builds using `npm install` followed by `npm run check`.

**Phase 1 exit checkpoint:** [x] Architecture docs and the compiling workspace establish clean module boundaries. Evidence: zero-vulnerability install plus passing typecheck, lint, test runners, and builds.

---

# Phase 2 — Local LLM foundation

## Task 04 — Assess local model constraints

- [x] Capture available RAM, CPU, GPU/VRAM, operating system, and initial latency constraints.
  - **Checkpoint:** Hardware profile and model selection constraints are documented. Evidence: `docs/benchmarks/local-model-profile.md`.
- [x] Compare suitable Ollama models for tool reasoning, English, Roman Urdu, and structured JSON.
  - **Checkpoint:** Eight candidates/quantizations were evaluated with prompt set v1; the final default/fallback comparison used the identical five cases. Evidence: `docs/benchmarks/local-model-profile.md`.
- [x] Select a default and smaller fallback model.
  - **Checkpoint:** `qwen2:1.5b` Q4_0 is the 100% semantic default; Q3_K_M is the smaller schema-safe, reduced-capability fallback. Latency, observed memory change, validity, semantic accuracy, and limitations are recorded in the benchmark profile.

**Task exit checkpoint:** [x] Both selected tags load within the 15 GiB CPU-only laptop budget; the default passes all evaluation cases and the smaller fallback is configuration-selectable with its limitations enforced/documented.

## Task 05 — Implement the LLM provider abstraction

- [x] Define provider-neutral request, response, message, and structured-decision types.
  - **Checkpoint:** Types do not import Ollama-specific structures outside the adapter. Evidence: `packages/contracts/src/index.ts` compiles independently.
- [x] Implement the Ollama adapter with configuration, cancellation, and timeout support.
  - **Checkpoint:** The checksum-verified localhost runtime returned a schema-valid response from `qwen2:1.5b`; the opt-in live adapter suite passed 11/11. Environment factory tests cover primary/fallback selection and timeout validation.
- [x] Normalize transport and model errors into typed application errors.
  - **Checkpoint:** Offline, missing-model, and timeout tests return expected error codes. Evidence: Ollama adapter unit suite.

**Task exit checkpoint:** [x] Fake providers remain structurally interchangeable through `LlmProvider`, while `createConfiguredOllamaProvider` selects primary or fallback Ollama models from environment configuration.

## Task 06 — Establish structured decision prompting

- [x] Define the LLM decision schema: action, tool arguments, concise rationale summary, completion evidence/state, and user message.
  - **Checkpoint:** Valid examples pass and malformed examples fail schema validation. Evidence: Zod schema and adapter unit suite.
- [x] Build system/context prompts that expose only permitted tool definitions and relevant state.
  - **Checkpoint:** Prompt snapshot contains no unavailable tools or user identifier. Evidence: `prompt.test.ts`.
- [x] Add bounded JSON correction/retry behavior.
  - **Checkpoint:** A malformed first response is corrected once and an unrecoverable response fails safely. Evidence: correction-budget unit tests.

**Task exit checkpoint:** [x] The default model produced 5/5 locally validated decisions on prompt set v1; the fallback also produced 5/5 schema-valid decisions.

**Phase 2 exit checkpoint:** [x] Localhost Ollama produces validated, provider-neutral decisions with measured latency, memory, multilingual, schema, and semantic results. Evidence: live integration suite and `docs/benchmarks/local-model-profile.md`.

---

# Phase 3 — Agent core

## Task 07 — Model goals, tasks, and runtime state

- [x] Define task status, goal, current action, completed actions, observations, errors, and remaining-work types.
  - **Checkpoint:** State schema validates representative running, approval-paused, failed, safely-blocked, cancelled, and completed tasks. Evidence: agent-core state tests.
- [x] Implement immutable state transitions with timestamps and correlation IDs.
  - **Checkpoint:** Unit tests reject illegal transitions, preserve prior history, replay deterministically, and make duplicate step delivery idempotent. Evidence: `state.test.ts`.
- [x] Add state-size controls and observation references for large results.
  - **Checkpoint:** Oversized observations are replaced by size-stamped durable references without mutating their source. Evidence: compaction unit test.

**Task exit checkpoint:** [x] A task's full lifecycle can be replayed deterministically from transitions.

## Task 08 — Build the dynamic agent loop

- [x] Implement reason -> validate -> execute -> observe -> update -> reason-again orchestration.
  - **Checkpoint:** A fake model performs two different argument-dependent actions before evidence-backed completion. Evidence: dynamic runtime test.
- [x] Add cancellation, maximum iterations, and wall-clock deadline handling.
  - **Checkpoint:** Tests stop loops at each configured boundary with a clear terminal reason. Evidence: cancellation, iteration, and deadline tests.
- [x] Prevent concurrent execution of the same task and duplicate step application.
  - **Checkpoint:** Concurrency test yields one execution and duplicate transitions are idempotent. Evidence: runtime and state tests.

**Task exit checkpoint:** [x] No production path encodes a mandatory Instagram analysis sequence; the core depends only on provider-neutral model and tool ports.

## Task 09 — Implement completion and impossibility evaluation

- [x] Require explicit, schema-valid completion claims tied to goal evidence.
  - **Checkpoint:** The harness rejects missing or unsuccessful observation evidence. Evidence: completion-validation runtime test.
- [x] Define terminal outcomes: completed, failed, cancelled, approval-required, and safely-blocked.
  - **Checkpoint:** Each outcome has a tested transition and terminal reason/final response representation. Evidence: terminal-outcome state test.
- [x] Detect repeated no-progress actions and impossible goals.
  - **Checkpoint:** Repeated identical actions terminate within the configured bound and cannot-continue decisions preserve their explanation. Evidence: no-progress and impossible-goal tests.

**Task exit checkpoint:** [x] The loop stops correctly through harness-owned evidence and boundary rules, not only the model's assertion.

**Phase 3 exit checkpoint:** [x] A simulated multi-step goal completes dynamically and all implemented safety stop paths pass 14 agent-core tests.

---

# Phase 4 — Tools, validation, and policy

## Task 10 — Create the tool contract and registry

- [x] Define tool metadata, input/output schemas, risk level, timeout, and execution interface.
  - **Checkpoint:** Compile-time contracts plus runtime input/output and timeout tests cover valid and invalid tools. Evidence: tool-registry suite.
- [x] Implement registration, discovery, filtering, and lookup.
  - **Checkpoint:** Duplicate names fail; prohibited/ungranted tools are filtered before model context and rechecked before execution. Evidence: registry and policy tests.
- [x] Version tool contracts and expose machine-readable definitions.
  - **Checkpoint:** Registry snapshot includes stable names, semantic versions, JSON schemas, risk, and timeouts. Evidence: starter contract snapshot assertions.

**Task exit checkpoint:** [x] The harness can discover and invoke only registered, schema-valid tool contracts.

## Task 11 — Add safe starter tools

- [x] Implement a deterministic calculator tool.
  - **Checkpoint:** Arithmetic, precedence, parentheses, and code-like invalid-expression tests pass using a bounded parser without dynamic code execution.
- [x] Implement a read-only diagnostic/echo test tool.
  - **Checkpoint:** Structured input round-trips with byte-size limits enforced. Evidence: echo tool tests.
- [x] Implement an in-memory test repository tool for save/search behavior.
  - **Checkpoint:** Integration tests verify create, query, duplicate, and validation cases. Evidence: repository tool tests.

**Task exit checkpoint:** [x] The dynamic loop invokes calculator then repository tools and completes from both successful observations.

## Task 12 — Implement permission and approval policy

- [x] Classify tools/actions as read, write, sensitive, or prohibited.
  - **Checkpoint:** Every registered tool requires a risk classification and prohibited tools cannot be exposed or authorized. Evidence: contract and policy tests.
- [x] Enforce user/session allowlists before execution.
  - **Checkpoint:** Denied tools never reach their executor and result in an event-producing safely-blocked transition. Evidence: runtime policy test and event-enabled transition path.
- [x] Create approval request, pause, approve, reject, and expiry transitions.
  - **Checkpoint:** Sensitive actions pause before execution; decisions require a valid task/user-bound token and handle approval, rejection, duplicate decision, and expiry. Evidence: approval-manager tests.

**Task exit checkpoint:** [x] Model output cannot bypass tool visibility filtering, pre-execution authorization, prohibition, or human approval.

**Phase 4 exit checkpoint:** [x] Tool schemas, policy enforcement, starter tools, and approval pauses pass 24 agent-core tests including simulated runtime tasks.

---

# Phase 5 — Custom MCP layer

## Task 13 — Scaffold the MCP server

- [x] Select and pin the official MCP SDK and transport supported by the local architecture.
  - **Checkpoint:** Official MCP server/client SDKs are pinned at `2.0.0`, with v2/stdIO compatibility rationale documented in ADR 0004.
- [x] Implement server startup, graceful shutdown, health diagnostics, and structured logging.
  - **Checkpoint:** Stdio integration starts, emits structured stderr readiness diagnostics, reconnects, closes every child transport, and leaves no orphan MCP process.
- [x] Expose starter tools through MCP with input and output schemas.
  - **Checkpoint:** The official MCP client lists all four starter tools and invokes calculator, diagnostic, save, and search contracts through their schemas. Evidence: production stdio integration test.

**Task exit checkpoint:** [x] MCP calculator and repository results/errors match the same registry contracts exercised directly in Phase 4.

## Task 14 — Implement the MCP client adapter

- [x] Add connection lifecycle, capability negotiation, and tool discovery.
  - **Checkpoint:** Client reconnect spawns a fresh server and restores all tool definitions.
- [x] Map MCP definitions into the harness tool registry.
  - **Checkpoint:** Gateway definitions preserve name, description, input/output schemas, semantic version, risk, and timeout metadata.
- [x] Normalize MCP timeouts, cancellation, protocol/validation, connection, and tool errors.
  - **Checkpoint:** Each category produces a typed `ToolObservation`, verified with slow, cancellable, malformed, unavailable, and duplicate fixtures.

**Task exit checkpoint:** [x] `AgentRuntime` completes a goal through `McpToolGateway`, the stdio MCP server, and calculator without a direct tool call.

## Task 15 — Harden MCP execution boundaries

- [x] Validate inputs before sending and outputs after receiving.
  - **Checkpoint:** MCP/registry input validation rejects missing calculator input and SDK output validation rejects a malformed server result.
- [x] Add payload limits, per-tool timeouts, and cancellation propagation.
  - **Checkpoint:** Oversize input is rejected before connection; slow and caller-cancelled tools return bounded typed observations.
- [x] Add invocation IDs and idempotency support for write tools.
  - **Checkpoint:** Invocation IDs cross MCP metadata, identical retries return the cached write observation, conflicting reuse is rejected, and a new invocation exposes the underlying duplicate.

**Task exit checkpoint:** [x] MCP failures are safe, observable, payload/time bounded, cancellation-aware, and classified for retry policy.

**Phase 5 exit checkpoint:** [x] Harness -> MCP client -> MCP server -> starter tool passes success and failure paths under the full project check on 2026-08-24.

---

# Phase 6 — MongoDB persistence and memory

## Task 16 — Design MongoDB collections and indexes

- [x] Define schemas for users, sessions, tasks, steps, posts, comments, analyses, memory, approvals, and durable invocation records.
  - **Checkpoint:** Each collection documents ownership, retention, provenance, and prohibited sensitive data in `docs/architecture/mongodb-data-model.md`.
- [x] Define unique, lookup, sorting, text, and TTL indexes.
  - **Checkpoint:** Named indexes cover user scoping, task ordering, source deduplication, analysis versions, memory retrieval, approvals, sessions, and idempotency; migration tests verify critical indexes.
- [x] Define migrations/versioning and local seed strategy.
  - **Checkpoint:** Empty/v0 databases reach schema version 1, strict collection validators are installed, repeated migration is idempotent, and unknown future versions fail safely. Evidence: migration implementation and isolated MongoDB tests.

**Task exit checkpoint:** [x] Task snapshots are bounded while step/observation evidence is stored separately and reconstructed in order.

## Task 17 — Implement repositories and database MCP tools

- [x] Build typed repositories for task state, steps, Instagram posts/comments, and analyses.
  - **Checkpoint:** Repository tests run against a UUID-named local MongoDB database and remove it afterward.
- [x] Expose narrowly scoped `database_save`, `database_search`, and `database_update` tool contracts for MCP registration.
  - **Checkpoint:** Entity enums, runtime schemas, user scoping, field allowlists, and ownership-field protection reject arbitrary collections and unsafe query operators; production stdio registration and save/search are integration-tested with `MCP_DATABASE_ENABLED=true`.
- [x] Add upsert/deduplication using source identifiers and durable invocation IDs.
  - **Checkpoint:** Re-imported posts and retried database writes produce one record; invocation results are durably reused.

**Task exit checkpoint:** [x] Database tool contracts plug into the MCP server registry and persist/retrieve only validated, user-scoped records.

## Task 18 — Add short- and long-term memory

- [x] Create short-term context assembly from current task state and recent steps.
  - **Checkpoint:** Context retains the latest ten steps and compacts progressively within a configured byte budget.
- [x] Store durable task summaries and reusable application memory with provenance.
  - **Checkpoint:** Memory writes require source task, timestamp, kind, user, and stable memory ID.
- [x] Add relevance retrieval and explicit memory isolation per user/session.
  - **Checkpoint:** Text retrieval always includes user scope; cross-user and same-user cross-session tests return no foreign records.

**Task exit checkpoint:** [x] A new repository instance reconstructs state from a bounded task snapshot plus ordered step evidence.

**Phase 6 exit checkpoint:** [x] MongoDB-backed task state, tool evidence, source data, idempotency, and scoped memory pass isolated integration tests and the full project check.

---

# Phase 7 — Playwright and authorized Instagram access

## Task 19 — Build the browser automation service

- [x] Implement managed browser/context/page lifecycle and graceful cleanup.
  - **Checkpoint:** Repeated real-Chrome start/stop tests close page, context, and browser; MCP shutdown also stops its browser service. Evidence: Playwright adapter and production stdio MCP suites.
- [x] Add navigation, extraction, timeout, and screenshot-on-error primitives.
  - **Checkpoint:** Local fixture pages pass success, bounded timeout, and selector-failure screenshot paths.
- [x] Restrict navigation to configured allowed origins and safe protocols.
  - **Checkpoint:** Tests block foreign origins, file URLs, and JavaScript URLs before navigation.

**Task exit checkpoint:** [x] Browser primitives are reliable on local fixtures without Instagram access; all five Playwright adapter tests pass.

## Task 20 — Secure authenticated session handling

- [x] Add an interactive, user-authorized login/bootstrap flow.
  - **Checkpoint:** `npm run bootstrap:instagram -w @instagram-agent/playwright-adapter` accepts credentials only through the visible browser; a fixture test creates reusable state without prompt/terminal credentials.
- [x] Store browser state outside source control with restrictive local permissions.
  - **Checkpoint:** State is forced to mode `0600`; its directory and error screenshots are ignored by Git. Fixture permission test passes.
- [x] Detect expired sessions and require re-authentication without bypass behavior.
  - **Checkpoint:** Login redirects produce typed `authentication_required`; no CAPTCHA, anti-bot, or login bypass path exists.

**Task exit checkpoint:** [x] The user-authorized Instagram session was persisted with mode `0600`, restored by a new visible browser context, and no credential/session content appeared in source or logs.

## Task 21 — Implement Instagram read tools

- [x] Implement `instagram_get_posts` with pagination/bounds and normalized output.
  - **Checkpoint:** Fixture, production MCP, direct authorized, and headed authorized MCP runs validate bounded post IDs, canonical URLs, timestamps, and continuation output. The final live run returned two posts.
- [x] Implement `instagram_get_post_details` with resilient extraction boundaries.
  - **Checkpoint:** Fixture test proves missing optional fields do not corrupt the result schema; the headed authorized MCP run validated a real detail record.
- [x] Implement `instagram_get_comments` with pagination, deduplication, and progress observations.
  - **Checkpoint:** Fixtures return unique normalized comments and continuation state. The headed authorized MCP run returned two comments and verified that cursor page 2 contained distinct deterministic comment IDs.

**Task exit checkpoint:** [x] All three contracts are registered through production MCP and operate only through the restored user-authorized, same-origin browser context; fixture and live headed checks pass.

**Phase 7 exit checkpoint:** [x] Production MCP retrieves authorized post, detail, and paginated comment data with bounded schemas, deterministic IDs, deduplication, typed authentication expiry, private-content-safe smoke output, and clean browser shutdown.

## Phase 7 feature extension — Followers/following comment explorer

- [x] Add bounded, resumable followers and following discovery from the authorized owner profile.
  - **Checkpoint:** Headed production MCP opens the owner profile/following dialog and returns three normalized accounts without logging names; `instagram_get_connections` supports both lists and numeric cursors.
- [x] Collect visible posts and comments for following accounts without failing the whole batch.
  - **Checkpoint:** The collector groups display name/username → posts → comments, respects account/post/comment bounds, propagates connection cursors, and isolates inaccessible accounts. Unit tests verify nesting and partial failure behavior.
- [x] Add a localhost API and dashboard explorer.
  - **Checkpoint:** The Vite-proxied live request returned one follower, one following account, one post, and both continuation cursors. The responsive dashboard renders follower names plus following account, post, and comment hierarchy with loading/error/empty states.

**Feature exit checkpoint:** [x] Authorized connection lists and following-account content are available as bounded resumable batches through Playwright → MCP → API → dashboard; no access-control bypass or unbounded single request was introduced.

---

# Phase 8 — Comment analysis and quality controls

## Task 22 — Define the analysis contract and taxonomy

- [x] Define sentiment, confidence, reason, complaint category, severity, language, and review status schemas.
  - **Checkpoint:** Representative English, Roman Urdu, mixed-language, slang, and ambiguous examples validate.
- [x] Create configurable confidence and severity rules.
  - **Checkpoint:** Boundary-value tests produce the expected auto/review outcomes.
- [x] Define taxonomy versioning and an unknown/other path.
  - **Checkpoint:** New categories can be introduced without invalidating old records.

**Task exit checkpoint:** Analysis output is structured, versioned, and does not force certainty.

## Task 23 — Implement batched LLM analysis

- [x] Build token/size-aware comment batching with stable comment IDs.
  - **Checkpoint:** Large fixture sets split without loss, duplication, or ID mismatch.
- [x] Prompt the provider for structured multilingual classification and complaint extraction.
  - **Checkpoint:** Evaluation set meets agreed schema-validity and baseline quality thresholds.
- [x] Validate, retry, and isolate individual failed items.
  - **Checkpoint:** One malformed result does not discard successful results from its batch.

**Task exit checkpoint:** At least 2,000 fixture comments process within resource and retry limits.

## Task 24 — Implement summaries and human review

- [x] Group negative comments by complaint category and severity with source references.
  - **Checkpoint:** Every aggregate count traces back to unique comment IDs.
- [x] Generate grounded summaries that cite supporting records.
  - **Checkpoint:** Unsupported summary claims fail validation or are flagged.
- [x] Queue low-confidence results and support reviewer correction.
  - **Checkpoint:** Corrections preserve original output, reviewer, timestamp, and audit history.

**Task exit checkpoint:** Dashboard-ready results distinguish model output, aggregate evidence, and human corrections.

**Phase 8 exit checkpoint:** [x] Multilingual analysis is batched, validated, traceable, and reviewable. Evidence: 2,000-comment fixture passes without loss or duplication; batch failures retry per item; invalid outputs remain isolated; reviewer edits retain immutable originals and audit history; live `qwen2.5:1.5b` evaluation scored 5/5 schema-valid and 5/5 expected sentiment/language classifications.

---

# Phase 9 — Backend API and live events

## Task 25 — Implement API foundation

- [x] Configure the Node.js API, validation, typed errors, request IDs, and health/readiness endpoints.
  - **Checkpoint:** API smoke and malformed-request tests return stable response envelopes.
- [x] Add authentication/session middleware and user-scoped authorization.
  - **Checkpoint:** Unauthenticated and cross-user access tests are denied.
- [x] Add rate limits, body limits, CORS, and secure defaults.
  - **Checkpoint:** Security middleware tests cover all public endpoints.

**Task exit checkpoint:** API starts, reports dependency readiness, and enforces its boundary controls.

## Task 26 — Implement agent task endpoints

- [x] Implement `POST /agent/tasks` to validate and enqueue a natural-language goal.
  - **Checkpoint:** Response returns a task ID and initial durable state.
- [x] Implement task detail, status, and steps endpoints.
  - **Checkpoint:** Responses are ordered, paginated where needed, and user-scoped.
- [x] Implement cancellation and approval decision endpoints.
  - **Checkpoint:** Race, expired approval, duplicate decision, and terminal-task tests pass.

**Task exit checkpoint:** The full task lifecycle is controllable over authenticated HTTP.

## Task 27 — Implement data, analytics, and event endpoints

- [x] Implement posts and comments query endpoints with filtering and pagination.
  - **Checkpoint:** Query contract and ownership tests pass on representative data volumes.
- [x] Implement analytics summaries with documented aggregation semantics.
  - **Checkpoint:** API totals match direct database aggregation fixtures.
- [x] Implement authenticated SSE (or selected transport) with resume support and heartbeats.
  - **Checkpoint:** Reconnection resumes without missing or duplicating persisted events.

**Task exit checkpoint:** Clients receive durable snapshots plus ordered live task updates.

**Phase 9 exit checkpoint:** [x] API integration tests cover create, monitor, approve/cancel, query, and reconnect flows. Evidence includes Mongo-backed task/event persistence, optimistic race detection, expired/duplicate/terminal approval handling, cross-user denial, bounded queries, exact aggregation fixtures, and live SSE reconnection using `Last-Event-ID` without duplicates.

---

# Phase 10 — React dashboard

## Task 28 — Build the dashboard shell and API client

- [x] Create routing, layout, error boundary, configuration, and accessible base components.
  - **Checkpoint:** Production build succeeds and accessibility smoke tests pass.
- [x] Build a typed API client with auth, cancellation, and normalized errors.
  - **Checkpoint:** Mock-server tests cover success, validation, authorization, and network failures.
- [x] Add query/cache state and live-event reconciliation.
  - **Checkpoint:** Reconnect and refresh do not duplicate events or show stale terminal state.

**Task exit checkpoint:** Dashboard loads reliable authenticated data from the backend.

## Task 29 — Implement goal, progress, and approval experiences

- [x] Build natural-language goal entry with validation and submission feedback.
  - **Checkpoint:** Empty, oversized, duplicate-click, success, and server-error cases pass UI tests.
- [x] Build status, current action, progress, and chronological activity views.
  - **Checkpoint:** Simulated events render running, paused, failed, cancelled, and completed states.
- [x] Build approval detail with risk explanation, approve, reject, and expiry handling.
  - **Checkpoint:** Approval UI never implies execution before backend confirmation.

**Task exit checkpoint:** A user can start and safely supervise an agent task end to end.

## Task 30 — Implement results and review experiences

- [x] Display sentiment totals and complaint groups with severity and filters.
  - **Checkpoint:** UI totals match API fixtures across filters.
- [x] Link summaries and aggregates to source comments.
  - **Checkpoint:** Every displayed claim can open its supporting records.
- [x] Build low-confidence review and correction controls.
  - **Checkpoint:** Correction round-trip updates the view and retains audit history.

**Task exit checkpoint:** Results are understandable, evidence-backed, and reviewable on common screen sizes.

**Phase 10 exit checkpoint:** [x] Browser tests cover goal submission through live completion and human review. Evidence: 18 component/client/cache tests plus a real Chromium production-build smoke test cover authentication-aware API outcomes, cancellation, stale snapshot rejection, event deduplication, all task states, approval confirmation timing, SSE completion, filtered totals, source-record opening, correction audit history, the bounded connections explorer, responsive production build, and an automated accessibility scan.

---

# Phase 11 — Reliability, security, and observability

## Task 31 — Add retry, timeout, and recovery policies

- [x] Define error taxonomy and retry eligibility by component/tool.
  - **Checkpoint:** Policy table explicitly excludes validation, permission, and permanent failures from retry.
- [x] Implement capped exponential backoff with jitter and retry budgets.
  - **Checkpoint:** Fake-clock tests verify caps, counts, and cancellation during backoff.
- [x] Add restart recovery for running and approval-pending tasks.
  - **Checkpoint:** Crash simulation resumes safely without duplicated writes or steps.

**Task exit checkpoint:** Transient failures recover, permanent failures terminate clearly, and retries remain bounded.

## Task 32 — Implement observability and audit trails

- [x] Emit structured logs with task, step, invocation, duration, status, and retry fields.
  - **Checkpoint:** A task can be traced across API, harness, MCP, and tool logs by IDs.
- [x] Persist decisions, tool calls, redacted arguments/results, approvals, and terminal outcomes.
  - **Checkpoint:** Audit reconstruction explains who/what caused each state change.
- [x] Add metrics and diagnostics for latency, errors, retries, queue depth, and model usage.
  - **Checkpoint:** A controlled failure appears in logs, metrics, and task history.

**Task exit checkpoint:** Operators can diagnose a failed task without exposing private content or secrets.

## Task 33 — Perform security and privacy hardening

- [x] Create a threat model for prompt injection, tool abuse, SSRF/navigation, data leakage, and session theft.
  - **Checkpoint:** Each high-risk threat has a tested mitigation or accepted-risk record.
- [x] Add centralized redaction, least-privilege configuration, dependency scanning, and secret scanning.
  - **Checkpoint:** Seeded test secrets are detected/redacted and production secrets never enter prompts.
- [x] Define data retention, deletion, export, and local backup behavior.
  - **Checkpoint:** Test-user deletion removes or anonymizes all scoped records as documented.

**Task exit checkpoint:** Security checklist passes with no unresolved critical/high finding.

**Phase 11 exit checkpoint:** [x] Failure injection, restart recovery, audit reconstruction, and security tests all pass. Evidence: `npm run check` completed with 98 passing checks and one intentionally skipped optional real-Ollama smoke; real Chromium passed, seeded-secret scanning passed, `npm audit --audit-level=high` reported zero vulnerabilities, and Mongo recovery/privacy tests verified idempotent resume plus scoped export/deletion.

---

# Phase 12 — System validation and release

## Task 34 — Build the complete automated test strategy

- [x] Set coverage targets and implement unit tests for schemas, state transitions, policy, and retry logic.
  - **Checkpoint:** Critical agent-core and permission branches meet the agreed coverage target. Evidence: `npm run test:coverage` enforces 95% lines, 80% branches, and 85% functions; the final release run measured 98.54%, 85.29%, and 93.22% respectively.
- [x] Add contract/integration tests for Ollama, MCP, MongoDB, API, and Playwright fixtures.
  - **Checkpoint:** CI/local test runner provisions isolated dependencies and cleans them up. Evidence: `npm run check` covers production MCP stdio, isolated Mongo repositories, Fastify/SSE, Ollama fixtures, Playwright fixtures, and real Chromium with cleanup assertions.
- [x] Add deterministic end-to-end scenarios with fake LLM plus optional local-model smoke tests.
  - **Checkpoint:** Success, approval, retry, malformed output, cancellation, and impossible-goal scenarios pass. Evidence: agent runtime/policy/reliability, Ollama correction, API approval, and Chromium SSE suites cover the matrix; real Ollama remains an explicit opt-in smoke.

**Task exit checkpoint:** One documented command runs the full repeatable verification suite.

## Task 35 — Validate the real Instagram use case

- [x] Run an authorized limited-volume smoke task for posts and comments.
  - **Checkpoint:** Extracted records are accurate, deduplicated, scoped, and auditable. Evidence: headed production MCP smoke returned 3 following accounts, 2 posts, normalized details, 2 comments, and duplicate-free cursor handling without logging private content.
- [ ] Run the full goal: find negative comments, group complaints, assess severity, save, and display.
  - **Checkpoint:** Step history proves choices were made through the dynamic agent loop.
- [x] Test large-volume batching, interruption, session expiry, and recovery.
  - **Checkpoint:** Limits are respected and failures produce safe, actionable states. Evidence: 2,000-comment batching, cancellation/deadline, login redirect/session-expiry, and optimistic restart recovery tests pass without duplicate steps or writes.

**Task exit checkpoint:** The primary user journey succeeds without hardcoded orchestration or access-control bypass.

## Task 36 — Document, package, and release the MVP

- [x] Write setup guides for Node.js, Ollama/models, MongoDB, browser installation, session bootstrap, and dashboard.
  - **Checkpoint:** A clean-machine walkthrough succeeds using documentation only. Evidence: an allowlisted source-only temporary copy completed `npm ci` and the release-readiness check without auth or build artifacts.
- [x] Document module responsibilities, APIs, schemas, permissions, operations, troubleshooting, and model swapping.
  - **Checkpoint:** Documentation links each architectural layer to its source package and tests. Evidence: `docs/architecture/module-map.md`, API, security, reliability, observability, setup, and troubleshooting guides provide the source/test map.
- [x] Create release configuration, versioning, changelog, backup guidance, and known-limitations list.
  - **Checkpoint:** Release candidate installs, starts, stops, and recovers cleanly. Evidence: semantic v0.1.0, `.nvmrc`, changelog, release checklist, known limitations, clean install, process start/stop probe, API lifecycle tests, and Mongo restart tests pass.

**Task exit checkpoint:** MVP release is reproducible, documented, secure by default, and meets the global definition of done.

**Phase 12 exit checkpoint:** Stakeholder acceptance confirms the primary scenario, safety controls, and local-first operation.

---

# Milestone checklist

- [x] **M1 — Architecture ready:** Phases 1–2 complete.
- [x] **M2 — Dynamic core ready:** Phases 3–4 complete.
- [x] **M3 — Tool platform ready:** Phase 5 complete.
- [x] **M4 — Persistence ready:** Phase 6 complete.
- [x] **M5 — Instagram read path ready:** Phase 7 complete.
- [x] **M6 — Analysis ready:** Phase 8 complete.
- [x] **M7 — Application ready:** Phases 9–10 complete.
- [ ] **M8 — MVP release ready:** Phases 11–12 complete and global definition of done checked.

## Recommended execution rule

Work on one task at a time within a phase unless two tasks are explicitly independent. After completing a subtask, attach its evidence and check its checkpoint. At the end of each phase, run the phase test suite and update this file before beginning the next phase.
