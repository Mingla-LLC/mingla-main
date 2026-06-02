#!/usr/bin/env node
/**
 * ORCH-1050 — happy-path regression check for the brand-team invite flow.
 *
 * NOTE on location: ORCH-1050 ships in mingla-business (Business app +
 * Supabase backend). This script lives under app-mobile/scripts/ci/ to
 * follow the SPEC layout — it inspects mingla-business paths from the
 * repo root.
 *
 * Validates the SHIPPED contract:
 *   - InviteBrandMemberSheet calls useInviteBrandMember (real backend
 *     pipeline), not the old Zustand recordInvitation directly.
 *   - team.tsx reads from React Query (useBrandInvitations +
 *     useBrandTeamMembers), not from useBrandTeamStore.entries.
 *   - The accept-brand-invitation landing route is wired with
 *     useAcceptBrandInvitation.
 *   - The new edge fn entry points + service file are on disk.
 *
 * Run: node app-mobile/scripts/ci/orch-1050-brand-invite-regression-check.mjs
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd().endsWith("app-mobile")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const REQUIRED = [
  {
    rel: "mingla-business/src/components/team/InviteBrandMemberSheet.tsx",
    needle: "useInviteBrandMember",
    forbid: "recordInvitation({",
  },
  {
    rel: "mingla-business/app/brand/[id]/team.tsx",
    needle: "useBrandInvitations",
    forbid: "useBrandTeamStore((s) => s.entries)",
  },
  {
    rel: "mingla-business/app/accept-brand-invitation.tsx",
    needle: "useAcceptBrandInvitation",
    forbid: null,
  },
  {
    rel: "mingla-business/src/services/brandInvitationsService.ts",
    needle: "inviteBrandMember",
    forbid: null,
  },
  {
    rel: "mingla-business/src/hooks/useBrandInvitations.ts",
    needle: "useInviteBrandMember",
    forbid: null,
  },
  {
    rel: "supabase/functions/invite-brand-member/index.ts",
    needle: "biz_brand_effective_rank",
    forbid: null,
  },
  {
    rel: "supabase/functions/accept-brand-invitation/index.ts",
    needle: "accept_invite_and_transfer_brand_ownership",
    forbid: null,
  },
];

const failures = [];

// Note the unfortunate way the migration version is generated: it tracks
// the planned filename for the SPEC's allowlist. If the version slipped
// during rebase, update the literal here.
const MIGRATION_REL =
  "supabase/migrations/20260820000000_orch_1050_brand_invite_flow.sql";
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
    `ORCH-1050 regression check FAIL — ${failures.length} issue(s):\n` +
      failures.join("\n"),
  );
  process.exit(1);
}

console.log("ORCH-1050 regression check PASS — invite flow wired end-to-end.");
