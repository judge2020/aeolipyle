import { RouteBases, Routes } from "discord-api-types/v10";
import type { MessageBody } from "./respond";

/** Interaction-token webhook call. Needs no bot token; the interaction token itself authorises it. */
async function webhookRequest(method: string, route: string, token: string, body: MessageBody): Promise<void> {
  const response = await fetch(`${RouteBases.api}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Never let the token leak into logs via an echoed error body.
    const detail = (await response.text()).split(token).join("[redacted]").slice(0, 300);
    throw new Error(`Discord webhook HTTP ${response.status}: ${detail}`);
  }
  await response.body?.cancel();
}

/** Edit the original response of an earlier interaction (used to tidy the restore prompt). */
export function editOriginalResponse(env: Env, token: string, body: MessageBody): Promise<void> {
  return webhookRequest("PATCH", Routes.webhookMessage(env.DISCORD_APPLICATION_ID, token, "@original"), token, body);
}
