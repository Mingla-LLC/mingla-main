\set ON_ERROR_STOP on

-- MINGLA-INVARIANT: I-3827-PRIVATE-GUEST-LIST-WITHHOLDS-COUNT | issue #3827 | When privateGuestList is true, pg_public_social_proof.goingCount, pg_public_rsvp_by_slug.rsvpGoingCount, publicEventRow.rsvp_going_count and business_public_events_view.rsvp_going_count are SQL NULL for anon and authed callers, never 0.
-- MINGLA-INVARIANT: I-3827-EXTRAS-NEVER-SUPPLY | issue #3827 | Guests on the host's own list never enter capacity, remaining, full / sold-out, checkout or submit; pg_public_social_proof.capacityFull is computed from the real count only.
-- MINGLA-INVARIANT: I-3827-EXTRAS-BOUNDED | issue #3827 | events.theme.business_event.settings.extraGuestCount is absent, JSON null, or a whole number 0..5000 (CHECK events_extra_guest_count_valid); the client cap equals the SQL cap.
-- MINGLA-INVARIANT: I-3827-PRIVACY-EDITS-NEVER-NOTIFY | issue #3827 | Changing privateGuestList or extraGuestCount on a live event tells no buyer and queues no guest alert.
-- MINGLA-INVARIANT: I-3827-RSVP-READER-KEYSET-FROZEN | issue #3827 | New RSVP fields enter pg_public_rsvp_by_slug only inside publicEventRow; the top-level key list is unchanged.

-- Issue #3827 going-box — implementor proof for
-- 20271128003827_issue_3827_going_box_privacy_extra_guests.sql.
-- Run after the full migration chain on PostgreSQL 17, as the database owner.
-- Every case executes the real functions and view, and rolls back.
--
-- WHAT IS PROVED
--   T-1  public ticketed, private on: social proof withholds goingCount (NULL, not 0)
--        for anon AND authed; sample []; extraGuestCount 0; capacityFull real
--   T-2  same, private off: real goingCount, extras, capacity unchanged
--   T-3  RSVP private: rsvpGoingCount NULL, publicEventRow.rsvp_going_count NULL;
--        social proof capacityFull real
--   T-4  business_public_events_view: same nulling; the column list is EXACTLY the
--        previous one (no column appended: CI re-applies 20270523002489, and
--        CREATE OR REPLACE VIEW cannot drop columns)
--   T-5  unlisted RSVP through the exact-link reader: same nulling
--   T-6  private off, real 0, extras 40: count 0 (real), extras 40, not full
--   T-7  sold out with huge extras: capacityFull true; capacity and per-tier remaining
--        unchanged (extras never consume supply)
--   T-8  leaf write of extras only: echo 40, the two booleans and every sibling key kept
--   T-9  leaf refusals in guard order, no write
--   T-10 the CHECK refuses a string, a fraction and 5001 on any write path
--   T-11 live ticketed edit of extras / privacy: persisted, and no buyer is told
--   T-12 live RSVP edit of extras: persisted, no guest alert queued
--   T-13 publish carries draft extras into the live theme; 9000 refuses with 23514
--   T-14 old 2/3-argument callers resolve to the ONE overload
--   T-15 grants
--   T-16 malformed theme shapes: every read answers, helpers are total
--   T-17 pg_public_rsvp_by_slug top-level key list unchanged (U-01e + publicEventRow)
--   T-18 publicEventRow equals the view row; own-list guests travel in public_theme
--   T-19 private RSVP at capacity: social proof capacityFull true, every count NULL
--
-- FAILS-ON-REVERT (replay the chain without 20271128003827): T-1, T-3, T-4, T-5 and
-- T-19 fail on the withheld count; T-2/T-6 on the missing extraGuestCount key; T-8 on
-- the 4-argument call; T-10 because the constraint does not exist.

CREATE OR REPLACE FUNCTION pg_temp.gb_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3827 going-box FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$assert$;

CREATE OR REPLACE FUNCTION pg_temp.gb_brand(p_tag text, OUT o_user uuid, OUT o_brand uuid, OUT o_slug text)
LANGUAGE plpgsql AS $brand$
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_slug := 'gb-' || p_tag || '-' || o_brand;
  INSERT INTO auth.users(id, email) VALUES (o_user, 'gb-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (o_brand, o_user, 'Going box ' || p_tag, o_slug, 'stripe', 'US', 'USD', 'USD');
END
$brand$;

CREATE OR REPLACE FUNCTION pg_temp.gb_theme(p_private boolean, p_extra integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $theme$
  SELECT jsonb_build_object('business_event', jsonb_build_object(
    'format', 'in_person',
    'hideAddressUntilTicket', false,
    'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue'),
    'settings', jsonb_strip_nulls(jsonb_build_object(
      'privateGuestList', p_private,
      'hideRemainingCount', false,
      'extraGuestCount', p_extra))))
$theme$;

-- A published (scheduled) event read directly by the public reads.
CREATE OR REPLACE FUNCTION pg_temp.gb_event(
  p_brand uuid, p_tag text, p_type text, p_private boolean, p_extra integer,
  p_capacity integer DEFAULT NULL, p_visibility text DEFAULT 'public',
  OUT o_event uuid, OUT o_slug text, OUT o_tier uuid
) LANGUAGE plpgsql AS $event$
BEGIN
  o_event := gen_random_uuid();
  o_slug := 'gb-' || p_tag || '-' || o_event;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme, location_text,
                            rsvp_capacity, rsvp_approval_mode)
    VALUES (o_event, p_brand, 'Going box ' || p_tag, o_slug, p_type, 'scheduled', p_visibility,
            'UTC', 'USD', now(), pg_temp.gb_theme(p_private, p_extra), 'Lantern Room · 61 Wythe Avenue',
            CASE WHEN p_type = 'rsvp' THEN p_capacity ELSE NULL END, 'auto');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  IF p_type <> 'rsvp' THEN
    o_tier := gen_random_uuid();
    INSERT INTO public.ticket_types(id, event_id, name, price_cents, quantity_total, currency)
      VALUES (o_tier, o_event, 'GA', 0, p_capacity, 'USD');
  END IF;
END
$event$;

CREATE OR REPLACE FUNCTION pg_temp.gb_tickets(p_event uuid, p_tier uuid, p_n integer)
RETURNS void LANGUAGE plpgsql AS $tickets$
DECLARE v_order uuid; i integer;
BEGIN
  FOR i IN 1..p_n LOOP
    v_order := gen_random_uuid();
    INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, total_cents, currency,
                              payment_status, source)
      VALUES (v_order, p_event, 'gb-buyer-' || v_order || '@example.test', 'Buyer', 0, 'USD', 'paid', 'legacy');
    INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
      VALUES (gen_random_uuid(), v_order, p_tier, p_event, 'gb-qr-' || v_order, 'valid', 'auto');
  END LOOP;
END
$tickets$;

CREATE OR REPLACE FUNCTION pg_temp.gb_rsvps(p_event uuid, p_n integer)
RETURNS void LANGUAGE plpgsql AS $rsvps$
DECLARE i integer;
BEGIN
  FOR i IN 1..p_n LOOP
    INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
      VALUES (p_event, 'Guest ' || i, 'gb-guest-' || gen_random_uuid() || '@example.test', '+15550003827',
              'going', 'approved');
  END LOOP;
END
$rsvps$;

CREATE OR REPLACE FUNCTION pg_temp.gb_proof(p_event uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $proof$
  SELECT public.pg_public_social_proof(p_event)::jsonb
$proof$;

-- ─── T-1 / T-2: ticketed social proof, private on / off ────────────────────────────
BEGIN;
DO $t01$
DECLARE b record; ev record; ev2 record; v jsonb; v_anon jsonb; v_auth jsonb; v_viewer uuid := gen_random_uuid();
BEGIN
  SELECT * INTO b FROM pg_temp.gb_brand('t01');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't01', 'event', true, 40, 100);
  PERFORM pg_temp.gb_tickets(ev.o_event, ev.o_tier, 3);
  INSERT INTO auth.users(id, email) VALUES (v_viewer, 'gb-viewer-' || v_viewer || '@example.test');

  SET LOCAL ROLE anon;
  v_anon := pg_temp.gb_proof(ev.o_event);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  v_auth := pg_temp.gb_proof(ev.o_event);
  RESET ROLE;

  FOREACH v IN ARRAY ARRAY[v_anon, v_auth] LOOP
    PERFORM pg_temp.gb_assert(v ? 'goingCount' AND jsonb_typeof(v -> 'goingCount') = 'null',
      'T-1a private ticketed: goingCount is JSON null, not 0 (got ' || COALESCE(v ->> 'goingCount', 'null') || ')');
    PERFORM pg_temp.gb_assert(v -> 'sample' = '[]'::jsonb, 'T-1b private: sample is []');
    PERFORM pg_temp.gb_assert((v ->> 'extraGuestCount')::int = 0, 'T-1c private: extraGuestCount 0');
    PERFORM pg_temp.gb_assert((v ->> 'capacityFull')::boolean = false AND (v ->> 'capacity')::int = 100,
      'T-1d private: capacityFull real (3 of 100 = false), capacity unchanged');
    PERFORM pg_temp.gb_assert((v ->> 'privateGuestList')::boolean, 'T-1e privateGuestList true');
  END LOOP;
  PERFORM pg_temp.gb_assert(v_anon = v_auth, 'T-1f anon and authed get the same shape and values');

  SELECT * INTO ev2 FROM pg_temp.gb_event(b.o_brand, 't02', 'event', false, 40, 100);
  PERFORM pg_temp.gb_tickets(ev2.o_event, ev2.o_tier, 3);
  v := pg_temp.gb_proof(ev2.o_event);
  PERFORM pg_temp.gb_assert((v ->> 'goingCount')::int = 3 AND (v ->> 'extraGuestCount')::int = 40
      AND (v ->> 'capacity')::int = 100 AND (v ->> 'capacityFull')::boolean = false,
    'T-2 private off: goingCount stays REAL (3), extras 40 beside it, capacity 100 (got ' || v::text || ')');
  -- Every pre-existing key keeps its position; the two new keys come last.
  PERFORM pg_temp.gb_assert(
    (SELECT array_agg(key ORDER BY ord) FROM json_each(public.pg_public_social_proof(ev2.o_event))
       WITH ORDINALITY AS t(key, value, ord))
    = ARRAY['eventId','entityType','goingCount','capacity','privateGuestList','hideRemainingCount',
            'sample','extraGuestCount','capacityFull']::text[],
    'T-2b key order: existing keys first, extraGuestCount and capacityFull appended');
END
$t01$;
ROLLBACK;

-- ─── T-3 / T-4 / T-19: RSVP private through the reader and the view ────────────────
BEGIN;
DO $t03$
DECLARE b record; ev record; v jsonb; v_row jsonb; v_view record; full_ev record;
BEGIN
  SELECT * INTO b FROM pg_temp.gb_brand('t03');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't03', 'rsvp', true, 25, 80);
  PERFORM pg_temp.gb_rsvps(ev.o_event, 5);

  SET LOCAL ROLE anon;
  v := public.pg_public_rsvp_by_slug(b.o_slug, ev.o_slug)::jsonb;
  SELECT * INTO v_view FROM public.business_public_events_view WHERE id = ev.o_event;
  RESET ROLE;
  v_row := v -> 'publicEventRow';

  PERFORM pg_temp.gb_assert(v ? 'rsvpGoingCount' AND jsonb_typeof(v -> 'rsvpGoingCount') = 'null',
    'T-3a private RSVP: rsvpGoingCount is JSON null (got ' || COALESCE(v ->> 'rsvpGoingCount', 'null') || ')');
  PERFORM pg_temp.gb_assert(jsonb_typeof(v_row -> 'rsvp_going_count') = 'null',
    'T-3b publicEventRow.rsvp_going_count is null');
  PERFORM pg_temp.gb_assert((pg_temp.gb_proof(ev.o_event) ->> 'capacityFull')::boolean = false,
    'T-3c social proof: capacityFull real (5 of 80 = false) while the count is withheld');
  PERFORM pg_temp.gb_assert(v_view.rsvp_going_count IS NULL,
    'T-4a view (anon): rsvp_going_count NULL');

  -- T-19: at capacity while private.
  SELECT * INTO full_ev FROM pg_temp.gb_event(b.o_brand, 't19', 'rsvp', true, 0, 4);
  PERFORM pg_temp.gb_rsvps(full_ev.o_event, 4);
  v := public.pg_public_rsvp_by_slug(b.o_slug, full_ev.o_slug)::jsonb;
  PERFORM pg_temp.gb_assert(jsonb_typeof(v -> 'rsvpGoingCount') = 'null'
      AND jsonb_typeof(v #> '{publicEventRow,rsvp_going_count}') = 'null',
    'T-19 private RSVP at capacity: every reader count stays null');
  PERFORM pg_temp.gb_assert((pg_temp.gb_proof(full_ev.o_event) ->> 'capacityFull')::boolean = true
      AND jsonb_typeof(pg_temp.gb_proof(full_ev.o_event) -> 'goingCount') = 'null',
    'T-19b social proof agrees: capacityFull true, goingCount null');
END
$t03$;
ROLLBACK;

-- ─── T-4b: the view keeps every pre-existing column; two new ones appended last ────
BEGIN;
DO $t04$
DECLARE v_cols text[]; v_types text[]; n integer;
BEGIN
  SELECT array_agg(a.attname::text ORDER BY a.attnum), array_agg(format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
    INTO v_cols, v_types
    FROM pg_attribute a
   WHERE a.attrelid = 'public.business_public_events_view'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  n := array_length(v_cols, 1);
  PERFORM pg_temp.gb_assert(v_cols = ARRAY[
      'id','brand_id','brand_slug','brand_name','brand_description','brand_profile_photo_url',
      'brand_display_attendee_count','brand_address','brand_cover_media_url','brand_theme_color',
      'brand_theme_font','brand_theme_animation','title','description','slug','event_type',
      'location_text','online_url','is_online','is_recurring','is_multi_date','recurrence_rules',
      'cover_media_url','cover_media_type','visibility','show_on_discover','status','published_at',
      'timezone','created_at','updated_at','public_theme','theme_color_override','theme_font_override',
      'theme_animation_override','currency','cover_media_provider','cover_media_source_url',
      'cover_media_credit','cover_media_credit_url','cover_media_alt','master_start_at','master_end_at',
      'master_timezone','master_event_date_id','city','party_types','vibe_tags','music_genres',
      'location_geo','pass_tax','pass_mingla_fee','pass_service_fee','pricing_region','pricing_currency',
      'pricing_locked','display_price_cents','rsvp_discoverable','rsvp_capacity','rsvp_allow_plus_ones',
      'rsvp_plus_ones_max','rsvp_waitlist_enabled','rsvp_approval_mode','rsvp_going_count','city_geo',
      'rsvp_contribution_enabled','rsvp_contribution_suggested_cents','rsvp_contribution_min_cents',
      'cover_media_gallery']::text[],
    'T-4b the view column list is EXACTLY the previous one, no column appended (got ' || array_to_string(v_cols, ',') || ')');
  PERFORM pg_temp.gb_assert(n = 69, 'T-4c the view still has 69 columns');
  PERFORM pg_temp.gb_assert(v_types[array_position(v_cols, 'rsvp_going_count')] = 'integer',
    'T-4d rsvp_going_count stays integer');
  PERFORM pg_temp.gb_assert(
    (SELECT c.reloptions FROM pg_class c WHERE c.oid = 'public.business_public_events_view'::regclass)
      @> ARRAY['security_invoker=false']::text[],
    'T-4e security_invoker=false restated on the view');
END
$t04$;
ROLLBACK;

-- ─── T-5 / T-17 / T-18: unlisted RSVP, key list, row = view ────────────────────────
BEGIN;
DO $t05$
DECLARE b record; ev record; pub record; v jsonb; v_keys text[]; v_view jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.gb_brand('t05');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't05', 'rsvp', true, 0, 40, 'hidden');
  PERFORM pg_temp.gb_rsvps(ev.o_event, 2);
  SET LOCAL ROLE anon;
  v := public.pg_public_rsvp_by_slug(b.o_slug, ev.o_slug)::jsonb;
  RESET ROLE;
  PERFORM pg_temp.gb_assert(v IS NOT NULL AND jsonb_typeof(v -> 'rsvpGoingCount') = 'null'
      AND jsonb_typeof(v #> '{publicEventRow,rsvp_going_count}') = 'null',
    'T-5 unlisted private RSVP via the exact-link reader: both counts withheld');

  SELECT * INTO pub FROM pg_temp.gb_event(b.o_brand, 't17', 'rsvp', false, 12, 40);
  PERFORM pg_temp.gb_rsvps(pub.o_event, 3);
  SELECT array_agg(key ORDER BY ord) INTO v_keys
    FROM json_each(public.pg_public_rsvp_by_slug(b.o_slug, pub.o_slug)) WITH ORDINALITY AS t(key, value, ord);
  PERFORM pg_temp.gb_assert(v_keys = ARRAY[
      'id','brandId','brandSlug','eventSlug','name','description','masterStartAt','masterEndAt',
      'timezone','status','isOnline','onlineUrl','venueName','address','hideAddressUntilTicket',
      'format','city','locationGeo','cityGeo','coverMediaUrl','coverMediaType','coverMediaAlt',
      'coverGallery','coverMediaProvider','coverMediaCredit','currency','partyTypes','vibeTags',
      'musicGenres','themeColorOverride','themeFontOverride','themeAnimationOverride','brand',
      'rsvpGoingCount','rsvpCapacity','rsvpAllowPlusOnes','rsvpPlusOnesMax','rsvpWaitlistEnabled',
      'rsvpApprovalMode','publicEventRow']::text[],
    'T-17 no new top-level key: U-01e list + publicEventRow last (got ' || array_to_string(v_keys, ',') || ')');

  v := public.pg_public_rsvp_by_slug(b.o_slug, pub.o_slug)::jsonb;
  SELECT to_jsonb(x) INTO v_view FROM public.business_public_events_view x WHERE x.id = pub.o_event;
  PERFORM pg_temp.gb_assert(v -> 'publicEventRow' = v_view
      AND NOT ((v -> 'publicEventRow') ? 'rsvp_capacity_full')
      AND NOT ((v -> 'publicEventRow') ? 'extra_guest_count'),
    'T-18 publicEventRow equals the view row and gains no column');
  PERFORM pg_temp.gb_assert((v ->> 'rsvpGoingCount')::int = 3
      AND (v #>> '{publicEventRow,rsvp_going_count}')::int = 3
      AND (v #>> '{publicEventRow,public_theme,business_event,settings,extraGuestCount}')::int = 12,
    'T-18b public: the count stays REAL (3); own-list guests (12) travel in public_theme');
END
$t05$;
ROLLBACK;

-- ─── T-6 / T-7: extras only, and sold out with huge extras ─────────────────────────
BEGIN;
DO $t06$
DECLARE b record; ev record; sold record; v jsonb; v_left integer;
BEGIN
  SELECT * INTO b FROM pg_temp.gb_brand('t06');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't06', 'event', false, 40, 50);
  v := pg_temp.gb_proof(ev.o_event);
  PERFORM pg_temp.gb_assert((v ->> 'goingCount')::int = 0 AND (v ->> 'extraGuestCount')::int = 40
      AND (v ->> 'capacityFull')::boolean = false,
    'T-6 private off, real 0, extras 40: goingCount 0 (real), extras 40, not full');

  SELECT * INTO sold FROM pg_temp.gb_event(b.o_brand, 't07', 'event', false, 5000, 10);
  PERFORM pg_temp.gb_tickets(sold.o_event, sold.o_tier, 10);
  v := pg_temp.gb_proof(sold.o_event);
  PERFORM pg_temp.gb_assert((v ->> 'capacityFull')::boolean = true AND (v ->> 'capacity')::int = 10
      AND (v ->> 'goingCount')::int = 10,
    'T-7a sold out (10 of 10) with 5000 extras: capacityFull true, capacity 10, goingCount real 10');

  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't07b', 'event', false, 5000, 10);
  PERFORM pg_temp.gb_tickets(ev.o_event, ev.o_tier, 2);
  v := pg_temp.gb_proof(ev.o_event);
  PERFORM pg_temp.gb_assert((v ->> 'capacityFull')::boolean = false,
    'T-7b 2 of 10 with 5000 extras is NOT full: extras never consume supply');
  SELECT r.remaining INTO v_left FROM public.pg_public_ticket_types_remaining(ev.o_event) r LIMIT 1;
  PERFORM pg_temp.gb_assert(v_left = 8,
    'T-7c per-tier remaining is real (8 left), untouched by extras (got ' || COALESCE(v_left::text, 'null') || ')');
END
$t06$;
ROLLBACK;

-- ─── T-8 / T-9 / T-14: the leaf ─────────────────────────────────────────────────────
BEGIN;
DO $t08$
DECLARE b record; ev record; v jsonb; v_before jsonb; v_after jsonb; v_stranger uuid := gen_random_uuid(); v_ok boolean;
BEGIN
  SELECT * INTO b FROM pg_temp.gb_brand('t08');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't08', 'event', true, NULL, 100);
  UPDATE public.events SET theme = jsonb_set(jsonb_set(theme, '{business_event,settings,hideRemainingCount}', 'true'),
                                             '{coverHue}', '25') WHERE id = ev.o_event;
  SELECT theme INTO v_before FROM public.events WHERE id = ev.o_event;

  PERFORM set_config('request.jwt.claim.sub', b.o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v := public.biz_set_event_guest_privacy(ev.o_event, NULL, NULL, 40);
  SELECT theme INTO v_after FROM public.events WHERE id = ev.o_event;
  PERFORM pg_temp.gb_assert(v = '{"privateGuestList": true, "hideRemainingCount": true, "extraGuestCount": 40}'::jsonb,
    'T-8a the echo is the persisted truth (got ' || v::text || ')');
  PERFORM pg_temp.gb_assert(
    (v_after #- '{business_event,settings,extraGuestCount}') = v_before
      AND (v_after #>> '{business_event,settings,extraGuestCount}')::int = 40,
    'T-8b only extraGuestCount changed; every sibling theme key byte-survives');

  -- Keep-on-NULL: a privacy-only call keeps the stored extras.
  v := public.biz_set_event_guest_privacy(ev.o_event, false);
  PERFORM pg_temp.gb_assert((v ->> 'extraGuestCount')::int = 40 AND (v ->> 'privateGuestList')::boolean = false
      AND (v ->> 'hideRemainingCount')::boolean = true,
    'T-14a an old 2-argument call resolves and keeps the stored extras and hideRemainingCount');
  v := public.biz_set_event_guest_privacy(p_event_id => ev.o_event, p_private_guest_list => true,
                                          p_hide_remaining_count => false);
  PERFORM pg_temp.gb_assert((v ->> 'extraGuestCount')::int = 40 AND (v ->> 'privateGuestList')::boolean,
    'T-14b the business app''s named 3-argument call resolves');
  PERFORM pg_temp.gb_assert(
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'biz_set_event_guest_privacy') = 1,
    'T-14c exactly one biz_set_event_guest_privacy overload');

  -- T-9 refusals, in guard order, and no write.
  SELECT theme INTO v_before FROM public.events WHERE id = ev.o_event;
  FOREACH v IN ARRAY ARRAY['-1'::jsonb, '5001'::jsonb] LOOP
    v_ok := false;
    BEGIN
      PERFORM public.biz_set_event_guest_privacy(ev.o_event, NULL, NULL, (v #>> '{}')::int);
    EXCEPTION WHEN raise_exception THEN
      v_ok := SQLERRM = 'invalid_extra_guest_count';
    END;
    PERFORM pg_temp.gb_assert(v_ok, 'T-9a extras ' || v::text || ' raises invalid_extra_guest_count');
  END LOOP;
  PERFORM pg_temp.gb_assert((SELECT theme FROM public.events WHERE id = ev.o_event) = v_before,
    'T-9b a refused call wrote nothing');

  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_ok := false;
  BEGIN
    PERFORM public.biz_set_event_guest_privacy(ev.o_event, NULL, NULL, 9999);
  EXCEPTION WHEN raise_exception THEN v_ok := SQLERRM = 'authentication_required';
  END;
  PERFORM pg_temp.gb_assert(v_ok, 'T-9c no caller: authentication_required BEFORE the range guard');

  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'gb-stranger-' || v_stranger || '@example.test');
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_ok := false;
  BEGIN
    PERFORM public.biz_set_event_guest_privacy(ev.o_event, NULL, NULL, 9999);
  EXCEPTION WHEN raise_exception THEN v_ok := SQLERRM = 'not_authorized';
  END;
  PERFORM pg_temp.gb_assert(v_ok, 'T-9d a non-member: not_authorized BEFORE the range guard');
END
$t08$;
ROLLBACK;

-- ─── T-10: the CHECK on every write path ────────────────────────────────────────────
BEGIN;
DO $t10$
DECLARE b record; ev record; v_bad jsonb; v_state text;
BEGIN
  SELECT * INTO b FROM pg_temp.gb_brand('t10');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't10', 'event', false, 0, 100);
  FOREACH v_bad IN ARRAY ARRAY['"abc"'::jsonb, '40.5'::jsonb, '5001'::jsonb, '-1'::jsonb, 'true'::jsonb, '[3]'::jsonb] LOOP
    v_state := NULL;
    BEGIN
      UPDATE public.events SET theme = jsonb_set(theme, '{business_event,settings,extraGuestCount}', v_bad)
       WHERE id = ev.o_event;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_state = CONSTRAINT_NAME;
    END;
    PERFORM pg_temp.gb_assert(v_state = 'events_extra_guest_count_valid',
      'T-10 extraGuestCount ' || v_bad::text || ' is refused by events_extra_guest_count_valid (23514)');
  END LOOP;
  UPDATE public.events SET theme = jsonb_set(theme, '{business_event,settings,extraGuestCount}', '5000')
   WHERE id = ev.o_event;
  UPDATE public.events SET theme = jsonb_set(theme, '{business_event,settings,extraGuestCount}', 'null')
   WHERE id = ev.o_event;
  UPDATE public.events SET theme = theme #- '{business_event,settings,extraGuestCount}' WHERE id = ev.o_event;
  PERFORM pg_temp.gb_assert(true, 'T-10b 5000, JSON null and an absent key are accepted');
END
$t10$;
ROLLBACK;

-- ─── T-11: live ticketed edit — persisted, no buyer told ────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.gb_published_event(p_tag text, p_draft_settings jsonb DEFAULT NULL)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_tier uuid, v_revision integer)
LANGUAGE plpgsql AS $fixture$
DECLARE v_row public.events%ROWTYPE; v_draft jsonb;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'gb-pub-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'Going box pub ' || p_tag, 'gb-pub-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'Going box draft', 'gb-pub-draft-' || v_event, 'event', 'draft',
    'draft', 'America/New_York');
  v_draft := jsonb_build_object(
      'format', 'in_person',
      'requestedVisibility', 'public',
      'clientRevision', 1,
      'city', 'Brooklyn',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn'),
      'hideAddressUntilTicket', false,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'));
  IF p_draft_settings IS NOT NULL THEN
    v_draft := v_draft || jsonb_build_object('settings', p_draft_settings);
  END IF;
  PERFORM public.issue_1719_publish_event_with_poster(v_event, jsonb_build_object(
    'title', 'Going box night',
    'timezone', 'America/New_York',
    'is_online', false,
    'city', 'Brooklyn',
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
    'theme', jsonb_build_object('business_draft', v_draft)), 1);
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  SELECT tt.id INTO v_tier FROM public.ticket_types AS tt WHERE tt.event_id = v_event AND tt.deleted_at IS NULL LIMIT 1;
  v_revision := COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0);
  RETURN NEXT;
END;
$fixture$;

BEGIN;
DO $t11$
DECLARE f record; v_order uuid := gen_random_uuid(); v_told_before integer; v_told_after integer; v_theme jsonb; v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.gb_published_event('t11');
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
                            payment_method, payment_status, source)
  VALUES (v_order, f.v_event, 'gb-t11@example.test', 'Buyer', '+15550003827', 0, 'free', 'paid', 'online_checkout');
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
  VALUES (gen_random_uuid(), v_order, f.v_tier, f.v_event, 'mingla:v1:ticket:' || gen_random_uuid()::text,
          md5(gen_random_uuid()::text), 'valid', 'auto');

  SELECT count(*) INTO v_told_before FROM public.event_edit_notices
   WHERE event_id = f.v_event AND (state <> 'logged' OR changes <> '[]'::jsonb);
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('extraGuestCount', 12)),
    'Adding the guests on my own list', f.v_revision + 1);
  SELECT theme INTO v_theme FROM public.events WHERE id = f.v_event;
  PERFORM pg_temp.gb_assert((v_theme #>> '{business_event,settings,extraGuestCount}')::int = 12,
    'T-11a a live ticketed edit persists extraGuestCount (got ' || COALESCE(v_theme #>> '{business_event,settings}', 'null') || ')');
  v_result := public.business_update_live_event_atomic(f.v_event,
    jsonb_build_object('core', jsonb_build_object('privateGuestList', true)),
    'Keeping the guest list to myself', f.v_revision + 2);
  SELECT theme INTO v_theme FROM public.events WHERE id = f.v_event;
  PERFORM pg_temp.gb_assert((v_theme #>> '{business_event,settings,privateGuestList}')::boolean
      AND (v_theme #>> '{business_event,settings,extraGuestCount}')::int = 12,
    'T-11b a privacy-only edit keeps the stored extras');
  SELECT count(*) INTO v_told_after FROM public.event_edit_notices
   WHERE event_id = f.v_event AND (state <> 'logged' OR changes <> '[]'::jsonb);
  PERFORM pg_temp.gb_assert(v_told_after = v_told_before AND COALESCE(v_result #>> '{buyer_notice,state}', 'logged') = 'logged',
    'T-11c no buyer is told: no notice with changes, the save answers logged (got ' || COALESCE(v_result ->> 'buyer_notice', 'null') || ')');
END
$t11$;
ROLLBACK;

-- ─── T-12: live RSVP edit ───────────────────────────────────────────────────────────
BEGIN;
DO $t12$
DECLARE b record; ev record; v_result jsonb; v_theme jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.gb_brand('t12');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't12', 'rsvp', false, NULL, 50);
  PERFORM pg_temp.gb_rsvps(ev.o_event, 2);
  PERFORM set_config('request.jwt.claim.sub', b.o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_result := public.biz_update_live_rsvp(ev.o_event,
    jsonb_build_object('title', 'Going box t12', 'location_text', 'Lantern Room · 61 Wythe Avenue',
                       'extraGuestCount', 12),
    'Adding the guests on my own list');
  SELECT theme INTO v_theme FROM public.events WHERE id = ev.o_event;
  PERFORM pg_temp.gb_assert((v_result ->> 'ok')::boolean AND (v_theme #>> '{business_event,settings,extraGuestCount}')::int = 12,
    'T-12a a live RSVP edit persists extraGuestCount (got ' || (v_result - 'event')::text || ')');
  PERFORM pg_temp.gb_assert((v_result ->> 'notified_count')::int = 0
      AND NOT EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = ev.o_event),
    'T-12b no guest alert is queued for an extras edit');
  v_result := public.biz_update_live_rsvp(ev.o_event,
    jsonb_build_object('title', 'Going box t12', 'location_text', 'Lantern Room · 61 Wythe Avenue'),
    'Saving again without the key');
  PERFORM pg_temp.gb_assert(
    ((SELECT theme FROM public.events WHERE id = ev.o_event) #>> '{business_event,settings,extraGuestCount}')::int = 12,
    'T-12c an edit without the key keeps the stored extras');
  BEGIN
    PERFORM public.biz_update_live_rsvp(ev.o_event,
      jsonb_build_object('title', 'Going box t12', 'location_text', 'Lantern Room · 61 Wythe Avenue',
                         'extraGuestCount', 5001), 'Too many guests here');
    RAISE EXCEPTION 'issue #3827 going-box FAIL: T-12d 5001 was accepted';
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.gb_assert(SQLERRM = 'invalid_extra_guest_count', 'T-12d 5001 raises invalid_extra_guest_count (got ' || SQLERRM || ')');
  END;
END
$t12$;
ROLLBACK;

-- ─── T-13: publish carries draft extras; out of range refuses ───────────────────────
BEGIN;
DO $t13$
DECLARE f record; v_theme jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.gb_published_event('t13',
    jsonb_build_object('privateGuestList', false, 'hideRemainingCount', false, 'extraGuestCount', 7));
  SELECT theme INTO v_theme FROM public.events WHERE id = f.v_event;
  PERFORM pg_temp.gb_assert((v_theme #>> '{business_event,settings,extraGuestCount}')::int = 7,
    'T-13a publish copies business_draft.settings.extraGuestCount into the live theme (got '
      || COALESCE(v_theme #>> '{business_event,settings}', 'null') || ')');
END
$t13$;
ROLLBACK;

BEGIN;
DO $t13b$
DECLARE v_state text;
BEGIN
  BEGIN
    PERFORM pg_temp.gb_published_event('t13b',
      jsonb_build_object('privateGuestList', false, 'hideRemainingCount', false, 'extraGuestCount', 9000));
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_state = CONSTRAINT_NAME;
  END;
  PERFORM pg_temp.gb_assert(v_state = 'events_extra_guest_count_valid',
    'T-13b publishing extras 9000 refuses with 23514 events_extra_guest_count_valid');
END
$t13b$;
ROLLBACK;

-- ─── T-15: grants and the #2489 registry ────────────────────────────────────────────
BEGIN;
DO $t15$
DECLARE v_declared text[]; v_found text[];
BEGIN
  PERFORM pg_temp.gb_assert(
    NOT has_function_privilege('anon', 'public.biz_set_event_guest_privacy(uuid,boolean,boolean,integer)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.biz_set_event_guest_privacy(uuid,boolean,boolean,integer)', 'EXECUTE'),
    'T-15a the leaf: no anon EXECUTE, authenticated yes');
  PERFORM pg_temp.gb_assert(
    NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.issue_3827_private_guest_list(jsonb)'::regprocedure)
      AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.issue_3827_extra_guest_count(jsonb)'::regprocedure),
    'T-15b neither helper is SECURITY DEFINER');
  PERFORM pg_temp.gb_assert(
    has_function_privilege('anon', 'public.issue_3827_private_guest_list(jsonb)', 'EXECUTE')
      AND has_function_privilege('anon', 'public.issue_3827_extra_guest_count(jsonb)', 'EXECUTE'),
    'T-15c anon can run the helpers (the definer view evaluates them as the reader)');
  PERFORM pg_temp.gb_assert(
    has_function_privilege('anon', 'public.pg_public_social_proof(uuid)', 'EXECUTE')
      AND has_function_privilege('anon', 'public.pg_public_rsvp_by_slug(text,text)', 'EXECUTE')
      AND has_table_privilege('anon', 'public.business_public_events_view', 'SELECT'),
    'T-15d the three public reads stay anon-readable');
  SELECT array_agg(object_name ORDER BY object_name) INTO v_declared FROM public.issue_2489_gate_registry();
  SELECT array_agg(name ORDER BY name) INTO v_found FROM (
    SELECT p.proname::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname <> 'issue_2489_address_withheld' AND p.proname <> 'issue_2489_gate_registry'
       AND (p.prosrc LIKE '%issue_2489_address_withheld%' OR p.prosrc LIKE '%issue_2489_public_theme%')
    UNION
    SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
       AND (pg_get_viewdef(c.oid) LIKE '%issue_2489_address_withheld%' OR pg_get_viewdef(c.oid) LIKE '%issue_2489_public_theme%')
  ) q;
  PERFORM pg_temp.gb_assert(v_declared = v_found, 'T-15e #2489 gate registry set equality still holds');
END
$t15$;
ROLLBACK;

-- ─── T-16: malformed theme shapes ───────────────────────────────────────────────────
BEGIN;
DO $t16$
DECLARE b record; ev record; v jsonb; t jsonb;
BEGIN
  FOREACH t IN ARRAY ARRAY[NULL::jsonb, '[]'::jsonb, '"x"'::jsonb, '{"business_event": []}'::jsonb,
    '{"business_event": {"settings": {"extraGuestCount": "12", "privateGuestList": "yes"}}}'::jsonb,
    '{"business_event": {"settings": {"extraGuestCount": 12.5}}}'::jsonb,
    '{"business_event": {"settings": {"extraGuestCount": 1e400}}}'::jsonb,
    '{"business_event": {"settings": {"extraGuestCount": -3}}}'::jsonb] LOOP
    PERFORM pg_temp.gb_assert(public.issue_3827_extra_guest_count(t) = 0
        AND public.issue_3827_private_guest_list(t) = false,
      'T-16a helpers are total and answer 0 / false for ' || COALESCE(t::text, 'NULL'));
  END LOOP;
  PERFORM pg_temp.gb_assert(public.issue_3827_extra_guest_count(pg_temp.gb_theme(false, 5000)) = 5000
      AND public.issue_3827_private_guest_list(pg_temp.gb_theme(true, NULL)),
    'T-16b valid values read back exactly');

  SELECT * INTO b FROM pg_temp.gb_brand('t16');
  SELECT * INTO ev FROM pg_temp.gb_event(b.o_brand, 't16', 'rsvp', false, NULL, 40);
  FOREACH t IN ARRAY ARRAY['[]'::jsonb, '{"business_event": {"settings": {"privateGuestList": "yes"}}}'::jsonb] LOOP
    UPDATE public.events SET theme = t WHERE id = ev.o_event;
    SET LOCAL ROLE anon;
    v := pg_temp.gb_proof(ev.o_event);
    PERFORM count(*) FROM public.business_public_events_view WHERE id = ev.o_event;
    v := public.pg_public_rsvp_by_slug(b.o_slug, ev.o_slug)::jsonb;
    RESET ROLE;
    PERFORM pg_temp.gb_assert(v IS NOT NULL AND v ? 'publicEventRow',
      'T-16c all three reads answer on theme ' || t::text);
  END LOOP;
END
$t16$;
ROLLBACK;

SELECT 'issue_3827_going_box_privacy.implementor.happy.pg17: PASS' AS result;
