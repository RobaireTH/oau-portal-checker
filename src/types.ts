export interface Env extends Cloudflare.Env {}

export interface StateStore {
  get<T>(key: string, type: "json"): Promise<T | null>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  write(values: Record<string, string>, deleteKeys?: string[]): Promise<void>;
}

export interface BotEnv {
  STATE: StateStore;
  BOT_TOKEN: string;
  OWNER_ID: string;
  WEBHOOK_SECRET: string;
  /** Base64-encoded 32-byte key used to encrypt the saved portal password. */
  ENCRYPTION_KEY: string;
}

export interface Course {
  code: string;
  title: string;
  unit: number;
  score: number | null;
  grade: string;
}

export type Results = Record<string, Course[]>;

export interface CachedResults {
  studentId: number;
  results: Results;
  fetchedAt: string;
}

export interface Session {
  token: string;
  studentId: number;
  loggedInAt: string;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface EncryptedPayload {
  iv: string;
  data: string;
}

export interface LastCheck {
  at: string;
  ok: boolean;
  error?: string;
}

/** Progress of a `/login` conversation. The password is never stored unencrypted. */
export type LoginState =
  { step: "username" } | { step: "password"; username: string };

export type ProtectedAction = "results" | "summary";

export type PinState =
  { action: "verify"; target: ProtectedAction } |
  { action: "set"; target?: ProtectedAction };

export interface ResultAccess {
  messageId: number;
  studentId: number;
  semesters: string[];
}
