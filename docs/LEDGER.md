# Ledger and outbox

Walrus is the durable source of truth. The local **SQLite ledger** is a cache that makes the bot fast
and lets it answer while writes are still in flight. It can be deleted and rebuilt from Walrus
(decision D-01). Code: [`ledger.ts`](../src/core/ledger.ts), [`outbox.ts`](../src/core/outbox.ts),
[`rebuild.ts`](../src/core/rebuild.ts).

## Write lifecycle

| Status | Meaning |
|---|---|
| `pending` | not written yet, or a write failed and is waiting for its retry (`next_attempt_at`) |
| `uploaded` | written to Walrus, `blob_id` known, not yet readable through recall |
| `done` | written and verified through recall |
| `failed` | gave up after 8 attempts; `requeueFailed` puts it back in the queue |

The bot answers from the ledger immediately (`entries()` includes `pending` and `uploaded` facts), so a
user never waits ~30 s for Walrus to see their own message.

## Outbox

`Outbox.flush()` processes everything that is due:

1. **Write.** `remember(group, fact, { idempotencyKey: "<group>:<fact id>" })`. Success → `uploaded`.
2. **Retry on failure** with a growing delay: **0.6 s, 2 s, 3 s**, then 10 s, 30 s, 60 s and 120 s (the last
   step repeats). After 8 attempts the row becomes `failed` and an event is emitted.
3. **Verify.** Recall must return the fact; the outbox waits **0.6 s, 2 s, 3 s** between checks because a read
   can come back empty right after a write. A fact that is still unreadable stays `uploaded` and is checked
   again on the next flush, **without writing again**.
4. **No duplicate writes.** Adding the same fact twice creates one row. A retry after an uncertain failure (for
   example a timeout after the write reached Walrus) first looks for the exact text already stored and adopts
   that blob instead of writing a second one. The idempotency key covers the same case on the relayer side.

Concurrent `flush()` calls share one run.

## Rebuilding from Walrus

`rebuildLedger(store, ledger, groupId)`:

1. `restore` re-indexes the group's blobs on the relayer (repeated while it reports `truncated`).
2. `recall` discovers the facts: one query per fact type (`[COMMITMENT v1]`, ...), then one query per fact
   found (`supersedes=<id>`) to reach its amendments and completion, so chains longer than the query limit are
   still followed.
3. Facts are imported as `done`, ordered by the `at` stamped inside each fact (see
   [FACT-MODEL.md](FACT-MODEL.md)), **not** by Walrus write time. Two jobs can finish out of order, so relayer
   time cannot be trusted to order facts.

The rebuilt ledger resolves to the same state as the original.

### Evidence (2026-09-25, Walrus mainnet)
Five facts (2 commitments, 1 amendment, 1 decision, 1 completion) were written through the outbox
to a test group: all five reached `done` in 212 s. A new empty ledger was rebuilt from Walrus alone
(1 restore call, 9 recall queries, 5 facts discovered and imported) and resolved to exactly the same items,
statuses, owners, due dates and current facts as the original.

### Known limits
- Recall is semantic and top-K bound. Discovery asks 50 results per query, so a group with more than 50 facts of one
  type relies on the `supersedes=` follow-up queries to reach the rest. Roots (facts that supersede nothing) beyond
  the limit could be missed in very large groups; fine at hackathon scale.
- Facts with the same `at` (same millisecond) fall back to insertion order, which a rebuild cannot recover
  (it uses blob id). In practice two messages in one group never share a millisecond.
