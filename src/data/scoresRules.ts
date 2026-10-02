/**
 * SCORES rules we have actually verified, each with its source.
 *
 * This is the ONLY place process timelines and legal rules live. The prompt
 * builder injects these into the model context, and the model is instructed to
 * state timelines ONLY from this file. Anything not here -> "I'm not sure,
 * check scores.sebi.gov.in or SEBI's helpline."
 *
 * If SEBI changes a rule, update the value, source and lastVerified here and
 * every message, email draft and deadline in the product follows.
 */

export interface VerifiedRule<T> {
  value: T;
  source: string;
  sourceUrl: string;
  lastVerified: string; // yyyy-mm-dd
}

const CIRCULAR = "SEBI circular SEBI/HO/OIAE/IGRD/CIR/P/2023/156 (20 Sep 2023)";
const CIRCULAR_URL =
  "https://www.sebi.gov.in/legal/circulars/sep-2023/redressal-of-investor-grievances-through-the-sebi-complaint-redress-scores-platform-and-linking-it-to-online-dispute-resolution-platform_77159.html";
const FAQ_URL = "https://scores.sebi.gov.in/scores-home";
const INVESTOR_URL = "https://investor.sebi.gov.in/securities-resolvedispute.html";

export const SCORES_RULES = {
  portalUrl: {
    value: "https://scores.sebi.gov.in",
    source: "SEBI SCORES homepage",
    sourceUrl: FAQ_URL,
    lastVerified: "2026-10-02",
  },
  helpline: {
    value: ["1800 22 7575", "1800 266 7575"],
    source: "SEBI investor grievance redressal page",
    sourceUrl: INVESTOR_URL,
    lastVerified: "2026-10-02",
  },
  /** The company gets this long to resolve your email before you may escalate. */
  preFilingEntityWaitDays: {
    value: 30,
    source: `${CIRCULAR} (approach the entity first) and SCORES investor FAQ; consistent with the regulator-prescribed 30-day turnaround stated in broker grievance policies`,
    sourceUrl: CIRCULAR_URL,
    lastVerified: "2026-10-02",
  } satisfies VerifiedRule<number>,
  /** Once filed on SCORES, the entity must answer within this long. */
  atrDays: {
    value: 21,
    source: "SCORES investor FAQ (Action Taken Report within 21 calendar days of receipt)",
    sourceUrl: FAQ_URL,
    lastVerified: "2026-10-02",
  } satisfies VerifiedRule<number>,
  firstReviewDays: {
    value: 15,
    source: "SCORES two-level review: seek first review within 15 days of the entity's ATR",
    sourceUrl: FAQ_URL,
    lastVerified: "2026-10-02",
  } satisfies VerifiedRule<number>,
  secondReviewDays: {
    value: 15,
    source: "SCORES two-level review: seek second review within 15 days of the Designated Body's response",
    sourceUrl: FAQ_URL,
    lastVerified: "2026-10-02",
  } satisfies VerifiedRule<number>,
  feedbackDays: {
    value: 15,
    source: "SCORES FAQ: feedback on closure within 15 days",
    sourceUrl: FAQ_URL,
    lastVerified: "2026-10-02",
  } satisfies VerifiedRule<number>,
  /** A SCORES complaint must be filed within this long of the cause of action. */
  limitationDays: {
    value: 365,
    source: `${CIRCULAR}: lodge within one year of the date of occurrence of the cause of action`,
    sourceUrl: CIRCULAR_URL,
    lastVerified: "2026-10-02",
  } satisfies VerifiedRule<number>,
};

/**
 * The exact rules block injected into the model prompt. The model sees the
 * numbers together with the instruction to use nothing else.
 */
export function formatRulesForPrompt(): string {
  const r = SCORES_RULES;
  return [
    "SCORES_RULES (verified; last checked 2026-10-02):",
    `- Before SCORES, the company gets ${r.preFilingEntityWaitDays.value} days to resolve your email. Only escalate after that, or immediately if they reject you outright.`,
    `- After you file, the company must answer (Action Taken Report) within ${r.atrDays.value} days.`,
    `- Unhappy with the answer? First review within ${r.firstReviewDays.value} days of their reply, second review within ${r.secondReviewDays.value} days after that.`,
    `- File within ${r.limitationDays.value} days (one year) of when the problem happened.`,
    `- Feedback on a closed complaint: within ${r.feedbackDays.value} days.`,
    `- SEBI helpline: ${r.helpline.value.join(", ")}. Portal: ${r.portalUrl.value}.`,
    "State process timelines or legal rules ONLY from these SCORES_RULES. " +
      "If a rule is not listed here, say you are not sure and point to scores.sebi.gov.in or SEBI's helpline.",
  ].join("\n");
}
