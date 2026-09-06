import type { APIInteraction, APIUser } from "discord-api-types/v10";
export function invokingUser(interaction: APIInteraction): APIUser {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) throw new Error("Interaction has no invoking user");
  return user;
}
export const scopeKeyFor = (interaction: APIInteraction): string => interaction.guild_id ? `guild:${interaction.guild_id}` : `user:${invokingUser(interaction).id}`;
