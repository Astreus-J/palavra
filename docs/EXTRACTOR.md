# Extractor and proposals

How a chat message becomes a fact. The model only interprets language; **code decides everything else**.
Rules come from [PRODUCT.md](PRODUCT.md) (A1-A6, M1-M6, D8-D10, T1-T3).

```
message ─▶ extraction (Gemini, JSON schema) ─▶ proposal (stored, expires in 24 h)
                                                   │  ✅ by an allowed person
                                                   ▼
                                     fact in the ledger ─▶ outbox ─▶ Walrus
```

Nothing reaches the ledger or Walrus until the right person presses ✅.

## Code map
| File | Role |
|---|---|
| `src/llm/gemini.ts` | thin `@google/genai` client; `isTransientError` |
| `src/llm/extraction.ts` | prompt, JSON schema, strict validation, retry + fallback model, candidate choice |
| `src/core/owner.ts` | rule A1: does a Telegram user match an owner name? |
| `src/core/proposals.ts` | `ProposalService.propose` / `confirm`, `ProposalStore` (SQLite, survives restarts) |
| `src/bot/messages.ts` | every user-facing text and the callback data (wording is task HACKATONSU-23) |
| `src/bot/proposals-bot.ts` | Telegram inline buttons and the press handler |

## Extraction
- Output is validated twice: the JSON schema sent to Gemini (`due` constrained to `YYYY-MM-DD`) and a strict parser in code.
- `due` is always a calendar date. A date-time returned by mistake is reduced to its date; anything else that
  is not a real calendar date is rejected.
- The prompt states today's date **with its weekday** (in the group's timezone, from the message time: rule T2)
  and the deadline rules D1-D9.
- **Retry:** transient errors (503, 429, network) are retried on the same model after 0.6 s, 2 s, 3 s.
  **Fallback:** when the primary keeps failing, or answers with something invalid, `GEMINI_FALLBACK_MODEL` takes over.
  When every model fails an `ExtractionError` carries all the causes and nothing is stored.

## Choosing the target of an amendment or completion (M3)
1. Code builds the candidates from the ledger: open or overdue commitments of the stated owner **or** of the author
   (a handover names the new owner, but the item belongs to the author), plus active decisions for amendments.
   Completed commitments are never candidates, and a decision is never completed (M6).
2. One candidate: it is proposed without asking the model. Several: the model must answer with one of the ids or
   `none`; its answer is checked against the list (a made-up id is rejected and the next model is tried).
3. No candidate: an amendment offers to record a new commitment; a completion is not recorded (M5).

## Who can confirm
| Case | Who can press ✅ |
|---|---|
| New decision or commitment | the author of the message, or a group admin (A3) |
| Amendment or completion by the owner or an admin (A4, A5) | the author of the message, or an admin |
| Amendment or completion reported by someone else | the owner, or an admin. The reporter stays the `author` and the text ends with "Confirmed by <owner>." |
| Amendment of a decision | the decision's author, or an admin |

Proposals expire after 24 hours (A6). A double press is harmless. If the item was completed before the
confirmation, nothing is written. An amendment supersedes the **current** last link of the chain.

## Buttons
`✅ Yes` · `➕ It's another one` (amendments by their author only: records a new commitment that supersedes nothing, M4) · `✖ No`.
Callback data is `p:<proposal id>:<y|o|n>` (well under Telegram's 64 bytes).

## Hooks for the rest of the bot
`handleProposalCallback(ctx, service, isAdmin, { onWritten })`: `onWritten` is where the outbox is flushed and where
the two-phase receipt (task HACKATONSU-21) goes. Reading commands and mentions is task HACKATONSU-19.
