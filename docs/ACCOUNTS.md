# Accounts and wallets

Public information only. Secrets (delegate key, wallet seed, tokens) live in `.env` or in the
team password manager, never in this repository.

## Walrus Memory account (task HACKATONSU-8)

Current account, owned by the dedicated Sessions wallet (see below):

| Item | Value |
|---|---|
| Network | **Sui mainnet** (relayer `https://relayer.memory.walrus.xyz`, `/config` reports `network: mainnet`) |
| Account ID (`MemWalAccount`) | `0x256402a0c90cf613b3c3881c6591d013b595cd7aeb2d27f147f4ae16c1ca92fb` |
| Owner address | `0x982907ba2719cfcfcb68cbd6996ce25b03ab9264d66c631e31d33165c52d6f91` (the Sessions wallet) |
| Created | 2026-09-24 21:39 UTC |
| Move package | `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5` |
| Delegate key registered | 1 (label "Web App", public key `e881dcb16a9228135cb80a778a143ddfa3297f09fe7ee80bbb5023a0361b792e`, Sui address `0x600b3317f819f2ba9e15e077ff0572bc93b2b85e925a7b5507d36371b3f54c1c`) |
| Account state | active, `admin_quarantined: false` |
| Where the delegate key lives | `MEMWAL_PRIVATE_KEY` in `.env` (server-side only, git-ignored) |

Verify on chain: query the account object with any Sui GraphQL/RPC endpoint, or open it in a Sui explorer.

### Setup check (2026-09-25, dedicated account)
- One real write to namespace `setup-check`: `rememberAndWait` returned in **24.3 s** with
  `blob_id = M_nkCl0_CRwctkXPrIpTutNVwG_JqLF0Vl7VSWbfGcw`
  ([Walruscan](https://walruscan.com/mainnet/blob/M_nkCl0_CRwctkXPrIpTutNVwG_JqLF0Vl7VSWbfGcw)).
- `recall` returned it on the first attempt (distance 0.364).
- `listNamespaces` shows `setup-check` with 1 memory (368 bytes stored).

### Previous account (retired)
The first account (`0xeefa5f7a…8547`, owner `0xceed0439…f4ee`, created with a Google login) is
no longer used. It holds one test blob (`rl8jl4MpCApFj7mdCHa_KuSDadjKbeB7mQyr58Uj1gM`) that does **not** count
for the account we submit.

### Costs, sponsorship and limits
- **Cost:** on the previous account the owner held **0 SUI and 0 WAL** and the write still succeeded,
  so the hosted relayer (a public good of the Walrus Foundation) appears to pay for storage and
  gas. This is inferred from the balances, not stated in the docs. Registering a delegate key is a
  transaction signed by the owner wallet.
- **Text size limit:** not published, not tested.
- **Rate limit:** enabled on the relayer (`rateLimitDisabled: false`); values are not published.
- **Write latency:** 24 s to 33 s measured (about 26 s in community reports). Reads are immediate.
- **Blobs are immutable:** they cannot be edited or deleted. Keep `MEMWAL_MODE=mock` for development.

### Known friction
- The relayer accepted a request whose configured `accountId` did not own the delegate key and
  answered with data from the key's own (other) account instead of failing. Candidate for a
  MemWal issue once reproduced with a minimal script.

### Recommendations
- Rotate the delegate key before the public demo (the private key appeared in a screenshot shared
  in a chat during setup), and register a separate key for the production server.
- The "agent ID" required at submission is not defined in the rules. We record the account ID
  above; confirm the exact meaning in the submission form.

## Sessions wallet (task HACKATONSU-7)

| Item | Value |
|---|---|
| Address (Sui mainnet) | `0x982907ba2719cfcfcb68cbd6996ce25b03ab9264d66c631e31d33165c52d6f91` |
| Wallet | Slush, created only for the Sessions (not a personal wallet) |
| Purpose | dedicated wallet for the Sessions submission and the prize (WAL-compatible); owner of the Walrus Memory account above |
| Seed backup | held by two team members, outside Git, Plane and chat (**to be confirmed**) |
| Receive test | **pending** (balance on 2026-09-25: 0 SUI, 0 WAL) |

The address is public on chain and is the one to give to DeepSurge and the submission form.
