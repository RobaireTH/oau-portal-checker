import type { StateStore } from "./types";

interface StoredValue {
  value: string;
  expiresAt?: number;
}

export const ACCOUNT_STATE_KEYS = [
  "session", "credentials", "results", "snapshot", "last_check", "login_reminder",
  "pending_notification", "login_state", "pin_state", "result_access", "project_access",
];

export class DurableStateStore implements StateStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  get<T>(key: string, type: "json"): Promise<T | null>;
  get(key: string): Promise<string | null>;
  async get<T>(key: string, type?: "json"): Promise<T | string | null> {
    const stored = await this.storage.get<StoredValue>(`state:${key}`);
    if (!stored || (stored.expiresAt !== undefined && stored.expiresAt <= Date.now())) {
      return null;
    }
    return type === "json" ? JSON.parse(stored.value) as T : stored.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    await this.storage.put(`state:${key}`, {
      value,
      ...(options?.expirationTtl === undefined ? {} : {
        expiresAt: Date.now() + options.expirationTtl * 1000,
      }),
    } satisfies StoredValue);
  }

  async delete(key: string) {
    await this.storage.delete(`state:${key}`);
  }

  async write(values: Record<string, string>, deleteKeys: string[] = []) {
    await this.storage.transaction(async (txn) => {
      if (deleteKeys.length) await txn.delete(deleteKeys.map((key) => `state:${key}`));
      const entries = Object.fromEntries(Object.entries(values).map(([key, value]) => [
        `state:${key}`, { value } satisfies StoredValue,
      ]));
      if (Object.keys(entries).length) await txn.put(entries);
    });
  }
}
