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
import {
  dispatchNotification,
  formatMoneyCents,
  getBrandTeamUserIdsByRoles,
} from "./stripeEdgeAuth.ts";
import { notifyBrandRoles } from "./businessNotifyTriggers.ts";
import { isMissingTillPaymentColumn } from "./tillMigrationCompat.ts";

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

/**
 * #4490 spec 08 §11 T4 — the floor staff who work orders at ONE venue: venue
 * staff (Kitchen / bar logins, Till devices) whose grant at that venue holds
 * any of these. Brand roles stay brand-wide (ROLES_VENUE_ORDER); these are
 * venue-scoped, so the same profile at another venue is never told.
 */
export const FLOOR_ORDER_CAPS = ["venue.kitchen", "restaurant.manage_orders"] as const;

/**
 * `issue_4490_venue_floor_user_ids` (service role). Never throws: a failed or
 * missing read (before migration 20281203604490 is applied — [TRANSITIONAL],
 * exits when that migration is in production) answers [] so the brand roles
 * are still told exactly as before.
 */
export async function venueFloorUserIds(
  supabase: VenueOrderNotifyClient,
  brandId: string,
  venueId: string,
  caps: readonly string[] = FLOOR_ORDER_CAPS,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("issue_4490_venue_floor_user_ids", {
      p_brand_id: brandId,
      p_venue_id: venueId,
      p_caps: [...caps],
    });
    if (error) {
      if (error.code !== "PGRST202" && error.code !== "42883") {
        console.warn("[venueOrderNotify] floor staff read failed (non-fatal):", error.code ?? "unknown");
      }
      return [];
    }
    return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
  } catch (err) {
    console.warn(
      "[venueOrderNotify] floor staff read failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

interface VenueRecipientsInput {
  brandId: string;
  venueId: string;
  roles: readonly string[];
  /** Also tell the venue's floor staff (T4). */
  floor: boolean;
  /** Anyone else to tell (T7: the person who sent the round). */
  extraUserIds?: ReadonlyArray<string | null | undefined>;
}

/** Brand roles ∪ the venue's floor staff ∪ extras, de-duplicated (T4). */
export async function venueOrderRecipients(
  supabase: VenueOrderNotifyClient,
  input: VenueRecipientsInput,
): Promise<string[]> {
  const roleIds = await getBrandTeamUserIdsByRoles(pinned(supabase), input.brandId, input.roles);
  const floorIds = input.floor ? await venueFloorUserIds(supabase, input.brandId, input.venueId) : [];
  const extra = (input.extraUserIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set([...roleIds, ...floorIds, ...extra]));
}

type DispatchInput = Parameters<typeof dispatchNotification>[0];

/** One dispatch per person, idempotency `<key>:<userId>` (the notifyBrandRoles rule). */
async function dispatchToEach(
  userIds: readonly string[],
  base: Omit<DispatchInput, "userId" | "idempotencyKey"> & { idempotencyKey: string },
): Promise<void> {
  for (const userId of userIds) {
    await dispatchNotification({ ...base, userId, idempotencyKey: `${base.idempotencyKey}:${userId}` });
  }
}

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
    // #4490 T4: brand roles AND the venue's Kitchen / bar and Till-device
    // logins, one dispatch each (idempotency key per person, as before).
    const recipients = await venueOrderRecipients(supabase, {
      brandId: input.brandId,
      venueId: input.venueId,
      roles: ROLES_VENUE_ORDER,
      floor: true,
    });
    await dispatchToEach(recipients, {
      brandId: input.brandId,
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
    const read = (columns: string) =>
      supabase
        .from("venue_orders")
        .select(columns)
        .eq("id", orderId)
        .maybeSingle();
    const BASE_COLUMNS =
      "id, brand_id, venue_id, currency, total_cents, spot_label_at_order, pickup_code, buyer_name, metadata";
    let { data, error } = await read(`${BASE_COLUMNS}, till_payment_id`);
    // [TRANSITIONAL] #4490 O2-T5: before the #4490 migrations reach production
    // there is no till_payment_id; every order is then a guest/staff order and
    // gets its push exactly as before O2. Exit: the migrations applied in
    // production (see tillMigrationCompat.ts).
    if (error && isMissingTillPaymentColumn(error)) {
      ({ data, error } = await read(BASE_COLUMNS));
    }
    if (error !== null || !data) return;
    const row = data as Record<string, unknown>;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (String(metadata.tab_settlement ?? "") === "true") return;
    // #4490 spec 08 O2: a Till carrier is a payment, never a new order. Only
    // late money (a cancelled payment that was paid) tells the seller.
    if (typeof row.till_payment_id === "string") {
      await fireTillLatePayment(supabase, row.till_payment_id, String(row.venue_id));
      return;
    }

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
  /**
   * #4490 spec 08 §11 T7: a sent Till round nobody accepted (no guest, no
   * Mingla money). Rung 1 also tells the person who sent it.
   */
  tillRound?: boolean;
  takenByUserId?: string | null;
}

/**
 * #4490 T7 — the same rungs for a Till round, without the guest lines (there
 * is no guest and no refund button behind a staff round).
 */
export function tillRoundEscalationCopy(
  rung: EscalationRung,
  destination: string,
  minutes: number,
): EscalationCopy {
  const base = escalationCopy(rung, destination, minutes);
  const mins = `${minutes} min`;
  if (rung === 1) return { ...base, body: `${mins} and the kitchen hasn't accepted it yet.` };
  if (rung === 2) return { ...base, body: `${mins} and nobody has accepted it. Print the ticket or call the kitchen.` };
  return base;
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
  const copy = (input.tillRound === true ? tillRoundEscalationCopy : escalationCopy)(
    input.rung,
    destination,
    unackedMinutes(input.unackedSeconds),
  );
  // #4490 T4 + T7: rung 1 also reaches the venue's floor staff and, for a Till
  // round, the person who sent it. Rungs 2 and 3 are unchanged (brand roles).
  const recipients = input.rung === 1
    ? await venueOrderRecipients(supabase, {
      brandId: input.brandId,
      venueId: input.venueId,
      roles: copy.roles,
      floor: true,
      extraUserIds: input.tillRound === true ? [input.takenByUserId] : [],
    })
    : null;
  const notify = (payload: Parameters<typeof notifyBrandRoles>[1]) =>
    recipients === null
      ? notifyBrandRoles(pinned(supabase), payload)
      : (({ roles: _roles, ...rest }) => dispatchToEach(recipients, rest))(payload);
  await notify({
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

/**
 * #4490 spec 08 O2 — "A cancelled payment was paid". Pushed once to whoever
 * took the payment, only when the money landed after the payment was
 * cancelled or its code expired (the Till then shows Refund / Keep).
 */
/** #4490 spec 08 O5 (T16): a guest order still waiting for a swap or refund. */
export interface VenueOrderSoldOutEscalationInput {
  orderId: string;
  brandId: string;
  venueId: string;
  venueName: string;
  itemNames: string | null;
  flaggedSeconds: number;
  spotLabel?: string | null;
  pickupCode?: string | null;
  buyerName?: string | null;
}

export function soldOutEscalationCopy(
  destination: string,
  itemNames: string | null,
  minutes: number,
): { title: string; body: string } {
  const what = itemNames && itemNames.trim() ? itemNames.trim() : "An item";
  return {
    title: `Sold out after payment · ${destination}`,
    body: `${what} sold out after the guest paid, ${minutes} min ago. Swap it or refund it.`,
  };
}

/**
 * T16 — rung 1 for a sold-out-after-payment order nobody resolved in 10
 * minutes: the brand's order roles and the venue's floor staff, once (its own
 * idempotency key; the scan claims it once). Never refunds, never pauses.
 */
export async function fireVenueOrderSoldOutEscalation(
  supabase: VenueOrderNotifyClient,
  input: VenueOrderSoldOutEscalationInput,
): Promise<void> {
  const destination = venueOrderDestinationLabel(input);
  const copy = soldOutEscalationCopy(destination, input.itemNames, unackedMinutes(input.flaggedSeconds));
  const recipients = await venueOrderRecipients(supabase, {
    brandId: input.brandId,
    venueId: input.venueId,
    roles: ROLES_VENUE_ORDER,
    floor: true,
  });
  await dispatchToEach(recipients, {
    type: "business.venue_order_unacknowledged",
    title: copy.title,
    body: copy.body,
    data: {
      orderId: input.orderId,
      venueId: input.venueId,
      brandId: input.brandId,
      venueName: input.venueName,
      destination,
      soldOutAfterPayment: true,
    },
    relatedId: input.orderId,
    relatedType: "venue_order",
    idempotencyKey: `business.venue_order_sold_out:${input.orderId}`,
    deepLink: venueOrdersDeepLink(input.venueId),
    pushOverrides: { collapseId: venueOrderCollapseId(input.orderId) },
  });
}

export async function fireTillLatePayment(
  supabase: VenueOrderNotifyClient,
  paymentId: string,
  venueId: string,
): Promise<void> {
  try {
    const { data } = await supabase.from("venue_till_payments")
      .select("id, paid_late, taken_by_user_id, venue_till_sales!inner(brand_id, check_label)")
      .eq("id", paymentId).maybeSingle();
    const row = (data ?? null) as Record<string, unknown> | null;
    if (!row || row.paid_late !== true || typeof row.taken_by_user_id !== "string") return;
    const rel = row.venue_till_sales as Record<string, unknown> | Array<Record<string, unknown>>;
    const sale = Array.isArray(rel) ? rel[0] : rel;
    await dispatchNotification({
      userId: row.taken_by_user_id,
      brandId: String(sale?.brand_id ?? ""),
      type: "business.venue_till_paid_late",
      title: "A cancelled payment was paid",
      body: "Refund it or keep it as payment",
      data: { venueId, paymentId },
      relatedId: paymentId,
      relatedType: "venue_till_payment",
      idempotencyKey: `venue_till_paid_late:${paymentId}`,
      deepLink: `mingla-business://venue/${venueId}/till`,
    });
  } catch (err) {
    console.warn(
      "[venueOrderNotify] fireTillLatePayment failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export interface VenueOrderReadyInput {
  orderId: string;
  station: "kitchen" | "bar";
  /** As the station ticket shows it (spot, moved label, or pickup code). */
  destination: string;
  /** Live (not voided) lines on that station's ticket. */
  itemCount: number;
}

/** "Ready · Table 6" / "Kitchen: 3 items to take out." (spec 08 §11 T5). */
export function venueOrderReadyCopy(input: VenueOrderReadyInput): { title: string; body: string } {
  const station = input.station === "bar" ? "Bar" : "Kitchen";
  const items = input.itemCount === 1 ? "1 item" : `${input.itemCount} items`;
  return { title: `Ready · ${input.destination}`, body: `${station}: ${items} to take out.` };
}

/**
 * #4490 spec 08 §11 T5 — a station marked its part of a Till round ready: tell
 * the person who sent the round and the check's server (if different). Guest
 * orders get no push (§11.4 item 3: every Till shows them). Never throws: the
 * station's tap already succeeded.
 */
export async function fireVenueOrderReady(
  supabase: VenueOrderNotifyClient,
  input: VenueOrderReadyInput,
): Promise<number> {
  try {
    const { data: order, error } = await supabase
      .from("venue_orders")
      .select("id, brand_id, venue_id, session_id, source, taken_by_user_id")
      .eq("id", input.orderId)
      .maybeSingle();
    if (error || !order || order.source !== "staff") return 0;
    const { data: sale } = await supabase
      .from("venue_till_sales")
      .select("id, server_user_id")
      .eq("session_id", order.session_id)
      .maybeSingle();
    const recipients = Array.from(new Set(
      [order.taken_by_user_id, sale?.server_user_id].filter((id): id is string => typeof id === "string"),
    ));
    const copy = venueOrderReadyCopy(input);
    await dispatchToEach(recipients, {
      brandId: String(order.brand_id),
      type: "business.venue_order_ready",
      title: copy.title,
      body: copy.body,
      data: {
        orderId: input.orderId,
        venueId: String(order.venue_id),
        saleId: sale?.id ?? null,
        station: input.station,
        destination: input.destination,
      },
      relatedId: input.orderId,
      relatedType: "venue_order",
      idempotencyKey: `business.venue_order_ready:${input.orderId}:${input.station}`,
      deepLink: `mingla-business://venue/${String(order.venue_id)}/till`,
      pushOverrides: { collapseId: `venue_order_ready:${input.orderId}:${input.station}` },
    });
    return recipients.length;
  } catch (err) {
    console.warn(
      "[venueOrderNotify] fireVenueOrderReady failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

/**
 * #4490 T7 — sent Till rounds among the scanned rows (venue-collected staff
 * rounds with a sent time), mapped to the person who sent each one.
 */
export async function tillRoundSenders(
  supabase: VenueOrderNotifyClient,
  orderIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (orderIds.length === 0) return out;
  try {
    const { data, error } = await supabase
      .from("venue_orders")
      .select("id, source, money_path, sent_at, taken_by_user_id")
      .in("id", orderIds);
    if (error) {
      // Before migration 20281203504490 there is no sent_at: no Till rounds.
      console.warn("[venue-order-escalation-sweep] till round read failed", error.code ?? "unknown");
      return out;
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (row.source === "staff" && row.money_path === "venue_collected" && row.sent_at) {
        out.set(String(row.id), typeof row.taken_by_user_id === "string" ? row.taken_by_user_id : null);
      }
    }
  } catch (err) {
    console.warn("[venue-order-escalation-sweep] till round read failed", err instanceof Error ? err.message : "unknown");
  }
  return out;
}
