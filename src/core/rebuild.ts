import { FACT_TYPES, FACT_VERSION, looksLikeFact, parseFact, type Fact } from "./fact.js";
import type { Ledger } from "./ledger.js";
import type { MemoryStore, RecalledMemory } from "../memory/store.js";

// Rebuilds a group's ledger from Walrus alone (decision D-01: the local cache is disposable).
//
// 1. `restore` re-indexes the group's blobs on the relayer.
// 2. `recall` discovers the facts. Recall is semantic and top-K bound, so we ask for each fact type,
//    then follow every fact id we find (`supersedes=<id>`) to reach amendments and completions.
// 3. Facts are imported as `done`. Their order comes from the `at` stamped inside each fact, not
//    from Walrus write time, so the rebuilt state matches the original.

export interface RebuildOptions {
  now?: () => Date;
  /** Results requested per query (default 50). */
  limit?: number;
  /** Safety cap on recall queries (default 500). */
  maxQueries?: number;
  /** Safety cap on repeated restore calls (default 5). */
  maxRestoreCalls?: number;
}

export interface RebuildReport {
  restoreCalls: number;
  queries: number;
  discovered: number;
  imported: number;
  alreadyInLedger: number;
  /** Recalled memories that are not valid facts (other tools, corrupted text). */
  ignored: number;
}

export async function rebuildLedger(store: MemoryStore, ledger: Ledger, groupId: string, options: RebuildOptions = {}): Promise<RebuildReport> {
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? 50;
  const maxQueries = options.maxQueries ?? 500;
  const report: RebuildReport = { restoreCalls: 0, queries: 0, discovered: 0, imported: 0, alreadyInLedger: 0, ignored: 0 };

  for (let i = 0; i < (options.maxRestoreCalls ?? 5); i++) {
    const summary = await store.restore(groupId);
    report.restoreCalls++;
    if (!summary.truncated) break;
  }

  const found = new Map<string, { fact: Fact; blobId: string }>();
  const ignored = new Set<string>();
  const queue: string[] = FACT_TYPES.map((type) => `[${type} v${FACT_VERSION}]`);
  const asked = new Set<string>();

  while (queue.length > 0 && report.queries < maxQueries) {
    const query = queue.shift() as string;
    if (asked.has(query)) continue;
    asked.add(query);
    report.queries++;

    const results: RecalledMemory[] = await store.recall(groupId, query, { limit, maxDistance: 2 });
    for (const memory of results) {
      if (!looksLikeFact(memory.text)) {
        ignored.add(memory.blobId);
        continue;
      }
      let fact: Fact;
      try {
        fact = parseFact(memory.text);
      } catch {
        ignored.add(memory.blobId);
        continue;
      }
      if (found.has(fact.id)) continue;
      found.set(fact.id, { fact, blobId: memory.blobId });
      queue.push(`supersedes=${fact.id}`); // follow the chain to its amendments and completion
    }
  }
  report.discovered = found.size;
  report.ignored = ignored.size;

  // Deterministic import order: event time, then blob id.
  const ordered = [...found.values()].sort((a, b) => (a.fact.at ?? "").localeCompare(b.fact.at ?? "") || a.blobId.localeCompare(b.blobId));
  for (const { fact, blobId } of ordered) {
    if (ledger.importFact(groupId, fact, blobId, now()).inserted) report.imported++;
    else report.alreadyInLedger++;
  }
  return report;
}
