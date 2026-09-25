import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { newFactId, type Fact, type FactType } from "./fact.js";
import type { Ledger } from "./ledger.js";
import { ownerMatchesUser, sameName, type ChatUser } from "./owner.js";
import { resolveState, todayIn, type ItemState } from "./resolver.js";
import { chooseCandidate, extractFact, type CallOptions, type Candidate } from "../llm/extraction.js";

// Proposals: nothing reaches the ledger or Walrus until the right person confirms it.
//
//   message → extraction (Gemini) → proposal (stored, expires in 24 h) → ✅ by an allowed person → fact in the ledger
//
// The rules are those of docs/PRODUCT.md: authorship and permissions (A1-A6), amendment vs. new
// commitment (M1-M6), deadlines and timezone (D8-D10, T2-T3).

export type ProposalAction = "yes" | "other" | "no";
export type ProposalKind = "record" | "record-instead" | "amend" | "complete";
export type ProposalStatus = "pending" | "confirmed" | "cancelled" | "expired";
export type ProposalWarning = "past-date" | "no-deadline";

export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000; // rule A6

export interface Proposal {
  id: string;
  groupId: string;
  status: ProposalStatus;
  kind: ProposalKind;
  /** The type of the fact written on ✅. */
  factType: FactType;
  proposer: { id: string; name: string };
  /** Who the proposal is about (used in "I found no open commitment for ..."). */
  subjectName: string;
  /** What will be written. `text` is the sentence stored on Walrus. */
  draft: { owner: string | null; task: string; due: string | null; topic: string | null; text: string };
  /** What the model extracted; used by "➕ It's another one" (M4). */
  extracted: { owner: string | null; task: string; due: string | null };
  /** Item being amended or completed. */
  targetRootId: string | null;
  targetLabel: string | null;
  previousDue: string | null;
  /** Rules A3-A5. Admins can always confirm. */
  confirmers: { userIds: string[]; ownerName: string | null };
  /** True when someone other than the proposer must confirm (A4, A5). */
  needsOtherConfirmation: boolean;
  /** "Maria", used in "Only Maria or an admin can confirm this". */
  confirmerLabel: string;
  warnings: ProposalWarning[];
  messageAt: string;
  createdAt: string;
  expiresAt: string;
  confirmedBy: string | null;
  writtenFactId: string | null;
}

export interface IncomingMessage {
  groupId: string;
  author: ChatUser;
  text: string;
  /** When the message was sent. "Today" for relative deadlines comes from here (rule T2). */
  sentAt: Date;
}

export type ProposeOutcome =
  | { kind: "ignored" }
  | { kind: "notice"; notice: "no-open-commitment"; ownerName: string }
  | { kind: "proposal"; proposal: Proposal; model: string; usedFallback: boolean };

export type ConfirmOutcome =
  | { status: "written"; proposal: Proposal; fact: Fact }
  | { status: "cancelled"; proposal: Proposal }
  | { status: "expired"; proposal: Proposal }
  | { status: "already-handled"; proposal: Proposal }
  | { status: "not-found" }
  | { status: "not-allowed"; who: string }
  | { status: "target-changed"; reason: "completed" | "missing"; proposal: Proposal }
  | { status: "invalid-action"; proposal: Proposal };

// ---- storage ------------------------------------------------------------------------------------

/** Pending proposals live in SQLite so their 24 h expiry survives a restart. */
export class ProposalStore {
  private constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS proposals_status ON proposals (status, expires_at);
    `);
  }

  static open(path: string): ProposalStore {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    if (path !== ":memory:") db.pragma("journal_mode = WAL");
    return new ProposalStore(db);
  }

  close(): void {
    this.db.close();
  }

  save(p: Proposal): void {
    this.db
      .prepare(`INSERT INTO proposals (id, group_id, status, expires_at, body) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body`)
      .run(p.id, p.groupId, p.status, p.expiresAt, JSON.stringify(p));
  }

  get(id: string): Proposal | undefined {
    const row = this.db.prepare(`SELECT body FROM proposals WHERE id = ?`).get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Proposal) : undefined;
  }

  /** Marks every pending proposal past its expiry as expired. Returns how many. */
  expireDue(now: Date): number {
    const rows = this.db.prepare(`SELECT body FROM proposals WHERE status = 'pending' AND expires_at <= ?`).all(now.toISOString()) as { body: string }[];
    for (const r of rows) this.save({ ...(JSON.parse(r.body) as Proposal), status: "expired" });
    return rows.length;
  }
}

// ---- helpers ------------------------------------------------------------------------------------

const shorten = (text: string, max = 60) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A one-line description of an item, used as its label in messages and as a candidate for the model. */
function itemLabel(item: ItemState): string {
  return shorten(item.history[0]?.fact.text ?? item.current.text);
}

function candidateFor(item: ItemState): Candidate {
  const parts = [item.kind === "DECISION" ? "decision" : `${item.owner ?? "?"}`, itemLabel(item), item.due ? `due ${item.due}` : "no deadline"];
  return { id: item.rootId, description: parts.join(" | ") };
}

const byDueThenInsertion = (a: ItemState, b: ItemState) =>
  (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99") || (a.history[0]?.seq ?? 0) - (b.history[0]?.seq ?? 0);

function commitmentText(owner: string, task: string, due: string | null): string {
  return `${owner} committed to ${task}.${due ? ` Due ${due}.` : " No deadline."}`;
}

// ---- service ------------------------------------------------------------------------------------

export interface ProposalServiceOptions {
  ledger: Ledger;
  proposals: ProposalStore;
  llm: CallOptions;
  /** IANA timezone of the group (rule T1). */
  timeZone: string;
  now?: () => Date;
  newId?: () => string;
}

export class ProposalService {
  private readonly ledger: Ledger;
  private readonly store: ProposalStore;
  private readonly llm: CallOptions;
  private readonly timeZone: string;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: ProposalServiceOptions) {
    this.ledger = options.ledger;
    this.store = options.proposals;
    this.llm = options.llm;
    this.timeZone = options.timeZone;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomBytes(4).toString("hex"));
  }

  private state(groupId: string): ItemState[] {
    return resolveState(this.ledger.entries(groupId), { now: this.now(), timeZone: this.timeZone }).items;
  }

  /** Reads a message and, when it is worth recording, stores a proposal. Nothing is written to the ledger. */
  async propose(msg: IncomingMessage): Promise<ProposeOutcome> {
    const today = todayIn(msg.sentAt, this.timeZone); // rule T2: the message date, not the confirmation date
    const extraction = await extractFact(msg.text, msg.author.name, today, this.llm);
    const e = extraction.value;
    if (e.type === "NONE") return { kind: "ignored" };

    const task = e.task ?? shorten(msg.text, 80);
    const extracted = { owner: e.owner, task, due: e.due };
    const warnings: ProposalWarning[] = [];
    if (e.due === null && e.type === "COMMITMENT") warnings.push("no-deadline"); // D8
    if (e.due !== null && e.due < today && (e.type === "COMMITMENT" || e.type === "AMENDMENT")) warnings.push("past-date"); // D9

    const base = {
      id: this.newId(),
      groupId: msg.groupId,
      status: "pending" as const,
      proposer: { id: msg.author.id, name: msg.author.name },
      extracted,
      warnings,
      messageAt: msg.sentAt.toISOString(),
      createdAt: this.now().toISOString(),
      expiresAt: new Date(this.now().getTime() + PROPOSAL_TTL_MS).toISOString(), // A6
      confirmedBy: null,
      writtenFactId: null,
    };
    const own = { userIds: [msg.author.id], ownerName: null }; // A3: the author of the message, or an admin
    const finish = (proposal: Proposal): ProposeOutcome => {
      this.store.save(proposal);
      return { kind: "proposal", proposal, model: extraction.model, usedFallback: extraction.usedFallback };
    };

    if (e.type === "DECISION") {
      const draft = { owner: e.owner, task, due: e.due, topic: null, text: `The group decided: ${task}.${e.due ? ` Date ${e.due}.` : ""}` };
      return finish({ ...base, kind: "record", factType: "DECISION", subjectName: msg.author.name, draft, targetRootId: null, targetLabel: null, previousDue: null, confirmers: own, needsOtherConfirmation: false, confirmerLabel: msg.author.name });
    }

    const ownerName = e.owner ?? msg.author.name;
    if (e.type === "COMMITMENT") {
      const draft = { owner: ownerName, task, due: e.due, topic: null, text: commitmentText(ownerName, task, e.due) };
      return finish({ ...base, kind: "record", factType: "COMMITMENT", subjectName: ownerName, draft, targetRootId: null, targetLabel: null, previousDue: null, confirmers: own, needsOtherConfirmation: false, confirmerLabel: msg.author.name });
    }

    // AMENDMENT or COMPLETION: the code builds the candidate list; the model only chooses among it (M3).
    const items = this.state(msg.groupId);
    const wanted = (item: ItemState) =>
      item.kind === "COMMITMENT" && item.status !== "completed" && (sameName(item.owner, e.owner) || ownerMatchesUser(item.owner, msg.author));
    const pool = items.filter(wanted);
    if (e.type === "AMENDMENT") pool.push(...items.filter((i) => i.kind === "DECISION")); // a decision changes only through an amendment (M6)
    pool.sort(byDueThenInsertion);

    let target: ItemState | undefined;
    if (pool.length === 1) target = pool[0];
    else if (pool.length > 1) {
      const choice = await chooseCandidate(msg.text, msg.author.name, pool.map(candidateFor), this.llm);
      target = pool.find((i) => i.rootId === choice.value);
    }

    if (!target) {
      if (e.type === "COMPLETION") return { kind: "notice", notice: "no-open-commitment", ownerName }; // M5
      const draft = { owner: ownerName, task, due: e.due, topic: null, text: commitmentText(ownerName, task, e.due) };
      return finish({ ...base, kind: "record-instead", factType: "COMMITMENT", subjectName: ownerName, draft, targetRootId: null, targetLabel: null, previousDue: null, confirmers: own, needsOtherConfirmation: false, confirmerLabel: msg.author.name });
    }

    const label = itemLabel(target);
    const isDecision = target.kind === "DECISION";
    const decisionAuthor = target.history[0]?.fact.author ?? "";
    // A4/A5: direct when the sender is the owner (or the author of the decision) or an admin; otherwise they need to confirm.
    const direct = msg.author.isAdmin || (isDecision ? decisionAuthor === msg.author.id : ownerMatchesUser(target.owner, msg.author));
    const confirmers = direct ? own : isDecision ? { userIds: [decisionAuthor], ownerName: null } : { userIds: [], ownerName: target.owner };
    const confirmerLabel = direct ? msg.author.name : isDecision ? "The author of this decision" : (target.owner ?? "The owner");
    const common = { ...base, subjectName: ownerName, targetRootId: target.rootId, targetLabel: label, previousDue: target.due, confirmers, needsOtherConfirmation: !direct, confirmerLabel };

    if (e.type === "COMPLETION") {
      const who = target.owner ?? ownerName;
      return finish({ ...common, kind: "complete", factType: "COMPLETION", draft: { owner: null, task, due: null, topic: null, text: `${who} completed "${label}".` } });
    }

    // AMENDMENT: only what changed is stated; the resolver inherits the rest.
    const newOwner = e.owner && !sameName(e.owner, target.owner) ? e.owner : null;
    const parts = [e.due ? `new due ${e.due}` : null, newOwner ? `new owner ${newOwner}` : null].filter(Boolean);
    const text = `Amendment of "${label}": ${parts.length > 0 ? parts.join(", ") : task}.`;
    return finish({ ...common, kind: "amend", factType: "AMENDMENT", draft: { owner: newOwner, task, due: e.due, topic: null, text } });
  }

  /** Applies a button press. Only here does a fact enter the ledger. */
  confirm(proposalId: string, presser: ChatUser, action: ProposalAction): ConfirmOutcome {
    const now = this.now();
    const proposal = this.store.get(proposalId);
    if (!proposal) return { status: "not-found" };
    if (proposal.status !== "pending") return { status: "already-handled", proposal };
    if (now.getTime() >= new Date(proposal.expiresAt).getTime()) {
      const expired = { ...proposal, status: "expired" as const };
      this.store.save(expired);
      return { status: "expired", proposal: expired }; // A6
    }

    // A3: only the allowed people or a group admin can press.
    const allowed =
      presser.isAdmin ||
      proposal.confirmers.userIds.includes(presser.id) ||
      (proposal.confirmers.ownerName !== null && ownerMatchesUser(proposal.confirmers.ownerName, presser));
    if (!allowed) return { status: "not-allowed", who: proposal.confirmerLabel };

    if (action === "no") {
      const cancelled = { ...proposal, status: "cancelled" as const, confirmedBy: presser.id };
      this.store.save(cancelled);
      return { status: "cancelled", proposal: cancelled };
    }
    if (action === "other" && proposal.kind !== "amend") return { status: "invalid-action", proposal };

    // "➕ It's another one" (M4): a new commitment that supersedes nothing.
    let fact: Fact;
    const confirmedNote = presser.id === proposal.proposer.id ? "" : ` Confirmed by ${presser.name}.`;
    if (action === "other") {
      const owner = proposal.extracted.owner ?? proposal.proposer.name;
      fact = this.buildFact(proposal, "COMMITMENT", null, owner, proposal.extracted.due, commitmentText(owner, proposal.extracted.task, proposal.extracted.due) + confirmedNote, now);
    } else if (proposal.kind === "record" || proposal.kind === "record-instead") {
      fact = this.buildFact(proposal, proposal.factType, null, proposal.draft.owner, proposal.draft.due, proposal.draft.text + confirmedNote, now);
    } else {
      // amend / complete: re-read the state, the item may have changed since the proposal was made.
      const item = this.state(proposal.groupId).find((i) => i.rootId === proposal.targetRootId);
      if (!item) return { status: "target-changed", reason: "missing", proposal };
      if (item.status === "completed") return { status: "target-changed", reason: "completed", proposal };
      fact = this.buildFact(proposal, proposal.factType, item.current.id, proposal.draft.owner, proposal.draft.due, proposal.draft.text + confirmedNote, now);
    }

    this.ledger.addFact(proposal.groupId, fact, now);
    const confirmed = { ...proposal, status: "confirmed" as const, confirmedBy: presser.id, writtenFactId: fact.id };
    this.store.save(confirmed);
    return { status: "written", proposal: confirmed, fact };
  }

  private buildFact(p: Proposal, type: FactType, supersedes: string | null, owner: string | null, due: string | null, text: string, now: Date): Fact {
    // `author` stays the person who wrote the message, even when someone else confirmed it (A4).
    return { id: newFactId(type), type, supersedes, author: p.proposer.id, owner, due, topic: p.draft.topic, at: now.toISOString(), text: text.trim() };
  }
}
