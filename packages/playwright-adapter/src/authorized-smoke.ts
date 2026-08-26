import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BrowserService } from "./browser-service.js";
import { assertAuthenticatedPage, verifyProtectedStorageState } from "./session.js";

const origin = process.env.INSTAGRAM_ALLOWED_ORIGIN ?? "https://www.instagram.com";
const storageStatePath = process.env.INSTAGRAM_STORAGE_STATE_PATH ?? fileURLToPath(new URL("../../../playwright/.auth/instagram.json", import.meta.url));
const screenshotDirectory = fileURLToPath(new URL("../../../playwright/errors", import.meta.url));
const candidates = [process.env.PLAYWRIGHT_EXECUTABLE_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"].filter((value): value is string => Boolean(value));
let executablePath: string | undefined;
for (const candidate of candidates) if (await access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }

await verifyProtectedStorageState(storageStatePath);
const service = new BrowserService({ allowedOrigins: [origin], storageStatePath, headless: false, slowMoMs: 300, screenshotDirectory, ...(executablePath ? { executablePath } : {}) });
try {
  const home = await service.navigate(new URL("/", origin).href);
  assertAuthenticatedPage(home);
  const postLinks = home.locator('a[href*="/p/"], a[href*="/reel/"]');
  await postLinks.first().waitFor({ state: "attached", timeout: 30_000 });
  assertAuthenticatedPage(home);
  const links = await postLinks.evaluateAll((anchors) => [...new Set(anchors.map((anchor) => (anchor as HTMLAnchorElement).href).filter(Boolean))]);
  if (links.length === 0) throw new Error("Authorized home loaded, but no accessible post or reel link was found");
  const target = service.assertAllowedUrl(links[0]!);
  const post = await service.navigate(target.href);
  assertAuthenticatedPage(post);
  await post.waitForTimeout(2_000);
  const id = target.pathname.split("/").filter(Boolean).at(-1);
  const publishedAt = await post.locator("time[datetime]").first().getAttribute("datetime", { timeout: 10_000 });
  if (!id || !publishedAt || Number.isNaN(Date.parse(publishedAt))) throw new Error("Post identity or timestamp could not be normalized");
  process.stdout.write(`${JSON.stringify({ authenticated: true, accessiblePostLinks: links.length, normalizedPostId: true, normalizedTimestamp: true, allowedOrigin: target.origin })}\n`);
  await post.waitForTimeout(3_000);
} catch (error) {
  const screenshot = await service.screenshotOnError("authorized-smoke");
  throw new Error(`${error instanceof Error ? error.message : "Authorized smoke test failed"}${screenshot ? `; screenshot: ${screenshot}` : ""}`, { cause: error });
} finally { await service.stop(); }
