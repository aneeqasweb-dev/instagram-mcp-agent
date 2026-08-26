import type { AgentTaskState } from "@instagram-agent/agent-core";
import type { Collection, Db, Document } from "mongodb";

export interface MemoryRecord extends Document {
  readonly userId: string; readonly memoryId: string; readonly sourceTaskId: string; readonly kind: "task_summary" | "application";
  readonly sessionId?: string; readonly text: string; readonly createdAt: Date; readonly expiresAt?: Date;
}

export function assembleShortTermContext(state: AgentTaskState, maximumBytes = 16_000): Record<string, unknown> {
  const recentSteps = state.steps.slice(-10);
  let context: Record<string, unknown> = {
    taskId: state.taskId, goal: state.goal, status: state.status, currentAction: state.currentAction,
    iteration: state.iteration, recentSteps, remainingWork: state.remainingWork,
  };
  while (Buffer.byteLength(JSON.stringify(context)) > maximumBytes && recentSteps.length > 0) {
    recentSteps.shift();
    context = { ...context, recentSteps };
  }
  if (Buffer.byteLength(JSON.stringify(context)) > maximumBytes) {
    context = { taskId: state.taskId, goal: state.goal.slice(0, Math.max(0, maximumBytes / 2)), status: state.status, iteration: state.iteration, compacted: true };
  }
  return context;
}

export class MongoMemoryRepository {
  readonly #collection: Collection<MemoryRecord>;
  constructor(db: Db) { this.#collection = db.collection("agent_memory"); }

  async save(record: MemoryRecord): Promise<void> {
    if (!record.sourceTaskId) throw new Error("Memory provenance requires a source task");
    await this.#collection.replaceOne({ userId: record.userId, memoryId: record.memoryId }, record, { upsert: true });
  }

  async retrieve(userId: string, query: string, limit = 5, sessionId?: string): Promise<MemoryRecord[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 20);
    const scope = { userId, ...(sessionId ? { sessionId } : {}) };
    const filter = query.trim() ? { ...scope, $text: { $search: query.slice(0, 200) } } : scope;
    return this.#collection.find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(safeLimit).toArray();
  }
}
