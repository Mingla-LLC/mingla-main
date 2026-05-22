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

// ORCH-0913-A: ScrollView moved up to wrap hero + action grid (full-page
// scroll parity with event dashboard). The actionGrid block is now followed
// directly by the KPI strip (no intervening <ScrollView>). Terminator marker
// updated accordingly.
const actionGrid = DASHBOARD_SRC.match(
  /<View style=\{styles\.actionGrid\}>([\s\S]*?)<\/View>\s*\n\s*<TripDetailKpiCard/,
)?.[1] ?? "";

const actionTileLabels = Array.from(
  actionGrid.matchAll(/label=(?:\{[^}]*\}|"([^"]+)")/g),
).map((match) => match[1] ?? "EDIT_LABEL");

describe("ORCH-0913 trip dashboard parity", () => {
  test("T-01 Dashboard renders zero tabs", () => {
    expect(DASHBOARD_SRC).not.toContain('accessibilityRole="tab"');
    expect(DASHBOARD_SRC).not.toMatch(/\bsetTab\b|\btab ===/);
  });

  test("T-02 Dashboard renders 7 action tiles in locked order", () => {
    expect(actionTileLabels).toEqual([
      "Travelers",
      "Money",
      "Blasts",
      "Group chat",
      "Public page",
      "Brand page",
      "EDIT_LABEL",
    ]);
  });

  test("T-03 Travelers tile sub uses singular/plural correctly", () => {
    expect(actionGrid).toContain('travelersCount === 1 ? "traveler" : "travelers"');
  });

  test("T-04 Money tile sub absent when zero at-risk", () => {
    expect(actionGrid).toContain(": undefined");
  });

  test("T-05 Money tile sub present when N at-risk", () => {
    expect(actionGrid).toContain('`${moneyData?.atRiskOrderCount} at risk`');
  });

  test("T-06 KPI strip renders directly beneath action grid", () => {
    // ORCH-0913-A: ScrollView now wraps hero + action grid + KPI + sections,
    // so the action grid's closing </View> is followed directly by
    // <TripDetailKpiCard> with no intervening <ScrollView>. Assertion still
    // pins KPI immediately after grid and PRICING TIERS after KPI.
    expect(DASHBOARD_SRC).toMatch(
      /<\/View>\s*<TripDetailKpiCard[\s\S]*?<Text style=\{styles\.sectionLabel\}>PRICING TIERS<\/Text>/,
    );
  });

  test("T-07 KPI strip Spots renders N / capacity when capacity set", () => {
    expect(DASHBOARD_SRC).toContain(
      "`${travelersCount} / ${trip.businessTrip.capacity}`",
    );
  });

  test("T-08 KPI strip Spots renders N when capacity null", () => {
    expect(DASHBOARD_SRC).toContain("`$ {travelersCount}`".replace(" ", ""));
  });

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

  test("T-17 Web textShadow uses CSS shorthand on Platform.OS=web", () => {
    expect(DASHBOARD_SRC).toContain('Platform.OS === "web"');
    expect(DASHBOARD_SRC).toContain('textShadow: "0 1px 4px rgba(0, 0, 0, 0.6)"');
    expect(DASHBOARD_SRC).toContain('textShadow: "0 1px 3px rgba(0, 0, 0, 0.5)"');
  });

  test("T-18 Mobile textShadow uses RN triple on native platforms", () => {
    expect(DASHBOARD_SRC).toContain('textShadowColor: "rgba(0, 0, 0, 0.6)"');
    expect(DASHBOARD_SRC).toContain("textShadowOffset: { width: 0, height: 1 }");
    expect(DASHBOARD_SRC).toContain("textShadowRadius: 4");
  });
});
