# Decision log

| ID | Decision | Status | Reason |
|---|---|---|---|
| D-01 | The SQLite ledger is a **rebuildable cache** of Walrus, never the only source | Proposed | Official rule: memory stored exclusively on Walrus. The restore test (delete SQLite → `restore` → same state) proves compliance |
| D-02 | Do not use `analyze`; write structured facts with `remember` | Accepted | Preserves type, id and supersession |
| D-03 | Current state is resolved in code, not by an LLM nor by plain recall | Accepted | Determinism; recall can come back empty |
| D-04 | Channel: Telegram first; the core is channel-agnostic so WhatsApp (Baileys) can be added later | Accepted | Bot created (@Palavra_paradevs_bot), privacy mode on. WhatsApp via Baileys carries ban risk and unreliable buttons |
| D-05 | Single LLM: Gemini, model **`gemini-3.8-flash`** (stable, fixed ID, thinking `low`), Gemini API runtime via `@google/genai` SDK (Node), **paid tier** | Accepted | Eligible: official rules list "Google Gemini" without restricting version. Same price as 3.6/3.7 Flash and more capable; supports JSON output via schema; launched Sep 2, 2026, no deprecation date. `gemini-3.5-flash-lite` discarded: cost difference is negligible at our volume and tasks (relative dates, selecting facts to supersede) demand higher quality. Paid tier because free-tier data is used for model training and the bot reads real group messages. Model configurable via `GEMINI_MODEL` for eval comparison |
| D-06 | Namespace `grp:<chat_id>` under one bot account | Accepted | Isolation is per owner + namespace |
| D-07 | One submission per team | Official rule | Define who submits and which wallet receives the prize |
| D-08 | English everywhere in the repository; the bot answers in the user's language | Accepted | International hackathon, public repo (see CONTRIBUTING.md) |
| D-09 | New public repository at `github.com/Astreus-J/palavra` | Done | Public repo is mandatory |
| D-10 | Promo Prize: promote in spaces not affiliated with Walrus/Sui | New | X and r/sui do not count |
| D-11 | English fact types (`DECISION`, `COMMITMENT`, `AMENDMENT`, `COMPLETION`) and English commands (`/palavra`, `/pending`, `/history`, `/decisions`) | Accepted | Follows D-08 |
