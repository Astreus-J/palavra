import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("padrões: modo mock, sem chaves", () => {
  const cfg = loadConfig({});
  assert.equal(cfg.MEMWAL_MODE, "mock");
  assert.equal(cfg.DEFAULT_TIMEZONE, "America/Sao_Paulo");
  assert.equal(cfg.MEMWAL_PRIVATE_KEY, undefined);
});

test("valores vazios do .env.example viram padrão", () => {
  const cfg = loadConfig({ MEMWAL_PRIVATE_KEY: "", DB_PATH: "" });
  assert.equal(cfg.MEMWAL_PRIVATE_KEY, undefined);
  assert.equal(cfg.DB_PATH, "./data/palavra.db");
});

test("modo real exige delegate key e account id", () => {
  assert.throws(() => loadConfig({ MEMWAL_MODE: "real" }), /MEMWAL_PRIVATE_KEY[\s\S]*MEMWAL_ACCOUNT_ID/);
  const ok = loadConfig({ MEMWAL_MODE: "real", MEMWAL_PRIVATE_KEY: "k", MEMWAL_ACCOUNT_ID: "0x1" });
  assert.equal(ok.MEMWAL_MODE, "real");
});

test("modo inválido é rejeitado", () => {
  assert.throws(() => loadConfig({ MEMWAL_MODE: "prod" }), /Configuração inválida/);
});
