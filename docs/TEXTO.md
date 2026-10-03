# Textos e UX das respostas do bot

Textos oficiais da interface do Palavra 2.0 em PT-BR.

## 1. Diretrizes de UX

As mensagens do bot devem ser:

- curtas e diretas;
- claras para quem não conhece a tecnologia;
- naturais em PT-BR;
- consistentes entre os fluxos;
- sem jargões técnicos desnecessários.

O bot deve apresentar o que entendeu antes de registrar uma informação que altera o estado do grupo.

Registros confirmados são permanentes. Alterações e conclusões criam novos registros e preservam o histórico anterior.

---

# 2. Registro

## 2.1 Confirmação de compromisso

> Entendi um compromisso:
>
> **Enviar o orçamento até sexta-feira.**
>
> Responsável: Maria.
>
> Posso registrar?

**Botões:**

- `Registrar`
- `Corrigir`
- `Cancelar`

## 2.2 Confirmação de decisão

> Entendi uma decisão:
>
> **O orçamento será enviado até sexta-feira.**
>
> Posso registrar?

**Botões:**

- `Registrar`
- `Corrigir`
- `Cancelar`

## 2.3 Registro confirmado

> ✅ Registrado.

## 2.4 Registro sendo salvo

> ⏳ Salvando o registro...

## 2.5 Registro salvo

> 🔗 Registro salvo. Ele ficará disponível no histórico do grupo.

## 2.6 Cancelamento

> Registro cancelado.

## 2.7 Correção

> Corrija a informação e envie novamente.

---

# 3. Erros

## 3.1 Não foi possível entender

> Não consegui entender o que deve ser registrado. Tente escrever a decisão ou o compromisso de forma mais direta.

## 3.2 Erro ao salvar

> ⚠️ Não consegui salvar o registro agora. Tente novamente em alguns instantes.

## 3.3 Registro ainda sendo salvo

> ⏳ Ainda estou salvando este registro. Aguarde um momento.

## 3.4 Erro genérico

> ⚠️ Não consegui concluir essa ação agora. Tente novamente.

## 3.5 Informação indisponível

> ⚠️ Não consegui acessar essa informação agora. Tente novamente em alguns instantes.

---

# 4. Alteração

Uma alteração deve apresentar claramente o compromisso identificado e a mudança proposta antes de qualquer novo registro.

## 4.1 Confirmação da alteração

> Entendi uma alteração:
>
> **Enviar o orçamento até sexta-feira → sábado.**
>
> É esse compromisso que você quer alterar?

**Botões:**

- `Sim, alterar`
- `É outro`
- `Cancelar`

## 4.2 Alteração confirmada

> ✅ Alteração registrada.

## 4.3 Alteração sendo salva

> ⏳ Salvando a alteração...

## 4.4 Nenhum compromisso encontrado

> Não encontrei um compromisso em aberto que corresponda a essa alteração.

## 4.5 É outro compromisso

> Certo. Indique qual compromisso você quer alterar.

## 4.6 Cancelamento da alteração

> Alteração cancelada.

## 4.7 Erro ao salvar alteração

> ⚠️ Não consegui salvar a alteração agora. Tente novamente em alguns instantes.

---

# 5. Conclusão

## 5.1 Confirmação da conclusão

> Entendi que este compromisso foi concluído:
>
> **Enviar o orçamento até sábado.**
>
> Posso registrar a conclusão?

**Botões:**

- `Concluir`
- `Corrigir`
- `Cancelar`

## 5.2 Conclusão registrada

> ✅ Compromisso concluído.

## 5.3 Conclusão sendo salva

> ⏳ Salvando a conclusão...

## 5.4 Conclusão cancelada

> Conclusão cancelada.

## 5.5 Nenhum compromisso encontrado

> Não encontrei um compromisso em aberto que corresponda a essa conclusão.

## 5.6 Erro ao salvar conclusão

> ⚠️ Não consegui registrar a conclusão agora. Tente novamente em alguns instantes.

---

# 6. Pendências

## 6.1 Existem pendências

> 📌 Pendências do grupo:
>
> • Enviar o orçamento — Maria — sexta-feira  
> • Revisar contrato — João — segunda-feira

## 6.2 Nenhuma pendência

> Não há pendências no momento.

## 6.3 Pendências atrasadas

> ⚠️ Pendências atrasadas:
>
> • Enviar o orçamento — Maria — sexta-feira  
> • Revisar contrato — João — ontem

---

# 7. Lembretes

## 7.1 Prazo hoje

> 📌 Lembrete: **o prazo de "Enviar o orçamento" é hoje.**
>
> Responsável: Maria.

## 7.2 Prazo vencido

> ⚠️ Prazo vencido: **"Enviar o orçamento".**
>
> Responsável: Maria.

---

# 8. Histórico

## 8.1 Histórico encontrado

> 📜 Histórico de **orçamento**:

Apresentar os registros relevantes em ordem cronológica, deixando clara a alteração entre as versões.

## 8.2 Alteração no histórico

> **Orçamento**
>
> • Sexta-feira — prazo original  
> ↓  
> • Sábado — prazo atualizado

A versão anterior permanece no histórico. A última alteração representa o estado atual.

## 8.3 Nenhum histórico

> Não encontrei registros para esse assunto.

---

# 9. Perguntas em linguagem natural

## 9.1 Informação encontrada

Responder diretamente à pergunta do usuário, utilizando a informação atualmente válida.

Exemplo:

> O orçamento ficou para **sábado**.  
> Responsável: **Maria**.

Quando disponível, incluir o recibo correspondente ao registro.

## 9.2 Informação não encontrada

> Não encontrei essa informação nos registros do grupo.

## 9.3 Memória ainda indisponível

> ⏳ Ainda não consegui acessar essa informação. Tente novamente em alguns instantes.

## 9.4 Erro na consulta

> ⚠️ Não consegui consultar os registros agora. Tente novamente.

---

# 10. Aviso de imutabilidade

## 10.1 Aviso antes do registro

> ⚠️ **Antes de registrar**
>
> O que você confirmar será salvo de forma permanente e não poderá ser apagado depois.
>
> Não registre senhas, documentos ou outras informações sensíveis.

## 10.2 Aviso curto

> ⚠️ Este registro será permanente e não poderá ser apagado depois.

## 10.3 Aviso em alteração

> ⚠️ A alteração será registrada como uma nova versão. O registro anterior continuará no histórico.

---

# 11. Terminologia

Usar consistentemente:

| Conceito | Termo na interface |
|---|---|
| `DECISAO` | decisão |
| `COMPROMISSO` | compromisso |
| `ALTERACAO` | alteração |
| `CONCLUSAO` | conclusão |
| `supersedes` | nova versão / alteração |
| histórico | histórico |
| estado atual | informação atual |
| responsável | responsável |
| registro persistido | registro salvo |

Não exibir normalmente na interface:

- `blob_id`;
- `ledger`;
- `resolver`;
- `recall`;
- `SQLite`;
- `outbox`;
- `supersedes`;
- detalhes internos de persistência.

Esses termos pertencem à implementação e à documentação técnica, não à conversa com o usuário.

---

# 12. Regra geral

Sempre que o bot precisar registrar uma informação que altere o estado do grupo:

1. apresentar o que entendeu;
2. pedir confirmação;
3. registrar somente após confirmação;
4. informar quando estiver salvando;
5. informar quando o registro estiver salvo;
6. manter o histórico quando houver alteração ou conclusão.

O usuário deve conseguir entender o que aconteceu sem conhecer Walrus ou os componentes internos do sistema.