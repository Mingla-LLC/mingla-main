import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");
const page = readFileSync(join(root, "app/pay/balance/[token].tsx"), "utf8");
const installment = readFileSync(join(root, "app/pay/[token].tsx"), "utf8");
const service = readFileSync(
  join(root, "src/services/tripBalancePayService.ts"),
  "utf8",
);
const stripe = readFileSync(
  join(root, "src/components/trip/TripBalanceStripePayment.web.tsx"),
  "utf8",
);

describe("#4522 anonymous trip balance page", () => {
  test("keeps the token as the only credential and never mounts an auth hook", () => {
    expect(page).not.toMatch(/useAuth|requireAuth|sessionStorage|localStorage/);
    expect(service).toContain('"trip-balance-pay"');
    expect(service).toContain("body: { ...body, token }");
    expect(service).not.toMatch(/console\.|capture\(/);
  });

  test("covers loading, expiry, paid, in-flight, retry and 2s/30s return polling", () => {
    for (
      const copy of [
        "Loading your balance",
        "This balance link has expired",
        "Paid in full",
        "Nothing to pay",
        "We're still confirming your payment",
        "Something went wrong",
        "Payment couldn't start",
      ]
    ) expect(page).toContain(copy);
    expect(page).toContain("POLL_INTERVAL_MS = 2_000");
    expect(page).toContain("POLL_BUDGET_MS = 30_000");
    expect(page).toContain('first(params.return) === "1"');
    expect(page).toContain("remainingMinor < expectedRemainingMinor");
    expect(page).not.toContain(
      "expectedRemainingMinor === null && view.balance?.paymentInFlight !== true",
    );
    expect(page).toContain(
      "Payment wasn't completed. Your balance has not been changed.",
    );
    expect(page).toContain("?return=1&expected=");
  });

  test("maps every buyer-facing balance refusal to approved visible copy", () => {
    for (
      const contract of [
        "payment_plan_v2_unavailable",
        "balance_payment_in_flight",
        "flex_amount_invalid",
        "flex_amount_below_minimum",
        "plan_not_flexible",
        "deposit_not_paid",
        "balance_not_found",
      ]
    ) expect(page).toContain(contract);
    expect(page).toContain(
      "Your balance just changed. Check the new amount and try again.",
    );
  });

  test("owns one lazy Stripe Elements rail and a validated Paystack redirect", () => {
    expect(page).toMatch(
      /React\.lazy\(\(\)\s*=>\s*import\("\.\.\/\.\.\/\.\.\/src\/components\/trip\/TripBalanceStripePayment"\)/s,
    );
    expect(stripe).toContain('nextElements.create("payment")');
    expect(stripe).toContain('redirect: "if_required"');
    expect(service).toContain('startsWith("https://checkout.paystack.com/")');
  });

  test("the old installment page shows the approved secondary entry only when flex was minted", () => {
    expect(installment).toContain("Pay a different amount");
    expect(installment).toContain("link.balance?.flexEnabled");
    expect(installment).toContain("/pay/balance/");
  });
});
