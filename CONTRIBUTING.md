# Contribuindo — Gitflow

Usamos **gitflow** (git-flow AVH). Não commite direto em `main` nem em `develop`.

## Branches
| Branch | Origem | Destino | Uso |
|---|---|---|---|
| `main` | — | — | Sempre estável; cada versão publicada tem tag `vX.Y.Z` |
| `develop` | `main` | — | Integração contínua do que está pronto |
| `feature/<ID>-<slug>` | `develop` | `develop` | Uma tarefa do Plane |
| `release/<X.Y.Z>` | `develop` | `main` + `develop` | Preparar uma versão (ex.: submissão) |
| `hotfix/<slug>` | `main` | `main` + `develop` | Correção urgente em produção |

`<ID>` é o número da tarefa no Plane (projeto HackatonSui), por exemplo
`feature/HACKATONSU-16-state-resolver`.

## Fluxo diário
```bash
git checkout develop && git pull
git flow feature start HACKATONSU-16-state-resolver
# ... commits ...
git flow feature finish HACKATONSU-16-state-resolver    # merge --no-ff em develop
```
Com repositório remoto, prefira abrir um Pull Request de `feature/*` para `develop`
(use `git flow feature publish`) e só então finalizar.

## Release
```bash
git flow release start 0.1.0
# ajustes finais (versão no package.json, README, CHANGELOG)
git flow release finish 0.1.0     # tag v0.1.0, merge em main e develop
```
Para a submissão do hackathon: `release/1.0.0` até 08/10, tag `v1.0.0`.

## Commits
[Conventional Commits](https://www.conventionalcommits.org/): `tipo(escopo): descrição`.
Tipos: `feat fix docs chore refactor test perf ci build style`. Exemplo:
`feat(core): adiciona State Resolver`. Referencie a tarefa no corpo:
`Refs HACKATONSU-16`.

## Hooks (ative uma vez por clone)
```bash
npm run setup:hooks
```
- `commit-msg`: valida Conventional Commits.
- `pre-commit`: bloqueia `.env` e padrões de chave (Sui, Gemini, Telegram, Plane).

## Segredos
Nunca versione `.env`, chaves, seeds ou tokens. Use `.env.example` para documentar variáveis.
Se um segredo vazar, considere-o comprometido e rotacione.

## Antes de finalizar uma feature
- `npm run typecheck` e `npm test` passam.
- Critérios de aceite da tarefa no Plane atendidos.
- Sem segredos nem dados pessoais no diff.
