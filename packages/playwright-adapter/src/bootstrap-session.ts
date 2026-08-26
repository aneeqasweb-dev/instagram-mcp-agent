import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BrowserService } from "./browser-service.js";
import { bootstrapAuthorizedSession } from "./session.js";

const origin = process.env.INSTAGRAM_ALLOWED_ORIGIN ?? "https://www.instagram.com";
const storageStatePath = process.env.INSTAGRAM_STORAGE_STATE_PATH ?? fileURLToPath(new URL("../../../playwright/.auth/instagram.json", import.meta.url));
const executableCandidates = [process.env.PLAYWRIGHT_EXECUTABLE_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"].filter((value): value is string => Boolean(value));
let executablePath: string | undefined;
for (const candidate of executableCandidates) {
  if (await access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }
}
const service = new BrowserService({
  allowedOrigins: [origin],
  storageStatePath,
  headless: false,
  ...(executablePath ? { executablePath } : {}),
});
const terminal = createInterface({ input: stdin, output: stdout });

try {
  await bootstrapAuthorizedSession(service, {
    loginUrl: new URL("/accounts/login/", origin).href,
    storageStatePath,
    waitForAuthorized: async (page) => {
      await terminal.question("Complete login in the opened browser. Press Enter here only after Instagram shows the authorized account. ");
      return !new URL(page.url()).pathname.startsWith("/accounts/login");
    },
  });
  stdout.write(`Authorized browser state saved locally at ${storageStatePath}\n`);
} finally {
  terminal.close();
  await service.stop();
}
