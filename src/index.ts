import { Bot } from "grammy";
import pino from "pino";
import { loadConfig, requireBotSecrets } from "./config.js";
import { Ledger } from "./core/ledger.js";
import { Outbox } from "./core/outbox.js";
import { ProposalService, ProposalStore } from "./core/proposals.js";
import { createGeminiClient } from "./llm/gemini.js";
import { createMemoryStore } from "./memory/index.js";
import { registerHandlers } from "./bot/telegram.js";

const OUTBOX_INTERVAL_MS = 20_000;
const STARTUP_RETRY_MS = [2_000, 5_000, 10_000, 20_000] as const;

/** A network blip at startup should not stop the bot: retry the first call a few times. */
async function withStartupRetry<T>(what: string, run: () => Promise<T>, log: pino.Logger): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const wait = STARTUP_RETRY_MS[attempt];
      if (wait === undefined) throw error;
      log.warn({ err: error instanceof Error ? error.message : error, retryInMs: wait }, `${what} failed, retrying`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = pino({ level: cfg.LOG_LEVEL });
  const secrets = requireBotSecrets(cfg);

  const memory = createMemoryStore(cfg);
  const ledger = Ledger.open(cfg.DB_PATH);
  const proposals = ProposalStore.open(cfg.DB_PATH);
  const outbox = new Outbox({ store: memory, ledger, onEvent: (event) => log.warn({ event }, "outbox event") });
  const models = [secrets.geminiModel, ...(cfg.GEMINI_FALLBACK_MODEL ? [cfg.GEMINI_FALLBACK_MODEL] : [])];
  const service = new ProposalService({
    ledger,
    proposals,
    timeZone: cfg.DEFAULT_TIMEZONE,
    llm: { client: createGeminiClient(secrets.geminiApiKey), models },
  });

  // Facts reach Walrus in the background; a failed flush is retried on the next tick.
  const flush = () =>
    outbox
      .flush()
      .then((r) => (r.written + r.verified + r.failed + r.retryScheduled > 0 ? log.info({ report: r }, "outbox flushed") : undefined))
      .catch((error) => log.error({ err: error }, "outbox flush failed"));

  const bot = new Bot(secrets.telegramToken);
  const me = await withStartupRetry("Telegram getMe", () => bot.api.getMe(), log);
  registerHandlers(bot, {
    router: { service, ledger, timeZone: cfg.DEFAULT_TIMEZONE, botUsername: me.username, proofBaseUrl: cfg.WALRUSCAN_BLOB_URL },
    onWritten: (fact) => {
      log.info({ factId: fact.id, type: fact.type }, "fact recorded");
      void flush();
    },
    onHandled: (info) => log.info(info, "handled"),
    onError: (error, context) => log.error({ err: error, context }, "handler error"),
  });

  const timer = setInterval(() => void flush(), OUTBOX_INTERVAL_MS);
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "stopping");
    clearInterval(timer);
    await bot.stop();
    await flush();
    ledger.close();
    proposals.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  log.info({ bot: `@${me.username}`, memory: cfg.MEMWAL_MODE, models, timezone: cfg.DEFAULT_TIMEZONE, db: cfg.DB_PATH }, "Palavra is starting");
  void flush();
  await bot.start({ onStart: () => log.info("Palavra is listening") });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
