import { z } from "zod";
import { isValidIsoDate } from "../core/fact.js";
import { isQuotaExhausted, isTransientError, type GeminiClient } from "./gemini.js";

// Fact extraction: turns one chat message into a structured proposal with Gemini.
//
// The model only interprets language. The code decides everything else: dates are validated (a
// deadline is always a calendar date, YYYY-MM-DD), errors are retried with backoff, a fallback model
// takes over when the primary keeps failing or answers with something invalid, and when the model has
// to pick one item among candidates it can only answer with an id from the list (or "none").

export const EXTRACTION_TYPES = ["DECISION", "COMMITMENT", "AMENDMENT", "COMPLETION", "NONE"] as const;
export type ExtractionType = (typeof EXTRACTION_TYPES)[number];

export interface Extraction {
  type: ExtractionType;
  owner: string | null;
  task: string | null;
  /** Calendar date, YYYY-MM-DD. Never a date-time. */
  due: string | null;
}

export class ExtractionError extends Error {
  constructor(message: string, readonly causes: unknown[] = []) {
    super(message, causes[0] === undefined ? undefined : { cause: causes[0] });
    this.name = "ExtractionError";
  }

  /** True when every attempt failed because the AI quota is used up (so the user can be told why). */
  get quotaExhausted(): boolean {
    return this.causes.length > 0 && this.causes.every(isQuotaExhausted);
  }
}

/** JSON schema sent to Gemini. `due` is constrained to a date pattern, and validated again in code. */
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: [...EXTRACTION_TYPES] },
    owner: { type: ["string", "null"], description: "Person responsible, as written in the message" },
    task: { type: ["string", "null"], description: "Short description of the task or decision" },
    due: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Deadline as a calendar date YYYY-MM-DD, or null" },
  },
  required: ["type", "owner", "task", "due"],
} as const;

/** "2026-09-25 (Friday)": the reference date the model must use for relative deadlines. */
export function describeToday(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${today} (${weekday})`;
}

/**
 * A ready-made calendar of the next 14 days: weekday, date and the week it belongs to
 * ("Friday 2026-10-02: next week"). Models are unreliable at counting days, so the prompt hands them
 * the answers and they only pick a line. Weeks run Monday to Sunday.
 */
export function calendarTable(today: string, days = 14): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const mondayOf = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;
  const start = Date.UTC(y, m - 1, d);
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const ms = start + i * DAY_MS;
    const weeksAhead = Math.round((mondayOf(ms) - mondayOf(start)) / (7 * DAY_MS));
    const week = weeksAhead === 0 ? "this week" : weeksAhead === 1 ? "next week" : `in ${weeksAhead} weeks`;
    const notes = [i === 0 ? "today" : i === 1 ? "tomorrow" : null, week].filter(Boolean).join(", ");
    const weekday = new Date(ms).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    lines.push(`${weekday} ${new Date(ms).toISOString().slice(0, 10)}: ${notes}`);
  }
  return lines.join("\n");
}

/** The deadline rules of docs/PRODUCT.md (D1-D9), stated for the model. */
const DEADLINE_RULES = `Deadline rules (the group timezone is already applied to "today"):
- "today", "tomorrow", "the day after tomorrow", "in N days", "in N weeks": count from today.
- A bare weekday ("Friday", "sexta") is the FIRST line of the calendar below with that weekday, today included: said on a Friday, "by Friday" is today's date.
- "next week" + weekday, "next Friday", "Friday next week": the calendar line with that weekday whose note says "next week", never the nearest one.
- A day of the month alone ("by the 30th", "dia 30") is its next occurrence on or after today; skip months without that day.
- Numeric dates are DD/MM or DD/MM/YYYY (never MM/DD). A written month ("October 12") is accepted. Without a year, use the current year if the date is today or later, otherwise the next year.
- "end of the month" is the last day of the current month.
- Ignore the time of day ("at 10am"): only the date goes in "due".
- Vague deadlines ("soon", "later", "asap", "next week" without a weekday) and messages with no deadline: "due" is null.
- A date in the past is still returned as written.`;

export function buildSystemPrompt(today: string): string {
  return `You extract facts from messages of a work group chat. Messages may be in Portuguese or English.
Today is ${describeToday(today)}.

Calendar (use it to convert weekdays and relative days to dates):
${calendarTable(today)}

Types:
- DECISION: the group decided something.
- COMMITMENT: someone takes a task.
- AMENDMENT: changes a deadline, owner or wording of something already agreed ("actually", "postponed", "moved to", "changed", "instead").
- COMPLETION: someone finished something.
- NONE: small talk, an opinion or a question.

Rules:
- The person writing is the "author"; "I" / "eu" refers to the author, so for "I will..." the owner is the author's name.
- "owner" is the person responsible, as named in the message. For a handover ("Pedro takes over the budget") it is the NEW owner.
- "due" must be a calendar date in the format YYYY-MM-DD (for example 2026-09-30). Never include a time of day, never return a date-time such as 2026-09-30T10:00:00, and never return text such as "Friday".
- Do not invent data: use null for anything the message does not say.

${DEADLINE_RULES}`;
}

const dateOnly = z.string().transform((value, ctx): string | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // A date-time is normalized to its date; the time of day is discarded.
  const candidate = /^\d{4}-\d{2}-\d{2}T/.test(trimmed) ? trimmed.slice(0, 10) : trimmed;
  if (!isValidIsoDate(candidate)) {
    ctx.addIssue({ code: "custom", message: `due is not a calendar date YYYY-MM-DD: ${JSON.stringify(value)}` });
    return z.NEVER;
  }
  return candidate;
});

const nullableText = z.union([z.string(), z.null()]).transform((v) => (v === null || v.trim() === "" ? null : v.trim()));

const extractionSchema = z.object({
  type: z.enum(EXTRACTION_TYPES),
  owner: nullableText,
  task: nullableText,
  due: z.union([dateOnly, z.null()]),
});

export interface ParsedExtraction {
  extraction: Extraction;
  /** Set when the model returned a date-time and it was reduced to a date. */
  normalizedDateTime: boolean;
}

/** Strict validation of the model's answer. Throws ExtractionError on anything that is not a valid extraction. */
export function parseExtraction(text: string): ParsedExtraction {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new ExtractionError("the model did not return valid JSON", [cause]);
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) {
    throw new ExtractionError(`invalid extraction: ${parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ")}`, [parsed.error]);
  }
  const rawDue = (json as { due?: unknown }).due;
  return { extraction: parsed.data, normalizedDateTime: typeof rawDue === "string" && /^\d{4}-\d{2}-\d{2}T/.test(rawDue.trim()) };
}

// ---- candidate choice -------------------------------------------------------------------------

export interface Candidate {
  id: string;
  /** One line the model can read: owner, what, due date. */
  description: string;
}

export const NONE_CHOICE = "none";

export function chooseSchema(candidates: readonly Candidate[]) {
  return {
    type: "object",
    properties: { choice: { type: "string", enum: [...candidates.map((c) => c.id), NONE_CHOICE] } },
    required: ["choice"],
  } as const;
}

export function buildChoosePrompt(message: string, author: string, candidates: readonly Candidate[]): string {
  const list = candidates.map((c) => `- ${c.id}: ${c.description}`).join("\n");
  return `Author: ${author}\nMessage: ${message}\n\nCandidates:\n${list}\n\nWhich candidate does the message change or complete? Answer with its id, or "${NONE_CHOICE}" if it clearly refers to none of them.`;
}

export const CHOOSE_SYSTEM = `You match a message from a work group chat to one item of a list. Answer only with an id from the list, or "none". Never invent an id.`;

/** Accepts only an id from the candidate list or "none" (null). Throws ExtractionError otherwise. */
export function parseChoice(text: string, candidates: readonly Candidate[]): string | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new ExtractionError("the model did not return valid JSON", [cause]);
  }
  const choice = (json as { choice?: unknown } | null)?.choice;
  if (typeof choice !== "string") throw new ExtractionError("the answer has no `choice`");
  if (choice === NONE_CHOICE) return null;
  if (!candidates.some((c) => c.id === choice)) throw new ExtractionError(`the model chose an id that is not a candidate: ${JSON.stringify(choice)}`);
  return choice;
}

// ---- calls with retry and fallback -------------------------------------------------------------

export interface CallOptions {
  client: GeminiClient;
  /** Primary model first, then the optional fallback. */
  models: readonly string[];
  /** Waits between retries of a transient error on the same model (default 0.6 s, 2 s, 3 s). */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY_DELAYS_MS = [600, 2_000, 3_000] as const;
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CallResult<T> {
  value: T;
  model: string;
  usedFallback: boolean;
  /** Calls made, over all models. */
  calls: number;
}

/**
 * Runs `request` on each model until one gives a valid answer. On a model, transient errors (503, 429,
 * network) are retried with backoff; an invalid answer moves on to the next model.
 */
async function callWithFallback<T>(
  options: CallOptions,
  request: { system: string; prompt: string; schema: object },
  parse: (text: string) => T,
): Promise<CallResult<T>> {
  const { client, models } = options;
  if (models.length === 0) throw new ExtractionError("no model configured");
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? realSleep;
  const causes: unknown[] = [];
  let calls = 0;

  for (const [index, model] of models.entries()) {
    for (let attempt = 0; ; attempt++) {
      calls++;
      try {
        const text = await client.generate({ model, ...request });
        return { value: parse(text), model, usedFallback: index > 0, calls };
      } catch (error) {
        causes.push(error);
        const wait = delays[attempt];
        if (isTransientError(error) && wait !== undefined) {
          await sleep(wait);
          continue;
        }
        break; // invalid answer or retries exhausted: try the next model
      }
    }
  }
  throw new ExtractionError(`the request failed on ${models.length} model(s): ${models.join(", ")}`, causes);
}

export interface ExtractResult extends CallResult<Extraction> {
  normalizedDateTime: boolean;
}

/** Extracts a fact proposal from one message. `today` is the message date in the group's timezone. */
export async function extractFact(message: string, author: string, today: string, options: CallOptions): Promise<ExtractResult> {
  const result = await callWithFallback(options, { system: buildSystemPrompt(today), prompt: `Author: ${author}\nMessage: ${message}`, schema: EXTRACTION_SCHEMA }, parseExtraction);
  return { value: result.value.extraction, model: result.model, usedFallback: result.usedFallback, calls: result.calls, normalizedDateTime: result.value.normalizedDateTime };
}

/** Asks the model to pick one candidate (or none). The answer is validated against the list. */
export async function chooseCandidate(message: string, author: string, candidates: readonly Candidate[], options: CallOptions): Promise<CallResult<string | null>> {
  if (candidates.length === 0) return { value: null, model: "", usedFallback: false, calls: 0 };
  return callWithFallback(options, { system: CHOOSE_SYSTEM, prompt: buildChoosePrompt(message, author, candidates), schema: chooseSchema(candidates) }, (text) => parseChoice(text, candidates));
}
