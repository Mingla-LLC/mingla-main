/**
 * Issue #3258, second pass — the app must name the URL STRIPE IS ACTUALLY
 * CHECKING, not the one the app would like it to be.
 *
 * The first pass shipped the sentence "Stripe is checking your website
 * (host.usemingla.com/b/lanternroom)." and built it from `brands.slug`. That
 * is only true for accounts created AFTER the platform started prefilling
 * `defaults.profile.business_url`. For every account onboarded before it —
 * including the live Lantern Room account this issue was filed over — Stripe
 * is checking the URL the seller typed inside Connect onboarding, which for
 * Lantern Room is `www.rambleawaypod.com`, a domain whose ports 80 and 443 are
 * closed. Naming the Mingla page there states something false with complete
 * confidence (Constitution rule 9, no fabricated data) and hides the single
 * most useful fact the product could show.
 *
 * So `brand-stripe-refresh-status` now returns the account's own
 * `business_profile.url`, and the sentence prefers it.
 *
 * Two things are under test here:
 *   1. The client selectors, executed for real.
 *   2. A SOURCE guard over the two edge files. It lives in a jest test rather
 *      than only in the Deno suite because `mingla-business jest (full suite)`
 *      is the one required check that runs on EVERY pull request with no path
 *      filter, and the `defaults` merge it guards is the single most dangerous
 *      line in this change: `STRIPE_MANAGED_RISK_CONTROLLER` supplies the
 *      whole `defaults` key, so a sibling `defaults:` written next to its
 *      spread silently drops `losses_collector` / `fees_collector` and changes
 *      who absorbs losses and collects fees on a live marketplace, with no
 *      error anywhere. The executable wire-level proof lives in
 *      supabase/functions/_shared/__tests__/issue_3258_business_profile_prefill.test.ts.
 */

// The REAL `brandPublicUrl` builder is used below (never a hand-typed URL), so
// the origin it reads must be present. Resolution repair, not a mock of the
// unit under test.
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

import { readFileSync } from "fs";
import { join } from "path";

import {
  type BrandStripeRequirementsShape,
  resolveBrandStripeBannerConfig,
} from "../brandStripeUiState";
import { describeStripePendingVerification } from "../../constants/stripeKycRemediationMessages";
import { brandPublicUrl } from "../../constants/publicUrls";

/** Exactly what Stripe returns for the live Lantern Room account. */
const LANTERN_ROOM: BrandStripeRequirementsShape = {
  disabled_reason: "requirements.pending_verification",
  currently_due: [],
  past_due: [],
  pending_verification: ["business_profile.url"],
};

/** The dead site Stripe is really fetching for that account. */
const SELLER_TYPED_URL = "https://www.rambleawaypod.com";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const readRepoFile = (relative: string): string =>
  readFileSync(join(REPO_ROOT, relative), "utf8");

describe("#3258 — the pending-verification sentence names the account's own URL", () => {
  it("names the URL the ACCOUNT reports, not the brand's Mingla page", () => {
    const sentence = describeStripePendingVerification({
      pendingVerification: LANTERN_ROOM.pending_verification,
      accountBusinessUrl: SELLER_TYPED_URL,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });

    expect(sentence).toContain("www.rambleawaypod.com");
    // The brand page must NOT appear when Stripe is not looking at it.
    expect(sentence).not.toContain("host.usemingla.com");
    expect(sentence).toContain("Stripe is checking your website");
    expect(sentence).toContain("Nothing to do");
    // Never re-introduce the false instruction.
    expect(sentence).not.toContain("Action required");
  });

  it("falls back to the brand's public page only when the account reports none", () => {
    const expectedPage = brandPublicUrl("lanternroom");
    for (const absent of [null, undefined, "", "   "]) {
      const sentence = describeStripePendingVerification({
        pendingVerification: LANTERN_ROOM.pending_verification,
        accountBusinessUrl: absent,
        brandPublicUrl: expectedPage,
      });
      expect(sentence).toContain(
        expectedPage.replace(/^https?:\/\//, ""),
      );
    }
  });

  it("names no URL at all when neither is known, rather than inventing one", () => {
    const sentence = describeStripePendingVerification({
      pendingVerification: ["business_profile.url"],
      accountBusinessUrl: null,
      brandPublicUrl: null,
    });
    expect(sentence).toBe(
      "Stripe is checking your website. Nothing to do — we'll email you when it's verified.",
    );
    expect(sentence).not.toContain("(");
  });

  it("only names a URL for business_profile.url — another pending field is unaffected", () => {
    const sentence = describeStripePendingVerification({
      pendingVerification: ["individual.verification.document"],
      accountBusinessUrl: SELLER_TYPED_URL,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });
    expect(sentence).not.toContain("rambleawaypod");
    expect(sentence).not.toContain("host.usemingla.com");
  });

  it("threads the account URL all the way through the Payments banner", () => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: LANTERN_ROOM,
      accountBusinessUrl: SELLER_TYPED_URL,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });

    expect(banner).not.toBeNull();
    expect(banner?.sub).toContain("www.rambleawaypod.com");
    expect(banner?.sub).not.toContain("host.usemingla.com");
    // Still the non-destructive, CTA-less presentation from the first pass.
    expect(banner?.destructive).toBe(false);
    expect(banner?.ctaLabel).toBeNull();
    expect(banner?.title).not.toContain("Action required");
  });

  it("keeps the brand page when the banner is given no account URL", () => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: LANTERN_ROOM,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });
    expect(banner?.sub).toContain("host.usemingla.com/b/lanternroom");
  });

  it("a genuinely due requirement still gets the red treatment — no regression", () => {
    const banner = resolveBrandStripeBannerConfig({
      status: "restricted",
      requirements: {
        disabled_reason: "requirements.past_due",
        currently_due: ["individual.id_number"],
        past_due: ["individual.id_number"],
        pending_verification: [],
      },
      accountBusinessUrl: SELLER_TYPED_URL,
      brandPublicUrl: brandPublicUrl("lanternroom"),
    });
    expect(banner?.destructive).toBe(true);
    expect(banner?.title).toContain("Action required");
    expect(banner?.ctaLabel).toBe("Continue verification");
  });
});

describe("#3258 — the edge-side prefill, guarded by the one gate that runs on every PR", () => {
  const blueprint = readRepoFile(
    "supabase/functions/_shared/stripeBlueprintClient.ts",
  );

  /**
   * `buildRecipientAccountDefaults`'s source, from its `export function` line
   * to the first closing brace in column 0. Sliced rather than grepped so the
   * assertions below are about THIS function's returns and cannot be satisfied
   * by a matching string somewhere else in a 400-line file.
   */
  const builderSource = ((): string => {
    const start = blueprint.indexOf(
      "export function buildRecipientAccountDefaults",
    );
    const end = blueprint.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return blueprint.slice(start, end);
  })();

  it("merges the profile ONTO the managed-risk controller's own defaults", () => {
    // The spread must still be there (ORCH-0954 / I-PROPOSED-CONTROLLER-PROPS-PINNED)...
    expect(blueprint).toContain("...STRIPE_MANAGED_RISK_CONTROLLER");
    // ...and the defaults key must be BUILT, not written as a naked literal
    // that would clobber `responsibilities`.
    expect(blueprint).toContain("defaults: buildRecipientAccountDefaults(input)");
    expect(builderSource).toContain("...STRIPE_MANAGED_RISK_CONTROLLER.defaults");
    // The v2 field paths. Asserted as the EMITTED object literals rather than
    // as bare substrings: the file's own doc comments name the v1 shapes in
    // order to rule them out, and a negative substring assertion would match
    // the comment that explains why they are wrong
    // (see reference_audit_regex_matches_comments_same_file).
    expect(builderSource).toContain("profile: { business_url:");
    expect(builderSource).toContain("profile: { product_description:");
  });

  it("EVERY returned object that carries a profile also carries the controller defaults", () => {
    // This is the assertion that stands between a live marketplace and a
    // silently dropped `losses_collector` / `fees_collector`. Structural, not
    // a substring: each `return {` block inside the builder that emits a
    // `profile` must ALSO spread the controller's defaults. Delete either
    // spread and this goes red on the one check that runs on every PR.
    const returnedObjects = builderSource.split("return {").slice(1);
    const profileReturns = returnedObjects.filter((block) =>
      block.includes("profile:")
    );
    expect(profileReturns).toHaveLength(2);
    for (const block of profileReturns) {
      expect(block).toContain("...controllerDefaults");
    }
    // And the controller defaults themselves must come from the pinned
    // constant, never be retyped by hand.
    expect(builderSource).toContain(
      "...STRIPE_MANAGED_RISK_CONTROLLER.defaults,",
    );
    expect(builderSource).not.toContain('losses_collector: "stripe"');
  });

  it("never lets one string be sent as both business_url and product_description", () => {
    // The builder returns on the URL branch before it can read the
    // description, so `invalid_product_description_url_match` is
    // unrepresentable. Pinned structurally here; proved on the wire by the
    // Deno suite named in this file's header.
    const builder = blueprint.slice(
      blueprint.indexOf("export function buildRecipientAccountDefaults"),
    );
    const urlBranch = builder.indexOf("profile: { business_url:");
    const descriptionBranch = builder.indexOf("profile: { product_description:");
    expect(urlBranch).toBeGreaterThan(-1);
    expect(descriptionBranch).toBeGreaterThan(urlBranch);
  });

  it("brand-stripe-onboard selects the slug and sends the brand page; partner-onboard sends nothing", () => {
    const brandOnboard = readRepoFile(
      "supabase/functions/brand-stripe-onboard/index.ts",
    );
    expect(brandOnboard).toContain(
      'select("name, contact_email, default_currency, slug")',
    );
    expect(brandOnboard).toContain("businessUrl: brandPublicPageUrl");

    const partnerOnboard = readRepoFile(
      "supabase/functions/partner-stripe-onboard/index.ts",
    );
    expect(partnerOnboard).not.toContain("businessUrl");
    expect(partnerOnboard).not.toContain("productDescription");
  });

  it("brand-stripe-refresh-status returns the account's business_profile.url", () => {
    const refresh = readRepoFile(
      "supabase/functions/brand-stripe-refresh-status/index.ts",
    );
    expect(refresh).toContain(
      "business_profile_url: readBusinessProfileUrl(account)",
    );
    expect(refresh).toContain("account.business_profile?.url");
  });
});
