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
 * Which fields block an autofill. clientIdFolioNoDpid is deliberately absent:
 * many retail investors genuinely do not know it, and we must be able to move
 * on without it rather than trapping them in a loop (acceptance test 9).
 */
export const REQUIRED: FieldKey[] = [
  "issueSummaryEnglish",
  "entityName",
  "entityType",
  "complaintCategory",
  "incidentDate",
  "reliefSought",
];

export const OPTIONAL: FieldKey[] = ["clientIdFolioNoDpid", "amountInvolved"];

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
  const skipped = new Set(state.skippedFields);
  return REQUIRED.filter((k) => !skipped.has(k) && !has(state, k));
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
 * required field, then unfilled optional fields. Used to attribute answers
 * (and non-answers) to the field being asked about.
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
  return missingFields(state).length === 0 && missingOptionalFields(state).length === 0;
}