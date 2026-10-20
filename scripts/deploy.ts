import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

export function deployedUrl(output: string): string {
  const entries = output.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
  const deployment = entries.findLast(entry => entry.type === "deploy");
  const url = deployment?.targets?.find((target: unknown) => typeof target === "string" && target.startsWith("https://"));
  if (!url) throw new Error("Worker deployed, but its public URL was not found in Wrangler output.");
  return url;
}

export async function registerWebhook(workerUrl: string, token: string, secret: string, request = fetch): Promise<void> {
  const url = new URL("/webhook", workerUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Webhook requires a public HTTPS Worker URL.");
  let response: Response;
  try {
    response = await request(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.href, secret_token: secret, max_connections: 1 }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Fetch errors may include the request URL containing the bot token.
    throw new Error("Worker deployed, but Telegram webhook registration could not connect. Rerun deployment to retry.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true || result?.result !== true) {
    throw new Error(`Worker deployed, but Telegram webhook registration failed (HTTP ${response.status}). Check BOT_TOKEN and WEBHOOK_SECRET, then retry.`);
  }
  console.log(`Telegram webhook registered: ${url.href}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    const process = Bun.spawn(["bunx", "wrangler", "deploy", ...args], { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    if (await process.exited !== 0) throw new Error("Wrangler exited unsuccessfully.");
    return;
  }
  const dryRun = args.includes("--dry-run");
  const index = args.indexOf("--secrets-file");
  const inlineFile = args.find(arg => arg.startsWith("--secrets-file="))?.slice("--secrets-file=".length);
  const secretsFile = inlineFile ?? (index >= 0 ? args[index + 1] : ".dev.vars");
  if (!secretsFile || secretsFile.startsWith("--")) throw new Error("Provide a path after --secrets-file.");
  let secrets: Record<string, string> = {};
  if (!dryRun) {
    const contents = await readFile(secretsFile, "utf8").catch(() => { throw new Error(`Cannot read ${secretsFile}. Put deployment secrets there before deploying.`); });
    try {
      secrets = secretsFile.endsWith(".json") ? JSON.parse(contents) : parseEnv(contents);
    } catch {
      throw new Error("Cannot parse deployment secrets. Use a valid dotenv or JSON file.");
    }
    if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) throw new Error("Deployment secrets must be key-value pairs.");
    for (const name of ["BOT_TOKEN", "WEBHOOK_SECRET", "ENCRYPTION_KEY"]) {
      if (typeof secrets[name] !== "string" || !secrets[name]) throw new Error(`Missing ${name} in deployment secrets file.`);
    }
  }
  const directory = await mkdtemp(join(tmpdir(), "oau-deploy-"));
  const outputFile = join(directory, "output.jsonl");
  try {
    const command = ["bunx", "wrangler", "deploy", ...args];
    if (!dryRun && index < 0 && !inlineFile) command.push("--secrets-file", secretsFile);
    const child = Bun.spawn(command, {
      env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputFile },
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    if (await child.exited !== 0) throw new Error("Deployment failed; Telegram webhook was not changed.");
    if (dryRun) return;
    await registerWebhook(deployedUrl(await readFile(outputFile, "utf8")), secrets.BOT_TOKEN, secrets.WEBHOOK_SECRET);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Deployment failed.");
    process.exitCode = 1;
  });
}
