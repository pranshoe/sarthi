import { inferCategory } from "@/portal/categories";
import { findDateInText } from "@/state/dates";
import { isSmallTalk } from "@/agent/detect";
import {
  BARE_AFFIRM,
  BARE_DENIAL,
  CONTACT_CLAIM,
  DENIAL_WITH_VERB,
  DONE_MESSAGE,
  EMAIL_AGREEMENT,
  EXPLICIT_DENIAL,
} from "@/agent/contactPhrases";
import { isExplicitCorrection } from "@/state/stateReducer";
import type { EmailFlowState } from "@/agent/turnRunner";
import type { GrievanceState } from "@/shared/types";

/**
 * Deterministic fact-extraction safety net for the live pipeline.
 *
 * The live model sometimes reports only part of what the user said
 * (seen: entity captured, amount + date + summaries dropped from the same
 * message). Code fills the gaps so no stated fact is ever lost.
 *
 * Hard limits, per spec:
 * - Only fills fields that are still empty. Never overwrites, so the
 *   contradiction flow keeps working for corrections.
 * - Never touches contact fields (priorContactDate / proof / ticket):
 *   those are owned by the handshake in Conversation.preprocess.
 * - Skips contact-talk messages entirely ("I emailed them on 10th August"
 *   is a contact date, not an incident date), small talk, lone years,
 *   and anything sent while the email handshake or draft completion owns
 *   the turn.
 * - Rupee amounts go to amountInvolved (a number), never reliefSought.
 * - Category is inferred, never asked: only at >= 0.6 confidence.
 */
export type FactUpdates = Partial<
  Pick<
    GrievanceState,
    | "entityName"
    | "entityType"
    | "clientIdFolioNoDpid"
    | "incidentDate"
    | "amountInvolved"
    | "complaintCategory"
    | "reliefSought"
    | "issueSummaryEnglish"
    | "issueSummaryOriginal"
    | "soldDescription"
  >
>;

const CONTACT_TALK = new RegExp(
  [
    CONTACT_CLAIM,
    DONE_MESSAGE,
    EXPLICIT_DENIAL,
    DENIAL_WITH_VERB,
    EMAIL_AGREEMENT,
    BARE_AFFIRM,
    BARE_DENIAL,
  ]
    .map((r) => `(?:${r.source})`)
    .join("|"),
  "i",
);

const UCC =
  /\b(?:ucc|client\s*(?:id|code)|folio(?:\s*no)?|dp\s*id)\s*(?:no\.?|#|:|-)?\s*([A-Z0-9]{4,16})\b/i;
/** Rupee prefix optional, so "40000 rupees" and "Rs 40,000" both work. */
const AMOUNT =
  /(?:rs\.?|inr|₹|रु|ரூ|rupees?|rupaye|rupaiya|rupaiye)?\s*(₹?\s*[\d,]{4,}(?:\.\d+)?)\s*(lakh|lac|lacs|lakhs|thousand|hazaar|हजार|ಸಾವಿರ|தொகை)?/i;
const KNOWN_NAMES =
  /\b(zerodha|groww|upstox|angel\s*one|kotak|icici\s*direct|hdfc\s*securities|axis\s*securities|5paisa|indian\s*robin|sbi\s*securities|dhan|icici\s*securities)\b/i;

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** Same gloss shape the mock uses, so live + mock states look alike. */
function englishGloss(
  text: string,
  got: { entityName?: string | null; amountInvolved?: number | null; incidentDate?: string | null },
): string {
  const who = got.entityName ?? "the broker/company";
  const money = got.amountInvolved ? `INR ${got.amountInvolved.toLocaleString("en-IN")} ` : "";
  const when = got.incidentDate ? `, on or around ${got.incidentDate}` : "";
  return (
    `Investor complaint regarding ${money}against ${who}${when}. ` +
    `The investor's own description: "${text}"`
  );
}

export function extractFacts(
  rawText: string,
  opts: { emailFlow: EmailFlowState; draftActive: boolean },
): FactUpdates {
  const t = (rawText ?? "").trim();
  if (!t) return {};
  if (isSmallTalk(t)) return {};
  if (opts.draftActive || opts.emailFlow !== "none") return {};
  if (CONTACT_TALK.test(t)) return {};
  // A lone year ("2026") answers a clarification question; it carries no
  // amount, no entity and no new date.
  if (/^(19|20)\d{2}\s*[.!…]*$/.test(t)) return {};

  const out: FactUpdates = {};

  const named = t.match(KNOWN_NAMES);
  if (named?.[1]) out.entityName = titleCase(named[1].replace(/\s+/g, " ").trim());

  // Strip year tokens before amount matching: "1st August 2026" is a date,
  // not two thousand and twenty-six rupees.
  const deyeared = t.replace(/\b(19|20)\d{2}\b/g, " ");
  const amt = deyeared.match(AMOUNT);
  if (amt?.[1] && /[\d]/.test(amt[1])) {
    let v = parseFloat(amt[1].replace(/[^\d.]/g, ""));
    const unit = (amt[2] || "").toLowerCase();
    if (/lakh|lac/.test(unit)) v *= 100000;
    else if (/thousand|hazaar|हजार|साव/.test(unit)) v *= 1000;
    else if (/தொகை/.test(unit)) v *= 1000;
    if (Number.isFinite(v) && v >= 100) out.amountInvolved = v;
  }

  const date = findDateInText(t);
  if (date) out.incidentDate = date;

  const inferred = inferCategory(t);
  if (inferred && inferred.confidence >= 0.6) out.complaintCategory = inferred.category;

  if (/broker|brokerage|zerodha|groww|upstox|angel/i.test(t)) out.entityType = "broker";
  else if (/nodal officer|iepf|unclaimed|demateriali/i.test(t)) out.entityType = "RTA";
  else if (/rta|registrar|transfer agent/i.test(t)) out.entityType = "RTA";

  if (/refund|money back|paisa wapas|வாங்க|திரும்ப|ಹಣವನ್ನೂ ಹಿಂದಿಕೊಡೆ|paisa wapas/i.test(t))
    out.reliefSought = "Refund of the amount";
  else if (/explanation|why did|clarif/i.test(t)) out.reliefSought = "An explanation for the delay";
  else if (/revers(e|al) (the|my)? ?trade|cancel/i.test(t))
    out.reliefSought = "Reversal of the transaction";

  const ucc = t.match(UCC);
  if (ucc?.[1]) out.clientIdFolioNoDpid = ucc[1].toUpperCase();

  // Summaries are generated, never requested. A short correction that
  // extracted something ("Actually it was 25,000") refines a field, it is
  // not a new story — but this layer only fills empties anyway, so the
  // isExplicitCorrection check is just belt and braces for the summary pair.
  // Neutral chatter with no complaint signal ("nice weather") files nothing.
  const contactMeta = CONTACT_TALK.test(t);
  const hasFacts =
    out.entityName || out.amountInvolved || out.incidentDate || out.complaintCategory || out.clientIdFolioNoDpid;
  const hasSignal =
    !!hasFacts ||
    /money|rupees?|paisa|refund|broker|shares?|account|demat|dividend|complaint|grievance|fraud|unauthori|credit|debit|transfer|invest|folio|ticket|proceeds/i.test(
      t,
    );
  if (
    !isExplicitCorrection(t) &&
    t.length > 14 &&
    hasSignal &&
    !(contactMeta && !hasFacts) &&
    /[a-zA-Z\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]/.test(t)
  ) {
    out.issueSummaryOriginal = t;
    out.issueSummaryEnglish = englishGloss(t, {
      entityName: out.entityName,
      amountInvolved: out.amountInvolved,
      incidentDate: out.incidentDate,
    });
  }

  return out;
}

/**
 * Keep only updates the pipeline may apply. Empty fields are always
 * fillable. Non-empty scalar fields are included ONLY when the message is an
 * explicit correction ("actually it was X"): partitionUpdates then applies
 * them immediately instead of holding them for confirmation. Summaries,
 * category, relief and entity type are never overwritten here — the model's
 * own updates plus the contradiction flow own those.
 */
const CORRECTION_OVERWRITABLE = new Set(["amountInvolved", "incidentDate", "entityName", "clientIdFolioNoDpid"]);

export function onlyEmpty(
  state: GrievanceState,
  updates: FactUpdates,
  allowCorrectionOverwrite = false,
): FactUpdates {
  const out: FactUpdates = {};
  (Object.keys(updates) as (keyof FactUpdates)[]).forEach((k) => {
    const cur = state[k];
    if (cur === null || cur === undefined || String(cur).trim() === "") {
      (out as Record<string, unknown>)[k] = updates[k];
    } else if (allowCorrectionOverwrite && CORRECTION_OVERWRITABLE.has(k)) {
      (out as Record<string, unknown>)[k] = updates[k];
    }
  });
  return out;
}
