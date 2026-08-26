import assert from "node:assert/strict";
import test from "node:test";
import type { ToolGateway, ToolInvocation, ToolObservation } from "@instagram-agent/contracts";
import { FollowingCommentsCollector } from "./following-comments.js";
import { buildApi } from "./index.js";
import { InMemoryApiStore, StaticAuthenticator } from "./platform.js";

class FakeGateway implements ToolGateway {
  calls: ToolInvocation[] = [];
  async listTools() { return []; }
  async invoke(_userId: string, invocation: ToolInvocation): Promise<ToolObservation> {
    this.calls.push(invocation);
    if (invocation.name === "instagram_get_connections" && invocation.arguments.list === "followers") return { invocationId: invocation.invocationId, ok: true, value: { accounts: [{ username: "follower", displayName: "Follower Name", profilePath: "/follower/" }], nextCursor: null } };
    if (invocation.name === "instagram_get_connections") return { invocationId: invocation.invocationId, ok: true, value: { accounts: [{ username: "one", displayName: "One Name", profilePath: "/one/" }, { username: "blocked", displayName: "Blocked", profilePath: "/blocked/" }], nextCursor: "2" } };
    if (invocation.name === "instagram_get_posts" && invocation.arguments.profilePath === "/blocked/") return { invocationId: invocation.invocationId, ok: false, error: { code: "unavailable", message: "Not accessible", retryable: false } };
    if (invocation.name === "instagram_get_posts") return { invocationId: invocation.invocationId, ok: true, value: { posts: [{ postId: "post-1", url: "https://www.instagram.com/p/post-1/", publishedAt: "2026-08-24T10:00:00Z" }] } };
    return { invocationId: invocation.invocationId, ok: true, value: { comments: [{ commentId: "comment-1", text: "Visible comment", author: "person" }] } };
  }
}

test("collects nested following names, posts, and comments while isolating inaccessible accounts", async () => {
  const gateway = new FakeGateway();
  const result = await new FollowingCommentsCollector(gateway).collect({ accountsPerBatch: 2, postsPerAccount: 1, commentsPerPost: 10 });
  assert.equal(result.nextCursor, "2");
  assert.equal(result.followers[0]?.displayName, "Follower Name");
  assert.equal(result.accounts[0]?.displayName, "One Name");
  assert.equal(result.accounts[0]?.posts[0]?.comments[0]?.commentId, "comment-1");
  assert.match(result.accounts[1]?.error ?? "", /unavailable/);
  assert.equal(gateway.calls.filter(({ name }) => name === "instagram_get_comments").length, 1);
});

test("API validates bounds and returns collector results", async () => {
  const collector = new FollowingCommentsCollector(new FakeGateway());
  const store = new InMemoryApiStore();
  const app = buildApi({ collector, platform: { auth: new StaticAuthenticator(new Map([["test-token", { userId: "user", sessionId: "session", expiresAt: Number.MAX_SAFE_INTEGER }]])), tasks: store, events: store, data: store, approvals: store } });
  try {
    const headers = { authorization: "Bearer test-token" };
    const invalid = await app.inject({ method: "POST", url: "/api/instagram/following-comments", headers, payload: { accountsPerBatch: 100 } });
    assert.equal(invalid.statusCode, 400);
    const valid = await app.inject({ method: "POST", url: "/api/instagram/following-comments", headers, payload: { accountsPerBatch: 2, postsPerAccount: 1, commentsPerPost: 5 } });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.json().data.accounts.length, 2);
    const profile = await app.inject({ method: "POST", url: "/api/instagram/profile-content", headers, payload: { username: "one" } });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().data.username, "one");
  } finally { await app.close(); }
});
