import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { createMemoryStore } from "../memory/index.js";
import { compareSnapshots, runRestoreTest, type Snapshot } from "./recovery.js";
import { buildScenario, dateFromToday } from "./recovery-scenario.js";

const NOW = new Date("2026-09-25T15:00:00Z");
const TZ = "America/Sao_Paulo";

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  facts: 2,
  items: [{ rootId: "c_1", kind: "COMMITMENT", status: "open", owner: "Maria", due: "2026-09-30", topic: null, current: "c_1", chain: ["c_1"] }],
  pending: ["c_1"],
  blobs: { c_1: "blob-1", k_2: "blob-2" },
  ...over,
});

test("the scenario has 8 facts with valid chains and relative dates", () => {
  const facts = buildScenario(NOW, TZ);
  assert.equal(facts.length, 8);
  assert.equal(new Set(facts.map((f) => f.id)).size, 8);
  for (const f of facts) if (f.supersedes) assert.ok(facts.some((p) => p.id === f.supersedes), `${f.id} points at an existing fact`);
  assert.equal(dateFromToday(NOW, TZ, 0), "2026-09-25");
  assert.equal(dateFromToday(NOW, TZ, -1), "2026-09-24");
  assert.equal(dateFromToday(NOW, TZ, 7), "2026-10-02");
});

test("compareSnapshots: identical snapshots are the same", () => {
  assert.deepEqual(compareSnapshots(snap(), snap()), { same: true, differences: [] });
});

test("compareSnapshots reports every kind of difference", () => {
  const changedItem = snap({ items: [{ ...snap().items[0]!, due: "2026-10-01", status: "overdue" }] });
  assert.match(compareSnapshots(snap(), changedItem).differences.join("\n"), /item c_1/);
  assert.match(compareSnapshots(snap(), snap({ pending: [] })).differences.join("\n"), /pending list/);
  assert.match(compareSnapshots(snap(), snap({ blobs: { c_1: "blob-1", k_2: "OTHER" } })).differences.join("\n"), /blob of k_2/);
  assert.match(compareSnapshots(snap(), snap({ facts: 1, items: [], pending: [], blobs: { c_1: "blob-1" } })).differences.join("\n"), /fact count: 2 → 1/);
  assert.equal(compareSnapshots(snap(), snap({ items: [] })).same, false);
});

test("write facts → delete the SQLite file → rebuild from Walrus → same state (mock)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "palavra-recovery-"));
  try {
    const dbPath = join(dir, "ledger.db");
    const steps: string[] = [];
    const result = await runRestoreTest({
      store: createMemoryStore(loadConfig({})),
      dbPath,
      groupId: "-100200300",
      facts: buildScenario(NOW, TZ),
      now: NOW,
      timeZone: TZ,
      sleep: async () => undefined,
      onStep: (m) => steps.push(m),
    });
    assert.equal(result.sqliteDeleted, true);
    assert.equal(result.comparison.same, true, result.comparison.differences.join("\n"));
    assert.equal(result.writeStatuses.done, 8);
    assert.equal(result.rebuild.imported, 8);
    assert.equal(result.before.facts, 8);
    assert.deepEqual(result.after, result.before);
    assert.equal(steps.length, 3);
    assert.ok(existsSync(dbPath), "the ledger file exists again after the rebuild");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the snapshot captures pending list, chains and blob ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "palavra-recovery-"));
  try {
    const { before } = await runRestoreTest({
      store: createMemoryStore(loadConfig({})), dbPath: join(dir, "l.db"), groupId: "g", facts: buildScenario(NOW, TZ), now: NOW, timeZone: TZ, sleep: async () => undefined,
    });
    assert.equal(before.items.length, 4, "three commitments and one decision; amendments and the completion join their chains");
    const byOwner = (o: string) => before.items.find((i) => i.owner === o)!;
    assert.equal(byOwner("Maria").status, "open");
    assert.equal(byOwner("Maria").chain.length, 3);
    assert.equal(byOwner("Pedro").status, "overdue");
    assert.equal(byOwner("Joao").status, "completed");
    assert.equal(before.pending.length, 2, "Pedro (overdue) then Maria (open)");
    assert.equal(before.items.find((i) => i.kind === "DECISION")?.status, "active");
    assert.ok(Object.values(before.blobs).every((b) => typeof b === "string" && b.length > 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
