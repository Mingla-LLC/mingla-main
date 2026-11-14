-- Issue #4423 Wave 5: pin search_path on functions that ran with the
-- caller's search_path.
--
-- 140 functions get search_path = public, extensions, pg_temp: the path
-- they already resolve names against for API requests and cron, with
-- pg_temp moved last so a temporary object can never shadow a real one.
-- None of their bodies refers to an unqualified object outside public or
-- extensions.
--
-- Left as they are on purpose: 22 SECURITY INVOKER LANGUAGE sql helpers
-- (listing, pricing and category helpers on the public read paths). A SET
-- clause stops Postgres inlining a SQL function into the calling query, and
-- these run with the caller's own rights, so pinning would cost plan
-- quality for no change in what they can reach.
-- Rollback: ALTER FUNCTION <same signature> RESET search_path.

BEGIN;

ALTER FUNCTION public._issue_1767_serving_venue_belongs_to_brand() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public._orch1073_enforce_deleted_unservable() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public._orch1255_venue_belongs_to_brand() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.accept_pair_request_atomic(p_request_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.add_board_card() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_analytics_engagement(p_days integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_analytics_funnel() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_analytics_geo() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_analytics_growth(p_days integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_analytics_retention(p_weeks integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_card_generation_active(p_city text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_card_generation_status(p_run_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_clear_demo_data() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_clear_expired_caches() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_get_override_history(p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_grant_override(p_user_id uuid, p_tier text, p_reason text, p_granted_by uuid, p_starts_at timestamp with time zone, p_expires_at timestamp with time zone, p_duration_days integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_list_subscriptions(p_search text, p_tier_filter text, p_limit integer, p_offset integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_reset_inactive_sessions() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_revoke_override(p_override_id uuid, p_revoked_by uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rule_detail(p_rule_set_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rule_set_diff(p_version_a uuid, p_version_b uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rule_set_versions(p_rule_set_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_export() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_list(p_scope_filter text, p_kind_filter text, p_search text, p_show_only_never_fired boolean) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_overview() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_rollback(p_rule_set_id uuid, p_target_version_id uuid, p_reason text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_run_affected_places(p_job_id uuid, p_limit integer, p_offset integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_run_detail(p_job_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_run_diff(p_job_a uuid, p_job_b uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_runs(p_city_id uuid, p_limit integer, p_offset integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_rules_save(p_rule_set_id uuid, p_new_entries jsonb, p_change_summary text, p_new_thresholds jsonb) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_seed_demo_profiles() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_subscription_stats() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.admin_uncategorized_places(p_country text, p_city text, p_limit integer, p_offset integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.auto_generate_invite_info() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.auto_update_city_seeded_status() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.biz_enforce_event_has_master_date() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.biz_prevent_brand_account_id_change() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.biz_scanner_invitations_lower_email() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.cascade_friend_decline_to_collabs() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.check_card_lock_in() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.check_invited_admin(p_email text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.check_pairing_allowed(p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.check_session_creation_allowed(p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.cleanup_expired_undo_actions() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.compute_taste_match(p_user_a uuid, p_user_b uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.convert_pending_invites_on_phone_verified() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.convert_pending_pair_invites_on_phone_verified() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.create_preference_history() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.create_subscription_on_onboarding_complete() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.create_subscription_on_signup() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.enforce_session_creation_limit() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.execute_undo_action(p_undo_id text, p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_event_rsvp_contributions_touch_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_event_rsvps_touch_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.generate_invite_code() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.generate_referral_code() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_card_rsvp_counts(p_saved_card_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_effective_tier(p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_muted_user_ids(user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_or_create_direct_conversation(p_user1_id uuid, p_user2_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_place_count_per_city() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_saved_card_vote_counts(p_saved_card_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_seed_stats_per_city() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_session_member_limit(p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_tier_limits(p_tier text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_total_unread_card_messages_count(p_session_id uuid, p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_undo_actions(p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_unread_card_message_count(p_session_id uuid, p_saved_card_id uuid, p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_unread_message_count(p_session_id uuid, p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_user_frequent_locations(user_uuid uuid, limit_count integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.handle_user_blocked() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.has_block_between(user1 uuid, user2 uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.has_recent_report(reporter uuid, reported uuid, hours_window integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.increment_place_engagement(p_google_place_id text, p_field text, p_amount integer) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.increment_run_counters(p_run_id uuid, p_processed integer, p_succeeded integer, p_failed integer, p_cost numeric) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_admin_email(p_email text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_blocked_by(blocker uuid, target uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_conversation_participant(conv_id uuid, u_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_muted_by(muter uuid, target uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.is_username_available(p_username text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.issue_3872_contract_state_guard() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.issue_3872_immutable_row() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.jaccard(a text[], b text[]) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.lock_run_for_chunk(p_run_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.phone_has_used_trial(p_phone text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.record_trial_phone(p_phone text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.release_advisory_lock_rules_run(p_lock_key bigint) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.remove_participant_prefs(p_session_id uuid, p_user_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.reveal_pair_requests_on_friend_accept() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.sync_display_name() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.sync_message_read_status() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_ad_app_readiness_immutable() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_ad_engine_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_event_rsvps_show_me_as_going_owner_only() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_events_sync_departure_from_theme() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_issue_1365_menu_requires_venue() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_issue_1789_modifier_currency_matches_item() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_kick_pending_thumb_backfill() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_menu_items_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_menu_modifier_groups_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_menu_modifiers_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_menus_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_order_installments_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_orders_show_me_as_going_owner_only() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_orders_show_me_as_going_propagate() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_photo_aesthetic_labels_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_qr_spots_code_is_immutable() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_qr_spots_mint_code() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_qr_spots_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_refund_line_items_installment_parity() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_refunds_amount_immutable() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_reservation_checkout_sessions_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_reservations_bump_version() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_reservations_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_rule_entries_block_update() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_rule_set_versions_block_update() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_availability_config_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_blackouts_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_capacity_rules_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_listings_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_order_sessions_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_ordering_settings_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_orders_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_reservation_settings_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_tables_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.tg_venue_waitlist_set_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.truncate_seed_map_presence() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.try_advisory_lock_rules_run(p_lock_key bigint) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.unpair_atomic(p_pairing_id uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_conversation_on_message() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_conversation_presence_timestamp() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_notification_preferences_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_profiles_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_user_preferences_from_interaction() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_user_reports_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.upsert_participant_prefs(p_session_id uuid, p_user_id uuid, p_prefs jsonb) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.validate_refund_policy(p_policy jsonb) SET search_path = public, extensions, pg_temp;

COMMIT;
