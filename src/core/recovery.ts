import { rmSync, existsSync } from "node:fs";
import type { Fact } from "./fact.js";
import { Ledger } from "./ledger.js";
import { Outbox, type OutboxEvent } from "./outbox.js";
import { rebuildLedger, type RebuildReport } from "./rebuild.js";
import { pendingItems, resolveState } from "./resolver.js";
import type { MemoryStore } from "../memory/store.js";

// Recovery test: prove the local ledger is disposable.
//   write facts through the outbox → snapshot → DELETE the SQLite file → rebuild from Walrus → snapshot → compare.

export interface Snapshot {
  facts: number;
  /** One entry per item (decision or commitment), in resolver order. */
  items: { rootId: string; kind: string; status: string; owner: string | null; due: string | null; topic: string | null; current: string; chain: string[] }[];
  /** Root ids of the pending list, in the order /pending would show them. */
  pending: string[];
  /** Fact id → Walrus blob id. */
  blobs: Record<string, string | null>;
}

export interface Comparison {
  same: boolean;
  differences: string[];
}

export interface RecoveryOptions {
  store: MemoryStore;
  /** Path of the SQLite file. It is really deleted, so it must be a file path, not ":memory:". */
  dbPath: string;
  groupId: string;
  facts: Fact[];
  now: Date;
  timeZone: string;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: OutboxEvent) => void;
  onStep?: (message: string) => void;
}

export interface RecoveryResult {
  before: Snapshot;
  after: Snapshot;
  comparison: Comparison;
  rebuild: RebuildReport;
  writeStatuses: Record<string, number>;
  timings: { writeMs: number; rebuildMs: number };
  sqliteDeleted: boolean;
}

export function snapshot(ledger: Ledger, groupId: string, options: { now: Date; timeZone: string }): Snapshot {
  const resolution = resolveState(ledger.entries(groupId, { includeFailed: true }), options);
  const blobs: Record<string, string | null> = {};
  for (const row of ledger.rows(groupId)) blobs[row.factId] = row.blobId;
  return {
    facts: Object.keys(blobs).length,
    items: resolution.items.map((i) => ({
      rootId: i.rootId,
      kind: i.kind,
      status: i.status,
      owner: i.owner,
      due: i.due,
      topic: i.topic,
      current: i.current.id,
      chain: i.history.map((h) => h.fact.id),
    })),
    pending: pendingItems(resolution.items).map((i) => i.rootId),
    blobs: Object.fromEntries(Object.entries(blobs).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function compareSnapshots(before: Snapshot, after: Snapshot): Comparison {
  const differences: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (before.facts !== after.facts) differences.push(`fact count: ${before.facts} → ${after.facts}`);
  if (!same(before.pending, after.pending)) differences.push(`pending list: [${before.pending}] → [${after.pending}]`);
  const rootIds = new Set([...before.items, ...after.items].map((i) => i.rootId));
  for (const rootId of rootIds) {
    const a = before.items.find((i) => i.rootId === rootId);
    const b = after.items.find((i) => i.rootId === rootId);
    if (!a || !b) differences.push(`item ${rootId}: ${a ? "missing after" : "appeared after"}`);
    else if (!same(a, b)) differences.push(`item ${rootId}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  if (!same(before.blobs, after.blobs)) {
    for (const id of new Set([...Object.keys(before.blobs), ...Object.keys(after.blobs)])) {
      if (before.blobs[id] !== after.blobs[id]) differences.push(`blob of ${id}: ${before.blobs[id]} → ${after.blobs[id]}`);
    }
  }
  return { same: differences.length === 0, differences };
}

const removeSqlite = (path: string) => {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) rmSync(file, { force: true });
};

export async function runRestoreTest(options: RecoveryOptions): Promise<RecoveryResult> {
  const { store, dbPath, groupId, facts, now, timeZone } = options;
  const step = options.onStep ?? (() => undefined);
  removeSqlite(dbPath);

  step(`writing ${facts.length} facts through the outbox`);
  const original = Ledger.open(dbPath);
  for (const fact of facts) original.addFact(groupId, fact, now);
  const t0 = Date.now();
  await new Outbox({ store, ledger: original, now: () => new Date(), ...(options.sleep ? { sleep: options.sleep } : {}), ...(options.onEvent ? { onEvent: options.onEvent } : {}) }).flush();
  const writeMs = Date.now() - t0;
  const writeStatuses = original.counts();
  const before = snapshot(original, groupId, { now, timeZone });
  original.close();

  step("deleting the SQLite file");
  removeSqlite(dbPath);
  const sqliteDeleted = !existsSync(dbPath);

  step("rebuilding the ledger from Walrus");
  const rebuilt = Ledger.open(dbPath);
  const t1 = Date.now();
  const rebuild = await rebuildLedger(store, rebuilt, groupId);
  const rebuildMs = Date.now() - t1;
  const after = snapshot(rebuilt, groupId, { now, timeZone });
  rebuilt.close();

  return { before, after, comparison: compareSnapshots(before, after), rebuild, writeStatuses, timings: { writeMs, rebuildMs }, sqliteDeleted };
}
