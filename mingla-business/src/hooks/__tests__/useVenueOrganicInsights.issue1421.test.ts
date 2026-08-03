import fs from "node:fs";
import path from "node:path";

describe("#1421 exact-venue organic query contract", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../useVenueOrganicInsights.ts"),
    "utf8",
  );

  it("keys the cache by both canonical IDs and gates on auth readiness", () => {
    expect(source).toContain(
      '["venue-organic-insights", brandId, venueId] as const',
    );
    expect(source).toContain(
      "const enabled = isAuthReady && brandId !== null && venueId !== null",
    );
  });

  it("retains last-good data only inside the same authorized scope", () => {
    expect(source).toContain("const STALE_TIME_MS = 60_000");
    expect(source).toContain("previous?.brandId === brandId");
    expect(source).toContain("previous.venueId === venueId");
    expect(source).toContain("? previous");
    expect(source).toContain("refetchOnWindowFocus: true");
  });
});
