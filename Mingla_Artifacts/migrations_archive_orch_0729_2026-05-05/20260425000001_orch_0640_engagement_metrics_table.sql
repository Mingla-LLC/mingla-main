-- ORCH-0640 ch01 — engagement_metrics table (DEC-039, DEC-047, DEC-052)
-- Dual-key schema:
--   single-card events: place_pool_id set, container_key NULL
--   curated-container events: place_pool_id NULL, container_key set
--   curated-stop events: both set + stop_index
-- 4-way fan-out per DEC-047 is handled by record_engagement RPC (migration 20260425000006)

BEGIN;

CREATE TABLE public.engagement_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_kind       TEXT NOT NULL CHECK (event_kind IN (
                     'served',       -- card delivered to deck
                     'seen_deck',    -- card appeared on deck viewport (impression)
                     'seen_expand',  -- card expanded by user (distinct from deck-render)
                     'saved',        -- user saved the card
                     'scheduled',    -- user scheduled the card
                     'reviewed'      -- user reviewed the place post-visit
                   )),
  place_pool_id    UUID REFERENCES public.place_pool(id) ON DELETE CASCADE,
                   -- NULL for curated-container events; SET for singles + curated-stop events
  container_key    TEXT,
                   -- NULL for single-card events
                   -- SET for curated events (container and stops share the same key)
                   -- Formula (locked by ORCH-0634 + DEC-052):
                   --   sha256(experience_type + ':' + sorted_stop_place_pool_ids.join(','))
  experience_type  TEXT,
                   -- NULL for singles; SET for curated ('romantic', 'adventurous', ...)
  category         TEXT,
                   -- The chip the card was served under ('brunch', 'drinks', ...)
  stop_index       INT,
                   -- NULL for single-card events and curated-container events
                   -- SET (0-indexed) for curated-stop events
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT engagement_metrics_identity_ck CHECK (
    container_key IS NOT NULL OR place_pool_id IS NOT NULL
  )
);

-- Lookup by place (engagement ranking per place)
CREATE INDEX idx_engagement_metrics_place_kind
  ON public.engagement_metrics (place_pool_id, event_kind) WHERE place_pool_id IS NOT NULL;

-- Lookup by curated experience identity (composition-level aggregation)
CREATE INDEX idx_engagement_metrics_container_kind
  ON public.engagement_metrics (container_key, event_kind) WHERE container_key IS NOT NULL;

-- User history lookup
CREATE INDEX idx_engagement_metrics_user_created
  ON public.engagement_metrics (user_id, created_at DESC);

-- Experience-type aggregation (curated only)
CREATE INDEX idx_engagement_metrics_experience
  ON public.engagement_metrics (experience_type, event_kind, created_at DESC)
  WHERE experience_type IS NOT NULL;

-- Category-scoped engagement
CREATE INDEX idx_engagement_metrics_category
  ON public.engagement_metrics (category, event_kind, created_at DESC);

ALTER TABLE public.engagement_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_engagement_metrics" ON public.engagement_metrics
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "admin_read_engagement_metrics" ON public.engagement_metrics
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active')
  );

CREATE POLICY "user_read_own_engagement" ON public.engagement_metrics
  FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE public.engagement_metrics IS
  'ORCH-0640 (DEC-039, DEC-047, DEC-052): place-level engagement tracking with dual-key schema.
   Single-card events set place_pool_id only. Curated-stop events set both place_pool_id
   and container_key (+ stop_index). Curated-container events set container_key only.
   Every curated interaction fans out to 4 rows: 1 container + 3 stops via record_engagement RPC.';

COMMIT;
