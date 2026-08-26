import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { ToolRegistry } from "@instagram-agent/agent-core";
import { BrowserPolicyError, BrowserService } from "./browser-service.js";
import { createInstagramTools } from "./instagram-tools.js";
import { assertAuthenticatedPage, AuthenticationRequiredError, bootstrapAuthorizedSession, verifyProtectedStorageState } from "./session.js";

let server: Server;
let origin: string;
let temporaryDirectory: string;

const fixture = `<!doctype html><html><body>
<h1 id="ready">Fixture ready</h1>
<article data-ig-post-id="post-1" data-ig-url="/p/post-1" data-ig-published-at="2026-08-20T10:00:00Z" data-ig-like-count="12"><span data-ig-caption>First post</span></article>
<article data-ig-post-id="post-2" data-ig-url="/p/post-2" data-ig-published-at="2026-08-21T10:00:00Z"></article>
<div data-ig-comment-id="comment-1" data-ig-post-id="post-1" data-ig-published-at="2026-08-22T10:00:00Z"><span data-ig-comment-text>Needs work</span><span data-ig-author>person</span></div>
<div data-ig-comment-id="comment-1" data-ig-post-id="post-1"><span data-ig-comment-text>Duplicate</span></div>
<div data-ig-comment-id="comment-2" data-ig-post-id="post-1"><span data-ig-comment-text>Helpful</span></div>
<span data-ig-next-cursor="page-2"></span>
</body></html>`;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "instagram-playwright-"));
  server = createServer((request, response) => {
    if (request.url?.startsWith("/slow")) return setTimeout(() => { response.end(fixture); }, 250);
    response.setHeader("content-type", "text/html");
    if (request.url?.startsWith("/empty")) return response.end("<!doctype html><html><body><h1>No posts yet</h1></body></html>");
    response.end(fixture);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(temporaryDirectory, { recursive: true, force: true });
});

function service(overrides: Partial<ConstructorParameters<typeof BrowserService>[0]> = {}) {
  return new BrowserService({ allowedOrigins: [origin], executablePath: "/usr/bin/google-chrome", screenshotDirectory: join(temporaryDirectory, "screens"), ...overrides });
}

test("manages repeated browser lifecycle and extracts local fixture content", async () => {
  const browser = service();
  await browser.navigate(origin);
  assert.equal(browser.running, true);
  assert.equal(await browser.extractText("#ready"), "Fixture ready");
  await browser.stop();
  assert.equal(browser.running, false);
  await browser.start();
  await browser.stop();
  assert.equal(browser.running, false);
});

test("blocks disallowed origins and unsafe protocols before navigation", async () => {
  const browser = service();
  assert.throws(() => browser.assertAllowedUrl("https://example.com"), BrowserPolicyError);
  assert.throws(() => browser.assertAllowedUrl("file:///etc/passwd"), BrowserPolicyError);
  assert.throws(() => browser.assertAllowedUrl("javascript:alert(1)"), BrowserPolicyError);
  await browser.stop();
});

test("bounds navigation and captures selector failures", async () => {
  const slowBrowser = service({ navigationTimeoutMs: 30 });
  await assert.rejects(slowBrowser.navigate(`${origin}/slow`), /Timeout/i);
  await slowBrowser.stop();
  const browser = service();
  try {
    await browser.navigate(origin);
    await assert.rejects(browser.extractText("#missing", 20));
    const screenshots = await readdir(join(temporaryDirectory, "screens"));
    assert.ok((await readFile(join(temporaryDirectory, "screens", screenshots[0]!))).length > 0);
  } finally { await browser.stop(); }
});

test("bootstraps user-authorized state with restrictive permissions and detects login pages", async () => {
  const statePath = join(temporaryDirectory, "auth", "state.json");
  const browser = service({ storageStatePath: statePath });
  try {
    await bootstrapAuthorizedSession(browser, { loginUrl: origin, storageStatePath: statePath, waitForAuthorized: async (page) => (await page.locator("#ready").count()) === 1 });
    await verifyProtectedStorageState(statePath);
    assert.equal((await stat(statePath)).mode & 0o077, 0);
    const page = await browser.navigate(`${origin}/accounts/login`);
    assert.throws(() => assertAuthenticatedPage(page), AuthenticationRequiredError);
  } finally { await browser.stop(); }
});

test("normalizes bounded posts, optional post details, and unique paginated comments", async () => {
  const browser = service();
  const registry = new ToolRegistry();
  try {
    createInstagramTools(browser, origin).forEach((tool) => registry.register(tool));
    const posts = await registry.invoke("user-1", { invocationId: "posts-1", name: "instagram_get_posts", arguments: { profilePath: "/profile", limit: 1 } });
    assert.equal(posts.ok, true);
    assert.equal((posts.value as { posts: unknown[] }).posts.length, 1);
    const empty = await registry.invoke("user-1", { invocationId: "posts-empty", name: "instagram_get_posts", arguments: { profilePath: "/empty", limit: 1 } });
    assert.equal(empty.ok, true);
    assert.deepEqual((empty.value as { posts: unknown[] }).posts, []);
    const details = await registry.invoke("user-1", { invocationId: "details-1", name: "instagram_get_post_details", arguments: { postPath: "/p/post-1" } });
    assert.deepEqual(details.value, { postId: "post-1", url: `${origin}/p/post-1`, publishedAt: "2026-08-20T10:00:00Z", caption: "First post" });
    const comments = await registry.invoke("user-1", { invocationId: "comments-1", name: "instagram_get_comments", arguments: { postPath: "/p/post-1", limit: 10 } });
    assert.equal(comments.ok, true, JSON.stringify(comments));
    assert.equal((comments.value as { comments: unknown[] }).comments.length, 2);
    assert.equal((comments.value as { nextCursor: string }).nextCursor, "page-2");
    const expired = await registry.invoke("user-1", { invocationId: "expired-1", name: "instagram_get_posts", arguments: { profilePath: "/accounts/login", limit: 1 } });
    assert.equal(expired.error?.code, "authentication_required");
  } finally { await browser.stop(); }
});
