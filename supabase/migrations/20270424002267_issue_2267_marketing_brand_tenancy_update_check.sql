-- issue #2267 — constrain `brand_id` on UPDATE to match the INSERT contract
-- on `marketing_templates` and `marketing_campaigns`.
--
-- WHAT IS ASYMMETRIC TODAY. Both tables constrain which brand a row may be
-- filed under when the row is CREATED, and neither constrains it when the row
-- is CHANGED:
--
--   marketing_templates_insert  WITH CHECK … AND (brand_id IS NULL OR
--                               mkt_brand_min_rank(brand_id,'event_manager'))
--   marketing_templates_update  WITH CHECK is_starter_pack = false
--                               AND account_id = auth.uid()
--                               — brand_id is not mentioned at all
--
--   marketing_campaigns_insert  WITH CHECK account_id = auth.uid()
--                               AND mkt_brand_min_rank(brand_id,'event_manager')
--   marketing_campaigns_update  WITH CHECK account_id = auth.uid()
--                               OR  mkt_brand_min_rank(brand_id,'event_manager')
--                               — the first disjunct alone satisfies the policy
--
-- `marketingTemplateService.updateUserTemplate` accepts a `brand_id` patch
-- (marketingTemplateService.ts:181-182), so the column is a live part of the
-- UPDATE payload and not merely theoretically writable. Verified against the
-- LIVE production pg_policy catalogue on 2026-08-18: both UPDATE policies match
-- their definitions in 20260602000003_orch_0815_marketing_hub_phase_a.sql
-- exactly (no drift), and `pg_trigger` carries ZERO user triggers on either
-- table, so nothing downstream re-checks the column either.
--
-- WHAT THIS MIGRATION DOES. Re-creates the two UPDATE policies so the
-- POST-UPDATE row must satisfy the same brand constraint the INSERT policy
-- already applies. `WITH CHECK` only.
--
-- WHY `USING` IS DELIBERATELY LEFT ALONE. `USING` decides which rows are
-- VISIBLE to the UPDATE. Adding a rank requirement there would lock an operator
-- out of rows they already own the moment their brand membership lapsed — they
-- could not even rename or retire their own draft. Row selection stays on
-- authorship/rank as before; only the shape of the resulting row is tightened.
-- Anyone editing this file later: tighten `WITH CHECK`, never `USING`.
--
-- NO BACKFILL, NO DATA MIGRATION. `WITH CHECK` is evaluated per statement
-- against the row an UPDATE would produce; it never re-validates rows at rest.
-- Existing rows are untouched and remain readable and deletable exactly as
-- before. Production at authoring time: 5 `marketing_templates` rows (all
-- starter-pack, which the UPDATE policy already excludes) and 18
-- `marketing_campaigns` rows.
--
-- `public.mkt_brand_min_rank` is intentionally NOT `SECURITY DEFINER` — it
-- evaluates in the caller's auth context and returns false rather than raising
-- when the caller has no membership (see the Phase A header, and
-- feedback_rls_returning_owner_gap.md). That property is what makes it correct
-- inside a `WITH CHECK`, and it is preserved here unchanged.

BEGIN;

-- =========================================================================
-- 1. marketing_templates — brand constraint on the resulting row
-- =========================================================================
-- USING: unchanged from Phase A.
-- WITH CHECK: adds the brand_id clause verbatim from marketing_templates_insert.
--   `brand_id IS NULL` stays permitted because a personal (unfiled) template is
--   a first-class shape on this table — the INSERT policy allows it and the
--   authorship CHECK constraint does not require a brand.
DROP POLICY IF EXISTS marketing_templates_update ON public.marketing_templates;
CREATE POLICY marketing_templates_update ON public.marketing_templates
  FOR UPDATE TO authenticated
  USING (is_starter_pack = false AND account_id = auth.uid())
  WITH CHECK (
    is_starter_pack = false
    AND account_id = auth.uid()
    AND (brand_id IS NULL OR public.mkt_brand_min_rank(brand_id, 'event_manager'))
  );

-- =========================================================================
-- 2. marketing_campaigns — brand constraint on the resulting row
-- =========================================================================
-- USING: unchanged from Phase A (author OR event_manager on the brand may
--   select the row for update — team editing of a colleague's campaign is an
--   intended behaviour and is preserved).
-- WITH CHECK: the rank requirement now stands on its own instead of sitting
--   behind an OR that the row's own author satisfies unconditionally. This is
--   the same requirement marketing_campaigns_insert already applies, so every
--   campaign that exists was authored by someone holding it. `brand_id` is
--   NOT NULL on this table, so there is no null arm to admit.
--   `account_id` is deliberately NOT added here: the row-selection rule above
--   admits a non-author event_manager, and requiring authorship on the result
--   would break that intended team-editing path.
DROP POLICY IF EXISTS marketing_campaigns_update ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_update ON public.marketing_campaigns
  FOR UPDATE TO authenticated
  USING (
    account_id = auth.uid()
    OR public.mkt_brand_min_rank(brand_id, 'event_manager')
  )
  WITH CHECK (
    public.mkt_brand_min_rank(brand_id, 'event_manager')
  );

-- =========================================================================
-- 3. Post-apply assertions — a partial apply must fail fast
-- =========================================================================
-- Reads the catalogue back rather than trusting the DDL above. Asserts the
-- shape of each policy in both directions: the brand clause is PRESENT in
-- WITH CHECK, and `USING` is byte-identical to what Phase A shipped (an
-- over-tightening of USING is as much a defect as the gap this closes).
DO $issue_2267_verify$
DECLARE
  v_using text;
  v_check text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_using, v_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'marketing_templates'
     AND p.polname = 'marketing_templates_update';

  IF v_check IS NULL THEN
    RAISE EXCEPTION 'issue #2267: marketing_templates_update is missing or has no WITH CHECK';
  END IF;
  IF v_check NOT LIKE '%mkt_brand_min_rank%' THEN
    RAISE EXCEPTION 'issue #2267: marketing_templates_update WITH CHECK does not constrain brand_id (got: %)', v_check;
  END IF;
  IF v_check NOT LIKE '%account_id = auth.uid()%' OR v_check NOT LIKE '%is_starter_pack = false%' THEN
    RAISE EXCEPTION 'issue #2267: marketing_templates_update WITH CHECK lost an existing clause (got: %)', v_check;
  END IF;
  IF v_using IS NULL OR v_using LIKE '%mkt_brand_min_rank%' THEN
    RAISE EXCEPTION 'issue #2267: marketing_templates_update USING must stay unchanged — a rank requirement there locks owners out of rows they already hold (got: %)', v_using;
  END IF;

  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_using, v_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'marketing_campaigns'
     AND p.polname = 'marketing_campaigns_update';

  IF v_check IS NULL THEN
    RAISE EXCEPTION 'issue #2267: marketing_campaigns_update is missing or has no WITH CHECK';
  END IF;
  IF v_check NOT LIKE '%mkt_brand_min_rank%' THEN
    RAISE EXCEPTION 'issue #2267: marketing_campaigns_update WITH CHECK does not constrain brand_id (got: %)', v_check;
  END IF;
  IF v_check LIKE '%account_id%' THEN
    RAISE EXCEPTION 'issue #2267: marketing_campaigns_update WITH CHECK still carries an authorship disjunct alongside the brand rank requirement, which the row''s own author satisfies unconditionally (got: %)', v_check;
  END IF;
  IF v_using IS NULL OR v_using NOT LIKE '%account_id = auth.uid()%' OR v_using NOT LIKE '%mkt_brand_min_rank%' THEN
    RAISE EXCEPTION 'issue #2267: marketing_campaigns_update USING must stay unchanged — team editing of a colleague''s campaign depends on it (got: %)', v_using;
  END IF;

  -- The helper must remain caller-context. A SECURITY DEFINER rewrite would
  -- make every clause above evaluate as the definer and silently pass.
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'mkt_brand_min_rank'
       AND pronamespace = 'public'::regnamespace
       AND prosecdef
  ) THEN
    RAISE EXCEPTION 'issue #2267: public.mkt_brand_min_rank became SECURITY DEFINER — the WITH CHECK clauses above would no longer evaluate in the caller''s auth context';
  END IF;

  RAISE NOTICE 'issue #2267: both UPDATE policies now constrain brand_id on the resulting row; both USING clauses unchanged';
END
$issue_2267_verify$;

COMMIT;
