#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith(".github")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const files = {
  claim: "supabase/functions/claim-attendance/index.ts",
  recovery: "supabase/functions/attendance-claim-backfill/index.ts",
  dispatch: "supabase/functions/ticket-confirmation-dispatch/index.ts",
  migration:
    "supabase/migrations/20270614002987_issue_2979_attendance_claim_secret_continuity.sql",
  workflow: ".github/workflows/issue-871-attendance-entitlement-tests.yml",
};

function between(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

export function violations(sources) {
  const failures = [];
  const recoveryBranch = between(
    sources.recovery,
    'body.mode === "issue_2979_recovery"',
    "const rsvpPepper",
  );
  const liveOrderFetch = between(
    sources.dispatch,
    "const { data: orderRaw",
    ".maybeSingle();",
  );
  const confirmationIssuance = between(
    sources.dispatch,
    '"issue_order_attendance_claim_proof_v2"',
    "sendResendEmailWithAttachment",
  );
  const tokenClaim = between(
    sources.migration,
    "CREATE OR REPLACE FUNCTION public.claim_attendance_internal_v2(",
    "CREATE OR REPLACE FUNCTION public.claim_attendance_internal(",
  );
  const identityClaim = between(
    sources.migration,
    "CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity(",
    "CREATE OR REPLACE FUNCTION public.preview_issue_2979_attendance_claim_recovery(",
  );
  const completion = between(
    sources.migration,
    "CREATE OR REPLACE FUNCTION public.complete_issue_2979_attendance_claim_delivery(",
    "CREATE OR REPLACE FUNCTION public.finalize_issue_2979_attendance_claim_recovery(",
  );
  const preview = between(
    sources.migration,
    "CREATE OR REPLACE FUNCTION public.preview_issue_2979_attendance_claim_recovery()",
    "CREATE OR REPLACE FUNCTION public.claim_issue_2979_attendance_claim_recovery_batch(",
  );
  const finalizer = between(
    sources.migration,
    "CREATE OR REPLACE FUNCTION public.finalize_issue_2979_attendance_claim_recovery(",
    "REVOKE ALL ON FUNCTION public.preview_issue_2979_attendance_claim_recovery()",
  );

  if (!recoveryBranch) failures.push("ISSUE2979_TESTER_EXACT_RECOVERY:branch_missing");
  if (recoveryBranch.includes("enqueue_attendance_claim_deliveries")) {
    failures.push("ISSUE2979_TESTER_EXACT_RECOVERY:broad_enqueue");
  }
  if (/\b235\b|\b244\b|\b249\b/.test(recoveryBranch + sources.migration)) {
    failures.push("ISSUE2979_TESTER_EXACT_RECOVERY:hardcoded_live_count");
  }
  for (const token of [
    "claim_issue_2979_attendance_claim_recovery_batch",
    "retryOnNetworkAmbiguity: false",
    "smsAdapter.send({",
    "mark_issue_2979_attendance_claim_provider_attempt",
  ]) {
    if (!recoveryBranch.includes(token)) {
      failures.push(`ISSUE2979_TESTER_DELIVERY_SAFETY:missing:${token}`);
    }
  }
  if (
    !sources.recovery.includes('current.generation !== "governed_v2"') ||
    !recoveryBranch.includes("runIssue2979RecoveryWhenGoverned")
  ) failures.push("ISSUE2979_TESTER_DELIVERY_SAFETY:governed_gate_missing");
  if (/api\.twilio\.com|api\.termii\.com/.test(recoveryBranch)) {
    failures.push("ISSUE2979_TESTER_DELIVERY_SAFETY:raw_sms_provider");
  }

  if (!liveOrderFetch.includes("buyer_user_id,")) {
    failures.push("ISSUE2979_TESTER_CONFIRMATION_OWNER:live_select_missing");
  }
  if (
    !confirmationIssuance.includes("p_generation: pepperRing.current.generation") ||
    !confirmationIssuance.includes("p_allow_retry_rotation: false") ||
    confirmationIssuance.includes("p_allow_retry_rotation: true")
  ) failures.push("ISSUE2979_TESTER_CONFIRMATION_OWNER:replay_rotates");

  for (const [name, body] of [["token", tokenClaim], ["identity", identityClaim]]) {
    if (
      !body.includes("state = 'claimed'") ||
      !body.includes("attendance_claim_deliveries") ||
      !body.includes("claim_resolved")
    ) failures.push(`ISSUE2979_TESTER_CLAIM_CLEANUP:${name}`);
  }

  const safeWrite = completion.indexOf("SET state = 'delivery_safe'");
  const claimedGuard = completion.indexOf("state = 'claimed'");
  const safeUpdateStart = completion.lastIndexOf(
    "UPDATE public.attendance_claim_recovery_items",
    safeWrite,
  );
  const safeUpdateEnd = completion.indexOf(";", safeWrite);
  const safeUpdate = completion.slice(safeUpdateStart, safeUpdateEnd + 1);
  if (safeWrite < 0 || claimedGuard < 0 || claimedGuard > safeWrite) {
    failures.push("ISSUE2979_TESTER_CLAIMED_MONOTONIC:provider_can_resurrect");
  }
  if (/WHERE order_id = p_order_id\s*;/.test(safeUpdate)) {
    failures.push("ISSUE2979_TESTER_CLAIMED_MONOTONIC:unconditional_safe_write");
  }
  if (!preview.includes("'noLongerEligible'")) {
    failures.push("ISSUE2979_TESTER_PREVIEW_RECONCILIATION:no_longer_eligible");
  }

  for (const token of [
    "state IN ('selected', 'replacement_issued', 'attention_required')",
    "issue_2979_delivery_work_remaining",
    "issue_2979_governed_proof_missing",
    "issue_2979_delivery_reconciliation_failed",
    "interval '72 hours'",
    "attendance_claim_legacy_token_digest = NULL",
  ]) {
    if (!finalizer.includes(token)) {
      failures.push(`ISSUE2979_TESTER_FINALIZER:missing:${token}`);
    }
  }

  for (const token of [
    "issue_2979_attendance_claim_continuity.tester.adversarial.test.ts",
    "issue_2979_recovery_delivery.tester.adversarial.test.ts",
    "issue_2979_ticket_confirmation_claim.tester.adversarial.test.ts",
    "issue_2979_attendance_claim_secret_continuity.tester.adversarial.test.sql",
    "issue-2979-attendance-claim-continuity.tester.mjs",
    'node "$tester_guard" --self-test',
    'node "$tester_guard"',
  ]) {
    if (!sources.workflow.includes(token)) {
      failures.push(`ISSUE2979_TESTER_CI_EXECUTION:missing:${token}`);
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

if (process.argv.includes("--self-test")) {
  const failures = [];
  const baseline = violations(sources);
  if (baseline.length) failures.push(`good fixture failed:\n${baseline.join("\n")}`);
  const mutants = [
    ["exact", "recovery", 'body.mode === "issue_2979_recovery"',
      'body.mode === "issue_2979_recovery" && enqueue_attendance_claim_deliveries'],
    ["ambiguity", "recovery", "retryOnNetworkAmbiguity: false", "retryOnNetworkAmbiguity: true"],
    ["owner", "dispatch", "      event_id,\n      buyer_name,\n      buyer_email,\n      buyer_user_id,", "      event_id,\n      buyer_name,\n      buyer_email,"],
    ["rotation", "dispatch", "p_allow_retry_rotation: false", "p_allow_retry_rotation: true"],
    ["claim cleanup", "migration", "claim_resolved", "cleanup_removed"],
    ["claimed monotonic", "migration", "state = 'claimed'", "state = 'resurrectable'"],
    ["preview reconciliation", "migration", "'noLongerEligible'", "'missingEligibleState'"],
    ["grace", "migration", "interval '72 hours'", "interval '1 second'"],
    ["workflow", "workflow", "issue_2979_recovery_delivery.tester.adversarial.test.ts", "tester_removed.ts"],
  ];
  for (const [name, key, from, to] of mutants) {
    const mutant = { ...sources, [key]: sources[key].replace(from, to) };
    if (violations(mutant).length <= baseline.length) {
      failures.push(`${name} mutant was not rejected`);
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue #2979 tester guard self-test passed");
  process.exit(0);
}

const failures = violations(sources);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("issue #2979 tester attendance continuity guard passed");
