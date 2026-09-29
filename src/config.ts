import "dotenv/config";
import { z } from "zod";

const empty = (v: unknown) => (v === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(empty, schema.optional());

// Free OpenRouter models, ordered by measured accuracy on eval/fixtures/extraction-cases.json
// (see eval/openrouter-extraction.ts --all), not just declared JSON-schema support. None is from
// Anthropic or OpenAI (Beyond the Big Two track). Full rationale and measured numbers: D-05 in
// docs/DECISIONS.md.
export const DEFAULT_OPENROUTER_MODELS = [
  "dots-studio/dots-3-note-preview:free",
  "liquid/lfm-2.5-2.6b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-26b-a4b-it:free",
  "openrouter/free",
] as const;

const schema = z
  .object({
    MEMWAL_MODE: z.enum(["mock", "real"]).default("mock"),
    MEMWAL_PRIVATE_KEY: opt(z.string()),
    MEMWAL_ACCOUNT_ID: opt(z.string()),
    MEMWAL_SERVER_URL: z.preprocess(empty, z.string().url().default("https://relayer.memory.walrus.xyz")),
    TELEGRAM_BOT_TOKEN: opt(z.string()),
    OPENROUTER_API_KEY: opt(z.string()),
    OPENROUTER_MODELS: z.preprocess(empty, z.string().default(DEFAULT_OPENROUTER_MODELS.join(","))),
    DB_PATH: z.preprocess(empty, z.string().default("./data/palavra.db")),
    DEFAULT_TIMEZONE: z.preprocess(empty, z.string().default("America/Sao_Paulo")),
    REMINDER_HOUR: z.preprocess(empty, z.coerce.number().int().min(0).max(23).default(9)),
    WALRUSCAN_BLOB_URL: z.preprocess(empty, z.string().url().default("https://walruscan.com/mainnet/blob")),
    LOG_LEVEL: z.preprocess(empty, z.enum(["fatal", "error", "warn", "info", "debug"]).default("info")),
  })
  .superRefine((env, ctx) => {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: env.DEFAULT_TIMEZONE });
    } catch {
      ctx.addIssue({ code: "custom", path: ["DEFAULT_TIMEZONE"], message: `not a valid IANA timezone: ${env.DEFAULT_TIMEZONE}` });
    }
    if (env.MEMWAL_MODE !== "real") return;
    for (const key of ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `required when MEMWAL_MODE=real` });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration (.env):\n${lines.join("\n")}`);
  }
  return parsed.data;
}

// Only needed to run the bot (not for tests/eval with the mock).
export function requireBotSecrets(cfg: Config): { telegramToken: string; openrouterApiKey: string; openrouterModels: string[] } {
  const missing = (["TELEGRAM_BOT_TOKEN", "OPENROUTER_API_KEY"] as const).filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Missing variables to start the bot: ${missing.join(", ")}`);
  const openrouterModels = cfg.OPENROUTER_MODELS.split(",").map((m) => m.trim()).filter(Boolean);
  if (openrouterModels.length === 0) throw new Error("OPENROUTER_MODELS is empty");
  return { telegramToken: cfg.TELEGRAM_BOT_TOKEN!, openrouterApiKey: cfg.OPENROUTER_API_KEY!, openrouterModels };
}
