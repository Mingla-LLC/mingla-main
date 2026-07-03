import { describe, expect, jest, test } from "@jest/globals";

/**
 * ORCH-1284 — the "Manage tax and registrations" CTA opened
 * `usemingla.com/connect-tax-registrations` (the marketing app, which 404s that
 * route) instead of `business.usemingla.com/connect-tax-registrations` (the
 * mingla-business web export, the ONLY surface that serves it). This regression
 * test pins the URL builder to the canonical business domain.
 *
 * Fails-on-revert: restoring the old `?? "https://usemingla.com"` fallback makes
 * every assertion below fail (origin becomes the marketing apex).
 */

// platformUrl.ts throws at module load unless the business web URL is set;
// provide the canonical production value via expo-constants extra — the exact
// pattern used by src/constants/__tests__/publicUrls.test.ts.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://business.usemingla.com",
      },
    },
  },
}));

// Keep the import hermetic: the hook pulls in expo-web-browser and the
// Supabase-backed service at module load; neither is needed to test the pure
// URL builder, and both are heavy/native under the node test env.
jest.mock("expo-web-browser", () => ({
  __esModule: true,
  openAuthSessionAsync: jest.fn(),
}));

jest.mock("../../services/brandStripeTaxAccountSessionService", () => ({
  __esModule: true,
  fetchBrandStripeTaxAccountSession: jest.fn(),
}));

import { taxToolsUrl } from "../useBrandStripeTaxAccountSession";

describe("ORCH-1284 — tax-registrations CTA targets business.usemingla.com, not the marketing apex", () => {
  // Synthetic values chosen with a slash + space so encoding is exercised.
  const result = {
    clientSecret: "cs_test_abc/123 secret",
    expiresAt: null,
    brandStripeAccountId: "acct_1XYZ",
  };

  test("origin is https://business.usemingla.com and path is /connect-tax-registrations", () => {
    const parsed = new URL(taxToolsUrl(result));
    expect(parsed.origin).toBe("https://business.usemingla.com");
    expect(parsed.host).toBe("business.usemingla.com");
    expect(parsed.pathname).toBe("/connect-tax-registrations");
  });

  test("never emits the marketing apex usemingla.com/connect-tax-registrations", () => {
    const url = taxToolsUrl(result);
    expect(
      url.startsWith("https://business.usemingla.com/connect-tax-registrations"),
    ).toBe(true);
    // The apex form (marketing 404) has `://usemingla.com/...`; the business
    // form has `://business.usemingla.com/...` and must never match this.
    expect(url).not.toContain("://usemingla.com/connect-tax-registrations");
  });

  test("carries both query params, correctly URL-encoded", () => {
    const url = taxToolsUrl(result);
    // Round-trip decode proves the params are present and correctly encoded.
    const parsed = new URL(url);
    expect(parsed.searchParams.get("clientSecret")).toBe(
      "cs_test_abc/123 secret",
    );
    expect(parsed.searchParams.get("brandStripeAccountId")).toBe("acct_1XYZ");
    // And the raw query is percent/form-encoded, not left literal.
    expect(url).toContain("clientSecret=cs_test_abc%2F123+secret");
    expect(url).toContain("brandStripeAccountId=acct_1XYZ");
  });
});
