export const nameKey = (name: string): string => name.toLowerCase();
export function validateCounterName(raw: string) {
  const display = raw.trim();
  return /^[A-Za-z0-9]{1,100}$/.test(display)
    ? { ok: true as const, display, key: nameKey(display) }
    : { ok: false as const };
}
