# 03. A replayed nonce is rejected as "wrong private key" (401 with no reason)

**Status:** reproduced on mainnet, 2026-10-05. Low severity, a DX issue; candidate to file only if we are
short of the 3 required reports, or to fold into an existing auth-error issue.

## What happens
The relayer correctly rejects a second request that reuses a nonce (replay protection works). But the 401 has
an **empty body and no `x-auth-error` header**, so the SDK falls back to the generic message "typically wrong
private key, key not registered on this account, account ID mismatch, or staging/mainnet mismatch". A stale
timestamp, in the same situation, gets `x-auth-error: ERR_TIMESTAMP_OUT_OF_BOUNDS` and an actionable message.

```
2) second request, same nonce (a replay):   HTTP 401  x-auth-error=null  body=""   -> "wrong private key..."
3) timestamp 10 min in the past:            HTTP 401  x-auth-error="ERR_TIMESTAMP_OUT_OF_BOUNDS"
```

## Why it matters
Anyone who retries a signed request through a proxy, a queue or a custom transport hits this and is sent to
check credentials that are fine. The relayer already has a machine-readable reason mechanism; the nonce
rejection does not use it. The SDK never reuses a nonce by itself, so only custom transports are affected.

## Expected
`x-auth-error: ERR_NONCE_REUSED` (or similar) and an SDK message that says the nonce was already used.

## Reproduce
```bash
NS=<any namespace> node --env-file=.env bugs/03-replayed-nonce-reported-as-bad-credentials/repro.mjs
```
Read-only. It forces a fixed nonce by overriding `crypto.randomUUID` for two calls.

## Environment
`@mysten-incubation/memwal` 0.1.8, relayer `https://relayer.memory.walrus.xyz` (relayerVersion 0.1.0,
apiVersion 1.0.0), Node v26.10.0, Linux 7.2.8 x86_64. No LLM involved.

## Related issues (checked 2026-10-05, see [../README.md](../README.md))
#696 (closed, 401 with `<no message>`), #980 (401 reported as 503), #573 and #571 (closed, error codes for
clock drift; the nonce case was not covered). Distinct, but in the same area.
