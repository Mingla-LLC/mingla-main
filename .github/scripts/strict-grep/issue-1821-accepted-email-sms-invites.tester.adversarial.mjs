#!/usr/bin/env node
/** #1821 tester guard: every channel shares one serialized, monotonic group truth. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const PATHS = {
  migration:
    "supabase/migrations/20270314001821_issue_1821_accepted_email_sms_invites.sql",
  sqlTest:
    "supabase/migrations/__tests__/issue_1821_accepted_email_sms_invites.test.sql",
};

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function ordered(source, tokens, label, failures) {
  let cursor = -1;
  for (const token of tokens) {
    const next = source.indexOf(token, cursor + 1);
    if (next < 0 || next <= cursor) {
      failures.push(`${label}: ordering drifted at ${token}`);
      return;
    }
    cursor = next;
  }
}

export function violations(files) {
  const failures = [];
  const migration = files.migration ?? "";
  const sqlTest = files.sqlTest ?? "";

  const projectorStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1821_project_offering_send_group(",
  );
  const projectorEnd = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1770_project_offering_push_delivery(",
    projectorStart,
  );
  const projector = projectorStart >= 0 && projectorEnd > projectorStart
    ? migration.slice(projectorStart, projectorEnd)
    : "";
  ordered(
    projector,
    [
      "FROM public.marketing_send_groups",
      "FOR UPDATE;",
      "FROM public.brand_offering_invite_delivery_attempts",
      "UPDATE public.marketing_send_groups SET",
    ],
    "serialized all-channel rollup",
    failures,
  );
  ordered(
    projector,
    [
      "WHEN v_queued>0 THEN 'running'",
      "WHEN v_failed=0 THEN 'completed'",
      "WHEN v_failed=(v_total-v_suppressed) THEN 'failed'",
      "ELSE 'partial'",
    ],
    "group status precedence",
    failures,
  );
  for (
    const token of [
      "count(*) FILTER(WHERE status IN ('queued','sending'))",
      "count(*) FILTER(WHERE status IN ('sent','delivered'))",
      "WHEN v_queued>0 THEN 'running'",
      "WHEN v_failed=0 THEN 'completed'",
      "WHEN v_failed=(v_total-v_suppressed) THEN 'failed'",
      "WHEN v_queued=0 THEN COALESCE(completed_at,now())",
      "ELSE completed_at",
    ]
  ) need(projector, token, "serialized all-channel rollup", failures);

  const reconcilerStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1770_reconcile_marketing_message()",
  );
  const reconciler = reconcilerStart >= 0
    ? migration.slice(reconcilerStart)
    : "";
  for (
    const token of [
      "WHEN status IN ('sent','delivered','failed','suppressed') THEN status",
      "WHEN status='delivered' THEN NULL",
      "WHEN status='sent' OR provider_accepted_at IS NOT NULL\n          THEN 'provider_partial_failure'",
      "is_retryable=CASE\n        WHEN status IN ('failed','suppressed') THEN is_retryable\n        ELSE false",
      "PERFORM public.issue_1821_project_offering_send_group(\n    v_attempt.send_group_id",
    ]
  ) need(reconciler, token, "late failure monotonicity", failures);

  const pushStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1770_project_offering_push_delivery(",
  );
  const pushEnd = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1770_reconcile_marketing_message()",
    pushStart,
  );
  const push = pushStart >= 0 && pushEnd > pushStart
    ? migration.slice(pushStart, pushEnd)
    : "";
  ordered(
    push,
    [
      "INSERT INTO public.notification_deliveries(",
      "PERFORM public.issue_1821_project_offering_send_group(\n    v_attempt.send_group_id",
    ],
    "push delegates after delivery projection",
    failures,
  );

  for (
    const token of [
      "T-1821-04 FAIL: accepted then failed downgraded Sent",
      "T-1821-04 FAIL: Delivered was downgraded by late failure",
      "safe_reason_code='provider_partial_failure' AND NOT is_retryable",
      "T-1821-07 FAIL: concurrent sessions did not overlap at the group lock",
      "T-1821-07 FAIL: concurrent email/SMS/push projection published stale totals",
      "T-1821-07 PASS: concurrent email/SMS/push completion serialized to Sent=3",
      "dblink_is_busy('issue1821_email')<>1",
      "dblink_is_busy('issue1821_sms')<>1",
      "dblink_is_busy('issue1821_push')<>1",
    ]
  ) need(sqlTest, token, "executable adversarial PG17 matrix", failures);

  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(PATHS).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(ROOT, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const clean = readFiles();
  const baseline = violations(clean);
  if (baseline.length) {
    throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  }
  const mutations = [
    [
      "migration",
      "WHEN status IN ('sent','delivered','failed','suppressed') THEN status",
      "WHEN status IN ('delivered','failed','suppressed') THEN status",
      "late failure downgraded accepted Sent",
    ],
    [
      "migration",
      "FROM public.marketing_send_groups\n  WHERE id=p_send_group_id\n  FOR UPDATE;",
      "FROM public.marketing_send_groups\n  WHERE id=p_send_group_id;",
      "group row lock removed",
    ],
    [
      "migration",
      "WHEN v_queued>0 THEN 'running'\n    WHEN v_failed=0 THEN 'completed'",
      "WHEN v_failed=0 THEN 'completed'\n    WHEN v_queued>0 THEN 'running'",
      "nonterminal group published Completed",
    ],
    [
      "migration",
      "WHEN status='delivered' THEN NULL",
      "WHEN status='delivered' THEN 'provider_partial_failure'",
      "late failure polluted Delivered truth",
    ],
    [
      "sqlTest",
      "T-1821-07 FAIL: concurrent sessions did not overlap at the group lock",
      "T-1821-07 overlap assertion removed",
      "concurrency overlap proof removed",
    ],
  ];
  for (const [key, before, after, label] of mutations) {
    if (!clean[key].includes(before)) {
      throw new Error(`self-test fixture missing: ${label}`);
    }
    const broken = { ...clean, [key]: clean[key].replace(before, after) };
    if (violations(broken).length === 0) {
      throw new Error(`mutation survived: ${label}`);
    }
  }
  console.log(
    "#1821 tester adversarial serialization/precedence self-test PASS (5 true mutations)",
  );
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1821 tester adversarial serialization/precedence guard PASS");
}
