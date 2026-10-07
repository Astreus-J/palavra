# Bug Bounty reproductions (task HACKATONSU-40)

Minimal, one-command reproductions of anomalies found in Walrus Memory (MemWal), each with expected vs actual
behavior and the environment, ready to become issues at https://github.com/MystenLabs/MemWal/issues.
**Nothing has been filed yet** (that is task HACKATONSU-41).

All scripts are read-only against the relayer: they call `recall()` and never write a blob.
`seed.mjs` is the only script that writes (6 blobs), and only if you run it.

```bash
npm install
cp .env.example .env            # MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID of an account you own
node --env-file=.env bugs/seed.mjs                                    # optional: create a namespace with data
NS=<namespace> node --env-file=.env bugs/01-recall-empty-when-client-clock-ahead/repro.mjs
```

## Candidates

| # | Title | Strength | Closest existing issues | Why it is not a duplicate |
|---|---|---|---|---|
| [01](01-recall-empty-when-client-clock-ahead/) | `recall()` answers 200 with an empty result when the client clock is 1-5 min ahead | **Strong** | #1036, #1070 (empty recall, 200, no cause) | Deterministic cause and reproduction; the symptom those issues describe may come from this |
| [02](02-recent-sort-max-distance-underfill/) | `sort: "recent"` + `maxDistance` returns fewer hits than asked, even 0 | **Strong** | #1066, #1036 (same SDK line, other mechanism), #1103 (`recent` + `maxTokens`) | Nobody reports that `limit` truncation happens before the distance filter |
| [03](03-replayed-nonce-reported-as-bad-credentials/) | A replayed nonce is rejected as "wrong private key" (401, no reason) | Weak (DX) | #696, #980, #573 | Different case, but small; file only if we need a third report or fold it into #980 |

Candidate 03 is honest filler: the first two are the ones worth the maintainers' time. If something better turns up
(for example by running the write-side probes, which we have not done), prefer it.

## How duplicates were checked
On **2026-10-05 (about 18:00 UTC)** we downloaded every issue of `MystenLabs/MemWal`, open and closed (461), with
`gh issue list --state all --limit 1000 --json number,title,state,body`, and searched titles and bodies for
`maxDistance`, `sort`/`recent`, `scoringWeights`, `listNamespaces`, `nonce`, `replay`, `clock`/`skew`/`drift`,
`dropped`, `has_more`, `wildcard`, `namespace` and error-class terms. The tracker moves fast (dozens of new
issues in the last week), so **re-run the search right before filing**.

## Probed, but already reported or not a bug (not filed)
| Probe | Result | Existing issue |
|---|---|---|
| write to `done` latency | 25.2 s, inside the documented range | docs/ACCOUNTS.md |
| `limit: 0`, non-integer `limit` | silent empty / raw serde text | #1086, #1088 |
| `maxDistance` drops everything | looks like an empty namespace | #1066, #1036 |
| `sort: "recent"` ordering on live writes | newest first, correct | (#1060 is about `restore`) |
| `accountId` ignored by the relayer | routes by delegate key | #1069 |
| invalid `sort` value | 422 with raw serde text | #1086 family |
| `scoringWeights` out of range or `NaN` | 400 `[0, 100]` / 422 raw serde; the ranges are not in the SDK docs | minor docs gap, not filed |
| namespace `""`, NUL byte, 2000 chars, `%`, `*`, `../` | rejected or no match; no wildcard leakage | #654 asks for wildcards |
| query over 16384 bytes | clear 400 | - |
| `listNamespaces`: `next_cursor` set while `has_more` is false | harmless if callers use `has_more` | cosmetic, not filed |
| same query 5 times | identical distances, stable order | - |
| nonce reuse | correctly rejected (see 03 for the error text) | - |

## Product impact on Recall (internal, not for the MemWal tracker)
Both strong findings also affect this bot, so they are worth a separate task:
- `src/memory/store.ts` passes a default `maxDistance` (0.7) together with `sort: "recent"`: finding 02 applies to it.
- The store does not look at `dropped_count`: finding 01 would make the bot believe a group has no memories.
