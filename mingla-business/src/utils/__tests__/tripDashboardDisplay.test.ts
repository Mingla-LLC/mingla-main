import {
  formatTripHeroSubline,
  formatTripSpotsLabel,
  resolveTripTierSoldCount,
  tripDashboardBundleProofTestID,
} from "../tripDashboardDisplay";

describe("ORCH-0950 expanded dashboard display", () => {
  test("renders canonical UTC dates without shifting all-day trip dates", () => {
    expect(
      formatTripHeroSubline({
        startAt: "2026-08-17T00:00:00+00:00",
        endAt: "2026-08-22T23:59:59+00:00",
        destinationLocationText: null,
      }),
    ).toBe("Aug 17-22");
  });

  test("adds destination only after the canonical destination is re-entered", () => {
    expect(
      formatTripHeroSubline({
        startAt: "2026-08-17T00:00:00+00:00",
        endAt: "2026-08-22T23:59:59+00:00",
        destinationLocationText: "Washington DC, USA",
      }),
    ).toBe("Aug 17-22 · Washington DC, USA");
  });

  test("renders Spots from current tickets sold and canonical capacity", () => {
    expect(formatTripSpotsLabel(75, 102)).toBe("75 / 102");
    expect(formatTripSpotsLabel(75, null)).toBe("75");
  });

  test("keeps single-tier dashboard sold count coherent while per-tier RPC loads", () => {
    expect(
      resolveTripTierSoldCount({
        ticketTypeId: "tier-1",
        soldCountByTier: new Map(),
        tripTicketsSoldCount: 75,
        pricingTierCount: 1,
      }),
    ).toBe(75);
  });

  test("does not smear total sold count across multi-tier dashboards", () => {
    expect(
      resolveTripTierSoldCount({
        ticketTypeId: "tier-1",
        soldCountByTier: new Map(),
        tripTicketsSoldCount: 75,
        pricingTierCount: 2,
      }),
    ).toBe(0);
  });

  test("uses RPC per-tier value when available", () => {
    expect(
      resolveTripTierSoldCount({
        ticketTypeId: "tier-1",
        soldCountByTier: new Map([["tier-1", 75]]),
        tripTicketsSoldCount: 0,
        pricingTierCount: 1,
      }),
    ).toBe(75);
  });

  test("exposes a non-visible ORCH-0950 branch-bundle proof hook for iOS QA", () => {
    expect(tripDashboardBundleProofTestID("event-1")).toBe(
      "orch-0950-trip-dashboard-branch-bundle-event-1",
    );
  });
});
