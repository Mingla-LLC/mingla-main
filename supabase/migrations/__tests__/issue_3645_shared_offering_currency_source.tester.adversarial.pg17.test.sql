-- Issue #3645 — one supported-currency source for offerings (tester, adversarial).
-- Independent of the implementor suite (T1–T9). It attacks migration
-- 20270819003645 from the angles a happy path does not reach:
--   A1  a signed-in organiser writing events.currency DIRECTLY (real RLS, role
--       authenticated) still succeeds for a listed code and for NULL, although
--       that role cannot read the list; an unlisted or lowercase code is
--       refused by the foreign key, never accepted
--   A2  the trigger that copies the brand's currency onto a non-draft event
--       still copies a listed code, and an unlisted brand currency is refused
--       by the foreign key (not stored, not turned into another error)
--   A3  every code the retired CHECK admitted is still admitted (no narrowing)
--   A4  the foreign key cannot be deferred, a referenced code cannot be
--       renamed, and an inactive-but-listed code is still a legal stored value
--       while the helper refuses it for new work
--   A5  the helper cannot be hijacked by a temp table of the same name or by
--       shadow upper/btrim/length functions earlier on the caller's search_path
--   A6  owner-rights functions with search_path '' / pg_catalog / public,pg_temp
--       get an answer when run by a client role; a caller-rights wrapper does
--       not launder the privilege; nobody but the owner, service_role and
--       superusers holds EXECUTE
--   A7  hostile spellings are false and never NULL: tab/newline/no-break-space
--       padding, an inner space, a space-padded two-letter code, wildcards,
--       full-width and Cyrillic look-alikes, a quote-and-comment payload
--   A8  STABLE: inside one statement the helper answers from that statement's
--       snapshot; the next statement sees the change
-- Every fixture is transaction-local and rolled back.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner      uuid := gen_random_uuid();
  v_brand_ok   uuid := gen_random_uuid();
  v_brand_bad  uuid := gen_random_uuid();
  v_event      uuid := gen_random_uuid();
  v_suffix     text := replace(gen_random_uuid()::text, '-', '');
  v_probe      constant character(3) := 'XTS';  -- ISO 4217 code reserved for testing
  v_unlisted   constant character(3) := 'XXX';  -- ISO 4217 "no currency"
  v_live       character(3);
  v_code       text;
  v_currency   character(3);
  v_constraint text;
  v_raised     boolean;
  v_answer     boolean;
  v_after      boolean;
  v_count      integer;
  v_role       text;
  v_fk         record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.supported_brand_currencies
              WHERE code IN (v_probe, v_unlisted)) THEN
    RAISE EXCEPTION 'SETUP FAIL: a probe code is already listed';
  END IF;
  SELECT c.code INTO v_live
    FROM public.supported_brand_currencies AS c WHERE c.active ORDER BY c.code DESC LIMIT 1;
  IF v_live IS NULL THEN
    RAISE EXCEPTION 'SETUP FAIL: no active currency to test with';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_owner);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  INSERT INTO public.brands (id, account_id, name, slug) VALUES
    (v_brand_ok,  v_owner, 'Issue 3645 Tester Listed',   '3645-t-ok-'  || v_suffix),
    (v_brand_bad, v_owner, 'Issue 3645 Tester Unlisted', '3645-t-bad-' || v_suffix);

  -- ── A1: the organiser's own direct write path, through real RLS ───────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SET LOCAL ROLE authenticated;

  v_raised := false;
  BEGIN
    PERFORM 1 FROM public.supported_brand_currencies LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'A1 SETUP FAIL: authenticated can read the list, so A1 would prove nothing';
  END IF;

  INSERT INTO public.events (id, brand_id, title, slug, created_by, status, currency)
  VALUES (v_event, v_brand_ok, 'Tester draft', '3645-t-e-' || v_suffix, v_owner, 'draft', v_live);
  UPDATE public.events SET currency = NULL WHERE id = v_event;
  UPDATE public.events SET currency = v_live WHERE id = v_event;

  FOREACH v_code IN ARRAY ARRAY[v_unlisted::text, lower(v_live::text)] LOOP
    v_raised := false;
    BEGIN
      UPDATE public.events SET currency = v_code WHERE id = v_event;
    EXCEPTION WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint IS DISTINCT FROM 'events_currency_supported_fkey' THEN
        RESET ROLE;
        RAISE EXCEPTION 'A1 FAIL: % refused by % instead', v_code, v_constraint;
      END IF;
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RESET ROLE;
      RAISE EXCEPTION 'A1 FAIL: a signed-in organiser stored the unlisted code %', v_code;
    END IF;
  END LOOP;

  v_raised := false;
  BEGIN
    INSERT INTO public.events (brand_id, title, slug, created_by, status, currency)
    VALUES (v_brand_ok, 'Tester unlisted', '3645-t-x-' || v_suffix, v_owner, 'draft', v_unlisted);
  EXCEPTION WHEN foreign_key_violation THEN
    v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'A1 FAIL: a signed-in organiser inserted an event with an unlisted code';
  END IF;
  SELECT e.currency INTO v_currency FROM public.events AS e WHERE e.id = v_event;
  IF v_currency IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'A1 FAIL: a refused write changed the row (now %)', v_currency;
  END IF;
  RAISE NOTICE 'A1 PASS: client role writes a listed code and NULL without reading the list; unlisted and lowercase are refused by the foreign key';

  -- ── A2: the brand-currency copy trigger on a non-draft event ──────────────
  UPDATE public.brands SET default_currency = v_live     WHERE id = v_brand_ok;
  UPDATE public.brands SET default_currency = v_unlisted WHERE id = v_brand_bad;

  INSERT INTO public.events (brand_id, title, slug, created_by, status, currency)
  VALUES (v_brand_ok, 'Tester copied', '3645-t-c-' || v_suffix, v_owner, 'scheduled', NULL)
  RETURNING currency INTO v_currency;
  IF v_currency IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'A2 FAIL: the brand currency % was not copied (got %)', v_live, v_currency;
  END IF;

  v_raised := false;
  BEGIN
    INSERT INTO public.events (brand_id, title, slug, created_by, status, currency)
    VALUES (v_brand_bad, 'Tester refused', '3645-t-r-' || v_suffix, v_owner, 'scheduled', NULL);
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS DISTINCT FROM 'events_currency_supported_fkey' THEN
      RAISE EXCEPTION 'A2 FAIL: unlisted brand currency refused by % instead', v_constraint;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'A2 FAIL: an event took an unlisted brand currency';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events AS e WHERE e.brand_id = v_brand_bad) THEN
    RAISE EXCEPTION 'A2 FAIL: the refused event was stored';
  END IF;
  RAISE NOTICE 'A2 PASS: a listed brand currency is copied; an unlisted one is refused by the foreign key and nothing is stored';

  -- ── A3: nothing the retired CHECK admitted was lost ───────────────────────
  -- This is history, not a second list: the 15 codes of the dropped
  -- events_currency_supported_check. Retiring one is `active = false`, which
  -- keeps the row; deleting a row is what this refuses to let pass quietly.
  v_count := 0;
  FOREACH v_code IN ARRAY ARRAY['GBP','USD','CAD','CHF','EUR','BGN','CZK','DKK',
                                'HUF','ISK','NOK','PLN','RON','SEK','NGN'] LOOP
    UPDATE public.events SET currency = v_code WHERE id = v_event;
    v_count := v_count + 1;
  END LOOP;
  UPDATE public.events SET currency = v_live WHERE id = v_event;
  RAISE NOTICE 'A3 PASS: all % codes of the retired CHECK are still accepted', v_count;

  -- ── A4: shape of the foreign key under pressure ───────────────────────────
  SELECT k.condeferrable, k.condeferred, k.confmatchtype, k.conkey, k.confkey
    INTO v_fk
    FROM pg_catalog.pg_constraint AS k
   WHERE k.conrelid = 'public.events'::regclass
     AND k.conname = 'events_currency_supported_fkey';
  IF NOT FOUND OR v_fk.condeferrable OR v_fk.condeferred THEN
    RAISE EXCEPTION 'A4 FAIL: the foreign key is missing or deferrable';
  END IF;
  IF pg_catalog.array_length(v_fk.conkey, 1) <> 1 THEN
    RAISE EXCEPTION 'A4 FAIL: the foreign key is not single-column';
  END IF;

  SET CONSTRAINTS ALL DEFERRED;
  v_raised := false;
  BEGIN
    UPDATE public.events SET currency = v_unlisted WHERE id = v_event;
  EXCEPTION WHEN foreign_key_violation THEN
    v_raised := true;
  END;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'A4 FAIL: deferring constraints let an unlisted code in until commit';
  END IF;

  -- A referenced code cannot be renamed out from under its events.
  v_raised := false;
  BEGIN
    UPDATE public.supported_brand_currencies SET code = v_probe WHERE code = v_live;
  EXCEPTION WHEN foreign_key_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'A4 FAIL: a currency in use was renamed';
  END IF;

  -- Inactive but listed: a legal stored value (so retiring never strands a
  -- row), yet refused by the helper for new work. Both halves, same row.
  INSERT INTO public.supported_brand_currencies
    (code, minor_unit_exponent, active, rail_source, display_order)
  VALUES (v_probe, 2, false, 'issue-3645-tester', 99991);
  UPDATE public.events SET currency = v_probe WHERE id = v_event;
  IF public.is_supported_offering_currency(v_probe::text) IS NOT FALSE THEN
    RAISE EXCEPTION 'A4 FAIL: the helper admits an inactive code';
  END IF;
  UPDATE public.events SET currency = v_live WHERE id = v_event;
  RAISE NOTICE 'A4 PASS: not deferrable; a used code cannot be renamed; inactive is storable but not offered';

  -- ── A5: search_path hijack ────────────────────────────────────────────────
  CREATE TEMP TABLE supported_brand_currencies
    (code character(3) PRIMARY KEY, active boolean NOT NULL) ON COMMIT DROP;
  INSERT INTO pg_temp.supported_brand_currencies VALUES (v_unlisted, true), (v_probe, true);
  CREATE FUNCTION public.upper(text) RETURNS text LANGUAGE sql IMMUTABLE
    AS $shadow$ SELECT 'XXX'::text $shadow$;
  CREATE FUNCTION public.btrim(text) RETURNS text LANGUAGE sql IMMUTABLE
    AS $shadow$ SELECT 'XXX'::text $shadow$;
  CREATE FUNCTION public.length(text) RETURNS integer LANGUAGE sql IMMUTABLE
    AS $shadow$ SELECT 3 $shadow$;
  SET LOCAL search_path = pg_temp, public, pg_catalog;

  -- The shadows are live for the caller, so the attack is real ...
  IF upper('abc') <> 'XXX' OR length('abcdef') <> 3 THEN
    RESET search_path;
    RAISE EXCEPTION 'A5 SETUP FAIL: the shadow functions are not in effect';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM supported_brand_currencies WHERE code = v_unlisted) THEN
    RESET search_path;
    RAISE EXCEPTION 'A5 SETUP FAIL: the temp table does not shadow the real one';
  END IF;
  -- ... and the helper ignores every one of them.
  IF public.is_supported_offering_currency(v_unlisted::text) IS NOT FALSE
     OR public.is_supported_offering_currency(v_probe::text) IS NOT FALSE
     OR public.is_supported_offering_currency('abcdef') IS NOT FALSE
     OR public.is_supported_offering_currency(lower(v_live::text)) IS NOT TRUE THEN
    RESET search_path;
    RAISE EXCEPTION 'A5 FAIL: the helper was steered by the caller''s search_path';
  END IF;
  RESET search_path;
  DROP FUNCTION public.upper(text);
  DROP FUNCTION public.btrim(text);
  DROP FUNCTION public.length(text);
  DROP TABLE pg_temp.supported_brand_currencies;
  RAISE NOTICE 'A5 PASS: a temp table and shadow upper/btrim/length do not change the answer';

  -- ── A6: who can reach the answer, and through what ────────────────────────
  CREATE FUNCTION public.t3645_definer_empty(p text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
    AS $w$ BEGIN RETURN public.is_supported_offering_currency(p); END $w$;
  CREATE FUNCTION public.t3645_definer_catalog(p text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
    AS $w$ BEGIN RETURN public.is_supported_offering_currency(p); END $w$;
  CREATE FUNCTION public.t3645_definer_public(p text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $w$ BEGIN RETURN is_supported_offering_currency(p); END $w$;
  CREATE FUNCTION public.t3645_invoker(p text) RETURNS boolean
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
    AS $w$ BEGIN RETURN public.is_supported_offering_currency(p); END $w$;
  GRANT EXECUTE ON FUNCTION public.t3645_definer_empty(text), public.t3645_definer_catalog(text),
    public.t3645_definer_public(text), public.t3645_invoker(text) TO authenticated, anon;

  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    IF public.t3645_definer_empty(v_live::text) IS NOT TRUE
       OR public.t3645_definer_catalog(v_live::text) IS NOT TRUE
       OR public.t3645_definer_public(v_live::text) IS NOT TRUE
       OR public.t3645_definer_empty(v_unlisted::text) IS NOT FALSE THEN
      RESET ROLE;
      RAISE EXCEPTION 'A6 FAIL: an owner-rights caller got a wrong answer as %', v_role;
    END IF;
    v_raised := false;
    BEGIN
      PERFORM public.t3645_invoker(v_live::text);
    EXCEPTION WHEN insufficient_privilege THEN
      v_raised := true;
    END;
    RESET ROLE;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'A6 FAIL: % reached the helper through a caller-rights wrapper', v_role;
    END IF;
  END LOOP;

  -- Nobody else holds EXECUTE: not PUBLIC, not any other non-superuser role.
  SELECT pg_catalog.string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_code
    FROM pg_catalog.pg_roles AS r
   WHERE NOT r.rolsuper
     AND r.rolname NOT IN ('service_role')
     AND r.oid <> (SELECT p.proowner FROM pg_catalog.pg_proc AS p
                    WHERE p.oid = 'public.is_supported_offering_currency(text)'::regprocedure)
     AND NOT pg_catalog.pg_has_role(r.oid,
           (SELECT p.proowner FROM pg_catalog.pg_proc AS p
             WHERE p.oid = 'public.is_supported_offering_currency(text)'::regprocedure), 'USAGE')
     AND NOT pg_catalog.pg_has_role(r.oid, 'service_role', 'USAGE')
     AND pg_catalog.has_function_privilege(r.oid, 'public.is_supported_offering_currency(text)', 'EXECUTE');
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION 'A6 FAIL: unexpected roles hold EXECUTE on the helper: %', v_code;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS p, pg_catalog.aclexplode(p.proacl) AS a
     WHERE p.oid = 'public.is_supported_offering_currency(text)'::regprocedure
       AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'A6 FAIL: PUBLIC holds a privilege on the helper';
  END IF;
  RAISE NOTICE 'A6 PASS: owner-rights callers answer for client roles under three search_paths; caller-rights wrapper refused; no stray EXECUTE';

  -- ── A7: hostile spellings are false, never NULL, never true ───────────────
  FOREACH v_code IN ARRAY ARRAY[
    E'\t' || v_live::text,                     -- tab is not trimmed
    v_live::text || E'\n',                     -- newline is not trimmed
    v_live::text || U&'\00A0',                 -- no-break space
    U&'\200B' || v_live::text,                 -- zero-width space
    left(v_live::text, 1) || ' ' || right(v_live::text, 2),   -- inner space (4 chars)
    left(v_live::text, 2) || ' ',              -- two letters padded to three
    (left(v_live::text, 2)::character(3))::text,              -- char(3) padding, as text
    left(v_live::text, 1) || '_' || right(v_live::text, 1),   -- LIKE wildcard
    '%%%', '___', '***',
    U&'\FF27\FF22\FF30',                       -- full-width G B P
    U&'G\0412P',                               -- Cyrillic Ve between Latin G and P
    U&'\0415UR',                               -- Cyrillic Ie + UR
    v_live::text || '''--',                    -- quote-and-comment payload
    v_live::text || v_live::text,              -- doubled
    '123', '   ', E'\n\n\n'
  ] LOOP
    v_answer := public.is_supported_offering_currency(v_code);
    IF v_answer IS NOT FALSE THEN
      RAISE EXCEPTION 'A7 FAIL: % answered % (must be false)', quote_literal(v_code), v_answer;
    END IF;
  END LOOP;
  -- Mixed case of a live code is the same code.
  IF public.is_supported_offering_currency(
       lower(left(v_live::text, 1)) || substr(v_live::text, 2, 1) || lower(right(v_live::text, 1))
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'A7 FAIL: mixed case of % is not supported', v_live;
  END IF;
  RAISE NOTICE 'A7 PASS: control-character padding, inner spaces, wildcards, look-alikes and payloads are all false';

  -- ── A8: STABLE means "this statement's snapshot" ──────────────────────────
  UPDATE public.supported_brand_currencies SET active = true WHERE code = v_probe;
  WITH retired AS (
    UPDATE public.supported_brand_currencies SET active = false WHERE code = v_probe
    RETURNING 1
  )
  SELECT public.is_supported_offering_currency(v_probe::text), (SELECT count(*) FROM retired)
    INTO v_answer, v_count;
  v_after := public.is_supported_offering_currency(v_probe::text);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A8 SETUP FAIL: the probe row was not retired';
  END IF;
  IF v_answer IS NOT TRUE THEN
    RAISE EXCEPTION 'A8 FAIL: the helper saw a change made later in its own statement';
  END IF;
  IF v_after IS NOT FALSE THEN
    RAISE EXCEPTION 'A8 FAIL: the next statement still saw the retired code as supported';
  END IF;
  RAISE NOTICE 'A8 PASS: one statement, one answer; the next statement sees the retirement';

  RAISE NOTICE 'issue_3645_shared_offering_currency_source tester adversarial: ALL PASS';
END
$test$;

ROLLBACK;
