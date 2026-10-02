import type { EmailDraft } from "@/shared/types";

/**
 * The pre-flight broker email, shown in chat next to the agent's message.
 * English draft (exactly what Gmail compose receives) plus a short
 * explanation in the user's own language. The agent never sends anything:
 * "Open in Gmail" opens a compose tab, "I've sent it" just records the date.
 */
export function EmailDraftCard({
  draft,
  gmailFailed,
  onOpenGmail,
  onSent,
}: {
  draft: EmailDraft;
  gmailFailed: boolean;
  onOpenGmail: (d: EmailDraft) => void;
  onSent: () => void;
}) {
  return (
    <div
      className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3"
      data-testid="email-draft"
    >
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">
        Draft email to the company
      </p>

      <dl className="space-y-1 text-[12.5px]">
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-slate-500">To</dt>
          <dd className="font-medium text-slate-800">
            {draft.to || <span className="italic text-amber-700">(empty — see below)</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-12 shrink-0 text-slate-500">Subject</dt>
          <dd className="font-medium text-slate-800">{draft.subject}</dd>
        </div>
      </dl>

      <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-2.5 font-sans text-[12.5px] leading-relaxed text-slate-700">
        {draft.bodyEn}
      </pre>

      <p className="mt-2 border-t border-dashed border-amber-300 pt-2 text-[12.5px] leading-relaxed text-slate-600">
        {draft.bodyLocal}
      </p>

      {!draft.contact && (
        <p className="mt-2 rounded-lg bg-white p-2 text-[12px] text-amber-800">
          I could not verify this broker&apos;s grievance email, so the To field is
          empty on purpose — I never guess addresses. Please check it on the
          broker&apos;s website before sending.
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onOpenGmail(draft)}
          className="flex-1 rounded-lg bg-brand-600 py-2 text-[13px] font-bold text-white"
        >
          Open in Gmail
        </button>
        <button
          onClick={onSent}
          className="flex-1 rounded-lg border border-slate-300 bg-white py-2 text-[13px] font-semibold text-slate-700"
        >
          I&apos;ve sent it
        </button>
      </div>
      {gmailFailed && (
        <p className="mt-1.5 rounded-lg bg-red-50 p-2 text-center text-[11.5px] text-red-700">
          Gmail did not open automatically — please use the button above.
        </p>
      )}
      <p className="mt-1.5 text-center text-[11px] text-slate-500">
        Review it first. I never send email for you.
      </p>
    </div>
  );
}
