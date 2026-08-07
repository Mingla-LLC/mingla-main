// @ts-nocheck — Jest globals follow the app-mobile test convention (see
// discoveryPriceCarriers.issue1384.test.ts and holidayCardToExpandedCardData.test.ts
// in this same directory). Runtime-typechecked by jest via babel-preset-expo.
/**
 * Issue #1669 — "The same place shows different facts depending on which screen
 * you opened it from."
 *
 * Happy-path regression test (implementor). The tester owns a second,
 * adversarial angle.
 *
 *   npx jest --runInBand \
 *     src/components/utils/__tests__/issue_1669_one_producer_parity.test.ts
 *
 * WHAT THIS TEST DOES
 * -------------------
 * It takes ONE place — a Lagos venue with a real price, real opening hours, a
 * real UTC offset, no rating and, in one group, no coordinates — and opens it
 * through FOUR REAL PRODUCTION ENTRY POINTS:
 *
 *   deck   `recommendationToExpandedCardData`   (SwipeableCards)
 *   likes  `savedCardToExpandedCardData`        (SavedTab / CalendarTab / SessionViewModal)
 *   chat   `cardPayloadToExpandedCardData`      (MessageInterface)
 *   friend `holidayCardToExpandedCardData`      (ViewFriendProfileScreen)
 *
 * …and then asks the SAME QUESTIONS THE UI ASKS, using the SAME functions the
 * UI uses, and asserts the answers agree:
 *
 *   price pill    `canonicalDiscoveryPriceDetail(card)`  — CardInfoSection.tsx:55
 *   open / closed `isPlaceOpenAt(extractWeekdayText(card.openingHours),
 *                                now, card.utcOffsetMinutes)` — ActionButtons.tsx:153
 *   rating chip   CardInfoSection's OWN guard, extracted and executed — an
 *                 unrated place must render no star pill at all
 *   weather block `card.location`                        — ExpandedCardModal fetch gate
 *
 * It is deliberately NOT a test that a mapper is imported. Every assertion is
 * the rendered fact, computed by the renderer's own helper.
 *
 * THE TIMEZONE CASE IS THE POINT
 * ------------------------------
 * TZ is pinned to Europe/London and the instant is chosen in JANUARY, when
 * London is GMT (UTC+0) and Lagos is WAT (UTC+1) — a real one-hour disagreement
 * between two of Mingla's three live markets. At 22:30 UTC the venue is CLOSED
 * (23:30 its time, past an 11pm close) and the viewer's clock says 22:30, which
 * would read OPEN. A producer that drops `utcOffsetMinutes` therefore tells the
 * user the opposite of the truth, and group B fails.
 */

// Must precede every Date construction in this file. Node resets its date cache
// on assignment to process.env.TZ (v16.2+), which is what makes the device-clock
// half of group B deterministic on any machine and in CI.
process.env.TZ = "Europe/London";

// `describe`/`it` are jest globals; assertions use Node's built-in strict assert
// so every failure can carry the sentence that explains WHAT the user saw.
// `expect(...).toBe(...)` has no message parameter, and a bare "expected true,
// got false" would tell the next reader nothing about a timezone badge.
import assert from "node:assert/strict";
// C-3 reads the renderer's own source and executes its star-chip guard.
import fs from "node:fs";
import path from "node:path";

import { savedCardToExpandedCardData } from "../savedCardToExpandedCardData";
import { recommendationToExpandedCardData } from "../recommendationToExpandedCardData";
import { holidayCardToExpandedCardData } from "../holidayCardToExpandedCardData";
import { cardPayloadToExpandedCardData } from "../../../services/cardPayloadAdapter";
import { canonicalDiscoveryPriceDetail } from "../../../utils/priceTiers";
import {
  extractWeekdayText,
  isPlaceOpenAt,
} from "../../../utils/openingHoursUtils";
// `deckService` pulls the RN network + feature-flag surface at module load, so
// the same stubs the sibling deckService.issue1384 suite uses are applied here.
// The mapper under test is pure — none of the stubs touch it.
jest.mock("../../../services/supabase", () => ({
  supabase: {},
  trackedInvoke: jest.fn(),
}));
jest.mock("../../../services/curatedExperiencesService", () => ({
  curatedExperiencesService: {
    generateCuratedExperiences: jest.fn(async () => ({ cards: [] })),
  },
}));
jest.mock("../../../config/featureFlags", () => ({
  FEATURE_FLAG_PROGRESSIVE_DELIVERY: false,
  FEATURE_FLAG_ACCOUNT_SIDE_TOGGLE: false,
}));
import { unifiedCardToRecommendation } from "../../../services/deckService";

// ── the one place, in each surface's own source shape ────────────────────────

/** Server-owned canonical discovery price. This alone decides the price pill. */
const PRICE = {
  priceRangeStatus: "active",
  sourceMinMinor: 850000,
  sourceMaxMinor: 1500000,
  sourceCurrencyCode: "NGN",
  sourceMinorUnitExponent: 2,
  displayMinMinor: 530,
  displayMaxMinor: 935,
  displayCurrencyCode: "USD",
  displayMinorUnitExponent: 2,
  priceIsApproximate: true,
  fxSnapshotId: "00000000-0000-4000-8000-000000000001",
  fxProvider: "exchange_rate_api_open_v6",
  fxProviderUpdatedAt: "2027-01-29T00:00:00.000Z",
  fxFreshness: "fresh",
};

const OPENING_HOURS = {
  weekdayDescriptions: [
    "Monday: 9:00 AM – 11:00 PM",
    "Tuesday: 9:00 AM – 11:00 PM",
    "Wednesday: 9:00 AM – 11:00 PM",
    "Thursday: 9:00 AM – 11:00 PM",
    "Friday: 9:00 AM – 11:00 PM",
    "Saturday: 9:00 AM – 11:00 PM",
    "Sunday: 9:00 AM – 11:00 PM",
  ],
};

/** Lagos is UTC+1 (WAT, no DST). */
const LAGOS_OFFSET_MINUTES = 60;

const BASE = {
  id: "place_terra_kulture",
  placeId: "ChIJ_terra_kulture",
  title: "Terra Kulture",
  category: "casual_food",
  categoryIcon: "utensils-crossed",
  description: "Lagos arts centre and restaurant",
  fullDescription: "Lagos arts centre and restaurant on Tiamiyu Savage.",
  image: "https://cdn.example/terra/0.jpg",
  images: ["https://cdn.example/terra/0.jpg"],
  // Constitution #9: this place genuinely has NO rating. Three producers used
  // to show 4.5 stars for exactly this case.
  rating: null,
  reviewCount: 0,
  address: "1376 Tiamiyu Savage St, Victoria Island, Lagos",
  openingHours: OPENING_HOURS,
  utcOffsetMinutes: LAGOS_OFFSET_MINUTES,
  website: "https://terrakulture.com",
  phone: "+2348039250018",
  highlights: ["Gallery", "Theatre"],
  tags: ["restaurant", "arts"],
  matchScore: 82,
  lat: 6.4281,
  lng: 3.4219,
  ...PRICE,
};

/** Explorer deck — a `Recommendation` straight off the deck batch. */
const asRecommendation = () => ({ ...BASE, distance: null, travelTime: null });

/** Likes — a `SavedCard` (saved_card.card_data, spread by normalizeRecord). */
const asSavedCard = () => ({
  ...BASE,
  dateAdded: "2027-01-05T10:00:00.000Z",
  source: "solo",
});

/** Chat — a `CardPayload` snapshot shared into a thread. */
const asCardPayload = () => ({
  ...BASE,
  location: { lat: BASE.lat, lng: BASE.lng },
  // The SENDER's distance. The recipient must never see it.
  distance: "0.4 km",
  travelTime: "6 min",
});

/** Friend page — a `HolidayCard` (different field NAMES, same place). */
const asHolidayCard = () => ({
  id: BASE.id,
  title: BASE.title,
  category: BASE.category,
  categorySlug: "casual_food",
  imageUrl: BASE.image,
  rating: null,
  priceLevel: null,
  address: BASE.address,
  googlePlaceId: BASE.placeId,
  lat: BASE.lat,
  lng: BASE.lng,
  priceTier: null,
  description: BASE.description,
  cardType: "single",
  tagline: null,
  stops: 0,
  stopsData: null,
  totalPriceMin: null,
  totalPriceMax: null,
  website: BASE.website,
  estimatedDurationMinutes: null,
  experienceType: null,
  categories: null,
  shoppingList: null,
  ...PRICE,
});

/**
 * Open the same place from every entry point. Each call is EXACTLY the call the
 * production surface makes — SavedTab spreads its own resolved match score,
 * the deck passes the viewer's planning datetime, the friend page passes the
 * travel mode.
 */
function openFromEveryEntryPoint(overrides = {}) {
  const patch = (base) => ({ ...base, ...overrides });
  return {
    deck: recommendationToExpandedCardData(patch(asRecommendation()), {
      selectedDateTime: new Date("2027-01-11T22:30:00.000Z"),
    }),
    likes: savedCardToExpandedCardData(
      { ...patch(asSavedCard()), matchScore: BASE.matchScore },
      { selectedDateTime: new Date("2027-01-05T10:00:00.000Z") },
    ),
    chat: cardPayloadToExpandedCardData(patch(asCardPayload())),
  };
}

/** Monday 2027-01-11 22:30 UTC → 22:30 in London (GMT), 23:30 in Lagos (WAT). */
const NOW = new Date("2027-01-11T22:30:00.000Z");

// ── A · the price pill ──────────────────────────────────────────────────────

describe("#1669 A — the price pill is the same from every entry point", () => {
  it("A-1: every producer yields the identical rendered price, not just the same fields", () => {
    const { deck, likes, chat } = openFromEveryEntryPoint();
    const friend = holidayCardToExpandedCardData(asHolidayCard(), {
      travelMode: "walking",
    });

    // This is the exact call CardInfoSection.tsx:55 makes to decide whether the
    // pill renders at all.
    const rendered = {
      deck: canonicalDiscoveryPriceDetail(deck),
      likes: canonicalDiscoveryPriceDetail(likes),
      chat: canonicalDiscoveryPriceDetail(chat),
      friend: canonicalDiscoveryPriceDetail(friend),
    };

    for (const [surface, detail] of Object.entries(rendered)) {
      assert.notEqual(
        detail,
        null,
        `${surface}: the price pill did not render. Before #1669 this was the live state of the deck, Discover and chat: the producer never spread canonicalDiscoveryPriceFields, so the renderer returned null and the same restaurant showed a price from Likes and no price at all from the deck it was discovered on.`,
      );
    }

    assert.deepEqual(rendered.likes, rendered.deck, "deck vs Likes price");
    assert.deepEqual(rendered.chat, rendered.deck, "chat vs deck price");
    assert.deepEqual(rendered.friend, rendered.deck, "friend page vs deck price");

    // Non-vacuity: the fixture really does produce a formatted range, so a
    // mapper that dropped the fields could not pass by returning null twice.
    assert.match(rendered.deck.source, /8,500/);
    assert.equal(typeof rendered.deck.approximate, "string");
  });

  it("A-2: a place with no server price shows no pill anywhere — never a fabricated one", () => {
    const unpriced = {
      priceRangeStatus: "unset",
      sourceMinMinor: null,
      sourceMaxMinor: null,
      sourceCurrencyCode: null,
      sourceMinorUnitExponent: null,
    };
    const { deck, likes, chat } = openFromEveryEntryPoint(unpriced);
    for (const [surface, card] of Object.entries({ deck, likes, chat })) {
      assert.equal(
        canonicalDiscoveryPriceDetail(card),
        null,
        `${surface} invented a price for a place the server has no price for`,
      );
    }
  });
});

// ── B · Open now / Closed ───────────────────────────────────────────────────

describe("#1669 B — Open now / Closed is the venue's clock on every entry point", () => {
  it("B-1: a London viewer gets the LAGOS answer from the deck, Likes and chat alike", () => {
    const { deck, likes, chat } = openFromEveryEntryPoint();

    // Exactly what ActionButtons.tsx:153 feeds useIsPlaceOpen → isPlaceOpenAt.
    const badge = (card) =>
      isPlaceOpenAt(
        extractWeekdayText(card.openingHours),
        NOW,
        card.utcOffsetMinutes ?? card.utc_offset_minutes ?? null,
      );

    // Ground truth: 23:30 in Lagos, past an 11pm close → CLOSED.
    assert.equal(
      badge(deck),
      false,
      "the deck told a London viewer a Lagos venue was open at 23:30 its time — this is the D2 defect, and it was live on five of six surfaces",
    );
    assert.equal(badge(likes), false, "Likes disagreed with the venue's clock");
    assert.equal(badge(chat), false, "chat disagreed with the venue's clock");

    // Non-vacuity: prove the offset is what produced the answer. Dropping it —
    // which is precisely what five producers did — flips the badge to OPEN,
    // because the viewer's London clock reads 22:30.
    const withoutOffset = isPlaceOpenAt(
      extractWeekdayText(deck.openingHours),
      NOW,
      null,
    );
    assert.equal(
      withoutOffset,
      true,
      "fixture no longer distinguishes venue-local from device-local time; pick another instant or the assertions above prove nothing",
    );
  });

  it("B-2: the offset survives every producer (it is what the badge reads)", () => {
    const { deck, likes, chat } = openFromEveryEntryPoint();
    for (const [surface, card] of Object.entries({ deck, likes, chat })) {
      assert.equal(
        card.utcOffsetMinutes,
        LAGOS_OFFSET_MINUTES,
        `${surface} dropped utcOffsetMinutes, so isPlaceOpenAt falls back to the viewer's device clock`,
      );
    }
  });
});

// ── C · the rating chip ─────────────────────────────────────────────────────
//
// The first cut of this fix asserted `card.rating === 0` here, with the message
// "the modal hides the chip at 0". That claim was FALSE and the test passed
// anyway: `CardInfoSection` gated on `rating !== undefined`, so `0` rendered as
// `★ 0.0` — an invented zero that reads as a real, terrible score. 763 servable
// place-pool rows have `rating IS NULL`, and one has a stored `0`.
//
// C-1 now asserts absence rather than a sentinel, and C-3 asks the RENDERER
// whether the chip appears instead of asserting what the renderer does.

describe("#1669 C — an unrated place is unrated on every entry point", () => {
  it("C-1: an unrated place reaches the modal with NO rating — not 4.5, and not 0", () => {
    const { deck, likes, chat } = openFromEveryEntryPoint();
    const friend = holidayCardToExpandedCardData(asHolidayCard(), {
      travelMode: "walking",
    });
    for (const [surface, card] of Object.entries({ deck, likes, chat, friend })) {
      assert.equal(
        card.rating,
        undefined,
        `${surface} produced a rating for a place that has none. Constitution #9: missing data is HIDDEN, and a coerced 0 is not hidden — CardInfoSection printed it as "★ 0.0".`,
      );
    }
  });

  it("C-2: a real rating is carried through unchanged", () => {
    const { deck, likes, chat } = openFromEveryEntryPoint({ rating: 4.2 });
    assert.equal(deck.rating, 4.2);
    assert.equal(likes.rating, 4.2);
    assert.equal(chat.rating, 4.2);
  });

  it("C-3: the REAL render guard hides the chip for every unrated form, and shows it for a real rating", () => {
    // Read the star-chip condition out of its real source and RUN it. The point
    // of C-3 is that no sentence in this file describes what the renderer does —
    // the renderer answers for itself. If the JSX moves, this fails loudly
    // rather than quietly asserting nothing (the vacuity guard).
    //
    // #1605 wave 4 [TEST-MOD-APPROVED #1605] — RE-POINTED, on this test's own
    // instruction ("if it moved, re-point the test rather than deleting it").
    // The star is no longer a `metricPill` in CardInfoSection: it is span 1 of
    // the hero plate's meta line, produced by `singlePlaceSpans`. The assertion
    // is byte-identical in meaning and now runs one layer EARLIER — at the point
    // that decides whether the fact EXISTS, which governs the deck card, the
    // expanded sheet's plate and every other surface that draws the meta line.
    // Nothing was weakened: the same expression is extracted and executed
    // against the same unrated forms.
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../expandedCard/expandedCardFacts.ts"),
      "utf8",
    );
    const match = /if\s*\(([^)]*\brating\b[^)]*)\)\s*\{\s*spans\.push\(\{\s*kind:\s*'rating'/.exec(
      source,
    );
    assert.ok(
      match,
      "Could not find the star-chip guard in expandedCardFacts.ts. This test proves the chip is hidden by executing that guard — if it moved, re-point the test rather than deleting it.",
    );
    const expr = match[1].trim();
    // eslint-disable-next-line no-new-func
    const chipRenders = new Function("rating", `return Boolean(${expr});`) as (
      r: unknown,
    ) => boolean;

    // The value the mapper emits for a place with no rating…
    const { deck, likes, chat } = openFromEveryEntryPoint();
    for (const [surface, card] of Object.entries({ deck, likes, chat })) {
      assert.equal(
        chipRenders(card.rating),
        false,
        `${surface}: the star chip RENDERS for an unrated place under the real guard \`${expr}\`.`,
      );
    }
    // …and the two other shapes an unrated place arrives in.
    assert.equal(chipRenders(null), false, `\`${expr}\` renders a chip for null`);
    assert.equal(
      chipRenders(0),
      false,
      `\`${expr}\` renders "★ 0.0" for a stored zero — one servable place in the pool has exactly that`,
    );
    // And a genuine rating must still show, or this is the opposite bug.
    assert.equal(
      chipRenders(4.2),
      true,
      `\`${expr}\` hides a REAL rating — hiding a fact is as wrong as inventing one`,
    );
  });
});

// ── D · weather / busyness location ─────────────────────────────────────────

describe("#1669 D — a coordinate-less card never borrows the viewer's location", () => {
  it("D-1: no producer substitutes a location the venue does not have", () => {
    const { deck, likes, chat } = openFromEveryEntryPoint({
      lat: undefined,
      lng: undefined,
      location: undefined,
    });
    for (const [surface, card] of Object.entries({ deck, likes, chat })) {
      assert.equal(
        card.location,
        undefined,
        `${surface} supplied a location for a card that has no coordinates. ExpandedCardModal gates its weather, busyness and booking fetches on card.location, so a substituted viewer position renders the USER's weather under the VENUE's name.`,
      );
    }
  });

  it("D-2: real coordinates still reach the weather/busyness fetch gate", () => {
    const { deck, likes, chat } = openFromEveryEntryPoint();
    for (const [surface, card] of Object.entries({ deck, likes, chat })) {
      assert.deepEqual(
        card.location,
        { lat: BASE.lat, lng: BASE.lng },
        `${surface} lost the venue's coordinates`,
      );
    }
  });
});

// ── E · curated plans ───────────────────────────────────────────────────────

describe("#1669 E — a curated plan is passed through, not rebuilt", () => {
  const curated = () => ({
    id: "exp_lagos_night",
    cardType: "curated",
    title: "A Lagos night",
    tagline: "Dinner, then the water",
    experienceType: "romantic",
    pairingKey: "dinner_then_view",
    totalPriceMin: 40,
    totalPriceMax: 120,
    estimatedDurationMinutes: 180,
    shoppingList: ["cash for the boat"],
    // The field an allowlist rebuild would silently lose.
    curatedNarrative: "Start on the mainland, end on the water.",
    stops: [
      { placeId: "s1", placeName: "Dinner", stopLabel: "Start Here", rating: 4.6 },
      { placeId: "s2", placeName: "Dessert", stopLabel: "Then", rating: 4.8 },
      { placeId: "s3", placeName: "The water", stopLabel: "End With", rating: 4.2 },
    ],
  });

  it("E-1: every stop and every curated field survives the deck and Likes alike", () => {
    const fromDeck = recommendationToExpandedCardData(curated());
    const fromLikes = savedCardToExpandedCardData(curated());

    for (const [surface, card] of Object.entries({ fromDeck, fromLikes })) {
      assert.equal(card.cardType, "curated", `${surface} lost the curated discriminator`);
      assert.equal(card.stops.length, 3, `${surface} lost stops`);
      assert.equal(card.stops[2].placeName, "The water");
      assert.equal(card.experienceType, "romantic");
      assert.equal(card.pairingKey, "dinner_then_view");
      assert.deepEqual(card.shoppingList, ["cash for the boat"]);
      assert.equal(
        card.curatedNarrative,
        "Start on the mainland, end on the water.",
        `${surface} rebuilt the plan from a fixed key allowlist instead of passing it through — the ORCH-1054 defect, which was still live on Likes, Calendar and the collab session view`,
      );
    }
  });

  it("E-2: a legacy row with stops but no cardType still renders as curated", () => {
    const legacy = curated();
    delete legacy.cardType;
    const card = savedCardToExpandedCardData(legacy);
    assert.equal(
      card.cardType,
      "curated",
      "SavedTab discriminated on `Array.isArray(stops)`, so rows saved before cardType was written must still open as curated",
    );
    assert.equal(card.stops.length, 3);
  });
});

// ── F · chat keeps its own honest suppressions ──────────────────────────────

describe("#1669 F — collapsing chat onto the mapper kept chat's own rules", () => {
  it("F-1: the sender's distance and travel time are still suppressed", () => {
    const chat = cardPayloadToExpandedCardData(asCardPayload());
    assert.equal(
      chat.distance,
      null,
      "the sender's distance is meaningless to the recipient (ORCH-0659/0660)",
    );
    assert.equal(chat.travelTime, null);
  });

  it("F-2: lock-in metadata still reaches the LockedInBanner", () => {
    const chat = cardPayloadToExpandedCardData({
      ...asCardPayload(),
      event: "card_locked_and_scheduled",
      scheduled_at: "2027-01-20T19:00:00.000Z",
      locker_user_id: "user-1",
      saved_card_id: "saved-1",
      session_id: "session-1",
    });
    assert.equal(chat.lockInEvent, "card_locked_and_scheduled");
    assert.equal(chat.scheduledAt, "2027-01-20T19:00:00.000Z");
    assert.equal(chat.lockerUserId, "user-1");
    assert.equal(chat.savedCardId, "saved-1");
    assert.equal(chat.sessionId, "session-1");
  });
});

// ── G · the upstream half, found on a device and not in the source read ─────

describe("#1669 G — the deck's cards carry the venue's UTC offset at all", () => {
  it("G-1: unifiedCardToRecommendation keeps utcOffsetMinutes", () => {
    // Runtime finding, Samsung + this branch's Metro, TZ=Asia/Tokyo: a Durham
    // cafe open 8am–9pm still read "Closed" with every expanded-card producer
    // collapsed. `discover-cards` emits `utcOffsetMinutes` and `Recommendation`
    // declares it, but this client mapper never copied it — so the field the
    // Open-now badge reads was already gone one layer ABOVE every producer the
    // investigation named. Collapsing the producers cannot fix a field that
    // never arrives.
    const rec = unifiedCardToRecommendation({
      id: "p1",
      title: "Yonder Coffee",
      category: "Icebreakers",
      address: "108 E Main St, Durham, NC",
      lat: 35.9946091,
      lng: -78.9005212,
      rating: 4.6,
      utcOffsetMinutes: -240,
      openingHours: OPENING_HOURS,
    });
    assert.equal(
      rec.utcOffsetMinutes,
      -240,
      "the deck's Recommendation dropped the venue's UTC offset, so every downstream producer had nothing to pass on",
    );

    // And it survives the whole way to the modal's input.
    const expanded = recommendationToExpandedCardData(rec);
    assert.equal(expanded.utcOffsetMinutes, -240);
  });

  it("G-2: a card the server sends no offset for stays honestly null", () => {
    const rec = unifiedCardToRecommendation({
      id: "p2",
      title: "No offset",
      category: "Icebreakers",
      address: "",
      lat: 1,
      lng: 2,
    });
    assert.equal(
      rec.utcOffsetMinutes,
      null,
      "an absent offset must be null, never a fabricated 0 (which would silently mean UTC)",
    );
  });

  it("G-3: an unrated server row stays unrated at the deck's own mapper, not zero", () => {
    // The rating fabrication has TWO sources, and collapsing the producers only
    // closed one. `unifiedCardToRecommendation` is upstream of every producer:
    // it coerced `card.rating ?? 0`, so an unrated place arrived at the mapper
    // already carrying a number, and no amount of honesty downstream could tell
    // absence from a real zero. 763 of 35,249 servable place_pool rows have
    // `rating IS NULL`; the deck is the surface most of them are seen on.
    const rec = unifiedCardToRecommendation({
      id: "p3",
      title: "The Parlour",
      category: "Icebreakers",
      address: "117 Market St, Durham, NC",
      lat: 35.9968,
      lng: -78.8999,
      openingHours: OPENING_HOURS,
    });
    assert.equal(
      rec.rating,
      undefined,
      "the deck stamped a rating onto a place the server has none for. Downstream this is indistinguishable from a real 0, and the expanded card printed it as `★ 0.0` — an invented zero that reads as a real, terrible score.",
    );
    assert.equal(
      recommendationToExpandedCardData(rec).rating,
      undefined,
      "the fabricated rating survived into the modal's input",
    );

    // A real rating is untouched.
    const rated = unifiedCardToRecommendation({
      id: "p4",
      title: "Frankie's of Raleigh",
      category: "Icebreakers",
      address: "11190 Fun Park Dr, Raleigh, NC",
      lat: 35.9,
      lng: -78.8,
      rating: 4.4,
    });
    assert.equal(rated.rating, 4.4, "a real rating stopped being carried");
  });
});

// ── H · the Calendar persistence hop ────────────────────────────────────────
//
// The PR claimed "a field either survives for all of them or for none of them."
// That is true of the eleven PRODUCERS, and false across this hop. Scheduling a
// card writes `card_data` through `CalendarService`'s own `allowedCardFields`
// allowlist, and CalendarTab reads that row straight back into the canonical
// mapper — so a field the allowlist omits is permanently absent on the Calendar
// surface no matter what the mapper carries. `utcOffsetMinutes` was omitted, so
// Calendar would have kept computing Open now / Closed on the VIEWER's clock
// even after #1683 widens the serving RPCs. 0 of the 19 live rows carry it.
//
// This asserts the RENDERED CONSEQUENCE, not the presence of a string in an
// array: it schedules a Lagos venue, reads the persisted row back through the
// mapper exactly as CalendarTab does, and asks `isPlaceOpenAt` the question the
// badge asks. A London viewer at 22:30 UTC would read OPEN; Lagos is 23:30 and
// CLOSED. If the offset does not survive the round-trip, the badge lies.

describe("#1669 H — a scheduled card keeps the venue's clock across the database", () => {
  it("H-1: utcOffsetMinutes survives CalendarService's allowlist, and the badge stays the venue's", async () => {
    jest.resetModules();
    const inserts: any[] = [];
    (globalThis as any).__DEV__ = false;
    jest.doMock("../../../services/supabase", () => ({
      supabase: {
        auth: { getSession: async () => ({ data: { session: null } }) },
        rpc: async () => ({ data: null, error: null }),
        from: () => ({
          insert: (payload: any) => {
            inserts.push(payload);
            return {
              select: () => ({
                single: async () => ({ data: { id: "row_1", ...payload }, error: null }),
              }),
            };
          },
        }),
      },
      trackedInvoke: jest.fn(),
    }));
    jest.doMock("../../../services/userActivityService", () => ({
      userActivityService: { recordActivity: jest.fn(async () => undefined) },
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CalendarService } = require("../../../services/calendarService");

    const card = savedCardToExpandedCardData(asSavedCard());
    assert.equal(
      card.utcOffsetMinutes,
      LAGOS_OFFSET_MINUTES,
      "vacuity guard: the mapper must carry the offset before we can ask whether persistence keeps it",
    );

    await CalendarService.addEntryFromSavedCard(
      "user_1",
      { ...card, source: "solo" },
      "2027-01-08T19:00:00.000Z",
    );
    const persisted = inserts[0].card_data;

    assert.equal(
      persisted.utcOffsetMinutes,
      LAGOS_OFFSET_MINUTES,
      "CalendarService.allowedCardFields dropped utcOffsetMinutes, so the row the Calendar reads back has no venue clock. Calendar would keep computing Open now / Closed on the VIEWER's device clock even after the serving RPCs start returning the offset (#1683) — because the row, not the RPC, is what that surface reads.",
    );

    // The rendered consequence, from the row and not from the card in memory.
    const reread = savedCardToExpandedCardData(persisted);
    const at2230Utc = new Date("2027-01-08T22:30:00.000Z");
    assert.equal(
      isPlaceOpenAt(
        extractWeekdayText(reread.openingHours),
        at2230Utc,
        reread.utcOffsetMinutes,
      ),
      false,
      "read back from the persisted row, the venue reads OPEN at 22:30 UTC. It is 23:30 in Lagos and the venue shut at 23:00 — this is the viewer's London clock answering a question about a Lagos venue.",
    );
  });
});
