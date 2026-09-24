import pino from "pino";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const log = pino({ level: cfg.LOG_LEVEL });

// Esqueleto: os módulos entram por feature (ver Plane, módulos 02 e 03).
log.info({ memwalMode: cfg.MEMWAL_MODE, timezone: cfg.DEFAULT_TIMEZONE }, "Palavra: configuração carregada");
