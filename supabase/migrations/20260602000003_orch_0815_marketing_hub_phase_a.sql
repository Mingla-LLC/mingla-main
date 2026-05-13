-- ORCH-0815-A1 — Marketing Hub Phase A schema foundation.
--
-- Creates 6 marketing tables (audiences, templates, campaigns, messages,
-- clicks, unsubscribes), supporting indexes, RLS policies, and seeds the
-- 5 Mingla starter-pack templates. Discriminated-union JSONB shapes
-- (query_definition, channel_payload) are enforced via CHECK constraints
-- so SMS (Phase B) and RCS (Phase C) plug in as additive kind values
-- without modifying existing shapes (per I-PROPOSED-BP + I-PROPOSED-BQ).
--
-- Status discriminator on marketing_messages includes `preview_skipped`
-- to honor the MARKETING_SEND_LIVE_ENABLED env-flag gate (rows are
-- written and tracked, but never sent to Resend until operator flips
-- the flag post-ORCH-0777-CLOSE).
--
-- RLS — per SPEC §6.5 hard guard "no SECURITY DEFINER helpers for SELECT"
-- (feedback_rls_returning_owner_gap.md), all policies use a local non-SD
-- STABLE helper `public.mkt_brand_min_rank(uuid, text)` that runs in the
-- caller's auth context with direct subqueries against brands +
-- brand_team_members. The existing `biz_brand_effective_rank_for_caller`
-- helper is SECURITY DEFINER and is intentionally NOT referenced here.
--
-- Migration is idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT
-- guards on the starter-pack seed. Apply-time DO $$ probes RAISE
-- EXCEPTION if any expected table / index / policy / seed row is
-- missing post-apply, so a partial apply fails fast.
--
-- Cross-refs:
--   SPEC      Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md  §6
--   DESIGN    Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md
--   DECISION  Mingla_Artifacts/DECISION_LOG.md DEC-149 (dual-surface placement)
--   PROTOCOL  Mingla_Artifacts/MASTER_BUG_LIST.md ORCH-0815 entry

BEGIN;

-- =========================================================================
-- 0. Local non-SECURITY-DEFINER helper for RLS
-- =========================================================================
-- Returns true iff caller is brand account_owner OR an active team member
-- whose role rank >= p_min_rank. Evaluated in caller's auth context
-- (NOT SECURITY DEFINER) so it cannot leak rows across RETURNING /
-- WITH CHECK boundaries per the RLS-RETURNING-OWNER-GAP pattern.
CREATE OR REPLACE FUNCTION public.mkt_brand_min_rank(
  p_brand_id uuid,
  p_min_rank text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.account_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id
      AND m.user_id = auth.uid()
      AND m.removed_at IS NULL
      AND public.biz_role_rank(m.role) >= public.biz_role_rank(p_min_rank)
  );
$$;

REVOKE ALL ON FUNCTION public.mkt_brand_min_rank(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_brand_min_rank(uuid, text) TO authenticated;

-- =========================================================================
-- 1. marketing_audiences — reusable saved queries
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.marketing_audiences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id            uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  name                text NOT NULL,
  query_definition    jsonb NOT NULL,
  is_system_generated boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- I-PROPOSED-BP: query_definition is a discriminated union with a
  -- required `kind` field. Phase A kinds: brand_buyers, event_buyers.
  -- Future kinds (brand_followers, custom_segment) extend additively.
  CONSTRAINT marketing_audiences_query_kind_valid CHECK (
    jsonb_typeof(query_definition) = 'object'
    AND (query_definition->>'kind') IN ('brand_buyers', 'event_buyers', 'brand_followers', 'custom_segment')
  )
);

CREATE INDEX IF NOT EXISTS idx_audiences_account_brand
  ON public.marketing_audiences (account_id, brand_id);

ALTER TABLE public.marketing_audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_audiences_select ON public.marketing_audiences;
CREATE POLICY marketing_audiences_select ON public.marketing_audiences
  FOR SELECT TO authenticated
  USING (
    account_id = auth.uid()
    OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id, 'brand_member'))
  );

DROP POLICY IF EXISTS marketing_audiences_insert ON public.marketing_audiences;
CREATE POLICY marketing_audiences_insert ON public.marketing_audiences
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = auth.uid()
    AND (brand_id IS NULL OR public.mkt_brand_min_rank(brand_id, 'event_manager'))
  );

DROP POLICY IF EXISTS marketing_audiences_update ON public.marketing_audiences;
CREATE POLICY marketing_audiences_update ON public.marketing_audiences
  FOR UPDATE TO authenticated
  USING (
    account_id = auth.uid()
    OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id, 'event_manager'))
  )
  WITH CHECK (
    account_id = auth.uid()
    OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id, 'event_manager'))
  );

DROP POLICY IF EXISTS marketing_audiences_delete ON public.marketing_audiences;
CREATE POLICY marketing_audiences_delete ON public.marketing_audiences
  FOR DELETE TO authenticated
  USING (
    account_id = auth.uid()
    OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id, 'event_manager'))
  );

-- =========================================================================
-- 2. marketing_templates — reusable content (user + Mingla starter pack)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.marketing_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id         uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  name             text NOT NULL,
  channel          text NOT NULL CHECK (channel IN ('email', 'sms', 'rcs')),
  subject_template text,
  body_template    text NOT NULL,
  is_starter_pack  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Starter-pack rows have no account_id / brand_id (global seeds).
  -- User-created rows must have account_id.
  CONSTRAINT marketing_templates_authorship_valid CHECK (
    (is_starter_pack = true AND account_id IS NULL)
    OR (is_starter_pack = false AND account_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_templates_account_brand
  ON public.marketing_templates (account_id, brand_id)
  WHERE NOT is_starter_pack;

CREATE INDEX IF NOT EXISTS idx_templates_starter_pack
  ON public.marketing_templates (channel)
  WHERE is_starter_pack;

ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_templates_select ON public.marketing_templates;
CREATE POLICY marketing_templates_select ON public.marketing_templates
  FOR SELECT TO authenticated
  USING (
    is_starter_pack = true
    OR account_id = auth.uid()
    OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id, 'brand_member'))
  );

DROP POLICY IF EXISTS marketing_templates_insert ON public.marketing_templates;
CREATE POLICY marketing_templates_insert ON public.marketing_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    is_starter_pack = false
    AND account_id = auth.uid()
    AND (brand_id IS NULL OR public.mkt_brand_min_rank(brand_id, 'event_manager'))
  );

DROP POLICY IF EXISTS marketing_templates_update ON public.marketing_templates;
CREATE POLICY marketing_templates_update ON public.marketing_templates
  FOR UPDATE TO authenticated
  USING (is_starter_pack = false AND account_id = auth.uid())
  WITH CHECK (is_starter_pack = false AND account_id = auth.uid());

DROP POLICY IF EXISTS marketing_templates_delete ON public.marketing_templates;
CREATE POLICY marketing_templates_delete ON public.marketing_templates
  FOR DELETE TO authenticated
  USING (is_starter_pack = false AND account_id = auth.uid());

-- =========================================================================
-- 3. marketing_campaigns — campaign records
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  brand_id        uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  audience_id     uuid NOT NULL REFERENCES public.marketing_audiences(id) ON DELETE RESTRICT,
  template_id     uuid REFERENCES public.marketing_templates(id) ON DELETE SET NULL,
  name            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms', 'rcs')),
  channel_payload jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  recipient_count integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- I-PROPOSED-BQ: channel_payload is a discriminated union with a
  -- required `kind` field that matches the channel column.
  CONSTRAINT marketing_campaigns_payload_kind_valid CHECK (
    jsonb_typeof(channel_payload) = 'object'
    AND (channel_payload->>'kind') IN ('email', 'sms', 'rcs')
    AND (channel_payload->>'kind') = channel
  )
);

CREATE INDEX IF NOT EXISTS idx_campaigns_account_status
  ON public.marketing_campaigns (account_id, status);

CREATE INDEX IF NOT EXISTS idx_campaigns_brand_status
  ON public.marketing_campaigns (brand_id, status);

CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_for
  ON public.marketing_campaigns (scheduled_for)
  WHERE status = 'scheduled';

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_campaigns_select ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_select ON public.marketing_campaigns
  FOR SELECT TO authenticated
  USING (
    account_id = auth.uid()
    OR public.mkt_brand_min_rank(brand_id, 'brand_member')
  );

DROP POLICY IF EXISTS marketing_campaigns_insert ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_insert ON public.marketing_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = auth.uid()
    AND public.mkt_brand_min_rank(brand_id, 'event_manager')
  );

DROP POLICY IF EXISTS marketing_campaigns_update ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_update ON public.marketing_campaigns
  FOR UPDATE TO authenticated
  USING (
    account_id = auth.uid()
    OR public.mkt_brand_min_rank(brand_id, 'event_manager')
  )
  WITH CHECK (
    account_id = auth.uid()
    OR public.mkt_brand_min_rank(brand_id, 'event_manager')
  );

DROP POLICY IF EXISTS marketing_campaigns_delete ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_delete ON public.marketing_campaigns
  FOR DELETE TO authenticated
  USING (
    account_id = auth.uid()
    OR public.mkt_brand_min_rank(brand_id, 'event_manager')
  );

-- =========================================================================
-- 4. marketing_messages — per-recipient delivery log
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.marketing_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  recipient_email     text,
  recipient_phone     text,
  channel             text NOT NULL CHECK (channel IN ('email', 'sms', 'rcs')),
  provider_message_id text,
  -- preview_skipped: written when MARKETING_SEND_LIVE_ENABLED=false
  -- (Phase A default until ORCH-0777 closes and audiences contain real
  -- buyers). Allows campaign reports to render honest preview state.
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN (
                        'queued', 'sent', 'delivered', 'opened', 'clicked',
                        'bounced', 'failed', 'unsubscribed', 'preview_skipped'
                      )),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  last_clicked_at     timestamptz,
  click_count         integer NOT NULL DEFAULT 0,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_messages_recipient_present CHECK (
    recipient_email IS NOT NULL OR recipient_phone IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_messages_campaign_status
  ON public.marketing_messages (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_email
  ON public.marketing_messages (recipient_email)
  WHERE recipient_email IS NOT NULL;

ALTER TABLE public.marketing_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_messages_select ON public.marketing_messages;
CREATE POLICY marketing_messages_select ON public.marketing_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_campaigns c
      WHERE c.id = marketing_messages.campaign_id
        AND (c.account_id = auth.uid()
             OR public.mkt_brand_min_rank(c.brand_id, 'brand_member'))
    )
  );

-- INSERT / UPDATE / DELETE: service-role only (edge function path). No
-- caller-facing policies — marketing_messages is written exclusively by
-- the marketing-send edge function via the service-role client (Phase B).

-- =========================================================================
-- 5. marketing_clicks — click tracking
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.marketing_clicks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES public.marketing_messages(id) ON DELETE SET NULL,
  destination_url text NOT NULL,
  tracking_id     text NOT NULL UNIQUE,
  clicked_at      timestamptz,
  user_agent      text,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clicks_tracking_id
  ON public.marketing_clicks (tracking_id);

CREATE INDEX IF NOT EXISTS idx_clicks_campaign
  ON public.marketing_clicks (campaign_id, clicked_at)
  WHERE clicked_at IS NOT NULL;

ALTER TABLE public.marketing_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_clicks_select ON public.marketing_clicks;
CREATE POLICY marketing_clicks_select ON public.marketing_clicks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketing_campaigns c
      WHERE c.id = marketing_clicks.campaign_id
        AND (c.account_id = auth.uid()
             OR public.mkt_brand_min_rank(c.brand_id, 'brand_member'))
    )
  );

-- INSERT / UPDATE: service-role only (edge function path, Phase B).

-- =========================================================================
-- 6. marketing_unsubscribes — global suppression
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.marketing_unsubscribes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email   text,
  contact_phone   text,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms', 'rcs', 'all')),
  scope           text NOT NULL CHECK (scope IN ('account', 'brand', 'global')),
  brand_id        uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  account_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reason          text,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_unsubscribes_either_email_or_phone CHECK (
    (contact_email IS NOT NULL AND contact_phone IS NULL)
    OR (contact_email IS NULL AND contact_phone IS NOT NULL)
  ),
  -- Scope/foreign-key alignment.
  CONSTRAINT marketing_unsubscribes_scope_keys CHECK (
    (scope = 'global' AND brand_id IS NULL AND account_id IS NULL)
    OR (scope = 'brand' AND brand_id IS NOT NULL)
    OR (scope = 'account' AND account_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unsub_email_channel_scope
  ON public.marketing_unsubscribes (
    contact_email,
    channel,
    scope,
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE contact_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_unsub_phone_channel_scope
  ON public.marketing_unsubscribes (
    contact_phone,
    channel,
    scope,
    COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE contact_phone IS NOT NULL;

ALTER TABLE public.marketing_unsubscribes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_unsubscribes_select ON public.marketing_unsubscribes;
CREATE POLICY marketing_unsubscribes_select ON public.marketing_unsubscribes
  FOR SELECT TO authenticated
  USING (
    scope = 'global'
    OR (scope = 'account' AND account_id = auth.uid())
    OR (scope = 'brand'
        AND brand_id IS NOT NULL
        AND public.mkt_brand_min_rank(brand_id, 'brand_member'))
  );

-- INSERT: service-role only (marketing-unsubscribe edge function path, Phase B).
-- Recipients unsubscribe via signed-token redirect endpoint, not direct write.

-- =========================================================================
-- 7. Mingla starter-pack template seed (5 email templates)
-- =========================================================================
-- Idempotent via ON CONFLICT — re-running migration is a no-op (refreshes
-- copy if templates were edited in the seed source between revisions).
INSERT INTO public.marketing_templates
  (id, account_id, brand_id, name, channel, subject_template, body_template, is_starter_pack)
VALUES
  (
    '00000815-0001-0000-0000-000000000001'::uuid,
    NULL, NULL,
    'Last call — N spots left',
    'email',
    'Last {spots_left} tickets — see you {event_date_short}',
    'Hi {first_name},'
      || E'\n\n'
      || 'Just a heads up — only {spots_left} tickets left for {event_name} on {event_date}. '
      || 'See you there.'
      || E'\n\n'
      || '{{event:{event_id}}}'
      || E'\n\n'
      || '— {brand_name} via Mingla',
    true
  ),
  (
    '00000815-0001-0000-0000-000000000002'::uuid,
    NULL, NULL,
    'Pre-event reminder (24h)',
    'email',
    'Tomorrow at {event_time} — {event_name}',
    'Hi {first_name},'
      || E'\n\n'
      || 'Quick reminder — {event_name} is tomorrow at {event_time}. Doors at {doors_open}.'
      || E'\n\n'
      || 'Your ticket QR is in your inbox from when you purchased. Bring it (or screenshot) to the door.'
      || E'\n\n'
      || '{{event:{event_id}}}'
      || E'\n\n'
      || 'See you there.'
      || E'\n\n'
      || '— {brand_name} via Mingla',
    true
  ),
  (
    '00000815-0001-0000-0000-000000000003'::uuid,
    NULL, NULL,
    'Thank you for coming',
    'email',
    'Thanks for coming out — {event_name}',
    'Hi {first_name},'
      || E'\n\n'
      || 'Thanks for coming out to {event_name}. Hope you had a great time.'
      || E'\n\n'
      || 'We''ll let you know when the next one is in the works. '
      || 'Until then — share the night with a friend who would have loved it.'
      || E'\n\n'
      || '— {brand_name} via Mingla',
    true
  ),
  (
    '00000815-0001-0000-0000-000000000004'::uuid,
    NULL, NULL,
    'Similar upcoming event',
    'email',
    'You might also like — {next_event_name}',
    'Hi {first_name},'
      || E'\n\n'
      || 'You came out to {previous_event_name} and we thought you might be into this one too.'
      || E'\n\n'
      || '{{event:{event_id}}}'
      || E'\n\n'
      || 'Tickets are live now if you want in.'
      || E'\n\n'
      || '— {brand_name} via Mingla',
    true
  ),
  (
    '00000815-0001-0000-0000-000000000005'::uuid,
    NULL, NULL,
    'Re-engagement (haven''t bought in 60 days)',
    'email',
    'We''ve missed you — {next_event_name}',
    'Hi {first_name},'
      || E'\n\n'
      || 'It''s been a minute. We have something coming up that feels like your kind of night.'
      || E'\n\n'
      || '{{event:{event_id}}}'
      || E'\n\n'
      || 'Come back for this one.'
      || E'\n\n'
      || '— {brand_name} via Mingla',
    true
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  updated_at = now();

-- =========================================================================
-- 8. Apply-time verification probes (fail-fast on partial apply)
-- =========================================================================
DO $$
DECLARE
  v_count integer;
BEGIN
  -- mkt_brand_min_rank helper exists and is NOT SECURITY DEFINER
  SELECT count(*) INTO v_count FROM pg_proc
    WHERE proname = 'mkt_brand_min_rank'
      AND pronamespace = 'public'::regnamespace
      AND prosecdef = false;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ORCH-0815-A1 PROBE FAILED: mkt_brand_min_rank missing or is SECURITY DEFINER (found %)', v_count;
  END IF;

  -- 6 tables exist
  SELECT count(*) INTO v_count FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'marketing_audiences', 'marketing_templates', 'marketing_campaigns',
        'marketing_messages', 'marketing_clicks', 'marketing_unsubscribes'
      );
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'ORCH-0815-A1 PROBE FAILED: expected 6 marketing tables, found %', v_count;
  END IF;

  -- All 6 tables have RLS enabled
  SELECT count(*) INTO v_count FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'marketing_audiences', 'marketing_templates', 'marketing_campaigns',
        'marketing_messages', 'marketing_clicks', 'marketing_unsubscribes'
      )
      AND c.relrowsecurity = true;
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'ORCH-0815-A1 PROBE FAILED: expected RLS on 6 tables, enabled on %', v_count;
  END IF;

  -- Discriminator CHECK constraints exist (I-PROPOSED-BP + I-PROPOSED-BQ)
  SELECT count(*) INTO v_count FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND constraint_name IN (
        'marketing_audiences_query_kind_valid',
        'marketing_campaigns_payload_kind_valid'
      );
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'ORCH-0815-A1 PROBE FAILED: discriminator CHECK constraints missing (found %)', v_count;
  END IF;

  -- preview_skipped status value is allowed (live-broadcast gate)
  PERFORM 1 FROM pg_constraint
    WHERE conname = 'marketing_messages_status_check'
      AND pg_get_constraintdef(oid) LIKE '%preview_skipped%';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORCH-0815-A1 PROBE FAILED: marketing_messages.status CHECK missing preview_skipped';
  END IF;

  -- 5 starter-pack templates seeded
  SELECT count(*) INTO v_count FROM public.marketing_templates
    WHERE is_starter_pack = true AND channel = 'email';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'ORCH-0815-A1 PROBE FAILED: expected 5 starter-pack email templates, found %', v_count;
  END IF;

  -- Critical indexes exist
  SELECT count(*) INTO v_count FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_audiences_account_brand',
        'idx_templates_account_brand',
        'idx_templates_starter_pack',
        'idx_campaigns_account_status',
        'idx_campaigns_brand_status',
        'idx_campaigns_scheduled_for',
        'idx_messages_campaign_status',
        'idx_messages_recipient_email',
        'idx_clicks_tracking_id',
        'idx_clicks_campaign',
        'uq_unsub_email_channel_scope',
        'uq_unsub_phone_channel_scope'
      );
  IF v_count <> 12 THEN
    RAISE EXCEPTION 'ORCH-0815-A1 PROBE FAILED: expected 12 indexes, found %', v_count;
  END IF;

  RAISE NOTICE 'ORCH-0815-A1 migration applied: 6 tables / 12 indexes / 6 RLS / 5 starter-pack templates / mkt_brand_min_rank helper (non-SD)';
END$$;

COMMIT;
