# IfeMate

IfeMate is a multi-user Telegram bot for OAU students. It connects to ePortal, keeps each user's account in isolated Cloudflare Durable Object storage, checks for result changes every 15 minutes, and sends private alerts through Telegram.

## Use IfeMate

1. Open a private chat with the bot and send `/start`.
2. Send `/login`, then enter your matric number and portal password.
3. Send `/refresh` to fetch your current results.
4. Open `/results`, `/summary`, `/analytics`, `/compare`, or `/report`. IfeMate asks you to create a private results PIN the first time you open a protected view.

After login, automatic checks continue without keeping Telegram open. Send `/status` to see the current login state and the latest automatic check. Send `/logout` to delete the saved portal credentials, session, cached results, notification state, and pending prompts.

IfeMate accepts every user's direct messages and ignores group chats. Every Telegram user is routed to a separate SQLite-backed Durable Object, so conversations, credentials, sessions, results, PINs, alerts, and message history are not shared between users.

## Commands

- `/start`: show the first-run guide and command list
- `/help`: show the guide again
- `/login`: connect an OAU portal account
- `/logout`: sign out and delete the saved password
- `/cancel`: cancel a login or PIN prompt
- `/clear`: delete recent tracked messages while Telegram still permits deletion
- `/setpin`: create or change the private results PIN
- `/refresh`: fetch the latest results from ePortal immediately
- `/results`: browse courses, grades, SGPA, and cumulative CGPA by semester
- `/summary`: view CGPA, units attempted and passed, failed courses, and elective progress
- `/analytics`: receive an SGPA and cumulative-CGPA trend chart with performance statistics
- `/compare`: compare every semester's SGPA, cumulative CGPA, and CGPA movement
- `/report`: download a PDF containing the GPA trend, semester comparison, and complete results
- `/status`: view the login state, automatic re-login state, last refresh, and latest automatic check

Protected views require the user's results PIN. Result buttons expire five minutes after authorization. Large semesters include Previous and Next controls. Update alerts identify added, changed, or removed courses and show the calculated semester-GPA and current-CGPA movement. Electives remain visible and are tracked separately for graduation progress while staying excluded from SGPA and CGPA.

## How it works

The Cloudflare Worker authenticates Telegram webhook requests, validates that an update came from a direct chat, and routes it to a Durable Object named for that Telegram user. Webhook updates are encrypted and durably queued before Telegram receives success. Each object processes its queue sequentially and maintains its own 15-minute result-check alarm.

After `/login`, the portal password is encrypted with AES-256-GCM using the deployment's `ENCRYPTION_KEY`. The session and encrypted credentials are stored together. If the portal session expires, IfeMate signs in again with the saved credentials. `/logout` removes all account-specific state.

Pending or unrecognized grades are displayed but excluded from GPA and passed-unit calculations. The elective-code and semester-label assumptions should be checked against official results before treating calculations as authoritative.

Analytics charts are rendered by QuickChart. Only semester labels and aggregate SGPA and CGPA values are sent for rendering. Matric numbers, course titles, raw scores, portal sessions, and credentials are not included.

## Privacy limits

- Telegram bot chats are not end-to-end encrypted, so a portal password passes through Telegram when submitted.
- IfeMate attempts to delete password and PIN messages immediately, but Telegram controls whether deletion succeeds.
- Credentials and queued updates are encrypted at rest. Cached results and portal session tokens are not encrypted.
- The encryption key and encrypted data are stored in the same Cloudflare project. Encryption protects against storage-only access, not access to both the Worker secret and Durable Object storage.
- Changing `ENCRYPTION_KEY` makes existing saved credentials and queued updates unreadable. Users must send `/login` again afterward.
- If a portal password changes, the saved login stops working until the user sends `/login` again.

## Self-hosting

1. Create a Telegram bot with `@BotFather` using `/newbot`. Set its display name to `IfeMate` with `/setname`.
2. Install dependencies:

   ```sh
   bun install
   ```

3. Create the local secrets file:

   ```sh
   cp .dev.vars.example .dev.vars
   openssl rand -hex 32
   openssl rand -base64 32
   ```

   Set `BOT_TOKEN` to the BotFather token, `WEBHOOK_SECRET` to the generated hex value, and `ENCRYPTION_KEY` to the generated base64 value. `.dev.vars` is gitignored. No Telegram owner ID is required.

4. Deploy:

   ```sh
   bun run deploy
   ```

The deployment script validates the three secrets, uploads them to Cloudflare, deploys the Worker, and registers the `/webhook` URL with Telegram. Use `bun run deploy --dry-run` to compile without deploying or changing the webhook. Use `bun run deploy --secrets-file <path>` to select another dotenv or JSON secrets file.

Wrangler creates the Durable Object binding and applies the `v1` SQLite migration during the first deployment. No KV namespace or database provisioning is required.

## Local development

Create and fill `.dev.vars`, then run:

```sh
bun run dev
```

Verify changes with:

```sh
bun run typecheck
bun test
```

The test suite uses mock portal and Telegram responses and does not send real messages.
