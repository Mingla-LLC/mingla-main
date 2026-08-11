// ===========================================================================
// Issue #1791 (SPEC #1788 P-55; DESIGN D-7, D-7a, D-7b, D-7c) — the escalation
// sweep. pg_cron fires this every minute (20270316001791).
//
// THE WHOLE JOB: ask the database which unacknowledged orders have crossed a
// rung, and push the people who can do something about it.
//
//   T+2 min  -> re-push the SAME staff, same collapse id, so the alert gets
//               louder instead of stacking.
//   T+5 min  -> managers + the owner. The guest is told honestly, and their
//               Cancel & refund control is surfaced (it was always there —
//               `venue-order-status` computes `canCancel` from the order's own
//               state, so this rung does not create the way out, it points at
//               it).
//   T+10 min -> ONE final owner alert. Then STOP.
//
// WHAT IT NEVER DOES — each with the correction it comes from:
//   * refund (D-7a): a slow venue is not a failed order, and refunding money
//     out from under a guest who is happily waiting is worse than waiting.
//   * cancel: same reason.
//   * pause the venue's ordering (D-7b): killing a venue's takings over one
//     unread ticket is Mingla making their decision for them. The pause switch
//     lives in their own Orders module.
//   * send an SMS (D-7c): one handset, a cost per message, and the NG rail is
//     dark. `send-venue-sms` stays a guest-facing waitlist tool.
//
// The prohibitions are enforced three ways: the scan RPC's write surface is
// literally two columns; this file imports nothing that can refund or pause;
// and `issue-1791-pause-and-escalation-single-writer.mjs` fails the build if
// either changes.
//
// verify_jwt = false, service-role Bearer REQUIRED in-code — the sweeper
// posture (cron holds the service key; nothing else may call this).
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { jsonResponse, serviceClient } from "../_shared/ticketCheckout.ts";
import {
  type EscalationRung,
  fireVenueOrderEscalation,
} from "../_shared/venueOrderNotify.ts";

interface ScanRow {
  order_id: string;
  brand_id: string;
  venue_id: string;
  venue_name: string;
  rung: number;
  spot_label: string | null;
  pickup_code: string | null;
  buyer_name: string | null;
  currency: string | null;
  total_cents: number;
  placed_at: string;
  unacked_seconds: number;
}

/** Bounded batch — the sweep family's shape (notification-retry-sweeper: 50). */
const BATCH_LIMIT = 50;

// `serviceClient()` returns the UNPINNED supabase-js client while the shared
// notify modules type against the pinned @2.45.4 one — two structurally
// identical classes that TypeScript will not unify because `supabaseUrl` is
// protected. This is the same `type ServiceClient = any` shape every other
// venue-order function uses rather than pinning a second copy of the SDK.
// deno-lint-ignore no-explicit-any
type ServiceClient = any;

function isServiceBearer(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (key.length === 0) return false;
  const header = req.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (presented.length !== key.length) return false;
  // Constant-time-ish compare: no early exit on the first differing byte.
  let diff = 0;
  for (let i = 0; i < key.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ key.charCodeAt(i);
  }
  return diff === 0;
}

serve(wrapEdgeHandler("venue-order-escalation-sweep", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (!isServiceBearer(req)) {
    return jsonResponse({ error: "not_authorized" }, 401);
  }

  const supabase: ServiceClient = serviceClient();
  const { data, error } = await supabase.rpc("pg_venue_order_escalation_scan", {
    p_now: new Date().toISOString(),
    p_limit: BATCH_LIMIT,
  });
  if (error) {
    console.error("[venue-order-escalation-sweep] scan failed", error.message);
    return jsonResponse({ error: "scan_failed" }, 500);
  }

  const rows = (Array.isArray(data) ? data : []) as ScanRow[];
  let notified = 0;
  const failures: string[] = [];

  for (const row of rows) {
    // The rung is already CLAIMED in the database (the scan raised
    // escalation_level in the same statement it returned from), so a push that
    // fails here is a push that is simply lost — it is NOT retried, and that is
    // deliberate. Retrying would mean a rung firing twice for one order, and
    // the next rung is at most five minutes away anyway. A lost push is a
    // logged miss; a duplicated 2am owner alert is a lost owner.
    try {
      await fireVenueOrderEscalation(supabase, {
        orderId: row.order_id,
        brandId: row.brand_id,
        venueId: row.venue_id,
        venueName: row.venue_name,
        rung: Math.min(3, Math.max(1, Number(row.rung))) as EscalationRung,
        unackedSeconds: Number(row.unacked_seconds ?? 0),
        currency: row.currency,
        totalCents: Number(row.total_cents ?? 0),
        spotLabel: row.spot_label,
        pickupCode: row.pickup_code,
        buyerName: row.buyer_name,
      });
      notified += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        "[venue-order-escalation-sweep] rung push failed",
        row.order_id,
        row.rung,
        message,
      );
      failures.push(`${row.order_id}:${row.rung}`);
    }
  }

  return jsonResponse({
    scanned: rows.length,
    notified,
    failed: failures.length,
    failures,
  });
}, {
  onError: (_err, requestId) =>
    jsonResponse({ error: "internal_error", requestId }, 500),
}));
