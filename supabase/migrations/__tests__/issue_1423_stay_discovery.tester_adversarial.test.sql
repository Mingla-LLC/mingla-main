\set ON_ERROR_STOP on
BEGIN;

DO $adversarial_contract$
DECLARE
  v_signature text := 'public.pg_public_stays_discover(text,date,date,integer,integer,integer,text[],text[],text,integer,integer)';
  v_source text;
BEGIN
  SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_source;
  IF v_source NOT LIKE '%venue_public_view%'
     OR v_source NOT LIKE '%venue.venue_category = ''stay''%'
     OR v_source NOT LIKE '%settings.booking_state = ''active''%'
     OR v_source NOT LIKE '%offering.kind = ''room''%'
     OR v_source NOT LIKE '%offering.status = ''live''%'
     OR v_source NOT LIKE '%media.status = ''ready''%'
     OR v_source NOT LIKE '%price.currency_code::text = venue.default_currency%'
     OR v_source NOT LIKE '%hold.state = ''active'' AND hold.expires_at > now()%'
     OR v_source NOT LIKE '%hold.state = ''reconciliation_required''%'
     OR v_source NOT LIKE '%commitment.state = ''active''%'
     OR v_source NOT LIKE '%night.sellable_quantity%'
     OR v_source LIKE '%''USD''%'
     OR v_source LIKE '%''GBP''%'
  THEN
    RAISE EXCEPTION 'A-1423-01 FAIL: public isolation, inventory, or currency guard drifted';
  END IF;
  RAISE NOTICE 'A-1423-01 PASS: negative-space public/inventory/currency contract is pinned';
END;
$adversarial_contract$;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key = 'STAY_PUBLIC_PAGES';

DO $hostile_filters$
DECLARE
  v_today date := current_date;
BEGIN
  BEGIN
    PERFORM public.pg_public_stays_discover(
      NULL, v_today + 3, v_today + 2, 2, 0, 1, NULL, NULL, NULL, 20, 0
    );
    RAISE EXCEPTION 'A-1423-02 FAIL: reversed date range was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.pg_public_stays_discover(
      NULL, v_today + 2, v_today + 368, 2, 0, 1, NULL, NULL, NULL, 20, 0
    );
    RAISE EXCEPTION 'A-1423-02 FAIL: unbounded date series was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.pg_public_stays_discover(
      repeat('x', 121), NULL, NULL, 2, 0, 1, NULL, NULL, NULL, 20, 0
    );
    RAISE EXCEPTION 'A-1423-02 FAIL: oversized destination was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.pg_public_stays_discover(
      NULL, NULL, NULL, 2, 0, 101, NULL, NULL, NULL, 20, 0
    );
    RAISE EXCEPTION 'A-1423-02 FAIL: unbounded room count was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.pg_public_stays_discover(
      NULL, NULL, NULL, 2, 0, 1, ARRAY['hotel;drop'], NULL, NULL, 20, 0
    );
    RAISE EXCEPTION 'A-1423-02 FAIL: invalid property kind was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  RAISE NOTICE 'A-1423-02 PASS: hostile filters are bounded before query execution';
END;
$hostile_filters$;

DO $literal_wildcards$
DECLARE
  v_source text;
BEGIN
  SELECT pg_get_functiondef(
    'public.pg_public_stays_discover(text,date,date,integer,integer,integer,text[],text[],text,integer,integer)'::regprocedure
  ) INTO v_source;
  IF v_source NOT LIKE '%replace(replace(replace(v_destination, ''!'', ''!!''), ''%'', ''!%''), ''_'', ''!_'')%'
     OR v_source NOT LIKE '%ESCAPE ''!''%' THEN
    RAISE EXCEPTION 'A-1423-03 FAIL: destination wildcard smuggling is no longer escaped';
  END IF;
  RAISE NOTICE 'A-1423-03 PASS: destination input is literal, not an ILIKE program';
END;
$literal_wildcards$;

ROLLBACK;
