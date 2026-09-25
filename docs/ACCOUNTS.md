# Accounts and wallets

Public information only. Secrets (delegate key, wallet seed, tokens) live in `.env` or in the
team password manager, never in this repository.

## Walrus Memory account (task HACKATONSU-8)

| Item | Value |
|---|---|
| Network | **Sui mainnet** (relayer `https://relayer.memory.walrus.xyz`, `/config` reports `network: mainnet`) |
| Account ID (`MemWalAccount`) | `0xeefa5f7aced5076820afb284043bc65200295dc888069c6c74cf611d02248547` |
| Owner address | `0xceed0439d0253862902e7f828e71f5a3c605dbf2889b415260daa81436f5f4ee` (created with a Google login, zkLogin, on memory.walrus.xyz) |
| Move package | `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5` |
| Delegate keys registered | 1 (label "Web App", Sui address `0x0911ad12ec5fdbeb53fc4ea205b4b0fe9853414ef1466f39bfee14e35cb4509f`) |
| Account state | active, `admin_quarantined: false` |
| Where the delegate key lives | `MEMWAL_PRIVATE_KEY` in `.env` (server-side only, git-ignored) |

Verify on chain: query the account object with any Sui GraphQL/RPC endpoint, or open it in a Sui explorer.

### Setup check (2026-09-24)
- One real write to namespace `setup-check`: `rememberAndWait` returned in **33.3 s** with
  `blob_id = rl8jl4MpCApFj7mdCHa_KuSDadjKbeB7mQyr58Uj1gM`
  ([Walruscan](https://walruscan.com/mainnet/blob/rl8jl4MpCApFj7mdCHa_KuSDadjKbeB7mQyr58Uj1gM)).
- `recall` returned it on the first attempt (distance 0.230).
- `listNamespaces` shows `setup-check` with 1 memory (345 bytes stored).

### Costs, sponsorship and limits
- **Cost:** the owner address holds **0 SUI and 0 WAL** and the write still succeeded, so at this
  volume the hosted relayer (a public good of the Walrus Foundation) pays for storage and gas.
  This is inferred from the balances, not stated in the docs.
- **Text size limit:** not published, not tested.
- **Rate limit:** enabled on the relayer (`rateLimitDisabled: false`); values are not published.
- **Write latency:** ~26 s (community reports) to 33 s (measured). Reads are immediate.
- **Blobs are immutable:** they cannot be edited or deleted. Keep `MEMWAL_MODE=mock` for development.

### Recommendations
- Register a **second delegate key** for the production server and keep the "Web App" key for
  development, so one can be revoked without touching the other.
- The "agent ID" required at submission is not defined in the rules. We record the account ID
  above; confirm the exact meaning in the submission form.

## Sessions wallet (task HACKATONSU-7)

| Item | Value |
|---|---|
| Address (Sui mainnet) | `0x982907ba2719cfcfcb68cbd6996ce25b03ab9264d66c631e31d33165c52d6f91` |
| Wallet | Slush, created only for the Sessions (not a personal wallet) |
| Purpose | dedicated wallet for the Sessions submission and the prize (WAL-compatible); also the owner of the new Walrus Memory account |
| Seed backup | held by two team members, outside Git, Plane and chat (**to be confirmed**) |
| Receive test | **pending** (balance on 2026-09-25: 0 SUI, 0 WAL) |

The address is public on chain and is the one to give to DeepSurge and the submission form.
