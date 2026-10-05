// Live demo of the two-phase receipt: post a message with ⏳, write one fact through the outbox, and
// watch the SAME message turn into a 🔗 link.
//
//   npm run receipt-demo -- --chat <telegram chat id>            test mode (mock memory: no on-chain proof)
//   npm run receipt-demo -- --chat <telegram chat id> --real     Walrus mainnet: writes ONE immutable blob
import { Bot } from "grammy";
import { loadConfig, requireBotSecrets } from "../src/config.js";
import { newFactId } from "../src/core/fact.js";
import { Ledger } from "../src/core/ledger.js";
import { Outbox } from "../src/core/outbox.js";
import { createMemoryStore } from "../src/memory/index.js";
import { ReceiptStore, ReceiptUpdater, SAVING_LINE } from "../src/bot/receipts.js";
import { escapeHtml } from "../src/bot/render.js";
import { redact } from "../src/redact.js";

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const real = args.includes("--real");
const chat = option("--chat");
if (!chat) {
  console.error("Usage: npm run receipt-demo -- --chat <telegram chat id> [--real]");
  process.exit(2);
}

const cfg = loadConfig({ ...process.env, MEMWAL_MODE: real ? "real" : "mock" });
const bot = new Bot(requireBotSecrets(cfg).telegramToken);
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const factId = newFactId("COMMITMENT");
const text = "Demo committed to show a receipt.";
const baseHtml = `🧪 <b>Receipt demo</b> (a test record, not something the group decided)\n${escapeHtml(text)}`;

const ledger = Ledger.open(":memory:");
const store = ReceiptStore.open(":memory:");
const groupId = "receipt-demo"; // its own namespace, apart from real groups
ledger.addFact(groupId, { id: factId, type: "COMMITMENT", supersedes: null, author: "tg:demo", owner: "Demo", due: null, topic: null, task: "show a receipt", at: null, text }, new Date());

// The network can blip (ETIMEDOUT): try the first message a few times, never printing the token.
let sent: Awaited<ReturnType<typeof bot.api.sendMessage>> | undefined;
for (let attempt = 1; attempt <= 5 && !sent; attempt++) {
  try {
    sent = await bot.api.sendMessage(chat, `${baseHtml}\n${SAVING_LINE}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    log(`send failed (attempt ${attempt}): ${redact(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    if (attempt === 5) process.exit(1);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
if (!sent) process.exit(1);
store.add({ groupId, factId, chatId: chat, messageId: sent.message_id, baseHtml });
log(`phase 1 sent to chat ${chat} (message ${sent.message_id}): ${SAVING_LINE}`);

const updater = new ReceiptUpdater({
  store, ledger, api: bot.api as never, proofBaseUrl: cfg.WALRUSCAN_BLOB_URL, onChain: real,
  onError: (e) => log(`edit error: ${redact(e instanceof Error ? e.message : String(e))}`),
});
const outbox = new Outbox({ store: createMemoryStore(cfg), ledger, onEvent: (e) => log(`outbox event: ${JSON.stringify(e)}`) });

const t0 = Date.now();
log(real ? "writing to Walrus mainnet (about 30 s)…" : "writing to the mock memory…");
const report = await outbox.flush();
const row = ledger.getRow(groupId, factId);
log(`outbox: ${JSON.stringify(report)} in ${((Date.now() - t0) / 1000).toFixed(1)} s | status=${row?.status} blob=${row?.blobId}`);
const edited = await updater.refresh();
log(`phase 2: ${edited} message edited`);
if (real && row?.blobId) log(`proof: ${cfg.WALRUSCAN_BLOB_URL}/${row.blobId}`);
process.exit(edited === 1 ? 0 : 1);
