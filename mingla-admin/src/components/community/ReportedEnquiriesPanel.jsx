/**
 * #4111 — Reported enquiries (Admin → Community, next to Moderation; #4130 Wave 6).
 *
 * Lists only enquiries the brand or the guest reported (D8). Actions: Dismiss,
 * and Block everywhere (D11), which asks for confirmation inside the row first.
 */

import { useCallback, useEffect, useReducer } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { AlertCard, SectionCard } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import {
  blockEnquirySenderEverywhere,
  dismissEnquiryReport,
  listReportedEnquiries,
} from "../../services/communityService";
import {
  INITIAL_REPORTED_ENQUIRIES_STATE,
  REPORTED_ENQUIRIES_EMPTY_COPY,
  formatReportedAt,
  loadReportedEnquiries,
  messageAuthorLabel,
  reportedEnquiriesReducer,
  reporterLabel,
  runReportedEnquiryAction,
} from "../../lib/reportedEnquiries";

const DEFAULT_SERVICE = Object.freeze({
  listReportedEnquiries,
  dismissEnquiryReport,
  blockEnquirySenderEverywhere,
});

const SUBTITLE = "Only enquiries a brand or a guest reported. Everything else stays private between them.";

function EnquiryMessages({ row }) {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  if (messages.length === 0) {
    return <p className="text-sm text-[var(--color-text-tertiary)]">No messages in this enquiry.</p>;
  }
  return (
    <ol className="space-y-2" aria-label={`Messages in the enquiry from ${row.guest_name || "the guest"}`}>
      {messages.map((message) => (
        <li
          key={message.id}
          className={`rounded-lg px-3 py-2 text-sm ${
            message.who === "guest"
              ? "bg-[var(--gray-50)]"
              : "border border-[var(--gray-200)]"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <span className="font-semibold text-[var(--color-text-primary)]">{messageAuthorLabel(message, row)}</span>
            <span>{message.who === "guest" ? "Guest" : message.who === "system" ? "System" : "Brand"}</span>
            {message.at ? <span>{formatReportedAt(message.at)}</span> : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">{message.body}</p>
        </li>
      ))}
    </ol>
  );
}

function ReportedEnquiryRow({ row, state, onDismiss, onAskBlock, onCancelBlock, onConfirmBlock }) {
  const busy = state.busy?.id === row.id ? state.busy.kind : null;
  const anyBusy = Boolean(state.busy);
  const confirming = state.confirmBlockId === row.id;
  const error = state.actionError?.id === row.id ? state.actionError.message : null;
  return (
    <li className="rounded-xl border border-[var(--gray-200)] p-4" data-enquiry-id={row.id}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">{reporterLabel(row.reporter_side)}</Badge>
            {row.topic_label ? <Badge variant="outline">{row.topic_label}</Badge> : null}
            <span className="text-xs text-[var(--color-text-tertiary)]">{formatReportedAt(row.reported_at)}</span>
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {row.brand_name || "Unknown brand"}
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            From {row.guest_name || "Unknown sender"}
            {row.guest_email ? <span className="text-[var(--color-text-tertiary)]"> · {row.guest_email}</span> : null}
            {row.has_account ? <span className="text-[var(--color-text-tertiary)]"> · Mingla account</span> : null}
          </p>
          <p className="text-sm text-[var(--color-warning-700)]">Reason: {row.report_reason || "No reason given"}</p>
        </div>
        {!confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "dismiss"}
              disabled={anyBusy}
              onClick={() => onDismiss(row.id)}
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={anyBusy}
              onClick={() => onAskBlock(row.id)}
            >
              Block everywhere
            </Button>
          </div>
        ) : null}
      </div>

      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Confirm block everywhere"
          className="mt-3 rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-3"
        >
          <p className="text-sm font-semibold text-[var(--color-error-700)]">
            Block {row.guest_name || "this sender"} everywhere?
          </p>
          <p className="mt-1 text-sm text-[var(--color-error-700)]">
            They won't be able to send an enquiry to any brand on Mingla
            {row.guest_email ? ` from ${row.guest_email}` : ""}
            {row.has_account ? " or from their Mingla account" : ""}. This also closes the report.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy === "block"} onClick={() => onCancelBlock()}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" loading={busy === "block"} onClick={() => onConfirmBlock(row.id)}>
              Yes, block everywhere
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-error-700)]">{error}</p>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-primary)]">
          Messages ({Array.isArray(row.messages) ? row.messages.length : 0})
        </summary>
        <div className="mt-2">
          <EnquiryMessages row={row} />
        </div>
      </details>
    </li>
  );
}

/** Stateless view: every state the panel can be in. */
export function ReportedEnquiriesView({ state, onRetry, onDismiss, onAskBlock, onCancelBlock, onConfirmBlock }) {
  if (state.status === "error") {
    return (
      <AlertCard
        variant="error"
        title="Couldn't load reported enquiries"
        action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}
      >
        {state.loadError || "Something stopped the list from loading."} No report was changed.
      </AlertCard>
    );
  }
  return (
    <SectionCard title="Reported enquiries" subtitle={SUBTITLE}>
      {state.notice ? (
        <p role="status" className="mb-3 text-sm text-[var(--color-success-700)]">{state.notice}</p>
      ) : null}
      {state.status === "loading" ? (
        <div className="flex justify-center py-12" aria-label="Loading reported enquiries"><Spinner /></div>
      ) : state.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{REPORTED_ENQUIRIES_EMPTY_COPY}</p>
      ) : (
        <ul className="space-y-3">
          {state.rows.map((row) => (
            <ReportedEnquiryRow
              key={row.id}
              row={row}
              state={state}
              onDismiss={onDismiss}
              onAskBlock={onAskBlock}
              onCancelBlock={onCancelBlock}
              onConfirmBlock={onConfirmBlock}
            />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function ReportedEnquiriesPanel({ service = DEFAULT_SERVICE, initialState = INITIAL_REPORTED_ENQUIRIES_STATE }) {
  const [state, dispatch] = useReducer(reportedEnquiriesReducer, initialState);
  const load = useCallback(() => loadReportedEnquiries(dispatch, service), [service]);
  useEffect(() => { void load(); }, [load]);

  return (
    <ReportedEnquiriesView
      state={state}
      onRetry={() => void load()}
      onDismiss={(id) => void runReportedEnquiryAction(dispatch, service, { id, kind: "dismiss" })}
      onAskBlock={(id) => dispatch({ type: "ask_block", id })}
      onCancelBlock={() => dispatch({ type: "cancel_block" })}
      onConfirmBlock={(id) => void runReportedEnquiryAction(dispatch, service, { id, kind: "block" })}
    />
  );
}

export default ReportedEnquiriesPanel;
