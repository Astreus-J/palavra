import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fact } from "./fact.js";
import { findItem, pendingItems, resolveState, todayIn, ResolverError, type LedgerEntry } from "./resolver.js";

const TZ = "America/Sao_Paulo";
const NOW = new Date("2026-09-25T15:00:00Z"); // 2026-09-25 12:00 in Sao Paulo
const resolve = (entries: LedgerEntry[], now = NOW, timeZone = TZ) => resolveState(entries, { now, timeZone });

let seq = 0;
const entry = (fact: Partial<Fact> & Pick<Fact, "id" | "type">, createdAt = "2026-09-24T10:00:00Z", s = ++seq): LedgerEntry => ({
  seq: s,
  createdAt,
  fact: { supersedes: null, author: "tg:1", owner: null, due: null, topic: null, text: `text of ${fact.id}`, ...fact },
});
const commitment = (id: string, owner: string, due: string | null, createdAt?: string) => entry({ id, type: "COMMITMENT", owner, due }, createdAt);
const amend = (id: string, parent: string, due: string | null, createdAt?: string, s?: number) => entry({ id, type: "AMENDMENT", supersedes: parent, due }, createdAt, s);
const complete = (id: string, parent: string, createdAt?: string) => entry({ id, type: "COMPLETION", supersedes: parent }, createdAt);

test("a single commitment is open while its due date is in the future", () => {
  const { items, orphans } = resolve([commitment("c_00000001", "Maria", "2026-09-30")]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, "open");
  assert.equal(items[0]?.owner, "Maria");
  assert.equal(items[0]?.due, "2026-09-30");
  assert.equal(orphans.length, 0);
});

test("one amendment: the last link wins and owner is inherited", () => {
  const { items } = resolve([commitment("c_00000001", "Maria", "2026-09-26"), amend("a_00000002", "c_00000001", "2026-09-27", "2026-09-25T09:00:00Z")]);
  const item = items[0]!;
  assert.equal(item.due, "2026-09-27");
  assert.equal(item.owner, "Maria");
  assert.equal(item.current.id, "a_00000002");
  assert.deepEqual(item.history.map((e) => e.fact.id), ["c_00000001", "a_00000002"]);
  assert.equal(item.status, "open");
});

test("two amendments in a row: follows the chain to the last link", () => {
  const { items } = resolve([
    commitment("c_00000001", "Maria", "2026-09-26"),
    amend("a_00000002", "c_00000001", "2026-09-27", "2026-09-25T09:00:00Z"),
    amend("a_00000003", "a_00000002", "2026-10-02", "2026-09-25T10:00:00Z"),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.due, "2026-10-02");
  assert.deepEqual(items[0]?.history.map((e) => e.fact.id), ["c_00000001", "a_00000002", "a_00000003"]);
});

test("completion closes the item and removes it from pending", () => {
  const { items } = resolve([commitment("c_00000001", "Pedro", "2026-09-30"), complete("k_00000002", "c_00000001", "2026-09-25T11:00:00Z")]);
  assert.equal(items[0]?.status, "completed");
  assert.equal(items[0]?.closedAt, "2026-09-25T11:00:00Z");
  assert.equal(items[0]?.owner, "Pedro");
  assert.deepEqual(pendingItems(items), []);
});

test("an amendment after a completion re-opens the item", () => {
  const { items } = resolve([
    commitment("c_00000001", "Pedro", "2026-09-30"),
    complete("k_00000002", "c_00000001", "2026-09-25T11:00:00Z"),
    amend("a_00000003", "k_00000002", "2026-10-05", "2026-09-25T12:00:00Z"),
  ]);
  assert.equal(items[0]?.status, "open");
  assert.equal(items[0]?.closedAt, null);
  assert.equal(items[0]?.due, "2026-10-05");
});

test("overdue: due before today in the group's timezone", () => {
  const overdue = resolve([commitment("c_00000001", "Ana", "2026-09-24")]).items[0]!;
  const today = resolve([commitment("c_00000002", "Ana", "2026-09-25")]).items[0]!;
  const future = resolve([commitment("c_00000003", "Ana", "2026-09-26")]).items[0]!;
  assert.equal(overdue.status, "overdue");
  assert.equal(today.status, "open", "due today is still open");
  assert.equal(future.status, "open");
});

test("the timezone decides the day: same instant, different status", () => {
  const lateNight = new Date("2026-09-26T02:00:00Z"); // 23:00 on Sep 25 in Sao Paulo, already Sep 26 in UTC
  const entries = [commitment("c_00000001", "Ana", "2026-09-25")];
  assert.equal(resolve(entries, lateNight, "America/Sao_Paulo").items[0]?.status, "open");
  assert.equal(resolve(entries, lateNight, "UTC").items[0]?.status, "overdue");
  assert.equal(todayIn(lateNight, "America/Sao_Paulo"), "2026-09-25");
  assert.equal(todayIn(lateNight, "UTC"), "2026-09-26");
});

test("a commitment without a due date is never overdue", () => {
  assert.equal(resolve([commitment("c_00000001", "Ana", null)]).items[0]?.status, "open");
});

test("tie: equal timestamps are broken by local insertion order, never by text or id", () => {
  const same = "2026-09-25T10:00:00Z";
  // Both amend the same commitment at the same instant. The one inserted later (seq 20) must win,
  // even though its id and text sort BEFORE the other's alphabetically.
  const root = commitment("c_00000001", "Maria", "2026-09-26", "2026-09-24T10:00:00Z");
  const first = entry({ id: "a_ffffffff", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-28", text: "zzz later in the alphabet" }, same, 10);
  const second = entry({ id: "a_00000000", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-29", text: "aaa first in the alphabet" }, same, 20);
  for (const order of [[root, first, second], [second, first, root]]) {
    const item = resolve(order).items[0]!;
    assert.equal(item.current.id, "a_00000000");
    assert.equal(item.due, "2026-09-29");
    assert.deepEqual(item.conflicts, ["a_ffffffff"]);
  }
});

test("fork: the newest timestamp wins even when it was inserted earlier", () => {
  const root = commitment("c_00000001", "Maria", "2026-09-26", "2026-09-24T10:00:00Z");
  const older = amend("a_00000002", "c_00000001", "2026-09-27", "2026-09-25T09:00:00Z", 30);
  const newerOne = amend("a_00000003", "c_00000001", "2026-09-28", "2026-09-25T10:00:00Z", 15);
  const item = resolve([root, older, newerOne]).items[0]!;
  assert.equal(item.current.id, "a_00000003");
  assert.deepEqual(item.conflicts, ["a_00000002"]);
});

test("the descendants of a losing branch are conflicts, not orphans", () => {
  const root = commitment("c_00000001", "Maria", "2026-09-26", "2026-09-24T10:00:00Z");
  const loser = amend("a_00000002", "c_00000001", "2026-09-27", "2026-09-25T09:00:00Z");
  const loserChild = amend("a_00000004", "a_00000002", "2026-09-29", "2026-09-25T11:00:00Z");
  const winner = amend("a_00000003", "c_00000001", "2026-09-28", "2026-09-25T10:00:00Z");
  const r = resolve([root, loser, loserChild, winner]);
  assert.deepEqual(r.items[0]?.conflicts.sort(), ["a_00000002", "a_00000004"]);
  assert.equal(r.orphans.length, 0);
});

test("an amendment whose parent is missing is an orphan, and attaches once the parent arrives", () => {
  const root = commitment("c_00000001", "Maria", "2026-09-26");
  const child = amend("a_00000002", "c_00000001", "2026-09-27", "2026-09-25T09:00:00Z");
  const before = resolve([child]);
  assert.equal(before.items.length, 0);
  assert.deepEqual(before.orphans.map((e) => e.fact.id), ["a_00000002"]);
  const after = resolve([child, root]);
  assert.equal(after.orphans.length, 0);
  assert.equal(after.items[0]?.due, "2026-09-27");
});

test("duplicate fact ids (write retries) are counted once", () => {
  const c = commitment("c_00000001", "Maria", "2026-09-26");
  const dup = { ...c, seq: c.seq + 100 };
  const r = resolve([c, dup]);
  assert.equal(r.items.length, 1);
  assert.equal(r.duplicates, 1);
});

test("a cycle among non-root facts cannot loop forever and ends up as orphans", () => {
  const a = entry({ id: "a_00000001", type: "AMENDMENT", supersedes: "a_00000002" });
  const b = entry({ id: "a_00000002", type: "AMENDMENT", supersedes: "a_00000001" });
  const r = resolve([a, b]);
  assert.equal(r.items.length, 0);
  assert.equal(r.orphans.length, 2);
});

test("decisions are active, take amendments and never count as pending", () => {
  const decision = entry({ id: "d_00000001", type: "DECISION", topic: "delivery", due: "2026-09-30" });
  const change = amend("a_00000002", "d_00000001", "2026-10-12", "2026-09-25T09:00:00Z");
  const { items } = resolve([decision, change]);
  assert.equal(items[0]?.kind, "DECISION");
  assert.equal(items[0]?.status, "active");
  assert.equal(items[0]?.due, "2026-10-12");
  assert.equal(items[0]?.topic, "delivery", "topic is inherited");
  assert.deepEqual(pendingItems(items), []);
});

test("independent chains are resolved independently", () => {
  const { items } = resolve([
    commitment("c_00000001", "Maria", "2026-09-30"),
    commitment("c_00000002", "Pedro", "2026-09-28"),
    complete("k_00000003", "c_00000002"),
  ]);
  assert.deepEqual(items.map((i) => [i.rootId, i.status]), [["c_00000001", "open"], ["c_00000002", "completed"]]);
});

test("pending: overdue first, then by due date, no due date last", () => {
  const { items } = resolve([
    commitment("c_00000001", "A", "2026-10-05"),
    commitment("c_00000002", "B", null),
    commitment("c_00000003", "C", "2026-09-20"),
    commitment("c_00000004", "D", "2026-09-27"),
    commitment("c_00000005", "E", "2026-09-22"),
  ]);
  assert.deepEqual(pendingItems(items).map((i) => i.owner), ["C", "E", "D", "A", "B"]);
});

test("the result does not depend on the order of the input", () => {
  const entries = [
    commitment("c_00000001", "Maria", "2026-09-26", "2026-09-24T10:00:00Z"),
    amend("a_00000002", "c_00000001", "2026-09-27", "2026-09-25T09:00:00Z"),
    complete("k_00000003", "a_00000002", "2026-09-25T10:00:00Z"),
  ];
  const expected = resolve(entries);
  for (const shuffled of [[...entries].reverse(), [entries[1]!, entries[2]!, entries[0]!]]) {
    assert.deepEqual(resolve(shuffled), expected);
  }
});

test("findItem locates a chain by any fact id", () => {
  const { items } = resolve([commitment("c_00000001", "Maria", "2026-09-26"), amend("a_00000002", "c_00000001", "2026-09-27", "2026-09-25T09:00:00Z")]);
  assert.equal(findItem(items, "a_00000002")?.rootId, "c_00000001");
  assert.equal(findItem(items, "c_99999999"), undefined);
});

test("invalid timezone and invalid timestamps fail loudly", () => {
  assert.throws(() => resolve([], NOW, "Mars/Olympus"), ResolverError);
  const bad = entry({ id: "c_00000001", type: "COMMITMENT", owner: "Maria" }, "not-a-date");
  const child = entry({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001" }, "also-bad");
  assert.throws(() => resolve([bad, child]), /invalid createdAt/);
});
