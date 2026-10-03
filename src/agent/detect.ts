/**
 * Script and language detection for the user's latest message.
 *
 * The LLM is instructed to mirror language, but we still detect locally so the
 * mock provider behaves identically to a live model, and so TTS knows which
 * voice to use. Spec section 3: detect the language AND script of the most
 * recent message, including romanized and code-mixed input.
 */

export interface DetectedLang {
  /** BCP-47 with script, e.g. "ta-IN", "hi-Latn", "en-IN". */
  tag: string;
  base: string;
  script: "Latn" | "Deva" | "Taml" | "Telu" | "Beng" | "Guru" | "Knda" | "Mlym" | "Gujr" | "Guru2" | "Arab";
  latin: boolean;
  confidence: number;
}

/** Script blocks we care about, keyed by Unicode range. */
const SCRIPTS: Array<{ script: DetectedLang["script"]; re: RegExp; base: string; tag: string }> = [
  { script: "Taml", re: /[\u0B80-\u0BFF]/, base: "ta", tag: "ta-IN" },
  { script: "Knda", re: /[\u0C80-\u0CFF]/, base: "kn", tag: "kn-IN" },
  { script: "Telu", re: /[\u0C00-\u0C7F]/, base: "te", tag: "te-IN" },
  { script: "Mlym", re: /[\u0D00-\u0D7F]/, base: "ml", tag: "ml-IN" },
  { script: "Beng", re: /[\u0980-\u09FF]/, base: "bn", tag: "bn-IN" },
  { script: "Guru", re: /[\u0A00-\u0A7F]/, base: "pa", tag: "pa-IN" },
  { script: "Gujr", re: /[\u0A80-\u0AFF]/, base: "gu", tag: "gu-IN" },
  { script: "Deva", re: /[\u0900-\u097F]/, base: "hi", tag: "hi-IN" },
  { script: "Arab", re: /[\u0600-\u06FF]/, base: "ur", tag: "ur-IN" },
];

/**
 * Romanized-language markers. Deliberately conservative: a bare Latin string is
 * English unless it contains a word that only appears in romanized Indic.
 */
const ROMANIZED: Array<{ base: string; tag: string; words: string[] }> = [
  { base: "hi", tag: "hi-Latn", words: ["namaste", "mera", "paisa", "nahi", "nahin", "hai", "hain", "kripya", "dhanyavad", "bheja", "bhej", "kar", "kiya", "koi", "mujhe", "shikayat", "khalo", "accha"] },
  { base: "ta", tag: "ta-Latn", words: ["vanakkam", "vanakkam", "naan", "enakku", "ennai", "illai", "irundhu", "konjam", "sollunga", "soru", "naal", "kondu", "panam", "vittam"] },
  { base: "te", tag: "te-Latn", words: ["namaskaram", "nenu", "meeku", "undi", "ledu", "kante", "cheppai", "raaledu", "paisa"] },
  { base: "kn", tag: "kn-Latn", words: ["namaskara", "naanu", "nakku", "illa", "iddu", "yava", "hage", "tanna", "paisa"] },
  { base: "ml", tag: "ml-Latn", words: ["namaskaram", "naanu", "akkre", "illa", "und", "enta", "panam"] },
  { base: "bn", tag: "bn-Latn", words: ["namaskar", "ami", "amar", "taka", "nai", "ghono"] },
  { base: "mr", tag: "mr-Latn", words: ["namaskar", "maza", "ahe", "nahi", "kar"] },
  { base: "gu", tag: "gu-Latn", words: ["kem", "tamaro", "che", "nathi", "makar"] },
  { base: "pa", tag: "pa-Latn", words: ["sat", "sri", "aap", "da", "hai", "koi"] },
];

/** Greetings that reveal intent on a very short message. */
const GREETINGS: Array<{ re: RegExp; lang: DetectedLang["tag"] }> = [
  { re: /^\s*(vanakkam|வணக்கம்)/i, lang: "ta-IN" },
  { re: /^\s*(namaskaram|నమస్కారం)/i, lang: "te-IN" },
  { re: /^\s*(namaskara|ನಮಸ್ಕಾರ)/i, lang: "kn-IN" },
  { re: /^\s*(namaste|नमस्ते)/i, lang: "hi-IN" },
  { re: /^\s*(namaskar|নমস্কার)/i, lang: "bn-IN" },
  { re: /^\s*(namaskar|नमस्कार)/i, lang: "mr-IN" },
  { re: /^\s*(kem|કેમ)/i, lang: "gu-IN" },
  { re: /^\s*(sat sri|sat shri)/i, lang: "pa-IN" },
];

export function detectLanguage(input: string): DetectedLang {
  const text = (input ?? "").trim();
  if (!text) return { tag: "en-IN", base: "en", script: "Latn", latin: true, confidence: 0 };

  // 1. Native script wins outright.
  for (const s of SCRIPTS) {
    if (s.re.test(text)) {
      return { tag: s.tag, base: s.base, script: s.script, latin: false, confidence: 0.98 };
    }
  }

  // 2. Greeting-specific hint, useful for very short or ambiguous input.
  // A Latin-script greeting ("Namaste!") is romanized, not native: the tag
  // must say -Latn or downstream script checks misread English replies.
  for (const g of GREETINGS) {
    const m = g.re.exec(text);
    if (m) {
      const tag = g.lang;
      const base = tag.split("-")[0]!;
      if (/^[\x00-\x7F]*$/.test(m[0])) {
        return { tag: `${base}-Latn`, base, script: "Latn", latin: true, confidence: 0.9 };
      }
      return {
        tag,
        base,
        script: scriptForTag(tag),
        latin: false,
        confidence: 0.9,
      };
    }
  }

  // 3. Romanized Indic. Count matches, pick the strongest.
  const lower = ` ${text.toLowerCase()} `;
  let best: { base: string; tag: string; hits: number } | null = null;
  for (const r of ROMANIZED) {
    let hits = 0;
    for (const w of r.words) {
      if (new RegExp(`\\b${w}\\b`, "i").test(lower)) hits++;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { base: r.base, tag: r.tag, hits };
  }
  if (best && best.hits >= 1) {
    return {
      tag: best.tag,
      base: best.base,
      script: "Latn",
      latin: true,
      confidence: Math.min(0.9, 0.5 + best.hits * 0.15),
    };
  }

  return { tag: "en-IN", base: "en", script: "Latn", latin: true, confidence: 0.6 };
}

export function scriptForTag(tag: string): DetectedLang["script"] {
  const found = SCRIPTS.find((s) => s.tag === tag);
  return found ? found.script : "Latn";
}

/** Is this a greeting / very short message that is not yet a complaint? */
export function isSmallTalk(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  const greeting =
    /^(hi|hello|hey|yo|hii+|namaste|namaskar|namaskaram|vanakkam|namaskara|sat sri|good (morning|afternoon|evening)|ok|okay|thanks|thank you|haan|ha|yes|no)\b[.! ]*$/i;
  if (greeting.test(t)) return true;
  // Native-script greetings (নমস্কার, કેમ, ...): same rule, any script.
  // The table patterns are prefix-anchored, so require the remainder to be
  // punctuation only — "vanakkam, I have a problem" is intake, not small talk.
  const raw = text.trim();
  for (const g of GREETINGS) {
    const m = g.re.exec(raw);
    if (m && /^[\s.!…]*$/.test(raw.slice(m[0].length))) return true;
  }
  return t.length <= 3;
}