import { installmentReassuranceText as businessCopy } from "../installmentReassurance";
import { installmentReassuranceText as sharedCopy } from "@mingla/offering-rendering/installmentReassurance";

describe("#3645 one shared buyer reassurance module", () => {
  it("business resolves the exact shared implementation", () => {
    const input = {
      depositFormatted: "₦2,706.25",
      remainingFormatted: "₦8,118.75",
      collection: "auto_card_or_pay_link" as const,
    };
    expect(businessCopy(input)).toBe(sharedCopy(input));
    expect(businessCopy(input)).toContain("secure link to pay");
  });
});
