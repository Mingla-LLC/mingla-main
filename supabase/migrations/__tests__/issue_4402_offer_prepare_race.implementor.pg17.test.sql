-- #4402 N1 (tester retest 6834391468): two offers for the same interest sent
-- at the same moment (two taps, two tabs). Without the interest lock in the
-- gig_offer_prepare wrapper, the second request passes the unpaid-offer check
-- before the first commits, then the impl's old retire branch cancels the
-- first offer with no provider check. With the lock, the second waits, sees
-- the first offer and answers payment_unverified.
--
-- Real two-session test (dblink), so fixtures are committed in an isolated
-- UUID namespace; the lane gives this suite its own database.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

DO $setup$
DECLARE
  v_host uuid := '44020001-0000-4000-8000-000000000001';
  v_creator uuid := '44020001-0000-4000-8000-000000000002';
  v_brand uuid := '44020001-0000-4000-8000-000000000003';
  v_city uuid := '44020001-0000-4000-8000-000000000004';
  v_gig uuid := '44020001-0000-4000-8000-000000000005';
BEGIN
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'issue-4402-race-host@test.local'), (v_creator, 'issue-4402-race-creator@test.local');
  INSERT INTO public.creator_accounts(id, email, display_name) VALUES
    (v_host, 'issue-4402-race-host@test.local', 'Race Host');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_host, 'Issue 4402 Race Host', 'issue-4402-race-host', 'USD');
  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'issue-4402-race-city', 'Race City', 'United States', 'US', 35.7, -78.6, 35.6, -78.7, 35.8, -78.5);
  INSERT INTO public.creator_profiles(creator_account_id, display_name, home_city_id, usage_ads_opt_in)
  VALUES (v_creator, 'Race Creator', v_city, true);
  INSERT INTO public.gigs(id, brand_id, listing_kind, listing_id, title_public, brief_public, format_key,
    deliverables, city_id, category, shoot_window_start, shoot_window_end, post_by, currency, status, created_by)
  VALUES (v_gig, v_brand, 'event', gen_random_uuid(), 'Race video',
    'Create a clear launch video showing the experience and its atmosphere.', 'behind_the_scenes',
    '[{"platform":"instagram","kind":"reel","count":1}]', v_city, 'nightlife',
    current_date + 2, current_date + 3, current_date + 7, 'USD', 'open', v_host);
  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  PERFORM public.creator_agreement_sign(DATE '1990-01-01');
  INSERT INTO public.gig_interest(id, gig_id, creator_account_id, quoted_minor)
  VALUES ('44020001-0000-4000-8000-000000000006', v_gig, v_creator, 10000);
END;
$setup$;

DO $race$
DECLARE
  -- TCP loopback: the image trusts 127.0.0.1, while its unix socket asks
  -- supabase_admin for a password.
  v_conn text := format('dbname=%L user=%L host=127.0.0.1 port=%L', current_database(), current_user,
    current_setting('port'));
  v_claims text := json_build_object('sub', '44020001-0000-4000-8000-000000000001', 'role', 'authenticated')::text;
  v_a jsonb; v_b jsonb; v_held boolean;
BEGIN
  PERFORM dblink_connect('issue4402_a', v_conn);
  PERFORM dblink_connect('issue4402_b', v_conn);
  -- A prepares and keeps its transaction (one statement) open for 1 s.
  PERFORM dblink_send_query('issue4402_a', format($q$
    SELECT public.gig_offer_prepare('44020001-0000-4000-8000-000000000006',
             '{"fee_minor":10000,"rights_accepted":true}'::jsonb, '4402-race-offer-a')::text,
           (pg_sleep(1) IS NULL)
      FROM (SELECT set_config('request.jwt.claim.sub', '44020001-0000-4000-8000-000000000001', true),
                   set_config('request.jwt.claims', %L, true)) claims
  $q$, v_claims));
  PERFORM pg_sleep(0.2);
  -- B sends the same offer (another key) while A is still open.
  PERFORM dblink_send_query('issue4402_b', format($q$
    SELECT public.gig_offer_prepare('44020001-0000-4000-8000-000000000006',
             '{"fee_minor":10000,"rights_accepted":true}'::jsonb, '4402-race-offer-b')::text
      FROM (SELECT set_config('request.jwt.claim.sub', '44020001-0000-4000-8000-000000000001', true),
                   set_config('request.jwt.claims', %L, true)) claims
  $q$, v_claims));
  PERFORM pg_sleep(0.2);
  IF dblink_is_busy('issue4402_b') <> 1 THEN
    RAISE EXCEPTION '#4402 N1 FAIL: the second offer did not wait for the first';
  END IF;
  SELECT answer::jsonb, held INTO v_a, v_held FROM dblink_get_result('issue4402_a') AS t(answer text, held boolean);
  SELECT answer::jsonb INTO v_b FROM dblink_get_result('issue4402_b') AS t(answer text);
  PERFORM dblink_disconnect('issue4402_a');
  PERFORM dblink_disconnect('issue4402_b');
  IF (v_a->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'first offer: %', v_a; END IF;
  IF v_b->>'error' IS DISTINCT FROM 'payment_unverified'
     OR (v_b->>'contract_id')::uuid IS DISTINCT FROM (v_a->>'contract_id')::uuid THEN
    RAISE EXCEPTION '#4402 N1 FAIL: the concurrent second offer was not refused: %', v_b;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gig_contracts WHERE id = (v_a->>'contract_id')::uuid AND state = 'offered')
     OR NOT EXISTS (SELECT 1 FROM public.gig_holds WHERE contract_id = (v_a->>'contract_id')::uuid AND status = 'pending')
     OR EXISTS (SELECT 1 FROM public.gig_holds h JOIN public.gig_contracts c ON c.id = h.contract_id
                 WHERE c.gig_id = '44020001-0000-4000-8000-000000000005' AND h.status = 'failed') THEN
    RAISE EXCEPTION '#4402 N1 FAIL: a concurrent offer retired the first hold without provider proof';
  END IF;
  RAISE NOTICE '#4402 N1 PASS: the concurrent second offer waited and was refused';
END;
$race$;
\echo 'issue #4402 concurrent offer prepare passed (N1)'
