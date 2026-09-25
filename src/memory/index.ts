import { MemWal, MemWalMock } from "@mysten-incubation/memwal";
import type { Config } from "../config.js";
import { MemoryError, SdkMemoryStore, type MemoryStore } from "./store.js";

export * from "./store.js";

// Default namespace of the SDK client. Every call passes its own group namespace explicitly.
const CLIENT_NAMESPACE = "palavra";

/** Builds the store selected by MEMWAL_MODE: "mock" (offline, no keys) or "real" (Walrus mainnet). */
export function createMemoryStore(cfg: Pick<Config, "MEMWAL_MODE" | "MEMWAL_PRIVATE_KEY" | "MEMWAL_ACCOUNT_ID" | "MEMWAL_SERVER_URL">): MemoryStore {
  if (cfg.MEMWAL_MODE === "mock") {
    return new SdkMemoryStore(MemWalMock.create({ namespace: CLIENT_NAMESPACE }), "mock");
  }
  if (!cfg.MEMWAL_PRIVATE_KEY || !cfg.MEMWAL_ACCOUNT_ID) {
    throw new MemoryError("MEMWAL_MODE=real requires MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID");
  }
  const client = MemWal.create({
    key: cfg.MEMWAL_PRIVATE_KEY,
    accountId: cfg.MEMWAL_ACCOUNT_ID,
    serverUrl: cfg.MEMWAL_SERVER_URL,
    namespace: CLIENT_NAMESPACE,
  });
  return new SdkMemoryStore(client, "real");
}
