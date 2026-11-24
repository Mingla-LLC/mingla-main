-- MINGLA-INVARIANT: I-4572-DRAFT-KEEPS-VENUE-AND-ADDRESS | issue #4572 | An unpublished copy built from an event (duplicate or unpublish, both through business_event_draft_payload_from_graph) copies the stored location's venueName and address as two fields; only a source with neither half falls back to {venueName: location_text, address: null}. The joined "Venue · Address" label is never written into venueName.
--
-- #4572 item 5 (20281129504572_issue_4572_draft_payload_keeps_venue.sql), PostgreSQL 17 proof
-- after the full replay.
--   P-1 (SC-5.1) duplicating a live event stored as {venueName:"V", address:"A"} gives a draft
--       with venueName "V" and address "A".
--   P-2 (SC-5.2) unpublishing it back to a draft keeps the same two fields.
--   P-3 (SC-5.3) a source with no stored halves still copies {venueName: location_text, address: null}.
--   P-4 (SC-5.4, adversarial) a venue name that itself contains " · " is copied unchanged (never split).
--   P-5 a draft's own stored halves are kept by the payload read.
--
-- FAILS-ON-REVERT: restoring the old 'location' expression
--   ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL)
-- for live events makes P-1 and P-2 read venueName "V · A" and address null.

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4572 FAIL: % (%)', p_label, COALESCE(p_detail, '<null>');
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4572p:' || p_tag)::uuid $fn$;

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END;
$fn$;

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES (pg_temp.u('owner'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'owner@i4572p.test', 'x', now(), now());
INSERT INTO public.creator_accounts(id) VALUES (pg_temp.u('owner')) ON CONFLICT DO NOTHING;
INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'I4572P Gallery', 'i4572p-gallery', 'verified', 'ngn', 'NGN');

-- Live (scheduled) events, each with its stored location shape.
DO $fx$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('dup',    'Kolanut Gallery',            '12 Example Close, Asokoro',  'Kolanut Gallery · 12 Example Close, Asokoro'),
    ('unpub',  'Kolanut Gallery',            '12 Example Close, Asokoro',  'Kolanut Gallery · 12 Example Close, Asokoro'),
    ('nohalf', NULL,                          NULL,                         'Old Label Hall'),
    ('dot',    'Art · Garden Pavilion',       NULL,                         'Art · Garden Pavilion')
  ) AS t(k, vn, ad, lt)
  LOOP
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, visibility, status,
      timezone, published_at, currency, is_online, location_text, theme, city, party_types)
    VALUES (pg_temp.u(r.k), pg_temp.u('brand'), pg_temp.u('owner'), 'I4572P ' || r.k, 'i4572p-' || r.k,
      'event', 'public', 'scheduled', 'Africa/Lagos', now(), 'NGN', false, r.lt,
      jsonb_build_object('business_event', jsonb_build_object(
        'schemaVersion', 1, 'requestedVisibility', 'public', 'clientRevision', 0, 'format', 'in_person')
        || CASE WHEN r.vn IS NULL AND r.ad IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('location', jsonb_build_object('venueName', r.vn, 'address', r.ad)) END),
      'Abuja', ARRAY['club-night']::text[]);
    INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
    VALUES (pg_temp.u(r.k), now() + interval '10 day', now() + interval '10 day 3 hour', true, 'Africa/Lagos');
  END LOOP;
  -- A draft with its own two halves.
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, visibility, status,
    timezone, currency, is_online, location_text, theme, city)
  VALUES (pg_temp.u('draft'), pg_temp.u('brand'), pg_temp.u('owner'), 'I4572P draft', 'i4572p-draft',
    'event', 'draft', 'draft', 'Africa/Lagos', 'NGN', false, 'Studio · 4 Road',
    jsonb_build_object('business_draft', jsonb_build_object('schemaVersion', 1, 'clientRevision', 0,
      'requestedVisibility', 'public', 'location', jsonb_build_object('venueName', 'Studio', 'address', '4 Road'))),
    'Abuja');
END $fx$;

DO $t$
DECLARE v_res jsonb; v_new uuid; v_loc jsonb;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.u('owner'));

  -- P-1 duplicate.
  v_res := public.business_duplicate_event_as_draft(pg_temp.u('dup'));
  v_new := COALESCE((v_res #>> '{event,id}')::uuid, (v_res ->> 'id')::uuid);
  SELECT theme #> '{business_draft,location}' INTO v_loc FROM public.events WHERE id = v_new;
  PERFORM pg_temp.ok(v_loc ->> 'venueName' = 'Kolanut Gallery', 'P-1 duplicate keeps the venue name', v_loc::text);
  PERFORM pg_temp.ok(v_loc ->> 'address' = '12 Example Close, Asokoro', 'P-1 duplicate keeps the address', v_loc::text);

  -- P-2 unpublish.
  PERFORM public.business_unpublish_event_to_draft(pg_temp.u('unpub'));
  SELECT theme #> '{business_draft,location}' INTO v_loc FROM public.events WHERE id = pg_temp.u('unpub');
  PERFORM pg_temp.ok(v_loc ->> 'venueName' = 'Kolanut Gallery', 'P-2 unpublish keeps the venue name', v_loc::text);
  PERFORM pg_temp.ok(v_loc ->> 'address' = '12 Example Close, Asokoro', 'P-2 unpublish keeps the address', v_loc::text);

  -- P-3 no stored halves: the fallback.
  v_loc := public.business_event_draft_payload_from_graph(pg_temp.u('nohalf')) #> '{theme,business_draft,location}';
  PERFORM pg_temp.ok(v_loc ->> 'venueName' = 'Old Label Hall' AND (v_loc -> 'address') = 'null'::jsonb,
    'P-3 a source with no halves falls back to location_text', v_loc::text);

  -- P-4 adversarial: a dot in the venue name is not split.
  v_loc := public.business_event_draft_payload_from_graph(pg_temp.u('dot')) #> '{theme,business_draft,location}';
  PERFORM pg_temp.ok(v_loc ->> 'venueName' = 'Art · Garden Pavilion' AND v_loc ->> 'address' IS NULL,
    'P-4 a venue name containing " · " is copied unchanged', v_loc::text);

  -- P-5 a draft's own halves.
  v_loc := public.business_event_draft_payload_from_graph(pg_temp.u('draft')) #> '{theme,business_draft,location}';
  PERFORM pg_temp.ok(v_loc ->> 'venueName' = 'Studio' AND v_loc ->> 'address' = '4 Road',
    'P-5 a draft keeps its stored halves', v_loc::text);
END $t$;

ROLLBACK;
