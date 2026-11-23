import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../../");
const route = readFileSync(
  resolve(root, "app/trip-balance/[orderId].tsx"),
  "utf8",
);
const purchase = readFileSync(
  resolve(root, "app/purchases/[kind]/[id].tsx"),
  "utf8",
);
const service = readFileSync(
  resolve(root, "src/services/tripBalancePayService.ts"),
  "utf8",
);
const flags = readFileSync(resolve(root, "src/config/featureFlags.ts"), "utf8");
const keys = readFileSync(resolve(root, "src/hooks/queryKeys.ts"), "utf8");

test("#4522 Explorer balance defaults on, keeps an explicit false kill switch and stays trip-only", () => {
  assert.match(flags, /EXPO_PUBLIC_FF_TRIP_BALANCE !== "false"/);
  assert.match(
    purchase,
    /FEATURE_FLAG_TRIP_BALANCE && order\?\.eventType === "trip"/,
  );
  assert.match(purchase, /<TripBalanceCard orderId=\{order\.id\}/);
});

test("#4522 the screen has the approved choices, schedule preview and buyer states", () => {
  for (
    const contract of [
      "Balance remaining",
      "Choose what to pay",
      "Your remaining payments update after you pay",
      "Paid so far",
      "Enter an amount.",
      "That's more than your balance",
      "The smallest payment is",
      "Couldn't load your balance",
      "You're offline",
      "Paid in full",
    ]
  ) {
    assert.ok(
      route.includes(contract),
      `missing balance contract: ${contract}`,
    );
  }
  assert.match(route, /rebalanceTripPlan\(/);
});

test("#4522 Stripe uses PaymentSheet; Paystack uses the normal browser and 2s\/30s confirmation", () => {
  assert.match(route, /initPaymentSheet\(/);
  assert.match(route, /presentPaymentSheet\(/);
  assert.match(route, /customerId: session\.customerId/);
  assert.match(
    route,
    /customerEphemeralKeySecret: session\.customerEphemeralKeySecret/,
  );
  assert.match(route, /with card ending \$\{paystackLast4\}/);
  assert.match(route, /WebBrowser\.openBrowserAsync\(session\.url\)/);
  assert.doesNotMatch(route, /openAuthSessionAsync\s*\(/);
  assert.match(route, /POLL_INTERVAL_MS = 2_000/);
  assert.match(route, /POLL_BUDGET_MS = 30_000/);
  assert.match(route, /remainingMinor < expectedRemainingMinor/);
  assert.match(
    route,
    /Payment wasn't completed\. Your balance has not been changed\./,
  );
  assert.match(service, /"trip-balance-pay"/);
  assert.match(
    service,
    /startsWith\("https:\/\/host\.usemingla\.com\/pay\/balance\/"\)/,
  );
});

test("#4522 Explorer maps every buyer-facing balance refusal to approved copy", () => {
  for (
    const contract of [
      "payment_plan_v2_unavailable",
      "balance_payment_in_flight",
      "flex_amount_invalid",
      "flex_amount_below_minimum",
      "flex_amount_leaves_unpayable_remainder",
      "balance_below_provider_minimum",
      "plan_not_flexible",
      "deposit_not_paid",
      "balance_not_found",
    ]
  ) assert.ok(route.includes(contract), `missing refusal mapping: ${contract}`);
  assert.match(
    route,
    /Your balance just changed\. Check the new amount and try again\./,
  );
});

test("#4522 one query-key factory invalidates both balance and purchase truth", () => {
  assert.match(keys, /export const tripBalanceKeys/);
  assert.match(route, /tripBalanceKeys\.detail\(orderId\)/);
  assert.match(route, /purchaseKeys\.all/);
  assert.match(route, /error\.code === "balance_changed"/);
  assert.match(route, /setCustomError\(\s*"Your balance just changed/s);
});

test("#4522 T4-3 / T4-8 both balance screens: a forbidden amount names the two payable amounts; a long block never says a few minutes", () => {
  const shared = readFileSync(resolve(root, "../packages/offering-rendering/tripBalance.ts"), "utf8");
  assert.match(shared, /case "leaves_unpayable_remainder":\s*return unpayableRemainderCopy\(balance, money\);/);
  const buyerWeb = readFileSync(resolve(root, "../mingla-business/app/pay/balance/[token].tsx"), "utf8");
  for (const [name, screen] of [["Explorer", route], ["buyer web", buyerWeb]] as const) {
    assert.ok(screen.includes("flex_amount_leaves_unpayable_remainder"), `${name}: server refusal`);
    // S-3: the client-side refusal copy is the shared one (it maps
    // "leaves_unpayable_remainder" to unpayableRemainderCopy), shown live.
    assert.ok(screen.includes("tripBalanceAmountErrorCopy("), `${name}: refused before any request`);
    assert.ok(screen.includes("unpayableRemainderCopy("), `${name}: shared copy naming both amounts`);
    // I-4522-NEVER-WRITE-OFF: no "written off" state; a balance too small to
    // charge stays owed, with the shared line and no pay button.
    assert.ok(screen.includes('"balance_below_provider_minimum"'), `${name}: too small to charge`);
    assert.ok(screen.includes("tripBalanceBelowProviderMinimum(") && screen.includes("tripBalanceSmallRemainderCopy("),
      `${name}: shared small-balance rule and line`);
    assert.ok(!screen.includes('"balance_settled"') && !screen.includes("too small to charge, so it has been cleared"),
      `${name}: no write-off`);
    assert.doesNotMatch(screen, /already processing\. Try again in a few minutes/, `${name}: T4-8 copy`);
    assert.match(screen, /still being confirmed\. You can pay again once it's confirmed, within 24 hours\./);
  }
});
