import { ApplicationCommandType, ApplicationCommandOptionType, ComponentType, InteractionType, Locale, MessageFlags } from "discord-api-types/v10";
import { TEST_PRIVATE_KEY_PKCS8_B64 } from "./fixtures/keys";
export async function signInteraction(bodyJson: string) {
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(TEST_PRIVATE_KEY_PKCS8_B64), c => c.charCodeAt(0)), "Ed25519", false, ["sign"]);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(timestamp + bodyJson));
  return { headers: { "Content-Type": "application/json", "X-Signature-Timestamp": timestamp, "X-Signature-Ed25519": Array.from(new Uint8Array(signature), n => n.toString(16).padStart(2, "0")).join("") }, body: bodyJson };
}
const user = (id: string) => ({ id, username: "tester", discriminator: "0", avatar: null, global_name: null });
export function makeCommandInteraction(name: string, options: Record<string, string> = {}, guild: string | null = "guild", userId = "100") {
  return {
    id: crypto.randomUUID(), application_id: "1546275044819345408", token: "test-interaction-token", version: 1,
    type: InteractionType.ApplicationCommand, locale: Locale.EnglishUS,
    ...(guild ? { guild_id: guild, member: { user: user(userId), permissions: "0" } } : { user: user(userId) }),
    data: { id: "200", type: ApplicationCommandType.ChatInput, name, options: Object.entries(options).map(([name, value]) => ({ name, value, type: ApplicationCommandOptionType.String })) },
  };
}
export function makeButtonInteraction(customId: string, guild: string | null = "guild", userId = "100") {
  return { ...makeCommandInteraction("", {}, guild, userId), type: InteractionType.MessageComponent,
    data: { component_type: ComponentType.Button, custom_id: customId }, message: { id: "300", flags: MessageFlags.Ephemeral },
  };
}
