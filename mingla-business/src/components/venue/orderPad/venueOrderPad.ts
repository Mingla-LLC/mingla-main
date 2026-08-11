/**
 * Issue #1792 (#1767 Phase 3b) — the ORDER PAD's pure logic (DESIGN D-11, D-2
 * AMENDED; SPEC #1788 P-2, P-2a, P-3, P-26, P-16).
 *
 * No React, no react-native, no network: everything here is a function of its
 * arguments, so the pad's rules can be proven under the default node/ts-jest
 * config. The sheet RENDERS what these functions decide.
 *
 * FOUR rules this file encodes, and they are the reason it exists:
 *
 *  1. ONE SPOT LIST. The pad picks from the SAME `qr_spots` rows the printed
 *     codes come from — brand-scoped, grouped by venue, rooms beside tables
 *     (D-3b). There is no second table-number list for waiters to keep in step
 *     with the laminates, because two lists is how table numbers disagree.
 *  2. THE CLIENT NEVER PRICES ANYTHING. `orderPadSubmitLines` emits
 *     `{ menuItemId, quantity, modifierIds, notes }` and nothing else — no
 *     price, ever, not even as a hint (P-20). Every number the waiter reads out
 *     comes back from `venue-order-staff { mode: "preview" }`.
 *  3. MODIFIER GROUPS ARE SATISFIED BEFORE A LINE EXISTS. The server refuses an
 *     unsatisfied group with `modifier_selection_invalid`; the pad refuses to
 *     get there, because "choose a doneness" is not an error, it is the next
 *     question.
 *  4. CHARGE TO ROOM IS VISIBLY ABSENT, NOT QUIETLY MISSING. It is listed,
 *     disabled, and it says why (D-11 settlement 3 needs stay-side incidentals).
 *     Half-building it would be worse than not having it: a waiter who taps it
 *     once and gets nothing stops trusting the pad.
 */

import {
  groupSpotsByVenue,
  isPrintable,
  type QrSpot,
  type SpotVenueGroup,
  type VenueRef,
} from "../qrSpots";

export type OrderPadSettlementMethod =
  | "bill_to_phone"
  | "venue_collected"
  | "charge_to_room";

/**
 * The pad uses the SHIPPED spot types and the SHIPPED grouping, deliberately.
 * A second `OrderPadSpot` shape would be a second definition of what a table is,
 * and D-11's requirement — "the same `qr_spots` list the printed codes come
 * from, so table numbers can never disagree" — is only true while there is
 * exactly one.
 */
export type OrderPadSpot = QrSpot;
export type OrderPadVenueRef = VenueRef;
export type OrderPadSpotGroup = SpotVenueGroup;

/** A modifier option, as the pad reads it off the menu. */
export interface OrderPadModifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  currency: string;
  isAvailable: boolean;
  sortOrder: number;
}

export interface OrderPadModifierGroup {
  id: string;
  menuItemId: string;
  name: string;
  selectionMode: "single" | "multi";
  minSelect: number;
  maxSelect: number | null;
  isActive: boolean;
  sortOrder: number;
  modifiers: OrderPadModifier[];
}

export interface OrderPadMenuItem {
  id: string;
  menuId: string;
  menuName: string;
  name: string;
  /** NULL = "price on request" — structurally not orderable (P-4b). */
  priceCents: number | null;
  currency: string;
  isAvailable: boolean;
  allowsNotes: boolean;
  sortOrder: number;
}

export interface OrderPadMenuSection {
  menuId: string;
  menuName: string;
  items: OrderPadMenuItem[];
}

/** One line the waiter has built but not yet sent. */
export interface OrderPadLine {
  /** Stable within a cart; NOT sent to the server. */
  key: string;
  menuItemId: string;
  name: string;
  /** Display only, read straight off the menu row — never summed by the pad. */
  unitPriceCents: number;
  currency: string;
  quantity: number;
  modifierIds: string[];
  /** Display only; the snapshot the server writes is its own read. */
  modifierNames: string[];
  notes: string | null;
}

/** Exactly what `venue-order-staff` accepts per line. Nothing with a price in it. */
export interface OrderPadSubmitLine {
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  notes: string | null;
}

export const ORDER_PAD_MAX_QUANTITY = 99;
export const ORDER_PAD_MAX_NOTE_CHARS = 140;

// ---------------------------------------------------------------------------
// Spots — ONE list, grouped by venue (D-3 / D-3b).
// ---------------------------------------------------------------------------

/**
 * The pad's spot list: the Spots inventory's OWN grouping and ordering, with the
 * spots that cannot take an order removed.
 *
 * The Spots screen deliberately shows inactive rows — a room whose serving
 * kitchen was never chosen appears there as a to-do rather than vanishing. The
 * pad is a different question: an inactive spot is one `resolveOrderContext`
 * answers `spot_unknown` for, so offering it would be offering a table the
 * server will refuse. A venue left with nothing is dropped entirely; an empty
 * group reads as "still loading" to somebody mid-service.
 */
export function orderableSpotGroups(
  spots: readonly OrderPadSpot[],
  venues: readonly OrderPadVenueRef[],
): OrderPadSpotGroup[] {
  return groupSpotsByVenue([...spots], [...venues])
    .map((group) => ({ ...group, spots: group.spots.filter(isPrintable) }))
    .filter((group) => group.spots.length > 0);
}

/** Free-text spot search — the fastest control at a busy pass is typing "12". */
export function filterSpotGroups(
  groups: readonly OrderPadSpotGroup[],
  query: string,
): OrderPadSpotGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...groups];
  return groups
    .map((group) => ({
      ...group,
      spots: group.spots.filter(
        (s) =>
          s.label.toLowerCase().includes(needle) ||
          group.venueName.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.spots.length > 0);
}

// ---------------------------------------------------------------------------
// Menu + modifiers.
// ---------------------------------------------------------------------------

/**
 * What the pad may offer, and why each exclusion is not a bug:
 *  * `isAvailable === false` — the item is 86'd. The server refuses it with
 *    `item_not_orderable`; showing it would be offering food the kitchen has
 *    told us it does not have.
 *  * `priceCents === null` — "price on request". `venue_order_items.
 *    unit_price_cents` is NOT NULL, so such an item is structurally not a line
 *    (P-4b). It is not a pricing gap the pad may fill in.
 *
 * Service windows are NOT evaluated here: they resolve in VENUE-LOCAL time on
 * the server (`pg_venue_local_now`), and a device clock is exactly the wrong
 * authority for "is the breakfast menu open".
 */
export function orderableMenuSections(
  items: readonly OrderPadMenuItem[],
): OrderPadMenuSection[] {
  const byMenu = new Map<string, OrderPadMenuItem[]>();
  for (const item of items) {
    if (!item.isAvailable) continue;
    if (item.priceCents === null) continue;
    const bucket = byMenu.get(item.menuId);
    if (bucket === undefined) byMenu.set(item.menuId, [item]);
    else bucket.push(item);
  }
  return [...byMenu.entries()]
    .map(([menuId, list]) => ({
      menuId,
      menuName: list[0]?.menuName ?? "Menu",
      items: [...list].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => a.menuName.localeCompare(b.menuName));
}

export function filterMenuSections(
  sections: readonly OrderPadMenuSection[],
  query: string,
): OrderPadMenuSection[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...sections];
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((i) => i.name.toLowerCase().includes(needle)),
    }))
    .filter((section) => section.items.length > 0);
}

export interface ModifierGroupState {
  /** May this line be added yet? */
  satisfied: boolean;
  /** What the waiter has to do next, in words. null when satisfied. */
  prompt: string | null;
}

/**
 * Mirrors the server's gate 5 (`modifier_selection_invalid`): every `minSelect`
 * met, no `maxSelect` exceeded, every chosen option still available. The server
 * is authoritative; this only means the waiter is asked the question rather
 * than shown the refusal.
 *
 * An INACTIVE group is skipped, and an unavailable option inside an active
 * group is treated as not chosen — the kitchen 86'ing "extra truffle" mid-shift
 * must invalidate the selection, not silently order it.
 */
export function modifierGroupState(
  group: OrderPadModifierGroup,
  selectedIds: readonly string[],
): ModifierGroupState {
  if (!group.isActive) return { satisfied: true, prompt: null };
  const available = new Set(
    group.modifiers.filter((m) => m.isAvailable).map((m) => m.id),
  );
  const chosen = selectedIds.filter((id) => available.has(id));
  if (chosen.length < group.minSelect) {
    return {
      satisfied: false,
      prompt: group.minSelect === 1
        ? `Choose ${group.name.toLowerCase()}`
        : `Choose ${group.minSelect} from ${group.name.toLowerCase()}`,
    };
  }
  const cap = group.selectionMode === "single" ? 1 : group.maxSelect;
  if (cap !== null && chosen.length > cap) {
    return {
      satisfied: false,
      prompt: `Pick at most ${cap} from ${group.name.toLowerCase()}`,
    };
  }
  return { satisfied: true, prompt: null };
}

/** The first unmet question across an item's groups, or null when ready. */
export function nextModifierPrompt(
  groups: readonly OrderPadModifierGroup[],
  selectedIds: readonly string[],
): string | null {
  for (const group of [...groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const state = modifierGroupState(group, selectedIds);
    if (!state.satisfied) return state.prompt;
  }
  return null;
}

/**
 * Toggling an option inside a group. `single` REPLACES (a doneness is not a
 * multi-select), `multi` adds up to its cap and refuses beyond it rather than
 * silently dropping the oldest choice — a waiter who taps a fourth extra needs
 * to see that the third is still there.
 */
export function toggleModifier(
  group: OrderPadModifierGroup,
  selectedIds: readonly string[],
  modifierId: string,
): string[] {
  const inGroup = new Set(group.modifiers.map((m) => m.id));
  const outside = selectedIds.filter((id) => !inGroup.has(id));
  const inside = selectedIds.filter((id) => inGroup.has(id));
  if (inside.includes(modifierId)) {
    return [...outside, ...inside.filter((id) => id !== modifierId)];
  }
  if (group.selectionMode === "single") return [...outside, modifierId];
  const cap = group.maxSelect;
  if (cap !== null && inside.length >= cap) return [...selectedIds];
  return [...outside, ...inside, modifierId];
}

// ---------------------------------------------------------------------------
// The cart.
// ---------------------------------------------------------------------------

/**
 * Two taps of the same item with the same options and the same note are ONE
 * line at quantity 2, not two lines — a docket that lists "1 Negroni" three
 * times is harder to read at the pass than "3 Negroni", and the kitchen reads
 * this. A different note keeps them apart, because a different note is a
 * different plate.
 */
export function cartLineIdentity(
  menuItemId: string,
  modifierIds: readonly string[],
  notes: string | null,
): string {
  const mods = [...modifierIds].sort().join(",");
  return `${menuItemId}|${mods}|${(notes ?? "").trim().toLowerCase()}`;
}

export function addLineToCart(
  lines: readonly OrderPadLine[],
  addition: Omit<OrderPadLine, "key">,
): OrderPadLine[] {
  const key = cartLineIdentity(
    addition.menuItemId,
    addition.modifierIds,
    addition.notes,
  );
  const existing = lines.find((l) => l.key === key);
  if (existing !== undefined) {
    return lines.map((l) =>
      l.key === key
        ? {
          ...l,
          quantity: Math.min(
            ORDER_PAD_MAX_QUANTITY,
            l.quantity + addition.quantity,
          ),
        }
        : l
    );
  }
  return [
    ...lines,
    {
      ...addition,
      key,
      quantity: Math.min(ORDER_PAD_MAX_QUANTITY, Math.max(1, addition.quantity)),
      notes: normalizeNote(addition.notes),
    },
  ];
}

export function setLineQuantity(
  lines: readonly OrderPadLine[],
  key: string,
  quantity: number,
): OrderPadLine[] {
  if (quantity <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) =>
    l.key === key
      ? { ...l, quantity: Math.min(ORDER_PAD_MAX_QUANTITY, quantity) }
      : l
  );
}

export function normalizeNote(notes: string | null): string | null {
  const trimmed = (notes ?? "").trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, ORDER_PAD_MAX_NOTE_CHARS);
}

/**
 * THE P-20 BOUNDARY, and the reason it is one function rather than an inline
 * `.map`. What leaves the pad is what the server accepts and NOTHING else: an
 * item id, a count, the options chosen, and the kitchen's note. A price sent
 * from here would be ignored server-side — but it would also be a claim this
 * surface has no business making, and the way that claim gets believed later is
 * by having been sent once.
 */
export function orderPadSubmitLines(
  lines: readonly OrderPadLine[],
): OrderPadSubmitLine[] {
  return lines.map((line) => ({
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    modifierIds: [...line.modifierIds],
    notes: normalizeNote(line.notes),
  }));
}

/** How many plates the docket carries — a count, not money. */
export function cartItemCount(lines: readonly OrderPadLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * A cart may not mix currencies (`mixed_currency`, and
 * I-PROPOSED-1767-NEVER-CROSS-SUM-CURRENCIES). The server refuses it; the pad
 * spots it while the waiter can still fix it in one tap.
 */
export function cartCurrency(
  lines: readonly OrderPadLine[],
): { ok: true; currency: string | null } | { ok: false } {
  const codes = new Set(lines.map((l) => l.currency.toUpperCase()));
  if (codes.size > 1) return { ok: false };
  return { ok: true, currency: [...codes][0] ?? null };
}

export interface OrderPadReadiness {
  ready: boolean;
  /** The one thing standing in the way, in words. null when ready. */
  blocker: string | null;
}

/**
 * Everything that must be true before "Send to kitchen" does anything. Stated
 * once, in words a waiter can act on, so the button is never merely grey.
 */
export function orderPadReadiness(input: {
  spotId: string | null;
  counterPickup: boolean;
  buyerName: string;
  lines: readonly OrderPadLine[];
}): OrderPadReadiness {
  if (input.spotId === null && !input.counterPickup) {
    return { ready: false, blocker: "Pick where this order is going." };
  }
  if (input.counterPickup && input.buyerName.trim().length < 2) {
    // The ticket reads `COLLECT · 42 · Amara`; without a name it reads
    // `COLLECT · 42` and staff hand food to whoever says the number.
    return { ready: false, blocker: "Add the guest's name for the collection." };
  }
  if (input.lines.length === 0) {
    return { ready: false, blocker: "Add something to the order." };
  }
  if (!cartCurrency(input.lines).ok) {
    return {
      ready: false,
      blocker: "Mixed currencies in one order — send them separately.",
    };
  }
  return { ready: true, blocker: null };
}

// ---------------------------------------------------------------------------
// Settlement (D-11) — three supported, one deliberately visible and disabled.
// ---------------------------------------------------------------------------

export interface OrderPadSettlementOption {
  method: OrderPadSettlementMethod;
  label: string;
  body: string;
  /** false = rendered, disabled, and honest about why. */
  available: boolean;
  /** Why it is off. null when available. */
  unavailableReason: string | null;
  /** True when money moves through Mingla and a fee applies. */
  minglaCollects: boolean;
}

/**
 * D-11's settlement table, as data.
 *
 * `venue_collected` is not "the cheap option" — it is the honest one. Mingla is
 * the venue's order pad for that ticket: no provider is called, no fee is taken,
 * no payout row is ever created (P-3 CHECK 4 makes the row unwritable in any
 * other shape), and the order still counts in full toward item velocity, zone
 * revenue and spend per cover. Measuring a venue's WHOLE service is the point.
 *
 * `charge_to_room` is listed and DISABLED. D-11 settlement 3 needs stay-side
 * incidentals billing, which does not exist; the shipped precedent for saying so
 * out loud is the door-sale sheet's disabled card-reader controls.
 */
export const ORDER_PAD_SETTLEMENT_OPTIONS: readonly OrderPadSettlementOption[] = [
  {
    method: "bill_to_phone",
    label: "Send the bill to their phone",
    body:
      "They pay on their own phone through Mingla. Our fee applies and it pays out as normal.",
    available: true,
    unavailableReason: null,
    minglaCollects: true,
  },
  {
    method: "venue_collected",
    label: "You took the money",
    body:
      "Cash or your own card machine. Nothing goes through Mingla and there's no fee — the order still counts in your numbers.",
    available: true,
    unavailableReason: null,
    minglaCollects: false,
  },
  {
    method: "charge_to_room",
    label: "Charge to the room",
    body: "Put it on the guest's room bill.",
    available: false,
    unavailableReason: "Not built yet — room billing is coming with stays.",
    minglaCollects: false,
  },
];

/** The methods a caller may actually send. Guards the disabled one at the seam. */
export function settlementMethodIsSendable(
  method: OrderPadSettlementMethod,
): method is "bill_to_phone" | "venue_collected" {
  const option = ORDER_PAD_SETTLEMENT_OPTIONS.find((o) => o.method === method);
  return option !== undefined && option.available;
}

export interface BillContactReadiness {
  ready: boolean;
  /** The one field still missing, in words. null when ready. */
  blocker: string | null;
}

/**
 * `bill_to_phone` needs the contact triple, and this is NOT a form-validation
 * preference: `venue_orders_paid_needs_contact` makes a PAID Mingla order
 * without all three literally unwritable, and the guest needs a receipt, a live
 * status card and a way to ask for their money back. A bill sent without them
 * would bounce at the database after the waiter had already walked away.
 *
 * Deliberately loose on the phone: E.164 normalisation happens server-side
 * (`normalizePhoneE164`), and a pad that rejects "07700 900123" because it wants
 * "+44" is a pad a waiter stops using. Length is the only thing checked here;
 * the server is the authority on shape and returns `buyer_phone_required` when
 * it cannot make sense of it.
 */
export function billContactReadiness(input: {
  name: string;
  email: string;
  phone: string;
}): BillContactReadiness {
  if (input.name.trim().length < 2) {
    return { ready: false, blocker: "Add the guest's name." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return { ready: false, blocker: "That email doesn't look right." };
  }
  if (input.phone.replace(/\D/g, "").length < 7) {
    return { ready: false, blocker: "Add a phone number." };
  }
  return { ready: true, blocker: null };
}

// ---------------------------------------------------------------------------
// Tabs (D-2 AMENDED) — staff-opened only.
// ---------------------------------------------------------------------------

export interface OrderPadTab {
  sessionId: string;
  venueId: string;
  qrSpotId: string | null;
  spotLabel: string | null;
  tabState: "open" | "settling";
  currency: string;
  roundCount: number;
  /** Every one of these is SERVER-summed (`biz_venue_tab_summaries`). */
  outstandingSubtotalCents: number;
  outstandingServiceChargeCents: number;
  outstandingTipCents: number;
  outstandingTotalCents: number;
  openedAt: string;
  lastOrderAt: string | null;
}

/**
 * A tab a waiter may still add a round to. `settling` is excluded on purpose:
 * the bill is already out on the guest's phone, and a round added after the
 * total was struck is a round the guest was never shown. The server refuses it
 * too (`session_not_addable`); this stops the waiter reaching for it.
 */
export function tabAcceptsRounds(tab: OrderPadTab): boolean {
  return tab.tabState === "open";
}

export function tabsForVenue(
  tabs: readonly OrderPadTab[],
  venueId: string | null,
): OrderPadTab[] {
  return tabs
    .filter((t) => venueId === null || t.venueId === venueId)
    .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
}

/** How a tab reads on the card: where it is, and how much is on it. */
export function tabDestinationLabel(tab: OrderPadTab): string {
  const label = (tab.spotLabel ?? "").trim();
  return label.length > 0 ? label : "No table";
}

export function tabRoundsLabel(tab: OrderPadTab): string {
  if (tab.roundCount === 0) return "No rounds yet";
  return tab.roundCount === 1 ? "1 round" : `${tab.roundCount} rounds`;
}
