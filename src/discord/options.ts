import { ApplicationCommandOptionType } from "discord-api-types/v10";
import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
export function getStringOption(interaction: APIChatInputApplicationCommandInteraction, name: string): string | undefined {
  const option = interaction.data.options?.find(option => option.name === name);
  return option?.type === ApplicationCommandOptionType.String ? option.value : undefined;
}
