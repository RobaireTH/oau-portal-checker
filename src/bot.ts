import { Bot, GrammyError, type Context } from "grammy/web";
import { loadResults, refreshResults } from "./cache";
import {
  hasCredentials,
  prepareCredentials,
  saveAccount,
} from "./credentials";
import { escapeHtml, semesterPages, formatSummary } from "./format";
import { semesterLabel } from "./grades";
import { digestPin } from "./crypto";
import { login } from "./portal";
import { ACCOUNT_STATE_KEYS } from "./state";
import type {
  CachedResults,
  BotEnv,
  LastCheck,
  LoginState,
  PinState,
  ProtectedAction,
  Results,
  Session,
  ResultAccess,
} from "./types";

const HELP = [
  "<b>OAU_PORTAL_CHECKER</b>",
  "",
  "/login - connect your OAU portal account",
  "/logout - sign out and delete the saved password",
  "/setpin - create or change your results PIN",
  "/results - pick a semester to view (asks for PIN)",
  "/summary - CGPA and unit totals (asks for PIN)",
  "/refresh - fetch the latest results from the portal now",
  "/status - session and last check info",
].join("\n");

const DELETE_ROW = [{ text: "🗑 Delete", callback_data: "delete" }];
const DELETE_KEYBOARD = { inline_keyboard: [DELETE_ROW] };
const BACK_KEYBOARD = {
  inline_keyboard: [[{ text: "« Back", callback_data: "back" }], DELETE_ROW],
};

/** A half-finished /login expires after 10 minutes. */
const LOGIN_TIMEOUT_SECONDS = 600;
/** A PIN prompt expires after 2 minutes if nothing is entered. */
const PIN_TIMEOUT_SECONDS = 120;
const ACCESS_TIMEOUT_SECONDS = 300;

function semesterKeyboard(results: Results) {
  const keys = Object.keys(results).sort((a, b) => Number(a) - Number(b));
  const rows: { text: string; callback_data: string }[][] = [];

  for (let i = 0; i < keys.length; i += 2) {
    rows.push(
      keys.slice(i, i + 2).map((key, offset) => ({
        text: semesterLabel(key),
        callback_data: `sem:${i + offset}:0`,
      })),
    );
  }

  rows.push(DELETE_ROW);

  return { inline_keyboard: rows };
}

function pickerText(fetchedAt: string): string {
  return `Pick a semester. Data from ${formatTime(fetchedAt)}.`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function createBot(env: BotEnv): Bot {
  const bot = new Bot(env.BOT_TOKEN, { client: { timeoutSeconds: 10 } });
  const ownerId = Number(env.OWNER_ID);

  // Private bot: silently ignore everyone except the owner.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === ownerId && ctx.chat?.type === "private" && ctx.chat.id === ownerId) await next();
  });

  async function askPin(ctx: Context, target: ProtectedAction) {
    await env.STATE.delete("login_state");
    await env.STATE.delete("result_access");
    const configured = await env.STATE.get("pin_digest");
    const state: PinState = configured
      ? { action: "verify", target }
      : { action: "set", target };
    await env.STATE.put(
      "pin_state",
      JSON.stringify(state),
      {
        expirationTtl: PIN_TIMEOUT_SECONDS,
      },
    );
    await ctx.reply(configured ? "Enter your PIN." : "Create a 4 to 12 digit PIN.");
  }

  async function showResults(ctx: Context) {
    const { results, fetchedAt, studentId } = await loadResults(env);
    const message = await ctx.reply(pickerText(fetchedAt), {
      reply_markup: semesterKeyboard(results),
    });
    await env.STATE.put("result_access", JSON.stringify({
      messageId: message.message_id, studentId,
      semesters: Object.keys(results).sort((a, b) => Number(a) - Number(b)),
    } satisfies ResultAccess), { expirationTtl: ACCESS_TIMEOUT_SECONDS });
  }

  async function showSummary(ctx: Context) {
    const { results } = await loadResults(env);
    await ctx.reply(formatSummary(results), {
      parse_mode: "HTML",
      reply_markup: DELETE_KEYBOARD,
    });
  }

  async function completeLogin(ctx: Context, state: Extract<LoginState, { step: "password" }>, password: string) {
    await env.STATE.delete("login_state");
    await ctx.deleteMessage().catch(() => {});
    try {
      const payload = await prepareCredentials(env, { username: state.username, password });
      const session = await login(state.username, password);
      await saveAccount(env, session, payload);
      await ctx.reply("Logged in. I'll stay logged in until you send /logout.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Login failed: ${escapeHtml(message)}. Send /login to try again.`, { parse_mode: "HTML" });
    }
  }

  bot.use(async (ctx, next) => {
    if (!ctx.message?.text || /^\/(?:cancel|logout|login|setpin)(?:@\w+)?\s*$/.test(ctx.message.text)) return next();
    const state = await env.STATE.get<LoginState>("login_state", "json");
    if (state?.step === "password") await completeLogin(ctx, state, ctx.message.text);
    else await next();
  });

  bot.command("start", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("cancel", async (ctx) => {
    await env.STATE.write({}, ["login_state", "pin_state", "result_access"]);
    await ctx.reply("Canceled.");
  });

  bot.command("login", async (ctx) => {
    await env.STATE.write({}, ["pin_state", "result_access"]);
    await env.STATE.put("login_state", JSON.stringify({ step: "username" }), {
      expirationTtl: LOGIN_TIMEOUT_SECONDS,
    });
    await ctx.reply("Send your matric number.");
  });

  bot.command("logout", async (ctx) => {
    await env.STATE.write({}, ACCOUNT_STATE_KEYS);
    await ctx.reply("Logged out. Your saved password has been deleted.");
  });

  bot.command("setpin", async (ctx) => {
    await env.STATE.write({}, ["login_state", "pin_state", "result_access"]);
    await env.STATE.put(
      "pin_state",
      JSON.stringify({ action: "set" } satisfies PinState),
      { expirationTtl: PIN_TIMEOUT_SECONDS },
    );
    await ctx.reply("Send a new 4 to 12 digit PIN. I'll delete your message after reading it.");
  });

  bot.command("results", (ctx) => askPin(ctx, "results"));
  bot.command("summary", (ctx) => askPin(ctx, "summary"));

  // Plain-text messages are either a PIN, or part of a /login conversation.
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    // Commands registered below this handler must still run, so pass them on.
    if (text.startsWith("/")) return next();

    const pin = await env.STATE.get<PinState>("pin_state", "json");
    if (pin) {
      await env.STATE.delete("pin_state");
      // Best effort: remove the PIN from the chat. Telegram may refuse, which is fine.
      await ctx.deleteMessage().catch(() => {});

      if (pin.action === "set") {
        if (!/^\d{4,12}$/.test(text)) {
          await env.STATE.put("pin_state", JSON.stringify(pin), { expirationTtl: PIN_TIMEOUT_SECONDS });
          await ctx.reply("PIN must contain 4 to 12 digits. Try again.");
          return;
        }
        await env.STATE.put("pin_digest", await digestPin(env.ENCRYPTION_KEY, text));
        await ctx.reply("PIN saved.");
        if (pin.target === "results") await showResults(ctx);
        else if (pin.target === "summary") await showSummary(ctx);
        return;
      }

      const configured = await env.STATE.get("pin_digest");
      if (!configured || await digestPin(env.ENCRYPTION_KEY, text) !== configured) {
        await ctx.reply("Wrong PIN. Send /results or /summary to try again.");
        return;
      }

      if (pin.target === "results") await showResults(ctx);
      else await showSummary(ctx);
      return;
    }

    const state = await env.STATE.get<LoginState>("login_state", "json");
    if (!state) return;

    if (state.step === "username") {
      await env.STATE.put(
        "login_state",
        JSON.stringify({
          step: "password",
          username: text,
        } satisfies LoginState),
        { expirationTtl: LOGIN_TIMEOUT_SECONDS },
      );
      await ctx.reply(
        "Now send your portal password. I'll delete your message after reading it.",
      );
      return;
    }

    await completeLogin(ctx, state, ctx.message.text);
  });

  bot.on("callback_query:data", async (ctx, next) => {
    if (ctx.callbackQuery.data === "delete") return next();
    const access = await env.STATE.get<ResultAccess>("result_access", "json");
    const session = await env.STATE.get<Session>("session", "json");
    if (!access || access.messageId !== ctx.callbackQuery.message?.message_id ||
        !session || session.studentId !== access.studentId) {
      await ctx.answerCallbackQuery({ text: "Access expired. Send /results and enter your PIN.", show_alert: true });
      return;
    }
    await next();
  });

  bot.callbackQuery(/^sem:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const access = await env.STATE.get<ResultAccess>("result_access", "json");
    const key = access?.semesters[Number(ctx.match[1])];
    const { results } = await loadResults(env);
    const courses = key === undefined ? undefined : results[key];

    if (!key || !courses) {
      await ctx.editMessageText("That semester is no longer on the portal.");
      return;
    }

    const pages = semesterPages(key, courses);
    const page = Number(ctx.match[2]);
    if (!pages[page]) return;
    const navigation = [];
    if (page > 0) navigation.push({ text: "Previous", callback_data: `sem:${ctx.match[1]}:${page - 1}` });
    if (page + 1 < pages.length) navigation.push({ text: "Next", callback_data: `sem:${ctx.match[1]}:${page + 1}` });
    await ctx.editMessageText(pages[page], {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [...(navigation.length ? [navigation] : []), ...BACK_KEYBOARD.inline_keyboard] },
    });
  });

  bot.callbackQuery("back", async (ctx) => {
    await ctx.answerCallbackQuery();

    const { results, fetchedAt } = await loadResults(env);
    const access = await env.STATE.get<ResultAccess>("result_access", "json");
    if (!access) return;
    // Retain the original authorization deadline when navigating.
    const visibleResults = Object.fromEntries(access.semesters.map((key) => [key, results[key] ?? []]));
    await ctx.editMessageText(pickerText(fetchedAt), {
      reply_markup: semesterKeyboard(visibleResults),
    });
  });

  bot.callbackQuery("delete", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage();
  });

  bot.command("refresh", async (ctx) => {
    const { fetchedAt } = await refreshResults(env);
    await ctx.reply(`Results refreshed at ${formatTime(fetchedAt)}.`);
  });

  bot.command("status", async (ctx) => {
    const session = await env.STATE.get<Session>("session", "json");
    const cached = await env.STATE.get<CachedResults>("results", "json");
    const lastCheck = await env.STATE.get<LastCheck>("last_check", "json");
    const saved = await hasCredentials(env);

    const lines = [
      "<b>Status</b>",
      session
        ? `Logged in since: ${formatTime(session.loggedInAt)}`
        : "Session: not active",
      saved
        ? "Auto re-login: on (password saved, encrypted)"
        : "Auto re-login: off. Send /login to connect your account.",
      cached
        ? `Results as of: ${formatTime(cached.fetchedAt)}`
        : "Results: not fetched yet. Send /refresh.",
      lastCheck
        ? `Last check: ${formatTime(lastCheck.at)} - ${lastCheck.ok ? "OK" : `failed: ${escapeHtml(lastCheck.error ?? "unknown error")}`}`
        : "Last check: none yet",
      "Automatic checks run every 15 minutes.",
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.catch(async (error) => {
    // Tapping "Back" on a message that already shows the list sends identical content. Harmless.
    if (
      error.error instanceof GrammyError &&
      error.error.description.includes("message is not modified")
    ) {
      return;
    }

    console.error(error.error);
    const message =
      error.error instanceof Error ? error.error.message : String(error.error);
    await error.ctx
      .reply(`Something went wrong: ${escapeHtml(message)}`, {
        parse_mode: "HTML",
      })
      .catch(() => {});
  });

  return bot;
}
