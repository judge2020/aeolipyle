import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import type { RESTPutAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import { TRANSLATED_LOCALES } from "../i18n/locales";
import { STR } from "../i18n/strings";
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from "../lib/limits";
import { SENSITIVE_COMMANDS } from "./sensitive";

type Localized = Partial<Record<string, string | null>> | null | undefined;
type Command = RESTPutAPIApplicationCommandsJSONBody[number];

const EXPECTED_CONTEXTS = JSON.stringify([InteractionContextType.Guild, InteractionContextType.BotDM]);
const EXPECTED_INTEGRATION_TYPES = JSON.stringify([ApplicationIntegrationType.GuildInstall]);
const MANAGE_CHANNELS = PermissionFlagsBits.ManageChannels.toString();
/** Discord's regex for chat-input command and option names. */
const NAME_RE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

const length = (s: string): number => [...s].length;

/** Discord's size rule: per field, only the longest of the default and its localizations counts. */
function longest(value: string, localized?: Localized): number {
  return Math.max(length(value), ...Object.values(localized ?? {}).map(v => length(v ?? "")));
}

function checkName(name: string): void {
  if (!NAME_RE.test(name) || name.toLowerCase() !== name) throw new Error(`Invalid name: ${name}`);
}

function checkDescriptions(description: string, localized?: Localized): void {
  for (const value of [description, ...Object.values(localized ?? {})]) {
    if (!value || length(value) > 100) throw new Error("Descriptions must contain 1–100 characters");
  }
  for (const locale of TRANSLATED_LOCALES) {
    if (!localized?.[locale]) throw new Error(`Missing description locale: ${locale}`);
  }
}

/** Combined size as Discord counts it toward the 8000-character limit. */
export function commandSize(command: Command): number {
  let size = longest(command.name, command.name_localizations);
  if (command.type !== undefined && command.type !== ApplicationCommandType.ChatInput) return size;
  size += longest(command.description, command.description_localizations);
  for (const option of command.options ?? []) {
    size += longest(option.name, option.name_localizations) + longest(option.description, option.description_localizations);
    if ("choices" in option) {
      for (const choice of option.choices ?? []) {
        size += longest(choice.name, choice.name_localizations) + (typeof choice.value === "string" ? length(choice.value) : 0);
      }
    }
  }
  return size;
}

function checkOptions(command: Command): void {
  if (command.type !== ApplicationCommandType.ChatInput) return;
  const seen = new Set<string>();
  let optionalSeen = false;
  for (const option of command.options ?? []) {
    checkName(option.name);
    if (seen.has(option.name)) throw new Error(`Duplicate option: ${option.name}`);
    seen.add(option.name);
    checkDescriptions(option.description, option.description_localizations);
    if (option.type !== ApplicationCommandOptionType.String) throw new Error("Only string options are supported");
    if (option.required && optionalSeen) throw new Error("Required options must come first");
    if (!option.required) optionalSeen = true;
    const expectedMax = option.name === "description" ? MAX_DESCRIPTION_LENGTH : MAX_NAME_LENGTH;
    if (option.min_length !== 1 || option.max_length !== expectedMax) throw new Error("Invalid option length bounds");
  }
}

/** Fails fast, before any network call, on anything Discord would reject or that drifts from the plan. */
export function validateCommands(commands: RESTPutAPIApplicationCommandsJSONBody = []): void {
  for (const [key, s] of Object.entries(STR)) {
    for (const locale of TRANSLATED_LOCALES) {
      if (!s[locale] || length(s[locale]) > 100) throw new Error(`Invalid translation: ${key}/${locale}`);
    }
  }

  const names = new Set<string>();
  for (const command of commands) {
    checkName(command.name);
    if (names.has(command.name)) throw new Error(`Duplicate command: ${command.name}`);
    names.add(command.name);
    if (command.type !== ApplicationCommandType.ChatInput) throw new Error("Only chat-input commands are supported");
    checkDescriptions(command.description, command.description_localizations);

    if (JSON.stringify(command.contexts) !== EXPECTED_CONTEXTS || JSON.stringify(command.integration_types) !== EXPECTED_INTEGRATION_TYPES) {
      throw new Error(`Invalid contexts or integration types: ${command.name}`);
    }
    const permissionMismatch = SENSITIVE_COMMANDS.has(command.name)
      ? command.default_member_permissions !== MANAGE_CHANNELS
      : "default_member_permissions" in command;
    if (permissionMismatch) throw new Error(`Invalid permissions: ${command.name}`);

    checkOptions(command);
    if (commandSize(command) > 8000) throw new Error(`Command exceeds 8000 characters: ${command.name}`);
  }
  for (const sensitive of SENSITIVE_COMMANDS) {
    if (!names.has(sensitive)) throw new Error(`Missing sensitive command: ${sensitive}`);
  }
}
