#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith(".github")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const files = {
  migration:
    "supabase/migrations/20270614002987_issue_2979_attendance_claim_secret_continuity.sql",
  governed: "supabase/functions/_shared/governedAdSecret.ts",
  link: "supabase/functions/attendance-claim-link/index.ts",
  claim: "supabase/functions/claim-attendance/index.ts",
  recovery: "supabase/functions/attendance-claim-backfill/index.ts",
  dispatch: "supabase/functions/ticket-confirmation-dispatch/index.ts",
  config: "supabase/config.toml",
  workflow: path.join(
    ".github",
    "workflows",
    ["issue-871-attendance-entitlement-tests", "yml"].join("."),
  ),
};

const rules = [
  [
    "ISSUE2979_TWO_GENERATION_RING",
    "governed",
    /resolveAttendanceClaimPepperRing[\s\S]*current:[\s\S]*governed_v2[\s\S]*previous:[\s\S]*legacy_v1[\s\S]*current:[\s\S]*legacy_v1/,
  ],
  [
    "ISSUE2979_CURRENT_ONLY_ISSUER",
    "link",
    /pepperRing\.current\.secret[\s\S]*issue_order_attendance_claim_proof_v2[\s\S]*p_generation: pepperRing\.current\.generation/,
  ],
  [
    "ISSUE2979_ONE_DUAL_CANDIDATE_CLAIM",
    "claim",
    /pepperRing\.current\.secret[\s\S]*pepperRing\.previous\.secret[\s\S]*claim_attendance_internal_v2[\s\S]*p_current_proof_digest[\s\S]*p_legacy_proof_digest/,
  ],
  [
    "ISSUE2979_ATOMIC_DUAL_RETIREMENT",
    "migration",
    /claim_attendance_internal_v2[\s\S]*FOR UPDATE[\s\S]*attendance_claim_token_generation = NULL[\s\S]*attendance_claim_legacy_token_digest = NULL[\s\S]*state = 'claimed'/,
  ],
  [
    "ISSUE2979_EXACT_RECOVERY_MODE",
    "recovery",
    /mode === "issue_2979_recovery"[\s\S]*claim_issue_2979_attendance_claim_recovery_batch[\s\S]*issue_order_attendance_claim_proof_v2[\s\S]*complete_issue_2979_attendance_claim_delivery/,
  ],
  [
    "ISSUE2979_AMBIGUOUS_IS_DELIVERY_SAFE",
    "migration",
    /provider_acceptance_ambiguous[\s\S]*provider_attempt_started_at IS NOT NULL[\s\S]*state = 'delivery_safe'[\s\S]*lease_expired_before_provider[\s\S]*provider_attempt_started_at IS NULL[\s\S]*provider_boundary_missing/,
  ],
  [
    "ISSUE2979_PROVIDER_IO_BOUNDARY",
    "recovery",
    /mark_issue_2979_attendance_claim_provider_attempt[\s\S]*beforeProviderIo/,
  ],
  [
    "ISSUE2979_FINALIZE_GRACE_AND_RECONCILIATION",
    "migration",
    /finalize_issue_2979_attendance_claim_recovery[\s\S]*issue_2979_delivery_work_remaining[\s\S]*issue_2979_governed_proof_missing[\s\S]*interval '72 hours'[\s\S]*attendance_claim_legacy_token_digest = NULL/,
  ],
  [
    "ISSUE2979_CONFIRMATION_REPLAY_NO_ROTATION",
    "dispatch",
    /buyer_user_id,[\s\S]*resolveAttendanceClaimPepperRing[\s\S]*issue_order_attendance_claim_proof_v2[\s\S]*p_allow_retry_rotation: false/,
  ],
  [
    "ISSUE2979_WORKFLOW_IMPLEMENTOR_COVERAGE",
    "workflow",
    /issue_2979_attendance_pepper_ring\.implementor\.happy\.test\.ts[\s\S]*issue_2979_dual_pepper_claim\.implementor\.happy\.test\.ts[\s\S]*issue_2979_recovery_delivery\.implementor\.happy\.test\.ts[\s\S]*issue_2979_governed_claim\.implementor\.happy\.test\.ts[\s\S]*issue_2979_attendance_claim_continuity\.implementor\.happy\.pg17\.test\.sql/,
  ],
];

function check(sources) {
  const failures = [];
  for (const [marker, key, pattern] of rules) {
    if (!pattern.test(sources[key])) failures.push(`${marker} failed in ${files[key]}`);
  }
  const recoveryStart = sources.recovery.indexOf(
    'body.mode === "issue_2979_recovery"',
  );
  const recoveryEnd = sources.recovery.indexOf("const orderPepper", recoveryStart);
  const recoveryBranch = sources.recovery.slice(recoveryStart, recoveryEnd);
  if (
    recoveryStart < 0 || recoveryEnd < recoveryStart ||
    recoveryBranch.includes("enqueue_attendance_claim_deliveries")
  ) failures.push("ISSUE2979_EXACT_RECOVERY_MODE broad enqueue entered recovery");
  if (/\b235\b/.test(sources.recovery + sources.migration)) {
    failures.push("ISSUE2979_NO_HARDCODED_LIVE_COUNTS historical count detected");
  }
  if (
    !/\[functions\.claim-attendance\]\s*verify_jwt = true/.test(sources.config) ||
    !/\[functions\.attendance-claim-link\]\s*verify_jwt = false/.test(sources.config) ||
    !/\[functions\.attendance-claim-backfill\]\s*verify_jwt = false/.test(
      sources.config,
    )
  ) failures.push("ISSUE2979_VERIFY_JWT_PRESERVATION changed");
  if (/api\.twilio\.com|api\.termii\.com/.test(recoveryBranch)) {
    failures.push("ISSUE2979_SMS_ADAPTER_ONLY raw SMS provider detected");
  }
  if (
    !sources.recovery.includes(
      "Your tickets are confirmed. You can open the app and sign in with your ",
    ) ||
    !sources.recovery.includes("checkout email or phone. ${claimWebUrl}")
  ) failures.push("ISSUE2979_APPROVED_RECOVERY_COPY changed");
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
  if (check(sources).length) failures.push("good fixture failed");
  for (const [marker, key] of rules) {
    const broken = { ...sources, [key]: "intentionally reverted" };
    if (!check(broken).some((failure) => failure.includes(marker))) {
      failures.push(`${marker} revert was not detected`);
    }
  }
  const widened = {
    ...sources,
    recovery: sources.recovery.replace(
      'body.mode === "issue_2979_recovery"',
      'body.mode === "issue_2979_recovery" && enqueue_attendance_claim_deliveries',
    ),
  };
  if (!check(widened).some((failure) => failure.includes("EXACT_RECOVERY_MODE"))) {
    failures.push("recovery widening revert was not detected");
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue #2979 strict guard self-test passed");
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("issue #2979 attendance claim continuity strict guard passed");
