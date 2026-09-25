import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { createMemoryStore, groupNamespace, MemoryError, SdkMemoryStore, type MemWalClient } from "./index.js";

const mockStore = () => createMemoryStore(loadConfig({}));

/** Fake client that records every call, to assert what the store sends to the SDK. */
function fakeClient(overrides: Partial<MemWalClient> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const client: MemWalClient = {
    async rememberAndWait(...args) { calls.push({ method: "rememberAndWait", args }); return { blob_id: "blob1", namespace: String(args[1]) }; },
    async recall(...args) { calls.push({ method: "recall", args }); return { results: [{ blob_id: "b1", text: "hello", distance: 0.1, created_at: "2026-09-25T10:00:00Z" }] }; },
    async restore(...args) { calls.push({ method: "restore", args }); return { restored: 2, skipped: 1, failed: 0, total: 3, truncated: false }; },
    async health() { calls.push({ method: "health", args: [] }); return { status: "ok" }; },
    ...overrides,
  };
  return { client, calls };
}

test("groupNamespace builds grp:<id> and accepts negative Telegram ids", () => {
  assert.equal(groupNamespace("-5230162759"), "grp:-5230162759");
  assert.equal(groupNamespace("abc_123"), "grp:abc_123");
});

test("groupNamespace rejects empty, spaced, prefixed and oversized ids", () => {
  for (const bad of ["", "a b", "grp:1", "x/y", "a".repeat(65)]) {
    assert.throws(() => groupNamespace(bad), MemoryError, `should reject ${JSON.stringify(bad)}`);
  }
});

test("mock mode needs no keys and reports its mode", () => {
  const store = createMemoryStore(loadConfig({}));
  assert.equal(store.mode, "mock");
});

test("real mode without credentials fails with a clear error", () => {
  assert.throws(
    () => createMemoryStore({ MEMWAL_MODE: "real", MEMWAL_PRIVATE_KEY: undefined, MEMWAL_ACCOUNT_ID: undefined, MEMWAL_SERVER_URL: "https://relayer.example" }),
    /requires MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID/,
  );
});

test("remember then recall round-trips through the mock", async () => {
  const store = mockStore();
  const written = await store.remember("g1", "Maria will send the budget by Friday");
  assert.equal(written.namespace, "grp:g1");
  assert.ok(written.blobId.length > 0);
  const found = await store.recall("g1", "budget Friday");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.text, "Maria will send the budget by Friday");
  assert.equal(found[0]?.blobId, written.blobId);
  assert.equal(typeof found[0]?.distance, "number");
});

test("groups are isolated: one group never sees another group's memories", async () => {
  const store = mockStore();
  await store.remember("g1", "The launch is on October 12");
  await store.remember("g2", "The launch is on November 3");
  const g1 = await store.recall("g1", "launch");
  const g2 = await store.recall("g2", "launch");
  assert.deepEqual(g1.map((m) => m.text), ["The launch is on October 12"]);
  assert.deepEqual(g2.map((m) => m.text), ["The launch is on November 3"]);
  assert.deepEqual(await store.recall("g3", "launch"), []);
});

test("recall respects limit and maxDistance", async () => {
  const store = mockStore();
  for (const t of ["budget one", "budget two", "budget three"]) await store.remember("g1", t);
  assert.equal((await store.recall("g1", "budget", { limit: 2 })).length, 2);
  assert.deepEqual(await store.recall("g1", "completely unrelated words", { maxDistance: 0.1 }), []);
});

test("empty text is rejected before reaching the client", async () => {
  const { client, calls } = fakeClient();
  await assert.rejects(new SdkMemoryStore(client, "real").remember("g1", "   "), /empty text/);
  assert.equal(calls.length, 0);
});

test("the group namespace is sent on every SDK call", async () => {
  const { client, calls } = fakeClient();
  const store = new SdkMemoryStore(client, "real");
  await store.remember("-100", "text");
  await store.recall("-100", "query");
  await store.restore("-100");
  assert.equal(calls[0]?.args[1], "grp:-100");
  assert.equal((calls[1]?.args[0] as { namespace: string }).namespace, "grp:-100");
  assert.equal(calls[2]?.args[0], "grp:-100");
});

test("default options: limit 5, maxDistance 0.7, write timeout 90 s", async () => {
  const { client, calls } = fakeClient();
  const store = new SdkMemoryStore(client, "real");
  await store.remember("g1", "text");
  await store.recall("g1", "q");
  assert.deepEqual(calls[0]?.args[2], { timeoutMs: 90_000 });
  const params = calls[1]?.args[0] as Record<string, unknown>;
  assert.equal(params.limit, 5);
  assert.equal(params.maxDistance, 0.7);
  assert.equal("sort" in params, false);
});

test("options are forwarded (sort, limit, maxDistance, timeout)", async () => {
  const { client, calls } = fakeClient();
  const store = new SdkMemoryStore(client, "real");
  await store.remember("g1", "text", { timeoutMs: 5 });
  await store.recall("g1", "q", { limit: 10, maxDistance: 0.4, sort: "recent" });
  assert.deepEqual(calls[0]?.args[2], { timeoutMs: 5 });
  assert.deepEqual(calls[1]?.args[0], { query: "q", namespace: "grp:g1", limit: 10, maxDistance: 0.4, sort: "recent" });
});

test("recall maps SDK results to the domain shape", async () => {
  const { client } = fakeClient();
  const [m] = await new SdkMemoryStore(client, "real").recall("g1", "q");
  assert.deepEqual(m, { blobId: "b1", text: "hello", distance: 0.1, createdAt: "2026-09-25T10:00:00Z" });
});

test("restore returns a summary", async () => {
  const { client } = fakeClient();
  assert.deepEqual(await new SdkMemoryStore(client, "real").restore("g1"), { restored: 2, skipped: 1, failed: 0, total: 3, truncated: false });
  const summary = await mockStore().restore("g1");
  assert.equal(typeof summary.restored, "number");
});

test("SDK errors are wrapped in MemoryError with the cause", async () => {
  const boom = new Error("relayer down");
  const { client } = fakeClient({
    rememberAndWait: async () => { throw boom; },
    recall: async () => { throw boom; },
    restore: async () => { throw boom; },
  });
  const store = new SdkMemoryStore(client, "real");
  for (const run of [() => store.remember("g1", "x"), () => store.recall("g1", "x"), () => store.restore("g1")]) {
    await assert.rejects(run, (e: unknown) => e instanceof MemoryError && e.cause === boom && /grp:g1/.test(e.message));
  }
});

test("health never throws", async () => {
  assert.deepEqual(await mockStore().health(), { ok: true, detail: "ok" });
  const { client } = fakeClient({ health: async () => { throw new Error("nope"); } });
  assert.deepEqual(await new SdkMemoryStore(client, "real").health(), { ok: false, detail: "nope" });
});
