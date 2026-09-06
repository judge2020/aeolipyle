import { ApplicationCommandType, InteractionResponseType, InteractionType } from "discord-api-types/v10";
import type { APIInteraction, APIInteractionResponse, APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import { commands } from "./commands";
import { dispatch } from "./components";
import { ephemeral, json } from "./discord/respond";
import { invokingUser, scopeKeyFor } from "./discord/scope";
import { verifyDiscordRequest } from "./discord/verify";
import { MSG } from "./messages";
export { CounterRegistry } from "./durable-objects/CounterRegistry";
export { Counter } from "./durable-objects/Counter";

async function handleInteractions(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const start = Date.now();
  const verified = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
  if (!verified.ok) return new Response("invalid request signature", { status: 401 });
  let interaction: APIInteraction;
  try {
    const parsed: unknown = JSON.parse(verified.body);
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed) || typeof parsed.type !== "number") throw new Error("Invalid interaction");
    interaction = parsed as APIInteraction;
  } catch { return new Response("invalid interaction JSON", { status: 400 }); }
  let outcome = "ok";
  const task = (async (): Promise<APIInteractionResponse> => {
    switch (interaction.type) {
      case InteractionType.Ping: return { type: InteractionResponseType.Pong };
      case InteractionType.ApplicationCommand: {
        if (interaction.data.type !== ApplicationCommandType.ChatInput) return ephemeral(MSG.unsupported);
        const handler = commands.get(interaction.data.name);
        return handler ? handler(interaction as APIChatInputApplicationCommandInteraction, env, ctx) : ephemeral(MSG.unknownCommand);
      }
      case InteractionType.MessageComponent: return dispatch(interaction, env, ctx);
      default: return ephemeral(MSG.unsupported);
    }
  })().catch(() => {
    outcome = "error";
    console.error({ event: "interaction_error", type: interaction.type });
    return ephemeral(MSG.internalError);
  });
  // Keep an already-started mutation alive if the deadline response wins.
  ctx.waitUntil(task.then(() => undefined));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<APIInteractionResponse>(resolve => {
    timer = setTimeout(() => { outcome = "timeout"; resolve(ephemeral(MSG.tookTooLong)); }, Math.max(0, 2500 - (Date.now() - start)));
  });
  try {
    return json(await Promise.race([task, deadline]));
  } finally {
    clearTimeout(timer);
    let scope: string | undefined;
    let userId: string | undefined;
    try { scope = scopeKeyFor(interaction); userId = invokingUser(interaction).id; } catch { /* PING has no user. */ }
    console.log({ event: "interaction", type: interaction.type,
      ...(interaction.type === InteractionType.ApplicationCommand ? { command: interaction.data?.name } : {}),
      ...(interaction.type === InteractionType.MessageComponent ? { customId: interaction.data?.custom_id } : {}),
      scope, userId, ms: Date.now() - start, outcome });
  }
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/") return new Response(MSG.home);
    if (request.method === "GET" && path === "/healthz") return new Response("ok");
    if (path !== "/interactions") return new Response("not found", { status: 404 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    return handleInteractions(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
