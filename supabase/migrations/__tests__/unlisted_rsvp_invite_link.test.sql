-- Unlisted RSVP events open from their invite link (migration 20270707000000).
--
-- WHAT IS PROVED (U-00 … U-09). EVERY CASE EXECUTES THE REAL READER against the full
-- applied migration chain, in its own transaction, and rolls back:
--
--   U-00  pg_public_rsvp_by_slug keeps its contract: one overload, STABLE SECURITY
--         DEFINER SQL, search_path public, RETURNS json, anon + authenticated EXECUTE
--   U-01  PUBLIC RSVP: `publicEventRow` is EXACTLY the business_public_events_view row
--         (same keys, same values), so the apps' existing row mappers read it unchanged;
--         the key sits last and every older key is still there
--   U-02  UNLISTED RSVP, read as anon: the reader answers, with the host's RSVP settings
--         in both the payload and the row — the case this change exists for
--   U-03  unlisted stays UNLISTED: absent from business_public_events_view,
--         events_public_view and pg_public_brand_upcoming
--   U-04  PRIVATE RSVP: NULL, as anon and as the owner
--   U-05  address withholding (#2489) holds on the unlisted payload AND row: withheld ->
--         no address, no pin, no street anywhere; opted out -> shown
--   U-06  exact key only: blank or missing slugs, or the right event slug under another
--         brand -> NULL
--   U-07  RSVP only, published only: an unlisted TICKETED event, an unlisted draft and a
--         deleted RSVP -> NULL
--   U-08  #1931 containment: an RSVP whose ordinary reads are blocked -> NULL
--   U-09  an unlisted RSVP can actually be RSVPed through the write the edge function calls
--
-- The row's column set is pinned to the view's in U-01 and U-02, so a later view change
-- that is not mirrored in the reader fails CI instead of silently dropping a field from
-- unlisted RSVP pages.
--
-- FAILS-ON-REVERT:
--   no migration (reader public-only, no row key)  -> U-01a fails (no publicEventRow)
--   visibility widened back to public-only           -> U-02a fails
--   visibility widened to private                    -> U-04a fails
--   a withholding CASE dropped from the row          -> U-01b / U-05 fail
--   containment clause dropped                       -> U-08a fails
--
-- Run after the full migration chain on fresh PostgreSQL 17, as the database owner.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.ur_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'unlisted RSVP invite link FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$assert$;

-- A brand owned by a fresh user.
CREATE OR REPLACE FUNCTION pg_temp.ur_brand(p_tag text, OUT o_user uuid, OUT o_brand uuid, OUT o_brand_slug text)
LANGUAGE plpgsql AS $brand$
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_brand_slug := 'ur-' || p_tag || '-' || o_brand;
  INSERT INTO auth.users(id, email) VALUES (o_user, 'ur-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (o_brand, o_user, 'Unlisted RSVP ' || p_tag, o_brand_slug, 'stripe', 'US', 'USD', 'USD');
END
$brand$;

-- A theme with the street address withheld (p_withheld true) or shown (false).
CREATE OR REPLACE FUNCTION pg_temp.ur_theme(p_withheld boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $theme$
  SELECT jsonb_build_object('business_event',
           jsonb_build_object('format', 'in_person',
                              'hideAddressUntilTicket', p_withheld,
                              'location', jsonb_build_object('venueName', 'The Back Room',
                                                             'address', '12 Hidden Lane'),
                              'settings', jsonb_build_object('privateGuestList', true,
                                                             'hideRemainingCount', true)))
$theme$;

-- One RSVP (or ticketed) event with an upcoming master date.
CREATE OR REPLACE FUNCTION pg_temp.ur_event(
  p_brand uuid, p_tag text, p_visibility text,
  p_event_type text DEFAULT 'rsvp', p_status text DEFAULT 'scheduled', p_withheld boolean DEFAULT true,
  OUT o_event uuid, OUT o_slug text
) LANGUAGE plpgsql AS $event$
BEGIN
  o_event := gen_random_uuid();
  o_slug := 'ur-' || p_tag || '-' || o_event;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme, location_text, location_geo,
                            rsvp_capacity, rsvp_approval_mode)
    VALUES (o_event, p_brand, 'Unlisted RSVP ' || p_tag, o_slug, p_event_type, p_status, p_visibility,
            'UTC', 'USD', CASE WHEN p_status = 'draft' THEN NULL ELSE now() END,
            pg_temp.ur_theme(p_withheld), 'The Back Room · 12 Hidden Lane', point(3.38, 6.52),
            CASE WHEN p_event_type = 'rsvp' THEN 40 ELSE NULL END,
            CASE WHEN p_event_type = 'rsvp' THEN 'manual' ELSE 'auto' END);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
END
$event$;

CREATE OR REPLACE FUNCTION pg_temp.ur_read(p_brand_slug text, p_event_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $read$
  SELECT public.pg_public_rsvp_by_slug(p_brand_slug, p_event_slug)::jsonb
$read$;

-- Sorted keys of a json object, and the view's sorted column names.
CREATE OR REPLACE FUNCTION pg_temp.ur_keys(p jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $keys$
  SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k
$keys$;

CREATE OR REPLACE FUNCTION pg_temp.ur_view_columns()
RETURNS text[] LANGUAGE sql STABLE AS $cols$
  SELECT array_agg(c.column_name::text ORDER BY c.column_name::text)
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'business_public_events_view'
$cols$;

-- ─── U-00: the reader's contract ────────────────────────────────────────────────────
BEGIN;
DO $u00$
DECLARE
  v_fn constant regprocedure := 'public.pg_public_rsvp_by_slug(text,text)'::regprocedure;
  v_row record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS result,
         (SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang) AS lang,
         (SELECT count(*) FROM pg_proc p2 WHERE p2.pronamespace = p.pronamespace AND p2.proname = p.proname) AS overloads
    INTO v_row FROM pg_proc p WHERE p.oid = v_fn;
  PERFORM pg_temp.ur_assert(v_row.overloads = 1, 'U-00a exactly one pg_public_rsvp_by_slug overload');
  PERFORM pg_temp.ur_assert(v_row.prosecdef AND v_row.provolatile = 's' AND v_row.lang = 'sql',
    'U-00b it stays a STABLE SECURITY DEFINER SQL function');
  PERFORM pg_temp.ur_assert(v_row.proconfig = ARRAY['search_path=public']::text[],
    'U-00c its search_path stays public (got ' || COALESCE(v_row.proconfig::text, 'NULL') || ')');
  PERFORM pg_temp.ur_assert(v_row.result = 'json', 'U-00d it still RETURNS json');
  PERFORM pg_temp.ur_assert(
    has_function_privilege('anon', v_fn, 'EXECUTE')
      AND has_function_privilege('authenticated', v_fn, 'EXECUTE'),
    'U-00e anon and authenticated still execute it');
END
$u00$;
ROLLBACK;

-- ─── U-01: a public RSVP — the row is the view row, older keys untouched ───────────
BEGIN;
DO $u01$
DECLARE b record; ev record; v_view jsonb; v_payload jsonb; v_keys text[];
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u01');
  SELECT * INTO ev FROM pg_temp.ur_event(b.o_brand, 'u01', 'public');

  SELECT to_jsonb(v) INTO v_view FROM public.business_public_events_view v WHERE v.id = ev.o_event;
  v_payload := pg_temp.ur_read(b.o_brand_slug, ev.o_slug);

  PERFORM pg_temp.ur_assert(v_view IS NOT NULL AND v_payload IS NOT NULL,
    'U-01 fixture: the view and the reader both serve the public RSVP');
  PERFORM pg_temp.ur_assert(v_payload ? 'publicEventRow' AND jsonb_typeof(v_payload -> 'publicEventRow') = 'object',
    'U-01a the payload carries a publicEventRow object');
  PERFORM pg_temp.ur_assert(v_payload -> 'publicEventRow' = v_view,
    'U-01b publicEventRow equals the business_public_events_view row, key for key and value for value');
  PERFORM pg_temp.ur_assert(pg_temp.ur_keys(v_payload -> 'publicEventRow') = pg_temp.ur_view_columns(),
    'U-01c its keys are exactly the view''s columns');

  -- Every key the page read before this change is still present, and the new key is last.
  SELECT array_agg(key ORDER BY ord) INTO v_keys
    FROM json_each(public.pg_public_rsvp_by_slug(b.o_brand_slug, ev.o_slug)) WITH ORDINALITY AS t(key, value, ord);
  PERFORM pg_temp.ur_assert(v_keys[array_length(v_keys, 1)] = 'publicEventRow',
    'U-01d publicEventRow is appended after every existing key');
  PERFORM pg_temp.ur_assert(v_keys[1:array_length(v_keys, 1) - 1] = ARRAY[
      'id','brandId','brandSlug','eventSlug','name','description','masterStartAt','masterEndAt',
      'timezone','status','isOnline','onlineUrl','venueName','address','hideAddressUntilTicket',
      'format','city','locationGeo','cityGeo','coverMediaUrl','coverMediaType','coverMediaAlt',
      'coverGallery','coverMediaProvider','coverMediaCredit','currency','partyTypes','vibeTags',
      'musicGenres','themeColorOverride','themeFontOverride','themeAnimationOverride','brand',
      'rsvpGoingCount','rsvpCapacity','rsvpAllowPlusOnes','rsvpPlusOnesMax','rsvpWaitlistEnabled',
      'rsvpApprovalMode']::text[],
    'U-01e every pre-existing key keeps its name and position (got ' || array_to_string(v_keys, ',') || ')');
END
$u01$;
ROLLBACK;

-- ─── U-02: an unlisted RSVP answers from its invite link, for anon ──────────────────
BEGIN;
DO $u02$
DECLARE b record; ev record; v_payload jsonb; v_row jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u02');
  SELECT * INTO ev FROM pg_temp.ur_event(b.o_brand, 'u02', 'hidden');

  SET LOCAL ROLE anon;
  v_payload := public.pg_public_rsvp_by_slug(b.o_brand_slug, ev.o_slug)::jsonb;
  RESET ROLE;
  v_row := v_payload -> 'publicEventRow';

  PERFORM pg_temp.ur_assert(v_payload IS NOT NULL AND v_payload ->> 'id' = ev.o_event::text,
    'U-02a anon opens the unlisted RSVP through pg_public_rsvp_by_slug');
  PERFORM pg_temp.ur_assert(v_payload ->> 'rsvpApprovalMode' = 'manual' AND (v_payload ->> 'rsvpCapacity')::int = 40,
    'U-02b the payload carries the host''s RSVP settings');
  PERFORM pg_temp.ur_assert(v_row ->> 'id' = ev.o_event::text AND v_row ->> 'event_type' = 'rsvp'
      AND v_row ->> 'visibility' = 'hidden' AND v_row ->> 'rsvp_approval_mode' = 'manual',
    'U-02c publicEventRow describes the same unlisted RSVP');
  PERFORM pg_temp.ur_assert(v_row #>> '{public_theme,business_event,settings,privateGuestList}' = 'true'
      AND v_row #>> '{public_theme,business_event,settings,hideRemainingCount}' = 'true',
    'U-02d the host''s guest-list and remaining-count choices travel with the row');
  PERFORM pg_temp.ur_assert(pg_temp.ur_keys(v_row) = pg_temp.ur_view_columns(),
    'U-02e the unlisted row has exactly the view''s columns');
END
$u02$;
ROLLBACK;

-- ─── U-03: unlisted is not listed ───────────────────────────────────────────────────
BEGIN;
DO $u03$
DECLARE b record; ev_hidden record; ev_public record; v_upcoming text[];
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u03');
  SELECT * INTO ev_hidden FROM pg_temp.ur_event(b.o_brand, 'u03-hidden', 'hidden');
  SELECT * INTO ev_public FROM pg_temp.ur_event(b.o_brand, 'u03-public', 'public');

  SET LOCAL ROLE anon;
  PERFORM pg_temp.ur_assert(NOT EXISTS (SELECT 1 FROM public.business_public_events_view WHERE id = ev_hidden.o_event),
    'U-03a business_public_events_view still does not list the unlisted RSVP');
  PERFORM pg_temp.ur_assert(NOT EXISTS (SELECT 1 FROM public.events_public_view WHERE id = ev_hidden.o_event),
    'U-03b events_public_view still does not list it');
  SELECT array_agg(offering_id::text) INTO v_upcoming FROM public.pg_public_brand_upcoming(b.o_brand_slug);
  RESET ROLE;

  PERFORM pg_temp.ur_assert(ev_public.o_event::text = ANY (COALESCE(v_upcoming, ARRAY[]::text[])),
    'U-03c fixture: the brand page lists the public RSVP');
  PERFORM pg_temp.ur_assert(NOT (ev_hidden.o_event::text = ANY (COALESCE(v_upcoming, ARRAY[]::text[]))),
    'U-03d the brand page does not list the unlisted RSVP');
END
$u03$;
ROLLBACK;

-- ─── U-04: private stays closed ─────────────────────────────────────────────────────
BEGIN;
DO $u04$
DECLARE b record; ev record;
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u04');
  SELECT * INTO ev FROM pg_temp.ur_event(b.o_brand, 'u04', 'private');

  PERFORM pg_temp.ur_assert(pg_temp.ur_read(b.o_brand_slug, ev.o_slug) IS NULL,
    'U-04a a private RSVP -> NULL');
  SET LOCAL ROLE anon;
  PERFORM pg_temp.ur_assert(public.pg_public_rsvp_by_slug(b.o_brand_slug, ev.o_slug) IS NULL,
    'U-04b a private RSVP -> NULL for anon');
  RESET ROLE;
END
$u04$;
ROLLBACK;

-- ─── U-05: address withholding holds on the unlisted payload and row ────────────────
BEGIN;
DO $u05$
DECLARE b record; withheld record; shown record; v_payload jsonb; v_row jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u05');
  SELECT * INTO withheld FROM pg_temp.ur_event(b.o_brand, 'u05-withheld', 'hidden', 'rsvp', 'scheduled', true);
  SELECT * INTO shown FROM pg_temp.ur_event(b.o_brand, 'u05-shown', 'hidden', 'rsvp', 'scheduled', false);

  v_payload := pg_temp.ur_read(b.o_brand_slug, withheld.o_slug);
  v_row := v_payload -> 'publicEventRow';
  PERFORM pg_temp.ur_assert(v_payload -> 'address' = 'null'::jsonb AND v_payload -> 'locationGeo' = 'null'::jsonb,
    'U-05a withheld: the payload has no address and no pin');
  PERFORM pg_temp.ur_assert(v_row -> 'location_text' = 'null'::jsonb AND v_row -> 'location_geo' = 'null'::jsonb,
    'U-05b withheld: the row has no location_text and no location_geo');
  PERFORM pg_temp.ur_assert(position('12 Hidden Lane' IN v_payload::text) = 0,
    'U-05c withheld: the street appears nowhere in the payload, row and theme included');
  PERFORM pg_temp.ur_assert(v_payload ->> 'venueName' = 'The Back Room'
      AND v_row #>> '{public_theme,business_event,location,venueName}' = 'The Back Room',
    'U-05d withheld: the venue name still shows');

  v_payload := pg_temp.ur_read(b.o_brand_slug, shown.o_slug);
  v_row := v_payload -> 'publicEventRow';
  PERFORM pg_temp.ur_assert(v_row ->> 'location_text' = 'The Back Room · 12 Hidden Lane'
      AND v_row -> 'location_geo' <> 'null'::jsonb AND v_payload -> 'locationGeo' <> 'null'::jsonb,
    'U-05e opted out: the address and pin are returned (the gate is not a blanket NULL)');
END
$u05$;
ROLLBACK;

-- ─── U-06: exact key only ───────────────────────────────────────────────────────────
BEGIN;
DO $u06$
DECLARE b record; other record; ev record;
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u06');
  SELECT * INTO other FROM pg_temp.ur_brand('u06-other');
  SELECT * INTO ev FROM pg_temp.ur_event(b.o_brand, 'u06', 'hidden');

  PERFORM pg_temp.ur_assert(pg_temp.ur_read(b.o_brand_slug, ev.o_slug) IS NOT NULL,
    'U-06 fixture: the exact key answers');
  PERFORM pg_temp.ur_assert(pg_temp.ur_read(NULL, ev.o_slug) IS NULL
      AND pg_temp.ur_read(b.o_brand_slug, NULL) IS NULL
      AND pg_temp.ur_read('', ev.o_slug) IS NULL
      AND pg_temp.ur_read(b.o_brand_slug, '') IS NULL,
    'U-06a a blank or missing slug -> NULL');
  PERFORM pg_temp.ur_assert(pg_temp.ur_read(other.o_brand_slug, ev.o_slug) IS NULL,
    'U-06b the right event slug under another brand -> NULL');
END
$u06$;
ROLLBACK;

-- ─── U-07: RSVP only, published only ────────────────────────────────────────────────
BEGIN;
DO $u07$
DECLARE b record; ticketed record; draft record; deleted record;
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u07');
  SELECT * INTO ticketed FROM pg_temp.ur_event(b.o_brand, 'u07-ticketed', 'hidden', 'event');
  SELECT * INTO draft FROM pg_temp.ur_event(b.o_brand, 'u07-draft', 'hidden', 'rsvp', 'draft');
  SELECT * INTO deleted FROM pg_temp.ur_event(b.o_brand, 'u07-deleted', 'hidden');
  UPDATE public.events SET deleted_at = now() WHERE id = deleted.o_event;

  PERFORM pg_temp.ur_assert(pg_temp.ur_read(b.o_brand_slug, ticketed.o_slug) IS NULL,
    'U-07a an unlisted TICKETED event is not served here');
  PERFORM pg_temp.ur_assert(public.pg_direct_event_checkout_bundle(ticketed.o_event, NULL, NULL) IS NOT NULL,
    'U-07b fixture: the ticketed bundle serves that event (#1929 owns it)');
  PERFORM pg_temp.ur_assert(pg_temp.ur_read(b.o_brand_slug, draft.o_slug) IS NULL,
    'U-07c an unlisted draft RSVP -> NULL');
  PERFORM pg_temp.ur_assert(pg_temp.ur_read(b.o_brand_slug, deleted.o_slug) IS NULL,
    'U-07d a deleted unlisted RSVP -> NULL');
END
$u07$;
ROLLBACK;

-- ─── U-08: #1931 containment ────────────────────────────────────────────────────────
BEGIN;
DO $u08$
DECLARE b record; ev record;
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u08');
  SELECT * INTO ev FROM pg_temp.ur_event(b.o_brand, 'u08', 'hidden');
  PERFORM pg_temp.ur_assert(pg_temp.ur_read(b.o_brand_slug, ev.o_slug) IS NOT NULL,
    'U-08 fixture: the reader serves the unlisted RSVP before the block');

  INSERT INTO public.event_private_media_transition_jobs(
    transition_id, event_id, direction, target_visibility, state, ordinary_read_blocked_at,
    expected_event_updated_at, source_fingerprint)
  VALUES (gen_random_uuid(), ev.o_event, 'enter_private', 'private', 'finalizing', now(),
          now(), repeat('a', 64));

  PERFORM pg_temp.ur_assert(pg_temp.ur_read(b.o_brand_slug, ev.o_slug) IS NULL,
    'U-08a NULL while the event''s ordinary reads are blocked');
END
$u08$;
ROLLBACK;

-- ─── U-09: an unlisted RSVP can be RSVPed ───────────────────────────────────────────
BEGIN;
DO $u09$
DECLARE b record; ev record; v_result jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.ur_brand('u09');
  SELECT * INTO ev FROM pg_temp.ur_event(b.o_brand, 'u09', 'hidden');

  -- The exact call public-submit-rsvp makes for a link guest (service role, no user).
  v_result := public.submit_event_rsvp_with_delivery(
    ev.o_event, NULL, 'Ada Guest', 'ada.guest@example.test', '+2348031234567',
    'going', 0, '[]'::jsonb, NULL, 'NG');

  PERFORM pg_temp.ur_assert(v_result ->> 'rsvpId' IS NOT NULL,
    'U-09a the RSVP is written for the unlisted event');
  PERFORM pg_temp.ur_assert(v_result ->> 'status' = 'going' AND v_result ->> 'approvalStatus' = 'pending',
    'U-09b manual approval is honoured (going, pending) — got ' || v_result::text);
  PERFORM pg_temp.ur_assert(EXISTS (SELECT 1 FROM public.event_rsvps r
                                     WHERE r.id = (v_result ->> 'rsvpId')::uuid AND r.event_id = ev.o_event),
    'U-09c the row exists on the event');
  PERFORM pg_temp.ur_assert((pg_temp.ur_read(b.o_brand_slug, ev.o_slug) -> 'rsvpGoingCount')::int = 0,
    'U-09d a pending RSVP does not count as going');
END
$u09$;
ROLLBACK;

SELECT 'unlisted_rsvp_invite_link: PASS' AS result;
