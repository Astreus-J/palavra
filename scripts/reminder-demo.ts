// Live demo of the deadline reminders, with a SIMULATED clock and an in-memory ledger (the bot's real data is untouched).
//
//   npm run reminder-demo -- --chat <telegram chat id>
//
// It seeds an overdue commitment and one due today, runs the scheduler twice (the second run must send nothing),
// and then completes one of them to show that it stops being reminded.
import { Bot } from "grammy";
import { loadConfig, requireBotSecrets } from "../src/config.js";
import { Ledger } from "../src/core/ledger.js";
import { redact } from "../src/redact.js";
import { ReminderScheduler, ReminderStore } from "../src/reminders/scheduler.js";

const args = process.argv.slice(2);
const chat = args.includes("--chat") ? args[args.indexOf("--chat") + 1] : undefined;
if (!chat || !/^-?\d+$/.test(chat)) {
  console.error("Usage: npm run reminder-demo -- --chat <telegram chat id>");
  process.exit(2);
}

const cfg = loadConfig();
const bot = new Bot(requireBotSecrets(cfg).telegramToken);
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// Simulated "now": Saturday 2026-09-26, 10:00 in Sao Paulo.
const clock = { now: new Date("2026-09-26T10:00:00-03:00") };
const ledger = Ledger.open(":memory:");
const base = { supersedes: null, author: "tg:demo", topic: null, at: "2026-09-24T12:00:00.000Z" } as const;
ledger.addFact(chat, { ...base, id: "c_00000001", type: "COMMITMENT", owner: "Pedro", due: "2026-09-25", task: "finish the backend (demo)", text: "Pedro committed to finish the backend." }, clock.now);
ledger.addFact(chat, { ...base, id: "c_00000002", type: "COMMITMENT", owner: "Maria", due: "2026-09-26", task: "send the budget (demo)", text: "Maria committed to send the budget." }, clock.now);

const scheduler = new ReminderScheduler({
  ledger, store: ReminderStore.open(":memory:"), timeZone: cfg.DEFAULT_TIMEZONE, reminderHour: cfg.REMINDER_HOUR, now: () => clock.now,
  send: (chatId, html) => bot.api.sendMessage(chatId, `🧪 Reminder demo (simulated date: Sat, Sep 26, 10:00; not real commitments)\n\n${html}`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
  onError: (e) => log(`delivery error: ${redact(e instanceof Error ? e.message : String(e))}`),
});

log(`tick 1 (simulated ${clock.now.toISOString()}): ${JSON.stringify(await scheduler.tick())}`);
log(`tick 2, an hour later:  ${JSON.stringify(await (clock.now = new Date(clock.now.getTime() + 3_600_000), scheduler.tick()))}   <- must send nothing`);
ledger.addFact(chat, { ...base, id: "k_00000003", type: "COMPLETION", supersedes: "c_00000001", owner: null, due: null, task: null, at: "2026-09-26T14:00:00.000Z", text: "Pedro finished the backend." }, clock.now);
clock.now = new Date("2026-09-27T10:00:00-03:00");
log(`tick 3, next day, Pedro completed: ${JSON.stringify(await scheduler.tick())}   <- Maria's is overdue now: one new reminder, nothing for Pedro`);
process.exit(0);
