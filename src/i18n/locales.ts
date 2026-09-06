import { Locale } from "discord-api-types/v10";
export const LOCALES = Object.values(Locale);
export type DiscordLocale = Locale;
export type TranslatedLocale = Exclude<Locale, Locale.EnglishUS | Locale.EnglishGB>;
export const SOURCE_LOCALES: ReadonlySet<DiscordLocale> = new Set([Locale.EnglishUS, Locale.EnglishGB]);
export const TRANSLATED_LOCALES = LOCALES.filter((locale): locale is TranslatedLocale => !SOURCE_LOCALES.has(locale));
export type LocalizedString = { en: string } & Record<TranslatedLocale, string>;
export function localizations(s: LocalizedString): Record<TranslatedLocale, string> {
  const { en: _en, ...translations } = s;
  return translations;
}
