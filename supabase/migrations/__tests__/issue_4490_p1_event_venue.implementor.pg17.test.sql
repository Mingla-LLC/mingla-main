\set ON_ERROR_STOP on
-- #4490 P1-3: executable PostgreSQL 17 proof of the event/experience venue
-- link (20281203024490). BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-EVENT-VENUE-SAME-BRAND | issue #4490 | an event's venue belongs to the event's own brand and its space belongs to that venue; clearing the venue clears the space.
--
-- E-1  columns: nullable links, space_use defaults to shared; existing events keep no venue.
-- E-2  the RPC links an event to its brand's venue and space; unlinking clears the space and resets use.
-- E-3  a venue of another brand is refused (RPC and direct write).
-- E-4  a space of another venue is refused (RPC and direct write); a space needs a venue.
-- E-5  authority: event manager yes; venue staff, outsiders and anon no; stale updated_at is PT409.
-- E-6  deleting the venue (or the space) clears the link without tripping the CHECK.
--
-- FAILS-ON-REVERT: drop the brand check in issue_4490_assert_event_venue -> E-3b;
-- drop the venue-clears-space line -> E-6a.

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


-- Fixture: owner 01, event manager 02, venue staff 03 (venue.manage_offers on A), outsider 04.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44902000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'e' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 5) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44902000-0000-4000-8000-000000000001', now()), ('44902000-0000-4000-8000-000000000005', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('44902000-0000-4000-9000-000000000010', '44902000-0000-4000-8000-000000000001', 'Gameland E 4490', 'gameland-e-4490', 'NGN', now(), now()),
  ('44902000-0000-4000-9000-000000000020', '44902000-0000-4000-8000-000000000005', 'Other E 4490', 'other-e-4490', 'NGN', now(), now());
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
  ('44902000-0000-4000-9000-000000000010', '44902000-0000-4000-8000-000000000002', 'event_manager', now()),
  ('44902000-0000-4000-9000-000000000010', '44902000-0000-4000-8000-000000000003', 'venue_staff', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
  ('44902000-0000-4000-9000-0000000000a1', '44902000-0000-4000-9000-000000000010', 'gamelande4490', 'Gameland E', 6.45, 3.40, 'play', 'verified'),
  ('44902000-0000-4000-9000-0000000000a2', '44902000-0000-4000-9000-000000000010', 'gamelandf4490', 'Gameland F', 6.45, 3.41, 'play', 'verified'),
  ('44902000-0000-4000-9000-0000000000b1', '44902000-0000-4000-9000-000000000020', 'othere4490', 'Other E', 6.46, 3.42, 'play', 'verified');
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities)
SELECT m.id, '44902000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.manage_offers']
FROM public.brand_team_members m WHERE m.user_id = '44902000-0000-4000-8000-000000000003';
INSERT INTO public.venue_spaces (id, venue_id, brand_id, name, capacity_standing) VALUES
  ('44902000-0000-4000-a000-0000000000a1', '44902000-0000-4000-9000-0000000000a1', '44902000-0000-4000-9000-000000000010', 'The Lawn', 400),
  ('44902000-0000-4000-a000-0000000000a2', '44902000-0000-4000-9000-0000000000a2', '44902000-0000-4000-9000-000000000010', 'Rooftop', 80),
  ('44902000-0000-4000-a000-0000000000b1', '44902000-0000-4000-9000-0000000000b1', '44902000-0000-4000-9000-000000000020', 'Hall', 200);
-- TEST-MOD-APPROVED #4490 07-A: a live event needs a party type to leave its venue, so Game Night has one.
INSERT INTO public.events (id, brand_id, title, slug, event_type, visibility, status, timezone, currency, party_types) VALUES
  ('44902000-0000-4000-b000-000000000001', '44902000-0000-4000-9000-000000000010', 'Game Night', 'game-night-4490', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN', ARRAY['club-night']::text[]),
  ('44902000-0000-4000-b000-000000000002', '44902000-0000-4000-9000-000000000010', 'Paint Party', 'paint-party-4490', 'experience', 'public', 'scheduled', 'Africa/Lagos', 'NGN', ARRAY[]::text[]);

-- E-1 columns ---------------------------------------------------------------------------
SELECT public.t4490_ok(
  (SELECT venue_id IS NULL AND space_id IS NULL AND space_use = 'shared' FROM public.events WHERE id = '44902000-0000-4000-b000-000000000001')
  AND (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'venue_id')
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'events_venue_id_idx'),
  'E-1 an event starts with no venue link and shared use; the venue link is indexed');

-- E-2 link and unlink ----------------------------------------------------------------------
SELECT public.t4490_as('44902000-0000-4000-8000-000000000002');
DO $e2$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001', '44902000-0000-4000-9000-0000000000a1',
    '44902000-0000-4000-a000-0000000000a1', 'exclusive', NULL);
  PERFORM public.t4490_ok(v->>'venue_id' = '44902000-0000-4000-9000-0000000000a1' AND v->>'space_id' = '44902000-0000-4000-a000-0000000000a1'
      AND v->>'space_use' = 'exclusive', 'E-2a an event manager links an event to the brand''s venue and space (exclusive stored)');
  v := public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000002', '44902000-0000-4000-9000-0000000000a1', NULL, 'shared', NULL);
  PERFORM public.t4490_ok(v->>'space_id' IS NULL AND v->>'space_use' = 'shared', 'E-2b an experience can sit at a venue with no named space');
  v := public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001', NULL, NULL, 'exclusive', NULL);
  PERFORM public.t4490_ok(v->>'venue_id' IS NULL AND v->>'space_id' IS NULL AND v->>'space_use' = 'shared',
    'E-2c unlinking clears the venue and the space and resets the use');
END
$e2$;

-- E-3 wrong brand -------------------------------------------------------------------------
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001','44902000-0000-4000-9000-0000000000b1',NULL,'shared',NULL)$$,
  '22023', 'event_venue_brand_mismatch', 'E-3a a venue of another brand is refused by the RPC');
SELECT public.t4490_reset();
SELECT public.t4490_expect($$UPDATE public.events SET venue_id = '44902000-0000-4000-9000-0000000000b1' WHERE id = '44902000-0000-4000-b000-000000000001'$$,
  '23514', 'event_venue_brand_mismatch', 'E-3b a direct write of another brand''s venue is refused by the table');

-- E-4 wrong venue for the space -------------------------------------------------------------
SELECT public.t4490_as('44902000-0000-4000-8000-000000000002');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001','44902000-0000-4000-9000-0000000000a1','44902000-0000-4000-a000-0000000000a2','shared',NULL)$$,
  '22023', 'event_space_not_in_venue', 'E-4a a space of another venue (same brand) is refused');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001',NULL,'44902000-0000-4000-a000-0000000000a1','shared',NULL)$$,
  '22023', 'event_space_needs_venue', 'E-4b a space needs a venue');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001','44902000-0000-4000-9000-0000000000a1',NULL,'private',NULL)$$,
  '22023', 'event_space_use_invalid', 'E-4c space use is shared or exclusive');
SELECT public.t4490_reset();
SELECT public.t4490_expect($$UPDATE public.events SET venue_id = '44902000-0000-4000-9000-0000000000a1', space_id = '44902000-0000-4000-a000-0000000000b1' WHERE id = '44902000-0000-4000-b000-000000000001'$$,
  '23514', 'event_space_not_in_venue', 'E-4d a direct write of a foreign space is refused by the table');

-- E-5 authority ---------------------------------------------------------------------------
SELECT public.t4490_as('44902000-0000-4000-8000-000000000003');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001','44902000-0000-4000-9000-0000000000a1',NULL,'shared',NULL)$$,
  '42501', 'not_authorized', 'E-5a venue staff cannot move an event');
SELECT public.t4490_as('44902000-0000-4000-8000-000000000004');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001','44902000-0000-4000-9000-0000000000a1',NULL,'shared',NULL)$$,
  '42501', 'not_authorized', 'E-5b an outsider cannot');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001','44902000-0000-4000-9000-0000000000a1',NULL,'shared',NULL)$$,
  '42501', NULL, 'E-5c anon cannot');
SELECT public.t4490_as('44902000-0000-4000-8000-000000000001');
SELECT public.t4490_expect($$SELECT public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001','44902000-0000-4000-9000-0000000000a1',NULL,'shared','2000-01-01T00:00:00Z')$$,
  'PT409', 'stale_write', 'E-5d a stale updated_at is a PT409 conflict');
SELECT public.t4490_ok(
  (public.issue_4490_set_event_venue('44902000-0000-4000-b000-000000000001', '44902000-0000-4000-9000-0000000000a1',
     '44902000-0000-4000-a000-0000000000a1', 'shared',
     (SELECT updated_at FROM public.events WHERE id = '44902000-0000-4000-b000-000000000001'))->>'space_id') = '44902000-0000-4000-a000-0000000000a1',
  'E-5e the owner links with the current updated_at');
SELECT public.t4490_reset();

-- E-6 deletes clear the link ----------------------------------------------------------------
DELETE FROM public.venue_spaces WHERE id = '44902000-0000-4000-a000-0000000000a1';
SELECT public.t4490_ok(
  (SELECT venue_id = '44902000-0000-4000-9000-0000000000a1' AND space_id IS NULL FROM public.events WHERE id = '44902000-0000-4000-b000-000000000001'),
  'E-6a deleting the space clears only the space');
UPDATE public.events SET space_id = NULL WHERE id = '44902000-0000-4000-b000-000000000002';
INSERT INTO public.venue_spaces (id, venue_id, brand_id, name, capacity_standing) VALUES
  ('44902000-0000-4000-a000-0000000000a3', '44902000-0000-4000-9000-0000000000a1', '44902000-0000-4000-9000-000000000010', 'Arcade', 120);
UPDATE public.events SET space_id = '44902000-0000-4000-a000-0000000000a3' WHERE id = '44902000-0000-4000-b000-000000000001';
DELETE FROM public.venue_listings WHERE id = '44902000-0000-4000-9000-0000000000a1';
SELECT public.t4490_ok(
  (SELECT bool_and(venue_id IS NULL AND space_id IS NULL) FROM public.events
   WHERE id IN ('44902000-0000-4000-b000-000000000001', '44902000-0000-4000-b000-000000000002')),
  'E-6b deleting the venue clears venue and space without tripping the CHECK');

ROLLBACK;
