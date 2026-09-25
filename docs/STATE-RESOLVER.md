# State Resolver

Pure code that turns a group's facts into its **current state**. No LLM, no network, no recall,
no clock (the caller passes `now`). Implementation: [`src/core/resolver.ts`](../src/core/resolver.ts).
Tests: `src/core/resolver.test.ts`. Facts are described in [FACT-MODEL.md](FACT-MODEL.md).

## Input and output

```ts
resolveState(entries: LedgerEntry[], { now: Date, timeZone: string }): Resolution
// LedgerEntry = { fact, seq, createdAt }   seq: local insertion order, createdAt: ISO instant
// Resolution  = { items: ItemState[], orphans: LedgerEntry[], duplicates: number }
```

Helpers: `pendingItems(items)`, `findItem(items, factId)`, `todayIn(now, timeZone)`.

## Rules

1. **Chains.** A chain starts at a root (`DECISION` or `COMMITMENT`, `supersedes` empty) and follows
   `supersedes` to the last link. The last link is the item's current fact.
2. **Status** comes from the last link:
   - commitment: `completed` if the last link is a `COMPLETION`; otherwise `overdue` when the due date is
     before today in the group's timezone, else `open`. A due date equal to today is still `open`.
   - decision: always `active` (decisions do not complete) and never pending.
   - an `AMENDMENT` after a `COMPLETION` re-opens the item.
3. **Inheritance.** `owner`, `due` and `topic` take the latest non-null value on the chain, so an
   amendment only needs to state what changed.
4. **Forks.** If several facts supersede the same parent, the newest `createdAt` wins. Equal
   timestamps are broken by the higher local `seq`. **Never by text or id.** The losing facts (and their
   descendants) are listed in `conflicts`.
5. **Timezone.** "Today" is the calendar date in the group's IANA timezone, so the same instant can be
   overdue in UTC and still open in America/Sao_Paulo.
6. **Bad data does not crash the bot.** Facts whose parent is missing (for example a write that has not
   arrived yet) or that form a cycle are returned as `orphans` and attach on the next run once the parent
   exists. Duplicate fact ids (write retries) are counted once. An invalid timezone or timestamp throws.
7. **Order independence.** The result does not depend on the order of the input.

## Pending list

`pendingItems` returns open and overdue commitments: overdue first, then by due date (no due date last),
then by insertion order. It feeds `/pending` and the reminders.
