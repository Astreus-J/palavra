# Walrus Sessions 8 — Chatbots That Remember (regras oficiais)

Fonte: https://thewalrussessions.wal.app/chatbots/index.html (lida em 24/09/2026).
Este documento substitui as suposições de `STRATEGY.md` onde houver divergência.

## Datas
- Início: 18/09/2026 09:00 UTC
- **Fim: 09/10/2026 14:00 UTC (11:00 em Brasília)**
- Resultados: 16/10/2026
- Prêmio: reivindicar com carteira compatível com WAL em até **21 dias** após o anúncio

## Elegibilidade
- 18+ (ou maioridade local); fora de jurisdições sancionadas
- **Uma submissão por pessoa ou equipe**
- Registro obrigatório na plataforma DeepSurge
- Dados do cadastro: nome do projeto, descrição do chatbot (função, público, problema), contato principal, conta GitHub

## Requisitos técnicos (obrigatórios)
- Chatbot funcional integrado ao Walrus Memory
- **Deploy em mainnet, com a memória armazenada exclusivamente no Walrus**
- **Mínimo de 10 blobs escritos na hora da submissão** (informar o agent ID como prova)
- Acessível a usuários reais por ao menos um canal (web, Telegram, Discord, WhatsApp, Slack, CLI)
- Repositório GitHub **público**, com código e instruções de setup
- Documentar qual LLM foi usado

> Atenção ao "exclusivamente no Walrus": o ledger local do Palavra (SQLite) deve ser um
> **cache reconstruível** a partir do Walrus, nunca a fonte única. Ver decisão D-01 em
> `DECISIONS.md`.

## Critérios de julgamento (4)
1. **Genuine Memory Functionality:** a memória entrega valor tangível, não estético? Recupera a informação certa na hora certa?
2. **Real-World Deployment & Impact:** há uso real? O antes/depois convence? A documentação prova melhoria mensurável?
3. **Build Quality & Reproducibility:** integração bem estruturada, documentada e clonável por outro dev?
4. **Article Excellence:** o texto ajuda iniciantes e motiva outros a construir algo parecido? (clareza, candura, utilidade)

Júri indicado pela Walrus Foundation; decisões finais.

## Trilhas e prêmios (pool total: $2.500 em WAL)

| Trilha | Vencedores | Prêmio | Como se concorre |
|---|---|---|---|
| Best Chatbot | 3 | 500 / 250 / 150 | avaliação geral pelos 4 critérios |
| Beyond the Big Two | 2 | 150 cada | LLM principal que não é Anthropic nem OpenAI; documentar modelo e runtime e o atrito de integração. Acumula com Best Chatbot |
| Best Article | 3 | 100 cada | clareza, candura e utilidade para iniciantes |
| **Promo Prize** | 5 | 100 cada | divulgação em espaços de terceiros (subreddits, fóruns, Discords, newsletters, plataformas). **Não vale** X, r/sui, r/walrus nem canais afiliados a Walrus/Sui. Precisa estar público no julgamento |
| Bug Bounty | 5 | 100 cada | issues de qualidade em github.com/MystenLabs/MemWal abertas durante o evento |

Modelos elegíveis em Beyond the Big Two: open-weight locais (Llama, Mistral, Qwen, Gemma,
DeepSeek, Phi via Ollama, LM Studio, llama.cpp, vLLM), provedores alternativos (Google
Gemini, Mistral API, xAI Grok, DeepSeek API, Cohere, Groq, Together, Fireworks,
OpenRouter) e modelos ajustados/customizados.

Padrão de issue do Bug Bounty: passos de reprodução, esperado vs. obtido, ambiente
(modelo, runtime, SO, versão do SDK). Quem escolhe é o time de engenharia da Walrus,
por qualidade e "actionability".

## Processo de submissão
1. Preencher o formulário Airtable: https://airtable.com/appoDAKpC74UOqoDa/shro5iVzzjoWfZlPK
2. Submeter na DeepSurge
3. Informar **carteira dedicada criada para as Sessions**
4. Link do repositório público (código + setup)
5. Documentar a escolha de LLM

## Documentação exigida
- Artigo no **Medium ou Inkray** explicando: o que o chatbot faz, como integra o Walrus Memory, o que mudou de comportamento, evidência de uso real (prints, logs, vídeo ou link vivo)
- **Formulário de feedback do Walrus Memory** com no mínimo 1 bug/atrito e 1 ideia de melhoria
- Issues no GitHub do MemWal
- Entrar no Discord da Walrus
- Compartilhar o artigo no X marcando **@WalrusProtocol** com **#WalrusMemory**

## Links
- Bug bounty / promo-only (WalForm): https://walform.wal.app/f?formId=0x38a736485349b133604c1caf286d669b4b774d16f0a26120ce839cad245baeef
- Issues: https://github.com/MystenLabs/MemWal
- Discord: https://discord.com/invite/walrusprotocol
- Termos: https://docs.wal.app/docs/legal/walrus_general_tos · https://docs.wal.app/docs/legal/privacy
- Docs Walrus Memory: https://docs.wal.app/walrus-memory

## O que a pesquisa anterior tinha errado ou não sabia
- "≥3 usuários com ≥10 memórias cada" **não aparece** nas regras oficiais. O requisito é
  ≥10 blobs no total e uso por usuários reais. Manter os 3 usuários como meta interna
  (é bom para o critério 2), não como exigência.
- Existe a trilha **Promo Prize** (5 × $100), que eu não tinha listado.
- O Bug Bounty pede issues no GitHub da MemWal (não "bug de SEAL" específico) e há
  formulário de feedback obrigatório com pelo menos 1 bug/atrito.
- Não há menção a "produção real" como pré-requisito de prêmio, mas o critério 2 pesa uso real.
