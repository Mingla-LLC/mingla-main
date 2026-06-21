// META-ORCH-1174 Leg A [trip-page-standardize] — implementor-owned source-contract
// regression (the established offering-rendering deno-readfile style). These
// assertions FAIL-ON-REVERT:
//   §1 — the Seth-LOCKED canonical 2→11 section order in TripOfferingBody.
//   §2 — TripOfferingBody is gorhom-safe (NO ScrollView / BottomSheetScrollView).
//   §3 — fork retirement: the consumer forks are DELETED + the consumer screen +
//        web/business wrapper import the shared TripOfferingBody/TripReserveBar.
//   §4 — the §10 box + the bar read ONE shared state (useTripOfferingState).
//   §5 — package isolation: TripOfferingBody imports ZERO app src/.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const exists = async (rel: string): Promise<boolean> => {
  try {
    await Deno.stat(new URL(rel, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

const body = await read("../TripOfferingBody.tsx");
const barrel = await read("../index.ts");
const consumer = await read(
  "../../../app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
);
const tripPreview = await read(
  "../../../mingla-business/src/components/trip/TripPreview.tsx",
);
const dateRange = await read("../formatTripDateRange.ts");
const stateMachine = await read("../useTripOfferingState.ts");
const bizAdapter = await read(
  "../../../mingla-business/src/components/trip/tripOfferingAdapter.ts",
);
const consumerAdapter = await read(
  "../../../app-mobile/src/hooks/useConsumerTripOfferingData.ts",
);

// ── §1 — canonical 2→11 section order ──
Deno.test("§1 TripOfferingBody renders the Seth-locked 2→11 section order", () => {
  const order = [
    "trip-body-title", // 2 name
    "trip-body-route-pills", // 3 dates + leaving-from + destination FULL-WIDTH pills
    "trip-body-meta-pills", // 4 days&nights · spots · countdown
    "trip-body-presented-by", // 5
    "trip-body-about", // 6 (folded here per Seth)
    "trip-body-itinerary", // 7
    "trip-body-included", // 8
    "trip-body-cancellation", // 9
    "trip-body-pay-box", // 10
    "trip-body-map", // 11 (folded here per Seth)
  ];
  let cursor = 0;
  for (const id of order) {
    const idx = body.indexOf(`testID="${id}"`);
    assert(idx > -1, `missing section testID="${id}"`);
    assert(
      idx >= cursor,
      `section "${id}" is OUT OF ORDER (appears before the prior section)`,
    );
    cursor = idx;
  }
  // §6 About sits between Presented-By and Itinerary; §11 map between Cancellation
  // and (the absent-in-body) floating bar — i.e. AFTER the §10 pay box.
  assert(
    body.indexOf('testID="trip-body-about"') >
      body.indexOf('testID="trip-body-presented-by"'),
    "About must sit AFTER Presented-By (§6 fold)",
  );
  assert(
    body.indexOf('testID="trip-body-map"') >
      body.indexOf('testID="trip-body-pay-box"'),
    "Map must sit AFTER the pay box (§11 fold)",
  );
  // the NEW animated countdown pill lives in the §4 meta-pills row.
  assertStringIncludes(body, "<TripCountdownPill");
});

// ── §2 — gorhom-safe: the body hosts NO scroll root ──
Deno.test("§2 TripOfferingBody is NOT a scroll root (gorhom-safe)", () => {
  // Strip comments + JSDoc so the header's prose ("MUST NOT render a `ScrollView`")
  // never false-positives — we assert on ACTIVE code only (imports + JSX).
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert(
    !/\bimport\b[^;]*\bScrollView\b/.test(code) && !/<ScrollView\b/.test(code),
    "TripOfferingBody must NOT import/render a ScrollView (the surface owns the scroll)",
  );
  assert(
    !/<BottomSheetScrollView\b/.test(code),
    "TripOfferingBody must NOT render a BottomSheetScrollView (gorhom-safe)",
  );
});

// ── §3 — fork retirement ──
Deno.test("§3 the consumer forks are DELETED", async () => {
  assert(
    !(await exists(
      "../../../app-mobile/src/components/offering/ConsumerTripReserveBar.tsx",
    )),
    "ConsumerTripReserveBar.tsx must be deleted (replaced by the shared TripReserveBar)",
  );
  assert(
    !(await exists(
      "../../../app-mobile/src/components/offering/ConsumerRefundLadder.tsx",
    )),
    "ConsumerRefundLadder.tsx must be deleted (replaced by the shared TripRefundLadder)",
  );
});

Deno.test("§3 both surfaces import the SHARED body + bar", () => {
  assertStringIncludes(consumer, "TripOfferingBody");
  assertStringIncludes(consumer, "TripReserveBar");
  assertStringIncludes(consumer, "useTripOfferingState");
  assert(
    !/ConsumerTripReserveBar|ConsumerRefundLadder/.test(consumer),
    "the consumer screen must NOT reference the deleted forks",
  );
  assertStringIncludes(tripPreview, "TripOfferingBody");
});

Deno.test("§3 the shared symbols are barrel-exported", () => {
  for (const sym of [
    "TripOfferingBody",
    "useTripOfferingState",
    "TripReserveBar",
    "TripRefundLadder",
    "DayByDay",
    "TripCountdownPill",
  ]) {
    assertStringIncludes(barrel, sym);
  }
});

// ── §4 — one shared state (box + bar never diverge) ──
Deno.test("§4 the §10 box + the bar read ONE shared state", () => {
  // the body's §10 box reads `state` (the lifted machine), not a forked recompute.
  assertStringIncludes(body, "state.barPriceLabel");
  assertStringIncludes(body, "state.cta");
  // the reserve bar in BOTH wrappers reads offeringState.cta (the SAME owner).
  assertStringIncludes(consumer, "cta={offeringState.cta}");
});

// ── §5 — package isolation ──
Deno.test("§5 TripOfferingBody imports ZERO app src/", () => {
  assert(
    !/from\s+["'][^"']*(?:app-mobile|mingla-business)\/(?:src|app)\//.test(body),
    "TripOfferingBody must not import app src/ (I-MOR-0827)",
  );
});

// =====================================================================
// META-ORCH-1174 Leg A.3 [trip-page-fixes] — the five device-bug source contracts.
// ADD-only (the §1-§5 above are unchanged). FAILS-ON-REVERT by true deletion.
// =====================================================================

// ── A.3 bug #1 — dates + days&nights map via the Hermes-safe normalizer ──
Deno.test("A.3#1 the date/duration path routes through normalizeTimestampIso (Hermes-safe)", () => {
  // formatTripDateRange normalizes BEFORE new Date(...) so the space-separated
  // RPC timestamp parses on native (was "Dates to be set" on device).
  assertStringIncludes(dateRange, "normalizeTimestampIso");
  // both per-surface adapters derive days&nights via the SHARED Hermes-safe deriver
  // (no local Date.parse fork that NaN'd on native).
  assertStringIncludes(bizAdapter, "deriveTripDuration");
  assertStringIncludes(consumerAdapter, "deriveTripDuration");
  assert(
    !/function deriveDuration\b/.test(bizAdapter),
    "business adapter must use the SHARED deriveTripDuration (no local fork)",
  );
  assert(
    !/function deriveDuration\b/.test(consumerAdapter),
    "consumer adapter must use the SHARED deriveTripDuration (no local fork)",
  );
  // the §4 days&nights pill reads data.durationLabel.
  assertStringIncludes(body, "data.durationLabel");
});

// ── A.3 bug #2 — §3 route is ONE continuous "From → To" pill (not two) ──
Deno.test("A.3#2 §3 renders ONE continuous From→To route pill", () => {
  // the merged route pill exists…
  assertStringIncludes(body, 'testID="trip-body-route-pill"');
  // …and reads "From {departure} → {destination}".
  assertStringIncludes(body, "From ${data.departureCityCountry} → ${data.destinationCityCountry}");
  // the OLD two-block pattern ("Leaving from …" as its own pill) is GONE.
  assert(
    !body.includes("Leaving from "),
    "the separate 'Leaving from' pill must be merged into the single route pill",
  );
});

// ── A.3 bug #3 — the §11 map reads destinationLat/Lng from the body data ──
Deno.test("A.3#3 §11 map is gated on the body's destinationLat/Lng + mapUrl", () => {
  assertStringIncludes(body, "data.destinationLat !== null");
  assertStringIncludes(body, "data.destinationLng !== null");
  assertStringIncludes(body, "mapUrl !== null");
  // the map URL is built from the SAME destination coords (not a separate source).
  assertStringIncludes(body, "lat: data.destinationLat");
  assertStringIncludes(body, "lng: data.destinationLng");
});

Deno.test("A.3#3 BOTH adapters thread destinationLat/Lng into TripOfferingData", () => {
  // business adapter maps the businessTrip coords through to the body data.
  assertStringIncludes(bizAdapter, "destinationLat: bt.destinationLat");
  assertStringIncludes(bizAdapter, "destinationLng: bt.destinationLng");
  // consumer adapter maps the RPC-sourced coords through to the body data.
  assertStringIncludes(consumerAdapter, "destinationLat: detail.destinationLat");
  assertStringIncludes(consumerAdapter, "destinationLng: detail.destinationLng");
});

// ── A.3 bug #4 — the payment toggle is interactive (wired to the surface state) ──
Deno.test("A.3#4 the §10 payment toggle is wired to paymentPlanChoice", () => {
  // the toggle's value + onChange thread the surface-owned state machine.
  assertStringIncludes(body, "value={paymentPlanChoice}");
  assertStringIncludes(body, "onChange={onPaymentPlanChoiceChange}");
  // the live price label follows the SAME state the toggle drives.
  assertStringIncludes(body, "state.barPriceLabel");
  // the state machine's barPriceLabel BRANCHES on paymentPlanChoice (so flipping
  // the toggle changes the price the box + bar show) — installments → deposit
  // "today", full → "total". Deleting either branch FAILS this assertion.
  assertStringIncludes(stateMachine, 'paymentPlanChoice === "installments"');
  assertStringIncludes(stateMachine, "${depositLabel} today");
  assertStringIncludes(stateMachine, "${priceLabel} total");
  // the state machine recomputes on paymentPlanChoice (useMemo dep) — the toggle
  // is NOT dormant.
  assertStringIncludes(stateMachine, "}, [data, paymentPlanChoice, onReserve, now]);");
});

// ── A.3 bug #5 — ONE merged §10 box (no duplicate price box) ──
Deno.test("A.3#5 §10 is ONE merged box (toggle + price + reserve), not two", () => {
  // exactly ONE pay-box section + ONE select box.
  const payBoxCount = (body.match(/testID="trip-body-pay-box"/g) ?? []).length;
  const selectBoxCount = (body.match(/testID="trip-body-select-box"/g) ?? []).length;
  assertEquals(payBoxCount, 1, "there must be exactly ONE §10 pay-box");
  assertEquals(selectBoxCount, 1, "there must be exactly ONE select/reserve box");
  // the prior SECOND price box (the standalone 'recap' card) is DELETED.
  assert(
    !body.includes("recapCard") && !body.includes("recapPrice"),
    "the duplicate 'recap' price card must be removed (merged into the one box)",
  );
  // the payment toggle now lives INSIDE the select box (one box), before the
  // price row — assert the toggle's testID precedes the select total.
  const toggleIdx = body.indexOf('testID="trip-body-payment-choice"');
  const totalIdx = body.indexOf('testID="trip-body-select-total"');
  const proceedIdx = body.indexOf('testID="trip-body-box-proceed"');
  assert(toggleIdx > -1 && totalIdx > -1 && proceedIdx > -1, "missing §10 sub-parts");
  assert(
    toggleIdx < totalIdx && totalIdx < proceedIdx,
    "inside the ONE box: toggle → price → reserve CTA, in order",
  );
});
