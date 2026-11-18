/**
 * ORCH-0913 — trip dashboard parity happy-path regression tests T-01..T-18.
 *
 * These are structural source tests because rendering the dashboard pulls the
 * Expo Router + React Query + native media graph into node Jest. They pin the
 * dashboard contract that failed before ORCH-0913: no tabs, seven action
 * tiles, section-beneath layout, dedicated Travelers/Money routes, lifecycle
 * pill, and web-safe hero text shadows.
 *
 * Fails-on-revert baseline: HEAD before this implementation.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const DASHBOARD_SRC = readFileSync(join(__dirname, "..", "index.tsx"), "utf8");
const TRAVELERS_SRC = readFileSync(
  join(__dirname, "..", "travelers", "index.tsx"),
  "utf8",
);
const MONEY_SRC = readFileSync(
  join(__dirname, "..", "money", "index.tsx"),
  "utf8",
);
const HERO_PILL_SRC = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "src",
    "components",
    "trip",
    "TripDetailHeroStatusPill.tsx",
  ),
  "utf8",
);

function styleBlock(source: string, styleName: string): string {
  return source.match(new RegExp(`${styleName}: \\{[^}]*\\}`))?.[0] ?? "";
}

// [TEST-MOD-APPROVED #4420] TILE_MATRIX P10: the trip home renders its tiles
// through the shared <OfferingTilePage>; each tile (route, label, sub) is
// built as data between `const configTiles` and `const tripMoreTiles`. That
// block is the tile scope now (it holds no manage-menu / share / cancel press).
const TILE_START = DASHBOARD_SRC.indexOf("const configTiles");
const TILE_END = DASHBOARD_SRC.indexOf("const tripMoreTiles");
const actionGrid =
  TILE_START > -1 && TILE_END > TILE_START ? DASHBOARD_SRC.slice(TILE_START, TILE_END) : "";

describe("ORCH-0913 trip dashboard parity", () => {
  test("T-01 Dashboard renders zero tabs", () => {
    expect(DASHBOARD_SRC).not.toContain('accessibilityRole="tab"');
    expect(DASHBOARD_SRC).not.toMatch(/\bsetTab\b|\btab ===/);
  });

  // T-02 REMOVED [TEST-MOD-APPROVED ORCH-1062]: the locked 7-tile static order was
  // a stale source pin. META-ORCH-1059 Pass 2 made the tile set config-driven —
  // Edit is primary/first, then buildOfferingDashboardTiles("trip") emits the
  // Travelers(guests)/Blasts/Public/Brand/Scan/Orders tiles via a single
  // `label={tile.label}` map, then the static Payments + Group chat tiles. The
  // tile inventory, labels, order, and routes are now covered behaviorally by
  // src/components/offering/__tests__/offeringDashboardTiles.parity.test.ts. A
  // hard-coded label array over the index.tsx source can no longer model the
  // config-driven grid, so this pin is dropped (coverage lives in the config test).

  test("T-03 Travelers tile sub uses tickets-sold singular/plural correctly", () => {
    expect(actionGrid).toContain('ticketsSold === 1 ? "traveler" : "travelers"');
  });

  test("T-04 Money tile sub absent when zero at-risk", () => {
    expect(actionGrid).toContain(": undefined");
  });

  test("T-05 Money tile sub present when N at-risk", () => {
    expect(actionGrid).toContain('`${moneyData?.atRiskOrderCount} at risk`');
  });

  test("T-06 KPI strip renders directly beneath action grid", () => {
    // [TEST-MOD-APPROVED #4420] the tiles are <OfferingTilePage>; the money
    // summary sits above them on phone (in the aside on desktop) and the trip
    // KPI card then PRICING TIERS follow the tiles.
    expect(DASHBOARD_SRC).toMatch(
      /<OfferingTilePage[\s\S]*?core=\{tripCoreTiles\}[\s\S]*?\{tripKpiCard\}[\s\S]*?<Text style=\{styles\.sectionLabel\}>PRICING TIERS<\/Text>/,
    );
  });

  // T-07 + T-08 REMOVED [TEST-MOD-APPROVED ORCH-1062]: the KPI Spots derivation
  // (`${ticketsSold} / ${capacity}` when capacity set, `${ticketsSold}` when null)
  // moved out of index.tsx into the shared formatTripSpotsLabel() helper
  // (src/utils/tripDashboardDisplay.ts) and is now covered behaviorally by
  // src/utils/__tests__/tripDashboardDisplay.test.ts. These two source-text pins
  // referenced strings that no longer live in index.tsx — dropped as covered.

  test("T-09 Recent Activity 5-stream merge includes real timestamped streams", () => {
    expect(DASHBOARD_SRC).toContain('o.paymentStatus !== "paid"');
    expect(DASHBOARD_SRC).toContain('r.status === "collected"');
    expect(DASHBOARD_SRC).toContain('r.status === "failed"');
    expect(DASHBOARD_SRC).toMatch(/sort\(\(a, b\) => new Date\(b\.at\)/);
  });

  test("T-10 Recent Activity caps at 5 rows", () => {
    expect(DASHBOARD_SRC).toContain(".slice(0, 5)");
  });

  test("T-11 Recent Activity row omitted when timestamp missing", () => {
    expect(DASHBOARD_SRC).toContain("o.createdAt.length === 0) continue");
    expect(DASHBOARD_SRC).toContain('r.collectedAt !== null');
    expect(DASHBOARD_SRC).toContain('r.failedAt !== null');
  });

  test("T-12 Lifecycle status pill renders 4 states", () => {
    expect(HERO_PILL_SRC).toContain('"live" | "upcoming" | "past" | "cancelled"');
    expect(HERO_PILL_SRC).toContain('input.status === "cancelled"');
    expect(HERO_PILL_SRC).toContain('input.status === "ended"');
    expect(HERO_PILL_SRC).toContain("Live");
    expect(HERO_PILL_SRC).toContain("Upcoming");
    expect(HERO_PILL_SRC).toContain("Past");
    expect(HERO_PILL_SRC).toContain("Cancelled");
  });

  test("T-13 Cancel CTA renders last in ScrollView when gated true", () => {
    const scrollBody = DASHBOARD_SRC.match(
      /<ScrollView[\s\S]*?>([\s\S]*?)<\/ScrollView>/,
    )?.[1] ?? "";
    expect(scrollBody.lastIndexOf("trip-dashboard-cancel-cta")).toBeGreaterThan(
      scrollBody.lastIndexOf("RECENT ACTIVITY"),
    );
  });

  test("T-14 Cancel CTA hidden when status=ended", () => {
    expect(DASHBOARD_SRC).toContain('trip.status !== "ended"');
    expect(DASHBOARD_SRC).toContain('trip.status !== "cancelled"');
  });

  test("T-15 Travelers route renders existing list content", () => {
    expect(TRAVELERS_SRC).toContain("TravelerIntakeAnswerCard");
    expect(TRAVELERS_SRC).toContain("TravelerTierChip");
    expect(TRAVELERS_SRC).toContain(
      "No travelers yet. Share the trip link to start taking bookings.",
    );
  });

  test("T-16 Money route renders existing MoneyTabBody content", () => {
    expect(MONEY_SRC).toContain("All bookings");
    expect(MONEY_SRC).toContain("Installment {inst.ordinal}");
    expect(MONEY_SRC).toContain("RefundPreviewSheet");
    expect(MONEY_SRC).toContain("Retry now");
  });

  // T-17 + T-18 REMOVED [TEST-MOD-APPROVED #4420]: TILE_MATRIX P10 replaced the
  // 200pt photo hero (white title over the cover, which needed the text shadow)
  // with the compact <OfferingHomeHeader> card, whose title sits beside the
  // thumbnail on the card surface. No text is drawn over the photo any more.

  test("T-19 Dashboard width matches event detail: TopBar shell + single md gutter", () => {
    expect(DASHBOARD_SRC).toContain(
      'import { TopBar } from "../../../src/components/ui/TopBar"',
    );
    expect(DASHBOARD_SRC).toMatch(
      /<TopBar[\s\S]*?leftKind="back"[\s\S]*?title=\{trip\.title\}/,
    );

    // [TEST-MOD-APPROVED #4420] spacing.md (16) is now space[4] (16): same gutter.
    const bodyContent = styleBlock(DASHBOARD_SRC, "bodyContent");
    expect(bodyContent).toContain("paddingHorizontal: space[4]");
    expect(bodyContent).toContain("paddingTop: space[4]");
    expect(bodyContent).not.toContain("padding: space[6]");

    expect(styleBlock(DASHBOARD_SRC, "headerWrap")).toContain(
      "paddingHorizontal: space[4]",
    );
    expect(styleBlock(DASHBOARD_SRC, "hero")).not.toContain("marginHorizontal");
    expect(styleBlock(DASHBOARD_SRC, "actionGrid")).not.toContain(
      "paddingHorizontal",
    );
    expect(styleBlock(DASHBOARD_SRC, "cancelTripWrap")).not.toContain(
      "paddingHorizontal",
    );
  });
});
