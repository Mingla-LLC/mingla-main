-- ISSUE-1002 [Campaign Builder multi-destination fan-out] — Wave 4 (final) of
-- epic #977. Forensic Lane C proved destination was a SINGLE object at every
-- layer, including the DB: `ad_campaigns` carries six scalar dest_* columns and
-- one row = one (platform, destination) ad. No ad platform accepts multiple
-- destinations per ad, so multi-select is realized as a FAN-OUT: one ad_campaigns
-- row per (destination × platform), created by the wizard's existing
-- one-call-per-unit loop (now with an added destination axis).
--
-- DESIGN DECISION (Lane C Q3 open choice: join table vs. grouping id) — grouping
-- id. Each `ad_campaigns` row is already physically 1:1 with a single destination
-- (one ad = one landing URL). A join table would therefore be redundant 1:1
-- indirection. Instead we tag the N rows that came from ONE builder fan-out with a
-- shared `dest_group_id`, so a single conceptual "campaign" (N destinations × M
-- platforms) is recoverable as `WHERE dest_group_id = $1`.
--
-- SAFE-MIGRATION: additive + nullable + idempotent (IF NOT EXISTS). A
-- single-destination build simply omits the group id (column stays NULL) → every
-- pre-1002 row and every single-destination row is unaffected. Reversible (see
-- ROLLBACK below). NOT applied here — the orchestrator applies on deploy.

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS dest_group_id uuid NULL;

COMMENT ON COLUMN public.ad_campaigns.dest_group_id IS
  'ISSUE-1002 multi-destination fan-out — the shared id tying together the N ad_campaigns rows produced by ONE Campaign Builder session that fanned out across a set of destinations × platforms (one row per (destination, platform), each with its own dest_url). NULL for legacy rows and single-destination builds that carried no group. Not a FK: the group is a logical envelope over sibling ad_campaigns rows, not a separate entity.';

-- Recover a whole fan-out group cheaply (campaign-group views, group-level
-- pause/report). Partial index — the column is NULL for the single-destination
-- and legacy majority, which never need grouping.
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_dest_group_id
  ON public.ad_campaigns (dest_group_id)
  WHERE dest_group_id IS NOT NULL;

-- ROLLBACK (manual, if ever needed — forward-only pipeline, documented per
-- safe-migration protocol):
--   DROP INDEX IF EXISTS public.idx_ad_campaigns_dest_group_id;
--   ALTER TABLE public.ad_campaigns DROP COLUMN IF EXISTS dest_group_id;
