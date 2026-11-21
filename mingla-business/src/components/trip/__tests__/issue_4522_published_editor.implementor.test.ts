// MINGLA-INVARIANT: I-4522-PUBLISHED-EDITOR-PARITY | issue #4522 | Published trip editing uses the four builder sections, asks for a reason only for the approved buyer-affecting changes, and validates v2 plans against each live package price.
/**
 * #4522 slice 12 — fails on revert if the old seven accordions return, the
 * reason becomes unconditional, questions ask for prose again, the brand-form
 * row disappears from Travelers, v2 is written under the legacy key, or plan
 * validation moves after the review/RPC.
 */

import fs from "node:fs";
import path from "node:path";

const tripDir = path.resolve(__dirname, "..");
const read = (relative: string): string =>
  fs.readFileSync(path.resolve(tripDir, relative), "utf8");

describe("#4522 — published editor parity", () => {
  const screen = read("EditPublishedTripScreen.tsx");
  const modal = read("../event/ChangeSummaryModal.tsx");
  const intake = read("EditPublishedTripIntakeAccordion.tsx");

  test("uses the builder's exact four sections in one scroll with a desktop rail", () => {
    const sectionBlock = screen.match(
      /const BUILDER_SECTIONS:[\s\S]*?\n\];/,
    )?.[0];
    expect(sectionBlock).toBeDefined();
    expect(sectionBlock?.match(/key:\s*"[^"]+"/g)).toEqual([
      'key: "trip"',
      'key: "itinerary"',
      'key: "pricing"',
      'key: "travelers"',
    ]);
    expect(screen).toContain("BUILDER_STEP_TITLES[1]");
    expect(screen).toContain("BUILDER_STEP_TITLES[4]");
    expect(screen).toContain('layout="list"');
    expect(screen).toContain("renderBuilderSectionBody(section.key)");
    expect(screen).not.toContain("openSection");
  });

  test("reuses the create builder components instead of parallel edit controls", () => {
    for (const component of [
      "TripCreatorStep1Basics",
      "TripCreatorStep2Itinerary",
      "TripInclusionChips",
      "TripCreatorStep3Inclusions",
      "TripCreatorStep4Pricing",
      "TripBuilderSectionTitle",
      "TripEarningsCard",
      "TripQuestionLibrary",
    ]) {
      expect(`${screen}\n${intake}`).toContain(component);
    }
    expect(screen).toContain("builderV2");
    expect(read("EditPublishedTripSettingsAccordion.tsx")).toContain("builderV2");
  });

  test("asks the approved prompt only when the buyer-affecting classifier says so", () => {
    expect(screen).toContain("liveTripEditNeedsBuyerReason(trip, patch)");
    expect(screen).toContain("reasonRequired={modal.reasonRequired}");
    expect(screen).toContain(
      'reasonPrompt="What changed and why? Travelers will see this."',
    );
    expect(screen).toMatch(
      /const auditReason = modal\.reasonRequired\s*\? reason\s*:\s*NON_BUYER_EDIT_AUDIT_REASON/,
    );
    expect(modal).toContain("reasonRequired = true");
    expect(modal).toContain("{reasonRequired ? (");
  });

  test("question edits use the shared library and audit reason without a reason field", () => {
    expect(intake).toContain("<TripQuestionLibrary");
    expect(intake).toContain("reason: NON_BUYER_EDIT_AUDIT_REASON");
    expect(intake).not.toContain("Reason for change");
    expect(intake).not.toContain("reasonDialogVisible");
  });

  test("keeps #4514 brand-form questions lazy and inside Travelers", () => {
    expect(screen).toContain('import("../forms/formsOwner")');
    expect(screen).toContain("default: m.GuestQuestionsRow");
    expect(screen).toContain('testID="edit-guest-questions-row"');
    expect(screen).toContain('kind="trip"');
    expect(screen).toContain("brandId={trip.brandId}");

    const intakeIndex = screen.indexOf('{renderSectionBody("intake")}');
    const questionsIndex = screen.indexOf("<GuestQuestionsRow", intakeIndex);
    const buyerIndex = screen.indexOf("<EventTicketCheckoutAccessCard", questionsIndex);
    expect(intakeIndex).toBeGreaterThan(-1);
    expect(questionsIndex).toBeGreaterThan(intakeIndex);
    expect(buyerIndex).toBeGreaterThan(questionsIndex);
  });

  test("edits every existing package and serializes exactly one plan shape", () => {
    expect(screen).toContain("trip.pricingTiers.map((tier) => ({");
    expect(screen).toContain("soldCount: trip.ticketsSoldCount");
    expect(screen).toContain("const editPackageByTicketType = new Map(");
    expect(screen).toContain("trip.pricingTiers.map<TripPricingTierInput>");
    expect(screen).toContain("payment_plan: _oldPaymentPlan");
    expect(screen).toContain("installments: _oldInstallments");
    expect(screen).toContain("metadata.payment_plan = editPkg.paymentPlan");
    expect(screen).toContain("metadata.installments = editPkg.paymentPlan");
    expect(screen).toContain("if (anyTierChanged) patch.pricing_tiers = nextTierInputs");
    expect(screen).not.toContain("v2PlanAuthoringLocked");
  });

  test("validates package plans against their edited prices before review", () => {
    const validation = screen.indexOf(
      "validateTripPackages(editState.pricing.packages)",
    );
    const review = screen.indexOf("setModal({", validation);
    const rpc = screen.indexOf("updateLiveTripMutation.mutateAsync");
    expect(validation).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(validation);
    expect(rpc).toBeGreaterThan(review);
    expect(screen).toContain('scrollToBuilderSection("pricing")');
  });
});
