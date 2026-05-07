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
import {
  getKycRemediationForRequirements,
  mapPayoutFailureCode,
} from "./stripeKycRemediation.ts";

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
  "person.created",
  "person.updated",
  "person.deleted",
  "application_fee.created",
  "application_fee.refunded",
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

async function handleRefundUpdated(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const refund = event.data.object;
  const refundId = objectString(refund, "id");
  if (!refundId) throw new Error("charge.refund.updated missing refund.id");
  const stripeAccountId = accountIdForEvent(event);
  if (!stripeAccountId) return null;
  const { data, error } = await supabase
    .from("stripe_connect_accounts")
    .select("brand_id, detached_at")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (error) throw new Error(`refund account lookup failed: ${error.message}`);
  if (!data?.brand_id || !data.detached_at) return data?.brand_id ?? null;

  await writeAudit(supabase, {
    user_id: null,
    brand_id: data.brand_id,
    event_id: event.id,
    action: "stripe_connect.detached_refund_updated",
    target_type: "detached_refund",
    target_id: refundId,
    after: refund,
  });
  return data.brand_id;
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
    case "charge.refund.updated":
      brandId = await handleRefundUpdated(supabase, event);
      break;
    case "application_fee.created":
    case "application_fee.refunded":
      brandId = await handleApplicationFee(supabase, event);
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
