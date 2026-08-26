import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserServiceOptions {
  readonly allowedOrigins: readonly string[];
  readonly executablePath?: string;
  readonly storageStatePath?: string;
  readonly headless?: boolean;
  readonly navigationTimeoutMs?: number;
  readonly screenshotDirectory?: string;
  readonly slowMoMs?: number;
}

export class BrowserPolicyError extends Error {
  constructor(message: string) { super(message); this.name = "BrowserPolicyError"; }
}

export class BrowserService {
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #options: BrowserServiceOptions;
  #browser: Browser | undefined;
  #context: BrowserContext | undefined;
  #page: Page | undefined;

  constructor(options: BrowserServiceOptions) {
    this.#options = options;
    this.#allowedOrigins = new Set(options.allowedOrigins.map((origin) => new URL(origin).origin));
    if (this.#allowedOrigins.size === 0) throw new Error("At least one allowed browser origin is required");
  }

  get running(): boolean { return this.#browser?.isConnected() === true; }

  async start(): Promise<Page> {
    if (this.#page && !this.#page.isClosed()) return this.#page;
    this.#browser = await chromium.launch({
      headless: this.#options.headless ?? true,
      slowMo: this.#options.slowMoMs ?? 0,
      ...(this.#options.executablePath ? { executablePath: this.#options.executablePath } : {}),
    });
    const storageStatePath = this.#options.storageStatePath;
    const storageStateExists = storageStatePath
      ? await access(storageStatePath).then(() => true, () => false)
      : false;
    this.#context = await this.#browser.newContext(storageStateExists ? { storageState: storageStatePath! } : {});
    this.#page = await this.#context.newPage();
    this.#page.setDefaultNavigationTimeout(this.#options.navigationTimeoutMs ?? 30_000);
    return this.#page;
  }

  assertAllowedUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new BrowserPolicyError(`Protocol '${url.protocol}' is not allowed`);
    if (!this.#allowedOrigins.has(url.origin)) throw new BrowserPolicyError(`Origin '${url.origin}' is not allowed`);
    return url;
  }

  async navigate(value: string, signal?: AbortSignal): Promise<Page> {
    const url = this.assertAllowedUrl(value);
    const page = await this.start();
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: this.#options.navigationTimeoutMs ?? 30_000 });
    signal?.throwIfAborted();
    return page;
  }

  async extractText(selector: string, timeoutMs = 5_000): Promise<string> {
    const page = await this.start();
    try {
      const text = await page.locator(selector).first().textContent({ timeout: timeoutMs });
      if (text === null) throw new Error(`Selector '${selector}' has no text`);
      return text.trim();
    } catch (error) {
      await this.screenshotOnError("extract");
      throw error;
    }
  }

  async screenshotOnError(label: string): Promise<string | undefined> {
    if (!this.#page || !this.#options.screenshotDirectory) return undefined;
    await mkdir(this.#options.screenshotDirectory, { recursive: true, mode: 0o700 });
    const safeLabel = label.replace(/[^a-z0-9_-]/gi, "-");
    const path = `${this.#options.screenshotDirectory}/${Date.now()}-${safeLabel}.png`;
    await this.#page.screenshot({ path, fullPage: true });
    return path;
  }

  async saveStorageState(path = this.#options.storageStatePath): Promise<void> {
    if (!path) throw new Error("A storage-state path is required");
    if (!this.#context) throw new Error("Browser service is not running");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await this.#context.storageState({ path });
  }

  async stop(): Promise<void> {
    const context = this.#context;
    const browser = this.#browser;
    this.#page = undefined;
    this.#context = undefined;
    this.#browser = undefined;
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
