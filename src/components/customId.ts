/**
 * Button custom_id grammar (≤ 100 chars, colon-separated):
 *   addc:restore:<zero|keep>:<uuid>   restore a soft-deleted counter
 *   addc:cancel:<uuid>                discard the restore prompt
 *   ctrs:page:<n>                     show page n (0-based) of /counters
 */
export type RestoreMode = "zero" | "keep";
export type CustomId =
  | { kind: "restore"; mode: RestoreMode; token: string }
  | { kind: "cancel"; token: string }
  | { kind: "page"; page: number };

export const restoreId = (mode: RestoreMode, token: string): string => `addc:restore:${mode}:${token}`;
export const cancelId = (token: string): string => `addc:cancel:${token}`;
export const pageId = (page: number): string => `ctrs:page:${page}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPageNumber = (s: string): boolean => /^\d+$/.test(s) && Number.isSafeInteger(Number(s));

export function parseCustomId(raw: string): CustomId | null {
  if (raw.length > 100) return null;
  const parts = raw.split(":");
  const [namespace, action, arg1, arg2] = parts;

  if (parts.length === 4 && namespace === "addc" && action === "restore" && (arg1 === "zero" || arg1 === "keep") && arg2 && UUID_RE.test(arg2)) {
    return { kind: "restore", mode: arg1, token: arg2 };
  }
  if (parts.length === 3 && namespace === "addc" && action === "cancel" && arg1 && UUID_RE.test(arg1)) {
    return { kind: "cancel", token: arg1 };
  }
  if (parts.length === 3 && namespace === "ctrs" && action === "page" && arg1 && isPageNumber(arg1)) {
    return { kind: "page", page: Number(arg1) };
  }
  return null;
}
