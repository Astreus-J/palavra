# Code excerpts for the article

Three short, commented snippets, picked for how directly they support the article's thesis:
**the current state is computed by code from an immutable fact log, never by an LLM.**

## 1. A fact (the unit written to Walrus)

A fact never describes "the current state" — it describes one event. `supersedes` is how one fact
changes or closes another, instead of editing it (Walrus blobs are immutable).

```ts
// src/core/fact.ts
export interface Fact {
  id: string;
  type: FactType; // DECISION | COMMITMENT | AMENDMENT | COMPLETION
  /** Id of the fact this one changes or closes. Required for AMENDMENT and COMPLETION. */
  supersedes: string | null;
  /** Who wrote the message (channel-scoped id, e.g. "tg:123456"). */
  author: string;
  /** Who is responsible. Required for COMMITMENT; may differ from the author. */
  owner: string | null;
  /** Deadline as an ISO calendar date (YYYY-MM-DD) in the group's timezone. */
  due: string | null;
  /**
   * When the message happened, as an ISO instant with milliseconds. It orders facts
   * independently of when Walrus finished writing them, so a ledger rebuilt from Walrus
   * resolves to the same state. Stamped by the ledger when a fact is added.
   */
  at: string | null;
  task: string | null;
  text: string;
}
```

Serialized to the text actually written to Walrus — human-readable, so it also works as an
embedding:

```ts
// src/core/fact.ts — serializeFact()
const pairs = KEYS.map((k) => `${k}=${enc(values[k])}`).join(" ");
return `[${fact.type} v${FACT_VERSION}] ${pairs}\n${fact.text.trim()}`;
// e.g. "[COMMITMENT v1] id=c_7f3a9b21 supersedes=- owner=Maria due=2026-09-26 ...
//       Maria committed to sending the budget by Friday, 2026-09-26."
```

## 2. The State Resolver (pure code, no LLM)

Given every fact ever written for a group, `resolveState` walks each `supersedes` chain to its
last link and that is the current state. No recall, no network, no clock of its own — the caller
passes `now`, which makes it a pure function and trivially testable.

```ts
// src/core/resolver.ts
export function resolveState(input: readonly LedgerEntry[], options: ResolveOptions): Resolution {
  // ...dedupe by fact id (a retried write can land twice; earliest insertion wins)...
  const items: ItemState[] = [];
  for (const root of entries) {
    if (root.fact.supersedes !== null) continue; // only DECISION/COMMITMENT start a chain
    let cursor = root;
    for (;;) {
      const next = children.get(cursor.fact.id) ?? [];
      if (next.length === 0) break;
      const winner = next.reduce((best, candidate) => (newer(candidate, best) ? candidate : best));
      // ...facts that lost a fork, and their descendants, go into `conflicts`...
      cursor = winner;
    }
    // cursor is now the current state of this item
  }
}
```

## 3. Supersession: how a fork is broken

Two people can amend the same commitment before either confirmation lands. `newer` decides which
one wins — by event time first, never by text or which write reached Walrus first (writes are
asynchronous and can finish out of order):

```ts
// src/core/resolver.ts
function newer(a: LedgerEntry, b: LedgerEntry): boolean {
  const ta = instant(a);
  const tb = instant(b);
  return ta !== tb ? ta > tb : a.seq > b.seq; // tie: local insertion order, never text or id
}
```

This is also what the restore test exercises: delete the SQLite ledger, rebuild it from Walrus
alone, and `resolveState` must land on the exact same winner — see
[`docs/evidence/restore-test-2026-09-25.md`](../evidence/restore-test-2026-09-25.md).
