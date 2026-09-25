import { test } from "node:test";
import assert from "node:assert/strict";
import { ExtractionError } from "../llm/extraction.js";
import type { Fact } from "../core/fact.js";
import { Ledger } from "../core/ledger.js";
import type { ChatUser } from "../core/owner.js";
import { ProposalService, ProposalStore } from "../core/proposals.js";
import { FakeLlm } from "../test-support/fake-llm.js";
import { handleHistoryPick, handleIncoming, parseCommand, START_TEXT, stripMention, type Incoming, type Reply } from "./commands.js";
import { sendReply, toIncoming } from "./telegram.js";

const BOT = "Palavra_paradevs_bot";
const NOW = new Date("2026-09-24T13:00:00Z"); // Thursday, 10:00 in Sao Paulo
const G = "-100200300";
const PROOF = "https://walruscan.com/mainnet/blob";
const maria: ChatUser = { id: "tg:1", name: "Maria", username: "maria_x", isAdmin: false };

function setup() {
  const ledger = Ledger.open(":memory:");
  const llm = new FakeLlm();
  const service = new ProposalService({
    ledger, proposals: ProposalStore.open(":memory:"), timeZone: "America/Sao_Paulo", now: () => NOW,
    llm: { client: llm.client, models: ["m"], sleep: async () => undefined },
  });
  const deps = { service, ledger, timeZone: "America/Sao_Paulo", botUsername: BOT, proofBaseUrl: PROOF, now: () => NOW };
  const say = (text: string, author = maria, extra: Partial<Incoming> = {}) => handleIncoming(deps, { groupId: G, author, text, sentAt: NOW, ...extra });
  const seed = (f: Partial<Fact> & Pick<Fact, "id" | "type">, group = G) =>
    ledger.addFact(group, { supersedes: null, author: "tg:1", owner: null, due: null, topic: null, task: null, at: "2026-09-22T12:00:00.000Z", text: `text of ${f.id}`, ...f }, NOW).row;
  return { ledger, llm, say, seed, deps };
}
/** Telegram HTML allows only a few tags, and any other "<" or "&" makes sendMessage fail with a 400. */
function assertTelegramHtml(html: string): void {
  const withoutTags = html.replace(/<\/?(b|i|u|code|pre)>/g, "").replace(/<a href="[^"<>]*">/g, "").replace(/<\/a>/g, "");
  assert.doesNotMatch(withoutTags, /[<>]/, `unescaped angle bracket in: ${html}`);
  assert.doesNotMatch(withoutTags, /&(?!(amp|lt|gt|quot);)/, `unescaped ampersand in: ${html}`);
  const opens = (html.match(/<(b|i|u|code|pre|a)[ >]/g) ?? []).length;
  const closes = (html.match(/<\/(b|i|u|code|pre|a)>/g) ?? []).length;
  assert.equal(opens, closes, `unbalanced tags in: ${html}`);
}

const textOf = (r: Reply[]): string => {
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "text");
  return (r[0] as Extract<Reply, { kind: "text" }>).text;
};

// ---- parsing ----------------------------------------------------------------------------------

test("parseCommand: plain, with the bot's name, with arguments; other bots and non-commands are not ours", () => {
  assert.deepEqual(parseCommand("/start", BOT), { command: "start", args: "" });
  assert.deepEqual(parseCommand("/palavra I'll send the budget", BOT), { command: "palavra", args: "I'll send the budget" });
  assert.deepEqual(parseCommand("/Pending@palavra_paradevs_bot", BOT), { command: "pending", args: "" });
  assert.deepEqual(parseCommand("/history   budget  ", BOT), { command: "history", args: "budget" });
  assert.deepEqual(parseCommand("/palavra line one\nline two", BOT), { command: "palavra", args: "line one\nline two" });
  assert.equal(parseCommand("/pending@some_other_bot", BOT), null);
  assert.equal(parseCommand("good morning", BOT), null);
  assert.equal(parseCommand("see /pending", BOT), null, "a command must start the message");
});

test("stripMention finds the bot by entity or by text, ignoring case and other bots", () => {
  const text = "@Palavra_paradevs_bot actually I'll send it Saturday";
  assert.equal(stripMention(text, BOT, [{ type: "mention", offset: 0, length: 21 }]), "actually I'll send it Saturday");
  assert.equal(stripMention("hey @palavra_paradevs_bot done with the backend", BOT), "hey done with the backend");
  assert.equal(stripMention("hey @someone_else", BOT), null);
  assert.equal(stripMention("hey @Palavra_paradevs_bot2 hi", BOT), null, "a different handle that merely starts the same");
  assert.equal(stripMention("@Palavra_paradevs_bot", BOT), "");
});

// ---- ignoring ---------------------------------------------------------------------------------

test("messages without a command or a mention are ignored (no model call, nothing stored)", async () => {
  const s = setup();
  for (const chatter of ["good morning everyone", "I'll send the budget by Friday", "see you at 10", "@someone_else look at this"]) {
    assert.deepEqual(await s.say(chatter), [], chatter);
  }
  assert.equal(s.llm.requests.length, 0);
  assert.equal(s.ledger.entries(G).length, 0);
});

test("unknown commands and commands for another bot are ignored", async () => {
  const s = setup();
  assert.deepEqual(await s.say("/settings"), []);
  assert.deepEqual(await s.say("/pending@some_other_bot"), []);
});

// ---- /start -----------------------------------------------------------------------------------

test("/start says records go to Walrus and cannot be deleted, and that only commands and mentions are read", async () => {
  const s = setup();
  const [reply] = await s.say("/start");
  assert.equal(reply!.kind, "text");
  const t = (reply as Extract<Reply, { kind: "text" }>).text;
  assert.match(t, /written to Walrus/);
  assert.match(t, /cannot be edited or deleted/);
  assert.match(t, /only read messages that start with a command or mention me/);
  assert.match(t, /@Palavra_paradevs_bot/, "the bot's own name replaces the placeholder");
  assert.ok((reply as { html?: boolean }).html);
  assert.equal(textOf(await s.say("/help")), textOf(await s.say("/start")));
  assert.match(START_TEXT, /\/pending/);
});

test("/start teaches by example: every kind of record, both languages, and that ✅ saves", async () => {
  const t = textOf(await setup().say("/start"));
  assert.match(t, /How to record something/);
  assert.match(t, /\/palavra I'll send the budget by Friday {2}\(a commitment\)/);
  assert.match(t, /Pedro will finish the backend by the 30th {2}\(a commitment for someone else\)/);
  assert.match(t, /We decided the launch is on October 12 {2}\(a decision\)/);
  assert.match(t, /actually I'll send it Saturday {2}\(changes a deadline\)/);
  assert.match(t, /I finished the budget {2}\(marks it as done\)/);
  assert.match(t, /English or Portuguese/);
  assert.match(t, /nothing is saved until you tap ✅/);
  assert.match(t, /\/history: pick an item/);
});

// ---- /palavra and mentions --------------------------------------------------------------------

test("/palavra <text> produces a proposal and writes nothing", async () => {
  const s = setup();
  s.llm.extract({ type: "COMMITMENT", task: "send the budget", due: "2026-09-25" });
  const [r] = await s.say("/palavra I'll send the budget by Friday");
  assert.equal(r!.kind, "proposal");
  assert.equal((r as Extract<Reply, { kind: "proposal" }>).proposal.draft.owner, "Maria");
  assert.equal(s.ledger.entries(G).length, 0);
  assert.match(s.llm.requests[0]!.prompt, /Message: I'll send the budget by Friday$/, "the command itself is not sent to the model");
});

test("a mention works like /palavra, with the mention removed from the text", async () => {
  const s = setup();
  s.llm.extract({ type: "AMENDMENT", owner: "Maria", due: "2026-09-26" });
  const [r] = await s.say("@Palavra_paradevs_bot actually I'll send it Saturday", maria, { entities: [{ type: "mention", offset: 0, length: 21 }] });
  assert.equal(r!.kind, "proposal");
  assert.match(s.llm.requests[0]!.prompt, /Message: actually I'll send it Saturday$/);
});

test("/palavra and a bare mention with no text explain how to use them", async () => {
  const s = setup();
  for (const bare of ["/palavra", "@Palavra_paradevs_bot"]) {
    const t = textOf(await s.say(bare));
    assert.match(t, /Examples:/);
    assert.match(t, /\/palavra I'll send the budget by Friday/);
    assert.match(t, /\/palavra We decided the launch is on October 12/);
    assert.match(t, /English or Portuguese/);
  }
  assert.equal(s.llm.requests.length, 0);
});

test("a message with nothing to record gets a short answer", async () => {
  const s = setup();
  s.llm.extract({ type: "NONE" });
  const t = textOf(await s.say("/palavra good morning"));
  assert.match(t, /couldn't find a decision, a commitment, a change or a completion/);
  assert.match(t, /Try a full sentence, for example: \/palavra I'll send the budget by Friday/);
});

test("M5: a completion with no open commitment is answered, not recorded", async () => {
  const s = setup();
  s.llm.extract({ type: "COMPLETION", owner: "Pedro", task: "backend" });
  assert.equal(textOf(await s.say("/palavra Pedro finished the backend")), "I found no open commitment for Pedro.");
  assert.equal(s.ledger.entries(G).length, 0);
});

test("if the model cannot be reached the user gets an apology; other errors are not swallowed", async () => {
  const s = setup();
  s.llm.failWith = new Error("403 permission denied");
  const quotaErr = new ExtractionError("out of quota", [new Error("429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel-FreeTier")]);
  const outOfQuota = { ...s.deps, service: { propose: async () => { throw quotaErr; } } as unknown as ProposalService };
  const quotaReply = await handleIncoming(outOfQuota, { groupId: G, author: maria, text: "/palavra x", sentAt: NOW });
  assert.match((quotaReply[0] as { text: string }).text, /reached my daily limit of AI requests/, "the user is told why");
  const seen: ExtractionError[] = [];
  const logged = { ...s.deps, onExtractionError: (e: ExtractionError) => seen.push(e) };
  const reply = await handleIncoming(logged, { groupId: G, author: maria, text: "/palavra x", sentAt: NOW });
  assert.match((reply[0] as { text: string }).text, /couldn't process that message/);
  assert.equal(seen.length, 1, "the failure is reported for the logs");
  assert.match(String(seen[0]!.causes[0]), /permission denied/);
  const stub = { ...s.deps, service: { propose: async () => { throw new TypeError("bug"); } } as unknown as ProposalService };
  await assert.rejects(handleIncoming(stub, { groupId: G, author: maria, text: "/palavra x", sentAt: NOW }), TypeError);
  assert.ok(new ExtractionError("x") instanceof Error);
});

// ---- /pending ---------------------------------------------------------------------------------

test("/pending with nothing open", async () => {
  assert.equal(textOf(await setup().say("/pending")), "No open commitments. ✅");
});

test("/pending lists overdue first and highlighted, then the open ones, from the State Resolver", async () => {
  const s = setup();
  s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "Maria", due: "2026-09-26", task: "send the budget" });
  s.seed({ id: "c_00000002", type: "COMMITMENT", owner: "Pedro", due: "2026-09-23", task: "finish the backend" });
  s.seed({ id: "c_00000003", type: "COMMITMENT", owner: "Ana", due: null, task: "pick a logo" });
  s.seed({ id: "c_00000004", type: "COMMITMENT", owner: "Joao", due: "2026-09-25", task: "deliver the identity" });
  s.seed({ id: "k_00000005", type: "COMPLETION", supersedes: "c_00000004", at: "2026-09-23T09:00:00.000Z" });
  s.seed({ id: "d_00000006", type: "DECISION", due: "2026-10-12", task: "launch date" });
  assert.equal(
    textOf(await s.say("/pending")),
    [
      "<b>🔴 Overdue (1):</b>",
      "• Pedro — finish the backend — was due Wed, Sep 23",
      "",
      "<b>Pending (2):</b>",
      "• Maria — send the budget — due Sat, Sep 26",
      "• Ana — pick a logo — no deadline",
    ].join("\n"),
  );
});

test("/pending follows amendments and drops completed items", async () => {
  const s = setup();
  s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "Maria", due: "2026-09-23", task: "send the budget" });
  s.seed({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-28", at: "2026-09-23T15:00:00.000Z" });
  assert.match(textOf(await s.say("/pending")), /Maria — send the budget — due Mon, Sep 28/);
  assert.doesNotMatch(textOf(await s.say("/pending")), /Overdue/);
  s.seed({ id: "k_00000003", type: "COMPLETION", supersedes: "a_00000002", at: "2026-09-24T09:00:00.000Z" });
  assert.equal(textOf(await s.say("/pending")), "No open commitments. ✅");
});

test("/pending is per group and escapes HTML in user text", async () => {
  const s = setup();
  s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "A&B", due: "2026-09-26", task: "fix <b>bold</b> bug" });
  s.seed({ id: "c_00000009", type: "COMMITMENT", owner: "Other", due: "2026-09-26", task: "elsewhere" }, "-999");
  const t = textOf(await s.say("/pending"));
  assert.match(t, /A&amp;B — fix &lt;b&gt;bold&lt;\/b&gt; bug/);
  assert.doesNotMatch(t, /elsewhere/);
});

test("/pending truncates very long lists", async () => {
  const s = setup();
  for (let i = 1; i <= 30; i++) s.seed({ id: `c_${i.toString(16).padStart(8, "0")}`, type: "COMMITMENT", owner: "Maria", due: "2026-09-30", task: `task ${i}` });
  const t = textOf(await s.say("/pending"));
  assert.match(t, /Pending \(30\)/);
  assert.match(t, /…and 5 more/);
  assert.ok(t.length < 4096);
});

test("/pending falls back to the sentence for facts written before `task` existed", async () => {
  const s = setup();
  s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "Maria", due: "2026-09-26", text: "Maria will send the budget." });
  assert.match(textOf(await s.say("/pending")), /Maria — Maria will send the budget\. — due/);
});

// ---- /history ---------------------------------------------------------------------------------

function seedBudgetChain(s: ReturnType<typeof setup>) {
  const root = s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "Maria", due: "2026-09-25", task: "send the budget", at: "2026-09-22T12:00:00.000Z" });
  s.seed({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-26", at: "2026-09-23T15:00:00.000Z" });
  return root;
}

test("/history <topic> shows the chain with a date and a proof status per fact", async () => {
  const s = setup();
  const root = seedBudgetChain(s);
  s.ledger.markUploaded(root.seq, "blobAAA", NOW);
  assert.equal(
    textOf(await s.say("/history budget")),
    [
      "📜 <b>send the budget</b> — Maria",
      `1. Tue, Sep 22 · committed, due Fri, Sep 25 · <a href="${PROOF}/blobAAA">proof</a>`,
      "2. Wed, Sep 23 · changed, due Sat, Sep 26 · ⏳ saving",
      "Now: open, due Sat, Sep 26",
    ].join("\n"),
  );
});

test("/history shows the completion and the final status", async () => {
  const s = setup();
  seedBudgetChain(s);
  s.seed({ id: "k_00000003", type: "COMPLETION", supersedes: "a_00000002", at: "2026-09-24T09:00:00.000Z" });
  const t = textOf(await s.say("/history send budget"));
  assert.match(t, /3\. Thu, Sep 24 · completed/);
  assert.match(t, /Now: completed ✅$/);
});

test("/history matches by task, owner or topic, ignoring case and accents, and needs every word", async () => {
  const s = setup();
  seedBudgetChain(s);
  s.seed({ id: "d_00000004", type: "DECISION", topic: "delivery", task: "Delivery date", due: "2026-09-30" });
  assert.match(textOf(await s.say("/history MARIA")), /send the budget/);
  assert.match(textOf(await s.say("/history delivery")), /Delivery date/);
  assert.match(textOf(await s.say("/history maria budget")), /send the budget/);
  assert.match(textOf(await s.say("/history maria delivery")), /I found nothing about "maria delivery"/);
});

test("/history: a decision reads 'Now: due ...'", async () => {
  const s = setup();
  s.seed({ id: "d_00000004", type: "DECISION", topic: "delivery", task: "Delivery date", due: "2026-09-30" });
  assert.match(textOf(await s.say("/history delivery")), /1\. Tue, Sep 22 · decided, due Wed, Sep 30 · ⏳ saving\nNow: due Wed, Sep 30$/);
});

test("/history needs a topic, says when nothing matches, is per group and escapes HTML", async () => {
  const s = setup();
  seedBudgetChain(s);
  assert.match(textOf(await s.say("/history <script>")), /^I found nothing about "&lt;script&gt;"\./);
  s.seed({ id: "c_00000009", type: "COMMITMENT", owner: "Other", due: "2026-09-26", task: "secret plan" }, "-999");
  assert.match(textOf(await s.say("/history secret")), /found nothing/);
});

test("/history shows at most 3 items, newest first", async () => {
  const s = setup();
  for (let i = 1; i <= 5; i++) s.seed({ id: `c_${i.toString(16).padStart(8, "0")}`, type: "COMMITMENT", owner: "Maria", due: "2026-09-30", task: `budget part ${i}`, at: `2026-09-2${i}T10:00:00.000Z` });
  const t = textOf(await s.say("/history budget"));
  assert.equal((t.match(/📜/g) ?? []).length, 3);
  assert.ok(t.indexOf("budget part 5") < t.indexOf("budget part 3"));
  assert.doesNotMatch(t, /budget part 2/);
});

// ---- Telegram mapping -------------------------------------------------------------------------

test("toIncoming maps a Telegram message to the router input", () => {
  const i = toIncoming({ chatId: -100200300, from: { id: 7, first_name: "Pedro", username: "pedro_dev" }, text: "/pending", date: 1_790_000_000, entities: [{ type: "bot_command", offset: 0, length: 8 }] }, true);
  assert.deepEqual(i.author, { id: "tg:7", name: "Pedro", username: "pedro_dev", isAdmin: true });
  assert.equal(i.groupId, "-100200300");
  assert.equal(i.sentAt.getTime(), 1_790_000_000_000);
  assert.equal(i.entities?.length, 1);
  assert.equal(toIncoming({ chatId: 5, from: { id: 1, first_name: "X" }, text: "hi", date: 0 }, false).author.username, null);
});

test("every HTML reply is valid Telegram HTML (a stray < or & makes Telegram reject the message)", async () => {
  const s = setup();
  const root = s.seed({ id: "c_00000001", type: "COMMITMENT", owner: "A&B <x>", due: "2026-09-26", task: "fix <b>bold</b> & more" });
  s.seed({ id: "a_00000002", type: "AMENDMENT", supersedes: "c_00000001", due: "2026-09-28", at: "2026-09-23T15:00:00.000Z" });
  s.ledger.markUploaded(root.seq, "blob&1", NOW);
  for (const command of ["/start", "/help", "/pending", "/history fix", "/history <nothing>", "/history"]) {
    for (const reply of await s.say(command)) if (reply.kind === "text" && reply.html) assertTelegramHtml(reply.text);
  }
  assertTelegramHtml(START_TEXT.replace("{bot}", BOT));
});

// ---- /history without a name: pick from a list --------------------------------------------------

test("/history with no topic lists the latest items with a button each, so nobody has to know the name", async () => {
  const s = setup();
  seedBudgetChain(s);
  s.seed({ id: "c_00000005", type: "COMMITMENT", owner: "Pedro", due: "2026-09-23", task: "finish the backend", at: "2026-09-24T09:00:00.000Z" });
  s.seed({ id: "d_00000006", type: "DECISION", due: "2026-10-12", task: "launch date", at: "2026-09-21T09:00:00.000Z" });
  const [reply] = await s.say("/history");
  assert.equal(reply!.kind, "text");
  const r = reply as Extract<Reply, { kind: "text" }>;
  assert.match(r.text, /^Which one\? These are the latest items:\n1\. 🔴 finish the backend — Pedro\n2\. 🟢 send the budget — Maria\n3\. 📌 launch date/);
  assert.match(r.text, /🟢 open · 🔴 overdue · ✅ done · 📌 decision/);
  assert.match(r.text, /Tap an item to see how it changed, or type \/history followed by a word/);
  assert.deepEqual(r.buttons?.map((b) => b.label), ["1. finish the backend", "2. send the budget", "3. launch date"]);
  assert.deepEqual(r.buttons?.map((b) => b.data), ["h:c_00000005", "h:c_00000001", "h:d_00000006"]);
  for (const b of r.buttons ?? []) assert.ok(Buffer.byteLength(b.data) <= 64);
  assertTelegramHtml(r.text);
});

test("/history with no topic shows only the latest 8, and completed items are listed too", async () => {
  const s = setup();
  for (let i = 1; i <= 10; i++) s.seed({ id: `c_${i.toString(16).padStart(8, "0")}`, type: "COMMITMENT", owner: "Maria", due: "2026-09-30", task: `task ${i}`, at: `2026-09-${10 + i}T10:00:00.000Z` });
  s.seed({ id: "k_0000000b", type: "COMPLETION", supersedes: "c_0000000a", at: "2026-09-24T12:00:00.000Z" }); // 0x0a is task 10
  const r = (await s.say("/history"))[0] as Extract<Reply, { kind: "text" }>;
  assert.equal(r.buttons?.length, 8);
  assert.match(r.text, /1\. ✅ task 10/, "the item just completed is the most recent change");
});

test("/history with no topic in an empty group says how to start", async () => {
  const [reply] = await setup().say("/history");
  assert.match((reply as { text: string }).text, /Nothing has been recorded in this group yet\.\nStart with something like: \/palavra/);
  assert.equal((reply as { buttons?: unknown }).buttons, undefined);
});

test("a /history search that finds nothing suggests the latest items instead of leaving the user guessing", async () => {
  const s = setup();
  seedBudgetChain(s);
  const [reply] = await s.say("/history zzz");
  const r = reply as Extract<Reply, { kind: "text" }>;
  assert.match(r.text, /^I found nothing about "zzz"\. These are the latest items:\n1\. 🟢 send the budget — Maria/);
  assert.equal(r.buttons?.length, 1);
  const empty = (await setup().say("/history zzz"))[0] as { text: string };
  assert.match(empty.text, /I found nothing about "zzz"\.\n\nNothing has been recorded/);
});

test("tapping an item shows its history; another group's item is not reachable", async () => {
  const s = setup();
  const root = seedBudgetChain(s);
  s.ledger.markUploaded(root.seq, "blobAAA", NOW);
  s.seed({ id: "c_00000009", type: "COMMITMENT", owner: "Other", due: "2026-09-26", task: "secret plan" }, "-999");
  const [reply] = handleHistoryPick(s.deps, G, "c_00000001");
  const t = (reply as { text: string }).text;
  assert.match(t, /^📜 <b>send the budget<\/b> — Maria\n1\. Tue, Sep 22 · committed, due Fri, Sep 25 · <a href="[^"]*blobAAA">proof<\/a>/);
  assertTelegramHtml(t);
  assert.match((handleHistoryPick(s.deps, G, "c_00000009")[0] as { text: string }).text, /can't find that item anymore/);
  assert.match((handleHistoryPick(s.deps, G, "c_deadbeef")[0] as { text: string }).text, /can't find that item anymore/);
});

// ---- sending -------------------------------------------------------------------------------------

test("sendReply sends HTML, one inline button per row, as a reply to the message", async () => {
  const sent: { chat: unknown; text: string; opts: any }[] = [];
  const api = { sendMessage: (async (chat: unknown, t: string, opts: unknown) => { sent.push({ chat, text: t, opts }); }) as never };
  await sendReply(api, G, { kind: "text", text: "<b>hi</b>", html: true, buttons: [{ label: "1. a", data: "h:c_00000001" }, { label: "2. b", data: "h:c_00000002" }] }, 55);
  const o = sent[0]!.opts;
  assert.equal(o.parse_mode, "HTML");
  assert.deepEqual(o.reply_markup.inline_keyboard.map((row: any[]) => row.map((b) => [b.text, b.callback_data])), [[["1. a", "h:c_00000001"]], [["2. b", "h:c_00000002"]]]);
  assert.equal(o.reply_parameters.message_id, 55);
  await sendReply(api, G, { kind: "text", text: "plain" });
  assert.equal(sent[1]!.opts.parse_mode, undefined);
  assert.equal(sent[1]!.opts.reply_markup, undefined);
  assert.equal(sent[1]!.opts.reply_parameters, undefined);
});
