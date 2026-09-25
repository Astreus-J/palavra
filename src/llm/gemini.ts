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

/** Errors worth retrying: overloaded (503), quota or rate limit (429), and network failures. */
export function isTransientError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\b(503|429|500|502|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(text);
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
