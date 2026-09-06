import { ephemeral, reply } from "../discord/respond";
import { MSG } from "../messages";
import { commandContext } from "./shared";
import type { CommandHandler } from "./shared";
export const counter: CommandHandler = async (interaction, env) => {
  const { registry, name } = commandContext(interaction, env);
  if (!name.ok) return ephemeral(MSG.badName);
  const row = await registry.lookup(name.key);
  if (!row) return ephemeral(MSG.notFound(name.display));
  return reply(MSG.counterStatus(row.displayName, await env.COUNTER.getByName(row.counterId).getCount(), row.description));
};
