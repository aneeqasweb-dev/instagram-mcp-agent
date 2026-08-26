import type { ToolGateway } from "@instagram-agent/contracts";

export interface CollectionRequest {
  readonly cursor?: string;
  readonly followerCursor?: string;
  readonly accountsPerBatch: number;
  readonly postsPerAccount: number;
  readonly commentsPerPost: number;
}

export interface CommentView { readonly commentId: string; readonly text: string; readonly author?: string; readonly publishedAt?: string }
export interface PostView { readonly postId: string; readonly url: string; readonly publishedAt: string; readonly caption?: string; readonly mediaUrl?: string; readonly comments: readonly CommentView[] }
export interface AccountView { readonly username: string; readonly displayName: string; readonly profilePath: string; readonly posts: readonly PostView[]; readonly error?: string }
export interface FollowingCommentsResult { readonly accounts: readonly AccountView[]; readonly followers: readonly Omit<AccountView, "posts">[]; readonly nextCursor: string | null; readonly followersNextCursor: string | null; readonly collectedAt: string }

type ConnectionResult = { accounts: Array<{ username: string; displayName: string; profilePath: string }>; nextCursor: string | null };
export interface ConnectionListResult { readonly accounts: readonly { username: string; displayName: string; profilePath: string }[]; readonly nextCursor: string | null }
type PostsResult = { posts: Array<{ postId: string; url: string; publishedAt: string; caption?: string; mediaUrl?: string }>; nextCursor: string | null };
type CommentsResult = { comments: CommentView[]; nextCursor: string | null };
export interface ProfileContentResult { readonly username: string; readonly displayName: string; readonly posts: readonly PostView[]; readonly nextCursor: string | null; readonly collectedAt: string }

const invoke = async <T>(gateway: ToolGateway, name: string, arguments_: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
  const result = await gateway.invoke("authorized-local-user", { invocationId: crypto.randomUUID(), name, arguments: arguments_ }, signal);
  if (!result.ok) throw new Error(`${result.error?.code ?? "tool_failed"}: ${result.error?.message ?? "Tool failed"}`);
  return result.value as T;
};

export class FollowingCommentsCollector {
  constructor(private readonly gateway: ToolGateway) {}

  async collect(request: CollectionRequest): Promise<FollowingCommentsResult> {
    const connections = await invoke<ConnectionResult>(this.gateway, "instagram_get_connections", { list: "following", limit: request.accountsPerBatch, ...(request.cursor ? { cursor: request.cursor } : {}) });
    const followers = await invoke<ConnectionResult>(this.gateway, "instagram_get_connections", { list: "followers", limit: request.accountsPerBatch, ...(request.followerCursor ? { cursor: request.followerCursor } : {}) });
    const accounts: AccountView[] = [];
    for (const account of connections.accounts) {
      try {
        const postResult = await invoke<PostsResult>(this.gateway, "instagram_get_posts", { profilePath: account.profilePath, limit: request.postsPerAccount });
        const posts: PostView[] = [];
        for (const post of postResult.posts) {
          const comments = await invoke<CommentsResult>(this.gateway, "instagram_get_comments", { postPath: new URL(post.url).pathname, limit: request.commentsPerPost });
          posts.push({ ...post, comments: comments.comments });
        }
        accounts.push({ ...account, posts });
      } catch (error) {
        accounts.push({ ...account, posts: [], error: error instanceof Error ? error.message : "Collection failed" });
      }
    }
    return { accounts, followers: followers.accounts, nextCursor: connections.nextCursor, followersNextCursor: followers.nextCursor, collectedAt: new Date().toISOString() };
  }

  async listConnections(list: "followers" | "following", cursor?: string, signal?: AbortSignal): Promise<ConnectionListResult> {
    return invoke<ConnectionResult>(this.gateway, "instagram_get_connections", { list, limit: 50, ...(cursor ? { cursor } : {}) }, signal);
  }

  async collectProfile(username: string, cursor?: string): Promise<ProfileContentResult> {
    const requested = username.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9._ -]{1,64}$/.test(requested)) throw new Error("Instagram username or friend name is invalid");
    let account = { username: requested, displayName: requested, profilePath: `/${requested}/` };
    if (!/^[A-Za-z0-9._]{1,30}$/.test(requested)) {
      const key = requested.toLowerCase().replace(/[^a-z0-9]/g, "");
      let connectionCursor: string | undefined;
      let found: ConnectionResult["accounts"][number] | undefined;
      for (let page = 0; page < 20 && !found; page += 1) {
        const result = await invoke<ConnectionResult>(this.gateway, "instagram_get_connections", { list: "following", limit: 50, ...(connectionCursor ? { cursor: connectionCursor } : {}) });
        found = result.accounts.find((item) => [item.username, item.displayName].some((value) => value.toLowerCase().replace(/[^a-z0-9]/g, "") === key));
        if (!result.nextCursor || result.nextCursor === connectionCursor) break;
        connectionCursor = result.nextCursor;
      }
      if (!found) throw new Error(`No followed Instagram account matches '${requested}'`);
      account = found;
    }
    const postResult = await invoke<PostsResult>(this.gateway, "instagram_get_posts", { profilePath: account.profilePath, limit: 12, ...(cursor ? { cursor } : {}) });
    const posts: PostView[] = [];
    for (const post of postResult.posts) {
      const comments = new Map<string, CommentView>();
      let commentCursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const result = await invoke<CommentsResult>(this.gateway, "instagram_get_comments", { postPath: new URL(post.url).pathname, limit: 50, ...(commentCursor ? { cursor: commentCursor } : {}) });
        for (const comment of result.comments) comments.set(comment.commentId, comment);
        if (!result.nextCursor || result.nextCursor === commentCursor) break;
        commentCursor = result.nextCursor;
      }
      posts.push({ ...post, comments: [...comments.values()] });
    }
    return { username: account.username, displayName: account.displayName, posts, nextCursor: postResult.nextCursor, collectedAt: new Date().toISOString() };
  }

  async close(): Promise<void> { if ("close" in this.gateway && typeof this.gateway.close === "function") await this.gateway.close(); }
}
