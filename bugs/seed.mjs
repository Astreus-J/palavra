// OPTIONAL. Writes six short memories into a fresh namespace so the repros have data to read.
// WARNING: every memory is an immutable, paid Walrus blob and a write takes ~25-35 s.
// Usage: node --env-file=.env bugs/seed.mjs        (prints the namespace to pass as NS=...)
import { createClient, printEnvironment } from "./_lib.mjs";

const NS = `repro-${Math.random().toString(36).slice(2, 8)}`;
const m = createClient(NS);
await printEnvironment();

// Written oldest to newest. The first three are about the budget; the last three are about something else,
// so the NEWEST memories are the LEAST relevant to the query "budget".
const facts = [
  "Maria will send the budget for the conference by Friday.",
  "The budget was moved to Saturday after the finance review.",
  "The budget total is 4200 dollars, approved by the board.",
  "Pedro finished the backend deployment on the staging server.",
  "The team lunch is on Wednesday at the Italian restaurant.",
  "Ana will present the new logo to the design committee next week.",
];
for (const text of facts) {
  const t0 = Date.now();
  const w = await m.rememberAndWait(text, NS, { timeoutMs: 120_000 });
  console.log(`wrote ${w.blob_id} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
console.log(`\nDone. Use:  NS=${NS} node --env-file=.env bugs/<NN-title>/repro.mjs`);
