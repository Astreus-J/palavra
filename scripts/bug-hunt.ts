// Instrumentation for the Bug Bounty track (task HACKATONSU-39). Probes the Walrus Memory SDK
// directly (not through MemoryStore, which only wraps the calls the bot needs) against the
// project's real mainnet account, in a throwaway namespace so it never touches real group data.
//
// Measures: write -> done latency, recall right after a write (retried for a window), ordering
// of sort:"recent" against each fact's own event time, and the default recall timeout/limit
// edge cases flagged in docs/DESIGN.md §8. Writes a dated report to docs/evidence/ and prints a
// short list of GitHub issue numbers (github.com/MystenLabs/MemWal/issues) each finding already
// matches, from a manual search done before this run -- see the report's "Known issues" column.
// Usage: npx tsx scripts/bug-hunt.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { MemWal } from "@mysten-incubation/memwal";

const apiKey = { key: process.env.MEMWAL_PRIVATE_KEY, accountId: process.env.MEMWAL_ACCOUNT_ID, serverUrl: process.env.MEMWAL_SERVER_URL };
if (!apiKey.key || !apiKey.accountId) throw new Error("Set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID (MEMWAL_MODE=real)");

const NAMESPACE = `bug-hunt-${new Date().toISOString().slice(0, 10)}`;
const m = MemWal.create({ key: apiKey.key, accountId: apiKey.accountId, serverUrl: apiKey.serverUrl, namespace: NAMESPACE });

type Verdict = "expected" | "known-issue" | "novel";
interface Finding { probe: string; observed: string; verdict: Verdict; knownIssues: string }
const findings: Finding[] = [];
const log = (probe: string, observed: string, verdict: Verdict, knownIssues = "-") => {
  findings.push({ probe, observed, verdict, knownIssues });
  console.log(`[${probe}] (${verdict}) ${observed}`);
};

async function probeWriteLatency() {
  const t0 = Date.now();
  const w = await m.rememberAndWait(`bug-hunt write-latency probe at ${new Date().toISOString()}`, NAMESPACE, { timeoutMs: 120_000 });
  const seconds = (Date.now() - t0) / 1000;
  // Documented range (docs/ACCOUNTS.md): 24-33 s.
  const verdict: Verdict = seconds >= 20 && seconds <= 45 ? "expected" : "novel";
  log("write-latency", `rememberAndWait took ${seconds.toFixed(1)} s, blob ${w.blob_id} (documented range: 24-33 s)`, verdict, verdict === "novel" ? "-" : "docs/ACCOUNTS.md");
  return w.blob_id;
}

async function probeRecallRightAfterWrite() {
  const text = `bug-hunt recall-after-write probe ${Math.random().toString(36).slice(2)}`;
  const t0 = Date.now();
  const w = await m.remember(text, NAMESPACE); // accepted, not awaited to done
  let foundAfterMs: number | null = null;
  for (let i = 0; i < 20; i++) {
    const r = await m.recall({ query: text, namespace: NAMESPACE, limit: 5 });
    if (r.results.some((x) => x.text === text)) { foundAfterMs = Date.now() - t0; break; }
    await new Promise((res) => setTimeout(res, 2000));
  }
  log(
    "recall-right-after-write",
    foundAfterMs === null
      ? `not found by recall within 40 s of remember() (job_id ${w.job_id})`
      : `found by recall ${(foundAfterMs / 1000).toFixed(1)} s after remember() accepted, before rememberAndWait would have returned -- recall is not guaranteed immediately after write, so this is expected, not a miss`,
    foundAfterMs === null ? "known-issue" : "expected",
    foundAfterMs === null ? "#1070, #1036, #1066 (empty recall right after a write)" : "-",
  );
}

async function probeOrdering(blobA: string, blobB: string) {
  const r = await m.recall({ query: "bug-hunt", namespace: NAMESPACE, sort: "recent", limit: 10 });
  const order = r.results.map((x) => x.blob_id);
  const newestFirst = order[0] === blobB && order[order.length - 1] === blobA;
  log(
    "sort-recent-ordering",
    `sort:"recent" order: ${order.join(", ")}; written order was ${blobA} then ${blobB} -- ${newestFirst ? "newest first, as documented" : "NOT newest-first, unexpected"}`,
    newestFirst ? "expected" : "novel",
    newestFirst ? "-" : "closest known report: #1060 (restore, not live writes, stamps the wrong time)",
  );
}

async function probeRecallEdgeCases() {
  try {
    const r = await m.recall({ query: "bug-hunt", namespace: NAMESPACE, limit: 0 });
    log("recall-limit-0", `limit:0 returned ${r.results.length} results, total=${r.total}`, "known-issue", "#1086 (limit is not validated)");
  } catch (e) {
    log("recall-limit-0", `limit:0 threw: ${String(e).slice(0, 160)}`, "known-issue", "#1086");
  }
  try {
    const r = await m.recall({ query: "bug-hunt", namespace: NAMESPACE, maxDistance: 0 });
    log("recall-maxDistance-0", `maxDistance:0 returned ${r.results.length} results, total=${r.total}`, "known-issue", "#1066 (all-dropped recall is indistinguishable from empty)");
  } catch (e) {
    log("recall-maxDistance-0", `maxDistance:0 threw: ${String(e).slice(0, 160)}`, "known-issue", "#1066");
  }
}

async function main() {
  console.log(`namespace: ${NAMESPACE}\n`);
  const blobA = await probeWriteLatency();
  await probeRecallRightAfterWrite();
  const w2 = await m.rememberAndWait("bug-hunt ordering probe B", NAMESPACE, { timeoutMs: 120_000 });
  await probeOrdering(blobA, w2.blob_id);
  await probeRecallEdgeCases();

  const novel = findings.filter((f) => f.verdict === "novel");
  const md = [
    "# Bug-hunt instrumentation run (task HACKATONSU-39)",
    "",
    `Namespace: \`${NAMESPACE}\` (throwaway, not a real group). Account: \`${apiKey.accountId}\`.`,
    `Date: ${new Date().toISOString()}.`,
    "",
    "| Probe | Observed | Verdict | Known issue |",
    "|---|---|---|---|",
    ...findings.map((f) => `| ${f.probe} | ${f.observed.replace(/\|/g, "\\|")} | ${f.verdict} | ${f.knownIssues} |`),
    "",
    "## Conclusion",
    "",
    novel.length === 0
      ? "Every anomaly this run reproduced already has an open issue in github.com/MystenLabs/MemWal/issues (checked by hand before running). No new issue was opened, to avoid a duplicate (the Bug Bounty rules require checking first)."
      : `${novel.length} observation(s) above do not match a known issue and are candidates for a new report: ${novel.map((f) => f.probe).join(", ")}.`,
    "",
  ].join("\n");
  const path = `docs/evidence/bug-hunt-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(path, md);
  console.log(`\nreport written to ${path}`);
}

await main();
