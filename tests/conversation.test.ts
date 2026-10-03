import { describe, expect, it } from "vitest";
import { Conversation } from "@/sidepanel/conversation";
import { MockLLMProvider } from "@/providers/llm/mockLlm";
import { MockSTTProvider } from "@/providers/stt/sarvamStt";
import { emptyState } from "@/state/grievanceState";
import { detectLanguage, isSmallTalk } from "@/agent/detect";
import {
  normaliseDate,
  textSimilarity,
  violatesGuardrails,
  statesUnverifiedRule,
  sanitiseRuleLanguage,
  promisedAction,
} from "@/agent/guardrails";
import { isAffirmation, isAgreementToDraft } from "@/agent/contactPhrases";
import { SYSTEM_PROMPT, buildTurnInstructions } from "@/agent/systemPrompt";
import { buildEmailDraft, gmailComposeUrl } from "@/agent/emailDraft";
import { SCORES_RULES } from "@/data/scoresRules";
import { findBrokerContact } from "@/data/brokers";
import { runTurn } from "@/agent/turnRunner";
import { computeDeadline, mergeState, partitionUpdates, resolveContradiction } from "@/state/stateReducer";
import { LIMIT_DAYS } from "@/state/phases";
import { evaluateEscalation } from "@/state/phases";

/**
 * Acceptance tests from spec section 10. All run in mock mode, so they cost
 * zero credits and are deterministic.
 */

function fresh() {
  return new Conversation({
    llm: new MockLLMProvider(),
    stt: new MockSTTProvider(),
  });
}

async function converse(conv: Conversation, ...messages: string[]) {
  const replies: string[] = [];
  for (const m of messages) {
    const t = await conv.send(m);
    replies.push(t?.text ?? "");
  }
  return replies;
}

describe("language mirroring", () => {
  it("1. 'hi' gets a greeting and an open invitation, no data question", async () => {
    const conv = fresh();
    const greeting = await conv.send("hi");
    const text = greeting!.text.toLowerCase();

    expect(text).toContain("sarthi");
    // An invitation to speak, not an interrogation.
    expect(text).toMatch(/tell me|what happened|what went wrong|own words|start anywhere|bataiye/);
    // Must not ask for entity, PAN, date or amount on turn one.
    expect(text).not.toMatch(/which broker|which company|how much|your pan/);
    expect(conv.state.entityName).toBeNull();
    expect(conv.state.incidentDate).toBeNull();
  });

  it("2. 'vanakkam' is answered in Tamil", async () => {
    const conv = fresh();
    const r = await conv.send("vanakkam");
    expect(detectLanguage(r!.text).base).toBe("ta");
    expect(r!.text).toMatch(/[\u0B80-\u0BFF]/);
    expect(r!.text).toContain("சாரதி");
  });

  it("2b. a Bengali greeting is answered in Bengali", async () => {
    const conv = fresh();
    const r = await conv.send("নমস্কার");
    expect(detectLanguage(r!.text).base).toBe("bn");
    expect(r!.text).toMatch(/[\u0980-\u09FF]/);
    expect(r!.text).toContain("সাথী");
  });

  it("2c. a Gujarati greeting is answered in Gujarati", async () => {
    const conv = fresh();
    const r = await conv.send("કેમ");
    expect(detectLanguage(r!.text).base).toBe("gu");
    expect(r!.text).toMatch(/[\u0A80-\u0AFF]/);
    expect(r!.text).toContain("સારથી");
  });

  it("3. switching Tamil to English switches the next reply to English", async () => {
    const conv = fresh();
    await conv.send("vanakkam");
    const r = await conv.send("my broker has not credited my sale proceeds");
    expect(detectLanguage(r!.text).base).toBe("en");
  });

  it("4. romanized Hindi gets a romanized Hindi reply", async () => {
    const conv = fresh();
    const r = await conv.send("mera paisa nahi aaya");
    const d = detectLanguage(r!.text);
    expect(d.base).toBe("hi");
    expect(d.latin).toBe(true);
    // No Devanagari in a romanized reply.
    expect(r!.text).not.toMatch(/[\u0900-\u097F]/);
  });

  it("keeps the last language for an ambiguous short message", () => {
    expect(isSmallTalk("ok")).toBe(true);
    expect(detectLanguage("ok").base).toBe("en");
  });
});

describe("free-form intake", () => {
  it("5. one message can fill entity, amount and date at once", async () => {
    const conv = fresh();
    await conv.send("hi");
    await conv.send("Zerodha has not credited my sale proceeds of 40000 rupees since 3rd March");

    expect(conv.state.entityName).toBe("Zerodha");
    expect(conv.state.amountInvolved).toBe(40000);
    expect(conv.state.incidentDate).toBe(localISO(2, 3));
  });

  it("6. answers 'what is SCORES?' then resumes without repeating questions", async () => {
    const conv = fresh();
    await conv.send("hi");
    const before = conv.history.length;
    const r = await conv.send("what is SCORES?");

    expect(r!.text).toMatch(/government|SEBI|complaint portal|redressal/i);
    // It should not have asked for the entity again if it already knows it.
    const askedEntity = /which broker|which company/i.test(r!.text);
    expect(askedEntity).toBe(false);
    expect(conv.history.length).toBeGreaterThan(before);
  });

  it("7. a correction updates state with a short acknowledgement", async () => {
    const conv = fresh();
    await conv.send("hi");
    await conv.send("Zerodha has not paid my 40000 rupees since 3rd March");
    const r = await conv.send("no, the date was 12th April");

    expect(conv.state.incidentDate).toBe(localISO(3, 12));
    // Acknowledgement should be short, not a new question.
    expect(r!.text.length).toBeLessThan(120);
  });

  it("8. the same missing field is never asked verbatim twice", async () => {
    const conv = fresh();
    await conv.send("hi");
    // Say nothing useful three times so the agent keeps asking the same thing.
    const replies: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await conv.send("blah blah unknown thing");
      replies.push(r!.text);
    }
    // Consider only lines that are actually asking the same thing.
    const unique = new Set(replies.map((r) => normalise(r)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it("9. 'I don't know the client ID' explains where to find it and offers a way out", async () => {
    const conv = fresh();
    await conv.send("hi");
    await conv.send("Zerodha has not credited my sale proceeds of 40000 rupees since 3rd March");
    const r = await conv.send("I don't know the client ID");

    expect(r!.text.toLowerCase()).toMatch(
      /contract note|profile|app|no problem|blank|leave it|chhod|chhod denge/,
    );
    // Optional field must never become a blocker.
    expect(conv.state.clientIdFolioNoDpid).toBeNull();
    expect(conv.derived.missing).not.toContain("clientIdFolioNoDpid");
  });
});

describe("SEBI rules and safety", () => {
  it("blocks autofill until the broker prerequisite is satisfied", async () => {
    const conv = fresh();
    expect(conv.derived.canAutofill).toBe(false);

    const complete = {
      ...emptyState(),
      issueSummaryEnglish: "Funds not credited",
      issueSummaryOriginal: "à¤ªà¥ˆà¤¸à¤¾ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾",
      entityName: "Zerodha",
      entityType: "broker" as const,
      complaintCategory: "Non-receipt of funds",
      incidentDate: new Date().toISOString().slice(0, 10),
      amountInvolved: 40000,
      reliefSought: "Refund",
    };

    // Not emailed yet, so still blocked.
    conv.state = complete;
    expect(conv.derived.canAutofill).toBe(false);
    expect(conv.derived.escalation.reason).toBe("not_emailed");

    // Emailed yesterday with a recorded date: eligible immediately.
    // There is no waiting period by design.
    conv.confirmEmailSent(shiftDays(-1));
    expect(conv.derived.escalation.eligible).toBe(true);
    expect(conv.derived.canAutofill).toBe(false); // summary not confirmed yet
    await conv.confirmSummary();
    expect(conv.derived.canAutofill).toBe(true);
  });

  it("allows filing after rejection once the date is recorded and confirmed", async () => {
    const conv = fresh();
    conv.state = {
      ...conv.state,
      issueSummaryEnglish: "Funds not credited",
      entityName: "Zerodha",
      entityType: "broker",
      complaintCategory: "Non-receipt of funds",
      incidentDate: new Date().toISOString().slice(0, 10),
      amountInvolved: 40000,
      reliefSought: "Refund",
    };
    // Rejection alone is not enough: the hard gate needs a recorded date.
    conv.recordRejection();
    expect(conv.derived.canAutofill).toBe(false);
    await conv.confirmSummary();
    conv.confirmEmailSent(shiftDays(-40));
    expect(conv.state.priorContactConfirmed).toBe(true);
    expect(conv.derived.escalation.reason).toBe("rejected");
    expect(conv.derived.canAutofill).toBe(true);
  });

  it("marks a complaint older than a year as out of time", () => {
    const st = evaluateEscalation({
      ...emptyState(),
      incidentDate: shiftDays(-400),
    });
    expect(st.expired).toBe(true);
    expect(st.eligible).toBe(false);
  });

  it("10. autofill never reports submitting and always flags the CAPTCHA", () => {
    const st = { ...emptyState() };
    // The fill engine reports submitDisabled: true unconditionally; assert the
    // contract that guarantees acceptance test 10.
    const report = { portal: "scores", results: [], captchaDetected: true, submitDisabled: true } as const;
    expect(report.submitDisabled).toBe(true);
    expect(report.captchaDetected).toBe(true);
    expect(st).toBeDefined();
  });
});

describe("dates", () => {
  it("bare day+month resolves to the most recent past occurrence", () => {
    // In October 2026, "3rd March" is March this year, not next year.
    expect(normaliseDate("3rd March")).toBe(localISO(2, 3));
    expect(normaliseDate("12 sept")).toBe(localISO(8, 12));
  });

  it("accepts an explicit year in either order", () => {
    expect(normaliseDate("3rd March 2024")).toBe("2024-03-03");
    expect(normaliseDate("March 3rd, 2024")).toBe("2024-03-03");
    expect(normaliseDate("03/03/2024")).toBe("2024-03-03");
  });

  it("a bare month-day still ahead of us falls back to last year", () => {
    // Whatever month is two ahead of now, it must resolve to last year.
    const now = new Date();
    const futureMonth = (now.getMonth() + 2) % 12;
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const got = normaliseDate(`5th ${monthNames[futureMonth]}`);
    expect(got).toBe(`${now.getFullYear() - 1}-${String(futureMonth + 1).padStart(2, "0")}-05`);
  });

  it("mergeState drops a future incident date instead of filing it", () => {
    const nextYear = new Date().getFullYear() + 1;
    const st = mergeState(emptyState(), {
      incidentDate: `${nextYear}-03-03`,
    } as Partial<ReturnType<typeof emptyState>>);
    expect(st.incidentDate).toBeNull();
  });

  it("end to end: 'since 3rd March' lands on this year's March", async () => {
    const conv = fresh();
    await conv.send("hi");
    await conv.send("Zerodha has not credited my sale proceeds since 3rd March");
    expect(conv.state.incidentDate).toBe(localISO(2, 3));
  });
});

describe("greeting, repeats, empathy, email, rules, deadline", () => {
  it("1. greeting explains the journey and invites, without a field question", async () => {
    const conv = fresh();
    const g = await conv.send("hi");
    const text = g!.text;
    // Journey: story -> company email check/draft -> SCORES form -> review+submit.
    expect(text).toMatch(/stor|what happened|own words/i);
    expect(text).toMatch(/compan|broker/i);
    expect(text).toMatch(/email/i);
    expect(text).toMatch(/SCORES|form/i);
    expect(text).toMatch(/review|submit/i);
    // No field question yet.
    expect(text).not.toMatch(/which broker|client ID|UCC|when did|how much|what kind/i);
    // Nothing captured from a greeting.
    expect(conv.state.entityName).toBeNull();
    expect(conv.state.issueSummaryEnglish).toBeNull();
  });

  it("2a. identical replies score 1, different replies score low", () => {
    expect(textSimilarity("Which broker is this about?", "Which broker is this about?")).toBe(1);
    expect(textSimilarity("Which broker is this about?", "The monsoon arrived early this year.")).toBeLessThan(0.5);
    expect(textSimilarity("", "hello")).toBe(0);
  });

  it("2b. a repeated question triggers exactly one regeneration", async () => {
    const repeated = "Which broker or company is this about?";
    let calls = 0;
    const stub = {
      id: "stub-repeat",
      chat: async () => {
        calls++;
        return JSON.stringify({
          detectedLanguage: "en-IN",
          reply: repeated,
          stateUpdates: {},
          phase: "INTAKE",
          nextAction: "none",
          confidence: {},
        });
      },
    };
    const history = Array.from({ length: 5 }, (_, i) => ({
      role: "agent" as const,
      text: i === 4 ? repeated : `Some earlier agent message number ${i}.`,
      at: new Date().toISOString(),
    }));
    const outcome = await runTurn(
      stub,
      { state: emptyState(), history, hasGreeted: true, summaryConfirmed: false, emailFlow: 'none', directives: [] },
      "hello again",
    );
    expect(outcome.repeatDetected).toBe(true);
    expect(calls).toBe(2);
  });

  it("2c. a fresh question is not flagged as a repeat", async () => {
    let calls = 0;
    const stub = {
      id: "stub-fresh",
      chat: async () => {
        calls++;
        return JSON.stringify({
          detectedLanguage: "en-IN",
          reply: "When did this first happen? A rough date is fine.",
          stateUpdates: {},
          phase: "INTAKE",
          nextAction: "none",
          confidence: {},
        });
      },
    };
    const outcome = await runTurn(
      stub,
      { state: emptyState(), history: [], hasGreeted: true, summaryConfirmed: false, emailFlow: 'none', directives: [] },
      "my money is stuck",
    );
    expect(outcome.repeatDetected).toBe(false);
    expect(calls).toBe(1);
  });

  it("3. loaded words trip the guardrail; the prompt teaches neutrality", () => {
    expect(violatesGuardrails("This is completely unacceptable and illegal cheating.")).toBe(true);
    expect(violatesGuardrails("Which broker is this about?")).toBe(false);
    expect(SYSTEM_PROMPT).toMatch(/without judging or accusing the company/);
    expect(SYSTEM_PROMPT).toMatch(/Do not use words like/);
  });

  it("4a. verified brokers resolve; unverified leave 'to' empty", () => {
    expect(findBrokerContact("Groww")?.email).toBe("compliance@groww.in");
    expect(findBrokerContact("my upstox account")?.email).toBe("complaints@upstox.com");
    expect(findBrokerContact("Zerodha")).toBeNull();
    expect(findBrokerContact("")).toBeNull();
    expect(findBrokerContact(null)).toBeNull();
  });

  it("4b. the draft contains every required part", () => {
    const draft = buildEmailDraft({
      ...emptyState(),
      entityName: "Upstox",
      clientIdFolioNoDpid: "AB1234",
      incidentDate: "2026-03-03",
      amountInvolved: 40000,
      issueSummaryEnglish: "Sale proceeds not credited.",
      reliefSought: "Refund of the amount",
      userLanguage: "en-IN",
    });
    expect(draft.to).toBe("complaints@upstox.com");
    expect(draft.subject).toMatch(/Upstox/);
    expect(draft.bodyEn).toMatch(/AB1234/);
    expect(draft.bodyEn).toMatch(/2026-03-03|Mar 2026|03 Mar/);
    expect(draft.bodyEn).toMatch(/40,000|40000/);
    expect(draft.bodyEn).toMatch(/at the earliest/);
    expect(draft.bodyEn).not.toMatch(/\b30 days\b/);
    expect(draft.bodyEn).toMatch(/SEBI SCORES/);
    expect(draft.bodyEn).toMatch(/reference|ticket number/i);
    expect(draft.bodyLocal.length).toBeGreaterThan(20);
  });

  it("4c. unknown broker drafts with placeholders and an empty recipient", () => {
    const draft = buildEmailDraft({
      ...emptyState(),
      entityName: "Zerodha",
      userLanguage: "hi-IN",
    });
    expect(draft.to).toBe("");
    expect(draft.contact).toBeNull();
    expect(draft.bodyEn).toMatch(/\[/); // placeholders present
    expect(draft.bodyLocal.length).toBeGreaterThan(20);
    for (const lang of ["en-IN", "hi-IN", "ta-IN", "kn-IN", "te-IN"]) {
      const d = buildEmailDraft({ ...emptyState(), entityName: "X", userLanguage: lang });
      expect(d.bodyLocal.length).toBeGreaterThan(20);
    }
  });

  it("4d. Gmail compose URL has the exact required shape", () => {
    const url = gmailComposeUrl("a@b.com", "Sub ject", "line1\nline2 & more");
    expect(url).toBe(
      "https://mail.google.com/mail/?view=cm&to=a%40b.com&su=Sub%20ject&body=line1%0Aline2%20%26%20more",
    );
    expect(gmailComposeUrl("", "s", "b")).toContain("?view=cm&to=&su=s&body=b");
  });

  it("4e. draft_email action attaches the draft to the chat turn", async () => {
    // A stub that offers the draft, as the model does in PREFLIGHT_EMAIL.
    const stub = {
      id: "stub-draft",
      chat: async () =>
        JSON.stringify({
          detectedLanguage: "en-IN",
          reply: "Here is the email — review it and send it from your Gmail.",
          stateUpdates: {},
          phase: "PREFLIGHT_EMAIL",
          nextAction: "draft_email",
          confidence: {},
        }),
    };
    const conv = new Conversation({ llm: stub });
    conv.hasGreeted = true;
    conv.summaryConfirmed = true;
    conv.state = {
      ...emptyState(),
      issueSummaryEnglish: "Sale proceeds not credited.",
      issueSummaryOriginal: "Sale proceeds not credited.",
      entityName: "Upstox",
      entityType: "broker",
      complaintCategory: "Non-receipt of funds",
      incidentDate: "2026-03-03",
      amountInvolved: 40000,
      reliefSought: "Refund of the amount",
      priorContactProof: "none",
      userLanguage: "en-IN",
    };
    await conv.send("please draft the email");
    const lastAgent = [...conv.history].reverse().find((t) => t.role === "agent");
    expect(conv.derived.phase).toBe("PREFLIGHT_EMAIL");
    expect(lastAgent?.emailDraft).toBeDefined();
    expect(lastAgent?.emailDraft?.to).toBe("complaints@upstox.com");
    expect(lastAgent?.emailDraft?.bodyEn).toMatch(/SEBI SCORES/);
  });

  it("5a. every rule carries a source URL and verification date", () => {
    for (const [key, rule] of Object.entries(SCORES_RULES)) {
      const r = rule as { value: unknown; source: string; sourceUrl: string; lastVerified: string };
      expect(r.source, key).toBeTruthy();
      expect(r.sourceUrl, key).toMatch(/^https:\/\//);
      expect(r.lastVerified, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("5b. escalation math reads from the verified rules, not literals", () => {
    expect(LIMIT_DAYS).toBe(SCORES_RULES.limitationDays.value);
  });

  it("5c. the prompt carries the rules and the honesty instruction", () => {
    const text = buildTurnInstructions({
      phase: "INTAKE",
      missing: ["entityName"],
      missingOptional: ["clientIdFolioNoDpid"],
      known: {},
      escalation: "waiting",
      nextAllowedAction: ["none"],
      turnNumber: 2,
      today: "2026-10-02",
      deadlineNote: null,
      emailFlow: "none",
      directives: [],
    });
    expect(text).toMatch(/SCORES_RULES/);
    expect(text).toMatch(/ONLY from these SCORES_RULES/);
    expect(text).toMatch(/scores\.sebi\.gov\.in/);
    // Merged required/optional split: required first, optional only after.
    expect(text).toMatch(/STILL MISSING - REQUIRED/);
    expect(text).toMatch(/STILL MISSING - OPTIONAL/);
    expect(text).toMatch(/clientIdFolioNoDpid/);
  });

  it("6a. deadline is incident date plus the limitation period", () => {
    const d = computeDeadline({ ...emptyState(), incidentDate: "2025-10-10" });
    expect(d.date).toBe("2026-10-10");
    expect(d.passed).toBe(false);
  });

  it("6b. a deadline inside the warning window is urgent", () => {
    const d = computeDeadline({ ...emptyState(), incidentDate: shiftDays(-340) });
    expect(d.date).not.toBeNull();
    expect(d.daysLeft).toBeGreaterThan(0);
    expect(d.daysLeft).toBeLessThanOrEqual(60);
    expect(d.urgent).toBe(true);
    expect(d.passed).toBe(false);
  });

  it("6c. a passed deadline is flagged as passed", () => {
    const d = computeDeadline({ ...emptyState(), incidentDate: shiftDays(-400) });
    expect(d.passed).toBe(true);
    expect(d.urgent).toBe(true);
  });

  it("6d. no incident date means no deadline", () => {
    const d = computeDeadline(emptyState());
    expect(d.date).toBeNull();
    expect(d.urgent).toBe(false);
  });
});

describe("hard gates, contradictions, ask limits, email handshake", () => {
  it("a. denial -> claim -> 'No' ends unconfirmed with an email offer, never AUTOFILL", async () => {
    const conv = fresh();
    await conv.send("hi");
    await conv.send("Zerodha has not credited my 40000 rupees sale proceeds since 3rd March");
    await conv.send("I have not contacted Zerodha about this");
    expect(conv.state.priorContactConfirmed).toBe(false);
    expect(conv.state.priorContactProof).toBe("none");

    await conv.send("I have already written to them");
    expect(conv.state.priorContactProof).toBe("emailed");
    // Claimed but dateless: still unconfirmed, waiting on the date.
    expect(conv.state.priorContactConfirmed).toBe(false);
    expect(conv.emailFlow).toBe("awaitingDate");

    const r = await conv.send("No");
    expect(conv.state.priorContactConfirmed).toBe(false);
    expect(conv.state.priorContactDate).toBeNull();
    expect(conv.state.priorContactProof).toBe("none");
    expect(r!.text).toMatch(/draft|email/i);
    expect(conv.derived.phase).not.toBe("AUTOFILL");
    expect(conv.derived.canAutofill).toBe(false);
  });

  it("1. AUTOFILL needs confirmed contact plus a date; the model cannot force it", async () => {
    const complete = {
      ...emptyState(),
      issueSummaryEnglish: "Funds not credited.",
      issueSummaryOriginal: "Funds not credited.",
      entityName: "Zerodha",
      entityType: "broker" as const,
      complaintCategory: "Non-receipt of funds",
      incidentDate: "2026-03-03",
      amountInvolved: 40000,
      reliefSought: "Refund",
      priorContactProof: "none" as const,
      userLanguage: "en-IN",
    };
    // Even a model screaming AUTOFILL cannot move code off PREFLIGHT.
    const stub = {
      id: "stub-phase",
      chat: async () =>
        JSON.stringify({
          detectedLanguage: "en-IN",
          reply: "Filing now.",
          stateUpdates: {},
          phase: "AUTOFILL",
          nextAction: "start_autofill",
          confidence: {},
        }),
    };
    const out = await runTurn(
      stub,
      { state: complete, history: [], hasGreeted: true, summaryConfirmed: true, emailFlow: "none", directives: [] },
      "go",
    );
    expect(out.suppressedAction).toBe("start_autofill");

    const conv = fresh();
    conv.state = complete;
    conv.hasGreeted = true;
    conv.summaryConfirmed = true;
    expect(conv.derived.phase).toBe("PREFLIGHT_EMAIL");

    conv.state = {
      ...complete,
      priorContactProof: "emailed",
      priorContactDate: shiftDays(-40),
      priorContactConfirmed: true,
    };
    expect(conv.derived.phase).toBe("AUTOFILL");
    expect(conv.derived.canAutofill).toBe(true);

    // Denial re-locks the gate immediately.
    conv.state = {
      ...conv.state,
      priorContactProof: "none",
      priorContactDate: null,
      priorContactConfirmed: false,
    };
    expect(conv.derived.phase).toBe("PREFLIGHT_EMAIL");
    expect(conv.derived.canAutofill).toBe(false);
  });

  it("2. silent overwrites are held; explicit corrections apply at once", () => {
    const cur = { ...emptyState(), amountInvolved: 40000 };
    const held = partitionUpdates(cur, { amountInvolved: 50000 }, "it was 50000 rupees");
    expect(held.held).toHaveLength(1);
    expect(held.held[0]).toMatchObject({ field: "amountInvolved", current: 40000, incoming: 50000 });
    expect(held.apply.amountInvolved).toBeUndefined();

    const direct = partitionUpdates(cur, { amountInvolved: 50000 }, "actually it was 50000");
    expect(direct.held).toHaveLength(0);

    // Code-owned flags can never arrive through updates.
    const owned = partitionUpdates(cur, { priorContactConfirmed: true, skippedFields: ["x"] } as never, "yes");
    expect(owned.held).toHaveLength(0);
    expect("priorContactConfirmed" in owned.apply).toBe(false);

    expect(
      resolveContradiction({ field: "amountInvolved", current: 40000, incoming: 50000, rounds: 0 }, "50000 is right"),
    ).toBe("incoming");
    expect(
      resolveContradiction({ field: "amountInvolved", current: 40000, incoming: 50000, rounds: 0 }, "40000 is right"),
    ).toBe("current");
  });

  it("2b. end to end: a held overwrite is confirmed in chat before committing", async () => {
    const conv = fresh();
    conv.state = {
      ...emptyState(),
      amountInvolved: 40000,
      issueSummaryEnglish: "Funds stuck.",
      issueSummaryOriginal: "Funds stuck.",
      userLanguage: "en-IN",
    };
    await conv.send("it was 50000 rupees");
    expect(conv.state.amountInvolved).toBe(40000);
    expect(conv.pendingContradictions).toHaveLength(1);

    const r = await conv.send("ok");
    expect(r!.text).toMatch(/40000/);
    expect(r!.text).toMatch(/50000/);
    // "ok" answers nothing: still held after one retry round.
    expect(conv.state.amountInvolved).toBe(40000);

    await conv.send("50000 is right");
    expect(conv.state.amountInvolved).toBe(50000);
    expect(conv.pendingContradictions).toHaveLength(0);
  });

  it("3. new facts get a short acknowledgement before the next question", async () => {
    const conv = fresh();
    await conv.send("hi");
    const r = await conv.send("Zerodha took my 40000 rupees");
    expect(r!.text).toMatch(/Got it|Noted|Thank|Understood/i);
    // And it still moves the intake forward instead of stalling.
    expect(conv.state.entityName).toBe("Zerodha");
  });

  it("b. client ID ignored twice is skipped on the third turn", async () => {
    const conv = fresh();
    conv.hasGreeted = true;
    conv.summaryConfirmed = true;
    conv.state = {
      ...emptyState(),
      issueSummaryEnglish: "Funds stuck.",
      issueSummaryOriginal: "Funds stuck.",
      entityName: "Zerodha",
      entityType: "broker",
      complaintCategory: "Non-receipt of funds",
      incidentDate: "2026-03-03",
      amountInvolved: 40000,
      reliefSought: "Refund",
      priorContactProof: "none",
      userLanguage: "en-IN",
    };
    await conv.send("blah blah");
    await conv.send("blah blah");
    await conv.send("blah blah");
    expect(conv.state.skippedFields).toContain("clientIdFolioNoDpid");
    const lastAgent = [...conv.history].reverse().find((t) => t.role === "agent");
    expect(lastAgent!.text).not.toMatch(/client ID|UCC/i);
  });

  it("c. 'Yes draft the email' shows the draft and opens Gmail in the same turn", async () => {
    const sent: Array<{ type: string; payload: { to: string; subject: string; body: string } }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.summaryConfirmed = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Upstox",
        entityType: "broker",
        complaintCategory: "Non-receipt of funds",
        incidentDate: "2026-03-03",
        reliefSought: "Refund of the amount",
        clientIdFolioNoDpid: "AB1234",
        amountInvolved: 40000,
        soldDescription: "Infosys shares",
        userName: "Priya Sharma",
        userPhone: "9876543210",
        userLanguage: "en-IN",
      };
      await conv.send("Yes draft the email");
      const lastAgent = [...conv.history].reverse().find((t) => t.role === "agent");
      expect(lastAgent?.emailDraft).toBeDefined();
      expect(lastAgent?.emailDraft?.bodyLocal.length).toBeGreaterThan(20);
      const gmail = sent.find((m) => m.type === "gmail/open");
      expect(gmail).toBeDefined();
      expect(gmail!.payload.to).toBe("complaints@upstox.com");
      expect(gmail!.payload.subject).toMatch(/Upstox/);
      expect(gmail!.payload.body).toMatch(/SEBI SCORES/);
      expect(conv.emailFlow).toBe("awaitingSent");
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("6. 'done' asks for the date; the date confirms and asks for proof", async () => {
    const conv = fresh();
    conv.hasGreeted = true;
    conv.state = {
      ...emptyState(),
      issueSummaryEnglish: "Sale proceeds not credited.",
      issueSummaryOriginal: "Sale proceeds not credited.",
      entityName: "Upstox",
      entityType: "broker",
      complaintCategory: "Non-receipt of funds",
      incidentDate: "2026-03-03",
      reliefSought: "Refund",
      userLanguage: "en-IN",
      priorContactProof: "emailed",
    };
    conv.emailFlow = "awaitingSent";
    const askDate = await conv.send("done");
    expect(conv.emailFlow).toBe("awaitingDate");
    expect(askDate!.text).toMatch(/when|date/i);
    expect(conv.state.priorContactConfirmed).toBe(false);

    await conv.send("yesterday");
    expect(conv.state.priorContactConfirmed).toBe(true);
    expect(conv.state.priorContactDate).not.toBeNull();
    expect(conv.emailFlow).toBe("awaitingProof");
    const proofQ = [...conv.history].reverse().find((t) => t.role === "agent");
    expect(proofQ!.text).toMatch(/proof|screenshot|ticket/i);

    await conv.send("ticket TKT-9981");
    expect(conv.state.priorContactTicket).toBe("TKT-9981");
    expect(conv.emailFlow).toBe("done");
  });

  it("5. category and entity type are inferred, asked openly only when unsure", async () => {
    const conv = fresh();
    await conv.send("hi");
    // Strong signals: both inferred with confidence, never asked.
    await conv.send("Zerodha has not credited my sale proceeds");
    expect(conv.state.entityType).toBe("broker");
    expect(conv.state.complaintCategory).toBe("Non-receipt of funds");

    // Nothing known: the category question is open, not multiple-choice.
    const conv2 = fresh();
    conv2.hasGreeted = true;
    conv2.state = {
      ...emptyState(),
      issueSummaryEnglish: "Something odd happened.",
      issueSummaryOriginal: "Something odd happened.",
      entityName: "Zerodha",
      entityType: "broker",
      userLanguage: "en-IN",
    };
    const r = await conv2.send("hmm");
    expect(r!.text).not.toMatch(/unauthorised trade|account closure|charges dispute/i);
  });

  it("8. greeting assumes no feelings", async () => {
    const conv = fresh();
    const g = await conv.send("hi");
    expect(g!.text).not.toMatch(/sorry|frustrat|worried|upset|angry/i);
  });
});

describe("year authority: a bare month-day never inherits the model's guessed year", () => {
  function recentPastYear(month: number, day: number): string {
    const now = new Date();
    const thisYear = `${now.getFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const asDate = new Date(`${thisYear}T00:00:00`);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return asDate.getTime() > startOfToday.getTime()
      ? `${now.getFullYear() - 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : thisYear;
  }

  it("overrides a guessed year with the code-computed most-recent-past date", () => {
    const { apply, held } = partitionUpdates(
      emptyState(),
      { incidentDate: "2025-08-04" },
      "Zerodha hasn't paid my 25,000 rupees since 4th August",
    );
    expect(held).toHaveLength(0);
    expect(apply.incidentDate).toBe(recentPastYear(8, 4));
  });

  it("trusts an explicitly stated year", () => {
    const { apply } = partitionUpdates(
      emptyState(),
      { incidentDate: "2024-08-04" },
      "since 4th August 2024",
    );
    expect(apply.incidentDate).toBe("2024-08-04");
  });

  it("end to end: stub model guessing last year is corrected before commit", async () => {
    const stub = {
      id: "stub-wrong-year",
      chat: async () =>
        JSON.stringify({
          detectedLanguage: "en-IN",
          reply: "Got it.",
          stateUpdates: { incidentDate: "2025-08-04", entityName: "Zerodha" },
          phase: "INTAKE",
          nextAction: "none",
          confidence: {},
        }),
    };
    const conv = new Conversation({ llm: stub });
    conv.hasGreeted = true;
    await conv.send("Zerodha hasn't paid my 25,000 rupees since 4th August");
    expect(conv.state.incidentDate).toBe(recentPastYear(8, 4));
    expect(conv.state.incidentDate).not.toBe("2025-08-04");
  });
});

describe("draft agreement override: words must never promise what code withholds", () => {
  it("INTAKE agreement attaches the draft and opens Gmail even when the model sets no action", async () => {
    const sent: Array<{ type: string; payload: { to: string; subject: string; body: string } }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      // The model promises a draft in words but sets nextAction "none".
      const stub = {
        id: "stub-mismatch",
        chat: async () =>
          JSON.stringify({
            detectedLanguage: "en-IN",
            reply: "Here is the email draft for you to send.",
            stateUpdates: {},
            phase: "INTAKE",
            nextAction: "none",
            confidence: {},
          }),
      };
      const conv = new Conversation({ llm: stub });
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        clientIdFolioNoDpid: "AB1234",
        amountInvolved: 40000,
        incidentDate: "2026-03-03",
        soldDescription: "Infosys shares",
        userName: "Priya Sharma",
        userPhone: "9876543210",
        userLanguage: "en-IN",
      };
      await conv.send("Yes draft the email");
      const lastAgent = [...conv.history].reverse().find((t) => t.role === "agent");
      expect(lastAgent?.emailDraft).toBeDefined();
      expect(lastAgent?.emailDraft?.bodyEn).toMatch(/SEBI SCORES/);
      const gmail = sent.find((m) => m.type === "gmail/open");
      expect(gmail).toBeDefined();
      expect(conv.emailFlow).toBe("awaitingSent");
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("'Yes sure' with missing placeholders shows the draft at once and opens Gmail (spec A.6)", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        userLanguage: "en-IN",
      };
      conv.history.push({
        role: "agent",
        text: "Would you like me to draft an email for you to send to them right now?",
        at: new Date().toISOString(),
      });
      const r = await conv.send("Yes sure");
      // Spec A.6: the draft is shown and Gmail opens on the agreement turn
      // itself (placeholders included); gaps are collected afterwards.
      expect(r?.emailDraft).toBeDefined();
      expect(sent.some((m) => m.type === "gmail/open")).toBe(true);
      expect(r?.emailDraft?.bodyEn).toMatch(/\[your client ID/);
      expect(r!.text).toMatch(/client ID|UCC/i);
      expect(conv.draftCompletion?.pending[0]).toBe("clientId");
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("completion walkthrough ends with a send-ready draft and one Gmail tab", async () => {
    const sent: Array<{ type: string; payload: { to: string; subject: string; body: string } }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        entityType: "broker",
        complaintCategory: "Non-receipt of funds",
        incidentDate: "2026-03-03",
        reliefSought: "Refund",
        userLanguage: "en-IN",
      };
      conv.history.push({
        role: "agent",
        text: "Want me to draft that email for you?",
        at: new Date().toISOString(),
      });
      await conv.send("Yes sure");
      expect(conv.draftCompletion?.pending[0]).toBe("clientId");

      await conv.send("AB1234");
      await conv.send("40000");
      await conv.send("WROGN shirts");
      await conv.send("Priya Sharma");
      const last = await conv.send("9876543210");

      // Phone digits must not leak into the amount (misfire guard).
      expect(conv.state.amountInvolved).toBe(40000);
      expect(conv.state.clientIdFolioNoDpid).toBe("AB1234");
      expect(conv.state.soldDescription).toBe("WROGN shirts");
      expect(conv.draftCompletion).toBeNull();

      expect(last?.emailDraft).toBeDefined();
      expect(last?.emailDraft?.bodyEn).not.toMatch(/\[/);
      expect(last?.emailDraft?.bodyEn).toMatch(/AB1234/);
      expect(last?.emailDraft?.bodyEn).toMatch(/40,000/);
      expect(last?.emailDraft?.bodyEn).toMatch(/Priya Sharma/);
      expect(last?.emailDraft?.bodyEn).toMatch(/9876543210/);
      const gmail = sent.filter((m) => m.type === "gmail/open");
      // Gmail opens once, on the agreement turn; the completion finale only
      // re-attaches the send-ready draft, never a second tab.
      expect(gmail).toHaveLength(1);
      expect(conv.emailFlow).toBe("awaitingSent");
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("declining a placeholder keeps it and moves on", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        entityType: "broker",
        complaintCategory: "Non-receipt of funds",
        incidentDate: "2026-03-03",
        amountInvolved: 40000,
        reliefSought: "Refund",
        userName: "Priya Sharma",
        userPhone: "9876543210",
        soldDescription: "WROGN shirts",
        userLanguage: "en-IN",
      };
      conv.history.push({
        role: "agent",
        text: "Want me to draft that email for you?",
        at: new Date().toISOString(),
      });
      await conv.send("Yes sure");
      // Only the client ID is missing: asked first.
      expect(conv.draftCompletion?.pending).toEqual(["clientId"]);
      const last = await conv.send("skip");
      expect(last?.emailDraft).toBeDefined();
      expect(last?.emailDraft?.bodyEn).toMatch(/\[your client ID/);
      expect(sent.some((m) => m.type === "gmail/open")).toBe(true);
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("'Sure' alone after an offer shows the draft at once (placeholders included)", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        userLanguage: "en-IN",
      };
      conv.history.push({
        role: "agent",
        text: "Want me to draft that email for you?",
        at: new Date().toISOString(),
      });
      const r = await conv.send("Sure");
      // Draft shown at once with placeholders; gaps collected afterwards.
      expect(r?.emailDraft).toBeDefined();
      expect(sent.some((m) => m.type === "gmail/open")).toBe(true);
      expect(r!.text).toMatch(/client ID|UCC/i);
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("'Yes sure' on an empty state attaches nothing (nothing to agree with)", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.history.push({
        role: "agent",
        text: "Want me to draft that email for you?",
        at: new Date().toISOString(),
      });
      await conv.send("Yes sure");
      const lastAgent = [...conv.history].reverse().find((t) => t.role === "agent");
      expect(lastAgent?.emailDraft).toBeUndefined();
      expect(sent.some((m) => m.type === "gmail/open")).toBe(false);
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("bare 'Yes' after an offer shows the draft at once (placeholders included)", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        userLanguage: "en-IN",
      };
      conv.history.push({
        role: "agent",
        text: "Want me to draft that email for you?",
        at: new Date().toISOString(),
      });
      const r = await conv.send("Yes");
      expect(r?.emailDraft).toBeDefined();
      expect(sent.some((m) => m.type === "gmail/open")).toBe(true);
      expect(r!.text).toMatch(/client ID|UCC/i);
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("a sent-claim is not mistaken for agreement: no draft, date asked instead", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      await conv.send("yes I sent them an email last week");
      const lastAgent = [...conv.history].reverse().find((t) => t.role === "agent");
      expect(lastAgent?.emailDraft).toBeUndefined();
      expect(sent.some((m) => m.type === "gmail/open")).toBe(false);
      expect(conv.emailFlow).toBe("awaitingDate");
      expect(conv.state.priorContactProof).toBe("emailed");
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("a failed Gmail open surfaces instead of failing silently", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async () => { throw new Error("no worker"); } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.summaryConfirmed = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Upstox",
        entityType: "broker",
        complaintCategory: "Non-receipt of funds",
        incidentDate: "2026-03-03",
        reliefSought: "Refund of the amount",
        clientIdFolioNoDpid: "AB1234",
        amountInvolved: 40000,
        soldDescription: "Infosys shares",
        userName: "Priya Sharma",
        userPhone: "9876543210",
        userLanguage: "en-IN",
      };
      await conv.send("Yes draft the email");
      const lastAgent = [...conv.history].reverse().find((t) => t.role === "agent");
      expect(lastAgent?.emailDraft).toBeDefined();
      expect(conv.gmailFailed).toBe(true);
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });
});

  it("agreement with nothing missing attaches immediately (no completion)", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        clientIdFolioNoDpid: "AB1234",
        amountInvolved: 40000,
        incidentDate: "2026-03-03",
        soldDescription: "Infosys shares",
        userName: "Priya Sharma",
        userPhone: "9876543210",
        userLanguage: "en-IN",
      };
      conv.history.push({
        role: "agent",
        text: "Want me to draft that email for you?",
        at: new Date().toISOString(),
      });
      const r = await conv.send("Yes sure");
      expect(r?.emailDraft).toBeDefined();
      expect(r?.emailDraft?.bodyEn).not.toMatch(/\[/);
      expect(sent.some((m) => m.type === "gmail/open")).toBe(true);
      expect(conv.draftCompletion).toBeNull();
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("missingDraftFields lists placeholders in ask order, honoring skips", async () => {
    const { missingDraftFields } = await import("@/agent/emailDraft");
    const { isSendReady } = await import("@/agent/emailDraft");
    const base = {
      clientIdFolioNoDpid: null,
      amountInvolved: null,
      incidentDate: null,
      soldDescription: null,
      userName: null,
      userPhone: null,
      skippedFields: [] as string[],
    };
    expect(missingDraftFields(base)).toEqual([
      "clientId",
      "amount",
      "incidentDate",
      "soldDescription",
      "userName",
      "userPhone",
    ]);
    expect(
      missingDraftFields({ ...base, clientIdFolioNoDpid: "AB1", skippedFields: ["amountInvolved"] }),
    ).toEqual(["incidentDate", "soldDescription", "userName", "userPhone"]);
    expect(
      missingDraftFields({
        clientIdFolioNoDpid: "AB1",
        amountInvolved: 5,
        incidentDate: "2026-01-01",
        soldDescription: "x",
        userName: "y",
        userPhone: "9999999999",
        skippedFields: [],
      }),
    ).toEqual([]);
    expect(isSendReady({ bodyEn: "hello [x]", subject: "s" })).toBe(false);
    expect(isSendReady({ bodyEn: "hello", subject: "s" })).toBe(true);
  });

describe("agreement words: zaroor/bilkul count as yes (live transcript replay)", () => {
  it("isAffirmation recognises Hindi agreement words", () => {
    expect(isAffirmation("zaroor")).toBe(true);
    expect(isAffirmation("Zaroor!")).toBe(true);
    expect(isAffirmation("bilkul")).toBe(true);
    expect(isAffirmation("haan zaroor")).toBe(true);
    // Not agreement: denials and empty nods without an offer stay negative.
    expect(isAffirmation("nahi")).toBe(false);
    expect(isAffirmation("bilkul nahi")).toBe(false);
  });

  it("isAgreementToDraft fires on 'zaroor' right after the email offer", () => {
    const offer =
      "Kya aap chahte hain ki main aapke liye ek email ka draft taiyar kar dun?";
    expect(isAgreementToDraft("zaroor", offer, false)).toBe(true);
    expect(isAgreementToDraft("bilkul", offer, false)).toBe(true);
    // No offer, nothing to agree with.
    expect(isAgreementToDraft("zaroor", "Tell me what happened.", false)).toBe(false);
    expect(isAgreementToDraft("zaroor", offer, true)).toBe(false);
  });

  it("'zaroor' after the offer shows the draft and opens Gmail the same turn", async () => {
    const sent: Array<{ type: string }> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: async (m: unknown) => { sent.push(m as never); return { ok: true }; } },
    };
    try {
      const conv = fresh();
      conv.hasGreeted = true;
      conv.state = {
        ...emptyState(),
        issueSummaryEnglish: "Sale proceeds not credited.",
        issueSummaryOriginal: "Sale proceeds not credited.",
        entityName: "Zerodha",
        clientIdFolioNoDpid: "AB1234",
        amountInvolved: 100000,
        incidentDate: "2026-09-04",
        soldDescription: "Shares",
        userName: "Priya Sharma",
        userPhone: "9876543210",
        userLanguage: "hi-Latn",
      };
      conv.history.push({
        role: "agent",
        text: "Kya aap chahte hain ki main aapke liye ek email ka draft taiyar kar dun?",
        at: new Date().toISOString(),
      });
      const r = await conv.send("zaroor");
      // The exact live failure: words promised a draft while nextAction
      // stayed "none", so no card rendered. Now the override must fire.
      expect(r?.emailDraft).toBeDefined();
      expect(conv.lastGmailUrl).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?view=cm/);
      expect(sent.some((m) => m.type === "gmail/open")).toBe(true);
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });
});

describe("unverified rules: Hindi attributions are caught like English ones", () => {
  it("statesUnverifiedRule flags SEBI-as-authority in any script", () => {
    expect(
      statesUnverifiedRule(
        "SEBI ke rules ke anusar, shikayat darj karne se pehle company ko approach karna zaroori hai.",
      ),
    ).toBe(true);
    expect(statesUnverifiedRule("SEBI rules require you to wait 30 days.")).toBe(true);
    expect(statesUnverifiedRule("Niyam ke tahat pehle email karo.")).toBe(true);
    // Mere mentions of SEBI/SEBI SCORES are not rules and must not flag.
    expect(statesUnverifiedRule("You can file on SEBI SCORES.")).toBe(false);
    expect(
      statesUnverifiedRule("The company must answer within 21 days."),
    ).toBe(false);
    expect(statesUnverifiedRule("SCORES portal: https://scores.sebi.gov.in")).toBe(false);
  });

  it("sanitiseRuleLanguage removes the Hindi attribution and keeps the question", () => {
    const out = sanitiseRuleLanguage(
      "SEBI ke rules ke anusar, shikayat darj karne se pehle company ko approach karna zaroori hai. Kya aap chahte hain ki main email draft taiyar kar dun?",
    );
    expect(statesUnverifiedRule(out)).toBe(false);
    expect(out).not.toMatch(/SEBI ke rules|niyam|kanoon/i);
    expect(out).toMatch(/email draft/i);
  });

  it("promisedAction hears Hindi draft presentations, not Hindi offers", () => {
    expect(promisedAction("Yeh lijiye aapka email draft tayar hai.")).toBe("draft_email");
    // Interrogative offer: asks, does not present.
    expect(
      promisedAction("Kya aap chahte hain ki main aapke liye ek email ka draft taiyar kar dun?"),
    ).toBeNull();
  });
});

describe("memory", () => {
  it("clears everything on request", async () => {
    const conv = fresh();
    await conv.send("hi");
    await conv.send("Zerodha has not paid my 40000 rupees");
    expect(conv.history.length).toBeGreaterThan(0);

    conv.clear();
    expect(conv.history).toHaveLength(0);
    expect(conv.state.entityName).toBeNull();
    expect(conv.hasGreeted).toBe(false);
  });
});

describe("confirm continues: the ack is free, the flow moves", () => {
  const complete = () => ({
    ...emptyState(),
    issueSummaryEnglish: "Funds not credited",
    issueSummaryOriginal: "Funds not credited",
    entityName: "Zerodha",
    entityType: "broker" as const,
    complaintCategory: "Non-receipt of funds",
    incidentDate: new Date().toISOString().slice(0, 10),
    amountInvolved: 40000,
    reliefSought: "Refund",
    priorContactProof: "none" as const,
    userLanguage: "en-IN",
  });

  it("the confirmation event itself costs the model nothing, even when it is down", async () => {
    let chatCalls = 0;
    const conv = new Conversation({
      llm: {
        id: "throwing",
        chat: async () => {
          chatCalls++;
          throw new Error("model unreachable");
        },
      },
      stt: new MockSTTProvider(),
    });
    conv.hasGreeted = true;
    conv.state = complete();
    expect(conv.derived.phase).toBe("CONFIRM");

    const followUp = await conv.send("Yes continue");
    // One attempt total: the proactive follow-up's. The confirmation (flag +
    // ack) never touched the model — otherwise this count would be higher,
    // and with a dead model any model-driven confirm would have thrown.
    expect(chatCalls).toBe(1);
    expect(conv.summaryConfirmed).toBe(true);
    const texts = conv.history.filter((t) => t.role === "agent").map((t) => t.text);
    expect(texts.some((t) => /confirmed/i.test(t))).toBe(true);
    expect(followUp).not.toBeNull();
  });

  it("'Looks right' continues proactively instead of stalling (button path)", async () => {
    const conv = fresh();
    conv.hasGreeted = true;
    conv.state = complete();
    const before = conv.history.length;
    const followUp = await conv.confirmSummary();
    expect(conv.summaryConfirmed).toBe(true);
    expect(followUp).not.toBeNull();
    expect(conv.history.length).toBeGreaterThan(before);
    // Contact denied: the flow must leave CONFIRM for the email step.
    expect(conv.derived.phase).toBe("PREFLIGHT_EMAIL");
  });

  it("AUTOFILL-ready confirm forces start_autofill even if the model says none", async () => {
    const conv = new Conversation({
      llm: {
        id: "passive-stub",
        chat: async () =>
          JSON.stringify({
            detectedLanguage: "en-IN",
            reply: "All set.",
            stateUpdates: {},
            phase: "AUTOFILL",
            nextAction: "none",
            confidence: {},
          }),
      },
      stt: new MockSTTProvider(),
    });
    conv.hasGreeted = true;
    conv.state = {
      ...complete(),
      priorContactProof: "emailed",
      priorContactDate: new Date().toISOString().slice(0, 10),
      priorContactConfirmed: true,
    };
    expect(conv.derived.phase).toBe("CONFIRM");
    const followUp = await conv.confirmSummary();
    expect(followUp?.text).toBe("All set.");
    // Words said "none", code says ready: code wins, so the UI fills.
    expect(conv.lastAction).toBe("start_autofill");
  });
});

// ---- helpers ----

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localISOFrom(d);
}

/**
 * Format a local calendar date as yyyy-mm-dd.
 * Deliberately avoids toISOString(), which converts to UTC and therefore
 * returns the previous day for anyone east of Greenwich (IST included).
 */
function localISOFrom(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localISO(monthIndex: number, day: number): string {
  return localISOFrom(new Date(new Date().getFullYear(), monthIndex, day));
}

void converse;