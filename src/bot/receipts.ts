import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Ledger, LedgerRow } from "../core/ledger.js";
import { escapeHtml } from "./render.js";

// Two-phase receipt. Right after ✅ the message shows ⏳ (the write to Walrus is slow: ~25-35 s). When
// the outbox has the blob, the SAME message is edited to a 🔗 link that opens the blob on Walruscan.
// If Walrus keeps refusing, the message says so and offers 🔄 Try again.

export type ReceiptState = "saving" | "retrying" | "saved" | "failed";

export const SAVING_LINE = "⏳ Saving to Walrus…";

export interface ReceiptView {
  state: ReceiptState;
  /** The receipt line(s) appended to the message (HTML). */
  text: string;
  /** Present only when the user can act: the id of the fact to retry. */
  retryFactId: string | null;
}

export interface ReceiptOptions {
  /** e.g. https://walruscan.com/mainnet/blob */
  proofBaseUrl: string;
  /** False in test mode (mock memory): there is no blob on chain to link to. */
  onChain: boolean;
}

/** The state of a fact's write, as the user should see it. */
export function receiptState(row: LedgerRow): ReceiptState {
  if (row.blobId !== null) return "saved"; // written: the blob exists, whatever the read-back check says
  if (row.status === "failed") return "failed";
  return row.attempts > 0 ? "retrying" : "saving";
}

export function proofUrl(proofBaseUrl: string, blobId: string): string {
  return `${proofBaseUrl}/${blobId}`;
}

export function renderReceipt(row: LedgerRow, o: ReceiptOptions): ReceiptView {
  const state = receiptState(row);
  switch (state) {
    case "saved":
      return {
        state,
        retryFactId: null,
        text: o.onChain && row.blobId ? `🔗 Saved on Walrus: <a href="${escapeHtml(proofUrl(o.proofBaseUrl, row.blobId))}">proof</a>` : "✅ Saved (test mode: no on-chain proof)",
      };
    case "failed":
      return {
        state,
        retryFactId: row.factId,
        text: "❌ I couldn't save this to Walrus after several tries. It is safe on my side: tap \"Try again\".",
      };
    case "retrying":
      return { state, retryFactId: null, text: `⏳ Still saving to Walrus (retry ${row.attempts})…` };
    case "saving":
      return { state, retryFactId: null, text: SAVING_LINE };
  }
}

// ---- callback data "r:<fact id>" (the 🔄 Try again button) ---------------------------------------

export function retryCallbackData(factId: string): string {
  return `r:${factId}`;
}

export function parseRetryCallback(data: string): string | null {
  const m = /^r:([dcak]_[0-9a-f]{8})$/.exec(data);
  return m ? (m[1] as string) : null;
}

// ---- storage ------------------------------------------------------------------------------------

export interface Receipt {
  groupId: string;
  factId: string;
  chatId: string;
  messageId: number;
  /** The message text before the receipt line (HTML, already escaped). */
  baseHtml: string;
  /** What the message currently shows. */
  shown: ReceiptState;
}

interface ReceiptRow {
  group_id: string;
  fact_id: string;
  chat_id: string;
  message_id: number;
  base_html: string;
  shown: ReceiptState;
}

/** Receipts live in SQLite so a restart does not leave a message stuck on ⏳. */
export class ReceiptStore {
  private constructor(private readonly db: Database.Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        group_id TEXT NOT NULL,
        fact_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        base_html TEXT NOT NULL,
        shown TEXT NOT NULL,
        PRIMARY KEY (group_id, fact_id)
      );
    `);
  }

  static open(path: string): ReceiptStore {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    if (path !== ":memory:") db.pragma("journal_mode = WAL");
    return new ReceiptStore(db);
  }

  close(): void {
    this.db.close();
  }

  /** Starts tracking a message. The first state shown is ⏳. */
  add(r: Omit<Receipt, "shown">): void {
    this.db
      .prepare(`INSERT INTO receipts (group_id, fact_id, chat_id, message_id, base_html, shown) VALUES (?, ?, ?, ?, ?, 'saving')
                ON CONFLICT(group_id, fact_id) DO UPDATE SET chat_id = excluded.chat_id, message_id = excluded.message_id, base_html = excluded.base_html, shown = 'saving'`)
      .run(r.groupId, r.factId, r.chatId, r.messageId, r.baseHtml);
  }

  get(groupId: string, factId: string): Receipt | undefined {
    const row = this.db.prepare(`SELECT * FROM receipts WHERE group_id = ? AND fact_id = ?`).get(groupId, factId) as ReceiptRow | undefined;
    return row ? toReceipt(row) : undefined;
  }

  /** Receipts whose message may still need an edit: everything that is not yet 🔗. */
  unfinished(): Receipt[] {
    return (this.db.prepare(`SELECT * FROM receipts WHERE shown != 'saved'`).all() as ReceiptRow[]).map(toReceipt);
  }

  setShown(groupId: string, factId: string, shown: ReceiptState): void {
    this.db.prepare(`UPDATE receipts SET shown = ? WHERE group_id = ? AND fact_id = ?`).run(shown, groupId, factId);
  }
}

const toReceipt = (r: ReceiptRow): Receipt => ({ groupId: r.group_id, factId: r.fact_id, chatId: r.chat_id, messageId: r.message_id, baseHtml: r.base_html, shown: r.shown });

// ---- retry --------------------------------------------------------------------------------------

export type RetryOutcome = "requeued" | "not-failed";

/** The 🔄 Try again button: put the failed fact back in the queue and show ⏳ again. */
export async function retryFailedFact(o: { ledger: Ledger; updater: ReceiptUpdater; groupId: string; factId: string; now: Date }): Promise<RetryOutcome> {
  if (!o.ledger.requeueFact(o.groupId, o.factId, o.now)) return "not-failed";
  await o.updater.refresh(); // failed → saving: the message goes back to ⏳ and loses the button
  return "requeued";
}

// ---- updater ------------------------------------------------------------------------------------

/** The one Telegram call the updater needs. */
export interface EditApi {
  editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    other: { parse_mode: "HTML"; link_preview_options: { is_disabled: boolean }; reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } },
  ): Promise<unknown>;
}

export interface UpdaterOptions extends ReceiptOptions {
  store: ReceiptStore;
  ledger: Ledger;
  api: EditApi;
  onError?(error: unknown, receipt: Receipt): void;
}

/** Errors that mean "editing this message will never work": stop trying instead of looping. */
const permanent = (e: unknown) => /message is not modified|message to edit not found|message can't be edited|MESSAGE_ID_INVALID|chat not found/i.test(e instanceof Error ? e.message : String(e));

export class ReceiptUpdater {
  constructor(private readonly o: UpdaterOptions) {}

  /** Renders the message for a fact's current state (used for the first edit and for every update). */
  view(receipt: Receipt): ReceiptView | null {
    const row = this.o.ledger.getRow(receipt.groupId, receipt.factId);
    return row ? renderReceipt(row, this.o) : null;
  }

  private async show(receipt: Receipt, view: ReceiptView): Promise<void> {
    await this.o.api.editMessageText(receipt.chatId, receipt.messageId, `${receipt.baseHtml}\n${view.text}`, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: view.retryFactId ? [[{ text: "🔄 Try again", callback_data: retryCallbackData(view.retryFactId) }]] : [] },
    });
  }

  /** Edits every tracked message whose write changed state. Returns how many messages were edited. */
  async refresh(): Promise<number> {
    let edited = 0;
    for (const receipt of this.o.store.unfinished()) {
      const view = this.view(receipt);
      if (!view || view.state === receipt.shown) continue;
      try {
        await this.show(receipt, view);
        this.o.store.setShown(receipt.groupId, receipt.factId, view.state);
        edited++;
      } catch (error) {
        if (permanent(error)) this.o.store.setShown(receipt.groupId, receipt.factId, view.state);
        this.o.onError?.(error, receipt);
      }
    }
    return edited;
  }
}
