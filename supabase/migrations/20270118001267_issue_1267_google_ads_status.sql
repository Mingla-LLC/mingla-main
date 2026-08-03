-- ISSUE-1267 [Google Ads — the 5th server-side conversion lane].
--
-- Additive + idempotent: adds public.ad_conversions.google_ads_status, mirroring
-- the four existing per-channel *_status columns (meta_capi_status,
-- tiktok_events_status, snap_capi_status, reddit_capi_status) shipped by
-- 20270105000865 — SAME NOT NULL DEFAULT 'pending' and the SAME 4-value CHECK.
--
-- The fireAdConversion helper (_shared/adConversionFire.ts) sets this to the
-- Google uploadClickConversions outcome exactly like the other lanes; the
-- per-channel *_status gate makes a re-delivered webhook re-send NOTHING once the
-- lane is non-'pending' (the redelivery-dedup contract, SC-3/RT-2).
--
-- NO new function (so no anon-definer-gate concern). NO token / secret: the Google
-- OAuth dev-token + refresh-token + customer-id already exist and the `adwords`
-- scope already covers uploadClickConversions; the conversion-action id is CONFIG
-- and lives in ad_connections.extra — never here.
--
-- ad_conversions.platform already enumerates 'google' (20270105000865, A3-1), so
-- no CHECK change is required there.
--
-- MIGRATION HYGIENE: version prefix 20270118001267 is strictly greater than the
-- applied prod head 20270117001020 (#1020) and every sibling-worktree prefix. The
-- ALTER is a single atomic statement (column + inline CHECK created together, so
-- never partially applied) guarded by IF NOT EXISTS for idempotent re-runs.

ALTER TABLE public.ad_conversions
  ADD COLUMN IF NOT EXISTS google_ads_status text NOT NULL DEFAULT 'pending'
    CHECK (google_ads_status IN ('pending', 'sent', 'failed', 'skipped'));

COMMENT ON COLUMN public.ad_conversions.google_ads_status IS
  'ISSUE-1267. Per-channel send outcome for the Google Ads uploadClickConversions lane (the 5th conversion channel), mirroring meta_capi_status / tiktok_events_status / snap_capi_status / reddit_capi_status. pending -> sent | failed | skipped. Read by the redelivery-dedup gate in _shared/adConversionFire.ts so a Google upload fires at most once per event_id.';
