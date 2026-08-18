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
    // #2218 — an already-marked row is not re-examined. `last_error` is the
    // marker an `unverified` verdict leaves behind, and without this filter the
    // sweep would re-alert on the same unverifiable rows every fifteen minutes
    // until the alarm became noise and stopped being read.
    .is("last_error", null)
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
  let unverified = 0;
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

    // `pending` is resolved away HERE, once, into a value whose type no longer
    // admits it — so the branches below cannot silently mishandle a verdict the
    // sweep was never supposed to act on.
    const asked: ReconcileVerdict = askable
      ? await askTermiiHistory(messageId)
      : { kind: "pending" };
    const verdict = asked.kind === "pending"
      ? deadlineVerdict(row, askable)
      : asked;

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

    // =====================================================================
    // #2218 — A FAILURE IS SOMETHING THE PROVIDER SAID. EVERYTHING ELSE IS
    // "WE DO NOT KNOW", AND IT SAYS SO.
    // =====================================================================
    // `failed` only ever comes from a provider status naming a failure, and it
    // is the only arm that writes a terminal state. `unverified` — no answer,
    // or an id no route can look up — writes the REASON while leaving `status`
    // at `sent`, which is exactly and only what is true: a provider accepted
    // this and nobody can tell us what became of it.
    //
    // Stamping those rows `failed_terminal` would be the mirror image of the
    // bug this issue is about. It would also be systematically wrong the moment
    // Nigerian texts start arriving again, because — per the 08:02 WAT
    // live-fire — EVERY Nigerian row currently carries an unreconcilable id,
    // not merely the ones that failed.
    //
    // The row is still distinguishable from a delivered one, which is the
    // acceptance bar: delivered rows carry a `delivered_at` and no
    // `last_error`; these carry a `last_error` and no `delivered_at`. And a
    // human is told either way.
    const reason = verdict.reason;
    if (verdict.kind === "failed") {
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
      failedOut += 1;
      continue;
    }
    await supabase.from("ticket_order_notifications").update({
      last_error: `delivery_unverified:${reason}`,
      updated_at: nowIso,
    }).eq("id", row.id);
    if (messageId.length > 0) {
      await supabase.from("notification_deliveries").update({
        failed_reason: `delivery_unverified:${reason}`,
      }).eq("provider_message_id", messageId).eq("channel", "sms");
    }
    unverified += 1;
    if (
      reason.startsWith("provider_message_id_unreconcilable") &&
      unreconcilableSamples.length < 5 && messageId.length > 0
    ) {
      unreconcilableSamples.push(messageId);
    }
  }

  // =========================================================================
  // #2218 — THE SHARED LEDGER IS SWEPT TOO, NOT ONLY THE TICKET ONE.
  // =========================================================================
  // `ticket_order_notifications` carries buyer confirmations;
  // `notification_deliveries` carries everything notifyV2 sends — RSVP, source
  // refunds, guest notifications. They are different tables, not different
  // views of one, and the ticket dispatcher writes only the first. Sweeping
  // just that one would leave half the SMS in the product able to rest at
  // `sent` forever, which is the same defect with a smaller blast radius —
  // exactly the kind of half-fix that gets rediscovered.
  //
  // Termii rows here have NEVER reached `delivered`: over the observation
  // window `termii-delivery-status` was invoked ZERO times while
  // `twilio-message-status` was invoked repeatedly, so the Nigerian delivery
  // report is not arriving at all. That is why this asks rather than waits.
  const { data: ledgerRows, error: ledgerErr } = await supabase
    .from("notification_deliveries")
    .select("id, provider, provider_message_id, attempt_at")
    .eq("channel", "sms")
    .eq("status", "sent")
    .is("delivered_at", null)
    // Same marker discipline as the ticket pass: `failed_reason` is what an
    // `unverified` verdict leaves behind, so a marked row is judged once.
    .is("failed_reason", null)
    .lt("attempt_at", deadlineIso)
    .order("attempt_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (ledgerErr) {
    console.warn(
      "[sms-delivery-reconcile] notification_deliveries scan note:",
      ledgerErr.message,
    );
  }
  let ledgerConfirmed = 0;
  let ledgerTerminal = 0;
  let ledgerUnverified = 0;
  for (
    const row of (ledgerRows ?? []) as Array<
      { id: string; provider: string | null; provider_message_id: string | null }
    >
  ) {
    const messageId = row.provider_message_id?.trim() ?? "";
    const askable = row.provider === "termii" &&
      isReconcilableTermiiMessageId(messageId);
    const asked: ReconcileVerdict = askable
      ? await askTermiiHistory(messageId)
      : { kind: "pending" };
    const verdict = asked.kind === "pending"
      ? deadlineVerdict(
        {
          id: row.id,
          provider: row.provider,
          provider_message_id: messageId,
          sent_at: null,
        },
        askable,
      )
      : asked;
    const nowIso = now.toISOString();
    if (verdict.kind === "delivered") {
      await supabase.from("notification_deliveries").update({
        status: "delivered",
        delivered_at: nowIso,
      }).eq("id", row.id);
      ledgerConfirmed += 1;
      continue;
    }
    // Same rule as the ticket pass: only a provider-stated failure is
    // `undelivered`. An absence of evidence records its reason and leaves the
    // status alone.
    if (verdict.kind === "failed") {
      await supabase.from("notification_deliveries").update({
        status: "undelivered",
        failed_reason: verdict.reason,
      }).eq("id", row.id);
      ledgerTerminal += 1;
      continue;
    }
    await supabase.from("notification_deliveries").update({
      failed_reason: `delivery_unverified:${verdict.reason}`,
    }).eq("id", row.id);
    ledgerUnverified += 1;
    if (
      verdict.reason.startsWith("provider_message_id_unreconcilable") &&
      unreconcilableSamples.length < 5 && messageId.length > 0
    ) {
      unreconcilableSamples.push(messageId);
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
  const surfaced = failedOut + unverified + ledgerTerminal + ledgerUnverified;
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
          } minutes.\n\n` +
          `${failedOut + ledgerTerminal} were reported FAILED by the provider ` +
          `and are now failed_terminal.\n` +
          `${unverified + ledgerUnverified} are UNVERIFIABLE — we have no ` +
          `evidence either way, so they are NOT marked failed; they now carry a ` +
          `reason instead of looking like a clean send` +
          (unreconcilableSamples.length > 0
            ? `.\n\nSome carried a provider message id that neither the delivery ` +
              `report nor the History endpoint can match (e.g. ${
                unreconcilableSamples.join(", ")
              }). That is an INTEGRATION fault, not a bad handset — no Nigerian ` +
              `delivery can be confirmed at all while it persists.`
            : "."),
        data: {
          day: dayKey,
          provider_reported_failed: failedOut + ledgerTerminal,
          unverifiable: unverified + ledgerUnverified,
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
    unverified,
    still_pending: stillPending,
    ledger_scanned: (ledgerRows ?? []).length,
    ledger_confirmed: ledgerConfirmed,
    ledger_terminal: ledgerTerminal,
    ledger_unverified: ledgerUnverified,
    swept_at: now.toISOString(),
  });
});
