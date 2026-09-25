import { GoogleGenAI } from "@google/genai";

// Thin Gemini client: one call, one model. Retry, fallback and validation live in extraction.ts.

export interface GenerateRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON schema of the expected answer; the model is asked for application/json. */
  schema: object;
}

export interface GeminiClient {
  generate(request: GenerateRequest): Promise<string>;
}

const errorText = (error: unknown) => (error instanceof Error ? `${error.name} ${error.message}` : String(error));

/** The quota is used up (HTTP 429 / RESOURCE_EXHAUSTED). */
export function isQuotaExhausted(error: unknown): boolean {
  return /\b429\b|RESOURCE_EXHAUSTED/i.test(errorText(error));
}

/** A daily quota does not come back in seconds, so waiting and retrying is pointless. */
export function isDailyQuota(error: unknown): boolean {
  return isQuotaExhausted(error) && /PerDay|per day|daily/i.test(errorText(error));
}

/** Errors worth retrying on the same model: overloaded (503), a per-minute rate limit (429), network failures. */
export function isTransientError(error: unknown): boolean {
  if (isDailyQuota(error)) return false;
  return /\b(503|429|500|502|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(errorText(error));
}

export function createGeminiClient(apiKey: string): GeminiClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate({ model, system, prompt, schema }) {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0 },
      });
      return response.text ?? "";
    },
  };
}
