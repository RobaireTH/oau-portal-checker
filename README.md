# OAU_PORTAL_CHECKER (Telegram bot on Cloudflare Workers)

Private Telegram bot that checks your OAU eportal results. Runs on Cloudflare Workers
(free plan) and checks the portal every 15 minutes for new or changed results.

## Commands

- `/login`: connect your portal account. The bot asks for your matric number and password in the chat, then deletes the password message.
- `/logout`: sign out and delete the saved password
- `/cancel`: cancel a login or PIN prompt
- `/clear`: delete tracked incoming and outgoing messages from the private chat while Telegram still permits deletion
- `/setpin`: create or change the PIN inside the private bot chat
- `/analytics`: asks for your PIN, then sends an SGPA and cumulative-CGPA trend chart with performance statistics
- `/compare`: asks for your PIN, then compares every semester's SGPA, cumulative CGPA, and CGPA movement
- `/report`: asks for your PIN, then generates a downloadable PDF with the GPA trend, semester comparison, and complete results
- `/results`: asks for your PIN, then lets you pick a semester from buttons and view its courses, SGPA, and cumulative CGPA at that point
- `/summary`: asks for your PIN, then shows CGPA, units attempted and passed, and failed courses

- `/refresh`: fetch the latest results from the portal now
- `/status`: login state, auto re-login state, when results were last fetched, and the result of the last automatic check

Results are cached in a SQLite-backed Durable Object and refreshed every 15 minutes by the automatic check, so protected views can be up to 15 minutes old. Use `/refresh` for the latest data. Large semesters have Previous/Next buttons. Result buttons expire five minutes after PIN authorization. Update alerts identify added, changed, or removed courses and show the resulting semester-GPA and current-CGPA movement. Elective updates are labeled and include separate passed-course and passed-unit progress for graduation tracking.

The bot only accepts the owner's private chat. Login and PIN prompts cancel incompatible conversations. Passwords preserve whitespace and slash prefixes; `/cancel`, `/clear`, `/logout`, `/login`, and `/setpin` are reserved during password entry. PIN messages are deleted after reading, and only a keyed digest is stored. `/clear` silently removes tracked messages and sweeps up to 1,000 recent message IDs in the private chat. Telegram still prevents the bot from deleting messages outside its 48-hour deletion window.

## How login works

After `/login`, the bot stays logged in. Your password is saved encrypted with AES-256-GCM, using `ENCRYPTION_KEY` from a Wrangler secret. The session and credentials are committed together. When the portal session expires, the bot logs in again with the saved password. `/logout` deletes the session, saved credentials, cached results, notification state, and pending prompts. Connecting an account resets its result cache and notification baseline.

Webhook updates are encrypted and durably queued before Telegram receives success. A Durable Object alarm processes one update or scheduled check at a time, keeping portal work out of the HTTP background execution limit. Recent duplicate update IDs are ignored. Notification batches are split into bounded messages and retain progress when a later message fails. A process crash after Telegram accepts a message but before delivery progress is saved can still duplicate that message on retry.

Pending or unrecognized grades are displayed but excluded from GPA and passed-unit calculations. Electives remain visible and are tracked separately for graduation progress while staying excluded from SGPA and CGPA. The existing elective-code and semester-label assumptions remain; verify these against your official results before treating the calculations as authoritative.

Analytics charts are rendered by QuickChart. Only semester labels and aggregate SGPA and CGPA values are sent for rendering; matric numbers, course titles, and raw scores are not included.

Limits to know about:

- The key and the encrypted data are both stored on Cloudflare. Encryption protects credentials and queued updates from a storage-only reader, but not someone with access to the key. Cached results and portal session tokens are not encrypted.
- Telegram chats with bots aren't end-to-end encrypted, so the password passes through Telegram's servers when you send it.
- If you change the portal password, the saved one stops working. Send `/login` again.
- Changing `ENCRYPTION_KEY` makes the saved password unreadable. Send `/login` again after changing it.

## Setup

1. Create the bot with `@BotFather` (`/newbot`). Usernames must end in `bot`. Set the display name to `OAU_PORTAL_CHECKER` with `/setname`.
2. Get your numeric Telegram user ID from `@userinfobot`.
3. Install dependencies:

   ```sh
   bun install
   ```

4. Create your local secrets file from [`.dev.vars.example`](.dev.vars.example):

   ```sh
   cp .dev.vars.example .dev.vars
   ```

   Generate the two secret values:

   ```sh
   openssl rand -hex 32    # WEBHOOK_SECRET
   openssl rand -base64 32 # ENCRYPTION_KEY
   ```

   Edit `.dev.vars` and replace all four placeholders with your BotFather token, numeric Telegram user ID, and generated secrets. `.dev.vars` is gitignored; keep its values private.

5. Deploy:

   ```sh
   bun run deploy
   ```

   The Bun deployment script uploads secrets from `.dev.vars`, deploys the Worker, and registers its `/webhook` URL with Telegram automatically. You can select another dotenv or JSON secrets file with `bun run deploy --secrets-file <path>`. A failed deployment leaves the current Telegram webhook untouched. `bun run deploy --dry-run` compiles without deploying or changing the webhook.

6. Check that the CLI prints `Telegram webhook registered` after deployment. No manual curl command is needed.

7. In the chat with your bot, send `/setpin` to create your private results PIN, then send `/login` and follow the prompts. Login saves the password for automatic re-login. You can also create the PIN when `/results` or `/summary` first asks for it.

Wrangler creates the Durable Object binding and applies the `v1` SQLite migration during deployment. No KV namespace is required. Existing KV data is not migrated or deleted; after upgrading from the KV version, send `/login` again. Automatic webhook registration sets `max_connections=1` to preserve conversational delivery order.

If you set `OAU_USERNAME` or `OAU_PASSWORD` as secrets earlier, you can remove them with `bunx wrangler secret delete <NAME>`. The code no longer reads them.

To check every 30 minutes instead, change the cron in `wrangler.jsonc` to `*/30 * * * *`.

## Local development

Create and fill in `.dev.vars` using the setup instructions above, then run `bun run dev`. Restart an already-running dev server after the binding change.

Run `bun run typecheck` and `bun test` to verify changes. Run `bun run types` after changing bindings. The tests use mock portal and Telegram responses and never send real messages.
