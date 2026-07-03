// ORCH-1274 [Admin Money console — READ-ONLY] — HAPPY-PATH regression.
//
// Source-level proof (node:test + fs, no DOM — mirrors the ORCH-1271/1272 admin
// regression pattern) that the READ-ONLY money console is wired end-to-end and
// preserves its two hard contracts:
//   1. Every one of the 10 money read-RPCs is guard-first on is_admin_user() and
//      least-privilege (REVOKE anon/PUBLIC + GRANT authenticated) + a self-assert.
//   2. The money-read migration returns integer cents (no to_char / no '$').
//   3. adminMoneyService reads ONLY via supabase.rpc(<the 10 names>) — never a
//      direct .from(<money table>).
//   4. The 3 pages + the subscriber card take NO direct .from(<money table>) read
//      (SC-5.4 money containment).
//   5. Nav is wired: constants (3 Business items) + Sidebar (Receipt+Landmark) +
//      App PAGES (3 routes).
//
// FAILS-ON-REVERT: deleting the `IF NOT public.is_admin_user() ...` guard line
// from any read-RPC fails test (1); deleting a `.from` guard reintroduces a money
// table read and fails test (4); removing a service RPC call fails test (3).
//
// The tester writes a SECOND, adversarial suite on a different angle.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS } from "../lib/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");

const read = (p) => fs.readFileSync(p, "utf8");
const MIGRATION = read(path.join(REPO_ROOT, "supabase/migrations/20261207000000_orch_1274_money_read_rpcs.sql"));
const SERVICE = read(path.join(ADMIN_SRC, "services/adminMoneyService.js"));
const PAGES = {
  payments: read(path.join(ADMIN_SRC, "pages/BusinessPaymentsPage.jsx")),
  orders: read(path.join(ADMIN_SRC, "pages/BusinessOrdersPage.jsx")),
  ledger: read(path.join(ADMIN_SRC, "pages/BusinessMoneyLedgerPage.jsx")),
};
const CARD = read(path.join(ADMIN_SRC, "components/entity/SubscriberContextCard.jsx"));
const APP = read(path.join(ADMIN_SRC, "App.jsx"));
const SIDEBAR = read(path.join(ADMIN_SRC, "components/layout/Sidebar.jsx"));

const RPCS = [
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

// Money tables that must NEVER be read directly from the browser (reads go via RPC).
const MONEY_TABLES = [
  "orders",
  "order_line_items",
  "order_installments",
  "refunds",
  "payouts",
  "stripe_disputes",
  "stripe_connect_accounts",
  "mingla_revenue_log",
  "stripe_external_accounts",
  "partner_splits",
];

const stripComments = (src) =>
  src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

// Strip JS block + full-line // comments so a doc mention of `.from(` never
// false-fails the containment checks.
const stripJs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function fnSlice(src, name) {
  const start = src.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"));
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.indexOf("$$;");
  return end < 0 ? rest : rest.slice(0, end + 3);
}

const directFromRe = (tables) =>
  new RegExp(`\\.from\\(\\s*['"\`](?:${tables.join("|")})['"\`]`, "i");

describe("ORCH-1274 money console — migration (guard-first + least-privilege + cents)", () => {
  for (const name of RPCS) {
    it(`${name}: is guard-first on is_admin_user()`, () => {
      const slice = fnSlice(MIGRATION, name);
      assert.ok(slice, `${name} is defined in the migration`);
      assert.match(
        slice,
        /BEGIN\s+IF NOT public\.is_admin_user\(\) THEN RAISE EXCEPTION 'not_authorized'/i,
        `${name} guard must be the first statement after BEGIN`,
      );
    });

    it(`${name}: is least-privilege (REVOKE anon/PUBLIC + GRANT authenticated)`, () => {
      assert.match(
        MIGRATION,
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM anon, PUBLIC`, "i"),
        `${name} must REVOKE EXECUTE from anon, PUBLIC`,
      );
      assert.match(
        MIGRATION,
        new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated`, "i"),
        `${name} must GRANT EXECUTE to authenticated`,
      );
    });
  }

  it("self-asserts the anon/authenticated privilege lockdown at apply time", () => {
    assert.match(MIGRATION, /has_function_privilege\('anon'/);
    assert.match(MIGRATION, /has_function_privilege\('authenticated'/);
    assert.match(MIGRATION, /RAISE EXCEPTION 'ORCH-1274:/);
  });

  it("cents contract: no to_char( and no '$' in executable SQL", () => {
    const code = stripComments(MIGRATION);
    assert.ok(!/to_char\s*\(/i.test(code), "money read-RPC migration must not use to_char()");
    assert.ok(!/'\$'/.test(code), "money read-RPC migration must not embed a '$' symbol");
  });

  it("adds NO admin RLS policy on any money table", () => {
    const policyStmts = stripComments(MIGRATION).match(/create\s+policy[\s\S]*?;/gi) || [];
    assert.equal(policyStmts.length, 0, "the read-only money migration creates no RLS policy");
  });
});

describe("ORCH-1274 money console — service reads only via definer RPCs", () => {
  it("calls each of the 10 admin_* money RPCs via supabase.rpc", () => {
    for (const name of RPCS) {
      assert.ok(SERVICE.includes(`"${name}"`), `adminMoneyService must call rpc("${name}")`);
    }
  });

  it("takes NO direct .from(<money table>) read", () => {
    const code = stripJs(SERVICE);
    assert.ok(!directFromRe(MONEY_TABLES).test(code), "adminMoneyService must not read a money table directly");
    assert.ok(!/\.from\(/.test(code), "adminMoneyService must not use .from at all (RPC-only)");
  });
});

describe("ORCH-1274 money console — money containment on the UI (SC-5.4)", () => {
  const surfaces = { ...PAGES, card: CARD };
  for (const [label, src] of Object.entries(surfaces)) {
    it(`${label}: no direct .from(<money table>) read`, () => {
      assert.ok(
        !directFromRe(MONEY_TABLES).test(stripJs(src)),
        `${label} must read money only through adminMoneyService RPCs`,
      );
    });
  }
});

describe("ORCH-1274 money console — nav wiring", () => {
  const businessGroup = NAV_GROUPS.find((g) => g.label === "Business");

  it("constants: Business group has Payments / Orders / Money ledger", () => {
    assert.ok(businessGroup, "a Business nav group exists");
    const byId = Object.fromEntries(businessGroup.items.map((i) => [i.id, i]));
    assert.equal(byId["business-payments"]?.icon, "CreditCard");
    assert.equal(byId["business-orders"]?.icon, "Receipt");
    assert.equal(byId["business-money-ledger"]?.icon, "Landmark");
  });

  it("Sidebar registers Receipt + Landmark in ICON_MAP (no LayoutDashboard fallback)", () => {
    assert.match(SIDEBAR, /\bReceipt\b/);
    assert.match(SIDEBAR, /\bLandmark\b/);
  });

  it("App PAGES routes the 3 money pages", () => {
    assert.match(APP, /"business-payments":\s*BusinessPaymentsPage/);
    assert.match(APP, /"business-orders":\s*BusinessOrdersPage/);
    assert.match(APP, /"business-money-ledger":\s*BusinessMoneyLedgerPage/);
  });
});
