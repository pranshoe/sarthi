import type { LLMProvider, STTProvider, TTSProvider } from "./types";
import { MockLLMProvider } from "./llm/mockLlm";
import { GeminiLLMProvider } from "./llm/gemini";
import { ClaudeLLMProvider, OpenAICompatProvider } from "./llm/openaiCompat";
import { MockSTTProvider, MockTTSProvider, SarvamSTTProvider, SarvamTTSProvider } from "./stt/sarvamStt";
import { config } from "@/shared/config";

/**
 * Provider selection lives here and nowhere else.
 *
 * Agent code never imports a concrete provider, so switching conversation
 * models is a config change. Default is Gemini because the free tier is the
 * most dependable for schema-constrained JSON; speech stays on Sarvam because
 * it is purpose-built for Indian languages.
 */

export function createLLM(): LLMProvider {
  if (config.mockMode) return new MockLLMProvider();
  switch (config.llm) {
    case "gemini":
      return new GeminiLLMProvider(
        import.meta.env?.VITE_GEMINI_MODEL ?? "gemini-3.5-flash-lite",
      );
    case "claude":
      return new ClaudeLLMProvider({
        apiKey: (import.meta.env?.VITE_CLAUDE_KEY as string | undefined) ?? "",
        model: import.meta.env?.VITE_CLAUDE_MODEL,
      });
    case "openai":
      return new OpenAICompatProvider({
        id: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        apiKey: (import.meta.env?.VITE_OPENAI_KEY as string | undefined) ?? "",
      });
    case "sarvam":
      return new OpenAICompatProvider({
        id: "sarvam",
        // Sarvam accepts api-subscription-key or Bearer on this endpoint.
        baseUrl: "https://api.sarvam.ai/v1",
        model: "sarvam-30b",
        apiKey: (import.meta.env?.VITE_SARVAM_KEY as string | undefined) ?? "",
        headerName: "api-subscription-key",
      });
    default:
      return new MockLLMProvider();
  }
}

export function createSTT(): STTProvider {
  if (config.mockMode) return new MockSTTProvider();
  return new SarvamSTTProvider();
}

export function createTTS(): TTSProvider {
  if (config.mockMode) return new MockTTSProvider();
  return new SarvamTTSProvider();
}