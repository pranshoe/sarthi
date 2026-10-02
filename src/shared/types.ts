/**
 * Typed contracts shared by the side panel, service worker and content scripts.
 * Keeping these in one file makes the message-passing boundaries explicit.
 */

export type Phase =
  | "GREETING"
  | "INTAKE"
  | "CONFIRM"
  | "PREFLIGHT_EMAIL"
  | "AUTOFILL"
  | "REVIEW";

export type EntityType = "broker" | "listed company" | "RTA" | "IEPF";

export type PriorContactProof = "emailed" | "none" | "rejected";

export interface Attachment {
  /** In-memory only. Never written to chrome.storage. */
  dataUrl: string;
  name: string;
  size: number;
  type: string;
}

export interface GrievanceState {
  complaintCategory: string | null;
  entityName: string | null;
  entityType: EntityType | null;
  clientIdFolioNoDpid: string | null;
  /** English summary used for the government portal. */
  issueSummaryEnglish: string | null;
  /** Summary in the user's own language, shown back to them. */
  issueSummaryOriginal: string | null;
  incidentDate: string | null; // ISO yyyy-mm-dd
  amountInvolved: number | null;
  priorContactDate: string | null; // ISO yyyy-mm-dd
  priorContactProof: PriorContactProof | null;
  /**
   * Code-owned. True only once a contact date is recorded (chat date answer
   * or "I've sent it"). The model may report dates; it may never set this.
   */
  priorContactConfirmed: boolean;
  /** Ticket/reference number the company gave, if the user shares one. */
  priorContactTicket: string | null;
  /** Full name for the email signature. Asked only in the pre-send flow. */
  userName: string | null;
  /** Mobile number for the email signature. Asked only in the pre-send flow. */
  userPhone: string | null;
  /** What was bought or sold. Asked only in the pre-send flow. */
  soldDescription: string | null;
  reliefSought: string | null;
  attachments: Attachment[];
  userLanguage: string; // BCP-47 + script, e.g. "ta-IN" or "hi-Latn"
  /**
   * Fields the agent gave up asking about after repeated non-answers.
   * Code-owned; excluded from the missing list. The model never sets this.
   */
  skippedFields: FieldKey[];
}

/** Derived every turn. Never persisted as a source of truth. */
export interface DerivedState {
  phase: Phase;
  missing: FieldKey[];
  confidence: Partial<Record<FieldKey, number>>;
  escalation: EscalationStatus;
  canAutofill: boolean;
  blockers: string[];
  deadline: FilingDeadline;
}

/** SCORES filing deadline derived from the incident date + limitation period. */
export interface FilingDeadline {
  /** yyyy-mm-dd of the last day SCORES will accept the complaint, if known. */
  date: string | null;
  daysLeft: number | null;
  /** True when the deadline is within the warning window or already passed. */
  urgent: boolean;
  passed: boolean;
}

export type FieldKey =
  | "complaintCategory"
  | "entityName"
  | "entityType"
  | "clientIdFolioNoDpid"
  | "issueSummaryEnglish"
  | "incidentDate"
  | "amountInvolved"
  | "priorContact"
  | "reliefSought";

export interface EscalationStatus {
  /** SEBI requires the entity be given time to respond (see SCORES_RULES). */
  eligible: boolean;
  expired: boolean;
  reason:
    | "not_emailed"
    | "waiting"
    | "wait_passed"
    | "rejected"
    | "expired"
    | "unknown";
  daysElapsed: number | null;
  daysLeft: number | null;
  closesOn: string | null;
  message: string;
}

export interface ChatTurn {
  role: "user" | "agent" | "system";
  text: string;
  at: string;
  /** Optional English gloss shown under an Indic reply. */
  english?: string;
  synthetic?: boolean;
  /** Present when this turn produced a broker-email draft. */
  emailDraft?: EmailDraft;
}

/** A pre-flight broker email. Built by code from GrievanceState, never sent. */
export interface EmailDraft {
  to: string;
  subject: string;
  /** Formal English body: this is what Gmail compose receives. */
  bodyEn: string;
  /** Short explanation of the draft in the user's own language. */
  bodyLocal: string;
  /** Null when the broker has no verified address: "to" stays empty. */
  contact: { email: string; role: string } | null;
}

/** Strict JSON the LLM must return each turn. */
export interface LLMTurnResult {
  detectedLanguage: string;
  reply: string;
  stateUpdates: Partial<GrievanceState>;
  phase: Phase;
  nextAction: "none" | "show_summary" | "draft_email" | "start_autofill";
  confidence: Partial<Record<string, number>>;
}

export interface ProviderConfig {
  llm: "mock" | "gemini" | "claude" | "openai" | "sarvam";
  stt: "mock" | "sarvam";
  tts: "mock" | "sarvam";
  /** When true, no network calls are made at all. */
  mockMode: boolean;
  proxyUrl: string;
  spokenReplies: boolean;
}

export interface TurnRequest {
  state: GrievanceState;
  derived: DerivedState;
  history: ChatTurn[];
  latestUserMessage: string;
  mockMode: boolean;
}

// ---- service worker message contracts ----

export type WorkerRequest =
  | { type: "llm/turn"; payload: TurnRequest }
  | { type: "stt/transcribe"; payload: { audio: ArrayBuffer; langHint?: string; mockMode: boolean } }
  | { type: "tts/speak"; payload: { text: string; lang: string; mockMode: boolean } }
  | { type: "panel/open"; payload: Record<string, never> }
  | { type: "gmail/open"; payload: { to: string; subject: string; body: string } };

export type WorkerResponse =
  | { ok: true; turn: LLMTurnResult }
  | { ok: true; text: string; detectedLang: string }
  | { ok: true; audio: string }
  | { ok: true }
  | { ok: false; error: string; detail?: string };

// ---- content script contracts ----

export type ContentRequest =
  | { type: "portal/detect" }
  | { type: "portal/fill"; payload: { state: GrievanceState } }
  | { type: "portal/highlight"; payload: { fields: string[] } };

export type ContentResponse =
  | { ok: true; portal: "scores" | "iepf" | null }
  | { ok: true; filled: FillReport }
  | { ok: false; error: string };

export interface FillReport {
  portal: string;
  results: Array<{
    key: string;
    selector: string;
    status: "filled" | "skipped" | "ambiguous" | "not_found";
    detail?: string;
  }>;
  captchaDetected: boolean;
  submitDisabled: true;
}