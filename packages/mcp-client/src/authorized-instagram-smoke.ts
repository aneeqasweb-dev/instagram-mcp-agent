import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { McpToolGateway } from "./mcp-tool-gateway.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const gateway = new McpToolGateway({
  transportFactory: () => new StdioClientTransport({
    command: path.join(projectRoot, "node_modules", ".bin", "tsx"),
    args: [path.join(projectRoot, "packages", "mcp-server", "src", "stdio.ts")],
    cwd: projectRoot,
    stderr: "pipe",
    env: {
      ...process.env as Record<string, string>,
      MCP_INSTAGRAM_ENABLED: "true",
      INSTAGRAM_ALLOWED_ORIGIN: "https://www.instagram.com",
      INSTAGRAM_STORAGE_STATE_PATH: path.join(projectRoot, "playwright", ".auth", "instagram.json"),
      PLAYWRIGHT_EXECUTABLE_PATH: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/usr/bin/google-chrome",
      PLAYWRIGHT_HEADLESS: "false",
    },
  }),
});

try {
  const definitions = await gateway.listTools("authorized-local-user");
  const required = ["instagram_get_connections", "instagram_get_posts", "instagram_get_post_details", "instagram_get_comments"];
  if (!required.every((name) => definitions.some((definition) => definition.name === name))) throw new Error("Instagram MCP tools are not registered");
  const connectionsResult = await gateway.invoke("authorized-local-user", { invocationId: crypto.randomUUID(), name: "instagram_get_connections", arguments: { list: "following", limit: 3 } });
  if (!connectionsResult.ok) throw new Error(`Following-list smoke failed: ${connectionsResult.error?.code ?? "unknown"}: ${connectionsResult.error?.message ?? "no detail"}`);
  const connections = (connectionsResult.value as { accounts: unknown[] }).accounts;
  if (connections.length === 0) throw new Error("No authorized following accounts were returned through MCP");
  const postsResult = await gateway.invoke("authorized-local-user", { invocationId: crypto.randomUUID(), name: "instagram_get_posts", arguments: { profilePath: "/", limit: 4 } });
  if (!postsResult.ok) throw new Error(`Post smoke failed: ${postsResult.error?.code ?? "unknown"}`);
  const posts = (postsResult.value as { posts: Array<{ postId: string; url: string; publishedAt: string }> }).posts;
  if (posts.length === 0) throw new Error("No authorized posts were returned through MCP");
  const detailResult = await gateway.invoke("authorized-local-user", { invocationId: crypto.randomUUID(), name: "instagram_get_post_details", arguments: { postPath: new URL(posts[0]!.url).pathname } });
  if (!detailResult.ok) throw new Error(`Post detail smoke failed: ${detailResult.error?.code ?? "unknown"}`);
  let commentsVerified = false;
  let collectedComments = 0;
  let paginationValidated = false;
  let paginationApplicable = false;
  for (const post of posts) {
    const result = await gateway.invoke("authorized-local-user", { invocationId: crypto.randomUUID(), name: "instagram_get_comments", arguments: { postPath: new URL(post.url).pathname, limit: 2 } });
    if (!result.ok) continue;
    const value = result.value as { comments: unknown[]; collected: number; nextCursor: string | null };
    if (value.comments.length > 0) {
      commentsVerified = true;
      collectedComments = value.collected;
      if (value.nextCursor) {
        paginationApplicable = true;
        const second = await gateway.invoke("authorized-local-user", { invocationId: crypto.randomUUID(), name: "instagram_get_comments", arguments: { postPath: new URL(post.url).pathname, limit: 2, cursor: value.nextCursor } });
        if (!second.ok) throw new Error(`Comment pagination smoke failed: ${second.error?.code ?? "unknown"}`);
        const firstIds = new Set((value.comments as Array<{ commentId: string }>).map(({ commentId }) => commentId));
        const secondComments = (second.value as { comments: Array<{ commentId: string }> }).comments;
        paginationValidated = secondComments.every(({ commentId }) => !firstIds.has(commentId));
      }
      break;
    }
  }
  if (!commentsVerified) throw new Error("No accessible loaded comment was returned through MCP from the bounded post sample");
  if (paginationApplicable && !paginationValidated) throw new Error("Instagram offered a continuation cursor, but a distinct second comment page was not verified");
  process.stdout.write(`${JSON.stringify({ mcpToolsRegistered: true, followingAccountsReturned: connections.length, postsReturned: posts.length, detailsValidated: true, commentsReturned: collectedComments, paginationValidated: paginationApplicable ? paginationValidated : "not_applicable", privateContentLogged: false })}\n`);
} finally { await gateway.close(); }
