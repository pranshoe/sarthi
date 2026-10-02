import type {
  DerivedState,
  FieldKey,
  FilingDeadline,
  GrievanceState,
  LLMTurnResult,
  Phase,
} from "@/shared/types";
import { intakeComplete, missingFields } from "./grievanceState";
import { evaluateEscalation, LIMIT_DAYS } from "./phases";
import { parseISODate, todayISO, toLocalISO, findDateInText } from "./dates";
import { normaliseDate } from "@/agent/guardrails";

/**
 * Code decides what is allowed; the LLM decides what to say.
 * Everything here is pure so it can be unit tested without a model.
 */

/** Merge model output into state. Never lets the model overwrite blindly. */
export function mergeState(
  current: GrievanceState,
  updates: Partial<GrievanceState>,
): GrievanceState {
  const next: GrievanceState = { ...current };

  const strFields = [
    "complaintCategory",
    "entityName",
    "clientIdFolioNoDpid",
    "issueSummaryEnglish",
    "issueSummaryOriginal",
    "reliefSought",
    "userName",
    "userPhone",
    "soldDescription",
  ] as const;

  for (const f of strFields) {
    const v = updates[f];
    // Empty string means "no change", not "clear it". Clearing is done via
    // user corrections, which arrive as a fresh non-empty value or an explicit
    // null in a correction flow.
    if (typeof v === "string" && v.trim() !== "") next[f] = v.trim();
    else if (v === null && current[f] !== null) next[f] = null;
  }

  if (updates.entityType !== undefined && updates.entityType !== null) {
    next.entityType = updates.entityType;
  }

  if (updates.issueSummaryEnglish) {
    // The portal wants plain English. If the model produced nothing usable,
    // fall back to the original so the form is never empty.
    next.issueSummaryEnglish = updates.issueSummaryEnglish.trim();
  }

  if (updates.incidentDate !== undefined) {
    const iso = normaliseDate(updates.incidentDate);
    // A grievance is always about the past. A future date means the model
    // mis-resolved the year, so drop it and let the agent ask again rather
    // than filing a complaint dated next year.
    if (iso && iso <= todayISO()) next.incidentDate = iso;
  }

  if (updates.incidentDate !== undefined) {
    const iso = normaliseDate(updates.incidentDate);
    // A grievance is always about the past. A future date means the model
    // mis-resolved the year, so drop it and let the agent ask again rather
    // than filing a complaint dated next year.
    if (iso && iso <= todayISO()) next.incidentDate = iso;
  }

  if (typeof updates.amountInvolved === "number" && updates.amountInvolved > 0) {
    next.amountInvolved = updates.amountInvolved;
  } else if (updates.amountInvolved === null) {
    next.amountInvolved = null;
  }

  // Contact date and ticket are reported values; confirmation itself is set
  // by code (see setContactConfirmed), never by the model.
  if (updates.priorContactDate !== undefined) {
    const iso = normaliseDate(updates.priorContactDate);
    if (iso && iso <= todayISO()) next.priorContactDate = iso;
  }
  if (typeof updates.priorContactTicket === "string" && updates.priorContactTicket.trim() !== "") {
    next.priorContactTicket = updates.priorContactTicket.trim();
  } else if (updates.priorContactTicket === null && current.priorContactTicket !== null) {
    next.priorContactTicket = null;
  }

  if (updates.priorContactProof !== undefined && updates.priorContactProof !== null) {
    next.priorContactProof = updates.priorContactProof;
  }

  // Code-owned flags. Silently dropped if a model ever sends them.
  return next;
}

/**
 * Framing that marks a message as an explicit correction ("actually X",
 * "no, it was Y"). Explicit corrections apply immediately with a short
 * acknowledgement; anything else that overwrites known data is held for
 * confirmation instead of being committed blindly.
 */
export function isExplicitCorrection(text: string): boolean {
  const t = text.trim();
  // A bare "No" answers something; only "No, ..." with content corrects.
  if (/^(no|nahi|nahin)\s*[.!…]*$/i.test(t)) return false;
  return /actually|correction|my mistake|sorry,? i meant|no,?\s+(it|that|this)\s+was|^no,?\s+\S|wrong|galat|tasappu|thappu|தவறு|ತಪ್ಪು/i.test(
    t,
  );
}

export interface HeldUpdate {
  field: string;
  current: unknown;
  incoming: unknown;
  rounds: number;
}

/** Fields whose overwrite counts as a contradiction worth confirming. */
const CONTRADICTION_FIELDS = [
  "amountInvolved",
  "incidentDate",
  "entityName",
  "clientIdFolioNoDpid",
  "complaintCategory",
  "entityType",
  "reliefSought",
  "priorContactProof",
  "priorContactDate",
  "priorContactTicket",
] as const;

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

/**
 * Split model updates into safe-to-apply vs held-for-confirmation.
 * A non-empty field overwritten with a different value is held, unless the
 * user clearly framed the message as a correction. priorContactConfirmed and
 * skippedFields are code-owned and never arrive here, but are dropped
 * defensively if they do.
 *
 * Year authority: when the user's message states NO year, a model's ISO year
 * is a guess (proven wrong repeatedly: "4th August" became last year). Code
 * recomputes the date from the raw text with the most-recent-past rule and
 * overrides the guess. An explicitly stated year is always trusted.
 */
export function partitionUpdates(
  current: GrievanceState,
  updates: Partial<GrievanceState>,
  rawText: string,
): { apply: Partial<GrievanceState>; held: HeldUpdate[] } {
  const corrected: Partial<GrievanceState> = { ...updates };
  if (!/\b(19|20)\d{2}\b/.test(rawText)) {
    for (const key of ["incidentDate", "priorContactDate"] as const) {
      if (typeof corrected[key] === "string") {
        const codeDate = findDateInText(rawText);
        if (codeDate) (corrected as Record<string, unknown>)[key] = codeDate;
      }
    }
  }
  const apply: Partial<GrievanceState> = {};
  const held: HeldUpdate[] = [];
  const explicit = isExplicitCorrection(rawText);

  for (const [key, value] of Object.entries(corrected)) {
    if (key === "priorContactConfirmed" || key === "skippedFields") continue;
    if (value === undefined || value === "") continue;
    // Explicit nulls are clears; mergeState owns that semantic. Only a
    // concrete new value overwriting a known one can contradict.
    if (value === null) {
      (apply as Record<string, unknown>)[key] = value;
      continue;
    }
    if (!(CONTRADICTION_FIELDS as readonly string[]).includes(key)) {
      (apply as Record<string, unknown>)[key] = value;
      continue;
    }
    const cur = (current as unknown as Record<string, unknown>)[key];
    const curEmpty = cur === null || cur === undefined || String(cur).trim() === "";
    if (curEmpty || sameValue(cur, value) || explicit) {
      (apply as Record<string, unknown>)[key] = value;
    } else {
      held.push({ field: key, current: cur, incoming: value, rounds: 0 });
    }
  }
  return { apply, held };
}

export interface PendingContradiction extends HeldUpdate {}

/**
 * Resolve a held contradiction against the user's next message.
 * Returns "incoming" (apply their newer value), "current" (keep recorded),
 * or "unresolved" (ask once more, then give up and keep the recorded value).
 */
export function resolveContradiction(
  pending: PendingContradiction,
  rawText: string,
): "incoming" | "current" | "unresolved" {
  const t = rawText.trim();
  if (isExplicitCorrection(t)) return "incoming";
  const mentions = (v: unknown) =>
    v !== null && v !== undefined && String(v).trim() !== "" && t.toLowerCase().includes(String(v).trim().toLowerCase());
  // Incoming wins ties: the user just said it.
  if (mentions(pending.incoming)) return "incoming";
  if (mentions(pending.current)) return "current";
  if (/^(yes|yeah|haan|haa|sari|haan ji|ஆம்|சரி|ಹೌದು|సరే)\b/i.test(t)) return "incoming";
  if (pending.rounds >= 1) return "current";
  return "unresolved";
}

/**
 * Phase transitions are enforced here, so a confused model cannot skip
 * straight to AUTOFILL without the prerequisite steps having happened.
 * The model's own phase value is never consulted: code derives the phase
 * purely from state, so the LLM can never set AUTOFILL by itself.
 */
export function computePhase(
  state: GrievanceState,
  modelPhase: Phase | undefined,
  opts: { hasGreeted: boolean; summaryConfirmed: boolean },
): Phase {
  void modelPhase;
  const escalation = evaluateEscalation(state);
  const complete = intakeComplete(state);

  // Forward-only progression through the required gates.
  if (!opts.hasGreeted) return "GREETING";
  if (!complete) return "INTAKE";
  if (!opts.summaryConfirmed) return "CONFIRM";
  // Hard gate (code, not LLM): filing unlocks only once contact with the
  // company is confirmed AND its date is recorded.
  if (state.priorContactConfirmed !== true || !state.priorContactDate) {
    return "PREFLIGHT_EMAIL";
  }
  if (!escalation.eligible || escalation.expired) return "PREFLIGHT_EMAIL";
  return "AUTOFILL";
}

export function computeDerived(
  state: GrievanceState,
  opts: { hasGreeted: boolean; summaryConfirmed: boolean },
  confidence: Partial<Record<string, number>> = {},
): DerivedState {
  const escalation = evaluateEscalation(state);
  const missing = missingFields(state);
  const phase = computePhase(state, undefined, opts);
  const deadline = computeDeadline(state);

  const blockers: string[] = [];
  if (escalation.expired) blockers.push("Outside the SCORES limitation period.");
  if (phase === "CONFIRM") blockers.push("Waiting for you to confirm what I understood.");
  if (phase === "PREFLIGHT_EMAIL" && escalation.reason === "waiting") {
    blockers.push(
      `The company has ${escalation.daysLeft} more days to respond before SCORES will accept this.`,
    );
  }

  // We only fill the portal when every required field exists, the summary is
  // confirmed, and contact with the company is confirmed with a date.
  // Defense in depth alongside the computePhase gate above.
  const canAutofill =
    missing.length === 0 &&
    opts.summaryConfirmed &&
    state.priorContactConfirmed === true &&
    !!state.priorContactDate &&
    escalation.eligible &&
    !escalation.expired;

  return {
    phase,
    missing,
    confidence: confidence as Partial<Record<FieldKey, number>>,
    escalation,
    canAutofill,
    blockers,
    deadline,
  };
}

/**
 * Filing deadline = incident date + SCORES limitation period.
 * Product policy (not a SEBI rule): warn when 60 days or fewer remain.
 */
export const FILING_DEADLINE_WARNING_DAYS = 60;

export function computeDeadline(state: GrievanceState): FilingDeadline {
  const none: FilingDeadline = { date: null, daysLeft: null, urgent: false, passed: false };
  if (!state.incidentDate) return none;
  const filed = parseISODate(state.incidentDate);
  if (!filed) return none;

  const closes = new Date(filed);
  closes.setDate(closes.getDate() + LIMIT_DAYS);
  const today = parseISODate(todayISO());
  if (!today) return none;

  const daysLeft = Math.floor((closes.getTime() - today.getTime()) / 86_400_000);
  const passed = daysLeft < 0;
  return {
    date: toLocalISO(closes),
    daysLeft,
    urgent: passed || daysLeft <= FILING_DEADLINE_WARNING_DAYS,
    passed,
  };
}

/** Fields the model was unsure about, surfaced on the review checklist. */
export function uncertainFields(
  derived: DerivedState,
  threshold = 0.7,
): string[] {
  return Object.entries(derived.confidence)
    .filter(([, v]) => typeof v === "number" && v < threshold)
    .map(([k]) => k);
}

/**
 * Build the "known" view handed to the LLM so it never asks for something
 * already captured.
 */
export function knownView(state: GrievanceState): Record<string, unknown> {
  return {
    complaintCategory: state.complaintCategory,
    entityName: state.entityName,
    entityType: state.entityType,
    clientIdFolioNoDpid: state.clientIdFolioNoDpid,
    issueSummary: state.issueSummaryOriginal,
    incidentDate: state.incidentDate,
    amountInvolved: state.amountInvolved,
    reliefSought: state.reliefSought,
    priorContact: describePriorContact(state),
    priorContactTicket: state.priorContactTicket,
    skippedFields: state.skippedFields.length > 0 ? state.skippedFields.join(", ") : null,
    attachments: state.attachments.map((a) => a.name),
  };
}

function describePriorContact(state: GrievanceState): string | null {
  if (state.priorContactProof === "rejected") {
    return state.priorContactConfirmed
      ? `The company rejected the complaint (contact confirmed${state.priorContactDate ? ` on ${state.priorContactDate}` : ""})`
      : "The company rejected the complaint (date not yet confirmed)";
  }
  if (state.priorContactDate) {
    return state.priorContactConfirmed
      ? `Emailed them on ${state.priorContactDate} (confirmed)`
      : `Emailed them on ${state.priorContactDate} (not yet confirmed)`;
  }
  if (state.priorContactProof === "emailed") return "Says they emailed, date not yet given";
  if (state.priorContactProof === "none") return "Has NOT contacted the company";
  return null;
}

/** Apply a validated turn in one step. Used by the turn runner. */
export function applyTurn(
  state: GrievanceState,
  turn: LLMTurnResult,
): GrievanceState {
  const merged = mergeState(state, turn.stateUpdates);
  if (turn.detectedLanguage) merged.userLanguage = turn.detectedLanguage;
  return merged;
}