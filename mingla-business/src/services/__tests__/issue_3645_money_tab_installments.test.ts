import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUSINESS_ROOT = join(__dirname, "..", "..", "..");
const money = readFileSync(join(BUSINESS_ROOT, "app", "trip", "[id]", "money", "index.tsx"), "utf8");
const service = readFileSync(join(BUSINESS_ROOT, "src", "services", "orderInstallmentsService.ts"), "utf8");
const actions = readFileSync(join(BUSINESS_ROOT, "src", "hooks", "useManualInstallmentActions.ts"), "utf8");

describe("#3645 Money tab provider-neutral installment operations", () => {
  it("uses charged/refunded truth and shows collection method and buyer action", () => {
    expect(service).toContain("amountChargedCents");
    expect(service).toContain("buyerTotalCents");
    expect(service).toContain("refundedAmountCents");
    expect(money).toContain("row.amountChargedCents");
    expect(money).toContain("Automatic · card ending");
    expect(money).toContain("Pay link sent");
    expect(money).toContain("Waiting for buyer to approve");
    expect(money).toContain("Pay link will be sent");
  });

  it("offers manual charge and pay-link actions with outcome-specific feedback", () => {
    expect(money).toContain("useChargeInstallmentNow");
    expect(money).toContain("useSendInstallmentReminder");
    expect(money).toContain("Send pay link");
    expect(actions).toContain("Pay link sent to the buyer.");
    expect(actions).toContain("The buyer's bank needs approval — we sent them a link.");
    expect(actions).toContain("We're confirming this payment. Check back in a few minutes.");
    expect(actions).toContain("You can resend once a day.");
  });
});
