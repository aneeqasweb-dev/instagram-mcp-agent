# ADR 0003: Infrastructure-independent agent core

- Status: accepted
- Date: 2026-08-24

## Context

The specification requires a real agent whose runtime owns policy and whose model and tools can be replaced.

## Decision

Use ports and adapters. Agent core owns the dynamic loop, state machine, policy, validation, retry decisions, and stop conditions. Ollama, MCP, MongoDB, event transport, and browser automation implement outward-facing ports.

## Alternatives

- Put orchestration in API route handlers: initially shorter, but hard to test/recover.
- Put orchestration in model prompts: unsafe and impossible to enforce reliably.
- Fixed workflow engine: contradicts observation-dependent tool selection.

## Consequences

There is more contract code early. In return, fake adapters permit deterministic tests, infrastructure is replaceable, and the model cannot bypass runtime controls.
