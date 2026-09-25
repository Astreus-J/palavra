import { test } from "node:test";
import assert from "node:assert/strict";
import type { GeminiClient } from "../llm/gemini.js";
import type { Fact } from "../core/fact.js";
import { Ledger } from "../core/ledger.js";
import { PROPOSAL_TTL_MS, ProposalService, ProposalStore, type Proposal } from "../core/proposals.js";
import { handleProposalCallback, inlineKeyboardFor, sendProposal, telegramAdminLookup, toChatUser, type AdminLookup, type CallbackContext } from "./proposals-bot.js";
import { callbackData, renderProposal, texts } from "./messages.js";

const T0 = new Date("2026-09-24T13:00:00Z");
const G = "-100200300";
const MARIA = { id: 1, first_name: "Maria", username: "maria_x" };
const PEDRO = { id: 2, first_name: "Pedro" };
const ANA = { id: 4, first_name: "Ana" };

function setup() {
  const clock = { now: new Date(T0) };
  const ledger = Ledger.open(":memory:");
  const answers: object[] = [];
  const client: GeminiClient = { generate: async () => JSON.stringify(answers.shift()) };
  const service = new ProposalService({
    ledger, proposals: ProposalStore.open(":memory:"), timeZone: "America/Sao_Paulo", now: () => clock.now,
    llm: { client, models: ["m"], sleep: async () => undefined }, newId: () => "0000000a",
  });
  const propose = async (): Promise<Proposal> => {
    answers.push({ type: "COMMITMENT", owner: null, task: "send the budget", due: "2026-09-25" });
    const o = await service.propose({ groupId: G, author: { id: "tg:1", name: "Maria", username: "maria_x", isAdmin: false }, text: "I'll send the budget by Friday", sentAt: T0 });
    assert.equal(o.kind, "proposal");
    return (o as { proposal: Proposal }).proposal;
  };
  return { service, ledger, propose, clock };
}

/** A fake callback context that records what the bot answers and edits. */
function fakeCtx(data: string, from: CallbackContext["from"]) {
  const log = { answers: [] as (string | undefined)[], edits: [] as string[], html: [] as (boolean | undefined)[] };
  const ctx: CallbackContext = { data, chatId: G, messageId: 42, from, answer: async (t) => { log.answers.push(t); }, editMessage: async (t, html) => { log.edits.push(t); log.html.push(html); } };
  return { ctx, log };
}
const notAdmin: AdminLookup = async () => false;
const adminIs = (id: number): AdminLookup => async (_chat, user) => user === `tg:${id}`;

test("a press by the author writes the fact, edits the message and calls the hook", async () => {
  const s = setup();
  const p = await s.propose();
  const written: Fact[] = [];
  const targets: unknown[] = [];
  const { ctx, log } = fakeCtx(callbackData(p.id, "yes"), MARIA);
  await handleProposalCallback(ctx, s.service, notAdmin, { onWritten: (f, _p, target) => { written.push(f); targets.push(target); } });
  assert.deepEqual(log.answers, [texts.written]);
  assert.match(log.edits[0]!, /^✅ Recorded\nMaria committed to send the budget\.[^\n]*\n⏳ Saving to Walrus…$/, "phase one of the receipt is shown at once");
  assert.deepEqual(log.html, [true], "the edit is HTML so the receipt link can be added later");
  assert.equal(written.length, 1);
  assert.deepEqual(targets, [{ chatId: G, messageId: 42, baseHtml: log.edits[0]!.replace("\n⏳ Saving to Walrus…", "") }]);
  assert.equal(s.ledger.entries(G).length, 1);
});

test("a press by someone who may not confirm changes nothing and keeps the buttons", async () => {
  const s = setup();
  const p = await s.propose();
  let hook = 0;
  const { ctx, log } = fakeCtx(callbackData(p.id, "yes"), PEDRO);
  await handleProposalCallback(ctx, s.service, notAdmin, { onWritten: () => { hook++; } });
  assert.deepEqual(log.answers, ["Only Maria or an admin can confirm this"]);
  assert.deepEqual(log.edits, [], "the message (and its buttons) stay");
  assert.equal(hook, 0);
  assert.equal(s.ledger.entries(G).length, 0);
});

test("an admin, looked up through the Telegram lookup, can confirm", async () => {
  const s = setup();
  const p = await s.propose();
  const { ctx } = fakeCtx(callbackData(p.id, "yes"), ANA);
  await handleProposalCallback(ctx, s.service, adminIs(4));
  assert.equal(s.ledger.entries(G).length, 1);
  assert.equal(s.ledger.entries(G)[0]!.fact.author, "tg:1", "the author stays the person who wrote the message");
});

test("if the admin lookup fails, the presser is treated as a regular member", async () => {
  const s = setup();
  const p = await s.propose();
  const { ctx, log } = fakeCtx(callbackData(p.id, "yes"), ANA);
  await handleProposalCallback(ctx, s.service, async () => { throw new Error("telegram down"); });
  assert.equal(s.ledger.entries(G).length, 0);
  assert.match(log.answers[0]!, /Only Maria or an admin/);
});

test("✖ cancels, and a repeated press is reported", async () => {
  const s = setup();
  const p = await s.propose();
  const no = fakeCtx(callbackData(p.id, "no"), MARIA);
  await handleProposalCallback(no.ctx, s.service, notAdmin);
  assert.deepEqual(no.log.edits, [texts.cancelled]);
  const again = fakeCtx(callbackData(p.id, "yes"), MARIA);
  await handleProposalCallback(again.ctx, s.service, notAdmin);
  assert.deepEqual(again.log.answers, [texts.alreadyHandled]);
  assert.equal(s.ledger.entries(G).length, 0);
});

test("A6: an expired proposal is reported and not written", async () => {
  const s = setup();
  const p = await s.propose();
  s.clock.now = new Date(T0.getTime() + PROPOSAL_TTL_MS + 1000);
  const { ctx, log } = fakeCtx(callbackData(p.id, "yes"), MARIA);
  await handleProposalCallback(ctx, s.service, notAdmin);
  assert.deepEqual(log.edits, [texts.expired]);
  assert.equal(s.ledger.entries(G).length, 0);
});

test("garbage callback data and unknown proposals are ignored safely", async () => {
  const s = setup();
  const bad = fakeCtx("hello", MARIA);
  await handleProposalCallback(bad.ctx, s.service, notAdmin);
  assert.deepEqual(bad.log, { answers: [undefined], edits: [], html: [] });
  const unknown = fakeCtx(callbackData("ffffffff", "yes"), MARIA);
  await handleProposalCallback(unknown.ctx, s.service, notAdmin);
  assert.deepEqual(unknown.log.answers, [texts.notFound]);
});

test("an error in a hook is reported through onError and the user gets an apology, not a crash", async () => {
  const s = setup();
  const p = await s.propose();
  const errors: unknown[] = [];
  const { ctx, log } = fakeCtx(callbackData(p.id, "yes"), MARIA);
  await handleProposalCallback(ctx, s.service, notAdmin, { onWritten: () => { throw new Error("outbox exploded"); }, onError: (e) => errors.push(e) });
  assert.equal(errors.length, 1);
  assert.equal(log.answers.at(-1), texts.couldNotUnderstand);
});

test("toChatUser and the Telegram admin lookup", async () => {
  assert.deepEqual(toChatUser(MARIA, false), { id: "tg:1", name: "Maria", username: "maria_x", isAdmin: false });
  assert.deepEqual(toChatUser(PEDRO, true), { id: "tg:2", name: "Pedro", username: null, isAdmin: true });
  const statuses: Record<number, string> = { 1: "creator", 2: "administrator", 3: "member", 4: "left" };
  const lookup = telegramAdminLookup({ getChatMember: (async (_chat: unknown, user: number) => ({ status: statuses[user] })) as never });
  assert.deepEqual(await Promise.all([1, 2, 3, 4].map((u) => lookup(G, `tg:${u}`))), [true, true, false, false]);
});

test("the keyboard has one button per action with the proposal id in the callback data", async () => {
  const s = setup();
  const p = await s.propose();
  const kb = inlineKeyboardFor(p.id, renderProposal(p));
  const buttons = kb.inline_keyboard.flat().map((b) => ("callback_data" in b ? [b.text, b.callback_data] : []));
  assert.deepEqual(buttons, [["✅ Yes", "p:0000000a:y"], ["✖ No", "p:0000000a:n"]]);
});

test("sendProposal replies to the original message with the buttons", async () => {
  const s = setup();
  const p = await s.propose();
  const sent: { chat: unknown; text: string; opts: any }[] = [];
  await sendProposal({ sendMessage: (async (chat: unknown, text: string, opts: unknown) => { sent.push({ chat, text, opts }); }) as never }, G, 77, p);
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text, /^Record this commitment\?/);
  assert.equal(sent[0]!.opts.reply_parameters.message_id, 77);
  assert.equal(sent[0]!.opts.reply_markup.inline_keyboard[0].length, 2);
});
