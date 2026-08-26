import { expect, it } from "vitest";
import { TaskCache } from "./event-cache.js";
import type { Task } from "./types.js";
const task = (revision: number, status: Task["status"]): Task => ({ taskId: "t", goal: "g", status, currentAction: null, revision, createdAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z", steps: [] });
it("deduplicates resumed events and rejects stale snapshots after refresh", () => { const cache = new TaskCache(); cache.reconcile(task(3, "running")); expect(cache.reconcile(task(2, "queued")).status).toBe("running"); cache.reconcile(task(4, "completed")); expect(cache.reconcile(task(5, "running")).status).toBe("completed"); const event = { id: "e1", taskId: "t", type: "completed", occurredAt: "2026-08-25T00:00:00Z", payload: {} }; expect(cache.add(event)).toBe(true); expect(cache.add(event)).toBe(false); expect(cache.events).toHaveLength(1); expect(cache.lastEventId).toBe("e1"); });
