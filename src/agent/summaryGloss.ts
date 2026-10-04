import type { GrievanceState } from "@/shared/types";

/**
 * Plain-English one-liner for the portal and the email draft: who, money,
 * what, when, relief. Every segment is conditional, so the result is never
 * hollow ("regarding against") no matter which subset is known. Never quotes
 * the user's words, so state stays English in every input language.
 *
 * Shared by the deterministic extractor and the mock LLM so live + mock
 * states look alike. The live model writes its own English; code only ever
 * (re)writes text matching isCodeGloss(), never model wording.
 */
export interface GlossInputs {
  entityName?: string | null;
  amountInvolved?: number | null;
  incidentDate?: string | null;
  soldDescription?: string | null;
  reliefSought?: string | null;
}

export function pickGlossInputs(state: GrievanceState): GlossInputs {
  return {
    entityName: state.entityName,
    amountInvolved: state.amountInvolved,
    incidentDate: state.incidentDate,
    soldDescription: state.soldDescription,
    reliefSought: state.reliefSought,
  };
}

export function sameGlossInputs(a: GlossInputs, b: GlossInputs): boolean {
  return (
    (a.entityName ?? null) === (b.entityName ?? null) &&
    (a.amountInvolved ?? null) === (b.amountInvolved ?? null) &&
    (a.incidentDate ?? null) === (b.incidentDate ?? null) &&
    (a.soldDescription ?? null) === (b.soldDescription ?? null) &&
    (a.reliefSought ?? null) === (b.reliefSought ?? null)
  );
}

export function buildEnglishSummary(got: GlossInputs): string {
  const who = got.entityName?.trim() || "the broker/company";
  let out = `Investor complaint against ${who}`;
  if (typeof got.amountInvolved === "number" && got.amountInvolved > 0) {
    out += ` regarding INR ${got.amountInvolved.toLocaleString("en-IN")}`;
  }
  const what = got.soldDescription?.trim();
  if (what) out += ` (${what})`;
  if (got.incidentDate) out += `, incident ${got.incidentDate}`;
  out += ".";
  const relief = got.reliefSought?.trim();
  if (relief) out += ` Seeks ${relief.charAt(0).toLowerCase()}${relief.slice(1)}.`;
  return out;
}

/** True for text this builder (or its predecessor) produced. */
export function isCodeGloss(text: string | null | undefined): boolean {
  return !!text && /^Investor complaint\b/.test(text.trim());
}

/**
 * The retired template's artifacts ("regarding against" from an empty money
 * slot, or a quoted original). Rebuilt once on sight; the new template can
 * never produce them, so this converges and never churns.
 */
export function isLegacyGloss(text: string | null | undefined): boolean {
  return !!text && /regarding against|own description/i.test(text);
}

/**
 * What was bought or sold, from free text. Verb-first ("sold 50 Infosys
 * shares") and Hinglish verb-last ("50 Infosys share becha tha"). Capped and
 * trimmed; returns null when nothing instrument-like is stated.
 */
export function extractSoldDescription(text: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const verbFirst =
    /(?:sold|bought|purchased?)\s+([A-Za-z0-9][^,.!?]{1,48}?\s+(?:shares?|stocks?|bonds?|debentures?|mutual\s+funds?|units?))\b/i.exec(
      t,
    );
  if (verbFirst?.[1]) return verbFirst[1].trim().slice(0, 60) || null;
  const verbLast =
    /((?:\d[\d,]*\s+)?[A-Za-z][A-Za-z.]*\s+(?:shares?|stocks?))\s+(?:becha|bechi|khareeda|khareede|liya|liye)\b/i.exec(
      t,
    );
  if (verbLast?.[1]) return verbLast[1].trim().slice(0, 60) || null;
  return null;
}
