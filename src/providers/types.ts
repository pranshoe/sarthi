import type { LLMTurnResult } from "@/shared/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  readonly id: string;
  /** Must return JSON matching the turn schema. Throws on unrecoverable error. */
  chat(messages: ChatMessage[], opts?: { jsonSchema?: unknown }): Promise<string>;
}

export interface STTResult {
  text: string;
  detectedLang: string;
}

export interface STTProvider {
  readonly id: string;
  transcribe(audio: Blob, langHint?: string): Promise<STTResult>;
}

export interface TTSProvider {
  readonly id: string;
  /** Returns playable audio bytes. */
  speak(text: string, lang: string): Promise<Blob>;
}

/** Per-turn cost accounting, surfaced in the dev console per spec 2c. */
export interface CostLedger {
  llmCalls: number;
  llmPromptTokens: number;
  llmCompletionTokens: number;
  sttSeconds: number;
  ttsChars: number;
}

export const ledger: CostLedger = {
  llmCalls: 0,
  llmPromptTokens: 0,
  llmCompletionTokens: 0,
  sttSeconds: 0,
  ttsChars: 0,
};

export function logCost(label: string, detail: Record<string, unknown>): void {
  // Rates observed in Sarvam pricing, INR. Used only for the console estimate.
  const estSarvam =
    (ledger.llmPromptTokens / 1_000_000) * 29.28 +
    (ledger.llmCompletionTokens / 1_000_000) * 73.2 +
    (ledger.sttSeconds / 3600) * 30 +
    (ledger.ttsChars / 10_000) * 30;

  console.info(
    `%c[sarthi] ${label}`,
    "color:#1a56db;font-weight:700",
    {
      ...detail,
      totals: { ...ledger },
      estimatedSarvamINR: Number(estSarvam.toFixed(3)),
    },
  );
}

export type { LLMTurnResult };