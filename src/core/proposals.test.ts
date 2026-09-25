import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GeminiClient, GenerateRequest } from "../llm/gemini.js";
import { ExtractionError } from "../llm/extraction.js";
import { renderProposal } from "../bot/messages.js";
import type { Fact } from "./fact.js";
import { Ledger } from "./ledger.js";
import type { ChatUser } from "./owner.js";
import { PROPOSAL_TTL_MS, ProposalService, ProposalStore, type ConfirmOutcome, type Proposal, type ProposeOutcome } from "./proposals.js";
import { pendingItems, resolveState } from "./resolver.js";

const TZ = "America/Sao_Paulo";
const T0 = new Date("2026-09-24T13:00:00Z"); // Thursday 2026-09-24, 10:00 in Sao Paulo (the day of docs/PRODUCT.md)
const G = "-100200300";

const maria: ChatUser = { id: "tg:1", name: "Maria", username: "maria_x", isAdmin: false };
const pedro: ChatUser = { id: "tg:2", name: "Pedro Henrique", username: "pedro_dev", isAdmin: false };
const lucas: ChatUser = { id: "tg:3", name: "Lucas", isAdmin: false };
const ana: ChatUser = { id: "tg:4", name: "Ana", isAdmin: true };

const BUDGET = "c_00000b01", INVOICE = "c_00000b02", BACKEND = "c_00000ba1", LAUNCH = "d_00000d01", BUDGET_V2 = "a_00000a01", BUDGET_DONE = "k_00000f01";

/** Fake Gemini: extraction and candidate-choice answers come from queues, in order. */
class FakeLlm {
  private extractions: object[] = [];
  private choices: string[] = [];
  requests: GenerateRequest[] = [];
  failWith: Error | null = null;
  extract(x: { type: string; owner?: string | null; task?: string | null; due?: string | null }) {
    this.extractions.push({ owner: null, task: null, due: null, ...x });
    return this;
  }
  choose(id: string) {
    this.choices.push(id);
    return this;
  }
  get chooseCalls() { return this.requests.filter((r) => r.prompt.includes("Candidates:")); }
  get extractCalls() { return this.requests.filter((r) => !r.prompt.includes("Candidates:")); }
  client: GeminiClient = {
    generate: async (request) => {
      this.requests.push(request);
      if (this.failWith) throw this.failWith;
      const next = request.prompt.includes("Candidates:") ? { choice: this.choices.shift() } : this.extractions.shift();
      if (next === undefined || (next as { choice?: unknown }).choice === undefined && request.prompt.includes("Candidates:")) throw new Error("the test did not script this call");
      return JSON.stringify(next);
    },
  };
}

function setup(store = ProposalStore.open(":memory:")) {
  const clock = { now: new Date(T0) };
  const ledger = Ledger.open(":memory:");
  const llm = new FakeLlm();
  let n = 0;
  const service = new ProposalService({
    ledger, proposals: store, timeZone: TZ, now: () => clock.now,
    llm: { client: llm.client, models: ["primary"], sleep: async () => undefined },
    newId: () => (++n).toString(16).padStart(8, "0"),
  });
  const advance = (ms: number) => { clock.now = new Date(clock.now.getTime() + ms); };
  const seed = (f: Partial<Fact> & Pick<Fact, "id" | "type">) =>
    ledger.addFact(G, { supersedes: null, author: "tg:1", owner: null, due: null, topic: null, at: "2026-09-23T10:00:00.000Z", text: `text of ${f.id}`, ...f }, T0);
  const state = () => resolveState(ledger.entries(G), { now: clock.now, timeZone: TZ }).items;
  const say = (author: ChatUser, text: string, sentAt = T0) => service.propose({ groupId: G, author, text, sentAt });
  return { service, ledger, llm, clock, advance, seed, state, say, store };
}

const proposal = (o: ProposeOutcome): Proposal => {
  assert.equal(o.kind, "proposal", `expected a proposal, got ${JSON.stringify(o)}`);
  return (o as Extract<ProposeOutcome, { kind: "proposal" }>).proposal;
};
const written = (o: ConfirmOutcome): Fact => {
  assert.equal(o.status, "written", `expected written, got ${o.status}`);
  return (o as Extract<ConfirmOutcome, { status: "written" }>).fact;
};
const seedBudget = (s: ReturnType<typeof setup>) => s.seed({ id: BUDGET, type: "COMMITMENT", owner: "Maria", due: "2026-09-25", text: "Maria committed to send the budget. Due 2026-09-25." });

// ---- A2: anyone can record ---------------------------------------------------------------------

test("A2: a commitment for someone else keeps author and owner apart; nothing is written before the confirmation", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", owner: "Pedro", task: "finish the backend", due: "2026-09-30" });
  const p = proposal(await s.say(lucas, "Pedro will finish the backend by the 30th"));
  assert.equal(p.factType, "COMMITMENT");
  assert.equal(p.draft.owner, "Pedro");
  assert.equal(p.draft.due, "2026-09-30");
  assert.equal(s.ledger.entries(G).length, 0, "the proposal alone writes nothing");
  const fact = written(s.service.confirm(p.id, lucas, "yes"));
  assert.equal(fact.author, "tg:3");
  assert.equal(fact.owner, "Pedro");
  assert.equal(fact.due, "2026-09-30");
  assert.equal(fact.supersedes, null);
  assert.equal(s.ledger.entries(G).length, 1);
});

test("A2: a decision is recorded with its date", async () => {
  const s = setup();
  s.llm.extract({ type: "DECISION", task: "the launch is on October 12", due: "2026-10-12" });
  const p = proposal(await s.say(maria, "We agreed the launch is on October 12"));
  const fact = written(s.service.confirm(p.id, maria, "yes"));
  assert.equal(fact.type, "DECISION");
  assert.equal(fact.due, "2026-10-12");
  assert.equal(s.state()[0]?.status, "active");
});

test("when the author commits for themselves, the owner is the author's name", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", owner: null, task: "send the budget", due: "2026-09-25" });
  assert.equal(proposal(await s.say(maria, "I'll send the budget by Friday")).draft.owner, "Maria");
});

test("chatter is ignored and nothing is stored", async () => {
  const s = setup();
  s.llm.extract({ type: "NONE" });
  assert.deepEqual(await s.say(maria, "good morning everyone"), { kind: "ignored" });
});

// ---- A3: who can press -------------------------------------------------------------------------

test("A3: only the author of the message or an admin can confirm a proposal", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
  const p = proposal(await s.say(maria, "I'll send the budget by Friday"));
  const denied = s.service.confirm(p.id, pedro, "yes");
  assert.deepEqual(denied, { status: "not-allowed", who: "Maria" });
  assert.equal(s.ledger.entries(G).length, 0, "nothing written");
  assert.equal(s.service.confirm(p.id, ana, "yes").status, "written", "an admin can");
});

test("A3: a second press is harmless", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
  const p = proposal(await s.say(maria, "x"));
  assert.equal(s.service.confirm(p.id, maria, "yes").status, "written");
  assert.equal(s.service.confirm(p.id, maria, "yes").status, "already-handled");
  assert.equal(s.ledger.entries(G).length, 1);
});

test("an unknown proposal id is reported, not thrown", () => {
  assert.deepEqual(setup().service.confirm("deadbeef", maria, "yes"), { status: "not-found" });
});

test("✖ cancels: nothing is written and the proposal is closed", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
  const p = proposal(await s.say(maria, "x"));
  assert.equal(s.service.confirm(p.id, maria, "no").status, "cancelled");
  assert.equal(s.ledger.entries(G).length, 0);
  assert.equal(s.service.confirm(p.id, maria, "yes").status, "already-handled");
});

// ---- A4: completion ----------------------------------------------------------------------------

const seedBackend = (s: ReturnType<typeof setup>) => s.seed({ id: BACKEND, type: "COMMITMENT", owner: "Pedro", due: "2026-09-30", author: "tg:3", text: "Pedro committed to finish the backend. Due 2026-09-30." });

test("A4: the owner completes directly (Pedro Henrique matches the owner name Pedro)", async () => {
  const s = setup();
  seedBackend(s);
  s.llm.extract({ type: "COMPLETION", owner: "Pedro", task: "backend" });
  const p = proposal(await s.say(pedro, "I finished the backend"));
  assert.equal(p.kind, "complete");
  assert.equal(p.needsOtherConfirmation, false);
  assert.equal(s.llm.chooseCalls.length, 0, "one candidate: the model is not asked");
  const fact = written(s.service.confirm(p.id, pedro, "yes"));
  assert.equal(fact.type, "COMPLETION");
  assert.equal(fact.supersedes, BACKEND);
  assert.equal(fact.author, "tg:2");
  assert.equal(s.state()[0]?.status, "completed");
  assert.doesNotMatch(fact.text, /Confirmed by/);
});

test("A4: an admin completes directly", async () => {
  const s = setup();
  seedBackend(s);
  s.llm.extract({ type: "COMPLETION", owner: "Pedro", task: "backend" });
  const p = proposal(await s.say(ana, "Pedro finished the backend"));
  assert.equal(p.needsOtherConfirmation, false);
  assert.equal(written(s.service.confirm(p.id, ana, "yes")).author, "tg:4");
});

test("A4: anyone else needs the owner's confirmation; the reporter stays the author", async () => {
  const s = setup();
  seedBackend(s);
  s.llm.extract({ type: "COMPLETION", owner: "Pedro", task: "backend" });
  const p = proposal(await s.say(lucas, "Pedro finished the backend"));
  assert.equal(p.needsOtherConfirmation, true);
  assert.equal(p.confirmerLabel, "Pedro");
  assert.equal(s.ledger.entries(G).length, 1, "nothing written yet (only the seeded commitment)");
  assert.deepEqual(s.service.confirm(p.id, maria, "yes"), { status: "not-allowed", who: "Pedro" });
  assert.deepEqual(s.service.confirm(p.id, lucas, "yes"), { status: "not-allowed", who: "Pedro" }, "the reporter cannot confirm their own report");
  const fact = written(s.service.confirm(p.id, pedro, "yes"));
  assert.equal(fact.author, "tg:3", "the reporter is the author");
  assert.match(fact.text, /Confirmed by Pedro Henrique\.$/);
  assert.equal(s.state()[0]?.status, "completed");
});

test("A4: an admin can confirm on behalf of the owner", async () => {
  const s = setup();
  seedBackend(s);
  s.llm.extract({ type: "COMPLETION", owner: "Pedro", task: "backend" });
  const p = proposal(await s.say(lucas, "Pedro finished the backend"));
  assert.equal(s.service.confirm(p.id, ana, "yes").status, "written");
});

// ---- A5: amendments ----------------------------------------------------------------------------

test("A5: the owner amends directly; only the changed fields are stated and the rest is inherited", async () => {
  const s = setup();
  seedBudget(s);
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", task: "send the budget", due: "2026-09-26" });
  const p = proposal(await s.say(maria, "Actually I'll send it Saturday"));
  assert.equal(p.kind, "amend");
  assert.equal(p.needsOtherConfirmation, false);
  const fact = written(s.service.confirm(p.id, maria, "yes"));
  assert.equal(fact.type, "AMENDMENT");
  assert.equal(fact.supersedes, BUDGET);
  assert.equal(fact.due, "2026-09-26");
  assert.equal(fact.owner, null, "the owner did not change");
  const item = s.state()[0]!;
  assert.equal(item.due, "2026-09-26");
  assert.equal(item.owner, "Maria");
});

test("A5: someone else's amendment needs the owner (or an admin)", async () => {
  const s = setup();
  seedBudget(s);
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", due: "2026-09-28" });
  const p = proposal(await s.say(lucas, "Maria's budget moved to Monday"));
  assert.equal(p.needsOtherConfirmation, true);
  assert.deepEqual(s.service.confirm(p.id, pedro, "yes"), { status: "not-allowed", who: "Maria" });
  assert.equal(s.state()[0]?.due, "2026-09-25", "unchanged until Maria or an admin confirms");
  assert.equal(s.service.confirm(p.id, maria, "yes").status, "written");
  assert.equal(s.state()[0]?.due, "2026-09-28");
});

test("A5: a handover changes the owner and the item moves to the new owner's pending list", async () => {
  const s = setup();
  seedBudget(s);
  seedBackend(s);
  s.llm.extract({ type: "AMENDMENT", owner: "Pedro", task: "budget" }).choose(BUDGET);
  const p = proposal(await s.say(maria, "Pedro takes over the budget"));
  assert.equal(s.llm.chooseCalls.length, 1, "the author's and the stated owner's commitments are both candidates");
  assert.equal(p.targetRootId, BUDGET);
  const fact = written(s.service.confirm(p.id, maria, "yes"));
  assert.equal(fact.owner, "Pedro");
  assert.equal(fact.due, null);
  const item = s.state().find((i) => i.rootId === BUDGET)!;
  assert.equal(item.owner, "Pedro");
  assert.equal(item.due, "2026-09-25", "the due date is inherited");
  assert.deepEqual(pendingItems(s.state()).map((i) => i.owner), ["Pedro", "Pedro"]);
});

test("A5/M6: a decision is amended by anyone, but only its author or an admin confirms", async () => {
  const s = setup();
  s.seed({ id: LAUNCH, type: "DECISION", due: "2026-10-12", author: "tg:3", text: "The group decided the launch is on Monday, 2026-10-12." });
  s.llm.extract({ type: "AMENDMENT", task: "the launch moved to October 15", due: "2026-10-15" });
  const p = proposal(await s.say(maria, "The launch moved to October 15"));
  assert.equal(p.needsOtherConfirmation, true);
  assert.equal(p.confirmerLabel, "The author of this decision");
  assert.equal(s.service.confirm(p.id, maria, "yes").status, "not-allowed", "the proposer is not the decision's author");
  const fact = written(s.service.confirm(p.id, lucas, "yes"));
  assert.equal(fact.supersedes, LAUNCH);
  assert.equal(fact.due, "2026-10-15");
  assert.equal(s.state()[0]?.due, "2026-10-15");
});

test("an amendment supersedes the CURRENT last link of the chain, not the root", async () => {
  const s = setup();
  seedBudget(s);
  s.seed({ id: BUDGET_V2, type: "AMENDMENT", supersedes: BUDGET, due: "2026-09-26", at: "2026-09-23T12:00:00.000Z" });
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", due: "2026-09-28" });
  const p = proposal(await s.say(maria, "make it Monday"));
  assert.equal(written(s.service.confirm(p.id, maria, "yes")).supersedes, BUDGET_V2);
});

// ---- A6: expiry --------------------------------------------------------------------------------

test("A6: a proposal expires after 24 hours and nothing is written", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
  const p = proposal(await s.say(maria, "x"));
  assert.equal(p.expiresAt, new Date(T0.getTime() + PROPOSAL_TTL_MS).toISOString());
  s.advance(PROPOSAL_TTL_MS + 60_000);
  assert.equal(s.service.confirm(p.id, maria, "yes").status, "expired");
  assert.equal(s.ledger.entries(G).length, 0);
  assert.equal(s.store.get(p.id)?.status, "expired");
});

test("A6: just before the limit it still works, and owner-confirmation requests expire the same way", async () => {
  const s = setup();
  seedBackend(s);
  s.llm.extract({ type: "COMPLETION", owner: "Pedro" }).extract({ type: "COMPLETION", owner: "Pedro" });
  const early = proposal(await s.say(lucas, "Pedro finished the backend"));
  const late = proposal(await s.say(lucas, "Pedro finished the backend, again"));
  s.advance(PROPOSAL_TTL_MS - 60_000);
  assert.equal(s.service.confirm(early.id, pedro, "yes").status, "written");
  s.advance(120_000);
  assert.equal(s.service.confirm(late.id, pedro, "yes").status, "expired");
});

test("A6: expireDue closes every pending proposal past its time", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "a", due: null }).extract({ type: "COMMITMENT", task: "b", due: null });
  const a = proposal(await s.say(maria, "a"));
  s.advance(PROPOSAL_TTL_MS / 2);
  const b = proposal(await s.say(maria, "b"));
  s.advance(PROPOSAL_TTL_MS / 2 + 1_000);
  assert.equal(s.store.expireDue(s.clock.now), 1);
  assert.equal(s.store.get(a.id)?.status, "expired");
  assert.equal(s.store.get(b.id)?.status, "pending");
});

test("pending proposals survive a restart (SQLite)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "palavra-proposals-"));
  try {
    const path = join(dir, "p.db");
    const first = setup(ProposalStore.open(path));
    first.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
    const p = proposal(await first.say(maria, "x"));
    first.store.close();
    const second = setup(ProposalStore.open(path));
    assert.equal(second.service.confirm(p.id, maria, "yes").status, "written");
    second.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- M: amendment vs. new commitment -----------------------------------------------------------

test("M1: an amendment proposal offers ✅ Yes, ➕ It's another one and ✖ No", async () => {
  const s = setup();
  seedBudget(s);
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", due: "2026-09-26" });
  const p = proposal(await s.say(maria, "Actually I'll send it Saturday"));
  const r = renderProposal(p);
  assert.deepEqual(r.buttons.map((b) => b.action), ["yes", "other", "no"]);
  assert.match(r.text, /Update ".*": Fri, Sep 25 → Sat, Sep 26\?/);
});

test("M2: a different deliverable of the same owner is a new commitment, not an amendment", async () => {
  const s = setup();
  seedBudget(s);
  s.llm.extract({ type: "COMMITMENT", owner: "Maria", task: "send the invoice", due: "2026-09-25" });
  const p = proposal(await s.say(maria, "I'll also send the invoice by Friday"));
  assert.equal(p.kind, "record");
  const fact = written(s.service.confirm(p.id, maria, "yes"));
  assert.equal(fact.supersedes, null);
  assert.equal(s.state().length, 2);
});

test("M3: with two candidates the model chooses among them, and only among them", async () => {
  const s = setup();
  seedBudget(s);
  s.seed({ id: INVOICE, type: "COMMITMENT", owner: "Maria", due: "2026-09-25", text: "Maria committed to send the invoice. Due 2026-09-25." });
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", task: "invoice", due: "2026-09-28" }).choose(INVOICE);
  const p = proposal(await s.say(maria, "Postponed the invoice to Monday"));
  const ask = s.llm.chooseCalls[0]!;
  assert.match(ask.prompt, new RegExp(BUDGET));
  assert.match(ask.prompt, new RegExp(INVOICE));
  assert.deepEqual((ask.schema as { properties: { choice: { enum: string[] } } }).properties.choice.enum.sort(), [BUDGET, INVOICE, "none"].sort());
  assert.equal(p.targetRootId, INVOICE);
  assert.equal(written(s.service.confirm(p.id, maria, "yes")).supersedes, INVOICE);
  assert.equal(s.state().find((i) => i.rootId === BUDGET)?.due, "2026-09-25", "the other commitment is untouched");
});

test("M3: a model answer of 'none' offers to record a new commitment", async () => {
  const s = setup();
  seedBudget(s);
  s.seed({ id: INVOICE, type: "COMMITMENT", owner: "Maria", due: "2026-09-25" });
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", task: "the report", due: "2026-09-28" }).choose("none");
  assert.equal(proposal(await s.say(maria, "Postponed the report to Monday")).kind, "record-instead");
});

test("M3: no open commitment for the owner: offer a new commitment (nothing to amend)", async () => {
  const s = setup();
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", task: "send the budget", due: "2026-09-26" });
  const p = proposal(await s.say(maria, "Actually I'll send it Saturday"));
  assert.equal(p.kind, "record-instead");
  const r = renderProposal(p);
  assert.match(r.text, /I found no open commitment for Maria\. Record it as a new commitment\?/);
  assert.deepEqual(r.buttons.map((b) => b.action), ["yes", "no"]);
  const fact = written(s.service.confirm(p.id, maria, "yes"));
  assert.equal(fact.type, "COMMITMENT");
  assert.equal(fact.supersedes, null);
});

test("M3: a completed commitment is never a candidate", async () => {
  const s = setup();
  seedBudget(s);
  s.seed({ id: BUDGET_DONE, type: "COMPLETION", supersedes: BUDGET, at: "2026-09-23T15:00:00.000Z" });
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", due: "2026-09-28" });
  assert.equal(proposal(await s.say(maria, "Actually I'll send it Monday")).kind, "record-instead");
});

test("M4: ➕ It's another one records a new commitment that supersedes nothing", async () => {
  const s = setup();
  seedBudget(s);
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", task: "send the budget", due: "2026-09-26" });
  const p = proposal(await s.say(maria, "Actually I'll send it Saturday"));
  const fact = written(s.service.confirm(p.id, maria, "other"));
  assert.equal(fact.type, "COMMITMENT");
  assert.equal(fact.supersedes, null);
  assert.equal(fact.owner, "Maria");
  assert.equal(fact.due, "2026-09-26");
  const items = s.state();
  assert.equal(items.length, 2);
  assert.equal(items.find((i) => i.rootId === BUDGET)?.due, "2026-09-25", "the original is untouched");
});

test("M4: ➕ is only valid on an amendment proposal", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
  const p = proposal(await s.say(maria, "x"));
  assert.equal(s.service.confirm(p.id, maria, "other").status, "invalid-action");
  assert.equal(s.ledger.entries(G).length, 0);
});

test("M5: a completion with no open commitment is not recorded", async () => {
  const s = setup();
  s.llm.extract({ type: "COMPLETION", owner: "Pedro", task: "backend" });
  assert.deepEqual(await s.say(pedro, "Done with the backend"), { kind: "notice", notice: "no-open-commitment", ownerName: "Pedro" });
  assert.equal(s.ledger.entries(G).length, 0);
});

test("M6: a decision is never completed", async () => {
  const s = setup();
  s.seed({ id: LAUNCH, type: "DECISION", due: "2026-10-12", author: "tg:3" });
  s.llm.extract({ type: "COMPLETION", owner: "Lucas", task: "the launch" });
  assert.equal((await s.say(lucas, "The launch is done")).kind, "notice");
  assert.equal(s.state()[0]?.status, "active");
});

// ---- D and T -----------------------------------------------------------------------------------

test("D8: a commitment without a deadline is flagged, and is never overdue", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the logo", due: null });
  const p = proposal(await s.say(maria, "I'll send the logo soon"));
  assert.deepEqual(p.warnings, ["no-deadline"]);
  assert.match(renderProposal(p).text, /No deadline/);
  written(s.service.confirm(p.id, maria, "yes"));
  assert.equal(s.state()[0]?.status, "open");
});

test("D9: a date in the past is flagged, can still be confirmed, and the item is overdue immediately", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the report", due: "2026-09-20" });
  const p = proposal(await s.say(maria, "I'll send the report by 20/09/2026"));
  assert.deepEqual(p.warnings, ["past-date"]);
  assert.match(renderProposal(p).text, /⚠️ This date is in the past/);
  written(s.service.confirm(p.id, maria, "yes"));
  assert.equal(s.state()[0]?.status, "overdue");
});

test("T2: 'today' comes from the message timestamp in the group timezone, not from UTC", async () => {
  const s = setup();
  s.llm.extract({ type: "NONE" }).extract({ type: "NONE" });
  await s.say(maria, "tomorrow", new Date("2026-09-25T02:30:00Z")); // Thu 23:30 local
  await s.say(maria, "tomorrow", new Date("2026-09-25T03:30:00Z")); // Fri 00:30 local
  assert.match(s.llm.extractCalls[0]!.system, /Today is 2026-09-24 \(Thursday\)/);
  assert.match(s.llm.extractCalls[1]!.system, /Today is 2026-09-25 \(Friday\)/);
});

test("T3: a late confirmation does not move the deadline", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
  const p = proposal(await s.say(maria, "tomorrow"));
  s.advance(10 * 60 * 60 * 1000);
  assert.equal(written(s.service.confirm(p.id, maria, "yes")).due, "2026-09-25");
});

// ---- robustness --------------------------------------------------------------------------------

test("if the item was completed before the confirmation, nothing is written", async () => {
  const s = setup();
  seedBudget(s);
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", due: "2026-09-28" });
  const p = proposal(await s.say(maria, "make it Monday"));
  s.seed({ id: BUDGET_DONE, type: "COMPLETION", supersedes: BUDGET, at: "2026-09-24T14:00:00.000Z" });
  const before = s.ledger.entries(G).length;
  const r = s.service.confirm(p.id, maria, "yes");
  assert.deepEqual([r.status, (r as { reason?: string }).reason], ["target-changed", "completed"]);
  assert.equal(s.ledger.entries(G).length, before);
});

test("when the model cannot be reached, the error surfaces and nothing is stored", async () => {
  const s = setup();
  s.llm.failWith = new Error("403 permission denied");
  await assert.rejects(s.say(maria, "x"), ExtractionError);
  assert.equal(s.ledger.entries(G).length, 0);
});

test("a confirmed fact is what the resolver and /pending see, with its own ledger status", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", owner: "Pedro", task: "finish the backend", due: "2026-09-30" });
  const p = proposal(await s.say(lucas, "x"));
  written(s.service.confirm(p.id, lucas, "yes"));
  assert.deepEqual(pendingItems(s.state()).map((i) => [i.owner, i.due]), [["Pedro", "2026-09-30"]]);
  assert.equal(s.ledger.counts().pending, 1, "queued for the outbox");
});
