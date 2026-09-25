import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fact } from "./fact.js";
import { Ledger } from "./ledger.js";
import { Outbox, RETRY_DELAYS_MS, VERIFY_DELAYS_MS, type OutboxEvent } from "./outbox.js";
import type { MemoryStore, RecalledMemory, RecallOptions, RememberedMemory, RememberOptions, RestoreSummary } from "../memory/store.js";

const T0 = new Date("2026-09-25T10:00:00.000Z");

/** In-memory store with programmable failures, used to drive the outbox deterministically. */
class FakeStore implements MemoryStore {
  readonly mode = "mock" as const;
  stored: { group: string; text: string; blobId: string }[] = [];
  writes: { group: string; text: string; key?: string | undefined }[] = [];
  failNextWrites = 0;
  /** Write reaches Walrus but the call still throws (a timeout after success). */
  storeThenThrow = 0;
  /** recall returns nothing for this many calls, as if the write were not readable yet. */
  hiddenRecalls = 0;
  failRecalls = 0;
  recallCalls = 0;

  async remember(group: string, text: string, options: RememberOptions = {}): Promise<RememberedMemory> {
    this.writes.push({ group, text, key: options.idempotencyKey });
    if (this.failNextWrites > 0) { this.failNextWrites--; throw new Error("relayer unavailable"); }
    const blobId = `blob-${this.stored.length + 1}`;
    this.stored.push({ group, text, blobId });
    if (this.storeThenThrow > 0) { this.storeThenThrow--; throw new Error("timeout after write"); }
    return { blobId, namespace: `grp:${group}` };
  }
  async recall(group: string, query: string, _options?: RecallOptions): Promise<RecalledMemory[]> {
    this.recallCalls++;
    if (this.failRecalls > 0) { this.failRecalls--; throw new Error("recall failed"); }
    if (this.hiddenRecalls > 0) { this.hiddenRecalls--; return []; }
    return this.stored.filter((s) => s.group === group && s.text === query).map((s) => ({ blobId: s.blobId, text: s.text, distance: 0, createdAt: null }));
  }
  async restore(_group: string): Promise<RestoreSummary> { return { restored: 0, skipped: 0, failed: 0, total: 0, truncated: false }; }
  async health() { return { ok: true }; }
}

const fact = (over: Partial<Fact> = {}): Fact => ({
  id: "c_00000001", type: "COMMITMENT", supersedes: null, author: "tg:1", owner: "Maria", due: "2026-09-30", topic: null, at: null,
  text: "Maria will send the budget.", ...over,
});

function setup() {
  const clock = { now: new Date(T0) };
  const store = new FakeStore();
  const ledger = Ledger.open(":memory:");
  const sleeps: number[] = [];
  const events: OutboxEvent[] = [];
  const outbox = new Outbox({ store, ledger, now: () => clock.now, sleep: async (ms) => { sleeps.push(ms); }, onEvent: (e) => events.push(e) });
  const advance = (ms: number) => { clock.now = new Date(clock.now.getTime() + ms); };
  return { store, ledger, outbox, clock, sleeps, events, advance };
}

test("happy path: pending → uploaded → done, with the blob id and an idempotency key", async () => {
  const { store, ledger, outbox } = setup();
  ledger.addFact("g1", fact(), T0);
  const report = await outbox.flush();
  assert.deepEqual(report, { written: 1, verified: 1, retryScheduled: 0, failed: 0, unverified: 0 });
  const row = ledger.getRow("g1", "c_00000001")!;
  assert.equal(row.status, "done");
  assert.equal(row.blobId, "blob-1");
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0]!.key, "g1:c_00000001");
  assert.equal(store.writes[0]!.text, row.raw);
});

test("a fact added twice is written to Walrus once", async () => {
  const { store, ledger, outbox } = setup();
  ledger.addFact("g1", fact(), T0);
  ledger.addFact("g1", fact(), T0);
  await outbox.flush();
  await outbox.flush();
  assert.equal(store.writes.length, 1);
  assert.equal(store.stored.length, 1);
});

test("a failed write is retried on the 0.6 s, 2 s, 3 s ladder", async () => {
  assert.deepEqual([...RETRY_DELAYS_MS].slice(0, 3), [600, 2_000, 3_000]);
  const { store, ledger, outbox, advance } = setup();
  ledger.addFact("g1", fact(), T0);
  store.failNextWrites = 3;
  const delays: number[] = [];
  for (let i = 0; i < 3; i++) {
    const report = await outbox.flush();
    assert.equal(report.retryScheduled, 1);
    const row = ledger.getRow("g1", "c_00000001")!;
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, i + 1);
    assert.equal(row.lastError, "relayer unavailable");
    const wait = new Date(row.nextAttemptAt!).getTime() - Date.now() * 0 - (T0.getTime() + delays.reduce((a, b) => a + b, 0));
    delays.push(wait);
    advance(wait);
  }
  assert.deepEqual(delays, [600, 2_000, 3_000]);
  const final = await outbox.flush();
  assert.equal(final.written, 1);
  assert.equal(ledger.getRow("g1", "c_00000001")!.status, "done");
  assert.equal(store.stored.length, 1);
});

test("a row is not retried before its time", async () => {
  const { store, ledger, outbox, advance } = setup();
  ledger.addFact("g1", fact(), T0);
  store.failNextWrites = 1;
  await outbox.flush();
  const writesAfterFailure = store.writes.length;
  advance(599);
  assert.deepEqual(await outbox.flush(), { written: 0, verified: 0, retryScheduled: 0, failed: 0, unverified: 0 });
  assert.equal(store.writes.length, writesAfterFailure);
  advance(1);
  assert.equal((await outbox.flush()).written, 1);
});

test("after the maximum attempts the fact is marked failed, and can be requeued", async () => {
  const { store, ledger, outbox, advance, events, clock } = setup();
  ledger.addFact("g1", fact(), T0);
  store.failNextWrites = 100;
  for (let i = 0; i < 8; i++) {
    await outbox.flush();
    advance(200_000);
  }
  const row = ledger.getRow("g1", "c_00000001")!;
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 8);
  assert.ok(events.some((e) => e.type === "write-failed" && e.willRetryAt === null));
  assert.equal((await outbox.flush()).written, 0, "failed rows are not retried automatically");
  store.failNextWrites = 0;
  assert.equal(ledger.requeueFailed(clock.now), 1);
  assert.equal((await outbox.flush()).written, 1);
  assert.equal(ledger.getRow("g1", "c_00000001")!.status, "done");
});

test("recall empty right after a write: waits 0.6 s, 2 s, 3 s and then confirms", async () => {
  assert.deepEqual([...VERIFY_DELAYS_MS], [600, 2_000, 3_000]);
  const { store, ledger, outbox, sleeps } = setup();
  ledger.addFact("g1", fact(), T0);
  store.hiddenRecalls = 3;
  const report = await outbox.flush();
  assert.equal(report.verified, 1);
  assert.deepEqual(sleeps, [600, 2_000, 3_000]);
  assert.equal(ledger.getRow("g1", "c_00000001")!.status, "done");
  assert.equal(store.writes.length, 1, "verification never re-writes");
});

test("a fact that stays unreadable remains uploaded and is verified on a later flush without a new write", async () => {
  const { store, ledger, outbox, events } = setup();
  ledger.addFact("g1", fact(), T0);
  store.hiddenRecalls = 100;
  const first = await outbox.flush();
  assert.equal(first.unverified, 1);
  assert.equal(ledger.getRow("g1", "c_00000001")!.status, "uploaded");
  assert.ok(events.some((e) => e.type === "unverified"));
  store.hiddenRecalls = 0;
  const second = await outbox.flush();
  assert.equal(second.verified, 1);
  assert.equal(ledger.getRow("g1", "c_00000001")!.status, "done");
  assert.equal(store.writes.length, 1);
});

test("recall errors during verification count as 'not yet'", async () => {
  const { store, ledger, outbox } = setup();
  ledger.addFact("g1", fact(), T0);
  store.failRecalls = 2;
  assert.equal((await outbox.flush()).verified, 1);
});

test("a write that reached Walrus but timed out is adopted on retry, not written twice", async () => {
  const { store, ledger, outbox, advance, events } = setup();
  ledger.addFact("g1", fact(), T0);
  store.storeThenThrow = 1;
  const first = await outbox.flush();
  assert.equal(first.retryScheduled, 1);
  assert.equal(store.stored.length, 1, "the first attempt did store it");
  advance(600);
  const second = await outbox.flush();
  assert.equal(second.written, 1);
  assert.equal(store.stored.length, 1, "no duplicate blob");
  assert.equal(store.writes.length, 1, "the retry did not write again");
  assert.equal(ledger.getRow("g1", "c_00000001")!.blobId, "blob-1");
  assert.ok(events.some((e) => e.type === "adopted-existing"));
});

test("concurrent flushes share one run", async () => {
  const { store, ledger, outbox } = setup();
  ledger.addFact("g1", fact(), T0);
  await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
  assert.equal(store.writes.length, 1);
});

test("groups are written to their own namespace", async () => {
  const { store, ledger, outbox } = setup();
  ledger.addFact("g1", fact(), T0);
  ledger.addFact("g2", fact({ id: "c_00000002", text: "Pedro will ship it.", owner: "Pedro" }), T0);
  await outbox.flush();
  assert.deepEqual(store.stored.map((s) => s.group).sort(), ["g1", "g2"]);
});

test("retryDelay follows the ladder and repeats the last step", () => {
  const { outbox } = setup();
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => outbox.retryDelay(n)), [600, 2_000, 3_000, 10_000, 30_000, 60_000, 120_000, 120_000, 120_000]);
});
