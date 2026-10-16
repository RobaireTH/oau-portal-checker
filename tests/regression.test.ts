import { afterEach, expect, test } from "bun:test";
import type { Update } from "grammy/types";
import { analyzeResults, analyticsChartRequest, formatAnalytics, renderAnalyticsChart } from "../src/analytics";
import { createBot } from "../src/bot";
import { loadResults } from "../src/cache";
import { decrypt, digestPin, encrypt } from "../src/crypto";
import { semesterPages } from "../src/format";
import { gpa, summarize } from "../src/grades";
import { Inbox } from "../src/inbox";
import { checkForNewResults, diff, flatten, formatChanges } from "../src/notify";
import { login, normalizeResults } from "../src/portal";
import { ACCOUNT_STATE_KEYS, DurableStateStore } from "../src/state";
import { isOwnerUpdate, processUpdate } from "../src/updates";
import type { BotEnv, Course } from "../src/types";

class MemoryStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  async get(key: string) { return structuredClone(this.values.get(key)); }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    for (const [k, v] of typeof key === "string" ? [[key, value]] : Object.entries(key)) this.values.set(k, structuredClone(v));
  }
  async delete(key: string | string[]) {
    let count = 0;
    for (const k of Array.isArray(key) ? key : [key]) if (this.values.delete(k)) count++;
    return count;
  }
  async getAlarm() { return this.alarm; }
  async setAlarm(time: number) { this.alarm = time; }
  transaction<T>(fn: (txn: MemoryStorage) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const before = structuredClone(this.values);
      const alarm = this.alarm;
      try { return await fn(this); } catch (error) { this.values = before; this.alarm = alarm; throw error; }
    });
    this.tail = run.catch(() => {});
    return run;
  }
}

const key = btoa("x".repeat(32));
const course: Course = { code: "CSC201", title: "Programming", unit: 3, score: 75, grade: "A" };
const session = { token: "dummy", studentId: 1, loggedInAt: new Date().toISOString() };
const cache = { studentId: 1, results: { "121": [course] }, fetchedAt: new Date().toISOString() };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

async function setup(seed: Record<string, unknown> = {}) {
  const storage = new MemoryStorage();
  const state = new DurableStateStore(storage as unknown as DurableObjectStorage);
  for (const [k, v] of Object.entries(seed)) await state.put(k, typeof v === "string" ? v : JSON.stringify(v));
  const env: BotEnv = { STATE: state, BOT_TOKEN: "123:dummy", OWNER_ID: "42", WEBHOOK_SECRET: "dummy", ENCRYPTION_KEY: key };
  const bot = createBot(env);
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "getMe" ? { id: 123, is_bot: true, first_name: "Test", username: "test_bot" }
      : method === "sendMessage" ? { message_id: 77, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: "private" }, text: payload.text }
      : method === "sendPhoto" ? { message_id: 78, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: "private" }, photo: [] } : true } as any;
  });
  return { storage, state, env, bot, calls };
}

let updateId = 0;
function message(text: string, group = false, sender = 42): Update {
  return { update_id: ++updateId, message: {
    message_id: updateId, date: Math.floor(Date.now() / 1000), from: { id: sender, is_bot: false, first_name: "Owner" },
    chat: group ? { id: -100, type: "supergroup", title: "Group" } : { id: 42, type: "private", first_name: "Owner" }, text,
    ...(text.startsWith("/") ? { entities: [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] } : {}),
  } };
}

function callback(data = "sem:0:0"): Update {
  return { update_id: ++updateId, callback_query: { id: "callback", from: { id: 42, is_bot: false, first_name: "Owner" },
    chat_instance: "test", data, message: { message_id: 77, date: 0, chat: { id: 42, type: "private", first_name: "Owner" }, text: "Picker" } } };
}

function mockPortal(courses: Course[]) {
  globalThis.fetch = (async () => Response.json({ result: { "121": courses.map(c => ({
    course_code: c.code, course_title: c.title, credit_unit: c.unit, total_score: c.score, grade: c.grade,
  })) } })) as typeof fetch;
}

test("fresh bot initializes and dispatches webhook updates", async () => {
  const { bot, calls } = await setup();
  await processUpdate(bot, message("/start"));
  await processUpdate(bot, message("/start"));
  expect(calls.filter(c => c.method === "getMe")).toHaveLength(1);
  expect(calls.filter(c => c.method === "sendMessage")).toHaveLength(2);
});

test("owner group messages and other users cannot enter private flows", async () => {
  const { bot, calls } = await setup({ session, results: cache });
  const group = message("/summary", true);
  expect(isOwnerUpdate(group, 42)).toBe(false);
  await processUpdate(bot, group);
  await processUpdate(bot, message("/summary", false, 99));
  expect(calls.filter(c => c.method === "sendMessage")).toHaveLength(0);
});

test("webhook processing invokes the configured error handler", async () => {
  const { bot, env, calls } = await setup();
  env.STATE.get = async () => { throw new Error("Mock storage failure"); };
  await processUpdate(bot, message("/status"));
  expect(calls.some(c => c.payload.text?.startsWith("Something went wrong"))).toBe(true);
});

test("logout clears account data and old result buttons", async () => {
  const seed = Object.fromEntries(ACCOUNT_STATE_KEYS.map(k => [k, {}]));
  const { bot, state, env, calls } = await setup({ ...seed, session, results: cache });
  await processUpdate(bot, message("/logout"));
  for (const k of ACCOUNT_STATE_KEYS) expect(await state.get(k)).toBeNull();
  await expect(loadResults(env)).rejects.toThrow("Not logged in");
  await processUpdate(bot, callback());
  expect(calls.some(c => c.method === "editMessageText")).toBe(false);
});

test("starting login cancels a pending PIN prompt", async () => {
  const { bot, state, calls } = await setup();
  await processUpdate(bot, message("/summary"));
  await processUpdate(bot, message("/login"));
  await processUpdate(bot, message("TEST/2000/000"));
  expect(await state.get("pin_state")).toBeNull();
  expect(await state.get("login_state", "json")).toEqual({ step: "password", username: "TEST/2000/000" });
  expect(calls.some(c => c.payload.text?.startsWith("Wrong PIN"))).toBe(false);
});

test("clear sweeps prior message IDs and tracked history in batches", async () => {
  const date = Math.floor(Date.now() / 1000);
  const tracked = [{ id: 77, date }, ...Array.from({ length: 205 }, (_, index) => ({ id: index + 1000, date }))];
  const { bot, state, calls } = await setup({ message_history: tracked });
  const clear = message("/clear");
  await processUpdate(bot, clear);
  const deletions = calls.filter(c => c.method === "deleteMessages");
  const deleted = deletions.flatMap(c => c.payload.message_ids);
  expect(deletions).toHaveLength(3);
  expect(deletions.every(c => c.payload.message_ids.length <= 100)).toBe(true);
  expect(deleted).toContain(clear.message!.message_id);
  expect(deleted).toContain(clear.message!.message_id - 1);
  expect(deleted).toContain(77);
  expect(deleted).toContain(1204);
  expect(await state.get("message_history")).toBeNull();
});

test("first protected command creates the PIN inside Telegram", async () => {
  const { bot, state, calls } = await setup({ session, results: cache });
  await processUpdate(bot, message("/results"));
  await processUpdate(bot, message("1234"));
  const stored = await state.get("pin_digest");
  expect(stored).toBe(await digestPin(key, "1234"));
  expect(stored).not.toContain("1234");
  expect(calls.some(c => c.method === "deleteMessage")).toBe(true);
  expect(calls.some(c => c.method === "sendMessage" && c.payload.text === "PIN saved. Loading your semester results now.")).toBe(true);
  expect(calls.some(c => c.method === "sendMessage" && c.payload.text.startsWith("Pick a semester"))).toBe(true);
});

test("PIN setup rejects invalid values without ending the prompt", async () => {
  const { bot, state, calls } = await setup();
  await processUpdate(bot, message("/setpin"));
  await processUpdate(bot, message("12ab"));
  expect(await state.get("pin_digest")).toBeNull();
  expect(await state.get("pin_state", "json")).toEqual({ action: "set" });
  expect(calls.some(c => c.payload.text?.startsWith("PIN must contain"))).toBe(true);
});

test("password whitespace and slash prefixes survive login; old account data is reset", async () => {
  const { bot, state, calls } = await setup({ login_state: { step: "password", username: "TEST/2000/000" }, session, results: cache, snapshot: {} });
  let sentPassword: string | undefined;
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("/api/login")) {
      sentPassword = JSON.parse(init!.body as string).password;
      return Response.json({ data: { id: "2", tertiary_token: "new" } });
    }
    return new Response('<meta name="csrf-token" content="dummy">');
  }) as typeof fetch;
  await processUpdate(bot, message("/secret "));
  expect(sentPassword).toBe("/secret ");
  expect(await state.get("results")).toBeNull();
  expect(await state.get("snapshot")).toBeNull();
  expect((await state.get<any>("session", "json"))?.studentId).toBe(2);
  const encrypted = await state.get<any>("credentials", "json");
  expect(JSON.parse(await decrypt(key, encrypted)).password).toBe("/secret ");
  expect(calls.some(c => c.payload.text?.includes("/refresh") && c.payload.text?.includes("/results"))).toBe(true);
});

test("credential encryption failure cannot replace the active account", async () => {
  const { bot, env, state } = await setup({ session, login_state: { step: "password", username: "new" } });
  env.ENCRYPTION_KEY = btoa("short");
  let fetched = false;
  globalThis.fetch = (async () => { fetched = true; throw new Error("Unexpected fetch"); }) as typeof fetch;
  await processUpdate(bot, message("password"));
  expect(fetched).toBe(false);
  expect(await state.get("session", "json")).toEqual(session);
});

test("valid PIN grants access to its picker; expired authorization denies navigation", async () => {
  const { bot, state, calls } = await setup({ session, results: cache, pin_digest: await digestPin(key, "1234") });
  await processUpdate(bot, message("/results"));
  await processUpdate(bot, message("1234"));
  await processUpdate(bot, callback());
  expect(calls.some(c => c.method === "editMessageText" && c.payload.text.includes("Programming"))).toBe(true);
  const edits = calls.filter(c => c.method === "editMessageText").length;
  await state.put("result_access", JSON.stringify({ messageId: 77, studentId: 1, semesters: ["121"] }), { expirationTtl: -1 });
  await processUpdate(bot, callback());
  expect(calls.filter(c => c.method === "editMessageText")).toHaveLength(edits);
  expect(calls.some(c => c.method === "answerCallbackQuery" && c.payload.show_alert)).toBe(true);
});

test("cache from another student is refreshed before display", async () => {
  const { env } = await setup({ session: { ...session, studentId: 2 }, results: cache });
  mockPortal([{ ...course, title: "New account" }]);
  const result = await loadResults(env);
  expect(result.studentId).toBe(2);
  expect(result.results["121"][0].title).toBe("New account");
});

test("numeric strings are normalized and pending grades do not corrupt GPA", () => {
  const results = normalizeResults({ result: { "121": [
    { course_code: "CSC201", course_title: "A", credit_unit: "3", total_score: "75", grade: " a " },
    { course_code: "CSC202", course_title: "B", credit_unit: "3", total_score: 65, grade: "B" },
    { course_code: "CSC203", course_title: "Pending", credit_unit: "3", total_score: null, grade: null },
  ] } });
  expect(gpa(results["121"])).toBe(4.5);
  expect(summarize(results)).toMatchObject({ pending: 1, unitsPassed: 6, unitsAttempted: 6 });
  expect(() => normalizeResults({ result: null })).toThrow();
  expect(() => normalizeResults({ result: { "121": [{ course_code: "A", course_title: "B", credit_unit: "bad" }] } })).toThrow();
});

test("analytics calculates chronological GPA trends and performance extremes", () => {
  const results = {
    "122": [
      { ...course, code: "CSC202", score: 65, grade: "B" },
      { ...course, code: "MTH202", score: 55, grade: "C" },
    ],
    "121": [
      { ...course, code: "CSC201", score: 75, grade: "A" },
      { ...course, code: "MTH201", score: 65, grade: "B" },
      { ...course, code: "SEA001", score: 0, grade: "F" },
    ],
  };
  const analytics = analyzeResults(results);
  expect(analytics.trend.map(point => point.key)).toEqual(["121", "122"]);
  expect(analytics.trend.map(point => point.sgpa)).toEqual([4.5, 3.5]);
  expect(analytics.currentCgpa).toBe(4);
  expect(analytics.peakCgpa?.cgpa).toBe(4.5);
  expect(analytics.highestSgpa?.key).toBe("121");
  expect(analytics.lowestSgpa?.key).toBe("122");
  expect(analytics.latestChange).toBe(-1);
  expect(analytics.averageScore).toBe(65);
  expect(analytics.highestScore).toEqual({ code: "CSC201", score: 75 });
  expect(analytics.lowestScore).toEqual({ code: "MTH202", score: 55 });
  expect(analytics.gradeDistribution).toEqual({ A: 1, B: 2, C: 1, D: 0, E: 0, F: 0 });
  expect(formatAnalytics(analytics)).toContain("CGPA ATH");
  expect(analyticsChartRequest(analytics).chart.data.datasets).toHaveLength(2);
});

test("analytics chart uses aggregate data and validates the PNG response", async () => {
  const analytics = analyzeResults({ "121": [course] });
  let requestBody: any;
  const image = await renderAnalyticsChart(analytics, (async (_url, init) => {
    requestBody = JSON.parse(init!.body as string);
    return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch);
  expect([...image]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(JSON.stringify(requestBody)).not.toContain(course.title);
  expect(requestBody.chart.data.datasets[0].data).toEqual([5]);
  await expect(renderAnalyticsChart(analytics, (async () => new Response("failed", { status: 503 })) as typeof fetch)).rejects.toThrow("Chart rendering failed");
});

test("analytics is PIN protected and sends a chart with statistics", async () => {
  const { bot, calls } = await setup({ session, results: cache, pin_digest: await digestPin(key, "1234") });
  globalThis.fetch = (async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "Content-Type": "image/png" } })) as typeof fetch;
  await processUpdate(bot, message("/analytics"));
  await processUpdate(bot, message("1234"));
  expect(calls.some(c => c.method === "sendPhoto" && c.payload.caption.includes("Academic Analytics"))).toBe(true);
});

test("large semester tables paginate and retain the full-semester GPA", () => {
  const courses = Array.from({ length: 200 }, (_, i) => ({ ...course, code: `CSC${i + 200}`, title: "<&>".repeat(30), grade: i % 2 ? "B" : "A" }));
  const pages = semesterPages("121", courses);
  expect(pages.length).toBeGreaterThan(1);
  for (const page of pages) {
    expect(page.length).toBeLessThan(4096);
    expect(page).toContain("4.50");
    expect(page).toContain("</pre>");
  }
});

test("removals and metadata corrections are detected and formatted safely", () => {
  const previous = flatten({ "121": [course] });
  expect(diff(previous, {})).toHaveLength(1);
  expect(formatChanges(diff(previous, {}))[0]).toContain("removed");
  expect(diff(previous, flatten({ "121": [{ ...course, unit: 4 }] }))).toHaveLength(1);
  const changes = diff({}, flatten({ "121": Array.from({ length: 200 }, (_, i) => ({ ...course, code: `CSC${i}`, title: "<&>".repeat(100) })) }));
  for (const text of formatChanges(changes)) expect(text.length).toBeLessThan(4096);
});

test("failed notification chunk resumes after already-delivered chunks", async () => {
  const { env, state } = await setup({ session, snapshot: {} });
  const courses = Array.from({ length: 200 }, (_, i) => ({ ...course, code: `CSC${i}`, title: "Course title ".repeat(10).trim() }));
  mockPortal(courses);
  const sent: string[] = [];
  let calls = 0;
  await checkForNewResults(env, async text => { if (++calls === 2) throw new Error("Telegram unavailable"); sent.push(text); });
  expect((await state.get<any>("pending_notification", "json")).next).toBe(1);
  const first = sent[0];
  await checkForNewResults(env, async text => { sent.push(text); });
  expect(sent.filter(t => t === first)).toHaveLength(1);
  expect(await state.get("pending_notification")).toBeNull();
  expect(await state.get("snapshot", "json")).toEqual(flatten({ "121": courses }));
});

test("failed login reminder is retried and suppressed only after delivery", async () => {
  const { env, state } = await setup();
  await expect(checkForNewResults(env, async () => { throw new Error("Telegram unavailable"); })).rejects.toThrow();
  expect(await state.get("login_reminder")).toBeNull();
  let delivered = 0;
  await checkForNewResults(env, async () => { delivered++; });
  await checkForNewResults(env, async () => { delivered++; });
  expect(delivered).toBe(1);
});

test("inbox persists encrypted updates, deduplicates retries, and retains newly appended jobs", async () => {
  const { storage } = await setup();
  const inbox = new Inbox(storage as unknown as DurableObjectStorage, key);
  const update = message("private-password");
  await Promise.all([inbox.enqueue(update), inbox.enqueue(update)]);
  expect(JSON.stringify(await storage.get("inbox"))).not.toContain("private-password");
  const first = (await inbox.peek())!;
  if (first.kind !== "update") throw new Error("Wrong job type");
  expect(JSON.parse(await decrypt(key, first.payload))).toEqual(update);
  await inbox.enqueue(message("next"));
  await inbox.complete(first);
  await inbox.enqueue(update);
  expect((await storage.get("inbox") as unknown[]).length).toBe(1);
  expect(storage.alarm).not.toBeNull();
});

test("login response validation rejects malformed sessions", async () => {
  globalThis.fetch = (async url => String(url).endsWith("/api/login")
    ? Response.json({ data: { id: 1 } }) : new Response('<meta name="csrf-token" content="dummy">')) as typeof fetch;
  await expect(login("dummy", "dummy")).rejects.toThrow("Invalid portal session");
});

test("AES-GCM round trip and tamper rejection", async () => {
  const payload = await encrypt(key, "dummy password");
  expect(await decrypt(key, payload)).toBe("dummy password");
  const bytes = Uint8Array.from(atob(payload.data), c => c.charCodeAt(0));
  bytes[0] ^= 1;
  payload.data = btoa(String.fromCharCode(...bytes));
  await expect(decrypt(key, payload)).rejects.toThrow();
});
