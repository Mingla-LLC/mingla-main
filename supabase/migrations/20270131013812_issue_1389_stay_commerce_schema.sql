-- Issue #1389: dark Stay commerce, refund-allocation, and shared-rail schema.
-- Provider writes remain disabled until the server-owned Stay flags and #1221
-- runtime evidence are explicitly enabled after production verification.

BEGIN;

INSERT INTO public.feature_flags (flag_key, is_enabled, description)
VALUES
  ('STAY_VENUE_AUTHORING', false, 'Stay venue and Rooms & Places authoring'),
  ('STAY_PUBLIC_PAGES', false, 'Public Stay pages'),
  ('STAY_RESERVE_READS', false, 'Stay availability and quote reads'),
  ('STAY_RESERVE_WRITES', false, 'Stay reservation payment and cancellation writes'),
  ('STAY_STRIPE_COMMERCE', false, 'Stripe Stay commerce rail'),
  ('STAY_PAYSTACK_COMMERCE', false, 'Paystack Stay commerce rail'),
  ('STAY_NOTIFICATIONS', false, 'Stay transactional notification fanout')
ON CONFLICT (flag_key) DO UPDATE SET
  description = EXCLUDED.description;

INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES
  ('stay_request_received', 'Stay reservations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_request_action_needed', 'Stay reservations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_payment_required', 'Stay reservations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_request_declined', 'Stay reservations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_reservation_confirmed', 'Stay reservations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_reservation_cancelled', 'Stay reservations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_refund_state', 'Stay reservations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_reconciliation_attention', 'Stay operations', true, 'high',
    ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('stay_reservation_reminder', 'Stay reminders', true, 'high',
    ARRAY['inapp','push','email','sms'], 'escalate_on_no_engagement')
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

CREATE TABLE public.stay_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  attempt_ordinal integer NOT NULL CHECK (attempt_ordinal BETWEEN 1 AND 100),
  connected_account_ref text,
  amount_minor bigint NOT NULL CHECK (
    amount_minor > 0 AND amount_minor <= 2147483647
  ),
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  application_fee_minor bigint NOT NULL DEFAULT 0 CHECK (
    application_fee_minor >= 0
    AND application_fee_minor <= amount_minor
  ),
  provider_fee_minor bigint CHECK (provider_fee_minor >= 0),
  state text NOT NULL DEFAULT 'created' CHECK (state IN (
    'created', 'pending', 'succeeded', 'failed', 'ambiguous',
    'expired', 'refund_due'
  )),
  provider_payment_ref text,
  provider_charge_ref text,
  provider_event_ref text,
  idempotency_key text NOT NULL CHECK (
    char_length(pg_catalog.btrim(idempotency_key)) BETWEEN 8 AND 200
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  readiness_revision bigint NOT NULL DEFAULT 1 CHECK (readiness_revision > 0),
  failure_code text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  UNIQUE (group_id, attempt_ordinal),
  UNIQUE (group_id, idempotency_key),
  UNIQUE NULLS NOT DISTINCT (provider, provider_payment_ref),
  CONSTRAINT stay_payment_attempt_terminal_shape CHECK (
    (state = 'succeeded' AND succeeded_at IS NOT NULL)
    OR (state <> 'succeeded' AND succeeded_at IS NULL)
  )
);

CREATE INDEX stay_payment_attempts_group_state_idx
  ON public.stay_payment_attempts (group_id, state, created_at DESC);
CREATE INDEX stay_payment_attempts_provider_ref_idx
  ON public.stay_payment_attempts (provider, provider_payment_ref)
  WHERE provider_payment_ref IS NOT NULL;

CREATE TABLE public.stay_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL
    REFERENCES public.stay_payment_attempts(id) ON DELETE RESTRICT,
  reservation_line_id uuid NOT NULL
    REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  component text NOT NULL CHECK (component IN ('base', 'fee', 'tax')),
  component_ref text NOT NULL,
  charged_minor bigint NOT NULL CHECK (charged_minor >= 0),
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (
    refunded_minor >= 0 AND refunded_minor <= charged_minor
  ),
  payout_released_minor bigint NOT NULL DEFAULT 0 CHECK (
    payout_released_minor >= 0 AND payout_released_minor <= charged_minor
  ),
  refund_treatment text NOT NULL CHECK (
    refund_treatment IN ('refundable', 'nonrefundable', 'same_as_line')
  ),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_attempt_id, reservation_line_id, component, component_ref)
);

CREATE INDEX stay_payment_allocations_line_idx
  ON public.stay_payment_allocations (reservation_line_id, payment_attempt_id);

CREATE TABLE public.stay_money_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  line_id uuid REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  payment_attempt_id uuid
    REFERENCES public.stay_payment_attempts(id) ON DELETE RESTRICT,
  refund_id uuid,
  payout_release_id uuid
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN (
    'charge_pending', 'charge_succeeded', 'charge_failed',
    'charge_ambiguous', 'refund_requested', 'refund_succeeded',
    'refund_failed', 'chargeback', 'payout_eligible',
    'payout_released', 'payout_reversed', 'payout_reversal_owed'
  )),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  provider_reference text,
  idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(pg_catalog.btrim(idempotency_key)) BETWEEN 8 AND 240
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND NOT (metadata ?| ARRAY[
        'authorization', 'client_secret', 'provider_secret', 'raw_body',
        'email', 'phone', 'guest_token', 'status_token'
      ])
    )
);

CREATE INDEX stay_money_ledger_group_idx
  ON public.stay_money_ledger (group_id, occurred_at, id);
CREATE INDEX stay_money_ledger_line_idx
  ON public.stay_money_ledger (line_id, occurred_at, id)
  WHERE line_id IS NOT NULL;

CREATE TABLE public.stay_cancel_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('guest', 'staff', 'admin')),
  selected_line_ids uuid[] NOT NULL CHECK (
    cardinality(selected_line_ids) BETWEEN 1 AND 50
  ),
  group_version bigint NOT NULL CHECK (group_version > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  allocation_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(allocation_snapshot) = 'array'
  ),
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX stay_cancel_previews_group_idx
  ON public.stay_cancel_previews (group_id, expires_at DESC);

CREATE TABLE public.stay_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  payment_attempt_id uuid NOT NULL
    REFERENCES public.stay_payment_attempts(id) ON DELETE RESTRICT,
  cancel_preview_id uuid NOT NULL UNIQUE
    REFERENCES public.stay_cancel_previews(id) ON DELETE RESTRICT,
  requested_by_type text NOT NULL CHECK (
    requested_by_type IN ('guest', 'staff', 'admin', 'system')
  ),
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (
    char_length(pg_catalog.btrim(reason)) BETWEEN 3 AND 500
  ),
  state text NOT NULL CHECK (state IN (
    'previewed', 'submitted', 'processing', 'succeeded', 'failed',
    'manual_reconciliation'
  )),
  amount_minor bigint NOT NULL CHECK (
    amount_minor >= 0 AND amount_minor <= 2147483647
  ),
  application_fee_reversal_minor bigint NOT NULL DEFAULT 0 CHECK (
    application_fee_reversal_minor >= 0
    AND application_fee_reversal_minor <= amount_minor
  ),
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  provider_ref text,
  source_refund_id uuid UNIQUE
    REFERENCES public.source_refunds(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(pg_catalog.btrim(idempotency_key)) BETWEEN 8 AND 240
  ),
  failure_code text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.stay_money_ledger
  ADD CONSTRAINT stay_money_ledger_refund_fkey
  FOREIGN KEY (refund_id) REFERENCES public.stay_refunds(id) ON DELETE RESTRICT;

CREATE INDEX stay_refunds_group_state_idx
  ON public.stay_refunds (group_id, state, created_at DESC);

CREATE TABLE public.stay_refund_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL
    REFERENCES public.stay_refunds(id) ON DELETE RESTRICT,
  payment_allocation_id uuid NOT NULL
    REFERENCES public.stay_payment_allocations(id) ON DELETE RESTRICT,
  reservation_line_id uuid NOT NULL
    REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  organizer_liability_minor bigint NOT NULL CHECK (
    organizer_liability_minor >= 0
    AND organizer_liability_minor <= amount_minor
  ),
  platform_fee_reversal_minor bigint NOT NULL CHECK (
    platform_fee_reversal_minor >= 0
    AND organizer_liability_minor + platform_fee_reversal_minor = amount_minor
  ),
  state text NOT NULL CHECK (
    state IN ('submitted', 'processing', 'succeeded', 'failed')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_id, payment_allocation_id)
);

CREATE INDEX stay_refund_allocations_line_idx
  ON public.stay_refund_allocations (reservation_line_id, refund_id);

CREATE TABLE public.stay_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  provider_event_id text NOT NULL,
  provider_event_type text NOT NULL,
  payment_attempt_id uuid
    REFERENCES public.stay_payment_attempts(id) ON DELETE RESTRICT,
  refund_id uuid REFERENCES public.stay_refunds(id) ON DELETE RESTRICT,
  event_fingerprint text NOT NULL CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
  safe_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(safe_payload) = 'object'
    AND NOT (safe_payload ?| ARRAY[
      'authorization', 'client_secret', 'provider_secret', 'raw_body',
      'email', 'phone', 'guest_token', 'status_token'
    ])
  ),
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

-- Register Stay as a typed consumer of the existing refund control plane.
DO $block$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.source_refunds'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.source_refunds DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$block$;

ALTER TABLE public.source_refunds
  DROP CONSTRAINT source_refunds_refund_kind_check,
  ADD CONSTRAINT source_refunds_source_type_check CHECK (
    source_type IN (
      'venue_reservation', 'rsvp_contribution', 'stay_reservation'
    )
  ),
  ADD CONSTRAINT source_refunds_refund_kind_check CHECK (
    refund_kind IN (
      'venue_eligible_cancel', 'rsvp_discretionary', 'event_cancel',
      'stay_cancellation'
    )
  ),
  ADD CONSTRAINT source_refunds_source_shape CHECK (
    (
      source_type = 'venue_reservation'
      AND venue_id IS NOT NULL
      AND event_id IS NULL
    )
    OR (
      source_type = 'rsvp_contribution'
      AND event_id IS NOT NULL
      AND venue_id IS NULL
      AND source_id = subject_id
    )
    OR (
      source_type = 'stay_reservation'
      AND venue_id IS NOT NULL
      AND event_id IS NULL
    )
  );

-- Register Stay lines in the shared event-anchored payout ledger.
DO $block$
DECLARE
  target regclass;
  constraint_row record;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.payout_source_fee_snapshots'::regclass,
    'public.brand_payout_releases'::regclass,
    'public.payout_release_items'::regclass
  ]
  LOOP
    FOR constraint_row IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = target
        AND contype = 'c'
        AND (
          pg_get_constraintdef(oid) ILIKE '%source_type%'
          OR pg_get_constraintdef(oid) ILIKE '%surface%'
        )
    LOOP
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT %I',
        target,
        constraint_row.conname
      );
    END LOOP;
  END LOOP;
END;
$block$;

ALTER TABLE public.payout_source_fee_snapshots
  ADD CONSTRAINT payout_source_fee_snapshots_source_type_check CHECK (
    source_type IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation'
    )
  );
ALTER TABLE public.brand_payout_releases
  ADD CONSTRAINT brand_payout_releases_surface_check CHECK (
    surface IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation'
    )
  );
ALTER TABLE public.payout_release_items
  ADD CONSTRAINT payout_release_items_source_type_check CHECK (
    source_type IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation'
    )
  );

CREATE OR REPLACE FUNCTION public.issue_1389_guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'stay_commerce_history_immutable' USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER stay_money_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.stay_money_ledger
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_guard_append_only();
CREATE TRIGGER stay_provider_events_append_only
  BEFORE UPDATE OR DELETE ON public.stay_provider_events
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_guard_append_only();

CREATE OR REPLACE FUNCTION public.issue_1389_guard_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.id <> OLD.id
     OR NEW.payment_attempt_id <> OLD.payment_attempt_id
     OR NEW.reservation_line_id <> OLD.reservation_line_id
     OR NEW.component <> OLD.component
     OR NEW.component_ref <> OLD.component_ref
     OR NEW.charged_minor <> OLD.charged_minor
     OR NEW.refund_treatment <> OLD.refund_treatment
     OR NEW.snapshot <> OLD.snapshot
     OR NEW.created_at <> OLD.created_at
     OR NEW.refunded_minor < OLD.refunded_minor
     OR NEW.payout_released_minor < OLD.payout_released_minor THEN
    RAISE EXCEPTION 'stay_payment_allocation_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_payment_allocations_guard
  BEFORE UPDATE OR DELETE ON public.stay_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_guard_payment_allocation();

CREATE OR REPLACE FUNCTION public.issue_1389_guard_refund_allocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     OR NEW.id <> OLD.id
     OR NEW.refund_id <> OLD.refund_id
     OR NEW.payment_allocation_id <> OLD.payment_allocation_id
     OR NEW.reservation_line_id <> OLD.reservation_line_id
     OR NEW.amount_minor <> OLD.amount_minor
     OR NEW.organizer_liability_minor <> OLD.organizer_liability_minor
     OR NEW.platform_fee_reversal_minor <> OLD.platform_fee_reversal_minor
     OR NEW.created_at <> OLD.created_at
     OR (
       OLD.state <> NEW.state
       AND NOT (
         OLD.state IN ('submitted', 'processing')
         AND NEW.state IN ('processing', 'succeeded', 'failed')
       )
     ) THEN
    RAISE EXCEPTION 'stay_refund_allocation_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_refund_allocations_guard
  BEFORE UPDATE OR DELETE ON public.stay_refund_allocations
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_guard_refund_allocation();

DO $block$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'stay_payment_attempts',
    'stay_payment_allocations',
    'stay_money_ledger',
    'stay_cancel_previews',
    'stay_refunds',
    'stay_refund_allocations',
    'stay_provider_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'REVOKE ALL ON public.%I FROM public, anon, authenticated',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',
      table_name
    );
  END LOOP;
END;
$block$;

COMMIT;

NOTIFY pgrst, 'reload schema';
