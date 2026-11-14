\set ON_ERROR_STOP on

-- #4430 migration 20280707424430: gig and Local payout promotion (P-1), the
-- counter difference on every refund branch (P-2), cancellation and dispute
-- notices (N-1), no referral notice for gig or Local shares (N-2), the
-- script-locked push (item 3), split money states (item 5), re-offer after a
-- hire ends (Q1) and the Local review rules (L-1). Every fixture
-- rolls back.
--
-- MINGLA-INVARIANT: I-4430-P1 | issue #4430 | an accumulating payee share of any order kind the CHECK allows is promoted on the next sweep once its own kind's release condition holds (T-P1)
-- MINGLA-INVARIANT: I-4430-P2 | issue #4430 | every refund branch's host refund includes each pending counter refund, and no refund adjustment ends superseded (T-P2)
-- MINGLA-INVARIANT: I-4430-N1 | issue #4430 | a contract moving to cancelled, declined, expired or a dispute decision notifies each party that did not act (T-N1)
-- MINGLA-INVARIANT: I-4430-N2 | issue #4430 | only payee_kind='referral' shares create referral outbox rows (T-N2)

BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

-- Outbox rows for one contract and category.
CREATE FUNCTION pg_temp.notes(p_contract uuid, p_category text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.notification_outbox WHERE category_key = p_category AND payload->>'contract_id' = p_contract::text;
$$;
CREATE FUNCTION pg_temp.body(p_contract uuid, p_category text) RETURNS text LANGUAGE sql AS $$
  SELECT payload->>'body' FROM public.notification_outbox WHERE category_key = p_category AND payload->>'contract_id' = p_contract::text ORDER BY created_at DESC, id DESC LIMIT 1;
$$;
CREATE FUNCTION pg_temp.title(p_contract uuid, p_category text) RETURNS text LANGUAGE sql AS $$
  SELECT payload->>'title' FROM public.notification_outbox WHERE category_key = p_category AND payload->>'contract_id' = p_contract::text ORDER BY created_at DESC, id DESC LIMIT 1;
$$;

-- One gig with one interested creator, an NGN offer of 20000 + 3000 booking
-- (23000 held), captured. p_counter: the creator counters to 15000 and the
-- host accepts, leaving a pending counter refund of 5750.
CREATE FUNCTION pg_temp.hire(p_n integer, p_counter boolean, p_capture boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_host uuid := '44300000-0000-4000-8000-000000000001';
  v_creator uuid := '44300000-0000-4000-8000-000000000002';
  v_brand uuid := '44300000-0000-4000-8000-000000000004';
  v_city uuid := '44300000-0000-4000-8000-000000000005';
  v_gig uuid := ('44300000-0000-4000-8000-0000000a' || lpad(p_n::text, 4, '0'))::uuid;
  v_int uuid := ('44300000-0000-4000-8000-0000000b' || lpad(p_n::text, 4, '0'))::uuid;
  v_answer jsonb; v_contract uuid; v_proposal uuid;
BEGIN
  INSERT INTO public.gigs(id, brand_id, listing_kind, listing_id, title_public, brief_public, format_key,
    deliverables, city_id, category, shoot_window_start, shoot_window_end, post_by, currency, status, created_by)
  VALUES (v_gig, v_brand, 'event', gen_random_uuid(), 'Money video ' || p_n,
    'Create a clear launch video showing the experience and its atmosphere.', 'behind_the_scenes',
    '[{"platform":"instagram","kind":"reel","count":1}]', v_city, 'nightlife',
    current_date + 2, current_date + 3, current_date + 7, 'NGN', 'open', v_host);
  INSERT INTO public.gig_interest(id, gig_id, creator_account_id, quoted_minor) VALUES (v_int, v_gig, v_creator, 20000);
  PERFORM pg_temp.act(v_host);
  v_answer := public.gig_offer_prepare(v_int, '{"fee_minor":20000,"rights_accepted":true}'::jsonb, 'i4430-offer-' || p_n);
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true OR (v_answer->>'total_minor')::bigint <> 23000 THEN RAISE EXCEPTION 'hire %: %', p_n, v_answer; END IF;
  v_contract := (v_answer->>'contract_id')::uuid;
  PERFORM pg_temp.act(NULL);
  IF p_capture THEN
    PERFORM public.gig_hold_set_provider_ref(v_contract, 1, 'gig_hold', 'ps_i4430_' || p_n);
    PERFORM public.gig_hold_mark_captured(v_contract, 1, 'ps_i4430_' || p_n);
  END IF;
  IF p_counter THEN
    PERFORM pg_temp.act(v_creator);
    v_answer := public.gig_counter_send(v_contract, 15000, NULL);
    IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'counter %: %', p_n, v_answer; END IF;
    v_proposal := (v_answer->>'proposal_id')::uuid;
    PERFORM pg_temp.act(v_host);
    v_answer := public.gig_counter_respond(v_proposal, true);
    IF (v_answer->>'refund_minor')::bigint <> 5750 THEN RAISE EXCEPTION 'counter accept %: %', p_n, v_answer; END IF;
    PERFORM pg_temp.act(NULL);
  END IF;
  RETURN v_contract;
END;
$$;

-- Quote then record a branch the way gig-refund does; returns the quote.
CREATE FUNCTION pg_temp.refund(p_contract uuid, p_branch text, p_ref text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_quote jsonb; v_answer jsonb;
BEGIN
  PERFORM pg_temp.act(NULL);
  v_quote := public.gig_refund_quote(p_contract, p_branch);
  v_answer := public.gig_refund_record(p_contract, p_branch, (v_quote->>'refund_minor')::bigint, (v_quote->>'creator_fee_minor')::bigint, p_ref);
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'record % %: %', p_contract, p_branch, v_answer; END IF;
  -- (e) a replay with the same branch and amounts is a no-op.
  v_answer := public.gig_refund_record(p_contract, p_branch, (v_quote->>'refund_minor')::bigint, (v_quote->>'creator_fee_minor')::bigint, p_ref);
  IF (v_answer->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'replay % %: %', p_contract, p_branch, v_answer; END IF;
  RETURN v_quote;
END;
$$;

-- Q1: the host can offer the same creator again on this gig.
CREATE FUNCTION pg_temp.reoffer(p_n integer, p_label text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_answer jsonb;
BEGIN
  PERFORM pg_temp.act('44300000-0000-4000-8000-000000000001');
  v_answer := public.gig_offer_prepare(('44300000-0000-4000-8000-0000000b' || lpad(p_n::text, 4, '0'))::uuid,
    '{"fee_minor":20000,"rights_accepted":true}'::jsonb, 'i4430-reoffer-' || p_n);
  PERFORM pg_temp.act(NULL);
  RETURN v_answer;
END;
$$;

DO $test$
DECLARE
  v_host uuid := '44300000-0000-4000-8000-000000000001';
  v_creator uuid := '44300000-0000-4000-8000-000000000002';
  v_admin uuid := '44300000-0000-4000-8000-000000000003';
  v_brand uuid := '44300000-0000-4000-8000-000000000004';
  v_city uuid := '44300000-0000-4000-8000-000000000005';
  v_open constant text := 'Your gig is open again for other applicants.';
  v_c uuid; v_c2 uuid; v_quote jsonb; v_answer jsonb; v_ws jsonb; v_body text; v_dispute uuid; v_failed boolean;
BEGIN
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'i4430-host@test.local'), (v_creator, 'i4430-creator@test.local'), (v_admin, 'i4430-admin@mingla.test');
  INSERT INTO public.admin_users(email, status) VALUES ('i4430-admin@mingla.test', 'active');
  INSERT INTO public.creator_accounts(id, email, display_name) VALUES (v_host, 'i4430-host@test.local', 'Money Host');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, default_timezone)
  VALUES (v_brand, v_host, 'Issue 4430 Money Host', 'issue-4430-money-host', 'NGN', 'Africa/Lagos');
  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'issue-4430-money-city', 'Money City', 'Nigeria', 'NG', 6.5, 3.4, 6.4, 3.3, 6.6, 3.5);
  INSERT INTO public.creator_profiles(creator_account_id, display_name, home_city_id, usage_ads_opt_in)
  VALUES (v_creator, 'Ada Creator', v_city, true);
  PERFORM pg_temp.act(v_creator);
  PERFORM public.creator_agreement_sign(DATE '1990-01-01');
  PERFORM pg_temp.act(NULL);

  IF public.issue_4430_money_words(5750, 'NGN') <> '₦57.50' OR public.issue_4430_money_words(29000, 'NGN') <> '₦290'
     OR public.issue_4430_money_words(123456700, 'NGN') <> '₦1,234,567' OR public.issue_4430_money_words(NULL, 'NGN') IS NOT NULL THEN
    RAISE EXCEPTION 'money words: % %', public.issue_4430_money_words(5750, 'NGN'), public.issue_4430_money_words(123456700, 'NGN');
  END IF;

  -- ── T-P2 (a) resolved_partial at 40%, and the dispute decision notice. ──
  v_c := pg_temp.hire(1, true);
  PERFORM pg_temp.act(v_host);
  v_ws := public.gig_contract_workspace(v_c);
  IF (v_ws->'pending_refund'->>'amount_minor')::bigint IS DISTINCT FROM 5750 OR v_ws->'pending_refund'->>'currency' <> 'NGN' THEN
    RAISE EXCEPTION 'P-2 workspace pending_refund: %', v_ws->'pending_refund';
  END IF;
  PERFORM pg_temp.act(NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c, 'disputed', NULL, NULL, NULL, NULL);
  INSERT INTO public.gig_disputes(contract_id, opened_by, reason, statement, status)
  VALUES (v_c, 'host', 'other', 'The video does not show the venue.', 'escalated') RETURNING id INTO v_dispute;
  PERFORM pg_temp.act(v_admin);
  PERFORM public.gig_dispute_admin_decide(v_dispute, 'partial_refund', 4000, 'Split.');
  PERFORM pg_temp.act(NULL);
  v_body := pg_temp.body(v_c, 'creator.gig.dispute');
  IF v_body IS DISTINCT FROM 'Mingla decided: 40% back to the host, you get ₦90.' OR pg_temp.title(v_c, 'creator.gig.dispute') <> 'Dispute decided' THEN
    RAISE EXCEPTION 'N-1 dispute creator words: %', v_body;
  END IF;
  IF pg_temp.body(v_c, 'business.gig.dispute') IS DISTINCT FROM 'Mingla decided: 40% back to you, the creator gets ₦90.' THEN
    RAISE EXCEPTION 'N-1 dispute host words: %', pg_temp.body(v_c, 'business.gig.dispute');
  END IF;
  v_quote := pg_temp.refund(v_c, 'resolved_partial', 'ps_rf_1');
  IF (v_quote->>'refund_minor')::bigint <> 11750 OR (v_quote->>'creator_fee_minor')::bigint <> 9000 THEN
    RAISE EXCEPTION 'P-2 (a) resolved_partial quote: %', v_quote;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_hold_adjustments WHERE contract_id = v_c AND kind = 'refund' AND status = 'refunded' AND refunded_minor = 5750 AND provider_ref = 'ps_rf_1')
     OR (SELECT refunded_minor FROM public.gig_holds WHERE contract_id = v_c) <> 6000
     OR (SELECT status FROM public.gig_holds WHERE contract_id = v_c) <> 'partially_refunded' THEN
    RAISE EXCEPTION 'P-2 (a) adjustment not recorded as refunded';
  END IF;
  IF public.issue_3872_contract_money_state(v_c) <> 'dispute_partial' THEN RAISE EXCEPTION 'item 5 dispute_partial: %', public.issue_3872_contract_money_state(v_c); END IF;
  -- Q1 boundary: a dispute outcome is not one of the ended-hire states Seth listed.
  IF pg_temp.reoffer(1, 'resolved_partial')->>'error' IS DISTINCT FROM 'interest_not_open' THEN RAISE EXCEPTION 'Q1 resolved_partial must not reopen'; END IF;

  -- ── T-P2 (b) host cancels after accept: 75% + booking + counter back. ──
  v_c := pg_temp.hire(2, true);
  PERFORM public.issue_3872_contract_apply_state(v_c, 'accepted', NULL, NULL, NULL, NULL);
  v_quote := pg_temp.refund(v_c, 'host_after_accept_before_lock', 'ps_rf_2');
  IF (v_quote->>'refund_minor')::bigint <> 5750 + 11250 + 2250 OR (v_quote->>'creator_fee_minor')::bigint <> 3750 THEN
    RAISE EXCEPTION 'P-2 (b) host_after_accept quote: %', v_quote;
  END IF;
  IF public.issue_3872_contract_money_state(v_c) <> 'cancelled_partial' THEN RAISE EXCEPTION 'item 5 cancelled_partial: %', public.issue_3872_contract_money_state(v_c); END IF;
  PERFORM pg_temp.act(v_host);
  v_ws := public.gig_contract_workspace(v_c);
  IF (v_ws->>'creator_kept_minor')::bigint <> 3750 OR v_ws->'pending_refund' <> 'null'::jsonb OR v_ws->>'money_state' <> 'cancelled_partial' THEN
    RAISE EXCEPTION 'item 5 workspace: kept % pending % state %', v_ws->'creator_kept_minor', v_ws->'pending_refund', v_ws->'money_state';
  END IF;
  PERFORM pg_temp.act(NULL);
  IF pg_temp.title(v_c, 'creator.gig.cancelled') <> 'The host cancelled this gig'
     OR pg_temp.body(v_c, 'creator.gig.cancelled') <> 'You keep ₦37.50 for the work so far.' THEN
    RAISE EXCEPTION 'N-1 host_after_accept creator: % / %', pg_temp.title(v_c, 'creator.gig.cancelled'), pg_temp.body(v_c, 'creator.gig.cancelled');
  END IF;
  IF pg_temp.title(v_c, 'business.gig.cancelled') <> 'Gig cancelled'
     OR pg_temp.body(v_c, 'business.gig.cancelled') <> '₦192.50 is on its way back to your payment. ' || v_open THEN
    RAISE EXCEPTION 'N-1 host_after_accept host: %', pg_temp.body(v_c, 'business.gig.cancelled');
  END IF;
  v_answer := pg_temp.reoffer(2, 'host_after_accept_before_lock');
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after host_after_accept: %', v_answer; END IF;

  -- ── T-P2 (c) full refunds stay full: upload_missed, post_missed, creator_after_accept.
  v_c := pg_temp.hire(3, true);
  PERFORM public.issue_3872_contract_apply_state(v_c, 'script_locked', now() - interval '1 minute', NULL, NULL, NULL);
  -- Entering script_locked re-syncs the deadline to the agreed due; pass it.
  UPDATE public.gig_contracts SET state_deadline_at = now() - interval '1 minute' WHERE id = v_c;
  v_quote := pg_temp.refund(v_c, 'upload_missed', 'ps_rf_3');
  IF (v_quote->>'refund_minor')::bigint <> 23000 OR (v_quote->>'creator_fee_minor')::bigint <> 0
     OR (SELECT status FROM public.gig_holds WHERE contract_id = v_c) <> 'refunded' THEN
    RAISE EXCEPTION 'P-2 (c) upload_missed: %', v_quote;
  END IF;
  IF pg_temp.title(v_c, 'creator.gig.cancelled') <> 'This gig was cancelled'
     OR pg_temp.body(v_c, 'creator.gig.cancelled') <> 'The video wasn''t uploaded by the deadline, so the host was refunded.'
     OR pg_temp.title(v_c, 'business.gig.cancelled') <> 'The video didn''t arrive in time'
     OR pg_temp.body(v_c, 'business.gig.cancelled') <> 'Your full refund has started. ' || v_open THEN
    RAISE EXCEPTION 'N-1 upload_missed notices';
  END IF;
  IF (pg_temp.reoffer(3, 'upload_missed')->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after upload_missed'; END IF;

  v_c := pg_temp.hire(4, true);
  PERFORM public.issue_3872_contract_apply_state(v_c, 'approved', now() - interval '1 minute', NULL, NULL, NULL);
  v_quote := pg_temp.refund(v_c, 'post_missed', 'ps_rf_4');
  IF (v_quote->>'refund_minor')::bigint <> 23000 THEN RAISE EXCEPTION 'P-2 (c) post_missed: %', v_quote; END IF;
  IF pg_temp.body(v_c, 'business.gig.post_missed') <> 'Your full refund has started. ' || v_open
     OR pg_temp.notes(v_c, 'creator.gig.post_missed') <> 1 THEN
    RAISE EXCEPTION 'N-1 post_missed notices: %', pg_temp.body(v_c, 'business.gig.post_missed');
  END IF;
  IF (pg_temp.reoffer(4, 'post_missed')->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after post_missed'; END IF;

  -- creator_after_accept on a gig that is no longer open: no {open} words.
  v_c := pg_temp.hire(5, true);
  PERFORM public.issue_3872_contract_apply_state(v_c, 'accepted', NULL, NULL, NULL, NULL);
  UPDATE public.gigs SET status = 'closed' WHERE id = (SELECT gig_id FROM public.gig_contracts WHERE id = v_c);
  v_quote := pg_temp.refund(v_c, 'creator_after_accept', 'ps_rf_5');
  IF (v_quote->>'refund_minor')::bigint <> 23000 OR (v_quote->>'creator_fee_minor')::bigint <> 0 THEN RAISE EXCEPTION 'P-2 (c) creator_after_accept: %', v_quote; END IF;
  IF pg_temp.title(v_c, 'business.gig.cancelled') <> 'Ada Creator cancelled the gig'
     OR pg_temp.body(v_c, 'business.gig.cancelled') <> 'Your full refund of ₦230 has started.'
     OR pg_temp.title(v_c, 'creator.gig.cancelled') <> 'You cancelled this gig'
     OR pg_temp.body(v_c, 'creator.gig.cancelled') <> 'The host gets a full refund.' THEN
    RAISE EXCEPTION 'N-1 creator_after_accept notices: % / %', pg_temp.title(v_c, 'business.gig.cancelled'), pg_temp.body(v_c, 'business.gig.cancelled');
  END IF;
  IF (SELECT status FROM public.gig_interest WHERE id = '44300000-0000-4000-8000-0000000b0005') <> 'shortlisted' THEN
    RAISE EXCEPTION 'Q1 creator_after_accept did not reopen the interest';
  END IF;
  -- The gig is closed, so the re-offer is refused for that reason only.
  IF pg_temp.reoffer(5, 'creator_after_accept')->>'error' IS DISTINCT FROM 'gig_not_open' THEN RAISE EXCEPTION 'Q1 closed gig'; END IF;
  UPDATE public.gigs SET status = 'open' WHERE id = (SELECT gig_id FROM public.gig_contracts WHERE id = v_c);
  IF (pg_temp.reoffer(5, 'creator_after_accept')->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after creator_after_accept'; END IF;

  -- ── T-P2 (d) repair: a superseded difference re-opens; counter_lower pays it.
  -- The stranded production shape: resolved_partial recorded under the old
  -- fold (hold partially_refunded at 6000, difference superseded).
  v_c := pg_temp.hire(6, true);
  PERFORM public.issue_3872_contract_apply_state(v_c, 'disputed', NULL, NULL, NULL, NULL);
  INSERT INTO public.gig_disputes(contract_id, opened_by, reason, statement, status, decided_outcome, decided_refund_bps, decided_at)
  VALUES (v_c, 'host', 'other', 'The video does not show the venue.', 'decided', 'partial_refund', 4000, now());
  PERFORM pg_temp.refund(v_c, 'resolved_partial', 'ps_rf_6');
  UPDATE public.gig_hold_adjustments SET status = 'superseded', refunded_minor = 0, provider_ref = NULL WHERE contract_id = v_c AND kind = 'refund';
  -- The migration's guarded repair matches only the production contract id;
  -- this database has none, so nothing was re-opened by the migration.
  IF EXISTS (SELECT 1 FROM public.gig_events WHERE kind = 'counter_refund_reopened') THEN RAISE EXCEPTION 'P-2 repair touched a fixture'; END IF;
  -- Re-open this fixture exactly as the repair does.
  UPDATE public.gig_hold_adjustments SET status = 'pending' WHERE contract_id = v_c AND kind = 'refund' AND status = 'superseded';
  IF NOT public.issue_3872_gig_refund_branch_allowed(v_c, 'counter_lower') THEN RAISE EXCEPTION 'P-2 (d) counter_lower not allowed after resolved_partial'; END IF;
  v_quote := public.gig_refund_quote(v_c, 'counter_lower');
  IF (v_quote->>'refund_minor')::bigint <> 5750 OR (v_quote->'sources'->0->>'kind') <> 'base' THEN RAISE EXCEPTION 'P-2 (d) counter quote: %', v_quote; END IF;
  v_answer := public.gig_refund_record(v_c, 'counter_lower', 5750, 0, 'ps_rf_6c');
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true OR (SELECT status FROM public.gig_hold_adjustments WHERE contract_id = v_c AND kind = 'refund') <> 'refunded' THEN
    RAISE EXCEPTION 'P-2 (d) counter record: %', v_answer;
  END IF;
  IF (public.gig_refund_record(v_c, 'counter_lower', 5750, 0, 'ps_rf_6c')->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'P-2 (d) counter replay'; END IF;
  v_failed := false;
  BEGIN PERFORM public.gig_refund_quote(v_c, 'counter_lower'); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'P-2 (d) a second counter refund was quoted'; END IF;
  -- A partially refunded hold still refuses every other branch.
  v_failed := false;
  BEGIN PERFORM public.gig_refund_quote(v_c, 'resolved_partial'); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'P-2 (d) the partially_refunded guard opened for resolved_partial'; END IF;

  -- ── T-N1 self-initiated actions do not notify the actor; expiry; no-money close.
  v_c := pg_temp.hire(7, false);
  PERFORM pg_temp.refund(v_c, 'host_before_accept', 'ps_rf_7');
  IF pg_temp.notes(v_c, 'creator.gig.offer_cancelled') <> 1
     OR EXISTS (SELECT 1 FROM public.notification_outbox o JOIN public.gig_events e ON e.contract_id = v_c AND e.kind = 'refund_recorded'
                 WHERE o.payload->>'contract_id' = v_c::text AND o.category_key LIKE 'business.%' AND o.idempotency_key LIKE '%' || e.id::text || '%') THEN
    RAISE EXCEPTION 'N-1 host_before_accept: the host was told about their own cancel';
  END IF;
  IF (pg_temp.reoffer(7, 'host_before_accept')->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after host_before_accept'; END IF;

  v_c := pg_temp.hire(8, false);
  PERFORM pg_temp.refund(v_c, 'creator_decline', 'ps_rf_8');
  IF pg_temp.notes(v_c, 'creator.gig.cancelled') <> 0 OR pg_temp.body(v_c, 'business.gig.declined_refunded') NOT LIKE '%' || v_open THEN
    RAISE EXCEPTION 'N-1 creator_decline: %', pg_temp.body(v_c, 'business.gig.declined_refunded');
  END IF;
  IF (pg_temp.reoffer(8, 'creator_decline')->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after creator_decline'; END IF;

  v_c := pg_temp.hire(9, false);
  UPDATE public.gig_contracts SET state_deadline_at = now() - interval '1 minute' WHERE id = v_c;
  PERFORM pg_temp.refund(v_c, 'declined_or_expired', 'ps_rf_9');
  IF (SELECT state FROM public.gig_contracts WHERE id = v_c) <> 'expired'
     OR pg_temp.title(v_c, 'creator.gig.cancelled') <> 'This offer expired' OR pg_temp.body(v_c, 'creator.gig.cancelled') <> 'You didn''t answer in time.'
     OR pg_temp.notes(v_c, 'business.gig.declined_refunded') < 1 THEN
    RAISE EXCEPTION 'N-1 expiry notices';
  END IF;
  IF (pg_temp.reoffer(9, 'declined_or_expired')->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after expiry'; END IF;

  -- A missed post with nothing held closes with no money; both sides hear it
  -- and the interest (left 'offered') can still be offered again.
  v_c := pg_temp.hire(10, false, false);
  PERFORM public.issue_3872_contract_apply_state(v_c, 'approved', now() - interval '1 minute', NULL, NULL, NULL);
  v_answer := public.gig_refund_claim(v_c, 'post_missed');
  IF (v_answer->>'closed_without_refund')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'post_missed_closed: %', v_answer; END IF;
  IF pg_temp.title(v_c, 'creator.gig.post_missed') <> 'This gig was closed' OR pg_temp.body(v_c, 'creator.gig.post_missed') <> 'The deadline passed.'
     OR pg_temp.title(v_c, 'business.gig.post_missed') <> 'The creator missed the deadline'
     OR pg_temp.body(v_c, 'business.gig.post_missed') <> 'Nothing was charged. ' || v_open THEN
    RAISE EXCEPTION 'N-1 post_missed_closed notices: %', pg_temp.body(v_c, 'business.gig.post_missed');
  END IF;
  IF (SELECT status FROM public.gig_interest WHERE id = '44300000-0000-4000-8000-0000000b0010') <> 'offered' THEN RAISE EXCEPTION 'post_missed_closed fixture shape'; END IF;
  IF (pg_temp.reoffer(10, 'post_missed_closed')->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Q1 re-offer after a no-money close'; END IF;
  -- A live, paid hire still blocks a second offer.
  v_c2 := (SELECT id FROM public.gig_contracts WHERE gig_id = '44300000-0000-4000-8000-0000000a0010' AND state = 'offered');
  PERFORM public.gig_hold_set_provider_ref(v_c2, 1, 'gig_hold', 'ps_i4430_10b');
  PERFORM public.gig_hold_mark_captured(v_c2, 1, 'ps_i4430_10b');
  PERFORM pg_temp.act(v_host);
  v_answer := public.gig_offer_prepare('44300000-0000-4000-8000-0000000b0010', '{"fee_minor":20000,"rights_accepted":true}'::jsonb, 'i4430-second-10');
  PERFORM pg_temp.act(NULL);
  IF v_answer->>'error' IS DISTINCT FROM 'already_offered' THEN RAISE EXCEPTION 'Q1 a live contract allowed a second offer: %', v_answer; END IF;

  -- ── Item 3: the script-locked push names the agreed upload deadline. ────
  v_c := pg_temp.hire(11, false);
  -- The push names the current terms' agreed due in the gig zone, with a
  -- plain-English zone label.
  INSERT INTO public.gig_events(contract_id, actor, kind, data) VALUES (v_c, 'host', 'lock_script', '{}'::jsonb);
  v_body := pg_temp.body(v_c, 'creator.gig.script_locked');
  IF v_body IS DISTINCT FROM 'The agreed script is locked. Film and upload by '
       || public.issue_4402_gig_when((SELECT video_due_at FROM public.gig_terms_versions WHERE contract_id = v_c), 'Africa/Lagos') || '.'
     OR v_body NOT LIKE '%Lagos time.' THEN
    RAISE EXCEPTION 'item 3 script_locked body: %', v_body;
  END IF;
  IF public.issue_4402_gig_when('2026-12-15T11:00:00Z', 'Africa/Lagos') <> 'Tue Dec 15, 12:00 PM Lagos time' THEN RAISE EXCEPTION 'item 3 zone words'; END IF;
  IF v_body LIKE '%two days%' OR v_body ~ '[A-Za-z]+/[A-Za-z_]+' THEN RAISE EXCEPTION 'item 3 body has a fixed gap or a zone slug: %', v_body; END IF;

  -- ── I-4430-P2 across every fixture: no refund difference ends superseded.
  IF EXISTS (SELECT 1 FROM public.gig_hold_adjustments WHERE kind = 'refund' AND status = 'superseded') THEN
    RAISE EXCEPTION 'I-4430-P2 a refund adjustment ended superseded';
  END IF;
  -- I-4430-N2: none of the gig shares above sent referral news.
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key LIKE '%referral%') THEN
    RAISE EXCEPTION 'I-4430-N2 a gig share created a referral notice';
  END IF;
  UPDATE public.payee_shares SET status = 'paid' WHERE order_kind = 'gig' AND payee_user_id = v_creator;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key LIKE '%referral%') THEN
    RAISE EXCEPTION 'I-4430-N2 a paid gig share created a referral notice';
  END IF;
END;
$test$;

-- ── T-P1: the sweep promotes accumulated gig and Local shares. ─────────────
-- Shares are written directly (replica role skips the share guard) for a
-- payee who has a verified Paystack account. NGN floor: 100000.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id, email) VALUES
  ('44300000-0000-4000-8000-0000000000c1', 'i4430-payee@test.local'),
  ('44300000-0000-4000-8000-0000000000c2', 'i4430-local@test.local');
INSERT INTO public.payee_accounts(user_id, paystack_status, paystack_recipient_code) VALUES
  ('44300000-0000-4000-8000-000000000002', 'verified', 'RCP_i4430_payee'),
  ('44300000-0000-4000-8000-0000000000c2', 'verified', 'RCP_i4430_local');
-- Three settled gig contracts from the block above (each first hire on its
-- gig ended cancelled); the third gets a dispute that is still open.
CREATE TEMP TABLE i4430_fx ON COMMIT DROP AS
SELECT n, (SELECT c.id FROM public.gig_contracts c WHERE c.gig_id = ('44300000-0000-4000-8000-0000000a' || lpad(n::text, 4, '0'))::uuid AND c.state IN ('cancelled', 'declined')) AS contract_id
FROM (VALUES (3), (4), (7), (8)) v(n);
INSERT INTO public.gig_disputes(contract_id, opened_by, reason, statement, status)
SELECT contract_id, 'host', 'other', 'Still open for this test.', 'escalated' FROM i4430_fx WHERE n = 4;
INSERT INTO public.payee_shares(id, order_kind, order_id, payee_kind, payee_user_id, rail, currency, gross_minor, mingla_fee_minor, net_minor, status, release_after) VALUES
  ('44300000-0000-4000-8000-0000000000e1', 'gig', (SELECT contract_id FROM i4430_fx WHERE n = 3), 'gig_fee', '44300000-0000-4000-8000-000000000002', 'paystack', 'NGN', 10000, 0, 10000, 'accumulating', now() - interval '1 day'),
  ('44300000-0000-4000-8000-0000000000e3', 'gig', (SELECT contract_id FROM i4430_fx WHERE n = 4), 'gig_fee', '44300000-0000-4000-8000-000000000002', 'paystack', 'NGN', 10000, 0, 10000, 'accumulating', now() - interval '1 day'),
  -- A ticket referral share with no release item: must never be promoted.
  ('44300000-0000-4000-8000-0000000000e4', 'ticket', gen_random_uuid(), 'referral', '44300000-0000-4000-8000-000000000002', 'paystack', 'NGN', 100000, 5000, 95000, 'accumulating', now() - interval '1 day');
-- A Local month that is approved but not yet published, with its share.
INSERT INTO public.place_pool(id, name, lat, lng) VALUES ('44300000-0000-4000-8000-0000000000f3', 'Issue 4430 Place', 6.5, 3.4);
INSERT INTO public.locals(id, user_id, city_id, agreement_version) VALUES
  ('44300000-0000-4000-8000-0000000000f1', '44300000-0000-4000-8000-0000000000c2', '44300000-0000-4000-8000-000000000005', 'v1');
INSERT INTO public.local_months(id, local_id, month, status, place_id, payee_share_id, payout_currency, payout_amount_minor, fx_snapshot_id) VALUES
  ('44300000-0000-4000-8000-0000000000f2', '44300000-0000-4000-8000-0000000000f1', date_trunc('month', current_date)::date, 'approved', '44300000-0000-4000-8000-0000000000f3', '44300000-0000-4000-8000-0000000000e5', 'NGN', 100000, gen_random_uuid());
INSERT INTO public.payee_shares(id, order_kind, order_id, payee_kind, payee_user_id, rail, currency, gross_minor, mingla_fee_minor, net_minor, status, release_after) VALUES
  ('44300000-0000-4000-8000-0000000000e5', 'local_month', '44300000-0000-4000-8000-0000000000f2', 'local_month', '44300000-0000-4000-8000-0000000000c2', 'paystack', 'NGN', 100000, 0, 100000, 'accumulating', now() - interval '1 day');
SET LOCAL session_replication_role = origin;

DO $p1$
DECLARE v_n integer; v_payout public.payee_payouts;
BEGIN
  PERFORM pg_temp.act(NULL);
  -- 1. One 10000 gig share under the floor: no payout, it stays accumulating.
  PERFORM * FROM public.payee_prepare_payout_sweep(now(), 50);
  IF (SELECT count(*) FROM public.payee_payouts WHERE payee_user_id IN ('44300000-0000-4000-8000-000000000002', '44300000-0000-4000-8000-0000000000c2')) <> 0 THEN
    RAISE EXCEPTION 'T-P1 step 1: a payout under the floor or before the Local month was published';
  END IF;
  IF (SELECT status FROM public.payee_shares WHERE id = '44300000-0000-4000-8000-0000000000e1') <> 'accumulating'
     OR (SELECT status FROM public.payee_shares WHERE id = '44300000-0000-4000-8000-0000000000e5') <> 'accumulating' THEN
    RAISE EXCEPTION 'T-P1 step 1 statuses';
  END IF;
  -- 2. A 95000 releasable gig share arrives: one payout with both gig shares
  --    (105000 gross). 3. The share on the open dispute stays out. 5. The
  --    ticket share with no release item stays out.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.payee_shares(id, order_kind, order_id, payee_kind, payee_user_id, rail, currency, gross_minor, mingla_fee_minor, net_minor, status, release_after) VALUES
    ('44300000-0000-4000-8000-0000000000e2', 'gig', (SELECT contract_id FROM i4430_fx WHERE n = 7), 'gig_fee', '44300000-0000-4000-8000-000000000002', 'paystack', 'NGN', 95000, 0, 95000, 'releasable', now() - interval '1 day');
  SET LOCAL session_replication_role = origin;
  PERFORM * FROM public.payee_prepare_payout_sweep(now(), 50);
  SELECT * INTO v_payout FROM public.payee_payouts WHERE payee_user_id = '44300000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 OR v_payout.gross_share_minor <> 105000 THEN RAISE EXCEPTION 'T-P1 step 2 payout: n=% gross=%', v_n, v_payout.gross_share_minor; END IF;
  IF (SELECT array_agg(share_id ORDER BY share_id) FROM public.payee_payout_items WHERE payout_id = v_payout.id)
     <> ARRAY['44300000-0000-4000-8000-0000000000e1', '44300000-0000-4000-8000-0000000000e2']::uuid[] THEN
    RAISE EXCEPTION 'T-P1 step 2 items';
  END IF;
  IF (SELECT status FROM public.payee_shares WHERE id = '44300000-0000-4000-8000-0000000000e3') <> 'accumulating'
     OR (SELECT payout_id FROM public.payee_shares WHERE id = '44300000-0000-4000-8000-0000000000e3') IS NOT NULL THEN
    RAISE EXCEPTION 'T-P1 step 3: a share on an open dispute was promoted';
  END IF;
  IF (SELECT status FROM public.payee_shares WHERE id = '44300000-0000-4000-8000-0000000000e4') <> 'accumulating' THEN
    RAISE EXCEPTION 'T-P1 step 5: a ticket share with no release item was promoted';
  END IF;
  -- 3b. Once the dispute is decided the share is promoted (alone it is under the floor).
  UPDATE public.gig_disputes SET status = 'decided', decided_outcome = 'partial_refund', decided_refund_bps = 5000, decided_at = now()
   WHERE contract_id = (SELECT contract_id FROM i4430_fx WHERE n = 4) AND status = 'escalated';
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.payee_shares(id, order_kind, order_id, payee_kind, payee_user_id, rail, currency, gross_minor, mingla_fee_minor, net_minor, status, release_after) VALUES
    ('44300000-0000-4000-8000-0000000000e6', 'gig', (SELECT contract_id FROM i4430_fx WHERE n = 8), 'gig_fee', '44300000-0000-4000-8000-000000000002', 'paystack', 'NGN', 95000, 0, 95000, 'releasable', now() - interval '1 day');
  SET LOCAL session_replication_role = origin;
  PERFORM * FROM public.payee_prepare_payout_sweep(now(), 50);
  IF (SELECT payout_id FROM public.payee_shares WHERE id = '44300000-0000-4000-8000-0000000000e3') IS NULL THEN
    RAISE EXCEPTION 'T-P1 step 3b: the share was not paid after the dispute was decided';
  END IF;
  -- 4. Local: promoted only once the month is published, then paid.
  SET LOCAL session_replication_role = replica;
  UPDATE public.local_months SET status = 'published' WHERE id = '44300000-0000-4000-8000-0000000000f2';
  SET LOCAL session_replication_role = origin;
  PERFORM * FROM public.payee_prepare_payout_sweep(now(), 50);
  IF NOT EXISTS (SELECT 1 FROM public.payee_payout_items i JOIN public.payee_payouts p ON p.id = i.payout_id
                  WHERE i.share_id = '44300000-0000-4000-8000-0000000000e5' AND p.gross_share_minor = 100000) THEN
    RAISE EXCEPTION 'T-P1 step 4: the published Local share was not paid';
  END IF;
END;
$p1$;

-- ── T-N2: a Local share and its payment send no referral news; a referral
-- share still does. ─────────────────────────────────────────────────────────
DO $n2$
DECLARE v_offer uuid := '44300000-0000-4000-8000-000000000101'; v_member uuid := '44300000-0000-4000-8000-000000000102';
BEGIN
  DELETE FROM public.notification_outbox WHERE category_key LIKE '%referral%';
  UPDATE public.payee_shares SET status = 'paid' WHERE id = '44300000-0000-4000-8000-0000000000e5';
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key LIKE '%referral%') THEN RAISE EXCEPTION 'T-N2 a Local share created referral news'; END IF;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.referral_offers(id, brand_id, name, audience, scope_kind, reward_kind, share_bps, currency, created_by)
  VALUES (v_offer, '44300000-0000-4000-8000-000000000004', 'Friends of 4430', 'both', 'brand', 'cash', 500, 'NGN', '44300000-0000-4000-8000-000000000001');
  INSERT INTO public.referral_members(id, offer_id, brand_id, role, display_name, link_slug, email_norm, status)
  VALUES (v_member, v_offer, '44300000-0000-4000-8000-000000000004', 'creator', 'Tobi', 'tobi4430', 'tobi.i4430@test.local', 'active');
  SET LOCAL session_replication_role = origin;
  ALTER TABLE public.payee_shares DISABLE TRIGGER payee_shares_guard;
  INSERT INTO public.payee_shares(order_kind, order_id, payee_kind, member_id, brand_id, payee_email_norm, rail, currency, gross_minor, mingla_fee_minor, net_minor, status, release_after)
  VALUES ('ticket', gen_random_uuid(), 'referral', v_member, '44300000-0000-4000-8000-000000000004', 'tobi.i4430@test.local', 'paystack', 'NGN', 10000, 500, 9500, 'pending', now());
  ALTER TABLE public.payee_shares ENABLE TRIGGER payee_shares_guard;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'business.referral.sale' AND payload->>'body' = 'Tobi earned a reward from Friends of 4430.') THEN
    RAISE EXCEPTION 'T-N2 a referral share no longer sends business.referral.sale';
  END IF;
END;
$n2$;

-- ── T-L1: the Local review evidence rules. ──────────────────────────────────
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id, email) VALUES ('44300000-0000-4000-8000-0000000000c3', 'i4430-other@test.local');
UPDATE public.locals SET agreement_signed_at = now(), agreement_acceptance_id = gen_random_uuid() WHERE id = '44300000-0000-4000-8000-0000000000f1';
UPDATE public.local_months SET status = 'visited', payee_share_id = NULL, payout_currency = NULL, payout_amount_minor = NULL, fx_snapshot_id = NULL WHERE id = '44300000-0000-4000-8000-0000000000f2';
INSERT INTO public.creator_media_jobs(id, client_operation_id, owner_kind, owner_id, purpose, local_month_id, status, duration_s, ready_at) VALUES
  ('44300000-0000-4000-8000-000000000201', gen_random_uuid(), 'local', '44300000-0000-4000-8000-0000000000c2', 'local_review', '44300000-0000-4000-8000-0000000000f2', 'ready', 40, now()),
  ('44300000-0000-4000-8000-000000000202', gen_random_uuid(), 'local', '44300000-0000-4000-8000-0000000000c3', 'local_review', '44300000-0000-4000-8000-0000000000f2', 'ready', 40, now()),
  ('44300000-0000-4000-8000-000000000203', gen_random_uuid(), 'local', '44300000-0000-4000-8000-0000000000c2', 'local_review', '44300000-0000-4000-8000-0000000000f2', 'processing', 40, NULL);
SET LOCAL session_replication_role = origin;

DO $l1$
DECLARE v_code text; v_body text := repeat('A fair and honest review of the place. ', 10);
BEGIN
  PERFORM pg_temp.act('44300000-0000-4000-8000-0000000000c2');
  -- Evidence must be the Local's own ready video for this month.
  BEGIN
    PERFORM public.local_review_submit('44300000-0000-4000-8000-0000000000f2', 5, 'Worth the trip', v_body, current_date, NULL,
      ARRAY['44300000-0000-4000-8000-000000000202']::uuid[], 'https://www.instagram.com/reel/TEST4430local/', true);
    v_code := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code <> 'review_evidence_invalid' THEN RAISE EXCEPTION 'T-L1 evidence rule (owner): %', v_code; END IF;
  BEGIN
    PERFORM public.local_review_submit('44300000-0000-4000-8000-0000000000f2', 5, 'Worth the trip', v_body, current_date, NULL,
      ARRAY['44300000-0000-4000-8000-000000000203']::uuid[], 'https://www.instagram.com/reel/TEST4430local/', true);
    v_code := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code <> 'review_evidence_invalid' THEN RAISE EXCEPTION 'T-L1 evidence rule (ready): %', v_code; END IF;
  -- A link off the supported hosts is refused with its own code.
  BEGIN
    PERFORM public.local_review_submit('44300000-0000-4000-8000-0000000000f2', 5, 'Worth the trip', v_body, current_date, NULL,
      ARRAY['44300000-0000-4000-8000-000000000201']::uuid[], 'https://example.com/reel/1', true);
    v_code := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM; END;
  IF v_code <> 'social_post_url_not_allowed' THEN RAISE EXCEPTION 'T-L1 link check: %', v_code; END IF;
  -- Valid input behaves as before.
  IF (public.local_review_submit('44300000-0000-4000-8000-0000000000f2', 5, 'Worth the trip', v_body, current_date, NULL,
      ARRAY['44300000-0000-4000-8000-000000000201']::uuid[], 'https://www.instagram.com/reel/TEST4430local/', true)->>'status') <> 'submitted' THEN
    RAISE EXCEPTION 'T-L1 a valid review was refused';
  END IF;
  PERFORM pg_temp.act(NULL);
END;
$l1$;

ROLLBACK;
\echo 'issue #4430 gig money, notices, re-offer and Local review passed'
