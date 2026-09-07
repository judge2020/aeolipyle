import { ApplicationCommandType, InteractionResponseType, InteractionType } from "discord-api-types/v10";
import type { APIChatInputApplicationCommandInteraction, APIInteraction, APIInteractionResponse } from "discord-api-types/v10";
import { commands } from "./commands";
import { dispatch as dispatchComponent } from "./components";
import { ephemeral, json } from "./discord/respond";
import { invokingUser, scopeKeyFor } from "./discord/scope";
import { verifyDiscordRequest } from "./discord/verify";
import { MSG } from "./messages";

// Wrangler needs the Durable Object classes exported from the main module.
export { CounterRegistry } from "./durable-objects/CounterRegistry";
export { Counter } from "./durable-objects/Counter";

/** Discord requires an initial response within 3 s; leave headroom for network transit. */
const RESPONSE_DEADLINE_MS = 2500;

function parseInteraction(body: string): APIInteraction | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed) || typeof parsed.type !== "number") return null;
    return parsed as APIInteraction;
  } catch {
    return null;
  }
}

async function routeInteraction(interaction: APIInteraction, env: Env, ctx: ExecutionContext): Promise<APIInteractionResponse> {
  switch (interaction.type) {
    case InteractionType.Ping:
      return { type: InteractionResponseType.Pong };
    case InteractionType.ApplicationCommand: {
      if (interaction.data.type !== ApplicationCommandType.ChatInput) return ephemeral(MSG.unsupported);
      const handler = commands.get(interaction.data.name);
      if (!handler) return ephemeral(MSG.unknownCommand);
      return handler(interaction as APIChatInputApplicationCommandInteraction, env, ctx);
    }
    case InteractionType.MessageComponent:
      return dispatchComponent(interaction, env, ctx);
    default:
      return ephemeral(MSG.unsupported);
  }
}

/** One structured line per interaction. Never includes the token or the payload. */
function logInteraction(interaction: APIInteraction, outcome: string, ms: number): void {
  let scope: string | undefined;
  let userId: string | undefined;
  try {
    scope = scopeKeyFor(interaction);
    userId = invokingUser(interaction).id;
  } catch {
    // PING carries no user.
  }
  console.log({
    event: "interaction",
    type: interaction.type,
    ...(interaction.type === InteractionType.ApplicationCommand ? { command: interaction.data.name } : {}),
    ...(interaction.type === InteractionType.MessageComponent ? { customId: interaction.data.custom_id } : {}),
    scope,
    userId,
    ms,
    outcome,
  });
}

async function handleInteractions(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const start = Date.now();

  const verified = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
  if (!verified.ok) return new Response("invalid request signature", { status: 401 });

  const interaction = parseInteraction(verified.body);
  if (!interaction) return new Response("invalid interaction JSON", { status: 400 });

  let outcome = "ok";
  const task = routeInteraction(interaction, env, ctx).catch((error: unknown) => {
    outcome = "error";
    const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
    console.error({ event: "interaction_error", type: interaction.type, ...detail });
    return ephemeral(MSG.internalError);
  });
  // If the deadline wins the race, let an already-started mutation finish in the background.
  ctx.waitUntil(task.then(() => undefined));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<APIInteractionResponse>(resolve => {
    const remaining = Math.max(0, RESPONSE_DEADLINE_MS - (Date.now() - start));
    timer = setTimeout(() => {
      outcome = "timeout";
      resolve(ephemeral(MSG.tookTooLong));
    }, remaining);
  });

  try {
    return json(await Promise.race([task, deadline]));
  } finally {
    clearTimeout(timer);
    logInteraction(interaction, outcome, Date.now() - start);
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
