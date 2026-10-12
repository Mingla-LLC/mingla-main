-- Issue #3645 — one source for "is this currency supported for an offering".
--
-- WHY: the supported-currency list was written out by hand in four places:
-- the events_currency_supported_check CHECK on public.events and the bodies of
-- business_publish_event_draft, biz_publish_experience and
-- biz_create_experience. The copies drifted (the two experience functions
-- carry 19 codes with no NGN; the CHECK and the event function carry 15 with
-- NGN), so a naira experience is refused and four codes the experience
-- functions admit die on a raw constraint error.
--
-- public.supported_brand_currencies (20270129001384) already owns the list
-- for brands, venues and stays. This migration makes it the owner for
-- offerings too, in two additive steps that change no behaviour today:
--
--   1. public.is_supported_offering_currency(text) — the ONE question every
--      offering function will ask. Nothing calls it yet; the three offering
--      functions are re-emitted to use it in a later, separately applied
--      migration.
--   2. public.events.currency is held to the table by a FOREIGN KEY instead of
--      a hand-written CHECK. The CHECK's 15 codes are exactly the 15 seeded
--      rows, so the set of accepted values is identical before and after.
--      NULL stays allowed: "no currency yet" is not "unsupported".
--
-- The FK has no ON DELETE / ON UPDATE action (NO ACTION). Retiring a currency
-- is `active = false`, which the FK ignores, so existing events keep their
-- currency; only the helper stops admitting it for new work. Deleting a row
-- that events still use is refused, which is the wanted outcome.
--
-- Re-runnable: the function is CREATE OR REPLACE, the FK is added only when
-- absent, VALIDATE on a validated constraint is a no-op, and the CHECK is
-- dropped IF EXISTS.
--
-- NOT modified here: business_publish_event_draft, biz_publish_experience,
-- biz_create_experience, public.supported_brand_currencies and its rows.
--
-- Invariant (docs/INVARIANT_REGISTRY.md):
--   I-PROPOSED-3645-ONE-OFFERING-CURRENCY-SOURCE

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The helper.
--
-- SECURITY DEFINER because supported_brand_currencies is revoked from every
-- client role; the offering functions that will call it are themselves
-- SECURITY DEFINER and run as the owner, so EXECUTE is granted to
-- service_role only. search_path is empty and every reference is qualified.
--
-- The length test is deliberate. A cast to character(3) silently truncates,
-- so without it 'NGNX' would be read as 'NGN' and admitted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_supported_offering_currency(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.supported_brand_currencies AS c
    WHERE c.active
      AND pg_catalog.length(pg_catalog.btrim(p_code)) = 3
      AND c.code = pg_catalog.upper(pg_catalog.btrim(p_code))::character(3)
  );
$function$;

REVOKE ALL ON FUNCTION public.is_supported_offering_currency(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_supported_offering_currency(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_supported_offering_currency(text) TO service_role;

COMMENT ON FUNCTION public.is_supported_offering_currency(text) IS
  'Issue #3645: the one answer to "may an offering use this currency". Reads public.supported_brand_currencies (active rows). Offering functions call this; they never carry their own list.';

-- ---------------------------------------------------------------------------
-- 2. events.currency: hand-written CHECK -> FOREIGN KEY to the table.
--
-- Pre-flight: refuse to proceed if any event already holds a code the table
-- does not list. With the CHECK in force this cannot happen; the guard exists
-- so a surprise is a named abort here rather than an anonymous VALIDATE error.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_orphans text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT e.currency::text, ', ')
    INTO v_orphans
    FROM public.events AS e
   WHERE e.currency IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.supported_brand_currencies AS c
        WHERE c.code = e.currency
     );
  IF v_orphans IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_3645_events_currency_not_in_supported_brand_currencies: %', v_orphans;
  END IF;
END
$preflight$;

DO $add_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS k
     WHERE k.conrelid = 'public.events'::pg_catalog.regclass
       AND k.conname = 'events_currency_supported_fkey'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_currency_supported_fkey
      FOREIGN KEY (currency)
      REFERENCES public.supported_brand_currencies (code)
      NOT VALID;
  END IF;
END
$add_fk$;

ALTER TABLE public.events
  VALIDATE CONSTRAINT events_currency_supported_fkey;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_currency_supported_check;

COMMENT ON CONSTRAINT events_currency_supported_fkey ON public.events IS
  'Issue #3645: replaces the hand-written events_currency_supported_check list. public.supported_brand_currencies owns the list. NULL is allowed.';

-- ---------------------------------------------------------------------------
-- 3. Self-verification. Any failure aborts the whole migration.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk_ok boolean;
BEGIN
  IF public.is_supported_offering_currency('NGN') IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3645_verify: NGN must be supported';
  END IF;
  IF public.is_supported_offering_currency('  ngn ') IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3645_verify: lowercase padded input must be supported';
  END IF;
  IF public.is_supported_offering_currency('JPY') IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3645_verify: JPY must not be supported';
  END IF;
  IF public.is_supported_offering_currency(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3645_verify: NULL must be false, never NULL or true';
  END IF;
  IF public.is_supported_offering_currency('NGNX') IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_3645_verify: an over-long code must not be truncated into a match';
  END IF;

  SELECT k.convalidated
    INTO v_fk_ok
    FROM pg_catalog.pg_constraint AS k
   WHERE k.conrelid = 'public.events'::pg_catalog.regclass
     AND k.conname = 'events_currency_supported_fkey'
     AND k.contype = 'f'
     AND k.confrelid = 'public.supported_brand_currencies'::pg_catalog.regclass;
  IF v_fk_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_3645_verify: events_currency_supported_fkey missing or not validated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS k
     WHERE k.conrelid = 'public.events'::pg_catalog.regclass
       AND k.conname = 'events_currency_supported_check'
  ) THEN
    RAISE EXCEPTION 'issue_3645_verify: events_currency_supported_check still present';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.is_supported_offering_currency(text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.is_supported_offering_currency(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: client roles must not hold EXECUTE on the helper';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.is_supported_offering_currency(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_verify: service_role must hold EXECUTE on the helper';
  END IF;
END
$verify$;

COMMIT;
