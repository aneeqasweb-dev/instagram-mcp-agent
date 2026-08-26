# ADR 0001: npm workspaces and TypeScript

- Status: accepted
- Date: 2026-08-24

## Context

The system has multiple applications and infrastructure adapters that must share contracts without collapsing architectural boundaries.

## Decision

Use npm workspaces, Node.js ESM, strict TypeScript, and project-local scripts. Keep deployable applications under `apps/` and reusable modules under `packages/`.

## Alternatives

- Separate repositories: stronger physical isolation but excessive coordination for a local MVP.
- pnpm/Turborepo: useful at scale, but adds tooling not currently needed.
- Plain JavaScript: lower initial setup but weaker tool/state contract enforcement.

## Consequences

One install and root command operate the project. Boundaries are enforced by package dependencies and reviews rather than separate repositories.
