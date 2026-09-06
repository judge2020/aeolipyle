import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import type { APIInteractionResponseChannelMessageWithSource, APIInteractionResponseUpdateMessage, APIInteractionResponseCallbackData } from "discord-api-types/v10";
export type MessageBody = Omit<APIInteractionResponseCallbackData, "flags">;
export const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const bodyFor = (body: string | MessageBody): MessageBody => ({ ...(typeof body === "string" ? { content: body } : body), allowed_mentions: { parse: [] } });
export const reply = (body: string | MessageBody): APIInteractionResponseChannelMessageWithSource => ({ type: InteractionResponseType.ChannelMessageWithSource, data: bodyFor(body) });
export const ephemeral = (body: string | MessageBody): APIInteractionResponseChannelMessageWithSource => ({ type: InteractionResponseType.ChannelMessageWithSource, data: { ...bodyFor(body), flags: MessageFlags.Ephemeral } });
export const updateMessage = (body: string | MessageBody): APIInteractionResponseUpdateMessage => ({ type: InteractionResponseType.UpdateMessage, data: { components: [], embeds: [], ...bodyFor(body) } });
