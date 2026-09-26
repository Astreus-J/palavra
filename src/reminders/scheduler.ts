import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Ledger } from "../core/ledger.js";
import { resolveState, todayIn, type ItemState } from "../core/resolver.js";
import { pendingLine } from "../bot/render.js";

// Deadline reminders. Deterministic: the State Resolver decides who is late, no LLM is involved.
//
//  - "overdue":   the due date is before today (group timezone). One reminder per commitment and due date.
//  - "due-today": the due date is today. One reminder per commitment and due date.
//
// Reminders go out from REMINDER_HOUR (default 9:00, group timezone). A reminder is sent once and
// remembered, so ticking every minute never repeats it. Completing a commitment stops its reminders;
// amending its deadline starts over for the new date.

export type ReminderKind = "overdue" | "due-today";

export interface Reminder {
  item: ItemState;
  kind: ReminderKind;
  /** The due date this reminder is about. */
  due: string;
}

/** The hour (0-23) of the day in the given timezone. */
export function localHour(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Which commitments need a reminder today, skipping the ones already reminded. Pure. */
export function collectReminders(items: readonly ItemState[], today: string, alreadySent: (rootId: string, due: string, kind: ReminderKind) => boolean): Reminder[] {
  const out: Reminder[] = [];
  for (const item of items) {
    if (item.kind !== "COMMITMENT" || item.status === "completed" || item.due === null) continue;
    const kind: ReminderKind | null = item.due < today ? "overdue" : item.due === today ? "due-today" : null;
    if (kind === null || alreadySent(item.rootId, item.due, kind)) continue;
    out.push({ item, kind, due: item.due });
  }
  return out;
}

const MAX_LINES = 20;

/** One message per group: overdue first, then due today. HTML. */
export function renderReminders(reminders: readonly Reminder[]): string {
  const section = (title: string, list: Reminder[]): string | null => {
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => a.due.localeCompare(b.due) || (a.item.history[0]?.seq ?? 0) - (b.item.history[0]?.seq ?? 0));
    const shown = sorted.slice(0, MAX_LINES).map((r) => pendingLine(r.item));
    const more = sorted.length > shown.length ? [`…and ${sorted.length - shown.length} more`] : [];
    return [`<b>${title} (${list.length}):</b>`, ...shown, ...more].join("\n");
  };
  return [
    "⏰ <b>Reminder</b>",
    section("🔴 Overdue", reminders.filter((r) => r.kind === "overdue")),
    section("🟡 Due today", reminders.filter((r) => r.kind === "due-today")),
    "Use /palavra to change a deadline or mark something as done. /pending shows everything that is open.",
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

// ---- storage ------------------------------------------------------------------------------------

/** Which reminders were already sent, so a restart never sends them twice. */
export class ReminderStore {
  private constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        group_id TEXT NOT NULL,
        root_id TEXT NOT NULL,
        due TEXT NOT NULL,
        kind TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (group_id, root_id, due, kind)
      );
    `);
  }

  static open(path: string): ReminderStore {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    if (path !== ":memory:") db.pragma("journal_mode = WAL");
    return new ReminderStore(db);
  }

  close(): void {
    this.db.close();
  }

  has(groupId: string, rootId: string, due: string, kind: ReminderKind): boolean {
    return this.db.prepare(`SELECT 1 FROM reminders WHERE group_id = ? AND root_id = ? AND due = ? AND kind = ?`).get(groupId, rootId, due, kind) !== undefined;
  }

  mark(groupId: string, reminders: readonly Reminder[], now: Date): void {
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO reminders (group_id, root_id, due, kind, sent_at) VALUES (?, ?, ?, ?, ?)`);
    for (const r of reminders) stmt.run(groupId, r.item.rootId, r.due, r.kind, now.toISOString());
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM reminders`).get() as { n: number }).n;
  }
}

// ---- scheduler ----------------------------------------------------------------------------------

export interface SchedulerOptions {
  ledger: Ledger;
  store: ReminderStore;
  timeZone: string;
  /** Reminders are sent from this hour (0-23) of the group's day. */
  reminderHour: number;
  /** Sends an HTML message to a chat. Throws when it could not be delivered. */
  send(chatId: string, html: string): Promise<unknown>;
  now?: () => Date;
  onError?(error: unknown, chatId: string): void;
}

export interface TickReport {
  groups: number;
  /** Groups that received a reminder message. */
  messages: number;
  /** Individual reminders included in those messages. */
  reminders: number;
}

/** Errors that will never go away for this chat (kicked, blocked, deleted): stop trying instead of looping. */
const permanent = (e: unknown) => /chat not found|bot was kicked|bot was blocked|forbidden|group chat was deleted|user is deactivated/i.test(e instanceof Error ? e.message : String(e));

/** Only real Telegram chats get reminders (ids are numbers, negative for groups). Demo namespaces are skipped. */
const isChatId = (groupId: string) => /^-?\d+$/.test(groupId);

export class ReminderScheduler {
  constructor(private readonly o: SchedulerOptions) {}

  /** One pass over every group. Safe to call every minute. */
  async tick(): Promise<TickReport> {
    const now = (this.o.now ?? (() => new Date()))();
    const report: TickReport = { groups: 0, messages: 0, reminders: 0 };
    if (localHour(now, this.o.timeZone) < this.o.reminderHour) return report; // too early in the group's day

    const today = todayIn(now, this.o.timeZone);
    for (const groupId of this.o.ledger.groups().filter(isChatId)) {
      report.groups++;
      const items = resolveState(this.o.ledger.entries(groupId), { now, timeZone: this.o.timeZone }).items;
      const due = collectReminders(items, today, (root, day, kind) => this.o.store.has(groupId, root, day, kind));
      if (due.length === 0) continue;
      let delivered = true;
      try {
        await this.o.send(groupId, renderReminders(due));
      } catch (error) {
        this.o.onError?.(error, groupId);
        if (!permanent(error)) continue; // a passing failure: the next tick tries again
        delivered = false; // undeliverable for good: remember it anyway so we do not loop
      }
      this.o.store.mark(groupId, due, now); // never again
      if (delivered) {
        report.messages++;
        report.reminders += due.length;
      }
    }
    return report;
  }
}
