import fs from "node:fs";
import path from "node:path";
import { venueOrderMetricsKeys } from "../useVenueOrderMetrics";

describe("#1795 one venue-order query owner", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../useVenueOrderMetrics.ts"),
    "utf8",
  );

  it("owns the exact canonical key and the auth/scope enable gate", () => {
    expect(source).toContain('["venue-order-metrics"] as const');
    expect(source).toContain('["venue-order-metrics", brandId, venueId] as const');
    expect(source).toContain(
      "const enabled = isAuthReady && brandId !== null && venueId !== null",
    );
    expect(source).toContain("staleTime: STALE_TIME_MS");
  });

  it("uses the same factory for the per-venue to-do fan-out", () => {
    expect(source).toContain(
      "queryKey: venueOrderMetricsKeys.detail(scope.brandId, scope.venueId)",
    );
    expect(source.match(/fetchVenueOrderMetrics/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("changes the cache identity for every brand/venue scope", () => {
    expect(venueOrderMetricsKeys.all).toEqual(["venue-order-metrics"]);
    expect(venueOrderMetricsKeys.detail("brand-a", "venue-a")).toEqual([
      "venue-order-metrics",
      "brand-a",
      "venue-a",
    ]);
    expect(venueOrderMetricsKeys.detail("brand-a", "venue-a")).not.toEqual(
      venueOrderMetricsKeys.detail("brand-a", "venue-b"),
    );
    expect(venueOrderMetricsKeys.detail("brand-a", "venue-a")).not.toEqual(
      venueOrderMetricsKeys.detail("brand-b", "venue-a"),
    );
  });
});
