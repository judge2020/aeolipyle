import { expect, it } from "vitest";
import { COMMANDS } from "../src/commands/definitions";
import { commandSize, validateCommands } from "../src/commands/validate";
import { STR } from "../src/i18n/strings";
import { LOCALES, TRANSLATED_LOCALES } from "../src/i18n/locales";
import { SENSITIVE_COMMANDS } from "../src/commands/sensitive";
it("validates all seven commands and all 30 translations per string", () => {
  expect(() => validateCommands(COMMANDS)).not.toThrow();
  expect(COMMANDS).toHaveLength(7);
  expect(LOCALES).toHaveLength(32);
  expect(TRANSLATED_LOCALES).toHaveLength(30);
  for (const s of Object.values(STR)) {
    expect(Object.keys(s)).toHaveLength(31);
    for (const value of Object.values(s)) { expect([...value].length).toBeGreaterThan(0); expect([...value].length).toBeLessThanOrEqual(100); }
  }
  for (const c of COMMANDS) expect(c.default_member_permissions).toBe(SENSITIVE_COMMANDS.has(c.name) ? "16" : undefined);
});
it("counts only the longest localization per field", () => {
  const command = { ...COMMANDS[0]!, name: "abc", description: "short", description_localizations: { de: "1234567890", fr: "12345678" }, options: [] };
  expect(commandSize(command)).toBe(13);
});
it("rejects duplicate commands and missing translations", () => {
  expect(() => validateCommands([...COMMANDS, COMMANDS[0]!])).toThrow("Duplicate");
  const copy = structuredClone(COMMANDS);
  copy[0]!.description_localizations = {};
  expect(() => validateCommands(copy)).toThrow("Missing description locale");
});
it("rejects permission drift, context drift, and optional ordering errors", () => {
  const permissions = structuredClone(COMMANDS); permissions[0]!.default_member_permissions = "8";
  expect(() => validateCommands(permissions)).toThrow("Invalid permissions");
  const contexts = structuredClone(COMMANDS); delete contexts[0]!.contexts;
  expect(() => validateCommands(contexts)).toThrow("Invalid contexts");
  const options = structuredClone(COMMANDS); options[0]!.options?.reverse();
  expect(() => validateCommands(options)).toThrow("Required options");
});
