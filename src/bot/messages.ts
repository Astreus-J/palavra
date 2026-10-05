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

const REGISTER: Button = { label: "Register", action: "yes" };
const CANCEL: Button = { label: "Cancel", action: "no" };
const OTHER: Button = { label: "It's another one", action: "other" };
const CHANGE: Button = { label: "Yes, change it", action: "yes" };
const COMPLETE: Button = { label: "Complete", action: "yes" };
const PERMANENT = "⚠️ This record will be permanent and cannot be deleted later.";

const dueLine = (due: string | null) => (due ? `Due: ${formatDate(due)}` : "Due: no deadline");
const pastWarning = (p: Proposal) => (p.warnings.includes("past-date") ? ["⚠️ This date is in the past"] : []);

/** The message and buttons that ask the group to confirm a proposal. */
export function renderProposal(p: Proposal): Rendered {
  const d = p.draft;
  switch (p.kind) {
    case "record": {
      const isDecision = p.factType === "DECISION";
      const lines = [
        isDecision ? "Got it, a decision:" : "Got it, a commitment:",
        "",
        `${d.task}`,
        "",
        ...(d.owner ? [`Owner: ${d.owner}.`] : []),
        ...(isDecision && !d.due ? [] : [dueLine(d.due)]),
        ...pastWarning(p),
        "",
        "Shall I record it?",
        PERMANENT,
      ];
      return { text: lines.join("\n"), buttons: [REGISTER, CANCEL] };
    }
    case "record-instead": {
      const lines = [`I couldn't find an open commitment for ${p.subjectName}.`, "", `${d.task}`, "", `Owner: ${d.owner}.`, dueLine(d.due), ...pastWarning(p), "", "Record it as a new commitment?"];
      return { text: lines.join("\n"), buttons: [REGISTER, CANCEL] };
    }
    case "amend": {
      const dueChange = d.due ? `${p.previousDue ? `${formatDate(p.previousDue)} ` : ""}→ ${formatDate(d.due)}` : null;
      const ownerChange = d.owner ? `owner → ${d.owner}` : null;
      const change = [dueChange, ownerChange].filter(Boolean).join(", ") || `→ ${d.task}`;
      if (p.needsOtherConfirmation) {
        return { text: [`${p.confirmerLabel}, ${p.proposer.name} wants to change "${p.targetLabel}": ${change}. Confirm?`, ...pastWarning(p)].join("\n"), buttons: [REGISTER, CANCEL] };
      }
      return {
        text: ["Got it, a change:", "", `${p.targetLabel}: ${change}`, "", "Is this the commitment you want to change?", ...pastWarning(p), "", PERMANENT].join("\n"),
        buttons: [CHANGE, OTHER, CANCEL],
      };
    }
    case "complete": {
      if (p.needsOtherConfirmation) return { text: `${p.confirmerLabel}, ${p.proposer.name} says "${p.targetLabel}" is done. Confirm?`, buttons: [REGISTER, CANCEL] };
      return { text: ["Got it, this commitment is done:", "", `${p.targetLabel}`, "", "Record the completion?", PERMANENT].join("\n"), buttons: [COMPLETE, CANCEL] };
    }
  }
}

export function noOpenCommitmentNotice(ownerName: string): string {
  return `I found no open commitment for ${ownerName}.`;
}

export const texts = {
  cancelled: "Record cancelled.",
  expired: "This proposal expired, please send it again.",
  alreadyHandled: "This proposal was already handled.",
  notFound: "I can't find this proposal anymore.",
  targetCompleted: "That commitment was completed in the meantime. Nothing was recorded.",
  targetMissing: "I can't find that item anymore. Nothing was recorded.",
  notAllowed: (who: string) => `Only ${who} or an admin can confirm this`,
  written: "✅ Recorded.",
  saving: "⏳ Saving the record...",
  changeSaving: "⏳ Saving the change...",
  changeSaved: "✅ Change recorded.",
  completionSaved: "✅ Commitment completed.",
  noMatchingCommitment: "I couldn't find an open commitment that matches this change.",
  couldNotUnderstand: "I couldn't understand what should be recorded. Try writing the decision or commitment more directly.",
  saveFailed: "⚠️ I couldn't save the record right now. Try again in a few moments.",
  genericError: "⚠️ I couldn't complete this action right now. Try again.",
  dataUnavailable: "⚠️ I couldn't access this information right now. Try again in a few moments.",
  quotaExhausted: "I've reached my daily limit of AI requests, so I can't read new messages right now. Nothing was lost: please try again later.",
} as const;

// ---- callback data: "p:<proposal id>:<y|o|n>" and "h:<item id>" (Telegram allows at most 64 bytes) ----

const CODE: Record<ProposalAction, string> = { yes: "y", other: "o", no: "n" };
const ACTION: Record<string, ProposalAction> = { y: "yes", o: "other", n: "no" };

export function callbackData(proposalId: string, action: ProposalAction): string {
  return `p:${proposalId}:${CODE[action]}`;
}

/** Tapping an item in the /history list. */
export function historyCallbackData(rootId: string): string {
  return `h:${rootId}`;
}

export function parseHistoryCallback(data: string): string | null {
  const m = /^h:([dcak]_[0-9a-f]{8})$/.exec(data);
  return m ? (m[1] as string) : null;
}

export function parseCallbackData(data: string): { proposalId: string; action: ProposalAction } | null {
  const m = /^p:([0-9a-f]{8}):([yon])$/.exec(data);
  return m ? { proposalId: m[1] as string, action: ACTION[m[2] as string] as ProposalAction } : null;
}
