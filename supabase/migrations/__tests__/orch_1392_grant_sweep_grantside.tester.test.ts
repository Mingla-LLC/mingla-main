// ORCH-1392 [SECURITY DEFINER grant-hygiene sweep] — TESTER adversarial
// regression test. DIFFERENT ANGLE than the implementor's happy-path suite
// (orch_1392_grant_sweep.test.ts).
//
// The implementor's suite attacks the REVOKE side only: it asserts each of the
// 45 functions REVOKEs anon (and authenticated for the 26 svc-only), that there
// is zero `GRANT ... TO anon`, and that the two body-gate tokens are present. It
// NEVER asserts that a positive GRANT to the INTENDED role exists, nor that the
// migration's own fail-closed Section-C DO-block actually covers every revoked
// function. Two silent-regression classes therefore slip past it:
//
//   ANGLE 1 (GRANT-side / availability regression): if a
//   `GRANT EXECUTE ... TO service_role` line is deleted, the function is left
//   with NO grant at all — service_role callers (the scan-ticket / delete-user /
//   webhook edge functions, the payout-ledger writers) lose EXECUTE and break in
//   production, while the implementor's REVOKE-only suite stays fully green. The
//   REVOKE hardens security; the GRANT preserves availability. This suite guards
//   the GRANT half.
//
//   ANGLE 2 (self-assert coverage regression): the migration's Section-C
//   DO-block is the fail-closed apply-time guarantee. If a function is dropped
//   from the svc_only[] / authed[] assert arrays (but keeps its REVOKE), the
//   runtime self-check silently stops covering it — a hole the migration-text
//   REVOKE assertions cannot see. This suite asserts the DO-block arrays are
//   set-equal to the revoked set (26 + 19).
//
// COMMS-0106: `--` comments are STRIPPED before matching, so a GRANT/array
// string living in a comment can never satisfy (or falsely trip) an assertion.
// This is a NEW file (append-only; no existing test modified; no TEST-MOD token
// owed). fails-on-revert: deleting any `GRANT ... TO service_role` line, or
// dropping a function from a DO-block assert array, flips this suite red.

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

// The 26 service_role-only functions: must GRANT service_role.
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
  "cleanup_expired_undo_actions",
  "cleanup_stale_push_tokens",
  "tg_meta_orch_1009_sub_d_quarterly_sweep",
];

// The 19 authenticated functions: must GRANT authenticated AND service_role.
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
  "recalculate_user_level",
];

// Extract the TO-clause of the GRANT EXECUTE statement for a given function name
// (name -> the grantee list text between `TO` and the statement `;`).
function grantToClause(fnName: string): string | null {
  const re = new RegExp(
    `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fnName}\\s*\\([^;]*?\\)\\s+TO\\s+([^;]+);`,
    "i",
  );
  const m = sql.match(re);
  return m ? m[1] : null;
}

Deno.test("ORCH-1392 tester · ANGLE 1a — every service_role-only fn GRANTs service_role (availability, fails-on-revert of a dropped GRANT)", () => {
  assert(SERVICE_ROLE_ONLY.length === 26, `expected 26 svc-only, got ${SERVICE_ROLE_ONLY.length}`);
  for (const fn of SERVICE_ROLE_ONLY) {
    const clause = grantToClause(fn);
    assert(clause !== null, `GRANT EXECUTE ... TO ... present for public.${fn}(...) (dropped GRANT would strand service_role callers)`);
    assert(
      /\bservice_role\b/i.test(clause!),
      `svc-only GRANT for public.${fn} names service_role (TO clause: "${clause!.trim()}")`,
    );
  }
});

Deno.test("ORCH-1392 tester · ANGLE 1b — every authenticated fn GRANTs BOTH authenticated AND service_role", () => {
  assert(AUTHENTICATED.length === 19, `expected 19 authenticated, got ${AUTHENTICATED.length}`);
  for (const fn of AUTHENTICATED) {
    const clause = grantToClause(fn);
    assert(clause !== null, `GRANT EXECUTE ... TO ... present for public.${fn}(...)`);
    assert(
      /\bauthenticated\b/i.test(clause!),
      `authenticated GRANT for public.${fn} names authenticated (TO clause: "${clause!.trim()}")`,
    );
    assert(
      /\bservice_role\b/i.test(clause!),
      `authenticated GRANT for public.${fn} ALSO names service_role — edge/webhook callers must retain EXECUTE (TO clause: "${clause!.trim()}")`,
    );
  }
});

// Extract the function names quoted inside a named plpgsql text[] array literal,
// e.g.  svc_only text[] := ARRAY[ 'public.foo(uuid)', ... ];
function doBlockArrayFns(arrayName: string): string[] {
  const re = new RegExp(`${arrayName}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]`, "i");
  const m = sql.match(re);
  if (!m) return [];
  const names: string[] = [];
  const entryRe = /'public\.(\w+)\s*\(/g;
  let e: RegExpExecArray | null;
  while ((e = entryRe.exec(m[1])) !== null) names.push(e[1]);
  return names;
}

Deno.test("ORCH-1392 tester · ANGLE 2 — Section-C DO-block assert arrays are set-equal to the revoked set (self-assert covers all 45)", () => {
  const svcAsserted = new Set(doBlockArrayFns("svc_only"));
  const authedAsserted = new Set(doBlockArrayFns("authed"));

  // Each revoked fn must be covered by the corresponding fail-closed assert array.
  for (const fn of SERVICE_ROLE_ONLY) {
    assert(svcAsserted.has(fn), `Section-C svc_only[] DO-block assert covers public.${fn} (else the apply-time fail-closed check silently skips it)`);
  }
  for (const fn of AUTHENTICATED) {
    assert(authedAsserted.has(fn), `Section-C authed[] DO-block assert covers public.${fn}`);
  }
  // And the arrays contain NOTHING beyond the revoked set (no phantom coverage).
  assert(
    svcAsserted.size === 26,
    `svc_only[] DO-block array has exactly 26 entries, got ${svcAsserted.size}`,
  );
  assert(
    authedAsserted.size === 19,
    `authed[] DO-block array has exactly 19 entries, got ${authedAsserted.size}`,
  );
});
