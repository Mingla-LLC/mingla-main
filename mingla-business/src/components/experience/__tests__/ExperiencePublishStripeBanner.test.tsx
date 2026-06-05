/**
 * ORCH-1076 Stream B — experience proactive Stripe banner + disabled Publish +
 * pre-check toast (SPEC §9 T-20/T-21/T-22) and regression T-23 (no banner on
 * the live-edit branch).
 *
 * Repo harness note: Node-env Jest, no RN renderer. These tests
 * source-characterize the ExperienceCreatorWizard wiring: the gate compute
 * (NOT in live-edit), the Pricing + Cover banner mounts, the disabled Publish
 * with Save-as-draft enabled, and the handleSubmit(true) pre-check that returns
 * before the biz_publish_experience RPC.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const wizardSource = (): string =>
  readFileSync(
    path.join(
      process.cwd(),
      "src/components/experience/ExperienceCreatorWizard.tsx",
    ),
    "utf8",
  );

describe("ORCH-1076 — experience gate compute", () => {
  test("experienceNeedsStripe mirrors the paid resolver + brand.stripeStatus, NOT in live-edit", () => {
    const src = wizardSource();
    expect(src).toContain("const experienceNeedsStripe");
    expect(src).toContain("!isLiveEdit");
    expect(src).toContain("offeringNeedsStripeToPublish");
    expect(src).toContain(
      "experienceDraftIsPaid({ isFree, resolvedTotalMajor })",
    );
    expect(src).toContain("stripeStatus: brand?.stripeStatus ?? null");
  });
});

describe("ORCH-1076 — T-6 banner mounts (Pricing + Cover)", () => {
  test("banner mounts on the Pricing step (4) when experienceNeedsStripe", () => {
    const src = wizardSource();
    expect(src).toContain("step === 4 && experienceNeedsStripe");
    expect(src).toContain('testID="experience-pricing-stripe-blocked"');
  });

  test("banner mounts on the FINAL Cover step (5) above Publish", () => {
    const src = wizardSource();
    expect(src).toContain("step === 5 && experienceNeedsStripe");
    expect(src).toContain('testID="experience-cover-stripe-blocked"');
  });

  test("both banners carry the experience copy + Finish Stripe setup CTA", () => {
    const src = wizardSource();
    expect(src).toContain('title="Stripe required for paid experiences"');
    expect(src).toContain(
      "Connect Stripe to publish this paid experience. Free experiences can be published any time.",
    );
    expect(src).toContain('ctaLabel="Finish Stripe setup"');
    expect(src).toContain("onConnectStripe={handleConnectStripe}");
    expect(src).toContain("brandStripeOnboardingRoute(brand.id)");
  });
});

describe("ORCH-1076 — T-20 disabled Publish, draft enabled", () => {
  test("Publish disabled when experienceNeedsStripe; Save as draft stays enabled", () => {
    const src = wizardSource();
    const draftIdx = src.indexOf('label="Save as draft"');
    const publishIdx = src.indexOf('label="Publish"');
    expect(draftIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(draftIdx);

    // The Publish button (from its label to the end of its element) carries the
    // needsStripe disable.
    const publishBlock = src.slice(publishIdx, publishIdx + 700);
    expect(publishBlock).toContain("disabled={experienceNeedsStripe}");

    // The Save-as-draft button element (bounded to BEFORE the Publish button)
    // has NO needsStripe disable.
    const draftBlock = src.slice(draftIdx, publishIdx);
    expect(draftBlock).not.toContain("disabled={experienceNeedsStripe}");
  });
});

describe("ORCH-1076 — T-21 / T-22 publish pre-check vs draft bypass", () => {
  test("T-21 handleSubmit(true) pre-check sets toast + returns before the RPC", () => {
    const src = wizardSource();
    const submitIdx = src.indexOf("const handleSubmit = useCallback");
    // The ACTUAL RPC call (not the comment mentioning the fn name).
    const rpcIdx = src.indexOf('supabase.rpc("biz_publish_experience"', submitIdx);
    expect(rpcIdx).toBeGreaterThan(submitIdx);
    const block = src.slice(submitIdx, rpcIdx);
    // The pre-check exists and gates on publish && experienceNeedsStripe.
    expect(block).toContain("if (publish && experienceNeedsStripe)");
    expect(block).toContain("Connect Stripe to publish this paid experience.");
    // The pre-check returns BEFORE the supabase.rpc call (block ends at the RPC).
    const guardIdx = block.indexOf("if (publish && experienceNeedsStripe)");
    const returnIdx = block.indexOf("return;", guardIdx);
    expect(returnIdx).toBeGreaterThan(guardIdx);
  });

  test("T-22 draft path (publish=false) is NOT gated — guard is publish-only", () => {
    const src = wizardSource();
    // The gate predicate requires `publish &&` — a draft save skips it.
    expect(src).toContain("if (publish && experienceNeedsStripe)");
    // Save as draft calls handleSubmit(false).
    expect(src).toContain("onPress={() => void handleSubmit(false)}");
  });
});

describe("ORCH-1076 — T-23 live-edit (edit-to-paid) has NO proactive banner", () => {
  test("the gate is suppressed in live-edit mode", () => {
    const src = wizardSource();
    // experienceNeedsStripe is `!isLiveEdit && ...`, so the live-edit branch
    // never shows the proactive banner — only the reactive ORCH-1075 catch.
    const gateIdx = src.indexOf("const experienceNeedsStripe");
    const gateBlock = src.slice(gateIdx, gateIdx + 250);
    expect(gateBlock).toContain("!isLiveEdit &&");
  });

  test("the reactive ORCH-1075 catch (handlePaidPublishGuard) is intact", () => {
    const src = wizardSource();
    expect(src).toContain("handlePaidPublishGuard");
    expect(src).toContain("resolvePaidPublishGuardCopy");
    expect(src).toContain("brandStripeOnboardingRoute(brand.id)");
  });
});
