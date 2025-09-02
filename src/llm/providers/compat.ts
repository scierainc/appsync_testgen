import { ChatOptions, LlmClient, LlmMessage } from "../types";

export class OpenAiCompatibleHttpClient implements LlmClient {
  private baseUrl: string;
  private apiKey?: string;
  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }
  async chat(messages: LlmMessage[], opts: ChatOptions): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: opts.model, temperature: opts.temperature, max_tokens: opts.maxTokens, messages })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => `${res.status} ${res.statusText}`);
      throw new Error(`LLM HTTP ${res.status}: ${text}`);
    }
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("LLM response missing content");
    return content;
  }
}
