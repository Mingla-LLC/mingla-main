// ORCH-1272 [Admin Identity console — READ-ONLY] — ADVERSARIAL deny + containment.
//
// TESTER-owned suite (mingla-tester). Attacks a DIFFERENT ANGLE than the
// implementor's happy-path (orch1272_identity_console_read.test.js): where that
// suite proves the wiring EXISTS, this one proves the SECURITY ENVELOPE cannot be
// silently widened — the "non-admin / anon gets NOTHING" + "the sensitive money
// tables are reachable ONLY through the guard-first SECURITY DEFINER RPC"
// invariants that were proven live-fire against PROD gqnoajqerqhnvulmnyvv on
// 2026-07-03 (admin sees soft-deleted acct 691e6d17 / cross-brand member
// 4d8d554a / soft-deleted brand 9fed1398; non-admin 04607d31 + anon see 0;
// admin_get_person → not_authorized for a non-admin even on their OWN id
// (guard-first, line 4), → not_found for a bogus uid, → permission-denied for
// anon). Those runtime facts are re-encoded here as durable source invariants a
// CI node:test run can enforce (no DB creds required).
//
// Explicitly NON-overlapping with the happy-path: it asserts the RPC's not_found
// safety, the strict guard-BEFORE-any-read ordering, the ABSENCE of any browser
// RLS policy on subscriptions / admin_subscription_overrides, the ABSENCE of any
// anon/PUBLIC re-GRANT, and the People page's not_authorized denial branch — none
// of which the happy-path checks.
//
// Fails-on-revert: deleting the guard line from the admin_get_person migration
// makes assertion (A) RED (guard no longer precedes the first table read);
// re-widening the money tables or re-granting anon makes (C)/(D) RED. Verified by
// true line-deletion at commit 089a25b646 (see the QA report Step 5).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel) => fs.readFileSync(path.join(ADMIN_SRC, rel), "utf8");
const stripSqlComments = (src) => src.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

const MIG_RLS = "supabase/migrations/20261205000001_orch_1272_identity_admin_read_rls.sql";
const MIG_RPC = "supabase/migrations/20261205000002_orch_1272_admin_get_person.sql";

const rpcSql = read(MIG_RPC);
const rlsSql = read(MIG_RLS);

// Extract ONLY the admin_get_person function body (first $$…$$ pair — the DO
// self-assert block is a separate $$ pair that must not be conflated).
function fnBody(sql) {
  const m = /create\s+or\s+replace\s+function\s+public\.admin_get_person\b/i.exec(sql);
  assert.ok(m, "admin_get_person function definition present");
  const rest = sql.slice(m.index);
  const open = rest.indexOf("$$");
  return rest.slice(open + 2, rest.indexOf("$$", open + 2));
}
const body = fnBody(rpcSql);

describe("ORCH-1272 ADVERSARIAL — admin_get_person guard-first ordering (deny-before-read)", () => {
  it("(A) the is_admin_user() NEGATION guard raising not_authorized precedes EVERY table read", () => {
    // The guard MUST be a negation (IF NOT …) that raises not_authorized — a flip
    // to `IF public.is_admin_user()` would invert the gate open.
    const guardIdx = body.search(
      /IF\s+NOT\s+public\.is_admin_user\(\)\s+THEN\s+RAISE\s+EXCEPTION\s+'not_authorized'/i,
    );
    const firstReadIdx = body.search(/\bFROM\s+public\./i);
    assert.ok(guardIdx >= 0, "guard-first negation raising not_authorized must be present");
    assert.ok(firstReadIdx >= 0, "the function must read at least one public.* table");
    assert.ok(
      guardIdx < firstReadIdx,
      "SECURITY: is_admin_user() guard must run BEFORE any FROM public.* read (no data touched pre-auth)",
    );
  });

  it("(B) not_found safety exists — a bogus uid RAISEs, never returns a hollow bundle", () => {
    // Live proof: admin_get_person('00000000-…') → not_found (line 6). The happy-
    // path does not assert this; without it a bogus id would return {person:null,…}.
    assert.match(
      body,
      /IF\s+v_out\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'not_found'/i,
      "missing-profile guard raising not_found must be present",
    );
  });
});

describe("ORCH-1272 ADVERSARIAL — sensitive money-table containment (RPC-only)", () => {
  it("(C) the RLS migration adds NO browser SELECT policy on subscriptions / admin_subscription_overrides", () => {
    // Live proof: subscriptions + admin_subscription_overrides expose ONLY a
    // `auth.uid() = user_id` self-read policy — no admin browser policy — so an
    // admin reading another user's money data via the anon key returns []. The
    // ONLY admin path is the SECURITY DEFINER RPC. If a future dev "helpfully"
    // adds an admin SELECT policy on either table, that containment is silently
    // broken. This asserts the negative the happy-path never checks.
    const code = stripSqlComments(rlsSql);
    assert.doesNotMatch(
      code,
      /\bON\s+public\.subscriptions\b/i,
      "no admin browser RLS may be added to subscriptions (money data is RPC-only)",
    );
    assert.doesNotMatch(
      code,
      /\bON\s+public\.admin_subscription_overrides\b/i,
      "no admin browser RLS may be added to admin_subscription_overrides (RPC-only)",
    );
  });

  it("(C2) the RPC itself is the crossing point for that sensitive data", () => {
    assert.match(body, /public\.subscriptions/, "RPC must read subscriptions server-side");
    assert.match(body, /public\.admin_subscription_overrides/, "RPC must read overrides server-side");
  });
});

describe("ORCH-1272 ADVERSARIAL — no anon / PUBLIC privilege escalation", () => {
  it("(D) neither migration GRANTs execute/select TO anon or PUBLIC; the RPC REVOKEs both", () => {
    // Live proof: has_function_privilege(anon, admin_get_person, EXECUTE) = false;
    // anon calling the RPC → 42501 permission denied. Guard against an accidental
    // re-grant that would re-open the function (or a table) to anon/PUBLIC.
    for (const [label, sql] of [["rpc", rpcSql], ["rls", rlsSql]]) {
      const badGrants = sql
        .split("\n")
        .filter((l) => /^\s*GRANT\b/i.test(l) && /\bTO\s+(anon|public)\b/i.test(l));
      assert.equal(
        badGrants.length,
        0,
        `SECURITY: ${label} migration must not GRANT to anon/PUBLIC — found: ${badGrants.join(" | ")}`,
      );
    }
    assert.match(
      rpcSql,
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.admin_get_person\(uuid\)\s+FROM\s+anon,\s*PUBLIC/i,
      "the RPC must explicitly REVOKE EXECUTE from anon, PUBLIC (least-privilege)",
    );
  });
});

describe("ORCH-1272 ADVERSARIAL — the People page surfaces the denial (no silent swallow)", () => {
  it("(E) PeopleConsolePage branches not_authorized to a user-facing message", () => {
    // A non-admin JWT that somehow reaches the RPC gets not_authorized; the page
    // must translate it to an explicit error state (EntityDetailView error+retry),
    // never a blank/silent screen. The happy-path only checks getPerson is called.
    const people = readSrc("pages/PeopleConsolePage.jsx");
    assert.match(people, /not_authorized/, "page must handle the not_authorized denial");
    assert.match(people, /not_found/, "page must handle the not_found case");
    assert.match(people, /onRetry/, "denial/error states must offer retry, not a dead end");
  });
});
