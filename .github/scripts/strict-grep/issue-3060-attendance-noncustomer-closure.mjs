#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith(".github")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const files = {
  migration:
    "supabase/migrations/20270614003060_issue_3060_attendance_noncustomer_closure.sql",
  happy:
    "supabase/migrations/__tests__/issue_3060_attendance_noncustomer_closure.implementor.happy.test.sql",
  adversarial:
    "supabase/migrations/__tests__/issue_3060_attendance_noncustomer_closure.tester.adversarial.test.sql",
  invariant: "docs/INVARIANT_REGISTRY.md",
  workflow: ".github/workflows/issue-871-attendance-entitlement-tests.yml",
};

function between(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

export function violations(sources) {
  const failures = [];
  const closure = between(
    sources.migration,
    "CREATE OR REPLACE FUNCTION public.close_issue_3060_attendance_noncustomer_history(",
    "REVOKE ALL ON FUNCTION public.close_issue_3060_attendance_noncustomer_history(",
  );
  const finalizer = between(
    sources.migration,
    "CREATE OR REPLACE FUNCTION public.finalize_issue_2979_attendance_claim_recovery()",
    "$function$;",
  );

  for (const token of [
    "CREATE TABLE public.attendance_claim_recovery_operator_closures",
    "ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON TABLE public.attendance_claim_recovery_operator_closures",
    "GRANT SELECT ON TABLE public.attendance_claim_recovery_operator_closures",
    "operator_confirmed_no_current_buyer",
    "operator_closure_id text",
    "ON DELETE RESTRICT",
  ]) {
    if (!sources.migration.includes(token)) {
      failures.push(`ISSUE3060_AUDIT_LEDGER:missing:${token}`);
    }
  }

  for (const token of [
    "I-PROPOSED-3060-NONCUSTOMER-CLOSURE-EXACT-AND-NONSENDING (ACTIVE)",
    "identified by an exact row count and SHA-256 of sorted order IDs",
    "The ordinary delivery-safe path still requires 72 hours",
  ]) {
    if (!sources.invariant.includes(token)) {
      failures.push(`ISSUE3060_INVARIANT:missing:${token}`);
    }
  }

  for (const token of [
    "p_expected_count integer",
    "p_expected_set_sha256 text",
    "string_agg(order_id::text, ',' ORDER BY order_id)",
    "extensions.digest(",
    "v_actual_count <> p_expected_count",
    "v_open_count <> p_expected_count",
    "v_actual_sha <> v_expected_sha",
    "issue_3060_recovery_set_mismatch",
    "o.buyer_user_id IS NOT NULL",
    "issue_3060_buyer_activity_detected",
    "issue_3060_delivery_inventory_mismatch",
    "d.provider_attempt_started_at IS NOT NULL",
    "issue_3060_provider_activity_detected",
    "GET DIAGNOSTICS v_transitioned = ROW_COUNT",
    "v_transitioned <> p_expected_count",
    "issue_3060_transition_count_mismatch",
  ]) {
    if (!closure.includes(token)) {
      failures.push(`ISSUE3060_EXACT_SET:missing:${token}`);
    }
  }
  if (!closure.includes("GRANT EXECUTE ON FUNCTION") &&
      !sources.migration.includes(
        "GRANT EXECUTE ON FUNCTION public.close_issue_3060_attendance_noncustomer_history",
      )) {
    failures.push("ISSUE3060_AUTHORITY:service_role_grant_missing");
  }
  if (!sources.migration.includes(
    ") FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.close_issue_3060_attendance_noncustomer_history(",
  )) {
    failures.push("ISSUE3060_AUTHORITY:public_roles_not_revoked");
  }

  for (const token of [
    "v_operator_count <> v_operator_receipt.expected_count",
    "v_operator_sha <> v_operator_receipt.set_sha256",
    "issue_3060_operator_receipt_mismatch",
    "interval '72 hours'",
    "WHEN r.resolved_via = 'operator_confirmed_no_current_buyer'",
    "attendance_claim_legacy_token_digest = NULL",
  ]) {
    if (!finalizer.includes(token)) {
      failures.push(`ISSUE3060_FINALIZER:missing:${token}`);
    }
  }

  for (const forbidden of [
    /\b235\b/,
    /DELETE\s+FROM\s+public\.(?:orders|tickets|attendance_claim_recovery_items)/i,
    /https?:\/\/(?:api\.)?(?:resend|twilio|termii)\b/i,
  ]) {
    if (forbidden.test(sources.migration)) {
      failures.push(`ISSUE3060_NO_SIDE_EFFECTS:forbidden:${forbidden}`);
    }
  }

  for (const token of [
    "already_closed",
    "ticket history was changed by operator closure",
    "closure fabricated or retained provider activity",
    "noncustomer finalization fabricated ownership or retained proof",
  ]) {
    if (!sources.happy.includes(token)) {
      failures.push(`ISSUE3060_HAPPY_PROOF:missing:${token}`);
    }
  }

  for (const token of [
    "wrong expected count was not refused",
    "wrong exact-set fingerprint was not refused",
    "mixed recovery state was not refused",
    "buyer claim activity was not refused",
    "incomplete delivery inventory was not refused",
    "prior provider activity was not refused",
    "mismatched receipt replay was not refused",
    "tampered receipt membership was not refused",
    "ordinary delivery-safe row bypassed the 72-hour grace",
    "ordinary finalization did not preserve governed proof",
  ]) {
    if (!sources.adversarial.includes(token)) {
      failures.push(`ISSUE3060_ADVERSARIAL_PROOF:missing:${token}`);
    }
  }

  for (const token of [
    "supabase/migrations/20270614003060_issue_3060_attendance_noncustomer_closure.sql",
    "supabase/migrations/__tests__/issue_3060*",
    "issue_3060_attendance_noncustomer_closure.implementor.happy.test.sql",
    "issue_3060_attendance_noncustomer_closure.tester.adversarial.test.sql",
    "node .github/scripts/strict-grep/issue-3060-attendance-noncustomer-closure.mjs --self-test",
    "node .github/scripts/strict-grep/issue-3060-attendance-noncustomer-closure.mjs",
  ]) {
    if (!sources.workflow.includes(token)) {
      failures.push(`ISSUE3060_CI_EXECUTION:missing:${token}`);
    }
  }

  return failures;
}

const sources = Object.fromEntries(
  Object.entries(files).map(([key, relative]) => [
    key,
    fs.readFileSync(path.join(root, relative), "utf8"),
  ]),
);

function mutate(key, from, to) {
  if (!sources[key].includes(from)) {
    throw new Error(`self-test source token missing: ${key}:${from}`);
  }
  return { ...sources, [key]: sources[key].replace(from, to) };
}

if (process.argv.includes("--self-test")) {
  const failures = [];
  const baseline = violations(sources);
  if (baseline.length) failures.push(`good fixture failed:\n${baseline.join("\n")}`);
  const mutants = [
    ["count", "migration", "v_actual_count <> p_expected_count", "false"],
    ["fingerprint", "migration", "v_actual_sha <> v_expected_sha", "false"],
    ["provider", "migration", "d.provider_attempt_started_at IS NOT NULL", "false"],
    ["buyer", "migration", "o.buyer_user_id IS NOT NULL", "false"],
    ["row count", "migration", "v_transitioned <> p_expected_count", "false"],
    ["receipt", "migration", "v_operator_sha <> v_operator_receipt.set_sha256", "false"],
    ["grace", "migration", "interval '72 hours'", "interval '1 second'"],
    ["adversarial", "adversarial", "prior provider activity was not refused", "provider check removed"],
    ["invariant", "invariant", "The ordinary delivery-safe path still requires 72 hours", "ordinary path weakened"],
    ["workflow test", "workflow", "issue_3060_attendance_noncustomer_closure.tester.adversarial.test.sql", "tester_removed.sql"],
    ["workflow gate", "workflow", "node .github/scripts/strict-grep/issue-3060-attendance-noncustomer-closure.mjs --self-test", "gate_removed"],
  ];
  for (const [name, key, from, to] of mutants) {
    const mutant = mutate(key, from, to);
    if (violations(mutant).length <= baseline.length) {
      failures.push(`${name} mutant was not rejected`);
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue #3060 attendance noncustomer closure guard self-test passed");
  process.exit(0);
}

const failures = violations(sources);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("issue #3060 attendance noncustomer closure guard passed");
