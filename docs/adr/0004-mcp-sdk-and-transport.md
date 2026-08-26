# ADR 0004: MCP SDK v2 over stdio

- Status: accepted
- Date: 2026-08-24

## Context

The agent and custom tool server run on the same laptop. The MCP SDK v2 line implements the 2026-07-28 protocol and is the current stable release.

## Decision

Pin `@modelcontextprotocol/server` and `@modelcontextprotocol/client` at `2.0.0`. Use stdio with a client-spawned child process. Keep MCP types inside adapter packages and expose only project contracts to agent core.

## Alternatives

- MCP v1: still supported temporarily, but it is the legacy line.
- Streamable HTTP: appropriate for remote/shared servers, but adds an unnecessary listening port and authentication surface locally.
- Direct function calls: useful in earlier tests, but does not validate the required standardized MCP boundary.

## Consequences

The client owns server process lifecycle, and stdout is reserved exclusively for MCP frames. Diagnostics go to stderr. Future remote deployment can add a Streamable HTTP transport behind the same `ToolGateway` interface.
