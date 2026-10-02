import type { STTProvider, STTResult, TTSProvider } from "../types";
import { ledger, logCost } from "../types";
import { TTS_SPEAKERS, ttsLangFor } from "@/shared/config";
import { config } from "@/shared/config";

/**
 * Sarvam speech adapters.
 *
 * Endpoint shapes verified against docs.sarvam.ai (Oct 2026):
 *   POST /speech-to-text   multipart  model=saaras:v4  mode=transcribe
 *   POST /text-to-speech   json       { text, language_code, model, speaker }
 *   -> { audios: string[] }  base64, NOT a single `audio` field
 *
 * Translation is deliberately not used: the LLM produces the English summary
 * in the same call as the user's language summary (spec 2a).
 *
 * All traffic goes through the local proxy. The key never enters the bundle.
 */

const SARVAM_BASE = "https://api.sarvam.ai";

function proxy(path: string): string {
  return `${config.proxyUrl.replace(/\/$/, "")}${path}`;
}

// ---------------- Speech to text ----------------

export class SarvamSTTProvider implements STTProvider {
  readonly id = "sarvam-stt";

  async transcribe(audio: Blob, langHint?: string): Promise<STTResult> {
    if (config.mockMode) return mockSTT(langHint ?? "en-IN");

    const fd = new FormData();
    fd.append("file", audio, "clip.webm");
    fd.append("model", "saaras:v4");
    fd.append("mode", "transcribe");
    // Sarvam auto-detects when we pass "unknown", which suits a user who never
    // chose a language.
    fd.append("language_code", langHint && langHint !== "auto" ? langHint : "unknown");

    const t0 = performance.now();
    const res = await fetch(proxy("/stt"), { method: "POST", body: fd });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`stt ${res.status}: ${detail.slice(0, 200)}`);
    }

    const json = (await res.json()) as { text?: string; detectedLang?: string };
    const seconds = Math.max(1, Math.round((performance.now() - t0) / 1000));
    ledger.sttSeconds += seconds;

    logCost("stt:sarvam", {
      model: "saaras:v4",
      ms: Math.round(performance.now() - t0),
      approxAudioSeconds: seconds,
      chars: json.text?.length ?? 0,
    });

    return { text: json.text ?? "", detectedLang: json.detectedLang ?? langHint ?? "en-IN" };
  }
}

export class MockSTTProvider implements STTProvider {
  readonly id = "mock-stt";
  async transcribe(_audio: Blob, langHint?: string): Promise<STTResult> {
    return mockSTT(langHint ?? "en-IN");
  }
}

/** Canned transcripts per language so voice can be demoed with zero credits. */
const MOCK_TRANSCRIPTS: Record<string, string> = {
  en: "My broker has not credited my sale proceeds since the third of March, forty thousand rupees are still missing.",
  hi: "मेरे ब्रोकर ने तीसरी मार्च से मेरी बिक्री का पैसा जमा नहीं किया, चालीस हजार रुपये अभी भी बकाया है।",
  ta: "என் டீலர் மார்ச் மூன்றாவது நாளிலிருந்து எனக்கு விற்பனை பணத்தை வழங்கவில்லை, நாற்பது ஆயிரம் ரூபாய் இன்னும் காணப்படவில்லை.",
  kn: "ನನ್ನ ಬ್ರೋಕರ್ ಮಾರ್ಚ್ ಮೂರನೇ ದಿಂದ ನನ್ನ ಮಾರಾಟ ಹಣವನ್ನು ಜಮಾ ಮಾಡಿಲ್ಲ, ನಲವತ್ತು ಸಾವಿರ ರೂಪಾಯಿ ಇನ್ನೂ ಇಲ್ಲ.",
  te: "నా డీలర్ మార్చి మూడో నాటి నుండి నా అమ్మకాల డబ్బు జమా చేయలేదు, నలబై వేల రూపాయలు ఇంకా లేవు.",
  default: "My broker has not credited my sale proceeds, forty thousand rupees are still missing.",
};

function mockSTT(lang: string): STTResult {
  const base = lang.split("-")[0] ?? "en";
  return {
    text: MOCK_TRANSCRIPTS[base] ?? MOCK_TRANSCRIPTS.default!,
    detectedLang: lang,
  };
}

// ---------------- Text to speech ----------------

export class SarvamTTSProvider implements TTSProvider {
  readonly id = "sarvam-tts";
  /** Cache by text+lang hash so a repeated reply costs nothing (spec 2c). */
  private cache = new Map<string, Blob>();

  async speak(text: string, lang: string): Promise<Blob> {
    const ttsLang = ttsLangFor(lang);
    if (!ttsLang) throw new Error(`No Bulbul v3 voice for ${lang}`);
    if (config.mockMode) return mockAudio();

    const key = `${ttsLang}::${hash(text)}`;
    const hit = this.cache.get(key);
    if (hit) {
      logCost("tts:sarvam", { cacheHit: true, chars: text.length });
      return hit;
    }

    const speaker = TTS_SPEAKERS[ttsLang] ?? "anushka";
    const res = await fetch(proxy("/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language_code: ttsLang, model: "bulbul:v3", speaker }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`tts ${res.status}: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as { audios?: string[] };
    const b64 = json.audios?.[0];
    if (!b64) throw new Error("tts returned no audio");

    const bytes = base64ToBytes(b64);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" });
    this.cache.set(key, blob);

    ledger.ttsChars += text.length;
    logCost("tts:sarvam", { lang: ttsLang, speaker, chars: text.length, bytes: bytes.length });

    return blob;
  }
}

export class MockTTSProvider implements TTSProvider {
  readonly id = "mock-tts";
  async speak(_text: string, _lang: string): Promise<Blob> {
    return mockAudio();
  }
}

/** A short silent WAV so the playback path is exercised without credits. */
function mockAudio(): Blob {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * 0.15);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return new Blob([buffer], { type: "audio/wav" });
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",").pop()! : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export { SARVAM_BASE };