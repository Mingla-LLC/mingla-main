// Issue #4420 (step 5) — a reported enquiry opened in the Support inbox: the
// enquiry as chat bubbles (guest left, brand right), who reported it and why,
// with Dismiss and Block everywhere (same calls and the same in-place
// confirmation as before; the logic is lib/reportedEnquiries.js, unchanged).
// Only enquiries a brand or a guest reported ever reach Mingla staff (#4111).
// A reported row is not a Support conversation, so no ticket is made from it.
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { LabelChips } from "./InboxLabels";
import { formatReportedAt, messageAuthorLabel, reporterLabel } from "../../lib/reportedEnquiries";
import { rowLabels } from "../../lib/supportInboxModel";

/**
 * Props: row (reported inbox row), state (reportedEnquiriesReducer state),
 * onClose, onDismiss(id), onAskBlock(id), onCancelBlock(), onConfirmBlock(id).
 */
export function ReportedEnquiryThread({ row, state, onClose, onDismiss, onAskBlock, onCancelBlock, onConfirmBlock }) {
  const e = row.enquiry;
  const busy = state.busy?.id === e.id ? state.busy.kind : null;
  const anyBusy = Boolean(state.busy);
  const confirming = state.confirmBlockId === e.id;
  const error = state.actionError?.id === e.id ? state.actionError.message : null;
  const messages = Array.isArray(e.messages) ? e.messages : [];
  return (
    <aside aria-label="Reported enquiry" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] lg:h-[calc(100vh-180px)]">
      <div className="border-b border-[var(--gray-200)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[var(--color-text-primary)]">{e.guest_name || "Unknown sender"}{e.brand_name ? ` · ${e.brand_name}` : ""}</h3>
            <p className="truncate text-xs text-[var(--color-text-tertiary)]">
              {e.guest_email || "No email"}{e.has_account ? " · Mingla account" : ""} · {formatReportedAt(e.reported_at)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {!confirming ? (
              <>
                <Button size="sm" variant="secondary" loading={busy === "dismiss"} disabled={anyBusy} onClick={() => onDismiss(e.id)}>Dismiss</Button>
                <Button size="sm" variant="danger" disabled={anyBusy} onClick={() => onAskBlock(e.id)}>Block everywhere</Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close reported enquiry" />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5"><LabelChips labels={rowLabels(row)} /></div>
        <p className="mt-2 text-sm text-[var(--color-warning-700)]">{reporterLabel(e.reporter_side)}. Reason: {e.report_reason || "No reason given"}</p>
      </div>

      {confirming ? (
        <div role="alertdialog" aria-label="Confirm block everywhere" className="m-4 rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-3">
          <p className="text-sm font-semibold text-[var(--color-error-700)]">Block {e.guest_name || "this sender"} everywhere?</p>
          <p className="mt-1 text-sm text-[var(--color-error-700)]">
            They won't be able to send an enquiry to any brand on Mingla{e.guest_email ? ` from ${e.guest_email}` : ""}{e.has_account ? " or from their Mingla account" : ""}. This also closes the report.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy === "block"} onClick={() => onCancelBlock()}>Cancel</Button>
            <Button size="sm" variant="danger" loading={busy === "block"} onClick={() => onConfirmBlock(e.id)}>Yes, block everywhere</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mx-4 mt-3 text-sm text-[var(--color-error-700)]">{error}</p> : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">No messages in this enquiry.</p>
        ) : messages.map((m) => {
          const system = m.who === "system";
          if (system) return <p key={m.id} className="text-center text-xs italic text-[var(--color-text-tertiary)]">{m.body}</p>;
          const guest = m.who === "guest";
          return (
            <div key={m.id} className={`flex flex-col ${guest ? "items-start" : "items-end"}`}>
              <span className="mb-0.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">{messageAuthorLabel(m, e)}{m.at ? ` · ${formatReportedAt(m.at)}` : ""}</span>
              <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${guest ? "bg-[var(--gray-100)] text-[var(--color-text-primary)]" : "bg-[var(--color-brand-500)] text-white"}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
