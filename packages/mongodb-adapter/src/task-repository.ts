import {
  agentTaskStateSchema,
  type AgentStep,
  type AgentTaskState,
} from "@instagram-agent/agent-core";
import type {
  TaskId,
  TaskRepository,
  UserId,
} from "@instagram-agent/contracts";
import type { Collection, Db, Document } from "mongodb";

type TaskSnapshot = Omit<AgentTaskState, "steps" | "observations" | "errors">;
interface StoredTask extends TaskSnapshot, Document {
  userId: UserId;
  taskId: TaskId;
}
interface StoredStep extends AgentStep, Document {
  userId: UserId;
  taskId: TaskId;
}

export class MongoTaskRepository implements TaskRepository<AgentTaskState> {
  readonly #tasks: Collection<StoredTask>;
  readonly #steps: Collection<StoredStep>;
  constructor(db: Db) {
    this.#tasks = db.collection("agent_tasks");
    this.#steps = db.collection("agent_steps");
  }

  async get(taskId: TaskId, userId: UserId): Promise<AgentTaskState | null> {
    const task = await this.#tasks.findOne(
      { taskId, userId },
      { projection: { _id: 0 } },
    );
    if (!task) return null;
    const steps = await this.#steps
      .find(
        { taskId, userId },
        { projection: { _id: 0, userId: 0, taskId: 0 } },
      )
      .sort({ iteration: 1 })
      .toArray();
    const observations = steps.flatMap((step) =>
      step.observation ? [step.observation] : [],
    );
    return agentTaskStateSchema.parse({
      ...task,
      steps,
      observations,
      errors: observations.flatMap((item) => (item.error ? [item.error] : [])),
    });
  }

  async save(state: AgentTaskState): Promise<void> {
    const parsed = agentTaskStateSchema.parse(state);
    const {
      steps,
      observations: _observations,
      errors: _errors,
      ...snapshot
    } = parsed;
    await this.#tasks.replaceOne(
      { userId: parsed.userId, taskId: parsed.taskId },
      snapshot,
      { upsert: true },
    );
    if (steps.length) {
      await this.#steps.bulkWrite(
        steps.map((step) => ({
          replaceOne: {
            filter: {
              userId: parsed.userId,
              taskId: parsed.taskId,
              stepId: step.stepId,
            },
            replacement: {
              ...step,
              userId: parsed.userId,
              taskId: parsed.taskId,
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
  }
}
