// ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — TESTER ADVERSARIAL regression.
//
// DIFFERENT ANGLE than the implementor's happy-path suite
// (orch1276_identity_console_edit.test.js). The implementor proves contract
// MARKERS exist via substring checks (guard present, "kind" absent from a SET
// blob, REVOKE present). This suite attacks the SEMANTICS + a runtime invariant
// that source-marker checks cannot see:
//
//   G1 — WHITELIST-BYPASS (semantic parse): the actual assignment TARGETS of the
//        UPDATE ... SET clause in admin_update_brand / admin_update_account are a
//        STRICT SUBSET of the allowed whitelist. A forbidden lifecycle/privilege
//        column (kind, account_id, claim_status, deleted_at, take_rate, stripe_*,
//        partner_enabled, default_brand_id, slug, id) can NEVER be an assignment
//        LHS. Parsing LHS columns (not substring) catches a forbidden column
//        smuggled in as a real assignment even if its name also appears in a
//        harmless CASE/comment. FAILS-ON-REVERT: add `deleted_at = ...` to the
//        SET clause and G1 fails.
//
//   G2 — LEAST-PRIVILEGE, negative form: none of the 11 RPCs carries a
//        `GRANT EXECUTE ... TO anon` or `... TO PUBLIC` (the implementor asserts
//        the REVOKE exists; this asserts no accidental re-GRANT slips in beside
//        it). Live-fire confirmed all 11 have anon EXECUTE = false in prod.
//
//   G3 — P1 REGRESSION GUARD (runtime invariant proven by live-fire on prod
//        gqnoajqerqhnvulmnyvv 2026-07-03): admin_reassign_brand_owner mutates
//        brands.account_id, which is protected by the BEFORE-UPDATE trigger
//        biz_prevent_brand_account_id_change() — it RAISES 'brands.account_id is
//        immutable' unless the caller first arms the bypass GUC
//        `set_config('app.allow_brand_owner_transfer','on',true)` (the pattern
//        established by ORCH-1081 / ORCH-1111 transfer RPCs). The shipped A2 RPC
//        OMITS that line, so reassign-owner fails 100% of the time in prod. This
//        guard asserts the arming call is present in the function body BEFORE the
//        account_id UPDATE. It is EXPECTED-RED until the P1 is fixed; it turns
//        green when the implementor adds the arming call (the CI-enforced
//        regression guard for the fix).
//
// Append-only (new file). node:test + fs, no DOM. Mirrors the admin regression
// pattern. Runs green EXCEPT G3 until the P1 REWORK lands.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const MIG_BRAND = read("supabase/migrations/20261208000001_orch_1276_brand_admin_write_rpcs.sql");
const MIG_ACCOUNT = read("supabase/migrations/20261208000002_orch_1276_account_admin_write_rpcs.sql");
const MIG_TEAM = read("supabase/migrations/20261208000003_orch_1276_team_invite_admin_write_rpcs.sql");
const MIG_USER = read("supabase/migrations/20261208000004_orch_1276_user_admin_write_rpcs.sql");
const ALL_MIG = [MIG_BRAND, MIG_ACCOUNT, MIG_TEAM, MIG_USER].join("\n");

const RPCS = [
  "admin_update_brand",
  "admin_reassign_brand_owner",
  "admin_set_brand_claim_status",
  "admin_set_brand_deleted",
  "admin_update_account",
  "admin_set_account_deleted",
  "admin_set_team_member_role",
  "admin_remove_team_member",
  "admin_revoke_brand_invitation",
  "admin_set_user_active",
  "admin_set_user_beta",
];

/** Slice a plpgsql function body (first `$$` pair after its CREATE). */
function fnBody(src, name) {
  const m = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\b`, "i").exec(src);
  assert.ok(m, `${name} must be defined`);
  const rest = src.slice(m.index);
  const open = rest.indexOf("$$");
  const close = rest.indexOf("$$", open + 2);
  return rest.slice(open + 2, close);
}

/**
 * Extract the assignment-target column names from an `UPDATE public.<table> SET
 * ... WHERE` clause: the LHS of each `col = ...` at (indented) line start.
 */
function setTargets(body, table) {
  const re = new RegExp(`UPDATE\\s+public\\.${table}[\\s\\S]*?\\sSET\\s([\\s\\S]*?)\\sWHERE\\b`, "i");
  const m = re.exec(body);
  assert.ok(m, `${table} UPDATE...SET...WHERE must be present`);
  const clause = m[1];
  const targets = [];
  for (const line of clause.split("\n")) {
    const lm = /^\s*([a-z_][a-z0-9_]*)\s*=/i.exec(line);
    if (lm) targets.push(lm[1].toLowerCase());
  }
  return targets;
}

describe("ORCH-1276 ADVERSARIAL G1 — whitelist SET-clause is a strict subset (semantic parse)", () => {
  it("admin_update_brand: assignment targets ⊆ whitelist; NO privilege/lifecycle column", () => {
    const allowed = new Set([
      "name", "description", "contact_email", "contact_phone", "pricing_currency",
      "default_currency", "venue_category", "theme_color", "theme_font",
      "theme_animation", "social_links", "custom_links", "updated_at",
    ]);
    const forbidden = new Set([
      "kind", "account_id", "claim_status", "deleted_at", "take_rate_bps_override",
      "stripe_account_id", "partner_enabled", "slug", "id",
    ]);
    const targets = setTargets(fnBody(MIG_BRAND, "admin_update_brand"), "brands");
    assert.ok(targets.length > 0, "must parse at least one assignment");
    for (const t of targets) {
      assert.ok(!forbidden.has(t), `admin_update_brand assigns FORBIDDEN column "${t}"`);
      assert.ok(allowed.has(t), `admin_update_brand assigns non-whitelisted column "${t}"`);
    }
  });

  it("admin_update_account: assignment targets ⊆ whitelist; NO deleted_at/partner_enabled/default_brand_id", () => {
    const allowed = new Set([
      "business_name", "phone_e164", "display_name", "email", "marketing_opt_in", "updated_at",
    ]);
    const forbidden = new Set(["deleted_at", "partner_enabled", "default_brand_id", "id"]);
    const targets = setTargets(fnBody(MIG_ACCOUNT, "admin_update_account"), "creator_accounts");
    assert.ok(targets.length > 0, "must parse at least one assignment");
    for (const t of targets) {
      assert.ok(!forbidden.has(t), `admin_update_account assigns FORBIDDEN column "${t}"`);
      assert.ok(allowed.has(t), `admin_update_account assigns non-whitelisted column "${t}"`);
    }
  });
});

describe("ORCH-1276 ADVERSARIAL G2 — least-privilege: no accidental anon/PUBLIC re-GRANT", () => {
  for (const name of RPCS) {
    it(`${name}: has REVOKE FROM anon and NO GRANT ... TO anon/PUBLIC`, () => {
      assert.match(
        ALL_MIG,
        new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\banon\\b`, "i"),
        `${name} must REVOKE EXECUTE FROM anon`,
      );
      const grantAnon = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+to\\s+[^;]*\\b(anon|public)\\b`, "i");
      assert.ok(!grantAnon.test(ALL_MIG), `${name} must NOT GRANT EXECUTE to anon/PUBLIC`);
    });
  }
});

describe("ORCH-1276 ADVERSARIAL G3 — reassign-owner must arm the account_id immutability bypass (P1)", () => {
  // Proven via live-fire on prod: admin_reassign_brand_owner raises
  // 'brands.account_id is immutable' (trigger biz_prevent_brand_account_id_change)
  // because it never sets app.allow_brand_owner_transfer='on'. EXPECTED-RED until
  // the P1 REWORK adds the arming call; then this locks the fix in.
  it("admin_reassign_brand_owner arms app.allow_brand_owner_transfer before mutating account_id", () => {
    const body = fnBody(MIG_BRAND, "admin_reassign_brand_owner");
    const armIdx = body.search(/set_config\s*\(\s*'app\.allow_brand_owner_transfer'\s*,\s*'on'/i);
    const updIdx = body.search(/UPDATE\s+public\.brands\s+SET\s+account_id/i);
    assert.ok(
      armIdx >= 0,
      "admin_reassign_brand_owner MUST call set_config('app.allow_brand_owner_transfer','on',true) — " +
        "without it the BEFORE-UPDATE trigger raises 'brands.account_id is immutable' and reassign fails (P1).",
    );
    assert.ok(updIdx >= 0, "admin_reassign_brand_owner must UPDATE brands SET account_id");
    assert.ok(armIdx < updIdx, "the bypass must be armed BEFORE the account_id UPDATE");
  });
});
