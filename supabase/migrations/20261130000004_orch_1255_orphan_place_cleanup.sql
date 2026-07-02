-- ===========================================================================
-- META-ORCH-1255 [multi-venue first-class creation] — M5: orphan place cleanup
-- ---------------------------------------------------------------------------
-- SPEC §4.A.6 (binding, commit b236bfaf9). Investigation D-1 side issue:
-- INCLUDED, not deferred. Three business_authored place_pool rows survived the
-- 2026-06-22 test-data wipe with NO brand/venue reference (their authoring
-- brands were deleted with CASCADE, but place_pool.business_author_brand_id
-- was already NULL / the brand pointer row was gone).
--
-- Remote read-only probe 2026-07-02 (MCP execute_sql): predicate matches
-- EXACTLY 3 rows — Lumen Wine Bar (is_servable=TRUE), The Tuscanny Place
-- (is_servable=false), Lantern & Vine (is_servable=TRUE). Two are currently
-- SERVABLE, i.e. potentially live on the consumer deck with no owner.
--
-- The _orch1073 trigger (trg_orch1073_deleted_unservable) force-holds
-- is_servable=false AND is_active=false on soft-delete (verified invariant
-- I-1073-DELETED-PLACE-NEVER-SERVABLE), which also answers the investigation's
-- "verify is_servable first" caveat STRUCTURALLY — the UPDATE below fires it.
--
-- Predicate is self-limiting to true orphans: business_authored + no
-- business_author_brand_id + no brand pointer + no venue_listings row. A
-- future legitimately-authored place always carries business_author_brand_id
-- or a venue row, so re-running this migration can never eat real data.
--
-- Apply via the Supabase Management API from MERGED main at CLOSE (after
-- M1–M4, which create venue_listings — the NOT EXISTS below references it).
-- Post-apply verify (one query, expects 3 rows, all with deleted_at set,
-- is_servable=false, is_active=false):
--   SELECT id, name, deleted_at, is_servable, is_active FROM place_pool
--   WHERE deleted_reason LIKE 'orch-1255:%';
-- ===========================================================================

BEGIN;

UPDATE public.place_pool pp
   SET deleted_at = now(),
       deleted_reason = 'orch-1255: 2026-06-22 wipe-leftover orphan (no brand/venue reference)',
       is_claimed = false, claimed_by = NULL
 WHERE pp.fetched_via = 'business_authored'
   AND pp.business_author_brand_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.place_pool_id = pp.id)
   AND NOT EXISTS (SELECT 1 FROM public.venue_listings v WHERE v.place_pool_id = pp.id);

COMMIT;
