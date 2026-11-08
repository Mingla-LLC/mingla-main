\set ON_ERROR_STOP on
-- #4318: the /links data layer, executable PostgreSQL 17 proof.
--
-- W  links_page_week(): one row per occurrence date in the next 7 days of
--    public, published, upcoming events, experiences and trips; private, draft,
--    cancelled, deleted, undiscoverable and past items never appear; a withheld
--    address gives no place text and only a coarse point.
-- S  links_page_strips() and the table: anon reads only published, unexpired
--    strips (and a blog strip only while its post is public) and never writes.
-- A  admin_links_*: a signed-in user who is not Support staff is refused.
-- V  admin_links_strip_save validates opens, url and blog, strips the URL
--    scheme, and puts a new strip on top.
-- R  admin_links_strips_reorder rejects a stale, partial or padded set (PT409)
--    and applies an exact one.
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

CREATE FUNCTION pg_temp.issue_4318_act(p_user uuid) RETURNS void LANGUAGE sql AS $function$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
         set_config(
           'request.jwt.claims',
           CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END,
           true
         );
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.issue_4318_act(uuid) TO anon, authenticated;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

-- ── People ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('43180000-0000-4000-a000-000000000001', 'issue4318-outsider@test.local', now()),
  ('43180000-0000-4000-a000-000000000002', 'issue4318-support@test.local', now()),
  ('43180000-0000-4000-a000-000000000003', 'issue4318-host@test.local', now());
INSERT INTO public.admin_team_members (email, role, status, accepted_at) VALUES
  ('issue4318-support@test.local', 'growth', 'active', now());
INSERT INTO public.support_staff (user_id, enabled, available, role) VALUES
  ('43180000-0000-4000-a000-000000000002', true, false, 'staff');

-- ── Listings ──────────────────────────────────────────────────────────────
INSERT INTO public.creator_accounts (id) VALUES ('43180000-0000-4000-a000-000000000003');
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'Issue 4318 Collective', 'issue-4318-collective', 'USD', now(), now());

-- e1 public weekly event, address shown (hideAddressUntilTicket=false).
-- e2 public event, address withheld (the default).
-- e3 private, e4 draft, e5 cancelled, e6 deleted, e7 undiscoverable RSVP,
-- e8 public but entirely in the past.
INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, city, location_text, location_geo, party_types, rsvp_approval_mode, rsvp_discoverable, theme,
  cover_media_url, created_at, updated_at) VALUES
  ('43180000-0000-4000-d000-000000000001', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'event', 'Issue 4318 Weekly Social', 'i4318-weekly', 'scheduled', 'public', 'USD', 'America/New_York', 'Raleigh',
   'Issue 4318 Hall, 1 Main St', point(-78.6382, 35.7796), '{}', 'auto', false,
   '{"business_event":{"hideAddressUntilTicket":false}}', 'https://cdn.test/i4318-weekly.jpg', now(), now()),
  ('43180000-0000-4000-d000-000000000002', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'event', 'Issue 4318 Secret Address Party', 'i4318-withheld', 'live', 'public', 'USD', 'America/New_York', 'Raleigh',
   'Issue 4318 Exact Venue', point(-78.6382, 35.7796), '{}', 'auto', false, '{}', NULL, now(), now()),
  ('43180000-0000-4000-d000-000000000003', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'event', 'Issue 4318 Private Dinner', 'i4318-private', 'scheduled', 'private', 'USD', 'America/New_York', 'Raleigh',
   'Private', point(-78.6382, 35.7796), '{}', 'auto', false, '{}', NULL, now(), now()),
  ('43180000-0000-4000-d000-000000000004', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'event', 'Issue 4318 Draft Night', 'i4318-draft', 'draft', 'draft', 'USD', 'America/New_York', 'Raleigh',
   'Draft', point(-78.6382, 35.7796), '{}', 'auto', false, '{}', NULL, now(), now()),
  ('43180000-0000-4000-d000-000000000005', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'event', 'Issue 4318 Called Off', 'i4318-cancelled', 'cancelled', 'public', 'USD', 'America/New_York', 'Raleigh',
   'Cancelled', point(-78.6382, 35.7796), '{}', 'auto', false, '{}', NULL, now(), now()),
  ('43180000-0000-4000-d000-000000000006', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'event', 'Issue 4318 Deleted Event', 'i4318-deleted', 'scheduled', 'public', 'USD', 'America/New_York', 'Raleigh',
   'Deleted', point(-78.6382, 35.7796), '{}', 'auto', false, '{}', NULL, now(), now()),
  ('43180000-0000-4000-d000-000000000007', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'rsvp', 'Issue 4318 Unlisted RSVP', 'i4318-rsvp', 'scheduled', 'public', 'USD', 'America/New_York', 'Raleigh',
   'RSVP', point(-78.6382, 35.7796), '{}', 'auto', false, '{}', NULL, now(), now()),
  ('43180000-0000-4000-d000-000000000008', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'event', 'Issue 4318 Last Week', 'i4318-past', 'scheduled', 'public', 'USD', 'America/New_York', 'Raleigh',
   'Past', point(-78.6382, 35.7796), '{}', 'auto', false, '{}', NULL, now(), now());
UPDATE public.events SET deleted_at = now() WHERE id = '43180000-0000-4000-d000-000000000006';

INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, cancelled_at) VALUES
  -- e1: two dates this week, one cancelled date this week, one next fortnight, one past.
  ('43180000-0000-4000-e000-000000000011', '43180000-0000-4000-d000-000000000001', now() + interval '1 day', now() + interval '1 day 3 hours', 'America/New_York', true, NULL),
  ('43180000-0000-4000-e000-000000000012', '43180000-0000-4000-d000-000000000001', now() + interval '3 days', now() + interval '3 days 3 hours', 'America/New_York', false, NULL),
  ('43180000-0000-4000-e000-000000000013', '43180000-0000-4000-d000-000000000001', now() + interval '2 days', now() + interval '2 days 3 hours', 'America/New_York', false, now()),
  ('43180000-0000-4000-e000-000000000014', '43180000-0000-4000-d000-000000000001', now() + interval '9 days', now() + interval '9 days 3 hours', 'America/New_York', false, NULL),
  ('43180000-0000-4000-e000-000000000015', '43180000-0000-4000-d000-000000000001', now() - interval '2 days', now() - interval '2 days' + interval '3 hours', 'America/New_York', false, NULL),
  ('43180000-0000-4000-e000-000000000021', '43180000-0000-4000-d000-000000000002', now() + interval '2 days', now() + interval '2 days 4 hours', 'America/New_York', true, NULL),
  ('43180000-0000-4000-e000-000000000031', '43180000-0000-4000-d000-000000000003', now() + interval '2 days', now() + interval '2 days 4 hours', 'America/New_York', true, NULL),
  ('43180000-0000-4000-e000-000000000041', '43180000-0000-4000-d000-000000000004', now() + interval '2 days', now() + interval '2 days 4 hours', 'America/New_York', true, NULL),
  ('43180000-0000-4000-e000-000000000051', '43180000-0000-4000-d000-000000000005', now() + interval '2 days', now() + interval '2 days 4 hours', 'America/New_York', true, NULL),
  ('43180000-0000-4000-e000-000000000061', '43180000-0000-4000-d000-000000000006', now() + interval '2 days', now() + interval '2 days 4 hours', 'America/New_York', true, NULL),
  ('43180000-0000-4000-e000-000000000071', '43180000-0000-4000-d000-000000000007', now() + interval '2 days', now() + interval '2 days 4 hours', 'America/New_York', true, NULL),
  ('43180000-0000-4000-e000-000000000081', '43180000-0000-4000-d000-000000000008', now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 'America/New_York', true, NULL);

-- x1 public experience with a free online tier and a stop; x2 the same but private.
INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, experience_intents, published_at, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at) VALUES
  ('43180000-0000-4000-d000-000000000101', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'experience', 'Issue 4318 Garden Walk', 'i4318-garden-walk', 'scheduled', 'public', 'USD', 'America/New_York',
   ARRAY['group-fun'], now(), 'auto', false, '{}', now(), now()),
  ('43180000-0000-4000-d000-000000000102', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'experience', 'Issue 4318 Private Walk', 'i4318-private-walk', 'scheduled', 'private', 'USD', 'America/New_York',
   ARRAY['group-fun'], now(), 'auto', false, '{}', now(), now());
INSERT INTO public.experience_stops (event_id, stop_order, place_name, address, lat, lng) VALUES
  ('43180000-0000-4000-d000-000000000101', 0, 'Issue 4318 Rose Garden', '1 Garden Way', 35.78, -78.66),
  ('43180000-0000-4000-d000-000000000102', 0, 'Issue 4318 Hidden Garden', '2 Garden Way', 35.78, -78.66);
INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master) VALUES
  ('43180000-0000-4000-e000-000000000101', '43180000-0000-4000-d000-000000000101', now() + interval '4 days', now() + interval '4 days 6 hours', 'America/New_York', true),
  ('43180000-0000-4000-e000-000000000102', '43180000-0000-4000-d000-000000000102', now() + interval '4 days', now() + interval '4 days 6 hours', 'America/New_York', true);

-- t1 public trip on its master date this week; t2 the same trip shape, bookings closed.
INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, destination_text, location_geo, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at) VALUES
  ('43180000-0000-4000-d000-000000000201', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'trip', 'Issue 4318 Beach Weekend', 'i4318-beach', 'scheduled', 'public', 'USD', 'America/New_York',
   'Wrightsville Beach', point(-78.64, 35.78), 'auto', false, '{}', now(), now()),
  ('43180000-0000-4000-d000-000000000202', '43180000-0000-4000-c000-000000000001', '43180000-0000-4000-a000-000000000003',
   'trip', 'Issue 4318 Closed Trip', 'i4318-closed-trip', 'scheduled', 'public', 'USD', 'America/New_York',
   'Nowhere', point(-78.64, 35.78), 'auto', false, '{}', now(), now());
UPDATE public.events SET bookings_closed = true WHERE id = '43180000-0000-4000-d000-000000000202';
INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master) VALUES
  ('43180000-0000-4000-e000-000000000201', '43180000-0000-4000-d000-000000000201', now() + interval '5 days', now() + interval '7 days', 'America/New_York', true),
  ('43180000-0000-4000-e000-000000000202', '43180000-0000-4000-d000-000000000202', now() + interval '5 days', now() + interval '7 days', 'America/New_York', true);

INSERT INTO public.ticket_types (id, event_id, name, price_cents, available_online, is_unlimited) VALUES
  ('43180000-0000-4000-f000-000000000101', '43180000-0000-4000-d000-000000000101', 'Walk', 0, true, true),
  ('43180000-0000-4000-f000-000000000102', '43180000-0000-4000-d000-000000000102', 'Walk', 0, true, true),
  ('43180000-0000-4000-f000-000000000201', '43180000-0000-4000-d000-000000000201', 'Seat', 0, true, true),
  ('43180000-0000-4000-f000-000000000202', '43180000-0000-4000-d000-000000000202', 'Seat', 0, true, true);
INSERT INTO public.trip_pricing_tiers (event_id, ticket_type_id, tier_name) VALUES
  ('43180000-0000-4000-d000-000000000201', '43180000-0000-4000-f000-000000000201', 'Standard'),
  ('43180000-0000-4000-d000-000000000202', '43180000-0000-4000-f000-000000000202', 'Standard');

-- ── Blog posts for blog strips: one public, one draft ─────────────────────
INSERT INTO public.blog_posts (id, slug, category_slug, status, publish_at, first_published_at, created_by) VALUES
  ('43180000-0000-4000-b000-000000000001', 'issue-4318-public-post', 'going-out', 'draft', now() - interval '1 day', now() - interval '1 day', '43180000-0000-4000-a000-000000000002'),
  ('43180000-0000-4000-b000-000000000002', 'issue-4318-draft-post', 'going-out', 'draft', NULL, NULL, '43180000-0000-4000-a000-000000000002');
INSERT INTO public.blog_post_versions (id, post_id, kind, title, document, created_by) VALUES
  ('43180000-0000-4000-b100-000000000001', '43180000-0000-4000-b000-000000000001', 'published', 'Issue 4318 Public Post', '{"version":1,"blocks":[]}', '43180000-0000-4000-a000-000000000002'),
  ('43180000-0000-4000-b100-000000000002', '43180000-0000-4000-b000-000000000002', 'draft', 'Issue 4318 Draft Post', '{"version":1,"blocks":[]}', '43180000-0000-4000-a000-000000000002');
UPDATE public.blog_posts SET status = 'published', published_version_id = '43180000-0000-4000-b100-000000000001'
  WHERE id = '43180000-0000-4000-b000-000000000001';
UPDATE public.blog_posts SET draft_version_id = '43180000-0000-4000-b100-000000000002'
  WHERE id = '43180000-0000-4000-b000-000000000002';

-- ── Strips written directly (as the owner) for the read proofs ────────────
INSERT INTO public.links_strips (id, city_slug, shows_on, title, label, opens, url, blog_post_id, position, is_published) VALUES
  ('43180000-0000-4000-9000-000000000001', NULL, (now() AT TIME ZONE 'utc')::date + 2, 'Every city strip', 'From Mingla', 'explorer', NULL, NULL, 10, true),
  ('43180000-0000-4000-9000-000000000002', 'raleigh-nc', (now() AT TIME ZONE 'utc')::date - 1, 'Raleigh last day', 'New', 'web', 'usemingla.com/raleigh', NULL, 20, true),
  ('43180000-0000-4000-9000-000000000003', 'raleigh-nc', (now() AT TIME ZONE 'utc')::date - 2, 'Expired strip', 'New', 'host', NULL, NULL, 5, true),
  ('43180000-0000-4000-9000-000000000004', 'lagos', (now() AT TIME ZONE 'utc')::date + 1, 'Unpublished strip', 'Featured', 'host', NULL, NULL, 6, false),
  ('43180000-0000-4000-9000-000000000005', NULL, (now() AT TIME ZONE 'utc')::date + 1, 'Public blog strip', 'Featured', 'blog', NULL, '43180000-0000-4000-b000-000000000001', 30, true),
  ('43180000-0000-4000-9000-000000000006', NULL, (now() AT TIME ZONE 'utc')::date + 1, 'Draft blog strip', 'Featured', 'blog', NULL, '43180000-0000-4000-b000-000000000002', 7, true);

-- ═══ W: links_page_week ═══════════════════════════════════════════════════
SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_rows jsonb;
  v_got text[];
  v_want text[] := ARRAY['i4318-weekly', 'i4318-withheld', 'i4318-weekly', 'i4318-garden-walk', 'i4318-beach'];
  v_row record;
BEGIN
  SELECT array_agg(week.item_slug ORDER BY week.starts_at), jsonb_agg(to_jsonb(week) ORDER BY week.starts_at)
    INTO v_got, v_rows
  FROM public.links_page_week() week
  WHERE week.brand_slug = 'issue-4318-collective';
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'W: expected one row per eligible date %, got %', v_want, v_got;
  END IF;

  -- Kinds and the column allow-list.
  IF (SELECT array_agg(elem->>'kind' ORDER BY ord) FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(elem, ord))
     IS DISTINCT FROM ARRAY['event', 'event', 'event', 'experience', 'trip'] THEN
    RAISE EXCEPTION 'W: kinds wrong: %', v_rows;
  END IF;
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v_rows->0) AS key)
     IS DISTINCT FROM ARRAY['brand_slug', 'cover_url', 'ends_at', 'item_slug', 'kind', 'lat', 'lng', 'place_label',
                            'starts_at', 'title', 'tz'] THEN
    RAISE EXCEPTION 'W: column allow-list drifted: %', v_rows->0;
  END IF;

  -- The shown address: place text and exact point.
  SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 'i4318-weekly' ORDER BY week.starts_at LIMIT 1;
  IF v_row.place_label IS DISTINCT FROM 'Issue 4318 Hall, 1 Main St' OR v_row.lat <> 35.7796 OR v_row.lng <> -78.6382
     OR v_row.tz <> 'America/New_York' OR v_row.cover_url <> 'https://cdn.test/i4318-weekly.jpg'
     OR v_row.title <> 'Issue 4318 Weekly Social' THEN
    RAISE EXCEPTION 'W: shown-address event row wrong: %', to_jsonb(v_row);
  END IF;

  -- The withheld address: no place text, a coarse point only, the event's zone.
  SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 'i4318-withheld';
  IF v_row.place_label IS NOT NULL OR v_row.lat <> 35.8 OR v_row.lng <> -78.6 OR v_row.tz <> 'America/New_York' THEN
    RAISE EXCEPTION 'W: withheld address leaked: %', to_jsonb(v_row);
  END IF;

  SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 'i4318-garden-walk';
  IF v_row.place_label <> 'Issue 4318 Rose Garden' OR v_row.lat <> 35.78 OR v_row.lng <> -78.66 THEN
    RAISE EXCEPTION 'W: experience row wrong: %', to_jsonb(v_row);
  END IF;
  SELECT * INTO v_row FROM public.links_page_week() week WHERE week.item_slug = 'i4318-beach';
  IF v_row.place_label <> 'Wrightsville Beach' OR v_row.lat <> 35.78 OR v_row.lng <> -78.64 THEN
    RAISE EXCEPTION 'W: trip row wrong: %', to_jsonb(v_row);
  END IF;

  IF EXISTS (SELECT 1 FROM public.links_page_week() week
             WHERE week.item_slug IN ('i4318-private', 'i4318-draft', 'i4318-cancelled', 'i4318-deleted',
                                      'i4318-rsvp', 'i4318-past', 'i4318-private-walk', 'i4318-closed-trip')) THEN
    RAISE EXCEPTION 'W: an ineligible listing leaked';
  END IF;
END
$test$;
RESET ROLE;

-- Withdrawing a listing removes its rows: the private flip, the draft flip and
-- the cancelled date each act on their own.
UPDATE public.events SET visibility = 'private' WHERE id = '43180000-0000-4000-d000-000000000101';
UPDATE public.events SET status = 'draft' WHERE id = '43180000-0000-4000-d000-000000000201';
UPDATE public.event_dates SET cancelled_at = now() WHERE id = '43180000-0000-4000-e000-000000000012';
SET LOCAL ROLE anon;
DO $test$
BEGIN
  IF (SELECT array_agg(week.item_slug ORDER BY week.starts_at) FROM public.links_page_week() week
      WHERE week.brand_slug = 'issue-4318-collective') IS DISTINCT FROM ARRAY['i4318-weekly', 'i4318-withheld'] THEN
    RAISE EXCEPTION 'W: withdrawn listings still listed';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ S: anon reads published, unexpired strips and never writes ════════════
SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_ids uuid[];
  v_failed boolean;
  v_probe text;
BEGIN
  SELECT array_agg(strip.id ORDER BY strip.position) INTO v_ids FROM public.links_page_strips() strip;
  IF v_ids IS DISTINCT FROM ARRAY['43180000-0000-4000-9000-000000000001', '43180000-0000-4000-9000-000000000002',
                                  '43180000-0000-4000-9000-000000000005']::uuid[] THEN
    RAISE EXCEPTION 'S: anon strips wrong: %', v_ids;
  END IF;
  IF (SELECT strip.blog_slug FROM public.links_page_strips() strip WHERE strip.id = '43180000-0000-4000-9000-000000000005')
     IS DISTINCT FROM 'issue-4318-public-post' THEN
    RAISE EXCEPTION 'S: blog strip lost its slug';
  END IF;

  -- The table itself: RLS shows the same published, unexpired rows.
  SELECT array_agg(strip.id ORDER BY strip.id) INTO v_ids FROM public.links_strips strip;
  IF v_ids IS DISTINCT FROM ARRAY['43180000-0000-4000-9000-000000000001', '43180000-0000-4000-9000-000000000002',
                                  '43180000-0000-4000-9000-000000000005', '43180000-0000-4000-9000-000000000006']::uuid[] THEN
    RAISE EXCEPTION 'S: anon table rows wrong: %', v_ids;
  END IF;

  FOREACH v_probe IN ARRAY ARRAY[
    'SELECT created_by FROM public.links_strips',
    'INSERT INTO public.links_strips (shows_on, title, label, opens, position) VALUES (current_date, ''x'', ''New'', ''host'', 0)',
    'UPDATE public.links_strips SET title = ''hacked''',
    'DELETE FROM public.links_strips',
    'SELECT public.admin_links_strips_list()',
    'SELECT public.admin_links_strip_save(NULL, NULL, current_date, ''x'', ''New'', ''host'', NULL, NULL)',
    'SELECT public.admin_links_strip_delete(''43180000-0000-4000-9000-000000000001'')',
    'SELECT public.admin_links_strips_reorder(ARRAY[]::uuid[])'
  ] LOOP
    v_failed := false;
    BEGIN
      EXECUTE v_probe;
    EXCEPTION WHEN insufficient_privilege THEN
      v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'S: anon ran %', v_probe; END IF;
  END LOOP;
END
$test$;
RESET ROLE;

-- ═══ A: signed in, not Support staff ══════════════════════════════════════
SELECT pg_temp.issue_4318_act('43180000-0000-4000-a000-000000000001');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_probe text;
  v_message text;
BEGIN
  FOREACH v_probe IN ARRAY ARRAY[
    'SELECT public.admin_links_strips_list()',
    'SELECT public.admin_links_strip_save(NULL, NULL, current_date, ''x'', ''New'', ''host'', NULL, NULL)',
    'SELECT public.admin_links_strip_delete(''43180000-0000-4000-9000-000000000001'')',
    'SELECT public.admin_links_strips_reorder(ARRAY[''43180000-0000-4000-9000-000000000001'']::uuid[])'
  ] LOOP
    v_message := NULL;
    BEGIN
      EXECUTE v_probe;
    EXCEPTION WHEN insufficient_privilege THEN
      v_message := SQLERRM;
    END;
    IF v_message IS DISTINCT FROM 'links_forbidden' THEN
      RAISE EXCEPTION 'A: a non-Support user ran % (%)', v_probe, v_message;
    END IF;
  END LOOP;
  BEGIN
    UPDATE public.links_strips SET title = 'hacked';
    RAISE EXCEPTION 'A: authenticated wrote the table directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;

-- ═══ V: Support staff save validates and adds on top ══════════════════════
SELECT pg_temp.issue_4318_act('43180000-0000-4000-a000-000000000002');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_today constant date := (now() AT TIME ZONE 'utc')::date;
  v_case record;
  v_message text;
  v_row public.links_strips;
  v_again public.links_strips;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    ('Bad Slug!', v_today, 'Title', 'New', 'host', NULL, NULL::uuid, 'links_city_invalid'),
    (NULL, v_today - 2, 'Title', 'New', 'host', NULL, NULL::uuid, 'links_shows_on_invalid'),
    (NULL, NULL, 'Title', 'New', 'host', NULL, NULL::uuid, 'links_shows_on_invalid'),
    (NULL, v_today, '   ', 'New', 'host', NULL, NULL::uuid, 'links_title_invalid'),
    (NULL, v_today, repeat('x', 61), 'New', 'host', NULL, NULL::uuid, 'links_title_invalid'),
    (NULL, v_today, 'Title', 'Hot', 'host', NULL, NULL::uuid, 'links_label_invalid'),
    (NULL, v_today, 'Title', 'New', 'store', NULL, NULL::uuid, 'links_opens_invalid'),
    (NULL, v_today, 'Title', 'New', 'web', NULL, NULL::uuid, 'links_url_invalid'),
    (NULL, v_today, 'Title', 'New', 'web', 'not a url', NULL::uuid, 'links_url_invalid'),
    (NULL, v_today, 'Title', 'New', 'web', 'javascript:alert(1)', NULL::uuid, 'links_url_invalid'),
    (NULL, v_today, 'Title', 'New', 'web', 'ftp://files.example.com/a', NULL::uuid, 'links_url_invalid'),
    (NULL, v_today, 'Title', 'New', 'web', 'https://https://usemingla.com', NULL::uuid, 'links_url_invalid'),
    (NULL, v_today, 'Title', 'New', 'blog', NULL, NULL::uuid, 'links_blog_post_invalid'),
    (NULL, v_today, 'Title', 'New', 'blog', NULL, '43180000-0000-4000-b000-000000000002'::uuid, 'links_blog_post_invalid'),
    (NULL, v_today, 'Title', 'New', 'blog', NULL, gen_random_uuid(), 'links_blog_post_invalid')
  ) AS c(city, shows_on, title, label, opens, url, blog, expected) LOOP
    v_message := NULL;
    BEGIN
      PERFORM public.admin_links_strip_save(NULL, v_case.city, v_case.shows_on, v_case.title, v_case.label,
                                            v_case.opens, v_case.url, v_case.blog);
    EXCEPTION WHEN raise_exception THEN
      v_message := SQLERRM;
    END;
    IF v_message IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION 'V: % expected %, got %', to_jsonb(v_case), v_case.expected, v_message;
    END IF;
  END LOOP;

  -- A web strip: scheme stripped, title trimmed, city normalised, on top.
  v_row := public.admin_links_strip_save(NULL, ' Raleigh-NC ', v_today, '  Opening night  ', 'Giveaway', 'web',
                                         ' HTTPS://usemingla.com/blog/opening?ref=links ', NULL);
  IF v_row.url <> 'usemingla.com/blog/opening?ref=links' OR v_row.title <> 'Opening night'
     OR v_row.city_slug <> 'raleigh-nc' OR v_row.created_by <> '43180000-0000-4000-a000-000000000002' THEN
    RAISE EXCEPTION 'V: web strip stored wrong: %', to_jsonb(v_row);
  END IF;
  IF v_row.position >= (SELECT min(strip.position) FROM public.admin_links_strips_list() strip WHERE strip.id <> v_row.id) THEN
    RAISE EXCEPTION 'V: a new strip did not go to the top';
  END IF;
  IF (SELECT strip.id FROM public.admin_links_strips_list() strip LIMIT 1) <> v_row.id THEN
    RAISE EXCEPTION 'V: the admin list does not start with the new strip';
  END IF;

  -- A second new strip goes above the first.
  v_again := public.admin_links_strip_save(NULL, NULL, v_today, 'Get the app', 'From Mingla', 'explorer',
                                           'usemingla.com/ignored', '43180000-0000-4000-b000-000000000001');
  IF v_again.position >= v_row.position OR v_again.url IS NOT NULL OR v_again.blog_post_id IS NOT NULL THEN
    RAISE EXCEPTION 'V: explorer strip wrong: %', to_jsonb(v_again);
  END IF;

  -- A blog strip on a public post; the list carries its title.
  v_again := public.admin_links_strip_save(NULL, NULL, v_today, 'Read this', 'Featured', 'blog', NULL,
                                           '43180000-0000-4000-b000-000000000001');
  IF (SELECT strip.blog_title FROM public.admin_links_strips_list() strip WHERE strip.id = v_again.id)
     IS DISTINCT FROM 'Issue 4318 Public Post' THEN
    RAISE EXCEPTION 'V: admin list lost the blog title';
  END IF;

  -- An update keeps the position and rewrites the fields.
  v_again := public.admin_links_strip_save(v_row.id, NULL, v_today + 1, 'Opening week', 'New', 'host', NULL, NULL);
  IF v_again.position <> v_row.position OR v_again.title <> 'Opening week' OR v_again.url IS NOT NULL
     OR v_again.city_slug IS NOT NULL THEN
    RAISE EXCEPTION 'V: update wrong: %', to_jsonb(v_again);
  END IF;
  v_message := NULL;
  BEGIN
    PERFORM public.admin_links_strip_save(gen_random_uuid(), NULL, v_today, 'Ghost', 'New', 'host', NULL, NULL);
  EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'links_strip_not_found' THEN RAISE EXCEPTION 'V: updating a missing strip: %', v_message; END IF;
END
$test$;

-- ═══ R: reorder takes exactly the current set ═════════════════════════════
DO $test$
DECLARE
  v_current uuid[];
  v_reversed uuid[];
  v_bad uuid[];
  v_state text;
  v_message text;
BEGIN
  SELECT array_agg(strip.id ORDER BY strip.position, strip.created_at, strip.id) INTO v_current
  FROM public.admin_links_strips_list() strip;
  SELECT array_agg(v_current[i] ORDER BY i DESC) INTO v_reversed FROM generate_subscripts(v_current, 1) AS i;

  -- Partial (one missing), padded (a stranger), repeated, NULL-holding, NULL.
  FOR v_bad IN
    SELECT v_current[1:cardinality(v_current) - 1]
    UNION ALL SELECT v_current || gen_random_uuid()
    UNION ALL SELECT v_current[1:cardinality(v_current) - 1] || v_current[1]
    UNION ALL SELECT v_current[1:cardinality(v_current) - 1] || NULL::uuid
    UNION ALL SELECT NULL::uuid[]
  LOOP
    v_state := NULL;
    BEGIN
      PERFORM public.admin_links_strips_reorder(v_bad);
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
      v_message := SQLERRM;
    END;
    IF v_state IS DISTINCT FROM 'PT409' OR v_message <> 'links_strips_stale' THEN
      RAISE EXCEPTION 'R: stale set % accepted or wrong error % %', v_bad, v_state, v_message;
    END IF;
  END LOOP;

  PERFORM public.admin_links_strips_reorder(v_reversed);
  IF (SELECT array_agg(strip.id ORDER BY strip.position) FROM public.admin_links_strips_list() strip)
     IS DISTINCT FROM v_reversed THEN
    RAISE EXCEPTION 'R: reorder not applied';
  END IF;
  IF (SELECT array_agg(strip."position" ORDER BY strip."position") FROM public.admin_links_strips_list() strip)
     IS DISTINCT FROM (SELECT array_agg(i ORDER BY i) FROM generate_series(1, cardinality(v_reversed)) AS i) THEN
    RAISE EXCEPTION 'R: positions are not the 1-based list index';
  END IF;

  -- After a delete the old full list is stale.
  PERFORM public.admin_links_strip_delete(v_reversed[1]);
  v_state := NULL;
  BEGIN
    PERFORM public.admin_links_strips_reorder(v_reversed);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM 'PT409' THEN RAISE EXCEPTION 'R: list with a deleted strip accepted'; END IF;
  v_message := NULL;
  BEGIN
    PERFORM public.admin_links_strip_delete(v_reversed[1]);
  EXCEPTION WHEN raise_exception THEN v_message := SQLERRM;
  END;
  IF v_message IS DISTINCT FROM 'links_strip_not_found' THEN RAISE EXCEPTION 'R: deleting twice: %', v_message; END IF;
END
$test$;
RESET ROLE;

-- The public order follows the admin order.
SET LOCAL ROLE anon;
DO $test$
BEGIN
  IF (SELECT array_agg(strip.id ORDER BY strip.position) FROM public.links_page_strips() strip)
     IS DISTINCT FROM (SELECT array_agg(strip.id) FROM public.links_page_strips() strip) THEN
    RAISE EXCEPTION 'S: public strips are not returned in position order';
  END IF;
END
$test$;
RESET ROLE;

-- ═══ Catalog: grants and the definer shape ════════════════════════════════
DO $test$
BEGIN
  IF NOT has_function_privilege('anon', 'public.links_page_week()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.links_page_strips()', 'EXECUTE') THEN
    RAISE EXCEPTION 'catalog: anon cannot call the public readers';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_page_strips()'::regprocedure) THEN
    RAISE EXCEPTION 'catalog: links_page_strips must be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.admin_links_strips_list()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_links_strip_save(uuid,text,date,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_links_strip_delete(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_links_strips_reorder(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'catalog: anon may call an admin RPC';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.links_strips'::regclass) THEN
    RAISE EXCEPTION 'catalog: links_strips has RLS off';
  END IF;
END
$test$;

ROLLBACK;
