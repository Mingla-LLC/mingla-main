// Issue #3645 PR9 [Admin payout pause/resume + debt view] — regression pin.
//
// Source-level proof (node:test + fs, mirrors the ORCH-1274/1278 admin pattern)
// that the admin pause/resume + debt view is wired end-to-end and keeps its hard
// contracts:
//   1. Migration: brands pause columns + the paused⇔reason CHECK; both claim RPCs
//      exclude admin-paused brands; admin_set_brand_payouts_paused is guard-first,
//      audited (brand.payouts_pause / brand.payouts_resume), least-privilege
//      (REVOKE anon + GRANT authenticated), and never touches a readiness gate;
//      the two reads are guard-first + least-privilege + integer-cents (no to_char/'$').
//   2. Services: adminMoneyService exposes the two reads; identityWriteService's
//      setBrandPayoutsPaused routes through callAdminWriteRpc.
//   3. UI: the Money ledger gains a read-only Organiser-debts tab (no direct write);
//      BrandsConsole wires pause/resume + the payout console (no direct money write).
//
// FAILS-ON-REVERT: removing the pause exclusion, the CHECK, the audit call, or the
// UI wiring fails a case here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");
const read = (p) => fs.readFileSync(p, "utf8");

const MIG = read(path.join(REPO_ROOT, "supabase/migrations/20270728003645_issue_3645_admin_payout_pause_and_debt.sql"));
const MONEY_SVC = read(path.join(ADMIN_SRC, "services/adminMoneyService.js"));
const IDENTITY_SVC = read(path.join(ADMIN_SRC, "services/identityWriteService.js"));
const LEDGER = read(path.join(ADMIN_SRC, "pages/BusinessMoneyLedgerPage.jsx"));
const BRANDS = read(path.join(ADMIN_SRC, "pages/BrandsConsolePage.jsx"));

const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripSqlComments = (src) => src.replace(/--.*$/gm, "");
const DIRECT_WRITE_RE = /\.(update|insert|delete)\s*\(/;

// Slice a plpgsql fn body between its $tag$ pair ($$ or $fn$).
function fnBody(src, name) {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i").exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const tag = /\$([a-zA-Z_]*)\$/.exec(rest)?.[0];
  if (!tag) return null;
  const open = rest.indexOf(tag);
  const close = rest.indexOf(tag, open + tag.length);
  return close < 0 ? null : rest.slice(open + tag.length, close);
}

describe("#3645 PR9 — migration pause state + claim exclusion", () => {
  it("adds the two brands pause columns + a paused⇔reason CHECK", () => {
    assert.match(MIG, /ADD COLUMN IF NOT EXISTS payouts_admin_paused_at timestamptz/);
    assert.match(MIG, /ADD COLUMN IF NOT EXISTS payouts_admin_pause_reason text/);
    assert.match(MIG, /brands_payouts_admin_pause_reason_check/);
    const check = stripSqlComments(MIG);
    assert.match(check, /payouts_admin_paused_at IS NULL AND payouts_admin_pause_reason IS NULL/);
    assert.match(check, /payouts_admin_paused_at IS NOT NULL[\s\S]*?btrim\(payouts_admin_pause_reason\) <> ''/);
  });

  for (const name of ["claim_stripe_payout_releases", "claim_paystack_payout_releases"]) {
    it(`${name} excludes admin-paused brands (money accrues, never claimed)`, () => {
      const body = stripSqlComments(fnBody(MIG, name) || "");
      assert.ok(body, `${name} is replaced in this migration`);
      assert.match(body, /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.brands bp[\s\S]*?payouts_admin_paused_at IS NOT NULL/i);
      // keeps the PR8 bigint maturity-recredit clamp
      assert.match(body, /2147483647::bigint/);
    });
    it(`${name} stays service_role-only`, () => {
      assert.match(MIG, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s*\\n?\\s*TO service_role`, "i"));
    });
  }
});

describe("#3645 PR9 — admin_set_brand_payouts_paused (audited write)", () => {
  it("is_admin_user() guard is the first statement, then reason gate", () => {
    const body = stripSqlComments(fnBody(MIG, "admin_set_brand_payouts_paused") || "");
    assert.ok(body);
    assert.match(body, /BEGIN\s+IF NOT public\.is_admin_user\(\) THEN\s+RAISE EXCEPTION 'not_authorized'/i);
    assert.match(body, /reason_required/);
  });
  it("audits as brand.payouts_pause / brand.payouts_resume via admin_write_audit", () => {
    const body = fnBody(MIG, "admin_set_brand_payouts_paused");
    assert.match(body, /admin_write_audit\s*\(/);
    assert.match(body, /brand\.payouts_pause/);
    assert.match(body, /brand\.payouts_resume/);
  });
  it("marks admin_paused only on unmarked pending rows and clears only its own marker", () => {
    const body = fnBody(MIG, "admin_set_brand_payouts_paused");
    assert.match(body, /error_message = 'admin_paused'[\s\S]*?error_message IS NULL/);
    assert.match(body, /error_message = NULL[\s\S]*?error_message = 'admin_paused'/);
  });
  it("least-privilege (REVOKE anon + GRANT authenticated)", () => {
    assert.match(MIG, /REVOKE EXECUTE ON FUNCTION public\.admin_set_brand_payouts_paused\(uuid, boolean, text\)\s*\n?\s*FROM anon, PUBLIC/);
    assert.match(MIG, /GRANT EXECUTE ON FUNCTION public\.admin_set_brand_payouts_paused\(uuid, boolean, text\)\s*\n?\s*TO authenticated/);
  });
  it("does NOT redefine charge/publish/payout readiness predicates", () => {
    assert.ok(!/create\s+or\s+replace\s+function\s+public\.pg_brand_can_payout/i.test(MIG), "pause must not change pg_brand_can_payout");
    assert.ok(!/create\s+or\s+replace\s+function\s+public\.pg_brand_can_charge/i.test(MIG), "pause must not change pg_brand_can_charge");
  });
});

describe("#3645 PR9 — money reads are guard-first + least-privilege + cents", () => {
  for (const name of ["admin_list_organiser_payout_debts", "admin_get_brand_payout_console"]) {
    it(`${name}: is_admin_user() guard is the first statement`, () => {
      const body = fnBody(MIG, name);
      assert.ok(body, `${name} is defined`);
      assert.match(body, /BEGIN\s+IF NOT public\.is_admin_user\(\) THEN RAISE EXCEPTION 'not_authorized'/i);
    });
    it(`${name}: least-privilege (REVOKE anon + GRANT authenticated)`, () => {
      assert.match(MIG, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s*\\n?\\s*FROM anon, PUBLIC`, "i"));
      assert.match(MIG, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s*\\n?\\s*TO authenticated`, "i"));
    });
  }
  it("the debt list returns { rows, total }", () => {
    const body = fnBody(MIG, "admin_list_organiser_payout_debts");
    assert.match(body, /jsonb_build_object\('rows', v_rows, 'total', v_total\)/);
    assert.match(body, /outstanding_cents/);
  });
  it("returns integer cents (no to_char / no '\\$' formatting)", () => {
    const money = stripSqlComments(MIG);
    assert.ok(!/to_char\s*\(/i.test(money), "no to_char");
    assert.ok(!/'\$'/.test(money), "no embedded $ symbol");
  });
});

describe("#3645 PR9 — service wiring", () => {
  it("adminMoneyService exposes the two reads via their RPCs", () => {
    assert.match(MONEY_SVC, /export async function listOrganiserPayoutDebts/);
    assert.match(MONEY_SVC, /rpc\("admin_list_organiser_payout_debts"/);
    assert.match(MONEY_SVC, /export async function getBrandPayoutConsole/);
    assert.match(MONEY_SVC, /rpc\("admin_get_brand_payout_console"/);
  });
  it("identityWriteService.setBrandPayoutsPaused routes through callAdminWriteRpc", () => {
    assert.match(IDENTITY_SVC, /export function setBrandPayoutsPaused/);
    assert.match(IDENTITY_SVC, /callAdminWriteRpc\("admin_set_brand_payouts_paused"/);
  });
});

describe("#3645 PR9 — UI wiring (read-only ledger tab + brands pause/resume)", () => {
  it("Money ledger adds a read-only Organiser-debts tab and no direct write", () => {
    assert.match(LEDGER, /id: "debts"/);
    assert.match(LEDGER, /listOrganiserPayoutDebts/);
    assert.match(LEDGER, /Organiser debts/);
    assert.ok(!DIRECT_WRITE_RE.test(stripJs(LEDGER)), "ledger must not write money tables directly");
  });
  it("BrandsConsole wires pause/resume + the payout console, no direct money write", () => {
    assert.match(BRANDS, /setBrandPayoutsPaused/);
    assert.match(BRANDS, /getBrandPayoutConsole/);
    assert.match(BRANDS, /Pause payouts/);
    assert.match(BRANDS, /Resume payouts/);
    assert.ok(!DIRECT_WRITE_RE.test(stripJs(BRANDS)), "BrandsConsole must route writes through the audited service");
  });
});
