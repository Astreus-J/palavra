import { test } from "node:test";
import assert from "node:assert/strict";
import { FACT_TYPES, FactError, looksLikeFact, newFactId, parseFact, serializeFact, isValidIsoDate, type Fact } from "./fact.js";

const base = { author: "tg:123456", owner: null, due: null, topic: null, at: null, supersedes: null } as const;

const commitment: Fact = {
  ...base, id: "c_7f3a9b21", type: "COMMITMENT", owner: "Maria", due: "2026-09-26",
  text: "Maria committed to sending the budget by Friday, 2026-09-26.",
};
const decision: Fact = { ...base, id: "d_00000001", type: "DECISION", topic: "delivery", due: "2026-09-30", text: "The delivery is on 2026-09-30." };
const amendment: Fact = {
  ...base, id: "a_00000002", type: "AMENDMENT", supersedes: "c_7f3a9b21", owner: "Maria", due: "2026-09-27",
  text: "Maria moved the budget to Saturday, 2026-09-27.",
};
const completion: Fact = { ...base, id: "k_00000003", type: "COMPLETION", supersedes: "a_00000002", owner: "Maria", text: "Maria sent the budget." };

test("serializes to the documented format", () => {
  assert.equal(
    serializeFact(commitment),
    "[COMMITMENT v1] id=c_7f3a9b21 supersedes=- author=tg%3A123456 owner=Maria due=2026-09-26 topic=- at=-\n" +
      "Maria committed to sending the budget by Friday, 2026-09-26.",
  );
});

test("round-trip: fact → text → fact is identical for every type", () => {
  for (const fact of [commitment, decision, amendment, completion]) {
    assert.deepEqual(parseFact(serializeFact(fact)), fact);
  }
  assert.deepEqual(new Set([commitment, decision, amendment, completion].map((f) => f.type)), new Set(FACT_TYPES));
});

test("round-trip keeps special characters, non-ASCII letters and the literal '-'", () => {
  const fact: Fact = { ...commitment, owner: "Ana Maria = d'\u00C1vila", author: "tg:-", topic: "-", text: "Line one\nLine two with = signs and [brackets]." };
  const back = parseFact(serializeFact(fact));
  assert.deepEqual(back, fact);
});

test("at round-trips as an ISO instant with milliseconds and rejects anything else", () => {
  const stamped: Fact = { ...commitment, at: "2026-09-25T10:00:00.123Z" };
  const text = serializeFact(stamped);
  assert.match(text, / at=2026-09-25T10%3A00%3A00\.123Z\n/);
  assert.deepEqual(parseFact(text), stamped);
  for (const bad of ["2026-09-25", "2026-09-25T10:00:00Z", "2026-13-01T00:00:00.000Z", "yesterday"]) {
    assert.throws(() => serializeFact({ ...commitment, at: bad }), /invalid at instant/, bad);
  }
});

test("facts written before `at` existed still parse (at is optional in the header)", () => {
  assert.equal(parseFact("[DECISION v1] id=d_00000001 supersedes=- author=tg%3A1\nWe use Postgres.").at, null);
});

test("text is trimmed and must not be empty", () => {
  assert.equal(parseFact(serializeFact({ ...commitment, text: "  spaced  " })).text, "spaced");
  assert.throws(() => serializeFact({ ...commitment, text: "   " }), FactError);
});

test("AMENDMENT and COMPLETION require supersedes", () => {
  assert.throws(() => serializeFact({ ...amendment, supersedes: null }), /requires supersedes/);
  assert.throws(() => serializeFact({ ...completion, supersedes: null }), /requires supersedes/);
});

test("DECISION and COMMITMENT must not have supersedes", () => {
  assert.throws(() => serializeFact({ ...commitment, supersedes: "c_00000009" }), /must not have supersedes/);
  assert.throws(() => serializeFact({ ...decision, supersedes: "d_00000009" }), /must not have supersedes/);
});

test("COMMITMENT requires an owner", () => {
  assert.throws(() => serializeFact({ ...commitment, owner: null }), /requires owner/);
});

test("author is required; a fact cannot supersede itself", () => {
  assert.throws(() => serializeFact({ ...commitment, author: " " }), /author is required/);
  assert.throws(() => serializeFact({ ...amendment, supersedes: amendment.id }), /supersede itself/);
});

test("validates ids and due dates (real calendar dates only)", () => {
  assert.throws(() => serializeFact({ ...commitment, id: "x_123" }), /invalid id/);
  assert.throws(() => serializeFact({ ...commitment, due: "2026-02-30" }), /invalid due date/);
  assert.throws(() => serializeFact({ ...commitment, due: "2026-09-26T10:00:00" }), /invalid due date/);
  assert.equal(isValidIsoDate("2028-02-29"), true);
  assert.equal(isValidIsoDate("2027-02-29"), false);
});

test("parse rejects malformed, unknown and unsupported input", () => {
  assert.throws(() => parseFact("just some text"), /malformed fact header/);
  assert.throws(() => parseFact("[NOTE v1] id=c_7f3a9b21 supersedes=- author=x\nhi"), /unknown fact type/);
  assert.throws(() => parseFact("[COMMITMENT v2] id=c_7f3a9b21 supersedes=- author=x owner=M\nhi"), /unsupported fact version/);
  assert.throws(() => parseFact("[COMMITMENT v1] id=c_7f3a9b21 supersedes=- author=x owner=M color=red\nhi"), /unknown header key/);
  assert.throws(() => parseFact("[COMMITMENT v1] id=c_7f3a9b21 id=c_7f3a9b21 supersedes=- author=x owner=M\nhi"), /duplicate header key/);
  assert.throws(() => parseFact("[COMMITMENT v1] id=c_7f3a9b21 author=x owner=M\nhi"), /missing header key: supersedes/);
  assert.throws(() => parseFact("[COMMITMENT v1] id=c_7f3a9b21 supersedes=- author=%E0%A4%A owner=M\nhi"), /invalid encoding/);
});

test("parse applies the same rules as serialize (AMENDMENT without supersedes)", () => {
  assert.throws(() => parseFact("[AMENDMENT v1] id=a_00000002 supersedes=- author=x\nchanged"), /requires supersedes/);
});

test("optional keys may be omitted when parsing", () => {
  const fact = parseFact("[DECISION v1] id=d_00000001 supersedes=- author=tg%3A1\nWe use Postgres.");
  assert.equal(fact.owner, null);
  assert.equal(fact.due, null);
  assert.equal(fact.topic, null);
});

test("newFactId matches the type prefix and is unique", () => {
  const ids = new Set<string>();
  for (const type of FACT_TYPES) {
    const id = newFactId(type);
    assert.match(id, /^[dcak]_[0-9a-f]{8}$/);
    ids.add(id);
  }
  assert.equal(ids.size, FACT_TYPES.length);
  assert.ok(newFactId("COMMITMENT").startsWith("c_"));
});

test("looksLikeFact filters non-fact memories", () => {
  assert.equal(looksLikeFact(serializeFact(commitment)), true);
  assert.equal(looksLikeFact("User prefers dark mode"), false);
});
