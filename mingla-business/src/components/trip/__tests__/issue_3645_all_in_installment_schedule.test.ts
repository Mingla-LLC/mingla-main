import {
  buildInstallmentScheduleRows,
} from "../installmentScheduleRows";
import type { InstallmentScheduleDisplaySchedule } from "../InstallmentScheduleDisplay";

const projected: InstallmentScheduleDisplaySchedule = {
  fullPriceCents: 1_000_000,
  depositCents: 250_000,
  currency: "NGN",
  installments: [{
    ordinal: 1,
    pct: 75,
    amountCents: 750_000,
    dueAt: "2027-03-01T12:00:00.000Z",
  }],
};

describe("#3645 all-in installment schedule", () => {
  it("shows percentages before a server quote and never fabricates naira", () => {
    const rows = buildInstallmentScheduleRows({ schedule: projected });
    expect(rows.deposit.amount).toBe("25%");
    expect(rows.installments[0].amount).toBe("75%");
    expect(rows.total).toBe("100%");
  });

  it("renders one aggregate server-locked cart schedule including fees and tax", () => {
    const rows = buildInstallmentScheduleRows({
      schedule: projected,
      depositChargeCents: 270_625,
      lockedChargeSchedule: {
        currency: "NGN",
        payments: [{
          ordinal: 1,
          dueAt: "2027-03-01T12:00:00.000Z",
          buyerTotalCents: 811_875,
          feesCents: 45_000,
          taxCents: 16_875,
        }],
      },
    });
    expect(rows.depositFormatted).toContain("2,706.25");
    expect(rows.remainingFormatted).toContain("8,118.75");
    expect(rows.total).toContain("10,825");
    expect(rows.installments).toHaveLength(1);
  });
});
