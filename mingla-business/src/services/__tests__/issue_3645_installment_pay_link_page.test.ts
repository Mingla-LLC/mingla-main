import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUSINESS_ROOT = join(__dirname, "..", "..", "..");
const page = readFileSync(join(BUSINESS_ROOT, "app", "pay", "[token].tsx"), "utf8");
const service = readFileSync(
  join(BUSINESS_ROOT, "src", "services", "installmentPayLinkService.ts"),
  "utf8",
);

describe("#3645 anonymous installment pay-link page", () => {
  it.each([
    "Pay your trip instalment",
    "Approve your payment",
    "Loading payment",
    "Checking your payment…",
    "Payment received",
    "Nothing to pay",
    "This link isn't valid",
    "We're still confirming your payment",
    "Something went wrong",
    "Payment already started",
  ])("covers the %s state", (copy) => expect(page).toContain(copy));

  it("polls a returning payment and exposes accessible summary and button labels", () => {
    expect(page).toContain("POLL_INTERVAL_MS = 2_000");
    expect(page).toContain("POLL_BUDGET_MS = 30_000");
    expect(page).toContain('accessibilityRole="summary"');
    expect(page).toContain('accessibilityRole="button"');
    expect(page).toContain("amountA11y");
  });

  it("has no auth hook and sends the token only to the dedicated function", () => {
    expect(page).not.toMatch(/useAuth|requireAuth|sessionStorage|localStorage/);
    expect(service).toContain('"installment-pay-link"');
    expect(service).toContain("{ body: { token, action } }");
    expect(service).toContain('startsWith("https://checkout.paystack.com/")');
    expect(service).not.toMatch(/console\.|capture\(/);
  });
});
