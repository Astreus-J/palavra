// Valida o modelo Gemini na extração de fatos (tarefa HACKATONSU-9, decisão D-05).
// Uso: GEMINI_MODEL=gemini-2.5-flash npx tsx eval/gemini-extraction.ts
import "dotenv/config";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const TODAY = "2026-09-24 (quinta-feira)";
type Tipo = "DECISAO" | "COMPROMISSO" | "ALTERACAO" | "CONCLUSAO" | "NENHUM";
interface Caso { autor: string; msg: string; tipo: Tipo; resp?: string; prazo?: string }

// Casos sintéticos, escritos para cobrir a variedade de linguagem natural de grupos em PT-BR.
const CASOS: Caso[] = [
  { autor: "Maria", msg: "Eu envio o orçamento até sexta", tipo: "COMPROMISSO", resp: "Maria", prazo: "2026-09-25" },
  { autor: "Lucas", msg: "O Pedro vai finalizar o backend até dia 30", tipo: "COMPROMISSO", resp: "Pedro", prazo: "2026-09-30" },
  { autor: "Maria", msg: "Decidimos que a entrega será dia 30/09", tipo: "DECISAO", prazo: "2026-09-30" },
  { autor: "Maria", msg: "Na verdade envio sábado", tipo: "ALTERACAO", resp: "Maria", prazo: "2026-09-26" },
  { autor: "Pedro", msg: "Terminei o backend", tipo: "CONCLUSAO", resp: "Pedro" },
  { autor: "João", msg: "Pessoal, bom dia!", tipo: "NENHUM" },
  { autor: "Lucas", msg: "Fica combinado: reunião segunda às 10h", tipo: "DECISAO", prazo: "2026-09-28" },
  { autor: "João", msg: "Vou mandar a identidade visual amanhã", tipo: "COMPROMISSO", resp: "João", prazo: "2026-09-25" },
  { autor: "Maria", msg: "Adiei pra semana que vem, segunda", tipo: "ALTERACAO", resp: "Maria", prazo: "2026-09-28" },
  { autor: "Maria", msg: "Já enviei o orçamento", tipo: "CONCLUSAO", resp: "Maria" },
  { autor: "Lucas", msg: "Ficou decidido usar Postgres no projeto", tipo: "DECISAO" },
  { autor: "João", msg: "Acho que a gente devia usar React", tipo: "NENHUM" },
  { autor: "Lucas", msg: "A Ana fica responsável pelo design, prazo 02/10", tipo: "COMPROMISSO", resp: "Ana", prazo: "2026-10-02" },
  { autor: "Pedro", msg: "Mudou: o prazo do backend agora é dia 5 de outubro", tipo: "ALTERACAO", resp: "Pedro", prazo: "2026-10-05" },
  { autor: "Ana", msg: "Concluí o design ontem", tipo: "CONCLUSAO", resp: "Ana" },
  { autor: "Maria", msg: "Quem ficou com o orçamento?", tipo: "NENHUM" },
];

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    tipo: { type: SchemaType.STRING, format: "enum", enum: ["DECISAO", "COMPROMISSO", "ALTERACAO", "CONCLUSAO", "NENHUM"] },
    responsavel: { type: SchemaType.STRING, nullable: true },
    tarefa: { type: SchemaType.STRING, nullable: true },
    prazo: { type: SchemaType.STRING, nullable: true, description: "AAAA-MM-DD ou null" },
  },
  required: ["tipo"],
};

const system = `Você extrai fatos de mensagens de um grupo de trabalho em português do Brasil.
Hoje é ${TODAY}. Tipos: DECISAO (decisão do grupo), COMPROMISSO (alguém assume uma tarefa),
ALTERACAO (muda prazo/tarefa já combinada), CONCLUSAO (alguém terminou algo), NENHUM (conversa, opinião ou pergunta).
Quem escreve é o "autor"; "eu" refere-se ao autor. Converta prazos relativos para AAAA-MM-DD. Não invente dados.`;

const model = process.env.GEMINI_MODEL;
if (!model || !process.env.GEMINI_API_KEY) throw new Error("Defina GEMINI_MODEL e GEMINI_API_KEY");
const gm = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
  model, systemInstruction: system,
  generationConfig: { responseMimeType: "application/json", responseSchema: schema as never, temperature: 0 },
});

// 503/429 são transitórios (alta demanda): repete com backoff, como fará o bot em produção.
let retries = 0;
async function gerar(prompt: string): Promise<string> {
  for (let i = 0; ; i++) {
    try { return (await gm.generateContent(prompt)).response.text(); }
    catch (e) {
      if (i >= 5 || !/\[(503|429)/.test(String(e))) throw e;
      retries++; await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}
let erroMostrado = false;
let valido = 0, tipoOk = 0, prazoOk = 0, prazoTotal = 0, respOk = 0, respTotal = 0;
const t0 = Date.now();
for (const c of CASOS) {
  let out: { tipo?: Tipo; responsavel?: string | null; prazo?: string | null } | null = null;
  try { out = JSON.parse(await gerar(`Autor: ${c.autor}\nMensagem: ${c.msg}`)); valido++; } catch (e) { if (!erroMostrado) { console.log("ERRO:", String(e).slice(0, 300)); erroMostrado = true; } }
  const okTipo = out?.tipo === c.tipo; if (okTipo) tipoOk++;
  let okPrazo = "—", okResp = "—";
  if (c.prazo) { prazoTotal++; const ok = out?.prazo === c.prazo; if (ok) prazoOk++; okPrazo = ok ? "ok" : `X (${out?.prazo})`; }
  if (c.resp) { respTotal++; const ok = out?.responsavel === c.resp; if (ok) respOk++; okResp = ok ? "ok" : `X (${out?.responsavel})`; }
  console.log(`${okTipo ? "✔" : "✘"} ${c.tipo.padEnd(11)} obtido=${String(out?.tipo).padEnd(11)} prazo=${okPrazo} resp=${okResp} | ${c.msg}`);
}
const pct = (a: number, b: number) => `${a}/${b} (${Math.round((100 * a) / b)}%)`;
console.log(`\nmodelo=${model} casos=${CASOS.length} retries=${retries} tempo=${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`JSON válido: ${pct(valido, CASOS.length)} | tipo: ${pct(tipoOk, CASOS.length)} | prazo: ${pct(prazoOk, prazoTotal)} | responsável: ${pct(respOk, respTotal)}`);
