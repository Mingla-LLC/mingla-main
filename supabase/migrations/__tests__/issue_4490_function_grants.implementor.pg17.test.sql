-- #4490 W3 fix round 1 (20280809459490): who may call every venue function. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-EVERY-FUNCTION-HAS-A-GRANT-DECISION | issue #4490 | every function a #4490 migration creates or re-emits is listed here in exactly one class (public read, signed-in, internal, invoker helper) and its anon and authenticated EXECUTE match that class; a new issue_4490_* function, or a new overload of a listed name, without a line here fails this suite.
--
-- Classes: public = anon and authenticated (and in the anon allowlist); signed_in = authenticated
-- only; internal = neither (database functions and the service role only); helper = SECURITY
-- INVOKER (runs with the caller's own rights; no grant assertion).
--
-- TEST-MOD-APPROVED #4490 (W3 fix 2): issue_4490_option_from_minor is gone; the "from" owner
-- issue_4490_offer_from, its slot read, the live-offers owner and the card's lean price read are internal, the three lifted price helpers are
-- invoker helpers.
--
-- TEST-MOD-APPROVED #4490 (06-W5): the two hosted deck wrappers (20280809460490) are internal
-- (service role only).
--
-- FAILS-ON-REVERT: without 20280809459490 G-2 fails (the ten internal functions keep the
-- schema's default anon and authenticated EXECUTE).
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t4490g_expected (sig text PRIMARY KEY, cls text NOT NULL
  CHECK (cls IN ('public', 'signed_in', 'internal', 'helper')));
INSERT INTO t4490g_expected (sig, cls) VALUES
  ('admin_list_venue_offers(text,text,integer,integer)', 'signed_in'),
  ('admin_venue_features(uuid)', 'signed_in'),
  ('assert_event_cover_selection_source(uuid,uuid,text,text,text,text,text)', 'internal'),
  ('biz_create_venue_listing(uuid,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,text,text)', 'signed_in'),
  ('biz_derive_service_periods_from_brand_hours(uuid)', 'signed_in'),
  ('biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)', 'signed_in'),
  ('biz_preview_venue_page(uuid)', 'signed_in'),
  ('biz_upsert_brand_hours(uuid,jsonb)', 'signed_in'),
  ('biz_venue_ordering_set_mode(uuid,text)', 'signed_in'),
  ('business_patch_event_taxonomy_with_place(uuid,text,text[],text[],text[],numeric,numeric,text,text,text)', 'internal'),
  ('business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)', 'signed_in'),
  ('business_publish_event_draft(uuid,jsonb,integer)', 'signed_in'),
  ('business_publish_rsvp_draft(uuid,jsonb,integer)', 'public'),
  ('claim_attendance_by_verified_identity(uuid)', 'internal'),
  ('correct_pending_venue_identity(uuid,uuid,uuid,timestamp with time zone,text,text,text,text,text,text,text,uuid,text,text,text,uuid)', 'signed_in'),
  ('issue_1387_assert_stay_row_integrity()', 'helper'),
  ('issue_1387_stay_inventory_snapshot(uuid)', 'signed_in'),
  ('issue_1388_assert_reservation_scope()', 'helper'),
  ('issue_1388_guard_immutable_rows()', 'helper'),
  ('issue_1388_guard_state_transition()', 'helper'),
  ('issue_1388_manage_request(text,uuid,bigint,text,uuid)', 'internal'),
  ('issue_1389_cancel_preview(uuid,uuid[],bigint,uuid)', 'signed_in'),
  ('issue_1389_cancel(uuid,text,text,text,uuid)', 'signed_in'),
  ('issue_1389_enqueue_stay_event()', 'internal'),
  ('issue_1389_finalize_payment(text,text,text,text,text,bigint,text,bigint,text)', 'internal'),
  ('issue_1389_line_start_at(uuid)', 'internal'),
  ('issue_1389_prepare_payment(uuid,text,bigint,uuid)', 'signed_in'),
  ('issue_1392_cancel_base(uuid,text,text,text,uuid)', 'internal'),
  ('issue_1392_cancel_preview_base(uuid,uuid[],bigint,uuid)', 'internal'),
  ('issue_1426_list_staff_stay_reservations(uuid)', 'signed_in'),
  ('issue_1426_manage_request(text,uuid,bigint,text,uuid)', 'signed_in'),
  ('issue_1426_staff_group_projection(uuid)', 'signed_in'),
  ('issue_1719_publish_experience_with_poster(uuid,jsonb,boolean)', 'signed_in'),
  ('issue_3281_apply_experience_price_options(uuid,text,text,integer,integer,jsonb,boolean)', 'internal'),
  ('issue_3281_apply_experience_r3_settings(uuid,jsonb)', 'internal'),
  ('issue_3281_ticket_type_slot_taken(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid)', 'internal'),
  ('issue_3386_identity_patch(venue_listings,text,text,text,text,text,double precision,double precision,text)', 'helper'),
  ('issue_4063_claim_subject(text,uuid)', 'internal'),
  ('issue_4188_cancel_preview(uuid,uuid[],bigint,uuid)', 'signed_in'),
  ('issue_4188_cancel(uuid,text,text,text,uuid)', 'signed_in'),
  ('issue_4188_guard_stay_group_source_truth()', 'helper'),
  ('issue_4188_has_venue_capability(uuid,uuid,text)', 'signed_in'),
  ('issue_4188_property_cancel_preview(uuid,uuid[],bigint,uuid)', 'internal'),
  ('issue_4188_property_cancel(uuid,text,text,text,uuid)', 'internal'),
  ('issue_4188_set_member_venue_grants(uuid,uuid,jsonb)', 'signed_in'),
  ('issue_4188_staff_stay_details(uuid)', 'signed_in'),
  ('issue_4473_share_purchases_by_verified_identity(uuid)', 'internal'),
  ('issue_4490_admin_booking(uuid)', 'signed_in'),
  ('issue_4490_admin_force_expire_hold(uuid,text)', 'signed_in'),
  ('issue_4490_admin_memberships(uuid)', 'signed_in'),
  ('issue_4490_admin_set_offer_status(uuid,text,text)', 'signed_in'),
  ('issue_4490_admit_guest_list(uuid,uuid,integer,uuid)', 'internal'),
  ('issue_4490_admit_member_by_code(uuid,text,integer,uuid)', 'internal'),
  ('issue_4490_admit_member(venue_listings,uuid,integer,uuid,text)', 'internal'),
  ('issue_4490_admit_pass(venue_listings,uuid,integer,boolean,uuid,text)', 'internal'),
  ('issue_4490_allocate_member_code(uuid)', 'internal'),
  ('issue_4490_apply_feature_preset(uuid,text,text)', 'signed_in'),
  ('issue_4490_apply_guest_list_sale(uuid)', 'internal'),
  ('issue_4490_apply_starting_features(uuid,text[],text)', 'signed_in'),
  ('issue_4490_arrange_spaces(uuid,jsonb,text)', 'signed_in'),
  ('issue_4490_assert_check_in(uuid,uuid)', 'internal'),
  ('issue_4490_assert_combination_parts()', 'helper'),
  ('issue_4490_assert_event_venue()', 'internal'),
  ('issue_4490_assert_feature_spaces()', 'helper'),
  ('issue_4490_assert_guest_list_entry()', 'internal'),
  ('issue_4490_assert_guest_list_terms()', 'internal'),
  ('issue_4490_assert_hire_capacity(uuid,uuid[],tstzrange)', 'internal'),
  ('issue_4490_assert_hours_windows()', 'helper'),
  ('issue_4490_assert_multi_day_offer()', 'internal'),
  ('issue_4490_assert_multi_day_option()', 'internal'),
  ('issue_4490_assert_offer_child_scope()', 'helper'),
  ('issue_4490_assert_offer_guest(jsonb,boolean)', 'helper'),
  ('issue_4490_assert_plan_payload(uuid,jsonb,boolean)', 'internal'),
  ('issue_4490_assert_schedule_dates()', 'helper'),
  ('issue_4490_assert_space_row()', 'helper'),
  ('issue_4490_assert_table_join()', 'helper'),
  ('issue_4490_assert_table_space()', 'helper'),
  ('issue_4490_assert_venue_brand()', 'helper'),
  ('issue_4490_assert_waitlist_space()', 'internal'),
  ('issue_4490_assign_table(uuid,uuid[],bigint)', 'signed_in'),
  ('issue_4490_balance_link_info(uuid,uuid,uuid)', 'internal'),
  ('issue_4490_booking_actor_ok(stay_reservation_groups,bytea,uuid)', 'helper'),
  ('issue_4490_booking_money(uuid)', 'internal'),
  ('issue_4490_booking_projection(uuid,text)', 'internal'),
  ('issue_4490_built_features()', 'helper'),
  ('issue_4490_built_offer_kinds()', 'helper'),
  ('issue_4490_busy_rules_valid(jsonb)', 'helper'),
  ('issue_4490_busy_price(jsonb,bigint,timestamp without time zone)', 'helper'),
  ('issue_4490_can_check_in(uuid,uuid)', 'internal'),
  ('issue_4490_can_collect_online(uuid,uuid)', 'internal'),
  ('issue_4490_can_manage_money(uuid,uuid)', 'internal'),
  ('issue_4490_can_manage_tables(uuid)', 'internal'),
  ('issue_4490_can_manage_venue(uuid,text)', 'signed_in'),
  ('issue_4490_can_view_booking(uuid)', 'signed_in'),
  ('issue_4490_can_view_members(uuid)', 'signed_in'),
  ('issue_4490_can_view_space(uuid)', 'signed_in'),
  ('issue_4490_can_view_venue(uuid)', 'signed_in'),
  ('issue_4490_cancel_actor(stay_reservation_groups,bytea,uuid)', 'internal'),
  ('issue_4490_cancel_preview(uuid,bytea,uuid)', 'signed_in'),
  ('issue_4490_cancel(uuid[],text,text,text,bytea,uuid)', 'signed_in'),
  ('issue_4490_change_booking_internal(uuid,text,jsonb,boolean,text,uuid,bytea,bigint,text)', 'internal'),
  ('issue_4490_change_booking(uuid,text,jsonb,boolean,bigint,text)', 'signed_in'),
  ('issue_4490_change_guest_max(uuid,uuid)', 'internal'),
  ('issue_4490_change_rules(uuid)', 'internal'),
  ('issue_4490_check_in_admit(uuid,uuid,integer,boolean,uuid)', 'internal'),
  ('issue_4490_check_in_list(uuid,date,uuid)', 'internal'),
  ('issue_4490_check_in_member(uuid,uuid,integer,uuid)', 'internal'),
  ('issue_4490_check_in_scan(uuid,text,integer,boolean,uuid,text)', 'internal'),
  ('issue_4490_check_in_undo(uuid,uuid,uuid)', 'internal'),
  ('issue_4490_claim_hour_unit(uuid,uuid,uuid,uuid,uuid[],tstzrange,tstzrange,timestamp with time zone)', 'internal'),
  ('issue_4490_claim_spaces(uuid,uuid,uuid,uuid[],uuid,tstzrange,tstzrange,timestamp with time zone)', 'internal'),
  ('issue_4490_clear_special_hours(uuid,date)', 'signed_in'),
  ('issue_4490_closed_reason(uuid)', 'internal'),
  ('issue_4490_confirm_free_offer(uuid)', 'internal'),
  ('issue_4490_create_offer_group(uuid,uuid,jsonb,text,uuid,bytea,text)', 'internal'),
  ('issue_4490_damage_deposit_state(uuid)', 'internal'),
  ('issue_4490_day_closed(uuid,date)', 'internal'),
  ('issue_4490_deposit_plan(uuid,uuid,bigint)', 'internal'),
  ('issue_4490_duplicate_offer(uuid,uuid,text)', 'signed_in'),
  ('issue_4490_enqueue_offer_event(stay_reservation_events,stay_reservation_groups)', 'internal'),
  ('issue_4490_enqueue_waitlist_message(uuid,text)', 'internal'),
  ('issue_4490_ensure_booking_settings(uuid)', 'internal'),
  ('issue_4490_event_space_ids(uuid)', 'internal'),
  ('issue_4490_extras_valid(jsonb)', 'helper'),
  ('issue_4490_feature_ancestors(text)', 'helper'),
  ('issue_4490_feature_dependents(text)', 'helper'),
  ('issue_4490_feature_keys()', 'helper'),
  ('issue_4490_feature_needs_space(text)', 'helper'),
  ('issue_4490_feature_needs(uuid,text)', 'internal'),
  ('issue_4490_feature_parents(text)', 'helper'),
  ('issue_4490_feature_preset(text)', 'helper'),
  ('issue_4490_feature_setting_on(uuid,text,text)', 'internal'),
  ('issue_4490_finalize_followup_payment(uuid,text,text,text,bigint,text,bigint)', 'internal'),
  ('issue_4490_flag_on(text)', 'internal'),
  ('issue_4490_flex_day_summary(uuid,uuid,integer,uuid)', 'internal'),
  ('issue_4490_flex_places(uuid,integer,uuid)', 'internal'),
  ('issue_4490_flex_starts(uuid,uuid,integer,uuid,uuid)', 'internal'),
  ('issue_4490_flexible_window(uuid,timestamp with time zone,integer)', 'internal'),
  ('issue_4490_floor_plan(uuid,uuid,timestamp with time zone)', 'signed_in'),
  ('issue_4490_forget_feature_pause()', 'internal'),
  ('issue_4490_gate_sale(uuid,uuid,jsonb,text,jsonb,text,uuid,uuid,bytea)', 'internal'),
  ('issue_4490_get_booking(uuid)', 'signed_in'),
  ('issue_4490_get_offer_booking(uuid,bytea,uuid,text)', 'internal'),
  ('issue_4490_get_venue_features(uuid)', 'signed_in'),
  ('issue_4490_group_window_id(uuid)', 'internal'),
  ('issue_4490_guard_append_only_money()', 'helper'),
  ('issue_4490_guard_booking_money_insert()', 'helper'),
  ('issue_4490_guard_check_in_log()', 'helper'),
  ('issue_4490_guard_member_history()', 'helper'),
  ('issue_4490_guard_offer_money_rows()', 'helper'),
  ('issue_4490_guest_change_booking(uuid,bytea,uuid,text,jsonb,boolean,bigint,text)', 'internal'),
  ('issue_4490_guest_list_close_at(uuid,date)', 'internal'),
  ('issue_4490_guest_list_cutoff_at(uuid,date,time without time zone)', 'internal'),
  ('issue_4490_guest_list_day(uuid,date)', 'signed_in'),
  ('issue_4490_guest_list_entry_pool(uuid)', 'internal'),
  ('issue_4490_guest_list_entry_projection(uuid)', 'internal'),
  ('issue_4490_guest_list_gate_sale(uuid,uuid,integer,text,jsonb,text,uuid,uuid,bytea)', 'internal'),
  ('issue_4490_guest_list_open_at(uuid,date)', 'internal'),
  ('issue_4490_guest_list_promoter_get(bytea)', 'internal'),
  ('issue_4490_guest_list_promoter_write(bytea,text,jsonb)', 'internal'),
  ('issue_4490_guest_list_terms_projection(uuid,date)', 'internal'),
  ('issue_4490_hire_booking_facts(uuid)', 'internal'),
  ('issue_4490_hire_default_mode()', 'helper'),
  ('issue_4490_hire_projection(uuid)', 'internal'),
  ('issue_4490_hire_ranges(uuid,uuid,integer)', 'internal'),
  ('issue_4490_hold_damage_deposit(uuid,text,text)', 'signed_in'),
  ('issue_4490_hold_hire_internal(uuid,uuid,jsonb,text,uuid,bytea,text)', 'internal'),
  ('issue_4490_hold_offer_internal(uuid,uuid,jsonb,text,uuid,bytea,text,boolean,uuid,text)', 'internal'),
  ('issue_4490_hosted_servable_places_intersection(text,numeric,jsonb,uuid[])', 'internal'),
  ('issue_4490_hosted_servable_places(text,numeric,double precision,double precision,double precision,uuid[],bigint,bigint,character,uuid)', 'internal'),
  ('issue_4490_hour_booking_facts(uuid)', 'internal'),
  ('issue_4490_hour_default_mode()', 'helper'),
  ('issue_4490_hour_projection(uuid)', 'internal'),
  ('issue_4490_inclusions_valid(jsonb)', 'helper'),
  ('issue_4490_is_damage_allocation(text,text)', 'internal'),
  ('issue_4490_issue_offer_pass(uuid)', 'internal'),
  ('issue_4490_layouts_valid(text[],text)', 'helper'),
  ('issue_4490_line_guests(uuid)', 'internal'),
  ('issue_4490_line_refund_bps(uuid,text)', 'internal'),
  ('issue_4490_line_window_id(uuid)', 'internal'),
  ('issue_4490_list_offers(uuid)', 'signed_in'),
  ('issue_4490_lock_plan_period()', 'internal'),
  ('issue_4490_log_check_in(venue_listings,uuid,uuid,uuid,text,integer,text,uuid,jsonb,uuid)', 'internal'),
  ('issue_4490_manage_block_for(uuid,uuid,text,jsonb,text)', 'internal'),
  ('issue_4490_manage_capacity_pool(text,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_guest_list(text,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_hire(text,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_hour(text,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_member(uuid,text,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_offer(text,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_package(text,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_manage_request_for(uuid,uuid,text,jsonb,bigint,text)', 'internal'),
  ('issue_4490_manage_space_combination(text,uuid,jsonb,bigint)', 'signed_in'),
  ('issue_4490_manage_space(text,uuid,jsonb,bigint)', 'signed_in'),
  ('issue_4490_manage_table(text,uuid,jsonb,text)', 'signed_in'),
  ('issue_4490_materialize_offer_windows(uuid)', 'internal'),
  ('issue_4490_member_actor_ok(venue_membership_subscriptions,bytea,uuid)', 'helper'),
  ('issue_4490_member_change(uuid,text,text,uuid,jsonb,text,text)', 'internal'),
  ('issue_4490_member_code_candidate()', 'internal'),
  ('issue_4490_member_credit_left(uuid,text,timestamp with time zone)', 'internal'),
  ('issue_4490_member_enqueue(uuid,uuid,text,text)', 'internal'),
  ('issue_4490_member_event(uuid,uuid,text,text,uuid,jsonb,text)', 'internal'),
  ('issue_4490_member_leave_at(uuid,boolean)', 'internal'),
  ('issue_4490_member_open_period(uuid)', 'internal'),
  ('issue_4490_member_period_at(uuid,timestamp with time zone)', 'internal'),
  ('issue_4490_member_projection(uuid,text,text)', 'internal'),
  ('issue_4490_member_qr_payload(uuid,text,text)', 'helper'),
  ('issue_4490_member_quote(uuid,uuid,bytea,uuid,text,boolean)', 'internal'),
  ('issue_4490_member_return_credits(uuid)', 'internal'),
  ('issue_4490_member_spend(uuid)', 'internal'),
  ('issue_4490_member_venue(uuid)', 'signed_in'),
  ('issue_4490_membership_billing_run(timestamp with time zone,integer)', 'internal'),
  ('issue_4490_membership_get(uuid,bytea,uuid,text)', 'internal'),
  ('issue_4490_membership_join(uuid,uuid,jsonb,date,text,uuid,bytea,text)', 'internal'),
  ('issue_4490_membership_member_action(uuid,bytea,uuid,text,text)', 'internal'),
  ('issue_4490_membership_payment_group(uuid,bytea,uuid)', 'internal'),
  ('issue_4490_membership_period_group(uuid)', 'internal'),
  ('issue_4490_membership_period_paid(uuid,uuid,text,text,text,uuid)', 'internal'),
  ('issue_4490_membership_plan_projection(uuid)', 'internal'),
  ('issue_4490_membership_plans(uuid)', 'signed_in'),
  ('issue_4490_membership_prepare_payment(uuid,bytea,uuid,text)', 'internal'),
  ('issue_4490_mirror_legacy_switch()', 'internal'),
  ('issue_4490_month_after(timestamp with time zone,text)', 'helper'),
  ('issue_4490_my_memberships()', 'signed_in'),
  ('issue_4490_my_offer_bookings()', 'signed_in'),
  ('issue_4490_my_waitlist_entries()', 'signed_in'),
  ('issue_4490_next_free_dates(uuid,uuid,date,integer)', 'signed_in'),
  ('issue_4490_offer_hours_check(uuid)', 'internal'),
  ('issue_4490_offer_from(uuid)', 'internal'),
  ('issue_4490_offer_day_open(uuid,uuid,date)', 'internal'),
  ('issue_4490_offer_slot_prices(uuid,integer,boolean)', 'internal'),
  ('issue_4490_offer_kind_feature(text)', 'helper'),
  ('issue_4490_offer_projection(uuid)', 'internal'),
  ('issue_4490_offer_readiness(uuid)', 'internal'),
  ('issue_4490_offer_sweep(integer)', 'internal'),
  ('issue_4490_on_event_space_change()', 'internal'),
  ('issue_4490_on_guest_list_sale_state()', 'internal'),
  ('issue_4490_on_hire_published()', 'internal'),
  ('issue_4490_on_offer_group_state()', 'internal'),
  ('issue_4490_on_table_opened()', 'internal'),
  ('issue_4490_on_waitlist_notified()', 'internal'),
  ('issue_4490_option_capacity(uuid)', 'internal'),
  ('issue_4490_option_layout_capacity(uuid,text)', 'internal'),
  ('issue_4490_option_place_name(uuid)', 'internal'),
  ('issue_4490_option_price_at(uuid,uuid)', 'internal'),
  ('issue_4490_option_pricing_unit(text)', 'helper'),
  ('issue_4490_option_spaces(uuid)', 'internal'),
  ('issue_4490_option_window_reason(uuid,uuid)', 'internal'),
  ('issue_4490_option_slot_reason(text,smallint[],time without time zone,time without time zone,date,timestamp without time zone)', 'helper'),
  ('issue_4490_pass_admitted_on(uuid,date)', 'internal'),
  ('issue_4490_pass_days_used(uuid)', 'internal'),
  ('issue_4490_pass_qr_payload(uuid,text,text)', 'helper'),
  ('issue_4490_pass_validity(uuid,uuid)', 'internal'),
  ('issue_4490_pass_view_on(uuid,date)', 'internal'),
  ('issue_4490_pass_view(uuid)', 'internal'),
  ('issue_4490_pause_offers_on_feature_off()', 'internal'),
  ('issue_4490_payment_components(uuid)', 'internal'),
  ('issue_4490_period_after(timestamp with time zone,text,text)', 'helper'),
  ('issue_4490_plan_venue(uuid)', 'signed_in'),
  ('issue_4490_policy_text(jsonb)', 'helper'),
  ('issue_4490_pool_day_usage(uuid,date)', 'internal'),
  ('issue_4490_pool_projection(uuid)', 'internal'),
  ('issue_4490_prepare_offer_payment(uuid,bytea,uuid,text,bigint,text)', 'internal'),
  ('issue_4490_preview_day_closure(uuid,date)', 'signed_in'),
  ('issue_4490_prune_table_joins()', 'internal'),
  ('issue_4490_public_features(uuid)', 'internal'),
  ('issue_4490_public_live_offers(uuid,text[])', 'internal'),
  ('issue_4490_public_offer_prices(uuid,text[])', 'internal'),
  ('issue_4490_public_memberships(uuid,text[])', 'internal'),
  ('issue_4490_public_offers(uuid,text[])', 'internal'),
  ('issue_4490_public_tables(uuid,text[])', 'internal'),
  ('issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)', 'internal'),
  ('issue_4490_quote_hour_internal(uuid,uuid,jsonb,text,uuid,text,jsonb)', 'internal'),
  ('issue_4490_quote_offer_internal(uuid,uuid,jsonb,text,uuid,text,boolean,jsonb,jsonb)', 'internal'),
  ('issue_4490_quote_offer(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)', 'internal'),
  ('issue_4490_quote_projection(uuid)', 'internal'),
  ('issue_4490_receipt_lookup(text,text,text)', 'internal'),
  ('issue_4490_receipt_store(text,text,text,jsonb)', 'internal'),
  ('issue_4490_record_offline_payment_for(uuid,uuid,bigint,text,text)', 'internal'),
  ('issue_4490_record_offline_payment_internal(uuid,bigint,text,date,text,uuid,text)', 'internal'),
  ('issue_4490_record_offline_payment(uuid,bigint,text,date,text,text)', 'signed_in'),
  ('issue_4490_refund_amount_internal(uuid,bigint,text,uuid,bytea,text,text)', 'internal'),
  ('issue_4490_refund_damage_internal(uuid,bigint,text,uuid,bytea,text,text)', 'internal'),
  ('issue_4490_refund_ladder_valid(jsonb)', 'helper'),
  ('issue_4490_release_damage_deposit(uuid,bigint,text,text)', 'signed_in'),
  ('issue_4490_release_damage_internal(uuid,text,uuid,bigint,text,text)', 'internal'),
  ('issue_4490_release_lapsed_claims(uuid[])', 'internal'),
  ('issue_4490_release_request_queue()', 'internal'),
  ('issue_4490_reopen_matching_windows()', 'helper'),
  ('issue_4490_requests_list(uuid,text)', 'signed_in'),
  ('issue_4490_resolve_table_pick(uuid,timestamp with time zone,integer,uuid[],uuid,uuid,boolean)', 'internal'),
  ('issue_4490_save_booking_settings(uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_save_floor_plan(uuid,uuid,jsonb,bigint,text)', 'signed_in'),
  ('issue_4490_send_booking_reminder(uuid,text)', 'signed_in'),
  ('issue_4490_set_capacity_override(uuid,uuid,date,integer,integer,boolean,boolean,text)', 'signed_in'),
  ('issue_4490_set_event_venue(uuid,uuid,uuid,text,timestamp with time zone,uuid)', 'signed_in'),
  ('issue_4490_set_special_hours(uuid,date,boolean,jsonb,text)', 'signed_in'),
  ('issue_4490_set_venue_feature(uuid,text,boolean,uuid[],jsonb,bigint,text,boolean)', 'signed_in'),
  ('issue_4490_space_capacity(uuid)', 'internal'),
  ('issue_4490_space_layout_capacity(uuid,text)', 'internal'),
  ('issue_4490_space_projection(venue_spaces)', 'helper'),
  ('issue_4490_spaces_status(uuid[],tstzrange,uuid)', 'internal'),
  ('issue_4490_special_day_projection(venue_special_hours)', 'helper'),
  ('issue_4490_staff_receipt(text,uuid,text,text)', 'internal'),
  ('issue_4490_suggest_tables(uuid,timestamp with time zone,integer,uuid,uuid)', 'signed_in'),
  ('issue_4490_sync_claims_from_commitment()', 'internal'),
  ('issue_4490_sync_claims_from_hold()', 'internal'),
  ('issue_4490_sync_event_space_claims(uuid)', 'internal'),
  ('issue_4490_sync_member_desk()', 'internal'),
  ('issue_4490_sync_offer_damage(uuid)', 'internal'),
  ('issue_4490_sync_offer_vat(uuid)', 'internal'),
  ('issue_4490_sync_stays_feature()', 'internal'),
  ('issue_4490_table_hold_minor_for(uuid[],integer)', 'signed_in'),
  ('issue_4490_table_hold_minor(uuid,integer)', 'signed_in'),
  ('issue_4490_table_party_max(uuid)', 'internal'),
  ('issue_4490_table_pick_terms(uuid,uuid[],integer)', 'internal'),
  ('issue_4490_table_projection(uuid)', 'internal'),
  ('issue_4490_table_service_date(uuid,timestamp with time zone)', 'internal'),
  ('issue_4490_table_slot_occupancy(uuid,timestamp with time zone,integer,uuid,uuid)', 'internal'),
  ('issue_4490_tables_could_seat(uuid,integer,uuid)', 'internal'),
  ('issue_4490_text_claim_link(uuid,bytea,uuid)', 'internal'),
  ('issue_4490_user_can_manage_bookings(uuid,uuid)', 'internal'),
  ('issue_4490_user_can_manage_members(uuid,uuid)', 'internal'),
  ('issue_4490_user_has_venue_capability(uuid,uuid,text)', 'internal'),
  ('issue_4490_validate_plan_desks()', 'internal'),
  ('issue_4490_venue_active_space_count(uuid)', 'internal'),
  ('issue_4490_venue_bookable_given(boolean,jsonb,jsonb,boolean)', 'internal'),
  ('issue_4490_venue_calendar(uuid,date,date)', 'signed_in'),
  ('issue_4490_venue_card_facts(uuid)', 'internal'),
  ('issue_4490_venue_day(uuid,date)', 'signed_in'),
  ('issue_4490_venue_feature_on(uuid,text)', 'internal'),
  ('issue_4490_venue_feature_rows(uuid)', 'internal'),
  ('issue_4490_venue_is_bookable(uuid)', 'internal'),
  ('issue_4490_venue_local_date(uuid)', 'internal'),
  ('issue_4490_venue_member(uuid)', 'signed_in'),
  ('issue_4490_venue_members(uuid,text)', 'signed_in'),
  ('issue_4490_venue_money_day(uuid,date)', 'internal'),
  ('issue_4490_venue_page_payload(uuid)', 'internal'),
  ('issue_4490_venue_page_row(uuid)', 'internal'),
  ('issue_4490_venue_service_date(uuid,timestamp with time zone)', 'internal'),
  ('issue_4490_venue_timezone(uuid)', 'internal'),
  ('issue_4490_venue_upcoming_events(uuid,timestamp with time zone)', 'internal'),
  ('issue_4490_waitlist_actor_ok(venue_waitlist,bytea,uuid)', 'helper'),
  ('issue_4490_waitlist_position(uuid)', 'internal'),
  ('issue_4490_waitlist_projection(uuid)', 'internal'),
  ('issue_4490_window_bounds(time without time zone,time without time zone)', 'helper'),
  ('issue_4490_window_cutoff(uuid,uuid)', 'internal'),
  ('issue_4490_slot_cutoff(text,text,timestamp with time zone,timestamp with time zone,integer)', 'helper'),
  ('issue_4490_window_is_flexible(uuid)', 'internal'),
  ('issue_4490_window_used(uuid)', 'internal'),
  ('issue_4490_windows_valid(jsonb,integer)', 'helper'),
  ('issue_4490_withdraw_request(uuid,bytea,uuid)', 'internal'),
  ('issue_4490_write_feature_row(uuid,text,boolean,uuid[],jsonb,boolean)', 'internal'),
  ('issue_4490_write_legacy_switch(uuid,text,boolean)', 'internal'),
  ('mint_claim_link(text,uuid)', 'internal'),
  ('pg_create_guest_reservation(uuid,timestamp with time zone,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text,uuid[],uuid)', 'internal'),
  ('pg_deck_venue_facts(uuid[])', 'public'),
  ('pg_finalize_guest_reservation(uuid,text)', 'internal'),
  ('pg_get_venue_waitlist_entry(uuid,bytea,uuid)', 'internal'),
  ('pg_join_venue_waitlist(uuid,integer,date,time without time zone,time without time zone,jsonb,bytea,uuid)', 'internal'),
  ('pg_leave_venue_waitlist(uuid,bytea,uuid)', 'internal'),
  ('pg_my_stay_reservation_groups()', 'signed_in'),
  ('pg_public_stay_details(uuid)', 'public'),
  ('pg_public_venue_ordering_state(text,text,text)', 'public'),
  ('pg_public_venue_page(text,text)', 'public'),
  ('pg_venue_available_slots(date,integer,uuid,uuid,uuid)', 'public'),
  ('pg_venue_available_tables(uuid,date,integer,timestamp with time zone,uuid)', 'public'),
  ('pg_venue_hire_options(uuid,uuid,integer)', 'public'),
  ('pg_venue_hour_day(uuid,date,integer,uuid)', 'public'),
  ('pg_venue_offer_availability(uuid,date,date,integer,uuid)', 'public'),
  ('pg_venue_order_finalize_payment(uuid,text,integer,text,text,text,integer,text)', 'internal'),
  ('preview_pending_venue_identity_correction(uuid)', 'signed_in')
;

DO $t$
DECLARE
  r record;
  v_missing text;
  v_wrong text;
  v_unlisted text;
BEGIN
  -- G-1 every listed signature exists.
  SELECT string_agg(e.sig, ', ') INTO v_missing
  FROM t4490g_expected e WHERE to_regprocedure('public.' || e.sig) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'T4490G FAIL: G-1 listed functions that do not exist: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS  G-1 every listed function exists (% functions)', (SELECT count(*) FROM t4490g_expected);

  -- G-2 anon and authenticated EXECUTE match the class.
  SELECT string_agg(format('%s [%s: anon=%s authenticated=%s definer=%s]', e.sig, e.cls,
           has_function_privilege('anon', p.oid, 'EXECUTE'),
           has_function_privilege('authenticated', p.oid, 'EXECUTE'), p.prosecdef), '; ')
    INTO v_wrong
  FROM t4490g_expected e
  JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure('public.' || e.sig)
  WHERE NOT CASE e.cls
    WHEN 'public' THEN p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    WHEN 'signed_in' THEN p.prosecdef
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    WHEN 'internal' THEN p.prosecdef
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    WHEN 'helper' THEN NOT p.prosecdef
  END;
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'T4490G FAIL: G-2 grants that do not match their class: %', v_wrong;
  END IF;
  RAISE NOTICE 'PASS  G-2 anon and authenticated EXECUTE match the class of every listed function';

  -- G-3 nothing without a decision: every issue_4490_* function and every overload of a listed
  -- name is listed.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_unlisted
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE (p.proname LIKE 'issue\_4490\_%'
         OR p.proname IN (SELECT split_part(e.sig, '(', 1) FROM t4490g_expected e))
    AND NOT EXISTS (SELECT 1 FROM t4490g_expected e WHERE to_regprocedure('public.' || e.sig) = p.oid);
  IF v_unlisted IS NOT NULL THEN
    RAISE EXCEPTION 'T4490G FAIL: G-3 functions without a grant decision: %', v_unlisted;
  END IF;
  RAISE NOTICE 'PASS  G-3 every issue_4490_* function and every overload of a listed name has a grant decision';

  -- G-4 the member-code helpers are internal, and the venue page reads are public.
  FOR r IN SELECT * FROM (VALUES
      ('issue_4490_allocate_member_code(uuid)', 'internal'),
      ('issue_4490_member_code_candidate()', 'internal'),
      ('pg_public_venue_page(text,text)', 'public'),
      ('pg_venue_available_slots(date,integer,uuid,uuid,uuid)', 'public'),
      ('pg_venue_available_tables(uuid,date,integer,timestamp with time zone,uuid)', 'public'),
      ('pg_venue_hire_options(uuid,uuid,integer)', 'public'),
      ('pg_venue_hour_day(uuid,date,integer,uuid)', 'public'),
      ('pg_venue_offer_availability(uuid,date,date,integer,uuid)', 'public'),
      ('pg_deck_venue_facts(uuid[])', 'public')) AS x(sig, cls)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM t4490g_expected e WHERE e.sig = r.sig AND e.cls = r.cls) THEN
      RAISE EXCEPTION 'T4490G FAIL: G-4 % must be %', r.sig, r.cls;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS  G-4 the member-code helpers are internal; the seven venue page and deck reads are public';

  -- G-5 the old four-argument table slots read is gone (the allowlist names the live signature).
  IF to_regprocedure('public.pg_venue_available_slots(date,integer,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'T4490G FAIL: G-5 the four-argument pg_venue_available_slots still exists';
  END IF;
  RAISE NOTICE 'PASS  G-5 only the five-argument pg_venue_available_slots exists';
END
$t$;

-- G-6 signed out, the public page read answers. (Refusals are read from the catalogue in G-2:
-- calling a refused definer function inside an exception block as anon once crashed a local
-- PostgreSQL 17 backend, so this suite never does that.)
SET LOCAL ROLE anon;
DO $t$
BEGIN
  PERFORM public.pg_public_venue_page('no-such-brand', 'no-such-venue');
  RAISE NOTICE 'PASS  G-6 anon reads pg_public_venue_page';
END
$t$;
RESET ROLE;

ROLLBACK;
