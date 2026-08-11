// ===========================================================================
// Issue #1790 (SPEC #1788 Phase 2) — the venue-order money engine, executed.
//
// Hermetic: pure functions only, no Supabase client, no network. Every group
// names the change it guards and fails when that change is reverted.
// ===========================================================================

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { feeFromBps } from "../allInPricingEngine.ts";
import {
  computeVenueOrderMoney,
  menuServiceWindowContains,
  priceCart,
  resolveTipCents,
  VENUE_ORDER_ERRORS,
  venueOrderErrorCopy,
  venueOrderErrorStatus,
  venueOrderIdempotencyFingerprint,
} from "../venueOrderPricing.ts";
import type {
  MenuItemRow,
  MenuModifierGroupRow,
  MenuModifierRow,
} from "../venueOrderPricing.ts";

const SWITCHES = {
  pass_tax: false,
  pass_mingla_fee: true,
  pass_service_fee: true,
} as const;

function baseMoney(overrides: Record<string, unknown> = {}) {
  return computeVenueOrderMoney({
    subtotalCents: 4000,
    serviceChargeBps: 1250,
    tipBps: null,
    tipFlatCents: null,
    switches: { ...SWITCHES },
    region: "GB",
    currency: "GBP",
    effectiveTakeRateBps: 1000,
    takeRateSource: "platform_default",
    serviceFeeBps: 300,
    vatRateBps: 0,
    ...overrides,
  } as Parameters<typeof computeVenueOrderMoney>[0]);
}

// ---------------------------------------------------------------------------
// T-M2 — ROUNDING PARITY. The database CHECK
// `mingla_fee_cents = round(fee_basis_cents::numeric * bps / 10000)` compares a
// Postgres round(numeric) against whatever this TypeScript wrote. This asserts
// the SAME grid and the SAME exact-integer oracle as the SQL half
// (supabase/migrations/__tests__/issue_1790_venue_order_money_rail.test.sql
// T-M2), so the two runtimes cannot drift without one of them going red.
//
// The oracle is exact half-away-from-zero integer division — no float — so it
// is a genuinely independent third opinion, not a restatement of either side.
// ---------------------------------------------------------------------------
Deno.test("T-M2: feeFromBps matches the exact half-up integer oracle across the whole grid", () => {
  const BPS = [0, 250, 300, 500, 1000, 1500];
  let compared = 0;
  for (const bps of BPS) {
    for (let basis = 0; basis <= 100000; basis++) {
      const oracle = Math.floor((basis * bps + 5000) / 10000);
      assertStrictEquals(
        feeFromBps(basis, bps),
        oracle,
        `feeFromBps(${basis}, ${bps}) diverged from the SQL CHECK's rounding`,
      );
      compared++;
    }
  }
  // Vacuity guard: a grid that silently shrank would pass over nothing.
  assertStrictEquals(compared, 600006);
});

// ---------------------------------------------------------------------------
// T-T1 — A TIP IS NEVER FEE'D (I-PROPOSED-1767-NO-CUT-OF-A-TIP).
// ---------------------------------------------------------------------------
Deno.test("T-T1: the fee basis is subtotal + service charge, and a tip cannot enter it", () => {
  const tipped = baseMoney({ tipFlatCents: 1000 });
  const plain = baseMoney();

  // GBP40.00 subtotal + 12.5% service charge = GBP45.00 basis.
  assertStrictEquals(tipped.serviceChargeCents, 500);
  assertStrictEquals(tipped.feeBasisCents, 4500);
  assertStrictEquals(tipped.minglaFeeCents, 450);

  // The GBP10 tip changed the total and NOTHING else about the money split.
  assertStrictEquals(tipped.minglaFeeCents, plain.minglaFeeCents);
  assertStrictEquals(tipped.platformServiceFeeCents, plain.platformServiceFeeCents);
  assertStrictEquals(tipped.feeBasisCents, plain.feeBasisCents);
  assertStrictEquals(tipped.buyerSubtotalCents, plain.buyerSubtotalCents);
  assertStrictEquals(tipped.totalCents, plain.totalCents + 1000);

  // application_fee_amount on the provider call IS the Mingla fee, so under
  // direct charges the tip lands in the venue's balance by arithmetic.
  assertStrictEquals(
    tipped.pricingBreakdown.application_fee_amount_cents,
    tipped.minglaFeeCents,
  );
});

Deno.test("T-T1b: a percentage tip is taken on the SUBTOTAL, never the fee basis", () => {
  // 20% on GBP40.00 is GBP8.00. Taking it on the GBP45.00 basis would be GBP9.00
  // — the venue's own service charge silently inflating the guest's tip.
  const money = baseMoney({ tipBps: 2000 });
  assertStrictEquals(money.tipCents, 800);
  assertStrictEquals(resolveTipCents(4000, 2000, null), 800);
  assertStrictEquals(resolveTipCents(4000, null, 1234), 1234);
  assertStrictEquals(resolveTipCents(4000, null, null), 0);
  // A flat amount wins over a percentage: the guest typed a number.
  assertStrictEquals(resolveTipCents(4000, 2000, 500), 500);
});

Deno.test("T-V1: the venue service charge is carried as its OWN named component", () => {
  const money = baseMoney({ tipFlatCents: 700 });
  const breakdown = money.pricingBreakdown as unknown as Record<string, number>;
  // I-PROPOSED-1767-EVERY-CHARGE-IS-VISIBLE — a guest is never charged something
  // they cannot see, and the service charge is never folded into the ONE
  // combined "Fees & tax" line (which stays Mingla's fees).
  assertStrictEquals(breakdown.venue_service_charge_cents, 500);
  assertStrictEquals(breakdown.venue_service_charge_bps, 1250);
  assertStrictEquals(breakdown.tip_cents, 700);
  // ...and the tip is NOT inside the engine's own components.
  assertStrictEquals(money.pricingBreakdown.base_cents, 4500);
});

Deno.test("T-M3: total = buyer subtotal + tax + tip, on every region arm", () => {
  for (
    const region of ["GB", "US", "EU", "CH", "NG"] as const
  ) {
    for (const passTax of [true, false]) {
      const money = computeVenueOrderMoney({
        subtotalCents: 3333,
        serviceChargeBps: 700,
        tipBps: 1500,
        tipFlatCents: null,
        switches: { ...SWITCHES, pass_tax: passTax },
        region,
        currency: region === "NG" ? "NGN" : "GBP",
        effectiveTakeRateBps: 700,
        takeRateSource: "platform_default",
        serviceFeeBps: 300,
        vatRateBps: 750,
      });
      assertStrictEquals(
        money.totalCents,
        money.buyerSubtotalCents + money.taxAmountCents + money.tipCents,
        `${region} passTax=${passTax}: the venue_orders_total_shape CHECK would reject this row`,
      );
      // The database CHECK recomputes both fees from the basis; if this drifts,
      // the row is unwritable rather than wrong.
      assertStrictEquals(
        money.minglaFeeCents,
        feeFromBps(money.feeBasisCents, 700),
      );
      assert(money.taxAmountCents >= 0);
    }
  }
});

Deno.test("T-M4: NG adds VAT on top only when the brand passes it", () => {
  const passed = computeVenueOrderMoney({
    subtotalCents: 100000,
    serviceChargeBps: 0,
    tipBps: null,
    tipFlatCents: null,
    switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true },
    region: "NG",
    currency: "NGN",
    effectiveTakeRateBps: 1000,
    takeRateSource: "platform_default",
    serviceFeeBps: 300,
    vatRateBps: 750,
  });
  const absorbed = computeVenueOrderMoney({
    subtotalCents: 100000,
    serviceChargeBps: 0,
    tipBps: null,
    tipFlatCents: null,
    switches: { pass_tax: false, pass_mingla_fee: true, pass_service_fee: true },
    region: "NG",
    currency: "NGN",
    effectiveTakeRateBps: 1000,
    takeRateSource: "platform_default",
    serviceFeeBps: 300,
    vatRateBps: 750,
  });
  assert(passed.taxAmountCents > 0);
  assertStrictEquals(absorbed.taxAmountCents, 0);
  assertStrictEquals(passed.buyerSubtotalCents, absorbed.buyerSubtotalCents);
});

// ---------------------------------------------------------------------------
// P-29 — the EXACT user-visible copy. Verbatim, not paraphrased. Every 4xx/5xx
// on a money path states explicitly that nothing has been charged when nothing
// has been charged; silence there is what makes a guest pay twice.
// ---------------------------------------------------------------------------
Deno.test("P-29: the money-path errors state that nothing has been charged", () => {
  assertStrictEquals(
    venueOrderErrorCopy("order_total_invalid", "guest"),
    "We couldn't price that order. Nothing has been charged.",
  );
  assertStrictEquals(
    venueOrderErrorCopy("internal_error", "guest"),
    "Something went wrong. Nothing has been charged.",
  );
  assertStrictEquals(
    venueOrderErrorCopy("payment_intent_create_failed", "guest"),
    "Your card wasn't charged. Try again.",
  );
  for (const code of ["order_total_invalid", "internal_error"] as const) {
    assert(
      venueOrderErrorCopy(code, "guest")!.includes("Nothing has been charged"),
      `${code} must say nothing was charged`,
    );
  }
});

Deno.test("P-29: the error table is verbatim, with its exact statuses", () => {
  const expected: Array<[string, number, string | null, string | null]> = [
    ["invalid_json", 400, "Something went wrong. Try again.", "Something went wrong. Try again."],
    ["buyer_name_required", 400, "Add a name so they know whose order this is.", "Add the guest's name."],
    ["buyer_email_invalid", 400, "That email doesn't look right.", "That email doesn't look right."],
    ["buyer_phone_required", 400, "We need a phone number to text you when it's ready.", "Add a phone number."],
    ["mixed_currency", 400, "These items are priced in different currencies — order them separately.", "Mixed currencies in one order."],
    ["spot_unknown", 404, "This code isn't active. Ask a member of staff.", "That spot is inactive or deleted."],
    ["counter_pickup_unavailable", 409, "Scan the code on your table to order.", "Counter pickup is off for this venue."],
    ["refund_window_closed", 409, "This order's already been served — message the venue and they'll sort you out.", null],
    ["transition_not_allowed", 409, null, "That order has already moved on. Pull to refresh."],
    ["tab_not_open", 409, null, "That tab is already closed."],
    ["too_many_orders", 429, "That's a lot of orders very quickly. Give it a moment.", null],
    ["pdf_render_failed", 502, null, "The sheet didn't render. Try again."],
    // [TEST-MOD-APPROVED #1848] APPENDED, nothing removed. These two codes were
    // the hole this "verbatim" table left: `venue_not_orderable` never appeared
    // in it, so its staff sentence was the one string on the rail that no
    // assertion held — which is how it survived saying "This venue isn't
    // verified for ordering." to a VERIFIED venue whose only problem was an
    // unflipped `ordering_enabled`. #1848 split that single code into the two
    // causes it always had; both are now pinned here, in this same table, by
    // this same loop, against the same three assertions per row.
    // The loop below passes no vars, so `{Venue}` resolves to its "This venue"
    // fallback — these three rows therefore pin that fallback too.
    ["venue_not_orderable", 409, "This venue isn't taking orders through Mingla yet.", "This venue isn't verified yet. Ordering opens once its claim is approved."],
    ["ordering_disabled", 409, "This venue isn't taking orders through Mingla yet.", "Ordering is switched off for this venue. Turn it on from Orders."],
    ["ordering_paused", 409, "This venue has paused ordering right now. Try again shortly.", "Ordering is paused. Turn it back on from Orders."],
  ];
  for (const [code, status, guest, staff] of expected) {
    const key = code as keyof typeof VENUE_ORDER_ERRORS;
    assertStrictEquals(venueOrderErrorStatus(key), status, `${code} status`);
    assertStrictEquals(venueOrderErrorCopy(key, "guest"), guest, `${code} guest copy`);
    assertStrictEquals(venueOrderErrorCopy(key, "staff"), staff, `${code} staff copy`);
  }
  // Vacuity guard: the table must not have quietly shrunk below what ships.
  assert(Object.keys(VENUE_ORDER_ERRORS).length >= 20);
});

Deno.test("P-29: {Venue} / {Item} / {group} are substituted, never left raw", () => {
  assertStrictEquals(
    venueOrderErrorCopy("venue_not_orderable", "guest", { venue: "The Brasserie" }),
    "The Brasserie isn't taking orders through Mingla yet.",
  );
  assertStrictEquals(
    venueOrderErrorCopy("item_not_orderable", "guest", { item: "Negroni" }),
    "Negroni just came off the menu.",
  );
  assertStrictEquals(
    venueOrderErrorCopy("item_not_orderable", "staff", { item: "Negroni" }),
    "Negroni is 86'd or outside its service window.",
  );
  assertStrictEquals(
    venueOrderErrorCopy("modifier_selection_invalid", "guest", { group: "Ice" }),
    "Choose an option for Ice before adding this.",
  );
  // A missing substitution never leaves a template token on a guest's screen.
  for (const code of Object.keys(VENUE_ORDER_ERRORS) as Array<keyof typeof VENUE_ORDER_ERRORS>) {
    for (const audience of ["guest", "staff"] as const) {
      const copy = venueOrderErrorCopy(code, audience);
      if (copy === null) continue;
      assert(!copy.includes("{"), `${code}/${audience} leaked a template token`);
    }
  }
});

// ---------------------------------------------------------------------------
// Cart validation (P-22 gates 4-6, P-4a, P-4b).
// ---------------------------------------------------------------------------
function menuItem(over: Partial<MenuItemRow> = {}): MenuItemRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    menu_id: "22222222-2222-4222-8222-222222222222",
    brand_id: "33333333-3333-4333-8333-333333333333",
    name: "Negroni",
    price_cents: 1200,
    currency: "GBP",
    is_available: true,
    ...over,
  };
}

function cartFor(
  items: MenuItemRow[],
  groups: MenuModifierGroupRow[] = [],
  modifiers: MenuModifierRow[] = [],
  requested = items.map((i) => ({
    menuItemId: i.id,
    quantity: 1,
    modifierIds: [] as string[],
    notes: null,
  })),
  orderable = new Set(items.map((i) => i.id)),
) {
  const groupsByItemId = new Map<string, MenuModifierGroupRow[]>();
  for (const g of groups) {
    const bucket = groupsByItemId.get(g.menu_item_id) ?? [];
    bucket.push(g);
    groupsByItemId.set(g.menu_item_id, bucket);
  }
  return priceCart({
    requested,
    itemsById: new Map(items.map((i) => [i.id, i])),
    groupsByItemId,
    modifiersById: new Map(modifiers.map((m) => [m.id, m])),
    orderableItemIds: orderable,
  });
}

Deno.test("T-O5/T-C1: a mixed-currency cart is rejected before any provider call", () => {
  const gbp = menuItem();
  const usd = menuItem({ id: "44444444-4444-4444-8444-444444444444", currency: "USD" });
  const result = cartFor([gbp, usd]);
  assert(!result.ok);
  assertStrictEquals(result.failure.code, "mixed_currency");
});

Deno.test("T-O6/P-4b: a price-on-request item and an 86'd item are both unorderable, NAMED", () => {
  const priceOnRequest = menuItem({ name: "Market fish", price_cents: null });
  const r1 = cartFor([priceOnRequest]);
  assert(!r1.ok);
  assertStrictEquals(r1.failure.code, "item_not_orderable");
  assertStrictEquals(
    (r1.failure as { item: string }).item,
    "Market fish",
    "the copy must name WHICH item came off the menu",
  );

  const eightySixed = menuItem({ is_available: false });
  const r2 = cartFor([eightySixed]);
  assert(!r2.ok);
  assertStrictEquals(r2.failure.code, "item_not_orderable");

  // Out of its service window: present, priced, available — but not orderable.
  const item = menuItem();
  const r3 = cartFor([item], [], [], undefined, new Set<string>());
  assert(!r3.ok);
  assertStrictEquals(r3.failure.code, "item_not_orderable");
});

Deno.test("T-O7: modifier groups are satisfied, and a foreign modifier is refused", () => {
  const item = menuItem();
  const group: MenuModifierGroupRow = {
    id: "55555555-5555-4555-8555-555555555555",
    menu_item_id: item.id,
    name: "Ice",
    selection_mode: "single",
    min_select: 1,
    max_select: 1,
    is_active: true,
  };
  const modifier: MenuModifierRow = {
    id: "66666666-6666-4666-8666-666666666666",
    group_id: group.id,
    name: "No ice",
    price_delta_cents: 0,
    currency: "GBP",
    is_available: true,
  };

  // min_select unmet.
  const unmet = cartFor([item], [group], [modifier], [
    { menuItemId: item.id, quantity: 1, modifierIds: [], notes: null },
  ]);
  assert(!unmet.ok);
  assertStrictEquals(unmet.failure.code, "modifier_selection_invalid");
  assertStrictEquals((unmet.failure as { group: string }).group, "Ice");

  // Satisfied.
  const ok = cartFor([item], [group], [modifier], [
    { menuItemId: item.id, quantity: 2, modifierIds: [modifier.id], notes: "no ice" },
  ]);
  assert(ok.ok);
  assertStrictEquals(ok.subtotalCents, 2400);
  assertStrictEquals(ok.lines[0].modifiers.length, 1);
  assertStrictEquals(ok.lines[0].modifiers[0].groupNameAtOrder, "Ice");

  // A modifier that belongs to NO group of this item.
  const foreign: MenuModifierRow = {
    ...modifier,
    id: "77777777-7777-4777-8777-777777777777",
    group_id: "88888888-8888-4888-8888-888888888888",
  };
  const stolen = cartFor([item], [group], [modifier, foreign], [
    { menuItemId: item.id, quantity: 1, modifierIds: [foreign.id], notes: null },
  ]);
  assert(!stolen.ok);
  assertStrictEquals(stolen.failure.code, "modifier_selection_invalid");
});

Deno.test("P-11a: a modifier priced in another currency IS the cross-sum bug, and is refused", () => {
  const item = menuItem();
  const group: MenuModifierGroupRow = {
    id: "55555555-5555-4555-8555-555555555555",
    menu_item_id: item.id,
    name: "Add",
    selection_mode: "multi",
    min_select: 0,
    max_select: 2,
    is_active: true,
  };
  const usdModifier: MenuModifierRow = {
    id: "66666666-6666-4666-8666-666666666666",
    group_id: group.id,
    name: "Double",
    price_delta_cents: 300,
    currency: "USD",
    is_available: true,
  };
  const result = cartFor([item], [group], [usdModifier], [
    { menuItemId: item.id, quantity: 1, modifierIds: [usdModifier.id], notes: null },
  ]);
  assert(!result.ok);
  assertStrictEquals(result.failure.code, "mixed_currency");
});

Deno.test("line arithmetic matches the venue_order_items_line_arith CHECK", () => {
  const item = menuItem({ price_cents: 1000 });
  const group: MenuModifierGroupRow = {
    id: "55555555-5555-4555-8555-555555555555",
    menu_item_id: item.id,
    name: "Size",
    selection_mode: "single",
    min_select: 0,
    max_select: 1,
    is_active: true,
  };
  // A negative delta (a smaller portion) is legal, and cannot drive a line
  // below zero.
  const smaller: MenuModifierRow = {
    id: "66666666-6666-4666-8666-666666666666",
    group_id: group.id,
    name: "Half",
    price_delta_cents: -400,
    currency: "GBP",
    is_available: true,
  };
  const ok = cartFor([item], [group], [smaller], [
    { menuItemId: item.id, quantity: 3, modifierIds: [smaller.id], notes: null },
  ]);
  assert(ok.ok);
  assertStrictEquals(ok.lines[0].lineTotalCents, (1000 - 400) * 3);
  assertStrictEquals(
    ok.lines[0].lineTotalCents,
    (ok.lines[0].unitPriceCents + ok.lines[0].modifiersTotalCents) *
      ok.lines[0].quantity,
  );

  const belowZero = cartFor(
    [menuItem({ price_cents: 100 })],
    [{ ...group, menu_item_id: menuItem({ price_cents: 100 }).id }],
    [smaller],
    [{ menuItemId: item.id, quantity: 1, modifierIds: [smaller.id], notes: null }],
  );
  assert(!belowZero.ok);
});

// ---------------------------------------------------------------------------
// P-13 — the service window WRAPS MIDNIGHT when end < start. A naive BETWEEN
// gets a late-night menu wrong, which is why it is spelled out and tested.
// ---------------------------------------------------------------------------
Deno.test("P-13: a late-night menu window wraps midnight", () => {
  const lateNight = { start: "21:00:00", end: "03:00:00", days: null };
  assert(menuServiceWindowContains(lateNight, { isoDayOfWeek: 5, minutesSinceMidnight: 22 * 60 }));
  assert(menuServiceWindowContains(lateNight, { isoDayOfWeek: 5, minutesSinceMidnight: 1 * 60 }));
  assert(!menuServiceWindowContains(lateNight, { isoDayOfWeek: 5, minutesSinceMidnight: 12 * 60 }));

  const breakfast = { start: "07:00:00", end: "11:00:00", days: null };
  assert(menuServiceWindowContains(breakfast, { isoDayOfWeek: 3, minutesSinceMidnight: 8 * 60 }));
  assert(!menuServiceWindowContains(breakfast, { isoDayOfWeek: 3, minutesSinceMidnight: 21 * 60 }));
  // The end is EXCLUSIVE — 11:00 is no longer breakfast.
  assert(!menuServiceWindowContains(breakfast, { isoDayOfWeek: 3, minutesSinceMidnight: 11 * 60 }));

  // Both NULL = always available; that is today's behaviour, so every existing
  // menu row is unchanged by the additive columns.
  assert(menuServiceWindowContains({ start: null, end: null, days: null }, {
    isoDayOfWeek: 1,
    minutesSinceMidnight: 0,
  }));

  // ISO day-of-week gating (1 = Monday .. 7 = Sunday).
  const weekend = { start: null, end: null, days: [6, 7] };
  assert(menuServiceWindowContains(weekend, { isoDayOfWeek: 7, minutesSinceMidnight: 600 }));
  assert(!menuServiceWindowContains(weekend, { isoDayOfWeek: 3, minutesSinceMidnight: 600 }));
});

// ---------------------------------------------------------------------------
// P-23 layer 1 — the deterministic idempotency fingerprint.
//
// #1819 H-2 renamed `sessionId` to `scopeId` and made `buyerKey` required, so
// the derived key can no longer collapse to a shared constant when a guest has
// no sitting yet. Every assertion below is the ORIGINAL one; `buyerKey` is held
// CONSTANT throughout so this group still tests exactly what it tested before.
// The buyer dimension itself is covered in
// supabase/functions/_shared/__tests__/issue_1819_order_idempotency_scope.test.ts.
// ---------------------------------------------------------------------------
const P23_BUYER = "ada@example.test|+12015550199";

Deno.test("P-23: the fingerprint is order-insensitive, session-scoped, and tip-aware", () => {
  const a = venueOrderIdempotencyFingerprint({
    scopeId: "S1",
    buyerKey: P23_BUYER,
    lines: [
      { menuItemId: "i1", quantity: 2, modifierIds: ["m2", "m1"], notes: "no ice" },
      { menuItemId: "i2", quantity: 1, modifierIds: [], notes: null },
    ],
    tipBps: 1000,
  });
  const reordered = venueOrderIdempotencyFingerprint({
    scopeId: "S1",
    buyerKey: P23_BUYER,
    lines: [
      { menuItemId: "i2", quantity: 1, modifierIds: [], notes: null },
      { menuItemId: "i1", quantity: 2, modifierIds: ["m1", "m2"], notes: "no ice" },
    ],
    tipBps: 1000,
  });
  assertEquals(a, reordered, "the same cart submitted twice must collapse to one order");

  // A DIFFERENT sitting is a different order, even with an identical cart —
  // this is the deliberate difference from the ticket path's key.
  assert(a !== venueOrderIdempotencyFingerprint({
    scopeId: "S2",
    buyerKey: P23_BUYER,
    lines: [
      { menuItemId: "i1", quantity: 2, modifierIds: ["m1", "m2"], notes: "no ice" },
      { menuItemId: "i2", quantity: 1, modifierIds: [], notes: null },
    ],
    tipBps: 1000,
  }));

  // Changing the tip changes the order.
  assert(a !== venueOrderIdempotencyFingerprint({
    scopeId: "S1",
    buyerKey: P23_BUYER,
    lines: [
      { menuItemId: "i1", quantity: 2, modifierIds: ["m1", "m2"], notes: "no ice" },
      { menuItemId: "i2", quantity: 1, modifierIds: [], notes: null },
    ],
    tipBps: 1500,
  }));

  // ...and so does a note, because the kitchen ticket differs.
  assert(a !== venueOrderIdempotencyFingerprint({
    scopeId: "S1",
    buyerKey: P23_BUYER,
    lines: [
      { menuItemId: "i1", quantity: 2, modifierIds: ["m1", "m2"], notes: "extra ice" },
      { menuItemId: "i2", quantity: 1, modifierIds: [], notes: null },
    ],
    tipBps: 1000,
  }));
});
