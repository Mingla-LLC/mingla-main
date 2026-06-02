-- META-ORCH-1009 Sub-E — required venue photo gallery.
--
-- A self-listed (or claimed) venue uploads a hero PLUS a gallery of 5–20 extra
-- photos (operator decision 2026-06-01). The gallery is what customers browse and
-- the set the AI vision analyzes. Photos are stored in the existing `brand_covers`
-- storage bucket at `{brandId}/gallery/{token}.jpg` (its RLS already gates writes
-- by the first path segment = brand the caller admins, and allows public read) —
-- so no new bucket is needed. We only persist the resulting public URLs here.
--
-- Additive + idempotent. No backfill: existing rows default to an empty gallery.

alter table public.place_pool
  add column if not exists business_gallery_urls text[] not null default '{}'::text[];

comment on column public.place_pool.business_gallery_urls is
  'META-ORCH-1009 Sub-E — operator-uploaded venue gallery photo public URLs '
  '(5–20, hero excluded). Stored in the brand_covers bucket. Required (>=5) for a '
  'business-authored/claimed venue to go live; also the set the AI vision analyzes.';
