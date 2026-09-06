import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { parse, type ParseError } from "jsonc-parser";
import { RouteBases, Routes } from "discord-api-types/v10";
import type { RESTPutAPIApplicationCommandsResult } from "discord-api-types/v10";
import { COMMANDS } from "../src/commands/definitions";
import { validateCommands } from "../src/commands/validate";

async function main(): Promise<void> {
  validateCommands(COMMANDS);
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(COMMANDS, null, 2));
    console.log(`Validated ${COMMANDS.length} commands, each with 30 translated locales`);
    return;
  }
  const errors: ParseError[] = [];
  const config: { vars?: { DISCORD_APPLICATION_ID?: string } } = parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"), errors);
  if (errors.length) throw new Error("Invalid wrangler.jsonc");
  const appId = process.env.DISCORD_APPLICATION_ID ?? config.vars?.DISCORD_APPLICATION_ID;
  if (!appId || !/^\d+$/.test(appId)) throw new Error("Missing or invalid DISCORD_APPLICATION_ID");
  const vars = await readFile(new URL("../.dev.vars", import.meta.url), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const values = Object.fromEntries(vars.split(/\r?\n/).flatMap(line => {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    return match ? [[match[1]!, match[2]!.replace(/^(['"])(.*)\1$/, "$2")]] : [];
  }));
  const token = process.env.DISCORD_BOT_TOKEN ?? values.DISCORD_BOT_TOKEN;
  if (!token || token === "paste-bot-token-here") throw new Error("Set DISCORD_BOT_TOKEN in the environment or .dev.vars");
  const response = await fetch(`${RouteBases.api}${Routes.applicationCommands(appId)}`, {
    method: "PUT", headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(COMMANDS), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}: ${(await response.text()).split(token).join("[redacted]")}`);
  const registered = await response.json() as RESTPutAPIApplicationCommandsResult;
  for (const command of registered) console.log({ id: command.id, name: command.name, version: command.version });
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command registration failed");
  process.exitCode = 1;
});
