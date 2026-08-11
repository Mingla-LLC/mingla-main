// ===========================================================================
// Issue #1793 — #1767 Phase 4 (GUEST ORDERING ON): the shared shapes.
//
// SET-B of the re-scoped DEC-C gate (SPEC #1788 P-61): everything under
// `packages/brand-rendering/venueOrdering/**` MAY sell — a cart, a quantity
// stepper, an "Add to order" button are all legitimate here — and may NEVER
// touch money. No provider SDK, no payment-sheet name, no fee, no take-rate, no
// tax arithmetic. Every money number these modules render arrives already
// computed from `venue-order-create` (P-20), and the payment STEP itself lives
// in host-owned components that this folder never imports.
//
// TYPES ONLY. No React, no react-native, no runtime import of any kind, so this
// module is free to be imported by anything on any surface without pulling a
// single byte into a bundle.
// ===========================================================================

/**
 * What a guest may honestly be told about a venue's ordering, from
 * `pg_public_venue_ordering_state`.
 *
 * The four states exist because #1789's `pg_public_qr_spot_resolve` answers NULL
 * to all four, and a surface that can only see NULL has exactly one thing it can
 * draw: a card that reads as broken. The ORCHESTRATOR AMENDMENT registered
 * against this phase says a guest at a PAUSED venue must be told the venue
 * paused — not shown a failure.
 */
export type VenueOrderingState = "on" | "paused" | "off" | "unavailable";

/**
 * `none`    — the guest presented no code (they opened the venue page).
 * `ok`      — an active code serving THIS venue's kitchen.
 * `unknown` — no such active code here. Deliberately collapsed with "a code
 *             belonging to a different venue": telling them apart would say
 *             which codes exist.
 */
export type VenueOrderingSpotState = "none" | "ok" | "unknown";

export interface VenueOrderingSpot {
  /** `qr_spots.label` is nullable — an unlabelled spot is a real spot. */
  label: string | null;
  /** `table` | `room_unit` | `zone` | `custom` (D-3). */
  kind: string;
  /** D-3b — a spot may pin ONE menu (in-room dining, the roof bar's drinks). */
  servingMenuId: string | null;
}

/** The whole public ordering configuration for one venue, as read by a guest. */
export interface VenueOrderingConfig {
  state: VenueOrderingState;
  /** Needed by a counter-pickup order, which has no spot code to send. */
  venueId: string | null;
  venueName: string;
  spotState: VenueOrderingSpotState;
  spot: VenueOrderingSpot | null;
  /** D-9 — used ONLY to decide the tip default. The money is the server's. */
  serviceChargeBps: number;
  serviceChargeLabel: string;
  tipsEnabled: boolean;
  tipPresetsBps: number[] | null;
  counterPickupEnabled: boolean;
  prepTimeMinutes: number | null;
}

/**
 * One chosen option on a line. `priceDeltaCents` is a MENU FACT read off the
 * public menu payload — the same kind of fact as the item's own price — and is
 * rendered, never summed. Every total on every surface comes from the server.
 */
export interface VenueOrderModifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  currency: string;
}

export interface VenueOrderModifierGroup {
  id: string;
  name: string;
  /** `single` | `multi`. */
  selectionMode: string;
  minSelect: number;
  maxSelect: number | null;
  modifiers: VenueOrderModifier[];
}

/**
 * A line in the guest's basket. NOTHING WITH A PRICE IN IT — P-20. The request
 * body `venue-order-create` accepts is exactly this shape plus the buyer, and a
 * price key anywhere in it is a validation error rather than a hint.
 */
export interface VenueOrderCartLine {
  /** Stable client-side identity: item + its chosen options + its note. */
  key: string;
  menuItemId: string;
  itemName: string;
  quantity: number;
  modifierIds: string[];
  /** Names only, for rendering the line back to the guest. */
  modifierNames: string[];
  notes: string | null;
}

/**
 * The server's priced answer to a cart. Every field was computed inside
 * `venue-order-create` from server-read menu rows.
 *
 * The four lines a guest sees are `subtotalCents`, `serviceChargeCents`,
 * `feesAndTaxCents` and `tipCents`, and they satisfy
 *
 *     subtotal + serviceCharge + feesAndTax + tip === total
 *
 * by construction on the server. No surface adds them up to check, and no
 * surface may draw a fifth line of its own invention.
 */
export interface VenueOrderPricedLine {
  lineNo: number;
  menuItemId: string;
  itemNameAtOrder: string;
  unitPriceCents: number;
  currency: string;
  quantity: number;
  modifiersTotalCents: number;
  lineTotalCents: number;
  notes: string | null;
}

export interface VenueOrderPreview {
  currency: string;
  subtotalCents: number;
  /** D-9 — ALWAYS its own labelled line. Never merged into fees & tax. */
  serviceChargeCents: number;
  serviceChargeLabel: string;
  /** The ONE combined Mingla-fees-and-tax line, stated by the server. */
  feesAndTaxCents: number;
  /** P-18 — outside every fee, by arithmetic rather than by policy. */
  tipCents: number;
  totalCents: number;
  lines: VenueOrderPricedLine[];
  tipsEnabled: boolean;
  counterPickupEnabled: boolean;
}

/** How the guest gets their food. Recorded, never inferred (D-3a). */
export type VenueOrderHandover =
  | { kind: "spot"; spotLabel: string | null }
  | { kind: "counter"; pickupCode: string | null; buyerName: string };

export type VenueOrderFulfillmentStatus =
  | "placed"
  | "acknowledged"
  | "in_progress"
  | "ready"
  | "delivered"
  | "cancelled"
  | "refunded";

/** The live order, as `venue-order-status` reports it. */
export interface VenueOrderLiveStatus {
  orderId: string;
  paymentStatus: string;
  fulfillmentStatus: VenueOrderFulfillmentStatus;
  acknowledgedAt: string | null;
  readyAt: string | null;
  refundRequestedAt: string | null;
  refundDecision: string | null;
  escalationLevel: number;
  /** Non-null EXACTLY when the order had no spot — the counter-pickup case. */
  pickupCode: string | null;
  spotLabel: string | null;
  canCancel: boolean;
  canRequestRefund: boolean;
  totals: {
    currency: string;
    subtotalCents: number;
    serviceChargeCents: number;
    feesAndTaxCents: number;
    tipCents: number;
    totalCents: number;
    refundedAmountCents: number;
  };
}

/** The guest's contact triple. Validated server-side; mirrored here for UX. */
export interface VenueOrderBuyerDraft {
  name: string;
  email: string;
  phone: string;
}

/**
 * The tip the guest has chosen for this SITTING.
 *
 * `null` means "not asked yet". OQ-2, standing: the tip is asked on the FIRST
 * round and REMEMBERED thereafter — changeable at any round, never re-asked
 * unprompted. The memory lives on `venue_order_sessions.tip_bps_choice`; this is
 * only what the current screen is showing.
 */
export interface VenueOrderTipChoice {
  bps: number | null;
  flatCents: number | null;
}

/** Which of the Menu tab's three ordering views is on screen. */
export type VenueOrderingView = "browse" | "review" | "status";
