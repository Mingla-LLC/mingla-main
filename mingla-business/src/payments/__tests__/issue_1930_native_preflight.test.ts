import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(__dirname, "..", "nativeCheckoutFlow.native.ts"),
  "utf8",
);

describe("#1930 Business PaymentSheet preflight", () => {
  it("fails closed immediately before presentation", () => {
    expect(source).toContain("preflight: true");
    expect(source).toContain('data?.status === "present_allowed"');
    expect(source.indexOf("await preflightPaymentSheet(")).toBeLessThan(
      source.indexOf("await presentPaymentSheet()"),
    );
    expect(source).toContain("This sale is no longer available.");
  });
});
