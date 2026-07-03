#!/usr/bin/env node
/**
 * ORCH-1272 [Admin Identity console — READ-ONLY] — I-PROPOSED-1272-IDENTITY-ADMIN-READ.
 *
 * RULE: the four identity tables creator_accounts, brand_team_members,
 * brand_invitations, partner_brand_links each carry an is_admin_user() SELECT RLS
 * policy; the admin Person bundle reads the sensitive subscriptions /
 * admin_subscription_overrides ONLY through the guard-first admin_get_person RPC —
 * NEVER via a direct browser read.
 *
 * Enforcement (over supabase/migrations/** + the identity read service):
 *   (a) each of the four `CREATE POLICY "<table> admin can read" ON public.<table>
 *       FOR SELECT USING (public.is_admin_user())` tokens is PRESENT in a migration;
 *   (b) `admin_get_person(` is defined in a migration;
 *   (c) mingla-admin/src/services/identityReadService.js does NOT directly read
 *       subscriptions / admin_subscription_overrides (they must flow via the RPC).
 *
 * Reverting the RLS/RPC migration removes the (a)/(b) tokens → this gate FAILS.
 * A regression that reads subscriptions directly in the browser → (c) FAILS.
 * `--self-test` proves FAIL-on-revert with GOOD/BAD fixtures.
 *
 * DRAFT until CLOSE (orchestrator flips I-PROPOSED-1272-IDENTITY-ADMIN-READ ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const SERVICE_FILE = path.join(process.cwd(), "mingla-admin/src/services/identityReadService.js");

const READ_TABLES = [
  "creator_accounts",
  "brand_team_members",
  "brand_invitations",
  "partner_brand_links",
];

function policyRe(table) {
  return new RegExp(
    `create\\s+policy\\s+"${table} admin can read"\\s+on\\s+public\\.${table}\\s+for\\s+select\\s+using\\s*\\(\\s*public\\.is_admin_user\\(\\)\\s*\\)`,
    "i",
  );
}

const RPC_RE = /create\s+or\s+replace\s+function\s+public\.admin_get_person\s*\(/i;

// A direct browser read of the sensitive tables in the service (the RPC is the
// only sanctioned path). Comment lines are stripped before the check.
const DIRECT_SUB_RE = /\.from\(\s*["'](?:subscriptions|admin_subscription_overrides)["']\s*\)/i;

function stripComments(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

function check(migSrc, serviceSrc, failures) {
  for (const t of READ_TABLES) {
    if (!policyRe(t).test(migSrc)) {
      failures.push(`missing is_admin_user() SELECT policy "${t} admin can read" on public.${t}.`);
    }
  }
  if (!RPC_RE.test(migSrc)) {
    failures.push("admin_get_person(uuid) read-RPC definition is missing from migrations.");
  }
  if (serviceSrc != null && DIRECT_SUB_RE.test(stripComments(serviceSrc))) {
    failures.push(
      "identityReadService.js reads subscriptions/admin_subscription_overrides directly — " +
        "route those through the guard-first admin_get_person RPC.",
    );
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const goodMig =
    READ_TABLES.map(
      (t) => `CREATE POLICY "${t} admin can read" ON public.${t} FOR SELECT USING (public.is_admin_user());`,
    ).join("\n") + "\nCREATE OR REPLACE FUNCTION public.admin_get_person(p_user_id uuid) RETURNS jsonb AS $$ BEGIN END; $$;\n";
  const goodService = 'supabase.rpc("admin_get_person", { p_user_id: userId });\n';

  // GOOD: all 4 policies + RPC + clean service.
  let f = [];
  check(goodMig, goodService, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD1: one policy removed (revert) → MUST fire.
  const missingOne = goodMig.replace(
    'CREATE POLICY "partner_brand_links admin can read" ON public.partner_brand_links FOR SELECT USING (public.is_admin_user());',
    "",
  );
  f = [];
  check(missingOne, goodService, f);
  if (f.length === 0) self.push("reverted RLS policy not flagged");

  // BAD2: RPC removed (revert) → MUST fire.
  const noRpc = goodMig.replace(RPC_RE, "-- removed (");
  f = [];
  check(noRpc, goodService, f);
  if (f.length === 0) self.push("reverted admin_get_person RPC not flagged");

  // BAD3: service reads subscriptions directly → MUST fire.
  const badService = goodService + 'supabase.from("subscriptions").select("*");\n';
  f = [];
  check(goodMig, badService, f);
  if (f.length === 0) self.push("direct subscriptions browser-read not flagged");

  if (self.length) {
    console.error("I-1272-IDENTITY-ADMIN-READ self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-1272-IDENTITY-ADMIN-READ self-test PASS (4/4 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-1272-IDENTITY-ADMIN-READ FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const migSrc = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"))
  .join("\n");
const serviceSrc = fs.existsSync(SERVICE_FILE) ? fs.readFileSync(SERVICE_FILE, "utf8") : null;

const failures = [];
check(migSrc, serviceSrc, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1272-IDENTITY-ADMIN-READ FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1272-IDENTITY-ADMIN-READ PASS — the four identity tables carry is_admin_user() " +
    "SELECT policies, admin_get_person is defined, and the read service takes no direct subscriptions read.",
);
