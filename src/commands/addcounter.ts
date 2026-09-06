import { getStringOption } from "../discord/options";
import { ephemeral, reply } from "../discord/respond";
import { MSG, renderRestorePrompt } from "../messages";
import { commandContext } from "./shared";
import type { CommandHandler } from "./shared";
export const addcounter: CommandHandler = async (interaction, env) => {
  const { user, registry, name } = commandContext(interaction, env);
  if (!name.ok) return ephemeral(MSG.badName);
  const description = getStringOption(interaction, "description")?.trim() || null;
  if (description && [...description].length > 500) return ephemeral(MSG.badDescription);
  const res = await registry.create({ displayName: name.display, description, userId: user.id, interactionToken: interaction.token });
  switch (res.status) {
    case "created": return reply(MSG.created(res.counter.displayName, res.counter.description));
    case "exists": return ephemeral(MSG.alreadyExists(res.counter.displayName));
    case "busy": return ephemeral(MSG.restoreBusy);
    case "deleted": return ephemeral(renderRestorePrompt(res.counter.displayName, res.counter.deletedAt!, await env.COUNTER.getByName(res.counter.counterId).getCount(), res.restoreToken));
  }
};
