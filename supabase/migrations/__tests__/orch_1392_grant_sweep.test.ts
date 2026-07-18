// ORCH-1392 [SECURITY DEFINER grant-hygiene sweep] — static migration-text
// regression test (SPEC §9 structural safeguard 1).
//
// House pattern (orch_1331_partner_paystack_rail.test.ts): the "Migrations
// apply cleanly from baseline" CI job proves the SQL EXECUTES + the in-migration
// DO-block asserts the runtime end-state; THIS suite proves the grant CONTRACT
// survives edits without needing a live DB. Its runtime sibling — the live
// has_function_privilege gate (scripts/ci/security_definer_anon_gate.sh +
// .github/workflows/security-definer-anon-grant-gate.yml) — is the OTHER half:
// this text test cannot see the implicit default-privileges anon grant (F-6),
// so both are required (SPEC §9).
//
// COMMS-0106: comments are STRIPPED before matching, so a REVOKE/GRANT string
// living in a `--` comment can never satisfy (or falsely trip) an assertion.
//
// FAILS-ON-REVERT: deleting any `REVOKE ... FROM ... anon` line, dropping
// `authenticated` from a service_role-only REVOKE, adding a `GRANT ... TO anon`,
// or deleting either body-gate guard token flips the matching assertion red.

import { assert } from "jsr:@std/assert@1";

const MIGRATION_PATH = new URL(
  "../20270104000000_orch_1392_security_definer_grant_sweep.sql",
  import.meta.url,
);

const raw = await Deno.readTextFile(MIGRATION_PATH);

// Strip `--` line + trailing comments (COMMS-0106). No `--` appears inside any
// string literal in this migration, so per-line removal is safe.
const sql = raw
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

// The 26 service_role-only functions: anon AND authenticated revoked.
const SERVICE_ROLE_ONLY = [
  "biz_refund_order_commit_from_webhook",
  "finalize_rsvp_contribution",
  "anonymize_user_audit_log",
  "mark_partner_split_transferred",
  "mark_partner_split_reversed",
  "mark_partner_split_failed",
  "bump_paystack_partner_split_attempt",
  "mark_paystack_partner_split_attempted",
  "record_partner_split_attempt",
  "record_paystack_partner_split_attempt",
  "truncate_seed_map_presence",
  "cron_refresh_admin_place_pool_mv",
  "tg_kick_pending_trial_runs",
  "tg_kick_pending_thumb_backfill",
  "tg_meta_orch_1009_sub_d_kick_rescores",
  "expire_agent_pending_actions",
  "pg_topup_recurring_experiences",
  "pg_expand_experience_recurrence",
  "pg_try_discover_cache_build_lock",
  "pg_release_discover_cache_build_lock",
  "record_trial_phone",
  "biz_ticket_scan",
  "add_buyer_to_event_chat",
  // Section B2 — §4.2 missed-leaker remediation (svc-only).
  "cleanup_expired_undo_actions",
  "cleanup_stale_push_tokens",
  "tg_meta_orch_1009_sub_d_quarterly_sweep",
];

// The 19 authenticated functions: anon revoked, authenticated kept.
const AUTHENTICATED = [
  "fetch_user_going_rsvps",
  "get_admin_emails",
  "accept_invite_and_transfer_brand_ownership",
  "accept_scanner_invitation",
  "get_or_create_direct_conversation",
  "remove_participant_prefs",
  "upsert_participant_prefs",
  "execute_undo_action",
  "get_effective_tier",
  "derive_user_segment",
  "get_undo_actions",
  "get_muted_user_ids",
  "admin_city_pipeline_status",
  "admin_city_place_stats",
  "phone_has_used_trial",
  "has_recent_report",
  "is_admin_email",
  "check_invited_admin",
  // Section B2 — §4.2 missed-leaker remediation (authenticated).
  "recalculate_user_level",
];

const ALL_REVOKED = [...SERVICE_ROLE_ONLY, ...AUTHENTICATED];

// Extract the FROM-clause of the REVOKE EXECUTE statement for a given function
// name (name -> the grantee list text between `FROM` and the statement `;`).
function revokeFromClause(fnName: string): string | null {
  // Match: REVOKE EXECUTE ON FUNCTION public.<fn>( ...args... ) FROM <grantees>;
  const re = new RegExp(
    `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fnName}\\s*\\([^;]*?\\)\\s+FROM\\s+([^;]+);`,
    "i",
  );
  const m = sql.match(re);
  return m ? m[1] : null;
}

Deno.test("ORCH-1392 · all 45 revoked functions REVOKE anon (fails-on-revert of any REVOKE line)", () => {
  assert(
    ALL_REVOKED.length === 45,
    `expected 45 revoked functions, got ${ALL_REVOKED.length}`,
  );
  for (const fn of ALL_REVOKED) {
    const clause = revokeFromClause(fn);
    assert(clause !== null, `REVOKE EXECUTE statement present for public.${fn}(...)`);
    assert(
      /\banon\b/i.test(clause!),
      `REVOKE for public.${fn} strips anon (FROM clause: "${clause!.trim()}")`,
    );
  }
});

Deno.test("ORCH-1392 · the 26 service_role-only functions ALSO REVOKE authenticated", () => {
  assert(SERVICE_ROLE_ONLY.length === 26, `expected 26 svc-only, got ${SERVICE_ROLE_ONLY.length}`);
  for (const fn of SERVICE_ROLE_ONLY) {
    const clause = revokeFromClause(fn);
    assert(clause !== null, `REVOKE EXECUTE statement present for public.${fn}(...)`);
    assert(
      /\bauthenticated\b/i.test(clause!),
      `service_role-only REVOKE for public.${fn} strips authenticated (FROM clause: "${clause!.trim()}")`,
    );
  }
});

Deno.test("ORCH-1392 · the 19 authenticated functions do NOT revoke authenticated", () => {
  assert(AUTHENTICATED.length === 19, `expected 19 authenticated, got ${AUTHENTICATED.length}`);
  for (const fn of AUTHENTICATED) {
    const clause = revokeFromClause(fn);
    assert(clause !== null, `REVOKE EXECUTE statement present for public.${fn}(...)`);
    assert(
      !/\bauthenticated\b/i.test(clause!),
      `authenticated-tier REVOKE for public.${fn} must NOT strip authenticated (FROM clause: "${clause!.trim()}")`,
    );
  }
});

Deno.test("ORCH-1392 · SC-10 — ZERO 'GRANT EXECUTE ... TO ... anon' anywhere (no re-widening)", () => {
  const grantToAnon = /GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*\bTO\b[^;]*\banon\b/i;
  assert(
    !grantToAnon.test(sql),
    "the migration must contain NO 'GRANT EXECUTE ... TO ... anon' statement",
  );
});

Deno.test("ORCH-1392 · both body-gate guard tokens present (A-1 self-scope + A-2 admin gate)", () => {
  assert(
    sql.includes("auth.uid() IS DISTINCT FROM p_user_id"),
    "A-1 fetch_user_going_rsvps self-scope guard token present",
  );
  assert(
    /IF\s+NOT\s+public\.is_admin_user\(\)\s+THEN/i.test(sql),
    "A-2 get_admin_emails admin gate token present",
  );
  // Both gates live inside a CREATE OR REPLACE that (re)creates the function.
  assert(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fetch_user_going_rsvps\s*\(/i.test(sql),
    "A-1 CREATE OR REPLACE present",
  );
  assert(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_admin_emails\s*\(/i.test(sql),
    "A-2 CREATE OR REPLACE present",
  );
});

Deno.test("ORCH-1392 · Section B2 §4.2 residual-leaker remediation present (4 fns)", () => {
  // These 4 same-class leakers were surfaced during IMPLEMENT and are revoked
  // here rather than allowlisted (SPEC §4.2). If REVIEW rejects the amendment,
  // this block + the 4 REVOKEs + the 4 DO-asserts + the 4 allowlist lines move
  // together — and this assertion is the tripwire that they stayed consistent.
  for (const fn of [
    "cleanup_expired_undo_actions",
    "cleanup_stale_push_tokens",
    "tg_meta_orch_1009_sub_d_quarterly_sweep",
    "recalculate_user_level",
  ]) {
    assert(revokeFromClause(fn) !== null, `Section B2 REVOKE present for public.${fn}`);
  }
});
