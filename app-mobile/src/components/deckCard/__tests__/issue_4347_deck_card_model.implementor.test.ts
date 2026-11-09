/**
 * #4347 wave 1 — the redesigned deck card's decisions, run against the REAL
 * pure producers (implementor happy path + the edges the state table names).
 *
 *   - photo pager: up to 6, video cover first, one per curated stop, the tap
 *     zones (30 / 40 / 30, nothing below the text column, nothing with < 2
 *     photos), clamped flips, failed-photo skipping, the top-card preload bound;
 *   - the fact line: open status first (open / closes soon / opens later /
 *     unknown = absent), then ★ rating (count), travel time, price; missing
 *     facts omitted, never faked;
 *   - the curated deck line and the host experience "From" price;
 *   - the one smart chip ("Closed when you arrive"), and its honesty rules;
 *   - the claimed-venue chunking that keeps the deck free of N+1 reads.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (each proven by deleting the fix line, see the issue):
 *   - drop the `photoCount < 2` early return in classifyDeckTap -> P-4 fails;
 *   - put the rating before the status in placeFactSpans -> F-1 fails;
 *   - drop `closing` (minutesLeft <= window) in getOpenStatusAt -> F-2 fails;
 *   - widen photosToPreload past PHOTO_PAGER.preloadAhead -> P-6 fails;
 *   - count all stops in curatedDeckSpans (sheet counts visible) -> C-1 fails.
 */
jest.mock("../../../services/currencyService", () => ({
  convertBetween: (amount: number) => amount,
  // 1 USD = 1,347.74 NGN, the snapshot on the issue.
  getServableRate: (code: string) => ({ USD: 1, NGN: 1347.74 } as Record<string, number>)[code] ?? null,
}));
jest.mock("../../../services/countryCurrencyService", () => ({
  currencySymbolMap: { USD: "$", NGN: "₦" },
}));
jest.mock("../../../utils/localeUtils", () => ({ getUserLocale: () => "en-US" }));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

import {
  classifyDeckTap,
  curatedDeckPhotos,
  curatedSmartChip,
  experienceDeckPhotos,
  nextLoadablePhotoIndex,
  pagerPresentation,
  photosToPreload,
  pickSmartChip,
  placeDeckPhotos,
  placeFactSpans,
  placeSmartChip,
  ratingText,
  routeLine,
  stepPhotoIndex,
  type DeckFactLabels,
} from "../deckCardModel";
import { getOpenStatusAt } from "../../../utils/openingHoursUtils";
import { curatedDeckSpans } from "../../expandedCard/expandedCardFacts";
import { claimedVenueChunks, toClaimedVenue } from "../../../hooks/useClaimedVenues";
import { formatClockMinute, formatExperienceWhen } from "../useDeckFactLabels";

const CI = require("../../../../../packages/card-identity/index.js");

const LABELS: DeckFactLabels = {
  openUntil: (time) => `Open until ${time}`,
  closesIn: (minutes) => `Closes in ${minutes} min`,
  opensAt: (time) => `Opens ${time}`,
  opensTomorrow: (time) => `Opens tomorrow ${time}`,
  opensOn: (day, time) => `Opens +${day} ${time}`,
  open24h: "Open 24 hours",
  clock: (minute) => formatClockMinute(minute, "en-US"),
};

// Monday 9 Nov 2026. Lagos is UTC+1, so 13:40Z is 14:40 at the venue.
const MON_1440 = new Date("2026-11-09T13:40:00Z");
const LAGOS = 60;
const HOURS = [
  "Monday: 12:00 PM – 11:00 PM",
  "Tuesday: 12:00 PM – 11:00 PM",
  "Wednesday: 12:00 PM – 11:00 PM",
  "Thursday: 12:00 PM – 11:00 PM",
  "Friday: 12:00 PM – 1:00 AM",
  "Saturday: 12:00 PM – 1:00 AM",
  "Sunday: Closed",
];
const at = (iso: string) => new Date(iso);
const texts = (spans: { text: string }[]) => spans.map((s) => s.text);

describe("#4347 photo pager", () => {
  test("P-1 a place pages its own media: video cover first, then stills, at most 6", () => {
    const images = [
      "https://cdn/v/cover.mp4",
      "https://cdn/1.jpg",
      "https://cdn/2.jpg",
      "https://cdn/2.jpg",
      "https://cdn/3.jpg",
      "https://cdn/4.jpg",
      "https://cdn/5.jpg",
      "https://cdn/6.jpg",
      "https://cdn/7.jpg",
      "",
    ];
    const photos = placeDeckPhotos({ image: "https://cdn/1.jpg", images });
    expect(photos.map((p) => p.uri)).toEqual([
      "https://cdn/v/cover.mp4",
      "https://cdn/1.jpg",
      "https://cdn/2.jpg",
      "https://cdn/3.jpg",
      "https://cdn/4.jpg",
      "https://cdn/5.jpg",
    ]);
    expect(photos.length).toBe(CI.PHOTO_PAGER.maxPhotos);
    expect(photos[0].isVideo).toBe(true);
    expect(placeDeckPhotos({ image: "", images: [] })).toEqual([]);
  });

  test("P-2 a curated plan pages ONE photo per stop and keeps the stop's number", () => {
    const photos = curatedDeckPhotos([
      { placeName: "Café Neo", imageUrl: "https://cdn/neo.jpg" },
      { placeName: "Nike Art Gallery", imageUrl: "" },
      { placeName: "Terra Kulture", imageUrls: ["", "https://cdn/terra.jpg"] },
    ]);
    expect(photos).toEqual([
      { uri: "https://cdn/neo.jpg", isVideo: false, stopNumber: 1, stopName: "Café Neo" },
      { uri: "https://cdn/terra.jpg", isVideo: false, stopNumber: 3, stopName: "Terra Kulture" },
    ]);
    const exp = experienceDeckPhotos("https://cdn/cover.jpg", [{ placeName: "A", imageUrl: "https://cdn/a.jpg" }]);
    expect(exp.map((p) => p.uri)).toEqual(["https://cdn/cover.jpg", "https://cdn/a.jpg"]);
  });

  test("P-3 the tap zones: left 30% back, right 30% forward, middle 40% opens", () => {
    const base = { width: 400, zoneBottomY: 500, photoCount: 4 };
    expect(classifyDeckTap({ ...base, x: 10, y: 100 })).toBe("prev");
    expect(classifyDeckTap({ ...base, x: 119, y: 100 })).toBe("prev");
    expect(classifyDeckTap({ ...base, x: 200, y: 100 })).toBe("open");
    expect(classifyDeckTap({ ...base, x: 281, y: 100 })).toBe("next");
    expect(classifyDeckTap({ ...base, x: 390, y: 100 })).toBe("next");
  });

  test("P-4 nothing flips below the text column, or on a card with one photo, or on bad input", () => {
    const base = { width: 400, zoneBottomY: 500, photoCount: 4 };
    expect(classifyDeckTap({ ...base, x: 10, y: 500 })).toBe("open");
    expect(classifyDeckTap({ ...base, x: 390, y: 700 })).toBe("open");
    expect(classifyDeckTap({ ...base, photoCount: 1, x: 10, y: 100 })).toBe("open");
    expect(classifyDeckTap({ ...base, photoCount: 0, x: 390, y: 100 })).toBe("open");
    expect(classifyDeckTap({ ...base, width: 0, x: 10, y: 100 })).toBe("open");
    expect(classifyDeckTap({ ...base, x: Number.NaN, y: 100 })).toBe("open");
  });

  test("P-5 flips clamp at both ends (no wrap), as the approved prototype does", () => {
    expect(stepPhotoIndex(0, 4, "prev")).toBe(0);
    expect(stepPhotoIndex(0, 4, "next")).toBe(1);
    expect(stepPhotoIndex(3, 4, "next")).toBe(3);
    expect(stepPhotoIndex(9, 4, "prev")).toBe(2);
    expect(stepPhotoIndex(0, 0, "next")).toBe(0);
  });

  test("P-6 the top card preloads the next 2 stills only, never a video", () => {
    const photos = placeDeckPhotos({
      image: "https://cdn/1.jpg",
      images: ["https://cdn/v.mp4", "https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg", "https://cdn/4.jpg"],
    });
    expect(CI.PHOTO_PAGER.preloadAhead).toBe(2);
    expect(photosToPreload(photos, 0)).toEqual(["https://cdn/1.jpg", "https://cdn/2.jpg"]);
    expect(photosToPreload(photos, 2)).toEqual(["https://cdn/3.jpg", "https://cdn/4.jpg"]);
    expect(photosToPreload(photos, 4)).toEqual([]);
  });

  test("P-7 a failed photo is skipped; when all fail the card has NO photo (neutral fill)", () => {
    const photos = placeDeckPhotos({ image: "a", images: ["a", "b", "c"] });
    expect(nextLoadablePhotoIndex(photos, 0, new Set(["a"]))).toBe(1);
    expect(nextLoadablePhotoIndex(photos, 2, new Set(["c"]))).toBe(1);
    expect(nextLoadablePhotoIndex(photos, 0, new Set(["a", "b", "c"]))).toBeNull();
    expect(pagerPresentation(photos, 0, new Set(["a"]))).toMatchObject({ hasPhoto: true, posterUri: "b" });
    expect(pagerPresentation(photos, 1, new Set(["a", "b", "c"]))).toEqual({
      photoIndex: 1,
      hasPhoto: false,
      posterUri: "",
      playVideoUri: null,
    });
    expect(pagerPresentation([], 0, new Set())).toMatchObject({ hasPhoto: false, posterUri: "" });
  });

  test("P-8 the video cover plays only on page 1; the poster under it is the first still", () => {
    const photos = placeDeckPhotos({ image: "s1", images: ["https://v/c.mp4", "s1", "s2"] });
    expect(pagerPresentation(photos, 0, new Set())).toEqual({
      photoIndex: 0,
      hasPhoto: true,
      posterUri: "s1",
      playVideoUri: "https://v/c.mp4",
    });
    expect(pagerPresentation(photos, 2, new Set())).toMatchObject({ posterUri: "s2", playVideoUri: null });
  });
});

describe("#4347 open status", () => {
  test("F-0 open, closes soon, opens later, opens tomorrow, unknown", () => {
    expect(getOpenStatusAt(HOURS, MON_1440, LAGOS)).toEqual({ kind: "open", closesAtMinute: 23 * 60, minutesLeft: 500 });
    // 22:30 Lagos = 21:30Z: 30 minutes left -> closing.
    expect(getOpenStatusAt(HOURS, at("2026-11-09T21:30:00Z"), LAGOS)).toEqual({
      kind: "closing",
      closesAtMinute: 23 * 60,
      minutesLeft: 30,
    });
    // 10:00 Lagos -> opens at noon today.
    expect(getOpenStatusAt(HOURS, at("2026-11-09T09:00:00Z"), LAGOS)).toEqual({
      kind: "closed",
      opensAtMinute: 12 * 60,
      opensDayOffset: 0,
    });
    // Sunday 14:00 Lagos (closed all day) -> Monday noon.
    expect(getOpenStatusAt(HOURS, at("2026-11-08T13:00:00Z"), LAGOS)).toEqual({
      kind: "closed",
      opensAtMinute: 12 * 60,
      opensDayOffset: 1,
    });
    // Saturday 00:30 Lagos is still Friday's late range (open until 1am).
    expect(getOpenStatusAt(HOURS, at("2026-11-13T23:30:00Z"), LAGOS)).toMatchObject({ kind: "closing", closesAtMinute: 60 });
    expect(getOpenStatusAt(null, MON_1440, LAGOS)).toBeNull();
    expect(getOpenStatusAt(["Monday: whenever"], MON_1440, LAGOS)).toBeNull();
    const allDay = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: Open 24 hours`);
    expect(getOpenStatusAt(allDay, MON_1440, LAGOS)).toEqual({ kind: "open24h" });
  });
});

describe("#4347 fact line", () => {
  const PLACE = {
    openingHours: { weekdayDescriptions: HOURS },
    utcOffsetMinutes: LAGOS,
    rating: 4.6,
    reviewCount: 212,
    travelTime: "12 min",
    distanceLabel: "3.4 mi",
    priceRange: "≈ $19–30",
  };

  test("F-1 the approved order: status, ★ rating (count), travel time, price", () => {
    const spans = placeFactSpans(PLACE, MON_1440, LABELS);
    expect(texts(spans)).toEqual(["Open until 11pm", "★ 4.6 (212)", "12 min", "≈ $19–30"]);
    expect(spans.map((s) => s.kind)).toEqual(["statusOpen", "rating", "fact", "fact"]);
  });

  test("F-2 amber within 60 min of closing; grey when closed; the window comes from the package", () => {
    expect(CI.FACT_LINE.closingSoonMinutes).toBe(60);
    const closing = placeFactSpans(PLACE, at("2026-11-09T21:30:00Z"), LABELS)[0];
    expect(closing).toEqual({ kind: "statusClosing", text: "Closes in 30 min" });
    const closed = placeFactSpans(PLACE, at("2026-11-09T09:00:00Z"), LABELS)[0];
    expect(closed).toEqual({ kind: "statusClosed", text: "Opens 12pm" });
  });

  test("F-3 missing facts are left out, never faked — hours unknown shows no status", () => {
    expect(texts(placeFactSpans({ ...PLACE, openingHours: null }, MON_1440, LABELS))).toEqual([
      "★ 4.6 (212)",
      "12 min",
      "≈ $19–30",
    ]);
    expect(texts(placeFactSpans({ ...PLACE, reviewCount: 0 }, MON_1440, LABELS))[1]).toBe("★ 4.6");
    expect(texts(placeFactSpans({ ...PLACE, rating: 0, travelTime: " ", priceRange: "" }, MON_1440, LABELS))).toEqual([
      "Open until 11pm",
      "3.4 mi",
    ]);
    expect(placeFactSpans({}, MON_1440, LABELS)).toEqual([]);
    expect(ratingText(4.55, 12_400)).toBe("★ 4.5 (12K)");
    expect(ratingText(null, 10)).toBeNull();
  });

  test("F-4 'Free' is the place's own price string, shown as given", () => {
    expect(texts(placeFactSpans({ priceRange: "Free" }, MON_1440, LABELS))).toEqual(["Free"]);
  });

  test("F-5 clock and experience date read like the design", () => {
    expect(formatClockMinute(23 * 60, "en-US")).toBe("11pm");
    expect(formatClockMinute(9 * 60 + 30, "en-US")).toBe("9:30am");
    expect(formatExperienceWhen("2026-11-14T17:00:00Z", "Africa/Lagos", "en-US")).toBe("Sat, Nov 14, 6pm");
    // A 24-hour locale keeps its own clock.
    expect(formatExperienceWhen("2026-11-14T17:00:00Z", "Africa/Lagos", "en-GB")).toBe("Sat 14 Nov, 18:00");
    expect(formatClockMinute(18 * 60, "de")).toBe("18:00");
    expect(formatExperienceWhen("not a date", "Africa/Lagos", "en-GB")).toBeNull();
    expect(formatExperienceWhen(null, "Africa/Lagos", "en-GB")).toBeNull();
  });
});

describe("#4347 curated deck line", () => {
  const OPTS = {
    spendLevelLabel: (level: string) => `level:${level}`,
    freeLabel: "Free",
    stopCountLabel: (n: number) => `${n} stops`,
    awayLabel: (m: number) => `${m} min away`,
  };
  const PLAN = {
    estimatedDurationMinutes: 210,
    stops: [
      { optional: false, priceMin: 0, priceMax: 50, travelTimeFromUserMin: 8 },
      { optional: false, priceMin: 50, priceMax: 120 },
      { optional: false, priceMin: 0, priceMax: 0 },
      { optional: true, priceMin: 400, priceMax: 500 },
    ],
  } as never;

  test("C-1 N stops · duration · N min away · spend level; the count is the sheet's (visible stops)", () => {
    expect(texts(curatedDeckSpans(PLAN, OPTS))).toEqual(["3 stops", "3h 30m", "8 min away", "level:moderate"]);
  });

  test("C-2 a host experience prints no spend level (its price is the plate's From pill)", () => {
    expect(texts(curatedDeckSpans(PLAN, { ...OPTS, isBrandExperience: true }))).toEqual(["3 stops", "3h 30m", "8 min away"]);
  });

  test("C-3 no location, no travel; no stops, no count", () => {
    const noGps = { ...(PLAN as object), stops: [{ optional: false, priceMin: 0, priceMax: 0 }] } as never;
    expect(texts(curatedDeckSpans(noGps, OPTS))).toEqual(["1 stops", "3h 30m", "Free"]);
    expect(texts(curatedDeckSpans({ estimatedDurationMinutes: 0, stops: [] } as never, OPTS))).toEqual([]);
  });

  test("C-4 the route line names the stops in order; one stop is not a route", () => {
    expect(routeLine([{ placeName: "Café Neo" }, { placeName: "Nike Art" }, { placeName: "Terra" }])).toBe(
      "Café Neo → Nike Art → Terra",
    );
    expect(routeLine([{ placeName: "Café Neo" }])).toBeNull();
  });
});

describe("#4347 smart chip", () => {
  test("S-1 'Closed when you arrive' fires only when open now AND closed at now + travel", () => {
    const late = at("2026-11-09T21:40:00Z"); // 22:40 Lagos, closes 23:00
    const card = { openingHours: HOURS, utcOffsetMinutes: LAGOS, travelTime: "25 min" };
    expect(placeSmartChip(card, late)).toEqual({ kind: "closedAtArrival", tone: "warn" });
    expect(placeSmartChip({ ...card, travelTime: "10 min" }, late)).toBeNull();
    expect(placeSmartChip({ ...card, travelTime: null }, late)).toBeNull();
    expect(placeSmartChip({ ...card, openingHours: null }, late)).toBeNull();
    // Already closed is the fact line's job ("Opens 12pm"), not a chip.
    expect(placeSmartChip(card, at("2026-11-09T09:00:00Z"))).toBeNull();
  });

  test("S-2 a curated stop closed at its arrival time names the stop; unknown hours never fire", () => {
    const start = at("2026-11-09T21:00:00Z"); // 22:00 Lagos
    const stops = [
      { openingHours: HOURS, utcOffsetMinutes: LAGOS, estimatedDurationMinutes: 45, travelTimeFromUserMin: 5 },
      { openingHours: HOURS, utcOffsetMinutes: LAGOS, estimatedDurationMinutes: 60, travelTimeFromPreviousStopMin: 10 },
    ];
    expect(curatedSmartChip(stops, start)).toEqual({ kind: "stopClosedAtArrival", stopNumber: 2, tone: "warn" });
    expect(curatedSmartChip(stops.map((s) => ({ ...s, openingHours: null })), start)).toBeNull();
    expect(curatedSmartChip(stops, at("2026-11-09T12:00:00Z"))).toBeNull();
  });

  test("S-3 at most ONE chip, by priority", () => {
    expect(
      pickSmartChip([
        { kind: "quieterLater", tone: "info" },
        null,
        { kind: "closedAtArrival", tone: "warn" },
        { kind: "rainOutdoor", tone: "warn" },
      ]),
    ).toEqual({ kind: "closedAtArrival", tone: "warn" });
    expect(pickSmartChip([null, null])).toBeNull();
  });
});

describe("#4347 claimed venues", () => {
  test("V-1 the deck's place ids are read in fixed chunks of 50 — never one read per card", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const chunks = claimedVenueChunks([...ids, ids[0], null, "not-a-uuid", undefined]);
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(new Set(chunks.flat()).size).toBe(120);
  });

  test("V-2 only a row with both slugs is a venue the deck can route to", () => {
    expect(
      toClaimedVenue({ place_pool_id: "p", slug: "itan-garden", brand_slug: "itan-kitchen", brand_name: "Ìtàn Kitchen" }),
    ).toEqual({ placePoolId: "p", brandSlug: "itan-kitchen", venueSlug: "itan-garden", brandName: "Ìtàn Kitchen" });
    expect(toClaimedVenue({ place_pool_id: "p", slug: "", brand_slug: "b", brand_name: null })).toBeNull();
    expect(toClaimedVenue({ place_pool_id: null, slug: "v", brand_slug: "b", brand_name: null })).toBeNull();
  });
});

describe("#4347 claimed venue routing (wiring)", () => {
  test("V-3 the deck opens a claimed venue's public page INSTEAD of the pool sheet", () => {
    const fs = require("fs");
    const path = require("path");
    const src: string = fs.readFileSync(path.join(__dirname, "../../SwipeableCards.tsx"), "utf8");
    const fn = src.slice(src.indexOf("const handleCardExpand = async () => {"), src.indexOf("const handleCloseExpandedModal"));
    const route = fn.indexOf("router.push(\n        `/b/${encodeURIComponent(currentClaimedVenue.brandSlug)}/v/${encodeURIComponent(currentClaimedVenue.venueSlug)}`");
    const sheet = fn.indexOf("setIsExpandedModalVisible(true)");
    expect(route).toBeGreaterThan(0);
    expect(sheet).toBeGreaterThan(route);
    expect(fn.slice(route, sheet)).toMatch(/return;/);
    // The chip and the route read the SAME lookup, from the batched hook.
    expect(src).toMatch(/const claimedVenues = useClaimedVenues\(/);
    expect(src).toMatch(/currentClaimedVenue \?\s*\(\s*<HostChip/);
  });
});

