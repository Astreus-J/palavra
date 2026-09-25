import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import type { Fact } from "../core/fact.js";
import { Ledger, type LedgerRow } from "../core/ledger.js";
import { Outbox } from "../core/outbox.js";
import { createMemoryStore } from "../memory/index.js";
import { parseRetryCallback, ReceiptStore, ReceiptUpdater, receiptState, renderReceipt, retryCallbackData, retryFailedFact, SAVING_LINE, type EditApi } from "./receipts.js";

const T0 = new Date("2026-09-25T20:00:00Z");
const G = "-5230162759";
const PROOF = "https://walruscan.com/mainnet/blob";
const BASE = "✅ Recorded\nMaria committed to send the budget. Due 2026-09-30.";
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: "c_00000001", type: "COMMITMENT", supersedes: null, author: "tg:1", owner: "Maria", due: "2026-09-30", topic: null, task: "send the budget", at: "2026-09-25T20:00:00.000Z",
  text: "Maria committed to send the budget. Due 2026-09-30.", ...over,
});
const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  seq: 1, groupId: G, factId: "c_00000001", raw: "x", status: "pending", blobId: null, attempts: 0, nextAttemptAt: null, lastError: null, createdAt: "", updatedAt: "", ...over,
});
const live = { proofBaseUrl: PROOF, onChain: true };

// ---- states and texts --------------------------------------------------------------------------

test("the state of a receipt follows the write: saving → retrying → saved, or failed", () => {
  assert.equal(receiptState(row()), "saving");
  assert.equal(receiptState(row({ attempts: 2, lastError: "boom" })), "retrying");
  assert.equal(receiptState(row({ status: "failed", attempts: 8 })), "failed");
  assert.equal(receiptState(row({ status: "uploaded", blobId: "abc" })), "saved", "the blob exists as soon as the write succeeds");
  assert.equal(receiptState(row({ status: "done", blobId: "abc" })), "saved");
});

test("phase one is ⏳; phase two is a 🔗 link that opens the blob on Walruscan", () => {
  assert.deepEqual(renderReceipt(row(), live), { state: "saving", text: SAVING_LINE, retryFactId: null });
  assert.equal(SAVING_LINE, "⏳ Saving to Walrus…");
  const saved = renderReceipt(row({ status: "done", blobId: "rl8jl4Mp_x-Y" }), live);
  assert.equal(saved.text, '🔗 Saved on Walrus: <a href="https://walruscan.com/mainnet/blob/rl8jl4Mp_x-Y">proof</a>');
  assert.equal(saved.retryFactId, null);
});

test("in test mode there is no on-chain proof to link to, and the text says so", () => {
  const saved = renderReceipt(row({ status: "done", blobId: "mock-blob-000001" }), { ...live, onChain: false });
  assert.equal(saved.text, "✅ Saved (test mode: no on-chain proof)");
  assert.doesNotMatch(saved.text, /href/);
});

test("a write that keeps failing shows a clear message with a retry, and a retrying one says how many times", () => {
  const retrying = renderReceipt(row({ attempts: 3, lastError: "boom" }), live);
  assert.equal(retrying.text, "⏳ Still saving to Walrus (retry 3)…");
  assert.equal(retrying.retryFactId, null);
  const failed = renderReceipt(row({ status: "failed", attempts: 8, lastError: "relayer down" }), live);
  assert.match(failed.text, /^❌ I couldn't save this to Walrus after several tries\. It is safe on my side: tap "Try again"\.$/);
  assert.equal(failed.retryFactId, "c_00000001");
  assert.doesNotMatch(failed.text, /relayer down/, "internal errors stay in the logs");
});

test("the blob id is escaped inside the link", () => {
  const v = renderReceipt(row({ status: "done", blobId: 'a"b<c' }), live);
  assert.doesNotMatch(v.text, /<c/);
  assert.match(v.text, /a&quot;b&lt;c|a"b&lt;c/);
});

test("retry callback data round-trips and never collides with the other buttons", () => {
  const data = retryCallbackData("c_22393069");
  assert.equal(data, "r:c_22393069");
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.equal(parseRetryCallback(data), "c_22393069");
  for (const bad of ["", "r:", "r:x_22393069", "r:c_2239306", "h:c_22393069", "p:0000000a:y"]) assert.equal(parseRetryCallback(bad), null, bad);
});

// ---- storage -----------------------------------------------------------------------------------

test("receipts are stored, listed while unfinished, and survive a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "palavra-receipts-"));
  try {
    const path = join(dir, "r.db");
    const a = ReceiptStore.open(path);
    a.add({ groupId: G, factId: "c_00000001", chatId: G, messageId: 42, baseHtml: BASE });
    assert.equal(a.get(G, "c_00000001")?.shown, "saving");
    assert.equal(a.unfinished().length, 1);
    a.setShown(G, "c_00000001", "saved");
    assert.equal(a.unfinished().length, 0, "a 🔗 receipt needs no more edits");
    a.close();
    const b = ReceiptStore.open(path);
    assert.deepEqual(b.get(G, "c_00000001"), { groupId: G, factId: "c_00000001", chatId: G, messageId: 42, baseHtml: BASE, shown: "saved" });
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adding a receipt again (a retried write) starts over at ⏳", () => {
  const s = ReceiptStore.open(":memory:");
  s.add({ groupId: G, factId: "c_00000001", chatId: G, messageId: 42, baseHtml: BASE });
  s.setShown(G, "c_00000001", "failed");
  s.add({ groupId: G, factId: "c_00000001", chatId: G, messageId: 43, baseHtml: BASE });
  assert.equal(s.get(G, "c_00000001")?.shown, "saving");
  assert.equal(s.get(G, "c_00000001")?.messageId, 43);
});

// ---- the updater -------------------------------------------------------------------------------

function setup(onChain = true) {
  const ledger = Ledger.open(":memory:");
  const store = ReceiptStore.open(":memory:");
  const edits: { chatId: string; messageId: number; text: string; other: Parameters<EditApi["editMessageText"]>[3] }[] = [];
  const errors: unknown[] = [];
  let failWith: Error | null = null;
  const api: EditApi = {
    editMessageText: async (chatId, messageId, text, other) => {
      if (failWith) throw failWith;
      edits.push({ chatId, messageId, text, other });
    },
  };
  const updater = new ReceiptUpdater({ store, ledger, api, proofBaseUrl: PROOF, onChain, onError: (e) => errors.push(e) });
  const track = (f: Fact = fact(), messageId = 42) => {
    const added = ledger.addFact(G, f, T0);
    store.add({ groupId: G, factId: f.id, chatId: G, messageId, baseHtml: BASE });
    return added.row;
  };
  return { ledger, store, edits, errors, updater, track, failNext: (e: Error | null) => { failWith = e; } };
}

test("nothing is edited while the fact is still saving (the message already shows ⏳)", async () => {
  const s = setup();
  s.track();
  assert.equal(await s.updater.refresh(), 0);
  assert.deepEqual(s.edits, []);
});

test("when the blob exists the SAME message is edited once to the 🔗 link, and never again", async () => {
  const s = setup();
  const r = s.track();
  s.ledger.markUploaded(r.seq, "blobXYZ", T0);
  assert.equal(await s.updater.refresh(), 1);
  assert.equal(s.edits.length, 1);
  const e = s.edits[0]!;
  assert.deepEqual([e.chatId, e.messageId], [G, 42]);
  assert.equal(e.text, `${BASE}\n🔗 Saved on Walrus: <a href="https://walruscan.com/mainnet/blob/blobXYZ">proof</a>`);
  assert.equal(e.other.parse_mode, "HTML");
  assert.deepEqual(e.other.reply_markup.inline_keyboard, []);
  assert.equal(await s.updater.refresh(), 0, "no repeated edits");
  assert.equal(s.store.unfinished().length, 0);
});

test("failure: ⏳ → 'still saving' → an error with a 🔄 button → try again → ⏳ → 🔗", async () => {
  const s = setup();
  const r = s.track();
  s.ledger.markRetry(r.seq, "relayer unavailable", new Date(T0.getTime() + 600), T0);
  await s.updater.refresh();
  assert.match(s.edits.at(-1)!.text, /⏳ Still saving to Walrus \(retry 1\)…$/);

  s.ledger.markFailed(r.seq, "relayer unavailable", T0);
  await s.updater.refresh();
  const failed = s.edits.at(-1)!;
  assert.match(failed.text, /❌ I couldn't save this to Walrus/);
  assert.deepEqual(failed.other.reply_markup.inline_keyboard, [[{ text: "🔄 Try again", callback_data: "r:c_00000001" }]]);

  assert.equal(await retryFailedFact({ ledger: s.ledger, updater: s.updater, groupId: G, factId: "c_00000001", now: T0 }), "requeued");
  const again = s.edits.at(-1)!;
  assert.ok(again.text.endsWith(SAVING_LINE));
  assert.deepEqual(again.other.reply_markup.inline_keyboard, [], "the button is gone while it retries");
  assert.equal(s.ledger.getRow(G, "c_00000001")?.status, "pending");

  s.ledger.markUploaded(r.seq, "blobOK", T0);
  await s.updater.refresh();
  assert.match(s.edits.at(-1)!.text, /🔗 Saved on Walrus/);
});

test("the retry button does nothing for a fact that is not failed", async () => {
  const s = setup();
  s.track();
  assert.equal(await retryFailedFact({ ledger: s.ledger, updater: s.updater, groupId: G, factId: "c_00000001", now: T0 }), "not-failed");
  assert.equal(await retryFailedFact({ ledger: s.ledger, updater: s.updater, groupId: G, factId: "c_0000dead", now: T0 }), "not-failed");
  assert.deepEqual(s.edits, []);
});

test("a temporary Telegram error is retried on the next refresh; a permanent one stops the loop", async () => {
  const s = setup();
  const r = s.track();
  s.ledger.markUploaded(r.seq, "blobXYZ", T0);
  s.failNext(new Error("Too Many Requests: retry after 5"));
  assert.equal(await s.updater.refresh(), 0);
  assert.equal(s.errors.length, 1);
  assert.equal(s.store.get(G, "c_00000001")?.shown, "saving", "still owed an edit");
  s.failNext(null);
  assert.equal(await s.updater.refresh(), 1, "the next refresh succeeds");

  const p = setup();
  const r2 = p.track();
  p.ledger.markUploaded(r2.seq, "blobXYZ", T0);
  p.failNext(new Error("Bad Request: message to edit not found"));
  await p.updater.refresh();
  assert.equal(p.store.get(G, "c_00000001")?.shown, "saved", "a deleted message is not edited forever");
  assert.equal(p.store.unfinished().length, 0);
});

test("'message is not modified' is treated as done", async () => {
  const s = setup();
  const r = s.track();
  s.ledger.markUploaded(r.seq, "blobXYZ", T0);
  s.failNext(new Error("Bad Request: message is not modified"));
  await s.updater.refresh();
  assert.equal(s.store.unfinished().length, 0);
});

test("several receipts are independent, and a receipt whose fact is unknown is skipped", async () => {
  const s = setup();
  const a = s.track(fact({ id: "c_00000001" }), 10);
  s.track(fact({ id: "c_00000002", text: "Pedro will ship it." }), 11);
  s.store.add({ groupId: G, factId: "c_0000dead", chatId: G, messageId: 12, baseHtml: BASE });
  s.ledger.markUploaded(a.seq, "blobA", T0);
  assert.equal(await s.updater.refresh(), 1);
  assert.equal(s.edits[0]!.messageId, 10);
  assert.equal(s.store.get(G, "c_00000002")?.shown, "saving");
});

// ---- the whole path, with the real outbox ------------------------------------------------------

test("end to end: ✅ → ⏳ → the outbox writes → the message becomes 🔗", async () => {
  const s = setup(true);
  s.track();
  const outbox = new Outbox({ store: createMemoryStore(loadConfig({})), ledger: s.ledger, sleep: async () => undefined });
  assert.equal(await s.updater.refresh(), 0, "before the write: still ⏳, no edit");
  await outbox.flush();
  assert.equal(await s.updater.refresh(), 1);
  assert.match(s.edits[0]!.text, /🔗 Saved on Walrus: <a href="https:\/\/walruscan\.com\/mainnet\/blob\/mock-blob-000001">proof<\/a>$/);
});

test("end to end in test mode: the message says there is no on-chain proof instead of a dead link", async () => {
  const s = setup(false);
  s.track();
  await new Outbox({ store: createMemoryStore(loadConfig({})), ledger: s.ledger, sleep: async () => undefined }).flush();
  await s.updater.refresh();
  assert.ok(s.edits[0]!.text.endsWith("✅ Saved (test mode: no on-chain proof)"));
});
