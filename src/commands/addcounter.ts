import { getStringOption } from "../discord/options";
import { ephemeral, reply } from "../discord/respond";
import { MAX_DESCRIPTION_LENGTH } from "../lib/limits";
import { MSG, renderRestorePrompt } from "../messages";
import { commandContext } from "./shared";
import type { CommandHandler } from "./shared";

export const addcounter: CommandHandler = async (interaction, env) => {
  const { user, registry, name } = commandContext(interaction, env);
  if (!name.ok) return ephemeral(MSG.badName);

  // Optional; a blank description counts as absent.
  const description = getStringOption(interaction, "description")?.trim() || null;
  if (description && [...description].length > MAX_DESCRIPTION_LENGTH) return ephemeral(MSG.badDescription);

  const res = await registry.create({ displayName: name.display, description, userId: user.id, interactionToken: interaction.token });
  switch (res.status) {
    case "created":
      return reply(MSG.created(res.counter.displayName, res.counter.description));
    case "exists":
      return ephemeral(MSG.alreadyExists(res.counter.displayName));
    case "busy":
      return ephemeral(MSG.restoreBusy);
    case "deleted": {
      // The name belongs to a soft-deleted counter: offer to bring it back, showing its last count.
      const lastCount = await env.COUNTER.getByName(res.counter.counterId).getCount();
      return ephemeral(renderRestorePrompt(res.counter.displayName, res.counter.deletedAt!, lastCount, res.restoreToken));
    }
  }
};
