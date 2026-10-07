// Shared helpers for the minimal reproductions in bugs/. Plain ESM, no build step.
// Run a repro with:  node --env-file=.env bugs/<NN-title>/repro.mjs
// Needs MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID (a delegate key registered on the account).
import { readFile } from "node:fs/promises";
import os from "node:os";
import { MemWal } from "@mysten-incubation/memwal";

export const SERVER_URL = process.env.MEMWAL_SERVER_URL || "https://relayer.memory.walrus.xyz";

export function createClient(namespace) {
  const { MEMWAL_PRIVATE_KEY: key, MEMWAL_ACCOUNT_ID: accountId } = process.env;
  if (!key || !accountId) throw new Error("Set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID (node --env-file=.env ...)");
  return MemWal.create({ key, accountId, serverUrl: SERVER_URL, namespace });
}

/** The namespace to read from: NS env var, or the argument. Repros that need data never write by default. */
export function requireNamespace() {
  const ns = process.env.NS;
  if (!ns) throw new Error("Set NS=<a namespace with at least 6 memories>. Create one with: node --env-file=.env bugs/seed.mjs (writes blobs)");
  return ns;
}

export async function printEnvironment() {
  const pkgUrl = new URL("../package.json", import.meta.resolve("@mysten-incubation/memwal"));
  const sdk = JSON.parse(await readFile(pkgUrl, "utf8")).version;
  let relayer = "unknown";
  try {
    const h = await (await fetch(`${SERVER_URL}/health`)).json();
    relayer = `relayerVersion ${h.relayerVersion}, apiVersion ${h.apiVersion}`;
  } catch {}
  console.log(`environment: @mysten-incubation/memwal ${sdk} | relayer ${SERVER_URL} (${relayer}) | node ${process.version} | ${os.type()} ${os.release()} ${os.arch()} | model: n/a (no LLM involved)`);
  console.log(`checked at ${new Date().toISOString()}\n`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs fn with Date.now() shifted, to simulate a machine whose clock is off. Restored afterwards. */
export async function withClockSkew(skewMs, fn) {
  const realNow = Date.now;
  Date.now = () => realNow() + skewMs;
  try {
    return await fn();
  } finally {
    Date.now = realNow;
  }
}
