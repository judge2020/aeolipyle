import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import { cancelId, pageId, restoreId } from "./components/customId";
import type { RestoreMode } from "./components/customId";
import type { CounterPage } from "./durable-objects/CounterRegistry";
import type { MessageBody } from "./discord/respond";
import { discordRelativeTimestamp } from "./lib/time";

const numberFormat = new Intl.NumberFormat("en-US");
export const formatCount = (n: number): string => numberFormat.format(n);

/** The 📝 line is only shown when a counter has a description. */
const descriptionLine = (desc?: string | null): string => (desc ? `\n📝 ${desc}` : "");

/** Every user-facing string, in one place. Names are ASCII-safe for Markdown; descriptions are mention-suppressed. */
export const MSG = {
  home: "Aeolipyle 🌀 — a slash-command counter bot for Discord",
  created: (name: string, desc?: string | null) => `✨ Created counter **${name}** starting at **0**!${descriptionLine(desc)}`,
  alreadyExists: (name: string) => `⚠️ A counter named **${name}** already exists here.`,
  restorePrompt: (name: string, deletedAt: number, last: number) =>
    `♻️ **${name}** was removed ${discordRelativeTimestamp(deletedAt)} and was at **${formatCount(last)}**. Bring it back?`,
  restored: (name: string, mode: RestoreMode, count: number) =>
    `♻️ Restored counter **${name}** at **${formatCount(count)}** (${mode === "zero" ? "reset to zero" : "kept its old count"})`,
  restorePromptDone: (name: string) => `✅ Handled — see the channel for **${name}**.`,
  restoreCancelled: (name: string) => `🚫 Cancelled. **${name}** stays removed.`,
  restoreExpired: "⌛ This prompt has expired or was already handled. Run `/addcounter` again.",
  restoreBusy: "⏳ That counter is being restored right now — try again in a moment.",
  notYourPrompt: "🙅 That prompt belongs to someone else.",
  removed: (name: string, count?: number) =>
    `🗑️ Removed counter **${name}**${count === undefined ? "" : ` (it was at **${formatCount(count)}**)`}. \`/addcounter\` can bring it back.`,
  renamed: (before: string, after: string) => `✏️ Renamed **${before}** → **${after}**`,
  renameTargetExists: (name: string) => `⚠️ A counter named **${name}** already exists.`,
  renameTargetDeleted: (name: string, deletedAt: number) =>
    `⚠️ **${name}** belongs to a counter removed ${discordRelativeTimestamp(deletedAt)}. Restore it with \`/addcounter\` or pick another name.`,
  counterStatus: (name: string, count: number, desc?: string | null) => `🔢 **${name}** is at **${formatCount(count)}**${descriptionLine(desc)}`,
  incremented: (name: string, count: number) => `⬆️ **${name}** is now **${formatCount(count)}**`,
  decremented: (name: string, count: number) => `⬇️ **${name}** is now **${formatCount(count)}**`,
  noCounters: "📭 No counters here yet. Create one with `/addcounter`!",
  notFound: (name: string) => `❓ No counter named **${name}** here. Try \`/counters\`.`,
  badName: "🚫 Counter names must be 1–100 characters: letters (A–Z), digits (0–9), and spaces.",
  badDescription: "🚫 Descriptions must be 1–500 characters.",
  unknownCommand: "🤷 I don't know that command.",
  staleButton: "🤷 That button is no longer wired to anything.",
  unsupported: "🤖 That kind of interaction isn't supported.",
  internalError: "💥 Something went wrong on my end. Please try again.",
  tookTooLong: "🐢 That took too long. Please try again.",
};

/** Ephemeral prompt shown when `/addcounter` hits a soft-deleted name. */
export function renderRestorePrompt(name: string, deletedAt: number, count: number, token: string): MessageBody {
  return {
    content: MSG.restorePrompt(name, deletedAt, count),
    components: [{
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Primary, label: "🔄 Restore & reset to 0", custom_id: restoreId("zero", token) },
        { type: ComponentType.Button, style: ButtonStyle.Success, label: `📦 Restore & keep ${formatCount(count)}`, custom_id: restoreId("keep", token) },
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "✖️ Cancel", custom_id: cancelId(token) },
      ],
    }],
  };
}

/** One page of `/counters`. An embed is used because 20 long names can exceed the 2000-char content limit. */
export function renderCountersPage(page: CounterPage, counts: number[]): MessageBody {
  if (page.total === 0) return { content: MSG.noCounters, embeds: [], components: [] };

  const lines = page.items.map((item, i) => `**${item.displayName}** · ${formatCount(counts[i] ?? 0)}`);
  const isFirstPage = page.page === 0;
  const isLastPage = page.page === page.pageCount - 1;
  return {
    content: "",
    embeds: [{
      title: "📋 Counters",
      description: lines.join("\n"),
      footer: { text: `Page ${page.page + 1}/${page.pageCount} · ${page.total} counters` },
    }],
    components: page.pageCount <= 1 ? [] : [{
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "◀️ Previous", custom_id: pageId(Math.max(0, page.page - 1)), disabled: isFirstPage },
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Next ▶️", custom_id: pageId(page.page + 1), disabled: isLastPage },
      ],
    }],
  };
}
