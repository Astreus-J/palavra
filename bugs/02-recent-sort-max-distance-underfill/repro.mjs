// recall({ sort: "recent", maxDistance }) returns fewer hits than asked (even 0) although enough
// memories pass the distance filter: the SDK applies maxDistance AFTER the relayer cut the list to `limit`.
// Read-only. Usage: NS=<namespace with >= 6 memories, newest ones less relevant to the query>
//                   node --env-file=.env bugs/02-recent-sort-max-distance-underfill/repro.mjs
import { createClient, printEnvironment, requireNamespace, sleep } from "../_lib.mjs";

const NS = requireNamespace();
const QUERY = process.env.QUERY || "budget";
const LIMIT = 3;
const m = createClient(NS);
await printEnvironment();

const all = (await m.recall({ query: QUERY, limit: 100 })).results; // everything, no filter
await sleep(1500);
const byDistance = [...all].sort((a, b) => a.distance - b.distance);
if (byDistance.length < LIMIT + 1) throw new Error(`Need at least ${LIMIT + 1} memories in ${NS}, found ${byDistance.length}`);

// A cutoff that the ${LIMIT} closest memories pass: just above the ${LIMIT}-th smallest distance.
const maxDistance = Math.round((byDistance[LIMIT - 1].distance + 0.01) * 1000) / 1000;
const passing = all.filter((x) => x.distance < maxDistance).length;
console.log(`query "${QUERY}", namespace has ${all.length} memories; ${passing} of them have distance < ${maxDistance}\n`);

const show = (label, r) => console.log(label.padEnd(54), `results=${r.results.length} total=${r.total}  distances=[${r.results.map((x) => x.distance.toFixed(3)).join(", ")}]`);
const relevance = await m.recall({ query: QUERY, limit: LIMIT, maxDistance });
await sleep(1500);
const recentOnly = await m.recall({ query: QUERY, limit: LIMIT, sort: "recent" });
await sleep(1500);
const recent = await m.recall({ query: QUERY, limit: LIMIT, sort: "recent", maxDistance });

show(`sort relevance, limit ${LIMIT}, maxDistance ${maxDistance}`, relevance);
show(`sort recent,    limit ${LIMIT}, (no maxDistance)`, recentOnly);
show(`sort recent,    limit ${LIMIT}, maxDistance ${maxDistance}`, recent);

console.log(
  recent.results.length < Math.min(LIMIT, passing)
    ? `\nREPRODUCED: ${passing} memories pass the filter and limit is ${LIMIT}, yet sort "recent" + maxDistance returned ${recent.results.length}. The ${LIMIT} newest memories were chosen first and the filter then removed the ones above ${maxDistance}.`
    : "\nNOT reproduced with this data: the newest memories are all within maxDistance. Use a namespace where the newest memories are less relevant to the query (bugs/seed.mjs makes one).",
);
