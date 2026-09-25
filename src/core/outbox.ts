import type { Ledger, LedgerRow } from "./ledger.js";
import type { MemoryStore } from "../memory/store.js";

// Outbox: moves facts from the ledger to Walrus, safely.
//
// Writes to Walrus are asynchronous and slow (~25–35 s), and reads can come back empty right after
// a write. So a fact is `pending` until the write succeeds (`uploaded`, with its blob_id) and only
// `done` once recall returns it. Failed writes are retried on a growing schedule, and a retry never
// writes the same fact twice (idempotency key + a look at what is already stored).

/** Backoff between attempts. The first steps are the ones reported by the community; the last repeats. */
export const RETRY_DELAYS_MS = [600, 2_000, 3_000, 10_000, 30_000, 60_000, 120_000] as const;
/** Waits between the checks that a written fact can be read back. */
export const VERIFY_DELAYS_MS = [600, 2_000, 3_000] as const;
export const DEFAULT_MAX_ATTEMPTS = 8;

export interface OutboxOptions {
  store: MemoryStore;
  ledger: Ledger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  retryDelaysMs?: readonly number[];
  verifyDelaysMs?: readonly number[];
  /** Called for every problem worth logging (failed write, unverified fact, ...). */
  onEvent?: (event: OutboxEvent) => void;
}

export type OutboxEvent =
  | { type: "write-failed"; factId: string; groupId: string; attempts: number; error: string; willRetryAt: string | null }
  | { type: "adopted-existing"; factId: string; groupId: string; blobId: string }
  | { type: "unverified"; factId: string; groupId: string; blobId: string };

export interface FlushReport {
  written: number;
  verified: number;
  retryScheduled: number;
  failed: number;
  /** Written but not (yet) readable through recall; checked again on the next flush. */
  unverified: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class Outbox {
  private readonly store: MemoryStore;
  private readonly ledger: Ledger;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly retryDelays: readonly number[];
  private readonly verifyDelays: readonly number[];
  private readonly onEvent: (event: OutboxEvent) => void;
  private flushing: Promise<FlushReport> | null = null;

  constructor(options: OutboxOptions) {
    this.store = options.store;
    this.ledger = options.ledger;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? realSleep;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.verifyDelays = options.verifyDelaysMs ?? VERIFY_DELAYS_MS;
    this.onEvent = options.onEvent ?? (() => undefined);
  }

  /** Delay before attempt number `attempts + 1`, after `attempts` failures. */
  retryDelay(attempts: number): number {
    return this.retryDelays[Math.min(attempts, this.retryDelays.length) - 1] ?? 0;
  }

  /** Processes everything that is due. Concurrent calls share one run, so nothing is written twice. */
  flush(): Promise<FlushReport> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(): Promise<FlushReport> {
    const report: FlushReport = { written: 0, verified: 0, retryScheduled: 0, failed: 0, unverified: 0 };

    // Facts written in an earlier run that could not be read back yet.
    for (const row of this.ledger.awaitingVerification()) {
      if (await this.verify(row)) report.verified++;
      else report.unverified++;
    }

    for (const row of this.ledger.dueForWrite(this.now())) {
      const written = await this.write(row);
      if (written === "failed") report.failed++;
      else if (written === "retry") report.retryScheduled++;
      else {
        report.written++;
        const uploaded = this.ledger.getRow(row.groupId, row.factId) as LedgerRow;
        if (await this.verify(uploaded)) report.verified++;
        else report.unverified++;
      }
    }
    return report;
  }

  private async write(row: LedgerRow): Promise<"ok" | "retry" | "failed"> {
    try {
      // A previous attempt may have written the fact even though it reported an error (for example a
      // timeout). Adopt the stored blob instead of writing a duplicate.
      const existing = row.attempts > 0 ? await this.findStored(row) : null;
      if (existing) {
        this.ledger.markUploaded(row.seq, existing, this.now());
        this.onEvent({ type: "adopted-existing", factId: row.factId, groupId: row.groupId, blobId: existing });
        return "ok";
      }
      const written = await this.store.remember(row.groupId, row.raw, { idempotencyKey: `${row.groupId}:${row.factId}` });
      this.ledger.markUploaded(row.seq, written.blobId, this.now());
      return "ok";
    } catch (error) {
      const attempts = row.attempts + 1;
      const now = this.now();
      if (attempts >= this.maxAttempts) {
        this.ledger.markFailed(row.seq, message(error), now);
        this.onEvent({ type: "write-failed", factId: row.factId, groupId: row.groupId, attempts, error: message(error), willRetryAt: null });
        return "failed";
      }
      const next = new Date(now.getTime() + this.retryDelay(attempts));
      this.ledger.markRetry(row.seq, message(error), next, now);
      this.onEvent({ type: "write-failed", factId: row.factId, groupId: row.groupId, attempts, error: message(error), willRetryAt: next.toISOString() });
      return "retry";
    }
  }

  /** Looks for this exact fact already stored on Walrus. Errors mean "not found": the write will be tried. */
  private async findStored(row: LedgerRow): Promise<string | null> {
    try {
      const found = await this.store.recall(row.groupId, row.raw, { limit: 5, maxDistance: 0.5 });
      return found.find((m) => m.text === row.raw)?.blobId ?? null;
    } catch {
      return null;
    }
  }

  /** Waits (0.6 s, 2 s, 3 s) for recall to return the written fact; marks it `done` when it does. */
  private async verify(row: LedgerRow): Promise<boolean> {
    for (let i = 0; i <= this.verifyDelays.length; i++) {
      try {
        const found = await this.store.recall(row.groupId, row.raw, { limit: 5, maxDistance: 0.5 });
        if (found.some((m) => m.blobId === row.blobId || m.text === row.raw)) {
          this.ledger.markDone(row.seq, this.now());
          return true;
        }
      } catch {
        // a failed read counts as "not yet"; try again after the wait
      }
      const wait = this.verifyDelays[i];
      if (wait !== undefined) await this.sleep(wait);
    }
    this.onEvent({ type: "unverified", factId: row.factId, groupId: row.groupId, blobId: row.blobId ?? "" });
    return false;
  }
}
