import { test } from "node:test";
import assert from "node:assert/strict";
import type { Proposal } from "../core/proposals.js";
import { callbackData, formatDate, historyCallbackData, noOpenCommitmentNotice, parseCallbackData, parseHistoryCallback, renderProposal, texts } from "./messages.js";

const base: Proposal = {
  id: "0000000a", groupId: "-1", status: "pending", kind: "record", factType: "COMMITMENT",
  proposer: { id: "tg:1", name: "Maria" }, subjectName: "Maria",
  draft: { owner: "Maria", task: "send the budget", due: "2026-09-25", topic: null, text: "Maria committed to send the budget. Due 2026-09-25." },
  extracted: { owner: "Maria", task: "send the budget", due: "2026-09-25" },
  targetRootId: null, targetLabel: null, previousDue: null,
  confirmers: { userIds: ["tg:1"], ownerName: null }, needsOtherConfirmation: false, confirmerLabel: "Maria",
  warnings: [], messageAt: "2026-09-24T13:00:00.000Z", createdAt: "2026-09-24T13:00:00.000Z", expiresAt: "2026-09-25T13:00:00.000Z",
  confirmedBy: null, writtenFactId: null,
};

test("T4: dates carry the weekday", () => {
  assert.equal(formatDate("2026-09-25"), "Fri, Sep 25");
  assert.equal(formatDate("2026-10-02"), "Fri, Oct 2");
  assert.equal(formatDate("2026-09-30"), "Wed, Sep 30");
  assert.equal(formatDate("2027-01-15"), "Fri, Jan 15");
});

test("a commitment proposal shows owner, task and date, with ✅ and ✖", () => {
  const r = renderProposal(base);
  assert.match(r.text, /^Record this commitment\?\n👤 Maria\n📋 send the budget\n📅 Fri, Sep 25$/);
  assert.deepEqual(r.buttons.map((b) => [b.label, b.action]), [["✅ Yes", "yes"], ["✖ No", "no"]]);
});

test("no deadline and past-date warnings appear on the proposal", () => {
  assert.match(renderProposal({ ...base, draft: { ...base.draft, due: null }, warnings: ["no-deadline"] }).text, /📅 No deadline/);
  assert.match(renderProposal({ ...base, warnings: ["past-date"] }).text, /⚠️ This date is in the past/);
});

test("a decision without a date has no date line", () => {
  const r = renderProposal({ ...base, factType: "DECISION", draft: { ...base.draft, owner: null, due: null } });
  assert.match(r.text, /^Record this decision\?/);
  assert.doesNotMatch(r.text, /📅/);
});

test("M1: an amendment by the owner offers ✅, ➕ and ✖ and shows old and new dates", () => {
  const r = renderProposal({ ...base, kind: "amend", factType: "AMENDMENT", targetRootId: "c_1", targetLabel: "budget", previousDue: "2026-09-25", draft: { ...base.draft, owner: null, due: "2026-09-26" } });
  assert.equal(r.text, 'Update "budget": Fri, Sep 25 → Sat, Sep 26?');
  assert.deepEqual(r.buttons.map((b) => b.action), ["yes", "other", "no"]);
  assert.equal(r.buttons[1]?.label, "➕ It's another one");
});

test("A5: an amendment that needs the owner names them and drops the ➕ button", () => {
  const r = renderProposal({ ...base, kind: "amend", factType: "AMENDMENT", targetLabel: "budget", previousDue: "2026-09-25", needsOtherConfirmation: true, confirmerLabel: "Maria", proposer: { id: "tg:3", name: "Lucas" }, draft: { ...base.draft, owner: null, due: "2026-09-28" } });
  assert.match(r.text, /^Maria, Lucas wants to change "budget": Fri, Sep 25 → Mon, Sep 28\. Confirm\?/);
  assert.deepEqual(r.buttons.map((b) => b.action), ["yes", "no"]);
});

test("a handover is shown as an owner change", () => {
  const r = renderProposal({ ...base, kind: "amend", factType: "AMENDMENT", targetLabel: "budget", draft: { ...base.draft, due: null, owner: "Pedro" } });
  assert.match(r.text, /owner → Pedro/);
});

test("A4: completions, direct and needing the owner", () => {
  const direct = renderProposal({ ...base, kind: "complete", factType: "COMPLETION", targetLabel: "backend" });
  assert.equal(direct.text, 'Mark "backend" as completed?');
  const other = renderProposal({ ...base, kind: "complete", factType: "COMPLETION", targetLabel: "backend", needsOtherConfirmation: true, confirmerLabel: "Pedro", proposer: { id: "tg:3", name: "Lucas" } });
  assert.equal(other.text, 'Pedro, Lucas says "backend" is done. Confirm?');
  assert.deepEqual(other.buttons.map((b) => b.action), ["yes", "no"]);
});

test("M3: no candidate offers a new commitment; M5 has its own notice", () => {
  const r = renderProposal({ ...base, kind: "record-instead" });
  assert.match(r.text, /^I found no open commitment for Maria\. Record it as a new commitment\?/);
  assert.equal(noOpenCommitmentNotice("Pedro"), "I found no open commitment for Pedro.");
});

test("callback data round-trips, fits Telegram's 64 bytes and rejects garbage", () => {
  for (const action of ["yes", "other", "no"] as const) {
    const data = callbackData("0000000a", action);
    assert.ok(Buffer.byteLength(data) <= 64);
    assert.deepEqual(parseCallbackData(data), { proposalId: "0000000a", action });
  }
  for (const bad of ["", "x", "p:zzzz:y", "p:0000000a:x", "p:0000000a", "q:0000000a:y", "p:0000000A:y"]) assert.equal(parseCallbackData(bad), null, bad);
});

test("history callback data round-trips and never collides with the proposal buttons", () => {
  const data = historyCallbackData("c_22393069");
  assert.equal(data, "h:c_22393069");
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.equal(parseHistoryCallback(data), "c_22393069");
  assert.equal(parseCallbackData(data), null, "a history tap is not a proposal press");
  assert.equal(parseHistoryCallback(callbackData("0000000a", "yes")), null);
  for (const bad of ["", "h:", "h:x_22393069", "h:c_2239306", "h:c_22393069x", "H:c_22393069"]) assert.equal(parseHistoryCallback(bad), null, bad);
});

test("permission texts name who can confirm", () => {
  assert.equal(texts.notAllowed("Pedro"), "Only Pedro or an admin can confirm this");
  assert.match(texts.expired, /expired, please send it again/);
});
