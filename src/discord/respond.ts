import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import type {
  APIInteractionResponseCallbackData,
  APIInteractionResponseChannelMessageWithSource,
  APIInteractionResponseUpdateMessage,
} from "discord-api-types/v10";

/** Message payload without flags; visibility is chosen by the helper used. */
export type MessageBody = Omit<APIInteractionResponseCallbackData, "flags">;

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

/** Every outgoing message suppresses mentions: descriptions are user-supplied text. */
function withSafeMentions(body: string | MessageBody): MessageBody {
  const data = typeof body === "string" ? { content: body } : body;
  return { ...data, allowed_mentions: { parse: [] } };
}

/** Public reply to the interaction. */
export function reply(body: string | MessageBody): APIInteractionResponseChannelMessageWithSource {
  return { type: InteractionResponseType.ChannelMessageWithSource, data: withSafeMentions(body) };
}

/** Reply visible only to the invoking user. */
export function ephemeral(body: string | MessageBody): APIInteractionResponseChannelMessageWithSource {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { ...withSafeMentions(body), flags: MessageFlags.Ephemeral },
  };
}

/** Edit the message a button was attached to. Embeds and buttons are cleared unless the body sets them. */
export function updateMessage(body: string | MessageBody): APIInteractionResponseUpdateMessage {
  return {
    type: InteractionResponseType.UpdateMessage,
    data: { components: [], embeds: [], ...withSafeMentions(body) },
  };
}
