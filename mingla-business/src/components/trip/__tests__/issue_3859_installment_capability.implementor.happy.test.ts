/**
 * Issue #3859 slice-1 Host happy-path contract.
 *
 * This source-level proof pins the narrow capability boundary without mounting
 * the large wizard tree. It fails if unsupported schedules become editable,
 * visible in previews, or publishable, or if the route stops supplying the
 * effective brand payment setup.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENT_ROOT = join(__dirname, "..");
const APP_ROOT = join(COMPONENT_ROOT, "..", "..", "..", "app");

const wizardSource = readFileSync(
  join(COMPONENT_ROOT, "TripCreatorWizard.tsx"),
  "utf8",
);
const pricingSource = readFileSync(
  join(COMPONENT_ROOT, "TripCreatorStep4Pricing.tsx"),
  "utf8",
);
const publishedEditorSource = readFileSync(
  join(COMPONENT_ROOT, "EditPublishedTripScreen.tsx"),
  "utf8",
);
const editRouteSource = readFileSync(
  join(APP_ROOT, "trip", "[id]", "edit.tsx"),
  "utf8",
);

describe("#3859 unsupported trip installment capability", () => {
  test("saved schedules stay visible but become provider-neutral and read-only", () => {
    expect(pricingSource).toContain(
      "Payment plans aren't available with this payment setup. Your saved schedule is kept, but buyers can't select it.",
    );
    expect(pricingSource).toMatch(
      /const planSuspended = !paymentPlansAvailable/,
    );
    expect(pricingSource).toMatch(
      /disabled=\{disabled === true \|\| planLocked \|\| planSuspended\}/,
    );
    expect(pricingSource).toMatch(
      /locked=\{planLocked \|\| planSuspended\}/,
    );
  });

  test("draft and published previews never expose an unsupported schedule", () => {
    expect(wizardSource).toContain(
      "installmentSchedule: paymentPlansAvailable ? p.paymentPlan : null",
    );
    expect(publishedEditorSource).toMatch(
      /const plannerPreviewSchedule =\s*!paymentPlansAvailable \|\|/,
    );
  });

  test("publish refuses before payout readiness while keeping the draft", () => {
    const refusal = wizardSource.indexOf(
      "if (tripHasUnsupportedInstallments)",
    );
    const bankGate = wizardSource.indexOf(
      "if (tripNeedsBankForInstallments)",
    );
    expect(refusal).toBeGreaterThan(0);
    expect(bankGate).toBeGreaterThan(refusal);
    expect(wizardSource).toContain("setStep(4)");
    expect(wizardSource).toContain(
      "paymentPlansAvailable={paymentPlansAvailable}",
    );
  });

  test("published editing gets the effective current-brand capability", () => {
    expect(editRouteSource).toContain("currentBrand.id === trip.brandId");
    expect(editRouteSource).toContain("paymentProvider={");
    expect(publishedEditorSource).toContain(
      "tripInstallmentsSupported(paymentProvider)",
    );
  });
});
