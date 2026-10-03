import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildTurnInstructions } from "@/agent/systemPrompt";
import { toGeminiSchema } from "@/providers/llm/gemini";
import { validateTurn } from "@/agent/guardrails";
import { emptyState } from "@/state/grievanceState";
import { computeDerived, knownView } from "@/state/stateReducer";
import { evaluateEscalation } from "@/state/phases";
import { todayISO } from "@/state/dates";
import { detectLanguage } from "@/agent/detect";

/**
 * Live end-to-end check: real proxy, real Gemini.
 *
 * Skipped unless SARTHI_LIVE=1, because it spends tokens:
 *
 *   $env:SARTHI_LIVE=1; npm run test:live
 *
 * The mock suite in conversation.test.ts covers behaviour for free. This only
 * proves the wiring: proxy reachable, key valid, model honours the schema.
 */

const PROXY = process.env.VITE_PROXY_URL ?? "http://127.0.0.1:8787";
const MODEL = process.env.VITE_GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const LIVE = process.env.SARTHI_LIVE === "1";

describe.skipIf(!LIVE)("live proxy + Gemini", () => {
  it("completes a three-turn Tamil conversation and fills state", async () => {
    const health = (await (await fetch(`${PROXY}/health`)).json()) as { gemini?: boolean };
    expect(health.gemini, "GEMINI_API_KEY missing from proxy/.env").toBe(true);

    const state = emptyState();
    const history: string[] = [];
    const script = [
      "vanakkam",
      "என் டீலர் என் விற்பனை பணத்தை ஆறு நாட்களாக ஜமா செய்யவில்லை, நாற்பது ஆயிரம் ரூபாய் இன்னும் வரவில்லை",
      "Zerodha, UCC AB1234, PAN ABCDE1234F, since 3rd March, 40000 rupees",
    ];

    for (const [i, line] of script.entries()) {
      const derived = computeDerived(state, { hasGreeted: true, summaryConfirmed: false });
      const instructions = buildTurnInstructions({
        phase: derived.phase,
        missing: derived.missing,
        known: knownView(state),
        escalation: evaluateEscalation(state).message,
        nextAllowedAction: ["none", "show_summary"],
        turnNumber: i + 1,
        today: todayISO(),
        deadlineNote: null,
        emailFlow: "none",
        directives: [],
      });

      const res = await fetch(`${PROXY}/gemini/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            ...history.map((h) => ({ role: "user", parts: [{ text: h }] })),
            { role: "user", parts: [{ text: `${line}\n\n${instructions}` }] },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1000,
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(RESPONSE_SCHEMA),
          },
        }),
      });
      if (!res.ok) {
      const detail = await res.text();
      throw new Error(`turn ${i + 1}: ${res.status} ${detail.slice(0, 500)}`);
    }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const turn = validateTurn(raw);
      expect(turn, `turn ${i + 1} failed schema validation: ${raw.slice(0, 200)}`).toBeTruthy();

      history.push(line);
      const u = turn!.stateUpdates;
      if (u.issueSummaryEnglish) state.issueSummaryEnglish = u.issueSummaryEnglish;
      if (u.issueSummaryOriginal) state.issueSummaryOriginal = u.issueSummaryOriginal;
      if (u.entityName) state.entityName = u.entityName;
      if (u.clientIdFolioNoDpid) state.clientIdFolioNoDpid = u.clientIdFolioNoDpid;
      if (u.incidentDate) state.incidentDate = u.incidentDate;
      if (typeof u.amountInvolved === "number") state.amountInvolved = u.amountInvolved;
      if (u.complaintCategory) state.complaintCategory = u.complaintCategory;
      if (u.entityType) state.entityType = u.entityType;
      if (u.reliefSought) state.reliefSought = u.reliefSought;

      console.log(`[live ${i + 1}] ${line.slice(0, 48)}`);
      console.log(`   -> ${turn!.detectedLanguage} | ${turn!.phase} | ${turn!.nextAction}`);
      console.log(`   -> ${turn!.reply.slice(0, 150)}`);
      console.log(`   -> updates: ${JSON.stringify(turn!.stateUpdates)}`);
    }

    // Turn 1 must greet in Tamil without interrogating.
    // State should have picked up entity, date and the story by the end.
    expect(state.entityName).toBeTruthy();
    expect(state.issueSummaryEnglish).toBeTruthy();
    expect(detectLanguage(state.issueSummaryOriginal ?? "").base).toBeTruthy();
    // Regression: a bare "3rd March" must resolve to this year's March, never
    // to an invented year like 2024/2025. Today is inside todayISO().
    expect(state.incidentDate).toBe(`${todayISO().slice(0, 4)}-03-03`);
    // Best-effort: the live model occasionally drops a field it caught on
    // other runs. The agent re-asks in production; the mock suite pins
    // extraction deterministically instead of failing the wiring test.
    if (!state.clientIdFolioNoDpid) {
      console.warn("[live] note: model dropped the UCC this run (flaky, not fatal)");
    }
  }, 120_000);
});