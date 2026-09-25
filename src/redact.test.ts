import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, serializeError } from "./redact.js";

// A made-up token, assembled at run time so that no token-shaped literal is ever committed.
const TOKEN = ["1234567890", "AAFake" + "x".repeat(34)].join(":");

test("the bot token inside a Telegram URL is removed", () => {
  const url = `request to https://api.telegram.org/bot${TOKEN}/sendMessage failed, reason: timeout`;
  const out = redact(url);
  assert.doesNotMatch(out, /AAFakex/);
  assert.match(out, /api\.telegram\.org\/bot<redacted>\/sendMessage failed/);
});

test("API keys are removed too, and ordinary text is untouched", () => {
  assert.equal(redact(`key=AIza${"x".repeat(35)} end`), "key=<redacted> end");
  assert.equal(redact(`key=AQ.${"y".repeat(40)}`), "key=<redacted>");
  assert.equal(redact("Bad Request: message is not modified"), "Bad Request: message is not modified");
  assert.equal(redact("bot42:short"), "bot42:short", "not shaped like a token");
});

test("serializeError keeps the type and the message but never the token, not even in the stack", () => {
  const e = new Error(`Network request failed: https://api.telegram.org/bot${TOKEN}/getMe`);
  const s = serializeError(e);
  assert.equal(s.type, "Error");
  assert.doesNotMatch(JSON.stringify(s), /AAFakex/);
  assert.match(s.message, /getMe/);
  assert.deepEqual(serializeError("boom"), { type: "NonError", message: "boom" });
});
