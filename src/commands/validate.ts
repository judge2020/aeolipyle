import { ApplicationCommandType, ApplicationCommandOptionType, ApplicationIntegrationType, InteractionContextType } from "discord-api-types/v10";
import type { RESTPutAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import { SENSITIVE_COMMANDS } from "./sensitive";
import { TRANSLATED_LOCALES } from "../i18n/locales";
import { STR } from "../i18n/strings";
const length = (s: string): number => [...s].length;
const longest = (s: string, localized?: Partial<Record<string, string | null>> | null): number => Math.max(length(s), ...Object.values(localized ?? {}).map(value => length(value ?? "")));
const nameRE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
function checkName(name: string): void {
  if (!nameRE.test(name) || name.toLowerCase() !== name) throw new Error(`Invalid name: ${name}`);
}
function checkDescriptions(description: string, localized?: Partial<Record<string, string | null>> | null): void {
  for (const value of [description, ...Object.values(localized ?? {})]) {
    if (!value || length(value) > 100) throw new Error("Descriptions must contain 1–100 characters");
  }
  for (const locale of TRANSLATED_LOCALES) if (!localized?.[locale]) throw new Error(`Missing description locale: ${locale}`);
}
export function commandSize(command: RESTPutAPIApplicationCommandsJSONBody[number]): number {
  let size = longest(command.name, command.name_localizations);
  if (command.type !== undefined && command.type !== ApplicationCommandType.ChatInput) return size;
  size += longest(command.description, command.description_localizations);
  for (const option of command.options ?? []) {
    size += longest(option.name, option.name_localizations) + longest(option.description, option.description_localizations);
    if ("choices" in option) for (const choice of option.choices ?? []) {
      size += longest(choice.name, choice.name_localizations) + (typeof choice.value === "string" ? length(choice.value) : 0);
    }
  }
  return size;
}
export function validateCommands(commands: RESTPutAPIApplicationCommandsJSONBody = []): void {
  for (const [key, s] of Object.entries(STR)) for (const locale of TRANSLATED_LOCALES) {
    if (!s[locale] || length(s[locale]) > 100) throw new Error(`Invalid translation: ${key}/${locale}`);
  }
  const names = new Set<string>();
  for (const command of commands) {
    checkName(command.name);
    if (names.has(command.name)) throw new Error(`Duplicate command: ${command.name}`);
    names.add(command.name);
    if (command.type !== ApplicationCommandType.ChatInput) throw new Error("Only chat-input commands are supported");
    checkDescriptions(command.description, command.description_localizations);
    if (JSON.stringify(command.contexts) !== JSON.stringify([InteractionContextType.Guild, InteractionContextType.BotDM]) || JSON.stringify(command.integration_types) !== JSON.stringify([ApplicationIntegrationType.GuildInstall])) throw new Error(`Invalid contexts or integration types: ${command.name}`);
    if (SENSITIVE_COMMANDS.has(command.name) ? command.default_member_permissions !== "16" : "default_member_permissions" in command) throw new Error(`Invalid permissions: ${command.name}`);
    const optionNames = new Set<string>();
    let optionalSeen = false;
    for (const option of command.options ?? []) {
      checkName(option.name);
      if (optionNames.has(option.name)) throw new Error(`Duplicate option: ${option.name}`);
      optionNames.add(option.name);
      checkDescriptions(option.description, option.description_localizations);
      if (option.type !== ApplicationCommandOptionType.String) throw new Error("Only string options are supported");
      if (option.required && optionalSeen) throw new Error("Required options must come first");
      if (!option.required) optionalSeen = true;
      if (option.min_length !== 1 || option.max_length !== (option.name === "description" ? 500 : 100)) throw new Error("Invalid option length bounds");
    }
    if (commandSize(command) > 8000) throw new Error(`Command exceeds 8000 characters: ${command.name}`);
  }
  for (const sensitive of SENSITIVE_COMMANDS) if (!names.has(sensitive)) throw new Error(`Missing sensitive command: ${sensitive}`);
}
