// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { StripeClient } from "./stripe.ts";
import { STRIPE_API_VERSION } from "./stripe.ts";
import { generateIdempotencyKey } from "./idempotency.ts";
import { writeAudit } from "./audit.ts";
import {
  dispatchNotification,
  getBrandPaymentManagerUserIds,
} from "./stripeEdgeAuth.ts";
import { qrTokenPepper } from "./ticketCheckout.ts";
// ORCH-0869 [Tr3 Installment Payments]: discriminator + handlers for
// installment PaymentIntent events. See SPEC §3.2.3.
import {
  isInstallmentPaymentIntentEvent,
  handleInstallmentPaymentSucceeded,
  handleInstallmentPaymentFailed,
} from "./installmentWebhookHandlers.ts";
import {
  getKycRemediationForRequirements,
  mapPayoutFailureCode,
} from "./stripeKycRemediation.ts";
// ORCH-0808 — AppsFlyer S2S poster for revenue + milestone events.
import {
  postAppsFlyerS2SEvent,
  resolveBrandOwnerUserId,
  claimBrandMilestone,
} from "./appsFlyerS2S.ts";

export const STRIPE_ROUTED_EVENT_TYPES = [
  "account.updated",
  "account.application.deauthorized",
  "account.external_account.created",
  "account.external_account.updated",
  "account.external_account.deleted",
  "capability.updated",
  "payout.created",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
  "charge.refund.updated",
  // ORCH-0787: subscribe to the modern Stripe refund event family for full coverage
  // beyond the legacy charge.refund.updated event. STRIPE_API_VERSION '2026-04-22.dahlia'
  // emits all three under different conditions; the reconciler is idempotent across them.
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "person.created",
  "person.updated",
  "person.deleted",
  "application_fee.created",
  "application_fee.refunded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  // ORCH-0790: web Checkout Sessions emit this when the buyer completes
  // payment on the Stripe-hosted page. We use it to record the
  // PaymentIntent id against our session so the payment_intent.succeeded
  // event arriving shortly after can finalise via the existing path.
  "checkout.session.completed",
] as const;

export type RoutedStripeEventType = typeof STRIPE_ROUTED_EVENT_TYPES[number];

export interface StripeWebhookEvent {
  id: string;
  type: string;
  account?: string | null;
  data: { object: Record<string, unknown> };
}

export interface RouteStripeEventResult {
  processed: boolean;
  eventType: string;
  brandId: string | null;
}

function objectString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function accountIdForEvent(event: StripeWebhookEvent): string | null {
  if (typeof event.account === "string" && event.account.length > 0) {
    return event.account;
  }
  const object = event.data.object;
  if (event.type === "account.updated") return objectString(object, "id");
  return objectString(object, "account");
}

function char3(currency: unknown, fallback = "GBP"): string {
  return (typeof currency === "string" && currency.length > 0 ? currency : fallback)
    .trim()
    .toUpperCase()
    .padEnd(3, " ")
    .slice(0, 3);
}

function dateFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function normalizeExternalAccountStatus(status: unknown): string {
  if (status === "verified" || status === "validated") return "verified";
  if (status === "verification_failed") return "verification_failed";
  if (status === "errored") return "errored";
  return "verification_pending";
}

async function brandIdForStripeAccount(
  supabase: SupabaseClient,
  stripeAccountId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("stripe_connect_accounts")
    .select("brand_id")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (error) throw new Error(`brand lookup failed: ${error.message}`);
  return data?.brand_id ?? null;
}

async function notifyBrandManagers(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    relatedId?: string | null;
    relatedType?: string | null;
    idempotencyKey: string;
    deepLink?: string | null;
  },
): Promise<void> {
  const userIds = await getBrandPaymentManagerUserIds(supabase, input.brandId);
  for (const userId of userIds) {
    await dispatchNotification({
      userId,
      brandId: input.brandId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      relatedId: input.relatedId,
      relatedType: input.relatedType,
      idempotencyKey: `${input.idempotencyKey}:${userId}`,
      deepLink: input.deepLink,
    });
  }
}

async function syncAccount(
  supabase: SupabaseClient,
  account: Record<string, unknown>,
  eventId: string,
): Promise<string | null> {
  const stripeAccountId = objectString(account, "id");
  if (!stripeAccountId) throw new Error("account event missing account.id");

  const prior = await supabase
    .from("stripe_connect_accounts")
    .select("brand_id, charges_enabled, payouts_enabled, requirements")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (prior.error) throw new Error(`account prior lookup failed: ${prior.error.message}`);

  const metadata = account.metadata as Record<string, unknown> | undefined;
  const brandId = prior.data?.brand_id ??
    (typeof metadata?.mingla_brand_id === "string" ? metadata.mingla_brand_id : null);
  if (!brandId) return null;

  const requirements = (account.requirements ?? {}) as Record<string, unknown>;
  const updatePayload: Record<string, unknown> = {
    brand_id: brandId,
    stripe_account_id: stripeAccountId,
    controller_dashboard_type: "express",
    charges_enabled: account.charges_enabled === true,
    payouts_enabled: account.payouts_enabled === true,
    requirements,
    updated_at: new Date().toISOString(),
  };
  if (typeof account.country === "string") {
    updatePayload.country = account.country.toUpperCase();
  }
  if (typeof account.default_currency === "string") {
    updatePayload.default_currency = account.default_currency.toUpperCase();
  }
  if (account.charges_enabled === true) {
    updatePayload.kyc_stall_reminder_sent_at = null;
  }

  const { error } = await supabase
    .from("stripe_connect_accounts")
    .upsert(updatePayload, { onConflict: "brand_id" });
  if (error) throw new Error(`stripe_connect_accounts upsert failed: ${error.message}`);

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: eventId,
    action: "stripe_connect.account_updated",
    target_type: "stripe_connect_account",
    target_id: stripeAccountId,
    before: prior.data
      ? {
        charges_enabled: prior.data.charges_enabled,
        payouts_enabled: prior.data.payouts_enabled,
        requirements: prior.data.requirements,
      }
      : null,
    after: {
      charges_enabled: account.charges_enabled === true,
      payouts_enabled: account.payouts_enabled === true,
      requirements,
      remediation: getKycRemediationForRequirements(requirements),
    },
  });

  // ORCH-0808 — AppsFlyer S2S: fire mingla_stripe_connect_activated exactly
  // once per brand on the first charges_enabled true. Idempotent via
  // brand_appsflyer_milestones.first_activated_at — restriction→un-restriction
  // cycles do NOT re-fire. Never propagates failure to Stripe.
  if (account.charges_enabled === true) {
    try {
      const isFirst = await claimBrandMilestone(
        supabase,
        brandId,
        "first_activated_at",
      );
      if (isFirst) {
        const ownerUserId = await resolveBrandOwnerUserId(supabase, brandId);
        if (ownerUserId) {
          await postAppsFlyerS2SEvent({
            supabase,
            userId: ownerUserId,
            eventName: "mingla_stripe_connect_activated",
            eventValues: {
              brand_id: brandId,
              stripe_account_id: stripeAccountId,
            },
          });
        }
      }
    } catch (afError) {
      console.warn(
        "[stripe-webhook] AppsFlyer connect-activated S2S threw:",
        afError instanceof Error ? afError.message : String(afError),
      );
    }
  }

  return brandId;
}

async function refreshAccountById(
  supabase: SupabaseClient,
  stripe: StripeClient,
  stripeAccountId: string,
  eventId: string,
): Promise<string | null> {
  const brandId = await brandIdForStripeAccount(supabase, stripeAccountId);
  const keyOwner = brandId ?? stripeAccountId;
  // @ts-ignore — Stripe SDK Accounts namespace is runtime-provided.
  const account = await stripe.accounts.retrieve(stripeAccountId, {
    apiVersion: STRIPE_API_VERSION,
    idempotencyKey: generateIdempotencyKey(keyOwner, "webhook_account_retrieve"),
  });
  return syncAccount(supabase, account as Record<string, unknown>, eventId);
}

async function handleExternalAccount(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const stripeAccountId = accountIdForEvent(event);
  if (!stripeAccountId) throw new Error(`${event.type} missing connected account id`);
  const brandId = await brandIdForStripeAccount(supabase, stripeAccountId);
  if (!brandId) return null;

  const external = event.data.object;
  const externalId = objectString(external, "id");
  if (!externalId) throw new Error(`${event.type} missing external_account.id`);

  if (event.type === "account.external_account.deleted") {
    const { error } = await supabase
      .from("stripe_external_accounts")
      .delete()
      .eq("stripe_external_account_id", externalId);
    if (error) throw new Error(`external account delete failed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from("stripe_external_accounts")
      .upsert(
        {
          brand_id: brandId,
          stripe_account_id: stripeAccountId,
          stripe_external_account_id: externalId,
          type: objectString(external, "object") === "card" ? "card" : "bank_account",
          last4: objectString(external, "last4"),
          currency: char3(external.currency),
          country: (objectString(external, "country") ?? "GB").toUpperCase().slice(0, 2),
          status: normalizeExternalAccountStatus(external.status),
          default_for_currency: external.default_for_currency === true,
          raw_payload: external,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_external_account_id" },
      );
    if (error) throw new Error(`external account upsert failed: ${error.message}`);

    if (normalizeExternalAccountStatus(external.status) === "verification_failed") {
      await notifyBrandManagers(supabase, {
        brandId,
        type: "stripe.bank_verification_failed",
        title: "Bank verification failed",
        body: "Stripe could not verify the payout bank account. Re-verify it from Payments.",
        data: { stripe_account_id: stripeAccountId, external_account_id: externalId },
        relatedId: externalId,
        relatedType: "stripe_external_account",
        idempotencyKey: `stripe.bank_verification_failed:${externalId}:${event.id}`,
        deepLink: `mingla-business://brand/${brandId}/payments`,
      });
    }
  }

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: event.id,
    action: `stripe_connect.${event.type}`,
    target_type: "stripe_external_account",
    target_id: externalId,
    after: external,
  });
  return brandId;
}

async function handlePayout(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const stripeAccountId = accountIdForEvent(event);
  if (!stripeAccountId) throw new Error(`${event.type} missing connected account id`);
  const brandId = await brandIdForStripeAccount(supabase, stripeAccountId);
  if (!brandId) return null;

  const payout = event.data.object;
  const payoutId = objectString(payout, "id");
  if (!payoutId) throw new Error(`${event.type} missing payout.id`);
  const rawStatus = objectString(payout, "status") ?? "pending";
  const status = rawStatus === "in_transit" ? "in_transit" : rawStatus;
  const { error } = await supabase.from("payouts").upsert(
    {
      brand_id: brandId,
      stripe_payout_id: payoutId,
      amount_cents: Number(payout.amount ?? 0),
      currency: char3(payout.currency),
      status,
      arrival_date: dateFromUnixSeconds(payout.arrival_date),
    },
    { onConflict: "stripe_payout_id" },
  );
  if (error) throw new Error(`payout upsert failed: ${error.message}`);

  if (event.type === "payout.failed") {
    const failureCode = objectString(payout, "failure_code") ?? "unknown";
    const remediation = mapPayoutFailureCode(failureCode);
    await notifyBrandManagers(supabase, {
      brandId,
      type: "stripe.payout_failed",
      title: "Stripe payout failed",
      body: remediation,
      data: { stripe_payout_id: payoutId, failure_code: failureCode, remediation },
      relatedId: payoutId,
      relatedType: "payout",
      idempotencyKey: `stripe.payout_failed:${payoutId}:${failureCode}`,
      deepLink: `mingla-business://brand/${brandId}/payments`,
    });
  }

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: event.id,
    action: `stripe_connect.${event.type}`,
    target_type: "payout",
    target_id: payoutId,
    after: payout,
  });

  // ORCH-0808 — AppsFlyer S2S: fire mingla_first_payout exactly once per
  // brand on the first paid payout. Other payout statuses (created, failed,
  // canceled, in_transit) do NOT trigger the milestone. Idempotent via
  // brand_appsflyer_milestones. Never propagates failure to Stripe.
  if (event.type === "payout.paid") {
    try {
      const isFirst = await claimBrandMilestone(
        supabase,
        brandId,
        "first_payout_at",
      );
      if (isFirst) {
        const ownerUserId = await resolveBrandOwnerUserId(supabase, brandId);
        if (ownerUserId) {
          const amountCents = Number(payout.amount ?? 0);
          const currency = char3(payout.currency, "USD");
          await postAppsFlyerS2SEvent({
            supabase,
            userId: ownerUserId,
            eventName: "mingla_first_payout",
            eventValues: {
              af_revenue: Math.round(amountCents) / 100,
              af_currency: currency,
              brand_id: brandId,
              stripe_payout_id: payoutId,
            },
          });
        }
      }
    } catch (afError) {
      console.warn(
        "[stripe-webhook] AppsFlyer first-payout S2S threw:",
        afError instanceof Error ? afError.message : String(afError),
      );
    }
  }

  return brandId;
}

async function handleDeauthorized(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const stripeAccountId = accountIdForEvent(event);
  if (!stripeAccountId) throw new Error("account.application.deauthorized missing account id");
  const brandId = await brandIdForStripeAccount(supabase, stripeAccountId);
  if (!brandId) return null;

  const { error } = await supabase
    .from("stripe_connect_accounts")
    .update({ detached_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("stripe_account_id", stripeAccountId);
  if (error) throw new Error(`deauthorize soft detach failed: ${error.message}`);

  await notifyBrandManagers(supabase, {
    brandId,
    type: "stripe.account_deauthorized",
    title: "Stripe was disconnected",
    body: "Stripe notified us that this brand's payout account was disconnected.",
    data: { stripe_account_id: stripeAccountId },
    relatedId: stripeAccountId,
    relatedType: "stripe_connect_account",
    idempotencyKey: `stripe.account_deauthorized:${stripeAccountId}:${event.id}`,
    deepLink: `mingla-business://brand/${brandId}/payments`,
  });

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: event.id,
    action: "stripe_connect.account_deauthorized",
    target_type: "stripe_connect_account",
    target_id: stripeAccountId,
    after: { detached_at: true },
  });
  return brandId;
}

/**
 * ORCH-0787: handle refund event family (charge.refund.updated, charge.refunded,
 * refund.created, refund.updated).
 *
 * Reconciles into public.refunds via biz_refund_order_commit_from_webhook:
 *   - Match by stripe_refund_id (idempotent webhook replay).
 *   - Match by metadata.idempotency_key (in-app refund pending, Stripe-acked before commit
 *     RPC fires — race mitigation per SPEC §15 highest-risk implementation detail).
 *   - Otherwise create a new succeeded refund row (dashboard-initiated refund).
 *
 * For detached connected accounts (orphan path), preserves the legacy audit-only
 * behaviour because there is no in-app order to advance.
 */
async function handleRefundEvent(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const refund = event.data.object;
  const refundId = objectString(refund, "id");
  if (!refundId) {
    throw new Error(`${event.type} missing refund.id`);
  }
  const paymentIntentId = objectString(refund, "payment_intent");
  const stripeAccountId = accountIdForEvent(event);
  const refundStatus = objectString(refund, "status") ?? "succeeded";
  const amountCents = Number(refund.amount ?? 0);
  const currency = char3(refund.currency);
  const metadata = (refund.metadata ?? {}) as Record<string, unknown>;
  const idempotencyHint = typeof metadata.mingla_idempotency_key === "string"
    ? metadata.mingla_idempotency_key
    : null;
  const orderIdHint = typeof metadata.mingla_order_id === "string"
    ? metadata.mingla_order_id
    : null;

  // Resolve brand (and detect detached/orphan accounts).
  let brandId: string | null = null;
  let detachedAt: string | null = null;
  if (stripeAccountId) {
    const { data, error } = await supabase
      .from("stripe_connect_accounts")
      .select("brand_id, detached_at")
      .eq("stripe_account_id", stripeAccountId)
      .maybeSingle();
    if (error) throw new Error(`refund account lookup failed: ${error.message}`);
    brandId = data?.brand_id ?? null;
    detachedAt = data?.detached_at ?? null;
  }

  // Detached/orphan account: preserve legacy audit-only behaviour. The
  // BrandStripeOrphanedRefundsSection surfaces these from payment_webhook_events.
  if (brandId && detachedAt) {
    await writeAudit(supabase, {
      user_id: null,
      brand_id: brandId,
      event_id: event.id,
      action: "stripe_connect.detached_refund_updated",
      target_type: "detached_refund",
      target_id: refundId,
      after: refund,
    });
    return brandId;
  }

  // Only act on settled refunds. Stripe also emits refund.created/refund.updated for
  // pending and canceled refunds; we treat 'succeeded' as the trigger for state advance.
  if (refundStatus !== "succeeded") {
    await writeAudit(supabase, {
      user_id: null,
      brand_id: brandId,
      event_id: event.id,
      action: `stripe.${event.type}.${refundStatus}`,
      target_type: "refund",
      target_id: refundId,
      after: refund,
    });
    return brandId;
  }

  // Find the order. Prefer metadata.mingla_order_id (set by refund-order edge function);
  // fallback to lookup by payment_intent_id.
  let orderId: string | null = orderIdHint;
  if (!orderId && paymentIntentId) {
    const { data: orderRow, error: orderLookupError } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (orderLookupError) {
      throw new Error(`order lookup failed: ${orderLookupError.message}`);
    }
    orderId = orderRow?.id ?? null;
  }

  if (!orderId) {
    // Truly orphan: no matching order. Audit and let the orphan section surface it.
    await writeAudit(supabase, {
      user_id: null,
      brand_id: brandId,
      event_id: event.id,
      action: `stripe.${event.type}.orphan`,
      target_type: "refund",
      target_id: refundId,
      after: refund,
    });
    return brandId;
  }

  // Reconcile into public.refunds (UPSERT path + ticket void + status advance).
  // The RPC is SECURITY DEFINER service-role and handles both:
  //   - Match-existing-by-stripe_refund_id (idempotent webhook replay).
  //   - Match-existing-by-metadata.idempotency_key (race: in-app refund pending).
  //   - Create-new-succeeded (dashboard-initiated refund).
  const { error: commitError } = await supabase.rpc(
    "biz_refund_order_commit_from_webhook",
    {
      p_order_id: orderId,
      p_stripe_refund_id: refundId,
      p_amount_cents: amountCents,
      p_currency: currency,
      p_application_fee_refunded_cents: Number(refund.application_fee_refunded ?? 0),
      p_idempotency_key_hint: idempotencyHint,
    },
  );

  if (commitError) {
    throw new Error(`refund webhook commit failed: ${commitError.message}`);
  }

  // Enqueue buyer notification only if this was a NEW (dashboard-initiated) refund.
  // The in-app refund-order edge function already enqueued one; we detect by checking
  // whether the refund row had a NULL stripe_refund_id before this call — but we
  // can't tell post-hoc. Simpler: idempotency_key on ticket_order_notifications
  // makes the enqueue safe. Use refund:<order>:<stripe_refund_id> — same key as
  // the edge function. ORCH-0788 dispatcher routes by template_key.
  const { data: orderDetail } = await supabase
    .from("orders")
    .select("event_id, buyer_email, currency")
    .eq("id", orderId)
    .maybeSingle();

  if (orderDetail?.buyer_email && orderDetail.buyer_email.length > 0) {
    await supabase.from("ticket_order_notifications").upsert(
      {
        order_id: orderId,
        event_id: orderDetail.event_id,
        channel: "email",
        recipient: orderDetail.buyer_email,
        status: "pending",
        idempotency_key: `refund:${orderId}:${refundId}`,
        attempt_count: 0,
        payload: {
          template_key: "buyer_refund_issued",
          amount_cents: amountCents,
          currency: String(orderDetail.currency ?? currency),
          reason: "Dashboard-initiated refund (Stripe)",
          is_full_refund: false,
          stripe_refund_id: refundId,
          source: "webhook_reconciliation",
        },
      },
      { onConflict: "idempotency_key" },
    );
    // ORCH-0788: inline-dispatch (inlined fetch instead of
    // dispatchTicketConfirmation import to avoid circular import — this
    // file lives in _shared/ and ticketCheckout.ts also lives in _shared/).
    // Failure is NON-FATAL — sweeper picks up retryable rows.
    const supaUrl = Deno.env.get("SUPABASE_URL");
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supaUrl && supaKey) {
      try {
        await fetch(`${supaUrl}/functions/v1/ticket-confirmation-dispatch`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${supaKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ orderId }),
        });
      } catch (err) {
        console.error("[stripe-webhook] refund dispatch failed (non-fatal)", err);
      }
    }
  }

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: event.id,
    action: `stripe.${event.type}.reconciled`,
    target_type: "refund",
    target_id: refundId,
    after: refund,
  });

  return brandId;
}

async function handleApplicationFee(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const fee = event.data.object;
  const feeId = objectString(fee, "id");
  if (!feeId) throw new Error(`${event.type} missing application_fee.id`);
  const stripeAccountId = objectString(fee, "account");
  const brandId = stripeAccountId
    ? await brandIdForStripeAccount(supabase, stripeAccountId)
    : null;
  const row = {
    stripe_application_fee_id: feeId,
    stripe_account_id: stripeAccountId,
    brand_id: brandId,
    amount_cents: Number(fee.amount ?? 0),
    currency: char3(fee.currency),
    refunded_amount_cents: Number(fee.amount_refunded ?? 0),
    refunded: fee.refunded === true,
    raw_payload: fee,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("mingla_revenue_log")
    .upsert(row, { onConflict: "stripe_application_fee_id" });
  if (error) throw new Error(`mingla_revenue_log upsert failed: ${error.message}`);

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: event.id,
    action: `stripe_connect.${event.type}`,
    target_type: "application_fee",
    target_id: feeId,
    after: row,
  });
  return brandId;
}

async function handleTicketCheckoutPaymentIntent(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const paymentIntent = event.data.object;
  const paymentIntentId = objectString(paymentIntent, "id");
  if (!paymentIntentId) throw new Error(`${event.type} missing payment_intent.id`);

  let { data: session, error: sessionError } = await supabase
    .from("ticket_checkout_sessions")
    .select("id, brand_id, event_id, order_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (sessionError) throw new Error(`ticket checkout session lookup failed: ${sessionError.message}`);
  // ORCH-0790: web Checkout Sessions create the session row BEFORE the
  // PaymentIntent exists, so the initial lookup by PI id misses on the
  // first PI webhook. Fall back to the Mingla checkout session id
  // embedded in the PI metadata, and back-fill stripe_payment_intent_id
  // so subsequent webhooks short-circuit on the PI lookup.
  if (!session) {
    const piMetadata =
      paymentIntent.metadata as Record<string, unknown> | undefined;
    const mingleCheckoutSessionId =
      typeof piMetadata?.mingla_checkout_session_id === "string"
        ? piMetadata.mingla_checkout_session_id
        : null;
    if (mingleCheckoutSessionId) {
      const fallback = await supabase
        .from("ticket_checkout_sessions")
        .select("id, brand_id, event_id, order_id")
        .eq("id", mingleCheckoutSessionId)
        .maybeSingle();
      if (fallback.error) {
        throw new Error(
          `ticket checkout session metadata lookup failed: ${fallback.error.message}`,
        );
      }
      if (fallback.data) {
        session = fallback.data;
        await supabase
          .from("ticket_checkout_sessions")
          .update({
            stripe_payment_intent_id: paymentIntentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id)
          .is("stripe_payment_intent_id", null);
      }
    }
  }
  if (!session) return null;

  if (event.type === "payment_intent.succeeded") {
    const charges = paymentIntent.charges as { data?: Array<Record<string, unknown>> } | undefined;
    const latestCharge = charges?.data?.[0] ?? null;
    const paymentMethodTypes = Array.isArray(paymentIntent.payment_method_types)
      ? paymentIntent.payment_method_types
      : [];
    const methodType = typeof paymentMethodTypes[0] === "string"
      ? paymentMethodTypes[0]
      : objectString(paymentIntent, "payment_method");
    // ORCH-0869 Stage 1b: when the deposit PI metadata carries
    // mingla_installment_plan_root='true', pass the Stripe Customer + saved
    // PaymentMethod IDs through to the finalize RPC so the cron has what it
    // needs to charge installments off-session. Non-installment PIs leave
    // these params NULL/false and the legacy finalize path runs unchanged.
    const piMetadata = (paymentIntent.metadata as Record<string, unknown> | undefined) ?? {};
    const isInstallmentPlanRoot = piMetadata["mingla_installment_plan_root"] === "true";
    const stripeCustomerId = isInstallmentPlanRoot
      ? objectString(paymentIntent, "customer")
      : null;
    const savedPaymentMethodId = isInstallmentPlanRoot
      ? objectString(paymentIntent, "payment_method")
      : null;
    const { data: finalized, error: finalizeError } = await supabase.rpc(
      "biz_ticket_checkout_finalize",
      {
        p_checkout_session_id: session.id,
        p_stripe_payment_intent_id: paymentIntentId,
        p_stripe_charge_id: latestCharge ? objectString(latestCharge, "id") : null,
        p_stripe_payment_method_type: methodType,
        p_qr_token_pepper: qrTokenPepper(),
        p_stripe_customer_id_on_connected_account: stripeCustomerId,
        p_saved_payment_method_id: savedPaymentMethodId,
        p_installment_plan_root: isInstallmentPlanRoot,
      },
    );
    if (finalizeError) throw new Error(`ticket checkout finalize failed: ${finalizeError.message}`);
    const orderId = typeof (finalized as Record<string, unknown> | null)?.orderId === "string"
      ? String((finalized as Record<string, unknown>).orderId)
      : null;
    if (orderId) {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (url && key) {
        await fetch(`${url}/functions/v1/ticket-confirmation-dispatch`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ orderId }),
        });
      }
    }

    // ORCH-0808 — AppsFlyer S2S: fire af_purchase exactly once per brand
    // for the FIRST ticket sale. Idempotent via brand_appsflyer_milestones.
    // Never propagates failure to Stripe (the helper swallows + logs).
    try {
      const brandId = session.brand_id as string | null;
      if (brandId) {
        const isFirst = await claimBrandMilestone(
          supabase,
          brandId,
          "first_ticket_sold_at",
        );
        if (isFirst) {
          const ownerUserId = await resolveBrandOwnerUserId(supabase, brandId);
          if (ownerUserId) {
            const amountCents = Number(paymentIntent.amount ?? 0);
            const currency = char3(paymentIntent.currency, "USD");
            const revenue = Math.round(amountCents) / 100;
            await postAppsFlyerS2SEvent({
              supabase,
              userId: ownerUserId,
              eventName: "af_purchase",
              eventValues: {
                af_revenue: revenue,
                af_currency: currency,
                brand_id: brandId,
                milestone: "first_ticket_sold",
              },
            });
          }
        }
      }
    } catch (afError) {
      // Belt-and-suspenders: helper already never throws, but if anything
      // wraps it (e.g. lookup throws unexpectedly), do not propagate.
      console.warn(
        "[stripe-webhook] AppsFlyer first-ticket S2S threw:",
        afError instanceof Error ? afError.message : String(afError),
      );
    }
  } else {
    await supabase
      .from("ticket_checkout_sessions")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
        metadata: { stripe_webhook_event_id: event.id, stripe_event_type: event.type },
      })
      .eq("id", session.id)
      .is("order_id", null);
  }

  return session.brand_id as string | null;
}

// ORCH-0790: handle Stripe Checkout Session completion for the web buyer
// flow. The Checkout Session carries our mingla_checkout_session_id in
// metadata, plus the id of the PaymentIntent Stripe created on the
// connected account. We back-fill stripe_payment_intent_id so the
// PaymentIntent.succeeded event (whichever order it arrives in) can
// resolve our session via the existing handler.
async function handleCheckoutSessionCompleted(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const csObject = event.data.object;
  const paymentIntentId = objectString(csObject, "payment_intent");
  const metadata = csObject.metadata as Record<string, unknown> | undefined;
  const mingleCheckoutSessionId =
    typeof metadata?.mingla_checkout_session_id === "string"
      ? metadata.mingla_checkout_session_id
      : null;
  if (!mingleCheckoutSessionId) {
    console.warn(
      "[stripe-webhook] checkout.session.completed missing mingla metadata",
      objectString(csObject, "id"),
    );
    return null;
  }
  const { data: session, error: lookupError } = await supabase
    .from("ticket_checkout_sessions")
    .select("id, brand_id")
    .eq("id", mingleCheckoutSessionId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(
      `checkout.session.completed session lookup failed: ${lookupError.message}`,
    );
  }
  if (!session) return null;
  if (paymentIntentId) {
    await supabase
      .from("ticket_checkout_sessions")
      .update({
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .is("stripe_payment_intent_id", null);
  }

  // ORCH-0804 / I-PROPOSED-BF — persist Stripe Tax data on the order row.
  // session.total_details.amount_tax + session.tax_calculation are
  // Checkout-Session-only fields (NOT on the PaymentIntent), so this is the
  // only webhook handler that can extract them. The orders row is INSERTed
  // by biz_ticket_checkout_finalize RPC (called from
  // handleTicketCheckoutPaymentIntent on payment_intent.succeeded). In
  // typical Stripe event ordering, payment_intent.succeeded fires BEFORE
  // checkout.session.completed, so the order row exists when we get here
  // and the UPDATE-by-payment-intent-id succeeds. If session.completed
  // arrives first (rare race), the UPDATE matches 0 rows and tax data is
  // lost on the orders row — known limitation queued as ORCH-0804-B
  // hardening (persist tax to ticket_checkout_sessions too + have the
  // finalize RPC copy from there).
  if (paymentIntentId) {
    const totalDetails = csObject.total_details as
      | Record<string, unknown>
      | undefined;
    const taxAmountCents = Number(totalDetails?.amount_tax ?? 0);
    const taxCalculationRef = csObject.tax_calculation;
    const taxCalculationId = typeof taxCalculationRef === "string"
      ? taxCalculationRef
      : null;
    if (taxAmountCents > 0 || taxCalculationId !== null) {
      const { error: taxUpdateError } = await supabase
        .from("orders")
        .update({
          tax_amount_cents: taxAmountCents,
          tax_calculation_id: taxCalculationId,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_payment_intent_id", paymentIntentId);
      if (taxUpdateError) {
        // Non-fatal: log + continue. Tax data can be reconciled later via
        // Stripe Dashboard. Better to surface the brand_id than fail the
        // whole webhook on a tax-persist error.
        console.warn(
          "[stripe-webhook] orders tax UPDATE failed",
          taxUpdateError.message,
          paymentIntentId,
        );
      }
    }
  }

  return session.brand_id as string | null;
}

export async function routeStripeEvent(
  supabase: SupabaseClient,
  stripe: StripeClient,
  event: StripeWebhookEvent,
): Promise<RouteStripeEventResult> {
  let brandId: string | null = null;

  switch (event.type) {
    case "account.updated":
      brandId = await syncAccount(supabase, event.data.object, event.id);
      break;
    case "account.application.deauthorized":
      brandId = await handleDeauthorized(supabase, event);
      break;
    case "account.external_account.created":
    case "account.external_account.updated":
    case "account.external_account.deleted":
      brandId = await handleExternalAccount(supabase, event);
      break;
    case "capability.updated":
    case "person.created":
    case "person.updated":
    case "person.deleted": {
      const stripeAccountId = accountIdForEvent(event);
      if (stripeAccountId) {
        brandId = await refreshAccountById(supabase, stripe, stripeAccountId, event.id);
      }
      break;
    }
    case "payout.created":
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled":
      brandId = await handlePayout(supabase, event);
      break;
    // ORCH-0787: unified refund event family
    case "charge.refund.updated":
    case "charge.refunded":
    case "refund.created":
    case "refund.updated":
      brandId = await handleRefundEvent(supabase, event);
      break;
    case "application_fee.created":
    case "application_fee.refunded":
      brandId = await handleApplicationFee(supabase, event);
      break;
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      // ORCH-0869 [Tr3 Installment Payments]: discriminate by metadata.
      // Installment PIs (created by process-scheduled-installments cron) carry
      // `mingla_installment_id` in metadata. Route to installment handlers
      // instead of the ticket-checkout finalize path.
      if (isInstallmentPaymentIntentEvent(event)) {
        if (event.type === "payment_intent.succeeded") {
          brandId = await handleInstallmentPaymentSucceeded(supabase, event);
        } else if (event.type === "payment_intent.payment_failed") {
          brandId = await handleInstallmentPaymentFailed(supabase, event);
        }
        // payment_intent.canceled for installment PIs: no-op (Tr3 doesn't cancel
        // installment PIs; cancellation is operator-driven via plan cancellation
        // which writes status='cancelled' directly on the ledger row).
      } else {
        brandId = await handleTicketCheckoutPaymentIntent(supabase, event);
      }
      break;
    // ORCH-0790: web Stripe Checkout Session completion. Records the
    // PaymentIntent id against our session so payment_intent.succeeded
    // (whichever order it arrives in) can finalise tickets via the
    // existing handler. Idempotent: re-running this event is a no-op.
    case "checkout.session.completed":
      brandId = await handleCheckoutSessionCompleted(supabase, event);
      break;
    default:
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        event_id: event.id,
        action: "stripe_connect.webhook_unhandled",
        target_type: "stripe_webhook_event",
        target_id: event.id,
        after: { type: event.type },
      });
      break;
  }

  return { processed: true, eventType: event.type, brandId };
}
