# Technical architecture

## Dependency direction

```text
React dashboard -> Backend API -> Agent harness -> Ports/contracts
                                         |          ^
                                         v          |
                                 LLM and MCP adapters
                                                |
                                                v
                                      MCP server -> tools
                                                     |-- Playwright
                                                     `-- MongoDB
```

Dependencies point toward shared contracts and agent policy. Infrastructure implements ports; the core does not import Fastify, Ollama, MongoDB, Playwright, React, or MCP SDK types.

## Runtime communication

1. React submits a goal to the backend and receives a durable task ID.
2. The backend starts or queues the harness and streams persisted task events via SSE.
3. The harness assembles bounded state and permitted tool definitions for the LLM adapter.
4. The LLM proposes a structured action; it never calls a tool directly.
5. The harness validates the decision, state transition, tool input, permission, and approval requirements.
6. The MCP client invokes the typed MCP server tool with an invocation ID and timeout.
7. The tool returns a validated observation. Large payloads are persisted and referenced rather than copied indefinitely into prompts.
8. The harness records the observation and asks the LLM what to do next.
9. Harness-owned completion rules accept or reject the proposed terminal outcome.

## Package responsibilities

| Workspace | Responsibility |
|---|---|
| `packages/contracts` | Provider-neutral domain types and replaceable ports |
| `packages/agent-core` | Dynamic loop, state transitions, validation, policy, completion rules |
| `packages/ollama-adapter` | Ollama implementation of the LLM provider port |
| `packages/mcp-client` | MCP discovery/invocation adapter for the harness |
| `packages/mcp-server` | Typed MCP gateway and tool registration |
| `packages/mongodb-adapter` | MongoDB migrations, scoped repositories, database tools, and durable memory |
| `apps/api` | Fastify HTTP/SSE boundary, authentication, and request orchestration |
| `apps/dashboard` | React goal, supervision, approval, activity, results, and review UI |

## Replaceable ports

- `LlmProvider`: provider-neutral message and structured-decision request/response.
- `TaskRepository`: durable task state and transition persistence.
- `EventPublisher`: ordered event publication independent of SSE/WebSocket.
- `ToolGateway`: discovery and invocation independent of MCP transport.

Mock implementations can be used in tests without infrastructure dependencies.

## Trust boundaries

- User input and model output are untrusted.
- Tool input and output are runtime-schema validated.
- Permissions and approvals are evaluated by the harness, not by prompts.
- Backend authentication establishes user scope; repositories enforce the same scope.
- Browser navigation uses an origin allowlist and a user-authorized session.
- Logs and events pass through centralized redaction.
