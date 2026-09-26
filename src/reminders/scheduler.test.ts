import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fact } from "../core/fact.js";
import { Ledger } from "../core/ledger.js";
import { resolveState } from "../core/resolver.js";
import { collectReminders, localHour, ReminderScheduler, ReminderStore, renderReminders, type Reminder } from "./scheduler.js";

const TZ = "America/Sao_Paulo"; // UTC-3 all year
const G = "-5230162759";
/** A local time in Sao Paulo, e.g. local("2026-09-26", "09:00"). */
const local = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-03:00`);

function setup(opts: { hour?: number; store?: ReminderStore } = {}) {
  const ledger = Ledger.open(":memory:");
  const store = opts.store ?? ReminderStore.open(":memory:");
  const clock = { now: local("2026-09-24", "10:00") };
  const sent: { chatId: string; html: string }[] = [];
  const errors: unknown[] = [];
  let failWith: Error | null = null;
  const scheduler = new ReminderScheduler({
    ledger, store, timeZone: TZ, reminderHour: opts.hour ?? 9, now: () => clock.now,
    send: async (chatId, html) => { if (failWith) { const e = failWith; failWith = null; throw e; } sent.push({ chatId, html }); },
    onError: (e) => errors.push(e),
  });
  const seed = (f: Partial<Fact> & Pick<Fact, "id" | "type">, group = G) =>
    ledger.addFact(group, { supersedes: null, author: "tg:1", owner: null, due: null, topic: null, task: null, at: "2026-09-20T12:00:00.000Z", text: `text of ${f.id}`, ...f }, clock.now);
  const at = (day: string, hhmm: string) => { clock.now = local(day, hhmm); };
  return { ledger, store, scheduler, sent, errors, seed, at, clock, failNext: (e: Error) => { failWith = e; } };
}
const BACKEND = { id: "c_00000001", type: "COMMITMENT", owner: "Pedro", task: "finish the backend", due: "2026-09-25" } as const;

// ---- overdue: one reminder, never repeated -----------------------------------------------------

test("an overdue commitment gets ONE reminder, from 9:00 in the group's timezone", async () => {
  const s = setup();
  s.seed(BACKEND);
  s.at("2026-09-26", "08:59");
  assert.deepEqual(await s.scheduler.tick(), { groups: 0, messages: 0, reminders: 0 }, "too early in the group's day");
  s.at("2026-09-26", "09:00");
  assert.deepEqual(await s.scheduler.tick(), { groups: 1, messages: 1, reminders: 1 });
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0]!.chatId, G);
  assert.equal(
    s.sent[0]!.html,
    ["⏰ <b>Reminder</b>", "<b>🔴 Overdue (1):</b>\n• Pedro — finish the backend — was due Fri, Sep 25", "Use /palavra to change a deadline or mark something as done. /pending shows everything that is open."].join("\n\n"),
    "it names the owner, the task and the due date",
  );
});

test("no loop: ticking every 10 minutes for three days sends it only once", async () => {
  const s = setup();
  s.seed(BACKEND);
  s.at("2026-09-26", "00:00");
  const end = local("2026-09-29", "00:00").getTime();
  while (s.clock.now.getTime() < end) {
    await s.scheduler.tick();
    s.clock.now = new Date(s.clock.now.getTime() + 10 * 60_000);
  }
  assert.equal(s.sent.length, 1);
  assert.equal(s.store.count(), 1);
});

test("Q09: a commitment recorded with a date already in the past still gets its one reminder", async () => {
  const s = setup();
  s.seed({ ...BACKEND, at: "2026-09-26T12:00:00.000Z" }); // recorded on the 26th, due the 25th
  s.at("2026-09-26", "15:00");
  assert.equal((await s.scheduler.tick()).reminders, 1);
  assert.equal((await s.scheduler.tick()).reminders, 0);
});

test("a restart does not repeat a reminder (the record is in SQLite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "palavra-reminders-"));
  try {
    const path = join(dir, "r.db");
    const a = setup({ store: ReminderStore.open(path) });
    a.seed(BACKEND);
    a.at("2026-09-26", "10:00");
    assert.equal((await a.scheduler.tick()).messages, 1);
    a.store.close();
    const b = setup({ store: ReminderStore.open(path) });
    b.seed(BACKEND);
    b.at("2026-09-26", "11:00");
    assert.equal((await b.scheduler.tick()).messages, 0);
    b.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- completed or amended: stop reminding -------------------------------------------------------

test("a completed commitment is never reminded", async () => {
  const s = setup();
  s.seed(BACKEND);
  s.seed({ id: "k_00000002", type: "COMPLETION", supersedes: "c_00000001", at: "2026-09-25T15:00:00.000Z" });
  s.at("2026-09-26", "10:00");
  assert.equal((await s.scheduler.tick()).reminders, 0);
  assert.deepEqual(s.sent, []);
});

test("completing after the reminder ends it, and nothing new is sent", async () => {
  const s = setup();
  s.seed(BACKEND);
  s.at("2026-09-26", "10:00");
  await s.scheduler.tick();
  s.seed({ id: "k_00000002", type: "COMPLETION", supersedes: "c_00000001", at: "2026-09-26T14:00:00.000Z" });
  s.at("2026-09-27", "10:00");
  assert.equal((await s.scheduler.tick()).reminders, 0);
  assert.equal(s.sent.length, 1);
});

test("amending the deadline before it passes: no overdue reminder for the old date, a new cycle for the new one", async () => {
  const s = setup();
  s.seed(BACKEND); // due 25
  s.seed({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-28", at: "2026-09-24T18:00:00.000Z" });
  s.at("2026-09-26", "10:00");
  assert.equal((await s.scheduler.tick()).reminders, 0, "the 25th no longer matters");
  s.at("2026-09-28", "09:00");
  await s.scheduler.tick();
  assert.match(s.sent.at(-1)!.html, /Due today \(1\)/, "the day of the new date");
  s.at("2026-09-29", "09:00");
  await s.scheduler.tick();
  assert.match(s.sent.at(-1)!.html, /Overdue \(1\)[\s\S]*was due Mon, Sep 28/, "and overdue after it");
  assert.equal(s.sent.length, 2);
});

test("amending after an overdue reminder to a later date: quiet until the new date passes, then one more reminder", async () => {
  const s = setup();
  s.seed(BACKEND);
  s.at("2026-09-26", "10:00");
  await s.scheduler.tick(); // reminder 1: overdue since the 25th
  s.seed({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-30", at: "2026-09-26T16:00:00.000Z" });
  s.at("2026-09-27", "10:00");
  assert.equal((await s.scheduler.tick()).reminders, 0);
  s.at("2026-10-01", "10:00");
  assert.equal((await s.scheduler.tick()).reminders, 1, "overdue for the new date");
  assert.equal(s.sent.length, 2);
});

// ---- due today ----------------------------------------------------------------------------------

test("due today: one reminder on the day at 9:00, then one 'overdue' the next day, then silence", async () => {
  const s = setup();
  s.seed({ ...BACKEND, due: "2026-09-26" });
  s.at("2026-09-26", "08:00");
  assert.equal((await s.scheduler.tick()).messages, 0);
  s.at("2026-09-26", "09:00");
  await s.scheduler.tick();
  assert.match(s.sent[0]!.html, /<b>🟡 Due today \(1\):<\/b>\n• Pedro — finish the backend — due Sat, Sep 26/);
  s.at("2026-09-26", "18:00");
  assert.equal((await s.scheduler.tick()).messages, 0, "not twice on the same day");
  s.at("2026-09-27", "09:00");
  await s.scheduler.tick();
  assert.match(s.sent[1]!.html, /Overdue \(1\)/);
  s.at("2026-09-28", "09:00");
  assert.equal((await s.scheduler.tick()).messages, 0);
  assert.equal(s.sent.length, 2);
});

// ---- who is never reminded ----------------------------------------------------------------------

test("decisions and commitments without a deadline are never reminded", async () => {
  const s = setup();
  s.seed({ id: "d_00000001", type: "DECISION", due: "2026-09-20", task: "the launch" });
  s.seed({ id: "c_00000002", type: "COMMITMENT", owner: "Ana", task: "pick a logo", due: null });
  s.seed({ id: "c_00000003", type: "COMMITMENT", owner: "Joao", task: "next month", due: "2026-10-30" });
  s.at("2026-09-26", "10:00");
  assert.equal((await s.scheduler.tick()).reminders, 0);
});

test("demo namespaces that are not Telegram chats are skipped", async () => {
  const s = setup();
  s.seed(BACKEND, "receipt-demo");
  s.seed(BACKEND, "restore-test-2026-09-25-6eefdb");
  s.at("2026-09-26", "10:00");
  assert.deepEqual(await s.scheduler.tick(), { groups: 0, messages: 0, reminders: 0 });
});

// ---- batching and groups ------------------------------------------------------------------------

test("one message per group: overdue first (oldest due date first), then due today", async () => {
  const s = setup();
  s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "Maria", task: "send the budget", due: "2026-09-25" });
  s.seed({ id: "c_00000002", type: "COMMITMENT", owner: "Pedro", task: "finish the backend", due: "2026-09-23" });
  s.seed({ id: "c_00000003", type: "COMMITMENT", owner: "Ana", task: "pick a logo", due: "2026-09-26" });
  s.at("2026-09-26", "09:30");
  assert.deepEqual(await s.scheduler.tick(), { groups: 1, messages: 1, reminders: 3 });
  const html = s.sent[0]!.html;
  assert.ok(html.indexOf("Pedro") < html.indexOf("Maria"), "the oldest overdue is listed first");
  assert.ok(html.indexOf("Overdue (2)") < html.indexOf("Due today (1)"));
  assert.match(html, /• Ana — pick a logo — due Sat, Sep 26/);
});

test("each group gets its own reminder and sees only its own items", async () => {
  const s = setup();
  s.seed(BACKEND, "-111");
  s.seed({ ...BACKEND, id: "c_00000009", owner: "Zoe", task: "write the docs" }, "-222");
  s.at("2026-09-26", "10:00");
  assert.deepEqual(await s.scheduler.tick(), { groups: 2, messages: 2, reminders: 2 });
  const to = (chat: string) => s.sent.find((m) => m.chatId === chat)!.html;
  assert.match(to("-111"), /Pedro/);
  assert.doesNotMatch(to("-111"), /Zoe/);
  assert.match(to("-222"), /Zoe/);
});

test("the message is valid Telegram HTML and escapes what people wrote; long lists are cut", async () => {
  const s = setup();
  s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "A&B <x>", task: "fix <b>bold</b> & more", due: "2026-09-25" });
  for (let i = 2; i <= 25; i++) s.seed({ id: `c_${i.toString(16).padStart(8, "0")}`, type: "COMMITMENT", owner: "Maria", task: `task ${i}`, due: "2026-09-25" });
  s.at("2026-09-26", "10:00");
  await s.scheduler.tick();
  const html = s.sent[0]!.html;
  assert.match(html, /A&amp;B &lt;x&gt; — fix &lt;b&gt;bold&lt;\/b&gt; &amp; more/);
  assert.match(html, /…and 5 more/);
  const stripped = html.replace(/<\/?b>/g, "");
  assert.doesNotMatch(stripped, /[<>]/);
  assert.ok(html.length < 4096);
});

// ---- timezone and hour --------------------------------------------------------------------------

test("the day and the hour come from the group's timezone, not from UTC", async () => {
  const s = setup();
  s.seed({ ...BACKEND, due: "2026-09-25" });
  s.clock.now = new Date("2026-09-26T02:30:00Z"); // Fri 23:30 in Sao Paulo, already Saturday in UTC
  await s.scheduler.tick();
  assert.match(s.sent[0]!.html, /Due today \(1\)/, "still the 25th for the group: due today, not overdue");
  s.clock.now = new Date("2026-09-26T12:30:00Z"); // Sat 09:30 in Sao Paulo
  await s.scheduler.tick();
  assert.match(s.sent[1]!.html, /Overdue \(1\)/);
  assert.equal(localHour(new Date("2026-09-26T02:30:00Z"), TZ), 23);
  assert.equal(localHour(new Date("2026-09-26T03:00:00Z"), TZ), 0);
  assert.equal(localHour(new Date("2026-09-26T12:00:00Z"), "UTC"), 12);
});

test("the reminder hour is configurable", async () => {
  const s = setup({ hour: 14 });
  s.seed(BACKEND);
  s.at("2026-09-26", "13:59");
  assert.equal((await s.scheduler.tick()).messages, 0);
  s.at("2026-09-26", "14:00");
  assert.equal((await s.scheduler.tick()).messages, 1);
});

// ---- delivery failures --------------------------------------------------------------------------

test("a passing delivery failure is retried on the next tick, and the reminder is not lost or doubled", async () => {
  const s = setup();
  s.seed(BACKEND);
  s.at("2026-09-26", "10:00");
  s.failNext(new Error("Network request for 'sendMessage' failed!"));
  assert.deepEqual(await s.scheduler.tick(), { groups: 1, messages: 0, reminders: 0 });
  assert.equal(s.errors.length, 1);
  assert.equal(s.store.count(), 0, "not marked as sent");
  s.at("2026-09-26", "10:01");
  assert.deepEqual(await s.scheduler.tick(), { groups: 1, messages: 1, reminders: 1 });
  assert.equal((await s.scheduler.tick()).messages, 0);
  assert.equal(s.sent.length, 1);
});

test("a chat that can never receive it (bot kicked) is not retried forever", async () => {
  const s = setup();
  s.seed(BACKEND);
  s.at("2026-09-26", "10:00");
  s.failNext(new Error("Forbidden: bot was kicked from the group chat"));
  assert.deepEqual(await s.scheduler.tick(), { groups: 1, messages: 0, reminders: 0 });
  assert.equal(s.store.count(), 1, "remembered so it does not loop");
  assert.equal((await s.scheduler.tick()).messages, 0);
  assert.equal(s.sent.length, 0);
});

// ---- the pure pieces ----------------------------------------------------------------------------

test("collectReminders uses the State Resolver output and skips what was already sent", () => {
  const ledger = Ledger.open(":memory:");
  const add = (f: Partial<Fact> & Pick<Fact, "id" | "type">) =>
    ledger.addFact(G, { supersedes: null, author: "tg:1", owner: "Maria", due: null, topic: null, task: null, at: "2026-09-20T12:00:00.000Z", text: `t ${f.id}`, ...f }, local("2026-09-24", "10:00"));
  add({ id: "c_00000001", type: "COMMITMENT", due: "2026-09-25" });
  add({ id: "c_00000002", type: "COMMITMENT", due: "2026-09-26" });
  const items = resolveState(ledger.entries(G), { now: local("2026-09-26", "10:00"), timeZone: TZ }).items;
  const all = collectReminders(items, "2026-09-26", () => false);
  assert.deepEqual(all.map((r) => [r.item.rootId, r.kind, r.due]), [["c_00000001", "overdue", "2026-09-25"], ["c_00000002", "due-today", "2026-09-26"]]);
  const skip = collectReminders(items, "2026-09-26", (root, due, kind) => root === "c_00000001" && due === "2026-09-25" && kind === "overdue");
  assert.deepEqual(skip.map((r) => r.item.rootId), ["c_00000002"]);
  assert.equal(renderReminders(all as Reminder[]).includes("Overdue (1)"), true);
});
