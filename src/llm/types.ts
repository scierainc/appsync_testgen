export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type ChatOptions = {
  model: string;
  temperature?: number;
  maxTokens?: number;
};

export type StreamChunk = {
  delta?: string;
  done?: boolean;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMeta?: any;
};

export interface LlmClient {
  chat(messages: LlmMessage[], opts: ChatOptions): Promise<string>;
  chatStream?(
    messages: LlmMessage[],
    opts: ChatOptions & { responseFormatJson?: boolean; signal?: AbortSignal }
  ): AsyncIterable<StreamChunk>;
}
