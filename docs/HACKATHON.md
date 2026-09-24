# Walrus Sessions 8 — Chatbots That Remember (official rules)

Source: https://thewalrussessions.wal.app/chatbots/index.html (read on 2026-09-24).
Where this differs from earlier assumptions, this document wins.

## Dates
- Start: 2026-09-18 09:00 UTC
- **End: 2026-10-09 14:00 UTC (11:00 in Brasilia)**
- Results: 2026-10-16
- Prize claim: wallet compatible with WAL within **21 days** after the announcement

## Eligibility
- 18+ (or age of majority locally); not in sanctioned jurisdictions
- **One submission per person or team**
- Registration on the DeepSurge platform is mandatory
- Registration data: project name, chatbot description (function, target users, problem solved), primary contact, GitHub account

## Technical requirements (mandatory)
- Working chatbot integrated with Walrus Memory
- **Deployed on mainnet, with memory stored exclusively on Walrus**
- **At least 10 blobs written at submission time** (provide the agent ID as proof)
- Reachable by real users through at least one channel (web widget, Telegram, Discord, WhatsApp, Slack, CLI)
- **Public** GitHub repository with source code and setup instructions
- Document which LLM was used

> Note on "stored exclusively on Walrus": the local SQLite ledger must be a **rebuildable
> cache** of Walrus, never the only source. See decision D-01 in `DECISIONS.md`.

## Judging criteria (4)
1. **Genuine Memory Functionality** — does memory deliver tangible value rather than aesthetics? Does the bot retrieve the right information at the right time?
2. **Real-World Deployment & Impact** — evidence of real usage; does the before/after convince; does the documentation prove a measurable improvement?
3. **Build Quality & Reproducibility** — is the integration well structured, documented and cloneable by other developers?
4. **Article Excellence** — does the piece help newcomers and motivate others to build similar things (clarity, candor, usefulness)?

The panel is appointed by the Walrus Foundation; decisions are final.

## Tracks and prizes (total pool: $2,500 in WAL)

| Track | Winners | Prize | How to compete |
|---|---|---|---|
| Best Chatbot | 3 | 500 / 250 / 150 | overall evaluation across the 4 criteria |
| Beyond the Big Two | 2 | 150 each | primary LLM that is not Anthropic or OpenAI; document model, runtime and integration friction. Stacks with Best Chatbot |
| Best Article | 3 | 100 each | clarity, candor, usefulness for newcomers |
| **Promo Prize** | 5 | 100 each | promotion in third-party spaces (subreddits, forums, Discords, newsletters, publishing platforms). **Not valid:** X, r/sui, r/walrus or Walrus/Sui-affiliated channels. Must be public at judging time |
| Bug Bounty | 5 | 100 each | quality issues at github.com/MystenLabs/MemWal opened during the event |

Eligible models for Beyond the Big Two: local open-weight models (Llama, Mistral, Qwen, Gemma,
DeepSeek, Phi via Ollama, LM Studio, llama.cpp, vLLM), alternative hosted providers (Google
Gemini, Mistral API, xAI Grok, DeepSeek API, Cohere, Groq, Together, Fireworks, OpenRouter)
and fine-tuned or custom models.

Bug Bounty issue standard: reproduction steps, expected vs. actual behavior, environment
(model, runtime, OS, SDK version). Winners are picked by the Walrus engineering team on quality
and actionability.

## Submission process
1. Fill in the Airtable form: https://airtable.com/appoDAKpC74UOqoDa/shro5iVzzjoWfZlPK
2. Submit on DeepSurge
3. Provide the **dedicated wallet address created for the Sessions**
4. Link the public repository (code + setup)
5. Document the LLM choice

## Required documentation
- Article on **Medium or Inkray** explaining: what the bot does, how it integrates Walrus Memory, what changed in behavior, real-use evidence (screenshots, logs, video or a live link)
- **Walrus Memory feedback form** with at least one bug/friction point and one improvement idea
- Issues on the MemWal GitHub repository
- Join the Walrus Discord
- Share the article on X tagging **@WalrusProtocol** with **#WalrusMemory**

## Links
- Bug bounty / promo-only (WalForm): https://walform.wal.app/f?formId=0x38a736485349b133604c1caf286d669b4b774d16f0a26120ce839cad245baeef
- Issues: https://github.com/MystenLabs/MemWal
- Discord: https://discord.com/invite/walrusprotocol
- Terms: https://docs.wal.app/docs/legal/walrus_general_tos · https://docs.wal.app/docs/legal/privacy
- Walrus Memory docs: https://docs.wal.app/walrus-memory

## Corrections to earlier research
- "≥3 users with ≥10 memories each" is **not** in the official rules. The requirement is ≥10
  blobs in total plus real users. We keep 3 users as an internal goal (good for criterion 2).
- A **Promo Prize** track exists (5 × $100).
- The Bug Bounty asks for GitHub issues on MemWal, and the feedback form is mandatory.
- "Production deployment" is not a prize prerequisite, but criterion 2 rewards real usage.
