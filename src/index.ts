import type { Update } from "grammy/types";
import { Hono } from "hono";
import { isOwnerUpdate } from "./updates";
import type { Env } from "./types";
export { OwnerBot } from "./owner";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("OAU_PORTAL_CHECKER is running"));

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
  if (isOwnerUpdate(update, Number(c.env.OWNER_ID))) {
    await c.env.OWNER.getByName(c.env.OWNER_ID).enqueueUpdate(update);
  }

  return c.text("ok");
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env) {
    await env.OWNER.getByName(env.OWNER_ID).enqueueCheck();
  },
} satisfies ExportedHandler<Env>;
