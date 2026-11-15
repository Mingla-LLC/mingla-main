/**
 * hostFirstSale.ts — #4238 W3-5 (D11; I-4238-FIRST-SALE-BOTH-PROVIDERS).
 *
 * A brand's first paid online ticket sale fires the host first-sale signals
 * exactly once, whichever processor took it (Stripe or Paystack):
 *   - AppsFlyer (Host app): `mingla_host_first_sale` for the owner (W6-2 naming,
 *     plain values, never revenue);
 *   - the ad platforms: `host_first_sale` with event_id `host_sale:<owner>`
 *     (adConversionFire host path), carrying the sale value and currency.
 *
 * True-first guard: a brand that already has a paid (or since refunded) online
 * order other than this one is not at its first sale. Its milestone is stamped
 * silently and nothing fires (protects hosts who sold before this shipped).
 *
 * The AppsFlyer poster is injected only by functions that hold the AppsFlyer
 * secrets (stripe-webhook). Every other caller (the shared Paystack finalize,
 * reached from the webhook, the status poll, confirm and reconcile) leaves
 * ad_conversions.appsflyer_status pending, and the hourly ad-conversion-retry
 * run posts it. Env-free; never throws.
 */

// @ts-ignore — Deno ESM import (pin matches adConversionFire.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type AppsFlyerPostFn,
  fireAdConversion,
  type FireAdConversionDeps,
} from "./adConversionFire.ts";
import {
  claimBrandMilestone,
  resolveBrandOwnerUserId,
} from "./appsFlyerDevice.ts";

export interface HostFirstSaleInput {
  brandId: string | null | undefined;
  orderId: string | null | undefined;
  amountCents: number;
  currency: string;
  provider: "stripe" | "paystack";
  /** When the buyer paid (the provider's time); defaults to now. */
  eventTimeMs?: number | null;
}

export type HostFirstSaleOutcome =
  | "fired"
  | "not_first"
  | "already_claimed"
  | "no_owner"
  | "skipped"
  | "error";

/** Orders that count as a past sale (a refund does not undo having sold). */
const SOLD_STATUSES = ["paid", "refunded", "partial_refund"];

/** True when the brand has another sold online order besides `orderId`. */
export async function brandHasPriorSale(
  supabase: SupabaseClient,
  brandId: string,
  orderId: string,
): Promise<boolean> {
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id")
    .eq("brand_id", brandId);
  if (eventsError) throw new Error(eventsError.message);
  const eventIds = ((events ?? []) as Array<{ id?: unknown }>)
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");
  if (eventIds.length === 0) return false;
  const { data: prior, error: ordersError } = await supabase
    .from("orders")
    .select("id")
    .in("event_id", eventIds)
    .in("payment_status", SOLD_STATUSES)
    .eq("source", "online_checkout")
    .neq("id", orderId)
    .limit(1);
  if (ordersError) throw new Error(ordersError.message);
  return Array.isArray(prior) && prior.length > 0;
}

export async function fireHostFirstTicketSold(
  supabase: SupabaseClient,
  input: HostFirstSaleInput,
  deps: FireAdConversionDeps & { postAppsFlyer?: AppsFlyerPostFn } = {},
): Promise<HostFirstSaleOutcome> {
  const brandId = typeof input.brandId === "string" ? input.brandId : "";
  const orderId = typeof input.orderId === "string" ? input.orderId : "";
  if (!brandId || !orderId) return "skipped";
  try {
    // 1. True-first guard.
    if (await brandHasPriorSale(supabase, brandId, orderId)) {
      await claimBrandMilestone(supabase, brandId, "first_ticket_sold_at");
      return "not_first";
    }
    // 2. Exactly once per brand (webhook redelivery, poll + webhook, Stripe).
    if (!(await claimBrandMilestone(supabase, brandId, "first_ticket_sold_at"))) {
      return "already_claimed";
    }
    // 3. The owner is the host the signals belong to.
    const ownerUserId = await resolveBrandOwnerUserId(supabase, brandId);
    if (!ownerUserId) return "no_owner";
    // 4. One conversion carries both: the ad platforms and (now, or from the
    //    hourly retry) AppsFlyer.
    await fireAdConversion(supabase, {
      hostEvent: {
        kind: "host_first_sale",
        eventId: `host_sale:${ownerUserId}`,
        subjectType: "host_user",
        subjectId: ownerUserId,
        valueCents: Number.isFinite(input.amountCents)
          ? Math.round(input.amountCents)
          : 0,
        currency: input.currency.trim().toUpperCase(),
        brandId,
        provider: input.provider,
      },
      surface: "web",
      lane: "consumer",
      eventTimeMs: input.eventTimeMs ?? null,
    }, deps);
    return "fired";
  } catch (err) {
    console.error(
      "[hostFirstSale] first-sale signal failed (non-fatal)",
      input.provider,
      err instanceof Error ? err.message : String(err),
    );
    return "error";
  }
}
