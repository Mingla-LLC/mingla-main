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
