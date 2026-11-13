-- Issue #4423 Wave 5: function EXECUTE grants.
--
-- 43 SECURITY DEFINER functions that no client calls lose EXECUTE for
-- PUBLIC, anon and authenticated. service_role and the owner keep it, so
-- edge functions, cron and the definer functions that call these still work.
--
-- A function stays callable when its name appears anywhere in app-mobile,
-- mingla-business, mingla-admin, mingla-marketing, mingla-site-cms,
-- mingla-sites, packages, backend, tools, scripts, tests, .github or
-- supabase/functions (dynamic rpc name prefixes included), in any policy,
-- view, default, check, trigger or index expression, in the body of any
-- SECURITY INVOKER function, in an in-flight branch, in the last 30 days of
-- REST calls, or in the allowlist's intended-public section. Mingla Sites
-- functions are left to their own lane (#3381), and so is any function an
-- existing suite exercises as anon or authenticated.
-- Rollback: GRANT EXECUTE ON FUNCTION <same signature> TO anon, authenticated
-- (and PUBLIC where it had it).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_analytics_engagement(p_days integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_funnel() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_geo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_growth(p_days integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_retention(p_weeks integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_deactivate_places(p_place_ids uuid[], p_reason text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_card_generation_active(p_city text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_card_generation_status(p_run_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_explorer_app_leads_list() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_stale_places(p_filter text, p_sort_by text, p_page integer, p_page_size integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_place_pool_city_list(p_country text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_place_pool_country_list() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_pool_category_health(p_country text, p_city text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reactivate_place(p_place_id uuid, p_reason text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rule_detail(p_rule_set_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rule_set_diff(p_version_a uuid, p_version_b uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rule_set_versions(p_rule_set_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_export() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_list(p_scope_filter text, p_kind_filter text, p_search text, p_show_only_never_fired boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_overview() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_preview_impact(p_rule_set_id uuid, p_proposed_entries text[], p_proposed_thresholds jsonb, p_city_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_rollback(p_rule_set_id uuid, p_target_version_id uuid, p_reason text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_run_affected_places(p_job_id uuid, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_run_detail(p_job_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_run_diff(p_job_a uuid, p_job_b uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_rules_runs(p_city_id uuid, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_trip_place(p_event_id uuid, p_side text, p_city text, p_country_code text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_uncategorized_places(p_country text, p_city text, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_virtual_tile_intelligence(p_country text, p_city text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ari_admin_quality_cases(p_status text, p_severity text, p_limit integer, p_before timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ari_admin_quality_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.biz_can_manage_orders_for_event(p_event_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.biz_can_read_order(p_order_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.biz_guest_roster_detail(p_event_id uuid, p_roster_key text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.business_move_event_date_time(p_event_id uuid, p_event_date_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_reason text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_muted_by(muter uuid, target uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_3720_community_comments(p_post_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_3720_is_host_community_member(p_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_4382_customer_can_view_conversation(p_conversation_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_4382_source_reporter_count(p_source_kind text, p_source_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_advisory_lock_rules_run(p_lock_key bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_force_deck_recycle(p_session_id uuid, p_exclude_place_ids uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_advisory_lock_rules_run(p_lock_key bigint) FROM PUBLIC, anon, authenticated;

COMMIT;
