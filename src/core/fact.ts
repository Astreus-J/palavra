import { randomBytes } from "node:crypto";

// Fact model v1: the unit of memory written to Walrus. See docs/FACT-MODEL.md.
//
//   [COMMITMENT v1] id=c_7f3a9b21 supersedes=- author=tg%3A123456 owner=Maria due=2026-09-26 topic=- at=2026-09-25T10%3A00%3A00.000Z
//   Maria committed to sending the budget by Friday, 2026-09-26.
//
// The first line is a machine-readable header; the rest is a human-readable sentence
// (good for embeddings and for showing to users).

export const FACT_TYPES = ["DECISION", "COMMITMENT", "AMENDMENT", "COMPLETION"] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const FACT_VERSION = 1;

export interface Fact {
  id: string;
  type: FactType;
  /** Id of the fact this one changes or closes. Required for AMENDMENT and COMPLETION. */
  supersedes: string | null;
  /** Who wrote the message (channel-scoped id, e.g. "tg:123456"). */
  author: string;
  /** Who is responsible. Required for COMMITMENT; may differ from the author. */
  owner: string | null;
  /** Deadline as an ISO calendar date (YYYY-MM-DD) in the group's timezone. */
  due: string | null;
  /** Optional explicit topic key, e.g. "delivery" (used by /decisions, P1). */
  topic: string | null;
  /**
   * When the message happened, as an ISO instant with milliseconds ("2026-09-25T10:00:00.000Z").
   * It orders facts independently of when Walrus finished writing them, so a ledger rebuilt from
   * Walrus resolves to the same state. Stamped by the ledger when a fact is added.
   */
  at: string | null;
  /** Human-readable sentence. */
  text: string;
}

export class FactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactError";
  }
}

const ID_PREFIX: Record<FactType, string> = { DECISION: "d", COMMITMENT: "c", AMENDMENT: "a", COMPLETION: "k" };
const ID_RE = /^[dcak]_[0-9a-f]{8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEADER_RE = /^\[([A-Z]+) v(\d+)\]((?: [a-z]+=\S*)*)$/;
const NULL_TOKEN = "-";
const KEYS = ["id", "supersedes", "author", "owner", "due", "topic", "at"] as const;

export function newFactId(type: FactType): string {
  return `${ID_PREFIX[type]}_${randomBytes(4).toString("hex")}`;
}

export function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidInstant(value: string): boolean {
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}

// A literal "-" is escaped so it never collides with the null token.
const enc = (v: string | null): string => (v === null ? NULL_TOKEN : v === NULL_TOKEN ? "%2D" : encodeURIComponent(v));
const dec = (v: string): string | null => (v === NULL_TOKEN ? null : decodeURIComponent(v));

/** Throws FactError when the fact breaks the v1 rules. */
export function validateFact(fact: Fact): void {
  if (!FACT_TYPES.includes(fact.type)) throw new FactError(`unknown fact type: ${String(fact.type)}`);
  if (!ID_RE.test(fact.id)) throw new FactError(`invalid id: ${fact.id}`);
  if (!fact.author.trim()) throw new FactError("author is required");
  if (!fact.text.trim()) throw new FactError("text is required");
  if (fact.due !== null && !isValidIsoDate(fact.due)) throw new FactError(`invalid due date: ${fact.due}`);
  if (fact.at !== null && !isValidInstant(fact.at)) throw new FactError(`invalid at instant: ${fact.at}`);
  if (fact.supersedes !== null && !ID_RE.test(fact.supersedes)) throw new FactError(`invalid supersedes id: ${fact.supersedes}`);
  if (fact.supersedes === fact.id) throw new FactError("a fact cannot supersede itself");

  const chained = fact.type === "AMENDMENT" || fact.type === "COMPLETION";
  if (chained && fact.supersedes === null) throw new FactError(`${fact.type} requires supersedes`);
  if (!chained && fact.supersedes !== null) throw new FactError(`${fact.type} must not have supersedes (use AMENDMENT to change it)`);
  if (fact.type === "COMMITMENT" && !fact.owner?.trim()) throw new FactError("COMMITMENT requires owner");
}

export function serializeFact(fact: Fact): string {
  validateFact(fact);
  const values: Record<(typeof KEYS)[number], string | null> = {
    id: fact.id,
    supersedes: fact.supersedes,
    author: fact.author,
    owner: fact.owner,
    due: fact.due,
    topic: fact.topic,
    at: fact.at,
  };
  const pairs = KEYS.map((k) => `${k}=${enc(values[k])}`).join(" ");
  return `[${fact.type} v${FACT_VERSION}] ${pairs}\n${fact.text.trim()}`;
}

/** Cheap check used to skip memories that are not facts (e.g. written by other tools). */
export function looksLikeFact(text: string): boolean {
  return /^\[(DECISION|COMMITMENT|AMENDMENT|COMPLETION) v\d+\] /.test(text);
}

/** Parses a serialized fact. Throws FactError on anything malformed or invalid. */
export function parseFact(raw: string): Fact {
  const newline = raw.indexOf("\n");
  const header = (newline === -1 ? raw : raw.slice(0, newline)).trimEnd();
  const text = newline === -1 ? "" : raw.slice(newline + 1).trim();

  const m = HEADER_RE.exec(header);
  if (!m) throw new FactError("malformed fact header");
  const [, type, version, rest = ""] = m;
  if (!FACT_TYPES.includes(type as FactType)) throw new FactError(`unknown fact type: ${type}`);
  if (Number(version) !== FACT_VERSION) throw new FactError(`unsupported fact version: v${version}`);

  const found = new Map<string, string>();
  for (const pair of rest.trim().split(" ").filter(Boolean)) {
    const eq = pair.indexOf("=");
    const key = pair.slice(0, eq);
    if (!(KEYS as readonly string[]).includes(key)) throw new FactError(`unknown header key: ${key}`);
    if (found.has(key)) throw new FactError(`duplicate header key: ${key}`);
    found.set(key, pair.slice(eq + 1));
  }
  for (const key of ["id", "supersedes", "author"] as const) {
    if (!found.has(key)) throw new FactError(`missing header key: ${key}`);
  }

  const get = (key: (typeof KEYS)[number]): string | null => {
    const value = found.get(key);
    if (value === undefined) return null;
    try {
      return dec(value);
    } catch {
      throw new FactError(`invalid encoding in header key: ${key}`);
    }
  };

  const fact: Fact = {
    id: get("id") ?? "",
    type: type as FactType,
    supersedes: get("supersedes"),
    author: get("author") ?? "",
    owner: get("owner"),
    due: get("due"),
    topic: get("topic"),
    at: get("at"),
    text,
  };
  validateFact(fact);
  return fact;
}
