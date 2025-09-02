import { ChatOptions, LlmClient, LlmMessage, StreamChunk } from "../types";

export class BedrockClaudeClient implements LlmClient {
  private region: string;
  private profile?: string;
  private modelId: string;

  private _client: any; // BedrockRuntimeClient
  private _credsLoader: any;

  constructor(params: { region: string; profile?: string; modelId: string }) {
    this.region = params.region;
    this.profile = params.profile;
    this.modelId = params.modelId;
  }

  private async getClient() {
    if (!this._client) {
      const mod = await import("@aws-sdk/client-bedrock-runtime"); // lazy load
      const { BedrockRuntimeClient } = mod as any;
      let creds = undefined;
      if (this.profile) {
        const cp = await import("@aws-sdk/credential-providers");
        const fromIni = (cp as any).fromIni ?? (cp as any).defaultProvider;
        creds = (fromIni && fromIni({ profile: this.profile })) || undefined;
      }
      this._client = new BedrockRuntimeClient({ region: this.region, ...(creds ? { credentials: creds } : {}) });
    }
    return this._client;
  }

  private toAnthropicBody(messages: LlmMessage[], opts: ChatOptions) {
    const sys = messages.find(m => m.role === "system")?.content;
    const rest = messages.filter(m => m.role !== "system");
    return {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature,
      system: sys,
      messages: rest.map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: [{ type: "text", text: m.content }]
      }))
    };
  }

  async chat(messages: LlmMessage[], opts: ChatOptions): Promise<string> {
    const client = await this.getClient();
    const { InvokeModelCommand } = (await import("@aws-sdk/client-bedrock-runtime")) as any;
    const body = this.toAnthropicBody(messages, opts);
    const out = await client.send(new InvokeModelCommand({
      modelId: this.modelId, contentType: "application/json", accept: "application/json",
      body: Buffer.from(JSON.stringify(body))
    }));
    const json = JSON.parse(Buffer.from(out.body ?? []).toString("utf8"));
    return (json.content ?? []).map((p: any) => p.type === "text" ? p.text : "").join("");
  }

  async *chatStream(messages: LlmMessage[], opts: ChatOptions & { responseFormatJson?: boolean; signal?: AbortSignal }): AsyncIterable<StreamChunk> {
    const client = await this.getClient();
    const { InvokeModelWithResponseStreamCommand } = (await import("@aws-sdk/client-bedrock-runtime")) as any;
    const body = this.toAnthropicBody(messages, opts);

    const out = await client.send(new InvokeModelWithResponseStreamCommand({
      modelId: this.modelId, contentType: "application/json", accept: "application/json",
      body: Buffer.from(JSON.stringify(body))
    }), { abortSignal: opts.signal as any });

    for await (const ev of (out.body as any)) {
      const payload = JSON.parse(Buffer.from(ev.chunk.bytes).toString("utf8"));
      if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") {
        yield { delta: payload.delta.text, providerMeta: payload };
      }
      if (payload.type === "message_delta" && payload.usage) {
        yield { usage: { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }, providerMeta: payload };
      }
    }
    yield { done: true };
  }
}
