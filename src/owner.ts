import { DurableObject } from "cloudflare:workers";
import type { Bot } from "grammy/web";
import type { Update } from "grammy/types";
import { createBot } from "./bot";
import { decrypt } from "./crypto";
import { Inbox } from "./inbox";
import { checkForNewResults } from "./notify";
import { DurableStateStore } from "./state";
import { processUpdate } from "./updates";
import type { BotEnv, Env } from "./types";

export class OwnerBot extends DurableObject<Env> {
  private readonly inbox = new Inbox(this.ctx.storage, this.env.ENCRYPTION_KEY);
  private readonly botEnv: BotEnv = { ...this.env, STATE: new DurableStateStore(this.ctx.storage) };
  private bot?: Bot;

  async enqueueUpdate(update: Update): Promise<void> {
    await this.inbox.enqueue(update);
  }

  async enqueueCheck(): Promise<void> {
    await this.inbox.enqueue();
  }

  // All account actions run through this alarm; RPC methods only append to the persistent inbox.
  async alarm(): Promise<void> {
    const job = await this.inbox.peek();
    if (!job) return;
    try {
      if (job.kind === "check") {
        await checkForNewResults(this.botEnv);
      } else {
        let update: Update;
        try {
          update = JSON.parse(await decrypt(this.env.ENCRYPTION_KEY, job.payload)) as Update;
        } catch {
          // A rotated key cannot decrypt previously queued messages. Let new /login updates through.
          console.error("Discarding an unreadable inbox update", job.id);
          await this.inbox.complete(job);
          return;
        }
        this.bot ??= createBot(this.botEnv);
        await processUpdate(this.bot, update);
      }
      await this.inbox.complete(job);
    } catch {
      console.error("Inbox processing failed; retry scheduled", job.id);
      await this.inbox.retry();
    }
  }
}
