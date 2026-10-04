import { Conversation } from "@/sidepanel/conversation";
import { GeminiLLMProvider } from "@/providers/llm/gemini";
import type { ChatMessage, LLMProvider } from "@/providers/types";
import { detectLanguage } from "@/agent/detect";
import { askedAboutField, statesUnverifiedRule } from "@/agent/guardrails";
import { knownView } from "@/state/stateReducer";
import type { GrievanceState } from "@/shared/types";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type LlmMode = "live" | "recorded";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, "fixtures");
export const OUT_DIR = join(HERE, "..", "..", "test-output");
export const ROWS_DIR = join(OUT_DIR, "_rows");

export function llmMode(): LlmMode {
  return process.env.LLM_MODE === "recorded" ? "recorded" : "live";
}

export function convoModel(): string {
  return process.env.CONVO_MODEL ?? "gemini-3.5-flash-lite";
}

/** Counts chat() calls so tests can prove "no new LLM turn" happened. */
export class CountingLLM implements LLMProvider {
  calls = 0;
  constructor(
    private inner: LLMProvider,
    private record?: string[],
  ) {}
  get id() {
    return `counting(${this.inner.id})`;
  }
  async chat(m: ChatMessage[]): Promise<string> {
    this.calls++;
    const out = await this.inner.chat(m);
    this.record?.push(out);
    return out;
  }
}

/** Replays exact raw LLM outputs saved by a previous live run. */
export class RecordedLLM implements LLMProvider {
  readonly id = "recorded";
  private i = 0;
  constructor(private responses: string[]) {}
  async chat(): Promise<string> {
    if (this.i >= this.responses.length) {
      throw new Error(
        `recorded fixture exhausted after ${this.i} calls — re-record with LLM_MODE=live`,
      );
    }
    return this.responses[this.i++]!;
  }
}

function fixturePath(scenarioId: string, run: number): string {
  return join(FIXTURE_DIR, scenarioId, `run${run}.json`);
}

export function loadFixture(scenarioId: string, run: number): string[] {
  const p = fixturePath(scenarioId, run);
  if (!existsSync(p)) {
    throw new Error(`missing fixture ${p} — run once with LLM_MODE=live to record it`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as string[];
}

function saveFixture(scenarioId: string, run: number, responses: string[]): void {
  const p = fixturePath(scenarioId, run);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(responses, null, 1));
}

export interface TurnRec {
  n: number;
  user: string;
  agent: string;
  lang: string;
  phaseBefore: string;
  phaseAfter: string;
  nextAction: string;
  stateDiff: Record<string, unknown>;
  missing: string[];
  askedAbout: string | null;
  draftShown: boolean;
  gmailUrl: string | null;
  reviewShown: boolean;
}

export interface CheckRec {
  name: string;
  pass: boolean;
  reason: string;
  turn: number;
}

export interface Scenario {
  id: string;
  title: string;
  hard: boolean;
  messages: string[];
  setup?: (conv: Conversation) => void | Promise<void>;
  assert: (ctx: Ctx) => void | Promise<void>;
}

export interface Ctx {
  conv: Conversation;
  turns: TurnRec[];
  llmCalls(): number;
  check(name: string, cond: unknown, reason?: string): void;
  note(line: string): void;
}

function diffState(before: GrievanceState, after: GrievanceState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof GrievanceState)[]) {
    if (k === "attachments") {
      if (after.attachments.length !== before.attachments.length) {
        out.attachments = `+${after.attachments.length - before.attachments.length}`;
      }
      continue;
    }
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) out[k] = after[k];
  }
  return out;
}

function cloneState(s: GrievanceState): GrievanceState {
  return JSON.parse(JSON.stringify(s)) as GrievanceState;
}

export interface RunResult {
  id: string;
  title: string;
  hard: boolean;
  run: number;
  mode: LlmMode;
  passed: boolean;
  checks: CheckRec[];
  failures: string[];
  turns: number;
  llmCalls: number;
}

/** Every agent reply seen in this process, for the cross-scenario S8 scan. */
export const globalCorpus: string[] = [];

export async function runScenario(
  scenario: Scenario,
  runIndex: number,
  mode: LlmMode,
): Promise<RunResult> {
  const recorded: string[] = [];
  const inner =
    mode === "live"
      ? new GeminiLLMProvider(convoModel())
      : new RecordedLLM(loadFixture(scenario.id, runIndex));
  const llm = new CountingLLM(inner, mode === "live" ? recorded : undefined);

  const conv = new Conversation({ llm });
  // Panel-open state: the real extension calls start() on open, which sets
  // this. The harness drives send() directly, so set it here — otherwise the
  // phase machine sits in GREETING forever and review/autofill actions that
  // GREETING disallows can never fire. Greeting content is unaffected.
  conv.hasGreeted = true;
  await scenario.setup?.(conv);

  const turns: TurnRec[] = [];
  const checks: CheckRec[] = [];
  const notes: string[] = [];
  let currentTurn = 0;

  const ctx: Ctx = {
    conv,
    turns,
    llmCalls: () => llm.calls,
    check: (name, cond, reason = "") => {
      checks.push({ name, pass: !!cond, reason: cond ? "" : reason, turn: currentTurn });
    },
    note: (line) => notes.push(line),
  };

  let fatal: string | null = null;
  try {
    for (const [i, msg] of scenario.messages.entries()) {
      currentTurn = i + 1;
      const phaseBefore = conv.derived.phase;
      const before = cloneState(conv.state);
      const knownBefore = knownView(conv.state);
      const agentTurn = await conv.send(msg);
      // Pace live runs: the free-tier model quota is per-minute, and an
      // unpaced suite (30+ calls/min with repair bursts) throttles itself
      // into 429s. 4s between turns keeps us under ~15 calls/min.
      // Recorded replays skip the wait (no network involved).
      if (mode === "live") await new Promise((r) => setTimeout(r, 4000));
      const agentText = agentTurn?.text ?? "";
      globalCorpus.push(agentText);
      turns.push({
        n: currentTurn,
        user: msg,
        agent: agentText,
        lang: detectLanguage(agentText).base,
        phaseBefore,
        phaseAfter: conv.derived.phase,
        nextAction: conv.lastAction,
        stateDiff: diffState(before, conv.state),
        missing: [...conv.derived.missing],
        askedAbout: askedAboutField(agentText, knownBefore),
        draftShown: !!agentTurn?.emailDraft,
        gmailUrl: conv.lastGmailUrl,
        reviewShown: !!agentTurn?.review,
      });
    }
    await scenario.assert(ctx);
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
  }

  const failures = checks.filter((c) => !c.pass).map((c) => `T${c.turn} [${c.name}] ${c.reason}`);
  if (fatal) failures.unshift(`fatal: ${fatal}`);
  const passed = failures.length === 0;

  if (mode === "live") saveFixture(scenario.id, runIndex, recorded);
  writeTranscript(scenario, runIndex, mode, turns, checks, notes, passed);
  writeRow({
    id: scenario.id, title: scenario.title, hard: scenario.hard, run: runIndex,
    mode, passed, checks, failures, turns: turns.length, llmCalls: llm.calls,
  });

  return {
    id: scenario.id, title: scenario.title, hard: scenario.hard, run: runIndex,
    mode, passed, checks, failures, turns: turns.length, llmCalls: llm.calls,
  };
}

export function writeTranscript(
  scenario: Scenario,
  run: number,
  mode: LlmMode,
  turns: TurnRec[],
  checks: CheckRec[],
  notes: string[],
  passed: boolean,
): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const lines: string[] = [
    `# ${scenario.id} ${scenario.title} — run ${run} (${mode}) — ${passed ? "PASS" : "FAIL"}`,
    "",
  ];
  for (const t of turns) {
    lines.push(`Turn ${t.n}`);
    lines.push(`USER:     ${t.user}`);
    lines.push(`AGENT:    ${t.agent}`);
    lines.push(
      `lang: ${t.lang} | phase: ${t.phaseBefore} -> ${t.phaseAfter} | nextAction: ${t.nextAction}`,
    );
    lines.push(`state diff: ${JSON.stringify(t.stateDiff)}`);
    lines.push(`missing: [${t.missing.join(", ")}]`);
    const turnChecks = checks.filter((c) => c.turn === t.n);
    const verdict =
      turnChecks.length === 0
        ? ""
        : turnChecks.every((c) => c.pass)
          ? "PASS"
          : `FAIL (${turnChecks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.reason}`).join("; ")})`;
    lines.push(`asked-about: ${t.askedAbout ?? "-"} | assertions: ${verdict}`);
    if (t.draftShown) lines.push(`draft: shown | gmail: ${t.gmailUrl ?? "(not opened)"}`);
    if (t.reviewShown) lines.push(`review: shown`);
    lines.push("");
  }
  const globalChecks = checks.filter((c) => c.turn === 0);
  if (globalChecks.length > 0 || notes.length > 0) {
    lines.push("Scenario assertions:");
    for (const c of globalChecks) {
      lines.push(`- [${c.pass ? "PASS" : "FAIL"}] ${c.name}${c.pass ? "" : ` — ${c.reason}`}`);
    }
    for (const n of notes) lines.push(`- note: ${n}`);
    lines.push("");
  }
  writeFileSync(join(OUT_DIR, `${scenario.id}-run${run}.md`), lines.join("\n"));
}

export function writeRow(result: RunResult): void {
  mkdirSync(ROWS_DIR, { recursive: true });
  writeFileSync(
    join(ROWS_DIR, `${result.id}-run${result.run}.json`),
    JSON.stringify(result, null, 1),
  );
}

/** Corpus-wide honesty scan (S8): every agent reply across given turns. */
export function scanCorpusForRules(replies: string[]): string[] {
  return replies.filter((r) => statesUnverifiedRule(r));
}
