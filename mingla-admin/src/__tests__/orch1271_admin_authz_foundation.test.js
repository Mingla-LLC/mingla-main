// ORCH-1271 [Admin authorization & audit FOUNDATION] — HAPPY-PATH regression.
//
// Source-level proof (node:test + fs, no DOM — mirrors the meta_orch_1104 /
// orch1008 admin regression pattern) that the foundation is wired end-to-end:
//   1. Single-gate migration flips BOTH partner-money SELECT policies to
//      is_admin_user(), preserves the self-access branches, drops account_type,
//      and self-asserts.
//   2. Audit-log extend adds actor_uid + reason (nullable) + idx_audit_log_target.
//   3. The audited-write primitive (admin_write_audit + admin_audit_probe) guards
//      FIRST on is_admin_user(), enforces reason, and writes admin_audit_log.
//   4. The admin-write-primitive edge fn is admin-gated (getUser → admin_users
//      active → 403), audits via admin_write_audit, surfaces blank reason as 400,
//      and is registered verify_jwt=true.
//   5. UI scaffolding renders: "Business" nav group + Building2 icon + #/business-
//      console route; HighRiskActionModal disables confirm until a reason is typed;
//      BusinessConsolePage round-trips runAuditProbe and holds scope (no domain
//      tables).
//   6. The 3 strict-grep gates + workflow job exist.
//
// The tester writes a SECOND, adversarial suite on a different angle.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel) => fs.readFileSync(path.join(ADMIN_SRC, rel), "utf8");

const MIG_GATE = "supabase/migrations/20261204000000_orch_1271_single_admin_gate.sql";
const MIG_EXTEND = "supabase/migrations/20261204000001_orch_1271_audit_log_extend.sql";
const MIG_PRIMITIVE = "supabase/migrations/20261204000002_orch_1271_admin_write_primitive.sql";
const EDGE = "supabase/functions/admin-write-primitive/index.ts";

describe("ORCH-1271 — single-gate migration", () => {
  const sql = read(MIG_GATE);
  it("flips partner_stripe_self_select to is_admin_user() + preserves self branch", () => {
    const stmt = /create\s+policy\s+partner_stripe_self_select[\s\S]*?;/i.exec(sql)[0];
    assert.match(stmt, /account_id = auth\.uid\(\)/);
    assert.match(stmt, /public\.is_admin_user\(\)/);
    assert.doesNotMatch(stmt, /account_type/i);
  });
  it("flips partner_splits_partner_self_select + preserves BOTH self + brand-team branches", () => {
    const stmt = /create\s+policy\s+partner_splits_partner_self_select[\s\S]*?;/i.exec(sql)[0];
    assert.match(stmt, /partner_account_id = auth\.uid\(\)/);
    assert.match(stmt, /brand_team_members btm/); // brand-team branch preserved verbatim
    assert.match(stmt, /public\.is_admin_user\(\)/);
    assert.doesNotMatch(stmt, /account_type/i);
  });
  it("ends with a self-assert that fails apply on a re-introduced split gate", () => {
    assert.match(sql, /I-ADMIN-SINGLE-GATE violated/);
    assert.match(sql, /pg_policies/);
  });
});

describe("ORCH-1271 — audit-log extend migration", () => {
  const sql = read(MIG_EXTEND);
  it("adds actor_uid + reason as nullable columns", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS actor_uid uuid/i);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS reason\s+text/i);
    assert.doesNotMatch(sql, /actor_uid uuid NOT NULL/i);
    assert.doesNotMatch(sql, /reason\s+text NOT NULL/i);
  });
  it("creates idx_audit_log_target(target_type, target_id)", () => {
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_audit_log_target\s+ON public\.admin_audit_log \(target_type, target_id\)/i);
  });
});

describe("ORCH-1271 — audited-write primitive migration", () => {
  const sql = read(MIG_PRIMITIVE);
  const body = (name) => {
    const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i").exec(sql);
    const rest = sql.slice(m.index);
    const open = rest.indexOf("$$");
    return rest.slice(open + 2, rest.indexOf("$$", open + 2));
  };
  it("admin_write_audit is SECURITY DEFINER, guards FIRST, gates reason, inserts audit", () => {
    const b = body("admin_write_audit");
    assert.match(sql, /admin_write_audit[\s\S]*?SECURITY DEFINER/i);
    // guard is the first statement (before the reason gate + any insert)
    const guardIdx = b.search(/IF auth\.uid\(\) IS NOT NULL AND NOT public\.is_admin_user\(\) THEN/i);
    const insertIdx = b.search(/INSERT INTO public\.admin_audit_log/i);
    assert.ok(guardIdx >= 0, "guard present");
    assert.ok(insertIdx > guardIdx, "insert comes after the guard");
    assert.match(b, /reason_required/);
    assert.match(b, /actor_unresolved/);
  });
  it("admin_audit_probe guards FIRST then calls admin_write_audit (no business mutation)", () => {
    const b = body("admin_audit_probe");
    const guardIdx = b.search(/IF NOT public\.is_admin_user\(\) THEN/i);
    const callIdx = b.search(/admin_write_audit\s*\(/i);
    assert.ok(guardIdx >= 0 && callIdx > guardIdx, "guard precedes the audit call");
    assert.match(b, /admin\.audit_probe/);
    // scope: the probe mutates NO business table.
    assert.doesNotMatch(b, /UPDATE\s+public\.|DELETE\s+FROM\s+public\.(?!admin_audit_log)/i);
  });
});

describe("ORCH-1271 — admin-write-primitive edge fn", () => {
  const ts = read(EDGE);
  it("is admin-gated: getUser → admin_users status active → 403", () => {
    assert.match(ts, /auth\.getUser\(token\)/);
    assert.match(ts, /from\("admin_users"\)[\s\S]*?\.eq\("status", "active"\)/);
    assert.match(ts, /forbidden.*403|403/);
  });
  it("audits via admin_write_audit passing explicit actor_* (service-role)", () => {
    assert.match(ts, /rpc\("admin_write_audit"/);
    assert.match(ts, /p_actor_email: user\.email/);
    assert.match(ts, /p_actor_uid: user\.id/);
  });
  it("surfaces a blank/whitespace reason as HTTP 400", () => {
    assert.match(ts, /reason_required.*400|400/);
    assert.match(ts, /\.trim\(\)/);
  });
  it("is registered verify_jwt=true in config.toml", () => {
    const toml = read("supabase/config.toml");
    assert.match(toml, /\[functions\.admin-write-primitive\]\s*\nverify_jwt = true/);
  });
});

describe("ORCH-1271 — admin UI scaffolding", () => {
  it("NAV_GROUPS has a 'Business' group with the business-console item", () => {
    const biz = NAV_GROUPS.find((g) => g.label === "Business");
    assert.ok(biz, "Business group present");
    assert.ok(biz.items.some((i) => i.id === "business-console" && i.icon === "Building2"));
    // NAV_ITEMS (flattened) exposes the new item too.
    assert.ok(NAV_ITEMS.some((i) => i.id === "business-console"));
  });
  it("Sidebar registers Building2 in ICON_MAP (else silent LayoutDashboard fallback)", () => {
    const sb = readSrc("components/layout/Sidebar.jsx");
    assert.match(sb, /import \{[\s\S]*?\bBuilding2\b[\s\S]*?\} from "lucide-react"/);
    assert.match(sb, /const ICON_MAP = \{[\s\S]*?\bBuilding2\b[\s\S]*?\};/);
  });
  it("App.jsx routes #/business-console → BusinessConsolePage", () => {
    const app = readSrc("App.jsx");
    assert.match(app, /import \{ BusinessConsolePage \} from "\.\/pages\/BusinessConsolePage"/);
    assert.match(app, /"business-console": BusinessConsolePage/);
  });
  it("HighRiskActionModal disables confirm until a non-empty reason (+ never fires onConfirm empty)", () => {
    const m = readSrc("components/entity/HighRiskActionModal.jsx");
    assert.match(m, /reason\.trim\(\)\.length > 0/);
    assert.match(m, /canConfirm/);
    assert.match(m, /disabled=\{!canConfirm\}/);
    // hard guard inside handleConfirm
    assert.match(m, /if \(requireReason && reason\.trim\(\)\.length === 0\) return;/);
  });
  it("BusinessConsolePage round-trips runAuditProbe and holds scope (no domain tables)", () => {
    const p = readSrc("pages/BusinessConsolePage.jsx");
    assert.match(p, /runAuditProbe/);
    for (const forbidden of ["creator_accounts", "events", "orders", "stripe_connect_accounts"]) {
      assert.doesNotMatch(p, new RegExp(forbidden), `scope held: no ${forbidden}`);
    }
  });
  it("adminWriteService.runAuditProbe calls the admin_audit_probe RPC", () => {
    const s = readSrc("services/adminWriteService.js");
    assert.match(s, /rpc\("admin_audit_probe", \{ p_reason: reason, p_note: note \}\)/);
  });
});

describe("ORCH-1271 — strict-grep gates + workflow", () => {
  for (const g of ["i-admin-single-gate", "i-admin-write-audited", "i-admin-gate-first-statement"]) {
    it(`${g}.mjs exists and supports --self-test`, () => {
      const src = read(`.github/scripts/strict-grep/${g}.mjs`);
      assert.match(src, /--self-test/);
    });
  }
  it("workflow registers the orch-1271-admin-authz-foundation job", () => {
    const wf = read(".github/workflows/strict-grep-mingla-business.yml");
    assert.match(wf, /orch-1271-admin-authz-foundation:/);
    assert.match(wf, /i-admin-single-gate\.mjs/);
    assert.match(wf, /i-admin-write-audited\.mjs/);
    assert.match(wf, /i-admin-gate-first-statement\.mjs/);
  });
});

// ── P0 HARDENING (appended at ORCH-1271 P0 rework — additive) ─────────────────
// Source-level fails-on-revert coverage for 20261204000003_orch_1271_p0_hardening.sql
// (actor-forgery + fail-open + reason-bypass) + the edge-fn reason normalization.
describe("ORCH-1271 P0 — audited-write hardening", () => {
  const HARDEN = "supabase/migrations/20261204000003_orch_1271_p0_hardening.sql";
  const sql = read(HARDEN);
  const edge = read("supabase/functions/admin-write-primitive/index.ts");

  it("REVOKEs admin_write_audit EXECUTE from anon/authenticated/PUBLIC + GRANTs service_role only", () => {
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.admin_write_audit\([^)]*\)\s*\n?\s*FROM anon, authenticated, PUBLIC/i);
    assert.match(sql, /GRANT\s+EXECUTE ON FUNCTION public\.admin_write_audit\([^)]*\)\s*\n?\s*TO service_role/i);
  });

  it("locks admin_audit_probe to authenticated (revokes anon/PUBLIC)", () => {
    assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.admin_audit_probe\(text,text\) FROM anon, PUBLIC/i);
    assert.match(sql, /GRANT\s+EXECUTE ON FUNCTION public\.admin_audit_probe\(text,text\) TO authenticated/i);
  });

  it("binds the actor SERVER-SIDE (auth.uid()), never COALESCE(p_actor_*) forgery", () => {
    // The rebound helper resolves the actor from auth.uid() for JWT callers…
    assert.match(sql, /IF auth\.uid\(\) IS NOT NULL THEN\s*\n\s*v_uid\s*:=\s*auth\.uid\(\)/i);
    // …and MUST NOT use the forgeable COALESCE(p_actor_uid, auth.uid()) pattern.
    assert.doesNotMatch(sql, /v_uid\s*:=\s*COALESCE\(p_actor_uid/i);
  });

  it("normalizes invisible-whitespace reason before the emptiness gate (translate delete)", () => {
    assert.match(sql, /translate\(\s*\n?\s*COALESCE\(p_reason, ''\)/i);
    assert.match(sql, /chr\(160\)/); // NBSP among the deleted invisibles
    assert.match(sql, /chr\(8203\)/); // ZWSP
    assert.match(sql, /RAISE EXCEPTION 'reason_required'/);
  });

  it("carries a has_function_privilege self-assert that fails apply if lockdown missing", () => {
    assert.match(sql, /has_function_privilege\('anon',\s*'public\.admin_write_audit/i);
    assert.match(sql, /admin_write_audit still EXECUTE-able by anon\/authenticated/i);
  });

  it("edge fn normalizes invisible-whitespace reason + binds actor to the verified caller", () => {
    assert.match(edge, /INVISIBLE_WS\s*=\s*\/\[/);
    assert.match(edge, /rawReason\.replace\(INVISIBLE_WS, ""\) === ""/);
    assert.match(edge, /p_actor_email: user\.email/);
    assert.match(edge, /p_actor_uid: user\.id/);
    assert.doesNotMatch(edge, /body\.(actor|actor_email|actor_uid|admin_email)/i);
  });
});
