import { ephemeral, reply } from "../discord/respond";
import { MSG } from "../messages";
import { commandContext } from "./shared";
import type { CommandHandler } from "./shared";
export const removecounter: CommandHandler = async (interaction, env) => {
  const { user, registry, name } = commandContext(interaction, env);
  if (!name.ok) return ephemeral(MSG.badName);
  const row = await registry.remove(name.key, user.id);
  if (!row) return ephemeral(MSG.notFound(name.display));
  const count = await env.COUNTER.getByName(row.counterId).getCount().catch(() => undefined);
  return reply(MSG.removed(row.displayName, count));
};
