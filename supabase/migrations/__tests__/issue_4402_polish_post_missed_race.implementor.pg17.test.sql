-- #4402 tester P2-1: a creator's post submit racing a post_missed refund.
-- gig_refund_claim locks the contract row and records the claim; the
-- provider refund runs after that. gig_posts_submit now takes the same row
-- lock and refuses (posting_closed) once a post_missed claim exists, so a
-- submit can never land between the claim and the refund record.
--
-- MINGLA-INVARIANT: I-4402-POST-6 | issue #4402 | no post is accepted once a post_missed claim exists or the post deadline has passed
--
-- Real two-session test (dblink), so fixtures are committed. Every run makes
-- fresh ids, emails and slugs (kept in a temp table), so the suite can run
-- again on the same database.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;
CREATE TEMP TABLE i4402pm_ids AS
SELECT gen_random_uuid() AS host, gen_random_uuid() AS creator, gen_random_uuid() AS brand, gen_random_uuid() AS city,
       gen_random_uuid() AS gig, gen_random_uuid() AS interest, substr(md5(random()::text), 1, 10) AS tag;

DO $setup$
DECLARE
  v_host uuid := (SELECT host FROM i4402pm_ids);
  v_creator uuid := (SELECT creator FROM i4402pm_ids);
  v_brand uuid := (SELECT brand FROM i4402pm_ids);
  v_city uuid := (SELECT city FROM i4402pm_ids);
  v_gig uuid := (SELECT gig FROM i4402pm_ids);
  v_int uuid := (SELECT interest FROM i4402pm_ids);
  v_tag text := (SELECT tag FROM i4402pm_ids);
  v_answer jsonb; v_c uuid;
BEGIN
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'i4402-pmrace-host-' || v_tag || '@test.local'), (v_creator, 'i4402-pmrace-creator-' || v_tag || '@test.local');
  INSERT INTO public.creator_accounts(id, email, display_name) VALUES (v_host, 'i4402-pmrace-host-' || v_tag || '@test.local', 'PM Race Host');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_host, 'Issue 4402 PM Race Host', 'i4402-pmrace-host-' || v_tag, 'USD');
  INSERT INTO public.seeding_cities(id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'i4402-pmrace-city-' || v_tag, 'PM Race City ' || v_tag, 'United States', 'US', 35.7, -78.6, 35.6, -78.7, 35.8, -78.5);
  INSERT INTO public.creator_profiles(creator_account_id, display_name, home_city_id, usage_ads_opt_in)
  VALUES (v_creator, 'PM Race Creator', v_city, true);
  INSERT INTO public.gigs(id, brand_id, listing_kind, listing_id, title_public, brief_public, format_key,
    deliverables, city_id, category, shoot_window_start, shoot_window_end, post_by, currency, status, created_by)
  VALUES (v_gig, v_brand, 'event', gen_random_uuid(), 'PM race video',
    'Create a clear launch video showing the experience and its atmosphere.', 'behind_the_scenes',
    '[{"platform":"instagram","kind":"reel","count":1}]', v_city, 'nightlife',
    current_date + 2, current_date + 3, current_date + 7, 'USD', 'open', v_host);
  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  PERFORM public.creator_agreement_sign(DATE '1990-01-01');
  INSERT INTO public.gig_interest(id, gig_id, creator_account_id, quoted_minor)
  VALUES (v_int, v_gig, v_creator, 10000);
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_answer := public.gig_offer_prepare(v_int, '{"fee_minor":10000,"rights_accepted":true}'::jsonb, 'i4402-pmrace-offer-' || v_tag);
  v_c := (v_answer->>'contract_id')::uuid;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.gig_hold_set_provider_ref(v_c, 1, 'gig_hold', 'pi_i4402_pmrace_' || v_tag);
  PERFORM public.gig_hold_mark_captured(v_c, 1, 'pi_i4402_pmrace_' || v_tag);
  -- Posting, deadline not yet passed: only the claim can close posting here.
  PERFORM public.issue_3872_contract_apply_state(v_c, 'posting', now() + interval '1 hour', NULL, NULL, NULL);
END;
$setup$;

DO $race$
DECLARE
  v_conn text := format('dbname=%L user=%L host=127.0.0.1 port=%L', current_database(), current_user, current_setting('port'));
  v_creator text := (SELECT creator::text FROM i4402pm_ids);
  v_claims text := json_build_object('sub', v_creator, 'role', 'authenticated')::text;
  v_c uuid := (SELECT id FROM public.gig_contracts WHERE gig_id = (SELECT gig FROM i4402pm_ids));
  v_claim jsonb; v_err text; v_rows integer;
BEGIN
  PERFORM dblink_connect('i4402pm_a', v_conn);
  PERFORM dblink_connect('i4402pm_b', v_conn);
  -- A (service role) claims the post_missed refund and keeps its statement open for 1 s.
  PERFORM dblink_send_query('i4402pm_a', format($q$
    SELECT public.gig_refund_claim(%L, 'post_missed')::text, (pg_sleep(1) IS NULL)
  $q$, v_c));
  PERFORM pg_sleep(0.2);
  -- B (the creator) submits links while A is still open.
  PERFORM dblink_send_query('i4402pm_b', format($q$
    SELECT public.gig_posts_submit(%L, '[{"platform":"instagram","url":"https://instagram.com/reel/i4402pmrace"}]'::jsonb)::text
      FROM (SELECT set_config('request.jwt.claim.sub', %L, true),
                   set_config('request.jwt.claims', %L, true)) claims
  $q$, v_c, v_creator, v_claims));
  PERFORM pg_sleep(0.2);
  IF dblink_is_busy('i4402pm_b') <> 1 THEN
    RAISE EXCEPTION '#4402 P2-1 FAIL: the post submit did not wait for the refund claim''s row lock';
  END IF;
  SELECT answer::jsonb INTO v_claim FROM dblink_get_result('i4402pm_a') AS t(answer text, slept boolean);
  PERFORM * FROM dblink_get_result('i4402pm_b', false) AS t(answer text);
  v_err := dblink_error_message('i4402pm_b');
  PERFORM dblink_disconnect('i4402pm_a');
  PERFORM dblink_disconnect('i4402pm_b');
  IF (v_claim->>'claimed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'claim: %', v_claim; END IF;
  IF v_err IS NULL OR v_err NOT LIKE '%posting_closed%' THEN
    RAISE EXCEPTION '#4402 P2-1 FAIL: a post was accepted after the post_missed claim: %', v_err;
  END IF;
  SELECT count(*) INTO v_rows FROM public.gig_posts WHERE contract_id = v_c;
  IF v_rows <> 0 OR (SELECT state FROM public.gig_contracts WHERE id = v_c) <> 'posting' THEN
    RAISE EXCEPTION '#4402 P2-1 FAIL: the racing submit changed the contract (posts %)', v_rows;
  END IF;
  RAISE NOTICE '#4402 P2-1 PASS: the submit waited for the claim and was refused with posting_closed';
END;
$race$;
\echo 'issue #4402 post submit vs post_missed refund race passed (P2-1)'
