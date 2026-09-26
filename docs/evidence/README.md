# Evidence index

Proof that Palavra works, kept in the repository so judges can verify it. Every blob is on Walrus mainnet
and can be opened on Walruscan.

| Evidence | What it proves | File |
|---|---|---|
| Restore test (mainnet, 2026-09-25) | Deleting the local SQLite ledger loses nothing: it is rebuilt from Walrus alone and the state is identical (pending list, chains, owners, due dates, blob ids) | [restore-test-2026-09-25.md](restore-test-2026-09-25.md) |
| Gemini model check | Model choice, measurements and integration friction | [gemini-model-check.md](gemini-model-check.md) |

## Blobs written so far (account `0x256402a0…92fb`)
| Source | Blobs |
|---|---|
| Setup check (`setup-check`) | 1 |
| Ledger rebuild check (`rebuild-check`) | 5 |
| Restore test (`restore-test-2026-09-25-6eefdb`) | 8 |
| **Total** | **14** (the hackathon requires at least 10 at submission time) |

## For the article
Suggested paragraph for the "before/after" section (task HACKATONSU-34):

> **The local cache is disposable.** Palavra keeps a SQLite ledger so it can answer instantly while Walrus
> writes finish (about 30 seconds each). But the ledger is only a cache. In our restore test we wrote eight
> facts to Walrus mainnet, deleted the SQLite file, and rebuilt the ledger from Walrus alone: the pending
> list, every chain of amendments, the owners, the due dates and the blob id of each fact came back identical.
> Ordering is the subtle part: Walrus writes are asynchronous and can finish out of order, so each fact carries
> its own event time instead of relying on the write time. Reproduce it with `npm run restore-test -- --real`.

## Two-phase receipt (task HACKATONSU-21)
Live run on 2026-09-25 in the test group, on Walrus mainnet (`npm run receipt-demo -- --chat <id> --real`):

1. The bot posted a message ending in **⏳ Saving to Walrus…**.
2. The outbox wrote the fact to Walrus in 37.7 s (blob `3MMaJspAb79PnsKCiKxM4ogcpL0qj0SO6EROZ-tc91I`).
3. The **same message** was edited to **🔗 Saved on Walrus: proof**, linking to
   [Walruscan](https://walruscan.com/mainnet/blob/3MMaJspAb79PnsKCiKxM4ogcpL0qj0SO6EROZ-tc91I).

If Walrus keeps refusing the write, the message becomes an error with a **🔄 Try again** button (covered by tests).
