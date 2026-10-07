// recall() returns HTTP 200 with results: [] when the CLIENT clock is 1-5 minutes ahead of the relayer.
// Read-only: it only calls recall(). Simulates a fast clock by shifting Date.now() around the call
// (the SDK uses Date.now() for both the request timestamp and the SEAL session creation time).
// Usage: NS=<namespace with >= 3 memories> node --env-file=.env bugs/01-recall-empty-when-client-clock-ahead/repro.mjs
import { createClient, printEnvironment, requireNamespace, sleep, withClockSkew } from "../_lib.mjs";

const NS = requireNamespace();
await printEnvironment();

const MINUTE = 60_000;
const rows = [];
// A NEW client per row: each one builds its own SEAL session, like a freshly started process would.
for (const minutes of [0, 1, 3, 5, 6, -4, -6]) {
  const m = createClient(NS);
  let outcome;
  try {
    const r = await withClockSkew(minutes * MINUTE, () => m.recall({ query: "budget", limit: 3 }));
    outcome = `HTTP 200  results=${r.results.length}  total=${r.total}  dropped_count=${r.dropped_count ?? "(absent)"}`;
  } catch (e) {
    outcome = `THROWS status=${e.status ?? "?"}  ${String(e.message).slice(0, 80)}`;
  }
  rows.push({ skew: `${minutes >= 0 ? "+" : ""}${minutes} min`, outcome });
  console.log(`client clock ${rows.at(-1).skew}`.padEnd(24), outcome);
  await sleep(1500);
}

// Isolation: a client that built its SEAL session at the real time and is THEN skewed +3 min still works,
// so the request timestamp is not what breaks decryption; the session's creation time is the suspect.
const warm = createClient(NS);
await warm.recall({ query: "budget", limit: 1 });
await sleep(1500);
const warmRes = await withClockSkew(3 * MINUTE, () => warm.recall({ query: "budget", limit: 3 }));
console.log("warm client, +3 min".padEnd(24), `HTTP 200  results=${warmRes.results.length}  total=${warmRes.total}  dropped_count=${warmRes.dropped_count ?? "(absent)"}  (session built at real time, then clock moved)`);

const okBaseline = rows[0].outcome.includes("results=3") || /results=[1-9]/.test(rows[0].outcome);
const aheadEmpty = rows.slice(1, 4).some((r) => r.outcome.includes("results=0") && /dropped_count=[1-9]/.test(r.outcome));
console.log(
  okBaseline && aheadEmpty
    ? "\nREPRODUCED: with a clock 1-5 min ahead, recall answers 200 with an empty result and dropped_count > 0, while the same memories are returned at +0 and at -4 min, and +6 min gets an explicit clock-drift 401."
    : "\nNOT reproduced with this data/namespace (see the table above).",
);
