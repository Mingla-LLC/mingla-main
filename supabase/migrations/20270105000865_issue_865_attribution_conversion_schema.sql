-- ISSUE-865 [Attribution & reservation-conversion tracking — WP-A foundation]
-- Conversion-tracking schema: the measurement layer on top of the SHIPPED
-- 5-channel ad engine (#862/#863/#866).
--
-- SPEC: Mingla_Artifacts/specs/SPEC_ISSUE-865_ATTRIBUTION_ENGINE.md §5.1,
--   as corrected by Amendment A3 (re-validation against the merged engine):
--     A3-1 — every campaign_id FK targets public.ad_campaigns (NOT the
--            never-shipped meta_campaigns); the connection FK targets
--            public.ad_connections (5-channel: meta/tiktok/snapchat/google/reddit,
--            2-lane: consumer/business, UNIQUE(platform,lane)).
--     A3-2 — pixel_id + CAPI token env-var NAMES live in ad_connections.extra /
--            token_env_var; this schema stores connection_id / platform / lane
--            so senders resolve per-connection, per-lane. NO token VALUES here.
--
-- WP-A is exactly two tables + the attribution-capture edge fn. The finalize
-- hook, the CAPI senders, and the web pixels are WP-B / WP-C (gated on Seth) and
-- are NOT in this migration — nothing here touches a purchase/finalize path.
--
-- Two tables, following the ad-engine idiom (20261230000000) verbatim:
--   ad_attribution_touches — one row per inbound tracked click / app deep-link
--                            (click_id UNIQUE first-party id). Append-only.
--   ad_conversions         — one row per attributed conversion, deduped on a
--                            UNIQUE event_id shared with the browser pixel + CAPI
--                            (SC-3 / SC-5). Per-channel *_status columns.
--
-- PRIVACY (SC-9): only SHA-256 hex hashes of PII are ever stored (ua_hash,
-- ip_hash, hashed_email, hashed_phone). The edge fn hashes IP/UA in-memory via
-- Web Crypto SHA-256 (byte-identical to pgcrypto encode(digest(x,'sha256'),'hex'),
-- the house idiom — extensions.pgcrypto is already enabled) so raw PII never
-- reaches Postgres. NO raw email/phone/IP column exists on either table.
--
-- RLS: admin-only SELECT via public.is_admin_user() for authenticated; NO
-- INSERT/UPDATE/DELETE policy (writes are service-role only, via the
-- attribution-capture edge fn — matches ad_connections / payment_webhook_events).
-- The WP-E brand-scoped proof-feed SELECT policy is deferred to WP-E (needs the
-- fire-helper to populate brand_id); this migration ships admin-read only.
--
-- MIGRATION HYGIENE (COMMS-0102): version prefix 20270105000865 is strictly
-- greater than the applied prod head 20270104000000 (ORCH-1392) and every
-- sibling-worktree prefix, and is none of the six known duplicate prefixes.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ad_attribution_touches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  click_id          text NOT NULL UNIQUE,          -- our first-party id (cookie / passed to checkout)
  network           text NOT NULL CHECK (network IN ('meta','tiktok','snapchat','google','reddit','other')),  -- widened to the 5 shipped channels (A3-1)
  external_click_id text NULL,                      -- fbclid | ttclid | sccid | gclid | rdt_cid
  connection_id     uuid NULL REFERENCES public.ad_connections(id) ON DELETE SET NULL,  -- resolved per-lane connection (A3-2)
  campaign_id       uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,    -- A3-1: ad_campaigns, never meta_campaigns
  lane              text NULL CHECK (lane IS NULL OR lane IN ('consumer','business')),  -- consumer vs business (A3-2)
  af_c_id           text NULL,                      -- AppsFlyer OneLink campaign param
  utm               jsonb NOT NULL DEFAULT '{}',    -- utm_source/medium/campaign/content
  dest_page_type    text NULL CHECK (dest_page_type IS NULL OR dest_page_type IN ('event','trip','brand','venue')),
  dest_brand_slug   text NULL,
  dest_entity_slug  text NULL,
  dest_event_id     uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  surface           text NOT NULL CHECK (surface IN ('web','ios','android')),
  user_id           uuid NULL REFERENCES auth.users(id),
  af_uid            text NULL,                      -- app device id (from appsflyer_devices)
  ua_hash           text NULL,                      -- SHA-256 hex of User-Agent; NEVER the raw UA (SC-9)
  ip_hash           text NULL,                      -- SHA-256 hex of client IP; NEVER the raw IP (SC-9)
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ad_attribution_touches IS
  'ISSUE-865 WP-A. One row per inbound tracked ad click / app deep-link. Written service-role-only by the attribution-capture edge fn. PII is stored ONLY as SHA-256 hex (ua_hash/ip_hash) — no raw UA/IP column exists (SC-9). connection_id/campaign_id resolve to the shipped 5-channel engine (A3-1); tokens/pixel-ids are NEVER stored here (they live in ad_connections.token_env_var / extra — A3-2).';

CREATE TABLE IF NOT EXISTS public.ad_conversions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  touch_id             uuid NULL REFERENCES public.ad_attribution_touches(id) ON DELETE SET NULL,
  click_id             text NULL,                   -- copy for late-binding when the touch is not yet resolved
  order_id             uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  event_type           text NOT NULL CHECK (event_type IN ('purchase','reservation','lead','view')),  -- internal category (§5.1)
  event_name           text NOT NULL,               -- platform event name (Purchase/CompletePayment/…); the dedup PAIR with event_id (A2-5)
  value_cents          integer NULL CHECK (value_cents IS NULL OR value_cents >= 0),
  currency             text NULL,
  connection_id        uuid NULL REFERENCES public.ad_connections(id) ON DELETE SET NULL,  -- resolved per-lane connection (A3-2)
  campaign_id          uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,    -- A3-1: ad_campaigns, never meta_campaigns
  platform             text NULL CHECK (platform IS NULL OR platform IN ('meta','tiktok','snapchat','google','reddit')),  -- A3-1
  lane                 text NULL CHECK (lane IS NULL OR lane IN ('consumer','business')),  -- A3-2
  brand_id             uuid NULL,                   -- resolved for rollups (populated by WP-B/WP-E)
  mingla_event_id      uuid NULL,                   -- Mingla event/offering id for rollups (renamed from §5.1's colliding `event_id uuid`)
  surface              text NOT NULL CHECK (surface IN ('web','ios','android')),
  event_id             text NOT NULL UNIQUE,        -- DEDUP KEY shared with the browser pixel + CAPI (SC-3/SC-5) — the idempotency guard
  event_source_url     text NULL,                   -- CAPI event_source_url (the page the conversion happened on)
  hashed_email         text NULL,                   -- SHA-256 hex for CAPI advanced matching; NEVER raw email (SC-9)
  hashed_phone         text NULL,                   -- SHA-256 hex for CAPI advanced matching; NEVER raw phone (SC-9)
  meta_capi_status     text NOT NULL DEFAULT 'pending' CHECK (meta_capi_status     IN ('pending','sent','failed','skipped')),
  tiktok_events_status text NOT NULL DEFAULT 'pending' CHECK (tiktok_events_status IN ('pending','sent','failed','skipped')),
  snap_capi_status     text NOT NULL DEFAULT 'pending' CHECK (snap_capi_status     IN ('pending','sent','failed','skipped')),
  reddit_capi_status   text NOT NULL DEFAULT 'pending' CHECK (reddit_capi_status   IN ('pending','sent','failed','skipped')),
  appsflyer_status     text NOT NULL DEFAULT 'pending' CHECK (appsflyer_status     IN ('pending','sent','failed','skipped')),
  provider_response    jsonb NULL,                  -- normalized per-channel send result — NEVER contains a token
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ad_conversions IS
  'ISSUE-865 WP-A. One row per attributed conversion, deduped on UNIQUE event_id (shared with the browser pixel + server CAPI — SC-3/SC-5; re-delivered webhooks never double-count). Written service-role-only. Per-channel *_status columns (meta/tiktok/snap/reddit CAPI + AppsFlyer S2S) are set to their send outcome by the WP-B fire helper — fail-open, never blocking the purchase. PII is stored ONLY as SHA-256 hex (hashed_email/hashed_phone); no raw PII column exists (SC-9). provider_response NEVER stores a token.';

COMMENT ON COLUMN public.ad_conversions.event_id IS
  'The single dedup key. Deterministic per real-world conversion (Mingla order/reservation id) so both the browser pixel and the server CAPI send the SAME id and platforms dedupe them (Meta eventID==event_id AND event==event_name exact pair, 48h — A2-5). The UNIQUE constraint is the idempotency guard: a re-delivered webhook writes no second row (RT-2 / SC-3).';

-- ════════════════════════════════════════════════════════════════════════
-- 2. Indexes — dedup key (event_id) is UNIQUE (auto-indexed); the rest are
--    the rollup / lookup keys (A3 §rollup; SPEC §5.1).
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ad_attribution_touches_connection     ON public.ad_attribution_touches (connection_id);
CREATE INDEX IF NOT EXISTS idx_ad_attribution_touches_campaign       ON public.ad_attribution_touches (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_attribution_touches_external_click ON public.ad_attribution_touches (external_click_id);
CREATE INDEX IF NOT EXISTS idx_ad_attribution_touches_created_at     ON public.ad_attribution_touches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_conversions_touch      ON public.ad_conversions (touch_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversions_click      ON public.ad_conversions (click_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversions_order      ON public.ad_conversions (order_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversions_connection ON public.ad_conversions (connection_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversions_campaign   ON public.ad_conversions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversions_brand      ON public.ad_conversions (brand_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversions_created_at ON public.ad_conversions (created_at DESC);

-- ════════════════════════════════════════════════════════════════════════
-- 3. updated_at trigger (house pattern) — reuse the ad-engine trigger fn
--    public.tg_ad_engine_set_updated_at() shipped by 20261230000000.
-- ════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_ad_conversions_updated_at ON public.ad_conversions;
CREATE TRIGGER trg_ad_conversions_updated_at
  BEFORE UPDATE ON public.ad_conversions
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS — admin SELECT only; writes are service-role only (no policy).
--    Matches the ad-engine foundation (20261230000000 §4) verbatim.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ad_attribution_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_conversions         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_attribution_touches admin can read" ON public.ad_attribution_touches;
CREATE POLICY "ad_attribution_touches admin can read"
  ON public.ad_attribution_touches
  FOR SELECT
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "ad_conversions admin can read" ON public.ad_conversions;
CREATE POLICY "ad_conversions admin can read"
  ON public.ad_conversions
  FOR SELECT
  USING (public.is_admin_user());

-- No INSERT/UPDATE/DELETE policies: authenticated cannot write; service_role
-- (the attribution-capture edge fn) bypasses RLS. Matches ad_connections /
-- payment_webhook_events. The WP-E brand-scoped proof-feed SELECT policy is
-- added later (needs ad_conversions.brand_id populated by the fire helper).

GRANT SELECT ON public.ad_attribution_touches TO authenticated;
GRANT SELECT ON public.ad_conversions         TO authenticated;

GRANT ALL ON public.ad_attribution_touches TO service_role;
GRANT ALL ON public.ad_conversions         TO service_role;
