import type { FieldKey, GrievanceState } from "@/shared/types";

export const emptyState = (): GrievanceState => ({
  complaintCategory: null,
  entityName: null,
  entityType: null,
  clientIdFolioNoDpid: null,
  issueSummaryEnglish: null,
  issueSummaryOriginal: null,
  incidentDate: null,
  amountInvolved: null,
  priorContactDate: null,
  priorContactProof: null,
  priorContactConfirmed: false,
  priorContactTicket: null,
  userName: null,
  userPhone: null,
  soldDescription: null,
  reliefSought: null,
  attachments: [],
  userLanguage: "en-IN",
  skippedFields: [],
});

/**
 * What "ready to review" means, computed in code — never declared by the LLM.
 * entityName, both summaries, date, amount, relief, plus an explicit position
 * on prior contact (proof set to emailed/none/rejected counts as explicit;
 * untouched null does not). clientId and priorContactProof detail are optional
 * and never block. entityType/complaintCategory are inferred with confidence
 * and asked openly only when uncertain — they never block review.
 */
export const REQUIRED_FOR_REVIEW: FieldKey[] = [
  "entityName",
  "issueSummaryEnglish",
  "incidentDate",
  "amountInvolved",
  "reliefSought",
  "priorContact",
];

/**
 * Advisory tail, asked only once nothing required is missing. These never
 * block review or autofill: the client ID is wanted by the portal but often
 * unknown, so it must never trap the user (acceptance test 9). Kept to a
 * single field on purpose — entityType/complaintCategory stay inferred-only
 * and are never quiz material.
 */
export const OPTIONAL: FieldKey[] = ["clientIdFolioNoDpid"];

export function has(state: GrievanceState, key: FieldKey): boolean {
  switch (key) {
    case "priorContact":
      return state.priorContactProof !== null;
    default: {
      const v = state[key as keyof GrievanceState];
      return v !== null && v !== undefined && String(v).trim() !== "";
    }
  }
}

/**
 * Single source of truth for "what is still missing".
 * The LLM is told this list; it never decides policy itself.
 * Skipped fields (asked twice, never answered) are excluded for good.
 */
export function missingFields(state: GrievanceState): FieldKey[] {
  return REQUIRED_FOR_REVIEW.filter((k) => !has(state, k));
}

/**
 * The optional fields that have not been asked for yet.
 */
export function missingOptionalFields(state: GrievanceState): FieldKey[] {
  const skipped = new Set(state.skippedFields);
  return OPTIONAL.filter((k) => !skipped.has(k) && !has(state, k));
}

/**
 * What the next question should most plausibly be about: first missing
 * required-for-review field, then unfilled optional fields. Used to
 * attribute answers (and non-answers) to the field being asked about.
 */
export function nextFocus(state: GrievanceState): FieldKey | null {
  const missing = missingFields(state);
  if (missing.length > 0) return missing[0]!;
  const optional = missingOptionalFields(state);
  if (optional.length > 0) return optional[0]!;
  return null;
}

/** True once we know enough to show the user a summary for confirmation. */
export function intakeComplete(state: GrievanceState): boolean {
  return missingFields(state).length === 0;
}
