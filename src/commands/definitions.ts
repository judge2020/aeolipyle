import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import type {
  APIApplicationCommandStringOption,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPutAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import { localizations } from "../i18n/locales";
import type { LocalizedString } from "../i18n/locales";
import { STR } from "../i18n/strings";
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from "../lib/limits";
import { SENSITIVE_COMMANDS } from "./sensitive";

const COMMAND_NAMES = ["addcounter", "removecounter", "renamecounter", "counter", "counters", "increment", "decrement"] as const;
type CommandName = (typeof COMMAND_NAMES)[number];

/** English description plus the 30 translated locales. Names stay English (plan decision D9). */
const translated = (s: LocalizedString) => ({ description: s.en, description_localizations: localizations(s) });

function stringOption(name: string, s: LocalizedString, required = true, maxLength = MAX_NAME_LENGTH): APIApplicationCommandStringOption {
  return { type: ApplicationCommandOptionType.String, name, ...translated(s), required, min_length: 1, max_length: maxLength };
}

function optionsFor(name: CommandName): APIApplicationCommandStringOption[] {
  if (name === "counters") return [];
  const options = [stringOption("name", STR[`cmd.${name}.opt.name.desc`])];
  if (name === "addcounter") options.push(stringOption("description", STR["cmd.addcounter.opt.description.desc"], false, MAX_DESCRIPTION_LENGTH));
  if (name === "renamecounter") options.push(stringOption("new_name", STR["cmd.renamecounter.opt.new_name.desc"]));
  return options;
}

export const COMMANDS: RESTPutAPIApplicationCommandsJSONBody = COMMAND_NAMES.map((name): RESTPostAPIChatInputApplicationCommandsJSONBody => ({
  name,
  type: ApplicationCommandType.ChatInput,
  ...translated(STR[`cmd.${name}.desc`]),
  // Add name_localizations here and on options if localized names are ever introduced.
  integration_types: [ApplicationIntegrationType.GuildInstall],
  contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
  // Discord enforces Manage Channels for the sensitive commands; the Worker does not re-check (plan decision D7).
  ...(SENSITIVE_COMMANDS.has(name) ? { default_member_permissions: PermissionFlagsBits.ManageChannels.toString() } : {}),
  options: optionsFor(name),
}));
