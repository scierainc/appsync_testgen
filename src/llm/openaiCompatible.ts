export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  extraHeaders?: Record<string, string>;
};

export async function chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${opts.apiKey}`,
      ...(opts.extraHeaders ?? {})
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.2,
      messages
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM response missing content");
  return content;
}