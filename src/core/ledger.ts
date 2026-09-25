import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseFact, serializeFact, type Fact } from "./fact.js";
import type { LedgerEntry } from "./resolver.js";

// Local ledger: a SQLite cache of every fact plus the state of its write to Walrus.
// Walrus is the durable source of truth; this cache can be deleted and rebuilt (see rebuild.ts).
//
// Write lifecycle of a row:
//   pending   → not yet written to Walrus (or a write failed and is waiting for its retry)
//   uploaded  → written, blob_id known, not yet seen back through recall
//   done      → written and verified through recall
//   failed    → gave up after too many attempts; `requeueFailed` puts it back in the queue

export type WriteStatus = "pending" | "uploaded" | "done" | "failed";

export interface LedgerRow {
  seq: number;
  groupId: string;
  factId: string;
  /** The serialized fact, exactly as written to Walrus. */
  raw: string;
  status: WriteStatus;
  blobId: string | null;
  attempts: number;
  /** ISO instant before which a pending row must not be retried. */
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const SCHEMA_VERSION = 1;

interface DbRow {
  seq: number;
  group_id: string;
  fact_id: string;
  raw: string;
  status: WriteStatus;
  blob_id: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const toRow = (r: DbRow): LedgerRow => ({
  seq: r.seq,
  groupId: r.group_id,
  factId: r.fact_id,
  raw: r.raw,
  status: r.status,
  blobId: r.blob_id,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at,
  lastError: r.last_error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class Ledger {
  private constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        raw TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','uploaded','done','failed')),
        blob_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (group_id, fact_id)
      );
      CREATE INDEX IF NOT EXISTS facts_status ON facts (status, next_attempt_at);
    `);
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  /** Opens (creating it if needed) the ledger at `path`; use ":memory:" for tests. */
  static open(path: string): Ledger {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    if (path !== ":memory:") db.pragma("journal_mode = WAL");
    return new Ledger(db);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Adds a fact to the ledger as `pending`. Idempotent: adding the same fact id again returns the
   * existing row and does not queue a second write. A different fact reusing an id is rejected.
   * If the fact has no `at`, it is stamped with `now`.
   */
  addFact(groupId: string, fact: Fact, now: Date): { row: LedgerRow; inserted: boolean } {
    const existing = this.getRow(groupId, fact.id);
    if (existing) {
      // A caller that did not stamp `at` is retrying the same fact: compare everything except the time.
      const stored = parseFact(existing.raw);
      const same = fact.at === null ? serializeFact({ ...stored, at: null }) === serializeFact(fact) : existing.raw === serializeFact(fact);
      if (!same) throw new LedgerError(`fact id ${fact.id} already exists with different content`);
      return { row: existing, inserted: false };
    }
    const stamped: Fact = fact.at === null ? { ...fact, at: now.toISOString() } : fact;
    const raw = serializeFact(stamped);
    const at = now.toISOString();
    this.db
      .prepare(`INSERT INTO facts (group_id, fact_id, raw, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`)
      .run(groupId, stamped.id, raw, at, at);
    return { row: this.getRow(groupId, stamped.id) as LedgerRow, inserted: true };
  }

  /** Adds a fact that already lives on Walrus (used when rebuilding). Stored as `done`. */
  importFact(groupId: string, fact: Fact, blobId: string, now: Date): { inserted: boolean } {
    const raw = serializeFact(fact);
    if (this.getRow(groupId, fact.id)) return { inserted: false };
    const at = now.toISOString();
    this.db
      .prepare(`INSERT INTO facts (group_id, fact_id, raw, status, blob_id, attempts, created_at, updated_at) VALUES (?, ?, ?, 'done', ?, 0, ?, ?)`)
      .run(groupId, fact.id, raw, blobId, at, at);
    return { inserted: true };
  }

  getRow(groupId: string, factId: string): LedgerRow | undefined {
    const r = this.db.prepare(`SELECT * FROM facts WHERE group_id = ? AND fact_id = ?`).get(groupId, factId) as DbRow | undefined;
    return r ? toRow(r) : undefined;
  }

  /** Facts of a group as resolver input. Ordered by (`at`, insertion order) through `createdAt` and `seq`. */
  entries(groupId: string, options: { includeFailed?: boolean } = {}): LedgerEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM facts WHERE group_id = ? ${options.includeFailed ? "" : "AND status != 'failed'"} ORDER BY seq`)
      .all(groupId) as DbRow[];
    return rows.map((r) => {
      const fact = parseFact(r.raw);
      return { fact, seq: r.seq, createdAt: fact.at ?? r.created_at };
    });
  }

  groups(): string[] {
    return (this.db.prepare(`SELECT DISTINCT group_id FROM facts ORDER BY group_id`).all() as { group_id: string }[]).map((r) => r.group_id);
  }

  /** Pending rows whose retry time has arrived, oldest first. */
  dueForWrite(now: Date): LedgerRow[] {
    return (this.db
      .prepare(`SELECT * FROM facts WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY seq`)
      .all(now.toISOString()) as DbRow[]).map(toRow);
  }

  /** Rows written to Walrus but not yet confirmed through recall. */
  awaitingVerification(): LedgerRow[] {
    return (this.db.prepare(`SELECT * FROM facts WHERE status = 'uploaded' ORDER BY seq`).all() as DbRow[]).map(toRow);
  }

  markUploaded(seq: number, blobId: string, now: Date): void {
    this.db
      .prepare(`UPDATE facts SET status = 'uploaded', blob_id = ?, attempts = attempts + 1, next_attempt_at = NULL, last_error = NULL, updated_at = ? WHERE seq = ?`)
      .run(blobId, now.toISOString(), seq);
  }

  markDone(seq: number, now: Date): void {
    this.db.prepare(`UPDATE facts SET status = 'done', updated_at = ? WHERE seq = ?`).run(now.toISOString(), seq);
  }

  /** A write failed: keep it pending and try again at `nextAttemptAt`. */
  markRetry(seq: number, error: string, nextAttemptAt: Date, now: Date): void {
    this.db
      .prepare(`UPDATE facts SET status = 'pending', attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE seq = ?`)
      .run(error, nextAttemptAt.toISOString(), now.toISOString(), seq);
  }

  markFailed(seq: number, error: string, now: Date): void {
    this.db
      .prepare(`UPDATE facts SET status = 'failed', attempts = attempts + 1, last_error = ?, next_attempt_at = NULL, updated_at = ? WHERE seq = ?`)
      .run(error, now.toISOString(), seq);
  }

  /** Puts failed rows back in the queue with a fresh attempt counter. Returns how many were requeued. */
  requeueFailed(now: Date, groupId?: string): number {
    const stmt = groupId === undefined
      ? this.db.prepare(`UPDATE facts SET status = 'pending', attempts = 0, next_attempt_at = NULL, updated_at = ? WHERE status = 'failed'`)
      : this.db.prepare(`UPDATE facts SET status = 'pending', attempts = 0, next_attempt_at = NULL, updated_at = ? WHERE status = 'failed' AND group_id = ?`);
    return (groupId === undefined ? stmt.run(now.toISOString()) : stmt.run(now.toISOString(), groupId)).changes;
  }

  counts(): Record<WriteStatus, number> {
    const out: Record<WriteStatus, number> = { pending: 0, uploaded: 0, done: 0, failed: 0 };
    for (const r of this.db.prepare(`SELECT status, COUNT(*) AS n FROM facts GROUP BY status`).all() as { status: WriteStatus; n: number }[]) out[r.status] = r.n;
    return out;
  }
}
