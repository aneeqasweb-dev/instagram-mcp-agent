import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const handle = serveStdio(() => {
  const server = new McpServer({ name: "mcp-test-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.registerTool("slow_tool", {
    description: "A deliberately slow test tool",
    inputSchema: z.object({}), outputSchema: z.object({ done: z.boolean() }),
    _meta: { "com.instagram-agent/version": "1.0.0", "com.instagram-agent/risk": "read", "com.instagram-agent/timeout-ms": 10 },
  }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return { content: [{ type: "text", text: "done" }], structuredContent: { done: true } };
  });
  server.registerTool("cancellable_tool", {
    description: "A cancellable test tool",
    inputSchema: z.object({}), outputSchema: z.object({ done: z.boolean() }),
    _meta: { "com.instagram-agent/version": "1.0.0", "com.instagram-agent/risk": "read", "com.instagram-agent/timeout-ms": 2_000 },
  }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return { content: [{ type: "text", text: "done" }], structuredContent: { done: true } };
  });
  server.registerTool("bad_output", {
    description: "A test tool returning output that violates its contract",
    inputSchema: z.object({}), outputSchema: z.object({ valid: z.boolean() }),
    _meta: { "com.instagram-agent/version": "1.0.0", "com.instagram-agent/risk": "read", "com.instagram-agent/timeout-ms": 1_000 },
  }, async () => ({ content: [{ type: "text", text: "invalid" }], structuredContent: { valid: "wrong" } as never }));
  return server;
});

const shutdown = async () => { await handle.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
