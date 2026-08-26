# ADR 0002: Fastify API and Server-Sent Events

- Status: accepted
- Date: 2026-08-24

## Context

The dashboard sends ordinary commands and primarily receives one-way task activity updates.

## Decision

Use Fastify for the Node.js API and authenticated SSE for live events. Commands such as task creation, cancellation, and approval remain HTTP requests. Persist events before publishing them, provide event IDs, resume through `Last-Event-ID`, and send heartbeats.

## Alternatives

- WebSocket: supports bidirectional messages but creates unnecessary lifecycle complexity for the MVP.
- Polling: simple, but inefficient and less responsive.
- Express: mature, but Fastify provides a strong schema/plugin model and good TypeScript support.

## Consequences

SSE is easy to inspect and reconnect. If future requirements demand bidirectional streaming, `EventPublisher` allows a WebSocket adapter without changing agent core.
