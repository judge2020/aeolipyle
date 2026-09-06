import { ApplicationCommandType, ApplicationCommandOptionType, ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from "discord-api-types/v10";
import type { RESTPutAPIApplicationCommandsJSONBody, APIApplicationCommandStringOption } from "discord-api-types/v10";
import { localizations } from "../i18n/locales";
import type { LocalizedString } from "../i18n/locales";
import { STR } from "../i18n/strings";
import { SENSITIVE_COMMANDS } from "./sensitive";
const translated = (s: LocalizedString) => ({ description: s.en, description_localizations: localizations(s) });
const option = (name: string, s: LocalizedString, required = true, max = 100): APIApplicationCommandStringOption => ({
  type: ApplicationCommandOptionType.String, name, ...translated(s), required, min_length: 1, max_length: max,
});
const names = ["addcounter", "removecounter", "renamecounter", "counter", "counters", "increment", "decrement"] as const;
export const COMMANDS: RESTPutAPIApplicationCommandsJSONBody = names.map(name => ({
  name, type: ApplicationCommandType.ChatInput, ...translated(STR[`cmd.${name}.desc`]),
  // Add name_localizations here and on options if localized names are introduced.
  integration_types: [ApplicationIntegrationType.GuildInstall], contexts: [InteractionContextType.Guild, InteractionContextType.BotDM],
  ...(SENSITIVE_COMMANDS.has(name) ? { default_member_permissions: PermissionFlagsBits.ManageChannels.toString() } : {}),
  options: name === "counters" ? [] : [
    option("name", STR[`cmd.${name}.opt.name.desc`]),
    ...(name === "addcounter" ? [option("description", STR["cmd.addcounter.opt.description.desc"], false, 500)] : []),
    ...(name === "renamecounter" ? [option("new_name", STR["cmd.renamecounter.opt.new_name.desc"])] : []),
  ],
}));
