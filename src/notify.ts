import { createBot } from "./bot";
import { escapeHtml } from "./format";
import { semesterLabel } from "./grades";
import { refreshResults } from "./cache";
import { NotLoggedInError } from "./portal";
import type { BotEnv, Course, LastCheck, Results } from "./types";

export type Snapshot = Record<string, Course>;
export interface Change {
  semester: string;
  code: string;
  entry?: Course;
  previous?: Course;
}

interface PendingNotification {
  snapshot: Snapshot;
  messages: string[];
  next: number;
}

export function flatten(results: Results): Snapshot {
  return Object.fromEntries(Object.entries(results).flatMap(([semester, courses]) =>
    courses.map((course) => [JSON.stringify([semester, course.code]), course])));
}

export function diff(previous: Snapshot, current: Snapshot): Change[] {
  const changes: Change[] = [];
  for (const id of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    const old = previous[id];
    const entry = current[id];
    if (old && entry && old.score === entry.score && old.grade === entry.grade &&
        old.title === entry.title && old.unit === entry.unit) continue;
    const [semester, code] = JSON.parse(id) as [string, string];
    changes.push({ semester, code, entry, previous: old });
  }
  return changes;
}

function resultText(course: Course): string {
  return `${course.score ?? "pending"} (${course.grade || "pending"}), ${course.unit} units`;
}

export function formatChanges(changes: Change[]): string[] {
  const header = "<b>Results updated on the portal</b>";
  const messages: string[] = [];
  let message = header;
  for (const { semester, code, entry, previous } of changes) {
    const course = entry ?? previous!;
    const update = !entry ? "removed from the portal" : previous
      ? `changed from ${resultText(previous)} to ${resultText(entry)}` : resultText(entry);
    // Bound upstream strings before escaping; every line and HTML message fits Telegram's limit.
    const line = escapeHtml(`${semesterLabel(semester).slice(0, 60)}: ${code.slice(0, 40)} ${course.title.slice(0, 120)} - ${update.slice(0, 180)}`);
    if (message.length + line.length + 1 > 3500) {
      messages.push(message);
      message = header;
    }
    message += `\n${line}`;
  }
  if (message !== header) messages.push(message);
  return messages;
}

type Send = (message: string, html: boolean) => Promise<unknown>;

async function flushPending(env: BotEnv, send: Send): Promise<void> {
  const pending = await env.STATE.get<PendingNotification>("pending_notification", "json");
  if (!pending) return;
  while (pending.next < pending.messages.length) {
    await send(pending.messages[pending.next], true);
    pending.next += 1;
    await env.STATE.put("pending_notification", JSON.stringify(pending));
  }
  await env.STATE.write({ snapshot: JSON.stringify(pending.snapshot) }, ["pending_notification"]);
}

/** Sending can be injected in tests without contacting Telegram. */
export async function checkForNewResults(env: BotEnv, send: Send = (message, html) =>
  createBot(env).api.sendMessage(env.OWNER_ID, message, html ? { parse_mode: "HTML" } : {}),
): Promise<void> {
  const checkedAt = new Date().toISOString();
  try {
    await flushPending(env, send);
    const current = flatten((await refreshResults(env)).results);
    const previous = await env.STATE.get<Snapshot>("snapshot", "json");
    if (!previous) {
      await env.STATE.put("snapshot", JSON.stringify(current));
    } else {
      const messages = formatChanges(diff(previous, current));
      if (messages.length) {
        await env.STATE.put("pending_notification", JSON.stringify({
          snapshot: current, messages, next: 0,
        } satisfies PendingNotification));
        await flushPending(env, send);
      } else {
        await env.STATE.put("snapshot", JSON.stringify(current));
      }
    }
    await env.STATE.write({ last_check: JSON.stringify({ at: checkedAt, ok: true } satisfies LastCheck) }, ["login_reminder"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.STATE.put("last_check", JSON.stringify({ at: checkedAt, ok: false, error: message } satisfies LastCheck));
    if (error instanceof NotLoggedInError && await env.STATE.get("login_reminder") !== message) {
      await send(message, false);
      await env.STATE.put("login_reminder", message);
    }
  }
}
