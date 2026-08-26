import { createStarterTools, redact, ToolRegistry } from "@instagram-agent/agent-core";
import type { ToolDefinition } from "@instagram-agent/contracts";
import { fromJsonSchema, McpServer, type JSONObject } from "@modelcontextprotocol/server";

const INVOCATION_META_KEY = "com.instagram-agent/invocation-id";

export function buildStarterRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  createStarterTools().tools.forEach((tool) => registry.register(tool));
  return registry;
}

function annotations(definition: ToolDefinition) {
  return {
    readOnlyHint: definition.risk === "read",
    destructiveHint: definition.risk === "prohibited",
    idempotentHint: definition.risk !== "write",
    openWorldHint: false,
  };
}

export async function buildMcpServer(registry = buildStarterRegistry(), onInvocation: (record: Readonly<Record<string, unknown>>) => void = () => {}): Promise<McpServer> {
  const server = new McpServer({ name: "instagram-agent-tools", version: "0.1.0" }, { capabilities: { tools: {} } });
  const tools = await registry.listTools("local-mcp-user");
  for (const definition of tools) {
    if (definition.risk === "prohibited") continue;
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: fromJsonSchema(definition.inputSchema),
        outputSchema: fromJsonSchema(definition.outputSchema),
        annotations: annotations(definition),
        _meta: {
          "com.instagram-agent/version": definition.version,
          "com.instagram-agent/risk": definition.risk,
          "com.instagram-agent/timeout-ms": definition.timeoutMs,
        },
      },
      async (arguments_, context) => {
        const started = Date.now();
        const meta = context.mcpReq._meta as Record<string, unknown> | undefined;
        const invocationId = typeof meta?.[INVOCATION_META_KEY] === "string" ? meta[INVOCATION_META_KEY] : crypto.randomUUID();
        const observation = await registry.invoke("local-mcp-user", { invocationId, name: definition.name, arguments: arguments_ as Record<string, unknown> });
        onInvocation(redact({ component: "mcp-server", event: "tool.invocation", invocationId, tool: definition.name, durationMs: Date.now() - started, status: observation.ok ? "succeeded" : "failed", retry: observation.error?.retryable ? 1 : 0, arguments: arguments_, observation }));
        if (!observation.ok) {
          const error = observation.error ?? { code: "unknown", message: "Unknown tool failure", retryable: false };
          return { isError: true, content: [{ type: "text", text: JSON.stringify(error) }] };
        }
        const structuredContent = observation.value as JSONObject;
        return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
      },
    );
  }
  return server;
}

export const invocationMetaKey = INVOCATION_META_KEY;
