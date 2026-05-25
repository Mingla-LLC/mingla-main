import { readFileSync } from "node:fs";
import { join } from "node:path";

const businessRoot = join(__dirname, "..", "..", "..", "..");
const repoRoot = join(businessRoot, "..");
const readBusiness = (rel: string): string =>
  readFileSync(join(businessRoot, rel), "utf8");
const readRepo = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const PAYMENT_ROUTE = readBusiness("app/checkout-trip/[tripEventId]/payment.tsx");
const MONEY_ROUTE = readBusiness("app/trip/[id]/money/index.tsx");
const MIGRATION = readRepo(
  "supabase/migrations/20260724000007_orch_0915_pay_in_full_opt_out.sql",
);

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const paymentSource = stripComments(PAYMENT_ROUTE);
const moneySource = stripComments(MONEY_ROUTE);
const migrationSource = stripComments(MIGRATION);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("ORCH-0915 pay-in-full choice — adversarial source contract", () => {
  test("T-A01 rapid full/installment toggles mutate only the choice, not cart, buyer, intake, restore, or checkout state", () => {
    const controlWindow = sourceBetween(
      paymentSource,
      "Payment option",
      "planDisclosureWrap",
    );

    expect(controlWindow.match(/setPaymentPlanChoice\("full"\)/g)).toHaveLength(1);
    expect(controlWindow.match(/setPaymentPlanChoice\("installments"\)/g)).toHaveLength(1);
    for (const forbidden of [
      "setLineQuantity",
      "setBuyer",
      "writeCheckoutResumePayload",
      "readCheckoutResumePayload",
      "setCheckoutSessionId",
      "setPaymentError",
      "setProcessing",
      "intakeFormDataArray",
    ]) {
      expect(controlWindow).not.toContain(forbidden);
    }
  });

  test("T-A02 browser refresh restores legacy cart/buyer payload only and deterministically defaults choice back to full", () => {
    const restoreWindow = sourceBetween(
      paymentSource,
      "const payload = readCheckoutResumePayload(storage, tripEventId);",
      "setRestoreChecked(true);",
    );

    expect(paymentSource).toContain('useState<PaymentPlanChoice>("full")');
    expect(restoreWindow).toContain("readCheckoutResumePayload");
    expect(restoreWindow).toContain("setLineQuantity");
    expect(restoreWindow).toContain("setBuyer(payload.buyer)");
    expect(restoreWindow).not.toContain("setPaymentPlanChoice");
    expect(restoreWindow).not.toContain("paymentPlanChoice");
    expect(paymentSource).toContain(
      "writeCheckoutResumePayload(storage, tripEventId, {",
    );
    const persistWindow = sourceBetween(
      paymentSource,
      "writeCheckoutResumePayload(storage, tripEventId, {",
      "const w = globalThis",
    );
    expect(persistWindow).toContain("lines");
    expect(persistWindow).toContain("buyer");
    expect(persistWindow).not.toContain("paymentPlanChoice");
  });

  test("T-A03 multi-tier carts with any plan tier still hit ticket_lines_mixed_with_installments before full-choice suppression", () => {
    const guardIndex = migrationSource.indexOf("ticket_lines_mixed_with_installments");
    const suppressionIndex = migrationSource.indexOf("p_payment_plan_choice <> 'full'");

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(suppressionIndex).toBeGreaterThan(guardIndex);
    const guardWindow = migrationSource.slice(
      migrationSource.lastIndexOf("IF v_line_count > 1", guardIndex),
      migrationSource.indexOf("END IF;", guardIndex) + "END IF;".length,
    );
    expect(guardWindow).toContain("IF v_line_count > 1 THEN");
    expect(guardWindow).not.toContain("p_payment_plan_choice");
  });

  test("T-A04 mixed-mode Money tab data model keeps installment orders and full-pay orders as distinct row types in the same trip", () => {
    const moneyDataWindow = sourceBetween(
      moneySource,
      "const moneyData = useMemo(() => {",
      "const atRiskOrderCount",
    );

    expect(moneyDataWindow).toContain("const rowsByOrder = new Map");
    expect(moneyDataWindow).toContain("const installmentRows = [...rowsByOrder.values()].map(deriveInstallmentRow)");
    expect(moneyDataWindow).toContain(".filter((order) => !rowsByOrder.has(order.id))");
    expect(moneyDataWindow).toContain('.filter((order) => order.paymentStatus === "paid")');
    expect(moneyDataWindow).toContain("isPaidInFull: true");
    expect(moneyDataWindow).toContain("paidToDateCents: order.totalCents");
    expect(moneyDataWindow).toContain("outstandingCents: 0");
    expect(moneyDataWindow).toContain("planSchedule: null");
    expect(moneyDataWindow).toContain("const rows = [...installmentRows, ...paidInFullRows]");
    expect(moneySource).toMatch(/isPaidInFull:\s*false[\s\S]{0,180}planSchedule:\s*\{/);
    expect(moneySource).toContain("Paid in full at booking. No installment ledger for this traveller.");
  });

  test("T-A05 full-pay branch cannot leak the installment schedule card, banner, or deposit CTA after toggle-back", () => {
    expect(paymentSource).toContain(
      'const isUsingInstallments = isPlanActive && paymentPlanChoice === "installments";',
    );
    expect(paymentSource).toMatch(
      /isUsingInstallments\s*&&\s*projectedSchedule\s*!==\s*null\s*\?\s*\(/,
    );
    expect(paymentSource).toMatch(
      /isPlanActive\s*&&\s*projectedSchedule\s*!==\s*null\s*&&\s*isUsingInstallments\s*\?\s*\(/,
    );
    expect(paymentSource).toMatch(
      /isPlanActive\s*&&\s*projectedSchedule\s*!==\s*null\s*&&\s*!isUsingInstallments\s*\?\s*\(/,
    );
    expect(paymentSource).toContain("Paid in full today");
    expect(paymentSource).toContain("No future installment bills will be scheduled for this booking.");
  });
});
