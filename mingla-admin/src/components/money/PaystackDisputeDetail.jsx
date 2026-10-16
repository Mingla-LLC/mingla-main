// #3645 WS5 — Paystack dispute detail + evidence workflow.
//
// Paystack is Mingla's merchant of record, so the evidence clock is Mingla's
// (docs/runbooks/PAYSTACK_DISPUTE_EVIDENCE.md). The dossier is assembled and
// hashed SERVER-SIDE from existing order / ticket / scan / consent / delivery
// data; this view only shows it and drives the human gate:
//   Review (approve current dossier) -> Export JSON | Submit (stub, no provider call).
// Every action is an audited admin RPC that appends an immutable evidence row.

import { useState, useEffect, useCallback, useMemo } from "react";
import { EntityDetailView } from "../entity/EntityDetailView";
import { getPaystackDispute } from "../../services/adminMoneyService";
import {
  reviewPaystackDisputeEvidence,
  recordPaystackDisputeEvidenceAction,
} from "../../services/adminMoneyActService";
import { formatDateTime } from "../../lib/formatters";
import {
  deadlineCountdown,
  canActOnEvidence,
  evidenceFilename,
  serializeDossier,
  evidenceErrorMessage,
} from "../../lib/paystackDisputeEvidence";

function formatMoney(cents, currency) {
  if (cents == null) return "—";
  const code = (currency || "").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)}${code ? ` ${code}` : ""}`;
  }
}

function downloadJson(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so the browser can start consuming the blob for download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const mono = (v) => (v ? <span className="font-mono text-xs break-all">{v}</span> : "—");

function deadlineCell(deadline) {
  const { overdue, label } = deadlineCountdown(deadline);
  return (
    <span className={overdue ? "text-[#b91c1c] font-medium" : "text-[var(--color-text-secondary)]"}>
      {deadline ? `${formatDateTime(deadline)} (${label})` : "—"}
    </span>
  );
}

function buildSections(bundle) {
  const d = bundle.dispute || {};
  const st = bundle.admin_state || {};
  const dossier = bundle.dossier || {};
  const gaps = dossier.evidence_gaps || [];
  const events = bundle.evidence_events || [];

  return [
    {
      label: "Dispute",
      fields: [
        { label: "Paystack dispute id", value: d.paystack_dispute_id, render: mono },
        { label: "Transaction reference", value: d.transaction_reference, render: mono },
        { label: "Amount", render: () => <span className="font-medium">{formatMoney(d.amount_cents, d.currency)}</span> },
        { label: "Status", value: d.status },
        { label: "Resolution", value: d.resolution },
        { label: "Reason", value: d.reason },
        { label: "Brand", value: bundle.brand?.name },
        { label: "Opened", value: d.created_at, render: (v) => formatDateTime(v) },
      ],
    },
    {
      label: "Clock (Mingla owns this — Paystack is merchant of record)",
      fields: [
        { label: "Internal review deadline", render: () => (d.is_resolved ? "—" : deadlineCell(bundle.internal_deadline_at)) },
        { label: "Paystack auto-accept", render: () => (d.is_resolved ? "Resolved" : deadlineCell(d.response_due_by)) },
        { label: "Debt opened", render: () => (d.debt_opened ? "Yes" : "No") },
      ],
    },
    {
      label: "Evidence review",
      fields: [
        { label: "Reviewed", value: st.evidence_reviewed_at, render: (v) => (v ? formatDateTime(v) : "Not reviewed") },
        {
          label: "Review matches current dossier",
          render: () => (st.evidence_reviewed_at ? (st.review_current ? "Yes" : "No — re-review needed") : "—"),
        },
        { label: "Current dossier sha256", value: bundle.dossier_sha256, render: mono },
        { label: "Internal note", value: st.internal_note },
      ],
    },
    {
      label: "Evidence dossier (auto-assembled)",
      fields: [
        { label: "Order", value: dossier.order?.id, render: mono },
        { label: "Buyer", render: () => [dossier.order?.buyer_name, dossier.order?.buyer_email].filter(Boolean).join(" · ") || "—" },
        { label: "Event", value: dossier.event?.title },
        { label: "Tickets issued", render: () => (dossier.tickets || []).length },
        { label: "Scans", render: () => (dossier.scan_events || []).length },
        { label: "Consent records", render: () => (dossier.consent_records || []).length },
        { label: "Delivery records", render: () => (dossier.delivery_records || []).length },
        {
          label: "Gaps to cover manually",
          render: () => (gaps.length ? <span className="text-[#b45309]">{gaps.join(", ")}</span> : "None"),
        },
        {
          label: "Full dossier",
          render: () => (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--color-brand-500)]">Show dossier JSON</summary>
              <pre className="mt-1 overflow-x-auto rounded-md bg-[var(--gray-100)] p-2 text-[11px] leading-relaxed">
                {serializeDossier(dossier)}
              </pre>
            </details>
          ),
        },
      ],
    },
    {
      label: "Evidence log (immutable)",
      fields: [
        {
          label: "",
          render: () =>
            events.length ? (
              <ul className="flex flex-col gap-1 text-xs">
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{e.action}</span>
                    {` · ${formatDateTime(e.created_at)} · ${e.actor_email || "unknown"} · `}
                    <span className="font-mono">{String(e.dossier_sha256).slice(0, 12)}</span>
                    {e.provider_submit_status === "not_sent_stub" ? " · provider: not sent (stub)" : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[var(--color-text-muted)]">No evidence actions yet.</span>
            ),
        },
      ],
    },
  ];
}

export function PaystackDisputeDetail({ disputeId, onBack }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // `silent` refreshes in place after an action so the confirm modal (which
  // lives inside EntityDetailView) is not unmounted mid-flight.
  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setBundle(null);
    }
    setError(null);
    try {
      const { data, error: err } = await getPaystackDispute(disputeId);
      if (err) {
        const msg = err.message || "";
        if (msg.includes("not_authorized")) setError("You are not authorized to view this dispute.");
        else if (msg.includes("not_found")) setError("No Paystack dispute found for this ID.");
        else setError(msg || "Failed to load this dispute.");
      } else {
        setBundle(data);
      }
    } finally {
      setLoading(false);
    }
  }, [disputeId]);

  useEffect(() => {
    load(false);
  }, [load]);

  const actions = useMemo(() => {
    if (!bundle) return [];
    const id = bundle.dispute.id;
    const { canReview, canExport, canSubmit } = canActOnEvidence(bundle.dispute, bundle.admin_state);
    const list = [];
    if (canReview) {
      list.push({
        label: bundle.admin_state?.evidence_reviewed_at ? "Re-review dossier" : "Review & approve dossier",
        title: "Approve evidence dossier",
        description:
          "Confirms a person has read the auto-assembled dossier. Export and submit unlock only while the dossier still matches this review. Moves no money.",
        confirmLabel: "Approve",
        onConfirm: async ({ reason }) => {
          const { error: err } = await reviewPaystackDisputeEvidence({ dispute_id: id, note: null, reason });
          if (err) throw new Error(evidenceErrorMessage(err));
          await load(true);
        },
      });
    }
    if (canExport) {
      list.push({
        label: "Export dossier JSON",
        title: "Export evidence dossier",
        description: "Records exactly what is exported (immutable) and downloads the reviewed dossier as JSON.",
        confirmLabel: "Export",
        onConfirm: async ({ reason }) => {
          const { data, error: err } = await recordPaystackDisputeEvidenceAction({
            dispute_id: id,
            action: "export",
            reason,
          });
          if (err) throw new Error(evidenceErrorMessage(err));
          downloadJson(
            evidenceFilename(bundle.dispute.paystack_dispute_id, data?.dossier_sha256),
            serializeDossier(data?.dossier),
          );
          await load(true);
        },
      });
    }
    if (canSubmit) {
      list.push({
        label: "Submit to Paystack (stub)",
        title: "Record evidence submission",
        description:
          "Records the reviewed dossier as submitted. The Paystack evidence API is not wired yet, so NOTHING is sent to Paystack — upload the exported JSON in the Paystack dashboard before the auto-accept deadline.",
        confirmLabel: "Record submission",
        onConfirm: async ({ reason }) => {
          const { error: err } = await recordPaystackDisputeEvidenceAction({
            dispute_id: id,
            action: "submit_stub",
            reason,
          });
          if (err) throw new Error(evidenceErrorMessage(err));
          await load(true);
        },
      });
    }
    return list;
  }, [bundle, load]);

  const d = bundle?.dispute || {};
  const badges = [];
  if (bundle) {
    badges.push({ label: d.is_resolved ? "resolved" : d.status || "dispute", variant: d.is_resolved ? "default" : "warning" });
    if (bundle.internal_overdue) badges.push({ label: "internal deadline passed", variant: "error" });
  }

  return (
    <EntityDetailView
      loading={loading}
      error={error}
      onRetry={() => load(false)}
      header={{
        title: bundle ? formatMoney(d.amount_cents, d.currency) : "Paystack dispute",
        subtitle: bundle ? <span className="font-mono">{d.paystack_dispute_id}</span> : undefined,
        badges,
        backLabel: "Money ledger",
        onBack,
      }}
      sections={bundle ? buildSections(bundle) : []}
      actions={actions}
    />
  );
}
