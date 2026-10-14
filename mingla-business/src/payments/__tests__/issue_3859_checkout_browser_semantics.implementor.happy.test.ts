/**
 * Issue #3859 — buyer-web checkout semantics that must survive the native
 * Explorer parity work. These source-boundary assertions protect the exact
 * props and routing projection React Native Web emits; the runtime proof uses
 * the real Expo web bundle against the isolated local database.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const paymentChoice = read(
  "mingla-business/src/components/trip/TripPaymentChoice.tsx",
);
const sharedPaymentChoice = read(
  "packages/offering-rendering/TripPaymentChoice.tsx",
);
const tripRoute = read("mingla-business/app/t/[brandSlug]/[tripSlug].tsx");

describe("#3859 buyer-web emitted accessibility state", () => {
  test("both payment radios expose checked state to native and web accessibility trees", () => {
    expect(
      paymentChoice.match(/accessibilityState=\{\{ checked: isFull \}\}/g),
    ).toHaveLength(1);
    expect(paymentChoice.match(/aria-checked=\{isFull\}/g)).toHaveLength(1);
    expect(
      paymentChoice.match(
        /accessibilityState=\{\{ checked: isInstallments \}\}/g,
      ),
    ).toHaveLength(1);
    expect(
      paymentChoice.match(/aria-checked=\{isInstallments\}/g),
    ).toHaveLength(1);
  });

  test.each([
    ["business compatibility component", paymentChoice],
    ["shared Explorer and public-page component", sharedPaymentChoice],
  ])(
    "%s exposes selected state on both payment tabs to native and web accessibility trees",
    (_label, source) => {
      expect(source.match(/accessibilityRole="tab"/g)).toHaveLength(2);
      expect(
        source.match(/accessibilityState=\{\{ selected: isFull \}\}/g),
      ).toHaveLength(1);
      expect(source.match(/aria-selected=\{isFull\}/g)).toHaveLength(1);
      expect(
        source.match(/accessibilityState=\{\{ selected: !isFull \}\}/g),
      ).toHaveLength(1);
      expect(source.match(/aria-selected=\{!isFull\}/g)).toHaveLength(1);
    },
  );

  test.each([
    "mingla-business/app/checkout/[eventId]/buyer.tsx",
    "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
    "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
  ])("%s exposes the checked consent state in emitted web markup", (file) => {
    const source = read(file);
    const checkboxStart = source.indexOf('accessibilityRole="checkbox"');
    expect(checkboxStart).toBeGreaterThan(-1);
    const checkboxProps = source.slice(checkboxStart, checkboxStart + 360);
    expect(checkboxProps).toContain(
      "accessibilityState={{ checked: termsAccepted, disabled: !authReady }}",
    );
    expect(checkboxProps).toContain("aria-checked={termsAccepted}");
  });
});

describe("#3859 line-authoritative trip routing", () => {
  test("single-tier package and sticky payment controls synchronize in both directions", () => {
    expect(tripRoute).toMatch(
      /const soleTierId =\s*data\.tiers\.length === 1[\s\S]*?: null;/,
    );
    expect(tripRoute).toMatch(
      /handleSynchronizedPaymentPlanChoice[\s\S]*?onPaymentPlanChoiceChange\(value\);[\s\S]*?onChangePlanChoice\(soleTierId, value\);/,
    );
    expect(tripRoute).toMatch(
      /handleSynchronizedTierPlanChoice[\s\S]*?onChangePlanChoice\(ticketTypeId, value\);[\s\S]*?onPaymentPlanChoiceChange\(value\);/,
    );
    expect(tripRoute).toContain(
      "onPaymentPlanChoiceChange={handleSynchronizedPaymentPlanChoice}",
    );
    expect(tripRoute).toContain(
      "onChangePlanChoice={handleSynchronizedTierPlanChoice}",
    );
  });

  test("package-row Reserve projects its line choices into the legacy scalar before navigation", () => {
    const handlerStart = tripRoute.indexOf("const handleTripReserve");
    const handlerEnd = tripRoute.indexOf("// META-ORCH-1174", handlerStart);
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = tripRoute.slice(handlerStart, handlerEnd);

    expect(handler).toMatch(
      /if \(choice === undefined && lines !== undefined && lines\.length > 0\) \{\s*choice = collapseTripPlanChoice\(lines\);\s*\}/,
    );
    expect(
      handler.indexOf("choice = collapseTripPlanChoice(lines)"),
    ).toBeLessThan(handler.indexOf("const linesParam"));
    expect(handler).toContain(
      "params: { plan: choice ?? paymentPlanChoice, ...linesParam }",
    );
  });
});
