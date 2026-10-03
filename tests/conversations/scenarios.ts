import { declaresReadiness, violatesGuardrails, statesUnverifiedRule } from "@/agent/guardrails";
import { detectLanguage } from "@/agent/detect";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ReviewCard } from "@/sidepanel/ReviewCard";
import { globalCorpus } from "./harness";
import {
  extractProofFromImageBytes,
  extractProofFromPdfBytes,
  flagProofMismatch,
} from "@/portal/ocrProof";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyState } from "@/state/grievanceState";
import type { Scenario } from "./harness";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "samples");

const NO_YEAR_Q = /which year|what year|year\?|kis saal|saal\?|in which year/i;

function asksUserToWriteEnglish(reply: string): boolean {
  const stripped = reply.replace(/i('ll| will)[^.?!]*[.?!]/gi, "");
  return /please write|write it|write (it|this|your)|send me|provide.{0,20}english|english.{0,20}(summary|version) (of|from) (your|you)/i.test(
    stripped,
  );
}

const WAITING_WORDS =
  /waiting period|waiting clock|give them \d+ days|\d+ more days|come back (after|later)|can't file yet/i;

export const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    title: "Greeting gets greeting + invite, no field question",
    hard: false,
    messages: ["hi"],
    assert(ctx) {
      const t = ctx.turns[0]!;
      ctx.check("mentions sarthi", /sarthi/i.test(t.agent), t.agent.slice(0, 120));
      ctx.check(
        "open invite, no interrogation",
        /tell me|what happened|own words|bataiye|start anywhere/i.test(t.agent),
        t.agent.slice(0, 120),
      );
      ctx.check("no field question", t.askedAbout === null, `asked about ${t.askedAbout}`);
      ctx.check("nothing captured yet", ctx.conv.state.entityName === null, "entity set on greet");
    },
  },
  {
    id: "S2",
    title: "Tamil greeting answered in Tamil",
    hard: false,
    messages: ["vanakkam"],
    assert(ctx) {
      const t = ctx.turns[0]!;
      ctx.check("reply in Tamil", detectLanguage(t.agent).base === "ta", t.agent.slice(0, 80));
      ctx.check("no field question", t.askedAbout === null, `asked about ${t.askedAbout}`);
    },
  },
  {
    id: "S3",
    title: "One message fills entity, amount, date, issue, category",
    hard: false,
    messages: ["hi", "Zerodha hasn't paid my sale proceeds of 40,000 rupees since 3rd March"],
    assert(ctx) {
      const s = ctx.conv.state;
      ctx.check("entity", s.entityName === "Zerodha", String(s.entityName));
      ctx.check("amount numeric", s.amountInvolved === 40000, String(s.amountInvolved));
      ctx.check("relief holds no digits", !/[\d,]{4,}/.test(s.reliefSought ?? ""), s.reliefSought ?? "(null)");
      ctx.check("date resolved", s.incidentDate === "2026-03-03", String(s.incidentDate));
      ctx.check("issue captured", !!s.issueSummaryEnglish, "issue missing");
      ctx.check("category inferred", s.complaintCategory === "Non-receipt of funds", String(s.complaintCategory));
      const t = ctx.turns[1]!;
      const asked = new Set(["entityName", "amountInvolved", "incidentDate", "issueSummaryEnglish", "complaintCategory"]);
      ctx.check(
        "next question is about none of them",
        t.askedAbout === null || !asked.has(t.askedAbout),
        `asked about ${t.askedAbout}`,
      );
    },
  },
  {
    id: "S4",
    title: "Regression: August dates, no year/category/summary interrogation",
    hard: false,
    messages: [
      "HI",
      "Zerodha hasn't paid my sale proceeds. I sold 50 Infosys shares on 1st August and the money was due on 4th August",
      "2026",
      "I already told you, the sale was on 1st August 2026 and the money hasn't come",
      "You should be able to tell the category from what I said",
      "Yes continue",
    ],
    assert(ctx) {
      for (const t of ctx.turns) {
        ctx.check(
          `T${t.n} never asks for the year`,
          !NO_YEAR_Q.test(t.agent),
          t.agent.slice(0, 140),
        );
        ctx.check(
          `T${t.n} never asks user to write English`,
          !asksUserToWriteEnglish(t.agent),
          t.agent.slice(0, 140),
        );
        ctx.check(
          `T${t.n} never asks for the category`,
          t.askedAbout !== "complaintCategory",
          `asked about ${t.askedAbout}`,
        );
        if (declaresReadiness(t.agent)) {
          ctx.check(
            `T${t.n} readiness only when nothing missing`,
            t.missing.length === 0,
            `claimed ready with missing=[${t.missing.join(",")}]`,
          );
        }
      }
      const s = ctx.conv.state;
      ctx.check("incident in Aug 2026", /^2026-08-/.test(s.incidentDate ?? ""), String(s.incidentDate));
      ctx.check("category captured", !!s.complaintCategory, "category still null");
      const askedContactOrAmount = ctx.turns.some(
        (t) =>
          t.askedAbout === "priorContact" ||
          t.askedAbout === "amountInvolved" ||
          /contact|wrote|email|amount|how much|rupees|refund/i.test(t.agent),
      );
      ctx.check("asked about contact or amount somewhere", askedContactOrAmount, "neither topic raised");
      ctx.check("never reached AUTOFILL", !ctx.turns.some((t) => t.phaseAfter === "AUTOFILL"), "autofill reached");
    },
  },
  {
    id: "S5",
    title: "HARD gate: claim then denial ends unconfirmed, email offered, never AUTOFILL",
    hard: true,
    messages: ["I have already written to them", "No I didn't"],
    assert(ctx) {
      const s = ctx.conv.state;
      ctx.check("confirmed false", s.priorContactConfirmed === false, String(s.priorContactConfirmed));
      ctx.check("date cleared", s.priorContactDate === null, String(s.priorContactDate));
      ctx.check(
        "phase never AUTOFILL",
        !ctx.turns.some((t) => t.phaseAfter === "AUTOFILL"),
        ctx.turns.map((t) => t.phaseAfter).join(","),
      );
      ctx.check("canAutofill false", ctx.conv.derived.canAutofill === false, "autofill open!");
      const offered = ctx.turns.some(
        (t) => t.nextAction === "draft_email" || /draft/i.test(t.agent),
      );
      ctx.check("email offered", offered, ctx.turns.map((t) => t.agent.slice(0, 80)).join(" | "));
    },
  },
  {
    id: "S6",
    title: "HARD review: card same turn, confirm is free, one follow-up continues",
    hard: true,
    messages: [
      "hi",
      "Zerodha has not credited my 40000 rupees sale proceeds since 3rd March",
      "I want a full refund of the amount",
      "I have not contacted Zerodha about this",
      "Please show me a summary to review",
    ],
    assert(ctx) {
      const reviewTurn = ctx.turns.find((t) => t.reviewShown);
      ctx.check("review card shown", !!reviewTurn, "no turn carried a review card");
      if (reviewTurn) {
        ctx.check(
          "review rendered same turn as reviewing words",
          /review|summary|confirm|read/i.test(reviewTurn.agent),
          reviewTurn.agent.slice(0, 120),
        );
      }
      const r = ctx.conv.getReview();
      ctx.check("review data complete", r.missing.length === 0, `missing=[${r.missing.join(",")}]`);
      ctx.check(
        "review lists the entity",
        r.fields.some((f) => f.value === "Zerodha"),
        JSON.stringify(r.fields.map((f) => f.value)),
      );
      // Static-markup smoke render: the card shows data + both buttons.
      const html = renderToStaticMarkup(
        createElement(ReviewCard, {
          state: ctx.conv.state,
          missing: r.missing,
          onConfirm: () => {},
          onEdit: () => {},
        }),
      );
      ctx.check("card markup shows entity", html.includes("Zerodha"), html.slice(0, 200));
      ctx.check("card markup has both buttons", html.includes("Looks right") && html.includes("Edit"), "buttons missing");
      // "Yes continue" must confirm in code and then continue proactively:
      // the confirmation event itself costs no turn (proven by the mock
      // unit test), and the follow-up moves the flow ahead — never a stall
      // after "Confirmed — moving ahead." The follow-up is one turn; its
      // chat-call count may include single repair passes by design.
      const callsBefore = ctx.llmCalls();
      return ctx.conv.send("Yes continue").then((followUp) => {
        ctx.check("summary confirmed", ctx.conv.summaryConfirmed === true, "not confirmed");
        ctx.check(
          "proactive follow-up turn happened",
          !!followUp && ctx.llmCalls() > callsBefore,
          `${ctx.llmCalls() - callsBefore} call(s)`,
        );
        ctx.check(
          "phase advanced past CONFIRM",
          ctx.conv.derived.phase !== "CONFIRM",
          ctx.conv.derived.phase,
        );
        ctx.check(
          "follow-up drives the contact step",
          !!followUp && /email|draft|wrote|contact|written/i.test(followUp.text),
          (followUp?.text ?? "(no turn)").slice(0, 120),
        );
        ctx.note(`confirm turn phase: ${ctx.conv.derived.phase}`);
      });
    },
  },
  {
    id: "S7",
    title: "Email flow: draft + Gmail same turn, done asks date, date confirms",
    hard: false,
    messages: ["I haven't contacted them", "yes draft it", "Done, I sent it", "yesterday"],
    assert(ctx) {
      const [t0, t1, t2, t3] = ctx.turns;
      ctx.check("draft shown on agree", !!t1?.draftShown, "no draft card on turn 2");
      ctx.check(
        "gmail URL opened same turn",
        !!t1?.gmailUrl && t1.gmailUrl.startsWith("https://mail.google.com/mail/?view=cm"),
        String(t1?.gmailUrl),
      );
      ctx.check("done asks the date", !!t2 && /when|date|yesterday|march/i.test(t2.agent), t2?.agent.slice(0, 120) ?? "(no turn)");
      const s = ctx.conv.state;
      ctx.check("date recorded", !!s.priorContactDate, String(s.priorContactDate));
      ctx.check("confirmed after date", s.priorContactConfirmed === true, String(s.priorContactConfirmed));
      void t0;
      void t3;
    },
  },
  {
    id: "S9",
    title: "Dated contact proceeds to review with no waiting-period talk",
    hard: false,
    messages: [
      "hi",
      "Upstox has not credited my 25000 rupees since 1st June",
      "I want my money back",
      "I emailed them on 10th August 2026",
      "Please show me a summary",
    ],
    assert(ctx) {
      for (const t of ctx.turns) {
        ctx.check(`T${t.n} no waiting talk`, !WAITING_WORDS.test(t.agent), t.agent.slice(0, 140));
      }
      const sawReview = ctx.turns.some((t) => t.reviewShown);
      const leftIntake = ctx.turns.some((t) => t.phaseAfter !== "INTAKE" && t.phaseAfter !== "GREETING");
      ctx.check("proceeded past intake", sawReview || leftIntake, ctx.turns.map((t) => t.phaseAfter).join(","));
    },
  },
  {
    id: "S10",
    title: "State integrity: untouched date stays, explicit correction applies cleanly",
    hard: false,
    messages: ["The weather is nice today", "Actually it was 25,000 rupees"],
    setup(conv) {
      conv.hasGreeted = true;
      conv.state = {
        ...conv.state,
        issueSummaryEnglish: "Funds stuck.",
        issueSummaryOriginal: "Funds stuck.",
        entityName: "Zerodha",
        amountInvolved: 40000,
        priorContactDate: "2026-09-05",
        priorContactProof: "emailed",
        userLanguage: "en-IN",
      };
    },
    assert(ctx) {
      const t1 = ctx.turns[0]!;
      ctx.check(
        "neutral turn leaves contact date alone",
        !("priorContactDate" in t1.stateDiff),
        JSON.stringify(t1.stateDiff),
      );
      const t2 = ctx.turns[1]!;
      ctx.check("amount corrected", ctx.conv.state.amountInvolved === 25000, String(ctx.conv.state.amountInvolved));
      const s = ctx.conv.state;
      ctx.check(
        "contact fields untouched by the correction",
        s.priorContactDate === "2026-09-05" && s.priorContactProof === "emailed",
        `date=${s.priorContactDate} proof=${s.priorContactProof}`,
      );
      ctx.check(
        "nothing else spuriously changed",
        !("entityName" in t2.stateDiff) &&
          !("incidentDate" in t2.stateDiff) &&
          !("issueSummaryEnglish" in t2.stateDiff),
        JSON.stringify(t2.stateDiff),
      );
    },
  },
  {
    id: "S11",
    title: "Ask limits: ignored client ID is skipped on the third turn, never a 4th",
    hard: false,
    messages: [
      "hi",
      "Groww has not credited my 15000 rupees since 9th May, I want a refund",
      "I have not contacted Groww about this",
      "yes draft it",
      "??",
      "??",
      "??",
      "??",
    ],
    assert(ctx) {
      const s = ctx.conv.state;
      ctx.check("client ID skipped", s.skippedFields.includes("clientIdFolioNoDpid"), JSON.stringify(s.skippedFields));
      const idAsks = ctx.turns.filter((t) => /client.?id|UCC/i.test(t.agent));
      ctx.check("asked at most 3 times", idAsks.length <= 3, `${idAsks.length} asks`);
      const last = ctx.turns[ctx.turns.length - 1]!;
      ctx.check("moved on", !/client.?id|UCC/i.test(last.agent), last.agent.slice(0, 120));
    },
  },
  {
    id: "S12",
    title: "Language mirror + mid-chat switch",
    hard: false,
    messages: ["mera paisa nahi aaya", "मेरा पैसा नहीं आया", "vanakkam", "my broker is Zerodha"],
    assert(ctx) {
      const [t0, t1, t2, t3] = ctx.turns;
      const d0 = detectLanguage(t0!.agent);
      ctx.check("romanized stays romanized", d0.base === "hi" && d0.latin === true, t0!.agent.slice(0, 80));
      ctx.check("no devanagari in romanized reply", !/[\u0900-\u097F]/.test(t0!.agent), "");
      ctx.check("devanagari stays devanagari", /[\u0900-\u097F]/.test(t1!.agent), t1!.agent.slice(0, 80));
      ctx.check("tamil stays tamil", detectLanguage(t2!.agent).base === "ta", t2!.agent.slice(0, 80));
      ctx.check("switch to english next reply", detectLanguage(t3!.agent).base === "en", t3!.agent.slice(0, 80));
    },
  },
  {
    id: "S13",
    title: "Mid-flow SCORES question answered, then resumes without repeats",
    hard: false,
    messages: ["hi", "Zerodha took my money", "What is SCORES?"],
    assert(ctx) {
      const t = ctx.turns[2]!;
      ctx.check("answers the question", /government|SEBI|portal/i.test(t.agent), t.agent.slice(0, 120));
      ctx.check("asks nothing already known", t.askedAbout === null || t.askedAbout === "issueSummaryEnglish", `asked about ${t.askedAbout}`);
    },
  },
  {
    id: "S14",
    title: "Anger gets one short neutral acknowledgement, then forward motion",
    hard: false,
    messages: ["hi", "I am so angry!!!", "Zerodha took my 5000 rupees"],
    assert(ctx) {
      const t = ctx.turns[1]!;
      ctx.check("short reply", t.agent.length <= 280, `${t.agent.length} chars`);
      ctx.check("no accusation words", !violatesGuardrails(t.agent), t.agent.slice(0, 120));
      ctx.check("moves forward", ctx.conv.state.entityName === "Zerodha", String(ctx.conv.state.entityName));
    },
  },
  {
    id: "S8",
    title: "HARD no invented rules across all replies",
    hard: true,
    messages: [],
    assert(ctx) {
      const bad = globalCorpus.filter((r) => statesUnverifiedRule(r));
      ctx.check(
        "no invented rules anywhere",
        bad.length === 0,
        bad.slice(0, 3).map((b) => b.slice(0, 120)).join(" // "),
      );
      ctx.note(`scanned ${globalCorpus.length} agent replies`);
    },
  },
  {
    id: "S16",
    title: "Proof OCR extracts ticket, date, client and flags mismatches",
    hard: false,
    messages: [],
    assert: async (ctx) => {
      const pngPath = join(SAMPLES, "sample_email_proof_zerodha.png");
      const pdfPath = join(SAMPLES, "sample_email_proof_zerodha.pdf");
      ctx.check("samples exist", existsSync(pngPath) && existsSync(pdfPath), "run gen_samples.py");
      const t0 = Date.now();
      const fromPng = await extractProofFromImageBytes(new Uint8Array(readFileSync(pngPath)));
      const fromPdf = await extractProofFromPdfBytes(new Uint8Array(readFileSync(pdfPath)));
      ctx.note(`extraction took ${Date.now() - t0}ms`);
      for (const [label, proof] of [["png", fromPng], ["pdf", fromPdf]] as const) {
        ctx.check(`${label} ticket 48213`, proof.ticketNumber === "48213", String(proof.ticketNumber));
        ctx.check(`${label} date 2026-08-10`, proof.date === "2026-08-10", String(proof.date));
        ctx.check(`${label} client ZK4821`, proof.clientId === "ZK4821", String(proof.clientId));
      }
      ctx.conv.state = {
        ...emptyState(),
        priorContactTicket: "00000",
        priorContactDate: "2026-09-01",
        clientIdFolioNoDpid: "XX0000",
        userLanguage: "en-IN",
      };
      const flag = flagProofMismatch(ctx.conv.state, fromPdf);
      ctx.check("mismatch flagged", flag.mismatches.length > 0, "no mismatches reported");
      ctx.check("flag names the ticket", /48213/.test(flag.message), flag.message.slice(0, 160));
    },
  },
];
