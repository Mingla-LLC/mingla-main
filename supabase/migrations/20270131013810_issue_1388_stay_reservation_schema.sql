-- Issue #1388: same-Stay, one-currency mixed Room and Place reservation core.
--
-- Quotes freeze commercial truth. Reservation groups consume one quote and
-- own one atomic inventory hold. Provider payments, refunds, payouts, and
-- notifications are deliberately deferred to #1389.

BEGIN;

CREATE TABLE public.stay_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_key_hash text NOT NULL CHECK (actor_key_hash ~ '^[a-f0-9]{64}$'),
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  mode text NOT NULL CHECK (mode IN ('instant', 'request')),
  status text NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'active', 'expired', 'consumed')),
  source_subtotal_minor bigint NOT NULL CHECK (source_subtotal_minor >= 0),
  fee_total_minor bigint NOT NULL CHECK (fee_total_minor >= 0),
  tax_total_minor bigint NOT NULL CHECK (tax_total_minor >= 0),
  total_minor bigint NOT NULL CHECK (
    total_minor >= 0
    AND total_minor =
      source_subtotal_minor + fee_total_minor + tax_total_minor
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  price_revision_set_hash text NOT NULL
    CHECK (price_revision_set_hash ~ '^[a-f0-9]{64}$'),
  inventory_revision_set_hash text NOT NULL
    CHECK (inventory_revision_set_hash ~ '^[a-f0-9]{64}$'),
  policy_snapshot_hash text NOT NULL
    CHECK (policy_snapshot_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL
    CHECK (char_length(pg_catalog.btrim(idempotency_key)) BETWEEN 8 AND 200),
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  UNIQUE (actor_key_hash, idempotency_key),
  CONSTRAINT stay_quote_lifecycle_shape CHECK (
    expires_at > created_at
    AND (
      (status <> 'consumed' AND consumed_at IS NULL)
      OR (status = 'consumed' AND consumed_at IS NOT NULL)
    )
  )
);

CREATE INDEX stay_quotes_actor_created_idx
  ON public.stay_quotes (actor_key_hash, created_at DESC);
CREATE INDEX stay_quotes_active_expiry_idx
  ON public.stay_quotes (expires_at)
  WHERE status = 'active';

CREATE TABLE public.stay_quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.stay_quotes(id) ON DELETE CASCADE,
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('room', 'place')),
  confirmation_mode text NOT NULL CHECK (
    confirmation_mode IN ('instant', 'request')
  ),
  room_check_in date,
  room_check_out date,
  room_quantity integer,
  place_window_id uuid
    REFERENCES public.stay_place_windows(id) ON DELETE RESTRICT,
  place_units integer,
  place_guests integer,
  adults integer NOT NULL DEFAULT 0 CHECK (adults >= 0),
  children integer NOT NULL DEFAULT 0 CHECK (children >= 0),
  named_unit_preferences uuid[] NOT NULL DEFAULT '{}',
  base_minor bigint NOT NULL CHECK (base_minor >= 0),
  fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (
    total_minor = base_minor + fee_minor + tax_minor
  ),
  price_version_id uuid NOT NULL
    REFERENCES public.stay_price_versions(id) ON DELETE RESTRICT,
  policy_version_id uuid NOT NULL
    REFERENCES public.stay_policy_versions(id) ON DELETE RESTRICT,
  offering_version bigint NOT NULL CHECK (offering_version > 0),
  inventory_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(inventory_snapshot) = 'object'),
  offering_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(offering_snapshot) = 'object'),
  price_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(price_snapshot) = 'object'),
  policy_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_quote_line_shape CHECK (
    (
      kind = 'room'
      AND room_check_in IS NOT NULL
      AND room_check_out > room_check_in
      AND room_quantity BETWEEN 1 AND 100
      AND place_window_id IS NULL
      AND place_units IS NULL
      AND place_guests IS NULL
      AND adults + children > 0
    )
    OR
    (
      kind = 'place'
      AND room_check_in IS NULL
      AND room_check_out IS NULL
      AND room_quantity IS NULL
      AND place_window_id IS NOT NULL
      AND (place_units IS NULL OR place_units BETWEEN 1 AND 100)
      AND place_guests BETWEEN 1 AND 1000
    )
  )
);

CREATE UNIQUE INDEX stay_quote_room_offering_unique
  ON public.stay_quote_lines (quote_id, offering_id)
  WHERE kind = 'room';
CREATE UNIQUE INDEX stay_quote_place_window_unique
  ON public.stay_quote_lines (quote_id, offering_id, place_window_id)
  WHERE kind = 'place';
CREATE INDEX stay_quote_lines_quote_idx
  ON public.stay_quote_lines (quote_id, kind, offering_id);

CREATE TABLE public.stay_quote_fee_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.stay_quotes(id) ON DELETE CASCADE,
  quote_line_id uuid NOT NULL
    REFERENCES public.stay_quote_lines(id) ON DELETE CASCADE,
  fee_version_id uuid NOT NULL
    REFERENCES public.stay_fee_versions(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (
    char_length(pg_catalog.btrim(name)) BETWEEN 1 AND 80
  ),
  fee_kind text NOT NULL CHECK (fee_kind IN ('mandatory_fee', 'tax')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  included_in_base boolean NOT NULL DEFAULT false,
  refund_treatment text NOT NULL CHECK (
    refund_treatment IN ('refundable', 'nonrefundable', 'same_as_line')
  ),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_line_id, fee_version_id)
);

CREATE INDEX stay_quote_fee_lines_quote_idx
  ON public.stay_quote_fee_lines (quote_id, quote_line_id);

CREATE TABLE public.stay_quote_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_line_id uuid NOT NULL
    REFERENCES public.stay_quote_lines(id) ON DELETE CASCADE,
  allocation_ordinal integer NOT NULL CHECK (
    allocation_ordinal BETWEEN 0 AND 99
  ),
  adults integer NOT NULL CHECK (adults BETWEEN 0 AND 1000),
  children integer NOT NULL CHECK (children BETWEEN 0 AND 1000),
  named_unit_preference uuid
    REFERENCES public.stay_units(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_line_id, allocation_ordinal),
  CONSTRAINT stay_quote_allocation_party CHECK (adults + children > 0)
);

CREATE TABLE public.stay_reservation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE
    CHECK (public_reference ~ '^ST-[A-F0-9]{20}$'),
  quote_id uuid NOT NULL UNIQUE
    REFERENCES public.stay_quotes(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_key_hash text NOT NULL CHECK (actor_key_hash ~ '^[a-f0-9]{64}$'),
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  mode text NOT NULL CHECK (mode IN ('instant', 'request')),
  state text NOT NULL CHECK (state IN (
    'instant_payment_pending',
    'request_pending',
    'declined',
    'request_expired',
    'approved_payment_required',
    'finalizing',
    'confirmed',
    'partially_cancelled',
    'cancelled',
    'reconciliation_required'
  )),
  request_deadline timestamptz,
  payment_deadline timestamptz,
  guest_snapshot jsonb NOT NULL CHECK (jsonb_typeof(guest_snapshot) = 'object'),
  source_subtotal_minor bigint NOT NULL CHECK (source_subtotal_minor >= 0),
  fee_total_minor bigint NOT NULL CHECK (fee_total_minor >= 0),
  tax_total_minor bigint NOT NULL CHECK (tax_total_minor >= 0),
  total_minor bigint NOT NULL CHECK (
    total_minor =
      source_subtotal_minor + fee_total_minor + tax_total_minor
  ),
  idempotency_key text NOT NULL
    CHECK (char_length(pg_catalog.btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_key_hash, idempotency_key),
  CONSTRAINT stay_group_deadline_shape CHECK (
    (
      state = 'request_pending'
      AND request_deadline IS NOT NULL
      AND payment_deadline IS NULL
    )
    OR (
      state = 'approved_payment_required'
      AND request_deadline IS NOT NULL
      AND payment_deadline IS NOT NULL
    )
    OR state NOT IN ('request_pending', 'approved_payment_required')
  )
);

CREATE INDEX stay_groups_actor_created_idx
  ON public.stay_reservation_groups (actor_key_hash, created_at DESC);
CREATE INDEX stay_groups_venue_state_idx
  ON public.stay_reservation_groups (venue_id, state, created_at DESC);
CREATE INDEX stay_groups_request_deadline_idx
  ON public.stay_reservation_groups (request_deadline)
  WHERE state = 'request_pending';
CREATE INDEX stay_groups_payment_deadline_idx
  ON public.stay_reservation_groups (payment_deadline)
  WHERE state = 'approved_payment_required';

CREATE TABLE public.stay_reservation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  quote_line_id uuid NOT NULL UNIQUE
    REFERENCES public.stay_quote_lines(id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('room', 'place')),
  state text NOT NULL CHECK (state IN (
    'payment_pending',
    'request_pending',
    'approved_payment_required',
    'confirmed',
    'cancelled',
    'declined',
    'expired',
    'reconciliation_required'
  )),
  room_check_in date,
  room_check_out date,
  room_quantity integer,
  place_window_id uuid
    REFERENCES public.stay_place_windows(id) ON DELETE RESTRICT,
  place_units integer,
  place_guests integer,
  adults integer NOT NULL DEFAULT 0 CHECK (adults >= 0),
  children integer NOT NULL DEFAULT 0 CHECK (children >= 0),
  base_minor bigint NOT NULL CHECK (base_minor >= 0),
  fee_minor bigint NOT NULL CHECK (fee_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (
    total_minor = base_minor + fee_minor + tax_minor
  ),
  offering_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(offering_snapshot) = 'object'),
  price_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(price_snapshot) = 'object'),
  policy_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  dependency_room_line_id uuid
    REFERENCES public.stay_reservation_lines(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_reservation_line_shape CHECK (
    (
      kind = 'room'
      AND room_check_in IS NOT NULL
      AND room_check_out > room_check_in
      AND room_quantity BETWEEN 1 AND 100
      AND place_window_id IS NULL
      AND place_units IS NULL
      AND place_guests IS NULL
      AND dependency_room_line_id IS NULL
    )
    OR
    (
      kind = 'place'
      AND room_check_in IS NULL
      AND room_check_out IS NULL
      AND room_quantity IS NULL
      AND place_window_id IS NOT NULL
      AND (place_units IS NULL OR place_units BETWEEN 1 AND 100)
      AND place_guests BETWEEN 1 AND 1000
    )
  )
);

CREATE INDEX stay_reservation_lines_group_idx
  ON public.stay_reservation_lines (group_id, kind, offering_id);

CREATE TABLE public.stay_inventory_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'active' CHECK (state IN (
    'active', 'converted', 'released', 'expired', 'reconciliation_required'
  )),
  expires_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT 'reservation'
    CHECK (char_length(pg_catalog.btrim(reason)) BETWEEN 1 AND 80),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stay_inventory_holds_expiry_idx
  ON public.stay_inventory_holds (expires_at)
  WHERE state = 'active';

CREATE TABLE public.stay_inventory_hold_slices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL
    REFERENCES public.stay_inventory_holds(id) ON DELETE RESTRICT,
  reservation_line_id uuid NOT NULL
    REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  resource_type text NOT NULL CHECK (
    resource_type IN ('room_night', 'place_window')
  ),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE RESTRICT,
  room_date date,
  place_window_id uuid
    REFERENCES public.stay_place_windows(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  exclusive_unit_id uuid
    REFERENCES public.stay_units(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_hold_slice_shape CHECK (
    (
      resource_type = 'room_night'
      AND room_date IS NOT NULL
      AND place_window_id IS NULL
    )
    OR (
      resource_type = 'place_window'
      AND room_date IS NULL
      AND place_window_id IS NOT NULL
    )
  ),
  UNIQUE NULLS NOT DISTINCT (
    hold_id,
    reservation_line_id,
    resource_type,
    room_date,
    place_window_id,
    exclusive_unit_id
  )
);

CREATE INDEX stay_hold_slices_room_idx
  ON public.stay_inventory_hold_slices (offering_id, room_date)
  WHERE resource_type = 'room_night';
CREATE INDEX stay_hold_slices_place_idx
  ON public.stay_inventory_hold_slices (offering_id, place_window_id)
  WHERE resource_type = 'place_window';

CREATE TABLE public.stay_inventory_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  reservation_line_id uuid NOT NULL
    REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  resource_type text NOT NULL CHECK (
    resource_type IN ('room_night', 'place_window')
  ),
  offering_id uuid NOT NULL
    REFERENCES public.stay_offerings(id) ON DELETE RESTRICT,
  room_date date,
  place_window_id uuid
    REFERENCES public.stay_place_windows(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  exclusive_unit_id uuid
    REFERENCES public.stay_units(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'released')),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_commitment_slice_shape CHECK (
    (
      resource_type = 'room_night'
      AND room_date IS NOT NULL
      AND place_window_id IS NULL
    )
    OR (
      resource_type = 'place_window'
      AND room_date IS NULL
      AND place_window_id IS NOT NULL
    )
  ),
  CONSTRAINT stay_commitment_release_shape CHECK (
    (state = 'active' AND released_at IS NULL AND release_reason IS NULL)
    OR (state = 'released' AND released_at IS NOT NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (
    group_id,
    reservation_line_id,
    resource_type,
    room_date,
    place_window_id,
    exclusive_unit_id
  )
);

CREATE INDEX stay_commitments_room_idx
  ON public.stay_inventory_commitments (offering_id, room_date)
  WHERE resource_type = 'room_night' AND state = 'active';
CREATE INDEX stay_commitments_place_idx
  ON public.stay_inventory_commitments (offering_id, place_window_id)
  WHERE resource_type = 'place_window' AND state = 'active';

CREATE TABLE public.stay_reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  line_id uuid
    REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type ~ '^stay_[a-z0-9_]{1,72}$'
  ),
  actor_type text NOT NULL CHECK (
    actor_type IN ('guest', 'staff', 'admin', 'service')
  ),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid,
  idempotency_key text NOT NULL
    CHECK (char_length(pg_catalog.btrim(idempotency_key)) BETWEEN 8 AND 240),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, idempotency_key)
);

CREATE INDEX stay_reservation_events_group_idx
  ON public.stay_reservation_events (group_id, created_at, id);

-- Cross-table scope assertions defend service-role and future Admin writers.
CREATE OR REPLACE FUNCTION public.issue_1388_assert_reservation_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_quote public.stay_quotes%ROWTYPE;
  v_quote_line public.stay_quote_lines%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_line public.stay_reservation_lines%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_offering public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'stay_quotes' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.venue_listings v
      WHERE v.id = NEW.venue_id
        AND v.brand_id = NEW.brand_id
        AND v.venue_category = 'stay'
    ) THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_quote_lines' THEN
    SELECT * INTO v_quote FROM public.stay_quotes WHERE id = NEW.quote_id;
    SELECT * INTO v_offering
    FROM public.stay_offerings WHERE id = NEW.offering_id;
    IF NOT FOUND
       OR v_offering.venue_id <> v_quote.venue_id
       OR v_offering.brand_id <> v_quote.brand_id
       OR v_offering.kind <> NEW.kind THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.place_window_id IS NOT NULL THEN
      SELECT * INTO v_window
      FROM public.stay_place_windows WHERE id = NEW.place_window_id;
      IF NOT FOUND OR v_window.offering_id <> NEW.offering_id
         OR v_window.venue_id <> v_quote.venue_id THEN
        RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_quote_fee_lines' THEN
    SELECT * INTO v_quote_line
    FROM public.stay_quote_lines WHERE id = NEW.quote_line_id;
    IF NOT FOUND OR v_quote_line.quote_id <> NEW.quote_id
       OR NOT EXISTS (
         SELECT 1
         FROM public.stay_fee_versions f
         JOIN public.stay_quote_lines source_line
           ON source_line.quote_id = NEW.quote_id
          AND source_line.offering_id = f.offering_id
         WHERE f.id = NEW.fee_version_id
       ) THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_quote_allocations' THEN
    SELECT * INTO v_quote_line
    FROM public.stay_quote_lines WHERE id = NEW.quote_line_id;
    IF NOT FOUND OR v_quote_line.kind <> 'room'
       OR (
         NEW.named_unit_preference IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.stay_units u
           WHERE u.id = NEW.named_unit_preference
             AND u.offering_id = v_quote_line.offering_id
             AND u.status = 'active'
         )
       ) THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_groups' THEN
    SELECT * INTO v_quote FROM public.stay_quotes WHERE id = NEW.quote_id;
    IF NOT FOUND OR v_quote.venue_id <> NEW.venue_id
       OR v_quote.brand_id <> NEW.brand_id
       OR v_quote.currency_code <> NEW.currency_code
       OR v_quote.mode <> NEW.mode
       OR v_quote.actor_key_hash <> NEW.actor_key_hash THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_lines' THEN
    SELECT * INTO v_group
    FROM public.stay_reservation_groups WHERE id = NEW.group_id;
    SELECT * INTO v_quote_line
    FROM public.stay_quote_lines WHERE id = NEW.quote_line_id;
    IF NOT FOUND OR v_quote_line.quote_id <> v_group.quote_id
       OR v_quote_line.offering_id <> NEW.offering_id
       OR v_quote_line.kind <> NEW.kind THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_holds' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.stay_reservation_groups g
      WHERE g.id = NEW.group_id
    ) THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_hold_slices' THEN
    SELECT * INTO v_hold
    FROM public.stay_inventory_holds WHERE id = NEW.hold_id;
    SELECT * INTO v_line
    FROM public.stay_reservation_lines WHERE id = NEW.reservation_line_id;
    IF NOT FOUND OR v_line.group_id <> v_hold.group_id
       OR v_line.offering_id <> NEW.offering_id THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_commitments' THEN
    SELECT * INTO v_line
    FROM public.stay_reservation_lines WHERE id = NEW.reservation_line_id;
    IF NOT FOUND OR v_line.group_id <> NEW.group_id
       OR v_line.offering_id <> NEW.offering_id THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_events' THEN
    IF NEW.line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.stay_reservation_lines l
      WHERE l.id = NEW.line_id AND l.group_id = NEW.group_id
    ) THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_quotes',
    'stay_quote_lines',
    'stay_quote_fee_lines',
    'stay_quote_allocations',
    'stay_reservation_groups',
    'stay_reservation_lines',
    'stay_inventory_holds',
    'stay_inventory_hold_slices',
    'stay_inventory_commitments',
    'stay_reservation_events'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.issue_1388_assert_reservation_scope()',
      v_table || '_scope_guard',
      v_table
    );
  END LOOP;
END;
$block$;

CREATE OR REPLACE FUNCTION public.issue_1388_guard_immutable_rows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_quote_status text;
BEGIN
  IF TG_TABLE_NAME = 'stay_quote_lines' AND TG_OP = 'UPDATE' THEN
    SELECT q.status INTO v_quote_status
    FROM public.stay_quotes q
    WHERE q.id = OLD.quote_id;
    IF v_quote_status = 'building'
       AND NEW.id = OLD.id
       AND NEW.quote_id = OLD.quote_id
       AND NEW.offering_id = OLD.offering_id
       AND NEW.kind = OLD.kind
       AND NEW.confirmation_mode = OLD.confirmation_mode
       AND NEW.room_check_in IS NOT DISTINCT FROM OLD.room_check_in
       AND NEW.room_check_out IS NOT DISTINCT FROM OLD.room_check_out
       AND NEW.room_quantity IS NOT DISTINCT FROM OLD.room_quantity
       AND NEW.place_window_id IS NOT DISTINCT FROM OLD.place_window_id
       AND NEW.place_units IS NOT DISTINCT FROM OLD.place_units
       AND NEW.place_guests IS NOT DISTINCT FROM OLD.place_guests
       AND NEW.adults = OLD.adults
       AND NEW.children = OLD.children
       AND NEW.named_unit_preferences = OLD.named_unit_preferences
       AND NEW.base_minor = OLD.base_minor
       AND NEW.price_version_id = OLD.price_version_id
       AND NEW.policy_version_id = OLD.policy_version_id
       AND NEW.offering_version = OLD.offering_version
       AND NEW.inventory_snapshot = OLD.inventory_snapshot
       AND NEW.offering_snapshot = OLD.offering_snapshot
       AND NEW.price_snapshot = OLD.price_snapshot
       AND NEW.policy_snapshot = OLD.policy_snapshot
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME IN (
    'stay_quote_lines',
    'stay_quote_fee_lines',
    'stay_quote_allocations',
    'stay_inventory_hold_slices',
    'stay_reservation_events'
  ) THEN
    RAISE EXCEPTION 'stay_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stay_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'stay_quotes' THEN
    IF OLD.status = 'building'
       AND NEW.status IN ('building', 'active')
       AND NEW.id = OLD.id
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.actor_key_hash = OLD.actor_key_hash
       AND NEW.venue_id = OLD.venue_id
       AND NEW.brand_id = OLD.brand_id
       AND NEW.currency_code = OLD.currency_code
       AND NEW.request_hash = OLD.request_hash
       AND NEW.idempotency_key = OLD.idempotency_key
       AND NEW.expires_at = OLD.expires_at
       AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
       AND NEW.version = OLD.version
       AND NEW.consumed_at IS NOT DISTINCT FROM OLD.consumed_at
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;
    IF NEW.id <> OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.actor_key_hash <> OLD.actor_key_hash
       OR NEW.venue_id <> OLD.venue_id
       OR NEW.brand_id <> OLD.brand_id
       OR NEW.currency_code <> OLD.currency_code
       OR NEW.mode <> OLD.mode
       OR NEW.source_subtotal_minor <> OLD.source_subtotal_minor
       OR NEW.fee_total_minor <> OLD.fee_total_minor
       OR NEW.tax_total_minor <> OLD.tax_total_minor
       OR NEW.total_minor <> OLD.total_minor
       OR NEW.request_hash <> OLD.request_hash
       OR NEW.price_revision_set_hash <> OLD.price_revision_set_hash
       OR NEW.inventory_revision_set_hash <> OLD.inventory_revision_set_hash
       OR NEW.policy_snapshot_hash <> OLD.policy_snapshot_hash
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.expires_at <> OLD.expires_at
       OR NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_quote_snapshot_immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_groups' THEN
    IF NEW.id <> OLD.id
       OR NEW.public_reference <> OLD.public_reference
       OR NEW.quote_id <> OLD.quote_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.actor_key_hash <> OLD.actor_key_hash
       OR NEW.venue_id <> OLD.venue_id
       OR NEW.brand_id <> OLD.brand_id
       OR NEW.currency_code <> OLD.currency_code
       OR NEW.mode <> OLD.mode
       OR NEW.guest_snapshot <> OLD.guest_snapshot
       OR NEW.source_subtotal_minor <> OLD.source_subtotal_minor
       OR NEW.fee_total_minor <> OLD.fee_total_minor
       OR NEW.tax_total_minor <> OLD.tax_total_minor
       OR NEW.total_minor <> OLD.total_minor
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.request_hash <> OLD.request_hash
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_group_snapshot_immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_lines' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.quote_line_id <> OLD.quote_line_id
       OR NEW.offering_id <> OLD.offering_id
       OR NEW.kind <> OLD.kind
       OR NEW.room_check_in IS DISTINCT FROM OLD.room_check_in
       OR NEW.room_check_out IS DISTINCT FROM OLD.room_check_out
       OR NEW.room_quantity IS DISTINCT FROM OLD.room_quantity
       OR NEW.place_window_id IS DISTINCT FROM OLD.place_window_id
       OR NEW.place_units IS DISTINCT FROM OLD.place_units
       OR NEW.place_guests IS DISTINCT FROM OLD.place_guests
       OR NEW.adults <> OLD.adults
       OR NEW.children <> OLD.children
       OR NEW.base_minor <> OLD.base_minor
       OR NEW.fee_minor <> OLD.fee_minor
       OR NEW.tax_minor <> OLD.tax_minor
       OR NEW.total_minor <> OLD.total_minor
       OR NEW.offering_snapshot <> OLD.offering_snapshot
       OR NEW.price_snapshot <> OLD.price_snapshot
       OR NEW.policy_snapshot <> OLD.policy_snapshot
       OR NEW.dependency_room_line_id IS DISTINCT FROM OLD.dependency_room_line_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_line_snapshot_immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_quotes_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_quotes
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();
CREATE TRIGGER stay_quote_lines_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();
CREATE TRIGGER stay_quote_fee_lines_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_quote_fee_lines
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();
CREATE TRIGGER stay_quote_allocations_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_quote_allocations
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();
CREATE TRIGGER stay_groups_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_reservation_groups
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();
CREATE TRIGGER stay_reservation_lines_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_reservation_lines
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();
CREATE TRIGGER stay_hold_slices_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_inventory_hold_slices
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();
CREATE TRIGGER stay_reservation_events_history_guard
  BEFORE UPDATE OR DELETE ON public.stay_reservation_events
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_immutable_rows();

CREATE OR REPLACE FUNCTION public.issue_1388_guard_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stay_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'stay_quotes' THEN
    IF OLD.status <> NEW.status AND NOT (
      (OLD.status = 'building' AND NEW.status = 'active')
      OR (
        OLD.status = 'active'
        AND NEW.status IN ('expired', 'consumed')
      )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_groups' THEN
    IF OLD.state <> NEW.state AND NOT (
       (
         OLD.state = 'instant_payment_pending'
         AND NEW.state IN (
           'finalizing', 'cancelled', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'request_pending'
         AND NEW.state IN (
           'approved_payment_required',
           'declined',
           'request_expired',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'approved_payment_required'
         AND NEW.state IN (
           'finalizing',
           'request_expired',
           'cancelled',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'finalizing'
         AND NEW.state IN ('confirmed', 'reconciliation_required')
       )
       OR (
         OLD.state = 'confirmed'
         AND NEW.state IN (
           'partially_cancelled', 'cancelled', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'partially_cancelled'
         AND NEW.state IN ('cancelled', 'reconciliation_required')
       )
       OR (
         OLD.state = 'reconciliation_required'
         AND NEW.state IN (
           'finalizing',
           'confirmed',
           'partially_cancelled',
           'cancelled'
         )
       )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_lines' THEN
    IF OLD.state <> NEW.state AND NOT (
       (
         OLD.state = 'payment_pending'
         AND NEW.state IN (
           'confirmed', 'cancelled', 'expired', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'request_pending'
         AND NEW.state IN (
           'approved_payment_required',
           'declined',
           'expired',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'approved_payment_required'
         AND NEW.state IN (
           'confirmed', 'cancelled', 'expired', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'confirmed'
         AND NEW.state IN ('cancelled', 'reconciliation_required')
       )
       OR (
         OLD.state = 'reconciliation_required'
         AND NEW.state IN ('confirmed', 'cancelled')
       )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_holds' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_hold_identity_immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.state <> NEW.state AND NOT (
      (
        OLD.state = 'active'
        AND NEW.state IN (
          'converted', 'released', 'expired', 'reconciliation_required'
        )
      )
      OR (
        OLD.state = 'reconciliation_required'
        AND NEW.state IN ('converted', 'released')
      )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_commitments' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.reservation_line_id <> OLD.reservation_line_id
       OR NEW.resource_type <> OLD.resource_type
       OR NEW.offering_id <> OLD.offering_id
       OR NEW.room_date IS DISTINCT FROM OLD.room_date
       OR NEW.place_window_id IS DISTINCT FROM OLD.place_window_id
       OR NEW.quantity <> OLD.quantity
       OR NEW.exclusive_unit_id IS DISTINCT FROM OLD.exclusive_unit_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_commitment_identity_immutable'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.state <> NEW.state
       AND NOT (OLD.state = 'active' AND NEW.state = 'released') THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_quotes_state_guard
  BEFORE UPDATE OR DELETE ON public.stay_quotes
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_state_transition();
CREATE TRIGGER stay_groups_state_guard
  BEFORE UPDATE OR DELETE ON public.stay_reservation_groups
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_state_transition();
CREATE TRIGGER stay_lines_state_guard
  BEFORE UPDATE OR DELETE ON public.stay_reservation_lines
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_state_transition();
CREATE TRIGGER stay_holds_state_guard
  BEFORE UPDATE OR DELETE ON public.stay_inventory_holds
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_state_transition();
CREATE TRIGGER stay_commitments_state_guard
  BEFORE UPDATE OR DELETE ON public.stay_inventory_commitments
  FOR EACH ROW EXECUTE FUNCTION public.issue_1388_guard_state_transition();

-- Reservation data is RPC-only. FORCE RLS protects future direct grants; the
-- service role remains the only table writer.
DO $block$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_quotes',
    'stay_quote_lines',
    'stay_quote_fee_lines',
    'stay_quote_allocations',
    'stay_reservation_groups',
    'stay_reservation_lines',
    'stay_inventory_holds',
    'stay_inventory_hold_slices',
    'stay_inventory_commitments',
    'stay_reservation_events'
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
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',
      v_table
    );
  END LOOP;
END;
$block$;

COMMIT;

NOTIFY pgrst, 'reload schema';
