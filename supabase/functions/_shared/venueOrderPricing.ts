// ===========================================================================
// Issue #1790 (SPEC #1788 Phase 2) — the venue-order money engine's PURE half.
//
// Co-located as a shared module rather than inside an edge function so it is
// unit-testable WITHOUT importing a serve()-on-load entry (the
// venue-reservation-create/ngPaystackSplit.ts pattern).
//
// P-20 — NEVER client-side money math. The client sends
// { menuItemId, quantity, modifierIds[], notes } and NOTHING with a price in
// it. Every number below is computed from SERVER-READ menu rows. A price in the
// request body is a validation error, not a hint.
//
// P-17 — the order of operations is load-bearing:
//   1. subtotal        = Sum over lines of (unit price + Sum modifier deltas) * qty
//   2. service charge  = round(subtotal * service_charge_bps / 10000)     [venue revenue]
//   3. FEE BASIS       = subtotal + service charge                        [and NOTHING else]
//   4. engine          = computeBuyerSubtotal({ baseCents: FEE BASIS, ... })
//   5. tax             on buyer subtotal
//   6. TIP             resolved LAST, from the subtotal only
//   7. total           = buyer subtotal + tax + tip
// The tip is computed after the fee and never feeds step 3, and the database
// enforces the same shape with a GENERATED fee_basis_cents column plus
// venue_orders_fee_from_basis. Two independent owners of one promise
// (I-PROPOSED-1767-NO-CUT-OF-A-TIP).
// ===========================================================================

import {
  buildPricingBreakdown,
  type ComputeAllInInput,
  computeBuyerSubtotal,
  computeConfigVat,
  feeFromBps,
  inclusiveVatDivisorForRegion,
  MINGLA_SERVICE_FEE_BPS,
  type PricingBreakdown,
  type PricingRegion,
  type PricingSwitches,
  type TaxBasis,
  taxBehaviorForRegion,
} from "./allInPricingEngine.ts";

// ---------------------------------------------------------------------------
// P-29 — error codes and the EXACT user-visible copy. VERBATIM from the spec
// table. This module is the single owner of that copy so no surface can
// paraphrase it.
//
// Every 4xx/5xx on a money path states EXPLICITLY that nothing was charged when
// nothing was charged. Silence there is what makes a guest pay twice.
// ---------------------------------------------------------------------------
export interface VenueOrderErrorSpec {
  status: number;
  /** What a GUEST reads. null = this code is never shown to a guest. */
  guest: string | null;
  /** What STAFF read. null = this code is never shown to staff. */
  staff: string | null;
}

export const VENUE_ORDER_ERRORS = {
  invalid_json: {
    status: 400,
    guest: "Something went wrong. Try again.",
    staff: "Something went wrong. Try again.",
  },
  buyer_name_required: {
    status: 400,
    guest: "Add a name so they know whose order this is.",
    staff: "Add the guest's name.",
  },
  buyer_email_invalid: {
    status: 400,
    guest: "That email doesn't look right.",
    staff: "That email doesn't look right.",
  },
  buyer_phone_required: {
    status: 400,
    guest: "We need a phone number to text you when it's ready.",
    staff: "Add a phone number.",
  },
  modifier_selection_invalid: {
    status: 400,
    guest: "Choose an option for {group} before adding this.",
    staff: "Choose an option for {group} before adding this.",
  },
  mixed_currency: {
    status: 400,
    guest:
      "These items are priced in different currencies — order them separately.",
    staff: "Mixed currencies in one order.",
  },
  spot_unknown: {
    status: 404,
    guest: "This code isn't active. Ask a member of staff.",
    staff: "That spot is inactive or deleted.",
  },
  venue_not_orderable: {
    status: 409,
    guest: "{Venue} isn't taking orders through Mingla yet.",
    staff: "This venue isn't verified for ordering.",
  },
  ordering_paused: {
    status: 409,
    guest: "{Venue} has paused ordering right now. Try again shortly.",
    staff: "Ordering is paused. Turn it back on from Orders.",
  },
  item_not_orderable: {
    status: 409,
    guest: "{Item} just came off the menu.",
    staff: "{Item} is 86'd or outside its service window.",
  },
  counter_pickup_unavailable: {
    status: 409,
    guest: "Scan the code on your table to order.",
    staff: "Counter pickup is off for this venue.",
  },
  stripe_account_not_ready: {
    status: 409,
    guest: "{Venue} can't take card payments yet.",
    staff: "Finish Stripe verification to take orders.",
  },
  refund_window_closed: {
    status: 409,
    guest:
      "This order's already been served — message the venue and they'll sort you out.",
    staff: null,
  },
  transition_not_allowed: {
    status: 409,
    guest: null,
    staff: "That order has already moved on. Pull to refresh.",
  },
  tab_not_open: {
    status: 409,
    guest: null,
    staff: "That tab is already closed.",
  },
  order_total_invalid: {
    status: 422,
    guest: "We couldn't price that order. Nothing has been charged.",
    staff: "We couldn't price that order. Nothing has been charged.",
  },
  too_many_orders: {
    status: 429,
    guest: "That's a lot of orders very quickly. Give it a moment.",
    staff: null,
  },
  payment_intent_create_failed: {
    status: 502,
    guest: "Your card wasn't charged. Try again.",
    staff: null,
  },
  pdf_render_failed: {
    status: 502,
    guest: null,
    staff: "The sheet didn't render. Try again.",
  },
  internal_error: {
    status: 500,
    guest: "Something went wrong. Nothing has been charged.",
    staff: "Something went wrong. Nothing has been charged.",
  },
} as const satisfies Record<string, VenueOrderErrorSpec>;

export type VenueOrderErrorCode = keyof typeof VENUE_ORDER_ERRORS;
export type VenueOrderAudience = "guest" | "staff";

/**
 * The exact user-visible copy for a code, with `{Venue}` / `{Item}` / `{group}`
 * substituted. Returns null when the code is deliberately never shown to that
 * audience (e.g. `too_many_orders` has no staff copy).
 */
export function venueOrderErrorCopy(
  code: VenueOrderErrorCode,
  audience: VenueOrderAudience,
  vars: { venue?: string; item?: string; group?: string } = {},
): string | null {
  const spec = VENUE_ORDER_ERRORS[code];
  const raw = audience === "guest" ? spec.guest : spec.staff;
  if (raw === null) return null;
  return raw
    .replace("{Venue}", vars.venue ?? "This venue")
    .replace("{Item}", vars.item ?? "That item")
    .replace("{group}", vars.group ?? "that option");
}

export function venueOrderErrorStatus(code: VenueOrderErrorCode): number {
  return VENUE_ORDER_ERRORS[code].status;
}

// ---------------------------------------------------------------------------
// Cart validation + line pricing (P-22 gates 4-6, P-4a, P-4b).
// ---------------------------------------------------------------------------
export interface MenuItemRow {
  id: string;
  menu_id: string;
  brand_id: string;
  name: string;
  /** NULL = "price on request". Structurally not orderable (P-4b). */
  price_cents: number | null;
  currency: string;
  is_available: boolean;
}

export interface MenuModifierRow {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  currency: string;
  is_available: boolean;
}

export interface MenuModifierGroupRow {
  id: string;
  menu_item_id: string;
  name: string;
  selection_mode: "single" | "multi";
  min_select: number;
  max_select: number | null;
  is_active: boolean;
}

export interface RequestedLine {
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  notes: string | null;
}

export interface PricedModifier {
  menuModifierId: string;
  groupNameAtOrder: string;
  modifierNameAtOrder: string;
  priceDeltaCents: number;
  currency: string;
}

export interface PricedLine {
  lineNo: number;
  menuItemId: string;
  itemNameAtOrder: string;
  unitPriceCents: number;
  currency: string;
  quantity: number;
  modifiersTotalCents: number;
  lineTotalCents: number;
  notes: string | null;
  modifiers: PricedModifier[];
}

export type CartFailure =
  | { code: "item_not_orderable"; item: string }
  | { code: "modifier_selection_invalid"; group: string }
  | { code: "mixed_currency" }
  | { code: "order_total_invalid" };

export type CartResult =
  | { ok: true; lines: PricedLine[]; subtotalCents: number; currency: string }
  | { ok: false; failure: CartFailure };

/**
 * Price a cart against SERVER-READ menu rows. Nothing here reads a price from
 * the request. Fails closed on the first violation, naming the item or group so
 * the user-visible copy can say WHICH one.
 *
 * `orderableItemIds` is the P-13 derivation (menu active, inside its service
 * window in VENUE-LOCAL time, venue verified, ordering enabled and unpaused)
 * computed by the caller, which is the only place that knows the venue's clock.
 * An item absent from that set is `item_not_orderable`, named.
 */
export function priceCart(input: {
  requested: RequestedLine[];
  itemsById: Map<string, MenuItemRow>;
  groupsByItemId: Map<string, MenuModifierGroupRow[]>;
  modifiersById: Map<string, MenuModifierRow>;
  orderableItemIds: Set<string>;
}): CartResult {
  const { requested, itemsById, groupsByItemId, modifiersById } = input;
  if (requested.length === 0) {
    return { ok: false, failure: { code: "order_total_invalid" } };
  }

  const lines: PricedLine[] = [];
  const currencies = new Set<string>();
  let subtotalCents = 0;
  let lineNo = 0;

  for (const req of requested) {
    lineNo += 1;
    const item = itemsById.get(req.menuItemId);
    if (item === undefined) {
      return {
        ok: false,
        failure: { code: "item_not_orderable", item: "That item" },
      };
    }
    // P-4b — a NULL price_cents item is "price on request" and is structurally
    // not orderable: venue_order_items.unit_price_cents is NOT NULL.
    if (
      item.price_cents === null || !item.is_available ||
      !input.orderableItemIds.has(item.id)
    ) {
      return {
        ok: false,
        failure: { code: "item_not_orderable", item: item.name },
      };
    }
    if (!Number.isInteger(req.quantity) || req.quantity < 1 || req.quantity > 99) {
      return { ok: false, failure: { code: "order_total_invalid" } };
    }

    currencies.add(item.currency);

    const groups = groupsByItemId.get(item.id) ?? [];
    const chosen: PricedModifier[] = [];
    const chosenIds = new Set(req.modifierIds);
    if (chosenIds.size !== req.modifierIds.length) {
      // A duplicate modifier id would double-charge a delta.
      return { ok: false, failure: { code: "order_total_invalid" } };
    }

    // Every chosen modifier must belong to a group of THIS item and be available.
    const groupIds = new Set(groups.filter((g) => g.is_active).map((g) => g.id));
    for (const modifierId of req.modifierIds) {
      const modifier = modifiersById.get(modifierId);
      if (
        modifier === undefined || !modifier.is_available ||
        !groupIds.has(modifier.group_id)
      ) {
        const owning = groups.find((g) => g.id === modifier?.group_id);
        return {
          ok: false,
          failure: {
            code: "modifier_selection_invalid",
            group: owning?.name ?? "that option",
          },
        };
      }
      const group = groups.find((g) => g.id === modifier.group_id)!;
      // P-11a — a modifier priced in another currency IS the cross-sum bug in
      // disguise. Re-asserted here even though a trigger also enforces it.
      currencies.add(modifier.currency);
      chosen.push({
        menuModifierId: modifier.id,
        groupNameAtOrder: group.name,
        modifierNameAtOrder: modifier.name,
        priceDeltaCents: modifier.price_delta_cents,
        currency: modifier.currency,
      });
    }

    // Group satisfaction: min_select met, max_select not exceeded.
    for (const group of groups) {
      if (!group.is_active) continue;
      const count = chosen.filter((c) =>
        modifiersById.get(c.menuModifierId)?.group_id === group.id
      ).length;
      const max = group.max_select ??
        (group.selection_mode === "single" ? 1 : Number.MAX_SAFE_INTEGER);
      if (count < group.min_select || count > max) {
        return {
          ok: false,
          failure: { code: "modifier_selection_invalid", group: group.name },
        };
      }
    }

    const modifiersTotalCents = chosen.reduce(
      (sum, c) => sum + c.priceDeltaCents,
      0,
    );
    const unitPriceCents = item.price_cents;
    if (unitPriceCents + modifiersTotalCents < 0) {
      // A negative-portion modifier can never drive a line below zero.
      return { ok: false, failure: { code: "order_total_invalid" } };
    }
    const lineTotalCents = (unitPriceCents + modifiersTotalCents) * req.quantity;

    lines.push({
      lineNo,
      menuItemId: item.id,
      itemNameAtOrder: item.name,
      unitPriceCents,
      currency: item.currency,
      quantity: req.quantity,
      modifiersTotalCents,
      lineTotalCents,
      notes: req.notes,
      modifiers: chosen,
    });
    subtotalCents += lineTotalCents;
  }

  // P-22 gate 6 / I-PROPOSED-1767-NEVER-CROSS-SUM-CURRENCIES.
  if (currencies.size > 1) {
    return { ok: false, failure: { code: "mixed_currency" } };
  }
  if (subtotalCents < 0) {
    return { ok: false, failure: { code: "order_total_invalid" } };
  }

  return {
    ok: true,
    lines,
    subtotalCents,
    currency: [...currencies][0] ?? "",
  };
}

// ---------------------------------------------------------------------------
// The money shape (P-17 / P-18 / P-19 / P-21).
// ---------------------------------------------------------------------------
export interface VenueOrderMoneyInput {
  subtotalCents: number;
  serviceChargeBps: number;
  /** null = the sitting has not been asked yet; 0 = explicitly declined. */
  tipBps: number | null;
  /** A flat tip in minor units, when the guest typed an amount instead of a %. */
  tipFlatCents: number | null;
  switches: PricingSwitches;
  region: PricingRegion;
  currency: string;
  effectiveTakeRateBps: number;
  takeRateSource: "brand_override" | "platform_default";
  serviceFeeBps?: number;
  /** NG only — country_vat_config bps. */
  vatRateBps?: number | null;
}

export interface VenueOrderMoney {
  subtotalCents: number;
  serviceChargeBps: number;
  serviceChargeCents: number;
  /** subtotal + service charge. The ONLY thing the take-rate ever multiplies. */
  feeBasisCents: number;
  minglaFeeCents: number;
  platformServiceFeeCents: number;
  buyerSubtotalCents: number;
  taxAmountCents: number;
  tipCents: number;
  totalCents: number;
  taxBasis: TaxBasis;
  pricingBreakdown: PricingBreakdown;
}

export function computeVenueOrderMoney(
  input: VenueOrderMoneyInput,
): VenueOrderMoney {
  // (2) the venue's own service charge — VENUE revenue, so it IS inside the fee
  // basis. This is the deliberate contrast with a tip (D-9 / P-19).
  const serviceChargeCents = feeFromBps(
    input.subtotalCents,
    input.serviceChargeBps,
  );
  // (3) THE FEE BASIS.
  const feeBasisCents = input.subtotalCents + serviceChargeCents;

  // (4) the SHARED all-in engine. Never hand-rolled here.
  const engineInput: ComputeAllInInput = {
    baseCents: feeBasisCents,
    switches: input.switches,
    region: input.region,
    currency: input.currency,
    effectiveTakeRateBps: input.effectiveTakeRateBps,
    takeRateSource: input.takeRateSource,
    serviceFeeBps: input.serviceFeeBps ?? MINGLA_SERVICE_FEE_BPS,
  };
  const engine = computeBuyerSubtotal(engineInput);

  // (5) tax. P-21 — the launch posture is the SHIPPED degrade-to-flat-absorb
  // ladder, which produces an honest `unresolved_flat_absorb` rather than a
  // fabricated number. NO F&B Stripe Tax code is chosen here (OQ-3): the
  // per-item tax_code column is a seam, deliberately unpopulated, and any code
  // written into it later must first be verified against live Stripe docs.
  let taxBasis: TaxBasis = "unresolved_flat_absorb";
  let taxCents = 0;
  let amountTotalCents = engine.buyerSubtotalCents;
  if (input.region === "NG") {
    const vat = computeConfigVat(
      engine.buyerSubtotalCents,
      input.vatRateBps ?? 0,
      input.switches.pass_tax,
    );
    taxBasis = "config_vat";
    taxCents = vat.taxCents;
    amountTotalCents = vat.buyerTotalCents;
  } else if (
    input.switches.pass_tax && taxBehaviorForRegion(input.region) === "inclusive"
  ) {
    const divisor = inclusiveVatDivisorForRegion(input.region);
    taxCents = engine.buyerSubtotalCents -
      Math.round(engine.buyerSubtotalCents / divisor);
    taxBasis = "venue_resolved";
    amountTotalCents = engine.buyerSubtotalCents;
  }

  const pricingBreakdown = buildPricingBreakdown({
    input: engineInput,
    amountTotalCents,
    taxCents,
    taxBasis,
    stripeTaxCalculationId: null,
  });

  // (6) THE TIP. Resolved LAST, from the SUBTOTAL only — never from the fee
  // basis, never from the buyer subtotal, and never from anything that has
  // already had a fee applied to it. Added to nothing but the total.
  const tipCents = resolveTipCents(
    input.subtotalCents,
    input.tipBps,
    input.tipFlatCents,
  );

  // (7) DERIVED from the engine's own numbers rather than re-decided here, so
  // this can never drift from buildPricingBreakdown:
  //   * GB/EU/CH inclusive — the VAT is INSIDE buyer_subtotal, so the ADDITIVE
  //     tax on the row is 0. Adding it again would charge the guest twice.
  //     The VAT still renders, from pricing_breakdown.components.tax_cents.
  //   * NG exclusive — VAT rides on top, so the difference is the real tax.
  //   * flat-absorb — 0, honestly.
  const buyerSubtotalCents = engine.buyerSubtotalCents;
  const taxAmountCents = Math.max(
    0,
    pricingBreakdown.buyer_total_cents - buyerSubtotalCents,
  );
  const totalCents = buyerSubtotalCents + taxAmountCents + tipCents;

  return {
    subtotalCents: input.subtotalCents,
    serviceChargeBps: input.serviceChargeBps,
    serviceChargeCents,
    feeBasisCents,
    minglaFeeCents: engine.miglaFeeCents,
    platformServiceFeeCents: engine.serviceFeeCents,
    buyerSubtotalCents,
    taxAmountCents,
    tipCents,
    totalCents,
    taxBasis,
    // I-PROPOSED-1767-EVERY-CHARGE-IS-VISIBLE — the venue's service charge and
    // the tip are carried as NAMED components alongside the engine's own
    // breakdown, so no checkout surface can render a charge the guest cannot
    // see, and neither is ever folded into the ONE combined "Fees & tax" line
    // (which stays Mingla's fees). ADDITIVE to the shared PricingBreakdown
    // shape — the engine's type is never forked.
    pricingBreakdown: {
      ...pricingBreakdown,
      venue_service_charge_bps: input.serviceChargeBps,
      venue_service_charge_cents: serviceChargeCents,
      tip_cents: tipCents,
    } as PricingBreakdown & {
      venue_service_charge_bps: number;
      venue_service_charge_cents: number;
      tip_cents: number;
    },
  };
}

/**
 * The tip, in minor units. A percentage preset applies to the SUBTOTAL only —
 * not the service charge, not the fees, not the tax — so a venue's own service
 * charge can never inflate the tip the guest thought they were leaving.
 */
export function resolveTipCents(
  subtotalCents: number,
  tipBps: number | null,
  tipFlatCents: number | null,
): number {
  if (tipFlatCents !== null && Number.isInteger(tipFlatCents) && tipFlatCents > 0) {
    return tipFlatCents;
  }
  if (tipBps !== null && Number.isInteger(tipBps) && tipBps > 0) {
    return feeFromBps(subtotalCents, tipBps);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// P-23 layer 1 — the deterministic idempotency key.
//
// Deliberately DIFFERENT from the ticket path: it includes sessionId, so a
// table legitimately ordering "two more of the same" in a later sitting is not
// collapsed into the first order. The derived default is the CRASH-SAFETY
// FLOOR, not the primary mechanism — the client MUST send a per-tap key, and
// two identical rounds inside ONE sitting are exactly why.
// ---------------------------------------------------------------------------
export function venueOrderIdempotencyFingerprint(input: {
  sessionId: string;
  lines: RequestedLine[];
  tipBps: number | null;
}): string {
  const lineKey = input.lines
    .map((line) =>
      [
        line.menuItemId,
        line.quantity,
        [...line.modifierIds].sort().join("+"),
        (line.notes ?? "").trim(),
      ].join("~")
    )
    .sort()
    .join("|");
  return [input.sessionId, lineKey, `tip:${input.tipBps ?? "none"}`].join(":");
}

export async function venueOrderIdempotencyKey(
  input: { sessionId: string; lines: RequestedLine[]; tipBps: number | null },
  sha256Hex: (value: string) => Promise<string>,
): Promise<string> {
  const digest = await sha256Hex(venueOrderIdempotencyFingerprint(input));
  return `venue_order:${input.sessionId}:${digest}:${input.tipBps ?? "none"}`;
}

// ---------------------------------------------------------------------------
// P-13 — orderability is DERIVED, never stored. A stored copy of a seven-input
// derivation is a staleness bug with a schema.
//
// `service_window_end < service_window_start` means the window WRAPS MIDNIGHT
// (a late-night menu). A naive BETWEEN gets that wrong, which is why it is
// spelled out here and tested.
// ---------------------------------------------------------------------------
export function menuServiceWindowContains(
  window: {
    start: string | null; // "HH:MM:SS" venue-local
    end: string | null;
    days: number[] | null; // ISO 1..7
  },
  venueLocal: { isoDayOfWeek: number; minutesSinceMidnight: number },
): boolean {
  if (window.days !== null && !window.days.includes(venueLocal.isoDayOfWeek)) {
    return false;
  }
  if (window.start === null || window.end === null) return true; // always available
  const start = hhmmToMinutes(window.start);
  const end = hhmmToMinutes(window.end);
  if (start === null || end === null) return true;
  const now = venueLocal.minutesSinceMidnight;
  if (end >= start) return now >= start && now < end;
  // wraps midnight
  return now >= start || now < end;
}

function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (match === null) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) {
    return null;
  }
  return h * 60 + m;
}
