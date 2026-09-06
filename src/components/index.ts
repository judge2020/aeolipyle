import type { APIMessageComponentInteraction, APIInteractionResponse } from "discord-api-types/v10";
import { ephemeral } from "../discord/respond";
import { MSG } from "../messages";
import { parseCustomId } from "./customId";
import { addcounterRestore } from "./addcounterRestore";
import { countersPageButton } from "./countersPage";
export async function dispatch(interaction: APIMessageComponentInteraction, env: Env, ctx: ExecutionContext): Promise<APIInteractionResponse> {
  const id = parseCustomId(interaction.data.custom_id);
  if (!id) return ephemeral(MSG.staleButton);
  return id.kind === "page" ? countersPageButton(interaction, env, id.page) : addcounterRestore(interaction, env, ctx, id);
}
