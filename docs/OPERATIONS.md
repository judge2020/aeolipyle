# Operating Aeolipyle

Aeolipyle serves Discord interactions at `https://aeolipyle.judge.sh/interactions`.
Each guild has its own counter registry. Bot DMs use a separate registry for each user.
Each counter stores its value in its own SQLite Durable Object, addressed by an immutable UUID.

## Development and validation

Use Node.js 22 or newer:

```sh
npm ci
npm run typecheck
npm test
npm run register:dry
npm run deploy -- --dry-run
npm run dev
```

Tests run in workerd with real SQLite Durable Objects and a committed test-only signing key.
Production uses the Discord application public key from `wrangler.jsonc`.
The Vitest dependency optimizer bundles the Discord CommonJS packages. Its external
`node:crypto` entry accommodates the package's unused Node fallback; production uses native
WebCrypto and has no `nodejs_compat` flag.

## Deploy and register

The Wrangler configuration explicitly selects the Judge Cloudflare account. Deploy with
`npm run deploy`, then check `curl -fsS https://aeolipyle.judge.sh/healthz` returns `ok`.
The `exports` declarations provision both SQLite Durable Object classes. Keep these declarations;
do not replace them with legacy migrations or delete their namespaces.

Put `DISCORD_BOT_TOKEN=...` in the ignored `.dev.vars`, or set that environment variable locally.
Run `npm run register:dry` to inspect the complete payload, then `npm run register` to replace
the application's global commands. The bot token is used only locally and is never deployed.
Application ID overrides are supported through `DISCORD_APPLICATION_ID`.

In the [Discord Developer Portal](https://discord.com/developers/applications/1546275044819345408/information),
set the Interactions Endpoint URL to `https://aeolipyle.judge.sh/interactions` and save.
Discord validates a signed PING and probes invalid signatures.
Enable Guild Install with scopes `bot` and `applications.commands`, with bot permissions `0`.

[Install Aeolipyle in a server](https://discord.com/oauth2/authorize?client_id=1546275044819345408&scope=bot+applications.commands&permissions=0).
The user must share a server with the bot to use its DMs. Global command propagation may take time.

## Commands

| Command | Behavior |
|---|---|
| `/addcounter name [description]` | Create at zero, or offer restore/reset/keep/cancel for a removed counter |
| `/removecounter name` | Soft-delete, retaining the count and metadata |
| `/renamecounter name new_name` | Rename, including casing changes; occupied removed names remain reserved |
| `/counter name` | Show count and optional description |
| `/counters` | Private list with 20 entries per page |
| `/increment name` | Add one |
| `/decrement name` | Subtract one, including below zero |

Names contain 1–100 ASCII letters, digits, or spaces and match without case sensitivity.
Leading and trailing whitespace is trimmed. Repeated internal spaces are preserved; tabs,
line breaks, symbols, non-ASCII characters, and names containing only spaces are rejected.
Descriptions are optional, at most 500 characters. Counts clamp to JavaScript's safe integer
bounds. All messages suppress mentions, including mentions embedded in descriptions.

Manage Channels is the default guild permission for add/remove/rename. Discord applies that
permission and administrator-configured command overrides; the Worker deliberately does not
repeat the check. All commands work in bot DMs. Descriptions have 30 non-English translations;
command names and response text remain English.

## Restore consistency

Restore prompts expire after 15 minutes and belong to their requesting user. Each prompt is
bound to a counter UUID and deletion generation. Claiming consumes all competing prompts;
reset happens before the registry makes the counter active. A failed reset releases the claim.
Claims expire after 60 seconds to recover from interrupted requests. Restoration preserves the
previous description when the new request omits it.

The registry and counter are separate Durable Objects, as specified in the plan. Operations
already resolved against a counter can still finish while another request removes it. A request
that exceeds the 2.5-second response deadline can also finish its mutation in the background.
Inspect `/counter` before repeating a timed-out increment if exactly one change matters.
This iteration does not deduplicate repeated Discord deliveries or offer a cross-object transaction.

## Live smoke test

In a test server, then in a bot DM:

1. Add `Smoke`, increment twice, decrement once, inspect it, and rename it `SMOKE`.
2. Remove it; add it again and restore keeping its value. Repeat using reset to zero and cancel.
3. Open two restore prompts. Restore via one, increment, then press reset on the other: the
   second must expire without changing the live count.
4. Create more than 20 counters and navigate the private list in both directions.
5. As a guild member without Manage Channels, verify add/remove/rename are unavailable.
   Have an administrator delegate a command under Server Settings → Integrations and verify it works.

Use `npx wrangler tail --format json` for troubleshooting. Application logs include interaction
type, command/button ID, scope, user ID, duration, and outcome. They omit full payloads and
interaction tokens. Prompt cleanup failures are best-effort and do not undo a successful restore.

Optional Workers Builds integration: connect the GitHub repository, use
`npm ci && npm run types` as the build command and `npx wrangler deploy` as the deployment command.
The deployed bot needs no scheduled job or gateway process.

## References

- [Cloudflare Durable Object declarations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Cloudflare Vitest module resolution](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#module-resolution)
- [Discord interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding)
