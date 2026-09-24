import "dotenv/config";
import { z } from "zod";

const empty = (v: unknown) => (v === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(empty, schema.optional());

const schema = z
  .object({
    MEMWAL_MODE: z.enum(["mock", "real"]).default("mock"),
    MEMWAL_PRIVATE_KEY: opt(z.string()),
    MEMWAL_ACCOUNT_ID: opt(z.string()),
    MEMWAL_SERVER_URL: z.preprocess(empty, z.string().url().default("https://relayer.memory.walrus.xyz")),
    TELEGRAM_BOT_TOKEN: opt(z.string()),
    GEMINI_API_KEY: opt(z.string()),
    GEMINI_MODEL: opt(z.string()),
    DB_PATH: z.preprocess(empty, z.string().default("./data/palavra.db")),
    DEFAULT_TIMEZONE: z.preprocess(empty, z.string().default("America/Sao_Paulo")),
    WALRUSCAN_BLOB_URL: z.preprocess(empty, z.string().url().default("https://walruscan.com/mainnet/blob")),
    LOG_LEVEL: z.preprocess(empty, z.enum(["fatal", "error", "warn", "info", "debug"]).default("info")),
  })
  .superRefine((env, ctx) => {
    if (env.MEMWAL_MODE !== "real") return;
    for (const key of ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `obrigatória com MEMWAL_MODE=real` });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuração inválida (.env):\n${lines.join("\n")}`);
  }
  return parsed.data;
}

// Necessárias só para rodar o bot (não para testes/eval com mock).
export function requireBotSecrets(cfg: Config): { telegramToken: string; geminiApiKey: string; geminiModel: string } {
  const missing = (["TELEGRAM_BOT_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL"] as const).filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Faltam variáveis para iniciar o bot: ${missing.join(", ")}`);
  return { telegramToken: cfg.TELEGRAM_BOT_TOKEN!, geminiApiKey: cfg.GEMINI_API_KEY!, geminiModel: cfg.GEMINI_MODEL! };
}
