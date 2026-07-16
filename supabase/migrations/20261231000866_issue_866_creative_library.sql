-- ISSUE-866 WP3 [Full Rooms Ad Engine — Creative Library] — canonical assets +
-- per-platform uploaded-ref cache.
--
-- SPEC: Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md §4.2 as
-- superseded by Amendment A1 (A1-1 platform enum + content-hash cache keying;
-- A1-3 mp4_master_url byte source; A1-6 probe-populated metadata + has_audio +
-- per-ratio variant slots; A1-8 ai_generated + the OD-4 poster CHECK).
--
-- Two tables:
--   ad_creatives              — one row per creative, made once; source bytes
--                               are IMMUTABLE after create (changed bytes = a
--                               NEW row — A1-1). Metadata (width/height/ratio/
--                               duration/mime/content_hash/has_audio) is
--                               POPULATED BY THE SERVER-SIDE BYTE-PROBE, never
--                               client-trusted (A1-6a / GR-22).
--   ad_creative_platform_refs — the per-(platform, lane, account) uploaded-ref
--                               cache: upload once, reuse forever; a cached
--                               `ready` ref is valid ONLY on content_hash match
--                               (A1-1 / GR-53 — Google assets are immutable, a
--                               name-keyed cache silently reuses a stale asset).
--
-- Plus the FK the WP1 foundation left as a forward reference (its migration
-- comment names this exact constraint): ads.creative_id → ad_creatives(id).
--
-- Version prefix 20261231000866: strictly greater than the local/sibling/remote
-- head 20261230000000 (WP1) and NOT one of the six duplicate prefixes named in
-- COMMS-0102 (20260612000000, 20260615000000, 20261012000000, 20261113000000,
-- 20261116000000, 20261117000000); the 000866 suffix avoids sibling-worktree
-- collisions (issue-867 shares the same head).
--
-- RLS: admin-only SELECT via public.is_admin_user() for authenticated; NO
-- INSERT/UPDATE/DELETE policy (service-role — the admin-gated edge functions —
-- writes only; identical to the WP1 ad-engine tables + payment_webhook_events).
--
-- RT-4 (venue = EXISTING entity): place_id references public.place_pool(id) —
-- NO new venue table is created by this migration.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN ('image','video')),
  name               text NOT NULL,
  -- canonical source (Mingla-owned; exactly one storage home per kind):
  source_url         text NULL,       -- public fetchable URL (image: meta-ad-creatives public URL; video: Bunny playback URL)
  storage_bucket     text NULL,       -- 'meta-ad-creatives' for image assets in Supabase storage (#864's bucket — reused, OD-7)
  storage_path       text NULL,       -- object path within the bucket
  bunny_video_id     text NULL,       -- Bunny Stream id for video assets (META-1270)
  poster_url         text NULL,       -- video cover/thumbnail URL (Meta+TikTok video creatives; Reddit VIDEO posts REQUIRE one — A1-8c)
  mp4_master_url     text NULL,       -- A1-3: direct-MP4 byte source (Bunny serves HLS, not a downloadable MP4);
                                      -- REQUIRED at resolve time for any video destined for Snapchat/Google
                                      -- (resolver-enforced, NOT a DB CHECK — a Meta/TikTok-only video is not blocked)
  -- venue tagging (EXISTING entities — no new venue table; RT-4):
  place_id           uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  brand_id           uuid NULL REFERENCES public.brands(id)     ON DELETE SET NULL,
  -- probe-populated metadata (A1-6a: ffprobe-or-equivalent on the ACTUAL BYTES;
  -- admin-supplied dimensions are IGNORED as inputs — never trusted):
  width              integer NULL,
  height             integer NULL,
  aspect_ratio       numeric NULL,    -- width/height, e.g. 1.7778 (16:9), 1.0 (1:1), 0.5625 (9:16)
  duration_seconds   numeric NULL,    -- video only
  mime_type          text NULL,
  byte_size          bigint NULL,     -- probe-derived canonical byte count (channel byte-cap rows need it without a re-fetch)
  has_audio          boolean NULL,    -- video only (A1-6a); Snap/TikTok HARD-REJECT silent video
  content_hash       text NOT NULL,   -- A1-1: sha256 of the canonical bytes, computed by the byte-probe, NEVER client-supplied;
                                      -- source bytes are immutable after create — changed bytes = a NEW row
  ai_generated       boolean NOT NULL DEFAULT false,  -- A1-8a → Meta self_ai_disclosure (true ⇒ OPT_IN);
                                                       -- default TRUE upstream for Higgsfield/Remotion pipeline output
  -- A1-6c per-ratio variant slots (deterministic crops from the master; the
  -- edge runtime cannot transcode, so slots are POPULATED bytes, keyed by ratio
  -- label): { "4:5"|"1:1"|"9:16"|"1.91:1": { source_url, storage_path?, width,
  -- height, content_hash, byte_size? } }
  variants           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by         uuid NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- integrity: an image must have a fetchable image; a video must have a Bunny
  -- id + poster (OD-4 CHECK STANDS — reinforced by A1-8c: Reddit requires a
  -- thumbnail for VIDEO posts [SPEC]):
  CONSTRAINT ad_creatives_image_source CHECK (kind <> 'image' OR source_url IS NOT NULL),
  CONSTRAINT ad_creatives_video_source CHECK (kind <> 'video' OR (bunny_video_id IS NOT NULL AND poster_url IS NOT NULL))
);

COMMENT ON TABLE public.ad_creatives IS
  'Creative Library canonical assets (ISSUE-866). One row per creative, made once, tagged to a venue (place_pool) and reused across every ad platform. Source bytes are IMMUTABLE after create (A1-1) — changed bytes = a new row. width/height/aspect_ratio/duration_seconds/mime_type/byte_size/has_audio/content_hash are populated by the server-side byte-probe (A1-6) and never client-trusted.';

COMMENT ON COLUMN public.ad_creatives.content_hash IS
  'A1-1: sha256 (hex) of the canonical bytes, computed by the byte-probe at create — never client-supplied. The platform-ref cache keys on CONTENT: a cached ready ref is returned only if its content_hash snapshot matches this value.';

COMMENT ON COLUMN public.ad_creatives.mp4_master_url IS
  'A1-3 step 3: Bunny Stream serves HLS, not a downloadable MP4 — Snap ingests raw bytes and Google needs bytes for the YouTube resumable upload. One of (direct MP4 rendition | this master) MUST resolve at resolveCreativeRef time for any video destined for Snapchat or Google; enforced in the resolver, not by DB CHECK.';

COMMENT ON COLUMN public.ad_creatives.variants IS
  'A1-6c per-ratio variant slots (4:5 / 1:1 / 9:16 / 1.91:1), each { source_url, storage_path?, width, height, content_hash, byte_size? }. Deterministic crops from the master, produced OUTSIDE the edge runtime (Deno edge cannot transcode — typed needs_transcode outcomes gate the channels until a slot is supplied). Google image uploads consume these PRE-CROPPED bytes (A1-5: the API has NO crop parameter and never fetches URLs).';

CREATE TABLE IF NOT EXISTS public.ad_creative_platform_refs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id         uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  -- A1-1: platform reads snapchat — never the bare four-letter snap token
  -- (GR-14: it silently breaks the cache key and the CHECK against #862's
  -- canon enum) — plus reddit so the CHECK and the adapter registry stay total:
  platform            text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','reddit')),
  lane                text NOT NULL CHECK (lane IN ('consumer','business')),
  external_account_id text NOT NULL,  -- the ad account / advertiser / customer the asset physically lives in
                                      -- (Meta image_hash is ACCOUNT-scoped; keying by account survives rebinds — OD-5)
  external_kind       text NOT NULL CHECK (external_kind IN ('image','video')),
  external_ref        text NULL,      -- PRIMARY id: meta image_hash|video_id · tiktok material_id · snapchat media_id · google asset resource_name
  external_ref_extra  jsonb NOT NULL DEFAULT '{}'::jsonb,
                                      -- secondary ids: meta {thumbnail_image_hash} · tiktok {image_id|video_id} ·
                                      -- google {per-ratio resource_names, youtube_video_id}
  content_hash        text NOT NULL,  -- A1-1: snapshot of ad_creatives.content_hash at upload time; a cached `ready`
                                      -- ref is valid ONLY on hash match — mismatch ⇒ fresh upload (Google: necessarily
                                      -- a fresh asset; assets are immutable — A1-5)
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','ready','failed')),
  error               text NULL,      -- normalized platform error on failure (NEVER contains a token — SC-SEC-1)
  uploaded_at         timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creative_platform_refs_uniq UNIQUE (creative_id, platform, lane, external_account_id)  -- THE idempotency key (AC-4)
);

COMMENT ON TABLE public.ad_creative_platform_refs IS
  'Per-platform uploaded-ref cache (ISSUE-866): an asset is uploaded to a given (platform, lane, external_account_id) AT MOST ONCE (I-PROPOSED-CREATIVE-IDEMPOTENT-UPLOAD). The UNIQUE key is the concurrency lock (resolveCreativeRef upserts status=uploading before calling the adapter). Cache validity keys on CONTENT (content_hash), not id/name — A1-1/GR-53.';

-- The WP1 forward reference (its migration comment names this exact constraint):
ALTER TABLE public.ads
  ADD CONSTRAINT ads_creative_id_fkey
  FOREIGN KEY (creative_id) REFERENCES public.ad_creatives(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Indexes (§4.2)
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ad_creatives_place_id            ON public.ad_creatives (place_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_brand_id            ON public.ad_creatives (brand_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_kind_status         ON public.ad_creatives (kind, status);
CREATE INDEX IF NOT EXISTS idx_ad_creative_refs_creative_id     ON public.ad_creative_platform_refs (creative_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_refs_platform_lane   ON public.ad_creative_platform_refs (platform, lane);
CREATE INDEX IF NOT EXISTS idx_ads_creative_id                  ON public.ads (creative_id);

-- ════════════════════════════════════════════════════════════════════════
-- 3. updated_at triggers (house pattern — reuses the WP1 trigger fn)
-- ════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_ad_creatives_updated_at ON public.ad_creatives;
CREATE TRIGGER trg_ad_creatives_updated_at
  BEFORE UPDATE ON public.ad_creatives
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

DROP TRIGGER IF EXISTS trg_ad_creative_platform_refs_updated_at ON public.ad_creative_platform_refs;
CREATE TRIGGER trg_ad_creative_platform_refs_updated_at
  BEFORE UPDATE ON public.ad_creative_platform_refs
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS — admin SELECT only; writes are service-role only (no policy)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ad_creatives              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creative_platform_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_creatives admin can read" ON public.ad_creatives;
CREATE POLICY "ad_creatives admin can read"
  ON public.ad_creatives
  FOR SELECT
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "ad_creative_platform_refs admin can read" ON public.ad_creative_platform_refs;
CREATE POLICY "ad_creative_platform_refs admin can read"
  ON public.ad_creative_platform_refs
  FOR SELECT
  USING (public.is_admin_user());

-- No INSERT/UPDATE/DELETE policies: authenticated cannot write; service_role
-- (the admin-gated admin-ad-* edge functions) bypasses RLS. Matches the WP1
-- ad-engine tables + payment_webhook_events.

GRANT SELECT ON public.ad_creatives              TO authenticated;
GRANT SELECT ON public.ad_creative_platform_refs TO authenticated;

GRANT ALL ON public.ad_creatives              TO service_role;
GRANT ALL ON public.ad_creative_platform_refs TO service_role;
