import type { EmailDraft, GrievanceState } from "@/shared/types";
import { findBrokerContact } from "@/data/brokers";
import { formatHuman } from "@/state/dates";

/**
 * Builds the pre-flight broker email from GrievanceState.
 *
 * Code owns the structure, so every required part is always present:
 * client ID (or placeholder), incident date, amount, what was sold
 * (or placeholder), the SEBI SCORES escalation line, and a
 * request for a reference/ticket number. No resolve-within period is stated:
 * timelines come only from SCORES_RULES, which carries no pre-filing wait.
 *
 * The agent NEVER sends this. It is shown in chat and opened in Gmail
 * compose for the user to review and send themselves.
 */

const PLACEHOLDERS = {
  clientId: "[your client ID / UCC / folio number]",
  amount: "[amount in INR]",
  sold: "[describe what was bought or sold — e.g. shares of ___]",
  issue: "[describe what went wrong]",
  name: "[Your name]",
  phone: "[Your contact number]",
};

export function buildEmailDraft(state: GrievanceState): EmailDraft {
  const contact = findBrokerContact(state.entityName);
  const entity = state.entityName?.trim() || "[Broker / company name]";

  const clientId = state.clientIdFolioNoDpid?.trim() || PLACEHOLDERS.clientId;
  const date = state.incidentDate ? formatHuman(state.incidentDate) : "[date of the incident]";
  const amount =
    typeof state.amountInvolved === "number" && state.amountInvolved > 0
      ? `INR ${state.amountInvolved.toLocaleString("en-IN")}`
      : PLACEHOLDERS.amount;
  const about = state.issueSummaryEnglish?.trim() || PLACEHOLDERS.issue;
  const relief = state.reliefSought?.trim() || "look into this matter and resolve it";
  const sold = state.soldDescription?.trim() || PLACEHOLDERS.sold;
  const name = state.userName?.trim() || PLACEHOLDERS.name;
  const phone = state.userPhone?.trim() || PLACEHOLDERS.phone;

  const subject = `Grievance redressal request - ${state.clientIdFolioNoDpid?.trim() ? `UCC ${state.clientIdFolioNoDpid.trim()} - ` : ""}${entity}`;

  const bodyEn = [
    `To the Grievance / Compliance Officer, ${entity},`,
    "",
    "I am writing to formally raise the following grievance regarding my account.",
    "",
    `Client ID / UCC / Folio: ${clientId}`,
    `Date of the incident: ${date}`,
    `Amount involved: ${amount}`,
    `What this is about: ${about}`,
    `What was bought or sold: ${sold}`,
    "",
    `I request you to ${relief}.`,
    "",
    `You are requested to resolve this at the earliest. If it is not resolved, I will escalate the matter by lodging a complaint on SEBI SCORES.`,
    "",
    "Please share a reference or ticket number for this complaint for my records.",
    "",
    "Regards,",
    name,
    phone,
  ].join("\n");

  return {
    to: contact?.email ?? "",
    subject,
    bodyEn,
    bodyLocal: summariseDraft(state.userLanguage, {
      entity,
      hasContact: contact !== null,
    }),
    contact: contact ? { email: contact.email, role: contact.role } : null,
  };
}

/**
 * Gmail compose URL in exactly ?view=cm&to=&su=&body= form.
 * "to" may legitimately be empty when the broker has no verified address.
 */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  return (
    "https://mail.google.com/mail/" +
    `?view=cm&to=${encodeURIComponent(to)}` +
    `&su=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

/**
 * Draft fields that still show placeholders, in the order they are asked.
 * Client ID and amount are skipped when the user already declined them twice
 * (ask limits); the rest are always askable. Returns [] when send-ready.
 */
export type DraftFieldKey =
  | "clientId"
  | "amount"
  | "incidentDate"
  | "soldDescription"
  | "userName"
  | "userPhone";

export function missingDraftFields(state: {
  clientIdFolioNoDpid: string | null;
  amountInvolved: number | null;
  incidentDate: string | null;
  soldDescription: string | null;
  userName: string | null;
  userPhone: string | null;
  skippedFields: string[];
}): DraftFieldKey[] {
  const skipped = new Set(state.skippedFields);
  const out: DraftFieldKey[] = [];
  if (!state.clientIdFolioNoDpid && !skipped.has("clientIdFolioNoDpid")) out.push("clientId");
  if (!(typeof state.amountInvolved === "number" && state.amountInvolved > 0) && !skipped.has("amountInvolved")) {
    out.push("amount");
  }
  if (!state.incidentDate) out.push("incidentDate");
  if (!state.soldDescription?.trim()) out.push("soldDescription");
  if (!state.userName?.trim()) out.push("userName");
  if (!state.userPhone?.trim()) out.push("userPhone");
  return out;
}

/** True when the built draft contains no [...] placeholders. */
export function isSendReady(draft: { bodyEn: string; subject: string }): boolean {
  return !/\[.+?\]/.test(draft.bodyEn) && !/\[.+?\]/.test(draft.subject);
}
/**
 * Short explanation of the draft in the user's own language, shown next to
 * the English draft in chat. Deterministic UI text, not an agent question.
 */
function summariseDraft(
  lang: string,
  facts: { entity: string; hasContact: boolean },
): string {
  const base = (lang.split("-")[0] ?? "en").toLowerCase();
  const t = SUMMARIES[base] ?? SUMMARIES.en!;
  return t(facts);
}

interface DraftFacts {
  entity: string;
  hasContact: boolean;
}

const SUMMARIES: Record<string, (f: DraftFacts) => string> = {
  en: (f) =>
    `This email asks ${f.entity} to resolve your complaint, and says you will go to SEBI SCORES if they do not. ` +
    (f.hasContact
      ? "I filled in their grievance email address for you."
      : "I could not verify their grievance email, so please check it on their website before sending.") +
    ` It also asks them for a reference number. Replace anything in [brackets] with your details.`,
  hi: (f) =>
    `यह ईमेल ${f.entity} से शिकायत सुलझाने को कहता है, और कहता है कि नहीं सुलझा तो आप SEBI SCORES में जाएँगे। ` +
    (f.hasContact
      ? "मैंने उनका शिकायत ईमेल पता भर दिया है।"
      : "उनका शिकायत ईमेल पता सत्यापित नहीं हो सका, इसलिए भेजने से पहले उनकी वेबसाइट पर जाँच लें।") +
    ` इसमें रेफरेंस नंबर भी माँगा गया है। [कोष्ठक] वाली जानकारी अपनी भर लें।`,
  ta: (f) =>
    `இந்த மின்னஞ்சல் ${f.entity}-ஐ புகாரைத் தீர்க்கக் கேட்கிறது, இல்லையெனில் SEBI SCORES-க்குச் செல்வதாகக் கூறுகிறது. ` +
    (f.hasContact
      ? "அவர்களின் புகார் மின்னஞ்சல் முகவரியை நிரப்பிவிட்டேன்."
      : "அவர்களின் புகார் மின்னஞ்சல் முகவரியை உறுதிப்படுத்த முடியவில்லை, அனுப்பும் முன் அவர்களின் இணையதளத்தில் பார்க்கவும்.") +
    ` குறிப்பு எண்ணும் கேட்கப்பட்டுள்ளது. [அடைப்புக்குறி] விவரங்களை நிரப்பவும்.`,
  kn: (f) =>
    `ಈ ಇಮೇಲ್ ${f.entity} ಅವರನ್ನು ದೂರು ಪರಿಹರಿಸಲು ಕೇಳುತ್ತದೆ, ಇಲ್ಲದಿದ್ದರೆ SEBI SCORES-ಗೆ ಹೋಗುವುದಾಗಿ ಹೇಳುತ್ತದೆ. ` +
    (f.hasContact
      ? "ಅವರ ದೂರು ಇಮೇಲ್ ವಿಳಾಸವನ್ನು ತುಂಬಿದ್ದೇನೆ."
      : "ಅವರ ದೂರು ಇಮೇಲ್ ವಿಳಾಸವನ್ನು ಖಚಿತಪಡಿಸಲಾಗಲಿಲ್ಲ, ಕಳುಹಿಸುವ ಮೊದಲು ಅವರ ವೆಬ್‌ಸೈಟ್‌ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.") +
    ` ಉಲ್ಲೇಖ ಸಂಖ್ಯೆಯನ್ನೂ ಕೇಳಲಾಗಿದೆ. [ಆವರಣ] ವಿವರಗಳನ್ನು ತುಂಬಿ.`,
  te: (f) =>
    `ఈ ఇమెయిల్ ${f.entity}ను ఫిర్యాదు పరిష్కరించమని అడుగుతుంది, లేకపోతే SEBI SCORESకు వెళ్తామని చెబుతుంది. ` +
    (f.hasContact
      ? "వారి ఫిర్యాదు ఇమెయిల్ చిరునామాను నింపాను."
      : "వారి ఫిర్యాదు ఇమెయిల్ చిరునామాను ధృవీకరించలేకపోయాను, పంపే ముందు వారి వెబ్‌సైట్‌లో చూడండి.") +
    ` రిఫరెన్స్ నంబర్ కూడా అడగబడింది. [బ్రాకెట్ల] వివరాలు నింపండి.`,
};
