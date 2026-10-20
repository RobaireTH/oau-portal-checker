import { DurableObject } from "cloudflare:workers";
import type { Bot } from "grammy/web";
import type { Update } from "grammy/types";
import { createBot } from "./bot";
import { hasCredentials } from "./credentials";
import { decrypt } from "./crypto";
import { Inbox } from "./inbox";
import { checkForNewResults } from "./notify";
import { DurableStateStore } from "./state";
import { privateChatId, processUpdate } from "./updates";
import type { BotEnv, Env } from "./types";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const NEXT_CHECK_KEY = "next_check_at";

export class OwnerBot extends DurableObject<Env> {
  private readonly inbox = new Inbox(this.ctx.storage, this.env.ENCRYPTION_KEY);
  private readonly state = new DurableStateStore(this.ctx.storage);
  private bot?: Bot;

  private async bindChat(chatId: string): Promise<void> {
    if (!Number.isSafeInteger(Number(chatId)) || Number(chatId) <= 0) throw new Error("Invalid chat ID");
    await this.ctx.storage.transaction(async (txn) => {
      const existing = await txn.get<string>("chat_id");
      if (existing && existing !== chatId) throw new Error("Chat ID mismatch");
      if (!existing) await txn.put("chat_id", chatId);
    });
  }

  private botEnvironment(chatId: string): BotEnv {
    return {
      STATE: this.state,
      BOT_TOKEN: this.env.BOT_TOKEN,
      CHAT_ID: chatId,
      ENCRYPTION_KEY: this.env.ENCRYPTION_KEY,
    };
  }

  private async scheduleCheck(env: BotEnv): Promise<void> {
    if (this.env.OWNER_ID === env.CHAT_ID) return;
    if (!await hasCredentials(env)) {
      await this.ctx.storage.delete(NEXT_CHECK_KEY);
      return;
    }
    let due = await this.ctx.storage.get<number>(NEXT_CHECK_KEY);
    if (due === undefined) {
      due = Date.now() + CHECK_INTERVAL_MS;
      await this.ctx.storage.put(NEXT_CHECK_KEY, due);
    }
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > due) await this.ctx.storage.setAlarm(due);
  }

  private async enqueueScheduledCheck(env: BotEnv): Promise<void> {
    if (!await hasCredentials(env)) {
      await this.ctx.storage.delete(NEXT_CHECK_KEY);
      return;
    }
    const due = await this.ctx.storage.get<number>(NEXT_CHECK_KEY);
    if (due !== undefined && due > Date.now()) {
      await this.ctx.storage.setAlarm(due);
      return;
    }
    await this.ctx.storage.delete(NEXT_CHECK_KEY);
    await this.inbox.enqueue();
  }

  async enqueueUpdate(chatId: string, update: Update): Promise<void> {
    if (privateChatId(update) !== chatId) throw new Error("Update chat mismatch");
    await this.bindChat(chatId);
    await this.inbox.enqueue(update);
  }

  async enqueueCheck(chatId: string): Promise<void> {
    await this.bindChat(chatId);
    await this.inbox.enqueue();
  }

  // All account actions run through this alarm; RPC methods only append to the persistent inbox.
  async alarm(): Promise<void> {
    const chatId = await this.ctx.storage.get<string>("chat_id");
    if (!chatId) return;
    const botEnv = this.botEnvironment(chatId);
    const job = await this.inbox.peek();
    if (!job) {
      await this.enqueueScheduledCheck(botEnv);
      return;
    }
    try {
      if (job.kind === "check") {
        await checkForNewResults(botEnv);
      } else {
        let update: Update;
        try {
          update = JSON.parse(await decrypt(this.env.ENCRYPTION_KEY, job.payload)) as Update;
        } catch {
          // A rotated key cannot decrypt previously queued messages. Let new /login updates through.
          console.error("Discarding an unreadable inbox update", job.id);
          await this.inbox.complete(job);
          await this.scheduleCheck(botEnv);
          return;
        }
        this.bot ??= createBot(botEnv);
        await processUpdate(this.bot, update);
      }
      await this.inbox.complete(job);
      await this.scheduleCheck(botEnv);
    } catch {
      console.error("Inbox processing failed; retry scheduled", job.id);
      await this.inbox.retry();
    }
  }
}
