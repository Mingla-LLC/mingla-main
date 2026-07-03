// ORCH-1263 [claim-adoption] Leg C — T-E1 (forbidden-key adversarial) +
// T-E2 (detail-mode guards). Invariant:
// I-PROPOSED-1263-ADOPTION-PAYLOAD-WHITELISTED — rating/review_count VALUES +
// AI/bouncer columns never cross either response; the detail surface is
// single-place, authed, rate-limited, fail-closed.
//
// MUST FAIL when the change is reverted:
//   * a mapper edit that leaks rating/review_count (or stops self-asserting)
//     → T-E1's leak + throw assertions fail;
//   * dropping the uuid guard / the zero-rows→404 fail-close → T-E2 fails;
//   * relaxing the shared 10/min bucket → the 429 arm fails.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  assertNoForbiddenKeys,
  type PoolAdoptionDetailRow,
  type PoolMatchRow,
  rowToAdoptionDetail,
  rowToPoolMatch,
} from "../../_shared/poolMatchResponse.ts";
import { FACET_COLUMNS } from "../../_shared/authoredApply.ts";
import {
  checkRateLimit,
  detailResponseForRows,
  isUuid,
  normalizeDetailBody,
  requireUser,
} from "../index.ts";

const FORBIDDEN = [
  "rating",
  "review_count",
  "bouncer_reason",
  "is_servable",
  "photo_aesthetic_data",
  "raw_google_data",
  "ai_reason",
  "ai_confidence",
];

function pollutedSearchRow(): PoolMatchRow & Record<string, unknown> {
  return {
    id: "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0",
    name: "The Lantern Room",
    address: "12 Vine St",
    city: "Raleigh",
    country: "US",
    lat: 35.78,
    lng: -78.64,
    google_place_id: "gp-lantern",
    primary_type: "wine_bar",
    types: ["bar", "restaurant"],
    opening_hours: { periods: [] },
    stored_photo_urls: [
      "https://cdn/1.jpg",
      "https://cdn/2.jpg",
      "https://cdn/3.jpg",
      "https://cdn/4.jpg",
      "https://cdn/5.jpg",
      "https://cdn/6.jpg",
      "https://cdn/7.jpg",
    ],
    has_hours: true,
    has_phone: false,
    has_website: true,
    has_rating: true,
    photo_count: 7,
    claim_state: "pending",
    // POLLUTION — a hostile/buggy RPC shape carrying banned columns.
    rating: 4.6,
    review_count: 321,
    ai_reason: "leak me",
    bouncer_reason: "leak me too",
    is_servable: true,
    raw_google_data: { secret: true },
  };
}

Deno.test("T-E1: search mapper never emits a forbidden key from a polluted row; facts/claim_state map correctly", () => {
  const match = rowToPoolMatch(pollutedSearchRow());
  const keys = new Set(Object.keys(match as unknown as Record<string, unknown>));
  for (const banned of FORBIDDEN) {
    assert(!keys.has(banned), `search response leaked ${banned}`);
  }
  // The new facts crossed; the VALUE did not.
  assertEquals(match.hasRating, true);
  assertEquals(match.hasHours, true);
  assertEquals(match.hasPhone, false);
  assertEquals(match.photoCount, 7);
  assertEquals(match.claimState, "pending");
  // photoUrls stay capped at 6 on the search row; photoCount carries the truth.
  assertEquals(match.photoUrls.length, 6);
  // wine_bar → drinks_and_music bucket → catch-all restaurant, NOT confident.
  assertEquals(match.venueCategoryConfident, false);
});

Deno.test("T-E1: old-RPC tolerance — absent fact columns default to false/0/available", () => {
  const legacy = pollutedSearchRow();
  delete (legacy as Record<string, unknown>).has_hours;
  delete (legacy as Record<string, unknown>).has_phone;
  delete (legacy as Record<string, unknown>).has_website;
  delete (legacy as Record<string, unknown>).has_rating;
  delete (legacy as Record<string, unknown>).photo_count;
  delete (legacy as Record<string, unknown>).claim_state;
  const match = rowToPoolMatch(legacy);
  assertEquals(match.hasHours, false);
  assertEquals(match.hasRating, false);
  assertEquals(match.photoCount, 0);
  assertEquals(match.claimState, "available");
});

Deno.test("T-E1: category confidence — explicit arms confident, catch-all not", () => {
  // brunch_lunch_casual (true restaurant family) → confident.
  assertEquals(
    rowToPoolMatch({ ...pollutedSearchRow(), primary_type: "italian_restaurant", types: ["italian_restaurant"] })
      .venueCategoryConfident,
    true,
  );
  // play arm → confident.
  const play = rowToPoolMatch({ ...pollutedSearchRow(), primary_type: "amusement_park", types: ["amusement_park"] });
  assertEquals(play.venueCategory, "play");
  assertEquals(play.venueCategoryConfident, true);
  // creative_arts arm → confident.
  assertEquals(
    rowToPoolMatch({ ...pollutedSearchRow(), primary_type: "art_studio", types: ["art_studio"] })
      .venueCategoryConfident,
    true,
  );
  // Unmapped → restaurant default, NOT confident (R-8: no fabricated confidence).
  const unmapped = rowToPoolMatch({ ...pollutedSearchRow(), primary_type: "car_wash", types: ["car_wash"] });
  assertEquals(unmapped.venueCategory, "restaurant");
  assertEquals(unmapped.venueCategoryConfident, false);
});

Deno.test("T-E1: adoption-detail mapper — full uncapped gallery, 23-facet fold, no forbidden keys; assert guard throws on a leak", () => {
  const row: PoolAdoptionDetailRow = {
    id: "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0",
    name: "The Lantern Room",
    address: "12 Vine St",
    city: "Raleigh",
    country: "US",
    lat: 35.78,
    lng: -78.64,
    google_place_id: "gp-lantern",
    primary_type: "wine_bar",
    types: ["bar"],
    opening_hours: { periods: [] },
    stored_photo_urls: [
      "https://cdn/1.jpg",
      "https://cdn/2.jpg",
      "https://cdn/3.jpg",
      "https://cdn/4.jpg",
      "https://cdn/5.jpg",
      "https://cdn/6.jpg",
      "https://cdn/7.jpg",
      "ftp://bad/protocol.jpg",
    ],
    national_phone_number: "(919) 555-0101",
    website: "https://lantern.example",
    price_tiers: ["comfy", "bougie"],
    price_level: "PRICE_LEVEL_EXPENSIVE",
    generative_summary: "A moody wine bar.",
    editorial_summary: "Editors love it.",
    reservable: true,
    serves_dinner: true,
    outdoor_seating: false,
    // POLLUTION (hostile row shape).
    rating: 4.6,
    review_count: 321,
    ai_confidence: 0.99,
  };
  const detail = rowToAdoptionDetail(row);
  const keys = new Set(Object.keys(detail as unknown as Record<string, unknown>));
  for (const banned of FORBIDDEN) {
    assert(!keys.has(banned), `detail response leaked ${banned}`);
  }
  // FULL gallery (7 http(s) URLs — uncapped, protocol-filtered).
  assertEquals(detail.photoUrls.length, 7);
  // Facets: exactly the 23 ids, boolean|null.
  assertEquals(Object.keys(detail.facets).length, FACET_COLUMNS.size);
  assertEquals(detail.facets.serves_dinner, true);
  assertEquals(detail.facets.outdoor_seating, false);
  assertEquals(detail.facets.serves_beer, null); // absent → null, never fabricated
  assertEquals(detail.facets.reservable, true);
  assertEquals(detail.reservable, true);
  assertEquals(detail.nationalPhoneNumber, "(919) 555-0101");
  assertEquals(detail.priceTiers, ["comfy", "bougie"]);

  // The runtime guard itself bites: a response object carrying a banned key throws.
  assertThrows(
    () => assertNoForbiddenKeys({ ...detail as unknown as Record<string, unknown>, rating: 4.6 }),
    Error,
    "forbidden_field_leaked:rating",
  );
  assertThrows(
    () => assertNoForbiddenKeys({ review_count: 10 }),
    Error,
    "forbidden_field_leaked:review_count",
  );
});

// ── T-E2 — detail-mode guards: 401 / 429 / 400 / 404 ────────────────────────

Deno.test("T-E2: no auth header → 401 (requireUser early return, no network)", async () => {
  const res = await requireUser(new Request("http://localhost/claim-search-pool", { method: "POST" }));
  assert(res instanceof Response);
  assertEquals((res as Response).status, 401);
});

Deno.test("T-E2: shared 10/min bucket — 11th hit inside the window is rejected (detail shares the search bucket)", () => {
  const user = "rate-user-orch1263";
  const t0 = 1_760_000_000_000;
  for (let i = 0; i < 10; i++) {
    assertEquals(checkRateLimit(user, t0 + i), true, `hit ${i + 1} should pass`);
  }
  assertEquals(checkRateLimit(user, t0 + 10), false, "11th hit must be rate_limited");
  // Window expiry frees the bucket.
  assertEquals(checkRateLimit(user, t0 + 61_000), true);
});

Deno.test("T-E2: bad place_id → 400 invalid_place_id (uuid-gate before any RPC)", () => {
  assertEquals(isUuid("3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0"), true);
  for (const bad of ["nope", "", 123, null, undefined, "3c7ebebf-7249-45a2-8b0b"]) {
    const out = normalizeDetailBody({ place_id: bad });
    assertEquals(out.ok, false);
    if (!out.ok) assertEquals(out.error, "invalid_place_id");
  }
  const ok = normalizeDetailBody({ place_id: "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0" });
  assert(ok.ok);
});

Deno.test("T-E2: zero RPC rows (claimed/pending/inactive) → 404 place_not_available; one row → 200 {detail}", async () => {
  const notAvailable = detailResponseForRows([]);
  assertEquals(notAvailable.status, 404);
  assertEquals((await notAvailable.json()).error, "place_not_available");

  const okRes = detailResponseForRows([{
    id: "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0",
    name: "The Lantern Room",
    address: null,
    city: null,
    country: null,
    lat: 35.78,
    lng: -78.64,
    google_place_id: "gp",
    primary_type: "wine_bar",
    types: ["bar"],
    opening_hours: null,
    stored_photo_urls: ["https://cdn/1.jpg"],
    national_phone_number: null,
    website: null,
    price_tiers: null,
    price_level: null,
    generative_summary: null,
    editorial_summary: null,
    reservable: null,
  }]);
  assertEquals(okRes.status, 200);
  const body = await okRes.json();
  assertEquals(body.detail.name, "The Lantern Room");
  assertEquals(body.detail.reservable, false);
});
