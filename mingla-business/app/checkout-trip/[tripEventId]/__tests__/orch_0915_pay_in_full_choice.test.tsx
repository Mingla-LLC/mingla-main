import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "../payment.tsx"), "utf8");

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

describe("ORCH-0915 trip payment choice source contract", () => {
  it("renders an accessible two-option payment control for plan-active tiers", () => {
    expect(activeSource).toContain('type PaymentPlanChoice = "full" | "installments"');
    expect(activeSource).toContain('useState<PaymentPlanChoice>("full")');
    expect(activeSource).toContain("Payment option");
    expect(activeSource).toContain("Pay full");
    expect(activeSource).toContain("Use payment plan");
    expect(activeSource).toContain('accessibilityRole="radiogroup"');
    expect(activeSource).toContain('accessibilityRole="radio"');
    expect(activeSource).toContain('accessibilityState={{ selected: paymentPlanChoice === "full" }}');
    expect(activeSource).toContain('accessibilityState={{ selected: paymentPlanChoice === "installments" }}');
  });

  it("defaults to full pay and gates the control to plan-active tiers only", () => {
    const controlIndex = activeSource.indexOf("Payment option");
    const scheduleIndex = activeSource.indexOf("planDisclosureWrap");
    expect(controlIndex).toBeGreaterThan(activeSource.indexOf("ORDER SUMMARY"));
    expect(scheduleIndex).toBeGreaterThan(controlIndex);
    expect(activeSource).toContain("isPlanActive && projectedSchedule !== null ? (");
    expect(activeSource).toContain('const isUsingInstallments = isPlanActive && paymentPlanChoice === "installments";');
  });

  it("updates copy, sticky banner, and CTA for both branches", () => {
    expect(activeSource).toContain("No future installment bills will be scheduled for this booking.");
    expect(activeSource).toContain("future uncollected installments");
    expect(activeSource).toContain("Paid in full today");
    expect(activeSource).toContain("Payment plan active");
    expect(activeSource).toContain('`Pay ${formatCurrency(projectedSchedule.depositCents, projectedSchedule.currency, true)} deposit`');
    expect(activeSource).toContain('`Pay ${formatCurrency(totals.total, totals.currency)}`');
  });

  it("passes explicit full/installment choices without clearing cart, buyer, or intake state", () => {
    expect(activeSource).toContain("paymentPlanChoice:");
    expect(activeSource).toContain("paymentPlanChoice: paymentPlanChoice");
    const choiceControlWindow = activeSource.slice(
      activeSource.indexOf("Payment option"),
      activeSource.indexOf("planDisclosureWrap"),
    );
    expect(choiceControlWindow).toContain("setPaymentPlanChoice");
    expect(choiceControlWindow).not.toContain("setLineQuantity");
    expect(choiceControlWindow).not.toContain("setBuyer");
    expect(choiceControlWindow).not.toContain("intakeFormData");
  });
});
