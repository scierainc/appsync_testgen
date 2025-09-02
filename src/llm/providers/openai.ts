import { ChatOptions, LlmClient, LlmMessage, StreamChunk } from "../types";

export class OpenAiSdkClient implements LlmClient {
  private apiKey: string;
  private baseURL?: string;
  private _sdk: any; // OpenAI instance

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  private async getClient() {
    if (!this._sdk) {
      const mod = await import("openai"); // lazy load
      const OpenAI = (mod as any).default ?? mod;
      this._sdk = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL });
    }
    return this._sdk;
  }

  async chat(messages: LlmMessage[], opts: ChatOptions): Promise<string> {
    const sdk = await this.getClient();
    const resp = await sdk.chat.completions.create({
      model: opts.model,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      messages
    });
    return resp.choices?.[0]?.message?.content ?? "";
  }

  async *chatStream(messages: LlmMessage[], opts: ChatOptions & { responseFormatJson?: boolean; signal?: AbortSignal }): AsyncIterable<StreamChunk> {
    const sdk = await this.getClient();
    const stream = await sdk.chat.completions.create({
      model: opts.model,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      messages,
      stream: true,
      ...(opts.responseFormatJson ? { response_format: { type: "json_object" } } : {})
    }, { signal: opts.signal });

    for await (const ev of stream) {
      const delta = ev?.choices?.[0]?.delta?.content ?? "";
      const finish = ev?.choices?.[0]?.finish_reason ?? undefined;
      if (delta) yield { delta, providerMeta: ev };
      if (finish) yield { finishReason: finish, providerMeta: ev };
    }
    yield { done: true };
  }
}
