// #3645 WS5 — pure helpers for the Paystack dispute evidence console.
//
// Kept free of React / supabase so node:test can pin them. The dossier itself is
// assembled and hashed SERVER-SIDE (admin_get_paystack_dispute); nothing here
// builds or edits evidence — it only formats deadlines and serialises the
// server-recorded snapshot for download.

/** Evidence workflow states, in order. Mirrors admin_list_paystack_disputes. */
export const EVIDENCE_STATES = [
  "needs_review",
  "reviewed",
  "exported",
  "submitted_stub",
  "resolved",
];

/**
 * Time left to an internal/provider deadline.
 * Returns { overdue, label } — label is "overdue", "42m", "3h 10m".
 */
export function deadlineCountdown(deadline, now = Date.now()) {
  if (!deadline) return { overdue: false, label: "—" };
  const t = new Date(deadline).getTime();
  if (Number.isNaN(t)) return { overdue: false, label: "—" };
  const ms = t - now;
  if (ms <= 0) return { overdue: true, label: "overdue" };
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return { overdue: false, label: `${mins}m` };
  const hours = Math.floor(mins / 60);
  return { overdue: false, label: `${hours}h ${mins % 60}m` };
}

/** Review/export/submit are only offered while the dispute is still open. */
export function canActOnEvidence(dispute, adminState) {
  const resolved = !!dispute?.is_resolved;
  const reviewed = !!adminState?.evidence_reviewed_at;
  const current = !!adminState?.review_current;
  return {
    canReview: !resolved,
    canExport: reviewed && current,
    canSubmit: !resolved && reviewed && current,
  };
}

/** Stable download filename: the sha prefix ties the file to the audit row. */
export function evidenceFilename(paystackDisputeId, sha256) {
  const id = String(paystackDisputeId || "dispute").replace(/[^a-zA-Z0-9_-]/g, "_");
  const sha = String(sha256 || "").slice(0, 12);
  return `paystack-dispute-${id}-${sha}.json`;
}

/** Pretty JSON of the server-recorded dossier (what was exported, verbatim). */
export function serializeDossier(dossier) {
  return JSON.stringify(dossier ?? {}, null, 2);
}

/** Map RPC error messages to operator-facing copy. */
export function evidenceErrorMessage(err) {
  const msg = err?.message || "";
  if (msg.includes("not_authorized")) return "Admin access required.";
  if (msg.includes("reason_required")) return "A reason is required.";
  if (msg.includes("dispute_not_found")) return "This dispute no longer exists.";
  if (msg.includes("dispute_resolved")) return "Paystack already resolved this dispute.";
  if (msg.includes("past_provider_deadline")) return "Paystack's response deadline has passed.";
  if (msg.includes("review_required")) return "Review the evidence dossier first.";
  if (msg.includes("dossier_changed_since_review"))
    return "The dossier changed since it was reviewed. Review it again.";
  return msg || "Something went wrong. Please try again.";
}
