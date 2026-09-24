# Palavra

> **O grupo decide. O Palavra lembra. O Walrus prova.**

Bot de Telegram que registra decisões, compromissos, alterações e conclusões de um grupo
em [Walrus Memory](https://docs.wal.app/walrus-memory), resolve o **estado atual** por código
(não por LLM) e responde com **recibos verificáveis** (link do blob no Walruscan).

Projeto da ParaDevs para o hackathon **Walrus Sessions 8: Chatbots That Remember**
(18/09 → 09/10/2026, DeepSurge).

> Status: esqueleto inicial. Progresso e tarefas no Plane (projeto HackatonSui).

## Como funciona (resumo)
- Um namespace por grupo (`grp:<chat_id>`) em uma conta Walrus Memory.
- Fatos estruturados (`DECISAO`, `COMPROMISSO`, `ALTERACAO`, `CONCLUSAO`) ligados por `supersedes`.
- Ledger local SQLite como **cache reconstruível** a partir do Walrus.
- LLM: Gemini (trilha *Beyond the Big Two*), só para interpretar linguagem natural.

Detalhes em [PROPOSTA.md](PROPOSTA.md), [docs/HACKATHON.md](docs/HACKATHON.md),
[docs/DELIVERABLES.md](docs/DELIVERABLES.md) e [docs/DECISIONS.md](docs/DECISIONS.md).

## Requisitos
- Node.js ≥ 20 (`nvm use`)

## Setup
```bash
npm install
cp .env.example .env      # preencha os valores (veja abaixo)
npm run setup:hooks       # ativa os hooks de commit (Conventional Commits + bloqueio de segredos)
npm test                  # roda offline com MemWalMock
npm run dev
```

### Variáveis (.env)
| Variável | Obrigatória | Descrição |
|---|---|---|
| `MEMWAL_MODE` | não (`mock`) | `mock` roda offline sem chaves; `real` usa mainnet |
| `MEMWAL_PRIVATE_KEY` | com `real` | delegate key do Walrus Memory (só no servidor) |
| `MEMWAL_ACCOUNT_ID` | com `real` | account ID da conta em mainnet |
| `MEMWAL_SERVER_URL` | não | relayer (padrão oficial) |
| `TELEGRAM_BOT_TOKEN` | para o bot | token do @BotFather |
| `GEMINI_API_KEY` | para o bot | chave do Google AI Studio |
| `GEMINI_MODEL` | para o bot | modelo (decisão D-05) |
| `DB_PATH` | não | cache SQLite (`./data/palavra.db`) |
| `DEFAULT_TIMEZONE` | não | `America/Sao_Paulo` |
| `WALRUSCAN_BLOB_URL` | não | base do link de prova |
| `LOG_LEVEL` | não | `info` |

## Scripts
| Comando | O que faz |
|---|---|
| `npm run dev` | executa com recarga automática |
| `npm run typecheck` | checagem de tipos |
| `npm test` | testes (node:test) |
| `npm run eval` | eval de 3 braços (em construção) |
| `npm run build` / `start` | compila e roda `dist/` |

## Estrutura
```
src/bot/        Telegram: comandos, botões
src/core/       extrator, State Resolver, ledger, outbox
src/memory/     wrapper MemWal + MemWalMock
src/reminders/  lembretes determinísticos
eval/           cenários e runner do eval
bugs/           reproduções mínimas para o Bug Bounty
docs/           regras, entregáveis, decisões, evidências
```

## Contribuindo
Fluxo de branches (gitflow) e convenções em [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença
[MIT](LICENSE)
