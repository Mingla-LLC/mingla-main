-- ===========================================================================
-- Issue #1856 — revoke TRUNCATE on the four ordering tables, and ship the
-- STANDING GUARD for the whole grant class.
--
-- THE GAP (verified on production, read-only, 2026-08-11):
--
--   menu_modifier_groups        anon=none  authenticated=TRUNCATE  <-- wipeable
--   menu_modifiers              anon=none  authenticated=TRUNCATE  <-- wipeable
--   qr_spots                    anon=none  authenticated=TRUNCATE  <-- wipeable
--   venue_ordering_settings     anon=none  authenticated=TRUNCATE  <-- wipeable
--   (the five venue_order_* tables are already clean — #1819 fixed those)
--
--   RLS DOES NOT GATE TRUNCATE. It is a table-level privilege and is never
--   row-filtered, so every one of those policies — all of them correct, all of
--   them brand-scoped — is irrelevant to it. Any signed-in Mingla user, member
--   of no brand at all, held the right to empty every venue's QR spots, every
--   menu modifier group and every venue's ordering settings PLATFORM-WIDE.
--
--   Destroying `qr_spots` is the one that cannot be undone by a restore alone:
--   the `code` column IS the printed QR laminated onto the furniture, and it
--   is server-minted and immutable. A venue that loses its spots has to
--   REPRINT ITS ENTIRE FLOOR.
--
--   Not reachable through PostgREST today (it exposes no TRUNCATE verb), which
--   is the only reason this is HIGH and not critical — the same reasoning
--   #1819 applied to the order tables. It is one direct connection, or one RPC
--   that forwards a table name, away from catastrophic.
--
-- WHY THE PRIVILEGE WAS THERE AT ALL, AND WHY THREE REVIEWS MISSED IT:
--
--   Supabase projects ship
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--       GRANT ALL ON TABLES TO anon, authenticated, service_role;
--   (this repo carries it verbatim at
--    20260505000000_baseline_squash_orch_0729.sql:18606-18609). Every table a
--   migration creates therefore arrives holding ALL EIGHT table privileges for
--   anon and authenticated — SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--   REFERENCES, TRIGGER and, on PG17, MAINTAIN — before a single GRANT is
--   written.
--
--   A migration that then writes `GRANT SELECT, INSERT, UPDATE, DELETE ...`
--   looks, in review, exactly like a table whose privileges were chosen. The
--   grant that matters was never written by any line of source, so there is
--   nothing for a reviewer to see and nothing for a grep to match. #1789 did
--   `REVOKE ALL ... FROM anon` on all four of these tables — correctly — and
--   left `authenticated` holding the raw default. Three reviews later it was
--   still there.
--
--   This is the THIRD appearance of the class: #1819 (tester, five order
--   tables), #1790 (implementor, six SECURITY DEFINER functions), and now the
--   orchestrator here. Each time on tables created by a different phase. Each
--   time after review. That is why the second half of this file matters more
--   than the first.
--
-- APPLY VIA THE MANAGEMENT-API LANE FROM MERGED MAIN. Never `supabase db push`.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- PART 1 — THE REVOKES.
--
-- REVOKE-then-GRANT, in that order, exactly as #1819 did: the end state is the
-- intended SET, not "the default set minus whatever was thought of". This also
-- removes MAINTAIN without naming it — a PG17 privilege that
-- `information_schema.role_table_grants` cannot even report, so nobody
-- auditing through information_schema would ever have seen it.
--
-- PUBLIC is named alongside anon and authenticated because a grant to PUBLIC
-- reaches both of them and is invisible in a per-role audit.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- qr_spots — KEEP SELECT, INSERT, UPDATE, DELETE for `authenticated`.
--
--   SELECT  : mingla-business/src/hooks/useQrSpots.ts:75 (fetchQrSpots) is a
--             direct PostgREST read. Removing it blanks the Spots screen.
--   UPDATE  : useQrSpots.ts:158 (useUpdateQrSpot) is a direct PostgREST write —
--             label, is_active, serving_venue_id, serving_menu_id, sort_order.
--   INSERT,
--   DELETE  : the "qr_spots manager plus can write" policy is FOR ALL, and the
--             spot inventory is operator-owned (D-3: the venue never manages
--             two lists). Both stay so the RLS contract and the ACL agree; RLS
--             is what gates them, and it gates them per brand at rank
--             event_manager or above.
--
-- TRUNCATE / REFERENCES / TRIGGER / MAINTAIN: no client path has ever used any
-- of them, and RLS gates none of them.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.qr_spots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_spots TO authenticated;

-- ---------------------------------------------------------------------------
-- menu_modifier_groups / menu_modifiers — KEEP SELECT, INSERT, UPDATE, DELETE
-- for `authenticated`. Both are edited straight through PostgREST:
--   SELECT          : useMenuModifiers.ts:85 and :99 (fetchMenuModifierGroups),
--                     and useVenueOrderPad.ts:151/:163 for the waiter pad.
--   INSERT / UPDATE : useMenuModifiers.ts:205 and :231 — `.upsert(...)`, which
--                     is INSERT ... ON CONFLICT and needs BOTH.
--   DELETE          : useMenuModifiers.ts:238 (prune the removed options) and
--                     :267 (useDeleteModifierGroup).
-- Same reasoning as above for the four that go.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.menu_modifier_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifier_groups TO authenticated;

REVOKE ALL ON public.menu_modifiers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifiers TO authenticated;

-- ---------------------------------------------------------------------------
-- venue_ordering_settings — KEEP SELECT AND ONLY SELECT for `authenticated`.
--
--   SELECT : mingla-business/src/hooks/useVenueOrderingSettings.ts:85 is a
--            direct PostgREST read, and it is what decides whether the venue
--            sees an Orders queue at all. #1846 already proved how easy this
--            one is to get wrong in the other direction — dropping the read
--            breaks the surface SILENTLY, with no error anywhere.
--   INSERT / UPDATE / DELETE were already revoked by #1846 (ruling OQ-7: the
--   ordering switch is an edge-function decision, never a client write). The
--   table was still carrying REFERENCES, TRIGGER, TRUNCATE and MAINTAIN from
--   the default grant, because #1846 named the three verbs it cared about
--   instead of revoking ALL and re-granting.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.venue_ordering_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_ordering_settings TO authenticated;

-- service_role is re-stated so the intended end state reads in one place.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_spots                TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifier_groups    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_modifiers          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_ordering_settings TO service_role;

COMMENT ON TABLE public.qr_spots IS
  'SPEC #1788 P-7 — the brand''s orderable-spot inventory; `code` IS the '
  'printed QR. authenticated holds SELECT/INSERT/UPDATE/DELETE and NOTHING '
  'else as of #1856: TRUNCATE is not gated by RLS, and truncating this table '
  'invalidates every printed code a venue has laminated onto its furniture.';

COMMENT ON TABLE public.venue_ordering_settings IS
  'SPEC #1788 — per-venue ordering switch and service charge. authenticated '
  'holds SELECT ONLY: writes are the venue-order-staff edge function (ruling '
  'OQ-7, #1846), and TRUNCATE/REFERENCES/TRIGGER/MAINTAIN were revoked by '
  '#1856. The SELECT is load-bearing — it is what decides whether the venue '
  'sees an Orders queue, and removing it fails silently.';

-- ===========================================================================
-- PART 2 — THE STANDING GUARD. This is the half that matters.
--
-- THE RULE
--   In schema `public`:
--     * a BASE TABLE may hold NO privilege at all for `anon` or for `PUBLIC`;
--     * nothing — table, view or materialized view — may hold any privilege
--       beyond SELECT for `anon`, `authenticated` or `PUBLIC`;
--   unless the exact (relation, grantee, privilege) triple is on the ALLOWLIST
--   below with a stated reason, or the (relation, grantee) pair is on the
--   frozen BASELINE recorded on 2026-08-11.
--
--   SELECT on a VIEW is deliberately not an offence: a `*_public_view` granted
--   SELECT to anon IS the public read surface, and flagging it would bury the
--   signal. SELECT on a BASE TABLE for anon IS an offence — an anonymous read
--   belongs behind a view or a SECURITY DEFINER RPC, where the column list is
--   chosen instead of inherited.
--
-- WHY IT READS THE CATALOG AND NOT SOURCE TEXT
--   The whole class is defined by a grant that NO SOURCE LINE EVER WROTE. It
--   is produced by `ALTER DEFAULT PRIVILEGES` at CREATE TABLE time. There is
--   nothing in supabase/migrations for a reviewer to notice, nothing for a
--   grep to match, and — this is the part that got it past three reviews — the
--   migration that creates the table reads as though its privileges were
--   chosen, because it does contain GRANT lines. They are simply not the whole
--   ACL. Only the catalog knows the whole ACL.
--
-- WHY `pg_class.relacl` + `aclexplode()` AND NOT `information_schema`
--   1. information_schema.role_table_grants IS ROLE-FILTERED. Its definition
--      restricts rows to those whose grantor or grantee is a CURRENTLY ENABLED
--      role. Called as `service_role`, it would return NOTHING about anon or
--      authenticated — a guard that is silently blind is worse than no guard.
--      pg_class.relacl is world-readable and shows every entry to every caller.
--   2. information_schema IS BLIND TO `MAINTAIN`. The SQL standard has no such
--      privilege, so PG17's MAINTAIN never appears there. Production holds it
--      for anon on 248 tables and for authenticated on 258 — an entire
--      privilege that an information_schema audit reports as absent.
--   3. It reports grants to PUBLIC (grantee OID 0), which a per-role query
--      misses entirely even though PUBLIC reaches anon and authenticated.
--   `has_table_privilege()` answers the EFFECTIVE question and is used as the
--   independent cross-check in the CI suite; the two must agree.
--
-- WHY A BASELINE AND NOT A BIGGER ALLOWLIST
--   On 2026-08-11 the live schema had 272 relations in `public` carrying the
--   raw Supabase default grants — 3452 offending (relation, grantee,
--   privilege) rows. That is the class at full size, and it is a BACKLOG, not
--   noise. Widening the allowlist to swallow it would convert the finding into
--   a permanent blessing. Instead the set is FROZEN below: the gate asserts
--   NO NEW OFFENDER beyond it, so the class cannot grow by one row while the
--   backlog is worked, and every entry removed from the baseline is a
--   permanent one-way ratchet.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.audit_overbroad_table_grants()
RETURNS TABLE (
  relation_name  text,
  relation_kind  text,
  grantee        text,
  privilege_type text,
  is_baselined   boolean,
  remediation    text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $issue_1856_guard$
  WITH rel AS (
    SELECT
      c.relname::text AS relname,
      c.relkind,
      CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
      END AS kind,
      c.relacl
    FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND c.relacl IS NOT NULL
  ),
  held AS (
    SELECT
      r.relname,
      r.relkind,
      r.kind,
      CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
      a.privilege_type::text AS privilege_type
    FROM rel r
    CROSS JOIN LATERAL pg_catalog.aclexplode(r.relacl) AS a
    WHERE a.grantee = 0
       OR a.grantee::regrole::text IN ('anon', 'authenticated')
  ),
  offending AS (
    SELECT h.*
    FROM held h
    WHERE (h.relkind IN ('r', 'p') AND h.grantee IN ('anon', 'PUBLIC'))
       OR h.privilege_type <> 'SELECT'
  ),
  -- -------------------------------------------------------------------------
  -- ALLOWLIST — (relation, grantee, privilege) triples that are DELIBERATE.
  -- Every row states why. Nothing goes here to make CI green; a pre-existing
  -- offender belongs in the baseline below, where it stays visible as a
  -- finding.
  -- -------------------------------------------------------------------------
  allowlist (relation_name, grantee, privilege_type, reason) AS (
    VALUES
      -- The three ordering tables #1856 keeps writable. All three are edited
      -- directly through PostgREST by mingla-business under the
      -- "manager plus can write" RLS policy (rank >= event_manager, brand
      -- scoped). Verified live client paths, not assumed:
      --   qr_spots             useQrSpots.ts:158            (UPDATE)
      --   menu_modifier_groups useMenuModifiers.ts:205,:267 (upsert, delete)
      --   menu_modifiers       useMenuModifiers.ts:231,:238 (upsert, delete)
      -- TRUNCATE is NOT here, and never can be: nothing in the product has
      -- ever needed it, and RLS cannot gate it.
      ('qr_spots',             'authenticated', 'INSERT', 'spot inventory is operator-owned; FOR ALL policy at rank >= event_manager'),
      ('qr_spots',             'authenticated', 'UPDATE', 'useQrSpots.ts:158 useUpdateQrSpot writes label/is_active/serving_*/sort_order'),
      ('qr_spots',             'authenticated', 'DELETE', 'spot inventory is operator-owned; FOR ALL policy at rank >= event_manager'),
      ('menu_modifier_groups', 'authenticated', 'INSERT', 'useMenuModifiers.ts:205 upsert = INSERT ... ON CONFLICT'),
      ('menu_modifier_groups', 'authenticated', 'UPDATE', 'useMenuModifiers.ts:205 upsert = INSERT ... ON CONFLICT'),
      ('menu_modifier_groups', 'authenticated', 'DELETE', 'useMenuModifiers.ts:267 useDeleteModifierGroup'),
      ('menu_modifiers',       'authenticated', 'INSERT', 'useMenuModifiers.ts:231 upsert = INSERT ... ON CONFLICT'),
      ('menu_modifiers',       'authenticated', 'UPDATE', 'useMenuModifiers.ts:231 upsert = INSERT ... ON CONFLICT'),
      ('menu_modifiers',       'authenticated', 'DELETE', 'useMenuModifiers.ts:238 prunes the options the operator removed')
  ),
  -- -------------------------------------------------------------------------
  -- BASELINE — the pre-existing offenders, FROZEN as of 2026-08-11 from the
  -- live production catalog. These are FINDINGS AWAITING TRIAGE, not
  -- exceptions: `is_baselined` marks them so CI can red on anything NEW while
  -- `SELECT * FROM public.audit_overbroad_table_grants() WHERE is_baselined`
  -- stays the standing worklist.
  --
  -- The anon-side set is a SUBSET of the authenticated-side set (verified on
  -- production: zero relations offend for anon but not for authenticated), so
  -- the shared 263 are listed once and the authenticated side adds its 6.
  -- -------------------------------------------------------------------------
  baseline_shared (relation_name) AS (
    SELECT unnest(ARRAY[
    '_archive_card_pool', '_archive_card_pool_stops',
    '_archive_orch_0700_doomed_columns',
    '_archive_orch_0734_signal_anchors', '_backup_friends',
    '_backup_messages', '_backup_profiles', '_backup_user_sessions',
    '_deprecated_profiles_is_admin_backup', '_orch_0588_dead_cards_backup',
    '_orch_0588_dead_stops_backup', 'account_deletion_requests',
    'activity_history', 'ad_attribution_touches', 'ad_campaigns',
    'ad_connections', 'ad_conversions', 'ad_creative_platform_refs',
    'ad_creatives', 'ad_public_stay_destinations_view', 'ad_sets',
    'ad_status_events', 'admin_audit_log', 'admin_backfill_log',
    'admin_backfill_log_archive_orch_0671', 'admin_config',
    'admin_email_log', 'admin_subscription_overrides', 'admin_users', 'ads',
    'agent_conversations', 'agent_messages', 'agent_pending_actions',
    'agent_user_profile', 'api_health_alert_state', 'api_health_checks',
    'api_health_meta', 'api_health_observations', 'api_health_services',
    'app_config', 'app_feedback', 'appsflyer_devices', 'archived_holidays',
    'audit_log', 'beta_access_leads', 'beta_feedback', 'blocked_users',
    'board_card_message_reads', 'board_card_messages', 'board_card_rsvps',
    'board_cards', 'board_collaborators', 'board_message_reactions',
    'board_message_reads', 'board_messages', 'board_participant_presence',
    'board_saved_cards', 'board_threads', 'board_typing_indicators',
    'board_user_swipe_states', 'board_votes', 'boards',
    'brand_appsflyer_milestones', 'brand_hours', 'brand_invitations',
    'brand_payout_releases', 'brand_paystack_recipients',
    'brand_place_pipeline_state', 'brand_team_members', 'brands',
    'brands_public_view', 'business_management_events_view',
    'business_public_brands_view', 'business_public_events_view',
    'calendar_entries', 'card_generation_runs', 'category_type_exclusions',
    'channel_suppressions', 'claimed_venues_public_view',
    'collaboration_invites', 'collaboration_sessions', 'consent_records',
    'conversation_participants', 'conversation_presence', 'conversations',
    'country_vat_config', 'creator_accounts', 'curated_places_cache',
    'curated_teaser_cache', 'custom_holidays', 'direct_message_reactions',
    'discover_daily_cache', 'discover_merged_build_locks',
    'discover_merged_events_cache', 'door_sales_ledger', 'email_templates',
    'engagement_metrics', 'event_cover_video_jobs', 'event_dates',
    'event_rsvp_contributions', 'event_rsvp_guests', 'event_rsvps',
    'event_scanners', 'events', 'events_public_view',
    'events_with_master_date_view', 'experience_edit_log',
    'experience_feedback', 'experience_stops', 'explorer_app_leads',
    'feature_flags', 'friend_requests', 'friends', 'gdpr_erasure_log',
    'geography_columns', 'geometry_columns', 'integrations',
    'job_applications', 'job_postings', 'leaderboard_presence',
    'manual_buyer_reminders', 'marketing_audiences', 'marketing_campaigns',
    'marketing_clicks', 'marketing_messages', 'marketing_templates',
    'marketing_unsubscribes', 'match_telemetry_events', 'menu_items',
    'menus', 'message_reads', 'messages', 'mingla_revenue_log',
    'muted_users', 'notification_categories', 'notification_channel_prefs',
    'notification_deliveries', 'notification_outbox',
    'notification_preferences', 'notifications', 'order_installments',
    'order_line_items', 'orders', 'organiser_payout_debts',
    'organisers_public_view', 'pair_requests', 'pairings',
    'partner_brand_links', 'partner_paystack_accounts', 'partner_splits',
    'partner_stripe_connect_accounts', 'payment_webhook_events',
    'payout_debt_applications', 'payout_debt_events',
    'payout_ledger_adjustments', 'payout_release_alert_outbox',
    'payout_release_items', 'payout_source_fee_snapshots',
    'payout_transfer_legs', 'payouts', 'pending_invites',
    'pending_pair_invites', 'pending_session_invites',
    'pending_trip_chat_claims', 'person_card_impressions',
    'photo_aesthetic_batches', 'photo_aesthetic_labels',
    'photo_aesthetic_runs', 'photo_backfill_batches', 'photo_backfill_runs',
    'place_admin_actions', 'place_external_reviews',
    'place_intelligence_runs', 'place_intelligence_trial_runs',
    'place_pool', 'place_reviews', 'place_scores',
    'platform_pricing_config', 'preference_history', 'preferences',
    'profiles', 'profiles_with_segment', 'public_menus_view',
    'referral_credits', 'refresh_batches', 'refresh_runs',
    'refund_line_items', 'refunds', 'reservation_checkout_sessions',
    'reservations', 'rsvp_notifications', 'rule_entries',
    'rule_set_versions', 'rule_sets', 'rules_run_results', 'rules_runs',
    'rules_versions', 'saved_card', 'saved_people', 'scan_events',
    'scanner_invitations', 'scheduled_activities', 'seed_map_presence',
    'seeding_batches', 'seeding_cities', 'seeding_operations',
    'seeding_runs', 'seeding_tiles', 'session_curated_cache',
    'session_deck_cards', 'session_deck_versions', 'session_participants',
    'signal_definition_versions', 'signal_definitions', 'spatial_ref_sys',
    'stripe_connect_accounts', 'stripe_country_specs', 'stripe_disputes',
    'stripe_external_accounts', 'subscriptions', 'support_audit_log',
    'support_staff', 'support_tickets', 'tag_along_requests',
    'ticket_checkout_session_items', 'ticket_checkout_sessions',
    'ticket_order_notifications', 'ticket_types',
    'ticketmaster_events_cache', 'tickets', 'tool_competitors',
    'tool_leads', 'trip_days', 'trip_edit_log', 'trip_inclusions',
    'trip_intake_schemas', 'trip_pricing_tiers',
    'twilio_message_status_events', 'undo_actions', 'used_trial_phones',
    'user_activity', 'user_interactions', 'user_levels',
    'user_location_history', 'user_map_settings',
    'user_preference_learning', 'user_push_tokens', 'user_reports',
    'user_sessions', 'user_taste_matches', 'user_visits',
    'venue_availability_config', 'venue_blackouts', 'venue_capacity_rules',
    'venue_claim_active_feedback', 'venue_claim_feedback',
    'venue_public_view', 'venue_reservation_settings', 'venue_sms_log',
    'venue_sms_opt_out', 'venue_tables', 'venue_waitlist',
    'waitlist_entries'
    ]::text[])
  ),
  baseline (relation_name, grantee) AS (
    SELECT relation_name, 'anon'::text          FROM baseline_shared
    UNION ALL
    SELECT relation_name, 'authenticated'::text FROM baseline_shared
    UNION ALL
    -- Offend for `authenticated` only — anon was already revoked on these.
    SELECT unnest(ARRAY[
      'brand_follows', 'business_notification_type_preferences',
      'event_cancel_refund_progress', 'event_cancel_refund_runs',
      'payout_hold_cutover_migrations', 'venue_listings'
    ]::text[]), 'authenticated'::text
    UNION ALL
    -- PostGIS ships this one with SELECT to PUBLIC; every SRID lookup and
    -- ST_Transform reads it. Recorded, not blessed — Seth triages whether the
    -- PUBLIC grant should become an explicit anon/authenticated SELECT.
    SELECT 'spatial_ref_sys', 'PUBLIC'
  )
  SELECT
    o.relname,
    o.kind,
    o.grantee,
    o.privilege_type,
    EXISTS (
      SELECT 1 FROM baseline b
      WHERE b.relation_name = o.relname AND b.grantee = o.grantee
    )
    -- A baselined relation is grandfathered only for the privilege types that
    -- existed in Supabase's default set when the baseline was taken. A future
    -- PostgreSQL privilege type arriving by default grant is NEW, and reds.
    AND o.privilege_type IN (
      'SELECT', 'INSERT', 'UPDATE', 'DELETE',
      'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ),
    CASE
      WHEN o.grantee = 'PUBLIC' THEN
        'REVOKE ' || o.privilege_type || ' ON public.' || quote_ident(o.relname) || ' FROM PUBLIC;'
      WHEN o.relkind IN ('r', 'p') AND o.grantee = 'anon' THEN
        'REVOKE ALL ON public.' || quote_ident(o.relname) || ' FROM anon;'
      ELSE
        'REVOKE ' || o.privilege_type || ' ON public.' || quote_ident(o.relname) ||
        ' FROM ' || o.grantee || ';'
    END
  FROM offending o
  WHERE NOT EXISTS (
    SELECT 1 FROM allowlist w
    WHERE w.relation_name  = o.relname
      AND w.grantee        = o.grantee
      AND w.privilege_type = o.privilege_type
  )
  ORDER BY 1, 3, 4;
$issue_1856_guard$;

-- The guard itself is created in `public`, so it arrives holding EXECUTE for
-- anon and authenticated by the very default-privilege mechanism it exists to
-- police. Naming the roles is the only thing that removes it — the
-- FUNCTION-level twin of the lesson this whole file is about.
REVOKE EXECUTE ON FUNCTION public.audit_overbroad_table_grants()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_overbroad_table_grants()
TO service_role;

COMMENT ON FUNCTION public.audit_overbroad_table_grants() IS
  'Issue #1856 class guard. Lists every (relation, grantee, privilege) in '
  'schema `public` where anon/authenticated/PUBLIC hold more than the rule '
  'allows: nothing at all for anon or PUBLIC on a base table, nothing beyond '
  'SELECT for anyone anywhere. Reads pg_class.relacl via aclexplode() — the '
  'LIVE ACL — because the class is created by ALTER DEFAULT PRIVILEGES and no '
  'source line ever writes it. information_schema.role_table_grants is '
  'unusable here: it is role-filtered (blind when called as service_role) and '
  'has no concept of PG17 MAINTAIN. `WHERE NOT is_baselined` MUST be empty — '
  'that is the CI gate. `WHERE is_baselined` is the standing triage backlog '
  'frozen on 2026-08-11. Read-only.';

-- ===========================================================================
-- PART 3 — SELF-CHECK. This migration proves its own fix against the LIVE ACL,
-- because a REVOKE that did not work still looks exactly like a REVOKE.
--
-- The four-table assertion is HARD: if the revoke did not land, the apply
-- fails and nothing is stamped.
--
-- The class sweep is a WARNING, deliberately — same call #1828 made. CI is the
-- hard gate; here, an unrelated pre-existing offender on someone else's table
-- must never be able to abort this apply and leave TRUNCATE on qr_spots.
-- ===========================================================================
DO $issue_1856_selfcheck$
DECLARE
  v_tbl      text;
  v_priv     text;
  v_new      text;
  v_baselined int;
BEGIN
  -- 1  The four tables hold NOTHING for anon or PUBLIC, and none of the four
  --    never-wanted privileges for authenticated.
  FOREACH v_tbl IN ARRAY ARRAY[
    'qr_spots', 'menu_modifier_groups', 'menu_modifiers', 'venue_ordering_settings'
  ] LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'issue_1856 VACUITY: public.% does not exist', v_tbl;
    END IF;

    FOREACH v_priv IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF has_table_privilege('anon', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION 'issue_1856: anon still holds % on public.%', v_priv, v_tbl;
      END IF;
    END LOOP;

    FOREACH v_priv IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege('authenticated', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION
          'issue_1856: authenticated still holds % on public.% — RLS does not gate TRUNCATE',
          v_priv, v_tbl;
      END IF;
    END LOOP;

    -- Over-revoking is its own outage (#1846). Every one of the four is read
    -- through PostgREST by mingla-business; losing SELECT breaks the screen
    -- with no error anywhere.
    IF NOT has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION
        'issue_1856: authenticated LOST SELECT on public.% — the read path breaks silently',
        v_tbl;
    END IF;
  END LOOP;

  -- 2  The three operator-edited tables keep their write path; the settings
  --    table must NOT have regained one.
  FOREACH v_tbl IN ARRAY ARRAY['qr_spots', 'menu_modifier_groups', 'menu_modifiers'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('authenticated', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION
          'issue_1856: authenticated lost % on public.% — the operator can no longer edit it',
          v_priv, v_tbl;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('authenticated', 'public.venue_ordering_settings', v_priv) THEN
      RAISE EXCEPTION
        'issue_1856: authenticated regained % on venue_ordering_settings — ruling OQ-7 says the switch is service-role only',
        v_priv;
    END IF;
  END LOOP;

  -- 3  service_role still runs the rail.
  IF NOT has_table_privilege('service_role', 'public.qr_spots', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.venue_ordering_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'issue_1856: service_role cannot write the ordering tables';
  END IF;

  -- 4  The guard must actually see the class it was built for. If the frozen
  --    baseline matches nothing, the recorded set is wrong and every future
  --    "no new offenders" pass would be vacuous.
  SELECT count(*) INTO v_baselined
  FROM public.audit_overbroad_table_grants() WHERE is_baselined;
  IF v_baselined = 0 THEN
    RAISE WARNING 'issue_1856_baseline_matched_nothing — the frozen baseline may be stale for this database';
  END IF;

  -- 5  The class sweep. WARNING, not EXCEPTION: see the header.
  SELECT string_agg(
           relation_kind || ' ' || relation_name || ' -> ' || grantee ||
           ' holds ' || privilege_type || '   [' || remediation || ']',
           E'\n  ' ORDER BY relation_name, grantee, privilege_type)
    INTO v_new
  FROM public.audit_overbroad_table_grants()
  WHERE NOT is_baselined;

  IF v_new IS NOT NULL THEN
    RAISE WARNING 'issue_1856_new_overbroad_grants:%', E'\n  ' || v_new;
  END IF;
END $issue_1856_selfcheck$;

COMMIT;
