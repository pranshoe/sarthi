import type { ChatMessage, LLMProvider } from "../types";
import { ledger, logCost } from "../types";

/**
 * OpenAI-compatible adapter. Also covers Sarvam-30B and Sarvam-105B, because
 * Sarvam exposes an OpenAI-shaped /v1/chat/completions endpoint that accepts
 * either `api-subscription-key` or `Authorization: Bearer`.
 */

export interface OpenAICompatOptions {
  id?: string;
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Extra header name/value, used by Sarvam's `api-subscription-key`. */
  headerName?: string;
  jsonMode?: boolean;
}

export class OpenAICompatProvider implements LLMProvider {
  readonly id: string;
  constructor(private readonly o: OpenAICompatOptions) {
    this.id = o.id ?? o.model;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.o.apiKey}`,
    };
    if (this.o.headerName) headers[this.o.headerName] = this.o.apiKey;

    const body: Record<string, unknown> = {
      model: this.o.model,
      messages,
      temperature: 0.3,
      max_tokens: 700,
    };
    // Ask for JSON where the provider honours it. We still validate locally.
    if (this.o.jsonMode !== false) body.response_format = { type: "json_object" };

    const t0 = performance.now();
    const res = await fetch(`${this.o.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${this.id} ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";

    ledger.llmCalls++;
    ledger.llmPromptTokens += json.usage?.prompt_tokens ?? 0;
    ledger.llmCompletionTokens += json.usage?.completion_tokens ?? 0;

    logCost(`llm:${this.id}`, {
      model: this.o.model,
      ms: Math.round(performance.now() - t0),
      replyChars: text.length,
    });

    if (!text) throw new Error(`${this.id} returned an empty response`);
    return text;
  }
}

/** Anthropic Messages API. Uses output_config json_schema when available. */
export class ClaudeLLMProvider implements LLMProvider {
  readonly id = "claude";
  constructor(private readonly o: { apiKey: string; model?: string }) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const rest = messages.filter((m) => m.role !== "system");
    // Anthropic takes the system prompt out of band.
    const mapped = rest.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
    // Ensure the run does not start with an assistant turn.
    while (mapped[0]?.role === "assistant") mapped.shift();

    const t0 = performance.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.o.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.o.model ?? "claude-3-5-haiku-latest",
        max_tokens: 700,
        temperature: 0.3,
        system,
        messages: mapped,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`claude ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (json.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    ledger.llmCalls++;
    ledger.llmPromptTokens += json.usage?.input_tokens ?? 0;
    ledger.llmCompletionTokens += json.usage?.output_tokens ?? 0;

    logCost("llm:claude", { model: this.o.model, ms: Math.round(performance.now() - t0) });
    return text;
  }
}