/**
 * ORCH-1335 — TESTER adversarial guard (DIFFERENT axis from the implementor).
 *
 * The implementor's suite already covers: predicate permutations (the rail/status
 * matrix) in chipInPayoutReadiness.test.ts, the RsvpStep5Setup.tsx source-structure,
 * and the RTL swap render. This test attacks the two axes NONE of those touch — the
 * WIRING between the compute sites and the predicate:
 *
 *   1. STALE-CACHE FALSE-POSITIVE (the cardinal rule). The predicate must trust ONLY
 *      the FRESH `freshStripeStatus` argument (the live useBrandStripeStatus hook) and
 *      must NEVER derive "ready" from a brand-level Stripe cache field. The implementor's
 *      predicate test uses Pick<Brand,"paymentProvider"|"paystackSubaccountCode"> so it
 *      NEVER exercises a brand object that actually CARRIES a stale `stripeStatus`.
 *      Here we hand the predicate a brand whose cached `stripeStatus === "active"` while
 *      the fresh hook says undefined (loading) / "restricted", and prove it stays
 *      not-ready. A false "Payouts are on" is the single worst regression.
 *
 *   2. STALE-CLOSURE / STALE-MEMO WIRING. Both compute sites (RsvpCreatorWizard AND
 *      EditPublishedScreen) must feed the FRESH `useBrandStripeStatus(...).data?.status`
 *      into isChipInPayoutReady — not `brand.stripeStatus`. AND EditPublishedScreen's
 *      `renderSectionBody` useCallback MUST list `chipInPayoutReady` in its dependency
 *      array; if it is absent, the memoized callback keeps a stale closure and the
 *      "rsvp-setup" banner never swaps after a Stripe status flip (active → restricted
 *      or the initial loading → active). No existing test inspects the wizard/edit
 *      wiring or that dep array.
 *
 * Pure `.test.ts` (fs source read + pure-fn calls, no RTL) → runs under the DEFAULT
 * jest.config.cjs, so it is CI-enforced.
 */
import { readFileSync } from "fs";
import path from "path";

import { isChipInPayoutReady } from "../../../utils/chipInPayoutReadiness";
import type { Brand } from "../../../types/brand";

type BrandLike = Pick<Brand, "paymentProvider" | "paystackSubaccountCode">;

const RSVP_DIR = path.resolve(__dirname, "..");
const EVENT_DIR = path.resolve(__dirname, "..", "..", "event");
const wizardSrc = readFileSync(path.join(RSVP_DIR, "RsvpCreatorWizard.tsx"), "utf8");
const editSrc = readFileSync(path.join(EVENT_DIR, "EditPublishedScreen.tsx"), "utf8");

describe("ORCH-1335 [tester] — predicate ignores the stale brand Stripe cache", () => {
  // A brand that CARRIES a stale cached stripeStatus:"active" (a real field on
  // types/brand.ts:223). The predicate must read ONLY the fresh hook argument.
  const staleCacheBrand = {
    paymentProvider: "stripe",
    stripeStatus: "active",
  } as unknown as BrandLike;

  it("stays NOT ready while the fresh status is still loading (undefined) even though the cache says active", () => {
    // If the util wrongly consulted brand.stripeStatus this would flash true — the
    // exact false-positive the cardinal rule forbids.
    expect(isChipInPayoutReady(staleCacheBrand, undefined)).toBe(false);
  });

  it("stays NOT ready when the FRESH status is restricted even though the cache says active", () => {
    expect(isChipInPayoutReady(staleCacheBrand, "restricted")).toBe(false);
  });

  it("becomes ready ONLY when the fresh status itself confirms active", () => {
    expect(isChipInPayoutReady(staleCacheBrand, "active")).toBe(true);
  });

  it("re-derives not-ready when the fresh Stripe status flips active → restricted (transition)", () => {
    const brand = { paymentProvider: "stripe" } as BrandLike;
    expect(isChipInPayoutReady(brand, "active")).toBe(true);
    expect(isChipInPayoutReady(brand, "restricted")).toBe(false);
  });
});

describe("ORCH-1335 [tester] — RsvpCreatorWizard feeds the FRESH hook status, not the cache", () => {
  it("computes readiness from useBrandStripeStatus, not brand.stripeStatus", () => {
    expect(wizardSrc).toContain("useBrandStripeStatus(brand?.id ?? null)");
    expect(wizardSrc).toMatch(
      /isChipInPayoutReady\(\s*brand\s*,\s*chipInStripeStatus\.data\?\.status\s*\)/,
    );
    // The predicate call must never be fed a stale brand-level Stripe cache field.
    expect(wizardSrc).not.toMatch(/isChipInPayoutReady\([^)]*\.stripeStatus/);
  });
});

describe("ORCH-1335 [tester] — EditPublishedScreen is symmetric AND stale-closure-safe", () => {
  it("computes readiness from the fresh hook (useBrand + useBrandStripeStatus), not the cache", () => {
    expect(editSrc).toContain("useBrandStripeStatus(chipInBrandId)");
    expect(editSrc).toMatch(
      /isChipInPayoutReady\(\s*chipInBrandQuery\.data\s*\?\?\s*null\s*,\s*chipInStripeStatus\.data\?\.status\s*,?\s*\)/,
    );
    expect(editSrc).not.toMatch(/isChipInPayoutReady\([^)]*\.stripeStatus/);
  });

  it("lists chipInPayoutReady in the renderSectionBody useCallback dependency array (no stale closure)", () => {
    const cbStart = editSrc.indexOf("const renderSectionBody = useCallback(");
    expect(cbStart).toBeGreaterThan(-1);
    // First 2-space-indented `);` after the callback opens = its own close (the
    // switch-body JSX returns are indented far deeper, so this is unambiguous).
    const cbEnd = editSrc.indexOf("\n  );", cbStart);
    expect(cbEnd).toBeGreaterThan(cbStart);
    const cbBlock = editSrc.slice(cbStart, cbEnd);
    // The dependency array is the trailing `[ ... ]` of the useCallback call.
    const depArray = cbBlock.slice(cbBlock.lastIndexOf("["));
    expect(depArray).toContain("chipInPayoutReady");
  });
});
