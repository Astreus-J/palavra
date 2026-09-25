import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fact } from "./fact.js";
import { Ledger, LedgerError } from "./ledger.js";

const T0 = new Date("2026-09-25T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: "c_00000001", type: "COMMITMENT", supersedes: null, author: "tg:1", owner: "Maria", due: "2026-09-30", topic: null, at: null, task: null,
  text: "Maria will send the budget.", ...over,
});

test("a new fact enters as pending, stamped with `at` when it has none", () => {
  const ledger = Ledger.open(":memory:");
  const { row, inserted } = ledger.addFact("g1", fact(), T0);
  assert.equal(inserted, true);
  assert.equal(row.status, "pending");
  assert.equal(row.blobId, null);
  assert.equal(row.attempts, 0);
  assert.match(row.raw, / at=2026-09-25T10%3A00%3A00\.000Z[ \n]/);
});

test("an explicit `at` is kept", () => {
  const ledger = Ledger.open(":memory:");
  const { row } = ledger.addFact("g1", fact({ at: "2026-09-24T08:00:00.000Z" }), T0);
  assert.match(row.raw, / at=2026-09-24T08%3A00%3A00\.000Z[ \n]/);
});

test("adding the same fact twice is idempotent: one row, no second write queued", () => {
  const ledger = Ledger.open(":memory:");
  const first = ledger.addFact("g1", fact(), T0);
  const second = ledger.addFact("g1", fact(), at(5_000));
  assert.equal(second.inserted, false);
  assert.equal(second.row.seq, first.row.seq);
  assert.equal(ledger.counts().pending, 1);
  assert.equal(ledger.entries("g1").length, 1);
});

test("retrying the same fact without `at` keeps the original timestamp", () => {
  const ledger = Ledger.open(":memory:");
  const first = ledger.addFact("g1", fact(), T0);
  const retry = ledger.addFact("g1", fact(), at(90_000));
  assert.equal(retry.inserted, false);
  assert.equal(retry.row.raw, first.row.raw);
  assert.match(retry.row.raw, / at=2026-09-25T10%3A00%3A00\.000Z[ \n]/);
});

test("the same id with a different explicit `at` is a conflict", () => {
  const ledger = Ledger.open(":memory:");
  ledger.addFact("g1", fact({ at: "2026-09-24T08:00:00.000Z" }), T0);
  assert.throws(() => ledger.addFact("g1", fact({ at: "2026-09-24T09:00:00.000Z" }), T0), LedgerError);
});

test("the same id with different content is rejected", () => {
  const ledger = Ledger.open(":memory:");
  ledger.addFact("g1", fact(), T0);
  assert.throws(() => ledger.addFact("g1", fact({ text: "Something else entirely." }), T0), LedgerError);
});

test("the same fact id may exist in different groups", () => {
  const ledger = Ledger.open(":memory:");
  ledger.addFact("g1", fact(), T0);
  assert.equal(ledger.addFact("g2", fact(), T0).inserted, true);
  assert.deepEqual(ledger.groups(), ["g1", "g2"]);
  assert.equal(ledger.entries("g1").length, 1);
  assert.equal(ledger.entries("g2").length, 1);
});

test("lifecycle: pending → uploaded (blob_id) → done", () => {
  const ledger = Ledger.open(":memory:");
  const { row } = ledger.addFact("g1", fact(), T0);
  ledger.markUploaded(row.seq, "blob-1", at(1_000));
  const uploaded = ledger.getRow("g1", "c_00000001")!;
  assert.equal(uploaded.status, "uploaded");
  assert.equal(uploaded.blobId, "blob-1");
  assert.equal(uploaded.attempts, 1);
  assert.deepEqual(ledger.awaitingVerification().map((r) => r.factId), ["c_00000001"]);
  ledger.markDone(row.seq, at(2_000));
  assert.equal(ledger.getRow("g1", "c_00000001")!.status, "done");
  assert.deepEqual(ledger.counts(), { pending: 0, uploaded: 0, done: 1, failed: 0 });
});

test("a retry keeps the row pending and hides it until its time arrives", () => {
  const ledger = Ledger.open(":memory:");
  const { row } = ledger.addFact("g1", fact(), T0);
  assert.equal(ledger.dueForWrite(T0).length, 1);
  ledger.markRetry(row.seq, "boom", at(600), at(0));
  const after = ledger.getRow("g1", "c_00000001")!;
  assert.equal(after.status, "pending");
  assert.equal(after.attempts, 1);
  assert.equal(after.lastError, "boom");
  assert.equal(ledger.dueForWrite(at(599)).length, 0);
  assert.equal(ledger.dueForWrite(at(600)).length, 1);
});

test("failed rows are excluded from entries by default and can be requeued", () => {
  const ledger = Ledger.open(":memory:");
  const { row } = ledger.addFact("g1", fact(), T0);
  ledger.markFailed(row.seq, "gave up", at(1));
  assert.equal(ledger.entries("g1").length, 0);
  assert.equal(ledger.entries("g1", { includeFailed: true }).length, 1);
  assert.equal(ledger.requeueFailed(at(2), "g2"), 0);
  assert.equal(ledger.requeueFailed(at(2), "g1"), 1);
  const back = ledger.getRow("g1", "c_00000001")!;
  assert.equal(back.status, "pending");
  assert.equal(back.attempts, 0);
});

test("entries feed the resolver: parsed facts, pending included, ordered by insertion", () => {
  const ledger = Ledger.open(":memory:");
  ledger.addFact("g1", fact(), T0);
  ledger.addFact("g1", fact({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-10-02", text: "Moved." }), at(60_000));
  const entries = ledger.entries("g1");
  assert.deepEqual(entries.map((e) => e.fact.id), ["c_00000001", "a_00000002"]);
  assert.ok(entries[0]!.seq < entries[1]!.seq);
  assert.equal(entries[0]!.createdAt, "2026-09-25T10:00:00.000Z");
  assert.equal(entries[1]!.createdAt, "2026-09-25T10:01:00.000Z");
});

test("data survives closing and reopening the database file", () => {
  const dir = mkdtempSync(join(tmpdir(), "palavra-ledger-"));
  try {
    const path = join(dir, "nested", "ledger.db");
    const first = Ledger.open(path);
    first.addFact("g1", fact(), T0);
    first.close();
    const second = Ledger.open(path);
    assert.equal(second.entries("g1").length, 1);
    assert.equal(second.getRow("g1", "c_00000001")!.status, "pending");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
