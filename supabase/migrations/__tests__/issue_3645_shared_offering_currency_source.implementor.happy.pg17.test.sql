-- Issue #3645 — one supported-currency source for offerings (behavioural).
-- Proves, against migration 20270819003645:
--   T1  the helper is true for EVERY active row of supported_brand_currencies
--       (looped over the table, never a literal list), in any case and with
--       surrounding spaces
--   T2  the helper is false for an inactive row, an unknown code, NULL, the
--       empty string, blanks, a too-short code and an over-long code
--   T3  adding a new active row makes the helper true for it with no function
--       change; deactivating a row makes it false again
--   T4  events.currency is held by a VALIDATED foreign key to the table with
--       no delete/update action, and the hand-written CHECK is gone
--   T5  an events row with NULL currency is allowed
--   T6  a direct write of an unlisted code to events.currency is refused by
--       that foreign key (insert and update)
--   T7  deactivating a currency never breaks an event that already uses it,
--       and deleting a row an event still uses is refused
--   T8  client roles cannot call the helper; service_role can
--   T9  the helper carries no currency list of its own
-- Every fixture is transaction-local and rolled back.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner     uuid := gen_random_uuid();
  v_brand     uuid := gen_random_uuid();
  v_event     uuid := gen_random_uuid();
  v_suffix    text := replace(gen_random_uuid()::text, '-', '');
  v_row       record;
  v_seen      integer := 0;
  v_probe     constant character(3) := 'XTS';  -- ISO 4217 code reserved for testing
  v_src_before text;
  v_src_after  text;
  v_con       record;
  v_constraint text;
  v_state     text;
  v_raised    boolean;
  v_currency  character(3);
BEGIN
  -- The probe code must not already be a real row, or T2/T3 prove nothing.
  IF EXISTS (SELECT 1 FROM public.supported_brand_currencies WHERE code = v_probe) THEN
    RAISE EXCEPTION 'SETUP FAIL: probe code % is already listed', v_probe;
  END IF;

  -- ── T1: every active row is supported, however it is typed ────────────────
  FOR v_row IN
    SELECT c.code FROM public.supported_brand_currencies AS c WHERE c.active
  LOOP
    v_seen := v_seen + 1;
    IF public.is_supported_offering_currency(v_row.code::text) IS NOT TRUE THEN
      RAISE EXCEPTION 'T1 FAIL: active code % not supported', v_row.code;
    END IF;
    IF public.is_supported_offering_currency(lower(v_row.code::text)) IS NOT TRUE THEN
      RAISE EXCEPTION 'T1 FAIL: lowercase % not supported', v_row.code;
    END IF;
    IF public.is_supported_offering_currency('  ' || lower(v_row.code::text) || '   ') IS NOT TRUE THEN
      RAISE EXCEPTION 'T1 FAIL: padded % not supported', v_row.code;
    END IF;
  END LOOP;
  IF v_seen = 0 THEN
    RAISE EXCEPTION 'T1 FAIL: the table has no active rows, the loop proved nothing';
  END IF;
  RAISE NOTICE 'T1 PASS: % active codes, each true in upper, lower and padded form', v_seen;

  -- ── T2: everything else is false (never NULL, never true) ─────────────────
  INSERT INTO public.supported_brand_currencies
    (code, minor_unit_exponent, active, rail_source, display_order)
  VALUES (v_probe, 2, false, 'issue-3645-test', 99990);

  IF public.is_supported_offering_currency(v_probe::text) IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: inactive row reported as supported';
  END IF;
  IF public.is_supported_offering_currency('QQQ') IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: unknown code reported as supported';
  END IF;
  IF public.is_supported_offering_currency(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: NULL must be false';
  END IF;
  IF public.is_supported_offering_currency('') IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: empty string must be false';
  END IF;
  IF public.is_supported_offering_currency('   ') IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: blanks must be false';
  END IF;
  -- Built from a live row so no code is hardcoded: one char short, one long.
  SELECT c.code INTO v_currency
    FROM public.supported_brand_currencies AS c WHERE c.active ORDER BY c.code LIMIT 1;
  IF public.is_supported_offering_currency(left(v_currency::text, 2)) IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: two-letter prefix of % must be false', v_currency;
  END IF;
  IF public.is_supported_offering_currency(v_currency::text || 'X') IS NOT FALSE THEN
    RAISE EXCEPTION 'T2 FAIL: % plus a fourth letter was truncated into a match', v_currency;
  END IF;
  RAISE NOTICE 'T2 PASS: inactive, unknown, NULL, empty, blank, short and over-long are all false';

  -- ── T3: the table decides; the function does not change ───────────────────
  SELECT p.prosrc INTO v_src_before
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.is_supported_offering_currency(text)'::regprocedure;

  UPDATE public.supported_brand_currencies SET active = true WHERE code = v_probe;
  IF public.is_supported_offering_currency(v_probe::text) IS NOT TRUE THEN
    RAISE EXCEPTION 'T3 FAIL: a newly active row is not supported';
  END IF;

  SELECT p.prosrc INTO v_src_after
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.is_supported_offering_currency(text)'::regprocedure;
  IF v_src_after IS DISTINCT FROM v_src_before THEN
    RAISE EXCEPTION 'T3 FAIL: the function body changed';
  END IF;

  UPDATE public.supported_brand_currencies SET active = false WHERE code = v_probe;
  IF public.is_supported_offering_currency(v_probe::text) IS NOT FALSE THEN
    RAISE EXCEPTION 'T3 FAIL: a deactivated row is still supported';
  END IF;
  RAISE NOTICE 'T3 PASS: activating a row is enough; deactivating removes it';

  -- ── T4: the foreign key is the constraint; the CHECK is gone ──────────────
  SELECT k.contype, k.convalidated, k.confdeltype, k.confupdtype,
         k.confrelid::regclass::text AS target,
         pg_catalog.pg_get_constraintdef(k.oid) AS def
    INTO v_con
    FROM pg_catalog.pg_constraint AS k
   WHERE k.conrelid = 'public.events'::regclass
     AND k.conname = 'events_currency_supported_fkey';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T4 FAIL: events_currency_supported_fkey does not exist';
  END IF;
  IF v_con.contype <> 'f' OR v_con.convalidated IS NOT TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: constraint is not a validated foreign key (%)', v_con.def;
  END IF;
  IF v_con.def <> 'FOREIGN KEY (currency) REFERENCES supported_brand_currencies(code)' THEN
    RAISE EXCEPTION 'T4 FAIL: unexpected foreign key definition: %', v_con.def;
  END IF;
  IF v_con.confdeltype <> 'a' OR v_con.confupdtype <> 'a' THEN
    RAISE EXCEPTION 'T4 FAIL: foreign key must take NO ACTION on delete and update';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS k
     WHERE k.conrelid = 'public.events'::regclass
       AND k.conname = 'events_currency_supported_check'
  ) THEN
    RAISE EXCEPTION 'T4 FAIL: events_currency_supported_check still exists';
  END IF;
  -- No CHECK on events may carry a currency list under any other name either.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS k
     WHERE k.conrelid = 'public.events'::regclass
       AND k.contype = 'c'
       AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'currency'
       AND pg_catalog.pg_get_constraintdef(k.oid) ~ '''[A-Z]{3}''.*''[A-Z]{3}'''
  ) THEN
    RAISE EXCEPTION 'T4 FAIL: a CHECK on events still lists currency codes';
  END IF;
  RAISE NOTICE 'T4 PASS: validated FK to supported_brand_currencies(code), NO ACTION, CHECK gone';

  -- ── T5: NULL currency is allowed ──────────────────────────────────────────
  INSERT INTO auth.users (id) VALUES (v_owner);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'Issue 3645 Currency Source', '3645-cur-' || v_suffix);

  INSERT INTO public.events (id, brand_id, title, slug, created_by, status, currency)
  VALUES (v_event, v_brand, 'No currency yet', '3645-cur-e-' || v_suffix, v_owner, 'draft', NULL);
  SELECT e.currency INTO v_currency FROM public.events AS e WHERE e.id = v_event;
  IF v_currency IS NOT NULL THEN
    RAISE EXCEPTION 'T5 FAIL: NULL currency was replaced by %', v_currency;
  END IF;
  RAISE NOTICE 'T5 PASS: an event with no currency is stored as NULL';

  -- ── T6: an unlisted code is refused by the foreign key ────────────────────
  v_raised := false;
  BEGIN
    UPDATE public.events SET currency = 'QQQ' WHERE id = v_event;
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'events_currency_supported_fkey' THEN
      RAISE EXCEPTION 'T6 FAIL: update refused by % instead', v_constraint;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'T6 FAIL: update to an unlisted code was accepted';
  END IF;

  v_raised := false;
  BEGIN
    INSERT INTO public.events (brand_id, title, slug, created_by, status, currency)
    VALUES (v_brand, 'Unlisted', '3645-cur-x-' || v_suffix, v_owner, 'draft', 'QQQ');
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'events_currency_supported_fkey' THEN
      RAISE EXCEPTION 'T6 FAIL: insert refused by % instead', v_constraint;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'T6 FAIL: insert with an unlisted code was accepted';
  END IF;

  -- Every listed code is accepted on a direct write (looped, not hardcoded).
  FOR v_row IN SELECT c.code FROM public.supported_brand_currencies AS c WHERE c.active LOOP
    UPDATE public.events SET currency = v_row.code WHERE id = v_event;
  END LOOP;
  RAISE NOTICE 'T6 PASS: unlisted code refused on insert and update; every listed code accepted';

  -- ── T7: retiring a currency never breaks an event that uses it ────────────
  UPDATE public.supported_brand_currencies SET active = true WHERE code = v_probe;
  UPDATE public.events SET currency = v_probe WHERE id = v_event;
  UPDATE public.supported_brand_currencies SET active = false WHERE code = v_probe;

  SELECT e.currency INTO v_currency FROM public.events AS e WHERE e.id = v_event;
  IF v_currency IS DISTINCT FROM v_probe THEN
    RAISE EXCEPTION 'T7 FAIL: deactivating the currency changed the event row';
  END IF;
  -- The row still accepts unrelated edits while its currency is inactive.
  UPDATE public.events SET title = 'Still editable' WHERE id = v_event;

  v_raised := false;
  BEGIN
    DELETE FROM public.supported_brand_currencies WHERE code = v_probe;
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'events_currency_supported_fkey' THEN
      RAISE EXCEPTION 'T7 FAIL: delete refused by % instead', v_constraint;
    END IF;
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'T7 FAIL: a currency an event still uses was deleted';
  END IF;
  RAISE NOTICE 'T7 PASS: deactivation leaves the event intact; deleting a used code is refused';

  -- ── T8: who may call the helper ───────────────────────────────────────────
  IF has_function_privilege('anon', 'public.is_supported_offering_currency(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.is_supported_offering_currency(text)', 'EXECUTE')
     OR has_function_privilege('public', 'public.is_supported_offering_currency(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T8 FAIL: a client role holds EXECUTE on the helper';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.is_supported_offering_currency(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T8 FAIL: service_role cannot call the helper';
  END IF;

  v_raised := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.is_supported_offering_currency('GBP');
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'T8 FAIL: authenticated called the helper';
  END IF;

  v_raised := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.is_supported_offering_currency('GBP');
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'T8 FAIL: anon called the helper';
  END IF;

  SET LOCAL ROLE service_role;
  IF public.is_supported_offering_currency(
       (SELECT min(c.code::text) FROM public.supported_brand_currencies AS c WHERE c.active)
     ) IS NOT TRUE THEN
    RESET ROLE;
    RAISE EXCEPTION 'T8 FAIL: service_role got a wrong answer';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'T8 PASS: anon and authenticated refused; service_role answered';

  -- ── T9: the helper owns no list; it is hardened ───────────────────────────
  IF v_src_after ~ '''[A-Za-z]{3}''' THEN
    RAISE EXCEPTION 'T9 FAIL: the helper body contains a currency literal';
  END IF;
  IF v_src_after !~ 'public\.supported_brand_currencies' THEN
    RAISE EXCEPTION 'T9 FAIL: the helper does not read public.supported_brand_currencies';
  END IF;
  SELECT format('%s|%s|%s', p.provolatile, p.prosecdef, p.proconfig::text) INTO v_state
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.is_supported_offering_currency(text)'::regprocedure;
  IF v_state <> 's|t|{"search_path=\"\""}' THEN
    RAISE EXCEPTION 'T9 FAIL: helper is not STABLE SECURITY DEFINER with an empty search_path: %', v_state;
  END IF;
  RAISE NOTICE 'T9 PASS: no literal list; STABLE, SECURITY DEFINER, empty search_path';

  RAISE NOTICE 'issue_3645_shared_offering_currency_source: ALL PASS';
END
$test$;

ROLLBACK;
