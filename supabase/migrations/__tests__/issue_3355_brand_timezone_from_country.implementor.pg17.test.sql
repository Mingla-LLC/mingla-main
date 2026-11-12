-- MINGLA-INVARIANT: I-BRAND-TIMEZONE-FROM-SINGLE-ZONE-COUNTRY | issue #3355 | A brand whose country has exactly one time zone gets that zone as default_timezone when it has none (insert, country change, backfill); a zone the host chose is never overwritten; a multi-zone country is never guessed (migration 20280702023355; edge mirror pinned by supabase/functions/_shared/__tests__/issue_3355_wave_a_handoff_fixable.implementor.test.ts).
--
-- Issue #3355 Wave A (A4, D5a). Reverting the trigger or the function makes a
-- block below raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355tz$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000007a1';
  v_ng uuid := '33550000-0000-4000-8000-0000000007b1';
  v_us uuid := '33550000-0000-4000-8000-0000000007b2';
  v_chosen uuid := '33550000-0000-4000-8000-0000000007b3';
  v_old uuid := '33550000-0000-4000-8000-0000000007b4';
  v_tz text;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'owner-3355tz@example.invalid','{"full_name":"Favour Host"}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES (v_owner,now(),now());

  -- The Time zone handoff opens the field that writes it.
  IF (SELECT route_template FROM public.brand_readiness_catalog WHERE key = 'timezone')
     IS DISTINCT FROM '/brand/{brand_id}/edit?section=timezone' THEN
    RAISE EXCEPTION 'the time zone handoff must open Brand profile''s Time zone section';
  END IF;

  -- The mapping: single-zone countries only.
  IF public.brand_single_zone_timezone('NG') <> 'Africa/Lagos'
     OR public.brand_single_zone_timezone(' gb ') <> 'Europe/London'
     OR public.brand_single_zone_timezone('US') IS NOT NULL
     OR public.brand_single_zone_timezone('ES') IS NOT NULL
     OR public.brand_single_zone_timezone(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'single-zone mapping is wrong';
  END IF;

  -- Insert: NG fills Lagos; US stays unset; a chosen zone stays.
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,country_code)
  VALUES (v_ng,v_owner,'Favy Lagos','favy-3355tz','NGN','NG');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,country_code)
  VALUES (v_us,v_owner,'Rooftop NYC','rooftop-3355tz','USD','US');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,country_code,default_timezone)
  VALUES (v_chosen,v_owner,'Chosen Zone','chosen-3355tz','NGN','NG','Europe/Paris');
  SELECT default_timezone INTO v_tz FROM public.brands WHERE id = v_ng;
  IF v_tz IS DISTINCT FROM 'Africa/Lagos' THEN RAISE EXCEPTION 'NG brand must get Africa/Lagos, got %', v_tz; END IF;
  IF (SELECT default_timezone FROM public.brands WHERE id = v_us) IS NOT NULL THEN
    RAISE EXCEPTION 'a multi-zone country must never be guessed';
  END IF;
  IF (SELECT default_timezone FROM public.brands WHERE id = v_chosen) <> 'Europe/Paris' THEN
    RAISE EXCEPTION 'a chosen zone must never be overwritten';
  END IF;

  -- Country change: the automatic zone follows; a chosen one stays.
  UPDATE public.brands SET country_code = 'GB' WHERE id = v_ng;
  IF (SELECT default_timezone FROM public.brands WHERE id = v_ng) <> 'Europe/London' THEN
    RAISE EXCEPTION 'the automatic zone follows the country';
  END IF;
  UPDATE public.brands SET country_code = 'US' WHERE id = v_ng;
  IF (SELECT default_timezone FROM public.brands WHERE id = v_ng) IS NOT NULL THEN
    RAISE EXCEPTION 'moving to a multi-zone country clears the automatic zone';
  END IF;
  UPDATE public.brands SET country_code = 'GB' WHERE id = v_chosen;
  IF (SELECT default_timezone FROM public.brands WHERE id = v_chosen) <> 'Europe/Paris' THEN
    RAISE EXCEPTION 'a chosen zone survives a country change';
  END IF;

  -- The guard still refuses an unknown zone (the host's picker path).
  v_failed := false;
  BEGIN
    UPDATE public.brands SET default_timezone = 'Mars/Olympus' WHERE id = v_us;
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'brands_default_timezone_guard must still refuse unknown zones'; END IF;
  UPDATE public.brands SET default_timezone = 'America/Chicago' WHERE id = v_us;

  -- Backfill: a pre-existing NG brand with no zone (the trigger did not exist
  -- when it was written) becomes Africa/Lagos; the statement is the
  -- migration's own, and a second run changes nothing.
  ALTER TABLE public.brands DISABLE TRIGGER brands_default_timezone_from_country;
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,country_code)
  VALUES (v_old,v_owner,'Old Lagos Brand','old-lagos-3355tz','NGN','NG');
  ALTER TABLE public.brands ENABLE TRIGGER brands_default_timezone_from_country;
  IF (SELECT default_timezone FROM public.brands WHERE id = v_old) IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the old brand starts with no zone';
  END IF;
  UPDATE public.brands b
  SET default_timezone = public.brand_single_zone_timezone(b.country_code)
  WHERE b.default_timezone IS NULL
    AND public.brand_single_zone_timezone(b.country_code) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_timezone_names z
      WHERE z.name = public.brand_single_zone_timezone(b.country_code)
    );
  IF (SELECT default_timezone FROM public.brands WHERE id = v_old) <> 'Africa/Lagos' THEN
    RAISE EXCEPTION 'backfill must set Africa/Lagos';
  END IF;
  IF (SELECT default_timezone FROM public.brands WHERE id = v_us) <> 'America/Chicago' THEN
    RAISE EXCEPTION 'backfill must not touch a set zone';
  END IF;
END;
$i3355tz$;

ROLLBACK;
