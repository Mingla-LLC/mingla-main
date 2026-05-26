-- META-ORCH-0972 Sub-C SC-C-14
-- fails-on-revert verified at 2aea165d5
--
-- Run after applying the Sub-C migration:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/functions/__tests__/pg_public_brand_upcoming.test.sql

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.pg_public_brand_upcoming(text,timestamp with time zone,integer)'::regprocedure
  )
  INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'pg_public_brand_upcoming is missing';
  END IF;

  IF v_def !~ 'CASE e\.event_type[\s\S]*WHEN ''event'' THEN ed\.start_at[\s\S]*WHEN ''trip'' THEN ed\.start_at[\s\S]*WHEN ''experience'' THEN NULLIF' THEN
    RAISE EXCEPTION 'pg_public_brand_upcoming does not normalize event/trip/experience starts_at';
  END IF;

  IF v_def !~ 'ORDER BY o\.starts_at ASC, o\.published_at DESC' THEN
    RAISE EXCEPTION 'pg_public_brand_upcoming does not sort chronologically with published_at tie-break';
  END IF;

  IF v_def !~ 'o\.starts_at > COALESCE\(p_cursor_at, now\(\)\)' THEN
    RAISE EXCEPTION 'pg_public_brand_upcoming cursor predicate is missing or not exclusive';
  END IF;

  IF v_def !~ 'LIMIT \(LEAST\(GREATEST\(COALESCE\(p_limit, 30\), 1\), 100\) \+ 1\)' THEN
    RAISE EXCEPTION 'pg_public_brand_upcoming does not fetch limit + 1 for has-more detection';
  END IF;

  IF v_def !~ 'e\.event_type AS offering_type' THEN
    RAISE EXCEPTION 'pg_public_brand_upcoming does not expose offering_type for interleaved cards';
  END IF;
END $$;
