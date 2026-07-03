#!/usr/bin/env node
/**
 * ORCH-1274 [Admin Money console — READ-ONLY] — I-PROPOSED-1274-MONEY-READ-VIA-
 * DEFINER-RPC + I-PROPOSED-1274-MONEY-READ-CENTS-CONTRACT.
 *
 * RULE (money containment): every admin money read goes through an `admin_*`
 * SECURITY DEFINER RPC — there is NO is_admin_user() SELECT RLS policy on any
 * money table (orders / order_line_items / order_installments / refunds /
 * refund_line_items / payouts / stripe_disputes / stripe_connect_accounts /
 * mingla_revenue_log / stripe_external_accounts / partner_splits). And the money
 * read-RPCs return integer cents + a currency code — never a pre-formatted
 * currency string (no to_char, no embedded '$').
 *
 * Enforcement (over supabase/migrations/**, SQL comments stripped first):
 *   (a) NO `CREATE POLICY ... ON public.<money_table> ... is_admin_user()` in any
 *       migration (an admin RLS grant on a sensitive money table is forbidden —
 *       reads go ONLY through the definer RPCs);
 *   (b) all 10 money read-RPC definitions are PRESENT in migrations (reverting
 *       20261207000000_orch_1274_money_read_rpcs.sql removes them → FAIL);
 *   (c) the money read-RPC migration contains no `to_char(` and no `'$'` literal
 *       (cents contract; a formatted-string return would trip this).
 *
 * `--self-test` proves FAIL-on-revert with GOOD/BAD fixtures.
 *
 * DRAFT until CLOSE (orchestrator flips the two I-PROPOSED-1274 invariants ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

// Money tables that must carry NO admin RLS policy — 1274 reads them ONLY via the
// definer RPCs. NOTE: partner_splits is intentionally EXCLUDED: ORCH-1271's
// single_admin_gate migration already grants admin read on partner_splits via an
// `OR public.is_admin_user()` branch in partner_splits_partner_self_select (a
// FOUNDATION decision this ORCH must not touch — DO-NOT-TOUCH: any money-table
// RLS). 1274 still reads partner_splits ONLY through admin_get_order (SECURITY
// DEFINER), so the read-path containment holds; forbidding admin RLS on it here
// would require reverting the 1271 foundation. (SPEC §10 listed it in error — see
// the implementation report's Discoveries.)
const MONEY_TABLES = [
  "orders",
  "order_line_items",
  "order_installments",
  "refunds",
  "refund_line_items",
  "payouts",
  "stripe_disputes",
  "stripe_connect_accounts",
  "mingla_revenue_log",
  "stripe_external_accounts",
];

const MONEY_RPCS = [
  "admin_list_brand_stripe_status",
  "admin_get_brand_stripe_status",
  "admin_list_orders",
  "admin_get_order",
  "admin_list_refunds",
  "admin_list_disputes",
  "admin_get_dispute",
  "admin_list_payouts",
  "admin_list_revenue_log",
  "admin_get_subscription_detail",
];

// Identifies the money read-RPC migration by the first RPC's definition.
const MONEY_MIG_MARKER = /create\s+or\s+replace\s+function\s+public\.admin_list_brand_stripe_status\s*\(/i;
const POLICY_RE = /create\s+policy[\s\S]*?;/gi;

function rpcDefRe(name) {
  return new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i");
}

// Strip SQL comments (everything from `--` to end-of-line, on every line) so a
// commented example / doc mention never false-fails, and a commented-out
// definition counts as absent (fails-on-revert for comment-out too).
function stripSqlComments(src) {
  return src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

function findMoneyAdminPolicies(src) {
  const hits = [];
  const stmts = src.match(POLICY_RE) || [];
  for (const stmt of stmts) {
    if (!/is_admin_user\s*\(/i.test(stmt)) continue;
    for (const t of MONEY_TABLES) {
      if (new RegExp(`on\\s+public\\.${t}\\b`, "i").test(stmt)) {
        hits.push(`forbidden admin RLS policy referencing is_admin_user() on money table public.${t}.`);
        break;
      }
    }
  }
  return hits;
}

/** @param {string} src combined migrations (comments stripped)
 *  @param {string|null} moneyMig the money-RPC migration (comments stripped) */
function check(src, moneyMig, failures) {
  // (a) no admin RLS on any money table.
  for (const h of findMoneyAdminPolicies(src)) failures.push(h);
  // (b) all 10 read-RPCs present.
  for (const name of MONEY_RPCS) {
    if (!rpcDefRe(name).test(src)) {
      failures.push(`money read-RPC public.${name}(...) is missing from migrations.`);
    }
  }
  // (c) cents contract — no pre-formatted money in the money read-RPC migration.
  if (moneyMig != null) {
    if (/to_char\s*\(/i.test(moneyMig)) {
      failures.push(
        "money read-RPC migration uses to_char(...) — return integer cents + a currency code, never a formatted string.",
      );
    }
    if (/'\$'/.test(moneyMig)) {
      failures.push(
        "money read-RPC migration embeds a '$' currency symbol — return integer cents + a currency code, never a formatted string.",
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const goodMoneyMig = MONEY_RPCS.map(
    (n) =>
      `CREATE OR REPLACE FUNCTION public.${n}(p_x uuid) RETURNS jsonb ` +
      "LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN " +
      "IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; " +
      "RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0); END; $$;",
  ).join("\n");

  // GOOD: all 10 RPCs, no money policy, cents-clean.
  let f = [];
  check(stripSqlComments(goodMoneyMig), stripSqlComments(goodMoneyMig), f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD1: an admin SELECT RLS policy on a money table → MUST fire.
  const withPolicy =
    goodMoneyMig +
    '\nCREATE POLICY "orders admin can read" ON public.orders FOR SELECT USING (public.is_admin_user());';
  f = [];
  check(stripSqlComments(withPolicy), stripSqlComments(goodMoneyMig), f);
  if (f.length === 0) self.push("admin RLS on money table not flagged");

  // BAD2: a removed read-RPC (revert) → MUST fire.
  const missingRpc = MONEY_RPCS.filter((n) => n !== "admin_get_order")
    .map(
      (n) =>
        `CREATE OR REPLACE FUNCTION public.${n}(p_x uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN ` +
        "IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; RETURN '{}'::jsonb; END; $$;",
    )
    .join("\n");
  f = [];
  check(stripSqlComments(missingRpc), stripSqlComments(missingRpc), f);
  if (f.length === 0) self.push("reverted money read-RPC not flagged");

  // BAD3: a to_char-formatted money return → MUST fire the cents contract.
  const formattedMig = goodMoneyMig.replace(
    "RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0);",
    "RETURN jsonb_build_object('amount', to_char(1000, 'FM999'));",
  );
  f = [];
  check(stripSqlComments(formattedMig), stripSqlComments(formattedMig), f);
  if (f.length === 0) self.push("to_char-formatted money return not flagged");

  if (self.length) {
    console.error("I-MONEY-NO-ADMIN-RLS self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-MONEY-NO-ADMIN-RLS self-test PASS (4/4 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-MONEY-NO-ADMIN-RLS FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((n) => n.endsWith(".sql"))
  .sort();
const combined = stripSqlComments(
  files.map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8")).join("\n"),
);
let moneyMig = null;
for (const n of files) {
  const s = stripSqlComments(fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"));
  if (MONEY_MIG_MARKER.test(s)) {
    moneyMig = s;
    break;
  }
}

const failures = [];
check(combined, moneyMig, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC / CENTS-CONTRACT FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC PASS — no admin RLS on any money table, " +
    "all 10 money read-RPCs present, and the money migration returns integer cents (no to_char/'$').",
);
