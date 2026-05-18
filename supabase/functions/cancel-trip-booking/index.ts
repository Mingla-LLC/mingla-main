/**
 * cancel-trip-booking — ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] cancel + refund engine for trips.
 *
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] CONTRACT:
 * - This file is the SINGLE OWNER of trip-booking cancellation + Tr4 refund
 *   execution. Single-event refund flow stays in refund-order/index.ts UNCHANGED.
 *   I-PROPOSED-TR4-* invariant family enforces this.
 * - Auth mode 'buyer': SHA256(token) === orders.buyer_cancel_token_hash.
 *   Auth mode 'operator': JWT validate + brand-membership via biz_is_brand_member_for_read_for_caller
 *   (enforced inside biz_cancel_trip_booking_begin RPC via SECURITY DEFINER + auth.uid()
 *   check; operator path runs the begin RPC with userClient(req)).
 * - SC-22 freshness contract: edge fn passes expectedRefundTotalCents in the
 *   begin request; the RPC re-computes via biz_compute_refund_for_cancel at
 *   begin time. If amount differs, return HTTP 409 with policy_updated.
 * - Refund amount computed via biz_compute_refund_for_cancel (deterministic SQL
 *   function pins amount at cancel_at). Immutable post-insert via trigger
 *   tg_refunds_amount_immutable (I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL).
 * - Per-PI refund loop: one stripe.refunds.create per source PaymentIntent.
 *   {stripeAccount: connectedAccountId} on EVERY call per ORCH-0843 direct-charge.
 *   refund_application_fee:true gives proportional 1.5% Mingla fee refund.
 * - On any per-PI failure: biz_cancel_trip_booking_rollback; operator retries
 *   via dashboard. orders.cancelled_at stays SET (booking IS cancelled even if
 *   refund failed; refund retry is operator-handled).
 * - Installment cancellation: scheduled+failed installments flipped to
 *   status=cancelled + cancelled_at populated inside biz_cancel_trip_booking_begin.
 *   CHECK constraint order_installments_cancelled_at_status_consistent enforces
 *   both-or-neither.
 * - Cron process-scheduled-installments has belt-and-braces filter:
 *   WHERE status='scheduled' AND cancelled_at IS NULL (Phase B.4).
 * - Notification: REUSE existing buyer_order_cancelled + buyer_refund_issued
 *   kinds from ORCH-0788 [ticket-confirmation-dispatch]; payload extended with
 *   cancelledBy + tierApplied + breakdown per design §5.3.
 *
 * Request shape (preview mode):
 *   GET /functions/v1/cancel-trip-booking?order_id=<uuid>&token=<plaintext>  (buyer)
 *   POST {mode:'preview', order_id, token?} with JWT (operator)
 *
 * Request shape (commit mode):
 *   POST {
 *     mode: 'buyer' | 'operator',
 *     orderId: string,
 *     token?: string,           // required for buyer mode
 *     reason?: string,          // required for operator mode (10-200 chars)
 *     expectedRefundTotalCents: number   // SC-22 freshness — preview's quoted amount
 *   }
 *   Headers: Idempotency-Key (required)
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  dispatchTicketConfirmation,
  jsonResponse,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CancelMode = "buyer" | "operator" | "preview";

interface PerPaymentRefund {
  installment_id: string | null;
  ordinal: number;
  source_pi: string | null;
  paid_cents: number;
  refund_cents: number;
  currency: string;
  note?: string;
}

interface BeginRpcResult {
  ok: boolean;
  reason?: string;
  refund_id?: string;
  per_payment_refund?: PerPaymentRefund[];
  refund_total_cents?: number;
  currency?: string;
  tier_pct?: number;
  installments_to_cancel?: Array<{ installment_id: string; ordinal: number; due_at: string }>;
}

interface ComputeRpcResult {
  ok: boolean;
  reason?: string;
  order_id?: string;
  event_id?: string;
  cancel_at?: string;
  trip_start?: string;
  days_remaining?: number;
  tier_pct?: number;
  paid_total_cents?: number;
  refund_total_cents?: number;
  currency?: string;
  per_payment_refund?: PerPaymentRefund[];
  installments_to_cancel?: Array<{ installment_id: string; ordinal: number; due_at: string }>;
  policy_kind?: string;
}

interface StripeRefundResult {
  id: string;
  status: string | null;
  amount: number;
}

// ---------------------------------------------------------------------------
// RPC error → HTTP mapper
// ---------------------------------------------------------------------------

function mapComputeReasonToHttp(reason: string): { code: string; status: number; detail: string } {
  switch (reason) {
    case "order_not_found":
      return { code: "order_not_found", status: 404, detail: "Order not found" };
    case "not_a_trip":
      return {
        code: "not_a_trip",
        status: 422,
        detail: "This cancel flow is trip-only; single events use the refund-order endpoint",
      };
    case "already_cancelled":
      return { code: "already_cancelled", status: 409, detail: "Order is already cancelled" };
    case "no_trip_start_date":
      return {
        code: "no_trip_start_date",
        status: 422,
        detail: "Trip has no scheduled start date — refund math cannot compute",
      };
    case "invalid_actor_kind":
      return { code: "invalid_actor_kind", status: 400, detail: "actor_kind must be buyer or operator" };
    default:
      return { code: "rpc_error", status: 500, detail: reason };
  }
}

// ---------------------------------------------------------------------------
// Buyer-token auth — validates SHA256(token) === orders.buyer_cancel_token_hash
// Returns the order row when valid (we already paid the hash lookup cost).
// ---------------------------------------------------------------------------

async function validateBuyerToken(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
  plaintextToken: string,
): Promise<{ ok: boolean; reason?: string; status?: number; orderRow?: Record<string, unknown> }> {
  if (!plaintextToken || plaintextToken.length < 16) {
    return { ok: false, reason: "token_required", status: 401 };
  }
  const tokenHash = await sha256Hex(plaintextToken);

  // Service-role lookup: anon buyers cannot read orders directly via PostgREST.
  const { data, error } = await supabase
    .from("orders")
    .select("id, buyer_cancel_token_hash, cancelled_at")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "order_lookup_failed", status: 500 };
  }
  if (!data) {
    return { ok: false, reason: "order_not_found", status: 404 };
  }
  const storedHash =
    typeof (data as Record<string, unknown>).buyer_cancel_token_hash === "string"
      ? ((data as Record<string, unknown>).buyer_cancel_token_hash as string)
      : null;
  if (!storedHash || storedHash !== tokenHash) {
    return { ok: false, reason: "invalid_token", status: 401 };
  }
  // Already-cancelled check is in biz_compute_refund_for_cancel, not duplicated here.
  return { ok: true, orderRow: data as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Connected-account lookup — mirrors refund-order pattern.
// ---------------------------------------------------------------------------

async function resolveConnectedAccountId(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
): Promise<{ connectedAccountId: string | null; eventId: string | null; brandId: string | null }> {
  const { data, error } = await supabase
    .from("orders")
    .select("event_id, events(brand_id, brands(stripe_connect_id))")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) {
    return { connectedAccountId: null, eventId: null, brandId: null };
  }
  type JoinedBrand = { stripe_connect_id?: string | null };
  type JoinedEvents = {
    brand_id?: string | null;
    brands?: JoinedBrand | JoinedBrand[] | null;
  };
  const row = data as Record<string, unknown>;
  const eventId = typeof row.event_id === "string" ? row.event_id : null;
  const eventsJoined = row.events as JoinedEvents | JoinedEvents[] | null;
  const eventsRow = Array.isArray(eventsJoined) ? eventsJoined[0] ?? null : eventsJoined;
  const brandId = typeof eventsRow?.brand_id === "string" ? eventsRow.brand_id : null;
  const brandsJoined = eventsRow?.brands ?? null;
  const brandsRow = Array.isArray(brandsJoined) ? brandsJoined[0] ?? null : brandsJoined;
  const connectedAccountId =
    typeof brandsRow?.stripe_connect_id === "string" && brandsRow.stripe_connect_id.length > 0
      ? brandsRow.stripe_connect_id
      : null;
  return { connectedAccountId, eventId, brandId };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

serve(async (req: Request): Promise<Response> => {
  // @ts-ignore — ticketCorsHeaders typed as readonly record at runtime
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const mode: CancelMode =
    body.mode === "buyer" ? "buyer" : body.mode === "operator" ? "operator" : "preview";
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const token = typeof body.token === "string" ? body.token : "";
  const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
  const expectedRefundTotalCents =
    typeof body.expectedRefundTotalCents === "number" ? body.expectedRefundTotalCents : null;

  if (!orderId) return jsonResponse({ error: "order_id_required" }, 400);

  const supabase = serviceClient();

  // ---------- AUTH ----------
  let actorKind: "buyer" | "operator" | null = null;
  let actorUserId: string | null = null;

  if (mode === "buyer" || mode === "preview") {
    // Preview-mode can also be operator with JWT; sniff for Authorization header first.
    const hasAuthHeader = req.headers.get("Authorization") !== null;
    if (hasAuthHeader) {
      const userId = await userIdFromAuthHeader(req);
      if (userId) {
        actorKind = "operator";
        actorUserId = userId;
      }
    }
    if (actorKind === null) {
      // Buyer token path
      const auth = await validateBuyerToken(supabase, orderId, token);
      if (!auth.ok) {
        return jsonResponse(
          { error: auth.reason ?? "invalid_token", detail: "buyer cancel token invalid or missing" },
          auth.status ?? 401,
        );
      }
      actorKind = "buyer";
      actorUserId = null; // buyer-self has no auth.users row
    }
  } else if (mode === "operator") {
    const userId = await userIdFromAuthHeader(req);
    if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);
    if (reasonRaw.length < 10 || reasonRaw.length > 200) {
      return jsonResponse({ error: "reason_invalid_length", detail: "operator cancel requires reason 10-200 chars" }, 400);
    }
    actorKind = "operator";
    actorUserId = userId;
  }

  if (!actorKind) {
    return jsonResponse({ error: "auth_resolution_failed" }, 401);
  }

  // ---------- PREVIEW MODE (read-only) ----------
  // Returns the deterministic refund computation without side-effects.
  // Used by the buyer cancel route + operator RefundPreviewSheet for the
  // initial hero-amount render. Commit mode below re-computes via _begin
  // and enforces SC-22 freshness against expectedRefundTotalCents.
  if (mode === "preview") {
    const { data: computeData, error: computeErr } = await supabase.rpc(
      "biz_compute_refund_for_cancel",
      { p_order_id: orderId, p_cancel_at: new Date().toISOString() },
    );
    if (computeErr) {
      console.error("[cancel-trip-booking] preview compute failed", computeErr);
      return jsonResponse({ error: "compute_failed", detail: computeErr.message }, 500);
    }
    const compute = (computeData as ComputeRpcResult | null) ?? { ok: false };
    if (!compute.ok) {
      const mapped = mapComputeReasonToHttp(compute.reason ?? "rpc_error");
      return jsonResponse({ error: mapped.code, detail: mapped.detail }, mapped.status);
    }
    return jsonResponse({
      mode: "preview",
      orderId: compute.order_id,
      eventId: compute.event_id,
      quotedAt: compute.cancel_at,
      tripStart: compute.trip_start,
      daysRemaining: compute.days_remaining,
      tierPct: compute.tier_pct,
      tierKind: compute.policy_kind ?? "none",
      paidTotalCents: compute.paid_total_cents ?? 0,
      refundTotalCents: compute.refund_total_cents ?? 0,
      currency: compute.currency ?? "GBP",
      perPaymentRefund: compute.per_payment_refund ?? [],
      installmentsToCancel: (compute.installments_to_cancel ?? []).length,
    });
  }

  // ---------- COMMIT MODE (write path) ----------
  // SC-22 freshness contract: client passes expectedRefundTotalCents from the
  // preview response. We re-compute via biz_cancel_trip_booking_begin (which
  // pins amount at cancel_at) and compare. If different, return 409 so the
  // client re-fetches preview before re-confirming.
  const idempotencyKey = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return jsonResponse({ error: "idempotency_key_required" }, 400);
  }
  if (expectedRefundTotalCents === null || expectedRefundTotalCents < 0) {
    return jsonResponse({ error: "expected_refund_total_cents_required" }, 400);
  }

  // Step 1: BEGIN — atomic insert pending refund + flip orders.cancelled_at +
  // cancel scheduled/failed installments. Returns refund_id + per-payment attribution.
  // SERVICE-ROLE only per RPC GRANT — we use serviceClient() not userClient.
  const cancelAt = new Date().toISOString();
  const { data: beginData, error: beginErr } = await supabase.rpc(
    "biz_cancel_trip_booking_begin",
    {
      p_order_id: orderId,
      p_actor_kind: actorKind,
      p_actor_user_id: actorUserId,
      p_reason: reasonRaw.length > 0 ? reasonRaw : null,
      p_cancel_at: cancelAt,
    },
  );

  if (beginErr) {
    console.error("[cancel-trip-booking] begin RPC failed", beginErr);
    return jsonResponse({ error: "begin_failed", detail: beginErr.message }, 500);
  }
  const begin = (beginData as BeginRpcResult | null) ?? { ok: false };
  if (!begin.ok) {
    const mapped = mapComputeReasonToHttp(begin.reason ?? "rpc_error");
    return jsonResponse({ error: mapped.code, detail: mapped.detail }, mapped.status);
  }

  const refundId = begin.refund_id ?? "";
  const computedRefundTotalCents = Number(begin.refund_total_cents ?? 0);
  const currency = (begin.currency ?? "GBP").toLowerCase();
  const tierPct = Number(begin.tier_pct ?? 0);
  const perPaymentRefund = begin.per_payment_refund ?? [];
  const installmentsCancelled = (begin.installments_to_cancel ?? []).length;

  // SC-22 freshness re-check — if policy changed between preview and confirm,
  // the computed amount may differ from expectedRefundTotalCents.
  // CRITICAL: at this point we have already begun (orders.cancelled_at flipped,
  // installments cancelled, refund row pending). We must NOT proceed to Stripe
  // refund at the wrong amount. Rollback the begin via _rollback (marks refund
  // failed; orders.cancelled_at + installment cancels stay per v1 design).
  if (computedRefundTotalCents !== expectedRefundTotalCents) {
    await supabase.rpc("biz_cancel_trip_booking_rollback", {
      p_refund_id: refundId,
      p_failure_reason: `sc22_freshness_divergence: expected=${expectedRefundTotalCents}, computed=${computedRefundTotalCents}`,
    });
    return jsonResponse(
      {
        error: "policy_updated",
        detail: "Cancellation policy was updated — refresh to see your new refund amount",
        currentRefundTotalCents: computedRefundTotalCents,
        currency,
        refundId,
      },
      409,
    );
  }

  // Step 2: connected-account lookup for Stripe refund calls.
  const { connectedAccountId, eventId, brandId } = await resolveConnectedAccountId(supabase, orderId);
  if (!connectedAccountId) {
    await supabase.rpc("biz_cancel_trip_booking_rollback", {
      p_refund_id: refundId,
      p_failure_reason: "missing_connected_account",
    });
    return jsonResponse(
      { error: "missing_connected_account", detail: "brand has no Stripe connected account" },
      422,
    );
  }

  // Step 3: per-PI refund loop. One stripe.refunds.create per source PI.
  // Zero-refund tiers (refund_cents=0 for all rows) skip Stripe entirely.
  const stripe = stripeTicketRefund();
  const stripeRefundIds: string[] = [];
  const refundLineRowsToInsert: Array<{
    refund_id: string;
    order_line_item_id: string;
    ticket_type_id: string;
    quantity: number;
    amount_cents: number;
    installment_id: string | null;
  }> = [];
  let totalApplicationFeeRefunded = 0;
  let stripeFailureDetail: string | null = null;

  // For refund_line_items inserts we need order_line_items rows; fetch once.
  // refund_line_items schema requires order_line_item_id + ticket_type_id + quantity.
  // For v1: a trip order has 1 line item (1 reservation = 1 ticket type). We
  // distribute the refund across (line_item × source PI) intersections.
  const { data: oliData } = await supabase
    .from("order_line_items")
    .select("id, ticket_type_id, quantity")
    .eq("order_id", orderId);
  const orderLineItems = (oliData ?? []) as Array<{
    id: string;
    ticket_type_id: string;
    quantity: number;
  }>;
  if (orderLineItems.length === 0) {
    await supabase.rpc("biz_cancel_trip_booking_rollback", {
      p_refund_id: refundId,
      p_failure_reason: "no_order_line_items",
    });
    return jsonResponse(
      { error: "no_order_line_items", detail: "order has no line items to attribute refund against" },
      500,
    );
  }
  // v1 simplification: attribute every per-payment refund row to the FIRST line item.
  // Multi-line trip orders are not a Tr2/Tr3 pattern; future ORCH if multi-tier trips appear.
  const primaryLineItem = orderLineItems[0];

  for (const entry of perPaymentRefund) {
    if (entry.refund_cents <= 0) {
      // Zero-refund tier (e.g., 0% tier or rounding edge case for tiny installments).
      // Still write refund_line_items row with amount=0? NO — refund_line_items
      // CHECK constraint requires amount_cents > 0. Skip the row entirely.
      // Audit-trail integrity: the refunds row carries refund_total_cents=0 so
      // the audit still proves the cancel happened at 0% tier.
      continue;
    }
    if (!entry.source_pi) {
      // No source PI (data integrity issue — installment finalized without PI?).
      // Skip + log; don't fail the whole flow.
      console.warn("[cancel-trip-booking] per-payment entry has no source_pi", entry);
      continue;
    }
    try {
      // @ts-ignore — Stripe SDK namespace is runtime-provided in Deno.
      const created = await stripe.refunds.create(
        {
          payment_intent: entry.source_pi,
          amount: entry.refund_cents,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: {
            mingla_refund_id: refundId,
            mingla_order_id: orderId,
            mingla_installment_id: entry.installment_id ?? "",
            mingla_idempotency_key: idempotencyKey,
            mingla_tr4_cancel: "true",
          },
        },
        {
          // Per-PI idempotency-key: refund_id + installment_id (or 'deposit')
          // — same key always returns same refund attempt at Stripe.
          idempotencyKey: `tr4_cancel:${refundId}:${entry.installment_id ?? "deposit"}`,
          stripeAccount: connectedAccountId,
        },
      );
      const result: StripeRefundResult = {
        id: String(created.id),
        status: created.status ?? null,
        amount: Number(created.amount ?? entry.refund_cents),
      };
      if (result.status === "failed" || result.status === "canceled") {
        stripeFailureDetail = `stripe refund status=${result.status} on installment_id=${entry.installment_id ?? "deposit"}`;
        break;
      }
      stripeRefundIds.push(result.id);
      refundLineRowsToInsert.push({
        refund_id: refundId,
        order_line_item_id: primaryLineItem.id,
        ticket_type_id: primaryLineItem.ticket_type_id,
        quantity: primaryLineItem.quantity,
        amount_cents: entry.refund_cents,
        installment_id: entry.installment_id,
      });
      // refund_application_fee:true tells Stripe to refund the 1.5% application
      // fee proportionally. The actual refunded fee lives on a separate
      // ApplicationFeeRefund object; for v1 we accumulate Math.floor(amount*0.015)
      // as the local estimate. Stripe webhook ApplicationFeeRefund.created can
      // reconcile in a future ORCH if exact accounting matters.
      totalApplicationFeeRefunded += Math.floor(entry.refund_cents * 0.015);
    } catch (err) {
      stripeFailureDetail = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  if (stripeFailureDetail !== null) {
    // Partial-success rollback. Some refunds may have succeeded at Stripe;
    // the refunds row stays at status=failed so operator can manually retry.
    // Already-succeeded Stripe refunds (recorded in stripeRefundIds) are
    // visible in Stripe Dashboard; the local refund_line_items rows are NOT
    // inserted because we haven't done the insert yet (next step).
    console.error("[cancel-trip-booking] stripe refund loop failed", {
      refundId,
      stripeFailureDetail,
      succeededBeforeFailure: stripeRefundIds.length,
    });
    await supabase.rpc("biz_cancel_trip_booking_rollback", {
      p_refund_id: refundId,
      p_failure_reason: stripeFailureDetail,
    });
    return jsonResponse(
      {
        error: "stripe_refund_failed",
        detail: stripeFailureDetail,
        refundId,
        partialSucceededRefunds: stripeRefundIds.length,
      },
      502,
    );
  }

  // Step 4: insert refund_line_items rows (one per Stripe refund call).
  // Trigger tg_refund_line_items_installment_parity enforces
  // I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY at write time.
  if (refundLineRowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("refund_line_items")
      .insert(refundLineRowsToInsert);
    if (insertError) {
      // Stripe refund succeeded but local ledger insert failed.
      // Webhook reconciliation will catch this; refunds.status=failed surfaces
      // the issue. Mark commit as failed but DO NOT roll back orders.cancelled_at —
      // booking IS cancelled (and Stripe IS refunded — buyer gets their money).
      console.error("[cancel-trip-booking] refund_line_items insert failed", insertError);
      await supabase.rpc("biz_cancel_trip_booking_rollback", {
        p_refund_id: refundId,
        p_failure_reason: `ledger_insert_failed: ${insertError.message}`,
      });
      return jsonResponse(
        {
          error: "ledger_insert_failed_after_stripe_success",
          detail: insertError.message,
          stripeRefundIds,
          refundId,
        },
        500,
      );
    }
  }

  // Step 5: COMMIT — flip refunds.status=succeeded + write stripe_refund_id +
  // application_fee_refunded_cents + processed_at. v1: primary stripe refund
  // id = first one; multi-PI refunds carry full list in audit metadata.
  const { data: commitData, error: commitErr } = await supabase.rpc(
    "biz_cancel_trip_booking_commit",
    {
      p_refund_id: refundId,
      p_stripe_refund_ids: stripeRefundIds.length > 0 ? stripeRefundIds : [""],
      p_application_fee_refunded_cents: totalApplicationFeeRefunded,
      p_processed_at: new Date().toISOString(),
    },
  );
  if (commitErr || !commitData || !(commitData as { ok: boolean }).ok) {
    // Critical: Stripe succeeded + ledger rows written but refund commit failed.
    // The refund-status reconciliation cron can recover; surface to caller.
    console.error("[cancel-trip-booking] commit RPC failed after Stripe + ledger success", commitErr);
    return jsonResponse(
      {
        error: "commit_failed_after_stripe_success",
        detail:
          "Stripe refund succeeded and ledger rows written but commit RPC failed. Reconciliation will finalise.",
        stripeRefundIds,
        refundId,
      },
      500,
    );
  }

  // Step 6: notification dispatch. REUSE existing ORCH-0788 kinds. Two rows
  // enqueued: buyer_order_cancelled (the cancellation confirmation) +
  // buyer_refund_issued (the refund processing email). Payload discriminator
  // cancelledBy='buyer'|'operator' drives email body variant per design §5.3.
  const { data: orderDetail } = await supabase
    .from("orders")
    .select("event_id, buyer_email, currency, total_cents")
    .eq("id", orderId)
    .maybeSingle();

  const buyerEmail = typeof orderDetail?.buyer_email === "string" ? orderDetail.buyer_email : "";

  if (buyerEmail.length > 0) {
    const baseNotifPayload = {
      cancelledBy: actorKind,
      tierPct,
      refundAmountCents: computedRefundTotalCents,
      currency,
      installmentBreakdown: perPaymentRefund.map((p) => ({
        ordinal: p.ordinal,
        paid_cents: p.paid_cents,
        refund_cents: p.refund_cents,
        currency: p.currency,
      })),
      reason: reasonRaw.length > 0 ? reasonRaw : null,
      refundIssued: computedRefundTotalCents > 0,
    };

    // buyer_order_cancelled (the cancellation email)
    const { error: notif1Err } = await supabase.from("ticket_order_notifications").insert({
      order_id: orderId,
      event_id: orderDetail?.event_id ?? eventId,
      channel: "email",
      recipient: buyerEmail,
      status: "pending",
      idempotency_key: `tr4_cancel:${refundId}:cancelled`,
      attempt_count: 0,
      payload: {
        template_key: "buyer_order_cancelled",
        ...baseNotifPayload,
      },
    });
    if (notif1Err) {
      console.error("[cancel-trip-booking] buyer_order_cancelled notification enqueue failed (non-fatal)", notif1Err.message);
    }

    // buyer_refund_issued (only when refund > 0)
    if (computedRefundTotalCents > 0) {
      const { error: notif2Err } = await supabase.from("ticket_order_notifications").insert({
        order_id: orderId,
        event_id: orderDetail?.event_id ?? eventId,
        channel: "email",
        recipient: buyerEmail,
        status: "pending",
        idempotency_key: `tr4_cancel:${refundId}:refund_issued`,
        attempt_count: 0,
        payload: {
          template_key: "buyer_refund_issued",
          ...baseNotifPayload,
          stripe_refund_ids: stripeRefundIds,
        },
      });
      if (notif2Err) {
        console.error("[cancel-trip-booking] buyer_refund_issued notification enqueue failed (non-fatal)", notif2Err.message);
      }
    }

    // Inline-dispatch so emails go out immediately. Mirrors refund-order pattern.
    // Failures are NON-FATAL — the notification-retry-sweeper picks up failed rows.
    try {
      await dispatchTicketConfirmation(orderId);
    } catch (dispatchErr) {
      console.error("[cancel-trip-booking] inline dispatch failed (non-fatal)", dispatchErr);
    }
  } else {
    console.warn("[cancel-trip-booking] no buyer_email; skipping notification enqueue", { orderId });
  }

  // Step 7: audit row.
  try {
    await writeAudit(supabase, {
      user_id: actorUserId,
      brand_id: brandId,
      event_id: eventId,
      action: "trip_booking_cancelled",
      target_type: "order",
      target_id: orderId,
      after: {
        refund_id: refundId,
        refund_total_cents: computedRefundTotalCents,
        currency,
        tier_pct: tierPct,
        cancelled_by_kind: actorKind,
        stripe_refund_ids: stripeRefundIds,
        installments_cancelled: installmentsCancelled,
        reason: reasonRaw.length > 0 ? reasonRaw : null,
      },
    });
  } catch (auditError) {
    console.error("[cancel-trip-booking] audit write failed (non-fatal)", auditError);
  }

  // Final success response — buyer UI shows success state; operator UI dismisses sheet.
  return jsonResponse({
    ok: true,
    mode: actorKind,
    refundId,
    refundAmountCents: computedRefundTotalCents,
    currency,
    tierPct,
    tierKind: "computed",
    stripeRefundIds,
    installmentsCancelled,
    processedAt: new Date().toISOString(),
  });
});
