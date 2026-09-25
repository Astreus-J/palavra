import { ExtractionError } from "../llm/extraction.js";
import type { Ledger } from "../core/ledger.js";
import type { ChatUser } from "../core/owner.js";
import type { Proposal, ProposalService } from "../core/proposals.js";
import { resolveState } from "../core/resolver.js";
import { noOpenCommitmentNotice, texts } from "./messages.js";
import { renderHistory, renderPending } from "./render.js";

// Routes an incoming Telegram message. The bot only reads messages that start with a command or
// mention it; everything else is ignored (privacy: it never processes ordinary group chatter).

export interface MessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface Incoming {
  /** Chat id as a string (negative for groups). It is also the group's memory namespace. */
  groupId: string;
  author: ChatUser;
  text: string;
  sentAt: Date;
  entities?: readonly MessageEntity[];
}

export type Reply =
  | { kind: "text"; text: string; html?: boolean }
  | { kind: "proposal"; proposal: Proposal };

export interface RouterDeps {
  service: ProposalService;
  ledger: Ledger;
  timeZone: string;
  botUsername: string;
  /** Base URL of the proof links (Walruscan). */
  proofBaseUrl: string;
  now?: () => Date;
}

export const START_TEXT = `👋 I'm Palavra. I keep track of what your group decides and who committed to what.

• /palavra &lt;text&gt; or @{bot} &lt;text&gt;: record a decision or commitment
• /pending: open commitments
• /history &lt;topic&gt;: how something changed, with proof

⚠️ Everything I record is written to Walrus, a decentralized storage network. Records can be verified by anyone and <b>cannot be edited or deleted</b>. Please don't write passwords or private data.

I only read messages that start with a command or mention me.`;

const USAGE_PALAVRA = "Tell me what to record. Example: /palavra I'll send the budget by Friday";
const USAGE_HISTORY = "Tell me which topic. Example: /history budget";
const NOTHING_TO_RECORD = "I couldn't find a decision or a commitment in that message.";

/** `/cmd`, `/cmd@bot`, `/cmd args`. Commands addressed to another bot (`/cmd@other`) are ignored. */
export function parseCommand(text: string, botUsername: string): { command: string; args: string } | null {
  const m = /^\/([A-Za-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  if (m[2] && m[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return { command: (m[1] as string).toLowerCase(), args: (m[3] ?? "").trim() };
}

/** The message text without the bot mention, or null when the bot was not mentioned. */
export function stripMention(text: string, botUsername: string, entities: readonly MessageEntity[] = []): string | null {
  const handle = `@${botUsername}`.toLowerCase();
  const mentions = entities.filter((e) => e.type === "mention" && text.slice(e.offset, e.offset + e.length).toLowerCase() === handle);
  const pattern = new RegExp(`@${botUsername}\\b`, "gi");
  if (mentions.length === 0 && !pattern.test(text)) return null;
  return text.replace(new RegExp(`@${botUsername}\\b`, "gi"), "").replace(/\s+/g, " ").trim();
}

const text = (t: string, html = false): Reply => ({ kind: "text", text: t, ...(html ? { html: true } : {}) });

export async function handleIncoming(deps: RouterDeps, msg: Incoming): Promise<Reply[]> {
  const now = deps.now ?? (() => new Date());
  const command = parseCommand(msg.text, deps.botUsername);

  if (command) {
    switch (command.command) {
      case "start":
      case "help":
        return [text(START_TEXT.replace("{bot}", deps.botUsername), true)];
      case "palavra":
        return command.args === "" ? [text(USAGE_PALAVRA)] : propose(deps, msg, command.args);
      case "pending":
        return [text(renderPending(resolveState(deps.ledger.entries(msg.groupId), { now: now(), timeZone: deps.timeZone }).items), true)];
      case "history": {
        if (command.args === "") return [text(USAGE_HISTORY)];
        const items = resolveState(deps.ledger.entries(msg.groupId), { now: now(), timeZone: deps.timeZone }).items;
        return [text(renderHistory(items, command.args, { ledger: deps.ledger, groupId: msg.groupId, timeZone: deps.timeZone, proofBaseUrl: deps.proofBaseUrl }), true)];
      }
      default:
        return []; // a command we do not know: not ours to answer
    }
  }

  const mentioned = stripMention(msg.text, deps.botUsername, msg.entities);
  if (mentioned === null) return []; // ordinary chatter: ignored
  return mentioned === "" ? [text(USAGE_PALAVRA)] : propose(deps, msg, mentioned);
}

async function propose(deps: RouterDeps, msg: Incoming, content: string): Promise<Reply[]> {
  try {
    const outcome = await deps.service.propose({ groupId: msg.groupId, author: msg.author, text: content, sentAt: msg.sentAt });
    switch (outcome.kind) {
      case "ignored":
        return [text(NOTHING_TO_RECORD)];
      case "notice":
        return [text(noOpenCommitmentNotice(outcome.ownerName))];
      case "proposal":
        return [{ kind: "proposal", proposal: outcome.proposal }];
    }
  } catch (error) {
    if (error instanceof ExtractionError) return [text(texts.couldNotUnderstand)];
    throw error;
  }
}
