// Thin OpenRouter client: one call, one model. Retry, fallback and validation live in extraction.ts.
//
// OpenRouter exposes an OpenAI-compatible chat completions endpoint in front of many providers.
// Free models vary widely in how well they honor `response_format`, so the JSON schema is also
// spelled out in the prompt text — the strict zod validation in extraction.ts is the real gate,
// and an invalid answer here just moves the caller on to the next model in the chain.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface GenerateRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON schema of the expected answer; also inlined into the prompt for models without native JSON mode. */
  schema: object;
}

export interface LLMClient {
  generate(request: GenerateRequest): Promise<string>;
}

const errorText = (error: unknown) => (error instanceof Error ? `${error.name} ${error.message}` : String(error));

/** The quota is used up (HTTP 429, or 402 when a model needs credits it does not have). */
export function isQuotaExhausted(error: unknown): boolean {
  return /\b(429|402)\b/.test(errorText(error));
}

/** A daily quota does not come back in seconds, so waiting and retrying is pointless. */
export function isDailyQuota(error: unknown): boolean {
  return isQuotaExhausted(error) && /day|daily/i.test(errorText(error));
}

/** Errors worth retrying on the same model: overloaded (503), a per-minute rate limit (429), network failures. */
export function isTransientError(error: unknown): boolean {
  if (isDailyQuota(error)) return false;
  return /\b(429|500|502|503|504)\b|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(errorText(error));
}

class OpenRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export function createOpenRouterClient(apiKey: string): LLMClient {
  return {
    async generate({ model, system, prompt, schema }) {
      const schemaInstruction = `Respond with ONLY a valid JSON object matching this schema, no markdown, no explanation:\n${JSON.stringify(schema)}`;
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Astreus-J/recall",
          "X-Title": "Recall",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          // Several free models on the chain support extended "reasoning" output; without a
          // generous max_tokens the completion can be truncated mid-JSON (seen live on
          // nvidia/nemotron-3-super-120b-a12b:free — see docs/DECISIONS.md D-05).
          max_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${system}\n\n${schemaInstruction}` },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OpenRouterError(`OpenRouter ${response.status} on ${model}: ${body.slice(0, 500)}`);
      }

      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}
