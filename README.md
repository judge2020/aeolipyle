# Aeolipyle 

> *Aeolipile - a simple, bladeless radial steam turbine whick spins when the central water container is heated.

One-shot vibecoded incrementer project to replace parts of the [Sweetiebot](https://github.com/erikmcclure/sweetiebot) Discord bot.

`prompts/` contains the larger plans / design prompts (although will not contain every single prompt used in this repo, or full conversations).

## Environment

Planning agent of choice: Anthropic Fable 5.1 [xhigh] via Claude Code, with gpt-6-astra [high] via Codex doing a single pass check on the plan afterwards.
Implementation agent of choice: gpt-6-astra [high] via Codex.

Using the following Cloudflare MCPs to facilitate high-quality Cloudflare related work:
plugin:cloudflare:cloudflare-api: https://mcp.cloudflare.com/mcp (HTTP) - ✔ Connected
plugin:cloudflare:cloudflare-docs: https://docs.mcp.cloudflare.com/mcp (HTTP) - ✔ Connected
plugin:cloudflare:cloudflare-bindings: https://bindings.mcp.cloudflare.com/mcp (HTTP) - ✔ Connected
plugin:cloudflare:cloudflare-builds: https://builds.mcp.cloudflare.com/mcp (HTTP) - ✔ Connected
plugin:cloudflare:cloudflare-observability: https://observability.mcp.cloudflare.com/mcp (HTTP) - ✔ Connected

Design goals:
We want this to run de-facto forever/indefinitely, so it shall run entirely on Cloudflare Workers, Wrangler, latest javascript api(s), etc.
This will run as a Discord bot, but completely via Interactions / slash commands, to be stateless and to not require.
Wrangler.jsonc may contain non-secret env vars, as well as hostnames and other configurations.

Agent Rules:
README.md not to be written to by agent.
Do not look at sweetiebot source code, or source code of other repositories on the running computer.
