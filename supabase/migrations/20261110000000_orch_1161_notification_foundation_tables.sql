-- META-ORCH-1161 Sub-A (thin slice) — notification foundation data model.
--
-- The 5 foundation tables per SPEC §5.1 + the reservation→notify outbox.
-- Additive only; nothing existing is altered. RLS on every table; service-role
-- writes the ledgers, users read their own.
--
-- Simultaneous-send model (DEC-185): the dispatcher fans out to EVERY channel in
-- a category's default_channels that passes can_send() — there is NO push-first/
-- SMS-fallback waterfall. reach_mode is retained on the table for forward use but
-- is NOT consulted by the thin-slice dispatcher.
--
-- Cross-refs:
--   SPEC:  Mingla_Artifacts/specs/SPEC_META-ORCH-1161_NOTIFICATION_MESSAGING_SYSTEM.md §5.1
--   Reuse: notifications (existing inbox, idempotency_key UNIQUE), venue_sms_opt_out
--          (venue-scope ledger — EXTENDED via inbound webhook, not replaced).

-- =============================================================
-- §1. notification_categories — the taxonomy the dispatcher reads as DATA.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.notification_categories (
  key text PRIMARY KEY,
  section text NOT NULL,
  is_transactional boolean NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('low','normal','high')),
  default_channels text[] NOT NULL,
  reach_mode text NOT NULL DEFAULT 'reach_once'
    CHECK (reach_mode IN ('reach_once','escalate_on_no_engagement')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_categories IS
  'META-ORCH-1161 §5.1 — notification taxonomy read as data by notify-dispatch v2. '
  'Only rows with urgency=high AND ''sms'' in default_channels can ever reach SMS (DC-3).';

-- =============================================================
-- §2. notification_channel_prefs — per-category × per-channel user toggle.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.notification_channel_prefs (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_key text NOT NULL REFERENCES public.notification_categories(key),
  channel text NOT NULL CHECK (channel IN ('inapp','push','email','sms')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_key, channel)
);

COMMENT ON TABLE public.notification_channel_prefs IS
  'META-ORCH-1161 §5.1 — per-(category,channel) toggle. ABSENT ROW = '
  'category.default_channels decides (transactional default-on; marketing default-off).';

-- =============================================================
-- §3. channel_suppressions — OVERRIDES prefs (a STOP beats any toggle).
-- =============================================================
CREATE TABLE IF NOT EXISTS public.channel_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for anon-by-contact
  contact text NULL,                 -- E.164 phone OR lowercased email
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  scope text NOT NULL CHECK (scope IN ('transactional','marketing','all')),
  reason text NOT NULL CHECK (reason IN
    ('stop_keyword','manual','bounce','complaint','unsubscribe','twilio_blacklist')),
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE CASCADE, -- NULL = global
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique idx so the same (target, channel, scope, brand) is recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS channel_suppressions_uniq_idx
  ON public.channel_suppressions (
    COALESCE(user_id::text, contact),
    channel,
    scope,
    COALESCE(brand_id::text, 'global')
  );

COMMENT ON TABLE public.channel_suppressions IS
  'META-ORCH-1161 §5.1 — suppression ledger. OVERRIDES preferences. A scope '
  '(transactional|marketing|all) STOP/bounce/complaint denies can_send() for that scope.';

-- =============================================================
-- §4. consent_records — append-only legal audit of WHO consented to WHAT.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  contact text NOT NULL,             -- E.164 phone OR lowercased email
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  scope text NOT NULL CHECK (scope IN ('transactional','marketing')),
  action text NOT NULL CHECK (action IN ('granted','revoked')),
  source text NOT NULL,              -- 'checkout'|'prefs_ui'|'stop_keyword'|'unsubscribe_link'|'reservation'
  disclosure_text text NULL,         -- EXACT copy shown at grant (legal burden of proof)
  ip_hash text NULL,
  country_code text NULL,            -- ISO-2 buyer country at grant
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consent_records_contact_idx
  ON public.consent_records (contact, channel, scope);

COMMENT ON TABLE public.consent_records IS
  'META-ORCH-1161 §5.1 — append-only consent audit trail. The legal record of WHO '
  'consented to WHAT, WHEN, with the EXACT disclosure shown.';

-- =============================================================
-- §5. notification_deliveries — the cross-channel delivery ledger.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('inapp','push','email','sms')),
  status text NOT NULL CHECK (status IN
    ('queued','sent','delivered','undelivered','failed','suppressed','skipped')),
  provider text NULL,                -- 'onesignal'|'resend'|'twilio'
  provider_message_id text NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz NULL,
  failed_reason text NULL,
  segments int NULL                  -- SMS segment count (cost observability)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_notification_idx
  ON public.notification_deliveries (notification_id);
-- The webhook reconciles status by provider_message_id (twilio-message-status §5.6).
CREATE INDEX IF NOT EXISTS notification_deliveries_provider_msg_idx
  ON public.notification_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMENT ON TABLE public.notification_deliveries IS
  'META-ORCH-1161 §5.1 — THE cross-channel delivery ledger. One row per channel '
  'attempt. Webhooks reconcile final status keyed by provider_message_id.';

-- =============================================================
-- §6. notification_outbox — reservation→notify durable queue (drained by cron).
-- =============================================================
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL REFERENCES public.notification_categories(key),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  contact text NULL,                 -- E.164 phone OR lowercased email (anon/guest path)
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  country_code text NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);

-- One outbox row per idempotency_key (a repeated trigger fire is a no-op insert).
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_idempotency_idx
  ON public.notification_outbox (idempotency_key);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON public.notification_outbox (status, created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.notification_outbox IS
  'META-ORCH-1161 §5.4/§7.2 — durable reservation→notify queue. An AFTER UPDATE '
  'trigger on reservations writes a row; a 1-min cron drains it to notify-dispatch v2.';

-- =============================================================
-- §7. RLS — every table. Service-role bypasses RLS for writes; users read own.
-- =============================================================
ALTER TABLE public.notification_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_channel_prefs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_suppressions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox         ENABLE ROW LEVEL SECURITY;

-- Categories are public read (the taxonomy is not secret; the prefs UI reads it).
DROP POLICY IF EXISTS notification_categories_read ON public.notification_categories;
CREATE POLICY notification_categories_read
  ON public.notification_categories FOR SELECT
  TO authenticated, anon
  USING (true);

-- A user owns their own channel prefs (read + write).
DROP POLICY IF EXISTS notification_channel_prefs_owner ON public.notification_channel_prefs;
CREATE POLICY notification_channel_prefs_owner
  ON public.notification_channel_prefs FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- A user reads their own suppressions (writes are service-role only — no policy
-- for authenticated INSERT/UPDATE → RLS denies; service-role bypasses RLS).
DROP POLICY IF EXISTS channel_suppressions_read_own ON public.channel_suppressions;
CREATE POLICY channel_suppressions_read_own
  ON public.channel_suppressions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- A user reads their own consent records (append-only; service-role writes).
DROP POLICY IF EXISTS consent_records_read_own ON public.consent_records;
CREATE POLICY consent_records_read_own
  ON public.consent_records FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- A user reads delivery rows for their own notifications (service-role writes).
DROP POLICY IF EXISTS notification_deliveries_read_own ON public.notification_deliveries;
CREATE POLICY notification_deliveries_read_own
  ON public.notification_deliveries FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.id = notification_deliveries.notification_id
       AND n.user_id = auth.uid()
  ));

-- The outbox is service-role only — NO policy for authenticated/anon → RLS denies
-- all non-service access. The trigger writes it as the table owner; the cron
-- drains it via service-role. Intentionally no read/write policy.
