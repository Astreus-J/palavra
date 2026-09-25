import { ExtractionError } from "../llm/extraction.js";
import type { Ledger } from "../core/ledger.js";
import type { ChatUser } from "../core/owner.js";
import type { Proposal, ProposalService } from "../core/proposals.js";
import { resolveState } from "../core/resolver.js";
import { shorten } from "../core/labels.js";
import { historyCallbackData, noOpenCommitmentNotice, texts } from "./messages.js";
import { escapeHtml, renderHistory, renderItemHistory, renderPending, renderRecent } from "./render.js";

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

export interface ReplyButton {
  label: string;
  /** Telegram callback data. */
  data: string;
}

export type Reply =
  | { kind: "text"; text: string; html?: boolean; /** One button per row. */ buttons?: ReplyButton[] }
  | { kind: "proposal"; proposal: Proposal };

export interface RouterDeps {
  service: ProposalService;
  ledger: Ledger;
  timeZone: string;
  botUsername: string;
  /** Base URL of the proof links (Walruscan). */
  proofBaseUrl: string;
  now?: () => Date;
  /** Called when the model could not be reached or answered nonsense (the user only sees an apology). */
  onExtractionError?(error: ExtractionError): void;
}

export const START_TEXT = `👋 I'm <b>Palavra</b>. I keep your group's word: what you decide, who committed to what, and what changed. And I can prove it later.

<b>How to record something</b>
Type /palavra followed by a sentence, or mention me (@{bot}). You can write in English or Portuguese. Examples:
• /palavra I'll send the budget by Friday  (a commitment)
• /palavra Pedro will finish the backend by the 30th  (a commitment for someone else)
• /palavra We decided the launch is on October 12  (a decision)
• @{bot} actually I'll send it Saturday  (changes a deadline)
• @{bot} I finished the budget  (marks it as done)

I show what I understood, and <b>nothing is saved until you tap ✅</b>.

<b>Commands</b>
/pending: what is still open and what is overdue
/history: pick an item to see how it changed, with proof
/palavra: record something (see above)

⚠️ Everything I record is written to Walrus, a decentralized storage network. Records can be verified by anyone and <b>cannot be edited or deleted</b>. Please don't write passwords or private data.

I only read messages that start with a command or mention me.`;

const USAGE_PALAVRA = `Tell me what to record. Examples:
/palavra I'll send the budget by Friday
/palavra We decided the launch is on October 12
/palavra Pedro will finish the backend by the 30th
You can write in English or Portuguese.`;
const NOTHING_TO_RECORD = `I couldn't find a decision, a commitment, a change or a completion in that message.
Try a full sentence, for example: /palavra I'll send the budget by Friday`;
const NOTHING_RECORDED_YET = `Nothing has been recorded in this group yet.
Start with something like: /palavra I'll send the budget by Friday`;

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

const historyOptions = (deps: RouterDeps, groupId: string) => ({ ledger: deps.ledger, groupId, timeZone: deps.timeZone, proofBaseUrl: deps.proofBaseUrl });

function recentReply(items: Parameters<typeof renderRecent>[0], intro: string): Reply | null {
  const list = renderRecent(items, intro);
  if (!list) return null;
  return { kind: "text", text: list.text, html: true, buttons: list.items.map((i) => ({ label: i.label, data: historyCallbackData(i.rootId) })) };
}

/** A tap on an item of the /history list. */
export function handleHistoryPick(deps: RouterDeps, groupId: string, rootId: string): Reply[] {
  const now = deps.now ?? (() => new Date());
  const item = resolveState(deps.ledger.entries(groupId), { now: now(), timeZone: deps.timeZone }).items.find((i) => i.rootId === rootId);
  return [text(item ? renderItemHistory(item, historyOptions(deps, groupId)) : "I can't find that item anymore.", true)];
}

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
        const items = resolveState(deps.ledger.entries(msg.groupId), { now: now(), timeZone: deps.timeZone }).items;
        if (command.args === "") return [recentReply(items, "Which one? These are the latest items:") ?? text(NOTHING_RECORDED_YET)];
        const found = renderHistory(items, command.args, historyOptions(deps, msg.groupId));
        if (found !== "") return [text(found, true)];
        // Nothing matched: show what exists instead of leaving the user guessing the name.
        const miss = `I found nothing about "${escapeHtml(shorten(command.args, 40))}".`;
        return [recentReply(items, `${miss} These are the latest items:`) ?? text(`${miss}\n\n${NOTHING_RECORDED_YET}`)];
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
    if (error instanceof ExtractionError) {
      deps.onExtractionError?.(error);
      return [text(error.quotaExhausted ? texts.quotaExhausted : texts.couldNotUnderstand)];
    }
    throw error;
  }
}
