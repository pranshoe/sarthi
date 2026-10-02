import type { EscalationStatus, GrievanceState } from "@/shared/types";
import { parseISODate, daysBetween, todayISO, toDate, toLocalISO } from "./dates";
import { SCORES_RULES } from "@/data/scoresRules";

/**
 * All numbers come from SCORES_RULES (verified, sourced). Nothing here is a
 * magic literal: if SEBI changes a timeline, one file changes and the
 * escalation logic, emails and deadlines all follow.
 */
export const WAIT_DAYS = SCORES_RULES.preFilingEntityWaitDays.value;
export const ATR_DAYS = SCORES_RULES.atrDays.value;
export const REVIEW_DAYS = SCORES_RULES.firstReviewDays.value;
export const LIMIT_DAYS = SCORES_RULES.limitationDays.value;

export const TIMELINE = [
  { stage: "Broker response expected", days: WAIT_DAYS, note: "wait before escalating" },
  { stage: "Entity must file ATR", days: ATR_DAYS, note: "starts only after you file on SCORES" },
  { stage: "First-level review request", days: REVIEW_DAYS, note: "from ATR receipt" },
  { stage: "Second-level review request", days: REVIEW_DAYS, note: "from Designated Body" },
  { stage: "Feedback on closure", days: REVIEW_DAYS, note: "from disposal" },
  { stage: "SCORES limitation period", days: LIMIT_DAYS, note: "from date of cause of action" },
] as const;

/**
 * The single escalation decision. Pure, testable, no LLM involvement.
 * Sources live in src/data/scoresRules.ts.
 */
export function evaluateEscalation(state: GrievanceState): EscalationStatus {
  const now = todayISO();

  const incident = parseISODate(state.incidentDate);
  if (incident) {
    const age = daysBetween(incident, now);
    if (age > LIMIT_DAYS) {
      return {
        eligible: false,
        expired: true,
        reason: "expired",
        daysElapsed: age,
        daysLeft: 0,
        closesOn: null,
        message:
          `The incident was ${age} days ago. SCORES only accepts complaints within ` +
          `${LIMIT_DAYS} days of the cause of action.`,
      };
    }
  }

  // An outright rejection needs no waiting period at all.
  if (state.priorContactProof === "rejected") {
    return {
      eligible: true,
      expired: false,
      reason: "rejected",
      daysElapsed: null,
      daysLeft: 0,
      closesOn: null,
      message: "The company rejected your complaint, so you can file on SCORES right away.",
    };
  }

  if (!state.priorContactDate) {
    return {
      eligible: false,
      expired: false,
      reason: "not_emailed",
      daysElapsed: null,
      daysLeft: null,
      closesOn: null,
      message:
        `SEBI only accepts a complaint if you first approached the company. ` +
        `They then get ${WAIT_DAYS} days to respond.`,
    };
  }

  const sent = parseISODate(state.priorContactDate);
  if (!sent) {
    return {
      eligible: false, expired: false, reason: "unknown",
      daysElapsed: null, daysLeft: null, closesOn: null,
      message: "We need the date you first contacted them.",
    };
  }

  const elapsed = daysBetween(sent, now);

  if (elapsed >= WAIT_DAYS) {
    return {
      eligible: true,
      expired: false,
      reason: "wait_passed",
      daysElapsed: elapsed,
      daysLeft: 0,
      closesOn: null,
      message: `${WAIT_DAYS} days have passed since you wrote to them, with no resolution. You can file on SCORES now.`,
    };
  }

  const left = WAIT_DAYS - elapsed;
  return {
    eligible: false,
    expired: false,
    reason: "waiting",
    daysElapsed: elapsed,
    daysLeft: left,
    closesOn: addDaysISO(sent, WAIT_DAYS),
    message: `The company still has ${left} more days to respond before you can file on SCORES.`,
  };
}

function addDaysISO(from: Date | string, days: number): string {
  const d = toDate(from);
  if (!d) return typeof from === "string" ? from : toLocalISO(from);
  d.setDate(d.getDate() + days);
  return toLocalISO(d);
}