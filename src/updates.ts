import { BotError, type Bot } from "grammy/web";
import type { Update } from "grammy/types";

export function privateChatId(update: Update): string | null {
  const from = update.message?.from ?? update.callback_query?.from;
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  if (!from || !Number.isSafeInteger(from.id) || from.id <= 0) return null;
  if (chat?.type !== "private" || chat.id !== from.id) return null;
  return String(from.id);
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
