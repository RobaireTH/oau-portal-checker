import { expect, test } from "bun:test";
import { deployedUrl, registerWebhook } from "../scripts/deploy";

test("uses deployment URL instead of cron targets or preview URLs", () => {
  const output = [
    JSON.stringify({ type: "version-upload", preview_url: "https://preview.example.com" }),
    JSON.stringify({ type: "deploy", targets: ["schedule: */15 * * * *", "https://bot.example.com"] }),
  ].join("\n");
  expect(deployedUrl(output)).toBe("https://bot.example.com");
  expect(() => deployedUrl(JSON.stringify({ type: "deploy", targets: [] }))).toThrow("public URL");
});

test("registers deployed webhook with its secret and sequential delivery", async () => {
  let payload: unknown;
  const request = (async (url, init) => {
    expect(String(url)).toBe("https://api.telegram.org/botdummy/setWebhook");
    expect(init?.method).toBe("POST");
    payload = JSON.parse(init!.body as string);
    return Response.json({ ok: true, result: true });
  }) as typeof fetch;
  await registerWebhook("https://bot.example.com", "dummy", "secret", request);
  expect(payload).toEqual({ url: "https://bot.example.com/webhook", secret_token: "secret", max_connections: 1 });
});

test("reports registration failures without leaking bot tokens", async () => {
  await expect(registerWebhook("https://bot.example.com", "sensitive-token", "secret", (async () => {
    throw new Error("https://api.telegram.org/botsensitive-token/setWebhook");
  }) as typeof fetch)).rejects.toThrow("could not connect");
  await expect(registerWebhook("https://bot.example.com", "dummy", "secret", (async () =>
    Response.json({ ok: false }, { status: 401 })) as typeof fetch)).rejects.toThrow("HTTP 401");
});
