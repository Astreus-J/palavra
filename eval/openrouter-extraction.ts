// Validates OpenRouter free models on fact extraction (task HACKATONSU-9, decision D-05).
// Usage:
//   OPENROUTER_MODEL=<model> npx tsx eval/openrouter-extraction.ts   # one model
//   npx tsx eval/openrouter-extraction.ts --all                     # every model in the chain (OPENROUTER_MODELS, or the built-in default)
//
// The account itself (not each model) is capped at 50 free-model requests/day unless $10 in
// credits is added, which raises it to 1000/day (seen live: "Rate limit exceeded:
// free-models-per-day"). A full --all sweep with retries can burn through 50 requests on its own —
// see docs/DECISIONS.md D-05 for the measured numbers from the run that discovered this.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { DEFAULT_OPENROUTER_MODELS } from "../src/config.js";

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
Convert relative deadlines to YYYY-MM-DD. Do not invent data.

Respond with ONLY a valid JSON object matching this schema, no markdown, no explanation:
${JSON.stringify(schema)}`;

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY");

const modelsToRun = process.argv.includes("--all")
  ? (process.env.OPENROUTER_MODELS?.split(",").map((m) => m.trim()).filter(Boolean) ?? [...DEFAULT_OPENROUTER_MODELS])
  : [process.env.OPENROUTER_MODEL ?? (() => { throw new Error("Set OPENROUTER_MODEL, or pass --all"); })()];

// 429/5xx are transient (rate limit / high demand): retry with backoff, as the bot will in production.
// `maxRetries` is lower in --all sweeps (see runModel) so one persistently rate-limited free model
// does not stall the whole sweep for minutes; a single-model run keeps the full production ladder.
async function generate(model: string, prompt: string, maxRetries: number): Promise<string> {
  for (let i = 0; ; i++) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    }
    const body = await response.text().catch(() => "");
    if (i >= maxRetries || !/\b(429|500|502|503|504)\b/.test(String(response.status))) {
      throw new Error(`OpenRouter ${response.status} on ${model}: ${body.slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
}

const CONSECUTIVE_FAILURE_LIMIT = 3;

async function runModel(model: string, maxRetries: number): Promise<void> {
  let errorShown = false;
  let valid = 0, typeOk = 0, dueOk = 0, dueTotal = 0, ownerOk = 0, ownerTotal = 0;
  let consecutiveFailures = 0;
  let skipped = 0;
  const t0 = Date.now();
  for (const c of CASES) {
    let out: { type?: FactType; owner?: string | null; due?: string | null } | null = null;
    try {
      out = JSON.parse(await generate(model, `Author: ${c.author}\nMessage: ${c.msg}`, maxRetries));
      valid++;
      consecutiveFailures = 0;
    } catch (e) {
      if (!errorShown) { console.log(`  ERROR: ${String(e).slice(0, 300)}`); errorShown = true; }
      consecutiveFailures++;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        skipped = CASES.length - CASES.indexOf(c) - 1;
        console.log(`  giving up after ${CONSECUTIVE_FAILURE_LIMIT} consecutive failures, skipping the remaining ${skipped} case(s)`);
        break;
      }
    }
    const okType = out?.type === c.type;
    if (okType) typeOk++;
    if (c.due) { dueTotal++; if (out?.due === c.due) dueOk++; }
    if (c.owner) { ownerTotal++; if (out?.owner === c.owner) ownerOk++; }
  }
  const pct = (a: number, b: number) => `${a}/${b} (${b === 0 ? "-" : Math.round((100 * a) / b)}%)`;
  console.log(`${model}`);
  console.log(`  time=${((Date.now() - t0) / 1000).toFixed(1)}s valid=${pct(valid, CASES.length)} type=${pct(typeOk, CASES.length)} due=${pct(dueOk, dueTotal)} owner=${pct(ownerOk, ownerTotal)}${skipped ? ` (${skipped} skipped)` : ""}`);
}

// --all is a health-check sweep across many models: fail fast (2 retries) so one stuck model does
// not stall the others. A single-model run keeps the full 5-retry production ladder.
const maxRetries = modelsToRun.length > 1 ? 2 : 5;
for (const model of modelsToRun) {
  await runModel(model, maxRetries);
}
