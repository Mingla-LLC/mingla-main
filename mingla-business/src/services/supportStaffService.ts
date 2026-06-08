/**
 * supportStaffService — META-ORCH-1104 Phase 3 (business-app staff console).
 *
 * Staff-side data access for the support inbox. Mirrors the mingla-admin desk
 * (`SupportDeskPage.jsx`) so the phone console and the PC desk share ONE queue
 * and ONE set of lifecycle actions (SPEC §7.1, parity with §6.1):
 *
 *   - `listSupportQueue()`     — reads ALL `support_tickets` via the live
 *                                `is_support_staff()` RLS path (staff/admin see
 *                                all; everyone else sees zero — SPEC §2.7/§3.3).
 *   - `setSupportAvailable()`  — the staffer's on-duty toggle via the
 *                                column-restricted `support_set_available` RPC
 *                                (SPEC §2.7).
 *   - `claimSupportTicket()`   — the `support-claim` edge fn (re-asserts staff
 *                                server-side; seeds the staffer participant via
 *                                the SECURITY DEFINER `claim_support_ticket`).
 *   - `setSupportTicketStatus`/`setSupportTicketPriority` — the
 *                                `support-set-status` edge fn (legal transitions
 *                                only, server-enforced).
 *
 * GRACEFUL DEGRADATION (dispatch requirement): the `support-*` edge fns are NOT
 * deployed yet. Every edge-fn call routes through `invokeSupportFn`, which
 * special-cases a 404 into a clear `{ ok:false, code:'not_deployed' }` result and
 * NEVER throws — exactly the admin desk's posture. The queue read + availability
 * RPC are already live (Phase 0), so the inbox is usable read-only + the toggle
 * works before the edge fns ship.
 *
 * This service THROWS on a genuine DB error for the reads (Prime Directive #5);
 * the edge-fn helpers return a structured result instead of throwing so the UI
 * can show a toast without a crash.
 *
 * Per SPEC §7.1 (Lane C Findings 2.4, 3, 4).
 */

import { supabase } from "./supabase";

/** A support ticket as STAFF see it (all rows, via is_support_staff() RLS). */
export interface SupportQueueTicket {
  id: string;
  requester_user_id: string;
  requester_segment: string;
  subject: string;
  status: string;
  priority: string;
  assigned_staff_id: string | null;
  conversation_id: string;
  brand_id: string | null;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  last_message_at: string;
}

const QUEUE_COLUMNS =
  "id, requester_user_id, requester_segment, subject, status, priority, assigned_staff_id, conversation_id, brand_id, created_at, first_response_at, resolved_at, last_message_at";

/**
 * List the full support queue (newest activity first). RLS returns ALL rows to
 * staff/admin and ZERO rows to everyone else — so a non-staff caller who forces
 * past the hidden console card still reads nothing (SPEC §3.3, T-3.1). Throws on
 * a genuine DB error (never a silent `[]`).
 */
export async function listSupportQueue(): Promise<SupportQueueTicket[]> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(QUEUE_COLUMNS)
    .order("last_message_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SupportQueueTicket[];
}

/**
 * The staffer's on-duty toggle. Writes `available` through the column-restricted
 * `support_set_available(p_available)` RPC (SPEC §2.7) — the staffer may flip
 * ONLY their own `available`; `enabled`/`role` stay admin-only. The RPC RAISEs
 * `not_support_staff` for a non-staff caller, which surfaces as a thrown error.
 * Returns the new value the server persisted.
 */
export async function setSupportAvailable(available: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("support_set_available", {
    p_available: available,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/** Structured edge-fn result — never throws; UI shows a toast on !ok. */
export interface SupportFnResult {
  ok: boolean;
  /** 'not_deployed' (404) | 'forbidden' (403) | 'error' | undefined on ok. */
  code?: "not_deployed" | "forbidden" | "error";
  message?: string;
}

/**
 * Invoke a `support-*` edge fn with graceful degradation. A 404 (fn not deployed
 * yet) becomes `{ ok:false, code:'not_deployed' }`; a 403 becomes
 * `{ ok:false, code:'forbidden' }`; anything else `{ ok:false, code:'error' }`.
 * NEVER throws — the inbox stays usable (read-only) before the fns ship and a
 * non-staff caller's forbidden response is shown, not crashed.
 */
async function invokeSupportFn(
  fnName: string,
  body: Record<string, unknown>,
): Promise<SupportFnResult> {
  try {
    const { data, error } = await supabase.functions.invoke(fnName, { body });
    if (error) {
      const status =
        typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : null;
      if (status === 404) {
        return {
          ok: false,
          code: "not_deployed",
          message:
            "Support actions aren't live yet — the queue is read-only until the support functions ship.",
        };
      }
      if (status === 403) {
        return {
          ok: false,
          code: "forbidden",
          message: "You don't have permission for that.",
        };
      }
      return { ok: false, code: "error", message: error.message };
    }
    const errField = (data as { error?: unknown } | null)?.error;
    if (typeof errField === "string" && errField.length > 0) {
      return { ok: false, code: "error", message: errField };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: "error",
      message: err instanceof Error ? err.message : "Something went wrong.",
    };
  }
}

/**
 * Claim a ticket: assigns the caller as the staffer, flips new→open, and seeds
 * the staffer as a conversation participant (idempotent) — all server-side via
 * the `support-claim` edge fn → `claim_support_ticket` SECURITY DEFINER RPC. The
 * staff id is ALWAYS the verified JWT caller, never a client-supplied id (SPEC
 * §3.2 #6, T-3.5).
 */
export async function claimSupportTicket(
  ticketId: string,
): Promise<SupportFnResult> {
  return invokeSupportFn("support-claim", { ticketId });
}

/** Set a legal status transition (server-enforced legality, SPEC §2.1). */
export async function setSupportTicketStatus(
  ticketId: string,
  status: string,
): Promise<SupportFnResult> {
  return invokeSupportFn("support-set-status", { ticketId, status });
}

/** Set ticket priority (low | normal | high | urgent). */
export async function setSupportTicketPriority(
  ticketId: string,
  priority: string,
): Promise<SupportFnResult> {
  return invokeSupportFn("support-set-status", { ticketId, priority });
}
