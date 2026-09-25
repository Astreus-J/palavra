import { test } from "node:test";
import assert from "node:assert/strict";
import type { GeminiClient, GenerateRequest } from "./gemini.js";
import { isTransientError } from "./gemini.js";
import {
  buildSystemPrompt, chooseCandidate, describeToday, ExtractionError, extractFact, parseChoice, parseExtraction, EXTRACTION_SCHEMA, type Candidate,
} from "./extraction.js";

const ok = (over: object = {}) => JSON.stringify({ type: "COMMITMENT", owner: "Maria", task: "send the budget", due: "2026-09-25", ...over });

/** Fake Gemini client: answers come from a script, one entry per call (a string is a reply, an Error is thrown). */
function scripted(steps: (string | Error)[]) {
  const calls: GenerateRequest[] = [];
  const client: GeminiClient = {
    async generate(request) {
      calls.push(request);
      const step = steps[calls.length - 1];
      if (step === undefined) throw new Error("no more scripted answers");
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return { client, calls };
}
const noSleep = (log: number[] = []) => async (ms: number) => { log.push(ms); };
const transient = () => new Error("503 UNAVAILABLE: This model is currently experiencing high demand");

test("the prompt states today with its weekday and requires YYYY-MM-DD, never a date-time", () => {
  assert.equal(describeToday("2026-09-24"), "2026-09-24 (Thursday)");
  const prompt = buildSystemPrompt("2026-09-24");
  assert.match(prompt, /Today is 2026-09-24 \(Thursday\)/);
  assert.match(prompt, /YYYY-MM-DD/);
  assert.match(prompt, /Never include a time of day/);
  assert.match(prompt, /DD\/MM/, "the numeric date order rule (D5) is stated");
  assert.match(prompt, /FOLLOWING calendar week/, "the next-week rule (D3) is stated");
});

test("the schema constrains `due` to a date pattern", () => {
  assert.equal(EXTRACTION_SCHEMA.properties.due.pattern, "^\\d{4}-\\d{2}-\\d{2}$");
});

test("a valid extraction parses", () => {
  const { extraction, normalizedDateTime } = parseExtraction(ok());
  assert.deepEqual(extraction, { type: "COMMITMENT", owner: "Maria", task: "send the budget", due: "2026-09-25" });
  assert.equal(normalizedDateTime, false);
});

test("a date-time is reduced to its date and flagged", () => {
  const r = parseExtraction(ok({ due: "2026-09-28T10:00:00" }));
  assert.equal(r.extraction.due, "2026-09-28");
  assert.equal(r.normalizedDateTime, true);
});

test("empty strings become null; NONE needs no data", () => {
  assert.deepEqual(parseExtraction(ok({ type: "NONE", owner: "", task: "  ", due: "" })).extraction, { type: "NONE", owner: null, task: null, due: null });
});

test("invalid answers are rejected: bad JSON, unknown type, non-calendar or free-text dates", () => {
  for (const bad of ["not json", "[]", ok({ type: "NOTE" }), ok({ due: "2026-02-30" }), ok({ due: "Friday" }), ok({ due: "25/09/2026" }), JSON.stringify({ type: "COMMITMENT" })]) {
    assert.throws(() => parseExtraction(bad), ExtractionError, bad);
  }
});

test("extractFact returns the validated extraction from the primary model", async () => {
  const { client, calls } = scripted([ok()]);
  const r = await extractFact("I'll send the budget by Friday", "Maria", "2026-09-24", { client, models: ["primary", "backup"] });
  assert.equal(r.value.due, "2026-09-25");
  assert.equal(r.model, "primary");
  assert.equal(r.usedFallback, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.prompt, /Author: Maria\nMessage: I'll send the budget by Friday/);
  assert.match(calls[0]!.system, /Today is 2026-09-24/);
});

test("transient errors are retried on the same model with the 0.6 s, 2 s, 3 s ladder", async () => {
  const waits: number[] = [];
  const { client, calls } = scripted([transient(), transient(), transient(), ok()]);
  const r = await extractFact("x", "Maria", "2026-09-24", { client, models: ["primary"], sleep: noSleep(waits) });
  assert.deepEqual(waits, [600, 2_000, 3_000]);
  assert.equal(calls.length, 4);
  assert.equal(r.calls, 4);
  assert.equal(r.usedFallback, false);
});

test("when the primary keeps failing, the fallback model takes over", async () => {
  const { client, calls } = scripted([transient(), transient(), transient(), transient(), ok({ due: "2026-09-26" })]);
  const r = await extractFact("x", "Maria", "2026-09-24", { client, models: ["primary", "backup"], sleep: noSleep() });
  assert.equal(r.model, "backup");
  assert.equal(r.usedFallback, true);
  assert.equal(r.value.due, "2026-09-26");
  assert.deepEqual(calls.map((c) => c.model), ["primary", "primary", "primary", "primary", "backup"]);
});

test("an invalid answer is not retried on the same model: it moves to the fallback", async () => {
  const { client, calls } = scripted([ok({ due: "Friday" }), ok()]);
  const r = await extractFact("x", "Maria", "2026-09-24", { client, models: ["primary", "backup"], sleep: noSleep() });
  assert.deepEqual(calls.map((c) => c.model), ["primary", "backup"]);
  assert.equal(r.usedFallback, true);
});

test("non-transient errors do not trigger retries", async () => {
  const waits: number[] = [];
  const { client, calls } = scripted([new Error("403 permission denied"), ok()]);
  await extractFact("x", "Maria", "2026-09-24", { client, models: ["primary", "backup"], sleep: noSleep(waits) });
  assert.deepEqual(waits, []);
  assert.equal(calls.length, 2);
});

test("when every model fails, ExtractionError carries all the causes", async () => {
  const { client } = scripted([ok({ due: "soon" }), "garbage"]);
  await assert.rejects(
    extractFact("x", "Maria", "2026-09-24", { client, models: ["primary", "backup"], sleep: noSleep() }),
    (e: unknown) => e instanceof ExtractionError && e.causes.length === 2 && /primary, backup/.test(e.message),
  );
  await assert.rejects(extractFact("x", "Maria", "2026-09-24", { client: scripted([]).client, models: [] }), /no model configured/);
});

test("isTransientError recognises overload, quota and network errors only", () => {
  assert.equal(isTransientError(new Error("[503 Service Unavailable] high demand")), true);
  assert.equal(isTransientError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')), true);
  assert.equal(isTransientError(new Error("fetch failed")), true);
  assert.equal(isTransientError(new Error("403 project denied access")), false);
  assert.equal(isTransientError(new Error("invalid JSON")), false);
});

// ---- candidate choice ----
const candidates: Candidate[] = [
  { id: "c_00000001", description: "Maria: budget, due 2026-09-25" },
  { id: "c_00000002", description: "Maria: invoice, due 2026-09-25" },
];

test("the model may only answer with a candidate id or none", () => {
  assert.equal(parseChoice(JSON.stringify({ choice: "c_00000002" }), candidates), "c_00000002");
  assert.equal(parseChoice(JSON.stringify({ choice: "none" }), candidates), null);
  for (const bad of [JSON.stringify({ choice: "c_deadbeef" }), JSON.stringify({ choice: 3 }), JSON.stringify({}), "nope"]) {
    assert.throws(() => parseChoice(bad, candidates), ExtractionError, bad);
  }
});

test("chooseCandidate sends the candidates, an enum schema, and validates the answer", async () => {
  const { client, calls } = scripted([JSON.stringify({ choice: "c_00000002" })]);
  const r = await chooseCandidate("Postponed the invoice to Monday", "Maria", candidates, { client, models: ["primary"] });
  assert.equal(r.value, "c_00000002");
  assert.match(calls[0]!.prompt, /- c_00000001: Maria: budget/);
  assert.match(calls[0]!.prompt, /- c_00000002: Maria: invoice/);
  assert.deepEqual((calls[0]!.schema as { properties: { choice: { enum: string[] } } }).properties.choice.enum, ["c_00000001", "c_00000002", "none"]);
});

test("a hallucinated id makes chooseCandidate fall back to the next model, then fail", async () => {
  const bad = JSON.stringify({ choice: "c_ffffffff" });
  const { client } = scripted([bad, JSON.stringify({ choice: "c_00000001" })]);
  const r = await chooseCandidate("x", "Maria", candidates, { client, models: ["primary", "backup"], sleep: noSleep() });
  assert.equal(r.value, "c_00000001");
  assert.equal(r.usedFallback, true);
  await assert.rejects(chooseCandidate("x", "Maria", candidates, { client: scripted([bad]).client, models: ["primary"] }), ExtractionError);
});

test("with no candidates there is no model call", async () => {
  const { client, calls } = scripted([]);
  const r = await chooseCandidate("x", "Maria", [], { client, models: ["primary"] });
  assert.equal(r.value, null);
  assert.equal(calls.length, 0);
});
