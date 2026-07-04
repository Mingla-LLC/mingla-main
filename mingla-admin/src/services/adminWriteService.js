/**
 * ORCH-1271 [Admin authorization & audit FOUNDATION] — audited-write service seam.
 *
 * Thin wrappers over the audited-write primitive. Domain consoles (1272/1273/
 * 1274) reuse `callAdminWriteRpc` / `invokeAdminWriteEdge` for their real
 * mutations; every such RPC is itself is_admin_user()-gated + writes
 * admin_audit_log via the admin_write_audit helper (I-ADMIN-WRITE-AUDITED).
 *
 * `runAuditProbe` is the ONLY live call wired in 1271 — it exercises the golden
 * reference RPC `admin_audit_probe`, which writes an admin.audit_probe audit row
 * and mutates NO business data. Each fn returns { data, error }; callers surface
 * `error` to the modal's inline error slot.
 */

import { supabase, invokeWithRefresh } from "../lib/supabase";

/**
 * Golden self-test: round-trips the audited-write primitive end-to-end.
 * Returns { data: <audit_uuid>, error }.
 */
export async function runAuditProbe(reason, note = null) {
  return supabase.rpc("admin_audit_probe", { p_reason: reason, p_note: note });
}

/**
 * Generic gated write-RPC caller (domains reuse). `params` are the RPC's named
 * p_* args. The RPC is expected to guard on is_admin_user() and audit via
 * admin_write_audit. Returns { data, error }.
 */
export async function callAdminWriteRpc(rpcName, params) {
  return supabase.rpc(rpcName, params);
}

/**
 * Generic service_role admin-write edge invoker (domains reuse for Stripe-
 * touching actions). Uses invokeWithRefresh so an idle admin tab's aged JWT is
 * refreshed before the call. Returns { data, error }.
 *
 * `opts.idempotencyKey` (ORCH-1278) attaches an `Idempotency-Key` header — required
 * by the admin-refund-order edge fn so a retried call after a network blip dedupes
 * (the client generates ONE crypto.randomUUID() per refund attempt and reuses it).
 * Backward compatible: 2-arg callers pass no opts and behave unchanged.
 */
export async function invokeAdminWriteEdge(fnName, body, opts = {}) {
  const options = { body };
  if (opts.idempotencyKey) {
    options.headers = { "Idempotency-Key": opts.idempotencyKey };
  }
  return invokeWithRefresh(fnName, options);
}
