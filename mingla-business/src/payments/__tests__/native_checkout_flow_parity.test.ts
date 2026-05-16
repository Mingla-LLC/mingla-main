/**
 * ORCH-0849 [Stripe payment-method parity] — mingla-business parity test.
 *
 * Source-file structural test (no runtime — just file reads + regex).
 * Asserts that the business mobile surface adopts the same native
 * PaymentSheet pattern as consumer, per SPEC_ORCH-0849 §3.6.3 and
 * invariant I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY.
 *
 * Three angle:
 *   (1) Business _layout.tsx mounts <StripeNativeProvider> with the
 *       business merchantIdentifier + urlScheme.
 *   (2) Business nativeCheckoutFlow.ts exists; imports initStripe from
 *       @stripe/stripe-react-native; calls initStripe with stripeAccountId;
 *       passes customer + customerEphemeralKeySecret to initPaymentSheet.
 *   (3) Business payment.tsx does NOT import expo-web-browser AND DOES
 *       import the new useNativeCheckoutFlow hook.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), "utf8");

const stripLineComments = (src: string): string =>
  src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

describe("ORCH-0849 — mingla-business native PaymentSheet parity", () => {
  it("mounts <StripeNativeProvider> in _layout.tsx with business merchant identifier and url scheme", () => {
    const source = stripLineComments(read("mingla-business/app/_layout.tsx"));
    expect(source).toMatch(/<StripeNativeProvider\b/);
    expect(source).toMatch(
      /merchantIdentifier=["']merchant\.com\.mingla\.business\.v2["']/,
    );
    expect(source).toMatch(/urlScheme=["']com\.mingla\.business\.v2["']/);
  });

  it("nativeCheckoutFlow.ts imports initStripe from @stripe/stripe-react-native", () => {
    const source = stripLineComments(
      read("mingla-business/src/payments/nativeCheckoutFlow.ts"),
    );
    expect(source).toMatch(
      /import\s+\{[^}]*\binitStripe\b[^}]*\}\s+from\s+["']@stripe\/stripe-react-native["']/,
    );
  });

  it("nativeCheckoutFlow.ts calls initStripe with stripeAccountId per PI", () => {
    const source = stripLineComments(
      read("mingla-business/src/payments/nativeCheckoutFlow.ts"),
    );
    // Must call initStripe({...stripeAccountId...}) — ORCH-0844 Connect
    // direct-charge invariant.
    expect(source).toMatch(/initStripe\s*\(\s*\{[\s\S]*?stripeAccountId/);
  });

  it("nativeCheckoutFlow.ts passes customer + customerEphemeralKeySecret to initPaymentSheet", () => {
    const source = stripLineComments(
      read("mingla-business/src/payments/nativeCheckoutFlow.ts"),
    );
    expect(source).toMatch(/customerId\s*:/);
    expect(source).toMatch(/customerEphemeralKeySecret\s*:/);
  });

  it("payment.tsx removes expo-web-browser import and adopts useNativeCheckoutFlow", () => {
    const source = stripLineComments(
      read("mingla-business/app/checkout/[eventId]/payment.tsx"),
    );
    // expo-web-browser import is ABSENT (forbidden by ORCH-0849 §3.4.5)
    expect(source).not.toMatch(
      /import\s+[^;]*\s+from\s+["']expo-web-browser["']/,
    );
    // useNativeCheckoutFlow hook is imported from the new per-app glue
    expect(source).toMatch(
      /import\s+\{\s*useNativeCheckoutFlow\s*\}\s+from\s+/,
    );
  });

  it("payment.tsx forbids WebBrowser.openAuthSessionAsync call site (post-ORCH-0849 retirement)", () => {
    const source = stripLineComments(
      read("mingla-business/app/checkout/[eventId]/payment.tsx"),
    );
    // The openAuthSessionAsync call was the ORCH-0839-B native-side handoff
    // mechanism. Removed by ORCH-0849. Any reappearance means the hosted-
    // checkout flow is creeping back in.
    expect(source).not.toMatch(/WebBrowser\s*\.\s*openAuthSessionAsync\s*\(/);
  });

  it("app.json registers the Stripe RN plugin with business merchant identifier", () => {
    const source = read("mingla-business/app.json");
    expect(source).toMatch(/"@stripe\/stripe-react-native"/);
    expect(source).toMatch(
      /"merchantIdentifier"\s*:\s*"merchant\.com\.mingla\.business\.v2"/,
    );
  });

  it("package.json declares @stripe/stripe-react-native at the same major.minor as consumer", () => {
    const consumerPkg = JSON.parse(read("app-mobile/package.json")) as {
      dependencies: Record<string, string>;
    };
    const businessPkg = JSON.parse(read("mingla-business/package.json")) as {
      dependencies: Record<string, string>;
    };
    const consumerVer = consumerPkg.dependencies["@stripe/stripe-react-native"];
    const businessVer = businessPkg.dependencies["@stripe/stripe-react-native"];
    expect(consumerVer).toBeDefined();
    expect(businessVer).toBeDefined();
    // Compare normalized semver major.minor — both apps must agree.
    const normalize = (v: string): string =>
      v.replace(/^[\^~]/, "").split(".").slice(0, 2).join(".");
    expect(normalize(businessVer)).toBe(normalize(consumerVer));
  });
});
