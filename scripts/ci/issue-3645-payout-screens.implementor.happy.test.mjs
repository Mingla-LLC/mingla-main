import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const absolute = (path) => join(repoRoot, path);
const read = (path) => readFileSync(absolute(path), "utf8");
const required = (path, values, source = read(path)) => {
  for (const value of values) {
    assert.ok(source.includes(value), `${path} must include ${JSON.stringify(value)}`);
  }
  return source;
};

const walk = (root) => readdirSync(absolute(root)).flatMap((name) => {
  const path = join(root, name);
  if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) return [];
  return statSync(absolute(path)).isDirectory() ? walk(path) : [path];
});

const surfaceContracts = [
  {
    surface: "Organiser Terms",
    path: "mingla-marketing/lib/organiserTermsContent.ts",
    values: [
      "Mingla keeps 4.5% of the ticket price on each paid sale (a 1.5% Mingla fee and a 3% service fee). You choose whether Buyers pay it on top.",
      "Mingla pays payment-provider card processing. Stripe’s automatic-tax fee (about 0.5%) is paid by you and shown separately. In Nigeria, the bank transfer fee and ₦50 stamp duty on each payout are deducted from that payout.",
    ],
  },
  {
    surface: "marketing payout card",
    path: "mingla-marketing/components/sections/organiser-home/dining-dashboard-card.tsx",
    values: [
      "Keep 100% of your ticket price when buyers cover the fee",
      "Paid about a day after each sale",
    ],
  },
  {
    surface: "host help",
    path: "mingla-marketing/content/help/registry.ts",
    values: [
      "Mingla keeps 4.5% of the ticket price on each paid sale",
      "Mingla pays payment-provider card processing.",
      "Stripe’s automatic-tax fee (about 0.5%) is paid by you and shown separately.",
    ],
  },
  {
    surface: "Home money tile",
    path: "mingla-business/app/(tabs)/home.tsx",
    values: ["COMING TO YOU", "Sales this week (what buyers paid)", "Paid to your bank this month", "Open Payments"],
  },
  {
    surface: "Payments overview",
    path: "mingla-business/src/components/brand/BrandPayoutOverview.tsx",
    values: ["Coming to you", "Paid this month", "Download payouts CSV", "rowTiming(next)"],
  },
  {
    surface: "payout detail",
    path: "mingla-business/src/components/brand/BrandPayoutDetailView.tsx",
    values: ["How we got to this number", "Card processing", "Mingla pays", "Stripe automatic-tax fee (~0.5%)", "Mingla owes you"],
  },
  {
    surface: "order detail",
    path: "mingla-business/app/event/[id]/orders/[oid]/index.tsx",
    values: ["Paid · payout:", "Card processing", "Mingla pays", "You get"],
  },
  {
    surface: "event money card",
    path: "mingla-business/app/event/[id]/index.tsx",
    values: ["onOpenPayouts", "`/brand/${event.brandId}/payments`"],
  },
  {
    surface: "experience money card",
    path: "mingla-business/app/experience/[id]/index.tsx",
    values: ["onOpenPayouts", "`/brand/${experience.brandId}/payments`"],
  },
  {
    surface: "trip money card",
    path: "mingla-business/app/trip/[id]/index.tsx",
    values: ["onOpenPayouts", "`/brand/${trip.brandId}/payments`"],
  },
  {
    surface: "event reconciliation",
    path: "mingla-business/app/event/[id]/reconciliation.tsx",
    values: ["Mingla fee (4.5% on new sales)", "Card processing", "Mingla pays", "Bank transfer fee shown on payout"],
  },
  {
    surface: "Finance reports",
    path: "mingla-business/src/components/brand/BrandFinanceReportsView.tsx",
    values: ["Buyers paid", "Mingla fee", "Card processing", "Mingla pays", "Stripe automatic-tax fee (~0.5%)", "Paid to bank", "Mingla owes back"],
  },
  {
    surface: "pricing preview",
    path: "mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
    values: ["Buyers pay it", "I cover it", "You get per ticket"],
  },
  {
    surface: "todos",
    path: "mingla-business/src/utils/businessTodos.ts",
    values: ["Add a bank to get", "Fix your bank details", "Finish verification to get paid"],
  },
  {
    surface: "notifications",
    path: "mingla-business/src/constants/businessNotificationTemplates.ts",
    values: [
      "New sale",
      "you'll get {amount}, paid out about a day from now.",
      "Paid to your bank",
      "{amount} reached your bank.",
      "Your {amount} payout is late. That’s on us, and we’re on it. No action needed.",
      "{amount} came out of this payout for a refund after an earlier payout.",
    ],
  },
  {
    surface: "notification producer",
    path: "supabase/functions/_shared/businessNotifyTriggers.ts",
    values: ["you'll get ${formatMoneyCents(hostNetCents as number, currency)}, paid out about a day from now."],
  },
  {
    surface: "Admin payout console",
    path: "mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx",
    values: ["Money ledger · Payouts", "Late, on us", "Mingla owes back", 'filterVariant="chips"'],
  },
];
for (const contract of surfaceContracts) required(contract.path, contract.values);

const tripMoneySource = required("mingla-business/app/trip/[id]/money/index.tsx", [
  'formatCurrencyAmount(cents, currency, true)',
]);
assert.ok(
  !tripMoneySource.includes("cents / 100"),
  "trip money must use the shared currency minor-unit factor",
);
const hostFacingRoots = [
  "mingla-business/app",
  "mingla-business/src/components",
  "mingla-business/src/constants",
  "mingla-marketing/components",
  "mingla-marketing/content",
  "mingla-marketing/lib",
  "mingla-admin/src/pages",
];
const forbidden = [
  "settles in 3–5 days",
  "settles in 3-5 days",
  "event end + 3 days",
  "99% kept",
  "Released after your events",
  "Mingla fee (2% + £0.30)",
  "Payment processing fee",
];
const assertNoForbidden = (path, source) => {
  for (const phrase of forbidden) {
    assert.ok(!source.includes(phrase), `${path} still contains stale payout copy ${JSON.stringify(phrase)}`);
  }
};
for (const path of hostFacingRoots.flatMap(walk)) {
  if (!/\.(?:js|jsx|ts|tsx)$/.test(path)) continue;
  assertNoForbidden(path, read(path));
}

if (process.argv.includes("--self-test")) {
  for (const contract of surfaceContracts) {
    const first = contract.values[0];
    assert.throws(
      () => required(contract.path, [first], read(contract.path).split(first).join("")),
      /must include/,
      `${contract.surface} must fail if its payout contract is reverted`,
    );
  }
  assert.throws(
    () => assertNoForbidden("reverted-host-copy.tsx", "Paid · settles in 3–5 days"),
    /stale payout copy/,
  );
  console.log("#3645 payout-screen RED proof: required truth and stale-copy reverts rejected");
}

console.log("#3645 payout-screen source contract: ok");
