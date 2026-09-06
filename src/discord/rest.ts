import { RouteBases, Routes } from "discord-api-types/v10";
import type { MessageBody } from "./respond";
async function webhookRequest(method: string, route: string, token: string, body: MessageBody): Promise<void> {
  const response = await fetch(`${RouteBases.api}${route}`, {
    method, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).split(token).join("[redacted]").slice(0, 300);
    throw new Error(`Discord webhook HTTP ${response.status}: ${detail}`);
  }
  await response.body?.cancel();
}
export const editOriginalResponse = (env: Env, token: string, body: MessageBody): Promise<void> => webhookRequest("PATCH", Routes.webhookMessage(env.DISCORD_APPLICATION_ID, token, "@original"), token, body);
export const createFollowup = (env: Env, token: string, body: MessageBody): Promise<void> => webhookRequest("POST", Routes.webhook(env.DISCORD_APPLICATION_ID, token), token, body);
