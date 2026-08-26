import type { RegisteredTool } from "@instagram-agent/agent-core";
import { ToolValidationError } from "@instagram-agent/agent-core";
import type { Db } from "mongodb";
import {
  ScopedDocumentRepository,
  type SafeEntity,
} from "./data-repositories.js";

const entitySchema = {
  type: "string",
  enum: ["comment_analysis", "agent_memory"],
};

export function createDatabaseTools(
  db: Db,
  invocationTtlMs = 86_400_000,
): readonly RegisteredTool[] {
  const repository = new ScopedDocumentRepository(db);

  async function idempotent(
    userId: string,
    invocationId: string,
    operation: () => Promise<unknown>,
  ): Promise<unknown> {
    const invocations = db.collection("tool_invocations");
    const existing = await invocations.findOne({ userId, invocationId });
    if (existing) return existing.result;
    const result = await operation();
    try {
      await invocations.insertOne({
        userId,
        invocationId,
        result,
        expiresAt: new Date(Date.now() + invocationTtlMs),
      });
    } catch (error) {
      const raced = await invocations.findOne({ userId, invocationId });
      if (raced) return raced.result;
      throw error;
    }
    return result;
  }

  const save: RegisteredTool = {
    definition: {
      name: "database_save",
      version: "1.0.0",
      description: "Upsert a scoped analysis or memory record.",
      risk: "write",
      timeoutMs: 5_000,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "id", "data"],
        properties: {
          entity: entitySchema,
          id: { type: "string", minLength: 1, maxLength: 200 },
          data: { type: "object", maxProperties: 50 },
        },
      },
      outputSchema: {
        type: "object",
        required: ["saved", "id"],
        properties: { saved: { type: "boolean" }, id: { type: "string" } },
      },
    },
    execute: async (args, context) =>
      idempotent(context.userId, context.invocationId, async () => {
        await repository.save(
          context.userId,
          args.entity as SafeEntity,
          String(args.id),
          args.data as Record<string, unknown>,
        );
        return { saved: true, id: String(args.id) };
      }),
  };
  const search: RegisteredTool = {
    definition: {
      name: "database_search",
      version: "1.0.0",
      description: "Search one allowed scoped entity using allowlisted fields.",
      risk: "read",
      timeoutMs: 5_000,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["entity"],
        properties: {
          entity: entitySchema,
          field: { type: "string" },
          equals: {},
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        dependencies: { field: ["equals"], equals: ["field"] },
      },
      outputSchema: {
        type: "object",
        required: ["records"],
        properties: {
          records: { type: "array", maxItems: 100, items: { type: "object" } },
        },
      },
    },
    execute: async (args, context) => {
      try {
        return {
          records: await repository.search(
            context.userId,
            args.entity as SafeEntity,
            args.field as string | undefined,
            args.equals,
            Number(args.limit ?? 20),
          ),
        };
      } catch (error) {
        throw new ToolValidationError(
          "unsafe_database_query",
          error instanceof Error ? error.message : "Unsafe database query",
        );
      }
    },
  };
  const update: RegisteredTool = {
    definition: {
      name: "database_update",
      version: "1.0.0",
      description:
        "Update allowed fields on one scoped analysis or memory record.",
      risk: "write",
      timeoutMs: 5_000,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "id", "changes"],
        properties: {
          entity: entitySchema,
          id: { type: "string", minLength: 1 },
          changes: { type: "object", minProperties: 1, maxProperties: 50 },
        },
      },
      outputSchema: {
        type: "object",
        required: ["updated", "id"],
        properties: { updated: { type: "boolean" }, id: { type: "string" } },
      },
    },
    execute: async (args, context) =>
      idempotent(context.userId, context.invocationId, async () => ({
        updated: await repository.update(
          context.userId,
          args.entity as SafeEntity,
          String(args.id),
          args.changes as Record<string, unknown>,
        ),
        id: String(args.id),
      })),
  };
  return [save, search, update];
}
