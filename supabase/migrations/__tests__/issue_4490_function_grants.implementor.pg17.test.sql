-- #4490 W3 fix round 1 (20281203444490): who may call every venue function. BEGIN ... ROLLBACK.
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
-- TEST-MOD-APPROVED #4490 (06-W5): the two hosted deck wrappers (20281203454490) are internal
-- (service role only).
-- TEST-MOD-APPROVED #4490 (06-W6a): the Discover venue helpers (20281203464490) are internal, and
-- the four Discover v2 readers that migration patches are listed (internal, as #4073 made them).
-- TEST-MOD-APPROVED #4490 (06-W6b): the deck venue-type reads (20281203474490) are internal, the lifted
-- place rule is an invoker helper, and the two base servable RPCs it re-emits keep their classes
-- (solo internal; the shared-deck intersection callable by signed-in and signed-out, as before).
-- TEST-MOD-APPROVED #4490 (06-W4 fix 2): the full-now reason (20281203494490) is internal (service role only);
-- the booking read it patches keeps its class.
-- TEST-MOD-APPROVED #4490 (06-W4 fix 1): the plan charge owner and its fee lines and period read, and the
-- remembered-payment-page writer (20281203484490) are internal (service role only); the eight functions that
-- migration re-emits keep their classes.
-- TEST-MOD-APPROVED #4490 (06-W5/W6 fix 1): the hosted wrappers take every signal of a request
-- at once (new signatures, still internal); the shared-deck base RPC is no longer re-emitted by
-- #4490 (W6-N1), so its line is gone; the two new Discover Venues helpers (the Stays-listed read
-- and the filtered candidates, W6-N3 / W6-N6) are internal.
--
-- TEST-MOD-APPROVED #4490 (08-O1): the Till core (20281203504490) adds 26 functions, all internal
-- (service role only; the venue-till edge passes the verified user), and patches the #1795 rollup,
-- which keeps its class (signed-in).
-- TEST-MOD-APPROVED #4490 (08-O1 part 2): receipts (20281203514490) add eight functions and the
-- sweep / card refund (20281203534490) two, all internal; the patched issue_4063_claim_subject keeps
-- its existing class.
-- TEST-MOD-APPROVED #4490 (08-O1 fix 1): 20281203554490 adds nine functions, all internal (service role
-- only); the legacy order-pad RPCs it patches (tab open / close, the queue's transition, the refund
-- decision) keep their signed-in class.
-- TEST-MOD-APPROVED #4490 (08-O1 fix 2): 20281203544490 adds the overpaid derivation and its refund
-- trigger function, both internal (service role only); the day's money and the guest-list gate sale it
-- patches keep their internal class.
-- TEST-MOD-APPROVED #4490 (08-O2): 20281203564490 adds eleven functions (card prepare/start/cancel/close,
-- code expiry, tap record, pay-code view/buyer/status/text, keep late payment), all internal (service role
-- only: the anonymous pay page reaches view/buyer through venue-till); the finalizer it re-emits keeps
-- its service-role-only grant.
-- TEST-MOD-APPROVED #4490 (08-O2 fix 1): 20281203574490 adds four functions (stale payment release, the
-- pay-code lookup without the switch, the pay-link text limits, the unknown-code guess budget) and
-- re-emits the pay-code status and text reads, all internal (service role only).
-- TEST-MOD-APPROVED #4490 (08-O3 part A): 20281203584490 adds nineteen functions (the station gate,
-- board, ticket actions, the station trigger and the floor PDF source and ledger) and re-emits the
-- Till's send, all internal (service role only).
-- TEST-MOD-APPROVED #4490 (08-O3 part A2): 20281203604490 adds the floor staff list and re-emits
-- pg_venue_order_escalation_scan (still service role only), both internal.
-- TEST-MOD-APPROVED #4490 (08-O3 fix 1): 20281203614490 adds the station screen check
-- issue_4490_station_screened (internal) and re-emits seven functions, each keeping its class.
-- TEST-MOD-APPROVED #4490 (08-O4): the split (20281203634490) adds eleven functions (the share context,
-- the service charge left, the share state, the shares-follow-the-check and paid-share line triggers,
-- set split, the three share wrappers, the sale extras) and re-emits take_payment, card_prepare and
-- card_start (same signatures); tables and by the hour (20281203644490) add nine (the deposit refund
-- guard, the line-voided trigger, session book / span / start / extend, seat, the catalog extras) and
-- re-emit the service charge left and the sale extras; all internal (service role only).
-- TEST-MOD-APPROVED #4490 (08-O4 fix 1): 20281203654490 adds five functions (the reservation deposit
-- owner trigger, the deposit's part on a booking, a check's line funding, the offer part of a payment
-- refund, the covered-check close) and re-emits the refund guard, finalize, the Till offer payment
-- record, the money day and start session (same signatures); all internal (service role only).
-- TEST-MOD-APPROVED #4490 (08-O4 fix 3): 20281203674490 adds the deposit excess refund (internal) and
-- re-emits the refund guard, finalize and the sale extras (same signatures).
-- TEST-MOD-APPROVED #4490 (08-O5 part A): 20281203684490 adds the PIN functions, the floor audit
-- helper, the device void and four trigger functions; all internal (service role only).
-- TEST-MOD-APPROVED #4490 (08-O5 part C): 20281203724490 adds the stock functions (13 internal, service
-- role only), the orderable rule and the stock guard trigger (invoker helpers); the functions it
-- re-emits or patches (till send, till void, the finalizer, the floor audit, the day summary) keep
-- their classes.
-- TEST-MOD-APPROVED #4490 (08-O5 fix 4): 20281203754490 also adds issue_4490_day_close_pdf (internal).
-- TEST-MOD-APPROVED #4490 (08-O5 fix 3): 20281203754490 adds issue_4490_pin_step_up_take (internal); the
-- functions it patches keep their classes.
-- TEST-MOD-APPROVED #4490 (08-O5 fix 1): 20281203734490 adds the line refund kind rule and the
-- sold-out refund formula (pure invoker helpers), the resolved-basis read, the hours history state
-- and its two trigger functions and the station screen rule (internal, service role only); the
-- functions it re-emits or patches keep their classes.
-- TEST-MOD-APPROVED #4490 (08-O5 part B): 20281203704490 adds the daily close (summary, close, reopen,
-- carry over, the drawer, export and their helpers) and its two guard trigger functions, all internal
-- (service role only); it re-emits the floor audit helper and the Till business date (same signatures,
-- still internal).
--
-- FAILS-ON-REVERT: without 20281203444490 G-2 fails (the ten internal functions keep the
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
  ('discover_v2_city_context(text[],double precision,double precision,double precision,text)', 'internal'),
  ('discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)', 'internal'),
  ('discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)', 'internal'),
  ('discover_v2_nearest_city(double precision,double precision)', 'internal'),
  ('issue_1384_query_servable_places_by_signal(text,numeric,double precision,double precision,double precision,uuid[],integer,bigint,bigint,character,uuid)', 'internal'),
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
  ('issue_4490_discover_venue_candidates(text[],double precision,double precision,double precision)', 'internal'),
  ('issue_4490_discover_venues_filtered(text[],double precision,double precision,jsonb)', 'internal'),
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
  ('issue_4490_full_now_reason(uuid)', 'internal'),
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
  ('issue_4490_hosted_places_by_venue_type(text,double precision,double precision,integer,uuid[],integer)', 'internal'),
  ('issue_4490_hosted_places_by_venue_type_intersection(text,jsonb,uuid[],integer)', 'internal'),
  ('issue_4490_hosted_servable_places_intersection(jsonb,jsonb,uuid[])', 'internal'),
  ('issue_4490_hosted_servable_places(jsonb,double precision,double precision,double precision,uuid[],bigint,bigint,character,uuid)', 'internal'),
  ('issue_4490_hosted_venue_types_near(double precision,double precision,integer)', 'internal'),
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
  ('issue_4490_member_charge(uuid,bigint)', 'internal'),
  ('issue_4490_member_fee_lines(uuid,bigint)', 'internal'),
  ('issue_4490_member_period_charge(uuid)', 'internal'),
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
  ('issue_4490_place_is_servable(boolean,boolean,text[])', 'helper'),
  ('issue_4490_plan_venue(uuid)', 'signed_in'),
  ('issue_4490_policy_text(jsonb)', 'helper'),
  ('issue_4490_pool_day_usage(uuid,date)', 'internal'),
  ('issue_4490_pool_projection(uuid)', 'internal'),
  ('issue_4490_prepare_offer_payment(uuid,bytea,uuid,text,bigint,text)', 'internal'),
  ('issue_4490_record_payment_page(uuid,text)', 'internal'),
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
  ('issue_4490_stays_listed_venue_ids(text[],double precision,double precision)', 'internal'),
  ('issue_4490_venue_type_chip_keys()', 'internal'),
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
  ('issue_4490_can_sell(uuid,uuid)', 'internal'),
  ('issue_4490_can_kitchen(uuid,uuid)', 'internal'),
  ('issue_4490_is_till_device(uuid,uuid)', 'internal'),
  ('issue_4490_till_business_date(uuid,timestamp with time zone)', 'internal'),
  ('issue_4490_till_enabled(uuid)', 'internal'),
  ('issue_4490_till_sale_projection(uuid)', 'internal'),
  ('issue_4490_till_lock(uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_reprice(uuid)', 'internal'),
  ('issue_4490_till_settings_set(uuid,jsonb,uuid,bigint)', 'internal'),
  ('issue_4490_till_settings_projection(uuid)', 'internal'),
  ('issue_4490_till_open(uuid,uuid,uuid,text,uuid,text)', 'internal'),
  ('issue_4490_till_relabel(uuid,uuid,text,uuid,integer)', 'internal'),
  ('issue_4490_till_set_server(uuid,uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_attach_round(uuid,uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_add_offer_line(uuid,uuid,uuid,jsonb,uuid,text,uuid,integer)', 'internal'),
  ('issue_4490_till_add_balance_line(uuid,uuid,bigint,uuid,text,integer)', 'internal'),
  ('issue_4490_till_void(uuid,uuid,uuid,uuid,text,boolean,integer)', 'internal'),
  ('issue_4490_till_send(uuid,uuid)', 'internal'),
  ('issue_4490_record_till_offer_payment(uuid,bigint,uuid,text)', 'internal'),
  ('issue_4490_till_apply_payment(uuid)', 'internal'),
  ('issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_refund(uuid,bigint,bigint,text,boolean,uuid,uuid,uuid)', 'internal'),
  ('issue_4490_till_checks(uuid,uuid)', 'internal'),
  ('issue_4490_till_catalog(uuid,uuid)', 'internal'),
  ('issue_4490_till_adopt_tab()', 'internal'),
  ('issue_4490_till_round_added()', 'internal'),
  ('issue_4490_till_receipt_immutable()', 'internal'),
  ('issue_4490_till_receipt_build(uuid)', 'internal'),
  ('issue_4490_till_receipt_capture(uuid)', 'internal'),
  ('issue_4490_till_receipt_on_paid()', 'internal'),
  ('issue_4490_till_receipt_projection(uuid)', 'internal'),
  ('issue_4490_till_receipt_send(uuid,uuid,uuid,text,text,bytea)', 'internal'),
  ('issue_4490_till_receipt_view(uuid,bytea)', 'internal'),
  ('issue_4490_till_receipt_link_facts(uuid)', 'internal'),
  ('issue_4490_till_sweep_held_rounds(integer)', 'internal'),
  ('issue_4490_till_mint_carrier_refund(uuid,bigint,bigint,uuid,uuid,text,uuid)', 'internal'),
  ('issue_4490_till_finalize_paid(uuid,uuid,uuid)', 'internal'),
  ('issue_4490_till_settle_after_void(uuid,uuid)', 'internal'),
  ('issue_4490_till_close_on_pad(uuid)', 'internal'),
  ('issue_4490_till_tab_closed()', 'internal'),
  ('issue_4490_pad_guard(text,uuid,uuid,uuid,uuid)', 'internal'),
  ('issue_4490_till_cancel_offer_lines(uuid,uuid[],uuid,text)', 'internal'),
  ('issue_4490_till_cancel_offers_if_refunded(uuid,uuid,text)', 'internal'),
  ('issue_4490_till_refund_line(uuid,uuid,uuid,text,uuid)', 'internal'),
  ('issue_4490_till_servers(uuid,uuid)', 'internal'),
  ('issue_4490_till_overpaid_derived(uuid)', 'internal'),
  ('issue_4490_till_refund_settles()', 'internal'),
  ('issue_4490_till_expire_codes(uuid)', 'internal'),
  ('issue_4490_till_card_close(uuid)', 'internal'),
  ('issue_4490_till_card_prepare(uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_card_start(uuid,text,bigint,uuid,uuid,uuid,integer,jsonb,text)', 'internal'),
  ('issue_4490_till_card_cancel(uuid,uuid)', 'internal'),
  ('issue_4490_till_tap_record(text,text,bigint,text,text)', 'internal'),
  ('issue_4490_till_pay_code_view(text)', 'internal'),
  ('issue_4490_till_pay_code_buyer(text,text,text,text)', 'internal'),
  ('issue_4490_till_pay_code_status(text,uuid,uuid)', 'internal'),
  ('issue_4490_till_pay_code_text(text,uuid,uuid,text,text)', 'internal'),
  ('issue_4490_till_keep_late_payment(uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_release_stale(uuid)', 'internal'),
  ('issue_4490_till_pay_code_lookup(text,uuid,uuid)', 'internal'),
  ('issue_4490_till_text_limits()', 'internal'),
  ('issue_4490_till_code_guess_budget(boolean,integer)', 'internal'),
  ('issue_4490_till_share_context()', 'internal'),
  ('issue_4490_till_sc_left(uuid)', 'internal'),
  ('issue_4490_till_share_state_sync()', 'internal'),
  ('issue_4490_till_shares_follow_sale()', 'internal'),
  ('issue_4490_till_share_line_guard()', 'internal'),
  ('issue_4490_till_set_split(uuid,text,jsonb,uuid,integer)', 'internal'),
  ('issue_4490_till_pay_share(uuid,uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_card_prepare_share(uuid,uuid,uuid,integer)', 'internal'),
  ('issue_4490_till_card_start_share(uuid,uuid,text,bigint,uuid,uuid,uuid,integer,jsonb,text)', 'internal'),
  ('issue_4490_till_sale_extras(uuid)', 'internal'),
  ('issue_4490_reservation_deposit_refund_guard()', 'internal'),
  ('issue_4490_till_line_voided()', 'internal'),
  ('issue_4490_till_session_book(uuid,uuid,uuid,uuid,integer,uuid,text,tstzrange,uuid)', 'internal'),
  ('issue_4490_till_session_span(uuid)', 'internal'),
  ('issue_4490_till_start_session(uuid,uuid,uuid,integer,integer,uuid,text,integer)', 'internal'),
  ('issue_4490_till_extend_session(uuid,uuid,integer,uuid,text,integer)', 'internal'),
  ('issue_4490_till_seat(uuid,uuid,uuid,integer,uuid,text,uuid,text)', 'internal'),
  ('issue_4490_till_catalog_extras(uuid)', 'internal'),
  -- 08-O4 fix 1 (20281203654490): all internal (service role only).
  ('issue_4490_reservation_deposit_owned()', 'internal'),
  ('issue_4490_record_till_credit(uuid,bigint,uuid,uuid,text)', 'internal'),
  ('issue_4490_till_line_funding(uuid)', 'internal'),
  ('issue_4490_till_refund_offer_parts(uuid)', 'internal'),
  ('issue_4490_till_close_covered(uuid,uuid,integer)', 'internal'),
  -- 08-O4 fix 3 (20281203674490): the deposit excess refund, internal.
  ('issue_4490_till_refund_deposit_excess(uuid,uuid)', 'internal'),
  -- 08-O5 part A (20281203684490): PINs, PIN sessions, step-up, the floor audit, all internal.
  ('issue_4490_pin_gate(uuid,uuid)', 'internal'),
  ('issue_4490_pin_is_weak(text)', 'internal'),
  ('issue_4490_pin_member_eligible(uuid,uuid,text)', 'internal'),
  ('issue_4490_pin_can_reset(uuid,uuid)', 'internal'),
  ('issue_4490_pin_can_manage_venue(uuid,uuid)', 'internal'),
  ('issue_4490_pin_current_device(uuid)', 'internal'),
  ('issue_4490_floor_audit(uuid,uuid,uuid,text,text,text,jsonb)', 'internal'),
  ('issue_4490_pin_set(uuid,uuid,text)', 'internal'),
  ('issue_4490_pin_reset(uuid,uuid)', 'internal'),
  ('issue_4490_pin_status(uuid,uuid)', 'internal'),
  ('issue_4490_pin_team(uuid,uuid)', 'internal'),
  ('issue_4490_pin_staff(uuid,uuid)', 'internal'),
  ('issue_4490_pin_check(uuid,uuid,uuid,text,text)', 'internal'),
  ('issue_4490_pin_unlock(uuid,uuid,uuid,text,uuid)', 'internal'),
  ('issue_4490_pin_session_resolve(bytea,uuid,uuid,uuid)', 'internal'),
  ('issue_4490_pin_session_end(bytea,uuid,uuid,text)', 'internal'),
  ('issue_4490_pin_sessions_end_all(uuid)', 'internal'),
  ('issue_4490_pin_approve(bytea,uuid,uuid,uuid,uuid,text,text,text)', 'internal'),
  ('issue_4490_pin_actor_assert(uuid,uuid,uuid)', 'internal'),
  ('issue_4490_pin_money_row_guard()', 'internal'),
  ('issue_4490_till_void_on_device(uuid,uuid,uuid,uuid,uuid,text,boolean,integer,boolean)', 'internal'),
  ('issue_4490_floor_audit_paid()', 'internal'),
  ('issue_4490_floor_audit_refund()', 'internal'),
  ('issue_4490_floor_audit_void()', 'internal'),
  -- 08-O5 part B (20281203704490): the daily close, all internal (service role only).
  ('issue_4490_day_close_guard()', 'internal'),
  ('issue_4490_cash_movement_guard()', 'internal'),
  ('issue_4490_close_person(uuid,uuid)', 'internal'),
  ('issue_4490_close_method_key(text,text)', 'internal'),
  ('issue_4490_close_method_order(text)', 'internal'),
  ('issue_4490_day_payment_ids(uuid,date)', 'internal'),
  ('issue_4490_day_refund_ids(uuid,date)', 'internal'),
  ('issue_4490_day_float(uuid,date)', 'internal'),
  ('issue_4490_day_totals(uuid,date)', 'internal'),
  ('issue_4490_day_open_checks(uuid,date)', 'internal'),
  ('issue_4490_day_gate(uuid,uuid,uuid)', 'internal'),
  ('issue_4490_day_check_date(uuid,date)', 'internal'),
  ('issue_4490_day_summary(uuid,date,uuid,uuid)', 'internal'),
  ('issue_4490_day_close(uuid,date,bigint,uuid,uuid,uuid)', 'internal'),
  ('issue_4490_day_reopen(uuid,date,text,uuid,uuid)', 'internal'),
  ('issue_4490_till_carry_over(uuid,date,uuid,uuid)', 'internal'),
  ('issue_4490_cash_movements_list(uuid,date,uuid,uuid)', 'internal'),
  ('issue_4490_cash_movement(uuid,date,text,bigint,text,uuid,uuid,uuid)', 'internal'),
  ('issue_4490_day_export(uuid,date,uuid,uuid)', 'internal'),
  ('issue_4490_till_settings_read(uuid,uuid)', 'internal'),
  -- 08-O5 part C (20281203724490): stock. The orderable rule is a pure invoker helper the two
  -- anon menu views call; the guard trigger is an invoker on purpose (it must see the caller's
  -- role); everything else is internal (service role only).
  ('issue_4490_menu_item_orderable(boolean,integer)', 'helper'),
  ('issue_4490_menu_item_stock_guard()', 'helper'),
  ('issue_4490_can_manage_menu(uuid,uuid)', 'internal'),
  ('issue_4490_stock_projection(uuid)', 'internal'),
  ('issue_4490_stock_item_venue(uuid)', 'internal'),
  ('issue_4490_stock_set(uuid,integer,integer,uuid,uuid)', 'internal'),
  ('issue_4490_station_sold_out(uuid,boolean,uuid)', 'internal'),
  ('issue_4490_station_stock(uuid,text,uuid)', 'internal'),
  ('issue_4490_stock_take(uuid[],text,uuid)', 'internal'),
  ('issue_4490_stock_give_back(uuid)', 'internal'),
  ('issue_4490_venue_order_mint_partial_refund(uuid,bigint,uuid,text,text)', 'internal'),
  ('issue_4490_order_sold_out_resolve(uuid,uuid[],text,uuid,uuid,uuid,text)', 'internal'),
  ('issue_4490_order_sold_out(uuid,uuid)', 'internal'),
  ('issue_4490_sold_out_open(uuid)', 'internal'),
  ('issue_4490_sold_out_escalation_scan(timestamp with time zone,integer)', 'internal'),
  -- 08-O5 fix 1 (20281203734490): every sold-out line resolvable once; hours as they were; the
  -- no-screen void restock. Two pure invoker rules; everything else internal (service role only).
  ('issue_4490_is_line_refund_kind(text)', 'helper'),
  ('issue_4490_sold_out_refund_for_basis(bigint,bigint,bigint,bigint)', 'helper'),
  ('issue_4490_sold_out_basis_done(uuid)', 'internal'),
  ('issue_4490_venue_hours_state(uuid)', 'internal'),
  ('issue_4490_venue_hours_baseline()', 'internal'),
  ('issue_4490_venue_hours_capture()', 'internal'),
  -- 08-O5 fix 3 (20281203754490): the step-up take (single-use approvals), internal.
  ('issue_4490_pin_step_up_take(uuid,uuid,uuid,text,text,text,boolean)', 'internal'),
  -- 08-O5 fix 4 (20281203754490): the day-close PDF source consumes its export step-up, internal.
  ('issue_4490_day_close_pdf(uuid,date,uuid,uuid)', 'internal'),
  ('issue_4490_station_has_screen(uuid,text)', 'internal'),
  -- 08-O3 part A (20281203584490): stations and floor PDFs, all internal (service role only).
  ('issue_4490_stations_enabled(uuid)', 'internal'),
  ('issue_4490_floor_person_name(uuid,uuid)', 'internal'),
  -- after #4579 (20281203774490): the one Till staff naming rule, internal; the
  -- PIN stand-in issue_4490_pin_member_is_mingla_admin was dropped (full parity).
  ('issue_4490_staff_name(uuid,uuid,text)', 'internal'),
  ('issue_4490_item_station(uuid,uuid)', 'internal'),
  ('issue_4490_order_item_station()', 'internal'),
  ('issue_4490_station_order_visible(venue_orders)', 'internal'),
  ('issue_4490_station_ticket_projection(uuid,text)', 'internal'),
  ('issue_4490_station_board(uuid,text,uuid)', 'internal'),
  ('issue_4490_station_lock(uuid,text,uuid,boolean)', 'internal'),
  ('issue_4490_station_sync_order(uuid)', 'internal'),
  ('issue_4490_station_accept(uuid,text,uuid)', 'internal'),
  ('issue_4490_station_ticket_ready(uuid,text,uuid)', 'internal'),
  ('issue_4490_station_item_ready(uuid,uuid)', 'internal'),
  ('issue_4490_station_recall(uuid,text,uuid)', 'internal'),
  ('issue_4490_order_picked_up(uuid,text,uuid)', 'internal'),
  ('issue_4490_station_mark_printed(uuid,text,uuid)', 'internal'),
  ('issue_4490_floor_pdf_source(text,uuid,uuid,text,uuid,uuid)', 'internal'),
  ('issue_4490_floor_pdf_record(uuid,text,text,uuid)', 'internal'),
  ('issue_4490_floor_pdf_due(integer)', 'internal'),
  ('issue_4490_floor_pdf_forget(text[])', 'internal'),
  -- 08-O3 part A2 (20281203604490): floor staff list (T4), and the escalation scan it re-emits (T7), both internal.
  ('issue_4490_venue_floor_user_ids(uuid,uuid,text[])', 'internal'),
  ('pg_venue_order_escalation_scan(timestamp with time zone,integer)', 'internal'),
  -- 08-O3 fix 1 (20281203614490): which stations have a screen (T5), internal.
  ('issue_4490_station_screened(uuid,text)', 'internal'),
  ('biz_venue_tab_open(uuid)', 'signed_in'),
  ('biz_venue_tab_close(uuid,text)', 'signed_in'),
  ('biz_venue_order_transition(uuid,text,text)', 'signed_in'),
  ('biz_venue_order_refund_decision(uuid,text,text)', 'signed_in'),
  ('venue_order_metrics_rollup(uuid,uuid)', 'signed_in'),
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
