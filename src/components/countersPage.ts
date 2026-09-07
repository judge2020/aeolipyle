import type { APIMessageComponentInteraction } from "discord-api-types/v10";
import { countersPage } from "../commands/counters";
import { updateMessage } from "../discord/respond";
import { scopeKeyFor } from "../discord/scope";

/** Prev/Next on the ephemeral `/counters` list: re-render the requested page in place. */
export async function countersPageButton(interaction: APIMessageComponentInteraction, env: Env, page: number) {
  return updateMessage(await countersPage(env, scopeKeyFor(interaction), page));
}
