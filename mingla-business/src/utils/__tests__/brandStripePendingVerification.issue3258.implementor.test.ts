/**
 * Issue #3258 — a seller who finished Stripe setup is told action is required
 * when nothing is.
 *
 * Ground truth from the live Lantern Room account (`acct_1UEr7lEokzcvwz0K`):
 *
 *   details_submitted    : true
 *   currently_due        : []                            <- nothing is needed
 *   past_due             : []
 *   disabled_reason      : requirements.pending_verification
 *   pending_verification : ["business_profile.url"]
 *
 * `pg_derive_brand_stripe_status()` maps ANY non-empty `disabled_reason` to
 * `restricted`, so the server said `restricted` — correctly, for its many
 * other readers. The Payments banner then did a bare `BANNER_CONFIG[status]`
 * lookup and rendered "Action required — your account is limited" in
 * destructive red with a "Continue verification" button that dropped the
 * seller back at the start of a form they had already completed.
 *
 * These assertions run against the REAL exported selector, the REAL banner
 * table and the REAL copy functions — no hand-rolled copy of the mapping.
 * The derivation itself is deliberately NOT under test here: it is unchanged.
 */

// The REAL `brandPublicUrl` builder is used below (never a hand-typed URL), so
// the origin it reads must be present — same shape as
// src/constants/__tests__/publicUrls.test.ts. Resolution repair, not a mock of
// the unit under test.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com",
      },
    },
  },
}));

import {
  BRAND_STRIPE_BANNER_CONFIG,
  STRIPE_PENDING_VERIFICATION_FALLBACK_SUB,
  type BrandStripeRequirementsShape,
  deriveBrandStripePresentation,
  getBrandProfileStripeBannerCopy,
  getBrandProfileStripeOperationsSub,
  resolveBrandStripeBannerConfig,
} from "../brandStripeUiState";
import { isStripePendingVerification } from "../stripeOnboardingOutcome";
import { describeStripePendingVerification } from "../../constants/stripeKycRemediationMessages";
import {
  getKycRemediationMessage,
  pickKycRemediationCode,
} from "../../constants/stripeKycRemediationMessages";
import { brandPublicUrl } from "../../constants/publicUrls";

/** Exactly what Stripe returned for Lantern Room. */
const LANTERN_ROOM: BrandStripeRequirementsShape = {
  disabled_reason: "requirements.pending_verification",
  currently_due: [],
  past_due: [],
  pending_verification: ["business_profile.url"],
};

const PAST_DUE: BrandStripeRequirementsShape = {
  disabled_reason: "requirements.past_due",
  currently_due: [],
  past_due: ["individual.verification.document"],
  pending_verification: [],
};

const CURRENTLY_DUE: BrandStripeRequirementsShape = {
  disabled_reason: "requirements.pending_verification",
  currently_due: ["individual.id_number"],
  past_due: [],
  pending_verification: ["business_profile.url"],
};

const REJECTED_FRAUD: BrandStripeRequirementsShape = {
  disabled_reason: "rejected.fraud",
  currently_due: [],
  past_due: [],
  pending_verification: [],
};

describe("#3258 — the pending-verification presentation", () => {
  it("reuses the existing predicate rather than a second copy of the rule", () => {
    // If these ever disagree, the presentation has drifted from the
    // onboarding-entry screen again — which IS the reported bug.
    expect(isStripePendingVerification(LANTERN_ROOM)).toBe(true);
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: LANTERN_ROOM,
      }),
    ).toBe("pending_verification");
  });

  it("splits pending verification out of restricted ONLY for that case", () => {
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: PAST_DUE,
      }),
    ).toBe("restricted");
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: CURRENTLY_DUE,
      }),
    ).toBe("restricted");
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: REJECTED_FRAUD,
      }),
    ).toBe("restricted");
    expect(
      deriveBrandStripePresentation({
        status: "restricted",
        requirements: null,
      }),
    ).toBe("restricted");
  });

  it("leaves every non-restricted status untouched", () => {
    for (const status of ["not_connected", "onboarding", "active"] as const) {
      expect(
        deriveBrandStripePresentation({
          status,
          requirements: LANTERN_ROOM,
        }),
      ).toBe(status);
    }
  });
});

describe("#3258 AC-1 — the Payments banner stops lying", () => {
  it("renders a non-destructive, CTA-less verifying banner for Lantern Room", () => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: LANTERN_ROOM,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });

    expect(banner).not.toBeNull();
    // The four things the seller actually saw, all inverted.
    expect(banner?.title).not.toContain("Action required");
    expect(banner?.destructive).toBe(false);
    expect(banner?.ctaVariant).not.toBe("destructive");
    expect(banner?.ctaVariant).toBeNull();
    // No CTA at all: the only button we could offer re-opens a finished form.
    expect(banner?.ctaLabel).toBeNull();
    expect(banner?.title).toBe("Onboarding submitted — verifying");
  });

  it("never colours the pending banner with the error token", () => {
    const banner = BRAND_STRIPE_BANNER_CONFIG.pending_verification;
    const restricted = BRAND_STRIPE_BANNER_CONFIG.restricted;
    expect(banner).not.toBeNull();
    expect(restricted).not.toBeNull();
    expect(banner?.iconColor).not.toBe(restricted?.iconColor);
    expect(banner?.icon).toBe("bank");
  });
});

describe("#3258 AC-2 — no regression for a genuinely restricted brand", () => {
  it.each([
    ["requirements.past_due", PAST_DUE],
    ["a non-empty currently_due", CURRENTLY_DUE],
    ["rejected.fraud", REJECTED_FRAUD],
  ])("keeps the red destructive banner for %s", (_label, requirements) => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: requirements as BrandStripeRequirementsShape,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });

    expect(banner?.title).toBe("Action required — your account is limited");
    expect(banner?.destructive).toBe(true);
    expect(banner?.ctaVariant).toBe("destructive");
    expect(banner?.ctaLabel).toBe("Continue verification");
  });

  it("leaves the other three banners byte-identical", () => {
    expect(
      resolveBrandStripeBannerConfig({ status: "not_connected", requirements: null })?.ctaLabel,
    ).toBe("Connect bank");
    expect(
      resolveBrandStripeBannerConfig({ status: "onboarding", requirements: null })?.ctaLabel,
    ).toBe("Finish onboarding");
    expect(resolveBrandStripeBannerConfig({ status: "active", requirements: null })?.success).toBe(
      true,
    );
  });
});

describe("#3258 AC-4 — the blocking field is named in plain English", () => {
  it("names the website and includes the brand's own public page", () => {
    const sentence = describeStripePendingVerification({
      pendingVerification: ["business_profile.url"],
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });

    expect(sentence).not.toBeNull();
    expect(sentence).toContain("your website");
    // The real canonical builder, rendered without the scheme.
    expect(sentence).toContain("host.usemingla.com/b/lanternroom");
    expect(sentence).not.toContain("https://");
    // Plain English only — never the raw Stripe code.
    expect(sentence).not.toContain("business_profile.url");
    expect(sentence).toContain("Nothing to do");
  });

  it("reads fine with no slug supplied", () => {
    const sentence = describeStripePendingVerification({
      pendingVerification: ["business_profile.url"],
    });
    expect(sentence).toBe(
      "Stripe is checking your website. Nothing to do — we'll email you when it's verified.",
    );
  });

  it("names the first code and counts the rest", () => {
    expect(
      describeStripePendingVerification({
        pendingVerification: [
          "individual.verification.document",
          "company.tax_id",
        ],
      }),
    ).toBe(
      "Stripe is checking the ID document you uploaded and 1 other detail. Nothing to do — we'll email you when everything is verified.",
    );
    expect(
      describeStripePendingVerification({
        pendingVerification: ["external_account", "company.tax_id", "individual.id_number"],
      }),
    ).toBe(
      "Stripe is checking your payout bank account and 2 other details. Nothing to do — we'll email you when everything is verified.",
    );
  });

  it("humanises an unknown code instead of printing snake.case", () => {
    const sentence = describeStripePendingVerification({
      pendingVerification: ["individual.political_exposure"],
    });
    expect(sentence).not.toBeNull();
    expect(sentence).not.toContain("individual.political_exposure");
    expect(sentence).not.toContain("_");
    expect(sentence).toContain("individual political exposure");
  });

  it("returns null (not a vague filler) when Stripe named nothing", () => {
    expect(describeStripePendingVerification({ pendingVerification: [] })).toBeNull();
    expect(describeStripePendingVerification({ pendingVerification: null })).toBeNull();
    expect(describeStripePendingVerification({})).toBeNull();
  });

  it("puts the sentence into the banner, falling back when there is none", () => {
    const named = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: LANTERN_ROOM,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });
    expect(named?.sub).toContain("host.usemingla.com/b/lanternroom");

    const unnamed = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: {
        disabled_reason: "requirements.pending_verification",
        currently_due: [],
        past_due: [],
      },
    });
    expect(unnamed?.sub).toBe(STRIPE_PENDING_VERIFICATION_FALLBACK_SUB);
    expect(unnamed?.ctaLabel).toBeNull();
  });
});

describe("#3258 AC-1b — the brand-profile row stops saying 'Action required'", () => {
  it("shows non-alarming copy for pending verification", () => {
    const presentation = deriveBrandStripePresentation({
      status: "restricted",
      requirements: LANTERN_ROOM,
    });
    const copy = getBrandProfileStripeBannerCopy(presentation);

    expect(copy).not.toBeNull();
    expect(copy?.title).not.toContain("Action required");
    expect(copy?.sub).not.toContain("Stripe has limited your account");
    expect(getBrandProfileStripeOperationsSub(presentation)).not.toBe(
      "Action required",
    );
    expect(getBrandProfileStripeOperationsSub(presentation)).toBe("Verifying…");
  });

  it("still says 'Action required' for a genuinely actionable restriction", () => {
    const presentation = deriveBrandStripePresentation({
      status: "restricted",
      requirements: PAST_DUE,
    });
    expect(getBrandProfileStripeBannerCopy(presentation)).toEqual({
      title: "Action required",
      sub: "Stripe has limited your account. Tap to resolve.",
    });
    expect(getBrandProfileStripeOperationsSub(presentation)).toBe(
      "Action required",
    );
  });

  it("keeps the pre-existing statuses byte-identical", () => {
    expect(getBrandProfileStripeBannerCopy("active")).toBeNull();
    expect(getBrandProfileStripeOperationsSub("active")).toBe("Active");
    expect(getBrandProfileStripeOperationsSub("not_connected")).toBe(
      "Not connected",
    );
    expect(getBrandProfileStripeBannerCopy("onboarding")).toEqual({
      title: "Onboarding submitted — verifying",
      sub: "We'll email you when Stripe finishes verifying your details.",
    });
  });
});

describe("#3258 — the KYC remediation card offers no dead tap", () => {
  it("drops the navigating CTA when nothing is due", () => {
    const message = getKycRemediationMessage("requirements.pending_verification");
    expect(message.severity).toBe("info");
    // "Check back later" was wired to onResolve → Stripe onboarding.
    expect(message.ctaLabel).toBeNull();
    expect(message.title).not.toContain("Action required");
  });

  it("never strands a brand that is BOTH pending and genuinely due", () => {
    // "Stripe is checking your website" and "Stripe still needs your ID" can
    // be true at once. With the pending message now CTA-less, letting it win
    // would show "nothing is needed from you" on a blocked account.
    expect(pickKycRemediationCode(CURRENTLY_DUE)).toBe("individual.id_number");
    expect(getKycRemediationMessage(pickKycRemediationCode(CURRENTLY_DUE) as string)
      .ctaLabel).toBe("Provide ID number");
    // …while the pure pending case still resolves to the CTA-less message.
    expect(pickKycRemediationCode(LANTERN_ROOM)).toBe(
      "requirements.pending_verification",
    );
  });

  it("keeps the disabled_reason on top for every actionable reason", () => {
    // No behaviour change for the pre-existing priority order.
    expect(pickKycRemediationCode(PAST_DUE)).toBe("requirements.past_due");
    expect(pickKycRemediationCode(REJECTED_FRAUD)).toBe("rejected.fraud");
    expect(
      pickKycRemediationCode({
        disabled_reason: null,
        currently_due: ["company.tax_id"],
        past_due: [],
      }),
    ).toBe("company.tax_id");
    expect(
      pickKycRemediationCode({
        disabled_reason: null,
        currently_due: ["company.tax_id"],
        past_due: ["external_account"],
      }),
    ).toBe("external_account");
    expect(pickKycRemediationCode(null)).toBeNull();
    // An unrecognised reason keeps top priority (its fallback IS actionable).
    expect(
      pickKycRemediationCode({
        disabled_reason: "some.brand.new.reason",
        currently_due: ["company.tax_id"],
        past_due: [],
      }),
    ).toBe("some.brand.new.reason");
  });

  it("keeps the CTA on every actionable code", () => {
    expect(getKycRemediationMessage("requirements.past_due").ctaLabel).toBe(
      "Resume verification",
    );
    expect(getKycRemediationMessage("rejected.fraud").ctaLabel).toBe(
      "Contact support",
    );
    expect(getKycRemediationMessage("external_account").ctaLabel).toBe(
      "Add bank account",
    );
    // Unknown codes still fall back to an actionable card.
    expect(getKycRemediationMessage("some.unmapped.code").ctaLabel).toBe(
      "Continue verification",
    );
  });
});
