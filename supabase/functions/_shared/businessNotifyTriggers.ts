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
// `brand_owner` strings; the spec's owner-role label maps to schema `brand_owner`).
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

/**
 * META-ORCH-1161 Sub-C §7.1 — buyer purchase-confirmation PUSH+in-app leg.
 *
 * The buyer already gets the EMAIL (with the ticket PDF + .ics) via
 * ticket-confirmation-dispatch — that stays the SOLE email owner for this moment.
 * This adds the NET-NEW free push + durable in-app row through notify-dispatch v2
 * (category `buyer_purchase_confirmation`, channels {inapp,push,email} per seed).
 *
 * Double-email avoidance: we dispatch with contact=null, so the v2 dispatcher's
 * email channel records `skipped` (no_contact) and NEVER sends — push+inapp only.
 * (buyer_purchase_confirmation is a NO-SMS category per DEC-185, so no SMS leg
 * exists regardless.)
 *
 * Idempotent per `buyer_purchase_confirmation:{orderId}` (notify-dispatch v2 +
 * the notifications UNIQUE backstop collapse the confirm/webhook double-fire).
 * Never throws — best-effort relative to the order finalize.
 */
export async function fireBuyerPurchaseConfirmationPush(
  supabase: SupabaseClient,
  input: {
    orderId: string;
    eventId: string;
    brandId: string | null;
    eventTitle: string;
    startAtIso?: string | null;
  },
): Promise<void> {
  try {
    // Resolve the buyer (push targets buyer_user_id; no contact → email skipped).
    const { data: order } = await supabase
      .from("orders")
      .select("buyer_user_id")
      .eq("id", input.orderId)
      .maybeSingle();
    const buyerUserId = order?.buyer_user_id as string | null | undefined;
    if (!buyerUserId) {
      // Anon/guest buyer has no account → no push/in-app row. The email
      // (ticket-confirmation-dispatch) still reaches them. No silent gap: nothing
      // to deliver on the push+inapp channels for a no-account buyer.
      return;
    }

    let brandName = "Mingla";
    if (input.brandId) {
      const { data: brand } = await supabase
        .from("brands")
        .select("name")
        .eq("id", input.brandId)
        .maybeSingle();
      if (brand?.name && typeof brand.name === "string") brandName = brand.name;
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.warn("[businessNotifyTriggers] purchase-confirmation push skipped: env missing");
      return;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        category_key: "buyer_purchase_confirmation",
        user_id: buyerUserId,
        // contact=null → email channel records `skipped` (no double-email; the
        // email is owned by ticket-confirmation-dispatch).
        contact: null,
        payload: {
          order_id: input.orderId,
          event_id: input.eventId,
          event_title: input.eventTitle,
          brand_name: brandName,
          reserved_for: input.startAtIso ?? null,
        },
        idempotency_key: `buyer_purchase_confirmation:${input.orderId}`,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(
        "[businessNotifyTriggers] purchase-confirmation push dispatch non-ok:",
        res.status,
        text,
      );
    }
  } catch (err) {
    console.warn(
      "[businessNotifyTriggers] fireBuyerPurchaseConfirmationPush failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * META-ORCH-1161 Sub-C §7.x — buyer refund-issued / order-cancelled PUSH+in-app
 * (+SMS per the seed) via notify-dispatch v2.
 *
 * The buyer EMAIL for these moments is owned by ticket-confirmation-dispatch
 * (template_key buyer_refund_issued / buyer_order_cancelled) — to avoid a
 * double-email we dispatch with contact = buyer_phone_e164 (phone ONLY). The v2
 * dispatcher's email channel then records `skipped` (no_contact) while push,
 * in-app, and SMS fire (buyer_refund_issued / buyer_order_cancelled are
 * {inapp,push,email,sms} per the seed). If the buyer has no phone, only push +
 * in-app reach them (still no double-email).
 *
 * Idempotent per the caller-supplied idempotency_key. Never throws.
 */
export async function fireBuyerOrderNotify(
  supabase: SupabaseClient,
  input: {
    categoryKey: "buyer_refund_issued" | "buyer_order_cancelled";
    orderId: string;
    idempotencyKey: string;
    extraPayload?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { data: order } = await supabase
      .from("orders")
      .select(
        "buyer_user_id, buyer_phone_e164, event_id, currency, events(title, brand_id, brands(name))",
      )
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order) {
      console.warn("[businessNotifyTriggers] order not found for buyer notify", input.orderId);
      return;
    }
    const buyerUserId = (order.buyer_user_id as string | null) ?? null;
    const buyerPhone = (order.buyer_phone_e164 as string | null) ?? null;
    // No account AND no phone → nothing on push/in-app/sms to deliver (email is
    // the email-owner's job). No silent gap — there is genuinely no recipient here.
    if (!buyerUserId && !buyerPhone) return;

    const eventsJoin = order.events as
      | { title?: string | null; brand_id?: string | null; brands?: { name?: string | null } | Array<{ name?: string | null }> | null }
      | Array<{ title?: string | null; brand_id?: string | null; brands?: { name?: string | null } | Array<{ name?: string | null }> | null }>
      | null
      | undefined;
    const eventRow = Array.isArray(eventsJoin) ? eventsJoin[0] ?? null : eventsJoin ?? null;
    const brandsJoin = eventRow?.brands ?? null;
    const brandRow = Array.isArray(brandsJoin) ? brandsJoin[0] ?? null : brandsJoin ?? null;
    const brandName = (brandRow?.name as string | null) ?? "Mingla";
    const eventTitle = (eventRow?.title as string | null) ?? "your order";

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.warn("[businessNotifyTriggers] buyer notify skipped: env missing");
      return;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        category_key: input.categoryKey,
        user_id: buyerUserId,
        // phone ONLY → email channel skips (no double-email); push/inapp/sms fire.
        contact: buyerPhone,
        payload: {
          order_id: input.orderId,
          event_id: (order.event_id as string | null) ?? null,
          event_title: eventTitle,
          brand_name: brandName,
          currency: (order.currency as string | null) ?? null,
          ...(input.extraPayload ?? {}),
        },
        idempotency_key: input.idempotencyKey,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(
        "[businessNotifyTriggers] buyer notify dispatch non-ok:",
        input.categoryKey,
        res.status,
        text,
      );
    }
  } catch (err) {
    console.warn(
      "[businessNotifyTriggers] fireBuyerOrderNotify failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
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

    // META-ORCH-1161 §7.1 — buyer purchase-confirmation PUSH+in-app (NET-NEW).
    // Email stays owned by ticket-confirmation-dispatch (no double-email). Resolve
    // the master/earliest date for the copy; null-safe.
    let startAtIso: string | null = null;
    const { data: masterDate } = await supabase
      .from("event_dates")
      .select("start_at")
      .eq("event_id", input.eventId)
      .order("is_master", { ascending: false })
      .order("start_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (masterDate?.start_at && typeof masterDate.start_at === "string") {
      startAtIso = masterDate.start_at;
    }
    await fireBuyerPurchaseConfirmationPush(supabase, {
      orderId: input.orderId,
      eventId: input.eventId,
      brandId,
      eventTitle,
      startAtIso,
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
