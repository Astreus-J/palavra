// Memory access layer: one interface for Walrus Memory (real, mainnet) and the offline mock.
//
// Every call is scoped to a group namespace ("grp:<chat_id>"), so one bot account can serve many
// groups without their memories ever mixing. Switching between the mock and the real client is a
// configuration change (MEMWAL_MODE), never a code change.

export interface RecalledMemory {
  blobId: string;
  text: string;
  /** Semantic distance: lower is closer (< 0.25 near-duplicate, 0.25–0.55 related, >= 0.7 unrelated). */
  distance: number;
  /** Write time recorded by the relayer, when available. */
  createdAt: string | null;
}

export interface RecallOptions {
  /** Max memories to return (default 5). */
  limit?: number;
  /** Drop memories at or beyond this distance (default 0.7). */
  maxDistance?: number;
  /** "relevance" (default) or "recent" (newest first among the semantic matches). */
  sort?: "relevance" | "recent";
}

export interface RememberOptions {
  /** How long to wait for the write to reach `done` (default 90 s; real writes take ~25–35 s). */
  timeoutMs?: number;
}

export interface RememberedMemory {
  blobId: string;
  namespace: string;
}

export interface RestoreSummary {
  restored: number;
  skipped: number;
  failed: number;
  total: number;
  /** True when more blobs remain and restore should be called again. */
  truncated: boolean;
}

export interface MemoryStore {
  readonly mode: "mock" | "real";
  /** Writes one fact/text and waits until it is stored. Real writes are immutable blobs. */
  remember(groupId: string, text: string, options?: RememberOptions): Promise<RememberedMemory>;
  recall(groupId: string, query: string, options?: RecallOptions): Promise<RecalledMemory[]>;
  /** Rebuilds the relayer's index for the group from Walrus (used to recover a lost local cache). */
  restore(groupId: string): Promise<RestoreSummary>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export class MemoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MemoryError";
  }
}

const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NAMESPACE_PREFIX = "grp:";

/** "grp:<chat_id>". Telegram group ids are negative numbers, so "-" is allowed. */
export function groupNamespace(groupId: string): string {
  if (!GROUP_ID_RE.test(groupId)) throw new MemoryError(`invalid group id: ${JSON.stringify(groupId)}`);
  return `${NAMESPACE_PREFIX}${groupId}`;
}

/** The subset of the MemWal / MemWalMock client that this layer uses. */
export interface MemWalClient {
  rememberAndWait(text: string, namespace?: string, opts?: { timeoutMs?: number }): Promise<{ blob_id: string; namespace: string }>;
  recall(params: {
    query: string;
    namespace?: string;
    limit?: number;
    maxDistance?: number;
    sort?: "relevance" | "recent";
  }): Promise<{ results: { blob_id: string; text: string; distance: number; created_at?: string }[] }>;
  restore(namespace: string, limit?: number): Promise<{ restored: number; skipped: number; failed: number; total: number; truncated: boolean }>;
  health(): Promise<{ status: string }>;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_DISTANCE = 0.7;
const DEFAULT_WRITE_TIMEOUT_MS = 90_000;

export class SdkMemoryStore implements MemoryStore {
  constructor(
    private readonly client: MemWalClient,
    readonly mode: "mock" | "real",
  ) {}

  async remember(groupId: string, text: string, options: RememberOptions = {}): Promise<RememberedMemory> {
    const namespace = groupNamespace(groupId);
    if (!text.trim()) throw new MemoryError("cannot remember empty text");
    try {
      const r = await this.client.rememberAndWait(text, namespace, { timeoutMs: options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS });
      return { blobId: r.blob_id, namespace: r.namespace };
    } catch (cause) {
      throw new MemoryError(`remember failed in ${namespace}`, { cause });
    }
  }

  async recall(groupId: string, query: string, options: RecallOptions = {}): Promise<RecalledMemory[]> {
    const namespace = groupNamespace(groupId);
    try {
      const { results } = await this.client.recall({
        query,
        namespace,
        limit: options.limit ?? DEFAULT_LIMIT,
        maxDistance: options.maxDistance ?? DEFAULT_MAX_DISTANCE,
        ...(options.sort ? { sort: options.sort } : {}),
      });
      return results.map((r) => ({ blobId: r.blob_id, text: r.text, distance: r.distance, createdAt: r.created_at ?? null }));
    } catch (cause) {
      throw new MemoryError(`recall failed in ${namespace}`, { cause });
    }
  }

  async restore(groupId: string): Promise<RestoreSummary> {
    const namespace = groupNamespace(groupId);
    try {
      const r = await this.client.restore(namespace);
      return { restored: r.restored, skipped: r.skipped, failed: r.failed, total: r.total, truncated: r.truncated };
    } catch (cause) {
      throw new MemoryError(`restore failed in ${namespace}`, { cause });
    }
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const h = await this.client.health();
      return { ok: h.status === "ok", detail: h.status };
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) };
    }
  }
}
