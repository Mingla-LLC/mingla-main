#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1240 / GitHub #668 — dual-sided account deletion regression (structural).
 *
 * Fails if delete-user reverts to unconditional auth.admin.deleteUser without
 * side-aware gating, or if clients stop sending `{ side: ... }`.
 *
 * #2321 RETIRED T-05 and T-07 — both were #2113-class checks that carried no
 * information. T-05 grepped the ORCH-1240 migration FILE for `explorer_deleted_at`
 * and stayed green for the whole life of the feature while that migration was never
 * applied to production and the column did not exist. T-07 grepped the edge function
 * for the literal string `authRetained`, which was green regardless of whether any
 * client honoured it — and no client did. A check that reads the repo cannot see a
 * migration that never ran. Their replacement asserts behaviour, not source text:
 * `.github/scripts/strict-grep/issue-2321-retained-auth-cannot-claim-deleted.mjs`.
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

check(
  // #2321 renamed the gate: the request path now calls `evaluateAuthRemoval`, which
  // returns WHY the login was retained. Both names are accepted so this check tracks
  // the behaviour (auth removal is gated) rather than one identifier. It is NOT
  // satisfied by a dead reference kept alive to please a grep.
  "T-01 [FAILS-ON-REVERT] delete-user gates auth.admin.deleteUser behind the side evaluator",
  edgeFn !== null &&
    (/evaluateAuthRemoval\(/.test(edgeFn) || /shouldDeleteAuthUser\(/.test(edgeFn)) &&
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
  "T-06 shared module strips support conversation participants on explorer purge",
  shared !== null && /conversation_participants/.test(shared),
  "Explorer purge must remove support inbox participation.",
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
