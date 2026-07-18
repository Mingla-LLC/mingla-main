-- ORCH-1392 [SECURITY DEFINER grant-hygiene sweep — durable fix]
--
-- Makes the 2026-07-18 emergency hot-patch (7 functions, grants-only, applied
-- live to prod) DURABLE + IDEMPOTENT and EXTENDS it to the remaining Tier-2
-- leakers found by INVESTIGATION_ORCH-1392, plus the 2 internal-gate body fixes
-- that grants alone cannot fix. Modeled on 20261227000000_orch_1338_p2_revoke_
-- anon_execute.sql and the ORCH-1384 20270103000000 grant-hardening shape.
--
-- ============================================================================
-- WHY THIS MIGRATION EXISTS (the default-privileges footgun)
-- ----------------------------------------------------------------------------
-- Supabase projects ship `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
-- EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`. So EVERY
-- `CREATE FUNCTION` lands with a DIRECT per-ROLE `anon=EXECUTE` ACL entry in
-- pg_proc.proacl, on top of the implicit PUBLIC grant. A `REVOKE ALL ... FROM
-- PUBLIC` does NOT strip that direct role grant — so a SECURITY DEFINER
-- function that trusts a caller-supplied identity (or has no internal
-- auth.uid() gate) and is anon-EXECUTE becomes an anon auth-bypass.
--
-- INVESTIGATION_ORCH-1392 probed prod live (`has_function_privilege`) and found
-- 279/399 definer functions anon-executable and 41 true leakers (7 HIGH +
-- 34 MED), incl. forge-refund / forge-paid-contribution / wipe-audit-log /
-- QR-exfil / admin-email-dump. The orchestrator hot-patched the 7 HIGH live
-- (grants-only). This migration re-asserts those 7, revokes the 34 Tier-2, and
-- adds the 2 body gates — all idempotently.
--
-- GRANTS-FIRST-AFTER-CREATE-OR-REPLACE + DO-NOT-DELETE-ANY-REVOKE:
--   * Section A (2 CREATE OR REPLACE) runs BEFORE the grants: CREATE OR REPLACE
--     PRESERVES the existing ACL on prod (no widening); on a fresh env it
--     re-creates the function so Section B then sets the correct ACL.
--   * Do NOT delete any REVOKE line and do NOT reorder Section B before
--     Section A — the anon grant RETURNS via default privileges the instant a
--     function is (re)created, so the explicit REVOKE is the ONLY durable
--     barrier. Deleting a REVOKE silently re-opens the leak (caught by
--     supabase/migrations/__tests__/orch_1392_grant_sweep.test.ts and the live
--     has_function_privilege CI gate).
--
-- ZERO `GRANT ... TO anon` anywhere in this file (SC-10). This migration only
-- ever NARROWS privilege.
--
-- SAFE-MIGRATION PROTOCOL: the only DDL is 2 semantics-preserving CREATE OR
-- REPLACE FUNCTION (identical signature + query; a guard prepended) + grants.
-- No table DDL, no RLS change, no DROP. Idempotent — safe to re-run.
--
-- DO NOT auto-apply — the orchestrator/Seth applies at CLOSE (mostly a no-op
-- vs the live hot-patch + the new Tier-2 revokes + the 2 gates).
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION A — internal-gate body fixes (2 functions). MUST precede Section B.
-- Both bodies are copied VERBATIM from prod `pg_get_functiondef`; only the
-- wrapper (LANGUAGE plpgsql + BEGIN/guard/RETURN QUERY/END) is new. Caller-
-- compat verified: fetch_user_going_rsvps' sole client caller
-- (calendarService.ts:517) passes the signed-in user's OWN id; get_admin_emails'
-- sole caller (AuthContext.jsx:129, authenticated) maps `data || []` and
-- tolerates an empty roster (hardcoded-allowlist fallback).
-- ============================================================================

-- A-1. fetch_user_going_rsvps — self-scope gate. anon is revoked at the grant
-- layer (Section B); an authenticated caller may only read their OWN rows;
-- service_role (auth.uid() IS NULL, the trusted edge-fn path) bypasses. Converts
-- LANGUAGE sql -> plpgsql (a sql function cannot host IF ... RAISE); the
-- RETURNS TABLE and the two-branch UNION ALL query are the prod body, unchanged.
CREATE OR REPLACE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)
RETURNS TABLE(rsvp_id uuid, guest_id uuid, role text, qr_code text, rsvp_status text, approval_status text, plus_count integer, display_name text, invited_by text, event_id uuid, event_title text, event_slug text, cover_media_url text, timezone text, location_text text, is_online boolean, online_url text, brand_id uuid, brand_slug text, brand_name text, master_start_at timestamp with time zone, master_end_at timestamp with time zone, created_at timestamp with time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ORCH-1392: self-scope gate. anon is revoked at the grant layer; an
  -- authenticated caller may only read their OWN rows. service_role
  -- (auth.uid() IS NULL) is the trusted edge-function path and bypasses.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id          AS rsvp_id,
    NULL::uuid    AS guest_id,
    'primary'     AS role,
    r.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(r.guest_name, 'Guest'), r.guest_name) AS display_name,
    NULL::text    AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    r.created_at
  FROM public.event_rsvps r
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  LEFT JOIN public.profiles pr ON pr.id = r.user_id
  WHERE r.user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL

  UNION ALL

  SELECT
    r.id          AS rsvp_id,
    g.id          AS guest_id,
    'guest'       AS role,
    g.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    COALESCE(NULLIF(btrim(pg.display_name), ''), g.name) AS display_name,
    r.guest_name  AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    g.created_at
  FROM public.event_rsvp_guests g
  JOIN public.event_rsvps r ON r.id = g.rsvp_id
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  LEFT JOIN public.profiles pg ON pg.id = g.matched_user_id
  WHERE g.matched_user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL;
END;
$function$;

-- A-2. get_admin_emails — only a confirmed admin may enumerate the admin
-- roster. Non-admins (and anon, already revoked) receive ZERO rows (not a
-- RAISE) — AuthContext.fetchDynamicAdmins maps `data || []` and treats empty as
-- "no dynamic admins" (hardcoded-allowlist fallback). Converts sql -> plpgsql,
-- adds SET search_path (also clears the function_search_path_mutable advisory).
CREATE OR REPLACE FUNCTION public.get_admin_emails()
RETURNS TABLE(email text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ORCH-1392: only a confirmed admin may enumerate the admin roster.
  -- Non-admins (and anon, already revoked) receive zero rows — the admin
  -- console tolerates an empty dynamic list (hardcoded allowlist fallback).
  IF NOT public.is_admin_user() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT au.email, au.status
    FROM admin_users au
    WHERE au.status IN ('active', 'invited');
END;
$function$;

-- ============================================================================
-- SECTION B — grants (41-function matrix). Idempotent REVOKE/GRANT.
-- Group 1 (23): service_role only  -> REVOKE FROM PUBLIC, anon, authenticated
-- Group 2 (18): authenticated      -> REVOKE FROM PUBLIC, anon
-- ============================================================================

-- ---- Group 1 — SERVICE_ROLE ONLY (23) --------------------------------------
-- 1  biz_refund_order_commit_from_webhook (re-assert hot-patch; HIGH forge-refund)
REVOKE EXECUTE ON FUNCTION public.biz_refund_order_commit_from_webhook(p_order_id uuid, p_stripe_refund_id text, p_amount_cents integer, p_currency character, p_application_fee_refunded_cents integer, p_idempotency_key_hint text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_refund_order_commit_from_webhook(p_order_id uuid, p_stripe_refund_id text, p_amount_cents integer, p_currency character, p_application_fee_refunded_cents integer, p_idempotency_key_hint text) TO service_role;

-- 2  finalize_rsvp_contribution (re-assert hot-patch; HIGH forge-paid-contribution)
REVOKE EXECUTE ON FUNCTION public.finalize_rsvp_contribution(p_contribution_id uuid, p_provider_ref text, p_charge_id text, p_payment_method_type text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_rsvp_contribution(p_contribution_id uuid, p_provider_ref text, p_charge_id text, p_payment_method_type text) TO service_role;

-- 3  anonymize_user_audit_log (re-assert hot-patch; HIGH wipe-audit-log)
REVOKE EXECUTE ON FUNCTION public.anonymize_user_audit_log(p_user_id uuid, p_salt text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_user_audit_log(p_user_id uuid, p_salt text) TO service_role;

-- 4  mark_partner_split_transferred (payout ledger)
REVOKE EXECUTE ON FUNCTION public.mark_partner_split_transferred(p_application_fee_id text, p_transfer_id text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_transferred(p_application_fee_id text, p_transfer_id text) TO service_role;

-- 5  mark_partner_split_reversed (payout ledger)
REVOKE EXECUTE ON FUNCTION public.mark_partner_split_reversed(p_application_fee_id text, p_reversal_transfer_id text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_reversed(p_application_fee_id text, p_reversal_transfer_id text) TO service_role;

-- 6  mark_partner_split_failed (payout ledger)
REVOKE EXECUTE ON FUNCTION public.mark_partner_split_failed(p_application_fee_id text, p_reason text, p_error_message text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_failed(p_application_fee_id text, p_reason text, p_error_message text) TO service_role;

-- 7  bump_paystack_partner_split_attempt (payout ledger)
REVOKE EXECUTE ON FUNCTION public.bump_paystack_partner_split_attempt(p_key text, p_error text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_paystack_partner_split_attempt(p_key text, p_error text) TO service_role;

-- 8  mark_paystack_partner_split_attempted (payout ledger)
REVOKE EXECUTE ON FUNCTION public.mark_paystack_partner_split_attempted(p_key text, p_payout_reference text, p_transfer_code text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_paystack_partner_split_attempted(p_key text, p_payout_reference text, p_transfer_code text) TO service_role;

-- 9  record_partner_split_attempt (payout ledger)
REVOKE EXECUTE ON FUNCTION public.record_partner_split_attempt(p_application_fee_id text, p_order_id uuid, p_brand_id uuid, p_partner_account_id uuid, p_mingla_fee_cents integer, p_partner_share_cents integer, p_currency text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_split_attempt(p_application_fee_id text, p_order_id uuid, p_brand_id uuid, p_partner_account_id uuid, p_mingla_fee_cents integer, p_partner_share_cents integer, p_currency text) TO service_role;

-- 10 record_paystack_partner_split_attempt (payout ledger)
REVOKE EXECUTE ON FUNCTION public.record_paystack_partner_split_attempt(p_reference text, p_order_id uuid, p_brand_id uuid, p_partner_account_id uuid, p_mingla_fee_cents integer, p_partner_share_cents integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_partner_split_attempt(p_reference text, p_order_id uuid, p_brand_id uuid, p_partner_account_id uuid, p_mingla_fee_cents integer, p_partner_share_cents integer) TO service_role;

-- 11 truncate_seed_map_presence (destructive TRUNCATE)
REVOKE EXECUTE ON FUNCTION public.truncate_seed_map_presence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.truncate_seed_map_presence() TO service_role;

-- 12 cron_refresh_admin_place_pool_mv (REFRESH MATVIEW; cron)
REVOKE EXECUTE ON FUNCTION public.cron_refresh_admin_place_pool_mv() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_refresh_admin_place_pool_mv() TO service_role;

-- 13 tg_kick_pending_trial_runs (worker kicker; net.http_post)
REVOKE EXECUTE ON FUNCTION public.tg_kick_pending_trial_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_kick_pending_trial_runs() TO service_role;

-- 14 tg_kick_pending_thumb_backfill (worker kicker; net.http_post)
REVOKE EXECUTE ON FUNCTION public.tg_kick_pending_thumb_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_kick_pending_thumb_backfill() TO service_role;

-- 15 tg_meta_orch_1009_sub_d_kick_rescores (worker kicker; net.http_post)
REVOKE EXECUTE ON FUNCTION public.tg_meta_orch_1009_sub_d_kick_rescores() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_meta_orch_1009_sub_d_kick_rescores() TO service_role;

-- 16 expire_agent_pending_actions (internal maintenance)
REVOKE EXECUTE ON FUNCTION public.expire_agent_pending_actions(p_now timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_agent_pending_actions(p_now timestamp with time zone) TO service_role;

-- 17 pg_topup_recurring_experiences (internal generator)
REVOKE EXECUTE ON FUNCTION public.pg_topup_recurring_experiences(p_floor integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_topup_recurring_experiences(p_floor integer) TO service_role;

-- 18 pg_expand_experience_recurrence (internal generator)
REVOKE EXECUTE ON FUNCTION public.pg_expand_experience_recurrence(p_event_id uuid, p_master_start timestamp with time zone, p_master_end timestamp with time zone, p_rule jsonb, p_timezone text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_expand_experience_recurrence(p_event_id uuid, p_master_start timestamp with time zone, p_master_end timestamp with time zone, p_rule jsonb, p_timezone text) TO service_role;

-- 19 pg_try_discover_cache_build_lock (internal lock)
REVOKE EXECUTE ON FUNCTION public.pg_try_discover_cache_build_lock(p_cache_key text, p_ttl_seconds integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_try_discover_cache_build_lock(p_cache_key text, p_ttl_seconds integer) TO service_role;

-- 20 pg_release_discover_cache_build_lock (internal lock)
REVOKE EXECUTE ON FUNCTION public.pg_release_discover_cache_build_lock(p_cache_key text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_release_discover_cache_build_lock(p_cache_key text) TO service_role;

-- 21 record_trial_phone (internal; edge delete-user)
REVOKE EXECUTE ON FUNCTION public.record_trial_phone(p_phone text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_trial_phone(p_phone text) TO service_role;

-- 22 biz_ticket_scan (edge-only; scan-ticket edge fn)
REVOKE EXECUTE ON FUNCTION public.biz_ticket_scan(p_event_id uuid, p_qr_payload text, p_scanner_user_id uuid, p_qr_token_pepper text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(p_event_id uuid, p_qr_payload text, p_scanner_user_id uuid, p_qr_token_pepper text) TO service_role;

-- 23 add_buyer_to_event_chat (post-purchase server)
REVOKE EXECUTE ON FUNCTION public.add_buyer_to_event_chat(p_event_id uuid, p_buyer_user_id uuid, p_order_id uuid, p_buyer_email text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_buyer_to_event_chat(p_event_id uuid, p_buyer_user_id uuid, p_order_id uuid, p_buyer_email text) TO service_role;

-- ---- Group 2 — AUTHENTICATED (anon revoked; 18) ----------------------------
-- 24 fetch_user_going_rsvps (re-assert hot-patch + BODY GATE A-1; client read)
REVOKE EXECUTE ON FUNCTION public.fetch_user_going_rsvps(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fetch_user_going_rsvps(p_user_id uuid) TO authenticated, service_role;

-- 25 get_admin_emails (re-assert hot-patch + BODY GATE A-2; admin console)
REVOKE EXECUTE ON FUNCTION public.get_admin_emails() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_emails() TO authenticated, service_role;

-- 26 accept_invite_and_transfer_brand_ownership (re-assert hot-patch; client accept)
REVOKE EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership(p_token_hash text, p_accepting_account_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership(p_token_hash text, p_accepting_account_id uuid) TO authenticated, service_role;

-- 27 accept_scanner_invitation (re-assert hot-patch; client accept)
REVOKE EXECUTE ON FUNCTION public.accept_scanner_invitation(p_token_hash text, p_accepting_account_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_scanner_invitation(p_token_hash text, p_accepting_account_id uuid) TO authenticated, service_role;

-- 28 get_or_create_direct_conversation (client verb)
REVOKE EXECUTE ON FUNCTION public.get_or_create_direct_conversation(p_user1_id uuid, p_user2_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(p_user1_id uuid, p_user2_id uuid) TO authenticated, service_role;

-- 29 remove_participant_prefs (client verb)
REVOKE EXECUTE ON FUNCTION public.remove_participant_prefs(p_session_id uuid, p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_participant_prefs(p_session_id uuid, p_user_id uuid) TO authenticated, service_role;

-- 30 upsert_participant_prefs (client verb)
REVOKE EXECUTE ON FUNCTION public.upsert_participant_prefs(p_session_id uuid, p_user_id uuid, p_prefs jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_participant_prefs(p_session_id uuid, p_user_id uuid, p_prefs jsonb) TO authenticated, service_role;

-- 31 execute_undo_action (client verb)
REVOKE EXECUTE ON FUNCTION public.execute_undo_action(p_undo_id text, p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_undo_action(p_undo_id text, p_user_id uuid) TO authenticated, service_role;

-- 32 get_effective_tier (recon read)
REVOKE EXECUTE ON FUNCTION public.get_effective_tier(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_tier(p_user_id uuid) TO authenticated, service_role;

-- 33 derive_user_segment (recon read)
REVOKE EXECUTE ON FUNCTION public.derive_user_segment(p_profile_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.derive_user_segment(p_profile_id uuid) TO authenticated, service_role;

-- 34 get_undo_actions (recon read)
REVOKE EXECUTE ON FUNCTION public.get_undo_actions(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_undo_actions(p_user_id uuid) TO authenticated, service_role;

-- 35 get_muted_user_ids (recon read)
REVOKE EXECUTE ON FUNCTION public.get_muted_user_ids(user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_muted_user_ids(user_id uuid) TO authenticated, service_role;

-- 36 admin_city_pipeline_status (recon read; OQ-3 body gate = fast-follow)
REVOKE EXECUTE ON FUNCTION public.admin_city_pipeline_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_city_pipeline_status() TO authenticated, service_role;

-- 37 admin_city_place_stats (recon read; OQ-3 body gate = fast-follow)
REVOKE EXECUTE ON FUNCTION public.admin_city_place_stats(p_city_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_city_place_stats(p_city_id uuid) TO authenticated, service_role;

-- 38 phone_has_used_trial (recon read)
REVOKE EXECUTE ON FUNCTION public.phone_has_used_trial(p_phone text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_has_used_trial(p_phone text) TO authenticated, service_role;

-- 39 has_recent_report (recon read)
REVOKE EXECUTE ON FUNCTION public.has_recent_report(reporter uuid, reported uuid, hours_window integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_recent_report(reporter uuid, reported uuid, hours_window integer) TO authenticated, service_role;

-- 40 is_admin_email (recon predicate)
REVOKE EXECUTE ON FUNCTION public.is_admin_email(p_email text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_email(p_email text) TO authenticated, service_role;

-- 41 check_invited_admin (invite predicate)
REVOKE EXECUTE ON FUNCTION public.check_invited_admin(p_email text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_invited_admin(p_email text) TO authenticated, service_role;

-- ============================================================================
-- SECTION B2 — §4.2 MISSED-LEAKER REMEDIATION (4 functions).
-- ----------------------------------------------------------------------------
-- IMPLEMENTOR-PROPOSED SPEC AMENDMENT — ratify at REVIEW.
-- SPEC §4.2 mandates: a probe-output signature that fits NONE of {intended-
-- public, internally-gated, RLS predicate helper, PostGIS} AND is not in the 41
-- is a MISSED LEAKER — "escalate for a SPEC amendment rather than allowlisting
-- it." The IMPLEMENT-phase CI-probe surfaced 4 anon-executable SECURITY DEFINER
-- functions that are the EXACT same class as functions already in the 41
-- (unguarded mutation / worker-kicker) but were absent from the investigation's
-- F-5 list and the SPEC's 41 (F-6 explicitly warned the gate heuristic misses
-- http-only + aliased side-effects). They CANNOT be allowlisted (they are true
-- leaks), so the durable-fix migration revokes anon here rather than ship a
-- red gate. Caller-compat verified by grep (see IMPLEMENTATION report §12):
--   * cleanup_expired_undo_actions / cleanup_stale_push_tokens /
--     tg_meta_orch_1009_sub_d_quarterly_sweep — NO client caller (backend/cron
--     only) -> service_role only.
--   * recalculate_user_level — sole client caller (userLevelService.ts:23,
--     authenticated, passes its own id) + edge upsert-leaderboard-presence
--     (service_role) -> authenticated (anon revoked), Group-2 class.
-- If REVIEW rejects this amendment, delete this Section B2, its 4 DO-block
-- asserts, the 4 allowlist lines, and the 4 static-test entries.
-- ============================================================================

-- B2-1 cleanup_expired_undo_actions (unguarded DELETE; backend/cron) -> service_role
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_undo_actions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_undo_actions() TO service_role;

-- B2-2 cleanup_stale_push_tokens (unguarded DELETE; backend/cron) -> service_role
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_push_tokens() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_push_tokens() TO service_role;

-- B2-3 tg_meta_orch_1009_sub_d_quarterly_sweep (http-only worker kicker; sibling
--      of #15) -> service_role
REVOKE EXECUTE ON FUNCTION public.tg_meta_orch_1009_sub_d_quarterly_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_meta_orch_1009_sub_d_quarterly_sweep() TO service_role;

-- B2-4 recalculate_user_level (unguarded upsert of any user's level; authed client) -> authenticated
REVOKE EXECUTE ON FUNCTION public.recalculate_user_level(target_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_user_level(target_user_id uuid) TO authenticated, service_role;

-- ============================================================================
-- SECTION C — post-apply asserts (fail-closed; rolls back on any wrong ACL).
-- Uses TYPE-ONLY signatures (has_function_privilege / regprocedure rejects
-- argument names). Mirrors the ORCH-1384 20270103000000 DO-block-assert shape.
-- ============================================================================
DO $$
DECLARE
  svc_only text[] := ARRAY[
    -- Group 1 (23)
    'public.biz_refund_order_commit_from_webhook(uuid, text, integer, character, integer, text)',
    'public.finalize_rsvp_contribution(uuid, text, text, text)',
    'public.anonymize_user_audit_log(uuid, text)',
    'public.mark_partner_split_transferred(text, text)',
    'public.mark_partner_split_reversed(text, text)',
    'public.mark_partner_split_failed(text, text, text)',
    'public.bump_paystack_partner_split_attempt(text, text)',
    'public.mark_paystack_partner_split_attempted(text, text, text)',
    'public.record_partner_split_attempt(text, uuid, uuid, uuid, integer, integer, text)',
    'public.record_paystack_partner_split_attempt(text, uuid, uuid, uuid, integer, integer)',
    'public.truncate_seed_map_presence()',
    'public.cron_refresh_admin_place_pool_mv()',
    'public.tg_kick_pending_trial_runs()',
    'public.tg_kick_pending_thumb_backfill()',
    'public.tg_meta_orch_1009_sub_d_kick_rescores()',
    'public.expire_agent_pending_actions(timestamp with time zone)',
    'public.pg_topup_recurring_experiences(integer)',
    'public.pg_expand_experience_recurrence(uuid, timestamp with time zone, timestamp with time zone, jsonb, text)',
    'public.pg_try_discover_cache_build_lock(text, integer)',
    'public.pg_release_discover_cache_build_lock(text)',
    'public.record_trial_phone(text)',
    'public.biz_ticket_scan(uuid, text, uuid, text)',
    'public.add_buyer_to_event_chat(uuid, uuid, uuid, text)',
    -- Section B2 svc-only (3)
    'public.cleanup_expired_undo_actions()',
    'public.cleanup_stale_push_tokens()',
    'public.tg_meta_orch_1009_sub_d_quarterly_sweep()'
  ];
  authed text[] := ARRAY[
    -- Group 2 (18)
    'public.fetch_user_going_rsvps(uuid)',
    'public.get_admin_emails()',
    'public.accept_invite_and_transfer_brand_ownership(text, uuid)',
    'public.accept_scanner_invitation(text, uuid)',
    'public.get_or_create_direct_conversation(uuid, uuid)',
    'public.remove_participant_prefs(uuid, uuid)',
    'public.upsert_participant_prefs(uuid, uuid, jsonb)',
    'public.execute_undo_action(text, uuid)',
    'public.get_effective_tier(uuid)',
    'public.derive_user_segment(uuid)',
    'public.get_undo_actions(uuid)',
    'public.get_muted_user_ids(uuid)',
    'public.admin_city_pipeline_status()',
    'public.admin_city_place_stats(uuid)',
    'public.phone_has_used_trial(text)',
    'public.has_recent_report(uuid, uuid, integer)',
    'public.is_admin_email(text)',
    'public.check_invited_admin(text)',
    -- Section B2 authenticated (1)
    'public.recalculate_user_level(uuid)'
  ];
  s text;
BEGIN
  FOREACH s IN ARRAY svc_only LOOP
    IF has_function_privilege('anon', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1392 assert FAILED: anon can EXECUTE % (expected service_role only)', s;
    END IF;
    IF has_function_privilege('authenticated', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1392 assert FAILED: authenticated can EXECUTE % (expected service_role only)', s;
    END IF;
    IF NOT has_function_privilege('service_role', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1392 assert FAILED: service_role CANNOT EXECUTE % (expected true)', s;
    END IF;
  END LOOP;

  FOREACH s IN ARRAY authed LOOP
    IF has_function_privilege('anon', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1392 assert FAILED: anon can EXECUTE % (expected authenticated)', s;
    END IF;
    IF NOT has_function_privilege('authenticated', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1392 assert FAILED: authenticated CANNOT EXECUTE % (expected true)', s;
    END IF;
    IF NOT has_function_privilege('service_role', s, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1392 assert FAILED: service_role CANNOT EXECUTE % (expected true)', s;
    END IF;
  END LOOP;

  RAISE NOTICE 'ORCH-1392: all 45 grant end-states asserted (26 service_role-only, 19 authenticated).';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
