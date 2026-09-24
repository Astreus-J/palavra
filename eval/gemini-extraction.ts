// Validates a Gemini model on fact extraction (task HACKATONSU-9, decision D-05).
// Usage: GEMINI_MODEL=<model> npx tsx eval/gemini-extraction.ts
// Test messages live in eval/fixtures/ (Portuguese and English chat samples).
import "dotenv/config";
import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

type FactType = "DECISION" | "COMMITMENT" | "AMENDMENT" | "COMPLETION" | "NONE";
interface Case { author: string; msg: string; type: FactType; owner?: string; due?: string }

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/extraction-cases.json", import.meta.url), "utf8")) as { today: string; cases: Case[] };
const CASES = fixtures.cases;

const schema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["DECISION", "COMMITMENT", "AMENDMENT", "COMPLETION", "NONE"] },
    owner: { type: ["string", "null"] },
    task: { type: ["string", "null"] },
    due: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
  },
  required: ["type"],
};

const system = `You extract facts from messages of a work group chat. Messages may be in Portuguese or English.
Today is ${fixtures.today}. Types: DECISION (a group decision), COMMITMENT (someone takes a task),
AMENDMENT (changes a deadline or task that was already agreed), COMPLETION (someone finished something),
NONE (small talk, opinion or question). The person writing is the "author"; "I"/"eu" refers to the author.
Convert relative deadlines to YYYY-MM-DD. Do not invent data.`;

const model = process.env.GEMINI_MODEL;
const apiKey = process.env.GEMINI_API_KEY;
if (!model || !apiKey) throw new Error("Set GEMINI_MODEL and GEMINI_API_KEY");
const MODEL: string = model;
const ai = new GoogleGenAI({ apiKey });

// 503/429 are transient (high demand / quota): retry with backoff, as the bot will in production.
let retries = 0;
async function generate(prompt: string): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0 },
      });
      return res.text ?? "";
    } catch (e) {
      if (i >= 5 || !/\b(503|429)\b/.test(String(e))) throw e;
      retries++;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

let errorShown = false;
let valid = 0, typeOk = 0, dueOk = 0, dueTotal = 0, ownerOk = 0, ownerTotal = 0;
const t0 = Date.now();
for (const c of CASES) {
  let out: { type?: FactType; owner?: string | null; due?: string | null } | null = null;
  try {
    out = JSON.parse(await generate(`Author: ${c.author}\nMessage: ${c.msg}`));
    valid++;
  } catch (e) {
    if (!errorShown) { console.log("ERROR:", String(e).slice(0, 300)); errorShown = true; }
  }
  const okType = out?.type === c.type;
  if (okType) typeOk++;
  let okDue = "-", okOwner = "-";
  if (c.due) { dueTotal++; const ok = out?.due === c.due; if (ok) dueOk++; okDue = ok ? "ok" : `X (${out?.due})`; }
  if (c.owner) { ownerTotal++; const ok = out?.owner === c.owner; if (ok) ownerOk++; okOwner = ok ? "ok" : `X (${out?.owner})`; }
  console.log(`${okType ? "✔" : "✘"} ${c.type.padEnd(11)} got=${String(out?.type).padEnd(11)} due=${okDue} owner=${okOwner} | ${c.msg}`);
}
const pct = (a: number, b: number) => `${a}/${b} (${Math.round((100 * a) / b)}%)`;
console.log(`\nmodel=${model} cases=${CASES.length} retries=${retries} time=${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`valid JSON: ${pct(valid, CASES.length)} | type: ${pct(typeOk, CASES.length)} | due: ${pct(dueOk, dueTotal)} | owner: ${pct(ownerOk, ownerTotal)}`);
