import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { MongoClient } from "mongodb";
import { createDatabaseTools, migrateDatabase } from "@instagram-agent/mongodb-adapter";
import { BrowserService, createInstagramTools } from "@instagram-agent/playwright-adapter";
import { buildMcpServer, buildStarterRegistry } from "./server.js";

const log = (level: "info" | "error", message: string) => process.stderr.write(`${JSON.stringify({ level, component: "mcp-server", message, at: new Date().toISOString() })}\n`);

let mongoClient: MongoClient | undefined;
let browserService: BrowserService | undefined;

const buildConfiguredServer = async () => {
  const registry = buildStarterRegistry();
  if (process.env.MCP_DATABASE_ENABLED === "true") {
    mongoClient = new MongoClient(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/instagram_agent");
    await mongoClient.connect();
    const db = mongoClient.db();
    await migrateDatabase(db);
    createDatabaseTools(db).forEach((tool) => registry.register(tool));
    log("info", "MongoDB MCP tools registered");
  }
  if (process.env.MCP_INSTAGRAM_ENABLED === "true") {
    const allowedOrigin = process.env.INSTAGRAM_ALLOWED_ORIGIN ?? "https://www.instagram.com";
    browserService = new BrowserService({
      allowedOrigins: [allowedOrigin],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      ...(process.env.INSTAGRAM_STORAGE_STATE_PATH ? { storageStatePath: process.env.INSTAGRAM_STORAGE_STATE_PATH } : {}),
      screenshotDirectory: process.env.PLAYWRIGHT_ERROR_SCREENSHOT_DIR ?? "playwright/errors",
      headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
    });
    createInstagramTools(browserService, allowedOrigin).forEach((tool) => registry.register(tool));
    log("info", "Authorized Instagram MCP tools registered");
  }
  return buildMcpServer(registry, (record) => process.stderr.write(`${JSON.stringify({ level: record.status === "failed" ? "error" : "info", ...record, at: new Date().toISOString() })}\n`));
};

const handle = serveStdio(buildConfiguredServer, {
  onerror: (error) => log("error", error.message),
});

log("info", "MCP stdio server ready");

const shutdown = async () => {
  log("info", "MCP stdio server stopping");
  await handle.close();
  await browserService?.stop();
  await mongoClient?.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
