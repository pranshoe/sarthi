import { useEffect, useMemo, useRef, useState } from "react";
import { Conversation, type AgentController } from "./conversation";
import { Chat } from "./Chat";
import { UnderstoodCard } from "./UnderstoodCard";
import { ReviewChecklist } from "./ReviewChecklist";
import { useMic } from "./MicButton";
import { config } from "@/shared/config";
import type { Attachment, EmailDraft, FillReport } from "@/shared/types";

export function App() {
  const conv = useMemo(() => new Conversation(), []);
  const [snap, setSnap] = useState<AgentController>(conv.snapshot);
  const [tab, setTab] = useState<"chat" | "review">("chat");
  const [report, setReport] = useState<FillReport | null>(null);
  const [consent, setConsent] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [spoken, setSpoken] = useState(config.spokenReplies);
  const started = useRef(false);
  // History length the chat-driven autofill already fired for. Guards the
  // edge trigger below against re-firing on every re-render.
  const filledForTurn = useRef(-1);

  useEffect(() => {
    const unsub = conv.subscribe((snap) => {
      setSnap(snap);
      // Chat-driven autofill: when a turn yields start_autofill (only after
      // the user confirmed the review — enforced in code), fill the portal
      // for real instead of just talking about it.
      if (conv.lastAction === "start_autofill" && filledForTurn.current !== snap.history.length) {
        filledForTurn.current = snap.history.length;
        void fill();
      }
    });
    if (!started.current) {
      started.current = true;
      void conv.start();
    }
    return unsub;
  }, [conv]);

  const mic = useMic((text) => void conv.send(text));

  /** Compose tab only. We never touch Gmail's DOM and never send anything. */
  async function openGmail(draft: EmailDraft) {
    try {
      await chrome.runtime.sendMessage({
        type: "gmail/open",
        payload: { to: draft.to, subject: draft.subject, body: draft.bodyEn },
      });
    } catch {
      // Outside the extension (dev server): copy instead of opening.
      try {
        await navigator.clipboard.writeText(
          `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.bodyEn}`,
        );
      } catch {
        /* clipboard unavailable */
      }
    }
  }

  async function addFiles(a: Attachment[]) {
    conv.addAttachments(a);
    // Push them onto the page file input straight away if a portal is open.
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: "portal/fill",
        payload: { state: conv.state },
      });
    }
  }

  async function fill() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) return;
    try {
      const res = (await chrome.tabs.sendMessage(tabs[0].id, {
        type: "portal/fill",
        payload: { state: conv.state },
      })) as { ok: boolean; filled?: FillReport; error?: string };
      if (res.ok && res.filled) setReport(res.filled);
      setTab("review");
    } catch {
      // No content script on this tab: probably not a portal page.
      setReport(null);
    }
  }

  // Only show once something real was captured. An empty card full of
  // "not captured yet" is noise, not progress.
  const s = snap.state;
  const anythingCaptured =
    s.issueSummaryOriginal !== null ||
    s.entityName !== null ||
    s.entityType !== null ||
    s.complaintCategory !== null ||
    s.incidentDate !== null ||
    s.amountInvolved !== null ||
    s.clientIdFolioNoDpid !== null ||
    s.reliefSought !== null;
  const showUnderstood = snap.derived.phase !== "GREETING" && anythingCaptured;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="bg-gradient-to-br from-brand-600 to-violet-600 pt-3 text-white">
        <div className="flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧭</span>
            <div>
              <h1 className="text-[15px] font-bold leading-tight">Sarthi</h1>
              <p className="text-[11px] opacity-90">Resilience Hub</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowSettings((s) => !s)}
              aria-label="Settings"
              className="rounded-lg bg-white/15 px-2 py-1.5 text-[12px]"
            >
              ⋯
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-4 px-3 text-[12px] font-semibold">
          <button
            onClick={() => setTab("chat")}
            className={`border-b-2 pb-2 ${tab === "chat" ? "border-white" : "border-transparent opacity-70"}`}
          >
            Agent
          </button>
          <button
            onClick={() => setTab("review")}
            className={`border-b-2 pb-2 ${tab === "review" ? "border-white" : "border-transparent opacity-70"}`}
          >
            Review
          </button>
        </div>

        {showSettings && (
          <div className="mx-3 mb-3 mt-2 space-y-2 rounded-xl bg-black/20 p-2.5 text-[12px]">
            <label className="flex items-center justify-between gap-2">
              <span>Spoken replies (costs credits)</span>
              <input
                type="checkbox"
                checked={spoken}
                onChange={(e) => {
                  setSpoken(e.target.checked);
                  conv.setSpokenReplies(e.target.checked);
                }}
              />
            </label>
            <div className="text-[11px] opacity-80">
              Mode: {config.mockMode ? "mock, 0 credits" : `live via ${config.llm}`} · proxy
              {config.proxyUrl}
            </div>
            <button
              onClick={() => {
                conv.clear();
                setReport(null);
              }}
              className="w-full rounded-lg bg-white/15 py-1.5 font-semibold"
            >
              Clear my data
            </button>
          </div>
        )}
      </header>

      {!consent && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Sarthi sends what you type or say to an AI model so it can help. Nothing is
          stored on a server.{" "}
          <button onClick={() => setConsent(true)} className="font-bold underline">
            I agree
          </button>
        </div>
      )}

      {snap.error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {snap.error}
        </div>
      )}

      {tab === "chat" ? (
        <>
          <UnderstoodCard state={snap.state} visible={showUnderstood} />
          <Chat
            history={snap.history}
            busy={snap.busy}
            onSend={(t) => void conv.send(t)}
            onMic={mic.toggle}
            recording={mic.recording}
            onOpenGmail={(d) => void openGmail(d)}
            onEmailSent={() => conv.confirmEmailSent()}
            gmailFailed={snap.gmailFailed}
            reviewState={snap.state}
            onReviewConfirm={() => void conv.confirmSummary()}
            onReviewEdit={() => conv.declineSummary()}
          />
          {import.meta.env.DEV && (
            <details className="border-t border-slate-200 bg-slate-900 px-3 py-2 text-[11px] text-green-300">
              <summary className="cursor-pointer font-mono text-slate-300">
                debug · phase {snap.derived.phase} · missing [{snap.derived.missing.join(", ")}] ·
                action {snap.history.filter((t) => t.role === "agent").length > 0 ? conv.lastAction : "none"}
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono">
{JSON.stringify(
  {
    phase: snap.derived.phase,
    missing: snap.derived.missing,
    askCounts: conv.askCounts,
    lastAction: conv.lastAction,
    lastSuppressed: conv.lastSuppressed,
    emailFlow: conv.emailFlow,
    pendingContradictions: conv.pendingContradictions.length,
    rawLLM: conv.lastRaw,
  },
  null,
  1,
)}
              </pre>
            </details>
          )}
          {mic.note && (
            <div className="bg-slate-100 px-3 py-1.5 text-center text-[11.5px] text-slate-600">
              {mic.note}
            </div>
          )}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReviewChecklist
            derived={snap.derived}
            state={snap.state}
            report={report}
            onAddFiles={(a) => void addFiles(a)}
            onFill={() => void fill()}
            busy={snap.busy}
          />
        </div>
      )}
    </div>
  );
}