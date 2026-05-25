import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");

const read = (relPath: string): string =>
  fs.readFileSync(path.join(repoRoot, relPath), "utf8");

const stripComments = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

describe("META-ORCH-0972 Sub-B Android root Stripe isolation", () => {
  it("keeps the native Stripe provider out of the root Home startup tree", () => {
    const rootLayout = stripComments(read("mingla-business/app/_layout.tsx"));

    expect(rootLayout).not.toMatch(/StripeProviderWrapper/);
    expect(rootLayout).not.toMatch(/@mingla\/payments-native/);
    expect(rootLayout).not.toMatch(/@stripe\/stripe-react-native/);
  });

  it("lazy-loads native checkout payment routes before they can evaluate Stripe", () => {
    const eventPayment = stripComments(
      read("mingla-business/app/checkout/[eventId]/payment.tsx"),
    );
    const tripPayment = stripComments(
      read("mingla-business/app/checkout-trip/[tripEventId]/payment.tsx"),
    );
    const nativeBoundary = stripComments(
      read("mingla-business/src/payments/NativeCheckoutPaymentBoundary.native.tsx"),
    );

    for (const source of [eventPayment, tripPayment]) {
      expect(source).toMatch(/React\.lazy/);
      expect(source).toMatch(/NativeCheckoutPaymentBoundary/);
      expect(source).not.toMatch(/from\s+["'][^"']*nativeCheckoutFlow["']/);
      expect(source).not.toMatch(/from\s+["'][^"']*StripeProviderWrapper["']/);
      expect(source).not.toMatch(/from\s+["']@stripe\/stripe-react-native["']/);
    }

    expect(nativeBoundary).toMatch(/useNativeCheckoutFlow/);
    expect(nativeBoundary).toMatch(/<StripeProviderWrapper>/);
    expect(nativeBoundary).toMatch(/<\/StripeProviderWrapper>/);
  });

  it("keeps the provider configuration in the native wrapper without package-version changes", () => {
    const wrapper = stripComments(
      read("mingla-business/src/payments/StripeProviderWrapper.native.tsx"),
    );
    const packageJson = read("mingla-business/package.json");

    expect(wrapper).toMatch(/merchantIdentifier=["']merchant\.com\.sethogieva\.minglabusiness["']/);
    expect(wrapper).toMatch(/urlScheme=["']com\.sethogieva\.minglabusiness["']/);
    expect(packageJson).toMatch(/"@stripe\/stripe-react-native": "\^0\.65\.1"/);
  });
});

// fails-on-revert verified at c9741eb52: root layout still imported and
// mounted StripeProviderWrapper, while checkout payment routes did not own a
// scoped provider wrapper.
