import { chmod, stat } from "node:fs/promises";
import type { Page } from "playwright";
import { ToolValidationError } from "@instagram-agent/agent-core";
import { BrowserService } from "./browser-service.js";

export class AuthenticationRequiredError extends ToolValidationError {
  constructor(message = "Instagram session is missing or expired; interactive user authentication is required") {
    super("authentication_required", message, false); this.name = "AuthenticationRequiredError";
  }
}

export interface SessionBootstrapOptions {
  readonly loginUrl: string;
  readonly storageStatePath: string;
  readonly waitForAuthorized: (page: Page) => Promise<boolean>;
}

export async function bootstrapAuthorizedSession(service: BrowserService, options: SessionBootstrapOptions): Promise<void> {
  const page = await service.navigate(options.loginUrl);
  if (!await options.waitForAuthorized(page)) throw new AuthenticationRequiredError("Login was not completed by the user");
  await service.saveStorageState(options.storageStatePath);
  await chmod(options.storageStatePath, 0o600);
}

export async function verifyProtectedStorageState(path: string): Promise<void> {
  const info = await stat(path);
  if ((info.mode & 0o077) !== 0) throw new Error("Browser storage state must not be accessible by group or other users");
}

export function assertAuthenticatedPage(page: Page, loginPath = "/accounts/login"): void {
  if (new URL(page.url()).pathname.startsWith(loginPath)) throw new AuthenticationRequiredError();
}
