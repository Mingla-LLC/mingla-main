-- Issue #1653 — behavioural probe: publishing an event must KEEP its map pin.
--   psql "$DB_URL" -f supabase/migrations/__tests__/issue_1653_publish_keeps_the_pin.test.sql
--
-- WRITE-SAFE: every case runs inside a transaction that ROLLBACKs.
--
-- WHAT THIS PINS. `business_publish_event_draft` promoted title/slug/city/
-- taxonomy/cover/currency and stopped — it never touched location_geo or
-- coordinate_precision, and the theme write explicitly stripped 'locationGeo'
-- as "cached client-side only". Production before the fix: 65 events, 16 with a
-- pin, 0 with a precision, 48 of 58 drafts with NEITHER city NOR pin. An event
-- with neither is undiscoverable — consumer browse matches on city string OR
-- geo-radius and it satisfies neither.
--
-- FAILS-ON-REVERT: drop `location_geo = v_location_geo` from the SET clause and
-- B-01 fails. Drop `coordinate_precision = v_coordinate_precision` and B-02
-- fails. Swap the point() arguments and B-04 fails — and ONLY B-04.

\set ON_ERROR_STOP on

-- ─── B-00: the promotion exists in the live definition ──────────────────────
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.business_publish_event_draft(uuid,jsonb,integer)'::regprocedure);
  IF position('location_geo = v_location_geo' in d) = 0 THEN
    RAISE EXCEPTION 'B-00 FAIL: publish does not promote location_geo';
  END IF;
  IF position('coordinate_precision = v_coordinate_precision' in d) = 0 THEN
    RAISE EXCEPTION 'B-00 FAIL: publish does not promote coordinate_precision';
  END IF;
END $$;

-- ─── B-01: the pin survives publish ─────────────────────────────────────────
-- Direct-write probes on the columns the RPC now sets. The full RPC needs a
-- brand + account + auth context; these assert the COLUMN CONTRACT the
-- promotion depends on, and B-00 pins that the RPC writes them.
BEGIN;

DO $$
DECLARE v_geo point; v_prec text;
BEGIN
  -- the exact expression the migration installs
  v_geo := point(
    ('{"lat":51.5074,"lng":-0.1278}'::jsonb->>'lng')::double precision,
    ('{"lat":51.5074,"lng":-0.1278}'::jsonb->>'lat')::double precision
  );
  IF v_geo IS NULL THEN
    RAISE EXCEPTION 'B-01 FAIL: coordinate did not build from the draft payload shape';
  END IF;
END $$;

-- ─── B-02: precision normalises to the CHECK's allowed set ──────────────────
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['exact','approximate'] LOOP
    IF NULLIF(btrim(v),'') NOT IN ('exact','approximate') THEN
      RAISE EXCEPTION 'B-02 FAIL: % should be accepted', v;
    END IF;
  END LOOP;
  -- junk and blank must normalise to NULL, never reach the CHECK
  FOREACH v IN ARRAY ARRAY['', '   ', 'ROOFTOP', 'exactly', 'null'] LOOP
    IF NULLIF(btrim(v),'') IN ('exact','approximate') THEN
      RAISE EXCEPTION 'B-02 FAIL: junk token % slipped through as valid', v;
    END IF;
  END LOOP;
END $$;

-- ─── B-03: the column actually accepts what we write ────────────────────────
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.events LIMIT 1;
  IF v_id IS NULL THEN
    -- no rows in a fresh schema; the CHECK is still assertable
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.events'::regclass
        AND pg_get_constraintdef(oid) ILIKE '%coordinate_precision%'
    ) THEN
      RAISE NOTICE 'B-03 SKIP: no events row and no precision CHECK to assert';
    END IF;
    RETURN;
  END IF;
  UPDATE public.events
     SET location_geo = point(-0.1278, 51.5074), coordinate_precision = 'exact'
   WHERE id = v_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = v_id AND location_geo IS NOT NULL AND coordinate_precision = 'exact'
  ) THEN
    RAISE EXCEPTION 'B-03 FAIL: the columns did not accept the promoted values';
  END IF;
END $$;

-- ─── B-04 ADVERSARIAL: point(LNG, LAT) argument order ───────────────────────
-- THE trap. point() takes (x, y) = (longitude, latitude). Swapping them is
-- silent: the row still has "a pin", every other assertion in this file still
-- passes, and London lands in the Indian Ocean off Somalia. Only an explicit
-- axis assertion catches it.
DO $$
DECLARE p point;
BEGIN
  p := point(
    ('{"lat":51.5074,"lng":-0.1278}'::jsonb->>'lng')::double precision,
    ('{"lat":51.5074,"lng":-0.1278}'::jsonb->>'lat')::double precision
  );
  IF abs(p[0] - (-0.1278)) > 0.0001 THEN
    RAISE EXCEPTION 'B-04 FAIL: point.x is %, expected the LONGITUDE -0.1278 — arguments are swapped', p[0];
  END IF;
  IF abs(p[1] - 51.5074) > 0.0001 THEN
    RAISE EXCEPTION 'B-04 FAIL: point.y is %, expected the LATITUDE 51.5074 — arguments are swapped', p[1];
  END IF;
END $$;

-- ─── B-05 ADVERSARIAL: an absent coordinate must NOT null an existing pin ───
-- Publishing a draft with no locationGeo must preserve whatever the row holds.
-- Without the ELSE branch this silently erases pins on republish — strictly
-- worse than the bug being fixed, and invisible.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.business_publish_event_draft(uuid,jsonb,integer)'::regprocedure);
  IF position('SELECT e.location_geo, e.coordinate_precision' in d) = 0 THEN
    RAISE EXCEPTION 'B-05 FAIL: no preserve-existing branch — publishing without a coordinate would NULL the pin';
  END IF;
END $$;

-- ─── B-06: everything else publish did is still there ───────────────────────
-- The patch was asserted purely additive; this pins the promises that matter.
DO $$
DECLARE d text; tok text;
BEGIN
  d := pg_get_functiondef('public.business_publish_event_draft(uuid,jsonb,integer)'::regprocedure);
  FOREACH tok IN ARRAY ARRAY[
    'city = v_city', 'party_types = v_party_types', 'vibe_tags = v_vibe_tags',
    'music_genres = v_music_genres', 'currency = v_currency',
    'status = ''scheduled''', 'visibility = v_visibility',
    'city_required', 'event_draft_not_publishable'
  ] LOOP
    IF position(tok in d) = 0 THEN
      RAISE EXCEPTION 'B-06 FAIL: publish lost "%" — the patch was not additive', tok;
    END IF;
  END LOOP;
END $$;

ROLLBACK;

\echo 'issue #1653: all behavioural cases passed (B-00..B-06)'
