# Palavra — design

Thesis: *the group decides, Palavra remembers, Walrus proves it.*
This document fixes what would break during implementation and cuts scope to fit the
deadline (Oct 9, 2026).

## 1. Key design decisions

| # | Decision | Why |
|---|---|---|
| 1 | The current state does NOT come from `recall`; it comes from a local ledger (SQLite) mirrored to Walrus | recall is asynchronous, can come back empty and is top-K bound; state cannot depend on it |
| 2 | Do not use `analyze`; write our own structured fact with `remember` | `analyze` rewrites text with an LLM and loses type, id and the supersession link |
| 3 | Supersession is linked by id, with inline-button (or reply) confirmation | "I'll send it Saturday" only supersedes "Friday" if the system knows which commitment it is |
| 4 | 3-arm eval (no recall / recall only / recall + resolver) | shows the resolver beats plain recall; it is the central figure of the article |
| 5 | Scope cut into P0/P1/P2 | a generic `/decisions` view needs entities and is not in P0 |
| 6 | Authorship and anti-injection rules | any group member can write "Maria finished everything" |
| 7 | Two-phase receipt (⏳ → 🔗) | the `blob_id` only exists once the job reaches `done` (~26 s in public reports) |

## 2. Architecture

```
Telegram (group) ── command/mention ──▶  Extractor (Gemini, structured JSON)
                                              │
                                    proposed fact + candidates
                                              ▼
                               Confirmation (inline ✅/✏️ buttons)
                                              ▼
                        ┌──────────── Local ledger (SQLite) ────────────┐
                        │  facts, id, type, supersedes, status, blob_id │  ◀── State Resolver
                        └───────────────────────┬───────────────────────┘        (pure code)
                                                │ outbox + retry
                                                ▼
                                   Walrus Memory (rememberAndWait)
                                   namespace grp:<chat_id>  → blob_id
                                                │
              free-form questions ── recall(sort:"recent") ──▶ Gemini ──▶ answer + receipts
```

Rules:
- **Operational source of truth:** the local ledger. **Durable, verifiable source of truth:**
  Walrus. If SQLite is lost, `restore` + `recall` rebuild the ledger (covered by a recovery test).
- **Recall** serves natural-language questions and history ("why did it change?"). The
  **State Resolver** serves `/pending`, `/decisions` and reminders. Never the LLM.
- **Writes:** local outbox; job goes `pending → uploaded → done`; retry with backoff
  (0.6 s, 2 s, 3 s, as reported by the community). A receipt appears only once there is a `blob_id`.

## 3. Fact model (what goes to Walrus)

Each fact is a readable line (good for embeddings) with a parseable header:

```
[COMMITMENT v1] id=c_7f3a supersedes=- author=tg:123456 owner=Maria due=2026-09-26
Maria committed to sending the budget by Friday, 2026-09-26.
```

Types: `DECISION`, `COMMITMENT`, `AMENDMENT`, `COMPLETION`.
- `AMENDMENT` and `COMPLETION` always carry `supersedes=<id>` of the fact they change or close.
- `author` is the Telegram id of who wrote it; `owner` is who is responsible. They may differ.
- Dates are always normalized to ISO in the header, in the group's timezone (default America/Sao_Paulo).

**State Resolver (pure, testable):** for each `supersedes` chain, the current state is the last
link; status is `open | overdue | completed`. Timestamp ties are broken by local insertion
order, never by text (a real problem reported with second-level ties in recall results).

## 4. Deciding "does this amend that commitment?"

1. Gemini extracts `{type, owner, task, due}` from the message (JSON with a schema).
2. If the type is amendment/completion, code lists the open commitments of that `owner` in
   the ledger (few, simple filter) and asks Gemini only to **choose among them** (or "none").
3. The bot shows the result and asks for confirmation:
   `Update "budget — Friday" → Saturday?  [✅ Yes] [➕ It's another one] [✖]`
4. Only after ✅ is it written. This avoids wrong supersession and doubles as demo material.

## 5. Scope by priority

**P0 (required to compete):**
- `/palavra <text>` and mention → record a decision/commitment.
- Amendment and completion with supersession + confirmation.
- `/pending` (deterministic) and overdue reminders (in-process scheduler).
- `/history <topic>` with the change chain and Walruscan receipts.
- Free-form question answered through recall, citing blobs.
- `npm run eval` (3 arms) and a mainnet report with real blobs.

**P1 (if time allows):** `/decisions` (overall state) using `DECISION` with an explicit topic
key (`/palavra delivery: 09/30`), with no entity inference.

**P2 (after submission):** WhatsApp, web dashboard, several groups per user.

## 6. Security and privacy

- Telegram privacy mode: the bot only sees commands and mentions. Announce in the group, on
  `/start`, that records go to Walrus and **cannot be deleted**.
- **Injection by a group member:** a completion only counts if it comes from the `owner`, from
  a group admin, or with the `owner`'s confirmation. Every fact stores `author`.
- Recalled memory enters the prompt in a delimited block as untrusted data (the SDK ships
  `untrusted-memory` under `/ai`).
- Immutability: no sensitive data (passwords, documents) should be written. A simple pattern
  filter runs before writing, plus a notice on `/start`.

## 7. Eval (the article's figure)

Automated scenarios, 3 simulated groups, 2 sessions each:

| Scenario | No recall | Recall only | Recall + resolver |
|---|---|---|---|
| Recover a recorded commitment (session 2) | fails | ok | ok |
| Commitment amended once | — | sometimes returns the old one | correct |
| Amended twice with close timestamps | — | unstable order | correct |
| Completed commitment absent from pending | — | wrong | correct |
| Empty recall right after a write | — | wrong | correct (ledger) |

Metric: hits / total per arm. `MemWalMock` for CI; the final report runs on mainnet. The
result "plain recall misses facts that changed, the resolver gets them right" is the thesis
of the article and new compared with competitors, who only measure with/without recall.

## 8. Bug Bounty (active plan)

Instrument the client to record: write→`done` latency, empty recall after a write, ordering
with `sort:"recent"` vs `created_at`, the effect of `scoringWeights`, and timeouts. Each
anomaly becomes a minimal reproducible script in `bugs/NN-title/`. Before submitting, check
the open MemWal issues to avoid duplicates.

## 9. Demo script (3 minutes)

1. A group of 3 people. Maria: "/palavra I'll send the budget by Friday".
2. The bot confirms, shows ⏳ and then 🔗 (opens the blob on Walruscan).
3. Maria: "Actually I'll send it Saturday" → button → state updated; history shows both.
4. Restart the bot, delete SQLite, run `restore` → the state comes back.
5. Friday passes (simulated date): automatic reminder.
6. Free-form question: "when is the budget due?" → answer with a receipt.
7. Eval slide: 3 arms.

## 10. Repository layout

```
src/bot/         telegram, commands, buttons
src/core/        extractor, state-resolver, ledger (sqlite), outbox
src/memory/      MemWal wrapper + MemWalMock
src/reminders/   deterministic scheduler
eval/            scenarios + runner (3 arms)
bugs/            minimal reproductions
docs/            architecture, article, blob ledger
```

## 11. Open decisions

See `DECISIONS.md` (D-05: exact Gemini model).
