/**
 * Contact-status language matchers, shared by the Conversation controller and
 * the mock LLM so both sides interpret "I haven't written" identically.
 *
 * These only recognise contact talk. "I haven't received my money" must never
 * match: every denial pattern requires a contact verb (written, emailed,
 * contacted, sent, complained).
 */

export const EXPLICIT_DENIAL =
  /\b(haven't|hasn't|didn't|never)\s+(written|wrote|emailed?|e-mailed|contacted|sent|complained)\b|\bnot\s+(written|sent|emailed?|contacted)\b|\bnot\s+yet\b|नहीं\s+(लिखा|भेजा)|எழுதவில்லை|அனுப்பவில்லை|ಬರೆದಿಲ್ಲ|ಕಳುಹಿಸಿಲ್ಲ/i;

/** A bare "no" with nothing else. Only meaningful in a contact context. */
export const BARE_DENIAL = /^(no|nahi|nahin|illa|illai|ledu|alla)\s*[.!…]*$/i;

/**
 * "No I didn't", "No, I haven't written" — a denial with a verb attached.
 * Stronger than BARE_DENIAL (which is context-gated); this form denies
 * contact wherever it appears.
 */
export const DENIAL_WITH_VERB =
  /^(no|nahi|nahin|illa|illai|ledu|alla)[,.]?\s+(i\s+)?(haven't|hasn't|didn't|never|don't|do not|have not|has not|did not)\b/i;

/** A bare yes-word with nothing else. Covers English, romanized Hindi
 * ("zaroor", "bilkul" are how agreement usually sounds), and native scripts. */
export const BARE_AFFIRM =
  /^(yes|yeah|yep|haan|haa|haanji|sure|okay|\bok\b|sari|zaroor|zarur|bilkul|சரி|ஆம்|ಹೌದು|ಸರಿ|సరే|అవును)\s*[.!…]*$/i;

/** Standalone softeners that read as agreement in context. */
const SOFTENER_ONLY =
  /^(sure|please|pls|thanks|thank you|thankyou|definitely|go ahead|do it|kar do|karo|zaroor|bilkul)\s*[.!…]*$/i;
const TRAILING_SOFTENER =
  /\s*(sure|please|pls|thanks|thank you|thankyou|definitely|go ahead|do it|kar do|karo|zaroor|bilkul)\s*[.!…]*$/i;

/**
 * "Yes sure", "Yeah please", "Sure" — an affirmation with at most a softener
 * attached. Plain "Yes" is covered by BARE_AFFIRM; this covers how people
 * actually answer.
 */
export function isAffirmation(text: string): boolean {
  const t = text.trim();
  if (BARE_AFFIRM.test(t)) return true;
  if (SOFTENER_ONLY.test(t)) return true;
  const stripped = t.replace(TRAILING_SOFTENER, "").trim();
  return stripped.length > 0 && BARE_AFFIRM.test(stripped);
}

/** Markers showing the agent just offered the email draft (any language). */
const OFFER_MARKERS = /draft|बना|தயாரி|ಸಿದ್ಧಪಡಿಸಿ|సిద్ధం/i;

/**
 * Single agreement rule shared by the controller and the mock: explicit
 * phrasing always counts; a bare affirmation counts only right after the
 * agent offered the draft (and never on an empty state, where there is
 * nothing to agree with). Sent-claims ("yes, I sent them an email") are
 * never agreement — they need a date, not a fresh draft.
 */
export function isAgreementToDraft(
  userText: string,
  lastAgentText: string | null,
  stateEmpty: boolean,
): boolean {
  const t = userText.trim();
  if (CONTACT_CLAIM.test(t) || DONE_MESSAGE.test(t)) return false;
  if (stateEmpty) return false;
  if (EMAIL_AGREEMENT.test(t)) return true;
  return (
    isAffirmation(t) && !!lastAgentText && OFFER_MARKERS.test(lastAgentText)
  );
}

export const CONTACT_CLAIM =
  /\b(already\s+(written|wrote|emailed?|sent|contacted)|have\s+(written|wrote|emailed?)|wrote\s+to\s+them|emailed?\s+them|sent\s+(them\s+)?(an?\s+)?(email|mail|letter))\b/i;

export const EMAIL_AGREEMENT =
  /\b(yes|yeah|haan|haa|sari|okay|\bok\b|sure|zaroor|zarur|bilkul)\b.{0,25}\b(draft|email|mail)\b|\b(draft|prepare|make|banao|bana)\b.{0,25}\b(email|mail|it)\b|बना.*(दो|दीजिए)|தயாரி|ಸಿದ್ಧಪಡಿಸಿ|సిద్ధం/i;

/** "It's sent" — only interpreted as such while a draft is pending. */
export const DONE_MESSAGE =
  /\b(done|sent(\s+it)?|bhej\s*diya?|anuppi|அனுப்பி|ಕಳುಹಿಸಿದೆ|పంపాను|already sent)\b/i;

/** "I don't know / skip it" — in a field-asking context, keep the placeholder. */
export const SKIP_FIELD =
  /\b(skip|skip it|leave it|leave blank|don't know|dont know|do not know|no idea|later|pata nahi)\b/i;

const TICKET_LABELED =
  /(ticket|token|reference|\bref\.?|complaint|grievance)\s*(no|number|num|id)?\s*[:#-]?\s*([A-Z0-9-]*\d[A-Z0-9-]{2,})/i;
const BARE_REF = /^[A-Z0-9][A-Z0-9-]{5,}$/;

/** Pull a ticket/reference number out of a proof message, if there is one. */
export function extractTicket(text: string): string | null {
  const labeled = text.match(TICKET_LABELED);
  if (labeled?.[3]) return labeled[3].toUpperCase();
  const bare = text.trim();
  if (BARE_REF.test(bare)) return bare.toUpperCase();
  return null;
}

const SCREENSHOT_WORDS = /\b(screenshot|screen shot|photo|picture|image|attached|attach|upload)\b/i;

/** The user says they have visual proof (to be attached in the review tab). */
export function mentionsScreenshot(text: string): boolean {
  return SCREENSHOT_WORDS.test(text);
}
