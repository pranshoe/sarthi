import { useEffect, useRef, useState } from "react";
import type { ChatTurn, EmailDraft, GrievanceState } from "@/shared/types";
import { EmailDraftCard } from "./EmailDraftCard";
import { ReviewCard } from "./ReviewCard";

/**
 * Chat transcript. No language picker here on purpose: the agent mirrors the
 * user's language, so a fixed dropdown would contradict the product (spec 3).
 */
export function Chat({
  history,
  busy,
  onSend,
  onMic,
  recording,
  onOpenGmail,
  onEmailSent,
  gmailFailed,
  reviewState,
  onReviewConfirm,
  onReviewEdit,
}: {
  history: ChatTurn[];
  busy: boolean;
  onSend: (t: string) => void;
  onMic: () => void;
  recording: boolean;
  onOpenGmail: (d: EmailDraft) => void;
  onEmailSent: () => void;
  gmailFailed: boolean;
  reviewState: GrievanceState;
  onReviewConfirm: () => void;
  onReviewEdit: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.length, busy]);

  function submit() {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    if (textRef.current) textRef.current.style.height = "auto";
    onSend(t);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex-1 space-y-3 overflow-y-auto px-3 py-4"
        data-testid="transcript"
      >
        {history.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                t.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2.5 text-[15px] leading-relaxed text-white"
                  : "max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] leading-relaxed text-slate-800 shadow-sm"
              }
            >
              <span className="whitespace-pre-wrap break-words">{t.text}</span>
              {t.english && t.english !== t.text && (
                <span className="mt-2 block border-t border-dashed border-slate-300 pt-2 text-[13px] text-slate-500">
                  EN: {t.english}
                </span>
              )}
              {t.emailDraft && (
                <EmailDraftCard
                  draft={t.emailDraft}
                  gmailFailed={gmailFailed}
                  onOpenGmail={onOpenGmail}
                  onSent={onEmailSent}
                />
              )}
              {t.review && (
                <ReviewCard
                  state={reviewState}
                  missing={t.review.missingAtShow}
                  onConfirm={onReviewConfirm}
                  onEdit={onReviewEdit}
                />
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 bg-white px-3 py-3">
        <div className="flex items-end gap-2">
          <button
            onClick={onMic}
            aria-label={recording ? "Stop recording" : "Speak"}
            title={recording ? "Stop" : "Speak (Chrome only)"}
            className={
              recording
                ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
                : "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-lg hover:bg-slate-50"
            }
          >
            {recording ? "■" : "🎤"}
          </button>
          <textarea
            ref={textRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(110, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Tell me what happened…"
            data-testid="composer"
            className="max-h-28 min-h-[44px] flex-1 resize-none overflow-y-auto rounded-2xl border border-slate-200 px-4 py-3 text-[15px] leading-snug outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || busy}
            className="h-11 shrink-0 rounded-2xl bg-brand-600 px-5 font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Speak or type in any language. CAPTCHAs and the final Submit stay with you.
        </p>
      </div>
    </div>
  );
}