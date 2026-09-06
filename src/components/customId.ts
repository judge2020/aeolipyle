export type RestoreMode = "zero" | "keep";
export type CustomId = { kind: "restore"; mode: RestoreMode; token: string } | { kind: "cancel"; token: string } | { kind: "page"; page: number };
export const restoreId = (mode: RestoreMode, token: string): string => `addc:restore:${mode}:${token}`;
export const cancelId = (token: string): string => `addc:cancel:${token}`;
export const pageId = (page: number): string => `ctrs:page:${page}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseCustomId(raw: string): CustomId | null {
  if (raw.length > 100) return null;
  const p = raw.split(":");
  if (p.length === 4 && p[0] === "addc" && p[1] === "restore" && (p[2] === "zero" || p[2] === "keep") && p[3] && uuid.test(p[3])) return { kind: "restore", mode: p[2], token: p[3] };
  if (p.length === 3 && p[0] === "addc" && p[1] === "cancel" && p[2] && uuid.test(p[2])) return { kind: "cancel", token: p[2] };
  if (p.length === 3 && p[0] === "ctrs" && p[1] === "page" && p[2] && /^\d+$/.test(p[2]) && Number.isSafeInteger(Number(p[2]))) return { kind: "page", page: Number(p[2]) };
  return null;
}
