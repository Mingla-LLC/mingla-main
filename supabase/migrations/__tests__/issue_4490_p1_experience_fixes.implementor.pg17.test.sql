\set ON_ERROR_STOP on
-- #4490 P1-4: executable PostgreSQL 17 proof of the experience creator fixes
-- (20281203034490, spec 01 §6). BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-EXPERIENCE-SHARED-SPOTS | issue #4490 | when an experience shares spots, every price option counts against the same spots (per day for per_day experiences); experiences saved before #4490 keep per-option counting (backfilled false), new ones share (column default true).
--
-- X-1  group size 150 is accepted; 100001 is refused as a price error (no smallint overflow).
-- X-2  a 120-minute block is accepted; 50 minutes (not a 15-minute step) is refused.
-- X-3  a blank price-option name is refused at every index; nothing becomes "Standard".
-- X-4  shared spots: with one spot shared by two options, a second booking on the same day is refused;
--      without sharing the old per-option count is unchanged.
-- X-5  per_day with a 12:00-23:59 window and several starts is accepted (Rule A gone).
-- X-6  publishing with an empty cover URL keeps the server's cover and does not raise.
-- X-7  #3645's paid-with-no-priced-option guard survives this file's re-emit (it runs after #3645).
--
-- FAILS-ON-REVERT: restore the 2..50 group check -> X-1a; restore the blank-name "Standard" fallback -> X-3a;
-- drop the shared-types branch of slot_taken -> X-4a; restore the persist-mismatch raise for an empty URL -> X-6a;
-- delete the #3645 2C block from the price-options re-emit -> X-7a (seen 24 Nov at 435a9edd8c: published, no raise).

BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

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
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;


CREATE TEMP TABLE x_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON x_ids TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44903000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x1-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44903000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('44903000-0000-4000-9000-000000000010', '44903000-0000-4000-8000-000000000001', 'Exp 4490', 'exp-4490', 'NGN', now(), now());

SELECT public.t4490_as('44903000-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  v_day text := to_char(now() + interval '14 days', 'YYYY-MM-DD');
  v_res jsonb;
BEGIN
  v_res := public.biz_create_experience('44903000-0000-4000-9000-000000000010', jsonb_build_object(
    'title', 'Paint and Play',
    'description', 'A paint party in the garden.',
    'currency', 'NGN',
    'is_free', true,
    'pricing_mode', 'whole',
    'whole_price_cents', 0,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'Africa/Lagos',
    'whenMode', 'single',
    'when', jsonb_build_object('date', v_day, 'doorsOpen', '12:00', 'endsAt', '23:59'),
    'stops', jsonb_build_array(jsonb_build_object(
      'stop_order', 0, 'place_name', 'Garden', 'ai_description', 'Where the paint happens.',
      'address', '1 Garden Rd', 'place_id', 'x4490-place-1', 'lat', 6.45, 'lng', 3.39)),
    'price_options', jsonb_build_array(
      jsonb_build_object('name', 'Solo', 'price_cents', 0, 'price_basis', 'person'),
      jsonb_build_object('name', 'Squad', 'price_cents', 0, 'price_basis', 'group', 'group_max', 150),
      jsonb_build_object('name', 'Lane hire', 'price_cents', 0, 'price_basis', 'block',
        'block_minutes', 120, 'min_blocks', 1, 'max_blocks', 3))
  ), false);
  INSERT INTO x_ids VALUES ('event', (v_res->'event'->>'id')::uuid);
END
$setup$;
SELECT public.t4490_reset();

-- X-1 / X-2 group and block sizes --------------------------------------------------------
SELECT public.t4490_ok(
  (SELECT group_max FROM public.ticket_types WHERE event_id = (SELECT v FROM x_ids WHERE k = 'event') AND name = 'Squad' AND deleted_at IS NULL) = 150,
  'X-1a a group of 150 saves (the 2..50 cap is gone)');
SELECT public.t4490_expect(
  format($$SELECT public.issue_3281_apply_experience_price_options(%L, 'NGN', 'whole', 0, NULL,
    '[{"name":"Huge","price_cents":0,"price_basis":"group","group_max":100001}]'::jsonb, false)$$, (SELECT v FROM x_ids WHERE k = 'event')),
  'P0001', 'experience_price_invalid', 'X-1b a group of 100001 is a price error, not an overflow');
SELECT public.t4490_expect(
  format($$UPDATE public.ticket_types SET group_max = 1 WHERE event_id = %L AND name = 'Squad'$$, (SELECT v FROM x_ids WHERE k = 'event')),
  '23514', NULL, 'X-1c the table still refuses a group below 2');
SELECT public.t4490_ok(
  (SELECT block_minutes FROM public.ticket_types WHERE event_id = (SELECT v FROM x_ids WHERE k = 'event') AND name = 'Lane hire' AND deleted_at IS NULL) = 120,
  'X-2a a 120-minute block saves (the 60-minute cap is gone)');
SELECT public.t4490_expect(
  format($$SELECT public.issue_3281_apply_experience_price_options(%L, 'NGN', 'whole', 0, NULL,
    '[{"name":"Odd","price_cents":0,"price_basis":"block","block_minutes":50,"min_blocks":1,"max_blocks":2}]'::jsonb, false)$$, (SELECT v FROM x_ids WHERE k = 'event')),
  'P0001', 'experience_price_invalid', 'X-2b a 50-minute block is refused (15-minute steps)');
SELECT public.t4490_expect(
  format($$SELECT public.issue_3281_apply_experience_price_options(%L, 'NGN', 'whole', 0, NULL,
    '[{"name":"Long","price_cents":0,"price_basis":"block","block_minutes":1455,"min_blocks":1,"max_blocks":2}]'::jsonb, false)$$, (SELECT v FROM x_ids WHERE k = 'event')),
  'P0001', 'experience_price_invalid', 'X-2c a block longer than a day is refused');

-- X-3 names ------------------------------------------------------------------------------
SELECT public.t4490_expect(
  format($$SELECT public.issue_3281_apply_experience_price_options(%L, 'NGN', 'whole', 0, NULL,
    '[{"name":"  ","price_cents":0,"price_basis":"person"}]'::jsonb, false)$$, (SELECT v FROM x_ids WHERE k = 'event')),
  '22023', 'experience_price_name_required', 'X-3a a blank first price name is refused (no forced "Standard")');
SELECT public.t4490_expect(
  format($$SELECT public.issue_3281_apply_experience_price_options(%L, 'NGN', 'whole', 0, NULL,
    '[{"name":"Solo","price_cents":0,"price_basis":"person"},{"price_cents":0,"price_basis":"person"}]'::jsonb, false)$$, (SELECT v FROM x_ids WHERE k = 'event')),
  '22023', 'experience_price_name_required', 'X-3b a blank later price name is refused (no "Option 2")');
SELECT public.t4490_ok(
  NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = (SELECT v FROM x_ids WHERE k = 'event') AND deleted_at IS NULL
              AND name IN ('Standard', 'Option 2', 'Option 3')),
  'X-3c every saved option carries the name the host typed');

-- X-7 #3645 kept (fix 4, P1-A): this file runs after #3645's 20280806003645, so its re-emit
-- carries the paid-with-no-priced-option guard: a paid whole-price experience whose options
-- are all 0 is refused, never published free.
SELECT public.t4490_expect(
  format($$SELECT public.issue_3281_apply_experience_price_options(%L, 'NGN', 'whole', 500000, NULL,
    '[{"name":"Solo","price_cents":0,"price_basis":"person"},{"name":"Pair","price_cents":0,"price_basis":"person"}]'::jsonb, false)$$, (SELECT v FROM x_ids WHERE k = 'event')),
  'P0001', 'experience_price_invalid', 'X-7a a paid whole-price experience with only 0 options is refused (#3645 2C)');
SELECT public.t4490_ok(
  position('issue_3645_2c: paid with no priced option' in pg_get_functiondef(
    'public.issue_3281_apply_experience_price_options(uuid,text,text,integer,integer,jsonb,boolean)'::regprocedure)) > 0,
  'X-7b the live body keeps #3645''s guard alongside the #4490 changes');

-- X-4 shared spots -----------------------------------------------------------------------
DO $x4$
DECLARE
  v_event uuid := (SELECT v FROM x_ids WHERE k = 'event');
  v_date uuid;
  v_solo uuid;
  v_squad uuid;
  v_day_start timestamptz;
  v_order uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_date FROM public.event_dates WHERE event_id = v_event ORDER BY start_at LIMIT 1;
  IF v_date IS NULL THEN
    -- A draft carries its dates only after publish; give this one its day.
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, ((now() AT TIME ZONE 'Africa/Lagos')::date + 14 + time '12:00') AT TIME ZONE 'Africa/Lagos',
            ((now() AT TIME ZONE 'Africa/Lagos')::date + 14 + time '23:59') AT TIME ZONE 'Africa/Lagos', 'Africa/Lagos', true)
    RETURNING id INTO v_date;
  END IF;
  SELECT id INTO v_solo FROM public.ticket_types WHERE event_id = v_event AND name = 'Solo' AND deleted_at IS NULL;
  SELECT id INTO v_squad FROM public.ticket_types WHERE event_id = v_event AND name = 'Squad' AND deleted_at IS NULL;
  SELECT start_at INTO v_day_start FROM public.event_dates WHERE id = v_date;
  PERFORM public.t4490_ok((SELECT spots_shared FROM public.events WHERE id = v_event)
      AND (SELECT column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'spots_shared') = 'true',
    'X-4a a new experience shares its spots by default (existing rows were backfilled false)');
  -- Per-option counting, as every experience published before #4490 keeps.
  PERFORM public.issue_3281_apply_experience_r3_settings(v_event, jsonb_build_object('spots_shared', false));
  INSERT INTO public.orders (id, event_id, payment_status, payment_method, source, total_cents, currency, buyer_phone_e164,
                             event_date_id, booked_start_at, booked_end_at)
  VALUES (v_order, v_event, 'paid', 'apple_pay', 'online_checkout', 0, 'ngn', '+2348025550101',
          v_date, v_day_start, v_day_start + interval '1 hour');
  INSERT INTO public.order_line_items (order_id, ticket_type_id, quantity, unit_price_cents) VALUES (v_order, v_solo, 1, 0);
  PERFORM public.t4490_ok(
    public.issue_3281_ticket_type_slot_taken(v_squad, v_date, v_day_start, v_day_start + interval '1 hour') = 0
    AND public.issue_3281_ticket_type_slot_taken(v_solo, v_date, v_day_start, v_day_start + interval '1 hour') = 1,
    'X-4b not shared: the Solo booking counts only against Solo (unchanged)');
  PERFORM public.issue_3281_apply_experience_r3_settings(v_event, jsonb_build_object('spots_shared', true, 'capacity_scope', 'per_day'));
  PERFORM public.t4490_ok(
    public.issue_3281_ticket_type_slot_taken(v_squad, v_date, v_day_start + interval '3 hours', v_day_start + interval '4 hours') = 1,
    'X-4c shared + per_day: a Squad start three hours later sees the Solo booking that day (1 of 1 spot taken, so refused)');
  PERFORM public.t4490_ok(
    public.issue_3281_ticket_type_slot_taken(v_squad, v_date, v_day_start + interval '1 day', v_day_start + interval '1 day 1 hour') = 0,
    'X-4d the next day is free');
  PERFORM public.issue_3281_apply_experience_r3_settings(v_event, jsonb_build_object('capacity_scope', 'per_start'));
  PERFORM public.t4490_ok(
    public.issue_3281_ticket_type_slot_taken(v_squad, v_date, v_day_start + interval '3 hours', v_day_start + interval '4 hours') = 0
    AND public.issue_3281_ticket_type_slot_taken(v_squad, v_date, v_day_start, v_day_start + interval '1 hour') = 1
    AND (SELECT spots_shared FROM public.events WHERE id = v_event),
    'X-4e shared per start: only the overlapping start counts; an absent key keeps sharing on');
END
$x4$;

-- X-5 Rule A gone --------------------------------------------------------------------------
DO $x5$
DECLARE
  v_event uuid := (SELECT v FROM x_ids WHERE k = 'event');
BEGIN
  PERFORM public.issue_3281_apply_experience_r3_settings(v_event, jsonb_build_object('capacity_scope', 'per_day', 'booking_spacing_minutes', 30));
  PERFORM public.t4490_ok((SELECT capacity_scope = 'per_day' FROM public.events WHERE id = v_event),
    'X-5 per_day with a 12:00-23:59 window and 30-minute starts is accepted');
END
$x5$;

-- X-6 cover still processing ------------------------------------------------------------------
UPDATE public.events
   SET cover_media_url = 'https://video.example.test/x4490/play.m3u8',
       cover_media_type = 'video',
       cover_media_poster_url = 'https://video.example.test/x4490/poster.jpg'
 WHERE id = (SELECT v FROM x_ids WHERE k = 'event');
SELECT public.t4490_as('44903000-0000-4000-8000-000000000001');
DO $x6$
DECLARE
  v_event uuid := (SELECT v FROM x_ids WHERE k = 'event');
  v_day text := to_char(now() + interval '14 days', 'YYYY-MM-DD');
BEGIN
  PERFORM public.issue_1719_publish_experience_with_poster(v_event, jsonb_build_object(
    'title', 'Paint and Play',
    'description', 'A paint party in the garden.',
    'currency', 'NGN',
    'is_free', true,
    'pricing_mode', 'whole',
    'whole_price_cents', 0,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'Africa/Lagos',
    'whenMode', 'single',
    'when', jsonb_build_object('date', v_day, 'doorsOpen', '12:00', 'endsAt', '23:59'),
    'stops', jsonb_build_array(jsonb_build_object(
      'stop_order', 0, 'place_name', 'Garden', 'ai_description', 'Where the paint happens.',
      'address', '1 Garden Rd', 'place_id', 'x4490-place-1', 'lat', 6.45, 'lng', 3.39)),
    'price_options', jsonb_build_array(jsonb_build_object('name', 'Solo', 'price_cents', 0, 'price_basis', 'person')),
    'cover', jsonb_build_object('coverMediaUrl', '', 'coverMediaType', 'video', 'coverMediaPosterUrl', '')
  ), false);
  PERFORM public.t4490_ok(true, 'X-6a an empty cover URL (video still processing) does not raise cover_media_persist_mismatch');
END
$x6$;
SELECT public.t4490_reset();
SELECT public.t4490_ok(
  (SELECT cover_media_url = 'https://video.example.test/x4490/play.m3u8' AND cover_media_type = 'video'
     AND cover_media_poster_url = 'https://video.example.test/x4490/poster.jpg'
   FROM public.events WHERE id = (SELECT v FROM x_ids WHERE k = 'event')),
  'X-6b the server keeps its cover, type and poster');

ROLLBACK;
