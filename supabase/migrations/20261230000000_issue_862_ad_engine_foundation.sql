-- ISSUE-862 [Full Rooms Ad Engine — WP1 foundation] — unified 5-channel schema.
--
-- SPEC: Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md
--   Amendment A3 §A (generalized schema) as corrected by Amendment A4
--   (budget columns widened to bigint — GR-01; ads.review_detail — GR-18).
--
-- Five tables, platform-agnostic, lane-aware:
--   ad_connections   — one row per (platform, lane); env-var NAMES only, never tokens
--   ad_campaigns     — one row per fully-created campaign (no orphans — §4.4b)
--   ad_sets          — Meta ad set / TikTok ad group / Snap ad squad / Google ad
--                      group / Reddit ad group
--   ads              — one row per ad (review_status + review_detail per GR-18)
--   ad_status_events — append-only audit (create/launch/pause/sync/create_failed/rollback)
--
-- Budgets are MINOR UNITS (cents) at rest, `bigint` (A4.a / GR-01 — the 10,000x
-- money bug guard); each adapter converts at its API boundary exactly once
-- (Meta identity · TikTok /100 dollars · Snap/Google/Reddit x10,000 micro).
--
-- NO SEED ROWS on purpose: platform account IDs live in env/config (Supabase
-- Edge Function secrets + admin-ad-connect reads them from Deno.env), never as
-- literals in this public repo (dispatch hygiene guard; deviates from A3 §D's
-- "seed all five" — the connect function creates each (platform, lane) row at
-- connect time instead; documented in the WP1 implementation report).
--
-- RLS: admin-only SELECT via public.is_admin_user() for authenticated; NO
-- INSERT/UPDATE/DELETE policy (service-role — the admin-gated admin-ad-* edge
-- functions — writes only; matches payment_webhook_events). A3 §A RLS section.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ad_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform               text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','reddit')),
  lane                   text NOT NULL CHECK (lane IN ('consumer','business')),
  display_name           text NOT NULL,
  external_account_id    text NOT NULL,
  external_org_id        text NULL,
  auth_kind              text NOT NULL CHECK (auth_kind IN ('system_user_token','refresh_token','dev_token_oauth')),
  token_env_var          text NOT NULL,
  extra                  jsonb NOT NULL DEFAULT '{}',
  status                 text NOT NULL DEFAULT 'unknown' CHECK (status IN ('connected','invalid','unknown')),
  -- operational status columns retained from the A2/§4.2 shape (A3 §A note):
  currency               text NULL,
  timezone               text NULL,
  min_daily_budget_cents integer NULL,
  account_status         text NULL,
  token_last_verified_at timestamptz NULL,
  connected              boolean NOT NULL DEFAULT false,
  connected_by           uuid NULL REFERENCES auth.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, lane)
);

COMMENT ON TABLE public.ad_connections IS
  'Ad-platform credentials live ONLY in Supabase Edge Function Secrets (Deno.env, resolved via token_env_var / the *_env_var NAMES in extra). This table stores env-var NAMES, never a token value. Refresh-token platforms (snapchat/reddit) mint a short-lived access token in edge memory per call; it is never persisted. extra also carries per-platform miscellany: page_id, pixel/dataset id, capi_env_var, has_payment_method, and the four per-category Meta minimum_budgets fetched at connect (A4.g — never hardcoded).';

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id        uuid NOT NULL REFERENCES public.ad_connections(id) ON DELETE RESTRICT,
  platform             text NOT NULL,   -- denormalized (= connection.platform) for query/index
  external_campaign_id text NOT NULL,
  name                 text NOT NULL,
  objective            text NOT NULL,   -- normalized-per-platform ('OUTCOME_TRAFFIC' Meta / 'TRAFFIC' TikTok+Snap / channel type Google / CLICKS Reddit)
  status               text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED')),
  daily_budget_cents   bigint NULL CHECK (daily_budget_cents IS NULL OR daily_budget_cents > 0),  -- minor units (A4.a bigint); NULL when budget lives on the ad set (ABO)
  -- retained from the meta_*/sibling shape (A3 §A note):
  delivery_status      text NULL,       -- Meta effective_status / TikTok secondary / Snap review rollup / Google approval
  status_synced_at     timestamptz NULL,
  targeting            jsonb NOT NULL DEFAULT '{}',
  -- destination public-page reference (the point of Full Rooms):
  dest_page_type       text NOT NULL CHECK (dest_page_type IN ('event','trip','brand','venue')),
  dest_brand_slug      text NOT NULL,
  dest_entity_slug     text NULL,
  dest_event_id        uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  dest_url             text NOT NULL,   -- canonical public web page — the AD-VISIBLE destination on ALL channels (A4.f destination policy v1)
  dest_smart_link      text NOT NULL,   -- AppsFlyer OneLink [A1]; DEMOTED by A4.f: tracking-template/future slot, NEVER the creative link
  -- idempotency (#863 reconciliation, A3 §A note):
  request_id           text NULL,
  created_by           uuid NULL REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_campaign_id),
  UNIQUE (connection_id, request_id)
);

COMMENT ON COLUMN public.ad_campaigns.dest_smart_link IS
  'A1 OneLink retained but DEMOTED by A4.f (PROOF D-P1: AppsFlyer serves crawlers an app-install interstitial — cloaking pattern). Never sent as the creative link/landing/final URL; reserved for the Google tracking_url_template / future re-enable.';

CREATE TABLE IF NOT EXISTS public.ad_sets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  external_adset_id  text NOT NULL,
  name               text NOT NULL,
  targeting          jsonb NOT NULL DEFAULT '{}',   -- normalized {countries, age_min, age_max, genders, cities, ...} + per-platform `passthrough` (A4.a / GR-31)
  budget_cents       bigint NULL CHECK (budget_cents IS NULL OR budget_cents > 0),  -- minor units (A4.a bigint); NULL under CBO (budget on campaign)
  optimization_goal  text NOT NULL,
  status             text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED')),
  -- retained where a platform exposes them (A3 §A note):
  billing_event      text NULL,
  bid_strategy       text NULL,
  placement          jsonb NULL,
  schedule_start_at  timestamptz NULL,
  schedule_end_at    timestamptz NULL,
  external_status    text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, external_adset_id)
);

CREATE TABLE IF NOT EXISTS public.ads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_set_id            uuid NOT NULL REFERENCES public.ad_sets(id) ON DELETE CASCADE,
  external_ad_id       text NOT NULL,
  -- #866 creative-library FK: the ad_creatives table ships in #866 (WP3); the
  -- column exists now so WP1 rows can be linked retroactively. #866's migration
  -- adds: ALTER TABLE public.ads ADD CONSTRAINT ads_creative_id_fkey
  --   FOREIGN KEY (creative_id) REFERENCES public.ad_creatives(id) ON DELETE SET NULL;
  creative_id          uuid NULL,
  -- the platform-created creative object id (Meta AdCreative id etc.) — needed
  -- to persist all four Meta IDs (AC-2) in the generalized schema:
  external_creative_id text NULL,
  name                 text NOT NULL,
  status               text NOT NULL DEFAULT 'PAUSED' CHECK (status IN ('PAUSED','ACTIVE','ARCHIVED','DELETED')),
  review_status        text NULL,      -- Meta ad review / TikTok audit / Snap PENDING|APPROVED|REJECTED / Google approval_status / Reddit ad.effective_status (R-3)
  review_detail        jsonb NULL,     -- GR-18: {issues_info[], ad_review_feedback_global, ad_review_feedback_placement_specific}
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_set_id, external_ad_id)
);

COMMENT ON COLUMN public.ads.review_detail IS
  'GR-18 rejection detail: Meta issues_info[] + ad_review_feedback.global/.placement_specific (read order: effective_status -> DISAPPROVED => ad_review_feedback.global; WITH_ISSUES => issues_info). NEVER store Meta `recommendations` here — they are optimization tips, not rejection reasons (PIPELINE_BLUEPRINT §9b).';

CREATE TABLE IF NOT EXISTS public.ad_status_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,  -- NULL if create failed before a row existed
  platform          text NULL,
  entity            text NULL CHECK (entity IS NULL OR entity IN ('campaign','ad_set','ad')),
  action            text NOT NULL CHECK (action IN ('create','launch','pause','sync','create_failed','rollback')),
  actor             uuid NULL REFERENCES auth.users(id),
  from_status       text NULL,
  to_status         text NULL,
  external_ids      jsonb NULL,        -- partial IDs captured on failure for manual reconciliation
  provider_response jsonb NULL,        -- normalized provider response (NEVER contains a token)
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════
-- 2. Indexes (A3 §A)
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_connection_id   ON public.ad_campaigns (connection_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_platform_status ON public.ad_campaigns (platform, status);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_dest_event_id   ON public.ad_campaigns (dest_event_id);
CREATE INDEX IF NOT EXISTS idx_ad_sets_campaign_id          ON public.ad_sets (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ads_ad_set_id                ON public.ads (ad_set_id);
CREATE INDEX IF NOT EXISTS idx_ad_status_events_campaign    ON public.ad_status_events (campaign_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════
-- 3. updated_at triggers (house pattern)
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_ad_engine_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ad_connections_updated_at ON public.ad_connections;
CREATE TRIGGER trg_ad_connections_updated_at
  BEFORE UPDATE ON public.ad_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

DROP TRIGGER IF EXISTS trg_ad_campaigns_updated_at ON public.ad_campaigns;
CREATE TRIGGER trg_ad_campaigns_updated_at
  BEFORE UPDATE ON public.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

DROP TRIGGER IF EXISTS trg_ad_sets_updated_at ON public.ad_sets;
CREATE TRIGGER trg_ad_sets_updated_at
  BEFORE UPDATE ON public.ad_sets
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

DROP TRIGGER IF EXISTS trg_ads_updated_at ON public.ads;
CREATE TRIGGER trg_ads_updated_at
  BEFORE UPDATE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS — admin SELECT only; writes are service-role only (no policy)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ad_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_campaigns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_sets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_connections admin can read" ON public.ad_connections;
CREATE POLICY "ad_connections admin can read"
  ON public.ad_connections
  FOR SELECT
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "ad_campaigns admin can read" ON public.ad_campaigns;
CREATE POLICY "ad_campaigns admin can read"
  ON public.ad_campaigns
  FOR SELECT
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "ad_sets admin can read" ON public.ad_sets;
CREATE POLICY "ad_sets admin can read"
  ON public.ad_sets
  FOR SELECT
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "ads admin can read" ON public.ads;
CREATE POLICY "ads admin can read"
  ON public.ads
  FOR SELECT
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "ad_status_events admin can read" ON public.ad_status_events;
CREATE POLICY "ad_status_events admin can read"
  ON public.ad_status_events
  FOR SELECT
  USING (public.is_admin_user());

-- No INSERT/UPDATE/DELETE policies: authenticated cannot write; service_role
-- (the admin-gated admin-ad-* edge functions) bypasses RLS. Matches
-- payment_webhook_events (RLS-enabled, service-role-only writes).

GRANT SELECT ON public.ad_connections   TO authenticated;
GRANT SELECT ON public.ad_campaigns     TO authenticated;
GRANT SELECT ON public.ad_sets          TO authenticated;
GRANT SELECT ON public.ads              TO authenticated;
GRANT SELECT ON public.ad_status_events TO authenticated;

GRANT ALL ON public.ad_connections   TO service_role;
GRANT ALL ON public.ad_campaigns     TO service_role;
GRANT ALL ON public.ad_sets          TO service_role;
GRANT ALL ON public.ads              TO service_role;
GRANT ALL ON public.ad_status_events TO service_role;
