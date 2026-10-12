\set ON_ERROR_STOP on
-- Issue #3660 — Host account deletion completes or changes nothing.
-- INDEPENDENT TESTER (tester2) FINAL RETEST suite, written by the tester after
-- rework 3. Two things are proven here, on the tester's own fixtures:
--
--   S  The money rule and the REAL payout sweep agree, arm by arm. For each of
--      21 fixtures (none of them the implementor's) the suite asks the rule
--      (private.host_account_unreleased_held_money) and then runs the real
--      public.run_payout_release_dark_sweep sixty days ahead, and requires:
--        'both'      the rule blocks AND the sweep opens a payout item; once
--                    that payout is released the rule stops blocking, so the
--                    block can always be worked off;
--        'neither'   the rule does not block AND the sweep ledgers nothing
--                    (cash at the door, a sale refunded in full, a sale on an
--                    event with no date, a brand off the hold rail, a provider
--                    reference that belongs to the other provider, ...);
--        'rule-only' the rule blocks and the sweep does not, for exactly the
--                    documented reasons: a payment whose fee has not been
--                    captured yet (it has the provider reference that earns a
--                    fee snapshot), an open dispute, and a collected
--                    instalment while the instalment payout switch is off.
--      A fixture landing in a different class fails the suite and names it.
--      Covered arms: ticket orders (online, card at the door, cash at the
--      door, partial and full refunds, open dispute, both providers), RSVP
--      contributions, venue reservation deposits, menu orders, instalments.
--      Stays are not here: the rule has no stay arm (every open stay group is
--      refused earlier as upcoming_stays).
--
--   P  Provider targets carried across deletions of the same account: two
--      earlier deletions with overlapping targets come back once each; a
--      retry returns the same merged list; earlier audit rows whose `before`
--      is null, a string, or holds non-array lists are ignored, not fatal.
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
  INSERT INTO public.creator_accounts(id,email) VALUES (a,'t2s-'||left(sfx,10)||'@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES (b,a,'T2S','t2s-'||sfx,'USD');
  SET LOCAL session_replication_role = replica;
  UPDATE public.brands SET payment_provider = p_provider, payout_hold_cutover_at = CASE WHEN p_hold THEN now() - interval '30 days' END WHERE id=b;
  INSERT INTO public.events(id,brand_id,created_by,title,slug,status) VALUES (e,b,a,'T2S Ended','t2s-e-'||sfx,'scheduled'),(e0,b,a,'T2S Dateless','t2s-0-'||sfx,'draft');
  INSERT INTO public.event_dates(event_id,start_at,end_at) VALUES (e, now()-interval '9 days', now()-interval '8 days');
  EXECUTE format(p_sql, b, e, e0, a, sid);
  SET LOCAL session_replication_role = origin;
  INSERT INTO fx(name, brand, expect) VALUES (p_name, b, p_expect);
END $fn$;
DO $$
DECLARE
  ord text := $q$INSERT INTO public.orders (id,event_id,buyer_email,buyer_name,total_cents,refunded_amount_cents,currency,payment_status,source,payment_method,stripe_payment_intent_id,stripe_charge_id,created_at) VALUES (%%5$L, %s, 't2s@example.test','T2S', 5000, %s,'USD',%L,%L,%L,%s,%s, now() - interval '9 days')$q$;
  snap text := $q$; INSERT INTO public.payout_source_fee_snapshots (id, source_type, source_id, provider_fee_cents, captured_at) VALUES (gen_random_uuid(), %L, %%5$L, 0, now())$q$;
  disp text := $q$; INSERT INTO public.stripe_disputes (stripe_dispute_id, stripe_charge_id, stripe_account_id, order_id, amount, currency, status, reason, raw_event) VALUES ('dp_'||left(%%5$L::text,8), 'ch_x', 'acct_x', %%5$L, 5000, 'usd', %L, 'fraudulent', '{}'::jsonb)$q$;
  con text := $q$INSERT INTO public.event_rsvp_contributions (id,event_id,brand_id,provider,currency,amount_cents,buyer_total_cents,refunded_amount_cents,pricing_breakdown,status,paid_at,created_at,stripe_payment_intent_id) VALUES (%%5$L, %%2$L, %%1$L,'stripe','USD',2500,2500,%s,'{}'::jsonb,%L, %s, %s, 'pi_c_'||left(%%5$L::text,8))$q$;
  dep text := $q$WITH r AS (INSERT INTO public.reservations (id, brand_id, venue_id, reserved_for, party_size, status, created_at) VALUES (gen_random_uuid(), %%1$L, gen_random_uuid(), %s, 2, 'completed', now() - interval '12 days') RETURNING id) INSERT INTO public.reservation_checkout_sessions (id, brand_id, reserved_for, party_size, buyer_name, buyer_email, buyer_phone_e164, amount_cents, currency, created_via, status, reservation_id, stripe_payment_intent_id, paystack_reference) SELECT %%5$L, %%1$L, %s, 2, 'T2S', 't2s@example.test', '+12015550197', 3000, 'USD', 'web', 'completed', r.id, %s, %s FROM r$q$;
  menu text := $q$INSERT INTO public.venue_orders (id, session_id, brand_id, venue_id, qr_spot_id, source, money_path, currency, subtotal_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, total_cents, idempotency_key, payment_status, fulfillment_status, acknowledged_at, acknowledged_by_user_id, confirmed_at, created_at, provider, stripe_payment_intent_id, paystack_reference, buyer_name, buyer_email, buyer_phone_e164) VALUES (%%5$L, gen_random_uuid(), %%1$L, gen_random_uuid(), gen_random_uuid(), 'guest_qr', 'mingla', 'USD', 1000, 0, 0, false, false, false, 1000, 1000, 't2s-' || gen_random_uuid()::text, %L, 'delivered', now() - interval '5 days', gen_random_uuid(), %s, now() - interval '5 days', %L, %s, %s, 'T2S', 't2s@example.test', '+12015550196')$q$;
BEGIN
  -- ARM 1
  PERFORM pg_temp.fx('O1 order partial_refund, 2000 of 5000 refunded, snapshot', 'both', format(ord,'%2$L','2000','partial_refund','legacy','online_card',$p$'pi_a_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'order'));
  PERFORM pg_temp.fx('O2 order partial_refund but refunded in full, snapshot', 'neither', format(ord,'%2$L','5000','partial_refund','legacy','online_card',$p$'pi_a_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'order'));
  PERFORM pg_temp.fx('O4 order paid, snapshot, dispute OPEN for the full amount', 'rule-only', format(ord,'%2$L','0','paid','legacy','online_card',$p$'pi_a_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'order') || format(disp,'needs_response'));
  PERFORM pg_temp.fx('O5 order paid, charge id only, NO snapshot (stripe brand)', 'rule-only', format(ord,'%2$L','0','paid','legacy','online_card','NULL',$p$'ch_a_'||left(%5$L::text,8)$p$));
  PERFORM pg_temp.fx('O6 order paid, charge id only, NO snapshot (PAYSTACK brand)', 'neither', format(ord,'%2$L','0','paid','legacy','online_card','NULL',$p$'ch_a_'||left(%5$L::text,8)$p$), 'paystack');
  PERFORM pg_temp.fx('O7 order paid, snapshot, on an event with NO dates', 'neither', format(ord,'%3$L','0','paid','legacy','online_card',$p$'pi_a_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'order'));
  PERFORM pg_temp.fx('O8 DOOR sale by card reader, payment intent, snapshot', 'both', format(ord,'%2$L','0','paid','door_sale','card_reader',$p$'pi_a_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'order'));
  PERFORM pg_temp.fx('O9 DOOR sale cash, no reference, no snapshot', 'neither', format(ord,'%2$L','0','paid','door_sale','cash','NULL','NULL'));
  PERFORM pg_temp.fx('O10 order paid, snapshot, brand NOT on the hold rail', 'neither', format(ord,'%2$L','0','paid','legacy','online_card',$p$'pi_a_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'order'), 'stripe', false);
  -- ARM 2
  PERFORM pg_temp.fx('C1 contribution partially_refunded 1000 of 2500, snapshot', 'both', format(con,'1000','partially_refunded','now() - interval ''8 days''','now() - interval ''8 days''') || format(snap,'rsvp_contribution'));
  PERFORM pg_temp.fx('C2 contribution refunded in full but status partially_refunded', 'neither', format(con,'2500','partially_refunded','now() - interval ''8 days''','now() - interval ''8 days''') || format(snap,'rsvp_contribution'));
  PERFORM pg_temp.fx('C3 contribution created BEFORE cutover, paid AFTER, snapshot', 'both', format(con,'0','paid','now() - interval ''8 days''','now() - interval ''40 days''') || format(snap,'rsvp_contribution'));
  PERFORM pg_temp.fx('C4 contribution created after cutover, paid_at NULL, snapshot', 'both', format(con,'0','paid','NULL','now() - interval ''8 days''') || format(snap,'rsvp_contribution'));
  -- ARM 3
  PERFORM pg_temp.fx('V1 deposit completed, snapshot, reservation still UPCOMING', 'both', format(dep,'now() + interval ''4 days''','now() + interval ''4 days''',$p$'pi_v_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'venue_reservation'));
  PERFORM pg_temp.fx('V2 deposit completed, PAYSTACK brand, paystack ref only, no snapshot', 'rule-only', format(dep,'now() - interval ''10 days''','now() - interval ''10 days''','NULL',$p$'psk_ref_'||left(%5$L::text,8)$p$) , 'paystack');
  PERFORM pg_temp.fx('V3 deposit completed, PAYSTACK brand, stripe PI only, no snapshot', 'neither', format(dep,'now() - interval ''10 days''','now() - interval ''10 days''',$p$'pi_v_'||left(%5$L::text,8)$p$,'NULL') , 'paystack');
  -- ARM 4
  PERFORM pg_temp.fx('M1 menu order partial_refund, snapshot', 'both', format(menu,'partial_refund','now() - interval ''5 days''','stripe',$p$'pi_m_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'venue_menu_order'));
  PERFORM pg_temp.fx('M2 menu order paid, snapshot, never confirmed', 'neither', format(menu,'paid','NULL','stripe',$p$'pi_m_'||left(%5$L::text,8)$p$,'NULL') || format(snap,'venue_menu_order'));
  PERFORM pg_temp.fx('M3 menu order paid via PAYSTACK, reference only, no snapshot', 'rule-only', format(menu,'paid','now() - interval ''5 days''','paystack','NULL',$p$'psk_m_'||left(%5$L::text,8)$p$));
  -- ARM 5
  PERFORM pg_temp.fx('I1 instalment collected after cutover (payout switch off)', 'rule-only', format(ord,'%2$L','0','pending','legacy','online_card','NULL','NULL') || $q$; INSERT INTO public.order_installments (id, order_id, ordinal, amount_cents, currency, due_at, status, stripe_payment_intent_id, collected_at) VALUES (gen_random_uuid(), %5$L, 1, 2500, 'USD', now() - interval '3 days', 'collected', 'pi_i1', now() - interval '3 days')$q$);
  PERFORM pg_temp.fx('I2 instalment collected, plan order on an event with NO dates', 'neither', format(ord,'%3$L','0','pending','legacy','online_card','NULL','NULL') || $q$; INSERT INTO public.order_installments (id, order_id, ordinal, amount_cents, currency, due_at, status, stripe_payment_intent_id, collected_at) VALUES (gen_random_uuid(), %5$L, 1, 2500, 'USD', now() - interval '3 days', 'collected', 'pi_i2', now() - interval '3 days')$q$);
END $$;

-- The rule's answer, before the sweep has done anything.
UPDATE fx SET rule = EXISTS (
  SELECT 1 FROM private.host_account_unreleased_held_money(ARRAY[fx.brand], ARRAY[]::uuid[]));

-- The REAL sweep, far enough ahead that maturity cannot be the reason for a miss.
SELECT set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.run_payout_release_dark_sweep(now() + interval '60 days') IS NOT NULL AS sweep_ran;
UPDATE fx SET swept = EXISTS (
  SELECT 1 FROM public.payout_release_items i
  JOIN public.brand_payout_releases pr ON pr.id = i.release_id
  WHERE pr.brand_id = fx.brand);

-- Pay everything the sweep opened; ask the rule again.
SET LOCAL session_replication_role = replica;
UPDATE public.brand_payout_releases pr SET status = 'released', released_at = now()
 WHERE pr.brand_id IN (SELECT brand FROM fx);
SET LOCAL session_replication_role = origin;
UPDATE fx SET rule_after_release = EXISTS (
  SELECT 1 FROM private.host_account_unreleased_held_money(ARRAY[fx.brand], ARRAY[]::uuid[]));

DO $$
DECLARE
  v_wrong text;
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM fx;
  IF v_n <> 21 THEN
    RAISE EXCEPTION 't2s 3660 S: expected 21 fixtures, built %', v_n;
  END IF;
  -- Each class must be populated, or "agreement" would be vacuous.
  IF (SELECT count(*) FROM fx WHERE expect = 'both' AND rule AND swept) < 7
     OR (SELECT count(*) FROM fx WHERE expect = 'neither' AND NOT rule AND NOT swept) < 8
     OR (SELECT count(*) FROM fx WHERE expect = 'rule-only' AND rule AND NOT swept) < 5 THEN
    RAISE EXCEPTION 't2s 3660 S: a class is under-populated: %', (
      SELECT string_agg(format('%s rule=%s sweep=%s', name, rule, swept), ' | ' ORDER BY name) FROM fx);
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
    RAISE EXCEPTION 't2s 3660 S: the money rule and the payout sweep DISAGREE: %', v_wrong;
  END IF;
  RAISE NOTICE 'issue_3660 tester2 retest3: rule and sweep agree on 21 fixtures';
END;
$$;

-- P ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b1 uuid := gen_random_uuid();
  v_b2 uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_acct1 text;
  v_acct2 text;
  v_r jsonb;
  v_retry jsonb;
BEGIN
  v_acct1 := 'acct_t2s1_' || left(v_sfx, 10);
  v_acct2 := 'acct_t2s2_' || left(v_sfx, 10);
  INSERT INTO auth.users(id) VALUES (v_a);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_a, 't2s-p-' || v_sfx || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b1, v_a, 'T2S P1', 't2s-p1-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b1, v_acct1, 'US', 'USD');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Deletion 1 (targets: account 1).
  v_r := public.biz_delete_host_account(v_a);
  IF jsonb_array_length(v_r->'stripe_accounts') <> 1 THEN
    RAISE EXCEPTION 't2s 3660 P: deletion 1 wrong: %', v_r;
  END IF;

  -- The Host comes back (sign-in recovery), makes a second brand, deletes again.
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_a;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_b2, v_a, 'T2S P2', 't2s-p2-' || v_sfx, 'USD');
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b2, v_acct2, 'US', 'USD');
  v_r := public.biz_delete_host_account(v_a);
  IF jsonb_array_length(v_r->'stripe_accounts') <> 2 THEN
    RAISE EXCEPTION 't2s 3660 P: deletion 2 must carry its own target and the earlier one: %', v_r;
  END IF;

  -- Earlier audit rows that are not what the function writes: must be ignored.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.audit_log(user_id, action, target_type, target_id, before, after)
  SELECT v_a, 'host_account.deleted', 'creator_account', v_a::text, x.b, '{}'::jsonb
  FROM (VALUES
    (NULL::jsonb),
    ('null'::jsonb),
    ('"not an object"'::jsonb),
    ('[1, 2]'::jsonb),
    ('{"stripe_accounts": "nope", "paystack_subaccounts": {"a": 1}}'::jsonb),
    ('{}'::jsonb)
  ) AS x(b);
  SET LOCAL session_replication_role = origin;

  -- Back again, nothing new, a third deletion: both earlier targets, once each
  -- (rows 1 and 2 both list account 1).
  UPDATE public.creator_accounts SET deleted_at = NULL WHERE id = v_a;
  v_r := public.biz_delete_host_account(v_a);
  IF v_r->>'status' IS DISTINCT FROM 'deleted'
     OR jsonb_array_length(v_r->'stripe_accounts') <> 2
     OR (SELECT count(DISTINCT x->>'stripe_account_id')
           FROM jsonb_array_elements(v_r->'stripe_accounts') x
          WHERE x->>'stripe_account_id' IN (v_acct1, v_acct2)) <> 2 THEN
    RAISE EXCEPTION 't2s 3660 P: overlapping earlier targets must come back once each: %', v_r;
  END IF;

  -- And a plain retry returns the same merged list.
  v_retry := public.biz_delete_host_account(v_a);
  IF (v_retry->>'already_deleted')::boolean IS NOT TRUE
     OR v_retry->'stripe_accounts' IS DISTINCT FROM v_r->'stripe_accounts' THEN
    RAISE EXCEPTION 't2s 3660 P: the retry does not return the merged list. deletion=% retry=%',
      v_r->'stripe_accounts', v_retry->'stripe_accounts';
  END IF;

  RAISE NOTICE 'issue_3660 host account deletion tester2 retest3 PASS';
END;
$$;
ROLLBACK;
