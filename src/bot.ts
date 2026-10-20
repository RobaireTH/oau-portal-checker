import { Bot, GrammyError, InputFile, type Context } from "grammy/web";
import { analyzeResults, formatAnalytics, renderAnalyticsChart } from "./analytics";
import { loadResults, refreshResults } from "./cache";
import { PROGRAMMES, type ProgrammeId } from "./curriculum";
import {
  hasCredentials,
  prepareCredentials,
  saveAccount,
} from "./credentials";
import { escapeHtml, formatSemesterComparison, semesterPages, formatSummary } from "./format";
import { semesterLabel } from "./grades";
import { digestPin } from "./crypto";
import { login } from "./portal";
import { generateAcademicReport } from "./report";
import { formatProjectionPages } from "./projection-format";
import { DEGREE_CLASSES, projectHonors, type DegreeClassId } from "./projection";
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
  "<b>IfeMate</b>",
  "Your private OAU results assistant. I check ePortal every 15 minutes and alert you when a result changes.",
  "",
  "<b>Start here</b>",
  "1. Send /login and enter your matric number and portal password.",
  "2. Send /refresh to fetch your current results.",
  "3. Open /results, /summary, /project, /analytics, /compare, or /report.",
  "4. Create your private results PIN when prompted.",
  "",
  "Your account is isolated from every other user. Use IfeMate only in this private chat. Your password message is deleted after reading, and your saved credentials are encrypted for automatic checks.",
  "",
  "<b>Commands</b>",
  "/login - connect your OAU portal account",
  "/logout - sign out and delete the saved password",
  "/cancel - cancel the current login or PIN prompt",
  "/clear - delete recent messages from this chat",
  "/setpin - create or change your results PIN",
  "/analytics - GPA trends and performance statistics",
  "/compare - compare SGPA and cumulative CGPA by semester",
  "/project - plan toward your highest attainable CGPA",
  "/report - download a complete academic PDF report",
  "/results - pick a semester to view (asks for PIN)",
  "/summary - CGPA and unit totals (asks for PIN)",
  "/refresh - fetch the latest results from the portal now",
  "/status - session and last-check information",
  "/help - show this guide",
].join("\n");

const BOT_COMMANDS = [
  { command: "start", description: "Open the IfeMate guide" },
  { command: "login", description: "Connect your OAU portal account" },
  { command: "refresh", description: "Fetch the latest portal results" },
  { command: "results", description: "View results by semester" },
  { command: "summary", description: "View CGPA and unit totals" },
  { command: "project", description: "Plan toward your highest attainable CGPA" },
  { command: "analytics", description: "View GPA trends and statistics" },
  { command: "compare", description: "Compare semester performance" },
  { command: "report", description: "Download an academic PDF report" },
  { command: "status", description: "View session and last-check details" },
  { command: "setpin", description: "Create or change your results PIN" },
  { command: "clear", description: "Delete recent bot chat messages" },
  { command: "logout", description: "Sign out and delete the saved password" },
  { command: "cancel", description: "Cancel the current prompt" },
  { command: "help", description: "Show the IfeMate guide" },
];

const DELETE_ROW = [{ text: "🗑 Delete", callback_data: "delete" }];
const DELETE_KEYBOARD = { inline_keyboard: [DELETE_ROW] };
const BACK_KEYBOARD = {
  inline_keyboard: [[{ text: "« Back", callback_data: "back" }], DELETE_ROW],
};
const PROGRAMME_KEYBOARD = {
  inline_keyboard: [
    [{ text: "Computer Science", callback_data: "project:computer-science" }],
    [{ text: "Computer Science with Economics", callback_data: "project:computer-science-economics" }],
    [{ text: "Computer Engineering", callback_data: "project:computer-engineering" }],
    DELETE_ROW,
  ],
};
const TARGET_KEYBOARD = {
  inline_keyboard: [
    ...DEGREE_CLASSES.map((target) => [{
      text: `${target.name} · ${target.minimum.toFixed(2)}`,
      callback_data: `target:${target.id}`,
    }]),
    DELETE_ROW,
  ],
};

/** A half-finished /login expires after 10 minutes. */
const LOGIN_TIMEOUT_SECONDS = 600;
/** A PIN prompt expires after 2 minutes if nothing is entered. */
const PIN_TIMEOUT_SECONDS = 120;
const ACCESS_TIMEOUT_SECONDS = 300;
const PROJECT_ACCESS_TIMEOUT_SECONDS = 1800;
const MESSAGE_DELETE_WINDOW_SECONDS = 48 * 60 * 60;
const MESSAGE_HISTORY_LIMIT = 1000;
const MESSAGE_SWEEP_LIMIT = 1000;

interface TrackedMessage {
  id: number;
  date: number;
}

interface ProjectAccess {
  messageId: number;
  studentId: number;
  programmeId?: ProgrammeId;
  targetId?: DegreeClassId;
}

function projectionKeyboard(page: number, total: number, hasTerms: boolean) {
  const navigation = [];
  if (page > 0) navigation.push({ text: page === 1 ? "Overview" : "Previous", callback_data: `projection:${page - 1}` });
  if (page + 1 < total) navigation.push({
    text: page === 0 ? hasTerms ? "Start term plan" : "Plan boundaries" : page + 1 === total - 1 ? "Plan boundaries" : "Next term",
    callback_data: `projection:${page + 1}`,
  });
  return {
    inline_keyboard: [
      ...(navigation.length ? [navigation] : []),
      [{ text: "Change target", callback_data: "project:targets" }],
      DELETE_ROW,
    ],
  };
}

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

function protectedDestination(target: ProtectedAction): string {
  if (target === "results") return "semester results";
  if (target === "summary") return "academic summary";
  if (target === "analytics") return "academic trend";
  if (target === "compare") return "semester comparison";
  if (target === "project") return "honours projection";
  return "academic report";
}

export function createBot(env: BotEnv): Bot {
  const bot = new Bot(env.BOT_TOKEN, { client: { timeoutSeconds: 10 } });
  const chatId = Number(env.CHAT_ID);

  async function rememberMessage(id: number, date: number) {
    const cutoff = Math.floor(Date.now() / 1000) - MESSAGE_DELETE_WINDOW_SECONDS;
    const history = await env.STATE.get<TrackedMessage[]>("message_history", "json") ?? [];
    const retained = history.filter((message) => message.date > cutoff && message.id !== id);
    retained.push({ id, date });
    await env.STATE.put("message_history", JSON.stringify(retained.slice(-MESSAGE_HISTORY_LIMIT)));
  }

  bot.api.config.use(async (previous, method, payload, signal) => {
    const response = await previous(method, payload, signal);
    if ((method === "sendMessage" || method === "sendPhoto" || method === "sendDocument") && response.ok) {
      const message = response.result as { message_id: number; date: number };
      await rememberMessage(message.message_id, message.date);
    }
    return response;
  });

  bot.use(async (ctx, next) => {
    if (ctx.from?.id === chatId && ctx.chat?.type === "private" && ctx.chat.id === chatId) await next();
  });

  bot.use(async (ctx, next) => {
    if (ctx.message) await rememberMessage(ctx.message.message_id, ctx.message.date);
    await next();
  });

  async function askPin(ctx: Context, target: ProtectedAction) {
    await env.STATE.delete("login_state");
    await env.STATE.delete("result_access");
    await env.STATE.delete("project_access");
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
    await ctx.reply(configured
      ? "Enter your PIN."
      : `Create a 4 to 12 digit PIN. I'll continue to your ${protectedDestination(target)} after saving it.`);
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

  async function showAnalytics(ctx: Context) {
    const { results } = await loadResults(env);
    const analytics = analyzeResults(results);
    const caption = formatAnalytics(analytics);
    try {
      const chart = await renderAnalyticsChart(analytics);
      await ctx.replyWithPhoto(new InputFile(chart, "academic-trend.png"), {
        caption,
        parse_mode: "HTML",
        reply_markup: DELETE_KEYBOARD,
      });
    } catch {
      await ctx.reply(`${caption}\n\n<i>The chart is temporarily unavailable. Send /analytics to try it again.</i>`, {
        parse_mode: "HTML",
        reply_markup: DELETE_KEYBOARD,
      });
    }
  }

  async function showComparison(ctx: Context) {
    const { results } = await loadResults(env);
    await ctx.reply(formatSemesterComparison(results), {
      parse_mode: "HTML",
      reply_markup: DELETE_KEYBOARD,
    });
  }

  async function showReport(ctx: Context) {
    const { results, fetchedAt } = await loadResults(env);
    const report = await generateAcademicReport(results);
    await ctx.replyWithDocument(new InputFile(report, "ifemate-academic-report.pdf"), {
      caption: `Academic report generated from portal data refreshed ${formatTime(fetchedAt)}.`,
      reply_markup: DELETE_KEYBOARD,
    });
  }

  async function showProgrammePicker(ctx: Context) {
    const { studentId } = await loadResults(env);
    const message = await ctx.reply("<b>Select your programme</b>\nYour future courses and graduation-unit rules depend on this choice.", {
      parse_mode: "HTML",
      reply_markup: PROGRAMME_KEYBOARD,
    });
    await env.STATE.put("project_access", JSON.stringify({
      messageId: message.message_id,
      studentId,
    } satisfies ProjectAccess), { expirationTtl: PROJECT_ACCESS_TIMEOUT_SECONDS });
  }

  async function showProjection(ctx: Context, programmeId: ProgrammeId, targetId: DegreeClassId, page: number) {
    const { results } = await loadResults(env);
    const projection = projectHonors(results, programmeId, targetId);
    const pages = formatProjectionPages(projection);
    if (!pages[page]) return;
    await ctx.editMessageText(pages[page], {
      parse_mode: "HTML",
      reply_markup: projectionKeyboard(page, pages.length, projection.termPlans.length > 0),
    });
  }

  async function showProtected(ctx: Context, target: ProtectedAction) {
    if (target === "results") await showResults(ctx);
    else if (target === "summary") await showSummary(ctx);
    else if (target === "analytics") await showAnalytics(ctx);
    else if (target === "compare") await showComparison(ctx);
    else if (target === "project") await showProgrammePicker(ctx);
    else if (target === "report") await showReport(ctx);
  }

  async function completeLogin(ctx: Context, state: Extract<LoginState, { step: "password" }>, password: string) {
    await env.STATE.delete("login_state");
    await ctx.deleteMessage().catch(() => {});
    try {
      const payload = await prepareCredentials(env, { username: state.username, password });
      const session = await login(state.username, password);
      await saveAccount(env, session, payload);
      await ctx.reply("Logged in. Next, send /refresh to fetch your latest results, then use /results to browse by semester, /project for an honours plan, /compare for the cumulative breakdown, or /analytics for performance trends.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Login failed: ${escapeHtml(message)}. Send /login to try again.`, { parse_mode: "HTML" });
    }
  }

  bot.use(async (ctx, next) => {
    if (!ctx.message?.text || /^\/(?:cancel|clear|logout|login|setpin)(?:@\w+)?\s*$/.test(ctx.message.text)) return next();
    const state = await env.STATE.get<LoginState>("login_state", "json");
    if (state?.step === "password") await completeLogin(ctx, state, ctx.message.text);
    else await next();
  });

  bot.command("start", async (ctx) => {
    try {
      await ctx.api.setMyCommands(BOT_COMMANDS, { scope: { type: "all_private_chats" } });
    } catch (error) {
      console.error("Command menu sync failed", error);
    }
    await ctx.reply(HELP, { parse_mode: "HTML" });
  });
  bot.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("cancel", async (ctx) => {
    await env.STATE.write({}, ["login_state", "pin_state", "result_access", "project_access"]);
    await ctx.reply("Canceled. Send /start to see the available commands.");
  });

  bot.command("clear", async (ctx) => {
    const cutoff = Math.floor(Date.now() / 1000) - MESSAGE_DELETE_WINDOW_SECONDS;
    const history = await env.STATE.get<TrackedMessage[]>("message_history", "json") ?? [];
    const latestId = ctx.message?.message_id;
    if (latestId === undefined) return;
    const inferredIds = Array.from(
      { length: Math.min(latestId, MESSAGE_SWEEP_LIMIT) },
      (_, index) => latestId - index,
    );
    const trackedIds = history.filter((message) => message.date > cutoff).map((message) => message.id);
    const ids = [...new Set([...inferredIds, ...trackedIds])].sort((a, b) => b - a);
    for (let index = 0; index < ids.length; index += 100) {
      await ctx.deleteMessages(ids.slice(index, index + 100)).catch(() => {});
    }
    await env.STATE.write({}, ["message_history", "login_state", "pin_state", "result_access", "project_access"]);
  });

  bot.command("login", async (ctx) => {
    await env.STATE.write({}, ["pin_state", "result_access", "project_access"]);
    await env.STATE.put("login_state", JSON.stringify({ step: "username" }), {
      expirationTtl: LOGIN_TIMEOUT_SECONDS,
    });
    await ctx.reply("Send your matric number.");
  });

  bot.command("logout", async (ctx) => {
    await env.STATE.write({}, ACCOUNT_STATE_KEYS);
    await ctx.reply("Logged out and deleted your saved password. Send /login when you want to connect again.");
  });

  bot.command("setpin", async (ctx) => {
    await env.STATE.write({}, ["login_state", "pin_state", "result_access", "project_access"]);
    await env.STATE.put(
      "pin_state",
      JSON.stringify({ action: "set" } satisfies PinState),
      { expirationTtl: PIN_TIMEOUT_SECONDS },
    );
    await ctx.reply("Send a new 4 to 12 digit PIN. I'll delete your message after reading it.");
  });

  bot.command("results", (ctx) => askPin(ctx, "results"));
  bot.command("summary", (ctx) => askPin(ctx, "summary"));
  bot.command("analytics", (ctx) => askPin(ctx, "analytics"));
  bot.command("compare", (ctx) => askPin(ctx, "compare"));
  bot.command("project", (ctx) => askPin(ctx, "project"));
  bot.command("report", (ctx) => askPin(ctx, "report"));

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
        if (pin.target) {
          await ctx.reply(`PIN saved. Loading your ${protectedDestination(pin.target)} now.`);
          await showProtected(ctx, pin.target);
        } else {
          const session = await env.STATE.get<Session>("session", "json");
          await ctx.reply(session
            ? "PIN saved. Next, send /results to browse by semester, /project for an honours plan, /compare for the cumulative breakdown, /report for a PDF, or /analytics for trends."
            : "PIN saved. Next, send /login to connect your portal account.");
        }
        return;
      }

      const configured = await env.STATE.get("pin_digest");
      if (!configured || await digestPin(env.ENCRYPTION_KEY, text) !== configured) {
        await ctx.reply("Wrong PIN. Send /results, /summary, /project, /compare, /report, or /analytics to try again.");
        return;
      }

      await showProtected(ctx, pin.target);
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
    if (ctx.callbackQuery.data.startsWith("project:")) return next();
    if (ctx.callbackQuery.data.startsWith("target:")) return next();
    if (ctx.callbackQuery.data.startsWith("projection:")) return next();
    const access = await env.STATE.get<ResultAccess>("result_access", "json");
    const session = await env.STATE.get<Session>("session", "json");
    if (!access || access.messageId !== ctx.callbackQuery.message?.message_id ||
        !session || session.studentId !== access.studentId) {
      await ctx.answerCallbackQuery({ text: "Access expired. Send /results and enter your PIN.", show_alert: true });
      return;
    }
    await next();
  });

  bot.callbackQuery(/^project:(computer-science|computer-science-economics|computer-engineering)$/, async (ctx) => {
    const access = await env.STATE.get<ProjectAccess>("project_access", "json");
    const session = await env.STATE.get<Session>("session", "json");
    if (!access || access.messageId !== ctx.callbackQuery.message?.message_id || !session || session.studentId !== access.studentId) {
      await ctx.answerCallbackQuery({ text: "Access expired. Send /project and enter your PIN.", show_alert: true });
      return;
    }
    const programmeId = ctx.match[1] as ProgrammeId;
    await ctx.answerCallbackQuery();
    await env.STATE.put("project_access", JSON.stringify({
      messageId: access.messageId,
      studentId: access.studentId,
      programmeId,
    } satisfies ProjectAccess), { expirationTtl: PROJECT_ACCESS_TIMEOUT_SECONDS });
    await ctx.editMessageText([
      "<b>Choose your honours safety floor</b>",
      escapeHtml(PROGRAMMES[programmeId].name),
      "Select the minimum class you want to secure. The term plan will still aim for your highest mathematically attainable CGPA.",
    ].join("\n"), { parse_mode: "HTML", reply_markup: TARGET_KEYBOARD });
  });

  bot.callbackQuery("project:targets", async (ctx) => {
    const access = await env.STATE.get<ProjectAccess>("project_access", "json");
    const session = await env.STATE.get<Session>("session", "json");
    if (!access?.programmeId || access.messageId !== ctx.callbackQuery.message?.message_id || !session || session.studentId !== access.studentId) {
      await ctx.answerCallbackQuery({ text: "Access expired. Send /project and enter your PIN.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await env.STATE.put("project_access", JSON.stringify({
      messageId: access.messageId,
      studentId: access.studentId,
      programmeId: access.programmeId,
    } satisfies ProjectAccess), { expirationTtl: PROJECT_ACCESS_TIMEOUT_SECONDS });
    await ctx.editMessageText([
      "<b>Choose your honours safety floor</b>",
      escapeHtml(PROGRAMMES[access.programmeId].name),
      "Select the minimum class you want to secure. The term plan will still aim for your highest mathematically attainable CGPA.",
    ].join("\n"), { parse_mode: "HTML", reply_markup: TARGET_KEYBOARD });
  });

  bot.callbackQuery(/^target:(first-class|second-class-upper|second-class-lower|third-class|pass)$/, async (ctx) => {
    const access = await env.STATE.get<ProjectAccess>("project_access", "json");
    const session = await env.STATE.get<Session>("session", "json");
    if (!access?.programmeId || access.messageId !== ctx.callbackQuery.message?.message_id || !session || session.studentId !== access.studentId) {
      await ctx.answerCallbackQuery({ text: "Access expired. Send /project and enter your PIN.", show_alert: true });
      return;
    }
    const targetId = ctx.match[1] as DegreeClassId;
    await ctx.answerCallbackQuery();
    await env.STATE.put("project_access", JSON.stringify({ ...access, targetId } satisfies ProjectAccess), {
      expirationTtl: PROJECT_ACCESS_TIMEOUT_SECONDS,
    });
    await showProjection(ctx, access.programmeId, targetId, 0);
  });

  bot.callbackQuery(/^projection:(\d+)$/, async (ctx) => {
    const access = await env.STATE.get<ProjectAccess>("project_access", "json");
    const session = await env.STATE.get<Session>("session", "json");
    if (!access?.programmeId || !access.targetId || access.messageId !== ctx.callbackQuery.message?.message_id || !session || session.studentId !== access.studentId) {
      await ctx.answerCallbackQuery({ text: "Access expired. Send /project and enter your PIN.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await env.STATE.put("project_access", JSON.stringify(access), { expirationTtl: PROJECT_ACCESS_TIMEOUT_SECONDS });
    await showProjection(ctx, access.programmeId, access.targetId, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^sem:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const access = await env.STATE.get<ResultAccess>("result_access", "json");
    const key = access?.semesters[Number(ctx.match[1])];
    const { results } = await loadResults(env);
    const courses = key === undefined ? undefined : results[key];

    if (!key || !courses) {
      await ctx.editMessageText("That semester is no longer on the portal. Send /refresh, then open /results again.");
      return;
    }

    const pages = semesterPages(key, courses, results);
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
    await ctx.reply(`Results refreshed at ${formatTime(fetchedAt)}. Next, send /results to browse by semester, /project for an honours plan, /compare for the cumulative breakdown, /report for a PDF, or /analytics for trends.`);
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
      session
        ? "Next: send /refresh, /results, /project, /compare, /report, /summary, or /analytics."
        : "Next: send /login to connect your account.",
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
