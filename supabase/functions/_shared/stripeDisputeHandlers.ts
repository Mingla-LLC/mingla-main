// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  postAppsFlyerS2SEvent,
  resolveBrandOwnerUserId,
} from "./appsFlyerS2S.ts";
import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts";

export interface StripeDisputeWebhookEvent {
  id: string;
  type: string;
  account?: string | null;
  data: { object: Record<string, unknown> };
}

export interface DisputeHandlerEffects {
  sendOpsAlertEmail: typeof sendOpsAlertEmail;
  postAppsFlyerS2SEvent: typeof postAppsFlyerS2SEvent;
  resolveBrandOwnerUserId: typeof resolveBrandOwnerUserId;
}

const defaultEffects: DisputeHandlerEffects = {
  sendOpsAlertEmail,
  postAppsFlyerS2SEvent,
  resolveBrandOwnerUserId,
};

function formatCurrencyAmount(amount: number, currency: string): string {
  const zeroDecimal = new Set(["jpy", "krw", "vnd"]);
  const lower = currency.toLowerCase();
  const major = zeroDecimal.has(lower) ? amount : amount / 100;
  return `${currency.toUpperCase()} ${
    major.toFixed(zeroDecimal.has(lower) ? 0 : 2)
  }`;
}

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

function alertEmailsFromEnv(): string[] {
  const raw = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS") ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
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
  const query = supabase
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

async function brandNameForBrandId(
  supabase: SupabaseClient,
  brandId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("name")
    .eq("id", brandId)
    .maybeSingle();
  if (error) {
    console.warn("[stripe-dispute] brand name lookup failed", {
      brandId,
      error: error.message,
    });
    return null;
  }
  return (data?.name as string | undefined) ?? null;
}

async function alertDisputeCreated(
  input: {
    brandName: string | null;
    disputeId: string;
    amount: number;
    currency: string;
    reason: string;
    evidenceDueBy: string | null;
    livemode: boolean;
    effects: DisputeHandlerEffects;
  },
): Promise<void> {
  const emails = alertEmailsFromEnv();
  if (emails.length === 0) {
    console.warn(
      "[stripe-dispute] STRIPE_DISPUTE_ALERT_EMAILS missing; dispute persisted without operator notification",
    );
    return;
  }
  const amountStr = formatCurrencyAmount(input.amount, input.currency);
  const brand = input.brandName ?? "unknown brand";
  const daysUntilDue = input.evidenceDueBy
    ? Math.max(
      0,
      Math.ceil(
        (new Date(input.evidenceDueBy).getTime() - Date.now()) / 86_400_000,
      ),
    )
    : null;
  const subject = daysUntilDue !== null
    ? `🚨 [LIVE] Chargeback dispute — ${amountStr} on ${brand}, evidence due in ${daysUntilDue} day${
      daysUntilDue === 1 ? "" : "s"
    }`
    : `🚨 [LIVE] Chargeback dispute — ${amountStr} on ${brand}`;
  const paragraphs = [
    "A new Stripe chargeback dispute requires your review.",
    `Amount: ${amountStr}`,
    `Brand: ${brand}`,
    `Reason: ${input.reason}`,
    input.evidenceDueBy
      ? `Evidence due: ${input.evidenceDueBy}`
      : "Evidence due: (not provided)",
    `Dispute ID: ${input.disputeId}`,
  ];
  const dashboardBase = input.livemode
    ? "https://dashboard.stripe.com/disputes"
    : "https://dashboard.stripe.com/test/disputes";
  try {
    const result = await input.effects.sendOpsAlertEmail({
      subject,
      paragraphs,
      recipients: emails,
      cta: {
        label: "Open in Stripe Dashboard",
        url: `${dashboardBase}/${input.disputeId}`,
      },
    });
    console.info("[stripe-dispute] dispute-created email alert result", {
      disputeId: input.disputeId,
      result,
    });
  } catch (err) {
    console.error("[stripe-dispute] dispute-created email alert failed", {
      disputeId: input.disputeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function alertDisputeLost(
  input: {
    brandName: string | null;
    disputeId: string;
    amount: number;
    currency: string;
    livemode: boolean;
    effects: DisputeHandlerEffects;
  },
): Promise<void> {
  const emails = alertEmailsFromEnv();
  if (emails.length === 0) return;
  const amountStr = formatCurrencyAmount(input.amount, input.currency);
  const brand = input.brandName ?? "unknown brand";
  const subject = `❌ [LIVE] Chargeback LOST — ${amountStr} on ${brand}`;
  const paragraphs = [
    'A Stripe chargeback was closed with status "lost".',
    `Amount: ${amountStr}`,
    `Brand: ${brand}`,
    `Dispute ID: ${input.disputeId}`,
  ];
  const dashboardBase = input.livemode
    ? "https://dashboard.stripe.com/disputes"
    : "https://dashboard.stripe.com/test/disputes";
  try {
    const result = await input.effects.sendOpsAlertEmail({
      subject,
      paragraphs,
      recipients: emails,
      cta: {
        label: "Open in Stripe Dashboard",
        url: `${dashboardBase}/${input.disputeId}`,
      },
    });
    console.info("[stripe-dispute] dispute-lost email alert result", {
      disputeId: input.disputeId,
      result,
    });
  } catch (err) {
    console.error("[stripe-dispute] dispute-lost email alert failed", {
      disputeId: input.disputeId,
      error: err instanceof Error ? err.message : String(err),
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
  const brandName = brandId
    ? await brandNameForBrandId(supabase, brandId)
    : null;
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
      brandName,
      disputeId,
      amount,
      currency,
      reason,
      evidenceDueBy: evidenceDueBy(dispute),
      livemode: dispute.livemode === true,
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
    await alertDisputeLost({
      brandName,
      disputeId,
      amount,
      currency,
      livemode: dispute.livemode === true,
      effects,
    });
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
