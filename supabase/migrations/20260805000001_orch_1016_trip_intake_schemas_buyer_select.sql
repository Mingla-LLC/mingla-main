-- ORCH-1016 [Consumer Discover Trips tab] REWORK (tester finding D2) —
-- authenticated-buyer SELECT policy for `trip_intake_schemas`.
--
-- WHY: The consumer app signs buyers in (persistSession=true), so a buyer
-- reading a published trip's intake schema hits RLS as `authenticated`, NOT
-- `anon`. The pre-existing `trip_intake_schemas_anon_select` policy is scoped
-- to the `anon` role ONLY; the only `authenticated` policy is
-- `trip_intake_schemas_planner_all` which requires
-- `biz_brand_effective_rank >= event_manager`. A signed-in CONSUMER buyer is
-- neither anon nor a planner, so they would read ZERO intake-schema rows and
-- the consumer trip-checkout intake renderer (ORCH-1016 D2) could never load
-- the schema — silently rendering no fields and then failing the edge fn's
-- required-question gate (`intake_form_required`, HTTP 400). This is the
-- fail-CLOSED gap the tester flagged.
--
-- FIX: add an additive `authenticated` SELECT policy mirroring the anon
-- policy's EXACT predicate (published trip: event_type='trip' AND
-- status in ('scheduled','live') AND not soft-deleted). This grants signed-in
-- buyers the SAME read the public web buyer (anon) already has — no wider.
-- The planner policy is untouched; the anon policy is untouched.
--
-- This parallels the `ticket_types` "Public can read ... (anon or auth)"
-- policy which already grants BOTH roles a published-event read. It does NOT
-- expose any draft/unpublished schema, and `trip_intake_schemas` is not a
-- brands/tickets table so COMMS-0009 (anon never reads brands/tickets
-- directly) is unaffected.
--
-- Idempotent: DROP IF EXISTS before CREATE so re-running `db push` is safe.

DROP POLICY IF EXISTS trip_intake_schemas_buyer_select ON public.trip_intake_schemas;

CREATE POLICY trip_intake_schemas_buyer_select
  ON public.trip_intake_schemas
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = trip_intake_schemas.event_id
        AND e.event_type = 'trip'
        AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text])
        AND e.deleted_at IS NULL
    )
  );
