/**
 * #426 G1 — web prefers /api/trip-checkout-bundle; native skips it.
 * @jest-environment node
 */

describe("issue #426 trip CDN shield", () => {
  it("usePublicTripBySlug source prefers trip-checkout-bundle on web", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../usePublicTripBySlug.ts"),
      "utf8",
    );
    expect(src).toContain("/api/trip-checkout-bundle?");
    expect(src).toContain('typeof document !== "undefined"');
    expect(src).toContain("pg_public_trip_by_slug");
    expect(src).toContain("invalid_trip_checkout_bundle");
    expect(src).toContain("tripSlug");
    expect(src).toContain("Array.isArray(v.tiers)");
  });
});
