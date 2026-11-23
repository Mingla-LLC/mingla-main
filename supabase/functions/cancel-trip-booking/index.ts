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
import { executeTicketRefundWithFeeTruth } from "../_shared/issue2097TicketRefundTruth.ts";
import {
  createPaystackRefund,
  isRetryablePaystackRefundError,
  PAYSTACK_MIN_REFUND_SUBUNITS,
  paystackRefundOutcomeStatus,
  persistPaystackRefundOutcome,
  reconcilePaystackRefund,
} from "../_shared/paystackRefunds.ts";
import { writeAudit } from "../_shared/audit.ts";
import { PaystackApiError } from "../_shared/paystack.ts";
import {
  dispatchTicketConfirmation,
  jsonResponse,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  computeRefundForActor,
  depositKeptCents,
  paymentRefundEntries,
} from "./refundEntries.ts";
import { planV2SchemaAvailable } from "../_shared/installments/planV2Schema.ts";
import { returnOrderOverpaymentsBestEffort } from "../_shared/installments/overpaymentLane.ts";
import { overpaymentReturnCents } from "./refundEntries.ts";
import { installmentOpsAlert } from "../_shared/installments/installmentOpsAlert.ts";
import {
  alertTripCancelNotFinished,
  alertUnrecordedTripRefund,
  providerRefundsMade,
} from "../_shared/installments/unrecordedRefunds.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// issue #4522 G-3 / G-4 — 'resume': the instalment run (service role only)
// finishes a cancel already in progress; it never starts one.
type CancelMode = "buyer" | "operator" | "preview" | "resume";

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
  deposit_non_refundable_cents?: number;
  refund_total_cents?: number;
  currency?: string;
  tier_pct?: number;
  installments_to_cancel?: Array<
    { installment_id: string; ordinal: number; due_at: string }
  >;
  /** issue #4522 G-3 / G-4 — the refunds row carries the intended refunds. */
  operation?: boolean;
  /** issue #4522 G-3 / G-4 — an unfinished cancel resumed (who cancelled, why). */
  resume?: boolean;
  actor_kind?: string;
  cancel_reason?: string | null;
  /** issue #4522 G-4 — card refunds refused with no money moved, per charge. */
  card_tries?: Record<string, number>;
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
  deposit_non_refundable_cents?: number;
  /** issue #4522 (N2) — overpayment returned in full on top of the policy refund. */
  overpayment_return_cents?: number;
  installments_to_cancel?: Array<
    { installment_id: string; ordinal: number; due_at: string }
  >;
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

function mapComputeReasonToHttp(
  reason: string,
): { code: string; status: number; detail: string } {
  switch (reason) {
    case "order_not_found":
      return {
        code: "order_not_found",
        status: 404,
        detail: "Order not found",
      };
    case "not_a_trip":
      return {
        code: "not_a_trip",
        status: 422,
        detail:
          "This cancel flow is trip-only; single events use the refund-order endpoint",
      };
    case "already_cancelled":
      return {
        code: "already_cancelled",
        status: 409,
        detail: "Order is already cancelled",
      };
    case "no_trip_start_date":
      return {
        code: "no_trip_start_date",
        status: 422,
        detail: "Trip has no scheduled start date — refund math cannot compute",
      };
    case "invalid_actor_kind":
      return {
        code: "invalid_actor_kind",
        status: 400,
        detail: "actor_kind must be buyer or operator",
      };
    // issue #4522 pass 5 (T9-2) — a charge of this booking can still land:
    // nothing was cancelled; retry once it settles.
    case "balance_payment_in_flight":
      return {
        code: "balance_payment_in_flight",
        status: 409,
        detail: "A payment on this trip is already processing",
      };
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
): Promise<
  {
    ok: boolean;
    reason?: string;
    status?: number;
    orderRow?: Record<string, unknown>;
  }
> {
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
    typeof (data as Record<string, unknown>).buyer_cancel_token_hash ===
        "string"
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
): Promise<{
  connectedAccountId: string | null;
  eventId: string | null;
  brandId: string | null;
  paymentProvider: "stripe" | "paystack";
}> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "event_id, events(brand_id, brands(stripe_connect_id, payment_provider))",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) {
    return {
      connectedAccountId: null,
      eventId: null,
      brandId: null,
      paymentProvider: "stripe",
    };
  }
  type JoinedBrand = {
    stripe_connect_id?: string | null;
    payment_provider?: string | null;
  };
  type JoinedEvents = {
    brand_id?: string | null;
    brands?: JoinedBrand | JoinedBrand[] | null;
  };
  const row = data as Record<string, unknown>;
  const eventId = typeof row.event_id === "string" ? row.event_id : null;
  const eventsJoined = row.events as JoinedEvents | JoinedEvents[] | null;
  const eventsRow = Array.isArray(eventsJoined)
    ? eventsJoined[0] ?? null
    : eventsJoined;
  const brandId = typeof eventsRow?.brand_id === "string"
    ? eventsRow.brand_id
    : null;
  const brandsJoined = eventsRow?.brands ?? null;
  const brandsRow = Array.isArray(brandsJoined)
    ? brandsJoined[0] ?? null
    : brandsJoined;
  const connectedAccountId = typeof brandsRow?.stripe_connect_id === "string" &&
      brandsRow.stripe_connect_id.length > 0
    ? brandsRow.stripe_connect_id
    : null;
  return {
    connectedAccountId,
    eventId,
    brandId,
    paymentProvider: brandsRow?.payment_provider === "paystack"
      ? "paystack"
      : "stripe",
  };
}

async function resolveTripPublicSlugs(
  supabase: ReturnType<typeof serviceClient>,
  eventId: string,
): Promise<{ brandSlug: string | null; tripSlug: string | null }> {
  const { data, error } = await supabase
    .from("events")
    .select("slug, brands(slug)")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) {
    console.warn("[cancel-trip-booking] public trip slugs unavailable", error);
    return { brandSlug: null, tripSlug: null };
  }

  type JoinedBrand = { slug?: string | null };
  const row = data as {
    slug?: string | null;
    brands?: JoinedBrand | JoinedBrand[] | null;
  };
  const brand = Array.isArray(row.brands)
    ? row.brands[0] ?? null
    : row.brands ?? null;
  return {
    brandSlug: typeof brand?.slug === "string" ? brand.slug : null,
    tripSlug: typeof row.slug === "string" ? row.slug : null,
  };
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

  const mode: CancelMode = body.mode === "buyer"
    ? "buyer"
    : body.mode === "operator"
    ? "operator"
    : body.mode === "resume"
    ? "resume"
    : "preview";
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const token = typeof body.token === "string" ? body.token : "";
  const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
  const expectedRefundTotalCents =
    typeof body.expectedRefundTotalCents === "number"
      ? body.expectedRefundTotalCents
      : null;

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
          {
            error: auth.reason ?? "invalid_token",
            detail: "buyer cancel token invalid or missing",
          },
          auth.status ?? 401,
        );
      }
      actorKind = "buyer";
      actorUserId = null; // buyer-self has no auth.users row
    }
  } else if (mode === "resume") {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (
      serviceKey.length === 0 ||
      req.headers.get("authorization") !== `Bearer ${serviceKey}`
    ) {
      return jsonResponse({ error: "forbidden" }, 403);
    }
    const { data: op } = await supabase.rpc(
      "issue_4522_trip_cancel_operation",
      { p_order_id: orderId },
    );
    if (op === null || op === undefined) {
      return jsonResponse({ error: "no_cancel_in_progress" }, 409);
    }
    const opActor = (op as { actor_kind?: unknown }).actor_kind;
    actorKind = opActor === "buyer" ? "buyer" : "operator";
    const opUser = (op as { actor_user_id?: unknown }).actor_user_id;
    actorUserId = typeof opUser === "string" ? opUser : null;
  } else if (mode === "operator") {
    const userId = await userIdFromAuthHeader(req);
    if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);
    if (reasonRaw.length < 10 || reasonRaw.length > 200) {
      return jsonResponse({
        error: "reason_invalid_length",
        detail: "operator cancel requires reason 10-200 chars",
      }, 400);
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
    // #1981 — operator preview previously ran service-role compute with only a
    // JWT presence check, so a member of brand A could preview brand B's
    // booking. Bind order → brand → membership before quoting.
    if (actorKind === "operator") {
      if (!actorUserId) {
        return jsonResponse({ error: "unauthenticated" }, 401);
      }
      const { brandId: previewBrandId } = await resolveConnectedAccountId(
        supabase,
        orderId,
      );
      if (!previewBrandId) {
        return jsonResponse({ error: "order_not_found" }, 404);
      }
      const { data: isMember, error: memberErr } = await supabase.rpc(
        "biz_is_brand_member_for_read",
        { p_brand_id: previewBrandId, p_user_id: actorUserId },
      );
      if (memberErr) {
        console.error(
          "[cancel-trip-booking] preview membership check failed",
          memberErr,
        );
        return jsonResponse({ error: "server" }, 500);
      }
      if (isMember !== true) {
        return jsonResponse({ error: "forbidden" }, 403);
      }
    }
    // issue #4522 — computed for this actor, so a host's preview includes a
    // non-refundable deposit exactly as begin will (D-9).
    const { data: computeData, error: computeErr } = await computeRefundForActor(
      supabase,
      await planV2SchemaAvailable(supabase),
      {
        orderId,
        cancelAt: new Date().toISOString(),
        actorKind: actorKind ?? "buyer",
      },
    );
    if (computeErr) {
      console.error("[cancel-trip-booking] preview compute failed", computeErr);
      return jsonResponse({
        error: "compute_failed",
        detail: computeErr.message,
      }, 500);
    }
    const compute = (computeData as ComputeRpcResult | null) ?? { ok: false };
    // issue #4522 G-3 / G-4 — a cancel still in progress answers with what it
    // still owes back (the refunds it intended), never a bare "already
    // cancelled"; confirming it resumes the same operation.
    if (!compute.ok && compute.reason === "already_cancelled") {
      const { data: op } = await supabase.rpc(
        "issue_4522_trip_cancel_operation",
        { p_order_id: orderId },
      );
      if (op !== null && op !== undefined) {
        const o = op as Record<string, unknown>;
        const entries = paymentRefundEntries(o.per_payment_refund);
        const { data: tripRow } = await supabase.from("orders")
          .select("event_id").eq("id", orderId).maybeSingle();
        const opEventId = typeof tripRow?.event_id === "string"
          ? tripRow.event_id
          : "";
        const slugs = await resolveTripPublicSlugs(supabase, opEventId);
        return jsonResponse({
          mode: "preview",
          inProgress: true,
          orderId,
          eventId: opEventId,
          brandSlug: slugs.brandSlug,
          tripSlug: slugs.tripSlug,
          quotedAt: o.created_at,
          tierPct: Number(o.tier_pct ?? 0),
          tierKind: "computed",
          paidTotalCents: entries.reduce((s, e) => s + e.paid_cents, 0),
          refundTotalCents: Number(o.amount_cents ?? 0),
          currency: String(o.currency ?? "GBP"),
          perPaymentRefund: entries,
          installmentsToCancel: 0,
          ...(depositKeptCents(o) > 0
            ? { depositKeptCents: depositKeptCents(o) }
            : {}),
        });
      }
    }
    if (!compute.ok) {
      const mapped = mapComputeReasonToHttp(compute.reason ?? "rpc_error");
      return jsonResponse(
        { error: mapped.code, detail: mapped.detail },
        mapped.status,
      );
    }
    const publicSlugs = await resolveTripPublicSlugs(
      supabase,
      compute.event_id ?? "",
    );
    return jsonResponse({
      mode: "preview",
      orderId: compute.order_id,
      eventId: compute.event_id,
      brandSlug: publicSlugs.brandSlug,
      tripSlug: publicSlugs.tripSlug,
      quotedAt: compute.cancel_at,
      tripStart: compute.trip_start,
      daysRemaining: compute.days_remaining,
      tierPct: compute.tier_pct,
      tierKind: compute.policy_kind ?? "none",
      paidTotalCents: compute.paid_total_cents ?? 0,
      refundTotalCents: compute.refund_total_cents ?? 0,
      currency: compute.currency ?? "GBP",
      perPaymentRefund: paymentRefundEntries(compute.per_payment_refund),
      installmentsToCancel: (compute.installments_to_cancel ?? []).length,
      // issue #4522 — "Deposit is non-refundable": what the cancel keeps.
      ...(depositKeptCents(compute) > 0
        ? { depositKeptCents: depositKeptCents(compute) }
        : {}),
      // issue #4522 (N2) — money paid beyond what the trip cost goes back in
      // full, whatever the tier, through its own refund (never part of
      // refundTotalCents, which the commit's freshness check compares).
      ...(overpaymentReturnCents(compute) > 0
        ? { overpaymentReturnCents: overpaymentReturnCents(compute) }
        : {}),
    });
  }

  // ---------- COMMIT MODE (write path) ----------
  // SC-22 freshness contract: client passes expectedRefundTotalCents from the
  // preview response. We re-compute via biz_cancel_trip_booking_begin (which
  // pins amount at cancel_at) and compare. If different, return 409 so the
  // client re-fetches preview before re-confirming.
  const idempotencyKey = req.headers.get("Idempotency-Key") ??
    req.headers.get("idempotency-key");
  if (
    !idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128
  ) {
    return jsonResponse({ error: "idempotency_key_required" }, 400);
  }
  if (expectedRefundTotalCents === null || expectedRefundTotalCents < 0) {
    return jsonResponse({ error: "expected_refund_total_cents_required" }, 400);
  }

  const cancelAt = new Date().toISOString();
  const {
    connectedAccountId,
    eventId,
    brandId,
    paymentProvider,
  } = await resolveConnectedAccountId(supabase, orderId);

  // #1981 — operator commit uses service-role begin RPC; bind order → brand →
  // membership before state flips (same check as operator preview).
  if (actorKind === "operator") {
    if (!actorUserId) {
      return jsonResponse({ error: "unauthenticated" }, 401);
    }
    if (!brandId) {
      return jsonResponse({ error: "order_not_found" }, 404);
    }
    const { data: isMember, error: memberErr } = await supabase.rpc(
      "biz_is_brand_member_for_read",
      { p_brand_id: brandId, p_user_id: actorUserId },
    );
    if (memberErr) {
      console.error(
        "[cancel-trip-booking] commit membership check failed",
        memberErr,
      );
      return jsonResponse({ error: "server" }, 500);
    }
    if (isMember !== true) {
      return jsonResponse({ error: "forbidden" }, 403);
    }
  }

  const planV2 = await planV2SchemaAvailable(supabase);
  // One computation before anything changes: the Paystack floor below and,
  // with the #4522 schema, the G-4 checks.
  const { data: floorData, error: floorError } =
    paymentProvider === "paystack" || (planV2 && mode !== "resume")
      ? await computeRefundForActor(
        supabase,
        planV2,
        { orderId, cancelAt, actorKind },
      )
      : { data: null, error: null };
  const floorCompute = (floorData as ComputeRpcResult | null) ?? {
    ok: false,
  };
  // issue #4522 G-4 — with the #4522 schema nothing that can be checked is
  // checked after the booking is cancelled: the quoted amount, the card
  // account and the line items are checked first, with no side effect, so a
  // cancel never stops part-way on them (main's database: as before).
  if (planV2 && mode !== "resume" && floorError === null && floorCompute.ok) {
    const preTotal = Number(floorCompute.refund_total_cents ?? 0);
    if (preTotal !== expectedRefundTotalCents) {
      return jsonResponse({
        error: "policy_updated",
        detail:
          "Cancellation policy was updated — refresh to see your new refund amount",
        currentRefundTotalCents: preTotal,
        currency: (floorCompute.currency ?? "GBP").toLowerCase(),
      }, 409);
    }
    if (preTotal > 0 && paymentProvider === "stripe" && !connectedAccountId) {
      return jsonResponse({
        error: "missing_connected_account",
        detail: "brand has no Stripe connected account",
      }, 422);
    }
    const { count: lineCount } = await supabase.from("order_line_items")
      .select("id", { count: "exact", head: true }).eq("order_id", orderId);
    if (preTotal > 0 && (lineCount ?? 0) === 0) {
      return jsonResponse({
        error: "no_order_line_items",
        detail: "order has no line items to attribute refund against",
      }, 500);
    }
  }

  // Paystack rejects explicit partial-refund amounts below NGN 50. Validate
  // before the cancellation state flips. True full refunds omit `amount` and
  // therefore retain Paystack's full-reversal/replay shape.
  if (paymentProvider === "paystack") {
    if (
      floorError === null && floorCompute.ok &&
      paymentRefundEntries(floorCompute.per_payment_refund).some((entry) =>
        entry.refund_cents > 0 &&
        entry.refund_cents < PAYSTACK_MIN_REFUND_SUBUNITS &&
        entry.refund_cents !== entry.paid_cents
      )
    ) {
      return jsonResponse(
        {
          error: "paystack_refund_below_minimum",
          detail: "Paystack partial refunds must be at least NGN 50",
        },
        422,
      );
    }
  }

  // Step 1: BEGIN — atomic insert pending refund + flip orders.cancelled_at +
  // cancel scheduled/failed installments. Returns refund_id + per-payment attribution.
  // SERVICE-ROLE only per RPC GRANT — we use serviceClient() not userClient.
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
    return jsonResponse(
      { error: "begin_failed", detail: beginErr.message },
      500,
    );
  }
  const begin = (beginData as BeginRpcResult | null) ?? { ok: false };
  if (!begin.ok) {
    const mapped = mapComputeReasonToHttp(begin.reason ?? "rpc_error");
    // issue #4522 G-3 / G-4 — a cancel that finished says so: its refund is
    // complete (an unfinished one is resumed by begin, never answered here).
    if (planV2 && mapped.code === "already_cancelled") {
      const { data: done } = await supabase.from("refunds")
        .select("amount_cents")
        .eq("order_id", orderId).eq("status", "succeeded")
        .not("metadata->trip_cancel->>completed_at", "is", null)
        .limit(1).maybeSingle();
      if (done) {
        return jsonResponse({
          error: mapped.code,
          detail: "Order is already cancelled and its refund is complete",
          operation: "completed",
          refundTotalCents: Number(done.amount_cents ?? 0),
        }, mapped.status);
      }
    }
    return jsonResponse(
      { error: mapped.code, detail: mapped.detail },
      mapped.status,
    );
  }

  const refundId = begin.refund_id ?? "";
  const computedRefundTotalCents = Number(begin.refund_total_cents ?? 0);
  // issue #4522 G-3 / G-4 — begin wrote this cancel's intended refunds on its
  // refunds row (or resumed them): every failure below leaves it in
  // progress for a host retry and the instalment run, never rolled back.
  const resumable = begin.operation === true;
  const resumed = begin.resume === true;
  if (resumed) {
    actorKind = begin.actor_kind === "buyer" ? "buyer" : "operator";
  }
  const cancelReason = resumed
    ? (typeof begin.cancel_reason === "string" ? begin.cancel_reason : "")
    : reasonRaw;
  if (resumed && mode !== "resume" && computedRefundTotalCents !== expectedRefundTotalCents) {
    // The cancel in progress refunds what it intended; nothing changes here.
    return jsonResponse({
      error: "policy_updated",
      detail: "Refresh to see the refund still being finished",
      currentRefundTotalCents: computedRefundTotalCents,
      currency: (begin.currency ?? "GBP").toLowerCase(),
      refundId,
    }, 409);
  }
  // issue #4522 (E-6) — a cancel whose refund comes to nothing has no refund
  // row (begin returns refund_id NULL): no provider, ledger or commit step
  // runs, and the notices are keyed by the order instead.
  const noRefund = refundId.length === 0 && computedRefundTotalCents === 0;
  const cancelNoticeKey = noRefund ? `order:${orderId}` : refundId;
  const currency = (begin.currency ?? "GBP").toLowerCase();
  const tierPct = Number(begin.tier_pct ?? 0);
  const perPaymentRefund = paymentRefundEntries(begin.per_payment_refund);
  const installmentsCancelled = (begin.installments_to_cancel ?? []).length;

  // issue #4522 G-3 / G-4 — one step of the cancel in progress, recorded on
  // its refunds row; ops are told once, only when it cannot finish (the 3rd
  // failure) or a second-provider refund was sent with no answer.
  let refusedCardCharge: string | null = null;
  const noteTripCancel = async (
    kind: "failure" | "waiting" | "unconfirmed" | "completed",
    detail: string | null,
    unconfirmed: string[] = [],
  ): Promise<{ alert: boolean; first_completion: boolean }> => {
    const { data, error } = await supabase.rpc("issue_4522_trip_cancel_note", {
      p_refund_id: refundId,
      p_kind: kind,
      p_detail: detail,
      p_refused_charge: refusedCardCharge,
    });
    if (error) {
      console.error("[cancel-trip-booking] cancel note failed", error.message);
      return { alert: false, first_completion: false };
    }
    const note = (data ?? {}) as { alert?: boolean; first_completion?: boolean };
    if (note.alert === true) {
      const made = await providerRefundsMade(supabase, refundId).catch(() => []);
      await alertTripCancelNotFinished(installmentOpsAlert, {
        orderId,
        refundId,
        currency,
        detail: detail ?? kind,
        made,
        intended: perPaymentRefund,
        unconfirmed,
        cause: kind === "unconfirmed" ? "unconfirmed" : "failure",
      });
    }
    return {
      alert: note.alert === true,
      first_completion: note.first_completion === true,
    };
  };
  const inProgressResponse = (detail: string) =>
    jsonResponse({
      error: "refund_in_progress",
      detail,
      refundId,
      refundTotalCents: computedRefundTotalCents,
      currency,
    }, 409);

  // SC-22 freshness re-check — if policy changed between preview and confirm,
  // the computed amount may differ from expectedRefundTotalCents.
  // CRITICAL: at this point we have already begun (orders.cancelled_at flipped,
  // installments cancelled, refund row pending). We must NOT proceed to Stripe
  // refund at the wrong amount. Rollback the begin via _rollback (marks refund
  // failed; orders.cancelled_at + installment cancels stay per v1 design).
  if (computedRefundTotalCents !== expectedRefundTotalCents) {
    // issue #4522 G-4 — checked before begin with the #4522 schema; a change
    // landing in between leaves the cancel in progress at begin's amount.
    if (!resumable) {
      await supabase.rpc("biz_cancel_trip_booking_rollback", {
        p_refund_id: refundId,
        p_failure_reason:
          `sc22_freshness_divergence: expected=${expectedRefundTotalCents}, computed=${computedRefundTotalCents}`,
      });
    }
    return jsonResponse(
      {
        error: "policy_updated",
        detail:
          "Cancellation policy was updated — refresh to see your new refund amount",
        currentRefundTotalCents: computedRefundTotalCents,
        currency,
        refundId,
      },
      409,
    );
  }

  // Step 2: connected-account lookup for Stripe refund calls.
  if (paymentProvider === "stripe" && !connectedAccountId && !noRefund) {
    if (resumable) {
      await noteTripCancel("failure", "missing_connected_account");
    } else {
      await supabase.rpc("biz_cancel_trip_booking_rollback", {
        p_refund_id: refundId,
        p_failure_reason: "missing_connected_account",
      });
    }
    return jsonResponse(
      {
        error: "missing_connected_account",
        detail: "brand has no Stripe connected account",
      },
      422,
    );
  }

  // issue #4522 pass 6 (S9-1) — after a failure: how many provider refunds of
  // this cancel were already made; when any, the one ops alert names them.
  const unrecordedRefundsAlert = async (detail: string): Promise<number> => {
    const made = await providerRefundsMade(supabase, refundId).catch(() => []);
    await alertUnrecordedTripRefund(installmentOpsAlert, { orderId, refundId, currency, detail, made });
    return made.length;
  };

  // Step 3: per-PI refund loop. One stripe.refunds.create per source PI.
  // Zero-refund tiers (refund_cents=0 for all rows) skip Stripe entirely.
  const stripe = paymentProvider === "stripe" ? stripeTicketRefund() : null;
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
  let paystackFailureRetryable = false;

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
    if (resumable) {
      await noteTripCancel("failure", "no_order_line_items");
    } else {
      await supabase.rpc("biz_cancel_trip_booking_rollback", {
        p_refund_id: refundId,
        p_failure_reason: "no_order_line_items",
      });
    }
    return jsonResponse(
      {
        error: "no_order_line_items",
        detail: "order has no line items to attribute refund against",
      },
      500,
    );
  }
  // v1 simplification: attribute every per-payment refund row to the FIRST line item.
  // Multi-line trip orders are not a Tr2/Tr3 pattern; future ORCH if multi-tier trips appear.
  const primaryLineItem = orderLineItems[0];
  const expectedStripeAttemptCount = perPaymentRefund.filter((entry) =>
    entry.refund_cents > 0 && entry.source_pi
  ).length;

  // issue #4522 G-3 — a resumed card refund replays its own attempt (same
  // fingerprint, same provider idempotency key): one made is read back, one
  // never sent is sent once. An attempt left unanswered for 20 hours is never
  // sent again (the provider forgets idempotency keys after 24): it waits for
  // ops. A new operation keys its attempts by the refund, not the request.
  const priorCardAttempts = new Map<
    string,
    { fingerprint: string; answered: boolean; createdAt: number }
  >();
  if (resumable && paymentProvider === "stripe" && refundId.length > 0) {
    const { data: prior } = await supabase.from("ticket_refund_attempts")
      .select("payment_intent_id, request_fingerprint, buyer_refund_id, created_at")
      .eq("refund_id", refundId);
    for (const a of (prior ?? []) as Record<string, unknown>[]) {
      priorCardAttempts.set(String(a.payment_intent_id), {
        fingerprint: String(a.request_fingerprint),
        answered: typeof a.buyer_refund_id === "string",
        createdAt: Date.parse(String(a.created_at)),
      });
    }
  }
  const unconfirmedPaystack: string[] = [];
  let providerStillAnswering = false;
  // issue #4522 G-4 — a card refund the provider refused (no money moved) is
  // tried again under a new provider key; one with no answer keeps its key.
  const cardTries = begin.card_tries ?? {};
  const cardProviderKey = (suffix: string): string => {
    const n = Number(cardTries[suffix] ?? 0);
    return n > 0
      ? `tr4_cancel:${refundId}:${suffix}:t${n}`
      : `tr4_cancel:${refundId}:${suffix}`;
  };

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
      console.warn(
        "[cancel-trip-booking] per-payment entry has no source_pi",
        entry,
      );
      continue;
    }
    try {
      if (paymentProvider === "paystack") {
        const merchantNote = `mingla_trip_refund:${refundId}:${
          entry.installment_id ?? "deposit"
        }`;
        const transaction = entry.source_pi;
        const amountSubunits = entry.refund_cents === entry.paid_cents
          ? undefined
          : entry.refund_cents;
        const persistOutcome = (made: { id: string; status: string }) =>
          persistPaystackRefundOutcome(
            () =>
              supabase.rpc("record_paystack_refund_outcome", {
                p_source_type: entry.installment_id === null
                  ? "order"
                  : "order_installment",
                p_source_id: entry.installment_id ?? orderId,
                p_local_refund_id: refundId,
                p_transaction_reference: transaction,
                p_merchant_note: merchantNote,
                p_provider_refund_id: made.id,
                p_amount_cents: entry.refund_cents,
                p_status: paystackRefundOutcomeStatus(made.status),
              }),
            "cancel-trip-booking",
          );
        // issue #4522 G-3 / G-4 — a refund of this cancel already made is
        // recorded, never sent again; one sent with no answer is only read
        // back (never re-sent: ops get it once if the provider has none).
        let created: { id: string; status: string } | null = null;
        let attemptRow: Record<string, unknown> | null = null;
        if (resumable) {
          const { data: att } = await supabase.from("paystack_refund_attempts")
            .select("status, provider_refund_id, error_message")
            .eq("local_refund_id", refundId).eq("merchant_note", merchantNote)
            .maybeSingle();
          attemptRow = (att ?? null) as Record<string, unknown> | null;
          if (attemptRow?.status === "failed") {
            throw new Error("paystack_refund_refused_at_provider");
          }
          if (
            attemptRow !== null &&
            (attemptRow.status === "processed" ||
              attemptRow.status === "accepted" ||
              typeof attemptRow.provider_refund_id === "string")
          ) {
            created = {
              id: String(attemptRow.provider_refund_id ?? ""),
              status: String(attemptRow.status),
            };
          } else if (attemptRow?.error_message === "provider_call_started") {
            const found = await reconcilePaystackRefund({
              transaction,
              merchantNote,
              amountSubunits,
              currency: "NGN",
            }).catch(() => null);
            if (found === null) {
              unconfirmedPaystack.push(merchantNote);
              continue;
            }
            created = found;
            await persistOutcome(found);
          }
        }
        if (created === null) {
          if (attemptRow === null) {
            const { error: attemptError } = await supabase.rpc(
              "record_paystack_refund_outcome",
              {
                p_source_type: entry.installment_id === null
                  ? "order"
                  : "order_installment",
                p_source_id: entry.installment_id ?? orderId,
                p_local_refund_id: refundId,
                p_transaction_reference: transaction,
                p_merchant_note: merchantNote,
                p_provider_refund_id: null,
                p_amount_cents: entry.refund_cents,
                p_status: "pending",
              },
            );
            if (attemptError) {
              throw new Error(
                `paystack_refund_attempt_persist_failed: ${attemptError.message}`,
              );
            }
          }
          if (resumable) {
            const { data: claimed, error: claimError } = await supabase.rpc(
              "issue_4522_claim_trip_paystack_send",
              { p_refund_id: refundId, p_merchant_note: merchantNote },
            );
            if (claimError) {
              throw new Error(`paystack_refund_claim_failed: ${claimError.message}`);
            }
            if (claimed !== true) {
              unconfirmedPaystack.push(merchantNote);
              continue;
            }
          }
          try {
            created = await createPaystackRefund({
              transaction,
              merchantNote,
              amountSubunits,
              currency: "NGN",
            });
          } catch (sendErr) {
            // The provider refused it (no money moved): it may be sent later.
            if (
              resumable && sendErr instanceof PaystackApiError &&
              !isRetryablePaystackRefundError(sendErr)
            ) {
              await supabase.rpc("issue_4522_claim_trip_paystack_send", {
                p_refund_id: refundId,
                p_merchant_note: merchantNote,
                p_release: true,
              });
            }
            throw sendErr;
          }
          await persistOutcome(created);
        }
        if (resumable && paystackRefundOutcomeStatus(created.status) === "failed") {
          throw new Error("paystack_refund_refused_at_provider");
        }
        if (entry.installment_id !== null) {
          const { error: markError } = await supabase.rpc(
            "issue_3645_mark_installment_refunded",
            {
              p_installment_id: entry.installment_id,
              p_refund_id: refundId,
              p_amount_cents: entry.refund_cents,
            },
          );
          if (markError !== null) {
            throw new Error(
              `installment_refund_mark_failed: ${markError.message}`,
            );
          }
        }
        stripeRefundIds.push(created.id);
        refundLineRowsToInsert.push({
          refund_id: refundId,
          order_line_item_id: primaryLineItem.id,
          ticket_type_id: primaryLineItem.ticket_type_id,
          quantity: primaryLineItem.quantity,
          amount_cents: entry.refund_cents,
          installment_id: entry.installment_id,
        });
        continue;
      }
      if (!stripe || !connectedAccountId) {
        throw new Error("stripe_missing_connected_account");
      }
      const prior = priorCardAttempts.get(entry.source_pi);
      const cardFingerprint = !resumable
        ? `${idempotencyKey}:${entry.installment_id ?? "deposit"}`
        : prior?.fingerprint ??
          `tr4_cancel:${refundId}:${entry.installment_id ?? "deposit"}`;
      const staleUnanswered = prior !== undefined && !prior.answered &&
        Date.now() - prior.createdAt > 20 * 3600 * 1000;
      const feeTruth = await executeTicketRefundWithFeeTruth({
        ...(staleUnanswered ? { allowProviderMutation: false } : {}),
        supabase,
        stripe,
        refundId,
        orderId,
        paymentIntentId: entry.source_pi,
        connectedAccountId,
        expectedCurrency: entry.currency || currency,
        // Legacy installment rows predate per-PI fee persistence. The shared
        // resolver adopts only the authenticated Fee bound to this exact PI;
        // it never estimates a percentage.
        expectedApplicationFeeAmount: null,
        requestedRefundAmount: entry.refund_cents,
        requestFingerprint: cardFingerprint,
        providerIdempotencyKey: cardProviderKey(entry.installment_id ?? "deposit"),
        expectedAttemptCount: expectedStripeAttemptCount,
        createBuyerRefund: () =>
          stripe.refunds.create(
            {
              payment_intent: entry.source_pi,
              amount: entry.refund_cents,
              reason: "requested_by_customer",
              refund_application_fee: true,
              metadata: {
                mingla_refund_id: refundId,
                mingla_order_id: orderId,
                mingla_installment_id: entry.installment_id ?? "",
                // same parameters on every replay of this refund's key
                mingla_idempotency_key: resumable
                  ? `tr4_cancel:${refundId}`
                  : idempotencyKey,
                mingla_tr4_cancel: "true",
              },
            },
            {
              idempotencyKey: cardProviderKey(entry.installment_id ?? "deposit"),
              stripeAccount: connectedAccountId,
            },
          ),
      });
      const result: StripeRefundResult = {
        id: feeTruth.buyerRefundId ?? "",
        status: feeTruth.status === "succeeded_positive" ||
            feeTruth.status === "not_applicable"
          ? "succeeded"
          : "pending",
        amount: entry.refund_cents,
      };
      if (
        feeTruth.status !== "succeeded_positive" &&
        feeTruth.status !== "not_applicable"
      ) {
        stripeFailureDetail = `fee_truth_${feeTruth.status}`;
        // the provider is still answering (its own read-back finishes it)
        providerStillAnswering = feeTruth.status === "pending_visibility" ||
          feeTruth.status === "awaiting_application_fee";
        break;
      }
      if (result.status === "failed" || result.status === "canceled") {
        stripeFailureDetail =
          `stripe refund status=${result.status} on installment_id=${
            entry.installment_id ?? "deposit"
          }`;
        break;
      }
      stripeRefundIds.push(result.id);
      if (entry.installment_id !== null) {
        const { error: markError } = await supabase.rpc(
          "issue_3645_mark_installment_refunded",
          {
            p_installment_id: entry.installment_id,
            p_refund_id: refundId,
            p_amount_cents: entry.refund_cents,
          },
        );
        if (markError !== null) {
          throw new Error(
            `installment_refund_mark_failed: ${markError.message}`,
          );
        }
      }
      refundLineRowsToInsert.push({
        refund_id: refundId,
        order_line_item_id: primaryLineItem.id,
        ticket_type_id: primaryLineItem.ticket_type_id,
        quantity: primaryLineItem.quantity,
        amount_cents: entry.refund_cents,
        installment_id: entry.installment_id,
      });
      totalApplicationFeeRefunded += feeTruth.applicationFeeRefundedCents ?? 0;
    } catch (err) {
      stripeFailureDetail = err instanceof Error ? err.message : String(err);
      const status = Number((err as { statusCode?: unknown })?.statusCode ?? 0);
      if (
        resumable && paymentProvider === "stripe" && status >= 400 &&
        status < 500 && status !== 409 && status !== 429
      ) {
        refusedCardCharge = entry.installment_id ?? "deposit";
      }
      paystackFailureRetryable = paymentProvider === "paystack" &&
        isRetryablePaystackRefundError(err);
      break;
    }
  }

  // issue #4522 G-3 / G-4 — the cancel stays in progress: nothing is rolled
  // back; the next host retry or instalment run resumes it from here.
  if (resumable && (stripeFailureDetail !== null || unconfirmedPaystack.length > 0)) {
    console.error("[cancel-trip-booking] cancel in progress", {
      refundId,
      stripeFailureDetail,
      unconfirmed: unconfirmedPaystack.length,
    });
    if (stripeFailureDetail !== null) {
      await noteTripCancel(
        providerStillAnswering ? "waiting" : "failure",
        stripeFailureDetail,
      );
    }
    if (unconfirmedPaystack.length > 0) {
      await noteTripCancel(
        "unconfirmed",
        `second_provider_refund_unanswered: ${unconfirmedPaystack.join(",")}`,
        unconfirmedPaystack,
      );
    }
    return inProgressResponse(
      stripeFailureDetail ?? "second_provider_refund_unanswered",
    );
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
    // issue #4522 pass 6 (S9-1) — money the provider already returned keeps
    // its refund pending (never "failed"), so it is still finished and
    // recorded; ops are told once.
    const made = await unrecordedRefundsAlert(stripeFailureDetail);
    if (!paystackFailureRetryable) {
      if (made === 0) {
        await supabase.rpc("biz_cancel_trip_booking_rollback", {
          p_refund_id: refundId,
          p_failure_reason: stripeFailureDetail,
        });
      }
    }
    return jsonResponse(
      {
        error: paystackFailureRetryable
          ? "paystack_refund_retryable"
          : paymentProvider === "paystack"
          ? "paystack_refund_failed"
          : "stripe_refund_failed",
        detail: stripeFailureDetail,
        refundId,
        partialSucceededRefunds: stripeRefundIds.length,
      },
      paystackFailureRetryable ? 503 : 502,
    );
  }

  // Step 4: insert refund_line_items rows (one per Stripe refund call).
  // Trigger tg_refund_line_items_installment_parity enforces
  // I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY at write time.
  if (refundLineRowsToInsert.length > 0) {
    // issue #4522 G-3 — a resumed cancel writes only the lines not yet written.
    const { error: insertError } = await (resumable
      ? supabase.from("refund_line_items").upsert(refundLineRowsToInsert, {
        onConflict: "refund_id,order_line_item_id,installment_id",
        ignoreDuplicates: true,
      })
      : supabase.from("refund_line_items").insert(refundLineRowsToInsert));
    if (insertError && resumable) {
      await noteTripCancel("failure", `ledger_insert_failed: ${insertError.message}`);
      return inProgressResponse(`ledger_insert_failed: ${insertError.message}`);
    }
    if (insertError) {
      // Stripe refund succeeded but local ledger insert failed.
      // Webhook reconciliation will catch this; refunds.status=failed surfaces
      // the issue. Mark commit as failed but DO NOT roll back orders.cancelled_at —
      // booking IS cancelled (and Stripe IS refunded — buyer gets their money).
      console.error(
        "[cancel-trip-booking] refund_line_items insert failed",
        insertError,
      );
      if (await unrecordedRefundsAlert(`ledger_insert_failed: ${insertError.message}`) === 0) {
        await supabase.rpc("biz_cancel_trip_booking_rollback", {
          p_refund_id: refundId,
          p_failure_reason: `ledger_insert_failed: ${insertError.message}`,
        });
      }
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
  // Legacy #1175 ordering sentinel: const { data: commitData, error: commitErr } = await supabase.rpc(
  const { data: commitData, error: commitErr } =
    await (paymentProvider === "paystack" && !noRefund
      ? supabase.rpc("biz_cancel_trip_booking_commit", {
        p_refund_id: refundId,
        p_stripe_refund_ids: stripeRefundIds.length > 0
          ? stripeRefundIds
          : [""],
        p_application_fee_refunded_cents: 0,
        p_processed_at: new Date().toISOString(),
      })
      : Promise.resolve({ data: { ok: true }, error: null }));
  if (paymentProvider === "paystack" && !noRefund && !commitErr) {
    await supabase.rpc("issue_2097_finalize_not_applicable", {
      p_refund_id: refundId,
      p_provider: "paystack",
      p_provider_refund_id: stripeRefundIds.join(","),
    });
  }
  // issue #4522 G-3 / G-4 — the cancel completes only when its refund is
  // settled in our books (card: the last attempt's finalize; second provider:
  // the commit, or the commit of an earlier run of this same cancel). Then
  // its final status is set and it is marked complete exactly once.
  let firstCompletion = !resumable;
  if (resumable && !noRefund) {
    if (commitErr) {
      await noteTripCancel("failure", `commit_failed: ${commitErr.message}`);
      return inProgressResponse(`commit_failed: ${commitErr.message}`);
    }
    const { data: settledRow } = await supabase.from("refunds")
      .select("status").eq("id", refundId).maybeSingle();
    if (settledRow?.status !== "succeeded") {
      await noteTripCancel("waiting", "refund_not_yet_settled");
      return inProgressResponse("refund_not_yet_settled");
    }
    const { error: settleError } = await supabase.rpc(
      "issue_4522_settle_trip_cancel_status",
      { p_order_id: orderId },
    );
    if (settleError) {
      await noteTripCancel("failure", `status_settle_failed: ${settleError.message}`);
      return inProgressResponse(`status_settle_failed: ${settleError.message}`);
    }
    firstCompletion = (await noteTripCancel("completed", null)).first_completion;
  } else if (commitErr || !commitData || !(commitData as { ok: boolean }).ok) {
    // Critical: Stripe succeeded + ledger rows written but refund commit failed.
    // The refund-status reconciliation cron can recover; surface to caller.
    console.error(
      "[cancel-trip-booking] commit RPC failed after Stripe + ledger success",
      commitErr,
    );
    await unrecordedRefundsAlert(`commit_failed: ${commitErr?.message ?? "not_ok"}`);
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

  const buyerEmail = typeof orderDetail?.buyer_email === "string"
    ? orderDetail.buyer_email
    : "";

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
      reason: cancelReason.length > 0 ? cancelReason : null,
      refundIssued: computedRefundTotalCents > 0,
      refund_record_id: refundId,
    };

    // buyer_order_cancelled (the cancellation email)
    const { error: notif1Err } = await supabase.from(
      "ticket_order_notifications",
    ).insert({
      order_id: orderId,
      event_id: orderDetail?.event_id ?? eventId,
      channel: "email",
      recipient: buyerEmail,
      status: "pending",
      idempotency_key: `tr4_cancel:${cancelNoticeKey}:cancelled`,
      attempt_count: 0,
      payload: {
        template_key: "buyer_order_cancelled",
        ...baseNotifPayload,
      },
    });
    if (notif1Err) {
      console.error(
        "[cancel-trip-booking] buyer_order_cancelled notification enqueue failed (non-fatal)",
        notif1Err.message,
      );
    }

    // buyer_refund_issued (only when refund > 0)
    if (computedRefundTotalCents > 0) {
      const { error: notif2Err } = await supabase.from(
        "ticket_order_notifications",
      ).insert({
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
        console.error(
          "[cancel-trip-booking] buyer_refund_issued notification enqueue failed (non-fatal)",
          notif2Err.message,
        );
      }
    }

    // Inline-dispatch so emails go out immediately. Mirrors refund-order pattern.
    // Failures are NON-FATAL — the notification-retry-sweeper picks up failed rows.
    try {
      await dispatchTicketConfirmation(orderId);
    } catch (dispatchErr) {
      console.error(
        "[cancel-trip-booking] inline dispatch failed (non-fatal)",
        dispatchErr,
      );
    }
  } else {
    console.warn(
      "[cancel-trip-booking] no buyer_email; skipping notification enqueue",
      { orderId },
    );
  }

  // Step 7: audit row (once per cancel: a resumed one that another run
  // already completed writes none).
  try {
    if (firstCompletion) await writeAudit(supabase, {
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
        payment_provider: paymentProvider,
        installments_cancelled: installmentsCancelled,
        reason: cancelReason.length > 0 ? cancelReason : null,
      },
    });
  } catch (auditError) {
    console.error(
      "[cancel-trip-booking] audit write failed (non-fatal)",
      auditError,
    );
  }

  // issue #4522 (N2) — any overpayment still held goes back now, in full,
  // through its own refund (the sweep retries it if the provider is slow).
  let overpaymentReturn = 0;
  if (await planV2SchemaAvailable(supabase)) {
    const { data: balance } = await supabase.rpc("issue_4522_balance", { p_order_id: orderId });
    const held = Number((balance as { heldCreditMinor?: unknown } | null)?.heldCreditMinor ?? 0);
    overpaymentReturn = Number.isSafeInteger(held) && held > 0 ? held : 0;
    if (overpaymentReturn > 0) await returnOrderOverpaymentsBestEffort(supabase, orderId);
  }

  // Final success response — buyer UI shows success state; operator UI dismisses sheet.
  return jsonResponse({
    ...(overpaymentReturn > 0 ? { overpaymentReturnCents: overpaymentReturn } : {}),
    ok: true,
    mode: actorKind,
    refundId,
    refundAmountCents: computedRefundTotalCents,
    currency,
    tierPct,
    tierKind: "computed",
    stripeRefundIds,
    paymentProvider,
    installmentsCancelled,
    processedAt: new Date().toISOString(),
  });
});
