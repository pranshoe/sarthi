/**
 * SEBI SCORES complaint categories, loaded from data — never hardcoded in
 * prompts or agent logic. If SCORES renames a category, change it here and
 * the inference, the mock, and the portal matcher all follow.
 *
 * Sources: SCORES complaint-registration category dropdown (scores.sebi.gov.in)
 * and the SCORES investor FAQ. Last checked 2026-10-02.
 */

export interface ComplaintCategory {
  /** Exact label used in state and on the portal. */
  label: string;
  /** Keywords (any language, any script) implying this category. */
  keywords: RegExp;
}

export const COMPLAINT_CATEGORIES: ComplaintCategory[] = [
  {
    label: "Non-receipt of funds",
    keywords:
      /sale proceeds|not credited|didn'?t (come|arrive)|no.?t credited|adavu|paisa nahi|vittam|panam illa|credits? (not|never)|deposit nahi|paisa wapas nahi|funds? not (received|refunded)/i,
  },
  {
    label: "Unauthorized trade",
    keywords: /unauthori[sz]ed|without my (consent|permission)|cheating|fraud/i,
  },
  {
    label: "Account closure issue",
    keywords: /clos(e|ing|ure) (my )?account|band kar|mudhal|village|mattu|account band/i,
  },
  {
    label: "Charges dispute",
    keywords: /charges?|commission|fees?|brokerage.*(high|wrong|extra)/i,
  },
  {
    label: "Non-receipt of securities",
    keywords: /shares? not (received|credited|transferred)|securities? not|demat (not|never)|holding missing/i,
  },
  {
    label: "Dividend or corporate action",
    keywords: /dividend|bonus|split|corporate action|interest/i,
  },
];

/**
 * Infer a category from free text. Returns the label plus a 0..1 confidence
 * (strong keyword hit vs weak single-token overlap) so callers can decide
 * whether to ask. Returns null when nothing matches.
 */
export function inferCategory(text: string): { category: string; confidence: number } | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  let best: { category: string; confidence: number } | null = null;
  for (const c of COMPLAINT_CATEGORIES) {
    if (!c.keywords.test(t)) continue;
    // Stronger signal: a multi-word keyword or the entity+money context.
    const strong = /\b\w+\s+\w+.*\b\w+\s+\w+/i.test(t.match(c.keywords)?.[0] ?? "");
    const confidence = strong ? 0.85 : 0.65;
    if (!best || confidence > best.confidence) best = { category: c.label, confidence };
  }
  return best;
}

/** Labels only, for dropdown matchers and tests. */
export function categoryLabels(): string[] {
  return COMPLAINT_CATEGORIES.map((c) => c.label);
}
