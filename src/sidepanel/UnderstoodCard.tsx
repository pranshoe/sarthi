import type { GrievanceState } from "@/shared/types";
import { formatHuman } from "@/state/dates";

/**
 * "What I understood" card.
 *
 * Shows the state in English (what goes to the portal) and in the user's own
 * language. The user corrects it by chatting, never by editing a form.
 */
export function UnderstoodCard({
  state,
  visible,
}: {
  state: GrievanceState;
  visible: boolean;
}) {
  if (!visible) return null;

  const rows: Array<[string, string | null]> = [
    ["Entity", state.entityName],
    ["Type", state.entityType],
    ["Category", state.complaintCategory],
    ["Client ID / Folio", state.clientIdFolioNoDpid],
    ["When", state.incidentDate ? formatHuman(state.incidentDate) : null],
    ["Amount", state.amountInvolved ? `₹${state.amountInvolved.toLocaleString("en-IN")}` : null],
    ["What you want", state.reliefSought],
  ];

  return (
    <section
      className="mx-3 mb-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3"
      data-testid="understood-card"
    >
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand-700">
        What I understood
      </h2>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[13px]">
            <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
            <dd className={v ? "font-medium text-slate-800" : "italic text-slate-400"}>
              {v ?? "not captured yet"}
            </dd>
          </div>
        ))}
      </dl>

      {state.issueSummaryEnglish && (
        <div className="mt-3 border-t border-brand-100 pt-2">
          <p className="mb-1 text-[11px] font-semibold text-slate-500">For the portal (English)</p>
          <p className="text-[13px] leading-relaxed text-slate-600">
            {state.issueSummaryEnglish}
          </p>
        </div>
      )}

      <p className="mt-2 text-[11px] text-slate-500">
        Something wrong? Just say so and I&apos;ll change it.
      </p>
    </section>
  );
}