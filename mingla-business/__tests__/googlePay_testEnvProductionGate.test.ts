import fs from "node:fs";
import path from "node:path";

describe("#4174 — business Google Pay Stripe-key gate", () => {
  it("derives PaymentSheet googlePay.testEnv from the server publishable key", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/payments/nativeCheckoutFlow.native.ts"),
      "utf8",
    );
    expect(source).toContain(
      "testEnv: isStripeGooglePayTestEnv(data.publishableKey)",
    );
    expect(source).not.toContain("process.env.EAS_BUILD_PROFILE");
  });
});
