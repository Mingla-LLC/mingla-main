// META-ORCH-1174 Leg B3 — implementor-owned SOURCE-CONTRACT regression (the
// offering-rendering deno-readfile style). Proves the §10 multi-package selector UI
// + the reserve→cart wiring is present + isolated across surfaces. FAILS-ON-REVERT
// via TRUE deletion of the asserted lines.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const body = await read("../TripOfferingBody.tsx");
const stateMachine = await read("../useTripOfferingState.ts");
const types = await read("../tripOfferingTypes.ts");
const totals = await read("../tripBoxTotals.ts");
const bizAdapter = await read(
  "../../../mingla-business/src/components/trip/tripOfferingAdapter.ts",
);
const bizRoute = await read(
  "../../../mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
);
const bizCheckout = await read(
  "../../../mingla-business/app/checkout-trip/[tripEventId]/index.tsx",
);
const consumerScreen = await read(
  "../../../app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
);
const consumerAdapter = await read(
  "../../../app-mobile/src/hooks/useConsumerTripOfferingData.ts",
);

// ── §10 box renders N selectable package rows with steppers ────────────────
Deno.test("B3 §10 box renders N package rows (TripPackageRow) with qty steppers", () => {
  assertStringIncludes(body, "const TripPackageRow:");
  assertStringIncludes(body, "sortedTiers.map((tier)");
  // each row: name + description + all-in price + remaining + a Minus/Plus stepper.
  assertStringIncludes(body, "tripTierPriceLabel(tier)");
  assertStringIncludes(body, "<Minus");
  assertStringIncludes(body, "<Plus");
  assertStringIncludes(body, "tier.description");
  assertStringIncludes(body, "remainingLabel");
  // the stepper writes through the SHARED clamp (clamped to remaining).
  assertStringIncludes(body, "state.clampQuantity(tier.ticketTypeId, qty)");
});

// ── per-package payment plan (DEC-F) lives per-row ─────────────────────────
Deno.test("B3 a plan tier offers a per-package pay-full/over-time toggle", () => {
  assertStringIncludes(body, "trip-body-pkg-plan-");
  assertStringIncludes(body, "value={planChoice}");
  // the per-row toggle drives the per-tier choice the surface owns.
  assertStringIncludes(body, "onChange={onChangePlanChoice}");
});

// ── the box CTA + the bars reserve ALL selected lines (DEC-B) ──────────────
Deno.test("B3 the §10 box CTA opens the cart with ALL selected lines", () => {
  // the box's reserve fires onReserve(undefined, state.selectedLines).
  assertStringIncludes(body, "callbacks.onReserve(undefined, state.selectedLines)");
  // the state exposes the selected lines + the summed totals the box reads.
  assertStringIncludes(stateMachine, "selectedLines");
  assertStringIncludes(stateMachine, "summedAllInCents");
  assertStringIncludes(stateMachine, "summedDueTodayCents");
  // the reserve callback signature carries the lines array (DEC-B).
  assertStringIncludes(types, "lines?: TripReserveLine[]");
  assertStringIncludes(types, "export interface TripReserveLine");
});

// ── all-in is SERVER-sourced (WYSIWYP) end-to-end ──────────────────────────
Deno.test("B3 all-in is server-sourced (priceAllInCents), summed, never bare base", () => {
  // the type carries the server all-in field.
  assertStringIncludes(types, "priceAllInCents");
  // the math coalesces all-in → base (never fabricates a markup).
  assertStringIncludes(totals, "tier.priceAllInCents");
  assertStringIncludes(totals, ": tier.priceCents;");
  // BOTH surface adapters thread the server all-in in.
  assertStringIncludes(bizAdapter, "priceAllInCents");
  assertStringIncludes(bizAdapter, "allInByTicketType");
  assertStringIncludes(consumerAdapter, "priceAllInCents");
  assertStringIncludes(consumerAdapter, "enrich?.allInCents");
});

// ── the floating bar shows "From {X}" → summed all-in (DEC-J) ──────────────
Deno.test("B3 bar label is 'From {min}' until selected, then the summed all-in", () => {
  assertStringIncludes(stateMachine, "From ${formatTripPrice(minAllIn");
  assertStringIncludes(stateMachine, "tripMinTierAllInCents");
  // once ≥1 selected → the summed all-in / due-today.
  assertStringIncludes(stateMachine, "summedAllInLabel ?? \"\"");
});

// ── reserve → cart wiring per surface ──────────────────────────────────────
Deno.test("B3 business reserve passes the selected lines to the trip checkout", () => {
  // the route fires reserve with the selected lines and rides them as a JSON param.
  assertStringIncludes(bizRoute, "offeringState.selectedLines");
  assertStringIncludes(bizRoute, "JSON.stringify(lines)");
  // the checkout index seeds the cart from the lines param (DEC-B), skipping
  // tier-select; the single-tier auto-skip is gated off when lines are present.
  assertStringIncludes(bizCheckout, "seededLinesParam");
  assertStringIncludes(bizCheckout, "if (seededLinesParam.length > 0) return;");
  // ORCH-1138 preserved: straight to checkout, no EBES, no address/tax form.
  assertStringIncludes(bizRoute, "tripCheckoutPath(trip.id)");
});

Deno.test("B3 consumer reserve seeds the cart with the selected lines", () => {
  // the consumer Reserve seeds initialQuantities from the selected lines and opens
  // the cart directly (ORCH-1138 — never EBES).
  assertStringIncludes(consumerScreen, "setSeededQuantities(seed)");
  assertStringIncludes(consumerScreen, "initialQuantities={seededQuantities}");
  assertStringIncludes(consumerScreen, "openCart()");
  // the body gets the multi-select props.
  assertStringIncludes(consumerScreen, "onChangeQuantity={handleChangeQuantity}");
  assertStringIncludes(consumerScreen, "planChoiceByTier={planChoiceByTier}");
});

// ── package isolation (I-MOR-0827) — no app src import for all-in ──────────
Deno.test("B3 the all-in fetch stays in surface hooks, NOT the package", () => {
  // the package math + body never import a service / app src.
  assert(!body.includes("fetchTierAllInCents"), "body must not fetch all-in");
  assert(!totals.includes("import "), "tripBoxTotals must be import-free (pure)");
  assert(!body.includes('from "../../'), "body must not reach into app src");
});
