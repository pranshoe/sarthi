import { z } from "zod";
import type { LLMTurnResult } from "@/shared/types";

/**
 * Runtime validation of the model's JSON. We do not trust the shape even when
 * the provider is asked for schema-constrained output: a malformed reply must
 * degrade to a usable turn, never crash the panel.
 */

const entityType = z.enum(["broker", "listed company", "RTA", "IEPF"]).nullable();

export const turnSchema = z.object({
  detectedLanguage: z.string().min(2).catch("en-IN"),
  reply: z.string().min(1),
  stateUpdates: z
    .object({
      complaintCategory: z.string().nullable().optional(),
      entityName: z.string().nullable().optional(),
      entityType: entityType.optional(),
      clientIdFolioNoDpid: z.string().nullable().optional(),
      issueSummaryEnglish: z.string().nullable().optional(),
      issueSummaryOriginal: z.string().nullable().optional(),
      incidentDate: z
        .string()
        .nullable()
        .optional()
        .refine(
          (v) => v === null || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v),
          "incidentDate must be ISO yyyy-mm-dd",
        ),
      amountInvolved: z.number().nullable().optional(),
      reliefSought: z.string().nullable().optional(),
      // The model may report what it heard (a date, a ticket number).
      // Whether contact is CONFIRMED is decided by code, never by the model,
      // so priorContactConfirmed and skippedFields are not settable here.
      priorContactDate: z
        .string()
        .nullable()
        .optional()
        .refine(
          (v) => v === null || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v),
          "priorContactDate must be ISO yyyy-mm-dd",
        ),
      priorContactTicket: z.string().nullable().optional(),
      userName: z.string().nullable().optional(),
      userPhone: z.string().nullable().optional(),
      soldDescription: z.string().nullable().optional(),
    })
    .catch({}),
  phase: z
    .enum(["GREETING", "INTAKE", "CONFIRM", "PREFLIGHT_EMAIL", "AUTOFILL", "REVIEW"])
    .catch("INTAKE"),
  nextAction: z
    .enum(["none", "show_summary", "draft_email", "start_autofill"])
    .catch("none"),
  confidence: z.record(z.string(), z.number()).catch({}),
});

/** Pull a JSON object out of a reply that may be wrapped in prose or fences. */
export function extractJSON(raw: string): unknown | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  // Direct parse first.
  try {
    return JSON.parse(s);
  } catch {
    /* fall through to brace scanning */
  }

  // Scan for the first balanced object, ignoring braces inside strings.
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function validateTurn(raw: string): LLMTurnResult | null {
  const json = extractJSON(raw);
  if (!json) return null;
  const parsed = turnSchema.safeParse(json);
  return parsed.success ? (parsed.data as LLMTurnResult) : null;
}

// ---- guardrails ----

/**
 * Refuse to display advice or outcome promises. The model is instructed not to
 * give these, but a prompt is a request, not a guarantee, so the UI filters too.
 */
const BANNED = [
  /\b(you will definitely|win for sure|guaranteed to|assured refund|you will get your money back)\b/i,
  /\b(it is illegal (for you|they)|you should sue|legally you are entitled to)\b/i,
  /\b(SEBI will (award|pay|compensate|refund) you)\b/i,
  // Neutral-empathy rule: never judge or accuse the company, and never use
  // loaded words that assume wrongdoing the user has not established.
  /\b(unacceptable|cheating|illegal)\b/i,
];

export function violatesGuardrails(text: string): boolean {
  return BANNED.some((re) => re.test(text));
}

/**
 * Day counts the agent is allowed to state, because they come from
 * SCORES_RULES (21-day ATR, 15-day reviews/feedback, 365-day limitation).
 * Anything else with a day/week/month unit is an invented rule.
 */
export const ALLOWED_DAY_COUNTS = [21, 15, 365];

/**
 * True when the reply states a process timeline or legal rule we have not
 * verified: a day count outside scoresRules, "rules require" language, or a
 * SEBI/rules authority claim in any language or script (Hindi "SEBI ke rules
 * ke anusar" dodges the English-only patterns — seen live).
 * Phone numbers, years and "one year" (no digits) never match: the unit
 * pattern requires day/week/month right after the number.
 */
export function statesUnverifiedRule(text: string): boolean {
  const t = text ?? "";
  if (/\b30\s*days?\b/i.test(t)) return true; // abolished waiting period, never say it
  if (/\brules?\s+require[sd]?\b/i.test(t)) return true;
  if (/\bSEBI\s+(rules|requires|mandates)\b/i.test(t)) return true;
  // "SEBI ke rules ke anusar", "SEBI ke niyam", "SEBI kanoon ke tahat" (+Devanagari).
  if (/\bSEBI\b.{0,50}\b(ke\s+rules?|rules?\s+ke|niyam|niyamon|kanoon|kaanoon|kayde|नियम|कानून)\b/i.test(t)) return true;
  // Bare rules-as-authority in Hindi/Hinglish, with or without SEBI named.
  if (/\b(rules?|niyam|kanoon|kaanoon)\s+ke\s+(anusar|anusaar|tahat|mutabiq)\b/i.test(t)) return true;
  if (/(नियम|कानून)\s+के\s+(तहत|अनुसार)/.test(t)) return true;
  const counts = t.match(/(\d+)\s*(days?|weeks?|months?)\b/gi) ?? [];
  for (const c of counts) {
    const n = Number(c.match(/\d+/)?.[0]);
    if (Number.isFinite(n) && !ALLOWED_DAY_COUNTS.includes(n)) return true;
  }
  return false;
}

/**
 * Deterministic rewrite applied when the model states an unverified timeline
 * or rule even after the repair pass. The reply keeps its shape and question;
 * only the offending language is replaced with verified-safe wording.
 * Guarantees the S8 corpus scan can never fail on a live turn.
 */
export function sanitiseRuleLanguage(text: string): string {
  let out = text ?? "";
  out = out.replace(
    /\bSEBI rules? require[^.?!]*[.?!]/gi,
    "Before SCORES, the company needs to have been contacted first. ",
  );
  out = out.replace(
    /\bSEBI\s+(rules|requires|mandates)\b[^.?!]*[.?!]/gi,
    "I'm not sure about that detail — please check scores.sebi.gov.in. ",
  );
  // Hindi/Hinglish authority claims ("SEBI ke rules ke anusar, ... zaroori
  // hai."): drop the whole sentence, same as the English equivalents above.
  out = out.replace(
    /[^.?!]*\bSEBI\b[^.?!]*\b(ke\s+rules?|rules?\s+ke|niyam|niyamon|kanoon|kaanoon|kayde|नियम|कानून)\b[^.?!]*[.?!]/gi,
    "Before SCORES, the company needs to have been contacted first. ",
  );
  out = out.replace(
    /[^.?!]*\b((rules?|niyam|kanoon|kaanoon)\s+ke\s+(anusar|anusaar|tahat|mutabiq)|(नियम|कानून)\s+के\s+(तहत|अनुसार))\b[^.?!]*[.?!]/gi,
    "Before SCORES, the company needs to have been contacted first. ",
  );
  out = out.replace(
    /\b(\d+)\s*(days?|weeks?|months?)\b/gi,
    (m, n) => (ALLOWED_DAY_COUNTS.includes(Number(n)) ? m : "some time"),
  );
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * True when the reply declares intake complete ("I have all the details").
 * The caller decides whether anything is actually still missing.
 */
export function declaresReadiness(text: string): boolean {
  return /\bi (have|ve got) (all|everything)|we have everything|all the details (are in|have been)|everything (i need|needed) is (in|here)|i('ve| have) got everything\b/i.test(
    text ?? "",
  );
}

interface AskPattern {
  field: string;
  re: RegExp;
}

/**
 * Which known field (if any) a reply is asking about. Conservative on
 * purpose: only strong, unambiguous question patterns match, across English
 * and the most common romanized/Indic keywords (UCC/PAN are script-agnostic).
 * Returns null when the reply asks nothing recognizable.
 */
const ASK_PATTERNS: AskPattern[] = [
  {
    field: "entityName",
    re: /which (broker|company)|(?:broker|company|entity).{0,25}name|name of (the )?(broker|company|entity)|who (is|are) (it|this|they)|kis (broker|company)|कौन (सी |सा )? ?(ब्रोकर|कंपनी)|எந்த (டீலர்|நிறுவனம்)|ಯಾವ (ಬ್ರೋಕರ್|ಕಂಪನಿ)/i,
  },
  {
    field: "incidentDate",
    re: /when did|what date|which date|date.{0,20}(happen|incident|occur)|kab hua|कब हुआ|எப்போது|ಯಾವಾಗ/i,
  },
  {
    field: "amountInvolved",
    re: /how much|what amount|amount involved|kitni (rashi|rakam)|राशि|எவ்வளவு|எத்தனை|ಎಷ್ಟು/i,
  },
  {
    field: "clientIdFolioNoDpid",
    re: /client.?id|UCC|folio|dp.?id|demat account/i,
  },
  {
    field: "reliefSought",
    re: /what would you like|what outcome|what do you want|relief|kya chahte|என்ன வேண்டும்|ಏನು ಬೇಕು/i,
  },
  {
    field: "complaintCategory",
    re: /what kind of (problem|complaint|issue)|kis tarah|किस तरह|என்ன மாதிரி|ಯಾವ ರೀತಿಯ/i,
  },
  {
    field: "entityType",
    re: /who is this company to you|what do they do for you|broker.*or.*(company|listed)|listed company.*\?/i,
  },
  {
    field: "priorContact",
    re: /(did|have) you (email|write|contact)|already (emailed|written|contacted)|likha (hai|tha)?\s*\?|email bheji/i,
  },
];

export function askedAboutField(
  reply: string,
  known: Record<string, unknown>,
): string | null {
  const text = reply ?? "";
  for (const { field, re } of ASK_PATTERNS) {
    if (!re.test(text)) continue;
    const v = known[field];
    if (v !== null && v !== undefined && String(v).trim() !== "") return field;
    // priorContact is "known" when the user has taken any position on it.
    if (field === "priorContact" && known.priorContact) return field;
  }
  return null;
}

/** Replace a non-compliant reply with a neutral, still-useful line. */
export function neutralise(text: string, lang: string): string {
  const fallback: Record<string, string> = {
    en: "I can't say what the outcome will be, but I can help you file it properly. What would you like me to do next?",
    hi: "मैं परिणाम की गारंटी नहीं दे सकता, लेकिन आपकी शिकायत सही तरीके से दर्ज करने में मदद कर सकता हूँ। आगे क्या करें?",
    ta: "விளைவை நான் உறுதிப்படுத்த முடியாது, ஆனால் புகாரை சரியாக பதிவு செய்ய உதவலாம். அடுத்து என்ன செய்யலாம்?",
  };
  return fallback[lang.split("-")[0] ?? "en"] ?? fallback.en!;
}

const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_NAME =
  "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";

/**
 * A day+month with no year means the most recent past occurrence, not blindly
 * this calendar year. In January, "15th December" is last December.
 */
export function recentPast(day: number, month: number, today = new Date()): string | null {
  let iso = isoOf(day, month, today.getFullYear());
  if (!iso) return null;
  const asDate = new Date(`${iso}T00:00:00`);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (asDate.getTime() > startOfToday.getTime()) {
    iso = isoOf(day, month, today.getFullYear() - 1);
  }
  return iso;
}

/** Coerce a spoken or typed date into ISO. Returns null when unusable. */
export function normaliseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy and dd-mm-yyyy
  const numeric = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    let y = Number(numeric[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return isoOf(d, m, y);
  }

  // "3rd March", "3rd March 2024", "March 3rd, 2024", "12 sept"
  const verbal =
    s.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME}\\s*,?\\s*(\\d{2,4})?$`, "i")) ??
    s.match(new RegExp(`^${MONTH_NAME}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{2,4})?$`, "i"));
  if (verbal) {
    // The two patterns put day/month in different groups; year is group 3 in both.
    const isDayFirst = /^\d/.test(s);
    const day = Number(isDayFirst ? verbal[1] : verbal[2]);
    const monthName = (isDayFirst ? verbal[2] : verbal[1]) ?? "";
    const yearRaw = verbal[3];
    const m = MONTH_NUM[monthName.slice(0, 3).toLowerCase()];
    if (!m || !Number.isFinite(day)) return null;
    if (yearRaw) {
      let y = Number(yearRaw);
      if (yearRaw.length <= 2) y += y < 70 ? 2000 : 1900;
      return isoOf(day, m, y);
    }
    return recentPast(day, m);
  }

  // Relative: "5 days ago", "today", "yesterday"
  const rel = s.match(/(\d+)\s*(?:days?|weeks?)/i);
  if (rel) {
    const n = Number(rel[1]);
    const mult = /week/i.test(s) ? 7 : 1;
    const d = new Date();
    d.setDate(d.getDate() - n * mult);
    return d.toISOString().slice(0, 10);
  }
  if (/today|आज|இன்று/i.test(s)) return new Date().toISOString().slice(0, 10);
  if (/yesterday|कल|நேற்று/i.test(s)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function isoOf(d: number, m: number, y: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

/** Keep only the first N sentences, used to bound TTS cost. */
export function truncateForSpeech(text: string, maxSentences: number): string {
  const parts = text
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= maxSentences) return text;
  return parts.slice(0, maxSentences).join(" ");
}

/**
 * What artifact (if any) a reply presents to the user. Used to keep words
 * and actions in agreement: a reply saying "here is the draft" must carry
 * nextAction draft_email or the UI never renders it. Interrogative offers
 * ("Shall I draft…?") do NOT count — only present-tense presentations.
 */
export function promisedAction(
  reply: string,
): "draft_email" | "show_summary" | "start_autofill" | null {
  const t = reply ?? "";
  if (
    /(here is|here's) (the|your|a) (draft|email)|i('ll| will) (draft|prepare) (the|an|this|your) (email|draft)/i.test(
      t,
    )
  ) {
    return "draft_email";
  }
  // Hindi/Hinglish present-tense presentations ("Yeh lijiye aapka email
  // draft tayar hai"). Interrogative offers ("draft taiyar kar dun?") do
  // NOT match: they ask, they don't present.
  if (
    /(yeh lijiye|yeh raha|ye raha|lijiye).{0,40}\b(draft|email)\b/i.test(t) ||
    /\b(draft|email)\b.{0,40}(tai?yar\s+(hai|kar diya hai)|ban ga(yi|ya)|ready hai)/i.test(t)
  ) {
    return "draft_email";
  }
  if (
    /(here is|here's).*(summary|what i understood)|review (the|this|below)|please review/i.test(
      t,
    )
  ) {
    return "show_summary";
  }
  if (/i('ll| will) fill|filling .*form (for|now)|opening .*scores/i.test(t)) {
    return "start_autofill";
  }
  return null;
}

/**
 * Normalised similarity between two replies, 0..1.
 *
 * Lowercases, strips punctuation (Unicode-aware, so Indic scripts survive),
 * then takes 1 minus the character Levenshtein ratio. Short agent replies
 * compare well under this measure; there are no embeddings available offline,
 * so this is the documented stand-in for the 0.8 threshold.
 */
export function textSimilarity(a: string, b: string): number {
  const na = normaliseText(a);
  const nb = normaliseText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  // Two-row DP. Replies are a few sentences; this stays trivially cheap.
  if (a.length < b.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}