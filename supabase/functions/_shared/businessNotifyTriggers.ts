// supabase/functions/_shared/businessNotifyTriggers.ts
//
// META-ORCH-1074 Sub-A [Business notification triggers].
//
// Shared, reusable trigger logic for the order-finalize-derived business
// notifications (order_paid, event_sold_out, low_inventory). Both the
// slow-path edge (ticket-checkout-confirm) and the webhook race-winner
// (stripeWebhookRouter handleTicketCheckoutPaymentIntent) call
// fireOrderFinalizeNotifications() after the finalize RPC reports an order.
// Idempotency keys (per §3.A.4) collapse the unavoidable double-fire (confirm
// vs webhook) to exactly ONE notifications row per recipient per event — so we
// do NOT need the RPC to tell us which side created the order.
//
// Copy strings are the LOCKED Sub-D §3 templates. Money slots are formatted
// currency-aware via formatMoneyCents (no hardcoded £/$, no GBP fallback —
// ORCH-1034). All business.* types route to the business OneSignal app
// automatically via notify-dispatch's resolveOneSignalApp (the `business.`
// prefix). — https://documentation.onesignal.com/docs/keys-and-ids

// @ts-ignore — Deno ESM import (pin matches stripeEdgeAuth.ts for type parity)
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  dispatchNotification,
  formatMoneyCents,
  getBrandTeamUserIdsByRoles,
} from "./stripeEdgeAuth.ts";

// LOCKED per-type recipient role-sets (§3.A.3 — using the live post-ORCH-1047
// `brand_owner` strings; spec's `account_owner` == schema `brand_owner`).
export const ROLES_ORDER_PAID = ["brand_owner", "brand_admin", "finance_manager"];
export const ROLES_SOLD_OUT = ["brand_owner", "brand_admin"];
export const ROLES_LOW_INVENTORY = ["brand_owner", "brand_admin"];

// Low-inventory threshold (operator-locked 2026-06-04): fire once when
// remaining crosses ≤10% of capacity AND is still > 0.
export const LOW_INVENTORY_PCT = 0.1;

/**
 * Fan out a business.* notification to every brand_team_member in `roles`.
 * One dispatchNotification per recipient, with a per-user idempotency suffix
 * (`${idempotencyKey}:${userId}`) so notify-dispatch's idempotency check
 * collapses webhook replays + confirm/webhook races to one row per recipient.
 */
export async function notifyBrandRoles(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    roles: readonly string[];
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
  const userIds = await getBrandTeamUserIdsByRoles(
    supabase,
    input.brandId,
    input.roles,
  );
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

interface EventCapacity {
  title: string;
  /** total published capacity across all ticket types; null if any is unlimited. */
  capacity: number | null;
  /** remaining bookable across all ticket types; null if any is unlimited. */
  remaining: number | null;
}

/**
 * Resolve the event title + post-finalize remaining/total capacity using the
 * canonical sales-consistent RPC (pg_public_ticket_types_remaining — sold
 * formula matches the checkout capacity gate). Summed across ticket types. If
 * any ticket type is unlimited (remaining=null), event-level capacity is
 * treated as unlimited (null) and sold_out/low_inventory never fire.
 */
async function resolveEventCapacity(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventCapacity | null> {
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("title")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !eventRow) return null;

  const { data: rows, error: rpcErr } = await supabase.rpc(
    "pg_public_ticket_types_remaining",
    { p_event_id: eventId },
  );
  if (rpcErr || !Array.isArray(rows)) {
    return { title: String(eventRow.title ?? ""), capacity: null, remaining: null };
  }

  let totalRemaining = 0;
  let totalSold = 0;
  let anyUnlimited = false;
  for (const r of rows as Array<{ sold: number | null; remaining: number | null }>) {
    const remaining = r.remaining;
    if (remaining === null || remaining === undefined) {
      anyUnlimited = true;
    } else {
      totalRemaining += Number(remaining);
    }
    totalSold += Number(r.sold ?? 0);
  }
  if (anyUnlimited) {
    return { title: String(eventRow.title ?? ""), capacity: null, remaining: null };
  }
  return {
    title: String(eventRow.title ?? ""),
    capacity: totalSold + totalRemaining,
    remaining: totalRemaining,
  };
}

/**
 * Fire the order-finalize-derived business notifications for a newly-paid
 * order. Safe to call from BOTH ticket-checkout-confirm (slow path) and the
 * webhook finalize branch — idempotency keys collapse the double-fire.
 *
 *  1. business.order_paid  — always, keyed on orderId.
 *  2. business.event_sold_out — when remaining hits 0, keyed on eventId.
 *  3. business.low_inventory — when remaining crosses ≤10% of capacity and >0,
 *     keyed on eventId:thresholdBucket (so it fires at most once per band).
 *
 * Never throws — notifications are best-effort relative to the order itself.
 */
export async function fireOrderFinalizeNotifications(
  supabase: SupabaseClient,
  input: {
    brandId: string | null;
    eventId: string;
    orderId: string;
    totalCents: number;
    currency: string | null;
    qty: number;
  },
): Promise<void> {
  if (!input.brandId) return;
  const brandId = input.brandId;
  try {
    const cap = await resolveEventCapacity(supabase, input.eventId);
    const eventTitle = cap?.title && cap.title.length > 0 ? cap.title : "your listing";
    const amount = formatMoneyCents(input.totalCents, input.currency);

    // 1. order_paid — always.
    await notifyBrandRoles(supabase, {
      brandId,
      roles: ROLES_ORDER_PAID,
      type: "business.order_paid",
      title: "New sale 🎉",
      body: `${eventTitle}: ${amount} just came in.`,
      data: {
        orderId: input.orderId,
        eventId: input.eventId,
        eventTitle,
        totalCents: input.totalCents,
        currency: input.currency,
        qty: input.qty,
      },
      relatedId: input.orderId,
      relatedType: "order",
      idempotencyKey: `business.order_paid:${input.orderId}`,
      deepLink: `mingla-business://event/${input.eventId}`,
    });

    // 2 + 3 derive from remaining capacity (skip when unlimited).
    if (cap && cap.capacity !== null && cap.remaining !== null) {
      const { capacity, remaining } = cap;
      if (remaining <= 0) {
        await notifyBrandRoles(supabase, {
          brandId,
          roles: ROLES_SOLD_OUT,
          type: "business.event_sold_out",
          title: "Sold out 🎉",
          body: `${eventTitle} is sold out — nice work.`,
          data: { eventId: input.eventId, eventTitle, capacity },
          relatedId: input.eventId,
          relatedType: "event",
          idempotencyKey: `business.event_sold_out:${input.eventId}`,
          deepLink: `mingla-business://event/${input.eventId}`,
        });
      } else if (
        capacity > 0 &&
        remaining / capacity <= LOW_INVENTORY_PCT
      ) {
        // thresholdBucket = the integer % band (always 10 for the 10% rule, but
        // computed so a future multi-band threshold fires once per band).
        const pct = Math.round((remaining / capacity) * 100);
        const bucket = Math.ceil((LOW_INVENTORY_PCT * 100));
        await notifyBrandRoles(supabase, {
          brandId,
          roles: ROLES_LOW_INVENTORY,
          type: "business.low_inventory",
          title: "Almost gone",
          body: `${eventTitle}: only ${remaining} left.`,
          data: {
            eventId: input.eventId,
            eventTitle,
            remaining,
            capacity,
            pct,
          },
          relatedId: input.eventId,
          relatedType: "event",
          idempotencyKey: `business.low_inventory:${input.eventId}:${bucket}`,
          deepLink: `mingla-business://event/${input.eventId}`,
        });
      }
    }
  } catch (err) {
    console.warn(
      "[businessNotifyTriggers] fireOrderFinalizeNotifications failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
