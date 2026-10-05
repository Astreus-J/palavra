import type { Fact } from "./fact.js";

// State Resolver: pure code that turns the facts of a group into its current state.
// No LLM, no network, no clock (the caller passes `now`). See docs/DESIGN.md §3.
//
// Rules
// - A chain starts at a root (DECISION or COMMITMENT) and follows `supersedes` to the last link.
// - The status comes from the last link: COMPLETION → completed; otherwise open or overdue.
//   A later AMENDMENT re-opens a completed item.
// - Owner, due date and topic are inherited: the effective value is the latest non-null one on the chain.
// - When several facts supersede the same parent (a fork), the newest `createdAt` wins; equal
//   timestamps are broken by local insertion order (`seq`). Never by text or id.
// - A commitment is overdue once its due date is before "today" in the group's timezone.

/** A fact plus the local metadata the ledger keeps for it. */
export interface LedgerEntry {
  fact: Fact;
  /** Local insertion order (monotonic). The final tie-breaker. */
  seq: number;
  /** ISO instant when the fact was written (relayer or local clock). */
  createdAt: string;
}

export type ItemStatus = "open" | "overdue" | "completed" | "active";

export interface ItemState {
  /** Id of the DECISION or COMMITMENT that started the chain. */
  rootId: string;
  kind: "DECISION" | "COMMITMENT";
  /** "active" for decisions (they do not complete); open, overdue or completed for commitments. */
  status: ItemStatus;
  /** Last link of the chain. */
  current: Fact;
  owner: string | null;
  due: string | null;
  topic: string | null;
  /** Root → ... → current, along the winning path. */
  history: LedgerEntry[];
  /** createdAt of the last link. */
  updatedAt: string;
  /** Set when the last link is a COMPLETION. */
  closedAt: string | null;
  /** Ids of facts that lost a fork on this chain (and their descendants). */
  conflicts: string[];
}

export interface Resolution {
  items: ItemState[];
  /** Entries that could not be attached to a root (missing parent, or a cycle). */
  orphans: LedgerEntry[];
  /** Entries dropped because their fact id was already present. */
  duplicates: number;
}

export interface ResolveOptions {
  now: Date;
  /** IANA timezone of the group, e.g. "America/Sao_Paulo". */
  timeZone: string;
}

export class ResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolverError";
  }
}

/** Today's calendar date (YYYY-MM-DD) in the given timezone. Throws on an invalid timezone. */
export function todayIn(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  } catch {
    throw new ResolverError(`invalid timezone: ${timeZone}`);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function instant(entry: LedgerEntry): number {
  const ms = Date.parse(entry.createdAt);
  if (Number.isNaN(ms)) throw new ResolverError(`invalid createdAt for ${entry.fact.id}: ${entry.createdAt}`);
  return ms;
}

/** Newest createdAt wins; equal instants fall back to the higher local `seq`. */
function newer(a: LedgerEntry, b: LedgerEntry): boolean {
  const ta = instant(a);
  const tb = instant(b);
  return ta !== tb ? ta > tb : a.seq > b.seq;
}

export function resolveState(input: readonly LedgerEntry[], options: ResolveOptions): Resolution {
  const today = todayIn(options.now, options.timeZone);
  for (const entry of input) instant(entry); // fail loudly on a corrupted timestamp, even without a fork

  // Deduplicate by fact id (retries can write the same fact twice); the earliest insertion wins.
  const ordered = [...input].sort((a, b) => a.seq - b.seq);
  const byId = new Map<string, LedgerEntry>();
  let duplicates = 0;
  for (const entry of ordered) {
    if (byId.has(entry.fact.id)) duplicates++;
    else byId.set(entry.fact.id, entry);
  }
  const entries = [...byId.values()];

  const children = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const parent = entry.fact.supersedes;
    if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), entry]);
  }

  const visited = new Set<string>();
  const subtree = (entry: LedgerEntry): string[] => {
    const ids = [entry.fact.id];
    for (const child of children.get(entry.fact.id) ?? []) ids.push(...subtree(child));
    return ids;
  };

  const items: ItemState[] = [];
  for (const root of entries) {
    if (root.fact.supersedes !== null) continue;
    if (root.fact.type !== "DECISION" && root.fact.type !== "COMMITMENT") continue;

    const history: LedgerEntry[] = [root];
    const conflicts: string[] = [];
    visited.add(root.fact.id);
    let cursor = root;
    for (;;) {
      const next = children.get(cursor.fact.id) ?? [];
      if (next.length === 0) break;
      const winner = next.reduce((best, candidate) => (newer(candidate, best) ? candidate : best));
      for (const loser of next) {
        if (loser === winner) continue;
        for (const id of subtree(loser)) {
          conflicts.push(id);
          visited.add(id);
        }
      }
      history.push(winner);
      visited.add(winner.fact.id);
      cursor = winner;
    }
    items.push(buildItem(root, history, conflicts, today));
  }

  const orphans = entries.filter((e) => !visited.has(e.fact.id));
  return { items, orphans, duplicates };
}

function buildItem(root: LedgerEntry, history: LedgerEntry[], conflicts: string[], today: string): ItemState {
  const last = history[history.length - 1] as LedgerEntry;
  let owner: string | null = null;
  let due: string | null = null;
  let topic: string | null = null;
  for (const { fact } of history) {
    owner = fact.owner ?? owner;
    due = fact.due ?? due;
    topic = fact.topic ?? topic;
  }

  const kind = root.fact.type as "DECISION" | "COMMITMENT";
  let status: ItemStatus;
  if (kind === "DECISION") status = "active";
  else if (last.fact.type === "COMPLETION") status = "completed";
  else status = due !== null && due < today ? "overdue" : "open";

  return {
    rootId: root.fact.id,
    kind,
    status,
    current: last.fact,
    owner,
    due,
    topic,
    history,
    updatedAt: last.createdAt,
    closedAt: last.fact.type === "COMPLETION" ? last.createdAt : null,
    conflicts,
  };
}

/** Open and overdue commitments: overdue first, then by due date (no due date last). */
export function pendingItems(items: readonly ItemState[]): ItemState[] {
  const rank = (i: ItemState) => (i.status === "overdue" ? 0 : 1);
  return items
    .filter((i) => i.kind === "COMMITMENT" && i.status !== "completed")
    .sort((a, b) => rank(a) - rank(b) || (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99") || a.history[0]!.seq - b.history[0]!.seq);
}

/** Finds the item whose chain contains the given fact id (root, amendment or completion). */
export function findItem(items: readonly ItemState[], factId: string): ItemState | undefined {
  return items.find((i) => i.history.some((e) => e.fact.id === factId));
}
