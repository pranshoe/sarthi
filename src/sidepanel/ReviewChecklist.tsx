import { useState } from "react";
import type { Attachment, DerivedState, FillReport, GrievanceState } from "@/shared/types";
import { SCORES_RULES } from "@/data/scoresRules";
import { formatHuman } from "@/state/dates";
import { MAX_ATTACHMENT_BYTES, fileToAttachment } from "@/portal/fileAttach";

/**
 * Review checklist. Everything the agent did, plus what it could not do and
 * what is deliberately left to the user.
 */
export function ReviewChecklist({
  derived,
  state,
  report,
  onAddFiles,
  onFill,
  busy,
}: {
  derived: DerivedState;
  state: GrievanceState;
  report: FillReport | null;
  onAddFiles: (a: Attachment[]) => void;
  onFill: () => void;
  busy: boolean;
}) {
  const [err, setErr] = useState<string | null>(null);

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    try {
      const out: Attachment[] = [];
      for (const f of Array.from(files)) out.push(await fileToAttachment(f));
      onAddFiles(out);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const uncertain = Object.entries(derived.confidence)
    .filter(([, v]) => typeof v === "number" && v < 0.7)
    .map(([k]) => k);

  return (
    <div className="space-y-3 px-3 pb-4" data-testid="review">
      {/* Filing deadline. Shown only when it matters: near or passed. */}
      {derived.deadline.urgent && derived.deadline.date && (
        <div
          className={
            derived.deadline.passed
              ? "rounded-xl border border-red-300 bg-red-50 p-3"
              : "rounded-xl border border-amber-300 bg-amber-50 p-3"
          }
          data-testid="deadline-warning"
        >
          <p className="text-[13px] font-bold text-slate-800">
            {derived.deadline.passed
              ? "Filing deadline has passed"
              : `Only ${derived.deadline.daysLeft} days left to file`}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">
            {derived.deadline.passed
              ? `The one-year SCORES window closed on ${formatHuman(derived.deadline.date)}. A complaint filed now will likely be rejected — check with SEBI's helpline (${SCORES_RULES.helpline.value.join(" / ")}) about any other options.`
              : `SCORES accepts complaints for one year from the incident. Yours closes on ${formatHuman(derived.deadline.date)}. Move quickly, and call SEBI's helpline (${SCORES_RULES.helpline.value.join(" / ")}) if you need guidance.`}
          </p>
        </div>
      )}
      {/* Escalation status */}
      <div
        className={
          derived.escalation.expired
            ? "rounded-xl border border-red-200 bg-red-50 p-3"
            : derived.escalation.eligible
              ? "rounded-xl border border-green-200 bg-green-50 p-3"
              : "rounded-xl border border-amber-200 bg-amber-50 p-3"
        }
      >
        <p className="text-[13px] font-semibold text-slate-800">
          {derived.escalation.expired
            ? "Outside the SCORES time limit"
            : derived.escalation.eligible
              ? "You can file on SCORES now"
              : "Waiting period"}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">
          {derived.escalation.message}
        </p>
        {derived.escalation.closesOn && (
          <p className="mt-1 text-[12px] text-slate-500">
            Can file from {formatHuman(derived.escalation.closesOn)}
          </p>
        )}
      </div>

      {derived.blockers.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-slate-50 p-3">
          {derived.blockers.map((b) => (
            <li key={b} className="text-[12.5px] text-slate-600">
              • {b}
            </li>
          ))}
        </ul>
      )}

      {/* Attachments */}
      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <h3 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-slate-500">
          Documents to attach
        </h3>
        <p className="mb-2 text-[11.5px] text-slate-500">
          Most importantly: proof you emailed the company first. Under{" "}
          {MAX_ATTACHMENT_BYTES / 1024 / 1024}MB each. Files stay in memory only.
        </p>
        {state.attachments.length > 0 && (
          <ul className="mb-2 space-y-1">
            {state.attachments.map((a) => (
              <li key={a.name} className="flex items-center gap-2 text-[12.5px] text-slate-700">
                <span>📄</span>
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-slate-400">{(a.size / 1024).toFixed(0)}KB</span>
              </li>
            ))}
          </ul>
        )}
        <input
          type="file"
          accept="application/pdf,image/*"
          multiple
          onChange={(e) => void onPick(e.target.files)}
          className="block w-full text-[12.5px] text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-slate-700"
          data-testid="file-input"
        />
        {err && <p className="mt-1 text-[12px] text-red-600">{err}</p>}
      </section>

      {/* Fill report */}
      {report && (
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">
            On the {report.portal} page
          </h3>
          <ul className="space-y-1">
            {report.results.map((r) => (
              <li key={r.key} className="flex items-start gap-2 text-[12.5px]">
                <span
                  className={
                    r.status === "filled"
                      ? "text-green-600"
                      : r.status === "ambiguous"
                        ? "text-amber-600"
                        : "text-slate-400"
                  }
                >
                  {r.status === "filled" ? "✓" : r.status === "ambiguous" ? "!" : "–"}
                </span>
                <span className="flex-1">
                  <span className="font-medium text-slate-700">{r.key}</span>
                  {r.detail && <span className="block text-slate-500">{r.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg bg-red-50 p-2 text-[12px] text-red-800">
            <strong>Still yours to do:</strong>{" "}
            {(report.captchaDetected ? "Solve the CAPTCHA, then " : "")}review every
            field and click Submit. I never do that for you.
          </div>
        </section>
      )}

      {uncertain.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-3 text-[12.5px] text-amber-900">
          <strong>Please double-check:</strong> {uncertain.join(", ")}
        </div>
      )}

      <button
        onClick={onFill}
        disabled={!derived.canAutofill || busy}
        data-testid="fill-button"
        className="w-full rounded-xl bg-brand-600 py-3 font-bold text-white disabled:bg-slate-300"
      >
        {report ? "Fill again" : "Fill the SCORES form for me"}
      </button>
      {!derived.canAutofill && (
        <p className="text-center text-[11.5px] text-slate-500">
          {derived.missing.length > 0
            ? `Still need: ${derived.missing.join(", ")}`
            : "Finish the steps above first."}
        </p>
      )}
    </div>
  );
}