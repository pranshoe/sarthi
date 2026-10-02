/**
 * Runtime configuration.
 *
 * API keys live ONLY in the local Express proxy (proxy/.env). This file holds
 * the proxy URL and which provider adapters to use. Nothing here is a secret.
 */

const env = import.meta.env ?? ({} as Record<string, string | undefined>);

export interface RuntimeConfig {
  llm: "mock" | "gemini" | "claude" | "openai" | "sarvam";
  stt: "mock" | "sarvam";
  tts: "mock" | "sarvam";
  /** Overrides every provider to its mock. Use this for dev and for tests. */
  mockMode: boolean;
  proxyUrl: string;
  /** TTS costs money per character, so it is opt-in. */
  spokenReplies: boolean;
  /** Keep replies short when speaking. */
  maxSpokenSentences: number;
}

export const config: RuntimeConfig = {
  llm: (env.VITE_LLM_PROVIDER ?? "mock") as RuntimeConfig["llm"],
  stt: (env.VITE_STT_PROVIDER ?? "sarvam") as RuntimeConfig["stt"],
  tts: (env.VITE_TTS_PROVIDER ?? "sarvam") as RuntimeConfig["tts"],
  mockMode: (env.VITE_MOCK_MODE ?? "true") === "true",
  proxyUrl: env.VITE_PROXY_URL ?? "http://127.0.0.1:8787",
  spokenReplies: (env.VITE_SPOKEN_REPLIES ?? "false") === "true",
  maxSpokenSentences: 2,
};

/** Sarvam language codes we accept for speech. BCP-47, Indian English included. */
export const SARVAM_LANGS = [
  "hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN", "kn-IN", "ml-IN",
  "gu-IN", "pa-IN", "od-IN", "as-IN", "ur-IN", "sa-IN", "ne-IN",
  "doi-IN", "kok-IN", "sat-IN", "snd-IN", "mai-IN", "mni-IN", "brx-IN", "en-IN",
] as const;

/** Sarvam TTS (Bulbul v3) supports 11 languages only. */
export const SARVAM_TTS_LANGS = [
  "hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN", "kn-IN", "ml-IN",
  "gu-IN", "pa-IN", "od-IN", "en-IN",
] as const;

export const TTS_SPEAKERS: Record<string, string> = {
  "hi-IN": "anushka",
  "bn-IN": "diya",
  "ta-IN": "tara",
  "te-IN": "vanaja",
  "mr-IN": "rohit",
  "kn-IN": "satya",
  "ml-IN": "soumya",
  "gu-IN": "manan",
  "pa-IN": "nirja",
  "od-IN": "subhasha",
  "en-IN": "anushka",
};

export function ttsLangFor(lang: string): string | null {
  const base = lang.split("-")[0] as (typeof SARVAM_TTS_LANGS)[number];
  const hit = (SARVAM_TTS_LANGS as readonly string[]).find((l) => l.startsWith(base));
  return hit ?? null;
}