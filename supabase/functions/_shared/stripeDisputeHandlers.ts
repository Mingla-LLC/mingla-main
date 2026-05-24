// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "./stripeEdgeAuth.ts";
import {
  postAppsFlyerS2SEvent,
  resolveBrandOwnerUserId,
} from "./appsFlyerS2S.ts";

export interface StripeDisputeWebhookEvent {
  id: string;
  type: string;
  account?: string | null;
  data: { object: Record<string, unknown> };
}

export interface DisputeHandlerEffects {
  dispatchNotification: typeof dispatchNotification;
  postAppsFlyerS2SEvent: typeof postAppsFlyerS2SEvent;
  resolveBrandOwnerUserId: typeof resolveBrandOwnerUserId;
}

const defaultEffects: DisputeHandlerEffects = {
  dispatchNotification,
  postAppsFlyerS2SEvent,
  resolveBrandOwnerUserId,
};

function stringValue(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function disputePaymentIntentId(
  dispute: Record<string, unknown>,
): string | null {
  const paymentIntent = dispute.payment_intent;
  if (typeof paymentIntent === "string" && paymentIntent.length > 0) {
    return paymentIntent;
  }
  if (paymentIntent && typeof paymentIntent === "object") {
    return stringValue(paymentIntent as Record<string, unknown>, "id");
  }
  return null;
}

function evidenceDueBy(dispute: Record<string, unknown>): string | null {
  const evidenceDetails = dispute.evidence_details;
  if (!evidenceDetails || typeof evidenceDetails !== "object") return null;
  const dueBy = numberValue(
    evidenceDetails as Record<string, unknown>,
    "due_by",
  );
  return dueBy === null ? null : new Date(dueBy * 1000).toISOString();
}

function alertUserIdsFromEnv(): string[] {
  const raw = Deno.env.get("STRIPE_DISPUTE_ALERT_USERS") ?? "";
  return Array.from(
    new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)),
  );
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
  if (error) throw new Error(`dispute brand lookup failed: ${error.message}`);
  return data?.brand_id ?? null;
}

async function orderIdForDispute(
  supabase: SupabaseClient,
  input: { chargeId: string; paymentIntentId: string | null },
): Promise<string | null> {
  let query = supabase
    .from("orders")
    .select("id")
    .eq("stripe_charge_id", input.chargeId)
    .maybeSingle();
  let { data, error } = await query;
  if (error) {
    throw new Error(`dispute order charge lookup failed: ${error.message}`);
  }
  if (data?.id) return data.id as string;

  if (!input.paymentIntentId) return null;
  ({ data, error } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_payment_intent_id", input.paymentIntentId)
    .maybeSingle());
  if (error) {
    throw new Error(`dispute order PI lookup failed: ${error.message}`);
  }
  return data?.id ?? null;
}

async function alertDisputeCreated(
  input: {
    brandId: string | null;
    disputeId: string;
    amount: number;
    currency: string;
    effects: DisputeHandlerEffects;
  },
): Promise<void> {
  const userIds = alertUserIdsFromEnv();
  if (userIds.length === 0) {
    console.warn(
      "[stripe-dispute] STRIPE_DISPUTE_ALERT_USERS missing; dispute persisted without operator notification",
    );
    return;
  }
  for (const userId of userIds) {
    await input.effects.dispatchNotification({
      userId,
      brandId: input.brandId,
      type: "stripe_dispute_created",
      title: "Stripe dispute opened",
      body:
        `A ${input.currency.toUpperCase()} ${input.amount} dispute needs review.`,
      data: {
        stripe_dispute_id: input.disputeId,
        amount: input.amount,
        currency: input.currency,
      },
      relatedId: input.disputeId,
      relatedType: "stripe_dispute",
      idempotencyKey: `stripe_dispute_created:${input.disputeId}:${userId}`,
    });
  }
}

async function postDisputeAppsFlyerEvent(
  supabase: SupabaseClient,
  input: {
    brandId: string | null;
    eventName: "dispute_created" | "dispute_lost";
    disputeId: string;
    amount: number;
    currency: string;
    effects: DisputeHandlerEffects;
  },
): Promise<void> {
  if (!input.brandId) return;
  const userId = await input.effects.resolveBrandOwnerUserId(
    supabase,
    input.brandId,
  );
  if (!userId) return;
  await input.effects.postAppsFlyerS2SEvent({
    supabase,
    userId,
    eventName: input.eventName,
    eventValues: {
      stripe_dispute_id: input.disputeId,
      amount: input.amount,
      af_currency: input.currency.toUpperCase(),
    },
  });
}

export async function handleChargeDispute(
  supabase: SupabaseClient,
  event: StripeDisputeWebhookEvent,
  effects: DisputeHandlerEffects = defaultEffects,
): Promise<string | null> {
  const dispute = event.data.object;
  const disputeId = stringValue(dispute, "id");
  if (!disputeId) throw new Error(`${event.type} missing dispute.id`);

  const stripeChargeId = stringValue(dispute, "charge");
  if (!stripeChargeId) throw new Error(`${event.type} missing dispute.charge`);

  const stripeAccountId =
    (typeof event.account === "string" && event.account.length > 0
      ? event.account
      : stringValue(dispute, "account")) ?? null;
  if (!stripeAccountId) {
    throw new Error(`${event.type} missing connected account`);
  }

  const paymentIntentId = disputePaymentIntentId(dispute);
  const amount = numberValue(dispute, "amount") ?? 0;
  const currency = (stringValue(dispute, "currency") ?? "usd").toLowerCase();
  const status = stringValue(dispute, "status") ?? "unknown";
  const reason = stringValue(dispute, "reason") ?? "unknown";
  const isChargeRefundable = dispute.is_charge_refundable === true;
  const brandId = await brandIdForStripeAccount(supabase, stripeAccountId);
  const orderId = await orderIdForDispute(supabase, {
    chargeId: stripeChargeId,
    paymentIntentId,
  });

  const { error } = await supabase
    .from("stripe_disputes")
    .upsert(
      {
        stripe_dispute_id: disputeId,
        stripe_charge_id: stripeChargeId,
        stripe_payment_intent_id: paymentIntentId,
        stripe_account_id: stripeAccountId,
        brand_id: brandId,
        order_id: orderId,
        amount,
        currency,
        status,
        reason,
        evidence_due_by: evidenceDueBy(dispute),
        is_charge_refundable: isChargeRefundable,
        raw_event: event,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_dispute_id" },
    );
  if (error) throw new Error(`stripe_disputes upsert failed: ${error.message}`);

  if (event.type === "charge.dispute.created") {
    await alertDisputeCreated({
      brandId,
      disputeId,
      amount,
      currency,
      effects,
    });
    await postDisputeAppsFlyerEvent(supabase, {
      brandId,
      eventName: "dispute_created",
      disputeId,
      amount,
      currency,
      effects,
    });
  }
  if (event.type === "charge.dispute.closed" && status === "lost") {
    await postDisputeAppsFlyerEvent(supabase, {
      brandId,
      eventName: "dispute_lost",
      disputeId,
      amount,
      currency,
      effects,
    });
  }

  return brandId;
}
