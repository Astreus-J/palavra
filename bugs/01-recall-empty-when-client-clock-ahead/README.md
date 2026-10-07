# 01. `recall()` answers 200 with an empty result when the client clock is 1-5 minutes ahead

**Status:** reproduced on mainnet, 2026-10-05. Candidate for a new MemWal issue (not filed yet).
**Severity:** high for chatbots: the bot silently believes the user has no memories.

## What happens
If the machine running the SDK has a clock **ahead** of the relayer by 1 to 5 minutes, `recall()` returns
HTTP 200 with `results: []`, `total: 0` and `dropped_count` equal to the number of matches (the field is
documented as "matches omitted because blob download or decrypt failed"). Nothing throws.

| Client clock | Result for the same namespace (3 memories match) |
|---|---|
| +0 min | 3 results |
| **+1, +3, +5 min** | **200, 0 results, `dropped_count: 3`** |
| +6 min | 401 with `x-auth-error: ERR_TIMESTAMP_OUT_OF_BOUNDS` (clear message) |
| -4 min | 3 results |
| -6 min | 401 clock-drift error (clear message) |
| warm client (SEAL session built at real time), then +3 min | 3 results |

So the relayer's drift window accepts the signed request, but decryption fails for every blob. The last row
isolates the cause: a client whose SEAL session was created before the clock moved still works, so the
request timestamp is fine and the **SEAL session creation time** (in the future for the key servers) is the
likely culprit. This last part is our hypothesis, not confirmed on the relayer side.

## Why it matters
Laptops, VMs and containers with a fast clock are common. The failure is deterministic, looks exactly like
"this user has no memories" (see #1036 and #1070, which describe the same symptom without a cause), and is
the opposite of what happens for a clock that is too far off, which gets a clear 401. A chatbot built on
`withMemWal` injects nothing and answers as if it had never met the user.

## Expected
Either decryption succeeds, or the call fails loudly with the same actionable clock-drift error used for
the +6 min case. At minimum, the SDK should treat `results: []` with `dropped_count > 0` as an error or
warning, not as an empty namespace.

## Reproduce
```bash
npm install
cp .env.example .env     # set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID
# needs a namespace with >= 3 memories about "budget"; either use your own or seed one (writes 6 blobs):
node --env-file=.env bugs/seed.mjs
NS=<namespace> node --env-file=.env bugs/01-recall-empty-when-client-clock-ahead/repro.mjs
```
The script is read-only. It simulates a fast clock by shifting `Date.now()` around each call (the SDK uses it
for both the request timestamp and the SEAL session creation time); we could not change the OS clock.

## Environment
`@mysten-incubation/memwal` 0.1.8, relayer `https://relayer.memory.walrus.xyz` (relayerVersion 0.1.0,
apiVersion 1.0.0), Node v26.10.0, Linux 7.2.8 x86_64. No LLM involved.

## Related issues (checked 2026-10-05, see [../README.md](../README.md))
#1036 and #1070 (empty recall with HTTP 200, no cause given), #573 and #571 (closed, clock-drift window).
This report adds a deterministic cause and a reproduction.
