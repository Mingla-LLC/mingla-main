-- MINGLA-INVARIANT: I-4572-EVENT-TYPES-ONE-LIST | issue #4572 | The 26 event type slugs (15 parties + 11 culture & learning, "Event type" in copy) are accepted by every server copy of the list: the events_party_types_canonical CHECK (an empty list stays valid), the four publish / patch gates, Ari's event executor and the Discover facet counter. Each copy equals the canonical TypeScript list in supabase/functions/_shared/eventTaxonomy.ts; an unknown or mixed-case slug is refused with party_types_not_canonical.
--
-- #4572 item 6 (20281129704572_issue_4572_event_types.sql), PostgreSQL 17 proof after the full replay.
--   E-1 the CHECK accepts a new slug and an empty list, and refuses an unknown slug.
--   E-2 business_patch_event_taxonomy and _with_place save 'exhibition' (happy) and refuse
--       'made-up' and 'Exhibition' (adversarial: unknown, mixed case).
--   E-3 business_publish_event_draft and business_publish_rsvp_draft pass the gate with
--       'screening' and refuse 'made-up' / 'Tasting' with party_types_not_canonical.
--   E-4 discover_v2_facets_exact lists every one of the 26 slugs as an Event type option.
--   E-5 ari_execute_event_operation's own copy holds the same 26 slugs (its gate is reached only
--       through a confirmed Ari operation, so the copy itself is pinned here).
--
-- FAILS-ON-REVERT: without the migration (the 15-value lists) E-1, E-2, E-3 and E-4 fail on
-- 'exhibition' / 'screening'; dropping any one function from the migration's patch loop fails that
-- function's assertion.

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
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4572e:' || p_tag)::uuid $fn$;

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END;
$fn$;

-- 'OK' or the raised message.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$fn$;

CREATE TEMP TABLE i4572e_canon(slug text PRIMARY KEY);
INSERT INTO i4572e_canon VALUES
  ('birthday-party'),('club-night'),('house-party'),('rooftop-party'),('themed-party'),('festival'),
  ('warehouse-party'),('beach-party'),('pool-party'),('boat-party'),('graduation-party'),('holiday-party'),
  ('rave'),('exhibition'),('opening'),('talk'),('workshop'),('screening'),('kids-family'),('class'),
  ('market'),('tour'),('performance'),('tasting'),('networking-event'),('corporate-event');

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES (pg_temp.u('owner'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'owner@i4572e.test', 'x', now(), now());
INSERT INTO public.creator_accounts(id) VALUES (pg_temp.u('owner')) ON CONFLICT DO NOTHING;
INSERT INTO public.brands(id, account_id, name, slug, claim_status, pricing_currency, default_currency)
VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'I4572E Gallery', 'i4572e-gallery', 'verified', 'ngn', 'NGN');

INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, visibility, status, timezone,
  published_at, currency, is_online, theme, city, party_types)
VALUES (pg_temp.u('live'), pg_temp.u('brand'), pg_temp.u('owner'), 'I4572E live', 'i4572e-live', 'event',
  'public', 'scheduled', 'Africa/Lagos', now(), 'NGN', false,
  jsonb_build_object('business_event', jsonb_build_object('schemaVersion', 1, 'format', 'in_person',
    'requestedVisibility', 'public', 'clientRevision', 0, 'hideAddressUntilTicket', false)),
  'Abuja', ARRAY['club-night']::text[]);
INSERT INTO public.event_dates(event_id, start_at, end_at, is_master, timezone)
VALUES (pg_temp.u('live'), now() + interval '10 day', now() + interval '10 day 3 hour', true, 'Africa/Lagos');

INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, visibility, status, timezone,
  currency, is_online, theme, city)
SELECT pg_temp.u(k), pg_temp.u('brand'), pg_temp.u('owner'), 'I4572E ' || k, 'i4572e-' || k, t,
  'draft', 'draft', 'Africa/Lagos', 'NGN', false, '{}'::jsonb, 'Abuja'
FROM (VALUES ('draft_event', 'event'), ('draft_rsvp', 'rsvp')) v(k, t);

-- E-1 the CHECK.
SELECT pg_temp.ok(pg_temp.try(format($q$UPDATE public.events SET party_types = ARRAY['exhibition','tasting'] WHERE id = %L$q$, pg_temp.u('draft_event'))) = 'OK',
  'E-1 the CHECK accepts new slugs');
SELECT pg_temp.ok(pg_temp.try(format($q$UPDATE public.events SET party_types = ARRAY[]::text[] WHERE id = %L$q$, pg_temp.u('draft_event'))) = 'OK',
  'E-1 the CHECK accepts an empty list');
SELECT pg_temp.ok(pg_temp.try(format($q$UPDATE public.events SET party_types = ARRAY['made-up'] WHERE id = %L$q$, pg_temp.u('draft_event'))) LIKE '%events_party_types_canonical%',
  'E-1 the CHECK refuses an unknown slug');

DO $e2$
DECLARE v text; v_sig text;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.u('owner'));
  FOREACH v_sig IN ARRAY ARRAY['plain', 'place'] LOOP
    v := pg_temp.try(format(
      CASE v_sig WHEN 'plain'
        THEN $q$SELECT public.business_patch_event_taxonomy(%L, 'Abuja', %L::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, NULL, NULL, NULL)$q$
        ELSE $q$SELECT public.business_patch_event_taxonomy_with_place(%L, 'Abuja', %L::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, NULL, NULL, NULL, NULL)$q$ END,
      pg_temp.u('live'), ARRAY['exhibition']));
    PERFORM pg_temp.ok(v = 'OK' AND (SELECT party_types FROM public.events WHERE id = pg_temp.u('live')) = ARRAY['exhibition'],
      'E-2 ' || v_sig || ' patch saves exhibition', v);
    FOREACH v IN ARRAY ARRAY['made-up', 'Exhibition'] LOOP
      PERFORM pg_temp.ok(pg_temp.try(format(
        CASE v_sig WHEN 'plain'
          THEN $q$SELECT public.business_patch_event_taxonomy(%L, 'Abuja', %L::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, NULL, NULL, NULL)$q$
          ELSE $q$SELECT public.business_patch_event_taxonomy_with_place(%L, 'Abuja', %L::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, NULL, NULL, NULL, NULL)$q$ END,
        pg_temp.u('live'), ARRAY[v])) = 'party_types_not_canonical',
        'E-2 ' || v_sig || ' patch refuses ' || v);
    END LOOP;
  END LOOP;
END $e2$;

DO $e3$
DECLARE v_fn text; v_ev text; v_slug text; v_res text;
BEGIN
  PERFORM pg_temp.act_as(pg_temp.u('owner'));
  FOR v_fn, v_ev IN SELECT * FROM (VALUES ('business_publish_event_draft', 'draft_event'),
                                          ('business_publish_rsvp_draft', 'draft_rsvp')) t LOOP
    FOREACH v_slug IN ARRAY ARRAY['screening', 'made-up', 'Tasting'] LOOP
      v_res := pg_temp.try(format($q$SELECT public.%I(%L, %L::jsonb, 0)$q$, v_fn, pg_temp.u(v_ev),
        jsonb_build_object('title', 'I4572E publish', 'currency', 'NGN',
          'theme', jsonb_build_object('business_draft', jsonb_build_object(
            'city', 'Abuja', 'format', 'in_person', 'currency', 'NGN',
            'partyTypes', jsonb_build_array(v_slug),
            'tickets', jsonb_build_array(jsonb_build_object('name', 'Free entry', 'isFree', true, 'capacity', 10)))))));
      IF v_slug = 'screening' THEN
        PERFORM pg_temp.ok(v_res NOT IN ('party_types_not_canonical', 'party_types_required'),
          'E-3 ' || v_fn || ' passes the gate with screening', v_res);
      ELSE
        PERFORM pg_temp.ok(v_res = 'party_types_not_canonical',
          'E-3 ' || v_fn || ' refuses ' || v_slug, v_res);
      END IF;
    END LOOP;
  END LOOP;
END $e3$;

-- E-4 the Discover facet counter lists all 26 (its array literal is the option list).
DO $e4$
DECLARE v_src text; r record;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)'::regprocedure;
  v_src := substr(v_src, strpos(v_src, '(''partyType'''), 900);
  v_src := substr(v_src, strpos(v_src, 'ARRAY['));
  v_src := substr(v_src, 1, strpos(v_src, ']::text[]'));
  FOR r IN SELECT slug FROM i4572e_canon LOOP
    PERFORM pg_temp.ok(strpos(v_src, '''' || r.slug || '''') > 0, 'E-4 Discover facets list ' || r.slug);
  END LOOP;
  PERFORM pg_temp.ok((length(v_src) - length(replace(v_src, ''',''', ''))) / 3 = 25, 'E-4 Discover facets list exactly 26', v_src);
END $e4$;

-- E-5 Ari's executor copy.
DO $e5$
DECLARE v_src text; r record;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.ari_execute_event_operation(uuid,text,jsonb)'::regprocedure;
  v_src := substr(v_src, strpos(v_src, 'NOT IN(''birthday-party'''), 900);
  v_src := substr(v_src, 1, strpos(v_src, '))'));
  FOR r IN SELECT slug FROM i4572e_canon LOOP
    PERFORM pg_temp.ok(strpos(v_src, '''' || r.slug || '''') > 0, 'E-5 Ari executor accepts ' || r.slug);
  END LOOP;
END $e5$;

ROLLBACK;
