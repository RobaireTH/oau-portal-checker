import { BotError, type Bot } from "grammy/web";
import type { Update } from "grammy/types";

export function isOwnerUpdate(update: Update, ownerId: number): boolean {
  const from = update.message?.from ?? update.callback_query?.from;
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  return from?.id === ownerId && chat?.type === "private" && chat.id === ownerId;
}

export async function processUpdate(bot: Bot, update: Update): Promise<void> {
  // getMe uses the client's bounded timeout; Bot.init retries network failures indefinitely.
  if (!bot.isInited()) bot.botInfo = await bot.api.getMe();
  try {
    await bot.handleUpdate(update);
  } catch (error) {
    if (error instanceof BotError) await bot.errorHandler(error);
    else throw error;
  }
}
