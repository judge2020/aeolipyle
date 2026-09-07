import type { APIInteraction, APIUser } from "discord-api-types/v10";

/** In guilds the user is nested under `member`; in bot DMs it is top-level. */
export function invokingUser(interaction: APIInteraction): APIUser {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) throw new Error("Interaction has no invoking user");
  return user;
}

/** Registry scope: one per guild, or one per user for bot DMs (and, defensively, anything without a guild). */
export function scopeKeyFor(interaction: APIInteraction): string {
  return interaction.guild_id ? `guild:${interaction.guild_id}` : `user:${invokingUser(interaction).id}`;
}
