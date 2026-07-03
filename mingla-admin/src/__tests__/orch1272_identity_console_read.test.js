// ORCH-1272 [Admin Identity console — READ-ONLY] — HAPPY-PATH regression.
//
// Source-level proof (node:test + fs, no DOM — mirrors the ORCH-1271 / meta_orch_
// 1104 admin regression pattern) that the identity READ console is wired end-to-
// end AND stays visibility-first:
//   1. RLS migration adds the four is_admin_user() SELECT policies (the admin-
//      visible data paths — incl. soft-deleted rows / non-owned teams a non-admin
//      cannot read).
//   2. admin_get_person read-RPC is guard-FIRST, READ-ONLY, and crosses the
//      sensitive subscriptions / admin_subscription_overrides tables (proving the
//      private money data flows through the RPC, not a browser read).
//   3. identityReadService is the single READ authority: getPerson→RPC, list/
//      detail reads under RLS, NO direct subscriptions read, and NO mutation
//      (read-only held — AC-5.2).
//   4. People + Brands pages consume EntityListView / EntityDetailView + the
//      ?userId= / ?brandId= deep-links, and ship zero edit actions.
//   5. Nav repointed to People + Brands; the 1271 placeholder route is gone.
//   6. The strict-grep gate + workflow job exist; admin_get_person is in the
//      gate-first registry; the DRAFT invariant is registered.
//
// Fails-on-revert target = the RLS/RPC migration + the service RPC call: deleting
// any policy line, the admin_get_person body, or the rpc("admin_get_person") call
// makes this suite RED. The tester writes a SECOND, adversarial live-fire suite
// (the cross-row AC-1.4 / AC-2.3 / AC-4.3 proofs against the deployed migration).

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

// Strip comments so the read-only-held / no-split-gate assertions measure CODE,
// not the explanatory prose in headers (which legitimately names the forbidden
// tokens to explain why they are forbidden).
const stripSqlComments = (src) => src.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const stripJsComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

const MIG_RLS = "supabase/migrations/20261205000001_orch_1272_identity_admin_read_rls.sql";
const MIG_RPC = "supabase/migrations/20261205000002_orch_1272_admin_get_person.sql";
const READ_TABLES = ["creator_accounts", "brand_team_members", "brand_invitations", "partner_brand_links"];

describe("ORCH-1272 — identity admin-read RLS migration", () => {
  const sql = read(MIG_RLS);
  for (const t of READ_TABLES) {
    it(`adds an is_admin_user() SELECT policy on ${t}`, () => {
      const re = new RegExp(
        `create\\s+policy\\s+"${t} admin can read"\\s+on\\s+public\\.${t}\\s+for\\s+select\\s+using\\s*\\(\\s*public\\.is_admin_user\\(\\)\\s*\\)`,
        "i",
      );
      assert.match(sql, re);
    });
  }
  it("never re-introduces the account_type='admin' split gate", () => {
    assert.doesNotMatch(stripSqlComments(sql), /account_type/i);
  });
  it("is DDL-only: no ALTER/UPDATE/INSERT/DELETE on business tables", () => {
    assert.doesNotMatch(stripSqlComments(sql), /\b(ALTER TABLE|UPDATE|INSERT INTO|DELETE FROM)\b/i);
  });
});

describe("ORCH-1272 — admin_get_person read-RPC migration", () => {
  const sql = read(MIG_RPC);
  const body = (() => {
    const m = /create\s+or\s+replace\s+function\s+public\.admin_get_person\b/i.exec(sql);
    const rest = sql.slice(m.index);
    const open = rest.indexOf("$$");
    return rest.slice(open + 2, rest.indexOf("$$", open + 2));
  })();
  it("is SECURITY DEFINER and guards FIRST on is_admin_user() before any query", () => {
    assert.match(sql, /admin_get_person[\s\S]*?SECURITY DEFINER/i);
    const afterBegin = body.slice(body.search(/\bBEGIN\b/i) + "BEGIN".length);
    const first = afterBegin
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n")
      .split(";")[0]
      .trim();
    assert.match(first, /^IF\s+NOT\s+public\.is_admin_user\(\)\s+THEN\s+RAISE/i);
  });
  it("crosses the sensitive subscriptions + admin_subscription_overrides tables (RPC-only)", () => {
    assert.match(body, /public\.subscriptions/);
    assert.match(body, /public\.admin_subscription_overrides/);
    assert.match(body, /get_effective_tier/);
    assert.match(body, /derive_user_segment/);
  });
  it("is READ-ONLY: no INSERT/UPDATE/DELETE, no admin_write_audit", () => {
    assert.doesNotMatch(body, /\b(INSERT INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
    assert.doesNotMatch(body, /admin_write_audit/i);
  });
  it("enforces least-privilege (ORCH-1271 P0 golden template): anon/PUBLIC revoked, authenticated granted, self-asserted", () => {
    assert.match(sql, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.admin_get_person\(uuid\)\s+FROM\s+anon,\s*PUBLIC/i);
    assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.admin_get_person\(uuid\)\s+TO\s+authenticated/i);
    // apply-time self-assert: anon cannot execute, authenticated can.
    assert.match(sql, /has_function_privilege\('anon',\s*'public\.admin_get_person\(uuid\)',\s*'EXECUTE'\)/i);
    assert.match(sql, /has_function_privilege\('authenticated',\s*'public\.admin_get_person\(uuid\)',\s*'EXECUTE'\)/i);
  });
});

describe("ORCH-1272 — identityReadService (single READ authority)", () => {
  const svc = stripJsComments(readSrc("services/identityReadService.js"));
  it("getPerson reads via the admin_get_person RPC", () => {
    assert.match(svc, /rpc\("admin_get_person",\s*\{\s*p_user_id/);
  });
  it("listAccounts reads creator_accounts with partner + status filters", () => {
    assert.match(svc, /\.from\("creator_accounts"\)/);
    assert.match(svc, /partner_enabled/);
    assert.match(svc, /deleted_at/);
  });
  it("listBrands reads brands; getBrandDetail reads team/invites/partner/tickets by brand_id", () => {
    assert.match(svc, /\.from\("brands"\)/);
    for (const t of ["brand_team_members", "brand_invitations", "partner_brand_links", "support_tickets"]) {
      assert.match(svc, new RegExp(`\\.from\\("${t}"\\)`), `reads ${t}`);
    }
    assert.match(svc, /\.eq\("brand_id",\s*brandId\)/);
  });
  it("takes NO direct browser read of subscriptions / admin_subscription_overrides", () => {
    assert.doesNotMatch(svc, /\.from\(\s*["'](?:subscriptions|admin_subscription_overrides)["']\s*\)/);
  });
  it("is READ-ONLY: no .update / .insert / .delete / admin_write_audit (AC-5.2)", () => {
    assert.doesNotMatch(svc, /\.update\(/);
    assert.doesNotMatch(svc, /\.insert\(/);
    assert.doesNotMatch(svc, /\.delete\(/);
    assert.doesNotMatch(svc, /admin_write_audit/);
  });
});

describe("ORCH-1272 — People + Brands pages", () => {
  const people = readSrc("pages/PeopleConsolePage.jsx");
  const brands = readSrc("pages/BrandsConsolePage.jsx");
  // [TEST-MOD-APPROVED ORCH-1276] Wave-2 EDIT repoint: the pages are no longer
  // read-only — they now carry audited edit modals. The read wiring + the
  // no-direct-browser-write / no-inline-audit invariant STILL hold (writes route
  // through identityWriteService → the audited RPCs); only the "no edit modal"
  // clause is retired (now enforced positively by ORCH-1276's own gate/tests).
  it("People uses EntityListView + getPerson + the ?userId= deep-link; writes route through the audited service", () => {
    assert.match(people, /EntityListView/);
    assert.match(people, /EntityDetailView/);
    assert.match(people, /getPerson/);
    assert.match(people, /listAccounts/);
    assert.match(people, /userId/);
    assert.match(people, /identityWriteService/);
    for (const forbidden of [".update(", ".insert(", ".delete(", "admin_write_audit"]) {
      assert.ok(!people.includes(forbidden), `no direct browser write: no ${forbidden} in People`);
    }
  });
  it("Brands uses EntityListView + getBrandDetail + the ?brandId= deep-link; writes route through the audited service", () => {
    assert.match(brands, /EntityListView/);
    assert.match(brands, /EntityDetailView/);
    assert.match(brands, /getBrandDetail/);
    assert.match(brands, /listBrands/);
    assert.match(brands, /brandId/);
    assert.match(brands, /identityWriteService/);
    for (const forbidden of [".update(", ".insert(", ".delete(", "admin_write_audit"]) {
      assert.ok(!brands.includes(forbidden), `no direct browser write: no ${forbidden} in Brands`);
    }
  });
});

describe("ORCH-1272 — nav + routing repointed", () => {
  it("NAV_GROUPS 'Business' group has People + Brands (business-console removed)", () => {
    const biz = NAV_GROUPS.find((g) => g.label === "Business");
    assert.ok(biz, "Business group present");
    assert.ok(biz.items.some((i) => i.id === "business-people" && i.icon === "Users"));
    assert.ok(biz.items.some((i) => i.id === "business-brands" && i.icon === "Building2"));
    assert.ok(!biz.items.some((i) => i.id === "business-console"), "placeholder item removed");
    assert.ok(NAV_ITEMS.some((i) => i.id === "business-people"));
    assert.ok(NAV_ITEMS.some((i) => i.id === "business-brands"));
  });
  it("App.jsx routes #/business-people + #/business-brands (business-console gone)", () => {
    const app = readSrc("App.jsx");
    assert.match(app, /import \{ PeopleConsolePage \} from "\.\/pages\/PeopleConsolePage"/);
    assert.match(app, /import \{ BrandsConsolePage \} from "\.\/pages\/BrandsConsolePage"/);
    assert.match(app, /"business-people": PeopleConsolePage/);
    assert.match(app, /"business-brands": BrandsConsolePage/);
    assert.doesNotMatch(app, /"business-console"/);
    assert.doesNotMatch(app, /BusinessConsolePage/);
  });
  it("the 1271 placeholder page is deleted", () => {
    assert.ok(!fs.existsSync(path.join(ADMIN_SRC, "pages/BusinessConsolePage.jsx")));
  });
  it("Sidebar ICON_MAP registers Users + Building2 (else silent fallback)", () => {
    const sb = readSrc("components/layout/Sidebar.jsx");
    assert.match(sb, /const ICON_MAP = \{[\s\S]*?\bUsers\b[\s\S]*?\bBuilding2\b[\s\S]*?\};/);
  });
});

describe("ORCH-1272 — gate + workflow + registry", () => {
  it("i-1272-identity-admin-read.mjs exists and supports --self-test", () => {
    const g = read(".github/scripts/strict-grep/i-1272-identity-admin-read.mjs");
    assert.match(g, /--self-test/);
    for (const t of READ_TABLES) assert.ok(g.includes(t), `gate references ${t}`);
    assert.match(g, /admin_get_person/);
  });
  it("workflow registers the orch-1272-identity-admin-read job", () => {
    const wf = read(".github/workflows/strict-grep-mingla-business.yml");
    assert.match(wf, /orch-1272-identity-admin-read:/);
    assert.match(wf, /i-1272-identity-admin-read\.mjs/);
  });
  it("admin_get_person is appended to the gate-first registry (not the write-RPC registry)", () => {
    const gate = read(".github/scripts/strict-grep/i-admin-gate-first-statement.mjs");
    assert.match(gate, /"admin_get_person"/);
    const writeGate = read(".github/scripts/strict-grep/i-admin-write-audited.mjs");
    assert.doesNotMatch(writeGate, /admin_get_person/);
  });
  it("I-PROPOSED-1272-IDENTITY-ADMIN-READ is registered DRAFT", () => {
    const reg = read("Mingla_Artifacts/INVARIANT_REGISTRY.md");
    assert.match(reg, /I-PROPOSED-1272-IDENTITY-ADMIN-READ \(DRAFT\)/);
  });
});
