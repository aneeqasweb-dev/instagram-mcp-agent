import type { Task, TaskEvent } from "./types.js";
const terminal = new Set(["completed", "failed", "cancelled", "safely_blocked"]);
export class TaskCache {
  task?: Task; readonly events: TaskEvent[] = []; readonly #ids = new Set<string>();
  reconcile(snapshot: Task) { if (!this.task || (snapshot.revision >= this.task.revision && !(terminal.has(this.task.status) && !terminal.has(snapshot.status)))) this.task = snapshot; return this.task; }
  add(event: TaskEvent) { if (this.#ids.has(event.id)) return false; this.#ids.add(event.id); this.events.push(event); this.events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)); return true; }
  get lastEventId() { return this.events.at(-1)?.id; }
}
