#!/usr/bin/env node
/** #4522 — a flexible payment and a planned charge never run on one order at once; a rebalanced row never reuses a Stripe key; the balance page and published editor keep their approved structure. */
// MINGLA-INVARIANT: I-4522-FLEX-CLAIM-GUARD | issue #4522 | The charge claim and the Paystack attempt refuse a planned row while a flexible payment is open, the cron never notices, charges or retries a flexible row, and a rebalanced row's Stripe idempotency key carries its schedule version.

import fs from "node:fs";
import path from "node:path";

/** The latest body of a function across the migrations (sorted by name). */
export function latestFunctionBody(migrations, name) {
  const pattern = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`,
    "i",
  );
  let body = null;
  for (const [file, sql] of Object.entries(migrations).sort(([a], [b]) => (a < b ? -1 : 1))) {
    let from = 0;
    for (;;) {
      const rest = sql.slice(from);
      const match = pattern.exec(rest);
      if (match === null) break;
      const start = from + match.index;
      const tagMatch = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(start));
      if (tagMatch === null) break;
      const tagAt = start + tagMatch.index + tagMatch[0].length;
      const end = sql.indexOf(tagMatch[1], tagAt);
      body = { file, text: sql.slice(start, end === -1 ? sql.length : end) };
      from = end === -1 ? sql.length : end + tagMatch[1].length;
    }
  }
  return body;
}

export function flexClaimGuardFailures({ migrations, scheduler, createInstallmentPI }) {
  const failures = [];
  const claim = latestFunctionBody(migrations, "claim_order_installment_for_charge");
  if (
    claim === null || !/issue_4522_order_has_open_flex\(/.test(claim.text) ||
    !/'flex_payment_in_flight'/.test(claim.text) || !/'flex_not_cron_chargeable'/.test(claim.text)
  ) {
    failures.push(
      `claim_order_installment_for_charge (${claim?.file ?? "missing"}): must refuse a flex row and any planned row while a flexible payment is open`,
    );
  }
  const attempt = latestFunctionBody(migrations, "issue_3645_begin_installment_attempt");
  if (
    attempt === null || !/issue_4522_order_has_open_flex\(/.test(attempt.text) ||
    !/'flex_payment_in_flight'/.test(attempt.text)
  ) {
    failures.push(
      `issue_3645_begin_installment_attempt (${attempt?.file ?? "missing"}): must refuse a planned row while a flexible payment is open`,
    );
  }
  const kindFilters = (scheduler.match(/\.eq\("kind", "scheduled"\)/g) ?? []).length;
  if (kindFilters < 3) {
    failures.push(
      `process-scheduled-installments: the due, retry and notice queries must each filter kind = 'scheduled' (found ${kindFilters})`,
    );
  }
  if (!/installmentKeyVersionSuffix\(installment\.schedule_version\)/.test(createInstallmentPI)) {
    failures.push(
      "createInstallmentPI: the Stripe idempotency key must carry the row's schedule version (I-4522-5)",
    );
  }
  return failures;
}

// ---------------------------------------------------------------------------
// #4522 published surfaces — the source-shape half of the balance-link page and
// the published trip editor (I-4522-PUBLISHED-EDITOR-PARITY). Behaviour lives in
// mingla-business jest suites (issue_4522_balance_page / _published_editor);
// what is checked here is structure no unit can execute: which states and
// refusal copy a route renders, where a lazy owner sits, and call ORDER.
// ---------------------------------------------------------------------------

export const PUBLISHED_SURFACE_FILES = {
  balancePage: "mingla-business/app/pay/balance/[token].tsx",
  installmentPage: "mingla-business/app/pay/[token].tsx",
  stripeRail: "mingla-business/src/components/trip/TripBalanceStripePayment.web.tsx",
  editorScreen: "mingla-business/src/components/trip/EditPublishedTripScreen.tsx",
  changeModal: "mingla-business/src/components/event/ChangeSummaryModal.tsx",
  intake: "mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx",
  settings: "mingla-business/src/components/trip/EditPublishedTripSettingsAccordion.tsx",
};

export function publishedSurfaceFailures(src) {
  const failures = [];
  const need = (key, token, rule) => {
    const hit = token instanceof RegExp ? token.test(src[key] ?? "") : (src[key] ?? "").includes(token);
    if (!hit) failures.push(`${rule}: ${key} must contain ${String(token)}`);
  };
  const forbid = (key, token, rule) => {
    const hit = token instanceof RegExp ? token.test(src[key] ?? "") : (src[key] ?? "").includes(token);
    if (hit) failures.push(`${rule}: ${key} must not contain ${String(token)}`);
  };

  // Balance link page: the URL token is the only credential.
  forbid("balancePage", /useAuth|requireAuth|sessionStorage|localStorage/, "balance page anonymity");
  for (const copy of [
    "Loading your balance",
    "This balance link has expired",
    "Paid in full",
    "Nothing to pay",
    "We're still confirming your payment",
    "Something went wrong",
    "Payment couldn't start",
    "Payment wasn't completed. Your balance has not been changed.",
    "Your balance just changed. Check the new amount and try again.",
  ]) need("balancePage", copy, "balance page states");
  for (const code of [
    "payment_plan_v2_unavailable",
    "balance_payment_in_flight",
    "flex_amount_invalid",
    "flex_amount_below_minimum",
    "plan_not_flexible",
    "deposit_not_paid",
    "balance_not_found",
  ]) need("balancePage", `case "${code}":`, "balance page refusal copy");
  for (const token of [
    "POLL_INTERVAL_MS = 2_000",
    "POLL_BUDGET_MS = 30_000",
    'first(params.return) === "1"',
    "remainingMinor < expectedRemainingMinor",
    "?return=1&expected=",
  ]) need("balancePage", token, "balance page return polling");
  forbid(
    "balancePage",
    "expectedRemainingMinor === null && view.balance?.paymentInFlight !== true",
    "balance page return polling",
  );
  need(
    "balancePage",
    /React\.lazy\(\(\)\s*=>\s*import\("\.\.\/\.\.\/\.\.\/src\/components\/trip\/TripBalanceStripePayment"\)/,
    "balance page lazy Stripe rail",
  );
  need("stripeRail", 'nextElements.create("payment")', "balance page lazy Stripe rail");
  need("stripeRail", 'redirect: "if_required"', "balance page lazy Stripe rail");
  for (const token of ["Pay a different amount", "link.balance?.flexEnabled", "/pay/balance/"]) {
    need("installmentPage", token, "installment page flex entry");
  }

  // Published trip editor: the builder's four sections in one scroll.
  const screen = src.editorScreen ?? "";
  const sectionBlock = screen.match(/const BUILDER_SECTIONS:[\s\S]*?\n\];/)?.[0] ?? "";
  const keys = (sectionBlock.match(/key:\s*"[^"]+"/g) ?? []).map((k) => k.replace(/\s+/g, " "));
  if (JSON.stringify(keys) !== JSON.stringify(['key: "trip"', 'key: "itinerary"', 'key: "pricing"', 'key: "travelers"'])) {
    failures.push(`published editor sections: BUILDER_SECTIONS must be trip, itinerary, pricing, travelers (got ${JSON.stringify(keys)})`);
  }
  for (const token of [
    "BUILDER_STEP_TITLES[1]",
    "BUILDER_STEP_TITLES[4]",
    'layout="list"',
    "renderBuilderSectionBody(section.key)",
  ]) need("editorScreen", token, "published editor sections");
  forbid("editorScreen", "openSection", "published editor sections");
  for (const component of [
    "TripCreatorStep1Basics",
    "TripCreatorStep2Itinerary",
    "TripInclusionChips",
    "TripCreatorStep3Inclusions",
    "TripCreatorStep4Pricing",
    "TripBuilderSectionTitle",
    "TripEarningsCard",
    "TripQuestionLibrary",
  ]) {
    if (!`${screen}\n${src.intake ?? ""}`.includes(component)) {
      failures.push(`published editor reuse: the editor must reuse ${component}`);
    }
  }
  need("editorScreen", "builderV2", "published editor reuse");
  need("settings", "builderV2", "published editor reuse");

  // Reason prompt only when the classifier says so.
  need("editorScreen", "liveTripEditNeedsBuyerReason(trip, patch)", "published editor reason");
  need("editorScreen", "reasonRequired={modal.reasonRequired}", "published editor reason");
  need("editorScreen", 'reasonPrompt="What changed and why? Travelers will see this."', "published editor reason");
  need(
    "editorScreen",
    /const auditReason = modal\.reasonRequired\s*\? reason\s*:\s*NON_BUYER_EDIT_AUDIT_REASON/,
    "published editor reason",
  );
  need("changeModal", "reasonRequired = true", "published editor reason");
  need("changeModal", "{reasonRequired ? (", "published editor reason");
  need("intake", "<TripQuestionLibrary", "published editor questions");
  need("intake", "reason: NON_BUYER_EDIT_AUDIT_REASON", "published editor questions");
  forbid("intake", "Reason for change", "published editor questions");
  forbid("intake", "reasonDialogVisible", "published editor questions");

  // #4514 brand-form questions stay lazy and inside Travelers.
  for (const token of [
    'import("../forms/formsOwner")',
    "default: m.GuestQuestionsRow",
    'testID="edit-guest-questions-row"',
    'kind="trip"',
    "brandId={trip.brandId}",
  ]) need("editorScreen", token, "published editor brand-form row");
  const intakeAt = screen.indexOf('{renderSectionBody("intake")}');
  const questionsAt = screen.indexOf("<GuestQuestionsRow", intakeAt);
  const buyerAt = screen.indexOf("<EventTicketCheckoutAccessCard", questionsAt);
  if (!(intakeAt > -1 && questionsAt > intakeAt && buyerAt > questionsAt)) {
    failures.push("published editor brand-form row: GuestQuestionsRow must sit after the intake body and before the checkout access card");
  }

  // Every package is edited and exactly one plan shape is written.
  for (const token of [
    "trip.pricingTiers.map((tier) => ({",
    "soldCount: trip.ticketsSoldCount",
    "const editPackageByTicketType = new Map(",
    "trip.pricingTiers.map<TripPricingTierInput>",
    "payment_plan: _oldPaymentPlan",
    "installments: _oldInstallments",
    "metadata.payment_plan = editPkg.paymentPlan",
    "metadata.installments = editPkg.paymentPlan",
    "if (anyTierChanged) patch.pricing_tiers = nextTierInputs",
    'scrollToBuilderSection("pricing")',
  ]) need("editorScreen", token, "published editor packages");
  forbid("editorScreen", "v2PlanAuthoringLocked", "published editor packages");

  // Plans are validated against edited prices BEFORE the review sheet and the RPC.
  const validationAt = screen.indexOf("validateTripPackages(editState.pricing.packages)");
  const reviewAt = screen.indexOf("setModal({", validationAt);
  const rpcAt = screen.indexOf("updateLiveTripMutation.mutateAsync");
  if (!(validationAt > -1 && reviewAt > validationAt && rpcAt > reviewAt)) {
    failures.push("published editor validation order: validateTripPackages must run before the review sheet, and the review before the RPC");
  }
  return failures;
}

export function readPublishedSurfaces(root) {
  return Object.fromEntries(
    Object.entries(PUBLISHED_SURFACE_FILES).map(([key, rel]) => [
      key,
      fs.readFileSync(path.join(root, rel), "utf8"),
    ]),
  );
}

/** True-source reversions the self-test applies to the live files. */
const PUBLISHED_SURFACE_REVERSIONS = [
  ["balancePage", "POLL_BUDGET_MS = 30_000", "POLL_BUDGET_MS = 10_000", "balance page return polling"],
  ["balancePage", 'case "balance_payment_in_flight":', 'case "balance_in_flight":', "balance page refusal copy"],
  ["balancePage", "This balance link has expired", "This link is invalid", "balance page states"],
  ["balancePage", "export default function", 'import { useAuth } from "x";\nexport default function', "balance page anonymity"],
  ["balancePage", "React.lazy(() =>", "(() =>", "balance page lazy Stripe rail"],
  ["installmentPage", "Pay a different amount", "Pay more", "installment page flex entry"],
  ["editorScreen", 'key: "pricing"', 'key: "settings"', "published editor sections"],
  ["editorScreen", "liveTripEditNeedsBuyerReason(trip, patch)", "true", "published editor reason"],
  ["intake", "reason: NON_BUYER_EDIT_AUDIT_REASON", "reason: reasonText", "published editor questions"],
  ["editorScreen", "validateTripPackages(editState.pricing.packages)", "validateTripPackagesLater()", "published editor validation order"],
  ["editorScreen", 'import("../forms/formsOwner")', 'import("../forms/GuestQuestionsRow")', "published editor brand-form row"],
];

if (process.argv.includes("--self-test")) {
  const goodClaim =
    "CREATE OR REPLACE FUNCTION public.claim_order_installment_for_charge(p uuid) RETURNS jsonb AS $fn$ BEGIN IF v_inst.kind = 'flex' THEN RETURN 'flex_not_cron_chargeable'; END IF; IF public.issue_4522_order_has_open_flex(v_order.id) THEN RETURN 'flex_payment_in_flight'; END IF; END $fn$;";
  const goodAttempt =
    "CREATE OR REPLACE FUNCTION public.issue_3645_begin_installment_attempt(p uuid) RETURNS jsonb AS $fn$ BEGIN IF public.issue_4522_order_has_open_flex(o) THEN RETURN 'flex_payment_in_flight'; END IF; END $fn$;";
  const oldClaim =
    "CREATE OR REPLACE FUNCTION public.claim_order_installment_for_charge(p uuid) RETURNS jsonb AS $fn$ BEGIN RETURN 'ok'; END $fn$;";
  const oldAttempt =
    "CREATE OR REPLACE FUNCTION public.issue_3645_begin_installment_attempt(p uuid) RETURNS jsonb AS $fn$ BEGIN RETURN 'ok'; END $fn$;";
  const goodScheduler =
    '.eq("kind", "scheduled") .eq("kind", "scheduled") .eq("kind", "scheduled")';
  const goodPi = "`installment:${a}` + installmentKeyVersionSuffix(installment.schedule_version);";
  const cases = [
    {
      label: "good",
      input: {
        migrations: { "1_a.sql": oldClaim, "2_b.sql": goodClaim + goodAttempt },
        scheduler: goodScheduler,
        createInstallmentPI: goodPi,
      },
      expected: [],
    },
    {
      label: "later claim-function revert",
      input: {
        migrations: { "1_a.sql": goodClaim + goodAttempt, "2_b.sql": oldClaim },
        scheduler: goodScheduler,
        createInstallmentPI: goodPi,
      },
      expected: ["claim_order_installment_for_charge"],
    },
    {
      label: "later Paystack attempt-function revert",
      input: {
        migrations: { "1_a.sql": goodClaim + goodAttempt, "2_b.sql": oldAttempt },
        scheduler: goodScheduler,
        createInstallmentPI: goodPi,
      },
      expected: ["issue_3645_begin_installment_attempt"],
    },
    {
      label: "scheduler kind-filter revert",
      input: {
        migrations: { "1_a.sql": goodClaim + goodAttempt },
        scheduler: '.eq("kind", "scheduled") .eq("kind", "scheduled")',
        createInstallmentPI: goodPi,
      },
      expected: ["process-scheduled-installments"],
    },
    {
      label: "Stripe key-version revert",
      input: {
        migrations: { "1_a.sql": goodClaim + goodAttempt },
        scheduler: goodScheduler,
        createInstallmentPI: "`installment:${a}`",
      },
      expected: ["createInstallmentPI"],
    },
  ];
  for (const selfTest of cases) {
    const failures = flexClaimGuardFailures(selfTest.input);
    if (
      failures.length !== selfTest.expected.length ||
      !selfTest.expected.every((prefix, index) => failures[index]?.startsWith(prefix))
    ) {
      console.error(
        `#4522 flex-claim-guard self-test FAILED (${selfTest.label}): expected=${JSON.stringify(selfTest.expected)} actual=${JSON.stringify(failures)}`,
      );
      process.exit(1);
    }
  }
  const surfaces = readPublishedSurfaces(process.cwd());
  const cleanSurface = publishedSurfaceFailures(surfaces);
  if (cleanSurface.length) {
    console.error(`#4522 published-surface self-test FAILED (live files not clean): ${JSON.stringify(cleanSurface)}`);
    process.exit(1);
  }
  for (const [key, before, after, expected] of PUBLISHED_SURFACE_REVERSIONS) {
    if (!surfaces[key].includes(before)) {
      console.error(`#4522 published-surface self-test FAILED: reversion anchor missing in ${key}: ${before}`);
      process.exit(1);
    }
    const mutated = { ...surfaces, [key]: surfaces[key].replace(before, after) };
    if (!publishedSurfaceFailures(mutated).some((f) => f.startsWith(expected))) {
      console.error(`#4522 published-surface self-test FAILED: reversion not caught: ${key} / ${expected}`);
      process.exit(1);
    }
  }
  console.log(
    `#4522 flex-claim-guard self-test PASS (${cases.length}/${cases.length} cases, ` +
      `${PUBLISHED_SURFACE_REVERSIONS.length} published-surface reversions).`,
  );
  process.exit(0);
}

const root = process.cwd();
const migrationsDir = path.join(root, "supabase/migrations");
const migrations = {};
for (const file of fs.readdirSync(migrationsDir)) {
  if (!file.endsWith(".sql")) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  if (/claim_order_installment_for_charge|issue_3645_begin_installment_attempt/.test(sql)) {
    migrations[file] = sql;
  }
}
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const failures = [
  ...flexClaimGuardFailures({
    migrations,
    scheduler: read("supabase/functions/process-scheduled-installments/index.ts"),
    createInstallmentPI: read("supabase/functions/_shared/installments/createInstallmentPI.ts"),
  }),
  ...publishedSurfaceFailures(readPublishedSurfaces(root)),
];
if (failures.length) {
  console.error("#4522 flex-claim-guard gate FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("#4522 flex-claim-guard gate PASS.");
