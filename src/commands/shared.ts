import type { APIChatInputApplicationCommandInteraction, APIInteractionResponse } from "discord-api-types/v10";
import { getStringOption } from "../discord/options";
import { invokingUser, scopeKeyFor } from "../discord/scope";
import { validateCounterName } from "../lib/names";

export type CommandHandler = (
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  ctx: ExecutionContext,
) => Promise<APIInteractionResponse>;

/** Everything a command handler needs: the invoker, this scope's registry, and the validated `name` option. */
export function commandContext(interaction: APIChatInputApplicationCommandInteraction, env: Env) {
  return {
    user: invokingUser(interaction),
    registry: env.COUNTER_REGISTRY.getByName(scopeKeyFor(interaction)),
    name: validateCounterName(getStringOption(interaction, "name") ?? ""),
  };
}
