import type { Update } from "grammy/types";
import { Hono } from "hono";
import { privateChatId } from "./updates";
import type { Env } from "./types";
export { OwnerBot } from "./owner";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("IfeMate is running"));

// Acknowledge only after the encrypted update is durably stored for alarm processing.
app.post("/webhook", async (c) => {
  if (
    !c.env.WEBHOOK_SECRET || c.req.header("X-Telegram-Bot-Api-Secret-Token") !== c.env.WEBHOOK_SECRET
  ) {
    return c.text("Unauthorized", 401);
  }

  let update: Update;
  try {
    update = await c.req.json<Update>();
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return c.text("Invalid update", 400);
  } catch {
    return c.text("Invalid update", 400);
  }
  const chatId = privateChatId(update);
  if (chatId) await c.env.OWNER.getByName(chatId).enqueueUpdate(chatId, update);

  return c.text("ok");
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env) {
    const chatId = env.OWNER_ID;
    if (chatId && Number.isSafeInteger(Number(chatId)) && Number(chatId) > 0) {
      await env.OWNER.getByName(chatId).enqueueCheck(chatId);
    }
  },
} satisfies ExportedHandler<Env>;
