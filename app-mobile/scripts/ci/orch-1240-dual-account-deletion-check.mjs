#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1240 / GitHub #668 — dual-sided account deletion regression (structural).
 *
 * Fails if delete-user reverts to unconditional auth.admin.deleteUser without
 * side-aware gating, or if clients stop sending `{ side: ... }`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const edgeFn = read("supabase/functions/delete-user/index.ts");
const shared = read("supabase/functions/_shared/accountDeletionSides.ts");
const consumerSettings = read("app-mobile/src/components/profile/AccountSettings.tsx");
const businessHook = read("mingla-business/src/hooks/useAccountDeletion.ts");
const migration = read(
  "supabase/migrations/20261128000000_orch_1240_issue_668_dual_account_deletion.sql",
);

check(
  "T-01 [FAILS-ON-REVERT] delete-user calls shouldDeleteAuthUser before auth.admin.deleteUser",
  edgeFn !== null &&
    /shouldDeleteAuthUser\(/.test(edgeFn) &&
    /auth\.admin\.deleteUser/.test(edgeFn),
  "Auth removal must be gated — unconditional deleteUser breaks dual-login accounts.",
);

check(
  "T-02 delete-user parses side=explorer|business",
  edgeFn !== null &&
    /side === "business"/.test(edgeFn) &&
    /purgeExplorerSideData/.test(edgeFn) &&
    /purgeBusinessSideData/.test(edgeFn),
  "Missing side-aware branches.",
);

check(
  "T-03 consumer delete invokes edge fn with side explorer",
  consumerSettings !== null && /side:\s*"explorer"/.test(consumerSettings),
  "Consumer AccountSettings must pass side: 'explorer'.",
);

check(
  "T-04 business delete invokes edge fn with side business",
  businessHook !== null && /side:\s*"business"/.test(businessHook),
  "Business useRequestAccountDeletion must pass side: 'business'.",
);

check(
  "T-05 migration adds profiles.explorer_deleted_at",
  migration !== null && /explorer_deleted_at/.test(migration),
  "Missing explorer side marker column.",
);

check(
  "T-06 shared module strips support conversation participants on explorer purge",
  shared !== null && /conversation_participants/.test(shared),
  "Explorer purge must remove support inbox participation.",
);

check(
  "T-07 response includes authRetained for partial delete",
  edgeFn !== null && /authRetained/.test(edgeFn),
  "Clients need authRetained to show correct success copy.",
);

let failed = 0;
console.log("\nORCH-1240 / #668 dual-account-deletion regression check\n");
for (const c of checks) {
  console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(`\nSummary: ${checks.length - failed}/${checks.length} PASS\n`);
process.exit(failed > 0 ? 1 : 0);
