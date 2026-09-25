import type { Proposal, ProposalAction } from "../core/proposals.js";

// User-facing texts. English (decision D-08); the final wording is owned by task HACKATONSU-23, so
// every text lives here and nowhere else.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Rule T4: dates shown to users carry the weekday, e.g. "Fri, Sep 25". Input is YYYY-MM-DD. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

export interface Button {
  label: string;
  action: ProposalAction;
}

export interface Rendered {
  text: string;
  buttons: Button[];
}

const YES: Button = { label: "✅ Yes", action: "yes" };
const NO: Button = { label: "✖ No", action: "no" };
const OTHER: Button = { label: "➕ It's another one", action: "other" };

const dueLine = (due: string | null) => (due ? `📅 ${formatDate(due)}` : "📅 No deadline");
const pastWarning = (p: Proposal) => (p.warnings.includes("past-date") ? ["⚠️ This date is in the past"] : []);

/** The message and buttons that ask the group to confirm a proposal. */
export function renderProposal(p: Proposal): Rendered {
  const d = p.draft;
  switch (p.kind) {
    case "record": {
      const title = p.factType === "DECISION" ? "Record this decision?" : "Record this commitment?";
      const lines = [title, ...(d.owner ? [`👤 ${d.owner}`] : []), `📋 ${d.task}`, ...(p.factType === "DECISION" && !d.due ? [] : [dueLine(d.due)]), ...pastWarning(p)];
      return { text: lines.join("\n"), buttons: [YES, NO] };
    }
    case "record-instead": {
      const lines = [`I found no open commitment for ${p.subjectName}. Record it as a new commitment?`, `👤 ${d.owner}`, `📋 ${d.task}`, dueLine(d.due), ...pastWarning(p)];
      return { text: lines.join("\n"), buttons: [YES, NO] };
    }
    case "amend": {
      const dueChange = d.due ? `${p.previousDue ? `${formatDate(p.previousDue)} ` : ""}→ ${formatDate(d.due)}` : null;
      const ownerChange = d.owner ? `owner → ${d.owner}` : null;
      const change = [dueChange, ownerChange].filter(Boolean).join(", ") || `→ ${d.task}`;
      if (p.needsOtherConfirmation) {
        return { text: [`${p.confirmerLabel}, ${p.proposer.name} wants to change "${p.targetLabel}": ${change}. Confirm?`, ...pastWarning(p)].join("\n"), buttons: [YES, NO] };
      }
      return { text: [`Update "${p.targetLabel}": ${change}?`, ...pastWarning(p)].join("\n"), buttons: [YES, OTHER, NO] };
    }
    case "complete": {
      if (p.needsOtherConfirmation) return { text: `${p.confirmerLabel}, ${p.proposer.name} says "${p.targetLabel}" is done. Confirm?`, buttons: [YES, NO] };
      return { text: `Mark "${p.targetLabel}" as completed?`, buttons: [YES, NO] };
    }
  }
}

export function noOpenCommitmentNotice(ownerName: string): string {
  return `I found no open commitment for ${ownerName}.`;
}

export const texts = {
  cancelled: "✖ Cancelled. Nothing was recorded.",
  expired: "This proposal expired, please send it again.",
  alreadyHandled: "This proposal was already handled.",
  notFound: "I can't find this proposal anymore.",
  targetCompleted: "That commitment was completed in the meantime. Nothing was recorded.",
  targetMissing: "I can't find that item anymore. Nothing was recorded.",
  notAllowed: (who: string) => `Only ${who} or an admin can confirm this`,
  written: "✅ Recorded",
  couldNotUnderstand: "Sorry, I couldn't process that message right now. Please try again in a moment.",
} as const;

// ---- callback data: "p:<proposal id>:<y|o|n>" (Telegram allows at most 64 bytes) ------------------

const CODE: Record<ProposalAction, string> = { yes: "y", other: "o", no: "n" };
const ACTION: Record<string, ProposalAction> = { y: "yes", o: "other", n: "no" };

export function callbackData(proposalId: string, action: ProposalAction): string {
  return `p:${proposalId}:${CODE[action]}`;
}

export function parseCallbackData(data: string): { proposalId: string; action: ProposalAction } | null {
  const m = /^p:([0-9a-f]{8}):([yon])$/.exec(data);
  return m ? { proposalId: m[1] as string, action: ACTION[m[2] as string] as ProposalAction } : null;
}
