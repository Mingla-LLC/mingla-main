-- #2829 W6 (AD-9) — stream videos for Mingla Sites.
--
-- A site's long films and hero loops play best from Bunny Stream (adaptive
-- MP4 renditions on a CDN, no video bytes on Supabase egress). Bunny's keys are
-- Core secrets, so Studio never talks to Bunny's API: it asks Core, through the
-- signed CMS -> Core routes on brand-site-cms-callback, for an upload intent
-- (Core creates the Bunny video and presigns a resumable upload), uploads the
-- file straight to Bunny, then polls Core for the video's status. This table is
-- where Core keeps that status, per site.
--
--   * one row per Bunny video a site uploaded; `provider_guid` is Bunny's id;
--   * `site_id` and `brand_id` are bound at insert (brand_id must be the
--     site's brand) and never change; the guid never changes either;
--   * status: created -> uploading -> processing -> ready | failed;
--   * `renditions`: the MP4 renditions Bunny produced, [{url, height}] on the
--     stream CDN host, written when the video is ready.
--
-- RLS forced; service_role only (the edge function is the only reader/writer).
-- Forward-only. Nothing here runs when Bunny is not configured: the routes
-- refuse before touching this table.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.brand_site_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'bunny' CHECK (provider = 'bunny'),
  provider_guid text NOT NULL
    CHECK (provider_guid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','uploading','processing','ready','failed')),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  width integer CHECK (width IS NULL OR width >= 0),
  height integer CHECK (height IS NULL OR height >= 0),
  renditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(renditions) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_videos_provider_guid_uq UNIQUE (provider, provider_guid),
  CONSTRAINT brand_site_videos_ready_ck CHECK (
    status <> 'ready' OR (duration_ms IS NOT NULL AND jsonb_array_length(renditions) > 0)
  )
);

CREATE INDEX IF NOT EXISTS brand_site_videos_site_idx ON public.brand_site_videos (site_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.brand_site_videos_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_site_brand uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT s.brand_id INTO v_site_brand FROM public.brand_sites s WHERE s.id = NEW.site_id;
    IF v_site_brand IS NULL OR v_site_brand <> NEW.brand_id THEN
      RAISE EXCEPTION 'brand_site_videos: brand % is not the brand of site %', NEW.brand_id, NEW.site_id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.site_id <> OLD.site_id OR NEW.brand_id <> OLD.brand_id
       OR NEW.provider <> OLD.provider OR NEW.provider_guid <> OLD.provider_guid THEN
      RAISE EXCEPTION 'brand_site_videos: site, brand and provider video never change'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.brand_site_videos_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_site_videos_guard_trg ON public.brand_site_videos;
CREATE TRIGGER brand_site_videos_guard_trg
  BEFORE INSERT OR UPDATE ON public.brand_site_videos
  FOR EACH ROW EXECUTE FUNCTION public.brand_site_videos_guard();

ALTER TABLE public.brand_site_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_videos FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_videos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_site_videos TO service_role;

COMMENT ON TABLE public.brand_site_videos IS
  '#2829 W6 — Bunny Stream videos uploaded for a Mingla Site (status, length, MP4 renditions). Written and read only by brand-site-cms-callback (service role) through signed CMS→Core routes. No direct grants.';

COMMIT;
