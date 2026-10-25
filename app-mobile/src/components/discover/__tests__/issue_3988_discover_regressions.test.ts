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

// MINGLA-INVARIANT: I-3988-DISCOVER-NATIVE-ROUTES | issue #3988 | Every Mingla Discover card resolves to an existing canonical native public route rather than trusting retired feed route templates.
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

test("#3988 Discover restores an explicit two-column grid and removes the redundant hosts strip", () => {
  const screen = readFileSync(fileURLToPath(new URL("../../DiscoverScreen.tsx", import.meta.url)), "utf8");
  const discoverCard = readFileSync(fileURLToPath(new URL("../DiscoverCard.tsx", import.meta.url)), "utf8");

  assert.match(screen, /style=\{\[styles\.gridCell, \{ width: gridCellWidth \}\]\}/);
  assert.match(discoverCard, /card:\s*\{\s*width:\s*"100%"/);
  assert.doesNotMatch(screen, /section\.mingla/);
  assert.doesNotMatch(screen, /From Mingla hosts|Book in the app/);
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
