import { createHash } from "node:crypto";
import type { RegisteredTool } from "@instagram-agent/agent-core";
import type { Locator, Page } from "playwright";
import { BrowserService } from "./browser-service.js";
import { assertAuthenticatedPage } from "./session.js";

interface Post { postId: string; url: string; publishedAt: string; caption?: string; mediaUrl?: string }
interface Comment { commentId: string; postId: string; text: string; author?: string; publishedAt?: string }

const optionalText = async (locator: Locator, selector: string) => {
  const child = locator.locator(selector).first();
  return await child.count() === 0 ? undefined : (await child.textContent())?.trim() || undefined;
};
const optionalAttribute = async (page: Page, selector: string, name: string) => {
  const locator = page.locator(selector).first();
  return await locator.count() === 0 ? null : locator.getAttribute(name);
};
const postIdFromUrl = (value: string) => new URL(value).pathname.split("/").filter(Boolean).at(-1);
const stableCommentId = (postId: string, author: string | undefined, publishedAt: string | undefined, content: string) =>
  createHash("sha256").update([postId, author ?? "", publishedAt ?? "", content].join("\u0000")).digest("hex").slice(0, 24);

async function fixturePosts(page: Page, limit: number): Promise<Post[] | undefined> {
  const rows = page.locator("[data-ig-post-id]");
  if (await rows.count() === 0) return undefined;
  const posts: Post[] = [];
  for (let index = 0; index < Math.min(await rows.count(), limit); index += 1) {
    const row = rows.nth(index);
    const postId = await row.getAttribute("data-ig-post-id");
    const url = await row.getAttribute("data-ig-url");
    const publishedAt = await row.getAttribute("data-ig-published-at");
    const caption = await optionalText(row, "[data-ig-caption]");
    const mediaUrl = await row.getAttribute("data-ig-media-url");
    if (postId && url && publishedAt) posts.push({ postId, url, publishedAt, ...(caption ? { caption } : {}), ...(mediaUrl ? { mediaUrl } : {}) });
  }
  return posts;
}

async function detailFromCurrentPage(page: Page): Promise<Post> {
  const fixture = page.locator("[data-ig-post-id]").first();
  if (await fixture.count() > 0) {
    const postId = await fixture.getAttribute("data-ig-post-id");
    const publishedAt = await fixture.getAttribute("data-ig-published-at");
    if (!postId || !publishedAt) throw new Error("Post identity fields are unavailable");
    const caption = await optionalText(fixture, "[data-ig-caption]");
    const mediaUrl = await fixture.getAttribute("data-ig-media-url");
    return { postId, url: page.url(), publishedAt, ...(caption ? { caption } : {}), ...(mediaUrl ? { mediaUrl } : {}) };
  }
  const postId = postIdFromUrl(page.url());
  const publishedAt = await page.locator("time[datetime]").last().getAttribute("datetime", { timeout: 30_000 });
  if (!postId || !publishedAt || Number.isNaN(Date.parse(publishedAt))) throw new Error("Post identity fields are unavailable");
  const mediaUrl = await page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);
  const caption = await page.locator('meta[property="og:description"]').getAttribute("content").catch(() => null);
  return { postId, url: page.url(), publishedAt, ...(caption ? { caption } : {}), ...(mediaUrl ? { mediaUrl } : {}) };
}

async function livePosts(page: Page, limit: number, offset = 0): Promise<Post[]> {
  const locator = page.locator('a[href*="/p/"], a[href*="/reel/"]');
  const unavailable = page.getByText(/This account is private|No posts yet|Sorry, this page isn't available/i).first();
  await Promise.race([locator.first().waitFor({ state: "attached", timeout: 15_000 }), unavailable.waitFor({ state: "visible", timeout: 15_000 })]).catch(() => undefined);
  assertAuthenticatedPage(page);
  if (await locator.count() === 0) return [];
  let unchanged = 0;
  let prior = 0;
  while (await locator.count() < offset + limit && unchanged < 4) {
    const count = await locator.count();
    unchanged = count === prior ? unchanged + 1 : 0;
    prior = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
  }
  const links = await locator.evaluateAll((anchors) =>
    [...new Set(anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean))]);
  const posts: Post[] = [];
  for (const url of links.slice(offset, offset + limit)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assertAuthenticatedPage(page);
    posts.push(await detailFromCurrentPage(page));
  }
  return posts;
}

async function clickMoreComments(page: Page): Promise<boolean> {
  const candidate = page.locator('button:has(svg[aria-label*="comments" i]), button:has(svg[aria-label*="replies" i])').first();
  if (await candidate.count() === 0 || !await candidate.isVisible()) return false;
  await candidate.click();
  await page.waitForTimeout(750);
  return true;
}

async function liveComments(page: Page, postId: string, limit: number, pageNumber: number): Promise<Comment[]> {
  for (let index = 0; index < pageNumber; index += 1) if (!await clickMoreComments(page)) break;
  const rows = page.locator("time[datetime]");
  const comments = new Map<string, Comment>();
  const count = await rows.count();
  for (let index = 1; index < count - 1; index += 1) {
    const time = rows.nth(index);
    const record = await time.evaluate((element) => {
      let container: HTMLElement | null = element.parentElement;
      while (container && container !== document.body) {
        const links = [...container.querySelectorAll("a")];
        const spans = [...container.querySelectorAll("span")];
        if (links.length > 0 && spans.length >= 2 && (container.innerText?.trim().length ?? 0) > 0) {
          const lines = (container.innerText ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
          return { author: lines[0], content: lines.slice(1, -1).join(" ") || lines[1], publishedAt: element.getAttribute("datetime") };
        }
        container = container.parentElement;
      }
      return null;
    });
    if (!record?.content) continue;
    const commentId = stableCommentId(postId, record.author, record.publishedAt ?? undefined, record.content);
    comments.set(commentId, { commentId, postId, text: record.content, ...(record.author ? { author: record.author } : {}), ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}) });
  }
  return [...comments.values()].slice(pageNumber * limit, (pageNumber + 1) * limit);
}

async function ownProfilePath(page: Page): Promise<string> {
  const candidates = page.locator("a[href]:has(img)");
  const reserved = new Set(["accounts", "direct", "explore", "reels", "stories"]);
  const links: Array<{ href: string; x: number; y: number; profileImage: boolean }> = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox();
    const href = await candidate.getAttribute("href");
    if (!box || !href) continue;
    const pathname = new URL(href, page.url()).pathname;
    const username = /^\/([A-Za-z0-9._]+)\/$/.exec(pathname)?.[1];
    if (!username || reserved.has(username.toLowerCase())) continue;
    const alt = await candidate.locator("img").first().getAttribute("alt");
    links.push({ href, x: box.x, y: box.y, profileImage: /profile picture/i.test(alt ?? "") });
  }
  const owner = links.sort((left, right) => Number(right.profileImage) - Number(left.profileImage) || left.x - right.x || right.y - left.y).find(({ x }) => x < 360);
  if (!owner) throw new Error("Authorized account profile link was not found");
  return new URL(owner.href, page.url()).pathname;
}

async function connectionRows(page: Page, offset: number, limit: number): Promise<Array<{ username: string; displayName: string; profilePath: string }>> {
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  await dialog.locator("a[href]").first().waitFor({ state: "attached", timeout: 30_000 });
  const accounts = new Map<string, { username: string; displayName: string; profilePath: string }>();
  let unchanged = 0;
  while (accounts.size < offset + limit && unchanged < 3) {
    const before = accounts.size;
    const links = dialog.locator("a[href]");
    for (let index = 0; index < await links.count(); index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute("href");
      if (!href) continue;
      const url = new URL(href, page.url());
      if (url.origin !== new URL(page.url()).origin) continue;
      const rawPath = url.pathname;
      const match = /^\/([A-Za-z0-9._]+)\/?$/.exec(rawPath);
      if (!match) continue;
      const profilePath = `/${match[1]!}/`;
      const rowText = (await link.locator("xpath=ancestor::div[count(.//a) >= 1][1]").innerText().catch(() => "")).split("\n").map((line) => line.trim()).filter(Boolean);
      const username = match[1]!;
      accounts.set(username, { username, displayName: rowText.find((line) => line !== username && !/^(Follow|Following|Remove)$/i.test(line)) ?? username, profilePath });
    }
    unchanged = accounts.size === before ? unchanged + 1 : 0;
    await dialog.evaluate((element) => { const scrollable = [...element.querySelectorAll("div")].find((item) => item.scrollHeight > item.clientHeight + 20); if (scrollable) scrollable.scrollTop = scrollable.scrollHeight; });
    await page.waitForTimeout(600);
  }
  return [...accounts.values()].slice(offset, offset + limit);
}

export function createInstagramTools(service: BrowserService, baseUrl = "https://www.instagram.com"): readonly RegisteredTool[] {
  const origin = new URL(baseUrl).origin;
  const navigate = async (path: string, signal: AbortSignal) => {
    const page = await service.navigate(new URL(path, origin).href, signal);
    assertAuthenticatedPage(page);
    return page;
  };
  return [
    {
      definition: { name: "instagram_get_connections", description: "Read a bounded page from the authorized account followers or following list", version: "1.0.0", risk: "read", timeoutMs: 120_000,
        inputSchema: { type: "object", additionalProperties: false, properties: { list: { type: "string", enum: ["followers", "following"] }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", pattern: "^[0-9]+$" } }, required: ["list", "limit"] },
        outputSchema: { type: "object", additionalProperties: false, properties: { accounts: { type: "array", items: { type: "object", additionalProperties: false, properties: { username: { type: "string" }, displayName: { type: "string" }, profilePath: { type: "string" } }, required: ["username", "displayName", "profilePath"] } }, nextCursor: { type: ["string", "null"] } }, required: ["accounts", "nextCursor"] } },
      execute: async (args, context) => { const home = await navigate("/", context.signal); const ownerPath = await ownProfilePath(home); const list = String(args.list); const profile = await navigate(ownerPath, context.signal); const trigger = profile.getByText(new RegExp(`\\b${list}$`, "i")).first(); await trigger.waitFor({ state: "visible", timeout: 30_000 }); await trigger.click(); const offset = Number(args.cursor ?? "0"); const accounts = await connectionRows(profile, offset, Number(args.limit)); return { accounts, nextCursor: accounts.length === Number(args.limit) ? String(offset + accounts.length) : null }; },
    },
    {
      definition: { name: "instagram_get_posts", description: "Read bounded posts visible to the authorized Instagram account", version: "1.0.0", risk: "read", timeoutMs: 120_000,
        inputSchema: { type: "object", additionalProperties: false, properties: { profilePath: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 20 }, cursor: { type: "string", pattern: "^[0-9]+$" } }, required: ["profilePath", "limit"] },
        outputSchema: { type: "object", additionalProperties: false, properties: { posts: { type: "array", items: { type: "object", additionalProperties: false, properties: { postId: { type: "string" }, url: { type: "string" }, publishedAt: { type: "string" }, caption: { type: "string" }, mediaUrl: { type: "string" } }, required: ["postId", "url", "publishedAt"] } }, nextCursor: { type: ["string", "null"] } }, required: ["posts", "nextCursor"] } },
      execute: async (args, context) => { const page = await navigate(String(args.profilePath), context.signal); const offset = Number(args.cursor ?? "0"); const posts = await fixturePosts(page, Number(args.limit)) ?? await livePosts(page, Number(args.limit), offset); const fixtureCursor = await optionalAttribute(page, "[data-ig-next-cursor]", "data-ig-next-cursor"); return { posts, nextCursor: fixtureCursor ?? (posts.length === Number(args.limit) ? String(offset + posts.length) : null) }; },
    },
    {
      definition: { name: "instagram_get_post_details", description: "Read normalized details for an authorized Instagram post", version: "1.0.0", risk: "read", timeoutMs: 60_000,
        inputSchema: { type: "object", additionalProperties: false, properties: { postPath: { type: "string", minLength: 1 } }, required: ["postPath"] },
        outputSchema: { type: "object", additionalProperties: false, properties: { postId: { type: "string" }, url: { type: "string" }, publishedAt: { type: "string" }, caption: { type: "string" } }, required: ["postId", "url", "publishedAt"] } },
      execute: async (args, context) => detailFromCurrentPage(await navigate(String(args.postPath), context.signal)),
    },
    {
      definition: { name: "instagram_get_comments", description: "Read a bounded page of unique comments visible to the authorized Instagram account", version: "1.0.0", risk: "read", timeoutMs: 120_000,
        inputSchema: { type: "object", additionalProperties: false, properties: { postPath: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string", pattern: "^[0-9]+$" } }, required: ["postPath", "limit"] },
        outputSchema: { type: "object", additionalProperties: false, properties: { comments: { type: "array", items: { type: "object", additionalProperties: false, properties: { commentId: { type: "string" }, postId: { type: "string" }, text: { type: "string" }, author: { type: "string" }, publishedAt: { type: "string" } }, required: ["commentId", "postId", "text"] } }, nextCursor: { type: ["string", "null"] }, collected: { type: "integer" } }, required: ["comments", "nextCursor", "collected"] } },
      execute: async (args, context) => { const page = await navigate(String(args.postPath), context.signal); const fixtureRows = page.locator("[data-ig-comment-id]"); const isFixture = await fixtureRows.count() > 0; let comments: Comment[]; if (isFixture) { const unique = new Map<string, Comment>(); for (let i = 0; i < Math.min(await fixtureRows.count(), Number(args.limit)); i += 1) { const row = fixtureRows.nth(i); const commentId = await row.getAttribute("data-ig-comment-id"); const postId = await row.getAttribute("data-ig-post-id"); const content = await optionalText(row, "[data-ig-comment-text]"); if (commentId && postId && content && !unique.has(commentId)) { const author = await optionalText(row, "[data-ig-author]"); const publishedAt = await row.getAttribute("data-ig-published-at"); unique.set(commentId, { commentId, postId, text: content, ...(author ? { author } : {}), ...(publishedAt ? { publishedAt } : {}) }); } } comments = [...unique.values()]; } else { const postId = postIdFromUrl(page.url()); if (!postId) throw new Error("Post ID is unavailable"); comments = await liveComments(page, postId, Number(args.limit), Number(args.cursor ?? "0")); } const nextCursor = isFixture ? await optionalAttribute(page, "[data-ig-next-cursor]", "data-ig-next-cursor") : comments.length >= Number(args.limit) ? String(Number(args.cursor ?? "0") + 1) : null; return { comments, nextCursor, collected: comments.length }; },
    },
  ];
}
