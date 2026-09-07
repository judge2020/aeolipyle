/** Trimmed names: 1–100 ASCII letters, digits, or spaces (prompts/03_ALLOW_SPACES_AMENDMENT.md). */
const COUNTER_NAME_RE = /^[A-Za-z0-9 ]{1,100}$/;

/** Case-insensitive identity of a counter name; the display casing is stored separately. */
export const nameKey = (name: string): string => name.toLowerCase();

export function validateCounterName(raw: string) {
  const display = raw.trim();
  if (!COUNTER_NAME_RE.test(display)) return { ok: false as const };
  return { ok: true as const, display, key: nameKey(display) };
}
