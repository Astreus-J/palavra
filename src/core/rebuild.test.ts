import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { createMemoryStore, type MemoryStore } from "../memory/index.js";
import type { Fact } from "./fact.js";
import { Ledger } from "./ledger.js";
import { Outbox } from "./outbox.js";
import { rebuildLedger } from "./rebuild.js";
import { resolveState, type Resolution } from "./resolver.js";

const NOW = new Date("2026-09-27T12:00:00Z");
const G = "-5230162759";
const base = { author: "tg:1", owner: null, due: null, topic: null, supersedes: null } as const;
const f = (over: Partial<Fact> & Pick<Fact, "id" | "type" | "at">): Fact => ({ ...base, text: `text ${over.id}`, ...over });

// A small history: two commitments (one amended twice), one completed, and one decision.
const HISTORY: Fact[] = [
  f({ id: "c_00000001", type: "COMMITMENT", owner: "Maria", due: "2026-09-26", at: "2026-09-24T10:00:00.000Z", text: "Maria will send the budget by Friday." }),
  f({ id: "d_00000002", type: "DECISION", topic: "delivery", due: "2026-09-30", at: "2026-09-24T10:05:00.000Z", text: "Delivery is on September 30." }),
  f({ id: "c_00000003", type: "COMMITMENT", owner: "Pedro", due: "2026-09-28", at: "2026-09-24T10:10:00.000Z", text: "Pedro will finish the backend." }),
  f({ id: "a_00000004", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-29", at: "2026-09-25T09:00:00.000Z", text: "Maria moved the budget to Monday." }),
  f({ id: "a_00000005", type: "AMENDMENT", supersedes: "a_00000004", due: "2026-10-02", at: "2026-09-25T15:00:00.000Z", text: "Maria moved the budget again to October 2." }),
  f({ id: "k_00000006", type: "COMPLETION", supersedes: "c_00000003", at: "2026-09-26T11:00:00.000Z", text: "Pedro finished the backend." }),
];

const project = (r: Resolution) =>
  r.items.map((i) => ({ rootId: i.rootId, kind: i.kind, status: i.status, owner: i.owner, due: i.due, topic: i.topic, current: i.current.id, history: i.history.map((h) => h.fact.id), conflicts: i.conflicts }));
const stateOf = (ledger: Ledger, group = G) => resolveState(ledger.entries(group), { now: NOW, timeZone: "America/Sao_Paulo" });

async function written(facts: Fact[]) {
  const store = createMemoryStore(loadConfig({}));
  const ledger = Ledger.open(":memory:");
  const outbox = new Outbox({ store, ledger, now: () => NOW, sleep: async () => undefined });
  for (const fact of facts) ledger.addFact(G, fact, NOW);
  await outbox.flush();
  return { store, ledger };
}

test("a ledger rebuilt from Walrus alone resolves to the same state", async () => {
  const { store, ledger: original } = await written(HISTORY);
  assert.equal(original.counts().done, HISTORY.length, "everything reached done");

  const rebuilt = Ledger.open(":memory:"); // the local cache is gone
  const report = await rebuildLedger(store, rebuilt, G, { now: () => NOW });
  assert.equal(report.imported, HISTORY.length);
  assert.equal(report.ignored, 0);
  assert.deepEqual(project(stateOf(rebuilt)), project(stateOf(original)));
  assert.equal(rebuilt.counts().done, HISTORY.length);

  const items = stateOf(rebuilt).items;
  assert.deepEqual(items.map((i) => [i.rootId, i.status]), [["c_00000001", "open"], ["d_00000002", "active"], ["c_00000003", "completed"]]);
  assert.equal(items[0]?.due, "2026-10-02", "the two amendments were followed");
});

test("ordering comes from `at`, not from the order in which Walrus stored the facts", async () => {
  // Two amendments of the same commitment; the NEWER one is written to Walrus FIRST.
  const root = f({ id: "c_00000001", type: "COMMITMENT", owner: "Maria", due: "2026-09-26", at: "2026-09-24T10:00:00.000Z" });
  const older = f({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-27", at: "2026-09-25T09:00:00.000Z" });
  const newer = f({ id: "a_00000003", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-28", at: "2026-09-25T09:00:01.000Z" });
  const { store, ledger: original } = await written([root, newer, older]);
  const rebuilt = Ledger.open(":memory:");
  await rebuildLedger(store, rebuilt, G, { now: () => NOW });
  assert.equal(stateOf(original).items[0]?.current.id, "a_00000003");
  assert.deepEqual(project(stateOf(rebuilt)), project(stateOf(original)));
});

test("rebuilding twice adds nothing new", async () => {
  const { store } = await written(HISTORY);
  const rebuilt = Ledger.open(":memory:");
  await rebuildLedger(store, rebuilt, G, { now: () => NOW });
  const again = await rebuildLedger(store, rebuilt, G, { now: () => NOW });
  assert.equal(again.imported, 0);
  assert.equal(again.alreadyInLedger, HISTORY.length);
});

test("other groups are not imported and non-fact memories are ignored", async () => {
  const { store } = await written(HISTORY);
  await store.remember(G, "User prefers dark mode and nothing else");
  await store.remember("another-group", "[COMMITMENT v1] id=c_0000000f supersedes=- author=tg%3A1 owner=Eve topic=-\nEve owns something elsewhere.");
  const rebuilt = Ledger.open(":memory:");
  const report = await rebuildLedger(store, rebuilt, G, { now: () => NOW });
  assert.equal(report.imported, HISTORY.length);
  assert.equal(report.ignored, 1);
  assert.deepEqual(rebuilt.groups(), [G]);
});

test("it follows a long chain even when each query returns only two results", async () => {
  // A chain longer than the query limit: the type queries alone cannot see all of it.
  const ids = ["c_00000001", "a_00000002", "a_00000003", "a_00000004", "a_00000005", "a_00000006"];
  const chain = ids.map((id, i) =>
    f({ id, type: i === 0 ? "COMMITMENT" : "AMENDMENT", supersedes: i === 0 ? null : ids[i - 1]!, owner: i === 0 ? "Maria" : null, due: `2026-10-0${i + 1}`, at: `2026-09-2${i}T10:00:00.000Z` }),
  );
  const { store } = await written(chain);
  const rebuilt = Ledger.open(":memory:");
  const report = await rebuildLedger(store, rebuilt, G, { now: () => NOW, limit: 2 });
  assert.equal(report.discovered, 6);
  assert.equal(stateOf(rebuilt).items[0]?.current.id, "a_00000006");
  assert.equal(stateOf(rebuilt).items[0]?.due, "2026-10-06");
});

test("restore is called until the relayer reports it is complete", async () => {
  const { store } = await written(HISTORY);
  let calls = 0;
  const flaky: MemoryStore = {
    mode: store.mode,
    remember: (...a) => store.remember(...a),
    recall: (...a) => store.recall(...a),
    health: () => store.health(),
    restore: async () => { calls++; return { restored: 1, skipped: 0, failed: 0, total: 3, truncated: calls < 3 }; },
  };
  const report = await rebuildLedger(flaky, Ledger.open(":memory:"), G, { now: () => NOW });
  assert.equal(report.restoreCalls, 3);
});

test("an empty group rebuilds to an empty ledger", async () => {
  const store = createMemoryStore(loadConfig({}));
  const rebuilt = Ledger.open(":memory:");
  const report = await rebuildLedger(store, rebuilt, "empty-group", { now: () => NOW });
  assert.equal(report.imported, 0);
  assert.equal(rebuilt.entries("empty-group").length, 0);
});
