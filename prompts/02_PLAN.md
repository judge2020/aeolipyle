# Aeolipyle — Implementation Plan

Source prompt: `prompts/01_INITIAL_PROMPT_FOR_PLANNING.md`. Read `README.md` first and obey its
agent rules (never write to `README.md`; never read Sweetiebot or any other repository's source).

This document is the complete spec for the implementation agent. It was written against the docs
current on 2026-09-06 (Discord API v10, Wrangler 4.129, `discord-interactions` 4.4.0). Where the
prompt left a choice open, the choice and its rationale are recorded in §2 so a reviewer can
push back before code is written.

---

## 0. What we are building

A Discord "counter" bot that runs forever on Cloudflare Workers with zero servers and zero
gateway connection. Discord POSTs every interaction to `https://aeolipyle.judge.sh/interactions`;
the Worker verifies the Ed25519 signature, does its work against Durable Objects, and replies
inside Discord's 3-second window.

- Seven global chat-input (slash) commands, usable in servers and in the bot's DMs.
- Each counter is its own **SQLite-backed Durable Object** (durable, atomic increments).
- A per-scope **registry Durable Object** owns the name index (case-insensitive uniqueness,
  soft-delete, rename, listing). Scope = a guild, or a single user in bot DMs.
- Sensitive commands (`/addcounter`, `/removecounter`, `/renamecounter`) are registered with
  `default_member_permissions` = **Manage Channels**, so Discord itself gates them in guilds;
  in bot DMs they are always available.
- Command names/descriptions are registered with Discord localizations from one central module.
- Outputs use emojis liberally. ✨

## 1. Fixed facts (from the prompt)

| Item | Value |
|---|---|
| Discord Application ID | `1546275044819345408` |
| Discord Public Key | `8175b3666037327ad203c2da5fdf9bbfe3d565965d84348d112106b21767a530` |
| Public hostname | `aeolipyle.judge.sh` |
| Interactions path | `POST /interactions` |
| Worker name | `aeolipyle` |

None of these are secrets; they live in `wrangler.jsonc` `vars`. The only secret in the whole
project is the **bot token**, and it is needed only by the local command-registration script,
never by the deployed Worker (interaction responses and follow-ups use the interaction token).

## 2. Decisions and assumptions

Numbered so the review pass can reference them. Each is cheap to flip; none is load-bearing.

- **D1 — Two Durable Object classes.** `CounterRegistry` (one per scope) indexes names →
  counter IDs; `Counter` (one per counter) holds the count. The prompt asks for a DO per counter;
  the registry exists because listing, case-insensitive uniqueness, soft-delete and rename need
  a single authority per scope. Counter DOs are addressed by an opaque UUID stored in the
  registry, so rename/soft-delete never touch the counter DO.
- **D2 — The Worker orchestrates.** The Worker calls the registry to resolve a name, then the
  counter DO to change the count. Two short RPC hops per `/increment`. The registry never calls
  counter DOs, so it stays tiny and never becomes a per-guild bottleneck.
- **D3 — Counts are integers within JavaScript's safe range and may go negative.**
  `/decrement` is not clamped at 0. The `Counter` DO clamps every update to
  ±`Number.MAX_SAFE_INTEGER` inside the SQL statement (§8.2), so the `number` that crosses the
  RPC boundary is always exact; SQLite's 64-bit INTEGER could hold more, but values beyond 2^53
  would silently lose precision on the way out. (Clamping at 0 instead is a one-literal change.)
- **D4 — `/addcounter` `description` is optional, 1–500 characters when given.** It is shown
  by `/counter` only; when absent, `/counter` and the creation message simply omit the 📝 line.
- **D5 — Restoring a soft-deleted counter applies the newly supplied casing, and the new
  description if one was given** (both "keep count" and "reset to 0" variants). If
  `/addcounter` was run without a description, the previous description is kept.
- **D6 — `/renamecounter` refuses to rename onto a name that belongs to a soft-deleted
  counter** (as well as an active one) and tells the user to restore it with `/addcounter`
  instead. Nothing is ever hard-deleted.
- **D7 — Discord enforces the permission gate; there is no user allowlist.** The three
  sensitive commands are registered with `default_member_permissions` set to
  `MANAGE_CHANNELS` (`"16"`). Discord hides them from guild members who lack that permission
  and never delivers the interaction to us; administrators always pass. Guild admins may
  deliberately delegate a command to other roles via Server Settings → Integrations, and that
  override is honoured because the Worker does **not** re-check `member.permissions` (a second
  check would silently break the override). `default_member_permissions` has no effect in bot
  DMs, which matches the prompt. If an override-proof check is ever wanted, it is one function
  in the dispatch step of §6.
- **D8 — Command contexts:** `integration_types: [GUILD_INSTALL]`, `contexts: [GUILD, BOT_DM]`.
  No user-install, no group-DM (`PRIVATE_CHANNEL`). Defensively, any interaction without a
  `guild_id` is treated as the invoking user's DM scope.
- **D9 — Localize descriptions, not names.** Command and option *descriptions* get
  `description_localizations` for all 30 non-English Discord locales. Command/option *names*
  stay English: Discord requires names to be single lowercase tokens matching a strict regex
  and unique per locale, concatenated translations read badly, and stable names make support
  easier. The data structure has a `name_localizations` slot so this can be enabled later.
- **D10 — Bot responses are English-only** in this iteration, but every user-facing string is
  in one module (`src/messages.ts`) so response localization by `interaction.locale` can be
  added without touching handlers.
- **D11 — Restore prompt state lives in the registry DO** (a `pending_restores` table with a
  15-minute TTL), because a button `custom_id` is capped at 100 characters and cannot carry a
  100-character name plus a 500-character description. Each pending row is bound to the
  counter's immutable `counter_id` and its `deleted_generation`, and a restore first takes a
  short exclusive claim, so a stale prompt can never touch an already-restored counter or a
  different counter that later reuses the name.
- **D12 — Declarative `exports` config, not `migrations`.** Cloudflare now documents
  `exports: { Class: { type: "durable-object", storage: "sqlite" } }` as the preferred way to
  declare DO classes; `migrations` is legacy and the two are mutually exclusive.
- **D13 — No `nodejs_compat` flag.** `discord-interactions` 4.x verifies with WebCrypto
  Ed25519, which workerd supports natively. Nothing in the project imports `node:*`.

## 3. Stack and versions (verified 2026-09-06)

| Package | Version to use | Notes |
|---|---|---|
| Node.js (local) | ≥ 22 (machine has 24.13) | Wrangler requires ≥ 22 |
| `wrangler` | `^4.129.0` | dev dependency |
| `typescript` | `^5.9.3` | **Not 7.x.** npm `latest` is TypeScript 7.0 (the native port) and it drops config options this tooling still uses. Pin `^5.9`. |
| `discord-interactions` | `^4.4.0` | Used for `verifyKey` (async, WebCrypto). Official Discord package, as required. |
| `discord-api-types` | `^0.38.55` | Runtime enums + TypeScript types from the `discord-api-types/v10` entry point. Small, no Node deps. |
| `vitest` | `^4.1.11` | **Not 5.x.** `@cloudflare/vitest-plugin` peer-depends on `vitest ^4.1`. |
| `@cloudflare/vitest-plugin` | `^1.1.4` | Replaces the deprecated-in-docs `@cloudflare/vitest-pool-workers`. |
| `tsx` | `^4.23` | Runs the registration script. |
| `@types/node` | `^24` | Only for `scripts/` (uses `process.env`, `fs`). |
| `jsonc-parser` | `^3.3.1` | Dev dependency; the register script reads `wrangler.jsonc` with it. |

Do **not** install `@cloudflare/workers-types`; `wrangler types` generates runtime + `Env`
types into `worker-configuration.d.ts`.

Enum policy, to avoid two sources of truth: **all** Discord enums and types come from
`discord-api-types/v10` (`InteractionType`, `InteractionResponseType`, `MessageFlags`,
`ComponentType`, `ButtonStyle`, `ApplicationCommandOptionType`, `InteractionContextType`,
`ApplicationIntegrationType`, `PermissionFlagsBits`, `Locale`, `Routes`, `RouteBases`, and the
`API*` types). `discord-interactions` contributes `verifyKey` only.

Style rules for the implementer:

- TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. No `any`.
- No TypeScript `enum` in our own code; use `as const` objects. Keeps every file runnable under
  Node's type-stripping if someone wants that later.
- Every response sets `allowed_mentions: { parse: [] }` (descriptions are user text; never ping).
- Never log the interaction token or full interaction payload.

## 4. Repository layout

```
aeolipyle/
├── README.md                     (do not modify)
├── AGENTS.md / CLAUDE.md         (existing)
├── prompts/                      (existing; plans live here)
├── package.json
├── package-lock.json
├── tsconfig.json                 (src)
├── scripts/tsconfig.json         (extends root; adds node types)
├── test/tsconfig.json            (extends root; adds vitest-plugin types)
├── vitest.config.ts
├── wrangler.jsonc
├── worker-configuration.d.ts     (generated by `wrangler types`; gitignored)
├── .gitignore
├── .dev.vars.example             (documents DISCORD_BOT_TOKEN for the register script)
├── src/
│   ├── index.ts                  fetch handler: routing, signature check, dispatch; re-exports DO classes
│   ├── messages.ts               all user-facing strings (emoji copy), formatting helpers
│   ├── discord/
│   │   ├── verify.ts             verifyDiscordRequest(request, publicKey) → { ok, body }
│   │   ├── respond.ts            reply(), ephemeral(), updateMessage(), json()
│   │   ├── rest.ts               editOriginalResponse(), createFollowup() (webhook endpoints)
│   │   ├── options.ts            getStringOption(interaction, name)
│   │   └── scope.ts              scopeKeyFor(interaction), invokingUser(interaction)
│   ├── commands/
│   │   ├── definitions.ts        command JSON (with localizations) — shared by register script
│   │   ├── index.ts              name → handler map
│   │   ├── sensitive.ts          SENSITIVE_COMMANDS set (leaf module: no Worker imports)
│   │   ├── addcounter.ts
│   │   ├── removecounter.ts
│   │   ├── counter.ts
│   │   ├── counters.ts
│   │   ├── increment.ts
│   │   ├── decrement.ts
│   │   └── renamecounter.ts
│   ├── components/
│   │   ├── customId.ts           encode/decode custom_id grammar
│   │   ├── index.ts              dispatch by custom_id prefix
│   │   ├── addcounterRestore.ts  restore/keep/cancel buttons
│   │   └── countersPage.ts       pagination buttons
│   ├── durable-objects/
│   │   ├── CounterRegistry.ts
│   │   └── Counter.ts
│   ├── i18n/
│   │   ├── locales.ts            LOCALES, TRANSLATED_LOCALES, helpers
│   │   └── strings.ts            translation table for command/option descriptions
│   └── lib/
│       ├── names.ts              validateCounterName(), nameKey()
│       └── time.ts               discordRelativeTimestamp(ms)
├── scripts/
│   └── register-commands.ts      PUT global commands (bulk overwrite), with validation + --dry-run
└── test/
    ├── fixtures/keys.ts          committed test-only Ed25519 keypair
    ├── helpers.ts                signInteraction(), makeCommandInteraction(), makeButtonInteraction()
    ├── names.test.ts
    ├── registry.test.ts
    ├── counter.test.ts
    ├── interactions.test.ts      end-to-end through fetch(): PING, bad signature, each command
    └── register.test.ts          command JSON passes the validator; every locale translated
```

## 5. Configuration files

### 5.1 `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "aeolipyle",
  "main": "src/index.ts",
  // Use the date of implementation (no later than the installed Wrangler supports).
  "compatibility_date": "2026-09-06",
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    { "pattern": "aeolipyle.judge.sh", "custom_domain": true }
  ],
  "observability": {
    "enabled": true,
    "logs": { "head_sampling_rate": 1 }
  },
  "vars": {
    "DISCORD_APPLICATION_ID": "1546275044819345408",
    "DISCORD_PUBLIC_KEY": "8175b3666037327ad203c2da5fdf9bbfe3d565965d84348d112106b21767a530"
  },
  "durable_objects": {
    "bindings": [
      { "name": "COUNTER_REGISTRY", "class_name": "CounterRegistry" },
      { "name": "COUNTER", "class_name": "Counter" }
    ]
  },
  "exports": {
    "CounterRegistry": { "type": "durable-object", "storage": "sqlite" },
    "Counter": { "type": "durable-object", "storage": "sqlite" }
  }
}
```

Notes:

- `custom_domain: true` requires the `judge.sh` zone to be on the same Cloudflare account;
  Wrangler creates the DNS record on first deploy. If the zone is elsewhere, temporarily set
  `workers_dev: true` and use the `workers.dev` URL until DNS is sorted.
- `workers_dev: false` keeps one canonical hostname. `wrangler dev` is unaffected.
- No `compatibility_flags` (see D13).
- `exports` replaces the legacy `migrations` array (see D12). Once deployed with `exports`,
  never switch back.

### 5.2 `package.json` (scripts and deps only)

```jsonc
{
  "name": "aeolipyle",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "types": "wrangler types --strict-vars=false",
    "typecheck": "npm run types && tsc -p tsconfig.json --noEmit && tsc -p scripts/tsconfig.json --noEmit && tsc -p test/tsconfig.json --noEmit",
    "test": "npm run types && vitest run",
    "register": "tsx scripts/register-commands.ts",
    "register:dry": "tsx scripts/register-commands.ts --dry-run"
  },
  "dependencies": {
    "discord-api-types": "^0.38.55",
    "discord-interactions": "^4.4.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "^1.1.4",
    "@types/node": "^24.0.0",
    "jsonc-parser": "^3.3.1",
    "tsx": "^4.23.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.11",
    "wrangler": "^4.129.0"
  }
}
```

`--strict-vars=false` makes `vars` type as `string` rather than literal types, so tests can
override `DISCORD_PUBLIC_KEY` without type friction.

### 5.3 `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["./worker-configuration.d.ts"]
  },
  "include": ["src/**/*.ts", "worker-configuration.d.ts"]
}
```

`scripts/tsconfig.json`: extends root, `"types": ["node"]`, and
`"include": ["./**/*.ts", "../src/**/*.ts", "../worker-configuration.d.ts"]`. Overriding
`types` drops the root's generated-types entry, so the generated declarations are pulled back in
explicitly via `include`; without them the `src/` files the script imports cannot resolve `Env`
or Worker runtime types and `npm run typecheck` fails. Keep `definitions.ts` importing only leaf
modules (`i18n/*`, `commands/sensitive.ts`) so the script never loads handlers.
`test/tsconfig.json`: extends root, `"types": ["@cloudflare/vitest-plugin/types"]`, and
`"include": ["./**/*.ts", "../worker-configuration.d.ts"]` (the `types` override drops the
root entry, so the generated file is pulled back in via `include`).

### 5.4 `vitest.config.ts`

```ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { TEST_PUBLIC_KEY_HEX } from "./test/fixtures/keys";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Overrides the production public key so tests can sign with a committed test keypair.
      miniflare: { bindings: { DISCORD_PUBLIC_KEY: TEST_PUBLIC_KEY_HEX } },
    }),
  ],
});
```

### 5.5 `.gitignore` and `.dev.vars.example`

`.gitignore`: `node_modules/`, `.wrangler/`, `.dev.vars`, `worker-configuration.d.ts`, `dist/`.

`.dev.vars.example`:

```
# Only the registration script needs this. Never commit .dev.vars.
DISCORD_BOT_TOKEN=paste-bot-token-here
```

Initialise git (`git init -b main`) as part of setup. Committing and publishing to GitHub are
authorized under the conditions in §16.1; follow the commit-message rules there.

## 6. Request pipeline (`src/index.ts`)

```
fetch(request, env, ctx):
  url = new URL(request.url)
  GET  /            → 200 text/plain "Aeolipyle 🌀 — a slash-command counter bot for Discord"
  GET  /healthz     → 200 "ok"
  POST /interactions→ handleInteractions(request, env, ctx)
  anything else     → 404 (405 for wrong method on /interactions)
```

`handleInteractions`:

1. Read `X-Signature-Ed25519` and `X-Signature-Timestamp`. Missing → `401`.
2. `rawBody = await request.text()` — read **once**, as text; use the same string for
   verification and for `JSON.parse`.
3. `ok = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY)`. False → `401`
   with body `"invalid request signature"`. Discord routinely probes the endpoint with bad
   signatures and removes endpoints that accept them.
4. `interaction = JSON.parse(rawBody) as APIInteraction` (parse failure → `400`).
5. Switch on `interaction.type`:
   - `Ping` → `{ type: Pong }`.
   - `ApplicationCommand` → look up `commands[interaction.data.name]`; unknown → ephemeral
     `MSG.unknownCommand`. Else run the handler. There is no permission check here: Discord
     already gated sensitive commands via `default_member_permissions` (D7, §7.2).
   - `MessageComponent` → `components.dispatch(interaction, env, ctx)`.
   - anything else → ephemeral `MSG.unsupported`.
6. Wrap 5 in `try/catch`: on error `console.error` (structured, no token) and return ephemeral
   `MSG.internalError`.
7. Deadline guard: race the handler against a 2500 ms timer; on timeout return ephemeral
   `MSG.tookTooLong`. (The DO write may still complete; that is acceptable and rare.)
8. Return `Response.json(interactionResponse)`.
9. Log one structured line per interaction:
   `{ event: "interaction", type, command|customId, scope, userId, ms, outcome }`.

Handlers have the signature
`(interaction, env, ctx) => Promise<APIInteractionResponse>`.

Export both DO classes from `src/index.ts` (`export { CounterRegistry } from "./durable-objects/CounterRegistry"` etc.);
Wrangler needs them exported from `main`, and `wrangler types` then generates
`DurableObjectNamespace<CounterRegistry>` typings automatically.

## 7. Scope, permissions, names

### 7.1 Scope (`src/discord/scope.ts`)

```ts
scopeKeyFor(interaction): string
  if (interaction.guild_id) return `guild:${interaction.guild_id}`;
  return `user:${invokingUser(interaction).id}`;   // bot DM (and, defensively, anything else)

invokingUser(interaction): APIUser
  return interaction.member?.user ?? interaction.user!;
```

Registry stub: `env.COUNTER_REGISTRY.getByName(scopeKey)`.
Counter stub: `env.COUNTER.getByName(counterId)` where `counterId` is the UUID stored in the
registry row.

### 7.2 Sensitive-command gating (registration-time, not runtime)

`SENSITIVE_COMMANDS = new Set(["addcounter", "removecounter", "renamecounter"])` lives in
`src/commands/sensitive.ts`, a leaf module with no Worker imports so the register script can
load it without dragging in handlers. `definitions.ts` sets
`default_member_permissions: PermissionFlagsBits.ManageChannels.toString()` (the string `"16"`)
on exactly those commands and omits the field on the other four. Consequences:

- In guilds, members without Manage Channels do not see the command and cannot invoke it;
  Discord never sends us the interaction. Administrators always pass.
- Guild admins can grant or restrict any command per role or channel under
  Server Settings → Integrations → Aeolipyle; the Worker honours whatever Discord decides.
- In bot DMs there is no member object and the field does not apply, so all commands work.
- There is no runtime permission code and no allowlist (D7).

### 7.3 Counter names (`src/lib/names.ts`)

```ts
const NAME_RE = /^[A-Za-z0-9]{1,100}$/;
validateCounterName(raw: string): { ok: true; display: string; key: string } | { ok: false }
  display = raw.trim()   // Discord already trims; harmless
  ok iff NAME_RE.test(display); key = display.toLowerCase()
```

`key` is the identity; `display` is what users see. Because names are ASCII alphanumerics,
they can be interpolated into Markdown without escaping.

Description validation (only when the option is present): trim; empty after trim counts as
absent; otherwise 1–500 characters or ephemeral `MSG.badDescription`. Absent is stored as `NULL`.

## 8. Durable Objects

Both classes `extends DurableObject<Env>` from `cloudflare:workers`, create their tables in the
constructor with `this.ctx.storage.sql.exec(...)` (synchronous; `CREATE TABLE IF NOT EXISTS`
is cheap on every wake), and expose plain RPC methods that return structured-cloneable plain
objects. Avoid method names that collide with stub members (`fetch`, `connect`, `id`, `name`).

Multi-statement strings are allowed for schema setup; statements with `?` bindings must be
single statements.

### 8.1 `CounterRegistry` (one per scope)

```sql
CREATE TABLE IF NOT EXISTS counters (
  name_key           TEXT PRIMARY KEY,        -- lowercase identity (changes only via rename)
  display_name       TEXT NOT NULL,           -- casing as last set by add/rename/restore
  description        TEXT,                    -- NULL = no description
  counter_id         TEXT NOT NULL UNIQUE,    -- crypto.randomUUID(); Counter DO name; immutable
  created_at         INTEGER NOT NULL,        -- epoch ms
  created_by         TEXT NOT NULL,           -- user id
  deleted_at         INTEGER,                 -- NULL = active
  deleted_by         TEXT,
  deleted_generation INTEGER NOT NULL DEFAULT 0, -- +1 on every soft delete
  restore_claim      TEXT,                    -- token of an in-flight restore, else NULL
  restore_claim_at   INTEGER                  -- epoch ms the claim was taken
);
CREATE INDEX IF NOT EXISTS counters_active ON counters (deleted_at, name_key);

CREATE TABLE IF NOT EXISTS pending_restores (
  token              TEXT PRIMARY KEY,        -- crypto.randomUUID(); goes into button custom_ids
  counter_id         TEXT NOT NULL,           -- immutable target; never resolved by name
  deleted_generation INTEGER NOT NULL,        -- must still equal counters.deleted_generation
  new_display_name   TEXT NOT NULL,
  new_description    TEXT,                    -- NULL = keep the existing description
  requested_by       TEXT NOT NULL,           -- user id that ran /addcounter
  interaction_token  TEXT NOT NULL,           -- slash-command token, to tidy the prompt later
  expires_at         INTEGER NOT NULL         -- epoch ms, created + 15 min
);
CREATE INDEX IF NOT EXISTS pending_by_counter ON pending_restores (counter_id);
```

Constants: `PENDING_TTL_MS = 15 * 60_000`, `RESTORE_CLAIM_TTL_MS = 60_000`. A claim older than
`RESTORE_CLAIM_TTL_MS` is treated as absent (covers a Worker that died between claim and
finalize).

Row type returned to the Worker (`CounterRecord`):
`{ nameKey, displayName, description: string | null, counterId, createdAt, createdBy, deletedAt: number | null, deletedGeneration }`.

RPC methods (all synchronous inside; no `await` between read and write, so each call is atomic):

| Method | Behaviour | Returns |
|---|---|---|
| `create({ displayName, description: string \| null, userId, interactionToken })` | Purge expired `pending_restores`. If no row for key → INSERT active row with fresh UUID → `created`. If active row → `exists`. If soft-deleted row with a live claim → `busy`. If soft-deleted row → INSERT a `pending_restores` row bound to its `counter_id` and `deleted_generation` → `deleted` with `restoreToken`. | `{ status: "created", counter } \| { status: "exists", counter } \| { status: "deleted", counter, restoreToken } \| { status: "busy", counter }` |
| `lookup(nameKey)` | Active row only. | `CounterRecord \| null` |
| `list(page, pageSize = 20)` | Active rows ordered by `name_key`, `LIMIT/OFFSET`, plus total. Clamp `page` into `[0, pageCount-1]`. | `{ items, total, page, pageCount }` |
| `remove(nameKey, userId)` | `UPDATE ... SET deleted_at=?, deleted_by=?, deleted_generation = deleted_generation + 1, restore_claim=NULL, restore_claim_at=NULL WHERE name_key=? AND deleted_at IS NULL RETURNING *`. Bumping the generation invalidates every older restore prompt for this counter. | `CounterRecord \| null` |
| `rename(nameKey, newDisplayName)` | Source must be active else `not_found`. `newKey = lower(newDisplayName)`. Same key → update `display_name` only. Else if target row exists: active → `target_exists`, deleted → `target_deleted` (include its `deletedAt`). Else `UPDATE counters SET name_key=?, display_name=? WHERE name_key=?`. | `{ status: "renamed", before, after } \| { status: "not_found" } \| { status: "target_exists", target } \| { status: "target_deleted", target }` |
| `claimRestore(token, userId)` | SELECT the pending row; none → `unknown`; expired → DELETE it, `expired`; `requested_by !== userId` → `forbidden`. Load `counters` by `counter_id`; missing, active (`deleted_at IS NULL`), or `deleted_generation` differs → DELETE the pending row, `stale`. Live claim by another token → `busy` (pending row kept). Otherwise, in the same call: `UPDATE counters SET restore_claim=?, restore_claim_at=? WHERE counter_id=?` and `DELETE FROM pending_restores WHERE counter_id=?` (every competing prompt for this counter dies here). | `{ status: "claimed", pending: { counterId, nameKey, newDisplayName, newDescription: string \| null, interactionToken } } \| { status: "unknown" \| "expired" \| "forbidden" \| "stale" \| "busy" }` |
| `finalizeRestore(token, { displayName, description })` | `UPDATE counters SET deleted_at=NULL, deleted_by=NULL, display_name=?, description=COALESCE(?, description), restore_claim=NULL, restore_claim_at=NULL WHERE restore_claim=? AND deleted_at IS NOT NULL AND name_key=lower(?) RETURNING *` (`description` is `string \| null`; `null` keeps the old one, D5). No row → `lost_claim` (claim timed out and was superseded, or the row is gone). | `{ status: "restored", counter } \| { status: "lost_claim" }` |
| `releaseRestoreClaim(token)` | `UPDATE counters SET restore_claim=NULL, restore_claim_at=NULL WHERE restore_claim=?`. Called when the reset step fails so the user can retry at once instead of waiting out the claim TTL. | `void` |
| `cancelPendingRestore(token, userId)` | SELECT the pending row joined to `counters` on `counter_id`; none → `unknown`; expired → DELETE, `expired`; wrong user → `forbidden`; else DELETE and return the counter's current `display_name`. | `{ status: "cancelled", displayName } \| { status: "unknown" \| "expired" \| "forbidden" }` |

### 8.2 `Counter` (one per counter)

```sql
CREATE TABLE IF NOT EXISTS counter (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counter (id, count, updated_at) VALUES (1, 0, 0);
```

| Method | SQL | Returns |
|---|---|---|
| `adjust(delta: number)` | `UPDATE counter SET count = MAX(?, MIN(?, count + ?)), updated_at = ? WHERE id = 1 RETURNING count`, bound as `(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, delta, now)` | new count (`number`, always exact) |
| `getCount()` | `SELECT count FROM counter WHERE id = 1` | `number` |
| `reset()` | `UPDATE counter SET count = 0, updated_at = ? WHERE id = 1` | `void` |

The clamp keeps the stored value inside JavaScript's safe-integer range (D3). SQLite's
multi-argument `MAX()`/`MIN()` are scalar functions, so the whole update stays one atomic
statement. Do not hard-code the two literals; bind `Number.MIN_SAFE_INTEGER` and
`Number.MAX_SAFE_INTEGER`.

`adjust` is a single statement, so concurrent increments serialize inside the DO and every
returned count is exact. Validate `delta` is `1` or `-1` at the call site.

## 9. Command specifications

All seven are global `CHAT_INPUT` commands with
`integration_types: [ApplicationIntegrationType.GuildInstall]` and
`contexts: [InteractionContextType.Guild, InteractionContextType.BotDM]`. The three sensitive
ones additionally carry `default_member_permissions: "16"` (Manage Channels; see §7.2).
Every string option gets `min_length` / `max_length` so Discord's client rejects the obvious
cases; the Worker re-validates anyway.

| Command | Options | Sensitive | Success visibility | Failure visibility |
|---|---|---|---|---|
| `/addcounter` | `name` (string, required, 1–100), `description` (string, optional, 1–500) | yes | public | ephemeral |
| `/removecounter` | `name` | yes | public | ephemeral |
| `/renamecounter` | `name`, `new_name` (both string, required, 1–100) | yes | public | ephemeral |
| `/counter` | `name` | no | public | ephemeral |
| `/counters` | — | no | ephemeral | ephemeral |
| `/increment` | `name` | no | public | ephemeral |
| `/decrement` | `name` | no | public | ephemeral |

Shared prelude for every handler: derive `scope`, `user`, `registry` stub; read options with
`getStringOption`; validate the name(s); on invalid → ephemeral `MSG.badName`.

### `/addcounter name description`

1. Validate the name, and the description if supplied (`null` when omitted).
2. `res = registry.create({ displayName, description, userId, interactionToken: interaction.token })`.
3. `created` → public `MSG.created(display, description)` (no 📝 line when `null`).
4. `exists` → ephemeral `MSG.alreadyExists(existing.displayName)`.
5. `deleted` → fetch last count from `COUNTER.getByName(counter.counterId).getCount()`, then
   ephemeral `MSG.restorePrompt(existing.displayName, deletedAt, lastCount)` with one action row:
   - `🔄 Restore & reset to 0` — `custom_id = addc:restore:zero:<token>` (Primary)
   - `📦 Restore & keep <n>` — `addc:restore:keep:<token>` (Success)
   - `✖️ Cancel` — `addc:cancel:<token>` (Secondary)
6. `busy` → ephemeral `MSG.restoreBusy` (a restore of that counter is in flight right now).

### `/removecounter name`

1. `row = registry.remove(nameKey, userId)`; `null` → ephemeral `MSG.notFound(display)`.
2. `count = COUNTER.getByName(row.counterId).getCount()` (best-effort; on error show without it).
3. Public `MSG.removed(row.displayName, count)`.

### `/renamecounter name new_name`

1. Validate both names.
2. `res = registry.rename(nameKey, newDisplay)`.
3. `renamed` → public `MSG.renamed(before.displayName, after.displayName)` (works for
   casing-only renames too, e.g. `foo` → `FOO`).
4. `not_found` → ephemeral `MSG.notFound`; `target_exists` → ephemeral
   `MSG.renameTargetExists(target.displayName)`; `target_deleted` → ephemeral
   `MSG.renameTargetDeleted(target.displayName, target.deletedAt)`.

### `/counter name`

1. `row = registry.lookup(nameKey)`; `null` → ephemeral `MSG.notFound`.
2. `count = counter.getCount()`.
3. Public `MSG.counterStatus(row.displayName, count, row.description)` (no 📝 line when `null`).

### `/counters`

1. `page = registry.list(0)`.
2. `total === 0` → ephemeral `MSG.noCounters`.
3. Fetch counts for the page in parallel:
   `Promise.all(items.map(i => env.COUNTER.getByName(i.counterId).getCount()))`.
4. Ephemeral message built by `renderCountersPage(page, counts)`: one embed
   (title `📋 Counters`, description = one line per counter `**Name** · 42`, footer
   `Page 1/3 · 47 counters`) plus, only if `pageCount > 1`, an action row with
   `◀️ Previous` (`ctrs:page:<n-1>`, disabled on first page) and `Next ▶️`
   (`ctrs:page:<n+1>`, disabled on last page).

An embed is used because 20 lines × up-to-100-char names can exceed the 2000-character
`content` limit but fits comfortably in a 4096-character embed description.

### `/increment name` and `/decrement name`

Shared implementation `adjustCommand(delta)`:

1. `row = registry.lookup(nameKey)`; `null` → ephemeral `MSG.notFound`.
2. `count = COUNTER.getByName(row.counterId).adjust(delta)`.
3. Public `MSG.incremented(row.displayName, count)` / `MSG.decremented(...)`.
   Name and new count only; no description.

## 10. Component (button) flows

### 10.1 `custom_id` grammar (`src/components/customId.ts`)

Colon-separated, ≤ 100 characters, parsed with `split(":")`:

| Pattern | Meaning |
|---|---|
| `addc:restore:zero:<uuid>` | restore soft-deleted counter and reset count to 0 |
| `addc:restore:keep:<uuid>` | restore and keep the past count |
| `addc:cancel:<uuid>` | discard the pending restore |
| `ctrs:page:<n>` | show page `n` (0-based) of `/counters` |

Unknown prefix → ephemeral `MSG.staleButton`.

### 10.2 Restore buttons (`addcounterRestore.ts`)

Design rationale (D11 plus response mechanics): the prompt is ephemeral but the confirmation
must be public. The button interaction is answered with a **new public message**
(`CHANNEL_MESSAGE_WITH_SOURCE`, no ephemeral flag — a component interaction on an ephemeral
message may create a non-ephemeral message; the "ephemeral is inherited" rule only applies to
follow-ups after a *deferred* response). The original ephemeral prompt is then tidied up via
the stored slash-command token with `PATCH /webhooks/{app}/{token}/messages/@original`, in
`ctx.waitUntil`, best-effort.

Why the claim protocol: a user can run `/addcounter` twice and hold two live prompts. Without
a claim, clicking "keep" on one, incrementing a few times, then clicking "reset to 0" on the
other would wipe the live count before the registry noticed the counter was already active.
Likewise, if a prompt were resolved by *name*, a restore → rename → re-create of the original
name would point the stale prompt at a brand-new counter. So a prompt is bound to the
immutable `counter_id` plus `deleted_generation`, and the reset only ever runs while the
registry holds an exclusive claim on a still-soft-deleted row.

Flow for `addc:restore:<mode>:<token>`:

1. `res = registry.claimRestore(token, user.id)`.
   - `unknown` / `expired` / `stale` → `UPDATE_MESSAGE` (type 7) replacing the prompt with
     `MSG.restoreExpired`, `components: []`. (`stale` covers "another prompt already restored
     it", "it was removed again since", and "that name now belongs to a different counter".)
   - `busy` → ephemeral `MSG.restoreBusy`.
   - `forbidden` → ephemeral `MSG.notYourPrompt`.
2. If `mode === "zero"`: `await COUNTER.getByName(pending.counterId).reset()`. The row is still
   soft-deleted (so `lookup` cannot hand it to `/increment`) and exclusively claimed (so no
   other prompt can restore it) while the reset runs. If `reset()` throws, call
   `registry.releaseRestoreClaim(token)` best-effort and return ephemeral `MSG.internalError`;
   the counter stays removed and `/addcounter` can simply be run again.
3. `r = registry.finalizeRestore(token, { displayName: pending.newDisplayName, description: pending.newDescription })`.
   - `restored` → public `MSG.restored(displayName, mode, count)`; `count` is `0` for zero
     mode, else `getCount()`.
   - `lost_claim` → `UPDATE_MESSAGE` with `MSG.restoreExpired` (only reachable if the claim
     aged past `RESTORE_CLAIM_TTL_MS`, e.g. the Worker stalled for a minute).
4. `ctx.waitUntil(editOriginalResponse(env, pending.interactionToken, { content: MSG.restorePromptDone(displayName), components: [] }).catch(logWarn))`.

Flow for `addc:cancel:<token>`: `res = registry.cancelPendingRestore(token, user.id)`.
- `cancelled` → `UPDATE_MESSAGE` with `MSG.restoreCancelled(res.displayName)`, `components: []`.
- `unknown` / `expired` → `UPDATE_MESSAGE` with `MSG.restoreExpired`, `components: []` (the
  prompt was already handled by another click, or timed out).
- `forbidden` → ephemeral `MSG.notYourPrompt`.

If, during manual testing, Discord rejects the public response to a button on an ephemeral
message (not expected), fall back to: respond `UPDATE_MESSAGE` to the prompt, then in
`waitUntil` wait ~300 ms and `POST /webhooks/{app}/{buttonInteractionToken}` with the public
confirmation.

### 10.3 Pagination buttons (`countersPage.ts`)

`ctrs:page:<n>` → `registry.list(n)` → fetch counts → respond `UPDATE_MESSAGE` with the
re-rendered embed and buttons. Works indefinitely: each click is a fresh interaction, so the
15-minute token limit does not apply. The message is ephemeral, so only the invoker can click.

## 11. Message copy (`src/messages.ts`)

All strings live here as functions returning `string` (or `{ content, embeds, components }` for
the two composite messages). Names are already safe for Markdown; descriptions are user text and
are protected by `allowed_mentions: { parse: [] }`. Relative times use Discord timestamps
`<t:${Math.floor(ms / 1000)}:R>`.

| Key | Visibility | Copy |
|---|---|---|
| `created(name, desc?)` | public | `✨ Created counter **{name}** starting at **0**!` + `\n📝 {desc}` only when a description exists |
| `alreadyExists(name)` | ephemeral | `⚠️ A counter named **{name}** already exists here.` |
| `restorePrompt(name, deletedAt, last)` | ephemeral | `♻️ **{name}** was removed <t:…:R> and was at **{last}**. Bring it back?` |
| `restored(name, mode, count)` | public | `♻️ Restored counter **{name}** at **{count}**` + (` (reset to zero)` or ` (kept its old count)`) |
| `restorePromptDone(name)` | edit of prompt | `✅ Handled — see the channel for **{name}**.` |
| `restoreCancelled(name)` | edit of prompt | `🚫 Cancelled. **{name}** stays removed.` |
| `restoreExpired` | edit of prompt | `⌛ This prompt has expired or was already handled. Run \`/addcounter\` again.` |
| `restoreBusy` | ephemeral | `⏳ That counter is being restored right now — try again in a moment.` |
| `notYourPrompt` | ephemeral | `🙅 That prompt belongs to someone else.` |
| `removed(name, count)` | public | `🗑️ Removed counter **{name}** (it was at **{count}**). \`/addcounter\` can bring it back.` |
| `renamed(before, after)` | public | `✏️ Renamed **{before}** → **{after}**` |
| `renameTargetExists(name)` | ephemeral | `⚠️ A counter named **{name}** already exists.` |
| `renameTargetDeleted(name, deletedAt)` | ephemeral | `⚠️ **{name}** belongs to a counter removed <t:…:R>. Restore it with \`/addcounter\` or pick another name.` |
| `counterStatus(name, count, desc?)` | public | `🔢 **{name}** is at **{count}**` + `\n📝 {desc}` only when a description exists |
| `incremented(name, count)` | public | `⬆️ **{name}** is now **{count}**` |
| `decremented(name, count)` | public | `⬇️ **{name}** is now **{count}**` |
| `noCounters` | ephemeral | `📭 No counters here yet. Create one with \`/addcounter\`!` |
| `countersPage(...)` | ephemeral | embed as in §9 `/counters` |
| `notFound(name)` | ephemeral | `❓ No counter named **{name}** here. Try \`/counters\`.` |
| `badName` | ephemeral | `🚫 Counter names must be 1–100 letters or digits (A–Z, 0–9), no spaces or symbols.` |
| `badDescription` | ephemeral | `🚫 Descriptions must be 1–500 characters.` |
| `unknownCommand` | ephemeral | `🤷 I don't know that command.` |
| `staleButton` | ephemeral | `🤷 That button is no longer wired to anything.` |
| `unsupported` | ephemeral | `🤖 That kind of interaction isn't supported.` |
| `internalError` | ephemeral | `💥 Something went wrong on my end. Please try again.` |
| `tookTooLong` | ephemeral | `🐢 That took too long. Please try again.` |

Format counts with `Intl.NumberFormat("en-US")` (e.g. `1,234`).

## 12. Discord REST helper (`src/discord/rest.ts`)

Only two calls, both authenticated by the interaction token (no bot token):

```ts
const API = RouteBases.api;   // https://discord.com/api/v10
editOriginalResponse(env, token, body)  → PATCH `${API}${Routes.webhookMessage(env.DISCORD_APPLICATION_ID, token, "@original")}`
createFollowup(env, token, body)        → POST  `${API}${Routes.webhook(env.DISCORD_APPLICATION_ID, token)}`
```

JSON body, `Content-Type: application/json`, always include `allowed_mentions: { parse: [] }`.
Throw on non-2xx with status and truncated body; callers use `waitUntil` + catch + `console.warn`.

## 13. Localization (`src/i18n/`)

`locales.ts`:

```ts
export const LOCALES = [
  "id","da","de","en-GB","en-US","es-ES","es-419","fr","hr","it","lt","hu","nl","no","pl",
  "pt-BR","ro","fi","sv-SE","vi","tr","cs","el","bg","ru","uk","hi","th","zh-CN","ja","zh-TW","ko",
] as const;                                   // the 32 locales Discord supports today
export type DiscordLocale = (typeof LOCALES)[number];
export type TranslatedLocale = Exclude<DiscordLocale, "en-US" | "en-GB">;
export const SOURCE_LOCALES: ReadonlySet<DiscordLocale> = new Set(["en-US", "en-GB"]);
export const TRANSLATED_LOCALES: readonly TranslatedLocale[] = LOCALES.filter(
  (l): l is TranslatedLocale => !SOURCE_LOCALES.has(l),
);                                            // 30 entries
export type LocalizedString = { en: string } & Record<TranslatedLocale, string>;
export function localizations(s: LocalizedString): Record<TranslatedLocale, string>  // drops `en`
```

`strings.ts` holds one `LocalizedString` per translatable key. Keys:

```
cmd.addcounter.desc      cmd.addcounter.opt.name.desc   cmd.addcounter.opt.description.desc
cmd.removecounter.desc   cmd.removecounter.opt.name.desc
cmd.renamecounter.desc   cmd.renamecounter.opt.name.desc  cmd.renamecounter.opt.new_name.desc
cmd.counter.desc         cmd.counter.opt.name.desc
cmd.counters.desc
cmd.increment.desc       cmd.increment.opt.name.desc
cmd.decrement.desc       cmd.decrement.opt.name.desc
```

Rules for the translations (the implementer writes them):

- Every key has all 30 translated locales (the type enforces it; the register script checks
  too). To drop a locale on purpose, remove it from `LOCALES`, never leave a hole.
- Every description, in every language, is 1–100 characters (Discord's hard limit; the
  validator enforces it). Aim for ≤ 80 so the command picker does not truncate it. The
  8000-character per-command size limit is not a constraint here: Discord counts only the
  **longest** localization of each field (default included), so even `/addcounter` with three
  localized fields sums to a few hundred characters at most.
- Plain sentences, no trailing period, no emoji in descriptions (Discord renders them inconsistently in the command picker).

`definitions.ts` builds `RESTPutAPIApplicationCommandsJSONBody` from these strings:

```ts
{ name: "addcounter", type: ChatInput,
  description: STR["cmd.addcounter.desc"].en,
  description_localizations: localizations(STR["cmd.addcounter.desc"]),
  integration_types: [GuildInstall], contexts: [Guild, BotDM],
  default_member_permissions: PermissionFlagsBits.ManageChannels.toString(),  // sensitive commands only
  options: [
    { type: String, name: "name", required: true, min_length: 1, max_length: 100,
      description: ..., description_localizations: ... },
    { type: String, name: "description", required: false, min_length: 1, max_length: 500, ... },
  ] }
```

`name_localizations` is deliberately omitted (D9); leave a one-line comment saying where it
would go.

## 14. Command registration script (`scripts/register-commands.ts`)

Run locally: `npm run register` (needs `DISCORD_BOT_TOKEN` in the environment or in
`.dev.vars`, which the script parses itself as simple `KEY=VALUE` lines).

1. Import `COMMANDS` from `src/commands/definitions.ts`. Read `DISCORD_APPLICATION_ID` from
   `wrangler.jsonc` `vars` using the `jsonc-parser` package (`parse(text)`), so the ID has a
   single source of truth; allow a `DISCORD_APPLICATION_ID` environment variable to override it.
2. **Validate before calling Discord** (fail with a clear message):
   - command names unique, lowercase, match `^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$` (u flag);
   - descriptions and every localized description 1–100 chars;
   - option names unique per command; `required` options come before optional ones;
   - every `LocalizedString` covers all `TRANSLATED_LOCALES`;
   - per-command combined size ≤ 8000, computed the way Discord does: for each field
     (command name/description, option names/descriptions, choice names/values) take the
     **longest** of the default value and its localizations, then sum those maxima across the
     command — do not add every localization together;
   - `contexts` and `integration_types` present on every command;
   - every command in `SENSITIVE_COMMANDS` has `default_member_permissions === "16"` and every
     other command has no `default_member_permissions` at all.
3. `--dry-run`: print the JSON payload and validation summary; exit 0 without network.
4. Otherwise `PUT ${RouteBases.api}${Routes.applicationCommands(appId)}` with
   `Authorization: Bot <token>` and the array body (bulk overwrite; idempotent). Print each
   registered command's `id`, `name`, `version`. Non-2xx → print status + body, exit 1.

Global commands can take up to an hour to propagate to clients; guild-scoped registration is
not used, so allow for that during first testing (or add an optional `--guild <id>` flag that
targets `Routes.applicationGuildCommands` for instant iteration — nice-to-have).

## 15. Tests (`test/`, Vitest 4 + `@cloudflare/vitest-plugin`)

Run inside workerd via the plugin; Durable Objects are real (SQLite), storage is isolated per
test file. The plugin injects `nodejs_compat` into tests automatically — do not let that mask a
Node import in `src/` (the `typecheck`/`deploy` path would still catch it, but keep `src/` free
of `node:*`).

- `fixtures/keys.ts`: a committed test-only Ed25519 keypair (`TEST_PUBLIC_KEY_HEX`,
  `TEST_PRIVATE_KEY_PKCS8_B64`). Generate once with WebCrypto
  (`crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])`) and paste in.
- `helpers.ts`: `signInteraction(bodyJson)` → `{ headers, body }` using
  `crypto.subtle.sign("Ed25519", key, timestamp + body)`; factories for chat-input and button
  interactions (guild variant with `member.permissions`, DM variant with `user`).
- `names.test.ts`: accept `a`, `Foo123`, 100 chars; reject empty, 101 chars, spaces, `-`, `_`,
  non-ASCII; key is lowercased, display preserved.
- `registry.test.ts` (via `env.COUNTER_REGISTRY.getByName("test")` RPC): create; duplicate →
  `exists`; case-insensitive duplicate (`Foo` vs `foo`) → `exists`; remove then create →
  `deleted` + token; `claimRestore` (wrong user → `forbidden`; twice → `unknown`); two prompts
  for the same counter: claiming one makes the other `unknown`; claim after another prompt
  already restored the counter → `stale`; claim after restore + remove again (generation bumped)
  → `stale`; claim after restore → rename → re-create of the original name → `stale` and the new
  counter is untouched; while a claim is live, `create` for that name → `busy` and a second claim
  → `busy`; a claim older than `RESTORE_CLAIM_TTL_MS` is ignored; `finalizeRestore` applies the
  supplied display/description and keeps the old description when given `null`;
  `finalizeRestore` with a token that holds no claim → `lost_claim`; `cancelPendingRestore`
  returns the display name and deletes the row, and → `unknown` afterwards; create with
  `description: null` stores `NULL`; rename casing-only; rename to taken → `target_exists`; rename
  to deleted → `target_deleted`; list pagination with 45 rows → 3 pages, sorted, clamped.
- `counter.test.ts`: `adjust(+1)` ×3 → 3; `adjust(-1)` below zero → -1; `reset()` → 0;
  100 concurrent `adjust(+1)` via `Promise.all` → exactly 100; seed `count` to
  `Number.MAX_SAFE_INTEGER` via `runInDurableObject`, then `adjust(+1)` returns exactly
  `Number.MAX_SAFE_INTEGER` (clamped, no precision loss); same at the negative bound.
- `interactions.test.ts` (through `exports.default.fetch` / `SELF.fetch`): PING → PONG; missing
  headers → 401; bad signature → 401; `/addcounter` → public message; `/increment` twice → 2;
  `/counter` shows the 📝 line when a description exists and omits it otherwise; `/addcounter`
  without `description` succeeds; `/counters` ephemeral flag set and embed present; sensitive
  command in a bot DM works; remove → re-add shows three buttons; clicking `keep` → public message with old count; clicking `zero` → 0;
  clicking `cancel` → `UPDATE_MESSAGE` naming the counter; with two prompts open, restoring via
  the first then clicking `zero` on the second → prompt replaced by the expired message and the
  count unchanged. Stub outbound `fetch` to Discord (the `@original` PATCH)
  with `vi.spyOn(globalThis, "fetch")` or `miniflare.outboundService`, asserting the URL.
- `register.test.ts`: `COMMANDS` passes the validator; every key in `strings.ts` has 30
  locales; no description over 100 chars in any locale; the size validator counts only the
  longest localization per field; the three sensitive commands carry
  `default_member_permissions === "16"` and the other four carry none.

`npm test` must pass and `npm run typecheck` must be clean before the work is considered done.

## 16. Deployment and Discord setup checklist

1. `npm install` → `npm run typecheck` → `npm test`.
2. Publish the repository to GitHub — see §16.1 for the exact preconditions and commands.
3. `npx wrangler login` (interactive; the human runs this) then `npm run deploy`.
   First deploy provisions both DO namespaces (SQLite) and the custom domain
   `aeolipyle.judge.sh`. Check `curl https://aeolipyle.judge.sh/healthz` → `ok`.
4. Put the bot token in `.dev.vars` (never committed) and run `npm run register:dry`, then
   `npm run register`.
5. Discord Developer Portal → application `1546275044819345408`:
   - **General Information → Interactions Endpoint URL** = `https://aeolipyle.judge.sh/interactions`
     → Save. Discord sends a PING and some deliberately bad signatures; the save succeeds only
     if the Worker answers PONG and 401s the bad ones (§6 steps 1–5).
   - **Installation**: Guild Install enabled; default install scopes `applications.commands`
     and `bot` with no permissions (the bot never sends messages outside interactions).
     Bot DMs work with guild-install only, provided the user shares a server with the bot.
6. Invite the bot to a test server with
   `https://discord.com/oauth2/authorize?client_id=1546275044819345408&scope=bot+applications.commands&permissions=0`.
7. Smoke test in the server and in a DM with the bot: every command, the restore buttons, and
   `/counters` pagination with > 20 counters. As a member **without** Manage Channels, confirm
   the three sensitive commands do not appear in the picker; then, as an admin, grant one of
   them to a role under Server Settings → Integrations → Aeolipyle and confirm the override works.
8. Optional: connect the GitHub repository to **Workers Builds** so pushes to `main` deploy
   automatically (build command `npm ci && npm run types`, deploy command `npx wrangler deploy`).
   Not required for the "runs forever" goal — the deployed Worker has no scheduled tasks and
   nothing to expire.

### 16.1 Publishing to GitHub (authorized)

The implementation agent **is authorized** to commit this project and publish it as a **public**
repository at `github.com/judge2020/aeolipyle`, subject to every check below passing. The repo
did not exist as of 2026-09-06.

**Precondition — the active `gh` account must be `judge2020`.** This machine has more than one
GitHub account logged into `gh`, so check the *active* account, not merely that some login
exists:

```sh
gh auth status                 # must show "Logged in to github.com account judge2020" with "Active account: true"
gh api user --jq .login        # must print exactly: judge2020
```

If either check fails, **stop**: do not switch accounts, do not create a repository, do not
push. Report the mismatch to the human and continue with the non-publishing steps.

**Pre-publish hygiene** (the repository is public, so this is mandatory):

- `.gitignore` is in place (§5.5) and `git status --ignored` lists `.dev.vars` under ignored.
- `git ls-files` contains neither `.dev.vars` nor `worker-configuration.d.ts`.
- `git grep -n "DISCORD_BOT_TOKEN"` matches only `.dev.vars.example`, the register script, and
  documentation — never a real token value. The application ID and interactions public key
  are public by design and may be committed.
- `README.md` is committed unchanged (agent rule).

**Commit-message rules** for this and every later commit:

- One line, no body, no trailers.
- Imperative mood, sentence case, no trailing period — e.g.
  `Add Discord counter bot on Cloudflare Workers`.
- Describe the change, not the process. No mention of tooling or agents, and **no AI
  attribution of any kind** (no `Co-Authored-By`, no "Generated with", no robot emoji).

**Commands** (run only after §16 step 1 is green):

```sh
git init -b main                                  # if not already done
git add -A
git commit -m "Add Discord counter bot on Cloudflare Workers"
gh repo create judge2020/aeolipyle --public --source=. --remote=origin \
  --description "Slash-command counter bot for Discord, running on Cloudflare Workers" --push
gh repo view judge2020/aeolipyle --json url,visibility   # expect visibility PUBLIC
```

Further commits and pushes to `main` during the implementation are allowed under the same
rules. Do not create additional repositories, change visibility, or push to any other remote.

## 17. Out of scope for this iteration (possible follow-ups)

- Autocomplete on `name` options (`APPLICATION_COMMAND_AUTOCOMPLETE` → registry prefix search,
  ≤ 25 choices). High UX value; add after the base works.
- Localized bot responses keyed on `interaction.locale` (strings already centralised, D10).
- `name_localizations` (D9).
- Per-counter history/audit (who incremented when) — would live in the `Counter` DO.
- User-install / group-DM contexts.
- Hard delete / purge of long-soft-deleted counters.
- An override-proof server-side permission re-check for sensitive commands (D7), if ever wanted.
