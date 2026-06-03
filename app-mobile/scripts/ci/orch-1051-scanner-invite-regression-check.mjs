#!/usr/bin/env node
/**
 * ORCH-1051 — happy-path regression check for the scanner-team invite flow.
 *
 * NOTE on location: ORCH-1051 ships in mingla-business (Business app +
 * Supabase backend). This script lives under app-mobile/scripts/ci/ to
 * follow the SPEC layout — it inspects mingla-business paths from the
 * repo root.
 *
 * Validates the SHIPPED contract:
 *   - InviteScannerSheet calls useInviteScanner (real backend pipeline),
 *     not the old Zustand recordInvitation directly.
 *   - /event/[id]/scanners reads from React Query
 *     (useScannerInvitationsForEvent), not from
 *     useScannerInvitationsStore.entries.
 *   - The /accept-scanner-invitation landing route is wired with
 *     useAcceptScannerInvitation.
 *   - The new edge fn entry points + service file are on disk.
 *
 * CLOSE Step 0.5: PASSES on the head commit and MUST FAIL on revert (e.g.
 * if the sheet falls back to recordInvitation or the service file is
 * dropped).
 *
 * Run: node app-mobile/scripts/ci/orch-1051-scanner-invite-regression-check.mjs
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd().endsWith("app-mobile")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const REQUIRED = [
  {
    rel: "mingla-business/src/components/scanners/InviteScannerSheet.tsx",
    needle: "useInviteScanner",
    forbid: "recordInvitation({",
  },
  {
    rel: "mingla-business/app/event/[id]/scanners/index.tsx",
    needle: "useScannerInvitationsForEvent",
    forbid: "useScannerInvitationsStore((s) => s.entries)",
  },
  {
    rel: "mingla-business/app/accept-scanner-invitation.tsx",
    needle: "useAcceptScannerInvitation",
    forbid: null,
  },
  {
    rel: "mingla-business/src/services/scannerInvitationsService.ts",
    needle: "inviteScanner",
    forbid: null,
  },
  {
    rel: "mingla-business/src/hooks/useScannerInvitations.ts",
    needle: "useInviteScanner",
    forbid: null,
  },
  {
    rel: "supabase/functions/invite-scanner/index.ts",
    needle: "biz_brand_effective_rank",
    forbid: null,
  },
  {
    rel: "supabase/functions/accept-scanner-invitation/index.ts",
    needle: "accept_scanner_invitation",
    forbid: null,
  },
];

const failures = [];

// Track the planned migration filename. Update the literal if the version
// slipped during rebase.
const MIGRATION_REL =
  "supabase/migrations/20260821000000_orch_1051_scanner_invite_flow.sql";
if (!fs.existsSync(path.join(repoRoot, MIGRATION_REL))) {
  failures.push(`${MIGRATION_REL}: migration file missing`);
}

for (const rule of REQUIRED) {
  const abs = path.join(repoRoot, rule.rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rule.rel}: required file missing`);
    continue;
  }
  const text = fs.readFileSync(abs, "utf8");
  if (rule.needle && !text.includes(rule.needle)) {
    failures.push(`${rule.rel}: missing required symbol "${rule.needle}"`);
  }
  if (rule.forbid && text.includes(rule.forbid)) {
    failures.push(`${rule.rel}: forbidden pattern present "${rule.forbid}"`);
  }
}

if (failures.length > 0) {
  console.error(
    `ORCH-1051 regression check FAIL — ${failures.length} issue(s):\n` +
      failures.join("\n"),
  );
  process.exit(1);
}

console.log(
  "ORCH-1051 regression check PASS — scanner invite flow wired end-to-end.",
);
