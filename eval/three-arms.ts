// 3-arm eval (DESIGN.md §7, task HACKATONSU-25). Scenarios: eval/scenarios.md, Part 1.
//
//   no-recall  the model sees only the question
//   recall     the model sees the question and the recalled memories
//   resolver   the model sees the question, the State Resolver output and the same memories
//
// The memory is the offline MemWalMock (no Walrus writes). The model is one free OpenRouter model,
// called once per question with no fallback: a quota error is reported as "unavailable", not as a miss.
// Usage: OPENROUTER_API_KEY=... npx tsx eval/three-arms.ts [--model <id>] [--report <path>]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { createMemoryStore } from "../src/memory/index.js";
import { groupNamespace } from "../src/memory/store.js";
import { newFactId, serializeFact, type Fact, type FactType } from "../src/core/fact.js";
import { resolveState, type LedgerEntry } from "../src/core/resolver.js";

const TZ = "America/Sao_Paulo";
const ARMS = ["no-recall", "recall", "resolver"] as const;
type Arm = (typeof ARMS)[number];
type Outcome = "hit" | "miss" | "unavailable";

interface RawFact { at: string; type: FactType; id: string; owner?: string; due?: string; supersedes?: string; text: string }
interface Scenario {
  id: string;
  facts: RawFact[];
  ask_at: string;
  question: string;
  answer: string;
  must_include?: string[];
  must_not_include?: string[];
  dates?: string[];
  wrong_dates?: string[];
  expected?: Partial<Record<Arm, string>>;
}

function loadScenarios(): Scenario[] {
  const md = readFileSync(new URL("./scenarios.md", import.meta.url), "utf8");
  const blocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  return blocks.map((b) => parseYaml(b) as Scenario);
}

/** The forms in which a date may appear in an answer (rule of scenarios.md, "How an answer is graded"). */
function dateForms(iso: string): string[] {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const short = months[m - 1]!.slice(0, 3);
  const pad = (n: number) => String(n).padStart(2, "0");
  return [iso, `${short} ${d}`, `${months[m - 1]} ${d}`, `${pad(d)}/${pad(m)}`];
}

function contains(answer: string, value: string): boolean {
  return answer.toLowerCase().includes(value.toLowerCase());
}

/** Hit when every required value and date is present and no forbidden one is. */
export function grade(answer: string, s: Scenario): Outcome {
  const mustOk = (s.must_include ?? []).every((v) => contains(answer, v));
  const datesOk = (s.dates ?? []).every((iso) => dateForms(iso).some((f) => contains(answer, f)));
  const forbiddenValue = (s.must_not_include ?? []).some((v) => contains(answer, v));
  const forbiddenDate = (s.wrong_dates ?? []).some((iso) => dateForms(iso).some((f) => contains(answer, f)));
  return mustOk && datesOk && !forbiddenValue && !forbiddenDate ? "hit" : "miss";
}

async function ask(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2048,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

const SYSTEM = "You answer questions about a group's commitments and decisions. Answer in one or two short English sentences, using only the information provided. If the information is not there, say so.";

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Set OPENROUTER_API_KEY");
  const modelArg = process.argv.indexOf("--model");
  const model = modelArg > -1 ? process.argv[modelArg + 1]! : "dots-studio/dots-3-note-preview:free";
  const reportArg = process.argv.indexOf("--report");
  const reportPath = reportArg > -1 ? process.argv[reportArg + 1]! : null;

  const scenarios = loadScenarios();
  const memory = createMemoryStore({ MEMWAL_MODE: "mock", MEMWAL_SERVER_URL: "https://relayer.memory.walrus.xyz", MEMWAL_PRIVATE_KEY: undefined, MEMWAL_ACCOUNT_ID: undefined });
  const rows: string[] = [];
  const totals: Record<Arm, Record<Outcome, number>> = Object.fromEntries(
    ARMS.map((a) => [a, { hit: 0, miss: 0, unavailable: 0 }]),
  ) as Record<Arm, Record<Outcome, number>>;

  for (const s of scenarios) {
    const groupId = `eval-${s.id}`;
    const ids = new Map<string, string>();
    const entries: LedgerEntry[] = [];
    for (const [seq, raw] of s.facts.entries()) {
      const id = newFactId(raw.type);
      ids.set(raw.id, id);
      const fact: Fact = {
        id, type: raw.type,
        supersedes: raw.supersedes ? (ids.get(raw.supersedes) ?? null) : null,
        author: "tg:0", owner: raw.owner ?? null, due: raw.due ?? null, topic: null, at: raw.at,
        task: raw.type === "COMMITMENT" || raw.type === "DECISION" ? raw.text : null, text: raw.text,
      };
      await memory.remember(groupId, serializeFact(fact));
      entries.push({ fact, seq, createdAt: raw.at });
    }
    const resolution = resolveState(entries, { now: new Date(s.ask_at), timeZone: TZ });
    const state = resolution.items
      .map((i) => `- ${i.kind === "DECISION" ? "Decision" : "Commitment"}: ${i.current.task ?? i.current.text}; owner: ${i.owner ?? "none"}; due: ${i.due ?? "none"}; status: ${i.status}`)
      .join("\n") || "- (no items)";
    const recalled = await memory.recall(groupId, s.question, { sort: "recent", limit: 5 });
    const memories = recalled.map((r) => `- ${r.text}`).join("\n") || "- (no memories found)";

    const prompts: Record<Arm, string> = {
      "no-recall": `Question: ${s.question}`,
      recall: `Memories:\n${memories}\n\nQuestion: ${s.question}`,
      resolver: `Current state (computed from the group's records):\n${state}\n\nMemories:\n${memories}\n\nQuestion: ${s.question}`,
    };
    const cells: string[] = [];
    for (const arm of ARMS) {
      let outcome: Outcome;
      let answer = "";
      try {
        answer = await ask(apiKey, model, SYSTEM, prompts[arm]);
        outcome = grade(answer, s);
      } catch (e) {
        outcome = "unavailable";
        answer = `(${String(e).slice(0, 120)})`;
      }
      totals[arm][outcome]++;
      const expected = s.expected?.[arm] ?? "-";
      cells.push(`| ${s.id} | ${arm} | ${expected} | ${outcome} | ${answer.replace(/\n/g, " ").slice(0, 140)} |`);
      console.log(`${s.id} ${arm.padEnd(10)} expected=${expected.padEnd(9)} got=${outcome.padEnd(11)} ${answer.replace(/\n/g, " ").slice(0, 110)}`);
    }
    rows.push(...cells);
  }

  const summary = ARMS.map((a) => `${a}: ${totals[a].hit} hit / ${totals[a].miss} miss / ${totals[a].unavailable} unavailable`).join("\n");
  console.log(`\n${summary}`);
  if (reportPath) {
    const md = [
      "# 3-arm eval results",
      "",
      `Model: \`${model}\`. Memory: MemWalMock (offline). Timezone: ${TZ}.`,
      "",
      "| Scenario | Arm | Expected | Got | Answer (truncated) |",
      "|---|---|---|---|---|",
      ...rows,
      "",
      "## Totals",
      "",
      ...ARMS.map((a) => `- **${a}**: ${totals[a].hit} hit, ${totals[a].miss} miss, ${totals[a].unavailable} unavailable`),
      "",
    ].join("\n");
    writeFileSync(reportPath, md);
    console.log(`report written to ${reportPath}`);
  }
}

await main();
