import fs from "node:fs";
import path from "node:path";

describe("ORCH-0953 §3.7 — business Google Pay EAS profile gate", () => {
  it("uses EAS_BUILD_PROFILE rather than __DEV__ for PaymentSheet googlePay.testEnv", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/payments/nativeCheckoutFlow.native.ts"),
      "utf8",
    );
    expect(source).toContain("process.env.EAS_BUILD_PROFILE !== \"production\"");
    expect(source).toContain("testEnv: isStripeGooglePayTestEnv()");
    expect(source).not.toContain("testEnv: __DEV__");
  });
});
