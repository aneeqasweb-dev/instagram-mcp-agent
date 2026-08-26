# MVP release checklist

1. Use Node.js 22+, run `npm ci`, and configure `.env` from the example.
2. Run `npm run verify:release`; retain the summary without private task content.
3. Confirm MongoDB backup/restore and user export/deletion behavior from the data-lifecycle guide.
4. Bootstrap the Instagram session in a visible browser and run the bounded authorized MCP smoke.
5. Run the optional real-Ollama smoke with the selected local model.
6. Start `npm run dev`; confirm API health/readiness, dashboard load, task cancellation, and clean Ctrl-C shutdown.
7. Confirm no critical/high security finding, update `CHANGELOG.md`, and tag the exact semantic version.

Release artifacts must not contain `.env`, `playwright/.auth`, screenshots, MongoDB data, logs, or coverage output. A failed mandatory checkpoint blocks the release candidate.
