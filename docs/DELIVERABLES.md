# Entregáveis completos — Walrus Sessions 8

Prazo final: **09/10/2026 14:00 UTC (11:00 BRT)**. Meta interna: submeter até 08/10 à noite.

## A. Obrigatórios para ser elegível
- [ ] Cadastro na DeepSurge (nome, descrição, contato, GitHub)
- [ ] Carteira dedicada às Sessions (endereço compatível com WAL)
- [ ] Conta Walrus Memory em **mainnet** + delegate key (guardada só no servidor)
- [ ] Chatbot no ar em **mainnet**, memória exclusivamente no Walrus
- [ ] **≥10 blobs** escritos, com agent ID como prova
- [ ] Acessível a usuários reais por ao menos 1 canal (Telegram)
- [ ] Repositório GitHub **público** com setup reproduzível
- [ ] Documentação da escolha de LLM (modelo + runtime)
- [ ] Formulário de submissão Airtable + submissão na DeepSurge

## B. Por critério de julgamento
1. **Memória genuína:** eval de 3 braços (sem recall / só recall / recall + resolver)
2. **Uso real:** ≥3 pessoas em grupo real por vários dias; transcrições, prints, vídeo de demo, ledger de blobs com links do Walruscan
3. **Build/reprodutibilidade:** README com setup em ≤10 min, `.env.example`, `npm run eval` com `MemWalMock`, docs de arquitetura, CI simples
4. **Artigo:** Medium ou Inkray, em inglês, com antes/depois medido

## C. Por trilha
- **Best Chatbot:** tudo de A e B
- **Beyond the Big Two:** Gemini como único LLM; seção "modelo e runtime" + "atritos de integração" no artigo e no README
- **Best Article:** publicar cedo (até 07/10) para dar tempo de corrigir
- **Promo Prize:** postar em espaço de terceiros (fóruns dev BR, Dev.to, Reddit fora de r/sui e r/walrus, newsletters, Discords não afiliados). **Não** conta X nem canais Walrus/Sui. Link entra no formulário
- **Bug Bounty:** ≥3 issues de qualidade no MemWal, abertas durante o evento (até 09/10), cada uma com reprodução, esperado vs. obtido, ambiente (modelo, runtime, SO, versão do SDK)

## D. Pós-submissão obrigatório
- [ ] Formulário de feedback do Walrus Memory (≥1 bug/atrito e ≥1 ideia)
- [ ] Entrar no Discord da Walrus
- [ ] Compartilhar o artigo no X com @WalrusProtocol e #WalrusMemory
- [ ] 16/10: resultado. Se ganhar, confirmar por e-mail e enviar carteira em até 21 dias

## E. Entregáveis do produto (P0 da proposta)
- [ ] Registro de decisão/compromisso (`/palavra`, menção)
- [ ] Alteração e conclusão com supersessão + confirmação por botão
- [ ] State Resolver (código puro) + ledger local reconstruível do Walrus
- [ ] `/pendencias` + lembretes determinísticos
- [ ] `/historico` com cadeia de mudanças e recibos Walruscan
- [ ] Pergunta livre via recall, citando blobs
- [ ] Recibo em duas fases (⏳ → 🔗)
- [ ] Teste de recuperação: apagar SQLite, `restore`, estado volta
- [ ] `npm run eval` + relatório em mainnet
- [ ] P1: `/decisoes` com chave de tópico explícita

## F. Cronograma (24/09 → 09/10)
| Fase | Datas | Foco |
|---|---|---|
| F0 | 24–25/09 | Docs, Plane, contas, carteira, mainnet, DeepSurge |
| F1 | 25–28/09 | Núcleo: modelo de fato, ledger, resolver, outbox, MemWal wrapper + Mock |
| F2 | 28/09–01/10 | Telegram, comandos, confirmação, recibos, pendências, lembretes |
| F3 | 01–03/10 | Eval 3 braços; teste de restore; deploy estável |
| F4 | 02–07/10 | Uso real em grupo; coleta de evidências; bugs/issues; artigo; promo |
| F5 | 07–08/10 | README final, vídeo, ledger de blobs, submissão |
| Buffer | 09/10 até 14:00 UTC | Só correções |
