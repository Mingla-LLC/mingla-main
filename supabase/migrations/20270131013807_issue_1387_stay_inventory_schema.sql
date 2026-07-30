-- Issue #1387: canonical Stay inventory foundation.
--
-- A Stay is one venue category. "Hotel", "resort", "guest house", and
-- "short-stay apartment" are descriptive property kinds, never product
-- identifiers. Rooms and Places share one inventory model while retaining
-- their different overnight/scheduled availability semantics.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Canonical venue category.
-- ---------------------------------------------------------------------------
DO $block$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'venue_listings'
      AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%venue_category%'
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.venue_listings DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END;
$block$;

ALTER TABLE public.venue_listings
  ADD CONSTRAINT venue_listings_venue_category_check
  CHECK (
    venue_category IN (
      'restaurant',
      'play',
      'creative_and_arts',
      'stay'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Property settings and Room/Place inventory.
-- ---------------------------------------------------------------------------
CREATE TABLE public.stay_settings (
  venue_id uuid PRIMARY KEY
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  property_kind text CHECK (
    property_kind IS NULL OR property_kind IN (
      'hotel',
      'resort',
      'guest_house',
      'lodge',
      'serviced_apartment',
      'short_stay_apartment',
      'other'
    )
  ),
  timezone text NOT NULL DEFAULT 'UTC',
  default_booking_mode text NOT NULL DEFAULT 'request'
    CHECK (default_booking_mode IN ('request', 'instant')),
  check_in_time time NOT NULL DEFAULT '15:00',
  check_out_time time NOT NULL DEFAULT '11:00',
  instant_payment_hold_minutes smallint NOT NULL DEFAULT 15
    CHECK (instant_payment_hold_minutes BETWEEN 5 AND 30),
  request_response_hours smallint NOT NULL DEFAULT 24
    CHECK (request_response_hours BETWEEN 1 AND 72),
  approved_payment_minutes smallint NOT NULL DEFAULT 30
    CHECK (approved_payment_minutes BETWEEN 10 AND 1440),
  booking_horizon_days smallint NOT NULL DEFAULT 365
    CHECK (booking_horizon_days BETWEEN 1 AND 730),
  booking_state text NOT NULL DEFAULT 'draft'
    CHECK (booking_state IN ('draft', 'review', 'active', 'paused')),
  house_rules text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stay_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('room', 'place')),
  name text NOT NULL CHECK (char_length(pg_catalog.btrim(name)) BETWEEN 1 AND 120),
  summary text NOT NULL DEFAULT ''
    CHECK (char_length(summary) <= 300),
  description text NOT NULL DEFAULT ''
    CHECK (char_length(description) <= 5000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'live', 'paused', 'archived')),
  confirmation_mode text CHECK (
    confirmation_mode IS NULL OR confirmation_mode IN ('request', 'instant')
  ),
  inventory_basis text NOT NULL
    CHECK (inventory_basis IN (
      'pooled_units', 'exclusive_units', 'shared_capacity'
    )),
  unit_naming_mode text NOT NULL DEFAULT 'interchangeable'
    CHECK (unit_naming_mode IN ('interchangeable', 'named')),
  quantity integer CHECK (quantity BETWEEN 1 AND 10000),
  capacity integer CHECK (capacity BETWEEN 1 AND 100000),
  min_guests integer NOT NULL DEFAULT 1 CHECK (min_guests BETWEEN 1 AND 1000),
  max_guests integer NOT NULL DEFAULT 1 CHECK (max_guests BETWEEN min_guests AND 1000),
  max_adults integer CHECK (max_adults BETWEEN 1 AND 1000),
  max_children integer CHECK (max_children BETWEEN 0 AND 1000),
  place_pricing_basis text CHECK (
    place_pricing_basis IS NULL
    OR place_pricing_basis IN ('per_booking', 'per_unit', 'per_guest')
  ),
  min_notice_minutes integer NOT NULL DEFAULT 0
    CHECK (min_notice_minutes BETWEEN 0 AND 525600),
  max_advance_days integer CHECK (
    max_advance_days IS NULL OR max_advance_days BETWEEN 1 AND 730
  ),
  buffer_before_minutes integer NOT NULL DEFAULT 0
    CHECK (buffer_before_minutes BETWEEN 0 AND 1440),
  buffer_after_minutes integer NOT NULL DEFAULT 0
    CHECK (buffer_after_minutes BETWEEN 0 AND 1440),
  amenities text[] NOT NULL DEFAULT '{}',
  safety_rules text[] NOT NULL DEFAULT '{}',
  accessibility_features text[] NOT NULL DEFAULT '{}',
  access_scope text NOT NULL DEFAULT 'public'
    CHECK (access_scope IN ('public', 'overnight_guests_only')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT stay_offering_kind_shape CHECK (
    (
      kind = 'room'
      AND inventory_basis IN ('pooled_units', 'exclusive_units')
      AND quantity IS NOT NULL
      AND capacity IS NULL
      AND max_adults IS NOT NULL
      AND max_children IS NOT NULL
      AND place_pricing_basis IS NULL
      AND access_scope = 'public'
    )
    OR
    (
      kind = 'place'
      AND max_adults IS NULL
      AND max_children IS NULL
      AND place_pricing_basis IS NOT NULL
      AND (
        (
          inventory_basis = 'exclusive_units'
          AND quantity IS NOT NULL
          AND capacity IS NULL
        )
        OR
        (
          inventory_basis = 'shared_capacity'
          AND quantity IS NULL
          AND capacity IS NOT NULL
          AND unit_naming_mode = 'interchangeable'
        )
      )
    )
  ),
  CONSTRAINT stay_named_inventory_requires_exclusive_units
    CHECK (
      unit_naming_mode = 'interchangeable'
      OR inventory_basis = 'exclusive_units'
    )
);

CREATE INDEX stay_offerings_venue_status_idx
  ON public.stay_offerings (venue_id, status, kind);
CREATE INDEX stay_offerings_brand_idx
  ON public.stay_offerings (brand_id, created_at DESC);

CREATE TABLE public.stay_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(pg_catalog.btrim(name)) BETWEEN 1 AND 120),
  external_reference text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'out_of_service', 'archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stay_units_offering_status_idx
  ON public.stay_units (offering_id, status);
CREATE UNIQUE INDEX stay_units_active_name_idx
  ON public.stay_units (offering_id, lower(name))
  WHERE status <> 'archived';

CREATE TABLE public.stay_offering_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  storage_object_id uuid NOT NULL
    REFERENCES storage.objects(id) ON DELETE RESTRICT,
  storage_bucket_id text NOT NULL CHECK (storage_bucket_id = 'brand_covers'),
  storage_object_name text NOT NULL
    CHECK (char_length(pg_catalog.btrim(storage_object_name)) > 0),
  mime_type text NOT NULL CHECK (
    mime_type IN (
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
    )
  ),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  alt_text text CHECK (alt_text IS NULL OR char_length(alt_text) <= 300),
  checksum_sha256 text CHECK (
    checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 19),
  is_cover boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'ready', 'failed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_offering_media_sort_unique
    UNIQUE (offering_id, sort_order) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT stay_offering_media_object_unique
    UNIQUE (offering_id, storage_object_id)
);

CREATE UNIQUE INDEX stay_offering_media_checksum_idx
  ON public.stay_offering_media (offering_id, checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL;
CREATE UNIQUE INDEX stay_offering_one_ready_cover_idx
  ON public.stay_offering_media (offering_id)
  WHERE is_cover AND status = 'ready';

-- ---------------------------------------------------------------------------
-- 3. Immutable commercial versions.
-- ---------------------------------------------------------------------------
CREATE TABLE public.stay_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  cancellation_policy text NOT NULL
    CHECK (char_length(pg_catalog.btrim(cancellation_policy)) > 0),
  free_cancel_cutoff_minutes integer NOT NULL DEFAULT 0
    CHECK (free_cancel_cutoff_minutes BETWEEN 0 AND 525600),
  late_refund_basis_points integer NOT NULL DEFAULT 0
    CHECK (late_refund_basis_points BETWEEN 0 AND 10000),
  no_show_refund_basis_points integer NOT NULL DEFAULT 0
    CHECK (no_show_refund_basis_points BETWEEN 0 AND 10000),
  operator_cancel_refund_basis_points integer NOT NULL DEFAULT 10000
    CHECK (operator_cancel_refund_basis_points BETWEEN 0 AND 10000),
  request_terms text,
  house_rules text,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(terms) = 'object'),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, version_number),
  CONSTRAINT stay_policy_version_time_order
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX stay_policy_one_current_idx
  ON public.stay_policy_versions (offering_id)
  WHERE effective_to IS NULL;

CREATE TABLE public.stay_price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  pricing_unit text NOT NULL
    CHECK (pricing_unit IN (
      'room_night', 'place_booking', 'place_unit', 'place_guest'
    )),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  reconciliation_id uuid
    REFERENCES public.brand_currency_reconciliations(id) ON DELETE SET NULL,
  supersedes_version_id uuid
    REFERENCES public.stay_price_versions(id) ON DELETE RESTRICT,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, version_number),
  CONSTRAINT stay_price_version_time_order
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX stay_price_one_current_idx
  ON public.stay_price_versions (offering_id)
  WHERE effective_to IS NULL;
CREATE INDEX stay_price_brand_currency_idx
  ON public.stay_price_versions (brand_id, currency_code)
  WHERE effective_to IS NULL;

CREATE TABLE public.stay_fee_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  fee_key text NOT NULL CHECK (fee_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text NOT NULL CHECK (char_length(pg_catalog.btrim(label)) BETWEEN 1 AND 80),
  version_number integer NOT NULL CHECK (version_number > 0),
  fee_kind text NOT NULL DEFAULT 'mandatory_fee'
    CHECK (fee_kind IN ('mandatory_fee', 'tax')),
  calculation text NOT NULL CHECK (calculation IN (
    'fixed_per_group',
    'fixed_per_room_night',
    'fixed_per_place_booking',
    'fixed_per_place_unit',
    'fixed_per_place_guest',
    'percentage_of_line_base'
  )),
  amount_minor bigint,
  basis_points integer,
  currency_code character(3)
    REFERENCES public.supported_brand_currencies(code),
  display_mode text NOT NULL DEFAULT 'separate'
    CHECK (display_mode IN ('included', 'separate')),
  refund_treatment text NOT NULL DEFAULT 'same_as_line'
    CHECK (refund_treatment IN (
      'refundable', 'nonrefundable', 'same_as_line'
    )),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  reconciliation_id uuid
    REFERENCES public.brand_currency_reconciliations(id) ON DELETE SET NULL,
  supersedes_version_id uuid
    REFERENCES public.stay_fee_versions(id) ON DELETE RESTRICT,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, fee_key, version_number),
  CONSTRAINT stay_fee_money_shape CHECK (
    (
      calculation LIKE 'fixed_%'
      AND amount_minor IS NOT NULL
      AND amount_minor >= 0
      AND basis_points IS NULL
      AND currency_code IS NOT NULL
    )
    OR
    (
      calculation = 'percentage_of_line_base'
      AND amount_minor IS NULL
      AND basis_points BETWEEN 0 AND 10000
      AND currency_code IS NULL
    )
  ),
  CONSTRAINT stay_fee_version_time_order
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX stay_fee_one_current_idx
  ON public.stay_fee_versions (offering_id, fee_key)
  WHERE effective_to IS NULL;
CREATE INDEX stay_fee_brand_currency_idx
  ON public.stay_fee_versions (brand_id, currency_code)
  WHERE effective_to IS NULL AND calculation LIKE 'fixed_%';

-- ---------------------------------------------------------------------------
-- 4. Room-night and scheduled Place availability.
-- ---------------------------------------------------------------------------
CREATE TABLE public.stay_room_nights (
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  sellable_quantity integer NOT NULL CHECK (sellable_quantity BETWEEN 0 AND 10000),
  price_override_minor bigint CHECK (price_override_minor >= 0),
  currency_code character(3)
    REFERENCES public.supported_brand_currencies(code),
  stop_sell boolean NOT NULL DEFAULT false,
  minimum_nights integer NOT NULL DEFAULT 1 CHECK (minimum_nights BETWEEN 1 AND 365),
  maximum_nights integer CHECK (
    maximum_nights IS NULL OR maximum_nights BETWEEN minimum_nights AND 365
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offering_id, local_date),
  CONSTRAINT stay_room_night_override_shape CHECK (
    (price_override_minor IS NULL AND currency_code IS NULL)
    OR (price_override_minor IS NOT NULL AND currency_code IS NOT NULL)
  )
);

CREATE INDEX stay_room_nights_date_idx
  ON public.stay_room_nights (venue_id, local_date);

CREATE TABLE public.stay_place_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (
    mode IN ('fixed_slots', 'repeating_windows', 'full_day')
  ),
  timezone text NOT NULL,
  local_start_date date NOT NULL,
  local_end_date date,
  weekdays smallint[] NOT NULL DEFAULT '{}',
  local_start_time time,
  local_end_time time,
  slot_duration_minutes integer,
  slot_interval_minutes integer,
  full_day_start_time time,
  full_day_end_time time,
  dst_fold_policy text NOT NULL DEFAULT 'reject'
    CHECK (dst_fold_policy IN ('earlier', 'later', 'reject')),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_place_rule_weekdays_valid CHECK (
    cardinality(weekdays) BETWEEN 0 AND 7
    AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  ),
  CONSTRAINT stay_place_rule_dates_valid
    CHECK (local_end_date IS NULL OR local_end_date >= local_start_date),
  CONSTRAINT stay_place_rule_mode_shape CHECK (
    (
      mode = 'fixed_slots'
      AND local_end_date IS NULL
      AND cardinality(weekdays) = 0
      AND local_start_time IS NOT NULL
      AND local_end_time IS NOT NULL
      AND slot_duration_minutes IS NULL
      AND slot_interval_minutes IS NULL
      AND full_day_start_time IS NULL
      AND full_day_end_time IS NULL
    )
    OR
    (
      mode = 'repeating_windows'
      AND cardinality(weekdays) BETWEEN 1 AND 7
      AND local_start_time IS NOT NULL
      AND local_end_time IS NOT NULL
      AND slot_duration_minutes BETWEEN 5 AND 1440
      AND slot_interval_minutes BETWEEN 5 AND 1440
      AND full_day_start_time IS NULL
      AND full_day_end_time IS NULL
    )
    OR
    (
      mode = 'full_day'
      AND cardinality(weekdays) BETWEEN 1 AND 7
      AND local_start_time IS NULL
      AND local_end_time IS NULL
      AND slot_duration_minutes IS NULL
      AND slot_interval_minutes IS NULL
      AND full_day_start_time IS NOT NULL
      AND full_day_end_time IS NOT NULL
    )
  )
);

CREATE INDEX stay_place_rules_offering_idx
  ON public.stay_place_schedule_rules (offering_id, active);

CREATE TABLE public.stay_place_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  schedule_rule_id uuid NOT NULL
    REFERENCES public.stay_place_schedule_rules(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  sellable_units integer CHECK (sellable_units BETWEEN 0 AND 10000),
  sellable_capacity integer CHECK (sellable_capacity BETWEEN 0 AND 100000),
  stop_sell boolean NOT NULL DEFAULT false,
  price_override_minor bigint CHECK (price_override_minor >= 0),
  currency_code character(3)
    REFERENCES public.supported_brand_currencies(code),
  dst_resolution text NOT NULL
    CHECK (dst_resolution IN ('unambiguous', 'earlier', 'later')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, starts_at, ends_at),
  CONSTRAINT stay_place_window_time_order CHECK (ends_at > starts_at),
  CONSTRAINT stay_place_window_inventory_shape CHECK (
    (sellable_units IS NOT NULL AND sellable_capacity IS NULL)
    OR (sellable_units IS NULL AND sellable_capacity IS NOT NULL)
  ),
  CONSTRAINT stay_place_window_override_shape CHECK (
    (price_override_minor IS NULL AND currency_code IS NULL)
    OR (price_override_minor IS NOT NULL AND currency_code IS NOT NULL)
  )
);

CREATE INDEX stay_place_windows_offering_time_idx
  ON public.stay_place_windows (offering_id, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- 5. Bulk creation jobs and their stable per-item outcomes.
-- ---------------------------------------------------------------------------
CREATE TABLE public.stay_bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL
    CHECK (char_length(pg_catalog.btrim(idempotency_key)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
  requested_count integer NOT NULL CHECK (requested_count BETWEEN 1 AND 500),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'array'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (venue_id, idempotency_key)
);

CREATE TABLE public.stay_bulk_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.stay_bulk_jobs(id) ON DELETE CASCADE,
  item_index integer NOT NULL CHECK (item_index >= 0),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  offering_id uuid REFERENCES public.stay_offerings(id) ON DELETE SET NULL,
  error_code text,
  safe_error_message text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, item_index),
  CONSTRAINT stay_bulk_item_result_shape CHECK (
    (status = 'succeeded' AND offering_id IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND offering_id IS NULL AND error_code IS NOT NULL)
  )
);

-- Currency reconciliation registration is separate from immutable money rows.
CREATE TABLE public.stay_currency_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL
    REFERENCES public.brand_currency_reconciliations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  item_kind text NOT NULL CHECK (item_kind IN ('price', 'fee')),
  source_version_id uuid NOT NULL,
  source_currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  source_amount_minor bigint NOT NULL CHECK (source_amount_minor >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'converted', 'reentered')),
  replacement_version_id uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reconciliation_id, item_kind, source_version_id)
);

CREATE INDEX stay_currency_reconciliation_pending_idx
  ON public.stay_currency_reconciliation_items
  (reconciliation_id, status, item_kind);

-- ---------------------------------------------------------------------------
-- 6. Cross-row integrity and immutable-history guards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1387_assert_stay_row_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_offering public.stay_offerings%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = NEW.venue_id;
  IF NOT FOUND OR v_venue.brand_id <> NEW.brand_id
     OR v_venue.venue_category <> 'stay' THEN
    RAISE EXCEPTION 'stay_venue_brand_mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME <> 'stay_settings'
     AND TG_TABLE_NAME <> 'stay_offerings'
     AND TG_TABLE_NAME <> 'stay_bulk_jobs' THEN
    IF NEW.offering_id IS NOT NULL THEN
      SELECT * INTO v_offering
      FROM public.stay_offerings
      WHERE id = NEW.offering_id;
      IF NOT FOUND OR v_offering.brand_id <> NEW.brand_id
         OR v_offering.venue_id <> NEW.venue_id THEN
        RAISE EXCEPTION 'stay_offering_scope_mismatch' USING ERRCODE = '23514';
      END IF;
      IF TG_TABLE_NAME = 'stay_room_nights' THEN
        IF v_offering.kind <> 'room' THEN
          RAISE EXCEPTION 'stay_room_inventory_kind_mismatch'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.sellable_quantity > v_offering.quantity THEN
          RAISE EXCEPTION 'stay_room_quantity_exceeded'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME IN ('stay_place_schedule_rules', 'stay_place_windows')
         AND v_offering.kind <> 'place' THEN
        RAISE EXCEPTION 'stay_place_inventory_kind_mismatch'
          USING ERRCODE = '23514';
      END IF;
      IF TG_TABLE_NAME = 'stay_place_windows' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.stay_place_schedule_rules r
          WHERE r.id = NEW.schedule_rule_id
            AND r.offering_id = NEW.offering_id
            AND r.brand_id = NEW.brand_id
            AND r.venue_id = NEW.venue_id
        ) THEN
          RAISE EXCEPTION 'stay_place_rule_scope_mismatch'
            USING ERRCODE = '23514';
        END IF;
        IF (
          (
            v_offering.inventory_basis = 'exclusive_units'
            AND (
              NEW.sellable_units IS NULL
              OR NEW.sellable_units > v_offering.quantity
              OR NEW.sellable_capacity IS NOT NULL
            )
          )
          OR
          (
            v_offering.inventory_basis = 'shared_capacity'
            AND (
              NEW.sellable_capacity IS NULL
              OR NEW.sellable_capacity > v_offering.capacity
              OR NEW.sellable_units IS NOT NULL
            )
          )
        ) THEN
          RAISE EXCEPTION 'stay_place_inventory_shape_mismatch'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME = 'stay_offering_media' THEN
        IF NOT EXISTS (
          SELECT 1
          FROM storage.objects so
          WHERE so.id = NEW.storage_object_id
            AND so.bucket_id = NEW.storage_bucket_id
            AND so.name = NEW.storage_object_name
            AND so.bucket_id = 'brand_covers'
            AND pg_catalog.split_part(so.name, '/', 1) = NEW.brand_id::text
            AND COALESCE(so.metadata->>'mimetype', '') = NEW.mime_type
            AND COALESCE((so.metadata->>'size')::bigint, 0) = NEW.byte_size
        ) THEN
          RAISE EXCEPTION 'stay_media_object_invalid'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1387_guard_money_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stay_money_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.offering_id <> OLD.offering_id
     OR NEW.brand_id <> OLD.brand_id
     OR NEW.venue_id <> OLD.venue_id
     OR NEW.version_number <> OLD.version_number
     OR NEW.created_at <> OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'stay_money_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'stay_price_versions'
     AND (
       to_jsonb(NEW)->'amount_minor' IS DISTINCT FROM to_jsonb(OLD)->'amount_minor'
       OR to_jsonb(NEW)->'currency_code'
         IS DISTINCT FROM to_jsonb(OLD)->'currency_code'
       OR to_jsonb(NEW)->'pricing_unit'
         IS DISTINCT FROM to_jsonb(OLD)->'pricing_unit'
       OR to_jsonb(NEW)->'supersedes_version_id'
         IS DISTINCT FROM to_jsonb(OLD)->'supersedes_version_id'
     ) THEN
    RAISE EXCEPTION 'stay_money_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'stay_fee_versions'
     AND (
       to_jsonb(NEW)->'fee_key' IS DISTINCT FROM to_jsonb(OLD)->'fee_key'
       OR to_jsonb(NEW)->'label' IS DISTINCT FROM to_jsonb(OLD)->'label'
       OR to_jsonb(NEW)->'calculation'
         IS DISTINCT FROM to_jsonb(OLD)->'calculation'
       OR to_jsonb(NEW)->'fee_kind'
         IS DISTINCT FROM to_jsonb(OLD)->'fee_kind'
       OR to_jsonb(NEW)->'amount_minor'
         IS DISTINCT FROM to_jsonb(OLD)->'amount_minor'
       OR to_jsonb(NEW)->'basis_points'
         IS DISTINCT FROM to_jsonb(OLD)->'basis_points'
       OR to_jsonb(NEW)->'currency_code'
         IS DISTINCT FROM to_jsonb(OLD)->'currency_code'
       OR to_jsonb(NEW)->'display_mode'
         IS DISTINCT FROM to_jsonb(OLD)->'display_mode'
       OR to_jsonb(NEW)->'refund_treatment'
         IS DISTINCT FROM to_jsonb(OLD)->'refund_treatment'
       OR to_jsonb(NEW)->'supersedes_version_id'
         IS DISTINCT FROM to_jsonb(OLD)->'supersedes_version_id'
     ) THEN
    RAISE EXCEPTION 'stay_money_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'stay_policy_versions'
     AND (
       to_jsonb(NEW)->'cancellation_policy'
         IS DISTINCT FROM to_jsonb(OLD)->'cancellation_policy'
       OR to_jsonb(NEW)->'free_cancel_cutoff_minutes'
         IS DISTINCT FROM to_jsonb(OLD)->'free_cancel_cutoff_minutes'
       OR to_jsonb(NEW)->'late_refund_basis_points'
         IS DISTINCT FROM to_jsonb(OLD)->'late_refund_basis_points'
       OR to_jsonb(NEW)->'no_show_refund_basis_points'
         IS DISTINCT FROM to_jsonb(OLD)->'no_show_refund_basis_points'
       OR to_jsonb(NEW)->'operator_cancel_refund_basis_points'
         IS DISTINCT FROM to_jsonb(OLD)->'operator_cancel_refund_basis_points'
       OR to_jsonb(NEW)->'request_terms'
         IS DISTINCT FROM to_jsonb(OLD)->'request_terms'
       OR to_jsonb(NEW)->'house_rules'
         IS DISTINCT FROM to_jsonb(OLD)->'house_rules'
       OR to_jsonb(NEW)->'terms' IS DISTINCT FROM to_jsonb(OLD)->'terms'
     ) THEN
    RAISE EXCEPTION 'stay_policy_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.effective_from <> OLD.effective_from
     OR (
       OLD.effective_to IS NOT NULL
       AND NEW.effective_to IS DISTINCT FROM OLD.effective_to
     ) THEN
    RAISE EXCEPTION 'stay_version_lifecycle_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_price_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_price_versions
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_guard_money_history();
CREATE TRIGGER stay_fee_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_fee_versions
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_guard_money_history();
CREATE TRIGGER stay_policy_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_guard_money_history();

CREATE OR REPLACE FUNCTION public.issue_1387_assert_timezone()
RETURNS trigger
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names() z
    WHERE z.name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'stay_invalid_timezone' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_settings_timezone_guard
  BEFORE INSERT OR UPDATE OF timezone ON public.stay_settings
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_assert_timezone();
CREATE TRIGGER stay_place_rules_timezone_guard
  BEFORE INSERT OR UPDATE OF timezone ON public.stay_place_schedule_rules
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_assert_timezone();

DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_settings',
    'stay_offerings',
    'stay_units',
    'stay_offering_media',
    'stay_policy_versions',
    'stay_price_versions',
    'stay_fee_versions',
    'stay_room_nights',
    'stay_place_schedule_rules',
    'stay_place_windows',
    'stay_bulk_jobs'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.issue_1387_assert_stay_row_integrity()',
      v_table || '_scope_guard',
      v_table
    );
  END LOOP;
END;
$block$;

CREATE OR REPLACE FUNCTION public.issue_1387_assert_unit_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_offering public.stay_offerings%ROWTYPE;
  v_active_count integer;
BEGIN
  SELECT * INTO v_offering
  FROM public.stay_offerings
  WHERE id = COALESCE(NEW.offering_id, OLD.offering_id)
  FOR UPDATE;
  IF v_offering.unit_naming_mode <> 'named'
     OR v_offering.inventory_basis <> 'exclusive_units' THEN
    RAISE EXCEPTION 'stay_named_unit_not_allowed' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_active_count
  FROM public.stay_units
  WHERE offering_id = v_offering.id
    AND status <> 'archived'
    AND id <> COALESCE(NEW.id, OLD.id);
  IF TG_OP <> 'DELETE' AND NEW.status <> 'archived' THEN
    v_active_count := v_active_count + 1;
  END IF;
  IF v_active_count > v_offering.quantity THEN
    RAISE EXCEPTION 'stay_unit_quantity_exceeded' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_unit_quantity_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.stay_units
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_assert_unit_quantity();

CREATE OR REPLACE FUNCTION public.issue_1387_assert_offering_unit_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.unit_naming_mode <> 'named' AND EXISTS (
    SELECT 1
    FROM public.stay_units u
    WHERE u.offering_id = NEW.id AND u.status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'stay_units_require_archive' USING ERRCODE = '23514';
  END IF;
  IF NEW.unit_naming_mode = 'named' AND (
    SELECT count(*)
    FROM public.stay_units u
    WHERE u.offering_id = NEW.id AND u.status <> 'archived'
  ) > NEW.quantity THEN
    RAISE EXCEPTION 'stay_unit_quantity_exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_offering_unit_quantity_guard
  BEFORE UPDATE OF inventory_basis, unit_naming_mode, quantity
  ON public.stay_offerings
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_assert_offering_unit_quantity();

CREATE OR REPLACE FUNCTION public.issue_1387_assert_media_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_ready_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status = 'ready' THEN
    SELECT count(*) INTO v_ready_count
    FROM public.stay_offering_media
    WHERE offering_id = NEW.offering_id
      AND status = 'ready'
      AND id <> NEW.id;
    IF v_ready_count >= 20 THEN
      RAISE EXCEPTION 'stay_media_limit_exceeded' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_media_limit_guard
  BEFORE INSERT OR UPDATE ON public.stay_offering_media
  FOR EACH ROW EXECUTE FUNCTION public.issue_1387_assert_media_limit();

-- ---------------------------------------------------------------------------
-- 7. RLS: brand-team/admin read, service-role write, no direct client writes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1387_has_brand_capability(
  p_brand_id uuid,
  p_user_id uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    p_user_id IS NOT NULL
    AND p_user_id = auth.uid()
    AND (
      public.is_admin_user()
      OR EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND b.account_id = p_user_id
          AND b.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.brand_team_members m
        WHERE m.brand_id = p_brand_id
          AND m.user_id = p_user_id
          AND m.accepted_at IS NOT NULL
          AND m.removed_at IS NULL
          AND (
            m.role IN ('brand_owner', 'brand_admin')
            OR (p_capability = 'inventory' AND m.role = 'event_manager')
            OR (p_capability = 'finance' AND m.role = 'finance_manager')
            OR (
              p_capability = 'read'
              AND m.role IN ('event_manager', 'finance_manager')
            )
          )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.issue_1387_has_brand_capability(uuid, uuid, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1387_has_brand_capability(uuid, uuid, text)
  TO authenticated, service_role;

DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_settings',
    'stay_offerings',
    'stay_units',
    'stay_offering_media',
    'stay_policy_versions',
    'stay_price_versions',
    'stay_fee_versions',
    'stay_room_nights',
    'stay_place_schedule_rules',
    'stay_place_windows',
    'stay_bulk_jobs',
    'stay_currency_reconciliation_items'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      v_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON public.%I FROM public, anon, authenticated',
      v_table
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.issue_1387_has_brand_capability('
      'brand_id, auth.uid(), ''read''))',
      v_table || '_team_read',
      v_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT ON public.%I TO authenticated',
      v_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',
      v_table
    );
  END LOOP;

  ALTER TABLE public.stay_bulk_job_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.stay_bulk_job_items FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON public.stay_bulk_job_items FROM public, anon, authenticated;
  CREATE POLICY stay_bulk_job_items_team_read
    ON public.stay_bulk_job_items FOR SELECT TO authenticated
    USING (
      public.is_admin_user()
      OR EXISTS (
        SELECT 1
        FROM public.stay_bulk_jobs j
        WHERE j.id = job_id
          AND public.issue_1387_has_brand_capability(
            j.brand_id, auth.uid(), 'read'
          )
      )
    );
  GRANT SELECT ON public.stay_bulk_job_items TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.stay_bulk_job_items TO service_role;
END;
$block$;

COMMIT;

NOTIFY pgrst, 'reload schema';
