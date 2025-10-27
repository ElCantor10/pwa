import { openDB } from "idb";

const DB_NAME = "todo-pwa";
const DB_VERSION = 1;

export const db = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    db.createObjectStore("tasks", { keyPath: "_id" });
    db.createObjectStore("outbox", { keyPath: "id" });
    db.createObjectStore("meta", { keyPath: "key" });
  },
});

export async function cacheTasks(list: any[]) {
  const tx = (await db).transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");
  
  await store.clear();
  for (const t of list) await store.put(t);
  await tx.done;
}

export async function putTaskLocal(task: any) {
  await (await db).put("tasks", task);
}

export async function getAllTasksLocal() {
  return await (await db).getAll("tasks");
}

export async function removeTaskLocal(id: string) {
  await (await db).delete("tasks", id);
}

export type OutboxOp =
  | { id: string; op: "create"; clientId: string; data: any; ts: number; }
  | { id: string; op: "update"; serverId?: string; clientId?: string; data: any; ts: number; }
  | { id: string; op: "delete"; serverId?: string; clientId?: string; ts: number; };

export async function queue(op: OutboxOp) {
  await (await db).put("outbox", op);
}

export async function getOutbox() {
  return await (await db).getAll("outbox");
}

export async function clearOutbox() {
  const tx = (await db).transaction("outbox", "readwrite");
  await tx.store.clear();
  await tx.done;
}

export async function setMapping(clientId: string, serverId: string) {
  await (await db).put("meta", { key: `mapping-${clientId}`, serverId });
}

export async function getMapping(clientId: string) {
  const result = await (await db).get("meta", `mapping-${clientId}`);
  return result?.serverId as string | undefined;
}