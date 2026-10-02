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
import { buildEmailDraft, missingDraftFields, type DraftFieldKey } from "@/agent/emailDraft";
import { normaliseDate } from "@/agent/guardrails";
import { findDateInText, todayISO } from "@/state/dates";
import {
  BARE_DENIAL,
  CONTACT_CLAIM,
  DONE_MESSAGE,
  EXPLICIT_DENIAL,
  SKIP_FIELD,
  extractTicket,
  isAgreementToDraft,
  mentionsScreenshot,
} from "@/agent/contactPhrases";
import type { EmailDraft, FieldKey } from "@/shared/types";
import { isSmallTalk } from "@/agent/detect";

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
import { createLLM, createSTT, createTTS } from "@/providers/registry";
import type { LLMProvider, STTProvider, TTSProvider } from "@/providers/types";
import { config } from "@/shared/config";
import { truncateForSpeech } from "@/agent/guardrails";

export interface AgentController {
  state: GrievanceState;
  derived: DerivedState;
  history: ChatTurn[];
  hasGreeted: boolean;
  summaryConfirmed: boolean;
  busy: boolean;
  error: string | null;
  gmailFailed: boolean;
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
  private stt: STTProvider;
  private tts: TTSProvider;
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

  constructor(deps?: Partial<{ llm: LLMProvider; stt: STTProvider; tts: TTSProvider }>) {
    this.llm = deps?.llm ?? createLLM();
    this.stt = deps?.stt ?? createSTT();
    this.tts = deps?.tts ?? createTTS();
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
    // Set synchronously so a second mount (React StrictMode) cannot start twice
    // and produce two greetings in the wrong order.
    this.hasGreeted = true;
    return this.turn("The user has just opened the panel. Greet them.", false);
  }

  async send(text: string): Promise<ChatTurn | null> {
    if (!text.trim()) return null;
    return this.turn(text, true);
  }

  private async turn(text: string, fromUser: boolean): Promise<ChatTurn | null> {
    this.busy = true;
    this.error = null;
    this.agreedThisTurn = false;
    this.draftFinalize = false;
    if (fromUser) this.push({ role: "user", text, at: new Date().toISOString() });
    this.emit();

    try {
      // Code-owned pre-processing runs before the model sees anything:
      // contact denials/claims, email-handshake dates, contradiction
      // resolutions and ask-limit skips are all decided here, not by the LLM.
      const directives = fromUser ? this.preprocess(text) : [];

      // Skip fields asked twice with no answer, before the model decides
      // what to ask next. The reply for this turn already moves on.
      this.applyAskLimits();

      const focus = fromUser ? nextFocus(this.state) : null;

      const { turn: modelTurn, suppressedAction, repeatDetected } = await runTurn(
        this.llm,
        {
          state: this.state,
          history: this.history.slice(0, -1), // latest is passed separately
          hasGreeted: this.hasGreeted,
          summaryConfirmed: this.summaryConfirmed,
          emailFlow: this.emailFlow,
          directives: [...directives, ...this.contradictionDirectives()],
        },
        text,
      );
      this.lastRepeatDetected = repeatDetected;

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

      // Agreement override: the draft must never depend solely on the model's
      // action field. Seen live: the reply said "here is the email draft"
      // while nextAction stayed "none" (or was phase-suppressed), so no card
      // appeared and Gmail never opened. When the user plainly agrees, code
      // attaches the draft — unless a pre-send completion just started, in
      // which case placeholders are collected first and the draft opens after.
      if (
        turn.nextAction !== "draft_email" &&
        this.agreedThisTurn &&
        !this.draftCompletion
      ) {
        const phase = this.derived.phase;
        if (phase === "INTAKE" || phase === "PREFLIGHT_EMAIL" || phase === "CONFIRM") {
          turn = { ...turn, nextAction: "draft_email" };
        }
      }

      // Ask-limit accounting, paused while collecting placeholders (those
      // replies are completion questions, not intake asks).
      if (!this.draftCompletion) {
        if (focus && turn.reply.includes("?")) {
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

      if (config.spokenReplies) void this.speak(turn.reply);
      return agentTurn;
    } catch (e) {
      this.busy = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.emit();
      return null;
    }
  }

  lastAction: LLMTurnResult["nextAction"] = "none";
  lastSuppressed: string | null = null;

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
      } else if (BARE_DENIAL.test(t) || EXPLICIT_DENIAL.test(t)) {
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
      if (EXPLICIT_DENIAL.test(t) || BARE_DENIAL.test(t)) {
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
    if (EXPLICIT_DENIAL.test(t)) {
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

  /** Shared denial outcome: nothing contacted, nothing dated, unconfirmed. */
  private applyDenial(directives: string[]): void {
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
      "[CONTACT_DENIED] The user just said they have NOT contacted the company. Acknowledge briefly and offer to draft the email for them. Do not show the draft yet.",
    );
  }

  /** Move the pre-send completion past its current field. */
  private advanceCompletion(): void {
    if (!this.draftCompletion) return;
    this.draftCompletion.pending.shift();
    this.draftCompletion.retries = 0;
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
      console.warn("[saathi] automatic Gmail open failed", e);
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

  confirmSummary(): void {
    this.summaryConfirmed = true;
    this.emit();
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

  async transcribe(audio: Blob, langHint?: string): Promise<string> {
    const { text } = await this.stt.transcribe(audio, langHint);
    return text;
  }

  private async speak(text: string): Promise<void> {
    try {
      const short = truncateForSpeech(text, config.maxSpokenSentences);
      const blob = await this.tts.speak(short, this.state.userLanguage);
      await new Audio(URL.createObjectURL(blob)).play();
    } catch (e) {
      console.warn("[saathi] tts failed", e);
    }
  }

  /** TTS off by default because it costs money per character. */
  setSpokenReplies(on: boolean): void {
    config.spokenReplies = on;
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