import { ephemeral, reply } from "../discord/respond";
import { MSG } from "../messages";
import { commandContext } from "./shared";
import type { CommandHandler } from "./shared";
export const adjustCommand = (delta: 1 | -1): CommandHandler => async (interaction, env) => {
  const { registry, name } = commandContext(interaction, env);
  if (!name.ok) return ephemeral(MSG.badName);
  const row = await registry.lookup(name.key);
  if (!row) return ephemeral(MSG.notFound(name.display));
  const count = await env.COUNTER.getByName(row.counterId).adjust(delta);
  return reply((delta === 1 ? MSG.incremented : MSG.decremented)(row.displayName, count));
};
export const increment = adjustCommand(1);
