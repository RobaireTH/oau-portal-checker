import { createBot } from "./bot";
import { escapeHtml } from "./format";
import { electiveProgress, isElective, semesterLabel, semesterProgress, summarize } from "./grades";
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

export function expand(snapshot: Snapshot): Results {
  const results: Results = {};
  for (const [id, course] of Object.entries(snapshot)) {
    const [semester] = JSON.parse(id) as [string, string];
    (results[semester] ??= []).push(course);
  }
  return results;
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

function transition(before: number | null, after: number | null): string {
  const left = before === null ? "n/a" : before.toFixed(2);
  const right = after === null ? "n/a" : after.toFixed(2);
  if (before === null || after === null) return `${left} -> ${right}`;
  const difference = after - before;
  if (Math.abs(difference) < 0.005) return `${left} -> ${right} (no change)`;
  return `${left} -> ${right} (${difference >= 0 ? "+" : ""}${difference.toFixed(2)})`;
}

function countTransition(before: number, after: number): string {
  const difference = after - before;
  if (!difference) return `${before} -> ${after} (no change)`;
  return `${before} -> ${after} (${difference > 0 ? "+" : ""}${difference})`;
}

function impactLines(changes: Change[], previous: Results, current: Results): string[] {
  const beforeProgress = new Map(semesterProgress(previous).map((semester) => [semester.key, semester]));
  const afterProgress = new Map(semesterProgress(current).map((semester) => [semester.key, semester]));
  const semesters = [...new Set(changes.map((change) => change.semester))];
  const lines = semesters.map((semester) => {
    const before = beforeProgress.get(semester)?.sgpa ?? null;
    const after = afterProgress.get(semester)?.sgpa ?? null;
    return `${semesterLabel(semester)} SGPA: ${transition(before, after)}`;
  });
  lines.push(`Current CGPA: ${transition(summarize(previous).cgpa, summarize(current).cgpa)}`);
  if (changes.some(({ entry, previous: old }) => isElective((entry ?? old)!.code))) {
    const before = electiveProgress(Object.values(previous).flat());
    const after = electiveProgress(Object.values(current).flat());
    lines.push(`Elective courses passed: ${countTransition(before.passedCourses, after.passedCourses)}`);
    lines.push(`Elective units passed: ${countTransition(before.passedUnits, after.passedUnits)}`);
    lines.push(`Elective status now: ${after.failedCourses} failed, ${after.pendingCourses} pending`);
    lines.push("Electives are tracked for graduation and excluded only from SGPA and CGPA.");
  }
  return lines;
}

export function formatChanges(changes: Change[], previous?: Results, current?: Results): string[] {
  const header = "<b>Results updated on the portal</b>";
  const messages: string[] = [];
  let message = header;
  for (const { semester, code, entry, previous } of changes) {
    const course = entry ?? previous!;
    const update = !entry ? "removed from the portal" : previous
      ? `changed from ${resultText(previous)} to ${resultText(entry)}` : resultText(entry);
    // Bound upstream strings before escaping; every line and HTML message fits Telegram's limit.
    const category = isElective(course.code) ? " [elective]" : "";
    const line = escapeHtml(`${semesterLabel(semester).slice(0, 60)}: ${code.slice(0, 40)}${category} ${course.title.slice(0, 120)} - ${update.slice(0, 180)}`);
    if (message.length + line.length + 1 > 3500) {
      messages.push(message);
      message = header;
    }
    message += `\n${line}`;
  }
  if (previous && current && changes.length) {
    const heading = "<b>Calculated impact</b>";
    const lines = impactLines(changes, previous, current).map(escapeHtml);
    const block = `${heading}\n${lines.join("\n")}`;
    if (message.length + block.length + 2 > 3500) {
      if (message !== header) messages.push(message);
      message = `${header}\n${block}`;
    } else {
      message += `\n\n${block}`;
    }
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
    const refreshed = await refreshResults(env);
    const currentResults = refreshed.results;
    const current = flatten(currentResults);
    const previous = await env.STATE.get<Snapshot>("snapshot", "json");
    if (!previous) {
      await env.STATE.put("snapshot", JSON.stringify(current));
    } else {
      const messages = formatChanges(diff(previous, current), expand(previous), currentResults);
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
