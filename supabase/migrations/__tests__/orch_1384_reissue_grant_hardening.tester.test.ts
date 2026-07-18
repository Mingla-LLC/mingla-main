// ORCH-1384 [partner brand-management verbs] — TESTER adversarial regression.
//
// DIFFERENT ANGLE than the implementor's suite. The implementor's
// `orch_1384_partner_link_lifecycle.test.ts` test
//   "T-4: reissue RPC grant — service_role ONLY"
// asserts only that the migration TEXT contains
//   `REVOKE ALL ON FUNCTION ... FROM PUBLIC;`  +  `GRANT EXECUTE ... TO service_role;`
// and calls that "service_role ONLY". That is the SAME false-green ORCH-1338 P2-1
// already caught in this codebase: Supabase's default ACL grants per-ROLE EXECUTE
// (anon, authenticated, service_role) at function CREATE, and
// `REVOKE ALL ... FROM PUBLIC` does NOT strip a per-ROLE grant — so at RUNTIME the
// reissue RPC remains EXECUTE-able by anon AND authenticated.
//
// LIVE PROOF (prod gqnoajqerqhnvulmnyvv, 2026-07-17):
//   has_function_privilege('anon',          reissue, 'EXECUTE') = true
//   has_function_privilege('authenticated', reissue, 'EXECUTE') = true
// Anon POST to /rest/v1/rpc/partner_reissue_brand_invitation executed the function
// body (returned P0001 'link_not_found', i.e. it ran the SELECT) instead of a 42501
// permission error. The reissue RPC has NO auth.uid() guard — its ONLY authorization
// is the (broken) service_role grant plus a caller-SUPPLIED p_partner_account_id, so
// the grant leak is a real authz bypass, not defense-in-depth.
//
// This test encodes the ORCH-1338 remediation shape as the acceptance bar: the
// migration must EXPLICITLY revoke EXECUTE from anon AND authenticated on the
// reissue function (matching `REVOKE EXECUTE ON FUNCTION <fn> FROM PUBLIC, anon,
// authenticated;`), then re-GRANT to service_role only.
//
// FAILS-ON-REVERT semantics: RED on the current (unfixed) branch — it pins the P0.
// It goes GREEN once REWORK adds the explicit REVOKE FROM ... anon, authenticated;
// and RED again if that REVOKE is ever deleted or narrowed. Demonstrated by the
// tester (see TEST report §5): adding the REVOKE line → 3/3 green; removing it →
// the §A/§B asserts fail.
//
// Run from the REPO ROOT (CI convention):
//   deno test --allow-read --no-check \
//     supabase/migrations/__tests__/orch_1384_reissue_grant_hardening.tester.test.ts
//
// COMMS-0106 discipline: comments are stripped before every structural match
// (prose can never satisfy an assertion), and the REVOKE statement is isolated by
// its unique function signature (provenance) before the grantee list is judged.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  new URL(
    "../20270102000000_orch_1384_partner_link_lifecycle.sql",
    import.meta.url,
  );
const migration = await Deno.readTextFile(MIGRATION_PATH);

// Strip SQL line comments so prose never false-positives a structural assertion.
const sql = migration.replace(/--[^\n]*/g, "");

const REISSUE_SIG =
  "public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz)";

/** Isolate the REVOKE ... ON FUNCTION <reissue> ... ; statement (provenance:
 *  the reissue signature must appear in a REVOKE, exactly the one under test). */
function reissueRevokeStatements(): string[] {
  return [...sql.matchAll(/REVOKE\s+[\s\S]*?ON\s+FUNCTION[\s\S]*?;/gi)]
    .map((m) => m[0])
    .filter((s) => s.includes(REISSUE_SIG));
}

Deno.test("§A reissue REVOKE strips the authenticated role grant (not only PUBLIC)", () => {
  const revokes = reissueRevokeStatements();
  assert(
    revokes.length >= 1,
    "expected a REVOKE ... ON FUNCTION <reissue> statement",
  );
  const strips = revokes.some((r) => {
    const from = r.replace(/^[\s\S]*\bFROM\b/i, ""); // grantee list only
    return /\bauthenticated\b/i.test(from);
  });
  assert(
    strips,
    "reissue is service_role-ONLY per SPEC §4.4 RPC-3 / §7 A-6, but no REVOKE " +
      "strips `authenticated` — Supabase's default per-ROLE ACL leaves authenticated " +
      "with EXECUTE (LIVE: has_function_privilege('authenticated', reissue, 'EXECUTE')=true). " +
      "Fix (ORCH-1338 pattern): REVOKE EXECUTE ON FUNCTION " + REISSUE_SIG +
      " FROM PUBLIC, anon, authenticated;",
  );
});

Deno.test("§B reissue REVOKE strips the anon role grant (not only PUBLIC)", () => {
  const revokes = reissueRevokeStatements();
  const strips = revokes.some((r) => {
    const from = r.replace(/^[\s\S]*\bFROM\b/i, "");
    return /\banon\b/i.test(from);
  });
  assert(
    strips,
    "no REVOKE strips `anon` from the reissue function — LIVE: " +
      "has_function_privilege('anon', reissue, 'EXECUTE')=true. `REVOKE ALL ... " +
      "FROM PUBLIC` does NOT remove the default per-ROLE anon grant.",
  );
});

Deno.test("§C companion — reissue re-GRANT stays service_role only (no widening to anon/authenticated/PUBLIC)", () => {
  const grants = [...sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?;/gi)]
    .map((m) => m[0])
    .filter((g) => g.includes(REISSUE_SIG));
  assert(
    grants.length === 1,
    `exactly one reissue GRANT expected, found ${grants.length}`,
  );
  const grantees = grants[0].replace(/^[\s\S]*\bTO\b/i, "");
  assertStringIncludes(grantees, "service_role");
  assert(!/\banon\b/i.test(grantees), "reissue GRANT must not target anon");
  assert(
    !/\bauthenticated\b/i.test(grantees),
    "reissue GRANT must not target authenticated",
  );
  assert(
    !/\bPUBLIC\b/i.test(grantees.replace(/public\./gi, "")),
    "reissue GRANT must not target PUBLIC",
  );
});
