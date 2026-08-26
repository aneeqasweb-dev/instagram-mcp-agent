import type { ToolDefinition, ToolGateway, ToolInvocation, ToolObservation, UserId } from "@instagram-agent/contracts";
import { Client, SdkError, type Tool, type Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";

const INVOCATION_META_KEY = "com.instagram-agent/invocation-id";

export type TransportFactory = () => Transport;

export interface McpToolGatewayOptions {
  readonly transportFactory: TransportFactory;
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly maximumPayloadBytes?: number;
  readonly defaultTimeoutMs?: number;
}

interface CachedInvocation {
  readonly fingerprint: string;
  readonly observation: ToolObservation;
}

export class McpGatewayError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpGatewayError";
  }
}

function customMeta(tool: Tool): Record<string, unknown> {
  return (tool._meta ?? {}) as Record<string, unknown>;
}

function risk(tool: Tool): ToolDefinition["risk"] {
  const value = customMeta(tool)["com.instagram-agent/risk"];
  if (value === "read" || value === "write" || value === "sensitive" || value === "prohibited") return value;
  return tool.annotations?.readOnlyHint ? "read" : "write";
}

function toDefinition(tool: Tool, defaultTimeoutMs: number): ToolDefinition {
  const meta = customMeta(tool);
  const timeout = meta["com.instagram-agent/timeout-ms"];
  return {
    name: tool.name,
    version: typeof meta["com.instagram-agent/version"] === "string" ? meta["com.instagram-agent/version"] : "1.0.0",
    description: tool.description ?? tool.name,
    inputSchema: tool.inputSchema as Record<string, unknown>,
    outputSchema: (tool.outputSchema ?? {}) as Record<string, unknown>,
    risk: risk(tool),
    timeoutMs: typeof timeout === "number" && Number.isSafeInteger(timeout) && timeout > 0 ? timeout : defaultTimeoutMs,
  };
}

function errorText(content: readonly unknown[]): string {
  for (const item of content) {
    if (typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string") return item.text;
  }
  return "MCP tool returned an error";
}

function normalizeError(invocationId: string, error: unknown): ToolObservation {
  if (error instanceof McpGatewayError) return { invocationId, ok: false, error: { code: error.code, message: error.message, retryable: error.retryable } };
  if (error instanceof DOMException && error.name === "AbortError") return { invocationId, ok: false, error: { code: "mcp_cancelled", message: "MCP invocation was cancelled", retryable: false } };
  if (error instanceof SdkError) {
    const timeout = String(error.code).toLowerCase().includes("timeout");
    return { invocationId, ok: false, error: { code: timeout ? "mcp_timeout" : "mcp_protocol_error", message: error.message, retryable: timeout } };
  }
  return { invocationId, ok: false, error: { code: "mcp_connection_error", message: error instanceof Error ? error.message : "Unknown MCP error", retryable: true } };
}

export class McpToolGateway implements ToolGateway {
  readonly #options: Required<Omit<McpToolGatewayOptions, "transportFactory">> & Pick<McpToolGatewayOptions, "transportFactory">;
  readonly #cache = new Map<string, CachedInvocation>();
  #client: Client | null = null;
  #transport: Transport | null = null;

  constructor(options: McpToolGatewayOptions) {
    this.#options = {
      ...options,
      clientName: options.clientName ?? "instagram-agent-harness",
      clientVersion: options.clientVersion ?? "0.1.0",
      maximumPayloadBytes: options.maximumPayloadBytes ?? 1_000_000,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30_000,
    };
  }

  get connected(): boolean { return this.#client !== null; }

  async connect(): Promise<void> {
    if (this.#client) return;
    const client = new Client({ name: this.#options.clientName, version: this.#options.clientVersion });
    const transport = this.#options.transportFactory();
    try {
      await client.connect(transport);
      this.#client = client;
      this.#transport = transport;
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw new McpGatewayError("mcp_connect_failed", error instanceof Error ? error.message : "MCP connection failed", true, { cause: error });
    }
  }

  async reconnect(): Promise<void> { await this.close(); await this.connect(); }

  async close(): Promise<void> {
    const client = this.#client;
    const transport = this.#transport;
    this.#client = null;
    this.#transport = null;
    if (client) await client.close().catch(() => undefined);
    else if (transport) await transport.close().catch(() => undefined);
  }

  async listTools(_userId: UserId): Promise<readonly ToolDefinition[]> {
    await this.connect();
    try {
      const result = await this.#client!.listTools(undefined, { timeout: this.#options.defaultTimeoutMs, cacheMode: "refresh" });
      return result.tools.map((tool) => toDefinition(tool, this.#options.defaultTimeoutMs));
    } catch (error) {
      throw new McpGatewayError("mcp_discovery_failed", error instanceof Error ? error.message : "MCP tool discovery failed", true, { cause: error });
    }
  }

  async invoke(_userId: UserId, invocation: ToolInvocation, signal?: AbortSignal): Promise<ToolObservation> {
    const fingerprint = JSON.stringify({ name: invocation.name, arguments: invocation.arguments });
    const cached = this.#cache.get(invocation.invocationId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return normalizeError(invocation.invocationId, new McpGatewayError("invocation_id_conflict", "Invocation ID was reused with different tool input", false));
      return structuredClone(cached.observation);
    }
    if (Buffer.byteLength(fingerprint) > this.#options.maximumPayloadBytes) return normalizeError(invocation.invocationId, new McpGatewayError("mcp_payload_too_large", "MCP tool input exceeds the configured payload limit", false));
    try {
      await this.connect();
      const tools = await this.listTools(_userId);
      const definition = tools.find(({ name }) => name === invocation.name);
      if (!definition) throw new McpGatewayError("mcp_tool_not_found", `MCP tool '${invocation.name}' is unavailable`, false);
      const result = await this.#client!.callTool(
        { name: invocation.name, arguments: invocation.arguments, _meta: { [INVOCATION_META_KEY]: invocation.invocationId } },
        { ...(signal ? { signal } : {}), timeout: definition.timeoutMs, maxTotalTimeout: definition.timeoutMs },
      );
      let observation: ToolObservation;
      if (result.isError) {
        let parsed: { code?: string; message?: string; retryable?: boolean } = {};
        const text = errorText(result.content);
        try { parsed = JSON.parse(text) as typeof parsed; } catch { parsed = { message: text }; }
        const fallbackCode = /invalid|validat/i.test(parsed.message ?? text) ? "mcp_validation_error" : "mcp_tool_error";
        observation = { invocationId: invocation.invocationId, ok: false, error: { code: parsed.code ?? fallbackCode, message: parsed.message ?? text, retryable: parsed.retryable ?? false } };
      } else {
        const value = result.structuredContent;
        const encoded = JSON.stringify(value);
        if (encoded === undefined || Buffer.byteLength(encoded) > this.#options.maximumPayloadBytes) throw new McpGatewayError("mcp_payload_too_large", "MCP tool output exceeds the configured payload limit", false);
        observation = { invocationId: invocation.invocationId, ok: true, value };
      }
      this.#cache.set(invocation.invocationId, { fingerprint, observation: structuredClone(observation) });
      return observation;
    } catch (error) {
      if (signal?.aborted) return normalizeError(invocation.invocationId, new DOMException("MCP invocation was cancelled", "AbortError"));
      return normalizeError(invocation.invocationId, error);
    }
  }
}

export function createLocalStdioTransport(parameters?: Partial<StdioServerParameters>): StdioClientTransport {
  const serverEntry = fileURLToPath(new URL("../../mcp-server/dist/stdio.js", import.meta.url));
  return new StdioClientTransport({ command: process.execPath, args: [serverEntry], stderr: "pipe", ...parameters });
}
