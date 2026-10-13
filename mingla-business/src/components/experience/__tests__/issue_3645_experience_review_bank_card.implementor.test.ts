/**
 * issue #3645 — the experience Review step (Invite people on) shows the bank
 * card. Before: on step 7 the Publish button was simply disabled for a paid
 * experience on a brand with no bank, with nothing on screen saying why.
 *
 * Also pins that accepting the Organiser Terms continues the publish.
 * Source assertions, per the repo's node-jest convention for RN components.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const WIZARD = readFileSync(
  path.join(process.cwd(), "src/components/experience/ExperienceCreatorWizard.tsx"),
  "utf8",
);

describe("#3645 — experience Review step bank card", () => {
  const at = WIZARD.indexOf("inviteEnabled && step === 7 && experienceNeedsStripe");
  const card = WIZARD.slice(at, at + 520);

  test("mounts on the Review step when the experience is paid and the brand cannot collect", () => {
    expect(at).toBeGreaterThan(-1);
    expect(card).toContain("<StripeBlockedCard");
    expect(card).toContain('testID="experience-review-stripe-blocked"');
  });

  test("same title, the approved body, and the same Connect bank action", () => {
    expect(card).toContain('title="Bank required for paid experiences"');
    expect(card).toContain(
      'body="Connect a bank to publish this paid experience. You\'ll come straight back here."',
    );
    expect(card).toContain('ctaLabel="Connect bank"');
    expect(card).toContain("onConnectStripe={handleConnectStripe}");
    expect(card).not.toMatch(/stripe connect|paystack/i);
  });

  test("it sits above the footer, after the Review summary", () => {
    expect(at).toBeGreaterThan(
      WIZARD.indexOf("<InvitePlanReviewSummary plan={invitePlan} quote={inviteQuote} />"),
    );
    expect(at).toBeLessThan(WIZARD.indexOf("{step < finalStep ? ("));
  });

  test("the Pricing and Cover step cards are still there", () => {
    expect(WIZARD).toContain("step === 4 && experienceNeedsStripe");
    expect(WIZARD).toContain("step === 5 && experienceNeedsStripe");
  });

  test("Publish stays disabled until the bank is connected", () => {
    expect(WIZARD).toContain(
      "disabled={experienceNeedsStripe || !invitePublishReady || checkingInvitePublish}",
    );
  });
});

describe("#3645 — a host returning to Review lands on Review", () => {
  test("the wizard waits for the invite step to be known, then moves to step 7 once", () => {
    const at = WIZARD.indexOf("if (inviteEnabled && resumeReviewRef.current) {");
    expect(at).toBeGreaterThan(-1);
    const block = WIZARD.slice(at, at + 160);
    expect(block).toContain("resumeReviewRef.current = false;");
    expect(block).toContain("setStep(7);");
  });
});

describe("#3645 — accepting the Organiser Terms continues the experience publish", () => {
  test("both terms checks hand over the publish to resume and show no retry toast", () => {
    expect(WIZARD.split("() => resumePublishRef.current(),").length - 1).toBe(2);
    expect(WIZARD).toContain("void beginPublish();");
    expect(WIZARD).not.toContain("ORGANISER_TERMS_PUBLISH_RETRY_TOAST");
  });
});
