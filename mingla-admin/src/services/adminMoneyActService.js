/**
 * ORCH-1278 [Admin Money console — WAVE-2 EDIT / ACT] — money act service.
 *
 * Thin wrappers over the ORCH-1271 audited-write seam (adminWriteService) for the
 * four HIGH-risk money actions. Every act is admin-gated + audited server-side:
 *   - refundOrder / connectAction → service_role EDGE FNS (Stripe-touching).
 *   - annotateDispute / grant|revokeOverrideAudited → user-JWT audited RPCs.
 *
 * Money is integer cents throughout — no pre-formatted currency strings cross this
 * boundary (the pages format client-side). READ stays in adminMoneyService.js; this
 * file is WRITE only. Callers surface { error } to the HighRiskActionModal's inline
 * error slot.
 */

import { callAdminWriteRpc, invokeAdminWriteEdge } from "./adminWriteService";

// ── W2-A — refund an order (edge fn; Stripe-touching, CRITICAL) ────────────────

/**
 * Issue a full/partial refund on an order. `lines` = [{ order_line_item_id,
 * quantity, amount_cents }]. The mounted refund intent owns the Idempotency-Key
 * so an uncertain response can be retried against the same DB/provider attempt.
 */
export function createAdminRefundIdempotencyKey() {
  return crypto.randomUUID();
}

export async function refundOrder({ order_id, lines, reason, idempotencyKey }) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new Error("idempotencyKey is required");
  }
  return invokeAdminWriteEdge(
    "admin-refund-order",
    { order_id, lines, reason },
    { idempotencyKey },
  );
}

// ── W2-B — Connect refresh / onboarding link (edge fn; no money) ───────────────

/** mode: 'refresh' | 'onboarding_link' over an EXISTING Connect account. */
export async function connectAction({ brand_id, mode, reason }) {
  return invokeAdminWriteEdge("admin-stripe-connect-action", { brand_id, mode, reason });
}

// ── W2-C — dispute internal note / mark-reviewed (DB-only audited RPC) ─────────

export async function annotateDispute({ dispute_id, note, mark_reviewed, reason }) {
  return callAdminWriteRpc("admin_annotate_dispute", {
    p_dispute_id: dispute_id,
    p_note: note ?? null,
    p_mark_reviewed: !!mark_reviewed,
    p_reason: reason,
  });
}

// ── #3645 WS5 — Paystack dispute evidence (DB-only audited RPCs) ──────────────

/**
 * Human review gate: approves the CURRENT auto-assembled dossier. The client
 * must pass the dossier_sha256 it displayed; the server recomputes and rejects
 * a mismatch so approval cannot bind to an unseen replacement snapshot.
 */
export async function reviewPaystackDisputeEvidence({
  dispute_id,
  note,
  reason,
  expected_dossier_sha256,
}) {
  return callAdminWriteRpc("admin_review_paystack_dispute_evidence", {
    p_dispute_id: dispute_id,
    p_note: note ?? null,
    p_reason: reason,
    p_expected_dossier_sha256: expected_dossier_sha256,
  });
}

/**
 * action: 'export' (record + hand back the reviewed dossier JSON) |
 * 'submit_stub' (record intent; NO Paystack API call is made). Both need a
 * prior review whose sha256 still matches, and append an immutable evidence row.
 */
export async function recordPaystackDisputeEvidenceAction({ dispute_id, action, reason }) {
  return callAdminWriteRpc("admin_record_paystack_dispute_evidence_action", {
    p_dispute_id: dispute_id,
    p_action: action,
    p_reason: reason,
  });
}

// ── W2-D — subscription comp / extend / revoke override (DB-only audited RPCs) ─

/** "Comp"/"extend" Plus. p_expires_at null → base RPC derives from duration_days. */
export async function grantOverrideAudited({ user_id, tier, reason, duration_days = 30, expires_at = null }) {
  return callAdminWriteRpc("admin_grant_override_audited", {
    p_user_id: user_id,
    p_tier: tier,
    p_reason: reason,
    p_duration_days: duration_days,
    p_expires_at: expires_at,
  });
}

export async function revokeOverrideAudited({ override_id, user_id, reason }) {
  return callAdminWriteRpc("admin_revoke_override_audited", {
    p_override_id: override_id,
    p_user_id: user_id,
    p_reason: reason,
  });
}

// ── #4130 Wave 2a — mark "Mingla owes back" settled (DB-only audited RPC) ─────

/**
 * Records that Mingla paid hosts back the transfer fees it held, for every
 * open credit in `currency`. The server records who and when (from the
 * session, never a client field), the reference and the reason, and writes
 * the audit row.
 */
export async function settleOwesBack({ currency, reference, reason }) {
  return callAdminWriteRpc("admin_settle_owes_back", {
    p_currency: currency,
    p_reference: reference,
    p_reason: reason,
  });
}
