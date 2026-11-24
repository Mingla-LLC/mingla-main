-- #4490 fix round 3 (20281203244490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-EVENT-TAKES-ITS-PLACE | issue #4490 | a scheduled or live event saved as "takes the space" holds every space it sits in (one space, each part of a combination, or every open space of the venue) for each of its dates, so hires, by-the-hour bookings and blocks over it are refused, and it cannot go live over a committed hire or block (event_space_taken).
-- MINGLA-INVARIANT: I-4490-WAITLIST-SPACE-OF-ITS-VENUE | issue #4490 | a waitlist row's preferred space is a space of that row's venue.
-- MINGLA-INVARIANT: I-4490-EVENT-ONE-PLACE | issue #4490 | an event sits in one space OR one combination of its own venue OR the whole venue, never two.
--
-- S one space (N101). C combination (N106). W whole venue. B refusal. K calendar (N102). Q waitlist space (N112). A authority.
--
-- FAILS-ON-REVERT (seen): without 20281203244490 S-1b fails (event_space_taken: the duplicated date clashes with
-- itself), C-1a fails (no p_combination_id) and W-1 claims nothing.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;
CREATE FUNCTION public.t4490_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_ok(boolean, text), public.t4490_expect(text, text, text, text),
  public.t4490_as(uuid), public.t4490_service(), public.t4490_reset() TO PUBLIC;

-- People: 01 owner, 05 outsider.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44907000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'f3u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 5) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44907000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Harmattan F3 4490',
        'harmattan-f3-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'gamelandf34490', 'Gameland F3', 6.45, 3.41, 'play', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a2', '44907000-0000-4000-9000-000000000010', 'arcadef34490', 'Arcade F3', 6.45, 3.42, 'play', 'verified', 'NG');

CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
GRANT EXECUTE ON FUNCTION public.t4490_id(text) TO PUBLIC;
-- The event night: 10 days out, 19:00-23:00 Lagos.
CREATE TEMP TABLE t4490_night ON COMMIT DROP AS
  SELECT ((current_date + 10) + time '19:00') AT TIME ZONE 'Africa/Lagos' AS s,
         ((current_date + 10) + time '23:00') AT TIME ZONE 'Africa/Lagos' AS e,
         (current_date + 10) AS d;
GRANT ALL ON t4490_night TO PUBLIC;

-- Fixture (owner): Gameland has The Lounge Side, Green Area North and South,
-- the combinations "Whole Green Area" and "Green Area + Lounge"; Arcade has a
-- Main floor and its own combination.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 constant uuid := '44907000-0000-4000-9000-0000000000a1';
  a2 constant uuid := '44907000-0000-4000-9000-0000000000a2';
BEGIN
  INSERT INTO t4490_ids SELECT 'lounge', (public.issue_4490_manage_space('create', a1,
    '{"name":"The Lounge Side","setting":"covered","capacity_standing":200}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'north', (public.issue_4490_manage_space('create', a1,
    '{"name":"Green Area North","setting":"outdoor","capacity_standing":150}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'south', (public.issue_4490_manage_space('create', a1,
    '{"name":"Green Area South","setting":"outdoor","capacity_standing":150}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'wholegreen', (public.issue_4490_manage_space_combination('create', a1,
    jsonb_build_object('name', 'Whole Green Area', 'space_ids', jsonb_build_array(public.t4490_id('north'), public.t4490_id('south'))))->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'greenlounge', (public.issue_4490_manage_space_combination('create', a1,
    jsonb_build_object('name', 'Green Area + Lounge', 'space_ids',
      jsonb_build_array(public.t4490_id('north'), public.t4490_id('south'), public.t4490_id('lounge'))))->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'a2main', (public.issue_4490_manage_space('create', a2,
    '{"name":"Main floor","setting":"indoor","capacity_standing":100}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'a2side', (public.issue_4490_manage_space('create', a2,
    '{"name":"Side room","setting":"indoor","capacity_standing":40}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'a2combo', (public.issue_4490_manage_space_combination('create', a2,
    jsonb_build_object('name', 'Both rooms', 'space_ids', jsonb_build_array(public.t4490_id('a2main'), public.t4490_id('a2side'))))->>'id')::uuid;
END
$fx$;
SELECT public.t4490_reset();

-- Three scheduled events at Gameland with no place yet (shared): Karaoke has
-- its date twice (the duplicate the seed data has), Quiz a cancelled second
-- date, Cookout one date.
DO $ev$
DECLARE
  k text;
  v uuid;
BEGIN
  FOREACH k IN ARRAY ARRAY['karaoke', 'quiz', 'cookout', 'clash'] LOOP
    v := gen_random_uuid();
    INSERT INTO t4490_ids VALUES (k, v);
    INSERT INTO public.events (id, brand_id, created_by, title, slug, status, venue_id, space_id, space_use)
    VALUES (v, '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', initcap(k) || ' night',
            k || '-f3-4490', 'scheduled', '44907000-0000-4000-9000-0000000000a1', NULL, 'shared');
  END LOOP;
  INSERT INTO public.event_dates (event_id, start_at, end_at)
  SELECT public.t4490_id('karaoke'), s, e FROM t4490_night, generate_series(1, 2);
  INSERT INTO public.event_dates (event_id, start_at, end_at)
  SELECT public.t4490_id('quiz'), s + interval '1 day', e + interval '1 day' FROM t4490_night;
  INSERT INTO public.event_dates (event_id, start_at, end_at, status, cancelled_at)
  SELECT public.t4490_id('quiz'), s + interval '2 day', e + interval '2 day', 'cancelled', now() FROM t4490_night;
  INSERT INTO public.event_dates (event_id, start_at, end_at)
  SELECT public.t4490_id('cookout'), s + interval '3 day', e + interval '3 day' FROM t4490_night;
  INSERT INTO public.event_dates (event_id, start_at, end_at)
  SELECT public.t4490_id('clash'), s + interval '4 day', e + interval '4 day' FROM t4490_night;
END
$ev$;
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_space_claims WHERE source = 'event'),
  'X-0 shared events (single space or whole venue) hold nothing');

-- ===========================================================================
-- S: one space, "This event takes the space".
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_ok(
  (public.issue_4490_set_event_venue(public.t4490_id('karaoke'), '44907000-0000-4000-9000-0000000000a1',
     public.t4490_id('lounge'), 'exclusive', NULL)->>'space_use') = 'exclusive',
  'S-1a the event saves "takes the space" (old five-argument call still works)');
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_space_claims
    WHERE event_id = public.t4490_id('karaoke') AND state = 'committed' AND space_id = public.t4490_id('lounge')) = 1,
  'S-1b an event whose date is listed twice claims The Lounge Side once (it used to clash with itself)');
SELECT public.t4490_ok((SELECT s.status FROM public.issue_4490_spaces_status(ARRAY[public.t4490_id('lounge')],
    (SELECT tstzrange(s, e, '[)') FROM t4490_night), NULL) s) = 'taken'
  AND (SELECT s.blocking_source FROM public.issue_4490_spaces_status(ARRAY[public.t4490_id('lounge')],
    (SELECT tstzrange(s, e, '[)') FROM t4490_night), NULL) s) = 'event',
  'S-1c the space reads taken by an event that night (what hire options and by-the-hour read)');
SELECT public.t4490_ok((SELECT s.status FROM public.issue_4490_spaces_status(
    ARRAY[public.t4490_id('north'), public.t4490_id('south'), public.t4490_id('lounge')],
    (SELECT tstzrange(s, e, '[)') FROM t4490_night), NULL) s) = 'taken',
  'S-1d "Green Area + Lounge" (contains the Lounge) reads taken that night');
SELECT public.t4490_expect($$INSERT INTO public.venue_space_claims (space_id, source, booked_range, claim_range, state, block_reason)
    SELECT public.t4490_id('lounge'), 'block', tstzrange(s + interval '1 hour', e, '[)'), tstzrange(s + interval '1 hour', e, '[)'),
           'committed', 'Repairs' FROM t4490_night$$,
  '23P01', NULL, 'S-1e nothing else can claim The Lounge Side over the event (the no-double-booking rule hires use)');

SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_event_venue(public.t4490_id('quiz'), '44907000-0000-4000-9000-0000000000a1',
  public.t4490_id('lounge'), 'exclusive', NULL);
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_space_claims WHERE event_id = public.t4490_id('quiz') AND state = 'committed') = 1,
  'S-2 a cancelled date is not claimed');

SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_event_venue(public.t4490_id('quiz'), '44907000-0000-4000-9000-0000000000a1',
  public.t4490_id('lounge'), 'shared', NULL);
SELECT public.t4490_reset();
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_space_claims WHERE event_id = public.t4490_id('quiz') AND state = 'committed'),
  'S-3 "The space stays open to others" lets the space go');

-- ===========================================================================
-- C: a combination (N106).
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_ok(
  (public.issue_4490_set_event_venue(p_event_id => public.t4490_id('cookout'), p_venue_id => '44907000-0000-4000-9000-0000000000a1',
     p_space_id => NULL, p_space_use => 'exclusive', p_combination_id => public.t4490_id('wholegreen'))->>'combination_id')
    = public.t4490_id('wholegreen')::text,
  'C-1a an event can sit in a combination ("Whole Green Area")');
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT array_agg(space_id ORDER BY space_id) FROM public.venue_space_claims
    WHERE event_id = public.t4490_id('cookout') AND state = 'committed' AND via_combination_id = public.t4490_id('wholegreen'))
  = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[public.t4490_id('north'), public.t4490_id('south')]) x),
  'C-1b taking a combination claims both halves (through the combination)');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_set_event_venue(p_event_id => %L, p_venue_id => %L,
    p_space_id => %L, p_space_use => 'shared', p_combination_id => %L)$$,
    public.t4490_id('cookout'), '44907000-0000-4000-9000-0000000000a1', public.t4490_id('lounge'), public.t4490_id('wholegreen')),
  '22023', 'event_one_place', 'C-2a a space and a combination at once is refused');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_set_event_venue(p_event_id => %L, p_venue_id => %L,
    p_space_id => NULL, p_space_use => 'shared', p_combination_id => %L)$$,
    public.t4490_id('cookout'), '44907000-0000-4000-9000-0000000000a1', public.t4490_id('a2combo')),
  '22023', 'event_space_not_in_venue', 'C-2b another venue''s combination is refused');
SELECT public.t4490_reset();
SELECT public.t4490_expect($$UPDATE public.events SET space_id = public.t4490_id('lounge') WHERE id = public.t4490_id('cookout')$$,
  '23514', NULL, 'C-2c the table itself never holds a space and a combination together');

-- ===========================================================================
-- W: the whole venue.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_event_venue(public.t4490_id('clash'), '44907000-0000-4000-9000-0000000000a1', NULL, 'exclusive', NULL);
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT count(DISTINCT space_id) FROM public.venue_space_claims
    WHERE event_id = public.t4490_id('clash') AND state = 'committed') = 3,
  'W-1 an event that takes the whole venue claims every space');
UPDATE public.events SET status = 'cancelled' WHERE id = public.t4490_id('clash');
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_space_claims WHERE event_id = public.t4490_id('clash') AND state = 'committed'),
  'W-2 cancelling it frees every space');

-- ===========================================================================
-- B: an event cannot take a space that is already hired or blocked.
-- ===========================================================================
INSERT INTO public.venue_space_claims (space_id, source, booked_range, claim_range, state, block_reason)
SELECT public.t4490_id('south'), 'block', tstzrange(s + interval '5 day', e + interval '5 day', '[)'),
       tstzrange(s + interval '5 day', e + interval '5 day', '[)'), 'committed', 'Private party' FROM t4490_night;
DO $b1$
DECLARE
  v uuid := gen_random_uuid();
BEGIN
  INSERT INTO t4490_ids VALUES ('late', v);
  INSERT INTO public.events (id, brand_id, created_by, title, slug, status, venue_id, space_id, space_use)
  VALUES (v, '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Late show',
          'late-f3-4490', 'draft', '44907000-0000-4000-9000-0000000000a1', NULL, 'shared');
  INSERT INTO public.event_dates (event_id, start_at, end_at, is_master)
  SELECT v, s + interval '5 day', e + interval '5 day', true FROM t4490_night;
END
$b1$;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_event_venue(p_event_id => public.t4490_id('late'), p_venue_id => '44907000-0000-4000-9000-0000000000a1',
  p_space_id => NULL, p_space_use => 'exclusive', p_combination_id => public.t4490_id('wholegreen'));
SELECT public.t4490_reset();
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_space_claims WHERE event_id = public.t4490_id('late')),
  'B-1a a draft holds nothing yet, even when it takes the space');
SELECT public.t4490_expect($$UPDATE public.events SET status = 'scheduled' WHERE id = public.t4490_id('late')$$,
  'PT409', 'event_space_taken', 'B-1b going live over a blocked half of the combination is refused (event_space_taken)');
SELECT public.t4490_ok((SELECT status FROM public.events WHERE id = public.t4490_id('late')) = 'draft',
  'B-1c the refused event stays a draft');
INSERT INTO public.venue_space_claims (space_id, source, booked_range, claim_range, state, block_reason)
SELECT public.t4490_id('lounge'), 'block', tstzrange(s + interval '3 day', e + interval '3 day', '[)'),
       tstzrange(s + interval '3 day', e + interval '3 day', '[)'), 'committed', 'Repairs' FROM t4490_night;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_set_event_venue(%L, %L, NULL, 'exclusive', NULL)$$,
    public.t4490_id('cookout'), '44907000-0000-4000-9000-0000000000a1'),
  'PT409', 'event_space_taken', 'B-2a moving a live event to the whole venue on a night the Lounge is blocked is refused');
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT combination_id FROM public.events WHERE id = public.t4490_id('cookout')) = public.t4490_id('wholegreen')
  AND (SELECT count(*) FROM public.venue_space_claims WHERE event_id = public.t4490_id('cookout') AND state = 'committed') = 2,
  'B-2b the refused change leaves the event where it was, still holding its two halves');

-- ===========================================================================
-- K: the Host calendar (N102).
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $k$
DECLARE
  v jsonb;
  v_ev jsonb;
BEGIN
  v := public.issue_4490_venue_calendar('44907000-0000-4000-9000-0000000000a1',
    (SELECT d FROM t4490_night), (SELECT d + 4 FROM t4490_night));
  SELECT x INTO v_ev FROM jsonb_array_elements(v->'events') x WHERE x->>'eventId' = public.t4490_id('cookout')::text LIMIT 1;
  PERFORM public.t4490_ok(v_ev->>'combinationId' = public.t4490_id('wholegreen')::text
    AND jsonb_array_length(v_ev->'spaceIds') = 2,
    'K-1 the calendar names the event''s combination and the spaces it sits in');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'combinationBlocks') b
      WHERE b->>'combinationId' = public.t4490_id('greenlounge')::text AND b->>'blockedBy' = 'The Lounge Side'),
    'K-2 "Green Area + Lounge" shows the Lounge in use on the event night');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'events') x
      WHERE x->>'eventId' = public.t4490_id('quiz')::text AND (x->>'startsAt')::timestamptz > (SELECT s + interval '36 hours' FROM t4490_night)),
    'K-3 a cancelled date is not listed');
END
$k$;
SELECT public.t4490_reset();

-- ===========================================================================
-- Q: the waitlist asks for one of the venue's own spaces (N112).
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
INSERT INTO public.venue_waitlist (brand_id, venue_id, guest_name, party_size, preferred_space_id)
VALUES ('44907000-0000-4000-9000-000000000010', '44907000-0000-4000-9000-0000000000a1', 'Ada', 4, public.t4490_id('lounge'));
SELECT public.t4490_ok((SELECT preferred_space_id FROM public.venue_waitlist WHERE guest_name = 'Ada') = public.t4490_id('lounge'),
  'Q-1 a walk-in can ask for The Lounge Side');
SELECT public.t4490_expect(format($$INSERT INTO public.venue_waitlist (brand_id, venue_id, guest_name, party_size, preferred_space_id)
    VALUES (%L, %L, 'Bola', 2, %L)$$, '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-9000-0000000000a1', public.t4490_id('a2main')),
  '23514', 'waitlist_space_not_in_venue', 'Q-2 another venue''s space is refused');
SELECT public.t4490_reset();

SELECT public.t4490_ok(pg_get_functiondef('public.issue_4490_member_projection(uuid,text,text)'::regprocedure) ~ $re$IF p_view = 'guest' THEN\s+v_result := v_result \|\| jsonb_build_object\('memberEmail', v_sub.member_email\)$re$,
  'M-1 the member''s own view carries their email (member checkout fills it in)');

SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_set_event_venue(%L, %L, %L, 'exclusive', NULL)$$,
    public.t4490_id('karaoke'), '44907000-0000-4000-9000-0000000000a1', public.t4490_id('lounge')),
  '42501', 'not_authorized', 'A-1 a stranger cannot place or change an event');
SELECT public.t4490_reset();
ROLLBACK;
