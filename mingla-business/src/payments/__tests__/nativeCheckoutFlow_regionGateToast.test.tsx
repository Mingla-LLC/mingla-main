import fs from "node:fs";
import path from "node:path";

describe("ORCH-0953 §3.8 — business native region-gate buyer message", () => {
  it("maps native_paid_not_allowed_in_region to web-fallback copy", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../nativeCheckoutFlow.native.ts"),
      "utf8",
    );
    expect(source).toContain("native_paid_not_allowed_in_region");
    expect(source).toContain("Pay on the web to complete checkout");
  });
});
