import type { APIMessageComponentInteraction } from "discord-api-types/v10";
import { countersPage } from "../commands/counters";
import { updateMessage } from "../discord/respond";
import { scopeKeyFor } from "../discord/scope";
export const countersPageButton = async (interaction: APIMessageComponentInteraction, env: Env, page: number) => updateMessage(await countersPage(env, scopeKeyFor(interaction), page));
