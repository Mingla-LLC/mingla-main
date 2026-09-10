/**
 * #426 G1 — getPublicExperienceBySlug prefers experience-checkout-bundle on web.
 * @jest-environment node
 */

describe("issue #426 experience CDN shield", () => {
  it("publicExperienceService source prefers experience-checkout-bundle on web", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../publicExperienceService.ts"),
      "utf8",
    );
    expect(src).toContain("/api/experience-checkout-bundle?");
    expect(src).toContain('typeof document !== "undefined"');
    expect(src).toContain("pg_public_experience_by_slug");
    expect(src).toContain("invalid_experience_checkout_bundle");
    expect(src).toContain("experienceSlug");
    expect(src).toContain("Array.isArray(v.stops)");
  });
});
