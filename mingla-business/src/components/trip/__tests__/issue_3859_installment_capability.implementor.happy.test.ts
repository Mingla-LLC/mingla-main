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

import {
  publicTripInstallmentSchedule,
  tripInstallmentsSupported,
} from "@mingla/offering-rendering/tripInstallmentCapability";

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
const capabilityHookSource = readFileSync(
  join(COMPONENT_ROOT, "..", "..", "hooks", "useTripInstallmentCapability.ts"),
  "utf8",
);
const capabilityServiceSource = readFileSync(
  join(COMPONENT_ROOT, "..", "..", "services", "tripInstallmentCapabilityService.ts"),
  "utf8",
);
const editRouteSource = readFileSync(
  join(APP_ROOT, "trip", "[id]", "edit.tsx"),
  "utf8",
);

describe("#3859 unsupported trip installment capability", () => {
  test("executes the real provider capability and public schedule boundary", async () => {
    const savedSchedule = { depositPercent: 25, installments: 3 };

    expect(await Promise.resolve(tripInstallmentsSupported(" STRIPE "))).toBe(
      true,
    );
    expect(await Promise.resolve(tripInstallmentsSupported("paystack"))).toBe(
      false,
    );
    expect(publicTripInstallmentSchedule(true, savedSchedule)).toBe(
      savedSchedule,
    );
    expect(publicTripInstallmentSchedule(false, savedSchedule)).toBeNull();
    expect(publicTripInstallmentSchedule(undefined, savedSchedule)).toBeNull();
  });

  test("saved schedules stay visible but become provider-neutral and read-only", () => {
    expect(pricingSource).toContain(
      "Payment plans aren't available with this payment setup. Your saved schedule is kept, but buyers can't select it.",
    );
    expect(pricingSource).toMatch(
      /const planSuspended = !paymentPlansAvailable/,
    );
    // [TEST-MOD-APPROVED #4522] The plan switch and both plan editors gained
    // more locks (shared first-package plan, v2 rollback, staged authoring);
    // an unsupported provider still disables the switch and locks the editor.
    expect(pricingSource).toMatch(
      /disabled=\{\s*disabled === true \|\|\s*planLocked \|\|\s*planSuspended \|\|/,
    );
    expect(pricingSource).toMatch(
      /locked=\{planLocked \|\| planSuspended \|\| sharedFollower\}/,
    );
    expect(pricingSource).toMatch(
      /locked=\{\s*planLocked \|\|\s*planSuspended \|\|/,
    );
  });

  test("draft and published previews never expose an unsupported schedule", () => {
    // [TEST-MOD-APPROVED #4522] The wizard half is now a behaviour test:
    // issue_4522_trip_wizard_flag_off_gates.implementor.test.tsx mounts the
    // real wizard and asserts the review preview carries no schedule. The
    // source still derives the preview plan from the capability.
    expect(wizardSource).toContain(
      "const paymentPlan = paymentPlansAvailable ? p.paymentPlan : null;",
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
    // [TEST-MOD-APPROVED #4522] The Pricing step index is a named constant
    // (step 4 with the builder off, step 3 with it on).
    expect(wizardSource).toContain("setStep(PRICING_STEP)");
    expect(wizardSource).toMatch(/const PRICING_STEP: StepIndex = V2 \? 3 : 4;/);
    expect(wizardSource).toContain(
      "paymentPlansAvailable={paymentPlansAvailable}",
    );
  });

  test("authoring uses the server capability RPC and fails closed", () => {
    expect(capabilityServiceSource).toContain(
      '"biz_trip_installments_supported_for_brand"',
    );
    expect(capabilityServiceSource).toContain("return data === true");
    expect(capabilityHookSource).toContain("catch {");
    expect(capabilityHookSource).toContain("return false");
    expect(wizardSource).toContain("useTripInstallmentCapability(trip.brandId)");
    expect(publishedEditorSource).toContain(
      "useTripInstallmentCapability(trip.brandId)",
    );
    expect(editRouteSource).toContain("currentBrand.id === trip.brandId");
  });
});
