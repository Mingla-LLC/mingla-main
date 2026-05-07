/**
 * Unit tests for deriveBrandStripeStatus TS twin.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md SC-12 + T-14.
 *
 * Covers 12+ cases mirroring the SQL pg_derive_brand_stripe_status CASE branches.
 * Both functions MUST return same output for same input — verified via this
 * test + a lighter SQL probe at IMPL Phase 1 deploy verification.
 */

import { describe, expect, test } from "@jest/globals";
import { deriveBrandStripeStatus } from "../deriveBrandStripeStatus";

describe("deriveBrandStripeStatus", () => {
  // -------------------------------------------------------------------------
  // not_connected branch
  // -------------------------------------------------------------------------

  test("no account → not_connected", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: false,
        charges_enabled: null,
        payouts_enabled: null,
        requirements: null,
        detached_at: null,
      }),
    ).toBe("not_connected");
  });

  test("no account, all flags true → not_connected (gated by has_account)", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: false,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: null,
        detached_at: null,
      }),
    ).toBe("not_connected");
  });

  test("has account, detached_at set → not_connected", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: null,
        detached_at: "2026-05-06T12:00:00Z",
      }),
    ).toBe("not_connected");
  });

  // -------------------------------------------------------------------------
  // restricted branch
  // -------------------------------------------------------------------------

  test("has account, requirements.disabled_reason set → restricted", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { disabled_reason: "requirements.past_due" },
        detached_at: null,
      }),
    ).toBe("restricted");
  });

  test("restricted overrides charges_enabled (rare edge case)", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { disabled_reason: "rejected.fraud" },
        detached_at: null,
      }),
    ).toBe("restricted");
  });

  // -------------------------------------------------------------------------
  // active branch
  // -------------------------------------------------------------------------

  test("has account, charges_enabled=true, no requirements → active", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: null,
        detached_at: null,
      }),
    ).toBe("active");
  });

  test("active when charges_enabled=true, payouts_enabled=false (D-B2-12 — payouts not gating)", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: true,
        payouts_enabled: false,
        requirements: null,
        detached_at: null,
      }),
    ).toBe("active");
  });

  test("active when requirements present but disabled_reason missing", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { disabled_reason: null },
        detached_at: null,
      }),
    ).toBe("active");
  });

  // -------------------------------------------------------------------------
  // onboarding branch (fallthrough)
  // -------------------------------------------------------------------------

  test("has account, charges_enabled=false, no requirements → onboarding", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: null,
        detached_at: null,
      }),
    ).toBe("onboarding");
  });

  test("onboarding when both flags false + requirements empty object", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {},
        detached_at: null,
      }),
    ).toBe("onboarding");
  });

  test("onboarding when charges_enabled=null", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: null,
        payouts_enabled: false,
        requirements: null,
        detached_at: null,
      }),
    ).toBe("onboarding");
  });

  // -------------------------------------------------------------------------
  // Cache-shape fallback (requirements + detached_at undefined per cache layer)
  // -------------------------------------------------------------------------

  test("cache-only inputs (requirements + detached_at undefined) → active when charges_enabled=true", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: true,
        payouts_enabled: true,
        // requirements undefined (mapBrandRowToUi can't pass it from cache)
        // detached_at undefined (cache doesn't carry)
      }),
    ).toBe("active");
  });

  test("cache-only inputs → onboarding when charges_enabled=false", () => {
    expect(
      deriveBrandStripeStatus({
        has_account: true,
        charges_enabled: false,
        payouts_enabled: false,
      }),
    ).toBe("onboarding");
  });
});
