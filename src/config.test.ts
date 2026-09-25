import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("defaults: mock mode, no keys", () => {
  const cfg = loadConfig({});
  assert.equal(cfg.MEMWAL_MODE, "mock");
  assert.equal(cfg.DEFAULT_TIMEZONE, "America/Sao_Paulo");
  assert.equal(cfg.MEMWAL_PRIVATE_KEY, undefined);
});

test("empty values from .env.example fall back to defaults", () => {
  const cfg = loadConfig({ MEMWAL_PRIVATE_KEY: "", DB_PATH: "" });
  assert.equal(cfg.MEMWAL_PRIVATE_KEY, undefined);
  assert.equal(cfg.DB_PATH, "./data/palavra.db");
});

test("real mode requires the delegate key and the account id", () => {
  assert.throws(() => loadConfig({ MEMWAL_MODE: "real" }), /MEMWAL_PRIVATE_KEY[\s\S]*MEMWAL_ACCOUNT_ID/);
  const ok = loadConfig({ MEMWAL_MODE: "real", MEMWAL_PRIVATE_KEY: "k", MEMWAL_ACCOUNT_ID: "0x1" });
  assert.equal(ok.MEMWAL_MODE, "real");
});

test("invalid mode is rejected", () => {
  assert.throws(() => loadConfig({ MEMWAL_MODE: "prod" }), /Invalid configuration/);
});

test("an invalid timezone stops the bot at startup (rule T1)", () => {
  assert.throws(() => loadConfig({ DEFAULT_TIMEZONE: "Mars/Olympus" }), /DEFAULT_TIMEZONE[\s\S]*not a valid IANA timezone/);
  assert.equal(loadConfig({ DEFAULT_TIMEZONE: "Europe/Lisbon" }).DEFAULT_TIMEZONE, "Europe/Lisbon");
});

test("the fallback model is optional", () => {
  assert.equal(loadConfig({}).GEMINI_FALLBACK_MODEL, undefined);
  assert.equal(loadConfig({ GEMINI_FALLBACK_MODEL: "gemini-3.5-flash" }).GEMINI_FALLBACK_MODEL, "gemini-3.5-flash");
});
