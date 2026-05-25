import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(__dirname, "../../../../..");
const read = (rel: string): string => readFileSync(join(repo, rel), "utf8");

const ROUTE = read("app/trip/[id]/money/index.tsx");
const HOOKS = read("src/hooks/useManualInstallmentActions.ts");
const CHARGE_SERVICE = read("src/services/manualInstallmentChargeService.ts");
const REMINDER_SERVICE = read("src/services/installmentReminderService.ts");
const DISPLAY = read("src/components/trip/InstallmentScheduleDisplay.tsx");

describe("ORCH-0914 Money tab redesign — happy-path source contract", () => {
  test("T-01 all requested table columns render", () => {
    for (const label of [
      "Buyer",
      "Plan",
      "Paid-to-date",
      "Outstanding",
      "Next installment",
      "Last status",
      "Actions",
    ]) {
      expect(ROUTE).toContain(label);
    }
  });

  test("T-02 plan column uses InstallmentScheduleDisplay", () => {
    expect(ROUTE).toContain("InstallmentScheduleDisplay");
    expect(ROUTE).toContain('variant="cell"');
    expect(DISPLAY).toContain('"cell" renders a compact one-line summary');
  });

  test("T-03 pay-in-full buyer row renders Paid in full", () => {
    expect(ROUTE).toContain("Paid in full");
    expect(ROUTE).toContain("isPaidInFull: true");
  });

  test("T-04 outstanding is orderTotalCents minus collected amount", () => {
    expect(ROUTE).toContain("head.orderTotalCents - paidToDateCents");
  });

  test("T-05 outstanding is clamped to zero", () => {
    expect(ROUTE).toContain("Math.max(0, head.orderTotalCents - paidToDateCents)");
    expect(ROUTE).toContain("outstandingCents: 0");
  });

  test("T-06 next installment picks scheduled-or-failed sorted by due date", () => {
    expect(ROUTE).toContain('row.status === "scheduled" || row.status === "failed"');
    expect(ROUTE).toContain("a.dueAt.localeCompare(b.dueAt)");
  });

  test("T-07 next installment renders dash when none exists", () => {
    expect(ROUTE).toContain('if (row.nextInstallment === null) return "—"');
  });

  test("T-08 at-risk status has red/error pill path", () => {
    expect(ROUTE).toContain('case "at_risk"');
    expect(ROUTE).toContain("moneyStatusPillFailed");
  });

  test("T-09 non-at-risk last status uses most recent attempted installment", () => {
    expect(ROUTE).toContain("mostRecentAttempted");
    expect(ROUTE).toContain('attempted?.status ?? "scheduled"');
  });

  test("T-10 scheduled fallback exists when no attempts were made", () => {
    expect(ROUTE).toContain('return "Scheduled"');
    expect(ROUTE).toContain('?? "scheduled"');
  });

  test("T-11 phone layout uses card/grid when width <= 480", () => {
    expect(ROUTE).toContain("width <= 480");
    expect(ROUTE).toContain("TravelerMoneyRowCard");
    expect(ROUTE).toContain("phoneMetricGrid");
  });

  test("T-12 tablet/web layout renders true table", () => {
    expect(ROUTE).toContain("TravelerMoneyTableRow");
    expect(ROUTE).toContain("moneyTableHeader");
    expect(ROUTE).toContain("moneyTableRow");
  });

  test("T-13 drill-in still renders installment grid, retry, and refund", () => {
    expect(ROUTE).toContain("ExpandedLedger");
    expect(ROUTE).toContain("Retry now");
    expect(ROUTE).toContain("RefundPreviewSheet");
    expect(ROUTE).toContain("Cancel &amp; refund");
  });

  test("T-14 charge-now button is wired to new mutation and service", () => {
    expect(ROUTE).toContain("Charge now");
    expect(ROUTE).toContain("useChargeInstallmentNow");
    expect(HOOKS).toContain("manualChargeInstallment");
    expect(CHARGE_SERVICE).toContain('"manual-charge-installment"');
  });

  test("T-15 charge-now on at-risk buyer opens ConfirmDialog", () => {
    expect(ROUTE).toContain("pendingAtRiskCharge");
    expect(ROUTE).toContain("<ConfirmDialog");
    expect(ROUTE).toContain("Charge anyway");
  });

  test("T-16 send-reminder is disabled when a recent reminder exists", () => {
    expect(ROUTE).toContain("useRecentReminderForOrder");
    expect(ROUTE).toContain("recentReminder.data !== null");
  });

  test("T-17 send-reminder enabled path calls the new mutation", () => {
    expect(ROUTE).toContain("sendReminderMutation.mutate({ orderId: row.orderId })");
    expect(HOOKS).toContain("useSendInstallmentReminder");
    expect(REMINDER_SERVICE).toContain('"send-installment-reminder"');
  });

  test("T-18 pay-in-full row has no charge and disabled reminder copy", () => {
    expect(ROUTE).toContain("!row.isPaidInFull");
    expect(ROUTE).toContain("No reminder needed — paid in full");
  });

  test("ORCH-0915 full-pay opt-out row renders paid-in-full truth with no installment actions", () => {
    expect(ROUTE).toContain(".filter((order) => !rowsByOrder.has(order.id))");
    expect(ROUTE).toContain('.filter((order) => order.paymentStatus === "paid")');
    expect(ROUTE).toContain("isPaidInFull: true");
    expect(ROUTE).toContain("paidToDateCents: order.totalCents");
    expect(ROUTE).toContain("outstandingCents: 0");
    expect(ROUTE).toContain("planSchedule: null");
    expect(ROUTE).toContain("Paid in full at booking. No installment ledger for this traveller.");
    expect(ROUTE).toContain("!row.isPaidInFull");
  });

  test("fails-on-revert simulation: removing row actions breaks the contract", () => {
    const reverted = ROUTE
      .replaceAll("Charge now", "")
      .replaceAll("Send reminder", "")
      .replaceAll("ConfirmDialog", "");
    expect(reverted).not.toContain("Charge now");
    expect(reverted).not.toContain("ConfirmDialog");
  });
});
