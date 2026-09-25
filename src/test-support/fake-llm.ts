import type { GeminiClient, GenerateRequest } from "../llm/gemini.js";

/** Fake Gemini: extraction and candidate-choice answers come from queues, in order. */
export class FakeLlm {
  private extractions: object[] = [];
  private choices: string[] = [];
  requests: GenerateRequest[] = [];
  failWith: Error | null = null;
  extract(x: { type: string; owner?: string | null; task?: string | null; due?: string | null }) {
    this.extractions.push({ owner: null, task: null, due: null, ...x });
    return this;
  }
  choose(id: string) {
    this.choices.push(id);
    return this;
  }
  get chooseCalls() { return this.requests.filter((r) => r.prompt.includes("Candidates:")); }
  get extractCalls() { return this.requests.filter((r) => !r.prompt.includes("Candidates:")); }
  client: GeminiClient = {
    generate: async (request) => {
      this.requests.push(request);
      if (this.failWith) throw this.failWith;
      const next = request.prompt.includes("Candidates:") ? { choice: this.choices.shift() } : this.extractions.shift();
      if (next === undefined || (next as { choice?: unknown }).choice === undefined && request.prompt.includes("Candidates:")) throw new Error("the test did not script this call");
      return JSON.stringify(next);
    },
  };
}
