import type { ChatTurn, GrievanceState, LLMTurnResult } from "@/shared/types";
import type { LLMProvider } from "@/providers/types";
import { SYSTEM_PROMPT, buildTurnInstructions } from "./systemPrompt";
import { neutralise, textSimilarity, validateTurn, violatesGuardrails } from "./guardrails";
import { repairOnce } from "@/providers/llm/repair";
import { detectLanguage } from "./detect";
import { todayISO } from "@/state/dates";
import { SCORES_RULES } from "@/data/scoresRules";
import { computeDerived, knownView } from "@/state/stateReducer";

export type EmailFlowState = "none" | "awaitingSent" | "awaitingDate" | "awaitingProof" | "done";

export interface TurnContext {
  state: GrievanceState;
  history: ChatTurn[];
  hasGreeted: boolean;
  summaryConfirmed: boolean;
  emailFlow: EmailFlowState;
  /** One-turn code directives, rendered verbatim into the instructions. */
  directives: string[];
}

/** Keep history cheap: full detail for recent turns, a stub for older ones. */
const KEEP_RECENT = 2;

function compactHistory(history: ChatTurn[], summary: string | null): ChatTurn[] {
  if (history.length <= KEEP_RECENT + 2) return history;
  const older = history.slice(0, history.length - KEEP_RECENT);
  const recent = history.slice(history.length - KEEP_RECENT);
  const merged: ChatTurn = {
    role: "system",
    text: summary ?? summarise(older),
    at: older[older.length - 1]?.at ?? new Date().toISOString(),
  };
  return [merged, ...recent];
}

/** Cheap local summary of turns we have already folded into state. */
function summarise(turns: ChatTurn[]): string {
  const facts = turns
    .filter((t) => t.role === "user")
    .slice(-3)
    .map((t) => t.text)
    .join(" / ");
  return `Earlier in the conversation the user said: ${facts}`.slice(0, 600);
}

const NEXT_ACTION_ALLOWANCE: Record<string, string[]> = {
  GREETING: ["none"],
  INTAKE: ["none", "show_summary"],
  CONFIRM: ["none", "show_summary"],
  PREFLIGHT_EMAIL: ["none", "draft_email", "show_summary"],
  AUTOFILL: ["none", "start_autofill", "show_summary"],
  REVIEW: ["none", "show_summary"],
};

export interface TurnOutcome {
  turn: LLMTurnResult;
  /** Set when the model asked for something we are not allowed to do yet. */
  suppressedAction: string | null;
  guardrailTripped: boolean;
  repairUsed: boolean;
  /** Set when the reply repeated a recent question and was regenerated. */
  repeatDetected: boolean;
}

/** Two replies asking the same thing score above this. No embeddings offline. */
export const REPEAT_SIMILARITY_THRESHOLD = 0.8;
/** How far back we look for a repeated question. */
const REPEAT_HISTORY_WINDOW = 5;

export async function runTurn(
  llm: LLMProvider,
  ctx: TurnContext,
  latestUserMessage: string,
): Promise<TurnOutcome> {
  const derived = computeDerived(ctx.state, {
    hasGreeted: ctx.hasGreeted,
    summaryConfirmed: ctx.summaryConfirmed,
  });

  const instructions = buildTurnInstructions({
    phase: derived.phase,
    missing: derived.missing,
    missingOptional: derived.missingOptional,
    known: knownView(ctx.state),
    escalation: derived.escalation.message,
    nextAllowedAction: NEXT_ACTION_ALLOWANCE[derived.phase] ?? ["none"],
    turnNumber: ctx.history.length + 1,
    today: todayISO(),
    deadlineNote: buildDeadlineNote(derived.deadline.date, derived.deadline.daysLeft, derived.deadline.passed, derived.deadline.urgent),
    emailFlow: ctx.emailFlow,
    directives: ctx.directives,
  });

  const messages = [
    { role: "system" as const, content: `${SYSTEM_PROMPT}\n\n${instructions}` },
    // Older context arrives as a single system turn to save tokens.
    ...compactHistory(ctx.history, null)
      .filter((t) => t.role !== "system")
      .map((t) => ({ role: t.role === "agent" ? ("assistant" as const) : ("user" as const), content: t.text })),
    { role: "user" as const, content: latestUserMessage },
  ];

  let repairUsed = false;
  let raw = await llm.chat(messages);
  let turn = validateTurn(raw);

  // Spec 2b: validate, then retry once asking the model to fix its output.
  if (!turn) {
    const fixed = await repairOnce(llm, raw, "output did not match the turn schema", messages);
    if (fixed) {
      repairUsed = true;
      turn = validateTurn(fixed);
    }
  }

  if (!turn) {
    // Last resort: a safe, still-useful turn rather than a dead panel.
    const det = detectLanguage(latestUserMessage);
    turn = {
      detectedLanguage: det.tag,
      reply: FALLBACK[det.base] ?? FALLBACK.en!,
      stateUpdates: {},
      phase: derived.phase,
      nextAction: "none",
      confidence: {},
    };
    console.warn("[saathi] model output unusable after repair; using fallback");
  }

  // Code decides what is allowed, regardless of what the model asked for.
  const allowed = NEXT_ACTION_ALLOWANCE[derived.phase] ?? ["none"];
  let suppressedAction: string | null = null;
  if (turn.nextAction !== "none" && !allowed.includes(turn.nextAction)) {
    suppressedAction = turn.nextAction;
    turn = { ...turn, nextAction: "none" };
  }

  // Autofill additionally requires explicit user go-ahead, tracked by the UI.
  if (turn.nextAction === "start_autofill" && !ctx.summaryConfirmed) {
    suppressedAction = "start_autofill";
    turn = { ...turn, nextAction: "none" };
  }

  const guardrailTripped = violatesGuardrails(turn.reply);
  if (guardrailTripped) {
    turn = {
      ...turn,
      reply: neutralise(turn.reply, turn.detectedLanguage),
    };
  }

  // Keep the detected language honest even if the model guessed oddly.
  const local = detectLanguage(latestUserMessage);
  if (local.confidence >= 0.9 && local.tag !== turn.detectedLanguage) {
    turn = { ...turn, detectedLanguage: local.tag };
  }

  // No repeats: if this reply asks the same thing as one of the last few
  // agent messages, regenerate once with an explicit rephrase instruction.
  // The retry counts as its own attempt; a still-similar reply is accepted
  // rather than looping forever.
  let repeatDetected = false;
  const recentAgent = ctx.history
    .filter((t) => t.role === "agent")
    .slice(-REPEAT_HISTORY_WINDOW)
    .map((t) => t.text);
  // Copy out of the narrowed variable: closures reset narrowing on `let`.
  const replyText: string = turn.reply;
  if (recentAgent.some((prev) => textSimilarity(replyText, prev) > REPEAT_SIMILARITY_THRESHOLD)) {
    repeatDetected = true;
    const retry = await llm.chat([
      ...messages.slice(0, -1),
      {
        role: "user" as const,
        content:
          `${messages[messages.length - 1]!.content}\n\nREPHRASE_REQUEST: ` +
          `Your reply above asks something very similar to what you already asked. ` +
          `Ask this differently, more simply, with an example, or move on to the next missing item. ` +
          `Do not ask about anything in ALREADY KNOWN. Reply in the same language. Return the same JSON format.`,
      },
    ]);
    const fixed = validateTurn(retry);
    if (fixed) {
      repairUsed = true;
      turn = fixed;
      // Re-apply the guardrails to the replacement, cheaply.
      if (violatesGuardrails(turn.reply)) {
        turn = { ...turn, reply: neutralise(turn.reply, turn.detectedLanguage) };
      }
    }
  }

  return { turn, suppressedAction, guardrailTripped, repairUsed, repeatDetected };
}

/**
 * What the model should tell the user about the filing deadline, in English
 * (it translates into the user's language itself). Null when nothing to say.
 */
function buildDeadlineNote(
  date: string | null,
  daysLeft: number | null,
  passed: boolean,
  urgent: boolean,
): string | null {
  if (!date || !urgent) return null;
  const helpline = SCORES_RULES.helpline.value.join(" / ");
  if (passed) {
    return (
      `The one-year SCORES filing deadline for this incident has already passed. ` +
      `Tell the user clearly, in their language, that SCORES will likely reject a complaint filed now, ` +
      `and suggest they check with SEBI's helpline (${helpline}) about any other options.`
    );
  }
  return (
    `The SCORES filing deadline for this incident is ${date}, only ${daysLeft} days away. ` +
    `Tell the user clearly, in their language, that time is short and they should move quickly, ` +
    `and suggest SEBI's helpline (${helpline}) if they need guidance.`
  );
}

const FALLBACK: Record<string, string> = {
  en: "Sorry, I didn't catch that clearly. Could you tell me what happened, in your own words?",
  hi: "माफ कीजिए, मैं ठीक से समझ नहीं पाया। क्या हुआ था, अपनी भाषा में बताइए?",
  ta: "மன்னிக்கவும், தெளிவாக புரியவில்லை. என்ன நடந்தது என்று சொல்லுங்கள்.",
  kn: "ಕ್ಷಮಿಸಿ, ಸ್ಪಷ್ಟವಾಗಿ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಏನಾಯಿತು ಎಂದು ತಿಳಿಸಿ.",
  te: "క్షమించండి, స్పష్టంగా అర్థం కాలేదు. ఏమి జరిగిందో చెప్పండి.",
};