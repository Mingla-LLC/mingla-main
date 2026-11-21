#!/usr/bin/env node
/** #4522 — a flexible payment and a planned charge never run on one order at once; a rebalanced row never reuses a Stripe key. */
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
  console.log(`#4522 flex-claim-guard self-test PASS (${cases.length}/${cases.length} cases).`);
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
const failures = flexClaimGuardFailures({
  migrations,
  scheduler: read("supabase/functions/process-scheduled-installments/index.ts"),
  createInstallmentPI: read("supabase/functions/_shared/installments/createInstallmentPI.ts"),
});
if (failures.length) {
  console.error("#4522 flex-claim-guard gate FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("#4522 flex-claim-guard gate PASS.");
