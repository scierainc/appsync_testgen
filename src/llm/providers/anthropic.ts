import { ChatOptions, LlmClient, LlmMessage, StreamChunk } from "../types";

export class AnthropicSdkClient implements LlmClient {
  private apiKey: string;
  private _sdk: any;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getClient() {
    if (!this._sdk) {
      const mod = await import("@anthropic-ai/sdk"); // lazy load
      const Anthropic = (mod as any).default ?? mod;
      this._sdk = new Anthropic({ apiKey: this.apiKey });
    }
    return this._sdk;
  }

  async chat(messages: LlmMessage[], opts: ChatOptions): Promise<string> {
    const sdk = await this.getClient();
    const sys = messages.find(m => m.role === "system")?.content;
    const rest = messages.filter(m => m.role !== "system");
    const resp = await sdk.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature,
      system: sys,
      messages: rest.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
    });
    return resp.content.map((p: any) => p.type === "text" ? p.text : "").join("");
  }

  async *chatStream(messages: LlmMessage[], opts: ChatOptions & { responseFormatJson?: boolean; signal?: AbortSignal }): AsyncIterable<StreamChunk> {
    const sdk = await this.getClient();
    const sys = messages.find(m => m.role === "system")?.content;
    const rest = messages.filter(m => m.role !== "system");
    const stream = await sdk.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature,
      system: sys,
      messages: rest.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      stream: true
    }, { signal: opts.signal });

    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        yield { delta: ev.delta.text, providerMeta: ev };
      }
      if (ev.type === "message_delta" && ev.usage) {
        yield { usage: { inputTokens: ev.usage.input_tokens, outputTokens: ev.usage.output_tokens }, providerMeta: ev };
      }
    }
    yield { done: true };
  }
}
