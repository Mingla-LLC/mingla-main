#!/usr/bin/env node
/**
 * ORCH-1051 — adversarial regression check.
 *
 * Self-tests the strict-grep functional gate (positive + negative fixtures)
 * and validates the canonical service shape — the contract the UI depends on.
 * Fails if the gate stops detecting a TRANSITIONAL banner injection, if the
 * service drops any of its public exports, if the migration drops an ERRCODE,
 * or if the scan-permission union loses brand_team_members.
 *
 * Run: node app-mobile/scripts/ci/orch-1051-scanner-invite-adversarial-check.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd().endsWith("app-mobile")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const failures = [];

// 1. The functional gate's --self-test must PASS.
const gate = path.join(
  repoRoot,
  ".github/scripts/strict-grep/orch-1051-scanner-invite-functional.mjs",
);
if (!fs.existsSync(gate)) {
  failures.push(`functional gate missing at ${gate}`);
} else {
  const r = spawnSync("node", [gate, "--self-test"], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    failures.push(
      `functional gate --self-test exited non-zero:\n${r.stdout}\n${r.stderr}`,
    );
  }
}

// 2. scannerInvitationsService must export the canonical functions + error
//    class + key factory.
const servicePath = path.join(
  repoRoot,
  "mingla-business/src/services/scannerInvitationsService.ts",
);
if (!fs.existsSync(servicePath)) {
  failures.push("scannerInvitationsService.ts missing");
} else {
  const text = fs.readFileSync(servicePath, "utf8");
  const requiredExports = [
    "export async function inviteScanner",
    "export async function acceptScannerInvitation",
    "export async function revokeScannerInvitation",
    "export async function listScannerInvitationsForBrand",
    "export async function listScannerInvitationsForEvent",
    "export class ScannerInvitationServiceError",
    "export const scannerInvitationKeys",
  ];
  for (const sym of requiredExports) {
    if (!text.includes(sym)) {
      failures.push(`service: missing export "${sym}"`);
    }
  }
}

// 3. The Postgres RPC must declare all 5 error codes (P0001..P0005). The
//    accept edge fn maps these; losing one silently widens the failure mode.
const migrationPath = path.join(
  repoRoot,
  "supabase/migrations/20260821000000_orch_1051_scanner_invite_flow.sql",
);
if (!fs.existsSync(migrationPath)) {
  failures.push("migration file missing");
} else {
  const sql = fs.readFileSync(migrationPath, "utf8");
  for (const code of ["P0001", "P0002", "P0003", "P0004", "P0005"]) {
    if (!sql.includes(`ERRCODE = '${code}'`)) {
      failures.push(`migration: missing RAISE EXCEPTION ERRCODE ${code}`);
    }
  }
  // The RPC must lock the invitation row to defeat double-accept races.
  if (!sql.includes("FOR UPDATE")) {
    failures.push("migration: RPC missing FOR UPDATE row lock");
  }
  // biz_ticket_scan permission union MUST honor both event_scanners AND
  // brand_team_members.role='scanner'. The whole point of ORCH-1051.
  if (!sql.includes("event_scanners")) {
    failures.push("migration: scan-permission union missing event_scanners path");
  }
  if (!sql.includes("brand_team_members") || !sql.includes("m.role = 'scanner'")) {
    failures.push(
      "migration: scan-permission union missing brand_team_members.role='scanner' path",
    );
  }
  // RLS predicates must be inline EXISTS, no SECURITY DEFINER helpers in
  // policy USING/WITH CHECK clauses per [[feedback-rls-returning-owner-gap]].
  // Heuristic: forbid biz_is_*_for_caller() inside scanner_invitations policies.
  if (sql.includes("biz_is_") && /POLICY[\s\S]*scanner_invitations[\s\S]*biz_is_/.test(sql)) {
    failures.push(
      "migration: scanner_invitations RLS uses biz_is_*_for_caller helper; must be inline EXISTS",
    );
  }
}

// 4. The accept edge fn must map every ERRCODE → HTTP envelope.
const acceptIndex = path.join(
  repoRoot,
  "supabase/functions/accept-scanner-invitation/index.ts",
);
if (fs.existsSync(acceptIndex)) {
  const text = fs.readFileSync(acceptIndex, "utf8");
  for (const code of ["P0001", "P0002", "P0003", "P0004", "P0005"]) {
    if (!text.includes(`"${code}"`)) {
      failures.push(
        `accept-scanner-invitation: missing HTTP mapping for ${code}`,
      );
    }
  }
  // creator_accounts lookup must use .id, not .user_id (the column does not
  // exist; this is the ORCH-1050 gotcha).
  if (text.includes('.eq("user_id", userId)')) {
    failures.push(
      "accept-scanner-invitation: looking up creator_accounts by .user_id — column does not exist. Use .id.",
    );
  }
}

// 5. The invite edge fn must scope-discriminate event_id requirement.
const inviteIndex = path.join(
  repoRoot,
  "supabase/functions/invite-scanner/index.ts",
);
if (fs.existsSync(inviteIndex)) {
  const text = fs.readFileSync(inviteIndex, "utf8");
  if (!text.includes("VALID_SCOPES") && !text.includes('"event"') && !text.includes("'event'")) {
    failures.push(
      "invite-scanner: scope enum not enforced (expected event|brand discrimination)",
    );
  }
  // Rank gate must be event_manager+ (rank 40 = MANAGE_SCANNERS).
  if (!text.includes("RANK_EVENT_MANAGER")) {
    failures.push(
      "invite-scanner: missing RANK_EVENT_MANAGER permission gate (rank 40)",
    );
  }
}

if (failures.length > 0) {
  console.error(
    `ORCH-1051 adversarial check FAIL — ${failures.length} issue(s):\n` +
      failures.join("\n"),
  );
  process.exit(1);
}
console.log(
  "ORCH-1051 adversarial check PASS — gate self-test + service shape + RPC codes + scan-permission union OK.",
);
