/**
 * Stripe Connect webhook event handling (issue #47).
 * Extracted for unit tests and used by `stripe-connect-webhook/index.ts`.
 */

import Stripe from "npm:stripe@17.4.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  mapStripePayoutStatus,
  projectStripeAccountToConnectRow,
} from "./stripeConnectProjection.ts";

export type ConnectEvent = Stripe.Event & { account?: string | null };

export function connectedAccountId(event: ConnectEvent): string | null {
  const a = event.account;
  if (typeof a === "string" && a.length > 0) return a;
  const obj = event.data?.object as { id?: string } | undefined;
  if (event.type === "account.updated") {
    return typeof obj?.id === "string" ? obj.id : null;
  }
  return null;
}

async function syncAccountById(
  admin: SupabaseClient,
  stripe: Stripe,
  accountId: string,
): Promise<void> {
  const account = await stripe.accounts.retrieve(accountId);
  const { data: row } = await admin
    .from("stripe_connect_accounts")
    .select("brand_id")
    .eq("stripe_account_id", account.id)
    .maybeSingle();

  const brandId =
    (row?.brand_id as string | undefined) ??
    (account.metadata?.brand_id !== undefined && account.metadata.brand_id !== ""
      ? account.metadata.brand_id
      : undefined);

  if (brandId === undefined || brandId === "") {
    console.warn("[stripe-connect-webhook] syncAccountById: no brand for", account.id);
    return;
  }

  const proj = projectStripeAccountToConnectRow(account);
  const connectRow: Record<string, unknown> = {
    brand_id: brandId,
    stripe_account_id: proj.stripe_account_id,
    account_type: proj.account_type,
    charges_enabled: proj.charges_enabled,
    payouts_enabled: proj.payouts_enabled,
    requirements: proj.requirements,
  };
  if (proj.charges_enabled) {
    connectRow.kyc_stall_reminder_sent_at = null;
  }
  const { error: upErr } = await admin.from("stripe_connect_accounts").upsert(connectRow, {
    onConflict: "brand_id",
  });
  if (upErr !== null) {
    throw new Error(`stripe_connect_accounts upsert: ${upErr.message}`);
  }

  const { error: bErr } = await admin
    .from("brands")
    .update({
      stripe_connect_id: account.id,
      stripe_charges_enabled: proj.charges_enabled,
      stripe_payouts_enabled: proj.payouts_enabled,
    })
    .eq("id", brandId);

  if (bErr !== null) {
    console.error("[stripe-connect-webhook] brands update:", bErr.message);
  }
}

async function handleDeauthorize(
  admin: SupabaseClient,
  connectedAccountId: string,
): Promise<void> {
  const { data: row } = await admin
    .from("stripe_connect_accounts")
    .select("brand_id")
    .eq("stripe_account_id", connectedAccountId)
    .maybeSingle();

  const brandId = row?.brand_id as string | undefined;
  if (brandId === undefined) return;

  await admin.from("stripe_connect_accounts").delete().eq("brand_id", brandId);
  await admin
    .from("brands")
    .update({
      stripe_connect_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    })
    .eq("id", brandId);
}

async function upsertPayout(
  admin: SupabaseClient,
  brandId: string,
  p: Stripe.Payout,
): Promise<void> {
  const cur = (p.currency ?? "gbp").toUpperCase().padEnd(3, " ").slice(0, 3);
  const { error } = await admin.from("payouts").upsert(
    {
      brand_id: brandId,
      stripe_payout_id: p.id,
      amount_cents: p.amount,
      currency: cur,
      status: mapStripePayoutStatus(p.status),
      arrival_date: p.arrival_date ?? null,
    },
    { onConflict: "stripe_payout_id" },
  );
  if (error !== null) {
    throw new Error(`payouts upsert: ${error.message}`);
  }
}

export async function processConnectEvent(
  admin: SupabaseClient,
  stripe: Stripe,
  event: ConnectEvent,
): Promise<void> {
  const type = event.type;
  const acctHeader = connectedAccountId(event);

  switch (type) {
    case "account.updated": {
      const obj = event.data.object as Stripe.Account;
      await syncAccountById(admin, stripe, obj.id);
      break;
    }
    case "capability.updated":
    case "person.updated":
    case "person.created": {
      if (acctHeader === null) break;
      await syncAccountById(admin, stripe, acctHeader);
      break;
    }
    case "account.application.deauthorized": {
      if (acctHeader === null) break;
      await handleDeauthorize(admin, acctHeader);
      break;
    }
    case "payout.created":
    case "payout.updated":
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled": {
      if (acctHeader === null) break;
      const p = event.data.object as Stripe.Payout;
      const { data: link } = await admin
        .from("stripe_connect_accounts")
        .select("brand_id")
        .eq("stripe_account_id", acctHeader)
        .maybeSingle();
      const brandId = link?.brand_id as string | undefined;
      if (brandId === undefined) break;
      await upsertPayout(admin, brandId, p);
      break;
    }
    default:
      break;
  }
}
