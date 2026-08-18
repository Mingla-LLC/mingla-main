/**
 * ORCH-0849 [Stripe payment-method parity] — mingla-business parity test.
 *
 * Source-file structural test (no runtime — just file reads + regex).
 * Asserts that the business mobile surface adopts the same native
 * PaymentSheet pattern as consumer, per SPEC_ORCH-0849 §3.6.3 and
 * invariant I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY.
 *
 * Three angle:
 *   (1) Business native checkout routes mount <StripeProviderWrapper> while
 *       the root layout stays free of the Stripe native provider.
 *   (2) Business nativeCheckoutFlow.native.ts exists; imports initStripe from
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
  it("keeps native Stripe provider off root while preserving checkout route provider config", () => {
    const rootLayout = stripLineComments(read("mingla-business/app/_layout.tsx"));
    const wrapper = stripLineComments(
      read("mingla-business/src/payments/StripeProviderWrapper.native.tsx"),
    );
    const nativeBoundary = stripLineComments(
      read("mingla-business/src/payments/NativeCheckoutPaymentBoundary.native.tsx"),
    );

    expect(rootLayout).not.toMatch(/StripeProviderWrapper/);
    expect(nativeBoundary).toMatch(/<StripeProviderWrapper>/);
    expect(nativeBoundary).toMatch(/useNativeCheckoutFlow/);
    expect(wrapper).toMatch(
      /merchantIdentifier=["']merchant\.com\.sethogieva\.minglabusiness["']/,
    );
    expect(wrapper).toMatch(/urlScheme=["']com\.sethogieva\.minglabusiness["']/);
  });

  it("nativeCheckoutFlow.native.ts imports initStripe from @stripe/stripe-react-native", () => {
    const source = stripLineComments(
      read("mingla-business/src/payments/nativeCheckoutFlow.native.ts"),
    );
    expect(source).toMatch(
      /import\s+\{[^}]*\binitStripe\b[^}]*\}\s+from\s+["']@stripe\/stripe-react-native["']/,
    );
  });

  it("nativeCheckoutFlow.native.ts calls initStripe with stripeAccountId per PI", () => {
    const source = stripLineComments(
      read("mingla-business/src/payments/nativeCheckoutFlow.native.ts"),
    );
    // Must call initStripe({...stripeAccountId...}) — ORCH-0844 Connect
    // direct-charge invariant.
    expect(source).toMatch(/initStripe\s*\(\s*\{[\s\S]*?stripeAccountId/);
  });

  it("nativeCheckoutFlow.native.ts passes customer + customerEphemeralKeySecret to initPaymentSheet", () => {
    const source = stripLineComments(
      read("mingla-business/src/payments/nativeCheckoutFlow.native.ts"),
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
    // Native flow is lazy-loaded through the route boundary so Home startup
    // does not evaluate @stripe/stripe-react-native.
    expect(source).toMatch(
      /NativeCheckoutPaymentBoundary/,
    );
    expect(source).not.toMatch(/from\s+["'][^"']*nativeCheckoutFlow["']/);
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
      /"merchantIdentifier"\s*:\s*"merchant\.com\.sethogieva\.minglabusiness"/,
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

/**
 * issue #2264 [abandoned payment told the wrong story] — the TERMINAL-TOKEN
 * half of the parity contract.
 *
 * The business app has no `checkoutErrorMessages.ts` (#2229 scoped that file to
 * app-mobile), so its four return-leg strings are declared as module constants
 * in `nativeCheckoutFlow.native.ts`. Two copies of a sentence with no shared
 * owner is exactly how the retired "We couldn't confirm your payment yet"
 * string ended up duplicated across three files and owned by none — so this
 * asserts them BYTE-IDENTICAL against app-mobile's constants of the same name.
 *
 * SPEC #2264 §7 T-8 (neither flow discards the answer) and T-9 (copy parity).
 *
 * Fails on revert: narrow either flow's `ticket-checkout-status` response type
 * back to `{ order }`, or let one app's copy drift, and this goes red.
 */
describe("#2264 — consumer/business terminal-token parity", () => {
  const CONSUMER_FLOW = stripLineComments(
    read("app-mobile/src/payments/nativeCheckoutFlow.ts"),
  );
  const BUSINESS_FLOW = stripLineComments(
    read("mingla-business/src/payments/nativeCheckoutFlow.native.ts"),
  );
  const CONSUMER_COPY = read("app-mobile/src/payments/checkoutErrorMessages.ts");

  const CONSTANTS = [
    "CHECKOUT_ABANDONED_MESSAGE",
    "CHECKOUT_PAYMENT_FAILED_MESSAGE",
    "CHECKOUT_PAYMENT_MISMATCH_MESSAGE",
    "CHECKOUT_AWAITING_CONFIRMATION_MESSAGE",
    "CHECKOUT_UNAVAILABLE_MESSAGE",
  ] as const;

  /** The string literal a `const NAME =\n  "…";` declaration carries. */
  const literalFor = (source: string, name: string): string => {
    const match = new RegExp(
      `\\b(?:export\\s+)?const\\s+${name}\\s*=\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`,
    ).exec(source);
    if (match === null) throw new Error(`no literal for ${name}`);
    return match[1];
  };

  it("both native flows read `status` AND `error` off ticket-checkout-status", () => {
    for (const source of [CONSUMER_FLOW, BUSINESS_FLOW]) {
      expect(source).toMatch(/status\?:\s*string;[\s\S]{0,200}?error\?:\s*string;/);
      expect(source).toMatch(/data\?\.status === "failed"/);
      expect(source).toMatch(/data\.error \?\? null/);
    }
  });

  it("neither native flow still carries the retired timeout string", () => {
    for (const rel of [
      "app-mobile/src/payments/nativeCheckoutFlow.ts",
      "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
    ]) {
      expect(read(rel)).not.toContain("We couldn't confirm your payment yet");
    }
  });

  it("the four return-leg strings are BYTE-IDENTICAL across the two apps", () => {
    for (const name of CONSTANTS) {
      expect(literalFor(BUSINESS_FLOW, name)).toBe(
        literalFor(CONSUMER_COPY, name),
      );
    }
  });

  it("the business mapper is TOTAL by the same construction as the consumer's", () => {
    // The final `return` of each mapper is unconditional, so an unrecognised
    // code degrades to "we don't know yet" instead of a false certainty.
    expect(BUSINESS_FLOW).toMatch(
      /const paystackReturnMessage[\s\S]*?return CHECKOUT_AWAITING_CONFIRMATION_MESSAGE;\s*\n\};/,
    );
    expect(CONSUMER_COPY).toMatch(
      /nativePaystackReturnMessage[\s\S]*?return CHECKOUT_AWAITING_CONFIRMATION_MESSAGE;\s*\n\};/,
    );
  });

  it("both flows carry the #2250 protective comment at the poll site", () => {
    for (const rel of [
      "app-mobile/src/payments/nativeCheckoutFlow.ts",
      "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
    ]) {
      const source = read(rel);
      expect(source).toContain(
        "I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-BROWSER-CLOSES",
      );
      expect(source).toContain(
        "I-PROPOSED-CHECKOUT-STATUS-ANSWER-NOT-DISCARDED",
      );
    }
  });
});
