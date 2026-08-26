import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
test("Chromium completes a goal through SSE and confirms a human correction", async () => {
  const server = createServer(async (request, response) => { const pathname = new URL(request.url ?? "/", "http://local").pathname; const target = path.join(dist, pathname === "/" ? "index.html" : pathname); try { const body = await readFile(target); response.setHeader("content-type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/html"); response.end(body); } catch { response.statusCode = 404; response.end(); } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/usr/bin/google-chrome" }); const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); let taskReads = 0; let corrected = false;
  page.on("pageerror", (error) => process.stderr.write(`browser page error: ${error.message}\n`));
  await page.addInitScript(() => sessionStorage.setItem("instagram-agent-token", "browser-token"));
  await page.route(/\/api\//, async (route) => { const url = new URL(route.request().url()); const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data }) });
    if (url.pathname.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: `id: e1\nevent: task.completed\ndata: {"id":"e1","taskId":"task-1","type":"task.completed","occurredAt":"2026-08-25T00:00:01Z","payload":{}}\n\n` });
    if (url.pathname === "/api/agent/tasks" && route.request().method() === "POST") return json({ taskId: "task-1", goal: "Analyze comments", status: "running", currentAction: "instagram_get_comments", revision: 1, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z", steps: [] }, 202);
    if (url.pathname === "/api/agent/tasks/task-1") { taskReads += 1; return json({ taskId: "task-1", goal: "Analyze comments", status: "completed", currentAction: null, revision: 2, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:01Z", steps: [], finalResponse: "Analysis ready" }); }
    if (url.pathname === "/api/reviews" && route.request().method() === "GET") return json([{ commentId: "c1", sentiment: "negative", confidence: .55, reason: "Ambiguous", complaintCategory: "delivery", severity: "high", language: "mixed", reviewStatus: "needs_review", complaint: "Late" }]);
    if (url.pathname === "/api/reviews/c1" && route.request().method() === "PATCH") { corrected = true; return json({ commentId: "c1", sentiment: "mixed", confidence: .55, reason: "Ambiguous", complaintCategory: "delivery", severity: "high", language: "mixed", reviewStatus: "reviewed", original: { sentiment: "negative" }, history: [{}] }); }
    return json({}); });
  try { await page.goto(`http://127.0.0.1:${address.port}/#/tasks`); await page.getByLabel("Natural-language goal").fill("Analyze comments"); await page.getByRole("button", { name: "Start task" }).click(); try { await page.getByText("Completed").waitFor({ timeout: 5_000 }); } catch { throw new Error(`Completion did not render; task reads=${taskReads}; body=${(await page.locator("body").innerText()).slice(0, 800)}`); } assert.ok(taskReads >= 1); await page.goto(`http://127.0.0.1:${address.port}/#/reviews`); await page.getByLabel("Correct sentiment for c1").selectOption("mixed"); await page.getByText(/Saved with audit history/).waitFor(); assert.equal(corrected, true); }
  finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
