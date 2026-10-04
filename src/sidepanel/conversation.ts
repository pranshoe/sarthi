import type {
  ChatTurn,
  DerivedState,
  GrievanceState,
  LLMTurnResult,
} from "@/shared/types";
import { emptyState, has, nextFocus } from "@/state/grievanceState";
import {
  computeDerived,
  mergeState,
  partitionUpdates,
  resolveContradiction,
} from "@/state/stateReducer";
import { runTurn } from "@/agent/turnRunner";
import { extractFacts, onlyEmpty } from "@/agent/extractFacts";
import { isExplicitCorrection } from "@/state/stateReducer";
import { buildEmailDraft, gmailComposeUrl, missingDraftFields, type DraftFieldKey } from "@/agent/emailDraft";
import { normaliseDate } from "@/agent/guardrails";
import { findDateInText, todayISO } from "@/state/dates";
import {
  BARE_DENIAL,
  CONTACT_CLAIM,
  DENIAL_WITH_VERB,
  DONE_MESSAGE,
  EXPLICIT_DENIAL,
  SKIP_FIELD,
  extractTicket,
  isAgreementToDraft,
  mentionsScreenshot,
} from "@/agent/contactPhrases";
import type { EmailDraft, FieldKey } from "@/shared/types";
import { isSmallTalk, detectLanguage, type DetectedLang } from "@/agent/detect";

/** True when no complaint fact has been captured yet. */
function nothingCaptured(state: GrievanceState): boolean {
  return (
    state.issueSummaryOriginal === null &&
    state.issueSummaryEnglish === null &&
    state.entityName === null &&
    state.entityType === null &&
    state.complaintCategory === null &&
    state.incidentDate === null &&
    state.amountInvolved === null &&
    state.clientIdFolioNoDpid === null &&
    state.reliefSought === null &&
    state.priorContactProof === null
  );
}

/** Short affirmation that confirms a review, without needing the model. */
const CONFIRM_AFFIRM =
  /^(yes|yeah|yep|continue|ok|okay|haan|haanji|sure|go ahead|sahi hai|acha|சரி|ஆம்|ಸರಿ|ಹೌದು)\s*[.!…]*$/i;
/** Two-word variants people actually type: "Yes continue", "ok proceed". */
const CONFIRM_AFFIRM_LONG =
  /^(yes|yeah|yep|ok|okay|sure|haan)[,.]?\s+(continue|proceed|go ahead|confirmed)\s*[.!…]*$/i;

const CONFIRM_ACK: Record<string, string> = {
  en: "Confirmed — moving ahead.",
  hi: "पक्का — आगे बढ़ते हैं।",
  ta: "உறுதி — தொடரலாம்.",
  kn: "ಖಚಿತ — ಮುಂದುವರೆಯೋಣ.",
};

function confirmAckFor(base: string): string {
  return CONFIRM_ACK[base] ?? CONFIRM_ACK.en!;
}

/** Short review intro when code forces the card and the model forgot it. */
const REVIEW_INTRO: Record<string, string> = {
  en: "Here's what I've understood — please review it below.",
  hi: "मैंने जो समझा है वह नीचे है — कृपया जाँच लें।",
  ta: "நான் புரிந்தது கீழே உள்ளது — சரிபார்க்கவும்.",
  kn: "ನನಗೆ ಅರ್ಥವಾದದ್ದು ಕೆಳಗಿದೆ — ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.",
};

function reviewIntroFor(base: string): string {
  return REVIEW_INTRO[base] ?? REVIEW_INTRO.en!;
}

/** Offline trouble lines by language, with romanized variants where tested. */
const OFFLINE_LINES: Record<string, string> = {
  en: "Sorry, I'm having trouble reaching my service right now. Could you please repeat that?",
  hi: "माफ़ कीजिए, सेवा से संपर्क नहीं हो पा रहा है। कृपया दोहराएँ?",
  ta: "மன்னிக்கவும், சேவையை அணுக முடியவில்லை. மீண்டும் சொல்லுங்கள்.",
  kn: "ಕ್ಷಮಿಸಿ, ಸೇವೆಯನ್ನು ಸಂಪರ್ಕಿಸಲು ಆಗುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಪುನಃ ಹೇಳಿ.",
};
const OFFLINE_LATN: Record<string, string> = {
  hi: "Maaf kijiye, seva se sampark nahi ho pa raha hai. Kripya dohrayein?",
  // Worded with detector-list words (enakku/konjam/sollunga) so the reply
  // still detects as ta-Latn when the model is down.
  ta: "Mannikkavum, enakku sevaiyai anauga mudiyavillai. Konjam sollunga.",
};

/** Offline greeting: Sarthi intro + open invite, never a field question. */
const OFFLINE_GREET: Record<string, string> = {
  en: "Hello! I'm Sarthi. Tell me what happened in your own words, and I'll help you file it on SEBI SCORES or IEPF. So, what happened?",
  hi: "नमस्ते! मैं सारथी हूँ। अपनी भाषा में बताइए क्या हुआ था — मैं SEBI SCORES या IEPF पर शिकायत दर्ज करने में मदद करूँगा। तो बताइए, क्या हुआ था?",
  ta: "Vanakkam! Naan Sarthi. SEBI SCORES alladhu IEPF-il pugaar seiya udhavugiren. Enna nadandhadhu endru sollungal.",
};
const OFFLINE_GREET_LATN: Record<string, string> = {
  hi: "Namaste! Main Sarthi hoon. Apni bhasha mein bataiye kya hua tha — main SEBI SCORES ya IEPF par shikayat mein madad karunga. To bataiye, kya hua tha?",
  ta: "Vanakkam! Naan Sarthi. SEBI SCORES alladhu IEPF-il pugaar seiya udhavugiren. Enna nadandhadhu endru sollungal.",
};

function offlineLineFor(det: DetectedLang): string {
  if (det.latin && OFFLINE_LATN[det.base]) return OFFLINE_LATN[det.base]!;
  return OFFLINE_LINES[det.base] ?? OFFLINE_LINES.en!;
}
import { createLLM } from "@/providers/registry";
import type { LLMProvider } from "@/providers/types";
import { config } from "@/shared/config";

export interface AgentController {
  state: GrievanceState;
  derived: DerivedState;
  history: ChatTurn[];
  hasGreeted: boolean;
  summaryConfirmed: boolean;
  busy: boolean;
  error: string | null;
  gmailFailed: boolean;
  contextGathered: boolean;
}

/**
 * The conversation controller. Deliberately framework-free so the acceptance
 * tests can drive it without React.
 *
 * Design rule from spec 4: the model writes every user-facing message. Nothing
 * here contains question text.
 */
export class Conversation {
  private llm: LLMProvider;
  private listeners = new Set<(c: AgentController) => void>();

  state: GrievanceState = emptyState();
  history: ChatTurn[] = [];
  hasGreeted = false;
  summaryConfirmed = false;
  busy = false;
  error: string | null = null;

  /** Pre-flight email handshake, owned by code (see turn()). */
  emailFlow: "none" | "awaitingSent" | "awaitingDate" | "awaitingProof" | "done" = "none";
  /** Times each field was asked without an answer. Two strikes -> skipped. */
  askCounts: Record<string, number> = {};
  /** Contradictions held for confirmation: field -> {current, incoming, rounds}. */
  pendingContradictions: Array<{ field: string; current: unknown; incoming: unknown; rounds: number }> = [];
  lastRepeatDetected = false;
  /** True when the automatic Gmail open failed; the card button still works. */
  gmailFailed = false;
  /** Compose URL built for the latest draft (test-visible; also the fallback). */
  lastGmailUrl: string | null = null;
  /** True when we successfully scraped context from the active tab. */
  contextGathered = false;
  /**
   * Pre-send completion: placeholders still in the draft, asked one at a time.
   * While active, the user's messages are answers, not new intake.
   */
  draftCompletion: { pending: DraftFieldKey[]; retries: number } | null = null;
  /** Set in preprocess when the user agreed this turn; consumed post-turn. */
  private agreedThisTurn = false;
  /** Set in preprocess when the last placeholder was just filled. */
  private draftFinalize = false;
  private proofTries = 0;

  constructor(deps?: Partial<{ llm: LLMProvider }>) {
    this.llm = deps?.llm ?? createLLM();
  }

  subscribe(fn: (c: AgentController) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get snapshot(): AgentController {
    return {
      state: this.state,
      derived: this.derived,
      history: this.history,
      hasGreeted: this.hasGreeted,
      summaryConfirmed: this.summaryConfirmed,
      busy: this.busy,
      error: this.error,
      gmailFailed: this.gmailFailed,
      contextGathered: this.contextGathered,
    };
  }

  get derived(): DerivedState {
    return computeDerived(this.state, {
      hasGreeted: this.hasGreeted,
      summaryConfirmed: this.summaryConfirmed,
    });
  }

  private emit(): void {
    const snap = this.snapshot;
    this.listeners.forEach((fn) => fn(snap));
  }

  private push(turn: ChatTurn): void {
    this.history.push(turn);
    // Bound memory: the panel is a session surface, not an archive.
    if (this.history.length > 60) this.history = this.history.slice(-60);
  }

  /** First turn. The greeting comes from the model, not from us. */
  async start(): Promise<ChatTurn | null> {
    if (this.hasGreeted) return null;
    this.hasGreeted = true;
    
    // Proactively gather context from the active tab before the first turn
    await this.scrapeActiveTab();

    const directive = this.contextGathered 
      ? `The user has just opened the panel. Greet them, and mention that you noticed their Client ID (${this.state.clientIdFolioNoDpid}) from the page they are on.` 
      : "The user has just opened the panel. Greet them.";

    return this.turn(directive, false);
  }

  async send(text: string): Promise<ChatTurn | null> {
    if (!text.trim()) return null;
    return this.turn(text, true);
  }

  private async turn(
    text: string,
    fromUser: boolean,
    dropLastFromContext = fromUser,
  ): Promise<ChatTurn | null> {
    this.busy = true;
    this.error = null;
    this.agreedThisTurn = false;
    this.draftFinalize = false;
    if (fromUser) this.push({ role: "user", text, at: new Date().toISOString() });
    this.emit();

    // CONFIRM-continue handled entirely in code: a short "yes/continue/ok"
    // while reviewing confirms with no LLM turn for the confirmation event
    // itself (see acknowledgeConfirm). The conversation then continues
    // proactively via proceedAfterConfirm, so "Confirmed — moving ahead."
    // is never a dead end.
    if (fromUser && this.shouldConfirmInCode(text)) {
      this.acknowledgeConfirm(text);
      return this.proceedAfterConfirm();
    }

    try {
      // Deterministic extraction FIRST (spec A.4): stated facts enter state
      // even if the model under-reports them — or if the model is
      // unreachable this turn. Only empty fields (plus explicit corrections)
      // are filled; contact fields are never touched here.
      if (fromUser) {
        const extra = onlyEmpty(
          this.state,
          extractFacts(text, { emailFlow: this.emailFlow, draftActive: !!this.draftCompletion }),
          isExplicitCorrection(text),
        );
        if (Object.keys(extra).length > 0) {
          this.state = mergeState(this.state, extra);
          const filled = Object.keys(extra);
          const stillSkipped = this.state.skippedFields.filter(
            (f) => !filled.includes(f as string),
          );
          if (stillSkipped.length !== this.state.skippedFields.length) {
            this.state = { ...this.state, skippedFields: stillSkipped };
          }
        }
      }

      // Code-owned pre-processing runs before the model sees anything:
      // contact denials/claims, email-handshake dates, contradiction
      // resolutions and ask-limit skips are all decided here, not by the LLM.
      const directives = fromUser ? this.preprocess(text) : [];

      // Skip fields asked twice with no answer, before the model decides
      // what to ask next. The reply for this turn already moves on.
      this.applyAskLimits();

      const focus = fromUser ? nextFocus(this.state) : null;

      // The model is authoritative for wording, but it is also a network
      // dependency that flaps (seen: every fallback model 404 at once). When
      // it is unreachable, code answers with a last-resort reply that keeps
      // every code-determined action (draft, review, date-ask) working — and
      // never invents facts (empty updates).
      let modelTurn: LLMTurnResult;
      let suppressedAction: string | null = null;
      let repeatDetected = false;
      let rawResponse = "";
      try {
        const out = await runTurn(
          this.llm,
          {
            state: this.state,
            // User turns pass the latest message separately; proactive turns
            // (greeting, post-confirm) keep the full history as context.
            history: dropLastFromContext ? this.history.slice(0, -1) : this.history,
            hasGreeted: this.hasGreeted,
            summaryConfirmed: this.summaryConfirmed,
            emailFlow: this.emailFlow,
            directives: [...directives, ...this.contradictionDirectives()],
          },
          text,
        );
        modelTurn = out.turn;
        suppressedAction = out.suppressedAction;
        repeatDetected = out.repeatDetected;
        rawResponse = out.rawResponse;
      } catch (e) {
        modelTurn = this.offlineFallback(text, directives);
        rawResponse = `{"offline":true,"error":${JSON.stringify(e instanceof Error ? e.message : String(e)).slice(0, 200)}}`;
      }
      this.lastRepeatDetected = repeatDetected;
      this.lastRaw = rawResponse;

      // Mutable copy: the agreement override below may set nextAction.
      let turn = modelTurn;

      // Digit-misfire guard: while collecting a non-amount placeholder, a
      // digit run in the answer (phone number, bare client ID) must not land
      // in amountInvolved. The completion parser below owns these answers.
      const dcField = this.draftCompletion?.pending[0];
      if (
        dcField === "userPhone" ||
        dcField === "clientId" ||
        dcField === "userName" ||
        dcField === "soldDescription"
      ) {
        delete (turn.stateUpdates as Record<string, unknown>).amountInvolved;
      }

      // Contradictions: commit only the safe part. Held fields stay as they
      // were until the user confirms which value is right.
      const { apply, held } = partitionUpdates(this.state, turn.stateUpdates, text);
      for (const h of held) {
        const existing = this.pendingContradictions.find((p) => p.field === h.field);
        if (existing) {
          existing.incoming = h.incoming;
          existing.rounds += 0; // rounds advance on the user's next message
        } else {
          this.pendingContradictions.push({ ...h, rounds: 0 });
        }
      }
      this.state = mergeState(this.state, apply);

      // Contact confirmation is code-owned: a recorded send date confirms.
      if (this.state.priorContactDate && this.state.priorContactProof !== "none") {
        this.state = { ...this.state, priorContactConfirmed: true };
      }

      // Suppress eager email generation: if we are still collecting pre-send
      // placeholders (Name, Phone), the model is strictly forbidden from
      // generating the draft until we are finished.
      if (this.draftCompletion && turn.nextAction === "draft_email") {
        turn = { ...turn, nextAction: "none" };
      }

      // Agreement override: the draft must never depend solely on the model's
      // action field. Seen live: the reply said "here is the email draft"
      // while nextAction stayed "none" (or was phase-suppressed), so no card
      // appeared and Gmail never opened. When the user plainly agrees, code
      // attaches the draft on THIS turn — placeholders included — while a
      // pre-send completion (if any) collects the gaps afterwards.
      if (turn.nextAction !== "draft_email" && this.agreedThisTurn) {
        const phase = this.derived.phase;
        if (phase === "INTAKE" || phase === "PREFLIGHT_EMAIL" || phase === "CONFIRM") {
          turn = { ...turn, nextAction: "draft_email" };
        }
      }

      // Explicit summary request: the user asked to review. When intake is
      // complete the card must ride this turn even if the model forgot it
      // (seen live: "show me a summary" answered with "I'm not sure" and no
      // card). User messages only: proactive directives contain words like
      // "review" themselves and must not trip this. Guarded so a premature
      // request never confirms an empty form.
      if (
        fromUser &&
        turn.nextAction !== "show_summary" &&
        /summar|review|recap|show me/i.test(text) &&
        this.derived.phase !== "GREETING" &&
        this.derived.missing.length === 0
      ) {
        turn = { ...turn, nextAction: "show_summary" };
        if (!/review|summary|confirm|read|understood/i.test(turn.reply)) {
          turn = { ...turn, reply: reviewIntroFor(detectLanguage(text).base) };
        }
      }

      // Ask-limit accounting, paused while collecting placeholders (those
      // replies are completion questions, not intake asks). Count a turn as
      // an ask unless the user was asking us something (Q&A turns don't burn
      // the field's patience) — answered fields reset to zero.
      if (!this.draftCompletion) {
        // A bare "??" or "…" is stonewalling, not a question: only a
        // question mark on a message with actual words pauses the count.
        const userAsked =
          text.trim().endsWith("?") &&
          /[a-zA-Z\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0CFF\u0C80-\u0CFF]/.test(text);
        if (focus && !userAsked) {
          this.askCounts[focus] = has(this.state, focus) ? 0 : (this.askCounts[focus] ?? 0) + 1;
        } else if (focus && has(this.state, focus)) {
          this.askCounts[focus] = 0;
        }
      }

      // The user confirming the summary unblocks autofill.
      if (turn.nextAction === "show_summary") this.summaryConfirmed = true;
      if (turn.nextAction === "start_autofill") this.summaryConfirmed = true;

      // An explicit "no" or a correction from the user should reopen the summary.
      if (/^(no|nope|not right|galat|nahi|superseded)/i.test(text.trim())) {
        this.summaryConfirmed = false;
      }

      const agentTurn: ChatTurn = {
        role: "agent",
        text: turn.reply,
        at: new Date().toISOString(),
        english:
          turn.reply !== this.state.issueSummaryOriginal &&
          this.state.issueSummaryOriginal &&
          /[ऀ-ॿఀ-౿஀-௿]/.test(turn.reply)
            ? this.state.issueSummaryEnglish ?? undefined
            : undefined,
        // The draft is built by code from the confirmed state, never by the
        // model, so every required part is always present. Never sent.
        emailDraft: turn.nextAction === "draft_email" ? buildEmailDraft(this.state) : undefined,
      };

      // Pre-send completion just finished: attach the now-complete draft.
      if (this.draftFinalize) {
        agentTurn.emailDraft = buildEmailDraft(this.state);
        this.draftFinalize = false;
      }

      // Review card rides the same turn the agent says it is reviewing.
      if (turn.nextAction === "show_summary") {
        agentTurn.review = {
          shownAt: agentTurn.at,
          missingAtShow: [...this.derived.missing],
        };
      }

      this.push(agentTurn);
      this.lastAction = turn.nextAction;
      this.lastSuppressed = suppressedAction;

      // Safety net: contact claimed but undated drifts back to date-asking.
      if (
        this.state.priorContactProof &&
        this.state.priorContactProof !== "none" &&
        !this.state.priorContactDate &&
        this.emailFlow === "none"
      ) {
        this.emailFlow = "awaitingDate";
      }

      // A fresh draft opens Gmail compose in the same turn (item 6).
      // Re-renders of an already-pending draft do not reopen it.
      if (agentTurn.emailDraft && this.emailFlow !== "awaitingSent") {
        this.emailFlow = "awaitingSent";
        await this.openGmail(agentTurn.emailDraft);
      } else if (agentTurn.emailDraft) {
        this.emailFlow = "awaitingSent";
      }

      this.busy = false;
      this.emit();

      return agentTurn;
    } catch (e) {
      this.busy = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.emit();
      return null;
    }
  }

  /** Dynamically injects a script to scrape the active tab for a Client ID */
  private async scrapeActiveTab(): Promise<void> {
    try {
      if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || tab.url.startsWith("chrome://")) return;

      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Look for common patterns on broker dashboards (e.g. Zerodha, Groww)
          // For the hackathon, we simply scan the DOM text for a 6-8 character uppercase alphanumeric pattern
          const text = document.body.innerText;
          const match = text.match(/\b([A-Z]{2}[0-9]{4,6})\b/);
          return match ? match[1] : null;
        },
      });

      const scrapedId = res[0]?.result;
      if (scrapedId && typeof scrapedId === "string") {
        this.state = { ...this.state, clientIdFolioNoDpid: scrapedId };
        this.contextGathered = true;
      }
    } catch (e) {
      console.warn("[sarthi] Active tab scraping failed", e);
    }
  }

  lastAction: LLMTurnResult["nextAction"] = "none";
  lastSuppressed: string | null = null;
  /** Raw model JSON of the latest turn (dev overlay + harness). */
  lastRaw: string | null = null;

  /**
   * Code-owned pre-processing. Runs before the model sees the message and
   * decides contact handshake, contradiction resolutions and skips.
   * Returns one-turn directives steering the reply.
   */
  private preprocess(text: string): string[] {
    const directives: string[] = [];
    const t = text.trim();

    // 0. Pending contradictions: the user is answering "which is right?"
    if (this.pendingContradictions.length > 0) {
      const keep: typeof this.pendingContradictions = [];
      for (const p of this.pendingContradictions) {
        const r = resolveContradiction(p, t);
        if (r === "incoming") {
          this.state = mergeState(this.state, { [p.field]: p.incoming } as Partial<GrievanceState>);
          if (p.field === "priorContactDate") {
            this.state = { ...this.state, priorContactConfirmed: true };
          }
        } else if (r === "unresolved") {
          keep.push({ ...p, rounds: p.rounds + 1 });
        }
      }
      this.pendingContradictions = keep.filter((p) => p.rounds < 2);
    }

    // 0b. Pre-send completion: this message answers the pending placeholder.
    // Contact talk aborts back to the normal handshake below.
    if (this.draftCompletion && this.draftCompletion.pending.length > 0) {
      if (EXPLICIT_DENIAL.test(t) || CONTACT_CLAIM.test(t) || DONE_MESSAGE.test(t)) {
        this.draftCompletion = null;
      } else {
        const field = this.draftCompletion.pending[0]!;
        if (SKIP_FIELD.test(t) || BARE_DENIAL.test(t)) {
          this.markCompletionSkipped(field);
          this.advanceCompletion();
        } else if (t.endsWith("?") && t.length > 3) {
          // A question, not an answer: answer it normally, then re-ask.
          directives.push(draftFieldDirective(field, true));
          return directives;
        } else {
          const parsed = parseDraftAnswer(field, t);
          if (parsed.ok) {
            this.writeDraftAnswer(field, parsed.value);
            this.advanceCompletion();
          } else if (++this.draftCompletion.retries > 1) {
            this.markCompletionSkipped(field);
            this.advanceCompletion(); // keep the placeholder, move on
          } else {
            directives.push(draftFieldDirective(field, true));
            return directives;
          }
        }
        if (!this.draftCompletion || this.draftCompletion.pending.length === 0) {
          this.draftCompletion = null;
          this.draftFinalize = true;
          directives.push(
            "[DRAFT_READY] The email draft is now complete and shown below; tell the user it is ready to review and send.",
          );
        } else {
          directives.push(draftFieldDirective(this.draftCompletion.pending[0]!, false));
        }
        return directives;
      }
    }

    // 1. Proof handshake has priority: here a bare "no" means "no proof".
    if (this.emailFlow === "awaitingProof") {
      const ticket = extractTicket(t);
      if (ticket) {
        this.state = { ...this.state, priorContactTicket: ticket };
        this.emailFlow = "done";
        this.proofTries = 0;
        directives.push(
          "[PROOF_RECORDED] The user just gave a ticket/reference number; it is recorded. Thank them briefly and move on to the next missing item.",
        );
      } else if (
        BARE_DENIAL.test(t) ||
        /\b(no proof|nothing|no ticket|no reference|no number)\b/i.test(t)
      ) {
        this.emailFlow = "done";
        this.proofTries = 0;
        directives.push(
          "[PROOF_DECLINED] The user has no proof. Say that is fine, briefly, and move on to the next missing item.",
        );
      } else {
        this.proofTries++;
        if (this.proofTries > 1) {
          this.emailFlow = "done";
          this.proofTries = 0;
          directives.push(
            "[PROOF_DECLINED] Move on without proof. Say that is fine briefly and continue with the next missing item.",
          );
        } else if (mentionsScreenshot(t)) {
          directives.push(
            "[PROOF_SCREENSHOT] The user says they have a screenshot. Tell them they can attach it in the review tab later, thank them, and move on to the next missing item.",
          );
          this.emailFlow = "done";
          this.proofTries = 0;
        } else {
          directives.push(
            "[EXPECTING_PROOF] The user did not give a ticket number. Ask once more, simply: a ticket or reference number if they have one, otherwise they can just say so.",
          );
        }
      }
      return directives;
    }

    // 2. Awaiting the send date.
    if (this.emailFlow === "awaitingDate") {
      const iso = normaliseDate(t) ?? findDateInText(t);
      if (iso) {
        this.state = {
          ...this.state,
          priorContactDate: iso,
          priorContactProof: this.state.priorContactProof ?? "emailed",
          priorContactConfirmed: true,
        };
        this.emailFlow = "awaitingProof";
        this.proofTries = 0;
        directives.push(
          `[EMAIL_DATE_RECORDED] The user confirmed sending the email on ${iso}; the record is updated. Thank them briefly, then ask whether they have any proof (a screenshot or a ticket/reference number).`,
        );
      } else if (BARE_DENIAL.test(t) || EXPLICIT_DENIAL.test(t) || DENIAL_WITH_VERB.test(t)) {
        this.applyDenial(directives);
      } else {
        directives.push(
          "[EXPECTING_EMAIL_DATE] No usable date in that message. Ask for the exact date they sent the email once more, simply, with an example like 'yesterday' or '12th March'.",
        );
      }
      return directives;
    }

    // 3. Awaiting sent confirmation.
    if (this.emailFlow === "awaitingSent") {
      if (EXPLICIT_DENIAL.test(t) || BARE_DENIAL.test(t) || DENIAL_WITH_VERB.test(t)) {
        this.applyDenial(directives);
      } else if (DONE_MESSAGE.test(t)) {
        // Item 6: a "done" still needs its date before anything is confirmed.
        this.emailFlow = "awaitingDate";
        directives.push(
          "[EXPECTING_EMAIL_DATE] The user says the email is sent. Ask for the exact date they sent it, simply, with an example like 'yesterday' or '12th March'.",
        );
      }
      return directives;
    }

    // 4. Fresh explicit denial, in any phase: the safe direction applies now.
    if (EXPLICIT_DENIAL.test(t) || DENIAL_WITH_VERB.test(t)) {
      this.applyDenial(directives);
      return directives;
    }

    // 4b. Small talk with nothing captured yet: greet back, no detail questions.
    // The prompt asks for this, but the live model sometimes skips straight to
    // interrogation (seen: "Hi" answered with "name the company"). Code steers.
    if (isSmallTalk(t) && this.emailFlow === "none" && nothingCaptured(this.state)) {
      directives.push(
        "SMALLTALK_GREETING: The user's message is small talk, and nothing about their complaint is known yet. Greet them back warmly in their language, do not ask for any complaint detail yet, and end with one open invitation to describe what happened.",
      );
      return directives;
    }

    // 5. Fresh claim of contact without a date: record the claim, ask the date.
    if (CONTACT_CLAIM.test(t) && !this.state.priorContactDate) {
      const iso = normaliseDate(t) ?? findDateInText(t);
      if (iso) {
        this.state = {
          ...this.state,
          priorContactDate: iso,
          priorContactProof: this.state.priorContactProof ?? "emailed",
          priorContactConfirmed: true,
        };
        this.emailFlow = "awaitingProof";
        this.proofTries = 0;
        directives.push(
          `[EMAIL_DATE_RECORDED] The user said they emailed on ${iso}; the record is updated. Thank them briefly, then ask whether they have any proof (a screenshot or a ticket/reference number).`,
        );
      } else {
        this.state = { ...this.state, priorContactProof: "emailed" };
        this.emailFlow = "awaitingDate";
        directives.push(
          "[EXPECTING_EMAIL_DATE] The user says they already emailed the company but gave no date. Ask for the exact date they sent it, simply, with an example.",
        );
      }
      return directives;
    }

    // 6. Agreement to the draft: instant when complete, collected otherwise.
    if (this.agreedToDraft(text)) {
      this.agreedThisTurn = true;
      const fillable = missingDraftFields(this.state);
      if (fillable.length > 0) {
        this.draftCompletion = { pending: fillable, retries: 0 };
        directives.push(draftFieldDirective(fillable[0]!, false));
      }
      return directives;
    }

    return directives;
  }

  /**
   * CONFIRM-continue handled entirely in code: a short "yes/continue/ok"
   * while reviewing confirms with no LLM turn at all. Also covers the turn
   * right after the review card: by then the phase has moved past CONFIRM
   * (e.g. PREFLIGHT_EMAIL when contact was denied), but the affirmation
   * still answers the card, not a question. Guarded so it never hijacks
   * other flows (email handshake, contradictions, completion, draft offers).
   */
  private shouldConfirmInCode(text: string): boolean {
    const t = text.trim();
    if (!CONFIRM_AFFIRM.test(t) && !CONFIRM_AFFIRM_LONG.test(t)) return false;
    if (this.emailFlow !== "none") return false;
    if (this.draftCompletion) return false;
    if (this.pendingContradictions.length > 0) return false;
    if (this.derived.phase === "CONFIRM") return true;
    const lastAgent = [...this.history].reverse().find((m) => m.role === "agent");
    if (lastAgent?.review && this.derived.missing.length === 0) return true;
    return false;
  }

  /**
   * The CONFIRM event itself: pure code, zero model involvement. Sets the
   * flag and receipts it in chat. What happens NEXT is a separate,
   * model-driven turn (proceedAfterConfirm) — kept apart so the
   * confirmation stays free and deterministic.
   */
  private acknowledgeConfirm(text: string): ChatTurn {
    this.summaryConfirmed = true;
    const ack: ChatTurn = {
      role: "agent",
      text: confirmAckFor(detectLanguage(text).base),
      at: new Date().toISOString(),
    };
    this.push(ack);
    this.lastAction = "show_summary";
    this.emit();
    return ack;
  }

  /**
   * Proactive continuation right after a confirmation, so the chat never
   * stalls on "Confirmed — moving ahead." Model-driven (one turn), with the
   * direction chosen in code from the live phase:
   * - AUTOFILL-ready: fill the portal for real (action forced in code, like
   *   the draft agreement override — never left to the model's discretion).
   * - PREFLIGHT_EMAIL: ask the single contact question that unblocks filing.
   * - Otherwise: continue with the most important missing item.
   * Runs through the normal turn pipeline, so offline fallback and Gmail
   * opening apply exactly as they do for user-driven turns.
   */
  private async proceedAfterConfirm(): Promise<ChatTurn | null> {
    const phase = this.derived.phase;
    let directive: string;
    if (phase === "AUTOFILL") {
      directive =
        "[CONFIRMED] The user just confirmed the review and everything is ready. " +
        "Set nextAction to start_autofill and tell them in one short sentence that you are filling the form on the page now.";
    } else if (phase === "PREFLIGHT_EMAIL") {
      directive =
        "[CONFIRMED] The user just confirmed the review. Contact with the company is still unconfirmed, which blocks filing. " +
        "Ask exactly this question, translated into the user's language, and nothing else: " +
        "'Have you already written to the company about this? If not, I can draft that email for you.' " +
        "Do not hedge, do not say you are not sure — asking this question is always correct here.";
    } else {
      directive =
        "[CONFIRMED] The user just confirmed the review. Continue with the single most important missing item: ask exactly ONE short question about it.";
    }
    const turn = await this.turn(directive, false);
    // Autofill must never depend on the model's action field (seen: the
    // reply says "filling now" while nextAction stays "none", so nothing
    // fills). When code says ready, code sets the action.
    if (turn && this.derived.phase === "AUTOFILL") {
      this.lastAction = "start_autofill";
      this.emit();
    }
    return turn;
  }

  /**
   * Last-resort reply when the model is unreachable. Code-owned and used only
   * then: it carries the code-determined intent for this turn (draft on
   * agreement, card on explicit summary request, offer on denial, date-ask
   * while awaiting a date, verified SCORES explainer for "what is SCORES?"),
   * and a plain trouble notice otherwise. Empty updates always: code never
   * invents facts on the model's behalf.
   */
  private offlineFallback(text: string, directives: string[]): LLMTurnResult {
    const det = detectLanguage(text);
    const phase = this.derived.phase;
    const base: LLMTurnResult = {
      detectedLanguage: det.tag,
      reply: "",
      stateUpdates: {},
      phase,
      nextAction: "none",
      confidence: {},
    };
    if (this.agreedThisTurn && phase !== "GREETING") {
      return {
        ...base,
        reply: "Here is the email draft — please review it below.",
        nextAction: "draft_email",
      };
    }
    if (
      /summar|review|recap|show me/i.test(text) &&
      phase !== "GREETING" &&
      this.derived.missing.length === 0
    ) {
      return { ...base, reply: reviewIntroFor(det.base), nextAction: "show_summary" };
    }
    if (directives.some((d) => d.startsWith("[CONTACT_DENIED]"))) {
      return {
        ...base,
        reply: "No problem at all. Want me to draft that email for you?",
      };
    }
    if (directives.some((d) => d.startsWith("[EXPECTING_EMAIL_DATE]"))) {
      return {
        ...base,
        reply: "When exactly did you send it? For example, 'yesterday' or '12th March'.",
      };
    }
    if (/what is SCORES\?/i.test(text.trim())) {
      return {
        ...base,
        reply:
          "SCORES (scores.sebi.gov.in) is SEBI's online portal for investor complaints. " +
          "If the company doesn't resolve your email, you can file there — and I'll help you prepare everything for it.",
      };
    }
    if (phase === "AUTOFILL") {
      // Confirmed and ready while the model is down: the portal fill is
      // code anyway, so say so plainly. The action is forced by the caller.
      return {
        ...base,
        reply:
          "Confirmed — I'm filling the form on the page now. Please review it there and submit it yourself.",
        nextAction: "start_autofill",
      };
    }
    // Small talk with nothing captured: greet + invite, same shape as the
    // live greeting (name, journey, open question — never a field ask).
    if (isSmallTalk(text)) {
      const det2 = detectLanguage(text);
      const line =
        (det2.latin ? OFFLINE_GREET_LATN[det2.base] : undefined) ??
        OFFLINE_GREET[det2.base] ??
        OFFLINE_GREET.en!;
      return { ...base, reply: line };
    }
    return { ...base, reply: offlineLineFor(det) };
  }

  /** Shared denial outcome: nothing contacted, nothing dated, unconfirmed. */  private applyDenial(directives: string[]): void {
    this.state = {
      ...this.state,
      priorContactProof: "none",
      priorContactDate: null,
      priorContactTicket: null,
      priorContactConfirmed: false,
    };
    this.emailFlow = "none";
    this.proofTries = 0;
    directives.push(
      "[CONTACT_DENIED] The user just said they have NOT contacted the company. Reply in at most two sentences: acknowledge briefly, then ask exactly this: 'Want me to draft that email for you?' Do not ask for any other detail (no company name, no date, no amount) in this reply.",
    );
  }

  /** Move the pre-send completion past its current field. */
  private advanceCompletion(): void {
    if (!this.draftCompletion) return;
    this.draftCompletion.pending.shift();
    this.draftCompletion.retries = 0;
  }

  /**
   * Record a completion give-up in skippedFields so the field is never asked
   * again anywhere (intake asks consult the same list). Only fields with a
   * skippable state key map here; the rest just keep their placeholder.
   */
  private markCompletionSkipped(field: DraftFieldKey): void {
    const key =
      field === "clientId"
        ? "clientIdFolioNoDpid"
        : field === "amount"
          ? "amountInvolved"
          : null;
    if (key && !(this.state.skippedFields as string[]).includes(key)) {
      this.state = {
        ...this.state,
        skippedFields: [...this.state.skippedFields, key as FieldKey],
      };
    }
  }

  /** Store a parsed pre-send answer straight into state. The user was asked
   * for exactly this field, so their answer is authoritative (no
   * contradiction dance for it). */
  private writeDraftAnswer(field: DraftFieldKey, value: string | number): void {
    switch (field) {
      case "clientId":
        this.state = { ...this.state, clientIdFolioNoDpid: String(value) };
        break;
      case "amount":
        this.state = { ...this.state, amountInvolved: Number(value) };
        break;
      case "incidentDate":
        this.state = { ...this.state, incidentDate: String(value) };
        break;
      case "soldDescription":
        this.state = { ...this.state, soldDescription: String(value) };
        break;
      case "userName":
        this.state = { ...this.state, userName: String(value) };
        break;
      case "userPhone":
        this.state = { ...this.state, userPhone: String(value) };
        break;
    }
  }

  /**
   * Did the user agree to the email draft in this message? Delegates to the
   * shared rule so controller and mock interpret agreement identically.
   */
  private agreedToDraft(text: string): boolean {
    const lastAgent = [...this.history].reverse().find((m) => m.role === "agent");
    return isAgreementToDraft(text, lastAgent?.text ?? null, nothingCaptured(this.state));
  }

  /** Fields asked twice with no answer are skipped before the model chooses. */
  private applyAskLimits(): void {
    for (const [field, count] of Object.entries(this.askCounts)) {
      if (
        count >= 2 &&
        !has(this.state, field as FieldKey) &&
        !(this.state.skippedFields as string[]).includes(field)
      ) {
        this.state = {
          ...this.state,
          skippedFields: [...this.state.skippedFields, field as FieldKey],
        };
      }
    }
  }

  private contradictionDirectives(): string[] {
    return this.pendingContradictions.map(
      (p) =>
        `UNRESOLVED CONTRADICTION on ${p.field}: recorded "${String(p.current)}" but the user also said "${String(p.incoming)}". Briefly ask which is right ("Earlier you said X, now Y — which is right?") before using either.`,
    );
  }

  /** Opens Gmail compose for a fresh draft. Guarded: no-ops outside the extension. */
  private async openGmail(draft: EmailDraft): Promise<void> {
    this.lastGmailUrl = gmailComposeUrl(draft.to, draft.subject, draft.bodyEn);
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: "gmail/open",
          payload: { to: draft.to, subject: draft.subject, body: draft.bodyEn },
        });
        this.gmailFailed = false;
      }
    } catch (e) {
      // The card's own "Open in Gmail" button remains as the manual fallback.
      console.warn("[sarthi] automatic Gmail open failed", e);
      this.gmailFailed = true;
      this.emit();
    }
  }

  // ---- side effects the UI triggers ----

  /**
   * Record that the user sent the broker email. The date is what confirms
   * contact: setting it flips priorContactConfirmed (code-owned, item 1).
   * Never overwrites an existing proof (e.g. "rejected").
   */
  confirmEmailSent(dateISO?: string): void {
    this.state = {
      ...this.state,
      priorContactProof: this.state.priorContactProof ?? "emailed",
      priorContactDate: dateISO ?? new Date().toISOString().slice(0, 10),
      priorContactConfirmed: true,
    };
    this.emailFlow = "done";
    this.emit();
  }

  recordRejection(): void {
    this.state = { ...this.state, priorContactProof: "rejected" };
    this.emit();
  }

  /**
   * "Looks right" on the review card. Flags the confirmation, then continues
   * proactively so the chat moves instead of stalling. Async because the
   * continuation is a real turn; the flag itself is set synchronously first.
   */
  async confirmSummary(): Promise<ChatTurn | null> {
    this.summaryConfirmed = true;
    this.emit();
    return this.proceedAfterConfirm();
  }

  /**
   * The user rejected the summary ("Edit"). Drops back so the next turn
   * re-asks; no LLM call involved.
   */
  declineSummary(): void {
    this.summaryConfirmed = false;
    this.emit();
  }

  /**
   * Everything the review card needs, computed from live state. The card is
   * pure presentation over this payload.
   */
  getReview(): {
    phase: string;
    missing: string[];
    canProceed: boolean;
    deadline: { date: string | null; daysLeft: number | null; urgent: boolean; passed: boolean };
    blockers: string[];
    fields: Array<{ key: string; label: string; value: string | null }>;
  } {
    const d = this.derived;
    const s = this.state;
    return {
      phase: d.phase,
      missing: [...d.missing],
      canProceed: d.missing.length === 0,
      deadline: { ...d.deadline },
      blockers: [...d.blockers],
      fields: [
        { key: "entityName", label: "Entity", value: s.entityName },
        { key: "issueSummaryEnglish", label: "Issue", value: s.issueSummaryEnglish },
        { key: "incidentDate", label: "Date", value: s.incidentDate },
        { key: "amountInvolved", label: "Amount", value: s.amountInvolved == null ? null : `INR ${s.amountInvolved}` },
        { key: "reliefSought", label: "Relief", value: s.reliefSought },
        {
          key: "priorContact",
          label: "Contacted company",
          value: s.priorContactProof === "none" ? "No — will email first" : s.priorContactDate ?? null,
        },
      ],
    };
  }

  addAttachments(files: GrievanceState["attachments"]): void {
    this.state = { ...this.state, attachments: [...this.state.attachments, ...files] };
    this.emit();
  }

  /** Spec 8: wipe everything held in memory. */
  clear(): void {
    this.state = emptyState();
    this.history = [];
    this.hasGreeted = false;
    this.summaryConfirmed = false;
    this.error = null;
    // Only clear browser storage when we are actually inside the extension.
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.session) {
        void chrome.storage.session.clear();
      }
    } catch {
      /* nothing to clear */
    }
    this.emit();
  }



}

/** Question for one pre-send placeholder. Retry adds a soft apology lead. */
function draftFieldDirective(field: DraftFieldKey, retry: boolean): string {
  const ask: Record<DraftFieldKey, string> = {
    clientId:
      "Ask ONLY this one now, simply: the user's client ID or UCC (say they can reply 'skip' to leave it blank). Do not mention other missing fields yet.",
    amount: "Ask ONLY this one now, simply: what amount is involved, in rupees.",
    incidentDate:
      "Ask ONLY this one now, simply: what date this first happened, with an example.",
    soldDescription: "Ask ONLY this one now, simply: what exactly was bought or sold.",
    userName:
      "Ask ONLY this one now, simply: their full name, as it should appear in the email signature.",
    userPhone:
      "Ask ONLY this one now, simply: their mobile number for the email signature.",
  };
  const tag = retry ? "DRAFT_FIELD_RETRY" : "DRAFT_FIELD";
  return `[${tag}:${field}] ${retry ? "They didn't give a usable answer; ask once more, more simply. " : ""}${ask[field]}`;
}

/** Parse a pre-send answer. Lenient, since the question was explicit. */
function parseDraftAnswer(
  field: DraftFieldKey,
  text: string,
): { ok: boolean; value: string | number } {
  const t = text.trim();
  switch (field) {
    case "clientId":
      return t.length >= 3 ? { ok: true, value: t.toUpperCase() } : { ok: false, value: "" };
    case "amount": {
      const n = parseInt(t.replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) && n > 0 ? { ok: true, value: n } : { ok: false, value: "" };
    }
    case "incidentDate": {
      const iso = normaliseDate(t) ?? findDateInText(t);
      if (!iso) return { ok: false, value: "" };
      // Never a future incident, even if explicitly stated.
      if (iso > todayISO()) return { ok: false, value: "" };
      return { ok: true, value: iso };
    }
    case "soldDescription":
    case "userName":
      return t.length > 0 ? { ok: true, value: t } : { ok: false, value: "" };
    case "userPhone": {
      const digits = t.replace(/\D/g, "");
      return digits.length >= 10 ? { ok: true, value: digits } : { ok: false, value: "" };
    }
  }
}