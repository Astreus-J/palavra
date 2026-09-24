import pino from "pino";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const log = pino({ level: cfg.LOG_LEVEL });

// Skeleton: modules are added feature by feature (see the Plane board, modules 02 and 03).
log.info({ memwalMode: cfg.MEMWAL_MODE, timezone: cfg.DEFAULT_TIMEZONE }, "Palavra: configuration loaded");
