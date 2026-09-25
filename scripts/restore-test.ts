// Recovery test: write facts → delete the SQLite ledger → rebuild it from Walrus → compare the state.
//
//   npm run restore-test                       offline, with the mock (nothing is written to Walrus)
//   npm run restore-test -- --real             Walrus mainnet: writes 8 immutable blobs (takes several minutes)
//   npm run restore-test -- --real --report docs/evidence/restore-test.md
//
// Exit code 0 when the state before and after is identical, 1 otherwise.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createMemoryStore } from "../src/memory/index.js";
import { runRestoreTest, type RecoveryResult, type Snapshot } from "../src/core/recovery.js";
import { buildScenario } from "../src/core/recovery-scenario.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const real = flag("--real");
const cfg = loadConfig({ ...process.env, MEMWAL_MODE: real ? "real" : "mock" });
const store = createMemoryStore(cfg);
const now = new Date();
const groupId = option("--group") ?? `restore-test-${now.toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 8)}`;
const reportPath = option("--report") ?? (real ? `docs/evidence/restore-test-${now.toISOString().slice(0, 10)}.md` : undefined);

const log = (message: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
const walruscan = (blob: string | null) => (blob ? (real ? `[${blob}](${cfg.WALRUSCAN_BLOB_URL}/${blob})` : blob) : "-");

function render(result: RecoveryResult, facts: ReturnType<typeof buildScenario>): string {
  const { before, after, comparison } = result;
  const verdict = comparison.same ? "**PASSED** — the state after the rebuild is identical to the state before." : "**FAILED** — the states differ.";
  const itemRows = (s: Snapshot) => s.items.map((i) => `| \`${i.rootId}\` | ${i.kind} | ${i.status} | ${i.owner ?? "-"} | ${i.due ?? "-"} | ${i.chain.length} | \`${i.current}\` |`).join("\n");
  const factRows = facts.map((f) => `| \`${f.id}\` | ${f.type} | ${f.supersedes ? `\`${f.supersedes}\`` : "-"} | ${walruscan(before.blobs[f.id] ?? null)} | ${before.blobs[f.id] === after.blobs[f.id] ? "same" : "DIFFERENT"} |`).join("\n");
  return `# Restore test — ${now.toISOString().slice(0, 10)}

Result: ${verdict}

| | |
|---|---|
| Mode | ${real ? "**Walrus mainnet** (real writes)" : "mock (offline)"} |
| Account | ${real ? `\`${cfg.MEMWAL_ACCOUNT_ID}\`` : "-"} |
| Group namespace | \`grp:${groupId}\` |
| Facts written | ${facts.length} (${JSON.stringify(result.writeStatuses)}) |
| SQLite deleted before the rebuild | ${result.sqliteDeleted ? "yes" : "NO"} |
| Write time (outbox, incl. verification) | ${(result.timings.writeMs / 1000).toFixed(1)} s |
| Rebuild time | ${(result.timings.rebuildMs / 1000).toFixed(1)} s |
| Rebuild | ${result.rebuild.restoreCalls} restore call(s), ${result.rebuild.queries} recall queries, ${result.rebuild.discovered} facts discovered, ${result.rebuild.imported} imported |

## What was compared
1. The **pending list** (\`/pending\` order): before \`[${before.pending.join(", ")}]\`, after \`[${after.pending.join(", ")}]\`.
2. Every **item and its chain** (status, owner, due date, topic, chain of fact ids, current fact).
3. The **Walrus blob id of every fact**.

### State before (original ledger)
| Item | Kind | Status | Owner | Due | Chain length | Current fact |
|---|---|---|---|---|---|---|
${itemRows(before)}

### State after (ledger rebuilt from Walrus only)
| Item | Kind | Status | Owner | Due | Chain length | Current fact |
|---|---|---|---|---|---|---|
${itemRows(after)}

### Facts and blobs
| Fact | Type | Supersedes | Blob | Blob after rebuild |
|---|---|---|---|---|
${factRows}

${comparison.same ? "No differences found." : `Differences:\n${comparison.differences.map((d) => `- ${d}`).join("\n")}`}

## How to reproduce
\`\`\`bash
npm run restore-test              # offline, mock
npm run restore-test -- --real    # Walrus mainnet: writes ${facts.length} immutable blobs
\`\`\`
`;
}

async function main() {
  if (real) log(`REAL mode: this writes ${8} immutable blobs to Walrus mainnet (account ${cfg.MEMWAL_ACCOUNT_ID?.slice(0, 10)}…), group ${groupId}`);
  const dir = mkdtempSync(join(tmpdir(), "palavra-restore-test-"));
  const facts = buildScenario(now, cfg.DEFAULT_TIMEZONE);
  try {
    const result = await runRestoreTest({
      store,
      dbPath: join(dir, "ledger.db"),
      groupId,
      facts,
      now,
      timeZone: cfg.DEFAULT_TIMEZONE,
      onStep: log,
      onEvent: (e) => log(`outbox event: ${JSON.stringify(e)}`),
    });
    log(`writes: ${JSON.stringify(result.writeStatuses)} in ${(result.timings.writeMs / 1000).toFixed(1)} s`);
    log(`rebuild: ${JSON.stringify(result.rebuild)} in ${(result.timings.rebuildMs / 1000).toFixed(1)} s`);
    log(`pending before: [${result.before.pending}]  after: [${result.after.pending}]`);
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, render(result, facts));
      log(`report written to ${reportPath}`);
    }
    if (result.comparison.same) log("RESULT: PASSED — the state after the rebuild is identical");
    else {
      log("RESULT: FAILED");
      for (const d of result.comparison.differences) console.log(`  - ${d}`);
    }
    process.exitCode = result.comparison.same ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("restore-test crashed:", err);
  process.exit(2);
});
