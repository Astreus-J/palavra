// Telegram error messages contain the request URL, and that URL contains the bot token
// ("https://api.telegram.org/bot<id>:<secret>/sendMessage"). Nothing that goes to a log may carry it.

const TOKEN = /bot\d{6,12}:[A-Za-z0-9_-]{20,}/g;
const KEY = /(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{30,}|suiprivkey1[a-z0-9]{20,})/g;

export function redact(text: string): string {
  return text.replace(TOKEN, "bot<redacted>").replace(KEY, "<redacted>");
}

/** A pino `err` serializer that keeps the useful parts of an error and removes secrets from them. */
export function serializeError(error: unknown): { type: string; message: string; stack?: string } {
  if (!(error instanceof Error)) return { type: "NonError", message: redact(String(error)) };
  return {
    type: error.name,
    message: redact(error.message),
    ...(error.stack ? { stack: redact(error.stack) } : {}),
  };
}
