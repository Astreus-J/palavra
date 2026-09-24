# Proposta — Palavra 2.0 (melhorias sobre a página do Plane)

Base: página "Palavra 2.0" (tese: *o grupo decide, o Palavra lembra, o Walrus prova*).
A direção está certa. Esta proposta corrige o que quebraria na implementação e corta
escopo para caber em 16 dias (prazo: 9/out/2026).

## 1. Resumo das mudanças

| # | Mudança | Por quê |
|---|---|---|
| 1 | O estado atual NÃO sai do `recall`; sai de um índice local (SQLite) espelhado no Walrus | recall é assíncrono, pode voltar vazio e tem top-K; estado não pode depender disso |
| 2 | Não usar `analyze`; gravar fato estruturado próprio com `remember` | `analyze` reescreve o texto por LLM e perde tipo, id e vínculo de supersessão |
| 3 | Vínculo de supersessão por id + confirmação com botão inline | "envio sábado" só supersede "sexta" se o sistema souber qual compromisso é |
| 4 | Eval com 3 braços (sem recall / só recall / recall + resolver) | mostra que o resolver ganha do recall puro; é a figura central do artigo |
| 5 | Corte de escopo P0/P1/P2 | `/decisoes` com "Frontend: Maria" exige entidades; fica fora do P0 |
| 6 | Regras de autoria e anti-injeção | qualquer membro do grupo pode escrever "Maria concluiu tudo" |
| 7 | Recibo em duas fases (⏳ → 🔗) | o blob_id só existe quando o job chega a `done` (~26s em relatos públicos) |
| 8 | Corrigir o exemplo da seção 3 | o texto diz "sábado" e a resposta do bot diz "segunda-feira" |

## 2. Arquitetura ajustada

```
Telegram (grupo)  ── comando/menção ──▶  Extrator (Gemini, JSON estruturado)
                                              │
                                    proposta de fato + candidatos
                                              ▼
                               Confirmação (botão inline ✅/✏️)
                                              ▼
                        ┌──────────── Ledger local (SQLite) ────────────┐
                        │  fatos, id, tipo, supersedes, status, blob_id │  ◀── State Resolver
                        └───────────────────────┬───────────────────────┘        (código puro)
                                                │ outbox + retry
                                                ▼
                                   Walrus Memory (rememberAndWait)
                                   namespace grp:<chat_id>  → blob_id
                                                │
              perguntas livres ── recall(sort:"recent") ──▶ Gemini ──▶ resposta + recibos
```

Regras:
- **Fonte de verdade operacional:** ledger local. **Fonte de verdade durável e verificável:**
  Walrus. Se o SQLite for perdido, `restore` + `recall` reconstroem o ledger (documentar
  como teste de recuperação; é ótimo argumento para o artigo).
- **Recall** serve para perguntas em linguagem natural e histórico ("por que mudou?"). O
  **State Resolver** serve para `/decisoes`, `/pendencias` e lembretes. Nunca o LLM.
- **Escrita:** outbox local; job em `pending → uploaded → done`; retry com backoff
  (0.6s, 2s, 3s, como relatado na comunidade). O recibo só aparece quando houver `blob_id`.

## 3. Modelo de fato (o que vai ao Walrus)

Cada fato é uma linha legível (bom para embedding) com cabeçalho parseável:

```
[COMPROMISSO v1] id=c_7f3a supersedes=- autor=tg:123456 resp=Maria prazo=2026-09-26
Maria se comprometeu a enviar o orçamento até sexta-feira, 26/09/2026.
```

Tipos: `DECISAO`, `COMPROMISSO`, `ALTERACAO`, `CONCLUSAO`.
- `ALTERACAO` e `CONCLUSAO` sempre levam `supersedes=<id>` do fato que alteram/fecham.
- `autor` é o id do Telegram de quem escreveu; `resp` é o responsável. Podem diferir.
- Data sempre normalizada em ISO no cabeçalho, com fuso do grupo (padrão America/Sao_Paulo).

**State Resolver (puro, testável):** dado o ledger, para cada cadeia de `supersedes` o
estado atual é o último elo; status = `aberto | vencido | concluído`. Empate de timestamp
desempata por ordem de inserção local, nunca por texto (problema real relatado com tie de
segundos no retorno do recall).

## 4. Como decidir "isso altera aquele compromisso?"

Ponto mais frágil da página. Fluxo proposto:
1. Gemini extrai `{tipo, resp, tarefa, prazo}` da mensagem (saída JSON com schema).
2. Se tipo = alteração/conclusão, o código lista os compromissos abertos daquele `resp` no
   ledger (poucos, filtro simples) e pede ao Gemini só para **escolher entre eles** (ou
   "nenhum").
3. O bot mostra o resultado e pede confirmação por botão:
   `Atualizar "orçamento — sexta" → sábado?  [✅ Sim] [➕ É outro] [✖]`
4. Só depois de ✅ grava. Isso evita supersessão errada e vira material de demo.

## 5. Escopo em prioridades

**P0 (obrigatório para competir):**
- `/palavra <texto>` e menção → registrar decisão/compromisso.
- Alteração e conclusão com supersessão + confirmação.
- `/pendencias` (determinístico) e lembrete de prazo vencido (scheduler no processo).
- `/historico <tema>` com cadeia de mudanças e recibos Walruscan.
- Pergunta livre respondida via recall, citando blobs.
- `npm run eval` (3 braços) e relatório com blobs reais em mainnet.

**P1 (se sobrar tempo):** `/decisoes` (estado geral) usando `DECISAO` com chave de tópico
explícita (`/palavra entrega: 30/09`), sem inferência de entidades.

**P2 (só depois da submissão):** WhatsApp, painel web, múltiplos grupos por usuário.

## 6. Segurança e privacidade (o que a página não cobre)

- Telegram em modo privacidade: o bot só vê comandos e menções. Isso é o que faz o
  "processa só o que é direcionado a ele" valer de verdade. Avisar no grupo, no `/start`,
  que os registros vão para o Walrus e **não podem ser apagados**.
- **Injeção por membro do grupo:** a conclusão só vale se vier de quem é o `resp`, ou de
  admin do grupo, ou com confirmação do `resp` por botão. Todo fato guarda `autor`.
- Memória recuperada entra no prompt em bloco delimitado como dado não confiável
  (padrão já usado por concorrentes; o SDK tem `untrusted-memory` em `/ai`).
- Imutabilidade: nenhum dado sensível do grupo (senhas, documentos) deve ser gravado.
  Filtro simples de padrões antes de gravar e aviso no `/start`.

## 7. Eval (a figura do artigo)

Cenários automatizados, 3 grupos simulados, 2 sessões cada:

| Cenário | Sem recall | Só recall | Recall + resolver |
|---|---|---|---|
| Recuperar compromisso registrado (sessão 2) | falha | ok | ok |
| Compromisso alterado uma vez | — | às vezes devolve o antigo | correto |
| Alterado duas vezes com timestamps próximos | — | ordem instável | correto |
| Compromisso concluído não aparece em pendências | — | erra | correto |
| Recall vazio logo após escrita | — | erra | correto (ledger) |

Métrica: acertos / total por braço. `MemWalMock` para CI; relatório final rodando em
mainnet. O resultado "recall puro erra fatos que mudaram, resolver acerta" é a tese do
artigo e um caso novo diante dos concorrentes, que só medem com/sem recall.

## 8. Bug Bounty (plano ativo, não apenas "possíveis áreas")

Instrumentar o cliente para registrar: latência escrita→`done`, recall vazio pós-escrita,
ordenação com `sort:"recent"` vs `created_at`, efeito de `scoringWeights`, timeouts. Cada
anomalia vira um script mínimo reproduzível em `bugs/NN-titulo/`. Antes de submeter,
conferir as issues já abertas do MemWal para não duplicar.

## 9. Roteiro de demo (3 minutos)

1. Grupo de 3 pessoas. Maria: "/palavra Eu envio o orçamento até sexta".
2. Bot confirma, mostra ⏳ e depois 🔗 (abre o blob no Walruscan).
3. Maria: "Na verdade envio sábado" → botão → estado atualizado; histórico mostra os dois.
4. Reinicia o bot, apaga o SQLite, roda `restore` → o estado volta.
5. Sexta passa (data simulada): lembrete automático.
6. Pergunta livre: "quando o orçamento ficou?" → resposta com recibo.
7. Slide do eval: 3 braços.

## 10. Estrutura do repositório

```
hackatons/palavra/
  src/bot/         telegram, comandos, botões
  src/core/        extrator, state-resolver, ledger (sqlite), outbox
  src/memory/      wrapper MemWal + MemWalMock
  src/reminders/   scheduler determinístico
  eval/            cenários + runner (3 braços)
  bugs/            reproduções mínimas
  docs/            arquitetura, artigo, ledger de blobs
```

## 11. Decisões que dependem de você

1. **Canal:** Telegram primeiro (a página já diz isso). Confirma?
2. **LLM:** Gemini como único modelo (recomendado). Qual modelo exato, para eu checar se
   qualifica em Beyond the Big Two?
3. **Conta MemWal em mainnet:** já existe? Custo em SUI/WAL e eventual conta patrocinada.
4. **Grupos reais:** quem entra nos 3+ usuários? (a equipe ParaDevs do Plane tem 3 membros.)
5. **Idioma do bot:** PT-BR apenas, ou bilíngue para os juízes? Sugestão: PT-BR no produto
   e artigo/README em inglês.

## 12. Próximos passos sugeridos

- Aprovar esta proposta e criar as tarefas no Plane (uma por item P0), se você quiser.
- Criar o esqueleto em `palavra/` com o ledger, o resolver e o eval antes do canal Telegram:
  o eval é o que mais pesa na avaliação e não depende de infraestrutura externa.
