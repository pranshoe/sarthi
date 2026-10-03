import { useState } from "react";
import type { GrievanceState } from "@/shared/types";
import { formatHuman } from "@/state/dates";

/**
 * Review card rendered in-chat the same turn the agent says it is reviewing.
 * Pure presentation over live state; the buttons call straight into the
 * Conversation (no LLM turn for either choice).
 */
export function ReviewCard({
  state,
  missing,
  onConfirm,
  onEdit,
}: {
  state: GrievanceState;
  missing: string[];
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const [chosen, setChosen] = useState<"yes" | "edit" | null>(null);

  const rows: Array<[string, string | null]> = [
    ["Entity", state.entityName],
    ["Issue", state.issueSummaryEnglish],
    ["Date", state.incidentDate ? formatHuman(state.incidentDate) : null],
    [
      "Amount",
      state.amountInvolved == null ? null : `INR ${state.amountInvolved.toLocaleString("en-IN")}`,
    ],
    ["Relief", state.reliefSought],
    [
      "Contacted company",
      state.priorContactProof === "none"
        ? "No — will email first"
        : state.priorContactDate ?? null,
    ],
  ];

  return (
    <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3" data-testid="review-card">
      <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-brand-700">
        Please review
      </p>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[13px]">
            <dt className="w-24 shrink-0 text-slate-500">{k}</dt>
            <dd className={v ? "font-medium text-slate-800" : "italic text-slate-400"}>
              {v ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      {missing.length > 0 && (
        <p className="mt-2 text-[12px] text-amber-800">
          Still missing: {missing.join(", ")}
        </p>
      )}
      {chosen === null ? (
        <div className="mt-2 flex gap-2">
          <button
            data-testid="review-confirm"
            onClick={() => {
              setChosen("yes");
              onConfirm();
            }}
            className="flex-1 rounded-lg bg-brand-600 py-2 text-[13px] font-bold text-white"
          >
            Looks right
          </button>
          <button
            data-testid="review-edit"
            onClick={() => {
              setChosen("edit");
              onEdit();
            }}
            className="flex-1 rounded-lg border border-slate-300 bg-white py-2 text-[13px] font-semibold text-slate-700"
          >
            Edit
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-slate-500">
          {chosen === "yes" ? "Confirmed — moving ahead." : "Noted — tell me what to change."}
        </p>
      )}
    </div>
  );
}
