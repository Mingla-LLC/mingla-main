// ===========================================================================
// Issue #1791 (SPEC #1788 P-53, P-54, P-55; DESIGN D-7, D-7b, D-7c) — the
// ALERTING SPINE for venue orders.
//
// WHY THIS FILE EXISTS. Today an inbound venue RESERVATION reaches staff in
// total silence: `grep dispatchNotification|notifyBrandRoles` across the three
// venue-reservation-* functions returns zero matches, so the list only updates
// while somebody happens to be looking at it. An order with money taken cannot
// inherit that. This module is the third leg of the mandatory triple —
// realtime + a 30s poll floor + PUSH — and each leg exists to cover the other
// two's failure modes (P-53).
//
// WHAT IT MAY DO: send a push and write a durable in-app `notifications` row,
// through the shipped rail (notifyBrandRoles -> dispatchNotification ->
// notify-dispatch -> OneSignal per-user external_id).
//
// WHAT IT MAY NEVER DO, and the design correction each prohibition comes from:
//   * refund anything (D-7a — money moves only when a PERSON decides),
//   * cancel anything,
//   * pause a venue's ordering (D-7b — never switch off a venue's ordering on
//     their behalf; the pause switch is THEIRS, in their Orders module),
//   * send an SMS (D-7c — one handset, a per-message cost, and the NG rail is
//     dark; `send-venue-sms` stays a guest-facing waitlist tool and is NOT
//     repurposed for staff alerting).
// The ladder only ever notifies PEOPLE. There is no fourth rung.
// ===========================================================================

// @ts-ignore — Deno ESM import (pin matches stripeEdgeAuth.ts for type parity)
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { formatMoneyCents } from "./stripeEdgeAuth.ts";
import { notifyBrandRoles } from "./businessNotifyTriggers.ts";

/**
 * Callers hold the UNPINNED service client from `_shared/ticketCheckout.ts`
 * while the notify rail types against the pinned @2.45.4 one. The two are
 * structurally identical but TypeScript will not unify them (`supabaseUrl` is
 * protected), so this module accepts the loose shape at its boundary and
 * narrows once, here — the alternative is a second pinned copy of the SDK in
 * every calling function. Same `type ServiceClient = any` posture as the rest
 * of the venue-order family.
 */
// deno-lint-ignore no-explicit-any
export type VenueOrderNotifyClient = any;

const pinned = (client: VenueOrderNotifyClient): SupabaseClient =>
  client as SupabaseClient;

/**
 * P-54 — wider than ROLES_ORDER_PAID (`brand_owner`, `brand_admin`,
 * `finance_manager`) by exactly one role: `event_manager` is the person who
 * actually works a floor, and a queue nobody on the floor is pushed about is
 * the silence this phase exists to end.
 *
 * KNOWN LIMIT, stated rather than hidden: role sets are BRAND-wide
 * (`brand_team_members` has no `venue_id`), so a three-venue brand's owner
 * receives every venue's pushes. Per-venue scoping arrives with Phase 5's
 * channel presence, which scopes the DEVICE rather than the membership. Phase 3
 * must not invent a membership column to work around it.
 */
export const ROLES_VENUE_ORDER = [
  "brand_owner",
  "brand_admin",
  "finance_manager",
  "event_manager",
];

/** P-55 rung 2 — up the roster to the people who can do something about it. */
export const ROLES_VENUE_ORDER_ESCALATION = ["brand_owner", "brand_admin"];

/** P-55 rung 3 — ONE final owner alert, and then the ladder stops. */
export const ROLES_VENUE_ORDER_FINAL = ["brand_owner"];

/** The new deep-link head this phase adds to the business router (P-54). */
export function venueOrdersDeepLink(venueId: string): string {
  return `mingla-business://venue/${venueId}/orders`;
}

/**
 * The stable collapse id. OneSignal REPLACES a notification carrying the same
 * collapse id rather than stacking a new one (push-utils.ts:78), which is what
 * turns "re-alert at T+2" into a louder version of the same ticket instead of
 * four unread badges for one order.
 */
export function venueOrderCollapseId(orderId: string): string {
  return `venue_order:${orderId}`;
}

export interface VenueOrderDestination {
  spotLabel?: string | null;
  pickupCode?: string | null;
  buyerName?: string | null;
}

/**
 * D-3 / D-3b — every ticket shows where it is GOING. A hotel's room-service
 * ticket and its restaurant's table ticket land in one queue because it is one
 * kitchen, so the destination is the thing that makes them tellable apart.
 * Counter pickup has no spot at all, so it names the code and the person:
 * `COLLECT · 42 · Amara`.
 */
export function venueOrderDestinationLabel(d: VenueOrderDestination): string {
  const spot = (d.spotLabel ?? "").trim();
  if (spot.length > 0) return spot;
  const code = (d.pickupCode ?? "").trim();
  const name = (d.buyerName ?? "").trim();
  if (code.length > 0) {
    return name.length > 0 ? `COLLECT · ${code} · ${name}` : `COLLECT · ${code}`;
  }
  return name.length > 0 ? name : "Counter";
}

/** Whole minutes, floored, never negative — the number a human reads. */
export function unackedMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor(seconds / 60);
}

export type EscalationRung = 1 | 2 | 3;

export interface EscalationCopy {
  title: string;
  body: string;
  roles: readonly string[];
}

/**
 * P-55 — the three rungs, and what each one is FOR.
 *
 *  1 (T+2)  — the same people, again, replacing the first push. Somebody is
 *             probably just in the weeds.
 *  2 (T+5)  — up the roster to managers and the owner, AND the guest is told
 *             honestly and shown their Cancel & refund button. That button was
 *             always there (D-7a); this rung surfaces it, it does not create it.
 *  3 (T+10) — ONE final owner alert. Then STOP. No infinite nagging: the ticket
 *             stays in the queue, the guest keeps their refund control, and
 *             orders keep arriving (D-7b).
 */
export function escalationCopy(
  rung: EscalationRung,
  destination: string,
  minutes: number,
): EscalationCopy {
  const mins = `${minutes} min`;
  if (rung === 1) {
    return {
      title: `Order waiting · ${destination}`,
      body: `${mins} and nobody has picked it up yet. Tap to acknowledge.`,
      roles: ROLES_VENUE_ORDER,
    };
  }
  if (rung === 2) {
    return {
      title: `Nobody has seen this order · ${destination}`,
      body:
        `${mins} unacknowledged. The guest has been told, and they can cancel for a full refund.`,
      roles: ROLES_VENUE_ORDER_ESCALATION,
    };
  }
  return {
    title: `Last alert · ${destination}`,
    body:
      `${mins} unacknowledged. This is the final nudge — the order is still in your queue.`,
    roles: ROLES_VENUE_ORDER_FINAL,
  };
}

export interface VenueOrderPlacedInput {
  orderId: string;
  brandId: string;
  venueId: string;
  currency: string | null;
  totalCents: number;
  itemCount: number;
  spotLabel?: string | null;
  pickupCode?: string | null;
  buyerName?: string | null;
}

/**
 * T0 — the order arrived. Push + a durable in-app row to everyone with orders
 * access, carrying the collapse id every later rung reuses.
 *
 * Never throws: an alert is best-effort RELATIVE TO THE ORDER. A push failure
 * must not roll back a payment that already succeeded — the poll floor and the
 * realtime channel are the other two legs of the triple, and they still work.
 */
export async function fireVenueOrderPlaced(
  supabase: VenueOrderNotifyClient,
  input: VenueOrderPlacedInput,
): Promise<void> {
  try {
    const destination = venueOrderDestinationLabel(input);
    const amount = formatMoneyCents(input.totalCents, input.currency);
    const items = input.itemCount === 1 ? "1 item" : `${input.itemCount} items`;
    await notifyBrandRoles(pinned(supabase), {
      brandId: input.brandId,
      roles: ROLES_VENUE_ORDER,
      type: "business.venue_order_placed",
      title: `New order · ${destination}`,
      body: `${amount} · ${items}. Tap to say you've got it.`,
      data: {
        orderId: input.orderId,
        venueId: input.venueId,
        brandId: input.brandId,
        destination,
        totalCents: input.totalCents,
        currency: input.currency,
        itemCount: input.itemCount,
      },
      relatedId: input.orderId,
      relatedType: "venue_order",
      idempotencyKey: `business.venue_order_placed:${input.orderId}`,
      deepLink: venueOrdersDeepLink(input.venueId),
      pushOverrides: { collapseId: venueOrderCollapseId(input.orderId) },
    });
  } catch (err) {
    console.warn(
      "[venueOrderNotify] fireVenueOrderPlaced failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * The webhook and the free-order path both know only an order id at the moment
 * the order becomes real, so this reads the row and fires T0 from it.
 *
 * A TAB SETTLEMENT is deliberately skipped: `metadata.tab_settlement = 'true'`
 * marks the row that PAYS a staff-opened tab, and the kitchen already made and
 * served everything on it. Pushing "new order" at the pass because a guest tapped
 * pay on their way out would be a lie about what just happened.
 */
export async function fireVenueOrderPlacedForOrder(
  supabase: VenueOrderNotifyClient,
  orderId: string,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("venue_orders")
      .select(
        "id, brand_id, venue_id, currency, total_cents, spot_label_at_order, pickup_code, buyer_name, metadata",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (error !== null || !data) return;
    const row = data as Record<string, unknown>;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (String(metadata.tab_settlement ?? "") === "true") return;

    const { count } = await supabase
      .from("venue_order_items")
      .select("id", { count: "exact", head: true })
      .eq("venue_order_id", orderId);

    await fireVenueOrderPlaced(supabase, {
      orderId,
      brandId: String(row.brand_id),
      venueId: String(row.venue_id),
      currency: (row.currency as string | null) ?? null,
      totalCents: Number(row.total_cents ?? 0),
      itemCount: Number(count ?? 0),
      spotLabel: (row.spot_label_at_order as string | null) ?? null,
      pickupCode: (row.pickup_code as string | null) ?? null,
      buyerName: (row.buyer_name as string | null) ?? null,
    });
  } catch (err) {
    console.warn(
      "[venueOrderNotify] fireVenueOrderPlacedForOrder failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface VenueOrderEscalationInput {
  orderId: string;
  brandId: string;
  venueId: string;
  venueName: string;
  rung: EscalationRung;
  unackedSeconds: number;
  currency: string | null;
  totalCents: number;
  spotLabel?: string | null;
  pickupCode?: string | null;
  buyerName?: string | null;
}

/**
 * One rung of the ladder. The idempotency key carries the rung, so the same
 * rung can never write a second notifications row for the same person — and
 * because `pg_venue_order_escalation_scan` claims the rung in the same
 * statement it returns it from, a rung is handed out at most once anyway. Belt
 * AND braces, because the cost of a duplicate 2am push to an owner is real.
 */
export async function fireVenueOrderEscalation(
  supabase: VenueOrderNotifyClient,
  input: VenueOrderEscalationInput,
): Promise<void> {
  const destination = venueOrderDestinationLabel(input);
  const copy = escalationCopy(
    input.rung,
    destination,
    unackedMinutes(input.unackedSeconds),
  );
  await notifyBrandRoles(pinned(supabase), {
    brandId: input.brandId,
    roles: copy.roles,
    type: "business.venue_order_unacknowledged",
    title: copy.title,
    body: copy.body,
    data: {
      orderId: input.orderId,
      venueId: input.venueId,
      brandId: input.brandId,
      venueName: input.venueName,
      destination,
      escalationLevel: input.rung,
      unackedSeconds: input.unackedSeconds,
      totalCents: input.totalCents,
      currency: input.currency,
    },
    relatedId: input.orderId,
    relatedType: "venue_order",
    idempotencyKey:
      `business.venue_order_unacknowledged:${input.orderId}:${input.rung}`,
    deepLink: venueOrdersDeepLink(input.venueId),
    // Same collapse id as T0 and every other rung: the phone shows ONE live
    // alert per order that gets louder, not a growing stack (P-55).
    pushOverrides: { collapseId: venueOrderCollapseId(input.orderId) },
  });
}
