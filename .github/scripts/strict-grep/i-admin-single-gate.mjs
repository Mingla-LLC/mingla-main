#!/usr/bin/env node
/**
 * ORCH-1271 [Admin authorization & audit FOUNDATION] — I-PROPOSED-1271-ADMIN-SINGLE-GATE.
 *
 * RULE: no in-scope admin authorization path uses profiles.account_type='admin';
 * public.is_admin_user() is the sole admin-identity gate. The two split-gate
 * partner-money SELECT policies are reconciled to is_admin_user() by the ORCH-1271
 * flip migration.
 *
 * Migrations are append-only history, so the EFFECTIVE state of a policy is set by
 * its LAST (highest-timestamp) definer — "last-writer-wins". This gate therefore,
 * for each in-scope policy, finds the latest CREATE POLICY across all migrations
 * and asserts it (a) uses is_admin_user() and (b) does NOT reference account_type.
 * Reverting the flip migration makes the OLD 1052/1054 account_type definer the
 * last writer again → this gate FAILS (fails-on-revert).
 *
 * `--self-test` proves FAIL-on-revert with GOOD/BAD fixtures.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

// { policy name → its table } — the two in-scope split-gate policies.
const IN_SCOPE_POLICIES = [
  { name: "partner_stripe_self_select", table: "partner_stripe_connect_accounts" },
  { name: "partner_splits_partner_self_select", table: "partner_splits" },
];

// Extract the LAST CREATE POLICY <name> statement (up to its terminating ';')
// across files supplied in ascending filename order.
function latestCreatePolicy(fileEntries, policyName) {
  const re = new RegExp(`create\\s+policy\\s+"?${policyName}"?\\b[\\s\\S]*?;`, "i");
  let latest = null;
  for (const { src } of fileEntries) {
    const m = re.exec(src);
    if (m) latest = m[0]; // later files overwrite → last one wins
  }
  return latest;
}

function check(fileEntries, failures) {
  // fileEntries MUST be sorted ascending by filename (migration apply order).
  for (const { name, table } of IN_SCOPE_POLICIES) {
    const stmt = latestCreatePolicy(fileEntries, name);
    if (!stmt) {
      failures.push(`in-scope policy ${name} (on ${table}) has no CREATE POLICY in any migration.`);
      continue;
    }
    if (/account_type/i.test(stmt)) {
      failures.push(
        `latest ${name} definer still references account_type (split gate not retired) — ` +
          `flip it to public.is_admin_user().`,
      );
    }
    if (!/is_admin_user\s*\(\s*\)/i.test(stmt)) {
      failures.push(`latest ${name} definer does not gate on public.is_admin_user().`);
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const oldStripe =
    'create policy partner_stripe_self_select on public.partner_stripe_connect_accounts ' +
    "for select using (account_id = auth.uid() or exists (select 1 from public.profiles p " +
    "where p.id = auth.uid() and p.account_type = 'admin'));\n";
  const oldSplits =
    "create policy partner_splits_partner_self_select on public.partner_splits for select " +
    "using (partner_account_id = auth.uid() or exists (select 1 from public.profiles p " +
    "where p.id = auth.uid() and p.account_type = 'admin'));\n";
  const flipStripe =
    "create policy partner_stripe_self_select on public.partner_stripe_connect_accounts " +
    "for select using (account_id = auth.uid() or public.is_admin_user());\n";
  const flipSplits =
    "create policy partner_splits_partner_self_select on public.partner_splits for select " +
    "using (partner_account_id = auth.uid() or public.is_admin_user());\n";

  // GOOD: old account_type files + a LATER flip file → flip wins.
  let f = [];
  check(
    [
      { name: "20260822_old.sql", src: oldStripe },
      { name: "20260823_old.sql", src: oldSplits },
      { name: "20261203_flip.sql", src: flipStripe + flipSplits },
    ],
    f,
  );
  if (f.length) self.push("good (flip present) fixture wrongly flagged: " + f.join("; "));

  // BAD (revert): flip file removed → account_type definer is last → MUST fire (both).
  f = [];
  check(
    [
      { name: "20260822_old.sql", src: oldStripe },
      { name: "20260823_old.sql", src: oldSplits },
    ],
    f,
  );
  if (f.length < 2) self.push("reverted flip (account_type last-writer) not flagged");

  // BAD2: a later migration re-introduces account_type → MUST fire.
  f = [];
  check(
    [
      { name: "20261203_flip.sql", src: flipStripe + flipSplits },
      { name: "20261210_regress.sql", src: oldStripe },
    ],
    f,
  );
  if (f.length === 0) self.push("re-introduced account_type definer not flagged");

  if (self.length) {
    console.error("I-ADMIN-SINGLE-GATE self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-ADMIN-SINGLE-GATE self-test PASS (3/3 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-ADMIN-SINGLE-GATE FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const fileEntries = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, src: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));

const failures = [];
check(fileEntries, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1271-ADMIN-SINGLE-GATE FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1271-ADMIN-SINGLE-GATE PASS — both partner-money SELECT policies gate on " +
    "public.is_admin_user(); the account_type='admin' split gate is retired.",
);
