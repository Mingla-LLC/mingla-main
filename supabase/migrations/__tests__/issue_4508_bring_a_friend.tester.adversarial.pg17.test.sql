-- #4508 tester adversarial suite: bring a friend with just their number.
--
-- Written by the independent tester. It attacks angles the implementor suites
-- do not: malformed numbers and country codes at the boundaries, replayed,
-- foreign and reused claim codes, a claimed guest re-invited, a deleted
-- inviter account, a cancelled event, the free-account pairing limit on both
-- sides, the exact edges of every daily cap (20 per inviter, 3 per number,
-- 300 signed-out texts), and the release / re-invite sequence across three
-- inviters.
--
-- MINGLA-INVARIANT: I-4508-TESTER-GUEST-INPUT-STRICT | issue #4508 | submit_event_rsvp refuses a guest number that is not strict E.164 (8 to 15 digits, no leading 0, no full-width digits, no trailing newline), a lower-case or three-letter country code, a non-object guest, an unknown key, any guest from a signed-out caller (rsvp_guest_sign_in_required, T1), a {userId} guest for a non-friend, and a guest count that differs from plusCount, writing nothing.
-- MINGLA-INVARIANT: I-4508-TESTER-CODES-NOT-REUSABLE | issue #4508 | a guest claim code is case-insensitive but never claims after release, never claims a later guest row for the same number, a primary RSVP claim code never resolves as a guest code, and a claimed pass is never released.
-- MINGLA-INVARIANT: I-4508-TESTER-CAP-EDGES | issue #4508 | the 20th guest number an inviter adds in 24 hours is accepted and the 21st refused (rsvp_guest_daily_cap) with nothing written; the 4th guest invite to one number in 24 hours is held (willText false, number_limit); a signed-out caller cannot add any guest (T1), so the signed-out text ceiling is never reached and a signed-in inviter is still texted past it.
-- MINGLA-INVARIANT: I-4508-TESTER-PAIRING-LIMIT | issue #4508 | a claim between two free accounts that are both already at their one pairing still makes the rsvp_guest close-friend pairing, and check_pairing_allowed for each still counts only their one ordinary pairing.
\set ON_ERROR_STOP on
\ir ../20281119004508_issue_4508_guest_phone_match.sql
\ir ../20281119014508_issue_4508_bring_a_friend.sql

BEGIN;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4508 TESTER FAIL: %', p_message; END IF;
END
$fn$;

CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$fn$;

-- One signed-in submit with a guest array, returning the error text ('' = ok).
CREATE FUNCTION pg_temp.try_guests(p_event uuid, p_user uuid, p_phone text, p_count integer, p_guests text)
RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN pg_temp.err(format(
    $s$SELECT public.submit_event_rsvp(%L, %L, 'Tester', %L, %L, 'going', %s, %L::jsonb, NULL, 'US')$s$,
    p_event, p_user, (SELECT u.email FROM auth.users u WHERE u.id = p_user), p_phone, p_count, p_guests));
END
$fn$;

DO $test$
DECLARE
  v_owner uuid := '45089000-0000-4000-8000-000000000001';
  v_brand uuid := '45089000-0000-4000-8000-000000000002';
  v_ev    uuid := '45089000-0000-4000-8000-000000000003';
  v_ev2   uuid := '45089000-0000-4000-8000-000000000004';
  v_ev3   uuid := '45089000-0000-4000-8000-000000000005';
  v_inv   uuid := '45089000-0000-4000-8000-000000000011'; -- Tess, the inviter
  v_gia   uuid := '45089000-0000-4000-8000-000000000012'; -- proved +15550301003
  v_gil   uuid := '45089000-0000-4000-8000-000000000013'; -- proved +15550301004
  v_ian   uuid := '45089000-0000-4000-8000-000000000014'; -- second inviter, deleted later
  v_kai   uuid := '45089000-0000-4000-8000-000000000015'; -- third inviter
  v_pal   uuid := '45089000-0000-4000-8000-000000000016'; -- Tess's ordinary pairing
  v_pam   uuid := '45089000-0000-4000-8000-000000000017'; -- Gia's ordinary pairing
  v_res   jsonb;
  v_rsvp  uuid;
  v_gid   uuid;
  v_gid2  uuid;
  v_code  text;
  v_code2 text;
  v_err   text;
  v_pr    uuid;
  v_n     integer;
  v_case  record;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 't-owner@example.test'), (v_inv, 't-inv@example.test'), (v_gia, 't-gia@example.test'),
    (v_gil, 't-gil@example.test'), (v_ian, 't-ian@example.test'), (v_kai, 't-kai@example.test'),
    (v_pal, 't-pal@example.test'), (v_pam, 't-pam@example.test');
  INSERT INTO public.profiles(id, email, display_name, first_name, last_name, phone) VALUES
    (v_inv, 't-inv@example.test', 'Tess Tester', 'Tess', 'Tester', '+15550301001'),
    (v_gia, 't-gia@example.test', 'Gia One', 'Gia', 'One', NULL),
    (v_gil, 't-gil@example.test', 'Gil Two', 'Gil', 'Two', NULL),
    (v_ian, 't-ian@example.test', 'Ian Three', 'Ian', 'Three', '+15550301005'),
    (v_kai, 't-kai@example.test', 'Kai Four', 'Kai', 'Four', '+15550301006'),
    (v_pal, 't-pal@example.test', 'Pal Five', 'Pal', 'Five', NULL),
    (v_pam, 't-pam@example.test', 'Pam Six', 'Pam', 'Six', NULL)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
    first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = EXCLUDED.phone;
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
    (v_gia, '+15550301003'), (v_gil, '+15550301004');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 't-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_owner, 'Tester 4508', 'tester-4508', 'stripe', 'US', 'USD', 'USD', 't-host@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
  VALUES
    (v_ev,  v_brand, v_owner, 'Tester Night', 'tester-night-4508', 'rsvp', 'scheduled', 'public',
     'America/New_York', 'USD', NULL, false, 'auto', true, 3, now()),
    (v_ev2, v_brand, v_owner, 'Tester Two', 'tester-two-4508', 'rsvp', 'scheduled', 'public',
     'America/New_York', 'USD', NULL, false, 'auto', true, 3, now()),
    (v_ev3, v_brand, v_owner, 'Tester No Plus', 'tester-noplus-4508', 'rsvp', 'scheduled', 'public',
     'America/New_York', 'USD', NULL, false, 'auto', false, 0, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_ev,  now() + interval '5 days', now() + interval '5 days 3 hours', 'America/New_York', true),
    (v_ev2, now() + interval '6 days', now() + interval '6 days 3 hours', 'America/New_York', true),
    (v_ev3, now() + interval '7 days', now() + interval '7 days 3 hours', 'America/New_York', true);

  -- ---- 1. Malformed numbers, country codes and guest shapes ---------------
  FOR v_case IN SELECT * FROM (VALUES
    ('[{"phone":"+0155503010"}]',                'rsvp_guest_phone_invalid',         'leading zero after +'),
    ('[{"phone":"+1234567"}]',                   'rsvp_guest_phone_invalid',         '7 digits'),
    ('[{"phone":"+1234567890123456"}]',          'rsvp_guest_phone_invalid',         '16 digits'),
    ('[{"phone":"15550301099"}]',                'rsvp_guest_phone_invalid',         'no plus'),
    ('[{"phone":"+１５５５０３０１０９９"}]',      'rsvp_guest_phone_invalid',         'full-width digits'),
    (E'[{"phone":"+15550301099\\n"}]',           'rsvp_guest_phone_invalid',         'trailing newline'),
    ('[{"phone":15550301099}]',                  'rsvp_guest_phone_invalid',         'number as JSON number'),
    ('[{"phone":"+1 555 030 1099"}]',            'rsvp_guest_phone_invalid',         'spaces inside'),
    ('[{"phone":"+15550301099","phoneCountryIso":"us"}]',  'rsvp_guest_phone_country_invalid', 'lower-case country'),
    ('[{"phone":"+15550301099","phoneCountryIso":"USA"}]', 'rsvp_guest_phone_country_invalid', 'three-letter country'),
    ('[{"phone":"+15550301099","phoneCountryIso":1}]',     'rsvp_guest_phone_country_invalid', 'numeric country'),
    ('[{"phone":"+15550301099","nickname":"x"}]', 'rsvp_guest_keys_invalid',         'unknown key'),
    ('["+15550301099"]',                          'rsvp_guest_keys_invalid',         'guest is a string'),
    ('[{}]',                                      'rsvp_guest_contact_required',     'empty guest'),
    ('[{"phone":"   "}]',                         'rsvp_guest_contact_required',     'blank phone'),
    ('[{"userId":"45089000-0000-4000-8000-000000000012","phone":"+15550301003"}]', 'rsvp_guest_keys_invalid', 'userId mixed with phone'),
    ('[{"userId":"not-a-uuid"}]',                 'rsvp_guest_keys_invalid',         'userId not a uuid'),
    ('[{"userId":"45089000-0000-4000-8000-000000000012"}]', 'rsvp_guest_not_friend', 'userId of a stranger'),
    ('[{"userId":"45089000-0000-4000-8000-000000000011"}]', 'rsvp_guest_not_friend', 'userId of self')
  ) AS t(guests, expected, label) LOOP
    v_err := pg_temp.try_guests(v_ev, v_inv, '+15550301001', 1, v_case.guests);
    PERFORM pg_temp.ok(v_err = v_case.expected,
      format('malformed guest (%s) refused with %s, got [%s]', v_case.label, v_case.expected, v_err));
  END LOOP;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = v_ev),
    'no refused submit wrote a party');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_guest_invite_log WHERE event_id = v_ev),
    'no refused submit counted against a cap');
  -- Boundaries that ARE valid: 8 and 15 digits, surrounding spaces trimmed.
  v_err := pg_temp.try_guests(v_ev, v_inv, '+15550301001', 2,
    '[{"phone":" +12345678 "},{"phone":"+123456789012345"}]');
  PERFORM pg_temp.ok(v_err = '', '8-digit and 15-digit numbers are accepted: ' || v_err);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE phone = '+12345678'),
    'a guest number is stored trimmed');
  -- Count mismatch and plus-ones switched off.
  v_err := pg_temp.try_guests(v_ev, v_inv, '+15550301001', 3, '[{"phone":"+12345678"},{"phone":"+123456789012345"}]');
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_count_mismatch', 'plusCount larger than the guests refused: ' || v_err);
  v_err := pg_temp.try_guests(v_ev3, v_inv, '+15550301001', 1, '[{"phone":"+15550301099"}]');
  PERFORM pg_temp.ok(v_err = 'rsvp_plus_ones_exceeded', 'a guest on an event with plus-ones off refused: ' || v_err);
  -- Signed out: {userId} is never accepted. [changed by the implementor in
  -- fix round 4, T1: any guest from a signed-out caller is refused with
  -- rsvp_guest_sign_in_required before the guest is read; was keys_invalid.]
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon', 'anon-t4508@example.test',
    '+15550309901', 'going', 1, '[{"userId":"45089000-0000-4000-8000-000000000012"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required', 'signed out cannot send a {userId} guest: ' || v_err);
  -- Reset Tess's party to no guests.
  PERFORM public.submit_event_rsvp(v_ev, v_inv, 'Tess Tester', 't-inv@example.test', '+15550301001',
    'going', 0, '[]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok((SELECT plus_count FROM public.event_rsvps WHERE event_id = v_ev AND user_id = v_inv) = 0,
    'dropping guests frees their spots');

  -- ---- 2. Codes: case, replay after release, foreign code, re-invite ------
  v_res := public.submit_event_rsvp(v_ev, v_inv, 'Tess Tester', 't-inv@example.test', '+15550301001',
    'going', 1, '[{"phone":"+15550301003"}]'::jsonb, NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(lower(v_code), NULL)->>'status' = 'open',
    'a lower-case code resolves');
  PERFORM pg_temp.ok(public.rsvp_guest_resolve('IIIIIIIIII', NULL)->>'status' = 'not_found'
    AND public.rsvp_guest_resolve(v_code || 'X', NULL)->>'status' = 'not_found'
    AND public.rsvp_guest_resolve(NULL, NULL)->>'status' = 'not_found',
    'codes outside the alphabet or length resolve to not_found');
  v_code2 := public.mint_claim_link('rsvp', v_rsvp)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_gia, v_code2, NULL)->>'outcome' = 'not_found'
    AND public.rsvp_guest_resolve(v_code2, NULL)->>'status' = 'not_found',
    'the primary''s RSVP claim code is never a guest code');
  -- Tess releases (she holds the link); the code is dead for claiming.
  PERFORM pg_temp.ok(public.rsvp_guest_release(v_code)->>'outcome' = 'released', 'first release');
  PERFORM pg_temp.ok(public.rsvp_guest_release(v_code)->>'outcome' = 'already_released', 'a replayed release');
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_gia, v_code, NULL)->>'outcome' = 'released',
    'a released code never claims, even for the proven owner');
  -- Tess may not re-add the number; Ian may, once.
  v_err := pg_temp.try_guests(v_ev, v_inv, '+15550301001', 1, '[{"phone":"+15550301003"}]');
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_released', 'the releasing inviter cannot re-add it: ' || v_err);
  v_res := public.submit_event_rsvp(v_ev, v_ian, 'Ian Three', 't-ian@example.test', '+15550301005',
    'going', 1, '[{"phone":"+15550301003"}]'::jsonb, NULL, 'US');
  SELECT g.id INTO v_gid2 FROM public.event_rsvp_guests g WHERE g.rsvp_id = (v_res->>'rsvpId')::uuid;
  PERFORM pg_temp.ok(v_gid2 IS NOT NULL AND v_gid2 <> v_gid, 'another inviter can add the released number once');
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_gia, v_code, NULL)->>'outcome' = 'released'
    AND (SELECT claimed_at IS NULL FROM public.event_rsvp_guests WHERE id = v_gid2),
    'the old released code never claims the new row for the same number');
  v_code2 := public.mint_claim_link('rsvp_guest', v_gid2)->>'code';
  PERFORM pg_temp.ok(v_code2 <> v_code, 'the new row has its own code');
  PERFORM pg_temp.ok(public.rsvp_guest_release(v_code2)->>'outcome' = 'released', 'second release (another inviter)');
  v_err := pg_temp.try_guests(v_ev, v_kai, '+15550301006', 1, '[{"phone":"+15550301003"}]');
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_released', 'two releases bar the number for a third inviter: ' || v_err);
  -- Signed out, the barred number is never added. [changed by the
  -- implementor in fix round 4, T1: the whole signed-out submit with a guest
  -- is refused (rsvp_guest_sign_in_required), writing nothing; it was
  -- answered like a new number with no row.]
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon Two', 'anon2-t4508@example.test',
    '+15550309902', 'going', 1, '[{"phone":"+15550301003"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE guest_email = 'anon2-t4508@example.test'),
    'signed out, a barred number is refused and nothing is written: ' || v_err);

  -- ---- 3. A claimed guest re-invited -------------------------------------
  v_res := public.submit_event_rsvp(v_ev2, v_inv, 'Tess Tester', 't-inv@example.test', '+15550301001',
    'going', 1, '[{"phone":"+15550301004"}]'::jsonb, NULL, 'US');
  v_rsvp := (v_res->>'rsvpId')::uuid;
  SELECT id INTO v_gid FROM public.event_rsvp_guests WHERE rsvp_id = v_rsvp;
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_gil, upper(v_code), 'Gil')->>'outcome' = 'claimed', 'Gil claims');
  PERFORM pg_temp.ok(public.rsvp_guest_release(v_code)->>'outcome' = 'already_claimed',
    'a claimed pass is never released by its code');
  PERFORM pg_temp.ok(public.rsvp_guest_claim(v_gia, v_code, NULL)->>'outcome' = 'claimed_by_other',
    'another account cannot take a claimed pass');
  v_err := pg_temp.try_guests(v_ev2, v_kai, '+15550301006', 1, '[{"phone":"+15550301004"}]');
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_already_listed', 'a claimed guest''s number cannot be re-invited: ' || v_err);
  -- [changed by the implementor in fix round 4, T1: signed out is refused.]
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon Three', 'anon3-t4508@example.test',
    '+15550309903', 'going', 1, '[{"phone":"+15550301004"}]'::jsonb, NULL, 'US')$s$, v_ev2));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND (SELECT count(*) FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id = g.rsvp_id
      WHERE r.event_id = v_ev2 AND g.phone = '+15550301004') = 1,
    'signed out, a claimed number is not added a second time: ' || v_err);
  PERFORM public.submit_event_rsvp(v_ev2, v_inv, 'Tess Tester', 't-inv@example.test', '+15550301001',
    'maybe', 1, '[{"phone":"+15550301004"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok((SELECT claimed_at IS NOT NULL AND matched_user_id = v_gil
      FROM public.event_rsvp_guests WHERE id = v_gid), 'a status change that still lists the number keeps the claim');

  -- ---- 4. Deleted inviter account; cancelled event ------------------------
  v_res := public.submit_event_rsvp(v_ev2, v_ian, 'Ian Three', 't-ian@example.test', '+15550301005',
    'going', 1, '[{"phone":"+15550301003"}]'::jsonb, NULL, 'US');
  SELECT id INTO v_gid2 FROM public.event_rsvp_guests WHERE rsvp_id = (v_res->>'rsvpId')::uuid;
  v_code2 := public.mint_claim_link('rsvp_guest', v_gid2)->>'code';
  DELETE FROM auth.users WHERE id = v_ian;
  v_res := public.rsvp_guest_claim(v_gia, v_code2, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'claimed' AND v_res->>'friendship' = 'none'
    AND v_res->'inviterUserId' = 'null'::jsonb,
    'a guest whose inviter deleted their account still claims, with no friendship: ' || v_res::text);
  PERFORM pg_temp.ok(public.rsvp_guest_message_context(v_gid2)->>'inviterLabel' IS NOT NULL,
    'the message context still names an inviter after the account is gone');
  UPDATE public.events SET status = 'cancelled' WHERE id = v_ev2;
  v_res := public.submit_event_rsvp(v_ev, v_inv, 'Tess Tester', 't-inv@example.test', '+15550301001',
    'going', 1, '[{"phone":"+15550309777"}]'::jsonb, NULL, 'US');
  PERFORM pg_temp.ok(public.rsvp_guest_resolve(v_code, v_gil)->>'status' = 'ended'
    AND public.rsvp_guest_claim(v_gil, v_code, NULL)->>'outcome' = 'ended'
    AND public.rsvp_guest_bring(v_gil, v_gid, '+15550309888', 'US', NULL)->>'outcome' IN ('ended', 'not_allowed'),
    'a cancelled event reads ended for resolve, claim and bring');
  PERFORM pg_temp.ok((public.rsvp_guest_message_context(v_gid)->>'eligible')::boolean IS FALSE,
    'a cancelled event''s guest is not eligible for texts');
  v_err := pg_temp.try_guests(v_ev2, v_kai, '+15550301006', 1, '[{"phone":"+15550309999"}]');
  PERFORM pg_temp.ok(v_err = 'rsvp_not_open', 'no guest can be added to a cancelled event: ' || v_err);

  -- ---- 5. Pairing limit: both free accounts already at one pairing --------
  INSERT INTO public.pair_requests(sender_id, receiver_id, status) VALUES (v_inv, v_pal, 'accepted')
  RETURNING id INTO v_pr;
  INSERT INTO public.pairings(user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST(v_inv, v_pal), GREATEST(v_inv, v_pal), v_pr);
  INSERT INTO public.pair_requests(sender_id, receiver_id, status) VALUES (v_gil, v_pam, 'accepted')
  RETURNING id INTO v_pr;
  INSERT INTO public.pairings(user_a_id, user_b_id, pair_request_id)
  VALUES (LEAST(v_gil, v_pam), GREATEST(v_gil, v_pam), v_pr);
  PERFORM pg_temp.ok(NOT (SELECT allowed FROM public.check_pairing_allowed(v_inv))
    AND NOT (SELECT allowed FROM public.check_pairing_allowed(v_gil)), 'fixture: both are at the free limit');
  v_res := public.submit_event_rsvp(v_ev, v_inv, 'Tess Tester', 't-inv@example.test', '+15550301001',
    'going', 2, '[{"phone":"+15550309777"},{"phone":"+15550301004"}]'::jsonb, NULL, 'US');
  SELECT g.id INTO v_gid FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = (v_res->>'rsvpId')::uuid AND g.phone = '+15550301004';
  PERFORM pg_temp.ok((SELECT matched_user_id = v_gil AND claimed_at IS NULL
      FROM public.event_rsvp_guests WHERE id = v_gid), 'fixture: Gil''s number matched, unclaimed');
  v_code := public.mint_claim_link('rsvp_guest', v_gid)->>'code';
  v_res := public.rsvp_guest_claim(v_gil, v_code, NULL);
  PERFORM pg_temp.ok(v_res->>'outcome' = 'claimed' AND (v_res->>'closeFriend')::boolean,
    'a claim between two free accounts at the limit still makes them close friends: ' || v_res::text);
  PERFORM pg_temp.ok((SELECT current_count FROM public.check_pairing_allowed(v_inv)) = 1
    AND (SELECT current_count FROM public.check_pairing_allowed(v_gil)) = 1,
    'the allowance still counts only the one ordinary pairing on each side');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.pairings
      WHERE v_inv IN (user_a_id, user_b_id) OR v_gil IN (user_a_id, user_b_id)) = 3,
    'three pairings exist: two ordinary, one rsvp_guest');

  -- ---- 6. Cap edges --------------------------------------------------------
  -- 20 per inviter: 19 already logged for Kai, one more is the 20th (ok), the
  -- next is the 21st (refused, nothing written).
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'user:' || v_kai, v_ev2, '1555077' || lpad(i::text, 4, '0') FROM generate_series(1, 19) i;
  v_err := pg_temp.try_guests(v_ev, v_kai, '+15550301006', 1, '[{"phone":"+15550308020"}]');
  PERFORM pg_temp.ok(v_err = '', 'the 20th number in 24 hours is accepted: ' || v_err);
  v_err := pg_temp.try_guests(v_ev, v_kai, '+15550301006', 2, '[{"phone":"+15550308020"},{"phone":"+15550308021"}]');
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_daily_cap', 'the 21st number in 24 hours is refused: ' || v_err);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE phone = '+15550308021')
    AND (SELECT count(*) FROM public.rsvp_guest_invite_log WHERE inviter_key = 'user:' || v_kai) = 20,
    'the refused submit wrote no guest and no log row');
  -- Re-sending the same party does not count again.
  v_err := pg_temp.try_guests(v_ev, v_kai, '+15550301006', 1, '[{"phone":"+15550308020"}]');
  PERFORM pg_temp.ok(v_err = '', 're-sending an unchanged party at the cap is fine: ' || v_err);
  -- 3 per number: a number with 3 invites in 24 hours is added but held.
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'user:' || gen_random_uuid(), v_ev2, '15550308555' FROM generate_series(1, 3);
  v_res := public.submit_event_rsvp(v_ev, v_owner, 'Owner', 't-owner@example.test', NULL,
    'going', 1, '[{"phone":"+15550308555"}]'::jsonb, NULL, NULL);
  PERFORM pg_temp.ok((v_res->'guests'->0->>'willText')::boolean IS FALSE
    AND v_res->'guests'->0->>'notTextedReason' = 'number_limit'
    AND (SELECT sms_hold FROM public.event_rsvp_guests WHERE phone = '+15550308555') = 'number_limit',
    'the 4th invite to one number in 24 hours is held: ' || v_res::text);
  -- An invite older than 24 hours no longer counts.
  UPDATE public.rsvp_guest_invite_log SET created_at = now() - interval '25 hours'
   WHERE phone_digits = '15550308556';
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits, created_at)
  SELECT 'user:' || gen_random_uuid(), v_ev2, '15550308556', now() - interval '25 hours' FROM generate_series(1, 3);
  v_res := public.submit_event_rsvp(v_ev, v_owner, 'Owner', 't-owner@example.test', NULL,
    'going', 2, '[{"phone":"+15550308555"},{"phone":"+15550308556"}]'::jsonb, NULL, NULL);
  PERFORM pg_temp.ok((SELECT sms_hold IS NULL FROM public.event_rsvp_guests WHERE phone = '+15550308556'),
    'invites older than 24 hours do not hold a number');
  -- 300 signed-out texts. [changed by the implementor in fix round 4, T1:
  -- a signed-out caller can no longer add a guest at all, so at 299 and
  -- past 300 the signed-out submit is refused, nothing is logged and no
  -- ceiling hold is recorded; it was texted at 300 and held at 301.]
  -- A signed-in inviter is never held by it.
  DELETE FROM public.rsvp_guest_invite_log WHERE inviter_key LIKE 'ip:%';
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  SELECT 'ip:' || md5(i::text) || md5(i::text), v_ev2, '1555066' || lpad(i::text, 4, '0') FROM generate_series(1, 299) i;
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon Four', 'anon4-t4508@example.test',
    '+15550309904', 'going', 1, '[{"phone":"+15550308300"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required',
    'a signed-out guest at 299 signed-out texts is refused: ' || v_err);
  INSERT INTO public.rsvp_guest_invite_log(inviter_key, event_id, phone_digits)
  VALUES ('ip:' || repeat('f', 64), v_ev2, '15550308399');
  v_err := pg_temp.err(format($s$SELECT public.submit_event_rsvp(%L, NULL, 'Anon Five', 'anon5-t4508@example.test',
    '+15550309905', 'going', 1, '[{"phone":"+15550308301"}]'::jsonb, NULL, 'US')$s$, v_ev));
  PERFORM pg_temp.ok(v_err = 'rsvp_guest_sign_in_required'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE phone IN ('+15550308300', '+15550308301'))
    AND (SELECT count(*) FROM public.rsvp_guest_invite_log WHERE inviter_key LIKE 'ip:%') = 300,
    'past the ceiling a signed-out guest is refused and nothing is logged: ' || v_err);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_guest_signed_out_ceiling_hits
      WHERE hit_day = (now() AT TIME ZONE 'UTC')::date),
    'no signed-out guest reaches the ceiling, so no hold is recorded');
  v_res := public.submit_event_rsvp(v_ev, v_owner, 'Owner', 't-owner@example.test', NULL,
    'going', 3, '[{"phone":"+15550308555"},{"phone":"+15550308556"},{"phone":"+15550308302"}]'::jsonb, NULL, NULL);
  PERFORM pg_temp.ok((SELECT sms_hold IS NULL FROM public.event_rsvp_guests WHERE phone = '+15550308302'),
    'a signed-in inviter is not held by the signed-out ceiling');

  RAISE NOTICE '#4508 tester adversarial: all cases passed';
END
$test$;

ROLLBACK;
