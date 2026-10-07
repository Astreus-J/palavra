# 02. `recall({ sort: "recent", maxDistance })` returns fewer hits than asked, even none

**Status:** reproduced on mainnet, 2026-10-05. Candidate for a new MemWal issue (not filed yet).
**Severity:** medium. It silently defeats the documented recipe for newest-wins recall.

## What happens
`sort: "recent"` is documented as "newest-among-matches" and recommended for newest-wins. `maxDistance` is
applied by the SDK **after** the relayer has already cut the list to `limit` (`dist/memwal.js`: the filter runs
on `result.results`, then `total` is overwritten). Combined, the relayer picks the `limit` newest memories
first, and the filter then removes the ones that are too far, even when older memories would pass.

Real output (8 memories, query "budget", `limit: 3`, cutoff 0.608; three memories have distance below it):

```
sort relevance, limit 3, maxDistance 0.608    results=3  distances=[0.576, 0.598, 0.598]
sort recent,    limit 3, (no maxDistance)     results=3  distances=[0.756, 0.742, 0.868]
sort recent,    limit 3, maxDistance 0.608    results=0  distances=[]
```

## Why it matters
Our bot (Recall) keeps a ledger of commitments and amendments and needs "the latest relevant fact". The
documented way is `sort: "recent"` plus a relevance cutoff so unrelated filler is dropped. That combination
returns nothing as soon as the newest memories are about something else. The behavior is correct for
`sort: "relevance"` (closest first, so truncation and filter agree), which makes the difference easy to miss.

## Expected
Apply the distance filter before truncating to `limit` (over-fetch, filter, then slice), or document that
`maxDistance` is a post-filter and that it can under-fill with `sort: "recent"`.

## Reproduce
```bash
cp .env.example .env     # set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID
node --env-file=.env bugs/seed.mjs          # optional: writes 6 blobs, newest ones are off-topic
NS=<namespace> node --env-file=.env bugs/02-recent-sort-max-distance-underfill/repro.mjs
```
Read-only. It picks the cutoff itself (just above the 3rd closest distance), so it works on any namespace
where the newest memories are less relevant to the query.

## Environment
`@mysten-incubation/memwal` 0.1.8, relayer `https://relayer.memory.walrus.xyz` (relayerVersion 0.1.0,
apiVersion 1.0.0), Node v26.10.0, Linux 7.2.8 x86_64. No LLM involved.

## Related issues (checked 2026-10-05, see [../README.md](../README.md))
#1066 and #1036 (all-dropped result looks like an empty namespace: same SDK line, different mechanism),
#1103 (`sort: "recent"` with `maxTokens` drops the most relevant hits: same family, different parameter),
#692 (`total` is undocumented). None describes the `limit` truncation happening before the filter.
