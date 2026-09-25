# Deliverables — Walrus Sessions 8

Final deadline: **2026-10-09 14:00 UTC (11:00 BRT)**. Internal goal: submit by the night of Oct 8.

## A. Mandatory for eligibility
- [ ] DeepSurge registration (name, description, contact, GitHub)
- [ ] Wallet dedicated to the Sessions (WAL-compatible address)
- [ ] Walrus Memory account on **mainnet** + delegate key (kept server-side)
- [ ] Chatbot live on **mainnet**, memory stored exclusively on Walrus
- [ ] **≥10 blobs** written, with the agent ID as proof
- [ ] Reachable by real users through at least one channel
- [x] **Public** GitHub repository with reproducible setup: https://github.com/Astreus-J/palavra
- [ ] LLM choice documented (model + runtime)
- [ ] Airtable submission form + DeepSurge submission

## B. Per judging criterion
1. **Genuine memory:** 3-arm eval (no recall / recall only / recall + resolver)
2. **Real usage:** ≥3 people in a real group for several days; transcripts, screenshots, demo video, blob ledger with Walruscan links
3. **Build/reproducibility:** README with setup in ≤10 minutes, `.env.example`, `npm run eval` with `MemWalMock`, architecture docs, CI
4. **Article:** Medium or Inkray, in English, with a measured before/after

## C. Per track
- **Best Chatbot:** everything in A and B
- **Beyond the Big Two:** Gemini as the only LLM; "model and runtime" + "integration friction" sections in the article and README
- **Best Article:** publish early (by Oct 7) to leave time for fixes
- **Promo Prize:** post in third-party spaces (Brazilian dev forums, Dev.to, Reddit outside r/sui and r/walrus, newsletters, unaffiliated Discords). X and Walrus/Sui channels do **not** count. The link goes into the form
- **Bug Bounty:** ≥3 quality issues on MemWal, opened during the event (by Oct 9), each with reproduction, expected vs. actual, environment (model, runtime, OS, SDK version)

## D. Post-submission (required)
- [ ] Walrus Memory feedback form (≥1 bug/friction and ≥1 idea)
- [ ] Join the Walrus Discord
- [ ] Share the article on X with @WalrusProtocol and #WalrusMemory
- [ ] Oct 16: results. If we win, confirm by email and send the wallet within 21 days

## E. Product deliverables (P0 of the design)
- [ ] Record a decision/commitment (`/palavra`, mention)
- [ ] Amendment and completion with supersession + button/reply confirmation
- [ ] State Resolver (pure code) + local ledger rebuildable from Walrus
- [ ] `/pending` + deterministic reminders
- [ ] `/history` with the change chain and Walruscan receipts
- [ ] Free-form question answered through recall, citing blobs
- [ ] Two-phase receipt (⏳ → 🔗)
- [x] Recovery test: delete SQLite, `restore`, state comes back (`npm run restore-test`; evidence in docs/evidence)
- [ ] `npm run eval` + report on mainnet
- [ ] P1: `/decisions` with an explicit topic key

## F. Schedule (Sep 24 → Oct 9)
| Phase | Dates | Focus |
|---|---|---|
| F0 | Sep 24–25 | Docs, board, accounts, wallet, mainnet, DeepSurge |
| F1 | Sep 25–28 | Core: fact model, ledger, resolver, outbox, MemWal wrapper + Mock |
| F2 | Sep 28–Oct 1 | Channel, commands, confirmation, receipts, pending, reminders |
| F3 | Oct 1–3 | 3-arm eval; restore test; stable deploy |
| F4 | Oct 2–7 | Real usage in a group; evidence; bugs/issues; article; promo |
| F5 | Oct 7–8 | Final README, video, blob ledger, submission |
| Buffer | until Oct 9 14:00 UTC | Fixes only |
