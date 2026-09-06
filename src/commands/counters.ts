import { ephemeral } from "../discord/respond";
import { scopeKeyFor } from "../discord/scope";
import { renderCountersPage } from "../messages";
import type { CommandHandler } from "./shared";
export async function countersPage(env: Env, scope: string, pageNumber: number) {
  const page = await env.COUNTER_REGISTRY.getByName(scope).list(pageNumber);
  const counts = await Promise.all(page.items.map(item => env.COUNTER.getByName(item.counterId).getCount()));
  return renderCountersPage(page, counts);
}
export const counters: CommandHandler = async (interaction, env) => ephemeral(await countersPage(env, scopeKeyFor(interaction), 0));
