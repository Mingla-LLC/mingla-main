// @ts-nocheck — Node strip-types suite; app-mobile's tsc sweep does not enable
// allowImportingTsExtensions, while the registered test command executes it directly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalDiscoverCardPath } from "../discoverCardRoute.ts";
import {
  DISCOVER_GRID_GAP,
  DISCOVER_GRID_SIDE_PADDING,
  discoverGridCellWidth,
} from "../discoverGridLayout.ts";
import { dedupeDiscoverFeedCards } from "../../../utils/discoverFeedDedupe.ts";

// MINGLA-INVARIANT: I-3988-DISCOVER-NATIVE-ROUTES | issue #3988 | Every Mingla Discover card resolves to an existing canonical native public route rather than trusting feed-provided route templates.
function card(kind: "event" | "rsvp" | "experience" | "trip" | "stay", params: Record<string, string> = { slug: "night out" }) {
  return {
    source: "mingla",
    kind,
    id: "offering-3988",
    brand: { id: "brand-3988", slug: "seth & friends", name: "Seth & Friends", photoUrl: null },
    title: "A night out",
    coverUrl: null,
    coverType: null,
    coverHue: 24,
    startsAtUtc: null,
    endsAtUtc: null,
    timezone: "Africa/Lagos",
    meta: { venueOrPlace: "Lagos" },
    price: null,
    route: { pathname: "/retired/[slug]", params },
  } as const;
}

test("#3988 Discover cards resolve every Mingla offering to a canonical native public route", () => {
  assert.equal(canonicalDiscoverCardPath(card("event")), "/e/seth%20%26%20friends/night%20out");
  assert.equal(canonicalDiscoverCardPath(card("rsvp")), "/e/seth%20%26%20friends/night%20out");
  assert.equal(canonicalDiscoverCardPath(card("experience", { experienceSlug: "city-food" })), "/exp/seth%20%26%20friends/city-food");
  assert.equal(canonicalDiscoverCardPath(card("trip", { tripSlug: "weekend-away" })), "/t/seth%20%26%20friends/weekend-away");
  assert.equal(canonicalDiscoverCardPath(card("stay", { venueSlug: "the-loft" })), "/b/seth%20%26%20friends/v/the-loft");
  assert.equal(canonicalDiscoverCardPath({ ...card("event"), brand: { ...card("event").brand, slug: " " } }), null);
});

test("#3988 Discover is one uninterrupted two-column feed without source section gaps", () => {
  const screen = readFileSync(fileURLToPath(new URL("../../DiscoverScreen.tsx", import.meta.url)), "utf8");
  const discoverCard = readFileSync(fileURLToPath(new URL("../DiscoverCard.tsx", import.meta.url)), "utf8");

  assert.match(screen, /style=\{\[styles\.gridCell, \{ width: gridCellWidth \}\]\}/);
  assert.match(discoverCard, /card:\s*\{\s*width:\s*"100%"/);
  assert.doesNotMatch(screen, /section\.mingla/);
  assert.doesNotMatch(screen, /section\.tm/);
  assert.doesNotMatch(screen, /From Mingla hosts|Book in the app/);
  assert.doesNotMatch(screen, /More events nearby/);
  assert.doesNotMatch(screen, /styles\.(?:divider|tmHeading)/);
  assert.match(screen, /items\.map\(\(card\) =>/);
});

test("#3988 Discover shows one Ticketmaster card per named event", () => {
  const cards = [
    { source: "ticketmaster", kind: "event", id: "tm-early", title: "Curtain Call From Beyond", venueName: "City Theatre", startsLocalDate: "2026-10-25", startsLocalTime: "18:30:00" },
    { source: "ticketmaster", kind: "event", id: "tm-later", title: "  CURTAIN   CALL FROM BEYOND  ", venueName: " CITY   THEATRE ", startsLocalDate: "2026-10-26", startsLocalTime: "19:00:00" },
    { source: "ticketmaster", kind: "event", id: "tm-other-venue", title: "Curtain Call From Beyond", venueName: "Grand Theatre", startsLocalDate: "2026-10-26", startsLocalTime: "20:00:00" },
    { source: "ticketmaster", kind: "event", id: "tm-accessible", title: "Accessible Curtain Call From Beyond", venueName: "City Theatre", startsLocalDate: "2026-10-25", startsLocalTime: "19:00:00" },
    { ...card("event"), id: "mingla-1", title: "Curtain Call From Beyond" },
  ] as any[];

  assert.deepEqual(
    dedupeDiscoverFeedCards(cards).map((item) => item.id),
    ["tm-early", "tm-other-venue", "tm-accessible", "mingla-1"],
  );
  const queryKeys = readFileSync(
    fileURLToPath(new URL("../../../hooks/discoverQueryKeys.ts", import.meta.url)),
    "utf8",
  );
  assert.match(queryKeys, /DISCOVER_OCCURRENCE_CATALOG_VERSION\s*=\s*2/);
  assert.match(queryKeys, /'feed',\s*DISCOVER_OCCURRENCE_CATALOG_VERSION/);
});

test("#3988 Discover exposes distinct progress treatments at both feed edges", () => {
  const screen = readFileSync(
    fileURLToPath(new URL("../../DiscoverScreen.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(screen, /const \[isPullRefreshing, setIsPullRefreshing\] = useState\(false\)/);
  assert.match(screen, /const refresh = useCallback\(async \(\) => \{[\s\S]{0,360}setIsPullRefreshing\(true\)[\s\S]{0,360}await queryClient\.invalidateQueries[\s\S]{0,360}setIsPullRefreshing\(false\)/);
  assert.match(screen, /<RefreshControl refreshing=\{isPullRefreshing\}[\s\S]{0,360}Refreshing events/);
  assert.match(screen, /feed\.isFetchingNextPage \? \([\s\S]{0,360}<ActivityIndicator/);
  assert.match(screen, /accessibilityRole="progressbar"/);
  assert.match(screen, /Loading more events/);
});

test("#3988 defaults to device city while manual search stays global", () => {
  const screen = readFileSync(
    fileURLToPath(new URL("../../DiscoverScreen.tsx", import.meta.url)),
    "utf8",
  );
  const picker = readFileSync(
    fileURLToPath(new URL("../CityPickerSheet.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(screen, /const location = useUserLocation\(user\?\.id, "solo"\)/);
  assert.match(screen, /geocodingService\.reverseGeocode\(lat, lng\)/);
  assert.match(screen, /if \(city \|\| typeof location\.data\?\.lat/);
  assert.match(picker, /searchMode="places"/);
  assert.match(picker, /suggestLimit=\{8\}/);
  assert.doesNotMatch(picker, /proximity=\{/);
});

test("#3988 two Discover columns plus their gap fit narrow viewports", () => {
  for (const viewportWidth of [240, 280, 320, 375, 430]) {
    const cellWidth = discoverGridCellWidth(viewportWidth);
    const contentWidth = viewportWidth - DISCOVER_GRID_SIDE_PADDING * 2;

    assert.ok(cellWidth > 0, `${viewportWidth}dp must retain visible cards`);
    assert.ok(
      cellWidth * 2 + DISCOVER_GRID_GAP <= contentWidth,
      `${viewportWidth}dp must fit two cards and the gap without wrapping`,
    );
  }
});

// MINGLA-INVARIANT: I-3988-NATIVE-PUBLIC-PAGES-NO-WEB-CHUNKS | issue #3988 | Native public offering details render shared sections synchronously from the Metro bundle without browser-style chunk resolution.
test("#3988 native public offering pages never cross a web-style lazy chunk boundary", () => {
  const nativeBoundary = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../packages/offering-rendering/LazyOfferingRefundLadder.native.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  assert.doesNotMatch(nativeBoundary, /React\.lazy|import\s*\(/);
  assert.match(nativeBoundary, /<OfferingRefundLadderModule\.OfferingRefundLadder/);
  assert.match(nativeBoundary, /<FollowerCountLine/);
  assert.match(nativeBoundary, /<SaleAvailabilityText/);
});
