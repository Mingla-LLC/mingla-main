-- #4508 RETEST (tester, independent of the implementor suites).
--
-- Adversarial angles the implementor suites do not take:
--   A. Signed-out guests: one constant refusal for every number class (listed,
--      released, an account's, fresh, a friend pick) AND zero side effects:
--      no rows, no logs, no notifications, the public going count unchanged.
--   B. Column closure: a host, an inviter and anon cannot read, FILTER or
--      ORDER BY matched_user_id / invited_by_user_id (a filter is an oracle
--      even when the column is not returned).
--   C. One place, two inviters: a person already holding a CLAIMED pass from
--      inviter A, whose number inviter B typed before it was proven, proves
--      the number later. The proven-number sweep must not give them a second
--      guest place; inviter B's row is released (or left unclaimed), never
--      claimed, and the going count counts the person once.
--   D. One place, own RSVP first then the sweep: the person's own RSVP exists,
--      inviter A's row for their (then unproven) number is swept after they
--      prove it: released, not claimed; the person is counted once.
--   E. Plus-ones off: "Guests can bring guests" cannot survive on a published
--      event for any writer, and a claimed guest cannot bring while it is off.
--
-- FAILS-ON-REVERT (verified by the tester on the #4508 branch):
--   drop the signed-out refusal in submit_event_rsvp      -> "A: signed-out ... refused"
--   restore SELECT on matched_user_id for authenticated   -> "B: ... matched_user_id"
--   drop the own-place check in issue_4508_sweep_guest_yields   -> "D: ... never swept"
--   (C holds on more than one guard: removing only the second-row check in
--   issue_4508_sweep_guest_yields leaves it green, so C is a regression net,
--   not a single-line proof.)
--   drop trigger issue_4508_guests_bring_needs_plus_ones  -> "E: published event"
-- Invariants exercised: I-4508-SIGNED-OUT-SUBMIT-NO-ORACLE, I-4508-ONE-PLACE-PER-PERSON,
-- I-4508-ONE-PLACE-ON-CLAIM-PATHS, I-4508-GUEST-ACCOUNT-COLUMNS-CLOSED, I-4508-HOST-SETTING-QUIET.
\set ON_ERROR_STOP on
\ir ../20281119004508_issue_4508_guest_phone_match.sql
\ir ../20281119014508_issue_4508_bring_a_friend.sql

BEGIN;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
END $fn$;
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN EXECUTE p_sql; RETURN ''; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $fn$;
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', p_user::text, true);
$fn$;
CREATE FUNCTION pg_temp.signed_out() RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claims', '', true);
  SELECT set_config('request.jwt.claim.sub', '', true);
$fn$;
CREATE FUNCTION pg_temp.going(p_event uuid) RETURNS bigint LANGUAGE sql AS $fn$
  SELECT (public.pg_public_social_proof(p_event)::jsonb->>'goingCount')::bigint;
$fn$;
CREATE FUNCTION pg_temp.footprint(p_event uuid) RETURNS text LANGUAGE sql AS $fn$
  SELECT concat_ws('/',
    (SELECT count(*) FROM public.event_rsvps WHERE event_id = p_event),
    (SELECT count(*) FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id WHERE r.event_id = p_event),
    (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = p_event),
    (SELECT count(*) FROM public.rsvp_guest_invite_log WHERE event_id = p_event),
    (SELECT count(*) FROM public.rsvp_guest_lookup_log),
    (SELECT count(*) FROM public.claim_links));
$fn$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO PUBLIC;
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON ids TO PUBLIC;

DO $retest$
DECLARE
  v_owner uuid := '45086000-0000-4000-8000-000000000001';
  v_brand uuid := '45086000-0000-4000-8000-000000000002';
  v_ev    uuid := '45086000-0000-4000-8000-000000000003';
  v_ev2   uuid := '45086000-0000-4000-8000-000000000004';
  v_ann   uuid := '45086000-0000-4000-8000-000000000011'; -- inviter A
  v_bob   uuid := '45086000-0000-4000-8000-000000000012'; -- inviter B
  v_cat   uuid := '45086000-0000-4000-8000-000000000013'; -- guest (C)
  v_dan   uuid := '45086000-0000-4000-8000-000000000014'; -- account with a proven number (A)
  v_eve   uuid := '45086000-0000-4000-8000-000000000015'; -- own RSVP first (D)
  v_res jsonb; v_rsvp uuid; v_gid uuid; v_gid_b uuid; v_code text; v_before text; v_going bigint; e text;
  v_num text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner,'rt-owner@example.test'),(v_ann,'rt-ann@example.test'),
    (v_bob,'rt-bob@example.test'),(v_cat,'rt-cat@example.test'),(v_dan,'rt-dan@example.test'),(v_eve,'rt-eve@example.test');
  INSERT INTO public.profiles(id,email,display_name,first_name,last_name,phone) VALUES
    (v_ann,'rt-ann@example.test','Ann Able','Ann','Able','+15550801001'),
    (v_bob,'rt-bob@example.test','Bob Baker','Bob','Baker','+15550801002'),
    (v_cat,'rt-cat@example.test','Cat Cole','Cat','Cole',NULL),
    (v_dan,'rt-dan@example.test','Dan Dale','Dan','Dale','+15550801004'),
    (v_eve,'rt-eve@example.test','Eve East','Eve','East',NULL)
  ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, first_name=EXCLUDED.first_name,
    last_name=EXCLUDED.last_name, phone=EXCLUDED.phone;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_dan,'+15550801004');
  INSERT INTO public.creator_accounts(id,email) VALUES (v_owner,'rt-owner@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,payment_provider,pricing_region,pricing_currency,default_currency,contact_email)
  VALUES (v_brand,v_owner,'Retest Brand','retest-4508-tester','stripe','US','USD','USD','rt-brand@example.test');
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,rsvp_capacity,
    rsvp_waitlist_enabled,rsvp_approval_mode,rsvp_allow_plus_ones,rsvp_plus_ones_max,rsvp_guests_can_bring,published_at)
  VALUES (v_ev,v_brand,v_owner,'Retest Night','retest-night-4508t','rsvp','scheduled','public','America/New_York','USD',NULL,
          false,'auto',true,3,true,now()),
         (v_ev2,v_brand,v_owner,'Retest Two','retest-two-4508t','rsvp','scheduled','public','America/New_York','USD',NULL,
          false,'auto',true,3,true,now());
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
    (v_ev, now()+interval '5 days', now()+interval '5 days 3 hours','America/New_York',true),
    (v_ev2, now()+interval '6 days', now()+interval '6 days 3 hours','America/New_York',true);
  INSERT INTO ids VALUES ('owner',v_owner),('ann',v_ann),('ev',v_ev),('ev2',v_ev2),('dan',v_dan);

  -- A list to probe against: Ann going with Dan (an account, matched by number)
  -- and a fresh number; one more fresh number released.
  v_res := public.submit_event_rsvp(v_ev, v_ann, 'Ann Able','rt-ann@example.test','+15550801001','going',2,
    '[{"phone":"+15550801004"},{"phone":"+15550801090"}]'::jsonb, NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  INSERT INTO ids VALUES ('ann_rsvp', v_rsvp);
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp AND phone = '+15550801090';
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_release(v_code)->>'outcome' = 'released', 'setup: a released number');

  -- ===================== A. signed-out: one answer, no trace =====================
  v_before := pg_temp.footprint(v_ev);
  v_going := pg_temp.going(v_ev);
  FOREACH v_num IN ARRAY ARRAY['+15550801004','+15550801090','+15550801002','+15550801099'] LOOP
    e := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L,NULL,'Sam Signed','rt-sam@example.test','+15550801111','going',1,%L::jsonb,NULL,'US')$s$,
                            v_ev, jsonb_build_array(jsonb_build_object('phone', v_num))::text));
    PERFORM pg_temp.ok(e = 'rsvp_guest_sign_in_required', 'A: signed-out guest number ' || right(v_num, 4) || ' refused with the constant answer (got ' || e || ')');
    e := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L,NULL,'Sam Signed','rt-sam@example.test','+15550801111','going',1,%L::jsonb,NULL,'US')$s$,
                            v_ev, jsonb_build_array(jsonb_build_object('name','Old Shape','email','old@example.test','phone', v_num))::text));
    PERFORM pg_temp.ok(e = 'rsvp_guest_sign_in_required', 'A: signed-out old-shape guest ' || right(v_num, 4) || ' refused the same way');
    e := pg_temp.err(format($s$SELECT public.rsvp_guest_lookup(NULL,%L,%L)$s$, v_ev, v_num));
    PERFORM pg_temp.ok(e = 'rsvp_guest_sign_in_required', 'A: signed-out lookup of ' || right(v_num, 4) || ' refused the same way');
  END LOOP;
  e := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L,NULL,'Sam Signed','rt-sam@example.test','+15550801111','going',1,%L::jsonb,NULL,'US')$s$,
                          v_ev, jsonb_build_array(jsonb_build_object('userId', v_dan))::text));
  PERFORM pg_temp.ok(e = 'rsvp_guest_sign_in_required', 'A: signed-out friend pick refused the same way');
  PERFORM pg_temp.ok(pg_temp.footprint(v_ev) = v_before, 'A: signed-out guest attempts leave no row, log, link or notification');
  PERFORM pg_temp.ok(pg_temp.going(v_ev) = v_going, 'A: the public going count does not move');
  -- A signed-out RSVP on its own still works (one tap).
  v_res := public.submit_event_rsvp(v_ev, NULL, 'Sam Signed','rt-sam@example.test','+15550801111','going',0,'[]'::jsonb,NULL,'US');
  PERFORM pg_temp.ok(v_res->>'status' = 'going' AND pg_temp.going(v_ev) = v_going + 1, 'A: a signed-out RSVP without guests still goes through');

  -- ===================== C. claimed pass + second inviter + sweep =====================
  -- Ann brings Cat's number; Cat proves it and claims Ann's pass.
  v_res := public.submit_event_rsvp(v_ev2, v_ann, 'Ann Able','rt-ann@example.test','+15550801001','going',1,
    '[{"phone":"+15550801003"}]'::jsonb, NULL, 'US');
  SELECT g.id INTO v_gid FROM public.event_rsvp_guests g WHERE g.rsvp_id = (v_res->>'rsvpId')::uuid;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v_cat,'+15550801003');
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_cat, v_code, 'Cat Cole')->>'outcome' = 'claimed', 'C setup: Cat claims Ann''s pass');
  v_going := pg_temp.going(v_ev2);
  -- Bob types a second number of Cat's that she has not proven yet.
  v_res := public.submit_event_rsvp(v_ev2, v_bob, 'Bob Baker','rt-bob@example.test','+15550801002','going',1,
    '[{"phone":"+15550801033"}]'::jsonb, NULL, 'US');
  SELECT g.id INTO v_gid_b FROM public.event_rsvp_guests g WHERE g.rsvp_id = (v_res->>'rsvpId')::uuid;
  PERFORM pg_temp.ok((SELECT matched_user_id IS NULL AND claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gid_b),
    'C setup: Bob''s row for the unproven number is unmatched');
  -- Cat proves that second number, then the proven-contact sweep runs.
  PERFORM public.record_verified_phone(v_cat, '+15550801033');
  PERFORM public.claim_attendance_by_verified_identity(v_cat);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_gid_b AND claimed_at IS NOT NULL),
    'C: the sweep never claims a second guest place for someone who already holds one');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
                       WHERE r.event_id = v_ev2 AND g.matched_user_id = v_cat AND g.claimed_at IS NOT NULL) = 1,
    'C: Cat holds exactly one claimed place on the event');

  -- ===================== D. own RSVP first, then the sweep =====================
  v_res := public.submit_event_rsvp(v_ev2, v_eve, 'Eve East','rt-eve@example.test','+15550801005','going',0,'[]'::jsonb,NULL,'US');
  v_res := public.submit_event_rsvp(v_ev2, v_bob, 'Bob Baker','rt-bob@example.test','+15550801002','going',2,
    '[{"phone":"+15550801033"},{"phone":"+15550801055"}]'::jsonb, NULL, 'US');
  SELECT g.id INTO v_gid_b FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = (v_res->>'rsvpId')::uuid AND g.phone = '+15550801055';
  v_going := pg_temp.going(v_ev2);
  PERFORM public.record_verified_phone(v_eve, '+15550801055');
  PERFORM public.claim_attendance_by_verified_identity(v_eve);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = v_gid_b AND claimed_at IS NOT NULL),
    'D: a person with their own RSVP is never swept into a guest place');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.event_rsvps WHERE event_id = v_ev2 AND user_id = v_eve AND rsvp_status = 'going') = 1,
    'D: their own RSVP stands');
  PERFORM pg_temp.ok(pg_temp.going(v_ev2) <= v_going, 'D: the going count never counts the person twice');

  -- ===================== E. plus-ones off =====================
  UPDATE public.events SET rsvp_allow_plus_ones = false WHERE id = v_ev2;
  PERFORM pg_temp.ok((SELECT rsvp_guests_can_bring FROM public.events WHERE id = v_ev2) = false,
    'E: a published event with plus-ones off cannot keep guests-can-bring (direct writer)');
  UPDATE public.events SET rsvp_guests_can_bring = true WHERE id = v_ev2;
  PERFORM pg_temp.ok((SELECT rsvp_guests_can_bring FROM public.events WHERE id = v_ev2) = false,
    'E: turning guests-can-bring back on alone does not stick while plus-ones are off');
  SELECT g.id INTO v_gid FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
   WHERE r.event_id = v_ev2 AND g.matched_user_id = v_cat AND g.claimed_at IS NOT NULL;
  v_res := public.rsvp_guest_bring(v_cat, v_gid, '+15550801077', 'US', NULL);
  PERFORM pg_temp.ok(coalesce(v_res->>'outcome', v_res->>'error', v_res::text) ILIKE '%not_allowed%',
    'E: a claimed guest cannot bring someone while plus-ones are off (got ' || v_res::text || ')');
END
$retest$;

-- ===================== B. column closure through the API roles =====================
SELECT pg_temp.as_user((SELECT v FROM ids WHERE k = 'owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err($$SELECT matched_user_id FROM public.event_rsvp_guests LIMIT 1$$) ILIKE '%permission denied%',
  'B: a host cannot read matched_user_id');
SELECT pg_temp.ok(pg_temp.err($$SELECT invited_by_user_id FROM public.event_rsvp_guests LIMIT 1$$) ILIKE '%permission denied%',
  'B: a host cannot read invited_by_user_id');
SELECT pg_temp.ok(pg_temp.err($$SELECT id FROM public.event_rsvp_guests WHERE matched_user_id IS NOT NULL$$) ILIKE '%permission denied%',
  'B: a host cannot filter on matched_user_id');
SELECT pg_temp.ok(pg_temp.err($$SELECT id FROM public.event_rsvp_guests ORDER BY matched_user_id$$) ILIKE '%permission denied%',
  'B: a host cannot order by matched_user_id');
RESET ROLE;
SELECT pg_temp.as_user((SELECT v FROM ids WHERE k = 'ann'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err($$SELECT id FROM public.event_rsvp_guests WHERE invited_by_user_id IS NOT NULL$$) ILIKE '%permission denied%',
  'B: an inviter cannot filter on invited_by_user_id');
RESET ROLE;
SELECT pg_temp.signed_out();
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err($$SELECT matched_user_id FROM public.event_rsvp_guests LIMIT 1$$) ILIKE '%permission denied%',
  'B: anon cannot read matched_user_id');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE '#4508 tester retest: all cases passed'; END $$;
ROLLBACK;
