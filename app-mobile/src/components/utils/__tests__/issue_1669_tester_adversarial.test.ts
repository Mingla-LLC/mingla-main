// @ts-nocheck — Jest globals follow the app-mobile test convention (see
// issue_1669_one_producer_parity.test.ts and holidayCardToExpandedCardData.test.ts
// in this same directory).
/**
 * Issue #1669 — TESTER ADVERSARIAL regression test.
 *
 *   npx jest --runInBand \
 *     src/components/utils/__tests__/issue_1669_tester_adversarial.test.ts
 *
 * A DIFFERENT ANGLE FROM THE IMPLEMENTOR'S TEST
 * ---------------------------------------------
 * The implementor's suite proves the deck and Likes AGREE about one place, and
 * its gate self-test proves a brand-new bypassing surface is caught. Neither
 * touches the three things this PR is actually most exposed on:
 *
 *   T1  The TWO producers deliberately NOT collapsed — Discover (a Ticketmaster
 *       event) and the Calendar reservation row (a venue shell built from a
 *       booking). The PR's defence is "both are capped at exactly one mint site
 *       each, so a sanctioned non-pool literal cannot become a back door for a
 *       second, pool-card one in the same file." That is a claim about the gate,
 *       and it is asserted nowhere. T1 runs the REAL gate against a REAL copy of
 *       the tree with a second, pool-card literal injected into each of those two
 *       files, and requires the gate to fail with an over-budget verdict. If
 *       anyone raises `sites` for either file, this test goes red.
 *
 *   T2  The three RENAME-AND-DELEGATE normalisers (chat, the friend page's
 *       holiday adapter, the friend page's fallback row). A rename is exactly
 *       where a field goes quietly missing, and "it delegates" is not the same
 *       claim as "it loses nothing". T2 asserts the strongest available form of
 *       that claim: each normaliser's output carries the SAME KEY SET as the
 *       canonical mapper's, so a field added to the mapper reaches every surface
 *       and a normaliser that forks back to a hand-written literal is caught the
 *       moment its key set drifts — no matter which field it drops.
 *
 *   T3  A card with GENUINELY ABSENT data flowing through the shared mapper.
 *       Constitution #9 is only interesting on the empty case.
 *
 *   T4  The PERSISTED calendar payload, driven through the REAL
 *       `CalendarService.addEntryFromSavedCard` (its `allowedCardFields`
 *       allowlist included) rather than a replica. Producer #4 wrote
 *       `rating || 4.5` and `travelTime || "15 min"` into `calendar_entries`,
 *       so this fabrication was persisted and read back as fact. A display-only
 *       assertion would not have caught it and would not catch its return.
 *
 * TZ is pinned so nothing here depends on the machine's clock.
 */

process.env.TZ = "Europe/London";
// `calendarService` guards its insert log with the React Native `__DEV__`
// global, which jest's node environment does not define.
(globalThis as any).__DEV__ = false;

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { savedCardToExpandedCardData } from "../savedCardToExpandedCardData";
import { recommendationToExpandedCardData } from "../recommendationToExpandedCardData";
import {
  holidayCardToExpandedCardData,
  fallbackCardToExpandedCardData,
} from "../holidayCardToExpandedCardData";
import { cardPayloadToExpandedCardData } from "../../../services/cardPayloadAdapter";
import { canonicalDiscoveryPriceDetail } from "../../../utils/priceTiers";

// `calendarService` reaches Supabase and the activity log at module load. Both
// are stubbed; the code under test — the allowlist that decides what is WRITTEN
// — is untouched by the stubs, and the insert stub is what captures the payload.
const capturedInserts: any[] = [];
jest.mock("../../../services/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      insert: (payload: any) => {
        capturedInserts.push(payload);
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
jest.mock("../../../services/userActivityService", () => ({
  userActivityService: { recordActivity: jest.fn(async () => undefined) },
}));
import { CalendarService } from "../../../services/calendarService";

// ── fixtures ────────────────────────────────────────────────────────────────

/** Server-owned canonical discovery price — the only thing that renders a pill. */
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

/**
 * A pool card with EVERY field the canonical mapper reads populated, and every
 * value distinct, so a normaliser that silently substitutes a default is caught
 * by value and not only by key.
 */
const RICH = {
  id: "place_terra_kulture",
  placeId: "ChIJ_terra_kulture",
  title: "Terra Kulture",
  category: "casual_food",
  categoryIcon: "utensils-crossed",
  description: "Lagos arts centre and restaurant",
  fullDescription: "Lagos arts centre and restaurant on Tiamiyu Savage.",
  image: "https://cdn.example/terra/0.jpg",
  images: ["https://cdn.example/terra/0.jpg", "https://cdn.example/terra/1.jpg"],
  rating: 4.2,
  reviewCount: 913,
  priceRange: "₦8,500 – ₦15,000",
  distance: "0.4 km",
  travelTime: "6 min",
  travelMode: "walking",
  address: "1376 Tiamiyu Savage St, Victoria Island, Lagos",
  openingHours: { weekdayDescriptions: ["Monday: 9:00 AM – 11:00 PM"] },
  utcOffsetMinutes: 60,
  website: "https://terrakulture.com",
  phone: "+2348039250018",
  highlights: ["Gallery", "Theatre"],
  tags: ["restaurant", "arts"],
  matchScore: 82,
  matchFactors: { location: 1, budget: 2, category: 3, time: 4, popularity: 5 },
  socialStats: { views: 11, likes: 22, saves: 33, shares: 44 },
  lat: 6.4281,
  lng: 3.4219,
  selectedDateTime: "2027-01-05T10:00:00.000Z",
  tip: { title: "Book the theatre night" },
  priceTier: "chill",
  ...PRICE,
};

const sortedKeys = (o: any) => Object.keys(o).sort();

// ── T1 · the two deliberately excluded producers stay capped ────────────────

describe("#1669 T1 — the two sanctioned non-pool mint sites cannot become back doors", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");
  const gateRel = "app-mobile/scripts/ci/issue-1669-expanded-card-one-producer.mjs";

  /**
   * A second, POOL-CARD literal — the exact thing the one-site budget exists to
   * refuse. It carries the required-field quartet the gate detects a mint by,
   * because `ExpandedCardData` makes all four mandatory.
   */
  const SECOND_POOL_CARD_LITERAL = `
export function issue1669TesterProbePoolCard(place: any) {
  return {
    id: place.id,
    placeId: place.placeId,
    title: place.title,
    category: place.category,
    categoryIcon: place.categoryIcon,
    description: place.description,
    fullDescription: place.description,
    image: place.image,
    images: [place.image],
    rating: place.rating ?? 0,
    reviewCount: 0,
    distance: null,
    address: place.address,
    highlights: [],
    tags: [],
    matchScore: 0,
    matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
  };
}
`;

  /** The two files the PR deliberately did NOT collapse, and why. */
  const SANCTIONED_NON_POOL_FILES = [
    {
      file: "app-mobile/src/components/DiscoverScreen.tsx",
      why: "Discover opens a Ticketmaster event, not a place-pool card.",
    },
    {
      file: "app-mobile/src/components/activity/CalendarTab.tsx",
      why: "The reservation row is a venue shell built from a booking row.",
    },
  ];

  let overlay: string;

  beforeAll(() => {
    // A real copy of everything the gate scans, so the gate under test is the
    // production gate reading production source — not a re-implementation of it.
    overlay = fs.mkdtempSync(path.join(os.tmpdir(), "issue1669-gate-"));
    fs.mkdirSync(path.join(overlay, "app-mobile/scripts/ci"), { recursive: true });
    for (const dir of ["src", "app"]) {
      fs.cpSync(
        path.join(repoRoot, "app-mobile", dir),
        path.join(overlay, "app-mobile", dir),
        { recursive: true },
      );
    }
    fs.copyFileSync(
      path.join(repoRoot, gateRel),
      path.join(overlay, gateRel),
    );
  });

  afterAll(() => {
    if (overlay) fs.rmSync(overlay, { recursive: true, force: true });
  });

  const runGate = () => {
    try {
      return {
        code: 0,
        out: execFileSync("node", [path.join(overlay, gateRel)], {
          encoding: "utf8",
        }),
      };
    } catch (e: any) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };

  it("T1-0 [vacuity guard]: the unmodified tree passes the gate, so T1-1's failure means something", () => {
    const { code, out } = runGate();
    assert.equal(
      code,
      0,
      `The gate does not pass on an unmodified copy of the tree, so nothing below is evidence.\n${out}`,
    );
  });

  for (const { file, why } of SANCTIONED_NON_POOL_FILES) {
    it(`T1-1: a SECOND, pool-card literal added to ${path.basename(file)} is rejected — ${why}`, () => {
      const abs = path.join(overlay, file);
      const original = fs.readFileSync(abs, "utf8");
      try {
        fs.writeFileSync(abs, original + SECOND_POOL_CARD_LITERAL);
        const { code, out } = runGate();
        assert.equal(
          code,
          1,
          `${file} minted a SECOND expanded-card shape and the gate still passed. The one-site budget is what stops a sanctioned non-pool literal being a licence for a pool-card one beside it — without it, the twelfth producer lands inside a file the registry already trusts.\n${out}`,
        );
        assert.match(
          out,
          /R3 .*minted only at registered sites/,
          `The gate failed, but not on R3 (the mint budget). ${file} is where the back door would be.\n${out}`,
        );
        assert.match(
          out,
          new RegExp(`Over budget:.*${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(2 > 1\\)`),
          `R3 did not report ${file} as over its declared one-site budget.\n${out}`,
        );
      } finally {
        fs.writeFileSync(abs, original);
      }
    });
  }

  it("T1-2: the budget for both sanctioned files is still exactly one site in the gate's registry", () => {
    const gateSource = fs.readFileSync(path.join(repoRoot, gateRel), "utf8");
    for (const { file } of SANCTIONED_NON_POOL_FILES) {
      const entry = new RegExp(
        `file:\\s*"${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*\\n\\s*sites:\\s*(\\d+)`,
      ).exec(gateSource);
      assert.ok(entry, `${file} is no longer registered in the gate's MINTS list.`);
      assert.equal(
        entry[1],
        "1",
        `${file} is budgeted for ${entry[1]} mint sites, not 1. Raising this budget is how a deliberately-excluded producer becomes a back door — the exclusion was only ever safe because the file is capped at the ONE non-pool literal it was sanctioned for.`,
      );
    }
  });
});

// ── T2 · rename-and-delegate loses nothing ──────────────────────────────────

describe("#1669 T2 — the rename-and-delegate normalisers carry every field the mapper carries", () => {
  const canonical = () => savedCardToExpandedCardData(RICH);

  /** Chat — a CardPayload, with the ORCH-0908 legacy `.card_data` nesting. */
  const asLegacyNestedCardPayload = () => ({
    id: RICH.id,
    title: RICH.title,
    category: RICH.category,
    image: RICH.image,
    // Everything else arrives nested, which is the shape the adapter's legacy
    // branch exists for. If the flattening regresses, the key set collapses.
    card_data: { ...RICH, location: { lat: RICH.lat, lng: RICH.lng } },
  });

  /** Friend page — a HolidayCard: different field NAMES, same place. */
  const asHolidayCard = () => ({
    id: RICH.id,
    title: RICH.title,
    category: RICH.category,
    categorySlug: "casual_food",
    imageUrl: RICH.image,
    rating: RICH.rating,
    priceLevel: null,
    address: RICH.address,
    googlePlaceId: RICH.placeId,
    lat: RICH.lat,
    lng: RICH.lng,
    priceTier: RICH.priceTier,
    priceRange: RICH.priceRange,
    description: RICH.description,
    cardType: "single",
    tagline: null,
    stops: 0,
    stopsData: null,
    totalPriceMin: null,
    totalPriceMax: null,
    website: RICH.website,
    estimatedDurationMinutes: null,
    experienceType: null,
    categories: null,
    shoppingList: null,
    ...PRICE,
  });

  /** Friend page — the category-fallback row that used to be producer #9. */
  const asFallbackCard = () => ({
    id: RICH.id,
    title: RICH.title,
    category: RICH.category,
    image: RICH.image,
    rating: RICH.rating,
    address: RICH.address,
    priceRange: RICH.priceRange,
  });

  it("T2-1: every normaliser emits the SAME key set as the canonical mapper — no field is lost in the rename", () => {
    const expected = sortedKeys(canonical());
    const produced = {
      "chat (cardPayloadToExpandedCardData)": cardPayloadToExpandedCardData(
        asLegacyNestedCardPayload(),
      ),
      "friend page — holiday (holidayCardToExpandedCardData)":
        holidayCardToExpandedCardData(asHolidayCard(), { travelMode: "walking" }),
      "friend page — fallback (fallbackCardToExpandedCardData)":
        fallbackCardToExpandedCardData(asFallbackCard(), { travelMode: "walking" }),
      "deck (recommendationToExpandedCardData)": recommendationToExpandedCardData(
        RICH,
        { selectedDateTime: new Date("2027-01-05T10:00:00.000Z") },
      ),
    };
    for (const [surface, card] of Object.entries(produced)) {
      const actual = sortedKeys(card);
      const missing = expected.filter((k) => !actual.includes(k));
      const extra = actual.filter((k) => !expected.includes(k));
      assert.deepEqual(
        { missing, extra },
        { missing: [], extra: [] },
        `${surface} does not emit the canonical mapper's key set. Missing: [${missing.join(", ")}]; extra: [${extra.join(", ")}]. A normaliser may rename a field on the way in; it may not decide which fields survive — that is the exact drift that produced eleven producers, and it is invisible to a test that only checks the fields it happens to remember.`,
      );
    }
  });

  it("T2-2: the chat normaliser's rename recovers every value from the legacy nested payload", () => {
    const chat = cardPayloadToExpandedCardData(asLegacyNestedCardPayload());
    // Fields the chat surface owns rather than inherits: the first three are
    // the SENDER's, which are meaningless to the recipient; `socialStats.shares`
    // is not carried in the payload; and `selectedDateTime` is derived from the
    // message's own scheduling metadata (`selectedDateTime` / `scheduled_at` at
    // the top level), asserted separately below.
    const chatOwned = new Set([
      "distance",
      "travelTime",
      "travelMode",
      "socialStats",
      "selectedDateTime",
    ]);
    const canon = canonical();
    for (const key of sortedKeys(canon)) {
      if (chatOwned.has(key)) continue;
      assert.deepEqual(
        chat[key],
        canon[key],
        `chat lost or changed \`${key}\` while flattening the legacy card_data payload: expected ${JSON.stringify(canon[key])}, got ${JSON.stringify(chat[key])}.`,
      );
    }
    assert.equal(chat.distance, null, "chat must not show the SENDER's distance");
    assert.equal(chat.travelTime, null, "chat must not show the SENDER's travel time");
    assert.equal(
      chat.socialStats.shares,
      0,
      "chat's share count is not carried in the payload and must not be invented",
    );
    // The two scheduling shapes chat genuinely receives (ORCH-0908).
    assert.deepEqual(
      cardPayloadToExpandedCardData({
        ...asLegacyNestedCardPayload(),
        selectedDateTime: "2027-01-05T10:00:00.000Z",
      }).selectedDateTime,
      new Date("2027-01-05T10:00:00.000Z"),
      "chat dropped the message's own selectedDateTime, which drives time-aware weather",
    );
    assert.deepEqual(
      cardPayloadToExpandedCardData({
        ...asLegacyNestedCardPayload(),
        scheduled_at: "2027-01-05T10:00:00.000Z",
      }).selectedDateTime,
      new Date("2027-01-05T10:00:00.000Z"),
      "chat dropped the ORCH-0908 snake_case scheduled_at, which drives the LockedInBanner's datetime",
    );
  });

  it("T2-3: the holiday normaliser's renamed fields land on the canonical keys", () => {
    const friend = holidayCardToExpandedCardData(asHolidayCard(), {
      travelMode: "walking",
    });
    assert.equal(friend.image, RICH.image, "imageUrl → image was dropped");
    assert.deepEqual(friend.images, [RICH.image], "imageUrl → images was dropped");
    assert.equal(friend.placeId, RICH.placeId, "googlePlaceId → placeId was dropped");
    assert.deepEqual(
      friend.location,
      { lat: RICH.lat, lng: RICH.lng },
      "flat lat/lng → location was dropped, and the modal gates weather, busyness and booking on card.location",
    );
    assert.equal(friend.website, RICH.website, "website was dropped");
    assert.equal(friend.priceTier, RICH.priceTier, "priceTier was dropped");
    assert.equal(friend.travelMode, "walking", "the caller's travel mode was dropped");
    assert.ok(
      canonicalDiscoveryPriceDetail(friend),
      "the canonical price fields did not survive the rename, so the friend page shows no price pill for a place that has a server price",
    );
  });

  it("T2-4: a curated holiday card is passed through whole, never rebuilt from an allowlist", () => {
    const stopsData = [
      { name: "Stop one", lat: 6.1, lng: 3.1, priceTier: "chill", note: "keep me" },
      { name: "Stop two", lat: 6.2, lng: 3.2, priceTier: "comfy", note: "keep me too" },
    ];
    const curated = holidayCardToExpandedCardData(
      {
        ...asHolidayCard(),
        cardType: "curated",
        stops: 2,
        stopsData,
        tagline: "A Lagos night",
        totalPriceMin: 8500,
        totalPriceMax: 15000,
        estimatedDurationMinutes: 210,
        experienceType: "romantic",
        shoppingList: ["blanket", "cooler"],
      },
      { travelMode: "walking" },
    );
    assert.equal(curated.cardType, "curated");
    assert.deepEqual(
      curated.stops,
      stopsData,
      "stopsData → stops lost a stop or a stop field. ORCH-1054 was exactly this: a curated plan rebuilt from a fixed allowlist instead of passed through.",
    );
    assert.equal(curated.estimatedDurationMinutes, 210);
    assert.deepEqual(curated.shoppingList, ["blanket", "cooler"]);
  });
});

// ── T3 · a card with genuinely absent data ──────────────────────────────────

describe("#1669 T3 — a card with genuinely absent data invents nothing", () => {
  /** The minimum a pool card can be: an id and a name, and nothing else known. */
  const EMPTY = { id: "place_unknown", title: "A place we know nothing about" };

  it("T3-1: nothing is fabricated on the way through the shared mapper", () => {
    const card = savedCardToExpandedCardData(EMPTY);
    assert.notEqual(card.rating, 4.5, "the 4.5-star fabrication is back");
    assert.notEqual(
      card.travelTime,
      "15 min",
      'the "15 min" travel-time fabrication is back',
    );
    assert.equal(card.travelTime, null, "an unknown travel time must be null, not invented");
    assert.equal(card.distance, null, "an unknown distance must be null, not invented");
    assert.equal(
      card.location,
      undefined,
      "a card with no coordinates must have no location — the modal gates weather, busyness and booking on it, and a substituted one renders the VIEWER's weather under the venue's name",
    );
    assert.equal(card.utcOffsetMinutes, null, "an unknown UTC offset must be null");
    assert.deepEqual(card.images, [], "no images means no images, not a placeholder");
    assert.equal(
      canonicalDiscoveryPriceDetail(card),
      null,
      "a place with no server price must render no price pill",
    );
  });

  it("T3-2: the same empty card is equally empty from every entry point", () => {
    const surfaces = {
      likes: savedCardToExpandedCardData(EMPTY),
      deck: recommendationToExpandedCardData(EMPTY),
      chat: cardPayloadToExpandedCardData(EMPTY),
      friendFallback: fallbackCardToExpandedCardData(
        { id: EMPTY.id, title: EMPTY.title, category: "", image: "", rating: undefined, address: "", priceRange: undefined },
        {},
      ),
    };
    for (const [surface, card] of Object.entries(surfaces)) {
      assert.notEqual(card.rating, 4.5, `${surface} fabricated a 4.5-star rating`);
      assert.notEqual(card.travelTime, "15 min", `${surface} fabricated a travel time`);
      assert.equal(card.location, undefined, `${surface} fabricated a location`);
      assert.equal(
        canonicalDiscoveryPriceDetail(card),
        null,
        `${surface} rendered a price pill for a place with no server price`,
      );
    }
  });
});

// ── T4 · the payload that is WRITTEN TO THE DATABASE ────────────────────────

describe("#1669 T4 — the scheduled calendar entry persists no fabricated fact", () => {
  beforeEach(() => {
    capturedInserts.length = 0;
  });

  /**
   * Producer #4 is the Likes → schedule payload. It is not display-only: it is
   * the `card_data` written to `calendar_entries`, which CalendarTab reads
   * straight back into the same modal. `rating || 4.5` and
   * `travelTime || "15 min"` were therefore stored as facts about the venue.
   *
   * This drives the REAL persistence path — `CalendarService`'s own
   * `allowedCardFields` allowlist included — so the assertion is about the row,
   * not about a replica of the row.
   */
  const scheduleUnratedPlace = async () => {
    const card = savedCardToExpandedCardData({
      id: "place_unrated_lagos",
      placeId: "ChIJ_unrated",
      title: "An unrated Lagos spot",
      category: "casual_food",
      address: "Victoria Island, Lagos",
      lat: 6.43,
      lng: 3.42,
      // No rating, no travel time — the exact case both fabrications fired on.
    });
    await CalendarService.addEntryFromSavedCard(
      "user_1",
      { ...card, source: "solo" },
      "2027-01-11T19:00:00.000Z",
    );
    return capturedInserts[0].card_data;
  };

  it("T4-1: an unrated place is not written to the database as a 4.5-star place", async () => {
    const persisted = await scheduleUnratedPlace();
    assert.notEqual(
      persisted.rating,
      4.5,
      "a fabricated 4.5-star rating was WRITTEN to calendar_entries.card_data. This is worse than a display bug: CalendarTab reads the row back into the same modal, so the invention becomes a durable fact about the venue that survives the fix.",
    );
  });

  it("T4-2: a place with no known travel time is not written as a 15-minute walk", async () => {
    const persisted = await scheduleUnratedPlace();
    assert.notEqual(
      persisted.travelTime,
      "15 min",
      'a fabricated "15 min" travel time was WRITTEN to calendar_entries.card_data.',
    );
  });

  it("T4-3: real values still round-trip into the row", async () => {
    const card = savedCardToExpandedCardData({
      ...RICH,
      travelTime: "6 min",
    });
    await CalendarService.addEntryFromSavedCard(
      "user_1",
      { ...card, source: "solo" },
      "2027-01-11T19:00:00.000Z",
    );
    const persisted = capturedInserts[0].card_data;
    assert.equal(persisted.rating, 4.2, "a real rating stopped being persisted");
    assert.equal(persisted.travelTime, "6 min", "a real travel time stopped being persisted");
    assert.equal(
      persisted.priceRangeStatus,
      "active",
      "the canonical price fields stopped being persisted, so the price pill would vanish when the row is read back",
    );
    assert.deepEqual(persisted.location, { lat: RICH.lat, lng: RICH.lng });
  });
});
