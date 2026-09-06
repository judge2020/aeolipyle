import { ephemeral, reply } from "../discord/respond";
import { getStringOption } from "../discord/options";
import { validateCounterName } from "../lib/names";
import { MSG } from "../messages";
import { commandContext } from "./shared";
import type { CommandHandler } from "./shared";
export const renamecounter: CommandHandler = async (interaction, env) => {
  const { registry, name } = commandContext(interaction, env);
  const newName = validateCounterName(getStringOption(interaction, "new_name") ?? "");
  if (!name.ok || !newName.ok) return ephemeral(MSG.badName);
  const res = await registry.rename(name.key, newName.display);
  switch (res.status) {
    case "renamed": return reply(MSG.renamed(res.before.displayName, res.after.displayName));
    case "not_found": return ephemeral(MSG.notFound(name.display));
    case "target_exists": return ephemeral(MSG.renameTargetExists(res.target.displayName));
    case "target_deleted": return ephemeral(MSG.renameTargetDeleted(res.target.displayName, res.target.deletedAt!));
  }
};
