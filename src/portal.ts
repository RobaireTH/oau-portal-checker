import { loadCredentials } from "./credentials";
import type { BotEnv, Course, Results, Session } from "./types";

const BASE_URL = "https://eportal2.oauife.edu.ng";
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/student`,
};

export class PortalError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class NotLoggedInError extends Error {}

async function portalRequest<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new PortalError(`Portal request failed (status ${response.status})`, response.status);
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new PortalError("Portal request timed out. Please try again.", 408);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCsrf(): Promise<{ token: string; cookie: string }> {
  return portalRequest(BASE_URL, {
    headers: { ...DEFAULT_HEADERS, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", Referer: `${BASE_URL}/` },
  }, async (response) => {
    const html = await response.text();
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    if (!match) throw new Error("CSRF token not found");
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { token: match[1], cookie };
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid portal ${label}`);
  return value as Record<string, unknown>;
}

function numeric(value: unknown, label: string): number {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error(`Invalid portal ${label}`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid portal ${label}`);
  return number;
}

export function normalizeResults(payload: unknown): Results {
  const result = record(record(payload, "response").result, "results");
  return Object.fromEntries(Object.entries(result).map(([semester, rawCourses]) => {
    if (!Array.isArray(rawCourses)) throw new Error(`Invalid portal courses for ${semester}`);
    const courses: Course[] = rawCourses.map((raw) => {
      const course = record(raw, "course");
      if (typeof course.course_code !== "string" || !course.course_code.trim() || typeof course.course_title !== "string") throw new Error("Invalid portal course details");
      if (course.grade !== null && course.grade !== undefined && typeof course.grade !== "string") throw new Error("Invalid portal grade");
      const score = course.total_score === null || course.total_score === undefined || course.total_score === ""
        ? null : numeric(course.total_score, "score");
      if (score !== null && score > 100) throw new Error("Invalid portal score");
      return {
        code: course.course_code.trim(), title: course.course_title.trim(),
        unit: numeric(course.credit_unit, "credit unit"), score,
        grade: typeof course.grade === "string" ? course.grade.trim().toUpperCase() : "",
      };
    });
    return [semester, courses];
  }));
}

/** Authenticate first; callers publish the session and encrypted credentials atomically. */
export async function login(username: string, password: string): Promise<Session> {
  const { token, cookie } = await fetchCsrf();
  return portalRequest(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, "Content-Type": "application/json", Referer: `${BASE_URL}/`, "X-CSRF-TOKEN": token, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ username, password }),
  }, async (response) => {
    const data = record(record(await response.json(), "login response").data, "login data");
    const studentId = numeric(data.id, "student ID");
    if (!Number.isSafeInteger(studentId) || studentId === 0 || typeof data.tertiary_token !== "string" || !data.tertiary_token) throw new Error("Invalid portal session");
    return { token: data.tertiary_token, studentId, loggedInAt: new Date().toISOString() };
  });
}

async function getResults(session: Session): Promise<Results> {
  return portalRequest(`${BASE_URL}/api/students/student-results-spreadsheet/${session.studentId}`, {
    headers: { ...DEFAULT_HEADERS, Authorization: `Bearer ${session.token}` },
  }, async (response) => normalizeResults(await response.json()));
}

async function reLogin(env: BotEnv): Promise<Session> {
  const credentials = await loadCredentials(env);
  if (!credentials) throw new NotLoggedInError("Not logged in. Send /login to connect your portal account.");
  try {
    const session = await login(credentials.username, credentials.password);
    const oldSession = await env.STATE.get<Session>("session", "json");
    if (oldSession && session.studentId !== oldSession.studentId) throw new NotLoggedInError("Portal account changed. Send /login to reconnect.");
    await env.STATE.put("session", JSON.stringify(session));
    return session;
  } catch (error) {
    if (error instanceof PortalError && [401, 403, 422].includes(error.status)) throw new NotLoggedInError("Saved portal login was rejected. Send /login to reconnect.");
    throw error;
  }
}

export async function fetchResults(env: BotEnv): Promise<Results> {
  const session = await env.STATE.get<Session>("session", "json") ?? await reLogin(env);
  try {
    return await getResults(session);
  } catch (error) {
    if (error instanceof PortalError && error.status === 401) return getResults(await reLogin(env));
    throw error;
  }
}
