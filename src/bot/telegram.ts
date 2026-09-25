import type { Bot } from "grammy";
import type { Fact } from "../core/fact.js";
import type { Proposal } from "../core/proposals.js";
import { handleIncoming, type Incoming, type MessageEntity, type Reply, type RouterDeps } from "./commands.js";
import { handleProposalCallback, sendProposal, telegramAdminLookup } from "./proposals-bot.js";

// Glue between grammy and the framework-independent router. Kept thin on purpose.

/** The parts of a Telegram text message that the router needs. */
export interface TelegramTextMessage {
  chatId: number | string;
  from: { id: number; first_name: string; username?: string };
  text: string;
  /** Unix time in seconds. */
  date: number;
  entities?: readonly MessageEntity[];
}

export function toIncoming(msg: TelegramTextMessage, isAdmin: boolean): Incoming {
  return {
    groupId: String(msg.chatId),
    author: { id: `tg:${msg.from.id}`, name: msg.from.first_name, username: msg.from.username ?? null, isAdmin },
    text: msg.text,
    sentAt: new Date(msg.date * 1000),
    ...(msg.entities ? { entities: msg.entities } : {}),
  };
}

export interface HandlerDeps {
  router: RouterDeps;
  /** Called after a fact entered the ledger: flush the outbox so it reaches Walrus. */
  onWritten?(fact: Fact, proposal: Proposal): void | Promise<void>;
  onError?(error: unknown, context: string): void;
  /** One call per message the bot acted on. Never includes the message text (privacy). */
  onHandled?(info: { chatId: string; userId: string; kind: string; replies: string[] }): void;
}

/** Registers the message and button handlers on a grammy bot. */
export function registerHandlers(bot: Bot, deps: HandlerDeps): void {
  const isAdmin = telegramAdminLookup(bot.api);
  const onError = deps.onError ?? (() => undefined);

  bot.on("message:text", async (ctx) => {
    const message = ctx.message;
    const text = message.text;
    const addressed = text.startsWith("/") || text.toLowerCase().includes(`@${deps.router.botUsername.toLowerCase()}`);
    if (!addressed) return; // ordinary chatter: not even an admin lookup
    try {
      const inGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
      const admin = inGroup ? await isAdmin(String(ctx.chat.id), `tg:${message.from.id}`).catch(() => false) : false;
      const replies = await handleIncoming(
        deps.router,
        toIncoming({ chatId: ctx.chat.id, from: message.from, text, date: message.date, ...(message.entities ? { entities: message.entities } : {}) }, admin),
      );
      for (const reply of replies) await send(reply);
      deps.onHandled?.({ chatId: String(ctx.chat.id), userId: `tg:${message.from.id}`, kind: text.startsWith("/") ? (text.split(/[\s@]/)[0] ?? "/") : "mention", replies: replies.map((r) => (r.kind === "proposal" ? `proposal:${r.proposal.kind}` : "text")) });
    } catch (error) {
      onError(error, "message");
      await ctx.reply("Sorry, something went wrong. Please try again.", { reply_parameters: { message_id: message.message_id } }).catch(() => undefined);
    }

    async function send(reply: Reply): Promise<void> {
      if (reply.kind === "proposal") {
        await sendProposal(ctx.api, ctx.chat.id, message.message_id, reply.proposal);
        return;
      }
      await ctx.reply(reply.text, {
        reply_parameters: { message_id: message.message_id },
        link_preview_options: { is_disabled: true },
        ...(reply.html ? { parse_mode: "HTML" as const } : {}),
      });
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.callbackQuery.message?.chat.id ?? ctx.chat?.id;
    if (chatId === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    await handleProposalCallback(
      {
        data: ctx.callbackQuery.data,
        chatId,
        from: ctx.from,
        answer: (t) => ctx.answerCallbackQuery(t === undefined ? {} : { text: t }),
        editMessage: (t) => ctx.editMessageText(t, { reply_markup: { inline_keyboard: [] } }),
      },
      deps.router.service,
      isAdmin,
      { ...(deps.onWritten ? { onWritten: deps.onWritten } : {}), onError: (e) => onError(e, "callback") },
    );
  });

  bot.catch((err) => onError(err.error, "bot"));
}
