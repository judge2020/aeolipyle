# Deployment verification

Deployed on 2026-09-06.

- Public repository: https://github.com/judge2020/aeolipyle
- Cloudflare account: Judge (`588bf4099b3f4afed2ac29958b07b7d3`)
- Worker: `aeolipyle`
- Version: `d14a5674-600a-4a53-962e-32e8b46abb35`
- Custom domain: https://aeolipyle.judge.sh
- Discord application: `1546275044819345408` (currently named `SweetieAI` in Discord)
- Interactions endpoint: https://aeolipyle.judge.sh/interactions

## Verified

- `npm run typecheck` completed successfully.
- `npm test`: 47 tests passed across five files, using real SQLite Durable Objects in workerd.
- `npm run register:dry` validated seven commands and 30 non-English locales per description.
- `npm run deploy -- --dry-run` succeeded without `nodejs_compat`.
- `npm run deploy` created both SQLite Durable Object namespaces and the custom domain.
- Worker startup time reported by Cloudflare: 17 ms.
- Production `GET /healthz`: HTTP 200, `ok`.
- Production `GET /`: HTTP 200 with the bot's identifying text.
- Production unsigned and deliberately invalidly signed interactions: HTTP 401.
- Discord accepted the interactions endpoint; live Cloudflare logs captured its signed PING
  completing successfully.
- `npm run register` registered all seven global commands. Read-back from Discord confirmed
  30 translations on every command and option description, guild/bot-DM contexts, guild-only
  installation, and Manage Channels (`16`) on precisely add/remove/rename.
- Discord install defaults are `applications.commands` and `bot`, with permissions `0`.
- The GitHub repository is public. Local credentials, editor recovery files, dependencies,
  generated runtime declarations, and build output are ignored. `README.md` is unchanged.

## Remaining human verification

At deployment time Discord reported zero installed guilds. Installation into a test server and
Discord-client smoke testing require a user's account. Follow the server/DM/button/pagination
and permission-override checks in [OPERATIONS.md](OPERATIONS.md#live-smoke-test).
These client checks are distinct from the automated interaction tests, which already pass.

[Install the bot](https://discord.com/oauth2/authorize?client_id=1546275044819345408&scope=bot+applications.commands&permissions=0).
