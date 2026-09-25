import { InlineKeyboard, type Api } from "grammy";
import type { Fact } from "../core/fact.js";
import type { ChatUser } from "../core/owner.js";
import type { ConfirmOutcome, Proposal, ProposalService } from "../core/proposals.js";
import { callbackData, parseCallbackData, renderProposal, texts, type Rendered } from "./messages.js";

// Telegram side of the proposals: draws the inline buttons and applies the presses.
// The functions take narrow interfaces so they can be tested without a running bot.

export type AdminLookup = (chatId: string, userId: string) => Promise<boolean>;

/** Everything the callback handler needs from a Telegram callback query. */
export interface CallbackContext {
  data: string;
  chatId: number | string;
  from: { id: number; first_name: string; last_name?: string; username?: string };
  /** Answers the callback query (a small toast). */
  answer(text?: string): Promise<unknown>;
  /** Replaces the text of the proposal message and removes its buttons. */
  editMessage(text: string): Promise<unknown>;
}

export interface ProposalHooks {
  /** Called after a fact entered the ledger: the place to flush the outbox and show the receipt. */
  onWritten?(fact: Fact, proposal: Proposal): void | Promise<void>;
  onError?(error: unknown): void;
}

export function toChatUser(from: CallbackContext["from"], isAdmin: boolean): ChatUser {
  return { id: `tg:${from.id}`, name: from.first_name, username: from.username ?? null, isAdmin };
}

/** Creators and administrators of the group. */
export function telegramAdminLookup(api: Pick<Api, "getChatMember">): AdminLookup {
  return async (chatId, userId) => {
    const member = await api.getChatMember(chatId, Number(userId.replace(/^tg:/, "")));
    return member.status === "creator" || member.status === "administrator";
  };
}

export function inlineKeyboardFor(proposalId: string, rendered: Rendered): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const button of rendered.buttons) keyboard.text(button.label, callbackData(proposalId, button.action));
  return keyboard;
}

/** Sends a proposal as a reply to the message that produced it, with its buttons. */
export async function sendProposal(api: Pick<Api, "sendMessage">, chatId: number | string, replyToMessageId: number | undefined, proposal: Proposal): Promise<void> {
  const rendered = renderProposal(proposal);
  await api.sendMessage(chatId, rendered.text, {
    reply_markup: inlineKeyboardFor(proposal.id, rendered),
    ...(replyToMessageId === undefined ? {} : { reply_parameters: { message_id: replyToMessageId } }),
  });
}

function summarize(o: Extract<ConfirmOutcome, { status: "written" }>): string {
  return `${texts.written}\n${o.fact.text}`;
}

/** Applies one button press. Nothing is written unless the presser is allowed and the proposal is still valid. */
export async function handleProposalCallback(ctx: CallbackContext, service: ProposalService, isAdmin: AdminLookup, hooks: ProposalHooks = {}): Promise<void> {
  const parsed = parseCallbackData(ctx.data);
  if (!parsed) {
    await ctx.answer();
    return;
  }
  try {
    const admin = await isAdmin(String(ctx.chatId), `tg:${ctx.from.id}`).catch(() => false);
    const outcome = service.confirm(parsed.proposalId, toChatUser(ctx.from, admin), parsed.action);
    switch (outcome.status) {
      case "written":
        await ctx.answer(texts.written);
        await ctx.editMessage(summarize(outcome));
        await hooks.onWritten?.(outcome.fact, outcome.proposal);
        return;
      case "cancelled":
        await ctx.answer();
        await ctx.editMessage(texts.cancelled);
        return;
      case "expired":
        await ctx.answer(texts.expired);
        await ctx.editMessage(texts.expired);
        return;
      case "not-allowed":
        await ctx.answer(texts.notAllowed(outcome.who)); // buttons stay: the right person can still press
        return;
      case "target-changed":
        await ctx.answer();
        await ctx.editMessage(outcome.reason === "completed" ? texts.targetCompleted : texts.targetMissing);
        return;
      case "already-handled":
        await ctx.answer(texts.alreadyHandled);
        return;
      case "not-found":
      case "invalid-action":
        await ctx.answer(texts.notFound);
        return;
    }
  } catch (error) {
    hooks.onError?.(error);
    await ctx.answer(texts.couldNotUnderstand).catch(() => undefined);
  }
}
