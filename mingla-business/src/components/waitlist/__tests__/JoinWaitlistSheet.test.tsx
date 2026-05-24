// T-WL-03 — JoinWaitlistSheet source contract.

import fs from "node:fs";
import path from "node:path";

describe("T-WL-03 JoinWaitlistSheet", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../JoinWaitlistSheet.tsx"),
    "utf8",
  );

  it("renders email, phone, name, quantity, and consent controls", () => {
    expect(source).toContain("Waitlist email");
    expect(source).toContain("Waitlist phone");
    expect(source).toContain("Waitlist name");
    expect(source).toContain("Quantity");
    expect(source).toContain("Consent to waitlist messages");
  });

  it("disables submit until contact and consent are present", () => {
    expect(source).toContain("const hasContact");
    expect(source).toContain("emailValid");
    expect(source).toContain("consent &&");
    expect(source).toContain("disabled={!canSubmit}");
  });

  it("success and already-waiting paths show toast and close", () => {
    expect(source).toContain("You're on the waitlist.");
    expect(source).toContain("You're already on the waitlist.");
    expect(source).toContain("showToast(");
    expect(source).toContain("onClose();");
  });
});
