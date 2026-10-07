// A request that reuses a nonce is rejected with 401 (good), but with an empty body and no x-auth-error header,
// so the SDK reports it as "wrong private key, key not registered ... account ID mismatch". A stale timestamp,
// by contrast, gets a machine-readable x-auth-error and an actionable message.
// Read-only. Usage: NS=<any namespace> node --env-file=.env bugs/03-replayed-nonce-reported-as-bad-credentials/repro.mjs
import { createClient, printEnvironment, requireNamespace, sleep, withClockSkew } from "../_lib.mjs";

const NS = requireNamespace();
const m = createClient(NS);
await printEnvironment();

// Log every non-2xx response the SDK receives.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const res = await realFetch(url, init);
  if (!res.ok) console.log(`   <- HTTP ${res.status}  x-auth-error=${JSON.stringify(res.headers.get("x-auth-error"))}  body=${JSON.stringify((await res.clone().text()).slice(0, 80))}`);
  return res;
};
const attempt = async (label, fn) => {
  console.log(label);
  try { await fn(); console.log("   OK"); } catch (e) { console.log(`   SDK error: status=${e.status} serverCode=${e.serverCode}\n   message: ${e.message}`); }
  await sleep(1500);
};

const realUUID = crypto.randomUUID.bind(crypto);
Object.defineProperty(crypto, "randomUUID", { value: () => "33333333-3333-4333-8333-333333333333", configurable: true });
await attempt("1) first request with a fixed nonce:", () => m.recall({ query: "test", limit: 1 }));
await attempt("2) second request, same nonce, fresh timestamp and signature (a replay):", () => m.recall({ query: "test", limit: 1 }));
Object.defineProperty(crypto, "randomUUID", { value: realUUID, configurable: true });

await attempt("3) for comparison, timestamp 10 minutes in the past (stale):", () => withClockSkew(-10 * 60_000, () => m.recall({ query: "test", limit: 1 })));
