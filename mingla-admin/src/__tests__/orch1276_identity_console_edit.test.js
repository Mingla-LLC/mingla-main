// ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — HAPPY-PATH regression.
//
// Source-level proof (node:test + fs, no DOM — mirrors the ORCH-1271/1272/1274
// admin regression pattern) that the 11 audited identity write actions are wired
// end-to-end and preserve their hard contracts:
//   1. Each of the 11 write-RPCs is guard-first on is_admin_user(), audits via
//      admin_write_audit(before/after), is least-privilege (REVOKE anon/PUBLIC +
//      GRANT authenticated) + a DO $$ self-assert.
//   2. Whitelist: admin_update_brand never writes kind/account_id/claim_status/
//      deleted_at; admin_update_account never writes deleted_at/partner_enabled.
//   3. Team/invite RPCs set NO updated_at (those tables have none); C1/C2 carry the
//      orphan-owner guard; C2 branches on the accepted/removed exclusion CHECK.
//   4. identityWriteService maps each service fn → the correct RPC name via
//      callAdminWriteRpc, and takes NO direct .from/.update/.insert/.delete.
//   5. Both console pages route mutations through identityWriteService, render the
//      edit modals, refetch on success, and take NO direct .update/.insert/.delete.
//   6. EntityEditModal is GENERIC (no identity/domain terms) and carries the
//      reason + confirm-phrase + JSON gate.
//
// FAILS-ON-REVERT: deleting a guard line fails test (1); removing a service RPC
// call fails test (4); introducing a direct browser write fails test (5).
//
// The tester writes a SECOND, adversarial suite on a different angle.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");

const read = (p) => fs.readFileSync(p, "utf8");
const MIG = {
  brand: read(path.join(REPO_ROOT, "supabase/migrations/20261208000001_orch_1276_brand_admin_write_rpcs.sql")),
  account: read(path.join(REPO_ROOT, "supabase/migrations/20261208000002_orch_1276_account_admin_write_rpcs.sql")),
  team: read(path.join(REPO_ROOT, "supabase/migrations/20261208000003_orch_1276_team_invite_admin_write_rpcs.sql")),
  user: read(path.join(REPO_ROOT, "supabase/migrations/20261208000004_orch_1276_user_admin_write_rpcs.sql")),
};
const ALL_MIG = Object.values(MIG).join("\n");
const SERVICE = read(path.join(ADMIN_SRC, "services/identityWriteService.js"));
const EEM = read(path.join(ADMIN_SRC, "components/entity/EntityEditModal.jsx"));
const BRANDS = read(path.join(ADMIN_SRC, "pages/BrandsConsolePage.jsx"));
const PEOPLE = read(path.join(ADMIN_SRC, "pages/PeopleConsolePage.jsx"));

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

const IDENTITY_TABLES = ["brands", "creator_accounts", "brand_team_members", "brand_invitations", "profiles"];

const stripSql = (src) =>
  src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DIRECT_WRITE_RE = /\.(update|insert|delete)\s*\(/;

function fnSlice(src, name) {
  const start = src.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"));
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.indexOf("$$;");
  return end < 0 ? rest : rest.slice(0, end + 3);
}

describe("ORCH-1276 — the 11 write-RPCs are guard-first + audited + least-privilege", () => {
  for (const name of RPCS) {
    it(`${name}: guard is the first statement`, () => {
      const slice = fnSlice(ALL_MIG, name);
      assert.ok(slice, `${name} is defined in a migration`);
      assert.match(
        slice,
        /BEGIN\s+IF NOT public\.is_admin_user\(\) THEN RAISE EXCEPTION 'not_authorized'/i,
        `${name} guard must be the first statement after BEGIN`,
      );
    });

    it(`${name}: audits via admin_write_audit(before/after)`, () => {
      const slice = fnSlice(ALL_MIG, name);
      assert.match(slice, /admin_write_audit\s*\(/i, `${name} must call admin_write_audit`);
      assert.match(slice, /'before'/i, `${name} audit metadata must include before`);
      assert.match(slice, /'after'/i, `${name} audit metadata must include after`);
    });

    it(`${name}: least-privilege (REVOKE anon/PUBLIC + GRANT authenticated + self-assert)`, () => {
      assert.match(
        ALL_MIG,
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM anon, PUBLIC`, "i"),
      );
      assert.match(
        ALL_MIG,
        new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated`, "i"),
      );
      assert.match(ALL_MIG, new RegExp(`has_function_privilege\\('anon',\\s*'public\\.${name}\\(`, "i"));
    });
  }
});

describe("ORCH-1276 — whitelist + schema-correct mutations", () => {
  it("admin_update_brand never writes kind/account_id/claim_status/deleted_at", () => {
    const code = stripSql(fnSlice(MIG.brand, "admin_update_brand"));
    for (const forbidden of ["kind", "account_id", "claim_status", "deleted_at"]) {
      assert.ok(!code.includes(forbidden), `admin_update_brand must not touch ${forbidden}`);
    }
    // the whitelist DOES carry the safe columns.
    assert.match(code, /name\s*=/);
    assert.match(code, /pricing_currency\s*=/);
    assert.match(code, /venue_category\s*=/);
  });

  it("admin_update_account never writes deleted_at/partner_enabled", () => {
    const code = stripSql(fnSlice(MIG.account, "admin_update_account"));
    assert.ok(!code.includes("deleted_at"), "admin_update_account must not touch deleted_at");
    assert.ok(!code.includes("partner_enabled"), "admin_update_account must not touch partner_enabled");
    assert.match(code, /business_name\s*=/);
    assert.match(code, /marketing_opt_in\s*=/);
  });

  it("team/invite RPCs set NO updated_at (those tables have none)", () => {
    for (const name of ["admin_set_team_member_role", "admin_remove_team_member", "admin_revoke_brand_invitation"]) {
      const code = stripSql(fnSlice(MIG.team, name));
      assert.ok(!code.includes("updated_at"), `${name} must not set updated_at`);
    }
  });

  it("C1/C2 carry the orphan-owner guard; C2 branches on the exclusion CHECK", () => {
    assert.match(fnSlice(MIG.team, "admin_set_team_member_role"), /cannot_demote_account_owner/);
    const c2 = fnSlice(MIG.team, "admin_remove_team_member");
    assert.match(c2, /cannot_remove_account_owner/);
    assert.match(c2, /removed_at = now\(\)/);
    assert.match(c2, /DELETE FROM public\.brand_team_members/i);
  });

  it("C3 revokes only pending invites (not_pending guard)", () => {
    assert.match(fnSlice(MIG.team, "admin_revoke_brand_invitation"), /not_pending/);
  });
});

describe("ORCH-1276 — identityWriteService routes every write through the audited RPC", () => {
  it("maps each service fn to its RPC name via callAdminWriteRpc", () => {
    for (const name of RPCS) {
      assert.ok(SERVICE.includes(`"${name}"`), `identityWriteService must call callAdminWriteRpc("${name}")`);
    }
    assert.match(SERVICE, /from "\.\/adminWriteService"/);
  });

  it("mapWriteError translates the audited RPC error codes", () => {
    for (const code of ["not_authorized", "reason_required", "not_found", "invalid_new_owner", "not_pending", "cannot_demote_account_owner"]) {
      assert.ok(SERVICE.includes(code), `mapWriteError must handle ${code}`);
    }
  });

  it("takes NO direct .from/.update/.insert/.delete", () => {
    const code = stripJs(SERVICE);
    assert.ok(!/\.from\(/.test(code), "identityWriteService must not use .from (RPC-only)");
    assert.ok(!DIRECT_WRITE_RE.test(code), "identityWriteService must not use .update/.insert/.delete");
  });
});

describe("ORCH-1276 — console pages route through the service, no direct writes", () => {
  const pages = { brands: BRANDS, people: PEOPLE };
  for (const [label, src] of Object.entries(pages)) {
    it(`${label}: no direct .update/.insert/.delete`, () => {
      assert.ok(!DIRECT_WRITE_RE.test(stripJs(src)), `${label} must route mutations through identityWriteService`);
    });
    it(`${label}: no supabase.from(<identity table>) write chain`, () => {
      const code = stripJs(src);
      assert.ok(
        !new RegExp(`\\.from\\(\\s*['"\`](?:${IDENTITY_TABLES.join("|")})['"\`]`, "i").test(code),
        `${label} must not read/write an identity table directly`,
      );
    });
    it(`${label}: never renders the brand kind column (META-ORCH-0972)`, () => {
      assert.ok(!stripJs(src).includes("kind"), `${label} must not reference the brand kind column`);
    });
  }

  it("BrandsConsolePage imports the write service + both modals and refetches on success", () => {
    assert.match(BRANDS, /from "\.\.\/services\/identityWriteService"/);
    assert.match(BRANDS, /EntityEditModal/);
    assert.match(BRANDS, /HighRiskActionModal/);
    assert.match(BRANDS, /loadBrand\(selectedBrandId\)/);
  });

  it("PeopleConsolePage imports the write service + edit modal and refetches on success", () => {
    assert.match(PEOPLE, /from "\.\.\/services\/identityWriteService"/);
    assert.match(PEOPLE, /EntityEditModal/);
    assert.match(PEOPLE, /loadPerson\(selectedUserId\)/);
  });
});

describe("ORCH-1276 — EntityEditModal is generic + gated", () => {
  it("is domain-agnostic (no identity/table/RPC terms baked in)", () => {
    for (const term of ["identityWriteService", "callAdminWriteRpc", "admin_", "creator_accounts", "brand_team_members"]) {
      assert.ok(!EEM.includes(term), `EntityEditModal must stay generic — no ${term}`);
    }
  });

  it("carries the required-field + reason + confirm-phrase + JSON submit gate", () => {
    assert.match(EEM, /const canSubmit = requiredOk && jsonOk && reasonOk && phraseOk && !submitting/);
    assert.match(EEM, /JSON\.parse/);
    assert.match(EEM, /phrase === confirmPhrase/);
    assert.match(EEM, /role="switch"/);
  });

  it("supports a readonly (display-only, never-submitted) field type", () => {
    assert.match(EEM, /f\.type === "readonly"/);
    // readonly fields are skipped in the submitted payload.
    assert.match(EEM, /if \(f\.type === "readonly"\) \{\s*\n\s*continue;/);
  });
});

// ── ORCH-1276 REWORK: P1 (reassign owner immutability bypass) + P2 (currency form) ──
describe("ORCH-1276 REWORK — P1 reassign-owner arms the account_id immutability bypass", () => {
  it("admin_reassign_brand_owner (mig 000001) arms app.allow_brand_owner_transfer before the account_id UPDATE", () => {
    const body = fnSlice(MIG.brand, "admin_reassign_brand_owner");
    const armIdx = body.search(/set_config\s*\(\s*'app\.allow_brand_owner_transfer'\s*,\s*'on'\s*,\s*true\s*\)/i);
    const updIdx = body.search(/UPDATE\s+public\.brands\s+SET\s+account_id/i);
    assert.ok(armIdx >= 0, "must arm the transfer bypass GUC (else the trigger raises 'brands.account_id is immutable')");
    assert.ok(updIdx >= 0, "must UPDATE brands SET account_id");
    assert.ok(armIdx < updIdx, "the bypass must be armed BEFORE the account_id UPDATE");
  });

  it("the 000005 redeploy migration also carries the fixed CREATE OR REPLACE + REVOKE anon", () => {
    const fix = read(path.join(REPO_ROOT, "supabase/migrations/20261208000005_orch_1276_fix_reassign_owner.sql"));
    assert.match(fix, /CREATE OR REPLACE FUNCTION public\.admin_reassign_brand_owner/i);
    assert.match(fix, /set_config\s*\(\s*'app\.allow_brand_owner_transfer'\s*,\s*'on'\s*,\s*true\s*\)/i);
    assert.match(fix, /REVOKE EXECUTE ON FUNCTION public\.admin_reassign_brand_owner\([^)]*\) FROM anon, PUBLIC/i);
  });

  it("mapWriteError translates the account_id immutability error to friendly copy", () => {
    assert.match(SERVICE, /account_id is immutable|immutable/);
  });
});

describe("ORCH-1276 REWORK — P2 pricing_currency is read-only/derived in the A1 form", () => {
  it("pricing_currency is a readonly field (displayed, not submitted); default_currency is editable + required", () => {
    // pricing_currency present as readonly, NOT as an editable required text field.
    assert.match(BRANDS, /key:\s*"pricing_currency"[\s\S]{0,120}type:\s*"readonly"/);
    assert.ok(
      !/key:\s*"pricing_currency",\s*label:\s*"Pricing currency",\s*type:\s*"text",\s*required:\s*true/.test(BRANDS),
      "pricing_currency must not be presented as an editable required field",
    );
    // default_currency is the editable source of truth.
    assert.match(BRANDS, /key:\s*"default_currency"[\s\S]{0,160}required:\s*true/);
    assert.match(BRANDS, /derived from this/i);
  });
});
