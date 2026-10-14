import {
  formatAuditTargetSummary,
  resolveAuditTargetLabel,
} from "../auditTargetLabels";

describe("issue #3645 activity-log target labels", () => {
  test.each([
    ["brand_team_members", "Team member"],
    ["stripe_connect_account", "Payout account"],
    ["brand_paystack_recipient", "Bank details"],
    ["brand_invitation", "Team invite"],
    ["order", "Order"],
    ["refund", "Refund"],
  ])("shows %s as %s", (targetType, expected) => {
    expect(resolveAuditTargetLabel(targetType)).toBe(expected);
  });

  test("unknown record types fail safe without exposing an internal name", () => {
    const unknownType = "future_private_table_name";

    expect(resolveAuditTargetLabel(unknownType)).toBe("Record");
    expect(formatAuditTargetSummary(unknownType, "1234567890")).toBe(
      "Record …567890",
    );
    expect(formatAuditTargetSummary(unknownType, "1234567890")).not.toContain(
      unknownType,
    );
  });

  test("keeps the existing shortened record id after the plain label", () => {
    expect(
      formatAuditTargetSummary(
        "stripe_connect_account",
        "acct_1QYx6uLkdIwHu7ixxuXrhh",
      ),
    ).toBe("Payout account …xuXrhh");
  });

  test("keeps the existing empty-target treatment", () => {
    expect(formatAuditTargetSummary(null, null)).toBe("—");
    expect(formatAuditTargetSummary("order", null)).toBe("Order");
  });
});
