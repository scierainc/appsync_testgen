import { ChatOptions, LlmClient, LlmMessage, StreamChunk } from "../types";

/**
 * Google Gemini via @google/generative-ai.
 * We concatenate messages into a single prompt (keeping system as systemInstruction).
 */
export class GeminiClient implements LlmClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async getModel(modelName: string, system?: string) {
    const mod = await import("@google/generative-ai"); // lazy load
    const { GoogleGenerativeAI } = mod as any;
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      ...(system ? { systemInstruction: system } : {})
    });
    return model;
  }

  private toPrompt(messages: LlmMessage[]) {
    const sys = messages.find(m => m.role === "system")?.content;
    const userOnly = messages.filter(m => m.role !== "system").map(m => m.content).join("\n\n");
    return { sys, prompt: userOnly };
  }

  async chat(messages: LlmMessage[], opts: ChatOptions): Promise<string> {
    const { sys, prompt } = this.toPrompt(messages);
    const model = await this.getModel(opts.model, sys);
    const res = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature,
        maxOutputTokens: opts.maxTokens
      }
    });
    return res?.response?.text?.() ?? res?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  async *chatStream(messages: LlmMessage[], opts: ChatOptions & { responseFormatJson?: boolean; signal?: AbortSignal }): AsyncIterable<StreamChunk> {
    const { sys, prompt } = this.toPrompt(messages);
    const model = await this.getModel(opts.model, sys);
    // SDK doesn’t use AbortSignal directly; we best-effort respect it by early return if aborted.
    const stream = await model.generateContentStream({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature,
        maxOutputTokens: opts.maxTokens
      }
    });

    for await (const chunk of (stream as any).stream) {
      if (opts.signal?.aborted) return;
      const text = chunk?.text?.() ?? "";
      if (text) yield { delta: text, providerMeta: chunk };
    }
    yield { done: true };
  }
}
