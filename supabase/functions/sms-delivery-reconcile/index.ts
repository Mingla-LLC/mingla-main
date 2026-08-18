// #2218 — sms-delivery-reconcile: the sweep that stops `sent` being a resting
// state for an SMS nobody received. Rationale and the two stall modes it
// distinguishes are in ./logic.ts; this file is the wiring.
//
// AUTH: service-role bearer only, the same gate notification-retry-sweeper
// uses. pg_cron presents SUPABASE_SERVICE_ROLE_KEY via net.http_post.
//
// SCHEDULE: every 15 minutes (migration
// 20270421002218_issue_2218_ng_sms_embargo_and_delivery_truth.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";
import { resolveRuntimeConfigValue } from "../_shared/runtimeConfig.ts";
import { isReconcilableTermiiMessageId } from "../_shared/ngSmsEmbargo.ts";
import {
  classifyTermiiHistoryStatus,
  deadlineVerdict,
  DELIVERY_CONFIRMATION_DEADLINE_MS,
  findHistoryStatus,
  isPastConfirmationDeadline,
  type ReconcileVerdict,
  type StaleSmsRow,
} from "./logic.ts";

const BATCH_LIMIT = 100;

/**
 * Ask Termii what became of one message.
 *
 * Returns `pending` on ANY transport or auth problem. That is deliberate: a
 * failed lookup is an absence of evidence, and converting it into a delivery
 * verdict either way would put a guess into the ledger — which is the whole
 * defect this function exists to end. An unanswerable row simply waits for the
 * deadline, where it becomes an explicit, named terminal state.
 */
async function askTermiiHistory(messageId: string): Promise<ReconcileVerdict> {
  const apiKey = Deno.env.get("TERMII_API_KEY");
  const baseUrl = resolveRuntimeConfigValue("termii_base_url", "TERMII_BASE_URL");
  if (!apiKey || typeof baseUrl !== "string" || !baseUrl) {
    return { kind: "pending" };
  }
  const url = `${baseUrl.replace(/\/$/, "")}/api/sms/inbox?api_key=${
    encodeURIComponent(apiKey)
  }&message_id=${encodeURIComponent(messageId)}`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return { kind: "pending" };
    const payload = await res.json().catch(() => null);
    const status = findHistoryStatus(payload, messageId);
    if (status === null) return { kind: "pending" };
    return classifyTermiiHistoryStatus(status);
  } catch {
    return { kind: "pending" };
  }
}

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
  const deadlineIso = new Date(
    now.getTime() - DELIVERY_CONFIRMATION_DEADLINE_MS,
  ).toISOString();

  // Only rows that CLAIM a completed send and carry no confirmation. A
  // `deferred` row is not stale — it is scheduled, and the retry sweeper owns
  // it. A `delivered` row is finished.
  const { data: rows, error: queryError } = await supabase
    .from("ticket_order_notifications")
    .select("id, provider, provider_message_id, sent_at, recipient, order_id")
    .eq("channel", "sms")
    .eq("status", "sent")
    .is("delivered_at", null)
    .lt("sent_at", deadlineIso)
    .order("sent_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (queryError) {
    return jsonResponse(
      { error: "query_failed", detail: queryError.message },
      500,
    );
  }

  const stale = (rows ?? []) as Array<
    StaleSmsRow & { recipient: string | null; order_id: string | null }
  >;
  let confirmed = 0;
  let failedOut = 0;
  let unreconcilable = 0;
  let stillPending = 0;
  const unreconcilableSamples: string[] = [];

  for (const row of stale) {
    if (!isPastConfirmationDeadline(row, now)) {
      stillPending += 1;
      continue;
    }
    const messageId = row.provider_message_id?.trim() ?? "";
    const askable = row.provider === "termii" &&
      isReconcilableTermiiMessageId(messageId);

    let verdict: ReconcileVerdict = { kind: "pending" };
    if (askable) verdict = await askTermiiHistory(messageId);
    if (verdict.kind === "pending") {
      verdict = deadlineVerdict(row, askable);
    }

    const nowIso = now.toISOString();
    if (verdict.kind === "delivered") {
      await supabase.from("ticket_order_notifications").update({
        status: "delivered",
        delivered_at: nowIso,
        updated_at: nowIso,
      }).eq("id", row.id);
      await supabase.from("notification_deliveries").update({
        status: "delivered",
        delivered_at: nowIso,
      }).eq("provider_message_id", messageId).eq("channel", "sms");
      confirmed += 1;
      continue;
    }

    // Everything else is terminal AND NAMED. `failed_terminal` on the buyer's
    // row and `undelivered` on the shared ledger — the two vocabularies' words
    // for the same fact — so neither table can still be read as a success.
    const reason = verdict.kind === "unreconcilable"
      ? verdict.reason
      : verdict.kind === "failed"
      ? verdict.reason
      : "delivery_unconfirmed";
    await supabase.from("ticket_order_notifications").update({
      status: "failed_terminal",
      last_error: reason,
      updated_at: nowIso,
    }).eq("id", row.id);
    if (messageId.length > 0) {
      await supabase.from("notification_deliveries").update({
        status: "undelivered",
        failed_reason: reason,
      }).eq("provider_message_id", messageId).eq("channel", "sms");
    }
    if (verdict.kind === "unreconcilable") {
      unreconcilable += 1;
      if (unreconcilableSamples.length < 5) {
        unreconcilableSamples.push(messageId);
      }
    } else {
      failedOut += 1;
    }
  }

  // =========================================================================
  // #2218 — AND A HUMAN IS TOLD.
  // =========================================================================
  // The acceptance bar is not "the row is correct", it is "a delivery failure
  // surfaces somewhere a human will see". A corrected row in a table nobody
  // opens is the same silence in a tidier shape. This routes through the SAME
  // ops-email path payout-release-sweep uses for its alarms, keyed per day and
  // per shape so a bad night produces one message rather than a hundred, and
  // NOTHING at all on a clean sweep.
  const surfaced = failedOut + unreconcilable;
  if (surfaced > 0) {
    const dayKey = now.toISOString().slice(0, 10);
    try {
      await dispatchNotification({
        emailTo: "ops@mingla.app",
        emailVariant: "generic_notification",
        type: "sms.delivery_unconfirmed",
        title: "SMS accepted but never confirmed delivered",
        body: `${surfaced} SMS notification(s) were accepted by a provider and ` +
          `never confirmed delivered within ${
            Math.round(DELIVERY_CONFIRMATION_DEADLINE_MS / 60000)
          } minutes. ` +
          `${failedOut} had no delivery confirmation; ${unreconcilable} carried a ` +
          `provider message id our reconciliation cannot look up` +
          (unreconcilableSamples.length > 0
            ? ` (e.g. ${unreconcilableSamples.join(", ")})`
            : "") +
          `. These rows are now failed_terminal, not "sent".`,
        data: {
          day: dayKey,
          unconfirmed: failedOut,
          unreconcilable,
          samples: unreconcilableSamples,
        },
        relatedType: "sms_delivery",
        idempotencyKey: `sms.delivery_unconfirmed:${dayKey}:${surfaced}`,
        skipPush: true,
      });
    } catch (err) {
      // An alert that cannot be sent must still be loud somewhere. Sentry reads
      // console.error from edge functions.
      console.error(
        "[sms-delivery-reconcile] ops alert dispatch failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return jsonResponse({
    scanned: stale.length,
    confirmed,
    failed: failedOut,
    unreconcilable,
    still_pending: stillPending,
    swept_at: now.toISOString(),
  });
});
