# Palavra

> **The group decides. Palavra remembers. Walrus proves it.**

*Palavra* is Portuguese for "word", as in "you have my word".

A group-chat bot that records decisions, commitments, amendments and completions in
[Walrus Memory](https://docs.wal.app/walrus-memory), resolves the **current state in code**
(not with an LLM) and answers with **verifiable receipts** (a link to the blob on Walruscan).

Built by ParaDevs for **Walrus Sessions 8: Chatbots That Remember**
(Sep 18 → Oct 9, 2026, DeepSurge).

> Status: early skeleton. Progress and tasks live on the team's Plane board.

## How it works (summary)
- One namespace per group (`grp:<chat_id>`) under a single Walrus Memory account.
- Structured facts (`DECISION`, `COMMITMENT`, `AMENDMENT`, `COMPLETION`) linked by `supersedes`.
- A local SQLite ledger is a **cache that can be rebuilt from Walrus**, never the only source.
- LLM: Gemini (the "Beyond the Big Two" track), used only to interpret natural language.

Details: [docs/DESIGN.md](docs/DESIGN.md), [docs/FACT-MODEL.md](docs/FACT-MODEL.md), [docs/HACKATHON.md](docs/HACKATHON.md),
[docs/DELIVERABLES.md](docs/DELIVERABLES.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/EXTRACTOR.md](docs/EXTRACTOR.md), [docs/REMINDERS.md](docs/REMINDERS.md).

## Requirements
- Node.js ≥ 22 (`nvm use`); the SQLite driver (`better-sqlite3` 13) requires it

## Setup
```bash
npm install
cp .env.example .env      # fill in the values (see below)
npm run setup:hooks       # enables commit hooks (Conventional Commits, secrets and language checks)
npm test                  # runs offline with MemWalMock
npm run dev
```

### Environment variables (.env)
| Variable | Required | Description |
|---|---|---|
| `MEMWAL_MODE` | no (`mock`) | `mock` runs offline without keys; `real` uses mainnet |
| `MEMWAL_PRIVATE_KEY` | with `real` | Walrus Memory delegate key (server-side only) |
| `MEMWAL_ACCOUNT_ID` | with `real` | account ID of the mainnet account |
| `MEMWAL_SERVER_URL` | no | relayer (official default) |
| `TELEGRAM_BOT_TOKEN` | to run the bot | token from @BotFather |
| `GEMINI_API_KEY` | to run the bot | Google AI Studio key |
| `GEMINI_MODEL` | to run the bot | model name (decision D-05) |
| `GEMINI_FALLBACK_MODEL` | no | backup model for persistent errors or invalid output |
| `DB_PATH` | no | SQLite cache (`./data/palavra.db`) |
| `DEFAULT_TIMEZONE` | no | `America/Sao_Paulo` |
| `WALRUSCAN_BLOB_URL` | no | base URL for proof links |
| `REMINDER_HOUR` | no | hour of the day (0-23) from which deadline reminders are sent (`9`) |
| `LOG_LEVEL` | no | `info` |

## Commands (bot)
`/palavra <text>` record a decision or commitment · `/pending` open commitments ·
`/history <topic>` change history with proofs · `/decisions` current decisions (P1).

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | run with auto-reload |
| `npm run typecheck` | type check |
| `npm test` | tests (node:test) |
| `npm run eval` | 3-arm eval (in progress) |
| `npm run reminder-demo` | live demo of the reminders with a simulated clock (`-- --chat <id>`) |
| `npm run receipt-demo` | live demo of the two-phase receipt in a chat (`-- --chat <id> --real` for mainnet) |
| `npm run restore-test` | delete the SQLite ledger, rebuild it from Walrus and compare the state (`-- --real` for mainnet) |
| `npm run build` / `start` | compile and run `dist/` |

## Layout
```
src/bot/        Telegram: commands, buttons, messages, receipts
src/llm/        Gemini client and fact extraction
src/core/       State Resolver, ledger, outbox, proposals
src/memory/     MemWal wrapper + MemWalMock
src/reminders/  deterministic deadline reminders
eval/           eval scenarios and runner
bugs/           minimal reproductions for the Bug Bounty
docs/           rules, deliverables, decisions, evidence
```

## Contributing
Branching (gitflow), commit conventions and the language policy are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License
[MIT](LICENSE)
