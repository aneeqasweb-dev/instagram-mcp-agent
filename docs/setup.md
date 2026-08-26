# Local setup

## Prerequisites

- Node.js 22 or newer and npm 10 or newer
- MongoDB reachable on localhost (or a custom `MONGODB_URI`)
- Ollama with a small instruction model suitable for the machine
- Google Chrome or Chromium

## Install and configure

1. Run `npm ci` from the repository root.
2. Copy `.env.example` to `.env` and keep `.env` private.
3. Generate a long random `API_SESSION_TOKEN`; do not reuse an account password.
4. Set `OLLAMA_MODEL` and optionally `OLLAMA_FALLBACK_MODEL`. Run `ollama pull <model>` for each configured model.
5. Start MongoDB and confirm the configured database is reachable.
6. Install Playwright's browser dependencies if the system Chrome path in `PLAYWRIGHT_EXECUTABLE_PATH` is unavailable.

## Authorize Instagram locally

Run `npm run build -w @instagram-agent/playwright-adapter`, then run `npx tsx packages/playwright-adapter/src/bootstrap-session.ts`. Complete login yourself in the visible browser. The resulting `playwright/.auth/instagram.json` contains sensitive session data, is excluded from source control, and must be readable only by your OS user.

Keep `MCP_INSTAGRAM_ENABLED=false` until the session has been created and verified. The automation is bounded to the configured Instagram origin and does not receive account credentials.

## Run

Run `npm run dev`, then open `http://localhost:5173`. The API defaults to `http://127.0.0.1:3000`. Supply the configured bearer session through the dashboard's local session flow.

Before enabling live Instagram tools, run the visible bounded smoke:

```sh
npx tsx packages/mcp-client/src/authorized-instagram-smoke.ts
```

## Verify

`npm run verify:release` runs type checks, lint checks, unit/integration tests, the deterministic browser fixture, secret and dependency scans, production builds, agent-core coverage thresholds, and packaging readiness. Live Instagram and real local-model smokes remain explicit opt-in checks because they require the user's session and machine-local model.
