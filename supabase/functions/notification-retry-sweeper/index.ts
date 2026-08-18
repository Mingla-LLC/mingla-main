// ORCH-0788 — Scheduled retry sweeper for buyer notifications.
//
// Picks up `ticket_order_notifications` rows that hit `failed_retryable`
// during inline-dispatch (transient Resend / Twilio failures) and fires
// the dispatcher again per affected order, respecting exponential backoff.
//
// Triggering: pg_cron job `orch_0788_notification_retry_sweeper` runs
// this function every 5 minutes (substrate Option A from SPEC §8.2).
// Migration `20260527000000_orch_0788_notification_retry_cron.sql`
// configures the schedule.
//
// Auth: service-role bearer only (same gate pattern as
// ticket-confirmation-dispatch). The pg_cron job presents the
// SUPABASE_SERVICE_ROLE_KEY via net.http_post.
//
// Eligible rows (two paths):
//   1. status='failed_retryable' AND attempt_count<3 AND backoff elapsed.
//      Backoff: 2^attempt_count × 60 seconds since updated_at.
//        attempt_count=1 → retry after 2 min
//        attempt_count=2 → retry after 4 min
//        attempt_count=3 → never retried (.lt cap is belt-and-suspenders).
//   2. status='pending' AND created_at older than ORPHAN_PENDING_SECONDS.
//      Catches rows where inline-dispatch silently failed (rare — wrong
//      service-role key, dispatcher 503, network blip between enqueue and
//      fetch). Without this path, pending rows from broken inline-dispatch
//      moments strand forever. Threshold 5 min is comfortably longer than
//      any real inline-dispatch latency (sub-second in normal operation).
//
// Batch cap: 50 distinct orders per sweep. Bounded against thundering herd.
//
// Idempotency: the dispatcher itself handles per-row UNIQUE(idempotency_key)
// protection. The sweeper's only job is to choose WHICH orders to re-dispatch.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  dispatchTicketConfirmation,
  dispatchTicketNotification,
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

import {
  BATCH_LIMIT,
  isEligible,
  MAX_ATTEMPTS,
  type RetryableRow,
} from "./logic.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const supabase = serviceClient();
  const now = new Date();
  const nowMs = now.getTime();

  const { data: rows, error: queryError } = await supabase
    .from("ticket_order_notifications")
    .select(
      "id, order_id, status, attempt_count, updated_at, created_at, next_attempt_at, payload",
    )
    // #2218 — `deferred` joins the sweep. Without it the status is a dead end:
    // nothing else in the system ever re-offers a held message.
    .in("status", ["failed_retryable", "pending", "deferred"])
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (queryError) {
    return jsonResponse(
      { error: "query_failed", detail: queryError.message },
      500,
    );
  }

  const scanned = rows?.length ?? 0;
  const eligible = ((rows ?? []) as RetryableRow[]).filter((row) =>
    isEligible(row, nowMs)
  );
  const waitlistNotificationIds = eligible
    .filter((row) =>
      row.order_id === null &&
      row.payload?.template_key === "waitlist_spot_open"
    )
    .map((row) => row.id);
  const uniqueOrderIds = [...new Set(eligible.map((r) => r.order_id))]
    .filter((orderId): orderId is string => typeof orderId === "string");

  const results: Array<
    {
      orderId?: string;
      notificationId?: string;
      status: "dispatched" | "failed";
      error?: string;
    }
  > = [];

  for (const orderId of uniqueOrderIds) {
    try {
      await dispatchTicketConfirmation(orderId);
      results.push({ orderId, status: "dispatched" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[notification-retry-sweeper] dispatch failed for ${orderId}`,
        message,
      );
      results.push({ orderId, status: "failed", error: message });
    }
  }

  for (const notificationId of waitlistNotificationIds) {
    try {
      await dispatchTicketNotification(notificationId);
      results.push({ notificationId, status: "dispatched" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[notification-retry-sweeper] dispatch failed for notification ${notificationId}`,
        message,
      );
      results.push({ notificationId, status: "failed", error: message });
    }
  }

  return jsonResponse({
    scanned,
    eligible: eligible.length,
    unique_orders: uniqueOrderIds.length,
    unique_notifications: waitlistNotificationIds.length,
    results,
    swept_at: now.toISOString(),
  });
});
