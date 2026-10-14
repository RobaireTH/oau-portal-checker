import { decrypt, encrypt } from "./crypto";
import { ACCOUNT_STATE_KEYS } from "./state";
import type { Credentials, BotEnv, EncryptedPayload, Session } from "./types";

/** Stores the portal login encrypted, so the bot can log in again after the session expires. */
export async function prepareCredentials(env: BotEnv, credentials: Credentials): Promise<EncryptedPayload> {
  return encrypt(env.ENCRYPTION_KEY, JSON.stringify(credentials));
}

export async function saveAccount(env: BotEnv, session: Session, payload: EncryptedPayload): Promise<void> {
  await env.STATE.write({
    session: JSON.stringify(session),
    credentials: JSON.stringify(payload),
  }, ACCOUNT_STATE_KEYS);
}

export async function loadCredentials(env: BotEnv): Promise<Credentials | null> {
  const payload = await env.STATE.get<EncryptedPayload>("credentials", "json");
  if (!payload) return null;

  return JSON.parse(await decrypt(env.ENCRYPTION_KEY, payload)) as Credentials;
}

export async function hasCredentials(env: BotEnv): Promise<boolean> {
  return (await env.STATE.get("credentials")) !== null;
}
