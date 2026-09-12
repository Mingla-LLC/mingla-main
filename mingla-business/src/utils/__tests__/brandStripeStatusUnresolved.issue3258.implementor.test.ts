/**
 * Issue #3258 (review follow-up) — the red "Action required" card rendered
 * FIRST, on every cold open, before anyone knew whether action was required.
 *
 * WHAT WAS STILL WRONG AFTER THE FIRST CUT
 *
 * `BrandPaymentsView` derives `stripeStatus` from the LIVE query with a
 * fallback to the CACHED `brand.stripeStatus`, but `requirements` come ONLY
 * from the live query (`useBrandStripeStatus` has no `placeholderData` /
 * `initialData`). So between mount and the query resolving — and that query
 * round-trips through an edge function which itself calls Stripe's
 * `accounts.retrieve` — the banner input is:
 *
 *     { status: "restricted", requirements: null }
 *
 * which `deriveBrandStripePresentation` answered with plain `restricted`: the
 * destructive banner, with a live, tappable "Continue verification". For the
 * brand this issue was filed over nothing was due, so the card then flipped to
 * the warm verifying copy a beat later. This happened on EVERY cold mount, on
 * the Payments screen and on the brand-profile route.
 *
 * WHAT IS ASSERTED
 *
 * The resolved banner for an unresolved-restricted brand is not destructive
 * and carries no CTA — and, just as importantly, it does NOT pre-emptively
 * show the verifying copy either, which would be the same fabrication pointed
 * the other way. The brand-profile route's two copy functions get the same
 * treatment, and the previously-correct answers are pinned unchanged so this
 * cannot have been bought by weakening the red card for a genuinely blocked
 * seller.
 *
 * FAILS-ON-REVERT: delete the `if (args.statusQuerySucceeded === false) return
 * "status_unresolved";` line in `../brandStripeUiState.ts` and the first three
 * describes fail — the destructive "Action required" banner and its CTA come
 * straight back.
 */

import {
  BRAND_STRIPE_BANNER_CONFIG,
  type BrandStripeRequirementsShape,
  STRIPE_STATUS_UNRESOLVED_SUB,
  STRIPE_STATUS_UNRESOLVED_TITLE,
  deriveBrandStripePresentation,
  getBrandProfileStripeBannerCopy,
  getBrandProfileStripeOperationsSub,
  resolveBrandStripeBannerConfig,
} from "../brandStripeUiState";
import { pickKycRemediationCode } from "../../constants/stripeKycRemediationMessages";

/** Exactly what Stripe returned for Lantern Room — nothing due. */
const LANTERN_ROOM: BrandStripeRequirementsShape = {
  disabled_reason: "requirements.pending_verification",
  currently_due: [],
  past_due: [],
  pending_verification: ["business_profile.url"],
};

/** A brand that genuinely IS blocked and must keep the red card. */
const CURRENTLY_DUE: BrandStripeRequirementsShape = {
  disabled_reason: "requirements.past_due",
  currently_due: ["individual.id_number"],
  past_due: [],
  pending_verification: [],
};

describe("#3258 review — the in-flight window renders no accusation and no CTA", () => {
  it("is neither destructive nor tappable while the status query is unresolved", () => {
    // The EXACT pair the screen holds between mount and the query resolving:
    // a cached `restricted` and requirements that have not arrived.
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: null,
      statusQuerySucceeded: false,
    });

    expect(banner).not.toBeNull();
    // The two things the reviewer flagged, inverted.
    expect(banner?.destructive).toBe(false);
    expect(banner?.ctaLabel).toBeNull();
    expect(banner?.ctaVariant).toBeNull();
    // And no red token on the icon either — `destructive: false` alone would
    // still let a red glyph through.
    expect(banner?.iconColor).not.toBe(
      BRAND_STRIPE_BANNER_CONFIG.restricted?.iconColor,
    );
  });

  it("says it is checking — it does NOT claim action is required, and does NOT claim verification is underway", () => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: null,
      statusQuerySucceeded: false,
    });

    expect(banner?.title).toBe(STRIPE_STATUS_UNRESOLVED_TITLE);
    expect(banner?.sub).toBe(STRIPE_STATUS_UNRESOLVED_SUB);
    // Not the old lie.
    expect(banner?.title).not.toContain("Action required");
    // Not the opposite lie: we do not yet know Stripe is verifying anything.
    expect(banner?.title).not.toBe(
      BRAND_STRIPE_BANNER_CONFIG.pending_verification?.title,
    );
    expect(banner?.sub).not.toBe(
      BRAND_STRIPE_BANNER_CONFIG.pending_verification?.sub,
    );
  });

  it("resolves the presentation to `status_unresolved` only for restricted", () => {
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: null,
        statusQuerySucceeded: false,
      }),
    ).toBe("status_unresolved");

    // Every other status describes itself without requirements, so an
    // unresolved query changes nothing for them.
    for (const status of ["not_connected", "onboarding", "active"] as const) {
      expect(
        deriveBrandStripePresentation({
          status,
          requirements: null,
          statusQuerySucceeded: false,
        }),
      ).toBe(status);
    }
  });
});

describe("#3258 review — the brand-profile route gets the same treatment", () => {
  it("neither accuses nor congratulates on the profile banner", () => {
    const copy = getBrandProfileStripeBannerCopy("status_unresolved");
    expect(copy).not.toBeNull();
    expect(copy?.title).toBe(STRIPE_STATUS_UNRESOLVED_TITLE);
    expect(copy?.title).not.toContain("Action required");
    // `BrandProfileView` paints the destructive style on
    // `stripeStatus === "restricted"`, so this state must not BE that string.
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: null,
        statusQuerySucceeded: false,
      }),
    ).not.toBe("restricted");
  });

  it("labels the Payments & Bank row honestly", () => {
    expect(getBrandProfileStripeOperationsSub("status_unresolved")).toBe(
      "Checking…",
    );
    expect(getBrandProfileStripeOperationsSub("status_unresolved")).not.toBe(
      "Action required",
    );
  });
});

describe("#3258 review — nothing that was already right was traded away", () => {
  it("restores the red card the instant the query says something IS due", () => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: CURRENTLY_DUE,
      statusQuerySucceeded: true,
    });
    expect(banner?.title).toBe("Action required — your account is limited");
    expect(banner?.destructive).toBe(true);
    expect(banner?.ctaLabel).toBe("Continue verification");
  });

  it("still shows the warm verifying card once the query confirms nothing is due", () => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: LANTERN_ROOM,
      statusQuerySucceeded: true,
    });
    expect(banner?.destructive).toBe(false);
    expect(banner?.ctaLabel).toBeNull();
    expect(banner?.title).toBe("Onboarding submitted — verifying");
  });

  it("a SUCCEEDED query that reports no requirements at all still reads restricted", () => {
    // `requirements: null` means two different things before and after the
    // query resolves. Once it HAS resolved, the server's derived enum is the
    // best answer available and the red card is honest again.
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: null,
        statusQuerySucceeded: true,
      }),
    ).toBe("restricted");
  });

  it("omitting the flag is byte-identical to the pre-review behaviour", () => {
    // Every pure-data caller (and the three shipped #3258 suites) omits it.
    expect(
      deriveBrandStripePresentation({ status: "restricted", requirements: null }),
    ).toBe("restricted");
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: LANTERN_ROOM,
      }),
    ).toBe("pending_verification");
    expect(
      resolveBrandStripeBannerConfig({ status: "restricted", requirements: null })
        ?.ctaLabel,
    ).toBe("Continue verification");
  });

  it("leaves the KYC remediation card alone — it already rendered nothing", () => {
    // `pickKycRemediationCode(null)` → null → the card renders nothing during
    // the same window. The reviewer asked for this to stay untouched.
    expect(pickKycRemediationCode(null)).toBeNull();
    expect(pickKycRemediationCode(undefined)).toBeNull();
  });
});
