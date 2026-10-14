import { fetchResults, NotLoggedInError } from "./portal";
import type { CachedResults, BotEnv, Session } from "./types";

/** Downloads results from the portal and stores them in KV. Used by the cron job and /refresh. */
export async function refreshResults(env: BotEnv): Promise<CachedResults> {
  const results = await fetchResults(env);
  const session = await env.STATE.get<Session>("session", "json");
  if (!session) throw new NotLoggedInError("Not logged in. Send /login.");
  const cached: CachedResults = {
    studentId: session.studentId,
    results,
    fetchedAt: new Date().toISOString(),
  };

  await env.STATE.put("results", JSON.stringify(cached));

  return cached;
}

/** Reads results from KV. Only goes to the portal if nothing has been cached yet. */
export async function loadResults(env: BotEnv): Promise<CachedResults> {
  const session = await env.STATE.get<Session>("session", "json");
  const cached = await env.STATE.get<CachedResults>("results", "json");
  return session && cached?.studentId === session.studentId ? cached : refreshResults(env);
}
