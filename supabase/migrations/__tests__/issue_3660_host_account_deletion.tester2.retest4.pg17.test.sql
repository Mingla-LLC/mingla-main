\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- INDEPENDENT TESTER (tester2) suite for rework 4, written by the tester.
--
--   E  Earlier provider targets are handed out only when they are still safe
--      for THIS account today. One Host is deleted with seven brands; then, with
--      the real support functions and the writes the onboarding functions
--      make, each brand ends up somewhere different:
--        K   untouched                                   -> still returned
--        T1  restored, reassigned to another owner, payouts reconnected
--            (same Stripe account id, soft detach cleared) -> NOT returned
--        T2  restored and reassigned, not reconnected      -> NOT returned
--        R1  Stripe row now carries a different account id -> NOT returned
--        A1  still deleted and still this Host's, but its Stripe row is
--            attached again                                -> NOT returned
--        P1  Paystack payout recipient active again         -> NOT returned
--        P3  Paystack untouched                             -> still returned
--      Asserted three ways: on a retry while the account is still marked
--      deleted, on a fresh deletion after sign-in recovery, and for the audit
--      trail (each row records only what its own run detached).
--      A second Host has brands restored to the SAME owner: before the next
--      deletion they are not earlier targets (reconnected or not).
--      A co-owner of a deleted brand gets no target at all.
--      Audit entries with no brand id, a brand id that is not a uuid, a brand
--      of somebody else, or that are not objects, are never returned.
--
--   D  Disputes, against the REAL payout sweep (the tester's own fixtures):
--        lost in full            -> does not block; the sweep ledgers nothing
--        two losses = the total  -> does not block; nothing ledgered
--        lost in part            -> blocks; the sweep ledgers the remainder;
--                                   released -> no longer blocks
--        won                     -> blocks until released
--        still open              -> blocks (money in motion)
--      for ticket orders and for menu orders.
--
-- Runs as supabase_admin (session_replication_role for the money fixtures).
-- Everything is rolled back.
BEGIN;
CREATE TEMP TABLE fx(name text, brand uuid, expect text, rule boolean, swept boolean, rule_after_release boolean);
-- %1 brand, %2 dated ended event, %3 dateless event, %4 owner, %5 source id
CREATE FUNCTION pg_temp.fx(p_name text, p_expect text, p_sql text, p_provider text DEFAULT 'stripe', p_hold boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); e uuid := gen_random_uuid(); e0 uuid := gen_random_uuid(); sid uuid := gen_random_uuid(); sfx text := replace(gen_random_uuid()::text,'-','');
BEGIN
  INSERT INTO auth.users(id) VALUES (a);
  INSERT INTO public.creator_accounts(id,email) VALUES (a,'t2f-'||left(sfx,10)||'@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES (b,a,'T2F','t2f-'||sfx,'USD');
  SET LOCAL session_replication_role = replica;
  UPDATE public.brands SET payment_provider = p_provider, payout_hold_cutover_at = CASE WHEN p_hold THEN now() - interval '30 days' END WHERE id=b;
  INSERT INTO public.events(id,brand_id,created_by,title,slug,status) VALUES (e,b,a,'T2F Ended','t2f-e-'||sfx,'scheduled'),(e0,b,a,'T2F Dateless','t2f-0-'||sfx,'draft');
  INSERT INTO public.event_dates(event_id,start_at,end_at) VALUES (e, now()-interval '9 days', now()-interval '8 days');
  EXECUTE format(p_sql, b, e, e0, a, sid);
  SET LOCAL session_replication_role = origin;
  INSERT INTO fx(name, brand, expect) VALUES (p_name, b, p_expect);
END $fn$;
DO $$
DECLARE
  ord text := $q$INSERT INTO public.orders (id,event_id,buyer_email,buyer_name,total_cents,refunded_amount_cents,currency,payment_status,source,payment_method,stripe_payment_intent_id,created_at) VALUES (%5$L, %2$L, 't2f@example.test','T2F', 5000, 0,'USD','paid','legacy','online_card','pi_t2f_'||left(%5$L::text,8), now() - interval '9 days'); INSERT INTO public.payout_source_fee_snapshots (id, source_type, source_id, provider_fee_cents, captured_at) VALUES (gen_random_uuid(), 'order', %5$L, 0, now())$q$;
  menu text := $q$INSERT INTO public.venue_orders (id, session_id, brand_id, venue_id, qr_spot_id, source, money_path, currency, subtotal_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents, idempotency_key, payment_status, fulfillment_status, acknowledged_at, acknowledged_by_user_id, confirmed_at, created_at, provider, stripe_payment_intent_id, buyer_name, buyer_email, buyer_phone_e164) VALUES (%5$L, gen_random_uuid(), %1$L, gen_random_uuid(), gen_random_uuid(), 'guest_qr', 'mingla', 'USD', 1000, 0, 0, false, false, false, 1000, 1000, 't2f-' || gen_random_uuid()::text, 'paid', 'delivered', now() - interval '5 days', gen_random_uuid(), now() - interval '5 days', now() - interval '5 days', 'stripe', 'pi_t2fm_'||left(%5$L::text,8), 'T2F', 't2f@example.test', '+12015550196'); INSERT INTO public.payout_source_fee_snapshots (id, source_type, source_id, provider_fee_cents, captured_at) VALUES (gen_random_uuid(), 'venue_menu_order', %5$L, 0, now())$q$;
  -- %s column (order_id | venue_order_id), %s amount, %L status, %L suffix
  disp text := $q$; INSERT INTO public.stripe_disputes (stripe_dispute_id, stripe_charge_id, stripe_account_id, %s, amount, currency, status, reason, raw_event) VALUES ('dp_t2f_'||left(%%5$L::text,8)||%L, 'ch_t2f', 'acct_t2f', %%5$L, %s, 'usd', %L, 'fraudulent', '{}'::jsonb)$q$;
BEGIN
  PERFORM pg_temp.fx('order, dispute LOST in full', 'neither', ord || format(disp,'order_id','a','5000','lost'));
  PERFORM pg_temp.fx('order, two disputes LOST adding up to the total', 'neither', ord || format(disp,'order_id','a','2000','lost') || format(disp,'order_id','b','3000','lost'));
  PERFORM pg_temp.fx('order, dispute LOST for 2000 of 5000', 'both', ord || format(disp,'order_id','a','2000','lost'));
  PERFORM pg_temp.fx('order, dispute WON', 'both', ord || format(disp,'order_id','a','5000','won'));
  PERFORM pg_temp.fx('order, dispute closed as a warning', 'both', ord || format(disp,'order_id','a','5000','warning_closed'));
  PERFORM pg_temp.fx('order, dispute OPEN (needs_response)', 'rule-only', ord || format(disp,'order_id','a','5000','needs_response'));
  PERFORM pg_temp.fx('order, dispute OPEN (under_review)', 'rule-only', ord || format(disp,'order_id','a','5000','under_review'));
  PERFORM pg_temp.fx('order, one LOST for 2000 and one OPEN for 3000', 'rule-only', ord || format(disp,'order_id','a','2000','lost') || format(disp,'order_id','b','3000','needs_response'));
  PERFORM pg_temp.fx('menu order, dispute LOST in full', 'neither', menu || format(disp,'venue_order_id','a','1000','lost'));
  PERFORM pg_temp.fx('menu order, dispute LOST for 400 of 1000', 'both', menu || format(disp,'venue_order_id','a','400','lost'));
  PERFORM pg_temp.fx('menu order, dispute WON', 'both', menu || format(disp,'venue_order_id','a','1000','won'));
  PERFORM pg_temp.fx('menu order, dispute OPEN', 'rule-only', menu || format(disp,'venue_order_id','a','1000','needs_response'));
END $$;

UPDATE fx SET rule = EXISTS (
  SELECT 1 FROM private.host_account_unreleased_held_money(ARRAY[fx.brand], ARRAY[]::uuid[]));
SELECT set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.run_payout_release_dark_sweep(now() + interval '60 days') IS NOT NULL AS sweep_ran;
UPDATE fx SET swept = EXISTS (
  SELECT 1 FROM public.payout_release_items i
  JOIN public.brand_payout_releases pr ON pr.id = i.release_id
  WHERE pr.brand_id = fx.brand);
SET LOCAL session_replication_role = replica;
UPDATE public.brand_payout_releases pr SET status = 'released', released_at = now()
 WHERE pr.brand_id IN (SELECT brand FROM fx);
SET LOCAL session_replication_role = origin;
UPDATE fx SET rule_after_release = EXISTS (
  SELECT 1 FROM private.host_account_unreleased_held_money(ARRAY[fx.brand], ARRAY[]::uuid[]));

DO $$
DECLARE
  v_wrong text;
BEGIN
  IF (SELECT count(*) FROM fx) <> 12 THEN
    RAISE EXCEPTION 't2f 3660 D: expected 12 fixtures';
  END IF;
  SELECT string_agg(
    format('[%s] expected %s, got rule=%s sweep=%s still-blocked-after-release=%s',
           name, expect, rule, swept, rule_after_release), ' || ' ORDER BY name)
  INTO v_wrong
  FROM fx
  WHERE NOT CASE expect
    WHEN 'both' THEN rule AND swept AND NOT rule_after_release
    WHEN 'neither' THEN NOT rule AND NOT swept
    WHEN 'rule-only' THEN rule AND NOT swept
    ELSE false END;
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 't2f 3660 D: disputes — the money rule and the payout sweep DISAGREE: %', v_wrong;
  END IF;
  RAISE NOTICE 'issue_3660 tester2 retest4: disputes agree with the sweep on 12 fixtures';
END;
$$;

-- E ---------------------------------------------------------------------------
CREATE TEMP TABLE t2f_br(tag text PRIMARY KEY, id uuid DEFAULT gen_random_uuid());
INSERT INTO t2f_br(tag) VALUES ('K'), ('T1'), ('T2'), ('R1'), ('A1'), ('P1'), ('P3'), ('GK'), ('S1'), ('S2');
GRANT SELECT ON t2f_br TO PUBLIC;

CREATE FUNCTION pg_temp.t2f_claims(p_role text, p_sub uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_sub::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_sub IS NULL THEN jsonb_build_object('role', p_role)::text
         ELSE jsonb_build_object('role', p_role, 'sub', p_sub)::text END, true);
END;
$fn$;
-- Which brand tags an answer's target list names.
CREATE FUNCTION pg_temp.t2f_tags(p_list jsonb) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE(string_agg(COALESCE(b.tag, '?' || (x->>'brand_id')), ',' ORDER BY b.tag), '')
  FROM jsonb_array_elements(COALESCE(p_list, '[]'::jsonb)) x
  LEFT JOIN t2f_br b ON b.id::text = x->>'brand_id';
$fn$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

DO $$
DECLARE
  v_h uuid := gen_random_uuid();    -- Host with brands K, T1, T2, R1, P1, P3
  v_g uuid := gen_random_uuid();    -- Host with brands GK, S1, S2
  v_n uuid := gen_random_uuid();    -- the owner brands get reassigned to
  v_co uuid := gen_random_uuid();   -- co-owner role on K
  v_adm uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_first jsonb;
  v_r jsonb;
  v_direct jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_h, 't2f-h-' || v_sfx || '@example.test'), (v_g, 't2f-g-' || v_sfx || '@example.test'),
    (v_n, 't2f-n-' || v_sfx || '@example.test'), (v_co, 't2f-co-' || v_sfx || '@example.test'),
    (v_adm, 't2f-adm-' || v_sfx || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  SELECT u.id, u.email FROM auth.users u WHERE u.id IN (v_h, v_g, v_n, v_co, v_adm);
  INSERT INTO public.admin_users(email, status)
  VALUES ('t2f-adm-' || v_sfx || '@example.test', 'active');

  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  SELECT b.id, CASE WHEN b.tag IN ('GK', 'S1', 'S2') THEN v_g ELSE v_h END,
         'T2F ' || b.tag, 't2f-' || lower(b.tag) || '-' || v_sfx, 'USD'
  FROM t2f_br b;
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  SELECT b.id, v_co, 'brand_owner', now(), now() FROM t2f_br b WHERE b.tag = 'K';
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  SELECT b.id, 'acct_t2f_' || b.tag || '_' || left(v_sfx, 8), 'US', 'USD'
  FROM t2f_br b WHERE b.tag IN ('K', 'T1', 'T2', 'R1', 'A1', 'GK', 'S1', 'S2');
  UPDATE public.brands br SET paystack_subaccount_code = 'ACCT_t2f_' || b.tag || '_' || left(v_sfx, 8)
  FROM t2f_br b WHERE b.id = br.id AND b.tag IN ('K', 'P1', 'P3');
  INSERT INTO public.brand_paystack_recipients
    (brand_id, recipient_code, bank_code, account_fingerprint, account_number_masked, account_name)
  SELECT b.id, 'RCP_t2f_' || b.tag || '_' || left(v_sfx, 8), '000',
         'hmac-sha256:' || repeat('d', 64), '••••0000', 'T2F'
  FROM t2f_br b WHERE b.tag IN ('P1', 'P3');

  -- Both Hosts are deleted.
  PERFORM pg_temp.t2f_claims('service_role', NULL);
  v_first := public.biz_delete_host_account(v_h);
  IF pg_temp.t2f_tags(v_first->'stripe_accounts') <> 'A1,K,R1,T1,T2'
     OR pg_temp.t2f_tags(v_first->'paystack_subaccounts') <> 'K,P1,P3' THEN
    RAISE EXCEPTION 't2f 3660 E fixture: first deletion targets wrong: stripe [%] paystack [%]',
      pg_temp.t2f_tags(v_first->'stripe_accounts'), pg_temp.t2f_tags(v_first->'paystack_subaccounts');
  END IF;
  v_r := public.biz_delete_host_account(v_g);
  IF pg_temp.t2f_tags(v_r->'stripe_accounts') <> 'GK,S1,S2' THEN
    RAISE EXCEPTION 't2f 3660 E fixture: second Host targets wrong: %', v_r;
  END IF;

  -- Time passes. Support restores and reassigns (the real functions) ...
  PERFORM pg_temp.t2f_claims('authenticated', v_adm);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_brand_deleted(b.id, false, 't2f support restore')
  FROM t2f_br b WHERE b.tag IN ('T1', 'T2', 'S1', 'S2');
  PERFORM public.admin_reassign_brand_owner(b.id, v_n, 't2f reassign to the new owner')
  FROM t2f_br b WHERE b.tag IN ('T1', 'T2');
  RESET ROLE;
  -- ... owners reconnect payouts (brand-stripe-onboard, same-country branch:
  -- same account id, soft detach cleared) ...
  UPDATE public.stripe_connect_accounts s SET detached_at = NULL, updated_at = now()
  FROM t2f_br b WHERE b.id = s.brand_id AND b.tag IN ('T1', 'S1');
  -- ... on one brand that is still deleted and still this Host's, the Stripe
  -- row is attached again (it is no longer something this deletion detached) ...
  UPDATE public.stripe_connect_accounts s SET detached_at = NULL, updated_at = now()
  FROM t2f_br b WHERE b.id = s.brand_id AND b.tag = 'A1';
  -- ... one Stripe row is re-pointed, one Paystack recipient is active again.
  UPDATE public.stripe_connect_accounts s
     SET stripe_account_id = 'acct_t2f_NEW_' || left(v_sfx, 8)
  FROM t2f_br b WHERE b.id = s.brand_id AND b.tag = 'R1';
  UPDATE public.brand_paystack_recipients r SET is_active = true
  FROM t2f_br b WHERE b.id = r.brand_id AND b.tag = 'P1';

  -- Audit entries nobody could verify.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.audit_log(user_id, action, target_type, target_id, before, after)
  SELECT v_h, 'host_account.deleted', 'creator_account', v_h::text, x.b, '{}'::jsonb
  FROM (VALUES
    (jsonb_build_object('stripe_accounts', jsonb_build_array(
        jsonb_build_object('stripe_account_id', 'acct_t2f_nobrand'),
        jsonb_build_object('brand_id', 'not-a-uuid', 'stripe_account_id', 'acct_t2f_baduuid'),
        jsonb_build_object('brand_id', (SELECT id FROM t2f_br WHERE tag = 'GK'),
                           'stripe_account_id', 'acct_t2f_GK_' || left(v_sfx, 8)),
        jsonb_build_object('brand_id', (SELECT id FROM t2f_br WHERE tag = 'K')),
        'null'::jsonb, '7'::jsonb, '"x"'::jsonb),
      'paystack_subaccounts', jsonb_build_array(
        jsonb_build_object('subaccount_code', 'ACCT_t2f_nobrand'),
        jsonb_build_object('brand_id', (SELECT id FROM t2f_br WHERE tag = 'GK'),
                           'subaccount_code', 'ACCT_t2f_other')))),
    ('"a string"'::jsonb),
    (NULL::jsonb)
  ) AS x(b);
  SET LOCAL session_replication_role = origin;

  -- (1) A retry while the Host is still marked deleted.
  PERFORM pg_temp.t2f_claims('service_role', NULL);
  v_r := public.biz_delete_host_account(v_h);
  IF (v_r->>'already_deleted')::boolean IS NOT TRUE
     OR pg_temp.t2f_tags(v_r->'stripe_accounts') <> 'K'
     OR pg_temp.t2f_tags(v_r->'paystack_subaccounts') <> 'K,P3'
     OR jsonb_array_length(v_r->'stripe_accounts') <> 1
     OR jsonb_array_length(v_r->'paystack_subaccounts') <> 2 THEN
    RAISE EXCEPTION 't2f 3660 E: a RETRY returned a target that is not safe for this account today. stripe [%] paystack [%] raw %',
      pg_temp.t2f_tags(v_r->'stripe_accounts'), pg_temp.t2f_tags(v_r->'paystack_subaccounts'), v_r;
  END IF;

  -- (2) The Host reopens the app (sign-in recovery, through RLS) and deletes again.
  PERFORM pg_temp.t2f_claims('authenticated', v_h);
  SET LOCAL ROLE authenticated;
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_h;
  RESET ROLE;
  PERFORM pg_temp.t2f_claims('service_role', NULL);
  v_r := public.biz_delete_host_account(v_h);
  IF (v_r->>'already_deleted')::boolean IS NOT FALSE
     OR pg_temp.t2f_tags(v_r->'stripe_accounts') <> 'K'
     OR pg_temp.t2f_tags(v_r->'paystack_subaccounts') <> 'K,P3'
     OR jsonb_array_length(v_r->'stripe_accounts') <> 1 THEN
    RAISE EXCEPTION 't2f 3660 E: a FRESH deletion returned a target that is not safe for this account today. stripe [%] paystack [%] raw %',
      pg_temp.t2f_tags(v_r->'stripe_accounts'), pg_temp.t2f_tags(v_r->'paystack_subaccounts'), v_r;
  END IF;
  -- That run detached nothing itself, and its audit row says so: K's Stripe
  -- account is recorded by exactly one row (the first deletion), and a row
  -- with empty lists exists for the later run. (Rows of one transaction share
  -- a timestamp, so "the newest row" is not a usable test here.)
  IF (SELECT count(*) FROM public.audit_log al
       WHERE al.action = 'host_account.deleted' AND al.target_id = v_h::text
         AND jsonb_typeof(al.before) = 'object'
         AND al.before->'stripe_accounts' @> jsonb_build_array(jsonb_build_object(
               'brand_id', (SELECT id FROM t2f_br WHERE tag = 'K')))
         AND al.after ? 'events_taken_down') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_log al
       WHERE al.action = 'host_account.deleted' AND al.target_id = v_h::text
         AND al.before = '{"stripe_accounts": [], "paystack_subaccounts": []}'::jsonb
         AND al.after ? 'events_taken_down') THEN
    RAISE EXCEPTION 't2f 3660 E: the later run''s audit row records targets it did not detach itself';
  END IF;
  -- The brands that went to the new owner are exactly as that owner left them.
  IF (SELECT count(*) FROM public.brands br JOIN t2f_br b ON b.id = br.id
       WHERE b.tag IN ('T1', 'T2') AND br.account_id = v_n AND br.deleted_at IS NULL) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.stripe_connect_accounts s JOIN t2f_br b ON b.id = s.brand_id
                    WHERE b.tag = 'T1' AND s.detached_at IS NULL) THEN
    RAISE EXCEPTION 't2f 3660 E: the old owner''s deletions touched a brand that now belongs to somebody else';
  END IF;

  -- (3) Brands restored to the SAME owner are not EARLIER targets, reconnected
  --     (S1) or not (S2): they are live brands again.
  v_direct := private.host_account_earlier_provider_targets(v_g);
  IF pg_temp.t2f_tags(v_direct->'stripe_accounts') <> 'GK' THEN
    RAISE EXCEPTION 't2f 3660 E: brands restored to the same owner are still listed as earlier targets: [%]',
      pg_temp.t2f_tags(v_direct->'stripe_accounts');
  END IF;

  -- (4) A co-owner of a deleted brand is handed nothing.
  v_r := public.biz_delete_host_account(v_co);
  IF jsonb_array_length(v_r->'stripe_accounts') <> 0
     OR jsonb_array_length(v_r->'paystack_subaccounts') <> 0 THEN
    RAISE EXCEPTION 't2f 3660 E: a co-owner''s deletion returned a provider target: %', v_r;
  END IF;

  RAISE NOTICE 'issue_3660 host account deletion tester2 retest4 PASS';
END;
$$;
ROLLBACK;
