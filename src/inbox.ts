import type { Update } from "grammy/types";
import { encrypt } from "./crypto";
import type { EncryptedPayload } from "./types";

export type Job = { kind: "update"; id: string; payload: EncryptedPayload } | { kind: "check"; id: string };

export class Inbox {
  constructor(private readonly storage: DurableObjectStorage, private readonly key: string) {}

  async enqueue(update?: Update): Promise<void> {
    const job: Job = update ? {
      kind: "update", id: `update:${update.update_id}`,
      payload: await encrypt(this.key, JSON.stringify(update)),
    } : { kind: "check", id: "check" };
    await this.storage.transaction(async (txn) => {
      const queue = await txn.get<Job[]>("inbox") ?? [];
      const completed = await txn.get<string[]>("completed_updates") ?? [];
      if (!queue.some((item) => item.id === job.id) && !completed.includes(job.id)) {
        queue.push(job);
        await txn.put("inbox", queue);
      }
      const due = Date.now() + 1;
      const alarm = await txn.getAlarm();
      if (queue.length && (alarm === null || alarm > due)) await txn.setAlarm(due);
    });
  }

  async peek(): Promise<Job | undefined> {
    return (await this.storage.get<Job[]>("inbox"))?.[0];
  }

  async complete(job: Job): Promise<void> {
    await this.storage.transaction(async (txn) => {
      const queue = await txn.get<Job[]>("inbox") ?? [];
      await txn.put("inbox", queue.filter((item) => item.id !== job.id));
      if (job.kind === "update") {
        const completed = await txn.get<string[]>("completed_updates") ?? [];
        await txn.put("completed_updates", [...completed, job.id].slice(-256));
      }
      if (queue.some((item) => item.id !== job.id)) await txn.setAlarm(Date.now() + 1);
    });
  }

  async retry(): Promise<void> {
    await this.storage.setAlarm(Date.now() + 30_000);
  }
}
