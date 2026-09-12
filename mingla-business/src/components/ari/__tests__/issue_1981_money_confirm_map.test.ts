/**
 * #1981 — client typed-confirm map must match backend MONEY_CONFIRM_TOOLS for
 * refund / cancel / trip-cancel / charge. retry + reminder stay standard.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(
  path.join(ROOT, "src/components/ari/ToolProposalCard.tsx"),
  "utf8",
);

describe("#1981 ToolProposalCard MONEY_CONFIRM_TOOLS", () => {
  it("includes refund/cancel/trip-cancel/CHARGE and excludes retry/reminder", () => {
    expect(source).toMatch(/refund_order:\s*"REFUND"/);
    expect(source).toMatch(/cancel_order:\s*"CANCEL"/);
    expect(source).toMatch(/cancel_trip_booking:\s*"CANCEL"/);
    expect(source).toMatch(/charge_installment_now:\s*"CHARGE"/);
    expect(source).not.toMatch(/retry_installment:\s*"/);
    expect(source).not.toMatch(/send_installment_reminder:\s*"/);
  });
});
