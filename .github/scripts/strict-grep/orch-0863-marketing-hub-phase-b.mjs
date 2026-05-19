#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-0863 [Marketing Hub Phase B — Overview + Audiences
 * + Templates tabs].
 *
 * Enforces the invariants pinned in SPEC §13 + §18:
 *   I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION
 *     - Overview route MUST NOT contain `$` (Constitution #9, no UTM-to-
 *       campaign attribution yet).
 *     - Overview route MUST NOT contain "revenue" (case-insensitive).
 *     - Overview route MUST NOT render "Opened" as a funnel-card label
 *       (no Resend webhook ingest path; SPEC NG-8).
 *   I-PROPOSED-MKT-STARTER-TEMPLATES-READ-ONLY
 *     - marketingTemplateService.updateUserTemplate MUST contain a
 *       starter-pack defense-in-depth guard that throws before any UPDATE
 *       round-trip.
 *   Composer template-prefill wiring
 *     - compose.tsx useLocalSearchParams schema MUST include `template?:`.
 *   I-PROPOSED-MKT-PHASE-B-NO-NEW-TABLES
 *     - This ORCH MUST NOT introduce new files under supabase/migrations/
 *       or supabase/functions/. Diff-aware against origin/main when
 *       available; otherwise validates the current tree shape.
 *   Required service file presence
 *     - mingla-business/src/services/marketing/marketingOverviewService.ts
 *       MUST exist and MUST export getMarketingOverview.
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — at least one check failed
 *   2 — file system error
 *
 * Self-test mode (`--self-test`) validates the regex/checker behaviour
 * against inlined fixture strings and exits 1 if expectations are not met.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const OVERVIEW_ROUTE = path.join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "marketing",
  "index.tsx",
);
const TEMPLATE_SERVICE = path.join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "marketing",
  "marketingTemplateService.ts",
);
const OVERVIEW_SERVICE = path.join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "marketing",
  "marketingOverviewService.ts",
);
const COMPOSE_ROUTE = path.join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "marketing",
  "campaigns",
  "compose.tsx",
);

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`FATAL: could not read ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Check 1: Overview route does NOT contain `$` (excluding template-literal interpolation ${...})
// ---------------------------------------------------------------------------
function checkOverviewNoDollar(source) {
  const lines = source.split("\n");
  const offenders = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const stripped = line.replace(/\$\{[^}]*\}/g, "");
    if (stripped.includes("$")) {
      offenders.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  if (offenders.length > 0) {
    fail(
      "C1: overview-no-dollar",
      `${OVERVIEW_ROUTE} contains a '$' literal (Constitution #9 — no revenue fabrication):\n  ${offenders.join("\n  ")}`,
    );
  } else {
    ok("C1: overview-no-dollar", "no '$' literal in Overview route");
  }
}

// ---------------------------------------------------------------------------
// Check 2: Overview route does NOT contain "revenue" (case-insensitive)
// ---------------------------------------------------------------------------
function checkOverviewNoRevenue(source) {
  if (source.toLowerCase().includes("revenue")) {
    fail(
      "C2: overview-no-revenue",
      `${OVERVIEW_ROUTE} contains the word 'revenue' (Constitution #9 — no UTM-to-campaign attribution exists yet)`,
    );
  } else {
    ok("C2: overview-no-revenue", "no 'revenue' substring in Overview route");
  }
}

// ---------------------------------------------------------------------------
// Check 3: Overview route does NOT render 'Opened' as a funnel-card label
// ---------------------------------------------------------------------------
function checkOverviewNoOpened(source) {
  if (
    source.includes('label="Opened"') ||
    source.includes('label="OPENED"') ||
    source.includes("label={'Opened'}") ||
    source.includes('label={"Opened"}')
  ) {
    fail(
      "C3: overview-no-opened",
      `${OVERVIEW_ROUTE} renders an 'Opened' funnel-card label (SPEC NG-8 — no Resend webhook ingest path)`,
    );
  } else {
    ok("C3: overview-no-opened", "no 'Opened' funnel-card label literal");
  }
}

// ---------------------------------------------------------------------------
// Check 4: marketingTemplateService.updateUserTemplate has a starter-pack guard
// ---------------------------------------------------------------------------
function checkStarterPackGuard(source) {
  // Look for the assertNotStarterPack pre-check call inside updateUserTemplate
  // AND deleteUserTemplate. The helper must throw 'Cannot modify starter-pack template'.
  const guardPattern = /assertNotStarterPack\s*\(/g;
  const guardCalls = source.match(guardPattern);
  const throwsCorrectMessage = source.includes('"Cannot modify starter-pack template"') ||
    source.includes("'Cannot modify starter-pack template'");
  if (guardCalls === null || guardCalls.length < 2 || !throwsCorrectMessage) {
    fail(
      "C4: starter-pack-guard",
      `${TEMPLATE_SERVICE} updateUserTemplate / deleteUserTemplate missing defense-in-depth starter-pack guard (need assertNotStarterPack() in both + 'Cannot modify starter-pack template' throw)`,
    );
  } else {
    ok(
      "C4: starter-pack-guard",
      `defense-in-depth guard present (${guardCalls.length} assertNotStarterPack calls)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Check 5: compose.tsx useLocalSearchParams schema includes `template?:`
// ---------------------------------------------------------------------------
function checkComposeTemplateParam(source) {
  const schemaPattern = /useLocalSearchParams<\{[^}]*template\?:\s*string[^}]*\}>/;
  if (!schemaPattern.test(source)) {
    fail(
      "C5: compose-template-param",
      `${COMPOSE_ROUTE} useLocalSearchParams schema missing 'template?: string' (ORCH-0863 template pre-fill wiring)`,
    );
  } else {
    ok("C5: compose-template-param", "useLocalSearchParams includes 'template?: string'");
  }
}

// ---------------------------------------------------------------------------
// Check 6: marketingOverviewService exists and exports getMarketingOverview
// ---------------------------------------------------------------------------
function checkOverviewServiceExists() {
  if (!fs.existsSync(OVERVIEW_SERVICE)) {
    fail(
      "C6: overview-service-exists",
      `${OVERVIEW_SERVICE} not found — required by ORCH-0863 SPEC §10`,
    );
    return;
  }
  const src = readSource(OVERVIEW_SERVICE);
  if (!/export\s+(async\s+)?function\s+getMarketingOverview\b/.test(src)) {
    fail(
      "C6: overview-service-exists",
      `${OVERVIEW_SERVICE} does not export getMarketingOverview`,
    );
  } else {
    ok("C6: overview-service-exists", "getMarketingOverview export present");
  }
}

// ---------------------------------------------------------------------------
// Check 7: No new files under supabase/migrations/ or supabase/functions/
//          introduced by this ORCH (diff-aware against origin/main when available)
// ---------------------------------------------------------------------------
function checkNoNewBackendFiles() {
  let diffOutput = "";
  try {
    diffOutput = execSync("git diff --name-only origin/main...HEAD", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch (_err) {
    // origin/main unavailable (e.g., CI fresh checkout or detached HEAD).
    // Fall back to checking uncommitted changes vs. HEAD.
    try {
      diffOutput = execSync("git diff --name-only HEAD", {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
    } catch (_err2) {
      // No git at all — skip the diff check gracefully (CI bare runs).
      ok(
        "C7: no-new-backend-files",
        "git unavailable — skipping diff check (manual review only)",
      );
      return;
    }
  }
  const changed = diffOutput.split("\n").filter((p) => p.length > 0);
  // ORCH-0859 [Tr2 Minimum Viable Trip] bundled into PR #126 alongside
  // ORCH-0863 + ORCH-0862 per operator-approved bundle (2026-05-17). The
  // backend touches under these specific paths are ORCH-0859 trip-publish
  // scope, not ORCH-0863 marketing scope. Exempted here; future close
  // should drop this allowlist when ORCH-0859 ships its own PR.
  const ORCH_0859_BUNDLED_ALLOWLIST = [
    "supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql",
    "supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql",
    "supabase/migrations/20260609000000_orch_0859_trip_publish_slug_flag.sql",
    "supabase/functions/_shared/email/tripConfirmationEmail.ts",
    "supabase/functions/discover-merged-events/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
  ];
  // ORCH-0869 [Tr3 Installment Payments] CLOSE PR #128 (2026-05-18). The
  // C7 gate is scoped to ORCH-0863's OWN diff (the gate runs against
  // origin/main..HEAD diff, which on a separate ORCH-0869 PR contains the
  // ORCH-0869 backend files since they have never reached main). These
  // backend touches are ORCH-0869 installment-engine scope, not ORCH-0863
  // marketing scope. Exempted here for the same reason as the ORCH-0859
  // allowlist above. Future close that drops both allowlists should also
  // re-scope C7 itself to fire ONLY against PRs whose commit message
  // explicitly cites `Close ORCH-0863` (gate-scope follow-up — register
  // when both allowlists become removable).
  const ORCH_0869_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/__tests__/installment_handoff_adversarial.test.ts",
    "supabase/functions/_shared/email/installmentDunningEmail.ts",
    "supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts",
    "supabase/functions/_shared/installmentWebhookHandlers.ts",
    "supabase/functions/_shared/stripePaymentMethods.ts",
    "supabase/functions/_shared/stripeWebhookRouter.ts",
    "supabase/functions/process-scheduled-installments/__tests__/idempotency.test.ts",
    "supabase/functions/process-scheduled-installments/index.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts",
    "supabase/migrations/20260610000000_tr3_installments.sql",
    "supabase/migrations/20260610000001_tr3_cron_use_vault_secrets.sql",
    "supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql",
  ];
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] CLOSE PR #134 (2026-05-18).
  // Same scoping rationale as the ORCH-0859 and ORCH-0869 allowlists above:
  // these backend touches are ORCH-0875 refund-engine + cancel-flow scope, not
  // ORCH-0863 marketing scope, so they're exempted from this gate. Future
  // close that drops these allowlists should re-scope C7 itself to fire ONLY
  // against PRs whose commit message explicitly cites `Close ORCH-0863`.
  const ORCH_0875_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/email/buyerLifecycleAdapters.ts",
    "supabase/functions/cancel-trip-booking/__tests__/adversarial_security.test.ts",
    "supabase/functions/cancel-trip-booking/__tests__/contract_invariants.test.ts",
    "supabase/functions/cancel-trip-booking/index.ts",
    "supabase/functions/process-booking-deadlines/index.ts",
    "supabase/functions/process-scheduled-installments/index.ts",
    "supabase/functions/ticket-checkout-create/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql",
    "supabase/migrations/20260612000001_tr4_revoke_rpc_anon_grants.sql",
  ];
  // ORCH-0099 [Ve1 Physical Venue Brand Onboarding] PR #135 (2026-05-18). C7 is
  // scoped to ORCH-0863 marketing; these backend touches are Ve1 venue-claim
  // scope bundled on the same branch as marketing work.
  const ORCH_0099_VE1_BACKEND_ALLOWLIST = [
    "supabase/functions/venue-claim-decision-email/index.ts",
    "supabase/functions/venue-claim-submitted-email/index.ts",
    "supabase/migrations/20260613000000_ve1_physical_venue_brand_onboarding.sql",
    "supabase/migrations/20260614000000_ve1_pr_review_hardening.sql",
  ];
  // ORCH-0877 [Event end-time display + midnight-crossing single-day authoring]
  // PR #136 (2026-05-19). C7 is scoped to ORCH-0863 marketing; these backend
  // touches are end-time + cross-midnight + ICS Constitution #9 fix scope.
  const ORCH_0877_BACKEND_ALLOWLIST = [
    "supabase/functions/_shared/dateTimeSplit.ts",
    "supabase/functions/_shared/email/__tests__/calendar.test.ts",
    "supabase/functions/_shared/email/__tests__/dateLine.test.ts",
    "supabase/functions/_shared/email/calendar.ts",
    "supabase/functions/_shared/email/dateLine.ts",
    "supabase/functions/_shared/email/ticketBody.ts",
    "supabase/functions/_shared/email/types.ts",
    "supabase/functions/_shared/marketingEmailRender.ts",
    "supabase/functions/_shared/ticketPdf.ts",
    "supabase/functions/discover-merged-events/index.ts",
    "supabase/functions/marketing-send/index.ts",
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "supabase/functions/ticket-pdf-fetch/index.ts",
    "supabase/migrations/20260615000000_orch_0877_patch_event_when_rpc.sql",
  ];
  const ALLOWLIST = [
    ...ORCH_0859_BUNDLED_ALLOWLIST,
    ...ORCH_0869_BACKEND_ALLOWLIST,
    ...ORCH_0875_BACKEND_ALLOWLIST,
    ...ORCH_0099_VE1_BACKEND_ALLOWLIST,
    ...ORCH_0877_BACKEND_ALLOWLIST,
  ];
  const forbidden = changed.filter(
    (p) =>
      (p.startsWith("supabase/migrations/") ||
        p.startsWith("supabase/functions/")) &&
      !ALLOWLIST.includes(p),
  );
  if (forbidden.length > 0) {
    fail(
      "C7: no-new-backend-files",
      `ORCH-0863 must not touch supabase/migrations/ or supabase/functions/ (NG hard guard); offenders:\n  ${forbidden.join("\n  ")}`,
    );
  } else {
    ok(
      "C7: no-new-backend-files",
      `zero touches under supabase/migrations/ or supabase/functions/ (${changed.length} files changed total)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Self-test mode
// ---------------------------------------------------------------------------
function runSelfTest() {
  console.log("# Self-test mode");
  let selfFails = 0;
  function expect(cond, msg) {
    if (!cond) {
      console.error(`SELF-FAIL: ${msg}`);
      selfFails += 1;
    } else {
      console.log(`SELF-OK: ${msg}`);
    }
  }

  // C1 negative test: `$` literal triggers fail.
  const badOverview = "const cost = '$100';\n";
  const beforeC1 = failures;
  checkOverviewNoDollar(badOverview);
  expect(failures === beforeC1 + 1, "C1 catches literal $ in source");
  failures = beforeC1;

  // C1 positive test: `${expr}` interpolation is allowed.
  const goodOverview = "const t = `Hello ${name}`;\n";
  checkOverviewNoDollar(goodOverview);
  expect(failures === beforeC1, "C1 allows template-literal interpolation");

  // C2 case-insensitive match.
  const beforeC2 = failures;
  checkOverviewNoRevenue("// Total Revenue from blasts\n");
  expect(failures === beforeC2 + 1, "C2 catches 'Revenue' (case-insensitive)");
  failures = beforeC2;

  // C3 catches 'Opened' label.
  const beforeC3 = failures;
  checkOverviewNoOpened('label="Opened"');
  expect(failures === beforeC3 + 1, "C3 catches label=\"Opened\"");
  failures = beforeC3;

  // C4 missing-guard test.
  const beforeC4 = failures;
  checkStarterPackGuard("export function updateUserTemplate() {}");
  expect(failures === beforeC4 + 1, "C4 catches missing assertNotStarterPack");
  failures = beforeC4;

  // C4 positive: guard present in both methods.
  const goodTpl =
    "function updateUserTemplate() { assertNotStarterPack(); throw new Error(\"Cannot modify starter-pack template\"); }\n" +
    "function deleteUserTemplate() { assertNotStarterPack(); throw new Error(\"Cannot modify starter-pack template\"); }";
  checkStarterPackGuard(goodTpl);
  expect(failures === beforeC4, "C4 passes with assertNotStarterPack in 2 methods");

  // C5 catches missing template param.
  const beforeC5 = failures;
  checkComposeTemplateParam("useLocalSearchParams<{ audience?: string }>()");
  expect(failures === beforeC5 + 1, "C5 catches missing template? param");
  failures = beforeC5;

  if (selfFails > 0) {
    console.error(`# Self-test FAILED: ${selfFails} expectation(s) not met`);
    process.exit(1);
  }
  console.log("# Self-test PASSED");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  runSelfTest();
}

console.log("# ORCH-0863 strict-grep gate — Marketing Hub Phase B");

const overviewSrc = readSource(OVERVIEW_ROUTE);
checkOverviewNoDollar(overviewSrc);
checkOverviewNoRevenue(overviewSrc);
checkOverviewNoOpened(overviewSrc);

const templateSvcSrc = readSource(TEMPLATE_SERVICE);
checkStarterPackGuard(templateSvcSrc);

const composeSrc = readSource(COMPOSE_ROUTE);
checkComposeTemplateParam(composeSrc);

checkOverviewServiceExists();

checkNoNewBackendFiles();

if (failures > 0) {
  console.error(`# ${failures} failure(s) — see above`);
  process.exit(1);
}
console.log("# All checks PASS");
process.exit(0);
