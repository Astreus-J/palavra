import { taskOf, shorten } from "../core/labels.js";
import type { Ledger } from "../core/ledger.js";
import { normalizeName } from "../core/owner.js";
import { pendingItems, type ItemState } from "../core/resolver.js";
import { formatDate } from "./messages.js";

// Read-only views: /pending and /history. Replies are HTML (Telegram parse_mode), so every piece of
// user text is escaped.

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MAX_LINES = 25;

/** "Fri, Sep 25" for the day in the group's timezone. */
function dayIn(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return formatDate(`${get("year")}-${get("month")}-${get("day")}`);
}

function pendingLine(item: ItemState): string {
  const when = item.due === null ? "no deadline" : `${item.status === "overdue" ? "was due" : "due"} ${formatDate(item.due)}`;
  return `• ${escapeHtml(item.owner ?? "?")} — ${escapeHtml(taskOf(item))} — ${when}`;
}

/** /pending: overdue commitments first and highlighted, then the open ones. Computed by the State Resolver. */
export function renderPending(items: readonly ItemState[]): string {
  const pending = pendingItems(items);
  if (pending.length === 0) return "No open commitments. ✅";
  const section = (title: string, list: ItemState[]): string | null => {
    if (list.length === 0) return null;
    const shown = list.slice(0, MAX_LINES);
    const more = list.length > shown.length ? [`…and ${list.length - shown.length} more`] : [];
    return [`<b>${title} (${list.length}):</b>`, ...shown.map(pendingLine), ...more].join("\n");
  };
  return [section("🔴 Overdue", pending.filter((i) => i.status === "overdue")), section("Pending", pending.filter((i) => i.status !== "overdue"))]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

const VERB = { COMMITMENT: "committed", DECISION: "decided", AMENDMENT: "changed", COMPLETION: "completed" } as const;

function matches(item: ItemState, query: string): boolean {
  const words = normalizeName(query).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const haystack = normalizeName(
    item.history.map(({ fact }) => [fact.task, fact.topic, fact.owner, fact.text].filter(Boolean).join(" ")).join(" "),
  );
  return words.every((w) => haystack.includes(w));
}

export interface HistoryOptions {
  ledger: Ledger;
  groupId: string;
  timeZone: string;
  /** Base URL of the proof links, e.g. https://walruscan.com/mainnet/blob */
  proofBaseUrl: string;
}

/** /history <topic>: how each matching item changed, with a proof link per fact. */
export function renderHistory(items: readonly ItemState[], query: string, o: HistoryOptions): string {
  const found = items.filter((i) => matches(i, query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  if (found.length === 0) return `I found nothing about "${escapeHtml(shorten(query, 40))}".`;
  return found
    .map((item) => {
      const head = `📜 <b>${escapeHtml(taskOf(item))}</b>${item.owner ? ` — ${escapeHtml(item.owner)}` : ""}`;
      const lines = item.history.map(({ fact }, n) => {
        const details = [fact.due ? `due ${formatDate(fact.due)}` : null, fact.type === "AMENDMENT" && fact.owner ? `owner → ${escapeHtml(fact.owner)}` : null].filter(Boolean).join(", ");
        const blob = o.ledger.getRow(o.groupId, fact.id)?.blobId ?? null;
        const proof = blob ? `<a href="${escapeHtml(`${o.proofBaseUrl}/${blob}`)}">proof</a>` : "⏳ saving";
        return `${n + 1}. ${fact.at ? dayIn(fact.at, o.timeZone) : "?"} · ${VERB[fact.type]}${details ? `, ${details}` : ""} · ${proof}`;
      });
      const status = item.kind === "DECISION" ? (item.due ? `Now: due ${formatDate(item.due)}` : "Now: active") : item.status === "completed" ? "Now: completed ✅" : `Now: ${item.status}${item.due ? `, due ${formatDate(item.due)}` : ""}`;
      return [head, ...lines, status].join("\n");
    })
    .join("\n\n");
}
