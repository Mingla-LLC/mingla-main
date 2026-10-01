/**
 * #3645 — picking Nigeria on BrandOnboardView must invoke select_provider
 * (via useSelectPaystackProvider) so payout_hold_cutover_at is stamped without
 * requiring bank details.
 *
 * Append-only source guard. Fails on revert: drop the useSelectPaystackProvider
 * import or the mutate call inside the NG branch of handleCountryChange.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_ng_select_provider.source.test.ts --runInBand
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(
  join(__dirname, "..", "BrandOnboardView.tsx"),
  "utf8",
);

describe("#3645 — NG country pick stamps hold cutover via select_provider", () => {
  it("imports useSelectPaystackProvider from useBrandPaystack", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*useSelectPaystackProvider\s*\}\s*from\s*["'][^"']*hooks\/useBrandPaystack["']/,
    );
  });

  it("handleCountryChange NG branch calls selectPaystackProvider.mutate", () => {
    const start = SRC.indexOf("const handleCountryChange");
    expect(start).toBeGreaterThanOrEqual(0);
    const region = SRC.slice(start, start + 900);
    expect(region).toContain('countryCode === "NG"');
    expect(region).toMatch(/selectPaystackProvider\.mutate\s*\(/);
  });
});
