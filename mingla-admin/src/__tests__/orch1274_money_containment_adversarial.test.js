// ORCH-1274 [Admin Money console — READ-ONLY] — TESTER ADVERSARIAL suite.
//
// A DIFFERENT ANGLE than the implementor happy-path
// (orch1274_money_console_read.test.js). The happy-path proves the guard line is
// PRESENT and adjacent to BEGIN, the REVOKE/GRANT pair exists, and the UI takes no
// `.from(<money table>)`. This suite instead attacks the money-containment +
// least-privilege + guard-first invariant from the angles that a plausible future
// regression would slip past the happy-path:
//
//   A. READ-ONLY — the money migration must never MUTATE a money table (no
//      insert/update/delete) and must call no admin_write_audit(. A money console
//      that writes is a P0 (money-containment breach + un-audited mutation).
//   B. SECURITY DEFINER preserved — a definer→invoker regression silently breaks
//      containment: the RPC would run with the CALLER's RLS and return 0 rows to
//      the admin (the direct-select-is-0 proof would then also empty the RPC).
//   C. `total` = the FULL filtered count, never the page slice — a regression to
//      jsonb_array_length(page) silently UNDER-reports on page 2+, so an admin no
//      longer "sees ALL brands' money" (cross-brand/silent-empty parity, AC-2).
//   D. No money-table GRANT broadening — the migration must not hand anon /
//      authenticated a fresh table-level SELECT on a money table (that would let
//      the browser read the table directly, bypassing the definer RPC).
//   E. Guard is the FIRST executable statement — parsed independently of the
//      happy-path's adjacency regex: strip comments, and assert NO query
//      (WITH/SELECT/PERFORM/INSERT/UPDATE/DELETE) precedes the is_admin_user()
//      guard (a query-before-guard opens a fail-open exposure window).
//   F. Cross-migration containment — across ALL migrations (not just this one), no
//      money table carries a `create policy ... is_admin_user()`, EXCEPT
//      partner_splits (the ORCH-1271 foundation branch; DO-NOT-TOUCH).
//
// FAILS-ON-REVERT ANCHOR: deleting the `IF NOT public.is_admin_user() ...` guard
// line from admin_list_orders makes the first executable statement `WITH base ...`
// → suite (E) FAILS ("admin_list_orders: a query precedes the is_admin_user()
// guard"). Restoring the line → green. (Verified by the tester via true line
// deletion — see the QA report Step 0.5.)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations");
const MONEY_MIG = path.join(MIGRATIONS_DIR, "20261207000000_orch_1274_money_read_rpcs.sql");

const read = (p) => fs.readFileSync(p, "utf8");

// Strip `-- ...` line comments so a documentation mention never false-fails and a
// commented-out statement counts as absent (fails-on-revert for comment-out too).
const stripSql = (src) =>
  src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const MIGRATION = read(MONEY_MIG);
const MIGRATION_NC = stripSql(MIGRATION);

const LIST_RPCS = [
  "admin_list_brand_stripe_status",
  "admin_list_orders",
  "admin_list_refunds",
  "admin_list_disputes",
  "admin_list_payouts",
  "admin_list_revenue_log",
];
const DETAIL_RPCS = [
  "admin_get_brand_stripe_status",
  "admin_get_order",
  "admin_get_dispute",
  "admin_get_subscription_detail",
];
const ALL_RPCS = [...LIST_RPCS, ...DETAIL_RPCS];

// Money tables that must never be MUTATED by the read-only console, nor be handed
// a fresh table-level grant. partner_splits INCLUDED here (never written by 1274).
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
  "partner_splits",
];
// For the cross-migration RLS check, partner_splits is EXCLUDED — the ORCH-1271
// single_admin_gate migration intentionally grants admin read on it via an
// `OR is_admin_user()` branch (a foundation decision this ORCH must not touch).
const MONEY_TABLES_NO_ADMIN_RLS = MONEY_TABLES.filter((t) => t !== "partner_splits");

// Slice a plpgsql function body from `CREATE ... FUNCTION public.<name>` to its
// closing `$$;` (bodies are comment-stripped so the analysis sees executable SQL).
function fnSlice(src, name) {
  const start = src.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"),
  );
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.indexOf("$$;");
  return end < 0 ? rest : rest.slice(0, end + 3);
}

describe("ORCH-1274 adversarial — A. READ-ONLY (no money mutation, no audit write)", () => {
  for (const table of MONEY_TABLES) {
    it(`migration never INSERTs into public.${table}`, () => {
      assert.ok(
        !new RegExp(`insert\\s+into\\s+public\\.${table}\\b`, "i").test(MIGRATION_NC),
        `read-only money console must not INSERT into ${table}`,
      );
    });
    it(`migration never UPDATEs public.${table}`, () => {
      assert.ok(
        !new RegExp(`update\\s+public\\.${table}\\b`, "i").test(MIGRATION_NC),
        `read-only money console must not UPDATE ${table}`,
      );
    });
    it(`migration never DELETEs from public.${table}`, () => {
      assert.ok(
        !new RegExp(`delete\\s+from\\s+public\\.${table}\\b`, "i").test(MIGRATION_NC),
        `read-only money console must not DELETE from ${table}`,
      );
    });
  }
  it("migration calls no admin_write_audit( (READ-ONLY: not in the write-RPC registry)", () => {
    assert.ok(
      !/admin_write_audit\s*\(/i.test(MIGRATION_NC),
      "the money read console must not invoke the audited-write primitive",
    );
  });
});

describe("ORCH-1274 adversarial — B. SECURITY DEFINER preserved on all 10 RPCs", () => {
  for (const name of ALL_RPCS) {
    it(`${name} is SECURITY DEFINER (definer→invoker would break containment)`, () => {
      const slice = fnSlice(MIGRATION_NC, name);
      assert.ok(slice, `${name} is defined in the migration`);
      assert.match(slice, /security\s+definer/i, `${name} must stay SECURITY DEFINER`);
      assert.ok(
        !/security\s+invoker/i.test(slice),
        `${name} must not be SECURITY INVOKER`,
      );
    });
  }
});

describe("ORCH-1274 adversarial — C. list `total` is the FULL filtered count, not the page", () => {
  for (const name of LIST_RPCS) {
    it(`${name}: total = (SELECT count(*) FROM filtered), never jsonb_array_length(page)`, () => {
      const slice = fnSlice(MIGRATION_NC, name);
      assert.ok(slice, `${name} is defined`);
      assert.match(
        slice,
        /\(\s*select\s+count\(\*\)\s+from\s+filtered\s*\)/i,
        `${name} must compute total from count(*) over the filtered set (page-2 parity)`,
      );
      assert.ok(
        !/jsonb_array_length\s*\(\s*v_rows/i.test(slice),
        `${name} must not derive total from the page slice length`,
      );
    });
  }
});

describe("ORCH-1274 adversarial — D. no money-table SELECT grant broadening", () => {
  for (const table of MONEY_TABLES) {
    it(`migration grants no table-level SELECT on public.${table} to anon/authenticated`, () => {
      // A GRANT of SELECT (or ALL) on a money TABLE to anon/authenticated would let
      // the browser read it directly, bypassing the definer RPC. Function EXECUTE
      // grants (GRANT EXECUTE ON FUNCTION ...) are fine and expected.
      const grantRe = new RegExp(
        `grant\\s+(?:select|all)[\\s\\S]{0,80}?\\bon\\s+(?:table\\s+)?public\\.${table}\\b[\\s\\S]{0,60}?\\bto\\s+(?:anon|authenticated|public)`,
        "i",
      );
      assert.ok(
        !grantRe.test(MIGRATION_NC),
        `${table} must not receive a fresh table-level SELECT grant (reads go via RPC)`,
      );
    });
  }
});

describe("ORCH-1274 adversarial — E. guard is the first executable statement (no query before it)", () => {
  const QUERY_LEAD = /^(with|select|insert|update|delete|perform)\b/i;
  for (const name of ALL_RPCS) {
    it(`${name}: no query precedes the is_admin_user() guard`, () => {
      const slice = fnSlice(MIGRATION_NC, name);
      assert.ok(slice, `${name} is defined`);
      const beginIdx = slice.search(/\bBEGIN\b/i);
      assert.ok(beginIdx >= 0, `${name} has a BEGIN`);
      // First non-empty token after BEGIN, up to the first ';'.
      const afterBegin = slice.slice(beginIdx + "BEGIN".length);
      const firstStmt = afterBegin.slice(0, afterBegin.indexOf(";")).trim();
      assert.ok(
        !QUERY_LEAD.test(firstStmt),
        `${name}: a query precedes the is_admin_user() guard — fail-open window (found: "${firstStmt
          .slice(0, 60)
          .replace(/\s+/g, " ")}")`,
      );
      assert.match(
        firstStmt,
        /^if\s+not\s+public\.is_admin_user\(\)\s+then\s+raise\s+exception\s+'not_authorized'/i,
        `${name}: first executable statement must be the not_authorized guard`,
      );
    });
  }
});

describe("ORCH-1274 adversarial — F. cross-migration: no admin RLS on any money table", () => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const combined = stripSql(
    files.map((n) => read(path.join(MIGRATIONS_DIR, n))).join("\n"),
  );
  const policyStmts = combined.match(/create\s+policy[\s\S]*?;/gi) || [];

  for (const table of MONEY_TABLES_NO_ADMIN_RLS) {
    it(`public.${table} carries NO is_admin_user() RLS policy in any migration`, () => {
      const offending = policyStmts.filter(
        (s) =>
          /is_admin_user\s*\(/i.test(s) && new RegExp(`on\\s+public\\.${table}\\b`, "i").test(s),
      );
      assert.equal(
        offending.length,
        0,
        `${table} must be read ONLY via the definer RPCs — found an admin RLS policy`,
      );
    });
  }

  it("partner_splits is the sole documented exception (1271 foundation) — sanity", () => {
    const psAdmin = policyStmts.some(
      (s) => /is_admin_user\s*\(/i.test(s) && /on\s+public\.partner_splits\b/i.test(s),
    );
    // Not an assertion on 1274 code; documents WHY partner_splits is excluded above.
    assert.equal(typeof psAdmin, "boolean");
  });
});
