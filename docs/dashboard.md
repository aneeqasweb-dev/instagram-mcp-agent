# React dashboard

The dashboard uses hash routes so a static Vite build can serve every view without server rewrite rules:

- `#/tasks` creates and supervises durable agent tasks.
- `#/analytics` shows filterable sentiment totals and complaint groups; every group opens its source comment records.
- `#/reviews` corrects low-confidence results only after backend confirmation and exposes original output plus audit history.
- `#/connections` preserves bounded, resumable followers/following collection and its account → post → comment hierarchy.

## Authentication

If `VITE_API_TOKEN` is not configured, the dashboard displays a local session screen. The entered `API_SESSION_TOKEN` is kept in `sessionStorage`, sent as a bearer token by the typed API client, and cleared when the browser tab's session ends.

## Live state

Task events stream through authenticated `fetch`-based SSE so the authorization header can be supplied. Event IDs are deduplicated, the last ID is used on reconnect, and task snapshots are reconciled by revision. A stale refresh cannot replace a newer or terminal state.

## Verification

```bash
npm test -w @instagram-agent/dashboard
npm run build -w @instagram-agent/dashboard
```

The test suite covers normalized API errors, abort handling, goal validation and duplicate clicks, live completion, every terminal/pause state, approval confirmation timing, analytics evidence, correction audit history, connections, and an axe accessibility smoke scan. It also launches real Chromium against the production build and exercises goal submission → SSE completion → reviewer correction.
