// ===========================================================================
// Issue #1793 — #1767 Phase 4: the guest ordering RULES, as pure functions.
//
// SET-B (SPEC #1788 P-61): may sell, may never touch money. Nothing in this file
// multiplies, adds or rounds a price. The only numbers it handles are counts,
// clock minutes, weekday indices and basis points it compares against zero.
//
// NO REACT, NO REACT-NATIVE. Everything here is arithmetic over data, which is
// what lets the regressions drive it directly instead of through a renderer.
// ===========================================================================

import type { PublicMenuGroup, PublicMenuItem } from "../types";
import type {
  VenueOrderCartLine,
  VenueOrderHandover,
  VenueOrderingConfig,
  VenueOrderLiveStatus,
  VenueOrderModifierGroup,
  VenueOrderTipChoice,
} from "./venueOrderingTypes";

// ---------------------------------------------------------------------------
// 1. Orderability, mirrored from the server for the GUEST'S sake only.
//
// P-13 — orderability is DERIVED from seven inputs and the SERVER is the only
// authority on it: `venue-order-create` re-derives every one of them and refuses
// the order otherwise. What this mirror buys is honesty in the other direction —
// a breakfast menu that stops offering an "Add" button at 11:01 instead of
// letting a guest build a basket the kitchen will reject. When the two disagree
// the server wins, and the guest is told which item came off (P-29
// `item_not_orderable` names it).
// ---------------------------------------------------------------------------

/** Where the VENUE's own clock stands. ISO weekday: 1 = Monday … 7 = Sunday. */
export interface VenueOrderingLocalClock {
  isoDayOfWeek: number;
  minutesSinceMidnight: number;
}

export interface VenueOrderingServiceWindow {
  /** "HH:MM" / "HH:MM:SS", venue-local. Null = always available. */
  start: string | null;
  end: string | null;
  /** ISO 1..7. Null = every day. */
  days: number[] | null;
}

const hhmmToMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
};

/**
 * BYTE-FOR-BYTE the same rule as the server's `menuServiceWindowContains`
 * (`supabase/functions/_shared/venueOrderPricing.ts`), including the wrap: an
 * `end` earlier than its `start` means the window CROSSES MIDNIGHT, which is
 * what a late-night menu is, and a naive BETWEEN gets it exactly backwards.
 *
 * The parity is pinned by a regression that reads both files, because two
 * implementations of one rule is how a guest comes to be offered at 00:30 an
 * item the kitchen will refuse at 00:30.
 */
export function venueOrderingWindowContains(
  window: VenueOrderingServiceWindow,
  local: VenueOrderingLocalClock,
): boolean {
  if (window.days !== null && !window.days.includes(local.isoDayOfWeek)) {
    return false;
  }
  if (window.start === null || window.end === null) return true;
  const start = hhmmToMinutes(window.start);
  const end = hhmmToMinutes(window.end);
  if (start === null || end === null) return true;
  const now = local.minutesSinceMidnight;
  if (end >= start) return now >= start && now < end;
  return now >= start || now < end;
}

/** `venueOpenState.venueLocalClock` is Monday-0; the server speaks ISO 1..7. */
export function isoDayFromMondayZero(weekday: number): number {
  return weekday + 1;
}

export interface VenueOrderingMenuGroupView extends PublicMenuGroup {
  /** False ⇒ rendered, but with no way to add anything from it. */
  orderable: boolean;
  window: VenueOrderingServiceWindow;
}

/**
 * Which menus a guest may actually order from right now.
 *
 * Two filters, both of them the server's rules restated:
 *   - a spot may PIN one menu (D-3b: Room 204 orders in-room dining, the roof
 *     bar orders drinks). `loadMenuSnapshot` drops every item off any other
 *     menu, so offering them here would be offering a rejection.
 *   - a menu outside its service window is closed, in the VENUE's timezone.
 *
 * A closed menu is still RENDERED — a guest reading the breakfast menu at 21:00
 * is entitled to read it. It simply cannot be added to.
 */
export function venueOrderingMenuGroups(input: {
  groups: PublicMenuGroup[];
  windowsByMenuId: Record<string, VenueOrderingServiceWindow | undefined>;
  servingMenuId: string | null;
  local: VenueOrderingLocalClock | null;
  orderingOn: boolean;
}): VenueOrderingMenuGroupView[] {
  const pinned = input.servingMenuId;
  return input.groups
    .filter((group) => pinned === null || group.menuId === pinned)
    .map((group) => {
      const window = input.windowsByMenuId[group.menuId] ??
        { start: null, end: null, days: null };
      // An unresolvable venue clock does NOT close the menu. The server fails
      // open on the clock for the same reason (`venueLocalNow`): a closed menu
      // is a lost sale, not a money risk, and the order-create path re-checks
      // the window against the venue's real time anyway.
      const open = input.local === null
        ? true
        : venueOrderingWindowContains(window, input.local);
      return { ...group, window, orderable: input.orderingOn && open };
    });
}

/** `price_cents IS NULL` is "price on request" and is structurally unorderable. */
export function venueOrderingItemOrderable(
  item: PublicMenuItem,
  groupOrderable: boolean,
): boolean {
  return groupOrderable && item.priceCents !== null;
}

// ---------------------------------------------------------------------------
// 2. Option groups — P-22 gate 5, mirrored so a guest is stopped BEFORE they pay
//    rather than after.
// ---------------------------------------------------------------------------

/** The first unsatisfied group, or null. Named, so the copy can say which. */
export function venueOrderingModifierFailure(
  groups: VenueOrderModifierGroup[],
  chosenIds: string[],
): { group: string; reason: "too_few" | "too_many" } | null {
  const chosen = new Set(chosenIds);
  for (const group of groups) {
    let count = 0;
    for (const modifier of group.modifiers) {
      if (chosen.has(modifier.id)) count += 1;
    }
    if (count < group.minSelect) return { group: group.name, reason: "too_few" };
    if (group.maxSelect !== null && count > group.maxSelect) {
      return { group: group.name, reason: "too_many" };
    }
  }
  return null;
}

export function venueOrderingModifierMessage(
  failure: { group: string; reason: "too_few" | "too_many" },
): string {
  // P-29 `modifier_selection_invalid`, guest copy, verbatim.
  return failure.reason === "too_few"
    ? `Choose an option for ${failure.group} before adding this.`
    : `Too many options chosen for ${failure.group}.`;
}

// ---------------------------------------------------------------------------
// 3. The basket. Identity, not arithmetic.
// ---------------------------------------------------------------------------

/**
 * A line's identity is its item, its chosen options and its note — so "two
 * burgers, one with no onions" is two lines and adding a third plain burger
 * lands on the plain line rather than silently changing someone's order.
 */
export function venueOrderCartLineKey(input: {
  menuItemId: string;
  modifierIds: string[];
  notes: string | null;
}): string {
  const mods = [...input.modifierIds].sort().join(",");
  const note = (input.notes ?? "").trim().toLowerCase();
  return `${input.menuItemId}|${mods}|${note}`;
}

export type VenueOrderCartAction =
  | { type: "ADD"; line: Omit<VenueOrderCartLine, "key" | "quantity">; quantity?: number }
  | { type: "SET_QUANTITY"; key: string; quantity: number }
  | { type: "REMOVE"; key: string }
  | { type: "CLEAR" };

/** 99 is the server's own per-line ceiling (`priceCart`); agreeing costs nothing. */
export const VENUE_ORDER_MAX_LINE_QUANTITY = 99;

export function venueOrderCartReducer(
  lines: VenueOrderCartLine[],
  action: VenueOrderCartAction,
): VenueOrderCartLine[] {
  switch (action.type) {
    case "ADD": {
      const key = venueOrderCartLineKey(action.line);
      const step = action.quantity === undefined ? 1 : action.quantity;
      if (!Number.isInteger(step) || step < 1) return lines;
      const existing = lines.find((line) => line.key === key);
      if (existing === undefined) {
        return [...lines, {
          ...action.line,
          key,
          quantity: Math.min(step, VENUE_ORDER_MAX_LINE_QUANTITY),
        }];
      }
      return lines.map((line) =>
        line.key === key
          ? {
            ...line,
            quantity: Math.min(
              line.quantity + step,
              VENUE_ORDER_MAX_LINE_QUANTITY,
            ),
          }
          : line
      );
    }
    case "SET_QUANTITY": {
      if (!Number.isInteger(action.quantity)) return lines;
      if (action.quantity < 1) {
        return lines.filter((line) => line.key !== action.key);
      }
      return lines.map((line) =>
        line.key === action.key
          ? {
            ...line,
            quantity: Math.min(action.quantity, VENUE_ORDER_MAX_LINE_QUANTITY),
          }
          : line
      );
    }
    case "REMOVE":
      return lines.filter((line) => line.key !== action.key);
    case "CLEAR":
      return [];
    default:
      return lines;
  }
}

/** How many things are in the basket. A COUNT — the only sum allowed here. */
export function venueOrderCartCount(lines: VenueOrderCartLine[]): number {
  let total = 0;
  for (const line of lines) total += line.quantity;
  return total;
}

/** The wire shape `venue-order-create` accepts. Nothing with a price in it. */
export function venueOrderCartWireLines(
  lines: VenueOrderCartLine[],
): Array<{
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  notes: string | null;
}> {
  return lines.map((line) => ({
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    modifierIds: line.modifierIds,
    notes: line.notes,
  }));
}

// ---------------------------------------------------------------------------
// 4. The tip (D-2 / P-18 / OQ-2).
// ---------------------------------------------------------------------------

/** The presets a venue offers, or the house default when it has configured none. */
export const VENUE_ORDER_DEFAULT_TIP_PRESETS_BPS: readonly number[] = [
  1000,
  1250,
  1500,
];

export function venueOrderTipPresets(config: VenueOrderingConfig): number[] {
  const configured = Array.isArray(config.tipPresetsBps)
    ? config.tipPresetsBps.filter((bps) => Number.isInteger(bps) && bps > 0)
    : [];
  // The filter runs BEFORE the emptiness check, not after: a venue that
  // configured a single junk preset would otherwise be left with a tip row
  // offering nothing but "None" — a control that looks broken rather than a
  // venue that simply has not configured one.
  return configured.length > 0
    ? configured
    : [...VENUE_ORDER_DEFAULT_TIP_PRESETS_BPS];
}

/**
 * The tip choice this screen starts with.
 *
 * OQ-2, standing: asked on the FIRST round of a sitting and REMEMBERED
 * thereafter — changeable at any round, never re-asked unprompted. `remembered`
 * is what the sitting already knows (it lives on
 * `venue_order_sessions.tip_bps_choice`); when it is present it wins, full stop.
 *
 * D-9: where the venue levies its OWN service charge, a fresh sitting starts at
 * NO TIP rather than stacking a second gratuity on top of one the guest is
 * already paying. That is a preselected zero, not a hidden one — the row still
 * renders and the guest can still tip.
 */
export function venueOrderInitialTip(
  config: VenueOrderingConfig,
  remembered: VenueOrderTipChoice | null,
): VenueOrderTipChoice {
  if (!config.tipsEnabled) return { bps: null, flatCents: null };
  if (remembered !== null) return remembered;
  if (config.serviceChargeBps > 0) return { bps: 0, flatCents: null };
  return { bps: null, flatCents: null };
}

/**
 * Is this sitting's tip a REMEMBERED answer rather than a fresh question?
 *
 * The row's heading changes on this, and only on this: a four-round table is
 * asked once and told "Tip · 10% (change)" for the next three.
 */
export function venueOrderTipIsRemembered(
  hasSitting: boolean,
  remembered: VenueOrderTipChoice | null,
): boolean {
  return hasSitting && remembered !== null;
}

// ---------------------------------------------------------------------------
// 5. Handover — D-3a. A no-spot order is NEVER promised delivery.
// ---------------------------------------------------------------------------

/**
 * How this order reaches its guest, derived from the ORDER'S OWN RECORD.
 *
 * `pickup_code` is non-null exactly when `qr_spot_id` was null — the server
 * mints it in that branch and in no other — so the branch is a recorded fact,
 * never a guess about where somebody might be sitting (the fabrication trap
 * D-3a names). A counter order gets a code; a spot order gets its spot.
 */
export function venueOrderHandover(
  live: Pick<VenueOrderLiveStatus, "pickupCode" | "spotLabel">,
  buyerName: string,
): VenueOrderHandover {
  if (live.pickupCode !== null && live.pickupCode !== "") {
    return { kind: "counter", pickupCode: live.pickupCode, buyerName };
  }
  return { kind: "spot", spotLabel: live.spotLabel };
}

export interface VenueOrderProgressCopy {
  title: string;
  body: string;
}

/**
 * What the guest reads at each step, branched on how the food actually reaches
 * them.
 *
 * THE RULE THIS ENCODES: a counter-pickup order is never told anything is on its
 * way to it. There is no table to bring it to — the guest ordered standing at a
 * venue page with no scanned spot — and telling them to wait somewhere for a
 * plate that will sit under a heat lamp until they collect it is the single
 * worst thing this surface could say. So the `ready` copy branches, and so does
 * every step before it.
 */
export function venueOrderProgressCopy(
  status: VenueOrderLiveStatus["fulfillmentStatus"],
  handover: VenueOrderHandover,
): VenueOrderProgressCopy {
  const collecting = handover.kind === "counter";
  const where = handover.kind === "spot"
    ? (handover.spotLabel !== null && handover.spotLabel.trim() !== ""
      ? handover.spotLabel.trim()
      : "your table")
    : null;
  switch (status) {
    case "placed":
      return {
        title: "Order placed",
        body: collecting
          ? "We're waiting for the venue to pick it up. You can cancel for a full refund until they do."
          : "We're waiting for the venue to pick it up. You can cancel for a full refund until they do.",
      };
    case "acknowledged":
      return {
        title: "The venue has your order",
        body: collecting
          ? "They're on it. We'll tell you the moment it's ready to collect."
          : `They're on it. We'll tell you the moment it's on its way to ${where}.`,
      };
    case "in_progress":
      return {
        title: "Being made now",
        body: collecting
          ? "Nearly there. Wait for your code, then collect at the counter."
          : `Nearly there. It'll come to ${where}.`,
      };
    case "ready":
      return {
        title: collecting ? "Ready to collect" : "On its way",
        body: collecting
          ? (handover.pickupCode !== null && handover.pickupCode !== ""
            ? `Come and collect, code ${handover.pickupCode}. Give them your name: ${handover.buyerName}.`
            : `Come and collect. Give them your name: ${handover.buyerName}.`)
          : `On its way to ${where}.`,
      };
    case "delivered":
      return {
        title: collecting ? "Collected" : "Delivered",
        body: collecting
          ? "Enjoy it."
          : `Handed over at ${where}. Enjoy it.`,
      };
    case "cancelled":
      return {
        title: "Cancelled",
        body: "This order was cancelled and refunded in full.",
      };
    case "refunded":
      return { title: "Refunded", body: "This order has been refunded." };
    default:
      return { title: "Order placed", body: "We're waiting for the venue." };
  }
}

/** The one-line chip that says where this basket is going, before it is paid. */
export function venueOrderHandoverChip(config: VenueOrderingConfig): string {
  if (config.spotState === "ok" && config.spot !== null) {
    const label = config.spot.label;
    return label !== null && label.trim() !== ""
      ? `Ordering for ${label.trim()}`
      : "Ordering for your spot";
  }
  return "Collect from the counter";
}

// ---------------------------------------------------------------------------
// 6. The honest states — THE AMENDMENT registered against this phase.
// ---------------------------------------------------------------------------

export interface VenueOrderingNotice {
  tone: "info" | "muted";
  title: string;
  body: string | null;
}

/**
 * What a guest is told when they cannot order.
 *
 * ORCHESTRATOR AMENDMENT (#1789, registered against #1793): a guest at a venue
 * whose ordering is switched off or paused must see an honest statement of that
 * fact — NEVER a card that reads as broken. The wording is P-29's guest copy
 * verbatim, so the banner a guest reads before they try and the error they would
 * have been handed if they had tried are the same sentence. A regression pins
 * both strings against `supabase/functions/_shared/venueOrderPricing.ts`.
 *
 * `scanned` is the whole of the noise control. Ordering is OFF for every venue
 * in the world by default (P-16), so a banner that rendered unconditionally
 * would tell every casual reader of every menu about a feature that is not on.
 * The person who scanned the card on their table is owed an explanation; a
 * person browsing is not. So the banner is shown to someone who ARRIVED to
 * order — a spot code in the URL, or `src=qr` — and to nobody else.
 */
export function venueOrderingNotice(
  config: VenueOrderingConfig,
  options: { scanned: boolean },
): VenueOrderingNotice | null {
  const venue = config.venueName.trim() === ""
    ? "This venue"
    : config.venueName.trim();

  if (config.state === "paused") {
    return options.scanned
      ? {
        tone: "info",
        title: `${venue} has paused ordering right now. Try again shortly.`,
        body:
          "Nothing has been charged. A member of staff can still take your order.",
      }
      : null;
  }
  if (config.state === "off" || config.state === "unavailable") {
    // `unavailable` is folded in deliberately: from the guest's seat "we could
    // not resolve this venue's ordering" and "this venue has not switched
    // ordering on" are the same fact — no orders here right now — and inventing
    // a second, more alarming sentence for the rarer one would be inventing a
    // failure the guest cannot act on.
    return options.scanned
      ? {
        tone: "muted",
        title: `${venue} isn't taking orders through Mingla yet.`,
        body: "A member of staff will be happy to take it.",
      }
      : null;
  }
  // Ordering IS on. The only thing left that can be wrong is the code itself.
  if (config.spotState === "unknown") {
    return {
      tone: "info",
      title: "This code isn't active. Ask a member of staff.",
      body: config.counterPickupEnabled
        ? "You can still order and collect it from the counter."
        : null,
    };
  }
  return null;
}

/**
 * May this guest build a basket at all?
 *
 * Ordering on, and either a real spot or a venue that allows counter pickup
 * (D-3a / P-22 gate 7). A guest with an unknown code at a counter-pickup venue
 * may still order — they simply order as a counter guest, which is honest: we do
 * not know where they are sitting, so we never claim to.
 */
export function venueOrderingCanOrder(config: VenueOrderingConfig): boolean {
  if (config.state !== "on") return false;
  if (config.spotState === "ok") return true;
  return config.counterPickupEnabled && config.venueId !== null;
}

/** True when the basket will become a counter-pickup order (no spot recorded). */
export function venueOrderingIsCounterPickup(
  config: VenueOrderingConfig,
): boolean {
  return config.spotState !== "ok";
}

// ---------------------------------------------------------------------------
// 7. The contact triple + party size, mirrored from P-22 gates 7 and 8.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function venueOrderBuyerFailure(
  buyer: { name: string; email: string; phone: string },
): { field: "name" | "email" | "phone"; message: string } | null {
  if (buyer.name.trim().length < 2) {
    return {
      field: "name",
      message: "Add a name so they know whose order this is.",
    };
  }
  if (!EMAIL_RE.test(buyer.email.trim())) {
    return { field: "email", message: "That email doesn't look right." };
  }
  // Digits only, because the country code is chosen separately and the server
  // normalises to E.164 and is the authority (`normalizePhoneE164`). Seven is
  // the shortest national number in use anywhere.
  if (buyer.phone.replace(/\D/g, "").length < 7) {
    return {
      field: "phone",
      message: "We need a phone number to text you when it's ready.",
    };
  }
  return null;
}

/** The optional "how many of you?" — a METRIC INPUT, never a payment mechanic. */
export const VENUE_ORDER_PARTY_SIZE_MAX = 100;

export function venueOrderPartySizeValid(value: number | null): boolean {
  if (value === null) return true;
  return Number.isInteger(value) && value >= 1 &&
    value <= VENUE_ORDER_PARTY_SIZE_MAX;
}

/**
 * D-10 / DESIGN §5 item 2 — the question is OPTIONAL and is labelled as the
 * guest's own estimate, because that is exactly what it is. Skipping it costs
 * the guest nothing and costs the venue only the denominator: that order reports
 * spend per ORDER and never spend per cover. The surface says so rather than
 * nagging.
 */
export const VENUE_ORDER_PARTY_SIZE_PROMPT = "How many of you? (optional)";
export const VENUE_ORDER_PARTY_SIZE_HELP =
  "Your estimate. It helps the venue plan — skip it if you'd rather not.";
