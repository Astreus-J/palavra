# Decisões (registro)

| ID | Decisão | Status | Motivo |
|---|---|---|---|
| D-01 | O ledger SQLite é **cache reconstruível** do Walrus, nunca fonte única | Proposta | Regra oficial: memória armazenada exclusivamente no Walrus. O teste de restore (apagar SQLite → `restore` → estado igual) prova conformidade |
| D-02 | Não usar `analyze`; gravar fato estruturado com `remember` | Aceita | Preserva tipo, id e supersessão |
| D-03 | Estado atual resolvido por código, não por LLM nem por recall puro | Aceita | Determinismo; recall pode voltar vazio |
| D-04 | Canal inicial: Telegram | Aceita | Sem risco de banimento; privacy mode limita ao que é endereçado ao bot |
| D-05 | LLM único: Gemini | A confirmar (modelo exato) | Trilha Beyond the Big Two; Gemini está na lista oficial |
| D-06 | Namespace `grp:<chat_id>` sob uma conta do bot | Aceita | Isolamento é por owner + namespace |
| D-07 | Uma submissão por equipe | Regra oficial | Definir quem submete e qual carteira recebe |
| D-08 | Artigo em inglês (Medium ou Inkray); produto em PT-BR | A confirmar | Júri internacional |
| D-09 | Repositório público novo em `hackatons/palavra/` | A criar | Exigência de repo público; hackmemo não é alterado |
| D-10 | Promo Prize: divulgar em espaços não afiliados a Walrus/Sui | Nova | X e r/sui não contam |
