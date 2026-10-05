import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, ownerMatchesUser, sameName } from "./owner.js";

test("A1: first name, full name and @username match; case, accents and spaces are ignored", () => {
  assert.equal(ownerMatchesUser("Maria", { name: "Maria" }), true);
  assert.equal(ownerMatchesUser("  MARIA ", { name: "maria" }), true);
  assert.equal(ownerMatchesUser("zoe", { name: "Zo\u00eb" }), true, "accent-insensitive");
  assert.equal(ownerMatchesUser("Pedro", { name: "Pedro Henrique", username: "pedro_dev" }), true, "first token of the first name");
  assert.equal(ownerMatchesUser("Pedro Henrique", { name: "Pedro Henrique" }), true, "full name");
  assert.equal(ownerMatchesUser("pedro_dev", { name: "Someone Else", username: "pedro_dev" }), true, "@username");
  assert.equal(ownerMatchesUser("@pedro_dev", { name: "Someone Else", username: "Pedro_Dev" }), true, "@ prefix and case ignored");
  assert.equal(ownerMatchesUser("  @pedro_dev ", { name: "Someone Else", username: "pedro_dev" }), true, "spaces before the @");
});

test("A1: different people and empty values do not match", () => {
  assert.equal(ownerMatchesUser("Pedro", { name: "Maria" }), false);
  assert.equal(ownerMatchesUser("Ped", { name: "Pedro" }), false, "no partial matches");
  assert.equal(ownerMatchesUser("Henrique", { name: "Pedro Henrique" }), false, "only the FIRST token counts");
  assert.equal(ownerMatchesUser(null, { name: "Maria" }), false);
  assert.equal(ownerMatchesUser("", { name: "Maria" }), false);
  assert.equal(ownerMatchesUser("   ", { name: "Maria" }), false);
});

test("sameName and normalizeName", () => {
  assert.equal(sameName("Jos\u00e9", "jose"), true);
  assert.equal(sameName("Maria", "Pedro"), false);
  assert.equal(sameName(null, "Maria"), false);
  assert.equal(normalizeName("  @Jo\u00e3o   Silva "), "joao silva");
});
