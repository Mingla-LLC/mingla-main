#!/usr/bin/env node
/**
 * ORCH-1050 — adversarial regression check.
 *
 * Self-tests the strict-grep functional gate (positive + negative fixtures)
 * and validates the canonical service shape — the contract the UI depends on.
 * Fails if the gate stops detecting a TRANSITIONAL banner injection, or if
 * the service drops any of its 4 public exports.
 *
 * Run: node app-mobile/scripts/ci/orch-1050-brand-invite-adversarial-check.mjs
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
  ".github/scripts/strict-grep/orch-1050-brand-invite-functional.mjs",
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

// 2. brandInvitationsService must export the canonical 5 functions + 1
//    error class + 2 key factories. Drift = the UI silently breaks.
const servicePath = path.join(
  repoRoot,
  "mingla-business/src/services/brandInvitationsService.ts",
);
if (!fs.existsSync(servicePath)) {
  failures.push("brandInvitationsService.ts missing");
} else {
  const text = fs.readFileSync(servicePath, "utf8");
  const requiredExports = [
    "export async function inviteBrandMember",
    "export async function acceptBrandInvitation",
    "export async function revokeBrandInvitation",
    "export async function listBrandInvitations",
    "export async function listBrandTeamMembers",
    "export class BrandInvitationServiceError",
    "export const brandInvitationKeys",
    "export const brandTeamMemberKeys",
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
  "supabase/migrations/20260820000000_orch_1050_brand_invite_flow.sql",
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
}

// 4. The accept edge fn must map every ERRCODE → HTTP envelope.
const acceptIndex = path.join(
  repoRoot,
  "supabase/functions/accept-brand-invitation/index.ts",
);
if (fs.existsSync(acceptIndex)) {
  const text = fs.readFileSync(acceptIndex, "utf8");
  for (const code of ["P0001", "P0002", "P0003", "P0004", "P0005"]) {
    if (!text.includes(`"${code}"`)) {
      failures.push(
        `accept-brand-invitation: missing HTTP mapping for ${code}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(
    `ORCH-1050 adversarial check FAIL — ${failures.length} issue(s):\n` +
      failures.join("\n"),
  );
  process.exit(1);
}
console.log(
  "ORCH-1050 adversarial check PASS — gate self-test + service shape + RPC codes OK.",
);
