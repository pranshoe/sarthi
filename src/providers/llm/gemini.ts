import type { ChatMessage, LLMProvider } from "../types";
import { ledger, logCost } from "../types";
import { RESPONSE_SCHEMA } from "@/agent/systemPrompt";
import { config } from "@/shared/config";

/**
 * Gemini adapter. Default live conversation model: the free tier is the most
 * reliable free option for schema-constrained JSON, and structured output is
 * enforced server-side via responseMimeType + responseSchema rather than by
 * asking nicely.
 *
 * Note: Gemini is much cheaper than Sarvam chat for the credits available, and
 * Sarvam speech stays on Sarvam. See README for the rationale.
 */

/**
 * Fallback chain, most-preferred first.
 *
 * Why this exists: model availability varies per API key and per project.
 * A key that lists gemini-2.5-flash can still return 404 for it, and the Flash
 * endpoints intermittently return 503 under load. On stage, a fallback beats a
 * silent failure.
 *
 * Verified working with schema-constrained output: gemini-3.5-flash-lite,
 * gemini-flash-lite-latest, gemini-3-flash-preview.
 */
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3-flash-preview"];

/**
 * Calls go to the local proxy, which injects the key server-side.
 * The key never enters this bundle: grep the dist output for "AIza" and you
 * will find nothing. Direct calls were removed because they needed a
 * VITE_GEMINI_KEY, which Vite inlines into the shipped JavaScript.
 */
function proxyUrl(model: string): string {
  return `${config.proxyUrl.replace(/\/$/, "")}/gemini/${model}:generateContent`;
}

/**
 * Adapt a standard JSON Schema to the subset Gemini accepts.
 *
 * Verified against gemini-3.5-flash-lite: it rejects `type: ["string","null"]`
 * ("Proto field is not repeating, cannot start list") and rejects
 * `additionalProperties` outright, in both boolean and schema form.
 *
 * `nullable: true` is the supported way to express an optional value, and it
 * composes with `enum` (including null inside the enum).
 *
 * Keeping this here means RESPONSE_SCHEMA stays a normal JSON Schema that other
 * providers can use unmodified.
 */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let nullable = false;

  for (const [key, value] of Object.entries(src)) {
    // Unsupported keywords. Gemini errors on both of these.
    if (key === "additionalProperties") continue;

    if (key === "type") {
      if (Array.isArray(value)) {
        const types = value.filter((t): t is string => typeof t === "string");
        nullable = nullable || types.includes("null");
        const concrete = types.find((t) => t !== "null");
        if (concrete) out.type = concrete;
        continue;
      }
      out.type = value;
      continue;
    }

    if (key === "enum") {
      out.enum = value;
      continue;
    }

    out[key] = toGeminiSchema(value);
  }

  if (nullable) out.nullable = true;
  return out;
}

function toGeminiContents(messages: ChatMessage[]) {
  // Gemini treats the first message as systemInstruction, then alternates.
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const rest = messages.filter((m) => m.role !== "system");
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: rest.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
}

export class GeminiLLMProvider implements LLMProvider {
  readonly id = "gemini";
  constructor(private readonly model = "gemini-2.5-flash") {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const { systemInstruction, contents } = toGeminiContents(messages);

    const body = {
      systemInstruction,
      contents,
      generationConfig: {
        temperature: 0.3,
        // 1000, not 700: Tamil/Kannada replies are token-heavy and a truncated
        // reply is invalid JSON, which kills the turn outright.
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(RESPONSE_SCHEMA),
      },
    };

    const t0 = performance.now();
    // Try the configured model, then walk the fallback chain on a hard failure.
    const chain = [this.model, ...FALLBACK_MODELS.filter((m) => m !== this.model)];
    let res: Response | null = null;
    let usedModel = this.model;
    let lastError = "";

    for (const model of chain) {
      res = await fetch(proxyUrl(model), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (model !== this.model) {
          console.warn(`[saathi] ${this.model} unavailable, using ${model}`);
        }
        usedModel = model;
        break;
      }
      lastError = `${model} -> ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`;
      // 400 means our request is malformed; retrying other models will not help.
      if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error(`Gemini: ${lastError}`);
      res = null;
    }

    if (!res) throw new Error(`Gemini: every model failed. Last: ${lastError}`);

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    ledger.llmCalls++;
    ledger.llmPromptTokens += json.usageMetadata?.promptTokenCount ?? 0;
    ledger.llmCompletionTokens += json.usageMetadata?.candidatesTokenCount ?? 0;

    logCost(`llm:${this.id}`, {
      model: usedModel,
      ms: Math.round(performance.now() - t0),
      promptTokens: json.usageMetadata?.promptTokenCount,
      completionTokens: json.usageMetadata?.candidatesTokenCount,
      replyChars: text.length,
    });

    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  }
}
