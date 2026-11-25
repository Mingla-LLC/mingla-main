-- #4490 P3-1 — group packages, extras, deposits and balance, changing a
-- booking (guests, day, extras), payments taken at the venue, and the offer
-- sweep (balance reminders and overdue notices).
--
-- Group packages (offer kind `group_package`) share the venue's day limit with
-- entry (same capacity pool; P3 packages are pool-only: "any open space").
-- A package is priced per guest or per booking through its named price
-- options (guest_min..guest_max, no 50 cap; the publish check bounds
-- guest_max by the pool's day limit), starts at set times for a set length,
-- includes items (menu items, staff, perks, one "guests choose one" question)
-- and sells priced extras (per booking or per guest).
--
-- Money:
--   * A package may ask for a deposit (percent or fixed) with the balance due
--     N days before. At checkout the guest pays the deposit ("Half now") or
--     everything ("All now"). A deposit at or above the total, or a booking
--     made after the balance due date, is paid in full.
--   * What is owed has one home: issue_4490_booking_money (and the
--     venue_booking_balance_v view over it): total due = the booking total
--     plus every applied change; paid = succeeded online payments plus
--     payments recorded at the venue, less refunds made for changes.
--   * The balance is paid online with the booking link (stage `balance`,
--     finalised by issue_4490_finalize_followup_payment, which never touches
--     holds) or recorded by staff with money rights as paid at the venue
--     (venue_offline_payments; never a provider payment row, as #4188).
--   * Changing a booking (more or fewer guests, another day, more extras)
--     writes an append-only amendment. More money owed raises the balance;
--     less follows the booking's snapshotted refund ladder for guests (the
--     operator rate for staff), and money already paid above the new total is
--     refunded through the same refund rail as a cancellation.
--
-- Engine edits (each marked below):
--   * issue_1389_finalize_payment: one early branch for stage `balance`, and
--     a late payment that arrives after the booking was already cancelled or
--     expired is recorded as refund due instead of failing the transition
--     guard forever (Stays included: that case used to raise
--     stay_invalid_transition on every webhook retry).
--   * issue_1388_guard_state_transition: an active commitment of a venue
--     booking may change its window or quantity, only inside a booking change
--     (transaction-local marker = the group id). Stays commitments unchanged.
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): drop the new tables, view and functions; restore the
-- redefined functions from 20281203074490 / 20281203084490 / 20281203094490 /
-- 20281203134490 / 20271231204134 / 20270131013813; drop the added columns.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Package columns, booking answers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_extras_valid(p_extras jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT jsonb_typeof(p_extras) = 'array'
    AND jsonb_array_length(p_extras) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_extras) e
      WHERE jsonb_typeof(e) <> 'object'
         OR COALESCE(e->>'id', '') !~ '^[a-z0-9][a-z0-9-]{0,39}$'
         OR jsonb_typeof(e->'name') <> 'string'
         OR char_length(btrim(e->>'name')) NOT BETWEEN 1 AND 80
         OR jsonb_typeof(e->'price_minor') <> 'number'
         OR (e->>'price_minor') !~ '^[0-9]{1,12}$'
         OR COALESCE(e->>'per', '') NOT IN ('booking', 'guest')
         OR e - ARRAY['id', 'name', 'price_minor', 'per'] <> '{}'::jsonb
    )
    AND (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_extras) e) = jsonb_array_length(p_extras);
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_inclusions_valid(p_items jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT jsonb_typeof(p_items) = 'array'
    AND jsonb_array_length(p_items) <= 30
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) i
      WHERE jsonb_typeof(i) <> 'object'
         -- P2 rows were plain {label, qty_per}; kind defaults to 'item'.
         OR COALESCE(i->>'kind', 'item') NOT IN ('item', 'menu_item', 'staff', 'perk', 'choice')
         OR jsonb_typeof(i->'label') <> 'string'
         OR char_length(btrim(i->>'label')) NOT BETWEEN 1 AND 80
         OR (i ? 'qty_per' AND COALESCE(i->>'qty_per', '') NOT IN ('guest', 'booking'))
         OR (i ? 'menu_item_id' AND COALESCE(i->>'menu_item_id', '') !~ '^[0-9a-f-]{36}$')
         OR (COALESCE(i->>'kind', 'item') = 'menu_item' AND NOT (i ? 'menu_item_id'))
         OR (i ? 'staff_ratio' AND (COALESCE(i->>'staff_ratio', '') !~ '^[0-9]{1,4}$'
                                    OR (i->>'staff_ratio')::integer NOT BETWEEN 1 AND 1000))
         OR (COALESCE(i->>'kind', 'item') = 'choice' AND (
              jsonb_typeof(i->'options') <> 'array'
              OR jsonb_array_length(i->'options') NOT BETWEEN 2 AND 10
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(i->'options') o
                         WHERE jsonb_typeof(o) <> 'string' OR char_length(btrim(o #>> '{}')) NOT BETWEEN 1 AND 60)))
         OR (COALESCE(i->>'kind', 'item') <> 'choice' AND i ? 'options')
         OR i - ARRAY['kind', 'label', 'qty_per', 'menu_item_id', 'staff_ratio', 'options'] <> '{}'::jsonb
    )
    -- One question per label (answers are keyed by the question's label).
    AND (SELECT count(DISTINCT lower(btrim(i->>'label'))) FROM jsonb_array_elements(p_items) i
         WHERE i->>'kind' = 'choice')
        = (SELECT count(*) FROM jsonb_array_elements(p_items) i WHERE i->>'kind' = 'choice');
$function$;

ALTER TABLE public.stay_offerings
  ADD COLUMN extras jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.stay_offerings
  ADD CONSTRAINT stay_offering_extras_valid CHECK (public.issue_4490_extras_valid(extras)),
  ADD CONSTRAINT stay_offering_inclusions_valid CHECK (public.issue_4490_inclusions_valid(inclusions)),
  ADD CONSTRAINT stay_offering_extras_offer_only CHECK (
    kind NOT IN ('room', 'place') OR (extras = '[]'::jsonb AND inclusions = '[]'::jsonb)
  );

ALTER TABLE public.stay_reservation_groups
  ADD COLUMN booking_answers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(booking_answers) = 'object');

-- ---------------------------------------------------------------------------
-- 2. Amendments (append-only) and payments taken at the venue.
--    Both hang off the booking only (venue and brand come from it).
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_booking_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  reservation_line_id uuid REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('change_guests', 'move_date', 'add_extras', 'balance_adjust')),
  from_guests integer CHECK (from_guests IS NULL OR from_guests BETWEEN 1 AND 100000),
  to_guests integer CHECK (to_guests IS NULL OR to_guests BETWEEN 1 AND 100000),
  from_window_id uuid REFERENCES public.stay_place_windows(id) ON DELETE RESTRICT,
  to_window_id uuid REFERENCES public.stay_place_windows(id) ON DELETE RESTRICT,
  extras jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(extras) = 'array'),
  price_delta_minor bigint NOT NULL,
  fee_delta_minor bigint NOT NULL DEFAULT 0,
  tax_delta_minor bigint NOT NULL DEFAULT 0,
  policy_fee_minor bigint NOT NULL DEFAULT 0 CHECK (policy_fee_minor >= 0),
  refund_minor bigint NOT NULL DEFAULT 0 CHECK (refund_minor >= 0),
  state text NOT NULL DEFAULT 'applied' CHECK (state IN ('applied')),
  actor_type text NOT NULL CHECK (actor_type IN ('guest', 'staff', 'admin')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, idempotency_key),
  CONSTRAINT venue_booking_amendments_shape CHECK (
    (kind = 'change_guests' AND reservation_line_id IS NOT NULL AND from_guests IS NOT NULL AND to_guests IS NOT NULL
       AND from_guests <> to_guests)
    OR (kind = 'move_date' AND from_window_id IS NOT NULL AND to_window_id IS NOT NULL AND from_window_id <> to_window_id)
    OR (kind = 'add_extras' AND jsonb_array_length(extras) >= 1)
    OR kind = 'balance_adjust'
  )
);
CREATE INDEX venue_booking_amendments_group_idx ON public.venue_booking_amendments (group_id, created_at);

CREATE TABLE public.venue_offline_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 2147483647),
  currency_code character(3) NOT NULL REFERENCES public.supported_brand_currencies(code),
  method text NOT NULL CHECK (method IN ('cash', 'transfer', 'card_at_venue', 'other')),
  paid_on date NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, idempotency_key)
);
CREATE INDEX venue_offline_payments_group_idx ON public.venue_offline_payments (group_id);

CREATE OR REPLACE FUNCTION public.issue_4490_guard_append_only_money()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- Account erasure may clear the actor pointer, nothing else.
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'venue_offline_payments' THEN
      IF to_jsonb(NEW)->'recorded_by' = 'null'::jsonb AND to_jsonb(OLD)->'recorded_by' <> 'null'::jsonb
         AND (to_jsonb(NEW) - 'recorded_by') = (to_jsonb(OLD) - 'recorded_by') THEN
        RETURN NEW;
      END IF;
    ELSIF to_jsonb(NEW)->'actor_user_id' = 'null'::jsonb AND to_jsonb(OLD)->'actor_user_id' <> 'null'::jsonb
       AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'venue_booking_history_immutable' USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER issue_4490_amendments_append_only
  BEFORE UPDATE OR DELETE ON public.venue_booking_amendments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_append_only_money();
CREATE TRIGGER issue_4490_offline_payments_append_only
  BEFORE UPDATE OR DELETE ON public.venue_offline_payments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_append_only_money();

-- Rows can be written only by the #4490 change / payment RPCs.
CREATE OR REPLACE FUNCTION public.issue_4490_guard_booking_money_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_reservation_groups g WHERE g.id = NEW.group_id AND g.offer_kind IS NOT NULL
  ) OR current_setting('mingla.issue_4490_booking_change', true) IS DISTINCT FROM NEW.group_id::text THEN
    RAISE EXCEPTION 'offer_rail_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_amendments_rail
  BEFORE INSERT ON public.venue_booking_amendments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_booking_money_insert();
CREATE TRIGGER issue_4490_offline_payments_rail
  BEFORE INSERT ON public.venue_offline_payments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_booking_money_insert();

ALTER TABLE public.venue_booking_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_offline_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_booking_amendments, public.venue_offline_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_booking_amendments, public.venue_offline_payments TO authenticated;
GRANT ALL ON public.venue_booking_amendments, public.venue_offline_payments TO service_role;
CREATE OR REPLACE FUNCTION public.issue_4490_can_view_booking(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT public.issue_4490_can_view_venue(g.venue_id)
    FROM public.stay_reservation_groups g
    WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL), false);
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_can_view_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_can_view_booking(uuid) TO authenticated, service_role;
CREATE POLICY "venue booking amendments readable by venue viewers"
  ON public.venue_booking_amendments FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_booking(group_id));
CREATE POLICY "venue offline payments readable by venue viewers"
  ON public.venue_offline_payments FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_booking(group_id));

-- ---------------------------------------------------------------------------
-- 3. Guards: booking answers are part of the frozen booking; an active
--    commitment of a venue booking may move inside a booking change only.
-- ---------------------------------------------------------------------------
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
       AND NEW.price_option_id IS NOT DISTINCT FROM OLD.price_option_id
       AND NEW.booked_minutes IS NOT DISTINCT FROM OLD.booked_minutes
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
       AND NEW.offer_kind IS NOT DISTINCT FROM OLD.offer_kind
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
       OR NEW.offer_kind IS DISTINCT FROM OLD.offer_kind
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
       OR NEW.offer_kind IS DISTINCT FROM OLD.offer_kind
       OR NEW.buyer_token_hash IS DISTINCT FROM OLD.buyer_token_hash
       OR NEW.payment_plan_snapshot <> OLD.payment_plan_snapshot
       OR NEW.booking_answers <> OLD.booking_answers
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
       OR NEW.price_option_id IS DISTINCT FROM OLD.price_option_id
       OR NEW.booked_minutes IS DISTINCT FROM OLD.booked_minutes
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_line_snapshot_immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1388_guard_state_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
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
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
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
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
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
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
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
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_commitments' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.reservation_line_id <> OLD.reservation_line_id
       OR NEW.resource_type <> OLD.resource_type
       OR NEW.offering_id <> OLD.offering_id
       OR NEW.room_date IS DISTINCT FROM OLD.room_date
       OR NEW.exclusive_unit_id IS DISTINCT FROM OLD.exclusive_unit_id
       OR NEW.created_at <> OLD.created_at
       OR (
         (NEW.place_window_id IS DISTINCT FROM OLD.place_window_id OR NEW.quantity <> OLD.quantity)
         -- #4490 P3: a venue booking change may move an active commitment to
         -- another window or change its guests, inside that change only.
         AND NOT (
           OLD.state = 'active' AND NEW.state = 'active'
           AND NEW.resource_type = 'place_window' AND NEW.place_window_id IS NOT NULL
           AND current_setting('mingla.issue_4490_booking_change', true) = NEW.group_id::text
           AND EXISTS (SELECT 1 FROM public.stay_reservation_groups g
                       WHERE g.id = NEW.group_id AND g.offer_kind IS NOT NULL)
         )
       ) THEN
      RAISE EXCEPTION 'stay_commitment_identity_immutable'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.state <> NEW.state
       AND NOT (OLD.state = 'active' AND NEW.state = 'released') THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

-- ---------------------------------------------------------------------------
-- 4. Group packages are built (feature switch, offer kind).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays', 'entry',
               'group_packages']::text[];
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_built_offer_kinds()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['entry', 'group_package']::text[];
$function$;

-- ---------------------------------------------------------------------------
-- 5. Shared helpers: where a booking line is now (a change moves its
--    commitment), what is owed, the deposit plan, pass validity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_line_window_id(p_line_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT c.place_window_id FROM public.stay_inventory_commitments c
     WHERE c.reservation_line_id = p_line_id
     ORDER BY (c.state = 'active') DESC, c.created_at DESC LIMIT 1),
    (SELECT l.place_window_id FROM public.stay_reservation_lines l WHERE l.id = p_line_id));
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_line_guests(p_line_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT c.quantity FROM public.stay_inventory_commitments c
     WHERE c.reservation_line_id = p_line_id
     ORDER BY (c.state = 'active') DESC, c.created_at DESC LIMIT 1),
    (SELECT l.place_guests FROM public.stay_reservation_lines l WHERE l.id = p_line_id));
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_group_window_id(p_group_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_line_window_id(l.id)
  FROM public.stay_reservation_lines l WHERE l.group_id = p_group_id
  ORDER BY l.created_at, l.id LIMIT 1;
$function$;

-- What is owed on a venue booking: the one home of "total due / paid /
-- balance". Online payments are succeeded attempts; payments taken at the
-- venue are venue_offline_payments; refunds made for a change lower what was
-- paid. Cancellation refunds are reported separately (refunded).
CREATE OR REPLACE FUNCTION public.issue_4490_booking_money(p_group_id uuid)
RETURNS TABLE (
  total_due bigint,
  paid_online bigint,
  paid_offline bigint,
  change_refunds bigint,
  net_paid bigint,
  refunded bigint,
  balance bigint,
  changes_minor bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH g AS (
    SELECT g.id, g.total_minor, g.state FROM public.stay_reservation_groups g
    WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL
  ), m AS (
    SELECT
      g.total_minor,
      g.state,
      COALESCE((SELECT sum(a.price_delta_minor + a.fee_delta_minor + a.tax_delta_minor + a.policy_fee_minor)
                FROM public.venue_booking_amendments a WHERE a.group_id = g.id AND a.state = 'applied'), 0)::bigint AS changes,
      COALESCE((SELECT sum(p.amount_minor) FROM public.stay_payment_attempts p
                WHERE p.group_id = g.id AND p.state = 'succeeded'), 0)::bigint AS online,
      COALESCE((SELECT sum(o.amount_minor) FROM public.venue_offline_payments o WHERE o.group_id = g.id), 0)::bigint AS offline,
      COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                WHERE r.group_id = g.id AND r.idempotency_key LIKE 'offer-change-refund:%'
                  AND r.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')), 0)::bigint AS change_refunds,
      COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                WHERE r.group_id = g.id
                  AND r.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')), 0)::bigint AS refunded
    FROM g
  )
  SELECT
    m.total_minor + m.changes,
    m.online,
    m.offline,
    m.change_refunds,
    m.online + m.offline - m.change_refunds,
    m.refunded,
    CASE WHEN m.state IN ('confirmed', 'partially_cancelled')
         THEN GREATEST(m.total_minor + m.changes - (m.online + m.offline - m.change_refunds), 0)
         ELSE 0 END,
    m.changes
  FROM m;
$function$;

CREATE VIEW public.venue_booking_balance_v
WITH (security_invoker = true)
AS
SELECT g.id AS group_id, money.*
FROM public.stay_reservation_groups g
CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) money
WHERE g.offer_kind IS NOT NULL;
REVOKE ALL ON public.venue_booking_balance_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_booking_balance_v TO service_role;

-- The deposit plan for a total on a window: whether "Half now" is offered,
-- how much, and when the rest is due. A deposit at or above the total, or a
-- due date already passed, means pay in full.
CREATE OR REPLACE FUNCTION public.issue_4490_deposit_plan(p_offering_id uuid, p_window_id uuid, p_total bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_deposit bigint;
  v_due timestamptz;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = p_window_id;
  IF NOT FOUND OR v_offer.deposit_kind = 'none' OR COALESCE(p_total, 0) <= 0 THEN
    RETURN jsonb_build_object('payModes', jsonb_build_array('full'), 'depositMinor', NULL,
      'balanceDueAt', NULL, 'depositKind', COALESCE(v_offer.deposit_kind, 'none'), 'depositValue', NULL,
      'collapsed', NULL);
  END IF;
  v_deposit := CASE v_offer.deposit_kind
    WHEN 'percent' THEN (p_total * v_offer.deposit_value + 5000) / 10000
    ELSE LEAST(v_offer.deposit_value, p_total) END;
  v_due := v_window.starts_at - make_interval(days => COALESCE(v_offer.balance_due_days_before, 0));
  IF v_deposit >= p_total OR v_deposit <= 0 OR v_due <= now() THEN
    RETURN jsonb_build_object('payModes', jsonb_build_array('full'), 'depositMinor', NULL,
      'balanceDueAt', NULL, 'depositKind', v_offer.deposit_kind, 'depositValue', v_offer.deposit_value,
      'collapsed', CASE WHEN v_due <= now() THEN 'balance_due_passed' ELSE 'deposit_covers_total' END);
  END IF;
  RETURN jsonb_build_object('payModes', jsonb_build_array('deposit', 'full'), 'depositMinor', v_deposit,
    'balanceDueAt', v_due, 'depositKind', v_offer.deposit_kind, 'depositValue', v_offer.deposit_value,
    'collapsed', NULL);
END;
$function$;

-- Pass validity for an offer on a window (the same rules as the pass issued
-- at confirmation).
CREATE OR REPLACE FUNCTION public.issue_4490_pass_validity(p_offering_id uuid, p_window_id uuid)
RETURNS TABLE (valid_local_date date, valid_from timestamptz, valid_to timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT w.local_date,
    CASE
      WHEN o.entry_style = 'timed_session' THEN w.starts_at - interval '30 minutes'
      WHEN o.kind = 'entry' THEN w.local_date::timestamp AT TIME ZONE public.issue_4490_venue_timezone(o.venue_id)
      ELSE w.starts_at - make_interval(mins => o.buffer_before_minutes)
    END,
    CASE
      WHEN o.entry_style = 'timed_session' THEN w.starts_at + interval '30 minutes'
      WHEN o.kind = 'entry' THEN GREATEST(w.ends_at,
        (w.local_date + 1)::timestamp AT TIME ZONE public.issue_4490_venue_timezone(o.venue_id))
      ELSE w.ends_at
    END
  FROM public.stay_offerings o
  JOIN public.stay_place_windows w ON w.id = p_window_id AND w.offering_id = o.id
  WHERE o.id = p_offering_id;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Offer readiness and reads (packages: inclusions, extras, deposit, start
--    times; the public page also lists live group packages).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_offer_readiness(p_offering_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_reasons text[] := '{}'::text[];
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_max_guests integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RETURN ARRAY['not_found'];
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_offer.venue_id;
  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    v_reasons := v_reasons || 'kind_not_available_yet'::text;
  END IF;
  IF NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    v_reasons := v_reasons || 'feature_off'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    JOIN public.stay_price_versions p
      ON p.price_option_id = o.id AND p.offering_id = o.offering_id AND p.effective_to IS NULL
    WHERE o.offering_id = v_offer.id AND o.status = 'active'
  ) THEN
    v_reasons := v_reasons || 'no_price_option'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_policy_versions p
    WHERE p.offering_id = v_offer.id AND p.effective_to IS NULL
  ) THEN
    v_reasons := v_reasons || 'no_policy'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active
  ) THEN
    v_reasons := v_reasons || 'no_schedule'::text;
  END IF;
  IF v_offer.kind IN ('entry', 'group_package') THEN
    SELECT * INTO v_pool FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id;
    IF NOT FOUND OR v_pool.archived_at IS NOT NULL THEN
      v_reasons := v_reasons || 'no_day_limit'::text;
    ELSE
      SELECT max(o.guest_max) INTO v_max_guests
      FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active';
      IF v_max_guests IS NOT NULL AND v_max_guests > v_pool.daily_limit THEN
        v_reasons := v_reasons || 'guest_max_over_capacity'::text;
      END IF;
    END IF;
  END IF;
  IF v_offer.kind IN ('private_hire', 'by_the_hour') AND NOT EXISTS (
    SELECT 1 FROM public.venue_offer_spaces s WHERE s.offering_id = v_offer.id
  ) THEN
    v_reasons := v_reasons || 'no_spaces'::text;
  END IF;
  IF v_offer.deposit_kind <> 'none' AND v_offer.kind <> 'group_package' THEN
    v_reasons := v_reasons || 'deposit_not_available_yet'::text;
  END IF;
  -- #4490 P3: packages are priced per guest or per booking, and start at set times.
  IF v_offer.kind = 'group_package' AND EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    WHERE o.offering_id = v_offer.id AND o.status = 'active' AND o.unit NOT IN ('guest', 'booking')
  ) THEN
    v_reasons := v_reasons || 'option_unit_invalid'::text;
  END IF;
  IF v_offer.kind = 'group_package' AND EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active AND r.mode = 'full_day'
  ) THEN
    v_reasons := v_reasons || 'no_start_times'::text;
  END IF;
  IF v_venue.venue_category = 'stay' THEN
    v_reasons := v_reasons || 'stay_venue'::text;
  END IF;
  RETURN v_reasons;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_offer_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', o.id,
    'venueId', o.venue_id,
    'kind', o.kind,
    'entryStyle', o.entry_style,
    'name', o.name,
    'summary', NULLIF(o.summary, ''),
    'description', NULLIF(o.description, ''),
    'status', o.status,
    'version', o.version,
    'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
    'sessionCapacity', CASE WHEN o.entry_style = 'timed_session' THEN o.capacity ELSE NULL END,
    'minNoticeMinutes', o.min_notice_minutes,
    'maxAdvanceDays', o.max_advance_days,
    'sortOrder', o.sort_order,
    'pool', public.issue_4490_pool_projection(o.capacity_pool_id),
    'options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', opt.id,
        'name', opt.name,
        'unit', opt.unit,
        'guestMin', opt.guest_min,
        'guestMax', opt.guest_max,
        'weekdays', to_jsonb(opt.weekdays),
        'startTime', to_char(opt.local_start_time, 'HH24:MI'),
        'endTime', to_char(opt.local_end_time, 'HH24:MI'),
        'eligibility', CASE WHEN opt.eligibility IS NULL THEN NULL ELSE jsonb_build_object(
          'label', opt.eligibility->>'label',
          'checkAtGate', (opt.eligibility->>'check_at_gate')::boolean) END,
        'busyRules', opt.busy_rules,
        'sortOrder', opt.sort_order,
        'status', opt.status,
        'version', opt.version,
        'priceMinor', price.amount_minor,
        'priceVersionId', price.id
      ) ORDER BY opt.sort_order, opt.created_at)
      FROM public.venue_offer_price_options opt
      LEFT JOIN public.stay_price_versions price
        ON price.price_option_id = opt.id AND price.offering_id = opt.offering_id AND price.effective_to IS NULL
      WHERE opt.offering_id = o.id AND opt.status = 'active'
    ), '[]'::jsonb),
    'policy', (
      SELECT jsonb_build_object(
        'versionId', p.id,
        'cancellationPolicy', p.cancellation_policy,
        'refundLadder', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'minMinutesBefore', (r->>'min_minutes_before')::integer,
            'refundBps', (r->>'refund_bps')::integer) ORDER BY ord)
          FROM jsonb_array_elements(p.refund_ladder) WITH ORDINALITY AS l(r, ord)
        ), '[]'::jsonb),
        'dateChangeRule', jsonb_strip_nulls(jsonb_build_object(
          'allowedUntilMinutesBefore', (p.date_change_rule->>'allowed_until_minutes_before')::integer,
          'feeBps', (p.date_change_rule->>'fee_bps')::integer,
          'maxChanges', (p.date_change_rule->>'max_changes')::integer,
          'guestChangeUntilMinutesBefore', (p.date_change_rule->>'guest_change_until_minutes_before')::integer)),
        'operatorCancelRefundBps', p.operator_cancel_refund_basis_points)
      FROM public.stay_policy_versions p
      WHERE p.offering_id = o.id AND p.effective_to IS NULL
    ),
    'schedule', (
      SELECT jsonb_build_object(
        'ruleId', r.id,
        'mode', CASE r.mode WHEN 'full_day' THEN 'full_day' ELSE 'sessions' END,
        'weekdays', to_jsonb(r.weekdays),
        'startTime', to_char(COALESCE(r.full_day_start_time, r.local_start_time), 'HH24:MI'),
        'endTime', to_char(COALESCE(r.full_day_end_time, r.local_end_time), 'HH24:MI'),
        'sessionMinutes', r.slot_duration_minutes,
        'sessionEveryMinutes', r.slot_interval_minutes,
        'startDate', r.local_start_date,
        'endDate', r.local_end_date,
        'timezone', r.timezone)
      FROM public.stay_place_schedule_rules r
      WHERE r.offering_id = o.id AND r.active
      ORDER BY r.created_at DESC
      LIMIT 1
    ),
    -- #4490 P3: what a package includes, its priced extras and its deposit.
    'inclusions', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'kind', COALESCE(i->>'kind', 'item'),
        'label', i->>'label',
        'qtyPer', i->>'qty_per',
        'menuItemId', i->>'menu_item_id',
        'staffRatio', (i->>'staff_ratio')::integer,
        'options', i->'options')) ORDER BY ord)
      FROM jsonb_array_elements(o.inclusions) WITH ORDINALITY AS inc(i, ord)), '[]'::jsonb),
    'extras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e->>'id', 'name', e->>'name', 'priceMinor', (e->>'price_minor')::bigint, 'per', e->>'per') ORDER BY ord)
      FROM jsonb_array_elements(o.extras) WITH ORDINALITY AS ex(e, ord)), '[]'::jsonb),
    'staffRoleLabel', o.staff_role_label,
    'deposit', jsonb_build_object(
      'kind', o.deposit_kind,
      'value', o.deposit_value,
      'balanceDueDaysBefore', o.balance_due_days_before),
    'payModes', CASE WHEN o.deposit_kind = 'none' THEN '["full"]'::jsonb ELSE '["deposit","full"]'::jsonb END,
    'durationMinutes', (SELECT r.slot_duration_minutes FROM public.stay_place_schedule_rules r
                        WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows'
                        ORDER BY r.created_at DESC LIMIT 1),
    'startTimes', COALESCE((
      SELECT jsonb_agg(st.t ORDER BY st.t) FROM (
      SELECT DISTINCT to_char(r.local_start_time + make_interval(mins => k * r.slot_interval_minutes), 'HH24:MI') AS t
      FROM public.stay_place_schedule_rules r
      CROSS JOIN LATERAL generate_series(0, GREATEST((
        (CASE WHEN r.local_end_time <= r.local_start_time
              THEN extract(epoch FROM (r.local_end_time - r.local_start_time))::integer / 60 + 1440
              ELSE extract(epoch FROM (r.local_end_time - r.local_start_time))::integer / 60 END)
        - r.slot_duration_minutes) / r.slot_interval_minutes, 0)) k
      WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows') st), '[]'::jsonb),
    'readiness', to_jsonb(public.issue_4490_offer_readiness(o.id)),
    -- Warnings never block publish (the gate can still sell).
    'canCollectOnline', public.issue_4490_can_collect_online(o.brand_id, o.venue_id),
    'warnings', to_jsonb(CASE WHEN public.issue_4490_can_collect_online(o.brand_id, o.venue_id)
                              THEN '{}'::text[] ELSE ARRAY['online_payments_off']::text[] END),
    'createdAt', o.created_at,
    'updatedAt', o.updated_at
  )
  FROM public.stay_offerings o
  WHERE o.id = p_offering_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_public_offers(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id,
      'kind', o.kind,
      'entryStyle', o.entry_style,
      'name', o.name,
      'summary', NULLIF(o.summary, ''),
      'fromMinor', (SELECT min(p.amount_minor) FROM public.venue_offer_price_options opt
                    JOIN public.stay_price_versions p ON p.price_option_id = opt.id AND p.effective_to IS NULL
                    WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'unit', COALESCE((SELECT opt.unit FROM public.venue_offer_price_options opt
                        WHERE opt.offering_id = o.id AND opt.status = 'active'
                        ORDER BY opt.sort_order LIMIT 1), 'guest'),
      'guestMin', (SELECT min(opt.guest_min) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'guestMax', (SELECT max(opt.guest_max) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
      'spaceIds', (SELECT jsonb_agg(s.space_id ORDER BY s.space_id) FROM public.venue_offer_spaces s
                   WHERE s.offering_id = o.id),
      'sortOrder', o.sort_order,
      'canCollectOnline', public.issue_4490_can_collect_online(o.brand_id, o.venue_id),
      'durationMinutes', CASE WHEN o.kind = 'group_package' THEN (
        SELECT r.slot_duration_minutes FROM public.stay_place_schedule_rules r
        WHERE r.offering_id = o.id AND r.active ORDER BY r.created_at DESC LIMIT 1) END,
      'payModes', CASE WHEN o.deposit_kind = 'none' THEN '["full"]'::jsonb ELSE '["deposit","full"]'::jsonb END,
      'minNoticeMinutes', o.min_notice_minutes
    ) ORDER BY o.sort_order, o.created_at)
    FROM public.stay_offerings o
    WHERE o.venue_id = p_venue_id AND o.status = 'live'
      AND o.kind = ANY(public.issue_4490_built_offer_kinds())
      AND public.issue_4490_offer_kind_feature(o.kind) = ANY(p_features)
  ), '[]'::jsonb) END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Package authoring (Host). issue_4490_manage_offer keeps create_draft,
--    names, prices, pool, refund ladder, publish / pause / archive; this adds:
--      set_package       inclusions, priced extras, staff role label
--      set_payment       deposit (percent or fixed) and balance due days
--      set_start_times   set start times and length (one rule per start)
--      set_change_rules  move-day / guest-change cut-offs, fee, max changes
--                        (a new policy version; bookings keep their snapshot)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_manage_package(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_items jsonb;
  v_extras jsonb;
  v_kind text;
  v_value bigint;
  v_days integer;
  v_minutes integer;
  v_weekdays smallint[];
  v_start time;
  v_t text;
  v_change jsonb;
  v_next integer;
  v_windows integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('set_package', 'set_payment', 'set_start_times', 'set_change_rules')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'venue', p_venue_id, 'payload', p_payload, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('manage_package:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = NULLIF(p_payload->>'offerId', '')::uuid AND venue_id = p_venue_id
    AND kind NOT IN ('room', 'place')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL OR v_offer.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.status = 'archived' THEN
    RAISE EXCEPTION 'offer_archived' USING ERRCODE = 'PT409';
  END IF;
  IF p_action IN ('set_package', 'set_payment', 'set_start_times') AND v_offer.kind <> 'group_package' THEN
    RAISE EXCEPTION 'offer_kind_invalid' USING ERRCODE = '22023';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);

  IF p_action = 'set_package' THEN
    -- Inclusions: camelCase in, snake_case stored.
    IF jsonb_typeof(COALESCE(p_payload->'inclusions', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'inclusions_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'kind', COALESCE(i->>'kind', 'item'),
        'label', btrim(COALESCE(i->>'label', '')),
        'qty_per', i->>'qtyPer',
        'menu_item_id', i->>'menuItemId',
        'staff_ratio', CASE WHEN COALESCE(i->>'staffRatio', '') ~ '^[0-9]{1,4}$' THEN (i->>'staffRatio')::integer
                            WHEN i ? 'staffRatio' THEN -1 END,
        'options', CASE WHEN i->'options' IS NULL OR i->'options' = 'null'::jsonb THEN NULL
                        WHEN jsonb_typeof(i->'options') = 'array' THEN (
                          SELECT jsonb_agg(CASE WHEN jsonb_typeof(o) = 'string' THEN to_jsonb(btrim(o #>> '{}')) ELSE o END
                                           ORDER BY ord)
                          FROM jsonb_array_elements(i->'options') WITH ORDINALITY AS opt(o, ord))
                        ELSE i->'options' END
      )) ORDER BY ord), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(COALESCE(p_payload->'inclusions', '[]'::jsonb)) WITH ORDINALITY AS inc(i, ord);
    IF NOT public.issue_4490_inclusions_valid(v_items) THEN
      RAISE EXCEPTION 'inclusions_invalid' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_items) i
      WHERE i ? 'menu_item_id' AND NOT EXISTS (
        SELECT 1 FROM public.menu_items mi JOIN public.menus m ON m.id = mi.menu_id
        WHERE mi.id = (i->>'menu_item_id')::uuid AND mi.brand_id = v_offer.brand_id
          AND (m.venue_id IS NULL OR m.venue_id = p_venue_id))
    ) THEN
      RAISE EXCEPTION 'inclusion_menu_item_not_found' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(COALESCE(p_payload->'extras', '[]'::jsonb)) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_payload->'extras', '[]'::jsonb)) e
                  WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'priceMinor') <> 'number') THEN
      RAISE EXCEPTION 'extras_invalid' USING ERRCODE = '22023';
    END IF;
    -- Extras keep their id across edits (bookings point at it); a new one gets
    -- a short id.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', COALESCE(NULLIF(e->>'id', ''), 'x' || substr(md5(gen_random_uuid()::text), 1, 10)),
        'name', btrim(COALESCE(e->>'name', '')),
        'price_minor', e->'priceMinor',
        'per', e->>'per') ORDER BY ord), '[]'::jsonb)
    INTO v_extras
    FROM jsonb_array_elements(COALESCE(p_payload->'extras', '[]'::jsonb)) WITH ORDINALITY AS ex(e, ord);
    IF NOT public.issue_4490_extras_valid(v_extras) THEN
      RAISE EXCEPTION 'extras_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'staffRoleLabel' AND p_payload->'staffRoleLabel' <> 'null'::jsonb
       AND char_length(btrim(COALESCE(p_payload->>'staffRoleLabel', ''))) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'staff_role_label_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_offerings
    SET inclusions = v_items,
        extras = v_extras,
        staff_role_label = CASE WHEN p_payload ? 'staffRoleLabel'
                                THEN NULLIF(btrim(COALESCE(p_payload->>'staffRoleLabel', '')), '')
                                ELSE staff_role_label END,
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_payment' THEN
    v_kind := COALESCE(p_payload->>'depositKind', '');
    IF v_kind NOT IN ('none', 'percent', 'fixed') THEN
      RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_kind <> 'none' THEN
      IF COALESCE(p_payload->>'depositValue', '') !~ '^[0-9]{1,12}$'
         OR COALESCE(p_payload->>'balanceDueDaysBefore', '') !~ '^[0-9]{1,3}$'
         OR (p_payload->>'balanceDueDaysBefore')::integer > 365 THEN
        RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
      END IF;
      v_value := (p_payload->>'depositValue')::bigint;
      v_days := (p_payload->>'balanceDueDaysBefore')::integer;
      IF (v_kind = 'percent' AND v_value NOT BETWEEN 1 AND 9999) OR (v_kind = 'fixed' AND v_value < 1) THEN
        RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
      END IF;
    END IF;
    UPDATE public.stay_offerings
    SET deposit_kind = v_kind,
        deposit_value = CASE WHEN v_kind = 'none' THEN NULL ELSE v_value END,
        balance_due_days_before = CASE WHEN v_kind = 'none' THEN NULL ELSE v_days END,
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_start_times' THEN
    IF jsonb_typeof(p_payload->'startTimes') <> 'array'
       OR jsonb_array_length(p_payload->'startTimes') NOT BETWEEN 1 AND 24
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'startTimes') t
                  WHERE t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
       OR (SELECT count(DISTINCT t) FROM jsonb_array_elements_text(p_payload->'startTimes') t)
          <> jsonb_array_length(p_payload->'startTimes') THEN
      RAISE EXCEPTION 'schedule_times_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'durationMinutes', '') !~ '^[0-9]{1,4}$'
       OR (p_payload->>'durationMinutes')::integer NOT BETWEEN 15 AND 1440 THEN
      RAISE EXCEPTION 'schedule_sessions_invalid' USING ERRCODE = '22023';
    END IF;
    v_minutes := (p_payload->>'durationMinutes')::integer;
    IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
      RAISE EXCEPTION 'schedule_weekdays_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    -- Retire the old rules: future windows with nothing held or sold stop selling.
    UPDATE public.stay_place_windows w
    SET stop_sell = true, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE w.offering_id = v_offer.id AND w.starts_at > now() AND NOT w.stop_sell
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        WHERE s.place_window_id = w.id AND h.state IN ('active', 'reconciliation_required'))
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_inventory_commitments c
        WHERE c.place_window_id = w.id AND c.state = 'active');
    UPDATE public.stay_place_schedule_rules
    SET active = false, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE offering_id = v_offer.id AND active;
    FOR v_t IN SELECT t FROM jsonb_array_elements_text(p_payload->'startTimes') t ORDER BY t
    LOOP
      v_start := v_t::time;
      INSERT INTO public.stay_place_schedule_rules (
        offering_id, brand_id, venue_id, mode, timezone, local_start_date, local_end_date, weekdays,
        local_start_time, local_end_time, slot_duration_minutes, slot_interval_minutes,
        full_day_start_time, full_day_end_time, created_by, updated_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, v_offer.venue_id, 'repeating_windows', v_settings.timezone,
        COALESCE(NULLIF(p_payload->>'startDate', '')::date, (now() AT TIME ZONE v_settings.timezone)::date),
        NULLIF(p_payload->>'endDate', '')::date,
        v_weekdays, v_start, v_start + make_interval(mins => v_minutes), v_minutes, v_minutes,
        NULL, NULL, v_uid, v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    IF v_offer.status = 'live' THEN
      v_windows := public.issue_4490_materialize_offer_windows(v_offer.id);
    END IF;

  ELSIF p_action = 'set_change_rules' THEN
    SELECT * INTO v_policy FROM public.stay_policy_versions
    WHERE offering_id = v_offer.id AND effective_to IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_not_ready:no_policy' USING ERRCODE = 'P0001';
    END IF;
    IF (p_payload ? 'allowedUntilMinutesBefore' AND p_payload->'allowedUntilMinutesBefore' <> 'null'::jsonb
        AND COALESCE(p_payload->>'allowedUntilMinutesBefore', '') !~ '^[0-9]{1,7}$')
       OR (p_payload ? 'guestChangeUntilMinutesBefore' AND p_payload->'guestChangeUntilMinutesBefore' <> 'null'::jsonb
        AND COALESCE(p_payload->>'guestChangeUntilMinutesBefore', '') !~ '^[0-9]{1,7}$')
       OR (p_payload ? 'feeBps' AND p_payload->'feeBps' <> 'null'::jsonb
        AND (COALESCE(p_payload->>'feeBps', '') !~ '^[0-9]{1,5}$' OR (p_payload->>'feeBps')::integer > 10000))
       OR (p_payload ? 'maxChanges' AND p_payload->'maxChanges' <> 'null'::jsonb
        AND COALESCE(p_payload->>'maxChanges', '') !~ '^[0-9]{1,2}$') THEN
      RAISE EXCEPTION 'date_change_rule_invalid' USING ERRCODE = '22023';
    END IF;
    v_change := jsonb_strip_nulls(jsonb_build_object(
      'allowed_until_minutes_before', NULLIF(p_payload->>'allowedUntilMinutesBefore', '')::integer,
      'fee_bps', NULLIF(p_payload->>'feeBps', '')::integer,
      'max_changes', NULLIF(p_payload->>'maxChanges', '')::integer,
      'guest_change_until_minutes_before', NULLIF(p_payload->>'guestChangeUntilMinutesBefore', '')::integer));
    UPDATE public.stay_policy_versions SET effective_to = now() WHERE id = v_policy.id;
    SELECT COALESCE(max(version_number), 0) + 1 INTO v_next
    FROM public.stay_policy_versions WHERE offering_id = v_offer.id;
    INSERT INTO public.stay_policy_versions (
      offering_id, brand_id, venue_id, version_number, cancellation_policy,
      free_cancel_cutoff_minutes, late_refund_basis_points, no_show_refund_basis_points,
      operator_cancel_refund_basis_points, refund_ladder, date_change_rule, created_by
    ) VALUES (
      v_offer.id, v_offer.brand_id, v_offer.venue_id, v_next, v_policy.cancellation_policy,
      v_policy.free_cancel_cutoff_minutes, v_policy.late_refund_basis_points, v_policy.no_show_refund_basis_points,
      v_policy.operator_cancel_refund_basis_points, v_policy.refund_ladder, v_change, v_uid
    );
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  END IF;

  v_result := public.issue_4490_offer_projection(v_offer.id) || jsonb_build_object('windowsCreated', v_windows);
  PERFORM public.issue_4490_receipt_store('manage_package:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Quote: extras and answers (packages); the quote shows the pay plan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_quote_projection(p_quote_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'quoteId', q.id,
    'version', q.version,
    'status', q.status,
    'mode', q.mode,
    'offerKind', q.offer_kind,
    'venueId', q.venue_id,
    'currencyCode', q.currency_code,
    'subtotalMinor', q.source_subtotal_minor,
    'feeMinor', q.fee_total_minor,
    'taxMinor', q.tax_total_minor,
    'totalMinor', q.total_minor,
    'expiresAt', q.expires_at,
    'window', (
      SELECT jsonb_build_object('windowId', w.id, 'localDate', w.local_date, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
      FROM public.stay_quote_lines l JOIN public.stay_place_windows w ON w.id = l.place_window_id
      WHERE l.quote_id = q.id LIMIT 1),
    'vat', (
      SELECT jsonb_build_object(
        'mode', CASE WHEN fee.id IS NULL THEN 'none' WHEN fee.included_in_base THEN 'included' ELSE 'added' END,
        'ratePct', CASE WHEN fee.id IS NULL THEN 0 ELSE (fee.snapshot->>'basis_points')::numeric / 100 END,
        'amountMinor', COALESCE(sum(fee.amount_minor), 0))
      FROM public.stay_quote_lines l
      LEFT JOIN public.stay_quote_fee_lines fee ON fee.quote_line_id = l.id AND fee.fee_kind = 'tax'
      WHERE l.quote_id = q.id
      GROUP BY fee.id IS NULL, fee.included_in_base, fee.snapshot->>'basis_points'
      ORDER BY (fee.id IS NULL) LIMIT 1),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id,
        'priceOptionId', l.price_option_id,
        'name', l.price_snapshot->>'optionName',
        'guests', l.place_guests,
        'unitPriceMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
        'baseMinor', l.base_minor,
        'taxMinor', l.tax_minor,
        'feeMinor', l.fee_minor,
        'totalMinor', l.total_minor,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel',
        'packageMinor', (l.price_snapshot->>'packageMinor')::bigint,
        'extrasMinor', (l.price_snapshot->>'extrasMinor')::bigint
      ) ORDER BY (l.price_snapshot->>'sortOrder')::integer, l.id)
      FROM public.stay_quote_lines l WHERE l.quote_id = q.id), '[]'::jsonb),
    -- #4490 P3: extras, answers, and what can be paid now.
    'extras', COALESCE((SELECT l.price_snapshot->'extras' FROM public.stay_quote_lines l
                        WHERE l.quote_id = q.id ORDER BY l.id LIMIT 1), '[]'::jsonb),
    'answers', COALESCE((SELECT l.price_snapshot->'answers' FROM public.stay_quote_lines l
                         WHERE l.quote_id = q.id ORDER BY l.id LIMIT 1), '{}'::jsonb),
    'payPlan', (SELECT public.issue_4490_deposit_plan(l.offering_id, l.place_window_id, q.total_minor)
                FROM public.stay_quote_lines l WHERE l.quote_id = q.id ORDER BY l.id LIMIT 1),
    'policy', (
      SELECT jsonb_build_object(
        'text', l.policy_snapshot->>'cancellation_policy',
        'refundLadder', l.policy_snapshot->'refund_ladder',
        'dateChangeRule', l.policy_snapshot->'date_change_rule')
      FROM public.stay_quote_lines l WHERE l.quote_id = q.id LIMIT 1)
  )
  FROM public.stay_quotes q WHERE q.id = p_quote_id;
$function$;

DROP FUNCTION public.issue_4490_quote_offer(uuid, uuid, jsonb, text, uuid, text);
DROP FUNCTION public.issue_4490_quote_offer_internal(uuid, uuid, jsonb, text, uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.issue_4490_quote_offer_internal(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_gate boolean,
  p_extras jsonb DEFAULT '[]'::jsonb,
  p_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_existing public.stay_quotes%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_usage record;
  v_quote_id uuid := gen_random_uuid();
  v_line_id uuid;
  v_request_hash text;
  v_currency text;
  v_item jsonb;
  v_guests integer;
  v_total_guests integer := 0;
  v_unit bigint;
  v_base bigint;
  v_tax bigint;
  v_reason text;
  v_remaining integer;
  v_total bigint;
  v_last date;
  v_extras jsonb := '[]'::jsonb;
  v_extras_minor bigint := 0;
  v_answers jsonb := '{}'::jsonb;
BEGIN
  IF p_offering_id IS NULL OR p_window_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) item
    WHERE jsonb_typeof(item) <> 'object'
       OR COALESCE(item->>'priceOptionId', '') !~ '^[0-9a-f-]{36}$'
       OR jsonb_typeof(item->'guests') <> 'number'
       OR (item->>'guests') !~ '^[0-9]{1,4}$'
       OR (item->>'guests')::integer NOT BETWEEN 1 AND 1000
  ) OR (SELECT count(DISTINCT item->>'priceOptionId') FROM jsonb_array_elements(p_lines) item)
       <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  -- #4490 P3: extras [{id, qty}] and the answers to "guests choose one".
  IF jsonb_typeof(COALESCE(p_extras, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_extras, '[]'::jsonb)) > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
                WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') !~ '^[a-z0-9][a-z0-9-]{0,39}$'
                   OR (e ? 'qty' AND (COALESCE(e->>'qty', '') !~ '^[0-9]{1,3}$' OR (e->>'qty')::integer NOT BETWEEN 1 AND 100)))
     OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e)
        <> jsonb_array_length(COALESCE(p_extras, '[]'::jsonb))
     OR jsonb_typeof(COALESCE(p_answers, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'offering', p_offering_id, 'window', p_window_id, 'lines', p_lines,
    'extras', COALESCE(p_extras, '[]'::jsonb), 'answers', COALESCE(p_answers, '{}'::jsonb))::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-quote:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_quotes
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_4490_quote_projection(v_existing.id);
  END IF;

  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind NOT IN ('room', 'place');
  IF NOT FOUND OR v_offer.status <> 'live'
     OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = p_window_id AND offering_id = v_offer.id;
  IF NOT FOUND OR v_window.stop_sell THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' AND NOT p_gate THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_last := (now() AT TIME ZONE v_settings.timezone)::date
    + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730));
  IF v_window.local_date > v_last THEN
    RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
  END IF;
  IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
    RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
  IF COALESCE(v_usage.closed, true) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_policy FROM public.stay_policy_versions
  WHERE offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_offer.brand_id;
  -- A group package is one party: one price option per booking.
  IF v_offer.kind = 'group_package' AND jsonb_array_length(p_lines) <> 1 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  -- Extras must be the offer's own; every "guests choose one" needs one of its
  -- options; nothing else may be answered.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.extras) x WHERE x->>'id' = e->>'id')) THEN
    RAISE EXCEPTION 'offer_extra_unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.inclusions) i
             WHERE i->>'kind' = 'choice'
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(i->'options') o
                               WHERE o = COALESCE(p_answers->>(i->>'label'), '')))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_answers, '{}'::jsonb)) k
                WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.inclusions) i
                                  WHERE i->>'kind' = 'choice' AND i->>'label' = k)) THEN
    RAISE EXCEPTION 'offer_answer_required' USING ERRCODE = '22023';
  END IF;
  v_answers := COALESCE(p_answers, '{}'::jsonb);

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_quote_id, p_user_id, p_actor_key, v_offer.venue_id, v_offer.brand_id, v_currency,
    'instant', 'building', 0, 0, 0, 0,
    v_request_hash, repeat('0', 64), repeat('0', 64), repeat('0', 64),
    btrim(p_idempotency_key), now() + interval '15 minutes', v_offer.kind
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY value->>'priceOptionId'
  LOOP
    v_guests := (v_item->>'guests')::integer;
    SELECT * INTO v_option FROM public.venue_offer_price_options
    WHERE id = (v_item->>'priceOptionId')::uuid AND offering_id = v_offer.id AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
    END IF;
    v_reason := public.issue_4490_option_window_reason(v_option.id, v_window.id);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION 'offer_%', v_reason USING ERRCODE = 'PT409';
    END IF;
    IF v_guests < v_option.guest_min OR v_guests > v_option.guest_max THEN
      RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_price FROM public.stay_price_versions
    WHERE price_option_id = v_option.id AND offering_id = v_offer.id AND effective_to IS NULL;
    IF NOT FOUND OR v_price.currency_code <> v_currency THEN
      RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
    END IF;
    v_unit := public.issue_4490_option_price_at(v_option.id, v_window.id);
    v_base := CASE v_option.unit WHEN 'guest' THEN v_unit * v_guests ELSE v_unit END;
    -- Extras ride on the (single) package line: per booking x qty, per guest x guests.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', x->>'id', 'name', x->>'name', 'per', x->>'per',
             'unitPriceMinor', (x->>'price_minor')::bigint,
             'qty', CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END,
             'amountMinor', (x->>'price_minor')::bigint
                * CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END)
             ORDER BY x->>'name'), '[]'::jsonb)
    INTO v_extras
    FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
    JOIN jsonb_array_elements(v_offer.extras) x ON x->>'id' = e->>'id';
    SELECT COALESCE(sum((x->>'amountMinor')::bigint), 0) INTO v_extras_minor FROM jsonb_array_elements(v_extras) x;
    v_base := v_base + v_extras_minor;
    IF v_base > 9000000000000000 THEN
      RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
    END IF;
    v_total_guests := v_total_guests + v_guests;
    v_line_id := gen_random_uuid();
    INSERT INTO public.stay_quote_lines (
      id, quote_id, offering_id, kind, confirmation_mode, place_window_id, place_guests,
      base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id,
      offering_version, inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot,
      price_option_id
    ) VALUES (
      v_line_id, v_quote_id, v_offer.id, v_offer.kind, 'instant', v_window.id, v_guests,
      v_base, 0, 0, v_base, v_price.id, v_policy.id, v_offer.version,
      jsonb_build_object('resources', jsonb_build_array(jsonb_build_object(
        'resourceType', 'place_window', 'windowId', v_window.id, 'version', v_window.version)),
        'poolId', v_offer.capacity_pool_id, 'localDate', v_window.local_date),
      jsonb_build_object('name', v_offer.name, 'kind', v_offer.kind, 'entryStyle', v_offer.entry_style,
        'venueId', v_offer.venue_id),
      jsonb_build_object('optionName', v_option.name, 'unit', v_option.unit, 'unitPriceMinor', v_unit,
        'listPriceMinor', v_price.amount_minor, 'currencyCode', v_currency, 'sortOrder', v_option.sort_order,
        'idCheckLabel', CASE WHEN COALESCE((v_option.eligibility->>'check_at_gate')::boolean, false)
                             THEN v_option.eligibility->>'label' END,
        'eligibilityLabel', v_option.eligibility->>'label',
        'packageMinor', v_base - v_extras_minor,
        'extras', v_extras,
        'extrasMinor', v_extras_minor,
        'answers', v_answers),
      to_jsonb(v_policy) - 'created_by',
      v_option.id
    );
    FOR v_fee IN
      SELECT * FROM public.stay_fee_versions
      WHERE offering_id = v_offer.id AND effective_to IS NULL
      ORDER BY fee_key, id
    LOOP
      v_tax := CASE
        WHEN v_fee.calculation = 'percentage_of_line_base' AND v_fee.display_mode = 'included'
          THEN round(v_base::numeric * v_fee.basis_points / (10000 + v_fee.basis_points))::bigint
        WHEN v_fee.calculation = 'percentage_of_line_base'
          THEN round(v_base::numeric * v_fee.basis_points / 10000)::bigint
        WHEN v_fee.calculation = 'fixed_per_place_booking' THEN v_fee.amount_minor
        WHEN v_fee.calculation = 'fixed_per_place_guest' THEN v_fee.amount_minor * v_guests
        ELSE 0 END;
      INSERT INTO public.stay_quote_fee_lines (
        quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor,
        included_in_base, refund_treatment, snapshot
      ) VALUES (
        v_quote_id, v_line_id, v_fee.id, v_fee.label, v_fee.fee_kind, v_tax,
        v_fee.display_mode = 'included', v_fee.refund_treatment, to_jsonb(v_fee)
      );
    END LOOP;
  END LOOP;

  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor,
      tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_quote_id GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;

  -- Capacity (not locked here; the hold re-checks under the pool lock).
  v_remaining := COALESCE(CASE WHEN p_gate THEN v_usage.gate_left ELSE v_usage.online_left END, 0);
  IF v_offer.entry_style = 'timed_session' THEN
    v_remaining := LEAST(v_remaining, GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
  END IF;
  IF v_total_guests > v_remaining THEN
    RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('remaining', v_remaining)::text;
  END IF;

  SELECT sum(total_minor) INTO v_total FROM public.stay_quote_lines WHERE quote_id = v_quote_id;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = totals.base, fee_total_minor = totals.fee,
      tax_total_minor = totals.tax, total_minor = totals.total,
      price_revision_set_hash = (
        SELECT encode(pg_catalog.sha256(convert_to(string_agg(
          l.price_version_id::text || ':' || l.price_snapshot::text, '|' ORDER BY l.price_option_id), 'UTF8')), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id),
      inventory_revision_set_hash = (
        SELECT encode(pg_catalog.sha256(convert_to(string_agg(
          l.offering_id::text || ':' || l.offering_version::text || ':' || l.inventory_snapshot::text,
          '|' ORDER BY l.price_option_id), 'UTF8')), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id),
      policy_snapshot_hash = (
        SELECT encode(pg_catalog.sha256(convert_to(string_agg(
          l.policy_version_id::text || ':' || l.policy_snapshot::text, '|' ORDER BY l.price_option_id), 'UTF8')), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id)
  FROM (
    SELECT sum(base_minor) AS base, sum(fee_minor) AS fee, sum(tax_minor) AS tax, sum(total_minor) AS total
    FROM public.stay_quote_lines WHERE quote_id = v_quote_id
  ) totals
  WHERE q.id = v_quote_id;

  RETURN public.issue_4490_quote_projection(v_quote_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_quote_offer(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_extras jsonb DEFAULT '[]'::jsonb,
  p_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_quote_offer_internal(
    p_offering_id, p_window_id, p_lines, p_actor_key, p_user_id, p_idempotency_key, false, p_extras, p_answers);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Hold: the deposit plan and the answers are frozen on the booking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_hold_offer_internal(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text,
  p_gate boolean,
  p_staff_user_id uuid,
  p_payment_collection text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quote public.stay_quotes%ROWTYPE;
  v_existing public.stay_reservation_groups%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_usage record;
  v_request_hash text;
  v_hold_id uuid := gen_random_uuid();
  v_needed integer;
  v_left integer;
  v_hold_expires timestamptz;
  v_policy jsonb;
  v_reservation_line uuid;
  v_plan jsonb;
BEGIN
  IF p_group_id IS NULL OR p_quote_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR (NOT p_gate AND (p_buyer_token_hash IS NULL OR octet_length(p_buyer_token_hash) <> 32)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM public.issue_4490_assert_offer_guest(p_guest, NOT p_gate);
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'quoteId', p_quote_id, 'guest', p_guest)::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-group:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_reservation_groups
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash OR v_existing.offer_kind IS NULL THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_quote FROM public.stay_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash <> p_actor_key OR v_quote.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' THEN
      UPDATE public.stay_quotes SET status = 'expired', version = version + 1 WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'offer_quote_expired' USING ERRCODE = 'PT409';
  END IF;

  -- Lock order: brand, offering, window, pool (+ override), then slices.
  PERFORM 1 FROM public.brands WHERE id = v_quote.brand_id FOR UPDATE;
  SELECT * INTO v_line FROM public.stay_quote_lines WHERE quote_id = v_quote.id ORDER BY id LIMIT 1;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id FOR UPDATE;
  IF v_offer.status <> 'live'
     OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stay_quote_lines l
    WHERE l.quote_id = v_quote.id
      AND (l.offering_version <> v_offer.version
           OR NOT EXISTS (SELECT 1 FROM public.stay_price_versions p
                          WHERE p.id = l.price_version_id AND p.effective_to IS NULL)
           OR NOT EXISTS (SELECT 1 FROM public.stay_policy_versions p
                          WHERE p.id = l.policy_version_id AND p.effective_to IS NULL))
  ) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = v_line.place_window_id FOR UPDATE;
  IF v_window.stop_sell OR now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id)
     OR (p_gate AND v_window.local_date <> (now() AT TIME ZONE public.issue_4490_venue_timezone(v_offer.venue_id))::date) THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' AND NOT p_gate THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.capacity_pool_id IS NOT NULL THEN
    PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id FOR UPDATE;
    PERFORM 1 FROM public.venue_capacity_overrides
    WHERE pool_id = v_offer.capacity_pool_id AND local_date = v_window.local_date FOR UPDATE;
  END IF;
  -- Lapsed holds stop counting (the sweep still owns their state change).
  SELECT sum(place_guests) INTO v_needed FROM public.stay_quote_lines WHERE quote_id = v_quote.id;
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
  IF COALESCE(v_usage.closed, true) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_left := CASE WHEN p_gate THEN v_usage.gate_left ELSE v_usage.online_left END;
  IF v_offer.entry_style = 'timed_session' THEN
    v_left := LEAST(v_left, GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
  END IF;
  IF v_needed > v_left THEN
    RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('remaining', v_left)::text;
  END IF;
  IF p_payment_collection = 'mingla' AND (
       NOT public.pg_brand_can_collect(v_quote.brand_id)
       OR NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = v_quote.brand_id
                      AND upper(b.default_currency) = v_quote.currency_code)) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  v_hold_expires := now() + make_interval(mins => v_settings.instant_payment_hold_minutes);
  v_policy := v_line.policy_snapshot;
  -- #4490 P3: the deposit plan is fixed when the booking is made.
  v_plan := public.issue_4490_deposit_plan(v_offer.id, v_window.id, v_quote.total_minor);
  IF p_gate THEN
    v_plan := jsonb_build_object('payModes', jsonb_build_array('full'), 'depositMinor', NULL, 'balanceDueAt', NULL,
      'depositKind', 'none', 'depositValue', NULL, 'collapsed', NULL);
  END IF;
  IF p_gate THEN
    PERFORM set_config('mingla.issue_4490_gate_sale', p_group_id::text, true);
  END IF;
  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, state, request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash, offer_kind, buyer_token_hash, payment_plan_snapshot,
    booking_source, payment_collection, created_by_staff_user_id,
    deposit_minor, balance_due_at, booking_answers
  ) VALUES (
    p_group_id,
    'VB-' || upper(substr(replace(p_group_id::text, '-', ''), 1, 20)),
    v_quote.id, p_user_id, p_actor_key, v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    'instant', 'instant_payment_pending', NULL, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(p_guest->>'name'),
      'email', NULLIF(lower(btrim(COALESCE(p_guest->>'email', ''))), ''),
      'phone', NULLIF(btrim(COALESCE(p_guest->>'phone', '')), ''),
      'phoneCountryIso', NULLIF(p_guest->>'phoneCountryIso', ''))),
    v_quote.source_subtotal_minor, v_quote.fee_total_minor, v_quote.tax_total_minor, v_quote.total_minor,
    btrim(p_idempotency_key), v_request_hash, v_quote.offer_kind, p_buyer_token_hash,
    jsonb_build_object(
      'stagePlan', CASE WHEN v_plan->>'depositMinor' IS NOT NULL THEN 'deposit_or_full' ELSE 'full' END,
      'depositKind', COALESCE(v_plan->>'depositKind', 'none'),
      'depositValue', (v_plan->>'depositValue')::bigint,
      'depositMinor', (v_plan->>'depositMinor')::bigint,
      'balanceDueAt', v_plan->>'balanceDueAt',
      'payModes', v_plan->'payModes',
      'currencyCode', v_quote.currency_code,
      'vatMode', v_settings.vat_mode,
      'refundLadder', COALESCE(v_policy->'refund_ladder', '[]'::jsonb),
      'dateChangeRule', COALESCE(v_policy->'date_change_rule', '{}'::jsonb),
      'policyText', v_policy->>'cancellation_policy',
      'operatorCancelRefundBps', (v_policy->>'operator_cancel_refund_basis_points')::integer,
      'damageDepositMinor', 0,
      'minSpendMinor', 0,
      'localDate', v_window.local_date),
    CASE WHEN p_gate THEN 'walk_in' ELSE 'guest' END,
    p_payment_collection,
    p_staff_user_id,
    (v_plan->>'depositMinor')::bigint,
    (v_plan->>'balanceDueAt')::timestamptz,
    COALESCE(v_line.price_snapshot->'answers', '{}'::jsonb)
  );
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_units, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id, booked_minutes
  )
  SELECT gen_random_uuid(), p_group_id, l.id, l.offering_id, l.kind, 'payment_pending', l.place_window_id,
         l.place_units, l.place_guests, 0, 0, l.base_minor, l.fee_minor, l.tax_minor, l.total_minor,
         l.offering_snapshot, l.price_snapshot, l.policy_snapshot, l.price_option_id, l.booked_minutes
  FROM public.stay_quote_lines l WHERE l.quote_id = v_quote.id ORDER BY l.price_option_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, p_group_id, 'active', v_hold_expires,
          CASE WHEN p_gate THEN 'gate_sale' ELSE 'instant_payment' END);
  INSERT INTO public.stay_inventory_hold_slices (
    hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
  )
  SELECT v_hold_id, r.id, 'place_window', r.offering_id, r.place_window_id, r.place_guests
  FROM public.stay_reservation_lines r WHERE r.group_id = p_group_id ORDER BY r.id;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, CASE WHEN p_gate THEN 'stay_offer_gate_sale' ELSE 'stay_offer_hold_created' END,
    CASE WHEN p_gate THEN 'staff' ELSE 'guest' END,
    COALESCE(p_staff_user_id, p_user_id),
    'offer-hold:' || btrim(p_idempotency_key),
    jsonb_build_object('holdExpiresAt', v_hold_expires, 'guests', v_needed, 'localDate', v_window.local_date)
  );
  RETURN p_group_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Pay: stage deposit ("Half now") or full ("All now") while on hold;
--     stage balance once confirmed with money owed. Allocations split the
--     amount over what is still outstanding on each line component (base,
--     then fee, then tax on ties) by largest remainder.
-- ---------------------------------------------------------------------------
-- What each line component can still take: its booked amount plus applied
-- changes, less what earlier live payments already allocated to it.
CREATE OR REPLACE FUNCTION public.issue_4490_payment_components(p_group_id uuid)
RETURNS TABLE (
  reservation_line_id uuid,
  component text,
  component_ref text,
  refund_treatment text,
  snapshot jsonb,
  cap_minor bigint,
  allocated_minor bigint,
  outstanding_minor bigint,
  sort_key integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH first_line AS (
    SELECT l.id FROM public.stay_reservation_lines l WHERE l.group_id = p_group_id ORDER BY l.created_at, l.id LIMIT 1
  ), deltas AS (
    SELECT COALESCE(a.reservation_line_id, (SELECT id FROM first_line)) AS line_id,
           sum(a.price_delta_minor + a.policy_fee_minor) AS base_delta,
           sum(a.tax_delta_minor) AS tax_delta
    FROM public.venue_booking_amendments a
    WHERE a.group_id = p_group_id AND a.state = 'applied'
    GROUP BY 1
  ), taxes AS (
    SELECT l.id AS line_id, fee.id, fee.fee_kind, fee.amount_minor, fee.refund_treatment, fee.snapshot,
           row_number() OVER (PARTITION BY l.id ORDER BY (fee.fee_kind = 'tax') DESC, fee.id) AS rn
    FROM public.stay_reservation_lines l
    JOIN public.stay_quote_fee_lines fee ON fee.quote_line_id = l.quote_line_id
    WHERE l.group_id = p_group_id AND NOT fee.included_in_base
  ), caps AS (
    SELECT l.id AS line_id, 'base'::text AS component, 'base'::text AS ref, 'same_as_line'::text AS treatment,
           jsonb_build_object('policy', l.policy_snapshot) AS snapshot,
           l.base_minor + COALESCE(d.base_delta, 0) AS cap, 1 AS sort_key
    FROM public.stay_reservation_lines l
    LEFT JOIN deltas d ON d.line_id = l.id
    WHERE l.group_id = p_group_id AND l.state <> 'cancelled'
    UNION ALL
    SELECT t.line_id, CASE t.fee_kind WHEN 'tax' THEN 'tax' ELSE 'fee' END, t.id::text, t.refund_treatment, t.snapshot,
           t.amount_minor + CASE WHEN t.rn = 1 AND t.fee_kind = 'tax' THEN COALESCE(d.tax_delta, 0) ELSE 0 END,
           CASE t.fee_kind WHEN 'tax' THEN 3 ELSE 2 END
    FROM taxes t
    JOIN public.stay_reservation_lines l ON l.id = t.line_id AND l.state <> 'cancelled'
    LEFT JOIN deltas d ON d.line_id = t.line_id
  ), allocated AS (
    SELECT al.reservation_line_id, al.component, al.component_ref,
           sum(al.charged_minor - al.refunded_minor - COALESCE((
             SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
             JOIN public.stay_refunds rr ON rr.id = ra.refund_id
             WHERE ra.payment_allocation_id = al.id
               AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0)) AS amount
    FROM public.stay_payment_allocations al
    JOIN public.stay_payment_attempts a ON a.id = al.payment_attempt_id
    WHERE a.group_id = p_group_id AND a.state IN ('succeeded', 'pending', 'ambiguous')
    GROUP BY 1, 2, 3
  )
  SELECT c.line_id, c.component, c.ref, c.treatment, c.snapshot, c.cap,
         COALESCE(x.amount, 0)::bigint,
         GREATEST(c.cap - COALESCE(x.amount, 0), 0)::bigint,
         c.sort_key
  FROM caps c
  LEFT JOIN allocated x ON x.reservation_line_id = c.line_id AND x.component = c.component AND x.component_ref = c.ref;
$function$;

DROP FUNCTION public.issue_4490_prepare_offer_payment(uuid, bytea, uuid, text, bigint);
CREATE OR REPLACE FUNCTION public.issue_4490_prepare_offer_payment(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_idempotency_key text,
  p_expected_version bigint,
  p_pay_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_money record;
  v_provider text;
  v_account text;
  v_currency text;
  v_take_rate integer;
  v_app_fee bigint;
  v_ordinal integer;
  v_request_hash text;
  v_cutover timestamptz;
  v_readiness bigint;
  v_stage text;
  v_amount bigint;
  v_outstanding bigint;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_expected_version IS NULL
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR (p_pay_mode IS NOT NULL AND p_pay_mode NOT IN ('deposit', 'full')) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('offer-payment:' || p_group_id::text || ':' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_attempt FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND idempotency_key = btrim(p_idempotency_key) FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> encode(pg_catalog.sha256(convert_to(jsonb_build_object(
         'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_attempt.stage,
         'amountMinor', v_attempt.amount_minor::text)::text, 'UTF8')), 'hex')
       -- P2 attempts hashed without the amount.
       AND v_attempt.request_hash <> encode(pg_catalog.sha256(convert_to(jsonb_build_object(
         'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_attempt.stage)::text, 'UTF8')), 'hex') THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', v_attempt.stage);
  END IF;
  IF v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stay_payment_attempts a
    WHERE a.group_id = p_group_id AND a.state IN ('pending', 'ambiguous')
  ) THEN
    RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
  END IF;

  IF v_group.state = 'instant_payment_pending' THEN
    IF v_group.payment_collection <> 'mingla' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_hold FROM public.stay_inventory_holds WHERE group_id = p_group_id FOR UPDATE;
    IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
      RAISE EXCEPTION 'offer_hold_expired' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = p_group_id AND a.state = 'succeeded') THEN
      RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
    END IF;
    IF p_pay_mode = 'deposit' THEN
      IF v_group.deposit_minor IS NULL OR v_group.balance_due_at IS NULL OR v_group.balance_due_at <= now() THEN
        RAISE EXCEPTION 'offer_pay_mode_unavailable' USING ERRCODE = '22023';
      END IF;
      v_stage := 'deposit';
      v_amount := v_group.deposit_minor;
    ELSE
      v_stage := 'full';
      v_amount := v_group.total_minor;
    END IF;
  ELSIF v_group.state IN ('confirmed', 'partially_cancelled') THEN
    SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);
    IF COALESCE(v_money.balance, 0) <= 0 THEN
      RAISE EXCEPTION 'offer_nothing_to_pay' USING ERRCODE = 'PT409';
    END IF;
    v_stage := 'balance';
    v_amount := v_money.balance;
  ELSE
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF v_amount > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_stage,
    'amountMinor', v_amount::text)::text, 'UTF8')), 'hex');
  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack' THEN pricing.paystack_subaccount_code ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency),
    pricing.effective_take_rate_bps
  INTO v_provider, v_account, v_currency, v_take_rate
  FROM public.resolve_brand_pricing_inputs(v_group.brand_id, v_group.venue_id) pricing
  LIMIT 1;
  SELECT b.payout_hold_cutover_at, b.discovery_currency_state_version INTO v_cutover, v_readiness
  FROM public.brands b WHERE b.id = v_group.brand_id;
  IF v_provider IS NULL
     OR v_currency IS DISTINCT FROM v_group.currency_code::text
     OR NOT public.pg_brand_can_collect(v_group.brand_id)
     OR v_cutover IS NULL
     OR (v_provider = 'stripe' AND v_account IS NULL)
     OR (v_provider = 'paystack' AND v_currency <> 'NGN')
     OR (v_provider = 'paystack' AND NULLIF(v_group.guest_snapshot->>'email', '') IS NULL) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(sum(c.outstanding_minor), 0) INTO v_outstanding
  FROM public.issue_4490_payment_components(p_group_id) c;
  IF v_outstanding < v_amount THEN
    RAISE EXCEPTION 'offer_payment_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  v_app_fee := LEAST(v_amount, round(v_amount::numeric * COALESCE(v_take_rate, 0) / 10000)::bigint);
  SELECT COALESCE(max(attempt_ordinal), 0) + 1 INTO v_ordinal
  FROM public.stay_payment_attempts WHERE group_id = p_group_id;
  PERFORM set_config('mingla.issue_4490_offer_rail', p_group_id::text, true);
  INSERT INTO public.stay_payment_attempts (
    group_id, provider, attempt_ordinal, connected_account_ref, amount_minor, currency_code,
    application_fee_minor, state, idempotency_key, request_hash, readiness_revision, stage
  ) VALUES (
    p_group_id, v_provider, v_ordinal, v_account, v_amount, v_group.currency_code,
    v_app_fee, 'created', btrim(p_idempotency_key), v_request_hash, COALESCE(v_readiness, 1), v_stage
  ) RETURNING * INTO v_attempt;
  WITH comp AS (
    SELECT * FROM public.issue_4490_payment_components(p_group_id) WHERE outstanding_minor > 0
  ), tot AS (
    SELECT sum(outstanding_minor) AS s FROM comp
  ), fl AS (
    SELECT comp.*,
      floor(v_amount::numeric * comp.outstanding_minor / tot.s)::bigint AS f,
      (v_amount::numeric * comp.outstanding_minor)
        - floor(v_amount::numeric * comp.outstanding_minor / tot.s) * tot.s AS rem
    FROM comp, tot
  ), rk AS (
    SELECT fl.*,
      row_number() OVER (ORDER BY fl.rem DESC, fl.sort_key, fl.reservation_line_id, fl.component_ref) AS rn,
      v_amount - sum(fl.f) OVER () AS extra
    FROM fl
  )
  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref, charged_minor, refund_treatment, snapshot
  )
  SELECT v_attempt.id, rk.reservation_line_id, rk.component, rk.component_ref,
         rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END,
         rk.refund_treatment, rk.snapshot || jsonb_build_object('stage', v_stage)
  FROM rk
  WHERE rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END > 0
  ORDER BY rk.reservation_line_id, rk.sort_key, rk.component_ref;
  IF (SELECT COALESCE(sum(charged_minor), 0) FROM public.stay_payment_allocations
      WHERE payment_attempt_id = v_attempt.id) <> v_attempt.amount_minor THEN
    RAISE EXCEPTION 'offer_payment_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_payment_prepared', 'guest', p_user_id, 'payment-prepared:' || v_attempt.id,
    jsonb_build_object('attemptId', v_attempt.id, 'provider', v_provider,
      'amountMinor', v_attempt.amount_minor::text, 'currencyCode', v_attempt.currency_code, 'stage', v_stage)
  );
  RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', v_stage);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Confirm: the one early branch in issue_1389_finalize_payment for a
--     balance payment, and the late-payment fix (both marked #4490 P3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_finalize_followup_payment(
  p_attempt_id uuid,
  p_provider_event_id text,
  p_provider_payment_ref text,
  p_provider_charge_ref text,
  p_amount_minor bigint,
  p_currency_code text,
  p_provider_fee_minor bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.stay_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_attempt.state = 'succeeded' THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_attempt.group_id FOR UPDATE;
  IF v_attempt.amount_minor <> p_amount_minor
     OR v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR v_attempt.provider_payment_ref IS DISTINCT FROM p_provider_payment_ref THEN
    -- The booking stays confirmed; this payment needs checking by hand.
    UPDATE public.stay_payment_attempts
    SET state = 'ambiguous', failure_code = 'provider_evidence_mismatch',
        provider_event_ref = p_provider_event_id, version = version + 1, updated_at = now()
    WHERE id = v_attempt.id;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_payment_late_refund_due', 'service', 'followup-mismatch:' || v_attempt.id,
      jsonb_build_object('attemptId', v_attempt.id, 'stage', v_attempt.stage)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    -- Paid after the booking was cancelled: money goes back.
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due', failure_code = 'late_success_booking_closed',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(NULLIF(p_provider_charge_ref, ''), provider_charge_ref),
        version = version + 1, updated_at = now()
    WHERE id = v_attempt.id;
    INSERT INTO public.stay_money_ledger (
      group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
      provider_reference, idempotency_key, metadata
    ) VALUES (
      v_group.id, v_attempt.id, 'charge_succeeded', v_attempt.amount_minor, v_attempt.currency_code,
      p_provider_payment_ref, 'stay:late_charge_succeeded:' || v_attempt.id, jsonb_build_object('refundDue', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_payment_late_refund_due', 'service', 'late-payment-refund-due:' || v_attempt.id,
      jsonb_build_object('attemptId', v_attempt.id)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  UPDATE public.stay_payment_attempts
  SET state = 'succeeded',
      provider_event_ref = p_provider_event_id,
      provider_charge_ref = COALESCE(NULLIF(p_provider_charge_ref, ''), provider_charge_ref),
      provider_fee_minor = p_provider_fee_minor,
      failure_code = NULL,
      succeeded_at = now(),
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;
  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
    provider_reference, idempotency_key, metadata
  ) VALUES (
    v_group.id, v_attempt.id, 'charge_succeeded', v_attempt.amount_minor, v_attempt.currency_code,
    p_provider_payment_ref, 'stay:charge_succeeded:' || v_attempt.id,
    jsonb_build_object('providerEventId', p_provider_event_id, 'stage', v_attempt.stage)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_offer_balance_paid', 'service', 'balance-paid:' || v_attempt.id,
    jsonb_build_object('attemptId', v_attempt.id, 'amountMinor', v_attempt.amount_minor::text,
      'currencyCode', v_attempt.currency_code, 'stage', v_attempt.stage)
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_finalize_payment(
  p_provider text,
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_payment_ref text,
  p_provider_charge_ref text,
  p_amount_minor bigint,
  p_currency_code text,
  p_provider_fee_minor bigint DEFAULT NULL,
  p_event_fingerprint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_event_id uuid;
  v_line public.stay_reservation_lines%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('stripe', 'paystack')
     OR char_length(COALESCE(p_provider_event_id, '')) NOT BETWEEN 3 AND 240
     OR char_length(COALESCE(p_provider_payment_ref, '')) NOT BETWEEN 3 AND 200
     OR p_amount_minor <= 0
     OR upper(COALESCE(p_currency_code, '')) !~ '^[A-Z]{3}$'
     OR (
       p_provider_fee_minor IS NOT NULL
       AND p_provider_fee_minor < 0
     ) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE provider = p_provider
    AND provider_payment_ref = p_provider_payment_ref
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.stay_provider_events (
    provider, provider_event_id, provider_event_type, payment_attempt_id,
    event_fingerprint, safe_payload
  ) VALUES (
    p_provider, p_provider_event_id, p_provider_event_type, v_attempt.id,
    COALESCE(
      NULLIF(p_event_fingerprint, ''),
      encode(extensions.digest(
        pg_catalog.convert_to(
          p_provider || ':' || p_provider_event_id || ':' ||
          p_provider_payment_ref,
          'UTF8'
        ),
        'sha256'
      ), 'hex')
    ),
    jsonb_build_object(
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code)
    )
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  IF v_attempt.state = 'succeeded' THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  -- #4490 P3: a venue booking's balance payment never touches the hold.
  IF v_attempt.stage IN ('balance', 'amendment') THEN
    RETURN public.issue_4490_finalize_followup_payment(
      v_attempt.id, p_provider_event_id, p_provider_payment_ref, p_provider_charge_ref,
      p_amount_minor, p_currency_code, p_provider_fee_minor);
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_attempt.group_id
  FOR UPDATE;
  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = v_attempt.group_id
  FOR UPDATE;

  IF v_attempt.amount_minor <> p_amount_minor
     OR v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR (
       v_attempt.provider_payment_ref IS DISTINCT FROM p_provider_payment_ref
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'ambiguous',
        failure_code = 'provider_evidence_mismatch',
        provider_event_ref = p_provider_event_id,
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN (
        'instant_payment_pending', 'approved_payment_required', 'finalizing'
      );
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'provider_evidence_mismatch',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF v_hold.id IS NULL
     OR v_hold.state NOT IN ('active', 'reconciliation_required')
     OR (
       v_hold.state = 'active'
       AND v_hold.expires_at <= now()
     )
     OR v_group.state NOT IN (
       'instant_payment_pending',
       'approved_payment_required',
       'reconciliation_required'
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(
          NULLIF(p_provider_charge_ref, ''),
          provider_charge_ref
        ),
        failure_code = 'late_success_inventory_unavailable',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    -- #4490 P3: a payment that arrives after the booking was already
    -- cancelled, declined or expired is recorded as refund due; the booking
    -- keeps its closed state (it used to fail the transition guard on every
    -- webhook retry).
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN (
        'instant_payment_pending', 'approved_payment_required', 'finalizing',
        'confirmed', 'partially_cancelled'
      );
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'late_success_refund_due',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    INSERT INTO public.stay_money_ledger (
      group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
      provider_reference, idempotency_key, metadata
    ) VALUES (
      v_group.id, v_attempt.id, 'charge_succeeded',
      v_attempt.amount_minor, v_attempt.currency_code,
      p_provider_payment_ref,
      'stay:late_charge_succeeded:' || v_attempt.id,
      jsonb_build_object('refundDue', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_payment_late_refund_due', 'service',
      'late-payment-refund-due:' || v_attempt.id,
      jsonb_build_object('attemptId', v_attempt.id)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF NOT public.pg_brand_can_collect(v_group.brand_id)
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_group.brand_id
         AND reconciliation.status = 'pending'
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        failure_code = 'readiness_changed_after_charge',
        provider_event_ref = p_provider_event_id,
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'readiness_changed_after_charge',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  UPDATE public.stay_reservation_groups
  SET state = 'finalizing', version = version + 1, updated_at = now()
  WHERE id = v_group.id;

  INSERT INTO public.stay_inventory_commitments (
    group_id, reservation_line_id, resource_type, offering_id,
    room_date, place_window_id, quantity, exclusive_unit_id
  )
  SELECT
    v_group.id, slice_row.reservation_line_id, slice_row.resource_type,
    slice_row.offering_id, slice_row.room_date, slice_row.place_window_id,
    slice_row.quantity, slice_row.exclusive_unit_id
  FROM public.stay_inventory_hold_slices slice_row
  WHERE slice_row.hold_id = v_hold.id
  ORDER BY
    slice_row.resource_type,
    slice_row.offering_id,
    slice_row.room_date,
    slice_row.place_window_id,
    slice_row.exclusive_unit_id
  ON CONFLICT DO NOTHING;

  IF (
    SELECT count(*)
    FROM public.stay_inventory_commitments commitment
    WHERE commitment.group_id = v_group.id
  ) <> (
    SELECT count(*)
    FROM public.stay_inventory_hold_slices slice_row
    WHERE slice_row.hold_id = v_hold.id
  ) THEN
    DELETE FROM public.stay_inventory_commitments
    WHERE group_id = v_group.id;
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(
          NULLIF(p_provider_charge_ref, ''),
          provider_charge_ref
        ),
        failure_code = 'commitment_conversion_failed',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'commitment_conversion_failed',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  UPDATE public.stay_inventory_holds
  SET state = 'converted',
      reason = 'payment_succeeded',
      version = version + 1,
      updated_at = now()
  WHERE id = v_hold.id;
  UPDATE public.stay_reservation_lines
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND state IN (
      'payment_pending', 'approved_payment_required', 'reconciliation_required'
    );
  UPDATE public.stay_reservation_groups
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_payment_attempts
  SET state = 'succeeded',
      provider_event_ref = p_provider_event_id,
      provider_charge_ref = COALESCE(
        NULLIF(p_provider_charge_ref, ''),
        provider_charge_ref
      ),
      provider_fee_minor = p_provider_fee_minor,
      failure_code = NULL,
      succeeded_at = now(),
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
    provider_reference, idempotency_key, metadata
  ) VALUES (
    v_group.id, v_attempt.id, 'charge_succeeded',
    v_attempt.amount_minor, v_attempt.currency_code,
    p_provider_payment_ref,
    'stay:charge_succeeded:' || v_attempt.id,
    jsonb_build_object('providerEventId', p_provider_event_id)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  FOR v_line IN
    SELECT * FROM public.stay_reservation_lines
    WHERE group_id = v_group.id
    ORDER BY id
  LOOP
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_group.id, v_line.id, v_attempt.id, 'payout_eligible',
      v_line.total_minor, v_attempt.currency_code,
      p_provider_payment_ref,
      'stay:payout_eligible:' || v_line.id,
      jsonb_build_object('pendingReleaseAnchor', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_confirmed', 'service',
    'payment-confirmed:' || v_attempt.id,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'amountMinor', v_attempt.amount_minor::text,
      'currencyCode', v_attempt.currency_code
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;

  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Booking read: where and how many now, money owed, deposit plan,
--     extras, answers, changes and what may still be changed.
-- ---------------------------------------------------------------------------

-- What the guest may still change on a booking, from its snapshotted rule:
-- move day until allowed_until_minutes_before; guests and extras until
-- guest_change_until_minutes_before (else the move cut-off); at most
-- max_changes day moves; nothing once anyone has been checked in.
CREATE OR REPLACE FUNCTION public.issue_4490_change_rules(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH g AS (
    SELECT g.*, g.payment_plan_snapshot->'dateChangeRule' AS rule,
      (SELECT w.starts_at FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)) AS starts_at,
      COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id), 0) AS admitted,
      (SELECT count(*) FROM public.venue_booking_amendments a WHERE a.group_id = g.id AND a.kind = 'move_date') AS moves
    FROM public.stay_reservation_groups g WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL
  ), r AS (
    SELECT g.*,
      CASE WHEN g.rule ? 'allowed_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'allowed_until_minutes_before')::integer) END AS move_until,
      CASE WHEN g.rule ? 'guest_change_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'guest_change_until_minutes_before')::integer)
           WHEN g.rule ? 'allowed_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'allowed_until_minutes_before')::integer) END AS guests_until
    FROM g
  )
  SELECT jsonb_build_object(
    'moveUntil', r.move_until,
    'guestChangeUntil', r.guests_until,
    'maxChanges', (r.rule->>'max_changes')::integer,
    'changesUsed', r.moves,
    'feeBps', COALESCE((r.rule->>'fee_bps')::integer, 0),
    'canMove', r.state = 'confirmed' AND r.admitted = 0 AND r.move_until IS NOT NULL AND now() < r.move_until
               AND (r.rule->>'max_changes' IS NULL OR r.moves < (r.rule->>'max_changes')::integer),
    'canChangeGuests', r.state = 'confirmed' AND r.guests_until IS NOT NULL AND now() < r.guests_until,
    'canAddExtras', r.state = 'confirmed' AND r.guests_until IS NOT NULL AND now() < r.guests_until
                    AND EXISTS (SELECT 1 FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
                                WHERE l.group_id = r.id AND jsonb_array_length(o.extras) > 0))
  FROM r;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_booking_projection(p_group_id uuid, p_qr_pepper text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'groupId', g.id,
    'reference', g.public_reference,
    'offerKind', g.offer_kind,
    'state', g.state,
    'version', g.version,
    'bookingSource', g.booking_source,
    'paymentCollection', g.payment_collection,
    'currencyCode', g.currency_code,
    'subtotalMinor', g.source_subtotal_minor,
    'feeMinor', g.fee_total_minor,
    'taxMinor', g.tax_total_minor,
    'totalMinor', g.total_minor,
    'paidMinor', COALESCE((SELECT sum(a.amount_minor) FROM public.stay_payment_attempts a
                           WHERE a.group_id = g.id AND a.state = 'succeeded'), 0),
    'refundedMinor', COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                               WHERE r.group_id = g.id AND r.state IN ('submitted', 'processing', 'succeeded')), 0),
    'balanceDueMinor', money.balance,
    'amountDueNowMinor', CASE WHEN g.state = 'instant_payment_pending' AND g.payment_collection = 'mingla'
                              THEN g.total_minor ELSE money.balance END,
    'holdUntil', (SELECT h.expires_at FROM public.stay_inventory_holds h
                  WHERE h.group_id = g.id AND h.state = 'active'),
    'guest', jsonb_build_object(
      'name', g.guest_snapshot->>'name',
      'email', g.guest_snapshot->>'email',
      'phone', g.guest_snapshot->>'phone'),
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug,
                'brandSlug', b.slug, 'brandName', b.name, 'address', v.address, 'city', v.city,
                'lat', v.lat, 'lng', v.lng, 'timezone', public.issue_4490_venue_timezone(v.id))
              FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = g.venue_id),
    'offer', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style)
              FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
              WHERE l.group_id = g.id ORDER BY l.created_at, l.id LIMIT 1),
    'window', (SELECT jsonb_build_object('windowId', w.id, 'localDate', w.local_date, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
               FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id, 'state', l.state, 'priceOptionId', l.price_option_id,
        'name', l.price_snapshot->>'optionName', 'guests', public.issue_4490_line_guests(l.id),
        'bookedGuests', l.place_guests, 'unit', l.price_snapshot->>'unit',
        'packageMinor', (l.price_snapshot->>'packageMinor')::bigint,
        'extrasMinor', (l.price_snapshot->>'extrasMinor')::bigint,
        'unitPriceMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
        'baseMinor', l.base_minor, 'taxMinor', l.tax_minor, 'feeMinor', l.fee_minor, 'totalMinor', l.total_minor,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel')
        ORDER BY COALESCE((l.price_snapshot->>'sortOrder')::integer, 0), l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = g.id), '[]'::jsonb),
    'policy', jsonb_build_object(
      'text', g.payment_plan_snapshot->>'policyText',
      'refundLadder', g.payment_plan_snapshot->'refundLadder',
      'dateChangeRule', g.payment_plan_snapshot->'dateChangeRule'),
    'vatMode', g.payment_plan_snapshot->>'vatMode',
    'passes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'passId', p.id, 'status', p.status, 'admits', p.admits, 'admittedCount', p.admitted_count,
        'validLocalDate', p.valid_local_date, 'validFrom', p.valid_from, 'validTo', p.valid_to,
        'holderName', p.holder_name, 'idCheckLabel', p.id_check_label, 'idCheckCount', p.id_check_count,
        'qrPayload', CASE WHEN p_qr_pepper IS NOT NULL AND p.status = 'valid'
                          THEN public.issue_4490_pass_qr_payload(p.id, p.qr_token_hash, p_qr_pepper) END)
        ORDER BY p.created_at)
      FROM public.venue_passes p WHERE p.group_id = g.id), '[]'::jsonb),
    'createdAt', g.created_at,
    'updatedAt', g.updated_at
  ) || jsonb_build_object(
    -- #4490 P3: money owed, deposit plan, extras, answers, changes.
    'totalDueMinor', money.total_due,
    'paidOnlineMinor', money.paid_online,
    'paidAtVenueMinor', money.paid_offline,
    'changesMinor', money.changes_minor,
    'depositMinor', g.deposit_minor,
    'balanceDueAt', g.balance_due_at,
    'payModes', CASE WHEN g.state = 'instant_payment_pending' AND g.payment_collection = 'mingla' THEN
        CASE WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now()
             THEN jsonb_build_array(
               jsonb_build_object('mode', 'deposit', 'amountMinor', g.deposit_minor),
               jsonb_build_object('mode', 'full', 'amountMinor', g.total_minor))
             ELSE jsonb_build_array(jsonb_build_object('mode', 'full', 'amountMinor', g.total_minor)) END
      ELSE '[]'::jsonb END,
    'extras', COALESCE((
      SELECT jsonb_agg(x ORDER BY ord)
      FROM (
        SELECT x, 1 AS ord FROM public.stay_reservation_lines l, jsonb_array_elements(COALESCE(l.price_snapshot->'extras', '[]'::jsonb)) x
        WHERE l.group_id = g.id
        UNION ALL
        SELECT x || jsonb_build_object('addedAt', a.created_at), 2 FROM public.venue_booking_amendments a,
          jsonb_array_elements(a.extras) x
        WHERE a.group_id = g.id AND a.kind = 'add_extras'
      ) all_extras), '[]'::jsonb),
    'answers', g.booking_answers,
    'inclusions', (SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'kind', COALESCE(i->>'kind', 'item'), 'label', i->>'label', 'qtyPer', i->>'qty_per',
          'staffRatio', (i->>'staff_ratio')::integer)) ORDER BY ord), '[]'::jsonb)
        FROM public.stay_reservation_lines l
        JOIN public.stay_offerings o ON o.id = l.offering_id,
        jsonb_array_elements(o.inclusions) WITH ORDINALITY AS inc(i, ord)
        WHERE l.id = (SELECT l2.id FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                      ORDER BY l2.created_at, l2.id LIMIT 1)),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'changeId', a.id, 'kind', a.kind, 'fromGuests', a.from_guests, 'toGuests', a.to_guests,
        'fromDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.from_window_id),
        'toDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.to_window_id),
        'extras', CASE WHEN jsonb_array_length(a.extras) > 0 THEN a.extras END,
        'amountMinor', a.price_delta_minor + a.fee_delta_minor + a.tax_delta_minor + a.policy_fee_minor,
        'feeMinor', a.policy_fee_minor, 'refundMinor', a.refund_minor, 'by', a.actor_type,
        'createdAt', a.created_at)) ORDER BY a.created_at)
      FROM public.venue_booking_amendments a WHERE a.group_id = g.id), '[]'::jsonb),
    'changeRules', public.issue_4490_change_rules(g.id)
  )
  FROM public.stay_reservation_groups g
  CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) money
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
$function$;

-- ---------------------------------------------------------------------------
-- 13. Refunds follow the booking's current day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_line_refund_bps(p_line_id uuid, p_actor_type text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_actor_type IN ('staff', 'admin', 'system')
      THEN COALESCE((l.policy_snapshot->>'operator_cancel_refund_basis_points')::integer, 10000)
    ELSE COALESCE((
      SELECT (rung->>'refund_bps')::integer
      FROM jsonb_array_elements(COALESCE(l.policy_snapshot->'refund_ladder', '[]'::jsonb)) WITH ORDINALITY AS r(rung, ord)
      WHERE (rung->>'min_minutes_before')::integer
            <= floor(extract(epoch FROM (w.starts_at - now())) / 60)
      ORDER BY ord
      LIMIT 1
    ), 0)
  END
  FROM public.stay_reservation_lines l
  -- #4490 P3: the window the booking is on now (a day move moves it).
  LEFT JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
  WHERE l.id = p_line_id;
$function$;

-- Refund part of what was paid online (a change that lowers the total): newest
-- payment first, over each payment's outstanding allocations by largest
-- remainder, one (consumed) preview and one refund per payment, through the
-- same source-refund rail as a cancellation. Returns the amount refunded.
CREATE OR REPLACE FUNCTION public.issue_4490_refund_amount_internal(
  p_group_id uuid,
  p_amount bigint,
  p_actor_type text,
  p_requester uuid,
  p_token_hash bytea,
  p_reason text,
  p_key text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_refund public.stay_refunds%ROWTYPE;
  v_source public.source_refunds%ROWTYPE;
  v_remaining bigint := GREATEST(COALESCE(p_amount, 0), 0);
  v_take bigint;
  v_avail bigint;
  v_snapshot jsonb;
  v_fee_reversal bigint;
  v_fee_remaining bigint;
  v_existing_fee bigint;
  v_ordinal integer := 0;
  v_total bigint := 0;
  v_requester uuid := p_requester;
  v_reason text := left(COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Booking changed'), 500);
  v_key text := btrim(p_key);
  v_selected uuid[];
BEGIN
  IF v_remaining = 0 THEN
    RETURN 0;
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  SELECT array_agg(l.id ORDER BY l.id) INTO v_selected
  FROM public.stay_reservation_lines l WHERE l.group_id = p_group_id;
  PERFORM set_config('mingla.issue_4490_offer_rail', p_group_id::text, true);
  FOR v_attempt IN
    SELECT * FROM public.stay_payment_attempts
    WHERE group_id = p_group_id AND state = 'succeeded'
    ORDER BY succeeded_at DESC, id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    WITH eligible AS (
      SELECT a.id AS payment_allocation_id, a.reservation_line_id,
        GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
          SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
          JOIN public.stay_refunds rr ON rr.id = ra.refund_id
          WHERE ra.payment_allocation_id = a.id
            AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0)) AS outstanding_minor,
        a.component, a.component_ref, a.refund_treatment
      FROM public.stay_payment_allocations a WHERE a.payment_attempt_id = v_attempt.id
    )
    SELECT COALESCE(sum(outstanding_minor), 0) INTO v_avail FROM eligible;
    CONTINUE WHEN v_avail = 0;
    v_take := LEAST(v_remaining, v_avail);
    WITH eligible AS (
      SELECT a.id AS payment_allocation_id, a.reservation_line_id, a.component, a.component_ref, a.refund_treatment,
        GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
          SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
          JOIN public.stay_refunds rr ON rr.id = ra.refund_id
          WHERE ra.payment_allocation_id = a.id
            AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0)) AS outstanding_minor
      FROM public.stay_payment_allocations a WHERE a.payment_attempt_id = v_attempt.id
    ), fl AS (
      SELECT e.*, floor(v_take::numeric * e.outstanding_minor / v_avail)::bigint AS f,
        (v_take::numeric * e.outstanding_minor) - floor(v_take::numeric * e.outstanding_minor / v_avail) * v_avail AS rem
      FROM eligible e WHERE e.outstanding_minor > 0
    ), rk AS (
      SELECT fl.*, row_number() OVER (ORDER BY fl.rem DESC, fl.payment_allocation_id) AS rn,
        v_take - sum(fl.f) OVER () AS extra
      FROM fl
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'paymentAllocationId', rk.payment_allocation_id,
        'reservationLineId', rk.reservation_line_id,
        'component', rk.component,
        'componentRef', rk.component_ref,
        'refundTreatment', rk.refund_treatment,
        'amountMinor', (rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END)::text,
        'attemptId', v_attempt.id) ORDER BY rk.reservation_line_id, rk.payment_allocation_id), '[]'::jsonb)
    INTO v_snapshot
    FROM rk WHERE rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END > 0;
    v_ordinal := v_ordinal + 1;
    INSERT INTO public.stay_cancel_previews (
      group_id, actor_user_id, actor_type, selected_line_ids, group_version, amount_minor,
      allocation_snapshot, preview_hash, expires_at, consumed_at, actor_token_hash
    ) VALUES (
      v_group.id, p_requester, CASE WHEN p_requester IS NULL AND p_token_hash IS NULL THEN 'system' ELSE p_actor_type END,
      v_selected, v_group.version, v_take, v_snapshot,
      encode(pg_catalog.sha256(convert_to(jsonb_build_object('changeRefund', v_key, 'n', v_ordinal,
        'attemptId', v_attempt.id, 'amountMinor', v_take::text)::text, 'UTF8')), 'hex'),
      now() + interval '10 minutes', now(),
      CASE WHEN p_actor_type = 'guest' THEN p_token_hash END
    ) RETURNING * INTO v_preview;
    SELECT COALESCE(sum(application_fee_reversal_minor), 0) INTO v_existing_fee
    FROM public.stay_refunds prior_refund
    WHERE prior_refund.payment_attempt_id = v_attempt.id
      AND prior_refund.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation');
    v_fee_remaining := GREATEST(0, v_attempt.application_fee_minor - v_existing_fee);
    v_fee_reversal := LEAST(v_fee_remaining,
      (v_attempt.application_fee_minor::numeric * v_preview.amount_minor + v_attempt.amount_minor / 2)::bigint
        / v_attempt.amount_minor);
      INSERT INTO public.stay_refunds (
        group_id, payment_attempt_id, cancel_preview_id, requested_by_type, requested_by_user_id,
        reason, state, amount_minor, application_fee_reversal_minor, currency_code, provider, idempotency_key
      ) VALUES (
        v_group.id, v_attempt.id, v_preview.id, v_preview.actor_type, v_requester, v_reason,
        CASE WHEN v_preview.amount_minor = 0 THEN 'succeeded' ELSE 'submitted' END,
        v_preview.amount_minor, v_fee_reversal, v_group.currency_code, v_attempt.provider,
        'offer-change-refund:' || v_key || ':' || v_ordinal
      ) RETURNING * INTO v_refund;
      IF v_preview.amount_minor > 0 THEN
        WITH requested AS (
          SELECT (item->>'paymentAllocationId')::uuid AS payment_allocation_id,
                 (item->>'reservationLineId')::uuid AS reservation_line_id,
                 (item->>'amountMinor')::bigint AS amount_minor
          FROM jsonb_array_elements(v_preview.allocation_snapshot) item
        ),
        floors AS (
          SELECT requested.*,
            floor(v_fee_reversal::numeric * requested.amount_minor / v_preview.amount_minor)::bigint AS fee_floor,
            (v_fee_reversal::numeric * requested.amount_minor
              - floor(v_fee_reversal::numeric * requested.amount_minor / v_preview.amount_minor)
                * v_preview.amount_minor) AS remainder
          FROM requested
        ),
        ranked AS (
          SELECT floors.*,
            row_number() OVER (ORDER BY remainder DESC, payment_allocation_id) AS remainder_rank,
            v_fee_reversal - sum(fee_floor) OVER () AS extras
          FROM floors
        )
        INSERT INTO public.stay_refund_allocations (
          refund_id, payment_allocation_id, reservation_line_id, amount_minor,
          organizer_liability_minor, platform_fee_reversal_minor, state
        )
        SELECT v_refund.id, ranked.payment_allocation_id, ranked.reservation_line_id, ranked.amount_minor,
          ranked.amount_minor - (ranked.fee_floor + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END),
          ranked.fee_floor + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END,
          'submitted'
        FROM ranked;
        INSERT INTO public.source_refunds (
          source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
          requested_by_type, requested_by_user_id, reason, provider, currency,
          original_charge_cents, buyer_refund_requested_cents,
          original_application_fee_cents, fee_reversal_required_cents,
          fee_state, fee_leg_kind, financial_state,
          organizer_refund_liability_cents, platform_fee_absorption_cents,
          provider_payment_reference, provider_account_reference, idempotency_key
        ) VALUES (
          'stay_reservation', v_refund.id, v_group.id, v_group.brand_id, v_group.venue_id, 'stay_cancellation',
          CASE v_preview.actor_type WHEN 'guest' THEN 'consumer' WHEN 'admin' THEN 'admin' ELSE 'brand_staff' END,
          v_requester, v_reason, v_attempt.provider, v_group.currency_code::text,
          v_attempt.amount_minor::integer, v_refund.amount_minor::integer,
          v_attempt.application_fee_minor::integer, v_fee_reversal::integer,
          CASE WHEN v_fee_reversal = 0 THEN 'not_required' ELSE 'queued' END,
          CASE WHEN v_fee_reversal = 0 THEN 'not_required'
               WHEN v_attempt.provider = 'stripe' THEN 'stripe_application_fee_refund'
               ELSE 'paystack_ledger_allocation' END,
          'pending',
          (v_refund.amount_minor - v_fee_reversal)::integer, v_fee_reversal::integer,
          v_attempt.provider_payment_ref, v_attempt.connected_account_ref,
          'stay-refund:' || v_refund.id
        ) RETURNING * INTO v_source;
        UPDATE public.stay_refunds SET source_refund_id = v_source.id, updated_at = now()
        WHERE id = v_refund.id RETURNING * INTO v_refund;
        INSERT INTO public.source_refund_ledger_allocations (
          refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
        ) VALUES (
          v_source.id, 'buyer_refund', v_source.buyer_refund_requested_cents, v_source.currency,
          v_source.provider, 'prepared', 'source-refund-allocation:buyer:' || v_source.id
        );
        IF v_source.organizer_refund_liability_cents > 0 THEN
          INSERT INTO public.source_refund_ledger_allocations (
            refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
          ) VALUES (
            v_source.id, 'organizer_refund_liability', v_source.organizer_refund_liability_cents,
            v_source.currency, v_source.provider, 'prepared', 'source-refund-allocation:organizer:' || v_source.id
          );
        END IF;
        IF v_source.platform_fee_absorption_cents > 0 THEN
          INSERT INTO public.source_refund_ledger_allocations (
            refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
          ) VALUES (
            v_source.id, 'platform_application_fee_reversal', v_source.platform_fee_absorption_cents,
            v_source.currency, v_source.provider, 'prepared', 'source-refund-allocation:platform:' || v_source.id
          );
        END IF;
        INSERT INTO public.stay_money_ledger (
          group_id, payment_attempt_id, refund_id, entry_type, amount_minor, currency_code,
          idempotency_key, metadata
        ) VALUES (
          v_group.id, v_attempt.id, v_refund.id, 'refund_requested', v_refund.amount_minor,
          v_group.currency_code, 'stay:refund_requested:' || v_refund.id,
          jsonb_build_object('reason', 'venue_offer_changed')
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
      v_total := v_total + v_refund.amount_minor;
      v_remaining := v_remaining - v_refund.amount_minor;
  END LOOP;
  RETURN v_total;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Change a confirmed booking: more or fewer guests, another day, more
--     extras. Preview first (no writes), then apply with the booking version.
--     Guests: within the snapshotted cut-offs. Staff: until the booking ends.
--     More money owed raises the balance; less follows the refund ladder
--     (guests) or the operator rate (staff); money paid online above the new
--     total is refunded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_change_booking_internal(
  p_group_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_actor_type text,
  p_actor_user uuid,
  p_token_hash bytea,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_line public.stay_reservation_lines%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_cur_window public.stay_place_windows%ROWTYPE;
  v_new_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_existing public.venue_booking_amendments%ROWTYPE;
  v_money record;
  v_usage record;
  v_rules jsonb;
  v_request_hash text;
  v_line_count integer;
  v_cur_guests integer;
  v_new_guests integer;
  v_party integer;
  v_admitted integer;
  v_needed integer := 0;
  v_left integer;
  v_delta_base bigint := 0;
  v_tax_delta bigint := 0;
  v_policy_fee bigint := 0;
  v_delta_total bigint;
  v_vat_bps integer;
  v_vat_included boolean;
  v_refund_bps integer;
  v_new_total bigint;
  v_refundable bigint;
  v_refund bigint := 0;
  v_extras jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_amend_id uuid;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_l record;
  v_reason text;
BEGIN
  IF p_group_id IS NULL OR p_action NOT IN ('change_guests', 'move_date', 'add_extras')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_actor_type NOT IN ('guest', 'staff')
     OR (NOT p_preview AND (char_length(v_key) NOT BETWEEN 8 AND 200 OR p_expected_version IS NULL)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_preview THEN
    SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  ELSE
    SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'payload', p_payload, 'actor', p_actor_type, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  IF NOT p_preview THEN
    SELECT * INTO v_existing FROM public.venue_booking_amendments
    WHERE group_id = p_group_id AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
      END IF;
      RETURN v_existing.summary || jsonb_build_object('changeId', v_existing.id, 'replayed', true,
        'groupVersion', v_group.version);
    END IF;
    IF v_group.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  IF v_group.state <> 'confirmed' THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;

  SELECT count(*) INTO v_line_count FROM public.stay_reservation_lines WHERE group_id = v_group.id AND state = 'confirmed';
  SELECT * INTO v_line FROM public.stay_reservation_lines
  WHERE group_id = v_group.id AND state = 'confirmed'
    AND (NULLIF(p_payload->>'lineId', '') IS NULL OR id = NULLIF(p_payload->>'lineId', '')::uuid)
  ORDER BY created_at, id LIMIT 1;
  IF NOT FOUND OR (p_action = 'change_guests' AND v_line_count > 1 AND NULLIF(p_payload->>'lineId', '') IS NULL) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id;
  SELECT * INTO v_cur_window FROM public.stay_place_windows WHERE id = public.issue_4490_line_window_id(v_line.id);
  v_settings := public.issue_4490_ensure_booking_settings(v_group.venue_id);
  v_rules := public.issue_4490_change_rules(v_group.id);
  v_admitted := COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = v_group.id), 0);
  v_cur_guests := public.issue_4490_line_guests(v_line.id);
  SELECT COALESCE(sum(public.issue_4490_line_guests(l.id)), 0) INTO v_party
  FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed';

  -- Who may change what, and until when.
  IF p_actor_type = 'guest' THEN
    IF p_action = 'move_date' AND NOT COALESCE((v_rules->>'canMove')::boolean, false) THEN
      RAISE EXCEPTION '%', CASE
        WHEN v_rules->>'moveUntil' IS NULL OR v_admitted > 0
             OR ((v_rules->>'maxChanges') IS NOT NULL AND (v_rules->>'changesUsed')::integer >= (v_rules->>'maxChanges')::integer)
        THEN 'offer_change_not_allowed' ELSE 'offer_change_too_late' END USING ERRCODE = 'P0001';
    END IF;
    IF p_action IN ('change_guests', 'add_extras') AND NOT COALESCE((v_rules->>'canChangeGuests')::boolean, false) THEN
      RAISE EXCEPTION '%', CASE WHEN v_rules->>'guestChangeUntil' IS NULL THEN 'offer_change_not_allowed'
                                ELSE 'offer_change_too_late' END USING ERRCODE = 'P0001';
    END IF;
  ELSIF now() >= v_cur_window.ends_at THEN
    RAISE EXCEPTION 'offer_change_too_late' USING ERRCODE = 'P0001';
  END IF;

  -- VAT on the line (added = on top; included = inside the price).
  SELECT (fee.snapshot->>'basis_points')::integer, fee.included_in_base INTO v_vat_bps, v_vat_included
  FROM public.stay_quote_fee_lines fee
  WHERE fee.quote_line_id = v_line.quote_line_id AND fee.fee_kind = 'tax'
  ORDER BY fee.id LIMIT 1;

  IF p_action = 'change_guests' THEN
    IF COALESCE(p_payload->>'guests', '') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
    END IF;
    v_new_guests := (p_payload->>'guests')::integer;
    SELECT * INTO v_option FROM public.venue_offer_price_options WHERE id = v_line.price_option_id;
    IF v_new_guests = v_cur_guests THEN
      RAISE EXCEPTION 'offer_change_nothing' USING ERRCODE = '22023';
    END IF;
    IF v_new_guests < GREATEST(COALESCE(v_option.guest_min, 1), 1) OR v_new_guests > LEAST(COALESCE(v_option.guest_max, 1000), 1000) THEN
      RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
    END IF;
    IF v_party - v_cur_guests + v_new_guests < v_admitted THEN
      RAISE EXCEPTION 'offer_already_checked_in' USING ERRCODE = 'PT409';
    END IF;
    v_delta_base := (v_new_guests - v_cur_guests) * (
      CASE WHEN v_line.price_snapshot->>'unit' = 'guest' THEN COALESCE((v_line.price_snapshot->>'unitPriceMinor')::bigint, 0) ELSE 0 END
      + COALESCE((SELECT sum((x->>'unitPriceMinor')::bigint) FROM jsonb_array_elements(COALESCE(v_line.price_snapshot->'extras', '[]'::jsonb)) x
                  WHERE x->>'per' = 'guest'), 0));
    v_needed := GREATEST(v_new_guests - v_cur_guests, 0);
    v_new_window := v_cur_window;
  ELSIF p_action = 'move_date' THEN
    SELECT * INTO v_new_window FROM public.stay_place_windows
    WHERE id = NULLIF(p_payload->>'windowId', '')::uuid AND offering_id = v_offer.id;
    IF NOT FOUND OR v_new_window.stop_sell OR v_new_window.id = v_cur_window.id THEN
      RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
    END IF;
    IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_new_window.id) THEN
      RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
    END IF;
    IF v_new_window.local_date > (now() AT TIME ZONE v_settings.timezone)::date
         + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730)) THEN
      RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
    END IF;
    FOR v_l IN
      SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed'
    LOOP
      v_reason := public.issue_4490_option_window_reason(v_l.price_option_id, v_new_window.id);
      IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
        RAISE EXCEPTION 'offer_%', v_reason USING ERRCODE = 'PT409';
      END IF;
      -- The booked price stands unless the new day is priced differently
      -- (weekday or busy-time price), then the difference applies.
      v_delta_base := v_delta_base
        + (COALESCE(public.issue_4490_option_price_at(v_l.price_option_id, v_new_window.id), 0)
           - COALESCE(public.issue_4490_option_price_at(v_l.price_option_id, v_cur_window.id), 0))
          * CASE WHEN v_l.price_snapshot->>'unit' = 'guest' THEN public.issue_4490_line_guests(v_l.id) ELSE 1 END;
    END LOOP;
    v_needed := v_party;
  ELSE -- add_extras
    IF jsonb_typeof(p_payload->'extras') <> 'array' OR jsonb_array_length(p_payload->'extras') NOT BETWEEN 1 AND 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'extras') e
                  WHERE jsonb_typeof(e) <> 'object'
                     OR (e ? 'qty' AND (COALESCE(e->>'qty', '') !~ '^[0-9]{1,3}$' OR (e->>'qty')::integer NOT BETWEEN 1 AND 100)))
       OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_payload->'extras') e) <> jsonb_array_length(p_payload->'extras') THEN
      RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'extras') e
               WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.extras) x WHERE x->>'id' = e->>'id')) THEN
      RAISE EXCEPTION 'offer_extra_unavailable' USING ERRCODE = 'P0002';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', x->>'id', 'name', x->>'name', 'per', x->>'per',
             'unitPriceMinor', (x->>'price_minor')::bigint,
             'qty', CASE WHEN x->>'per' = 'guest' THEN v_party ELSE COALESCE((e->>'qty')::integer, 1) END,
             'amountMinor', (x->>'price_minor')::bigint
               * CASE WHEN x->>'per' = 'guest' THEN v_party ELSE COALESCE((e->>'qty')::integer, 1) END)
             ORDER BY x->>'name'), '[]'::jsonb)
    INTO v_extras
    FROM jsonb_array_elements(p_payload->'extras') e
    JOIN jsonb_array_elements(v_offer.extras) x ON x->>'id' = e->>'id';
    SELECT COALESCE(sum((x->>'amountMinor')::bigint), 0) INTO v_delta_base FROM jsonb_array_elements(v_extras) x;
    v_new_window := v_cur_window;
  END IF;

  v_tax_delta := CASE WHEN v_vat_bps IS NOT NULL AND NOT COALESCE(v_vat_included, false)
                      THEN round(v_delta_base::numeric * v_vat_bps / 10000)::bigint ELSE 0 END;
  v_delta_total := v_delta_base + v_tax_delta;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(v_group.id);
  IF v_delta_total < 0 THEN
    -- Less to pay: the guest keeps the ladder's share; the venue keeps the rest.
    v_refund_bps := public.issue_4490_line_refund_bps(v_line.id, p_actor_type);
    v_policy_fee := ((-v_delta_total) * (10000 - COALESCE(v_refund_bps, 0)) + 5000) / 10000;
  ELSIF p_action = 'move_date' AND p_actor_type = 'guest' THEN
    v_policy_fee := (v_money.total_due * COALESCE((v_rules->>'feeBps')::integer, 0) + 5000) / 10000;
  END IF;
  v_new_total := v_money.total_due + v_delta_total + v_policy_fee;
  SELECT COALESCE(sum(GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
      SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
      JOIN public.stay_refunds rr ON rr.id = ra.refund_id
      WHERE ra.payment_allocation_id = a.id AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0))), 0)
  INTO v_refundable
  FROM public.stay_payment_allocations a
  JOIN public.stay_payment_attempts p ON p.id = a.payment_attempt_id
  WHERE p.group_id = v_group.id AND p.state = 'succeeded';
  v_refund := LEAST(GREATEST(v_money.net_paid - v_new_total, 0), v_refundable);

  -- Room on the day (under the pool lock when applying).
  IF v_needed > 0 THEN
    IF NOT p_preview AND v_offer.capacity_pool_id IS NOT NULL THEN
      PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id FOR UPDATE;
      PERFORM 1 FROM public.venue_capacity_overrides
      WHERE pool_id = v_offer.capacity_pool_id AND local_date = v_new_window.local_date FOR UPDATE;
    END IF;
    SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_new_window.local_date);
    IF COALESCE(v_usage.closed, true) THEN
      RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
    END IF;
    v_left := CASE WHEN p_actor_type = 'staff' THEN v_usage.gate_left ELSE v_usage.online_left END;
    IF v_offer.entry_style = 'timed_session' THEN
      v_left := LEAST(v_left, GREATEST(v_new_window.sellable_capacity - public.issue_4490_window_used(v_new_window.id), 0));
    END IF;
    IF v_needed > v_left THEN
      RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('remaining', v_left)::text;
    END IF;
  END IF;

  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'action', p_action,
    'lineId', v_line.id,
    'fromGuests', CASE WHEN p_action = 'change_guests' THEN v_cur_guests END,
    'toGuests', CASE WHEN p_action = 'change_guests' THEN v_new_guests END,
    'fromDate', CASE WHEN p_action = 'move_date' THEN v_cur_window.local_date END,
    'toDate', CASE WHEN p_action = 'move_date' THEN v_new_window.local_date END,
    'toStartsAt', CASE WHEN p_action = 'move_date' THEN v_new_window.starts_at END,
    'extras', CASE WHEN p_action = 'add_extras' THEN v_extras END)) || jsonb_build_object(
    'priceDeltaMinor', v_delta_base,
    'taxDeltaMinor', v_tax_delta,
    'feeMinor', v_policy_fee,
    'amountMinor', v_delta_total + v_policy_fee,
    'totalDueBeforeMinor', v_money.total_due,
    'totalDueAfterMinor', v_new_total,
    'paidMinor', v_money.net_paid,
    'refundMinor', v_refund,
    'balanceAfterMinor', GREATEST(v_new_total - (v_money.net_paid - v_refund), 0),
    'currencyCode', v_group.currency_code,
    'by', p_actor_type);
  IF p_preview THEN
    RETURN v_summary || jsonb_build_object('preview', true, 'groupVersion', v_group.version);
  END IF;

  -- Apply.
  PERFORM set_config('mingla.issue_4490_booking_change', v_group.id::text, true);
  IF p_action = 'change_guests' THEN
    UPDATE public.stay_inventory_commitments SET quantity = v_new_guests
    WHERE reservation_line_id = v_line.id AND state = 'active';
  ELSIF p_action = 'move_date' THEN
    UPDATE public.stay_inventory_commitments SET place_window_id = v_new_window.id
    WHERE group_id = v_group.id AND state = 'active' AND resource_type = 'place_window';
    UPDATE public.venue_passes p
    SET valid_local_date = v.valid_local_date, valid_from = v.valid_from, valid_to = v.valid_to,
        version = p.version + 1, updated_at = now()
    FROM public.issue_4490_pass_validity(v_offer.id, v_new_window.id) v
    WHERE p.group_id = v_group.id;
  END IF;
  IF p_action = 'change_guests' THEN
    UPDATE public.venue_passes p
    SET admits = totals.admits,
        id_check_count = LEAST(totals.id_count, totals.admits),
        version = p.version + 1, updated_at = now()
    FROM (
      SELECT sum(public.issue_4490_line_guests(l.id))::integer AS admits,
             COALESCE(sum(public.issue_4490_line_guests(l.id)) FILTER (WHERE l.price_snapshot->>'idCheckLabel' IS NOT NULL), 0)::integer AS id_count
      FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed'
    ) totals
    WHERE p.group_id = v_group.id;
  END IF;
  INSERT INTO public.venue_booking_amendments (
    group_id, reservation_line_id, kind, from_guests, to_guests, from_window_id, to_window_id, extras,
    price_delta_minor, tax_delta_minor, policy_fee_minor, refund_minor, actor_type, actor_user_id,
    idempotency_key, request_hash, summary
  ) VALUES (
    v_group.id, CASE WHEN p_action = 'change_guests' THEN v_line.id END,
    p_action,
    CASE WHEN p_action = 'change_guests' THEN v_cur_guests END,
    CASE WHEN p_action = 'change_guests' THEN v_new_guests END,
    CASE WHEN p_action = 'move_date' THEN v_cur_window.id END,
    CASE WHEN p_action = 'move_date' THEN v_new_window.id END,
    v_extras, v_delta_base, v_tax_delta, v_policy_fee, v_refund, p_actor_type, p_actor_user,
    v_key, v_request_hash, v_summary
  ) RETURNING id INTO v_amend_id;
  IF v_refund > 0 THEN
    v_refund := public.issue_4490_refund_amount_internal(v_group.id, v_refund, p_actor_type, p_actor_user,
      p_token_hash, 'Booking changed: ' || replace(p_action, '_', ' '), v_key);
  END IF;
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now()
  WHERE id = v_group.id RETURNING * INTO v_group;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_offer_changed', p_actor_type, p_actor_user, 'offer-change:' || v_key,
    jsonb_build_object('changeId', v_amend_id, 'action', p_action,
      'amountMinor', (v_summary->>'balanceAfterMinor'), 'currencyCode', v_group.currency_code,
      'refundMinor', v_refund::text)
  );
  RETURN v_summary || jsonb_build_object('changeId', v_amend_id, 'replayed', false,
    'refundMinor', v_refund, 'groupVersion', v_group.version);
END;
$function$;

-- Staff (Host, signed in): change a booking at their venue.
CREATE OR REPLACE FUNCTION public.issue_4490_change_booking(
  p_group_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_expected_version bigint DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
BEGIN
  SELECT g.venue_id INTO v_venue FROM public.stay_reservation_groups g
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
  IF auth.uid() IS NULL OR v_venue IS NULL
     OR NOT public.issue_4490_can_manage_venue(v_venue, 'venue.manage_bookings') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_change_booking_internal(p_group_id, p_action, p_payload, COALESCE(p_preview, true),
    'staff', auth.uid(), NULL, p_expected_version, p_idempotency_key);
END;
$function$;

-- Guest (edge venue-offers: booking token or the booking's own user).
CREATE OR REPLACE FUNCTION public.issue_4490_guest_change_booking(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_4490_change_booking_internal(p_group_id, p_action, p_payload, COALESCE(p_preview, true),
    'guest', p_user_id, p_token_hash, p_expected_version, p_idempotency_key);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 15. Staff: record a payment taken at the venue (cash, transfer, card at the
--     venue), send a balance reminder, read a booking, preview a day closure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_record_offline_payment_internal(
  p_group_id uuid,
  p_amount_minor bigint,
  p_method text,
  p_paid_on date,
  p_note text,
  p_user_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_money record;
  v_existing public.venue_offline_payments%ROWTYPE;
  v_row public.venue_offline_payments%ROWTYPE;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_hash text;
BEGIN
  IF p_group_id IS NULL OR p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > 2147483647
     OR COALESCE(p_method, '') NOT IN ('cash', 'transfer', 'card_at_venue', 'other')
     OR char_length(v_key) NOT BETWEEN 8 AND 200
     OR (p_note IS NOT NULL AND char_length(p_note) > 300) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_money(v_group.venue_id, p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'amount', p_amount_minor::text, 'method', p_method, 'paidOn', p_paid_on, 'note', p_note)::text, 'UTF8')), 'hex');
  SELECT * INTO v_existing FROM public.venue_offline_payments WHERE group_id = p_group_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_hash <> v_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);
    RETURN jsonb_build_object('paymentId', v_existing.id, 'replayed', true, 'balanceMinor', v_money.balance,
      'groupVersion', v_group.version);
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);
  IF p_amount_minor > v_money.balance THEN
    RAISE EXCEPTION 'offer_amount_over_balance' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('balanceMinor', v_money.balance)::text;
  END IF;
  PERFORM set_config('mingla.issue_4490_booking_change', p_group_id::text, true);
  INSERT INTO public.venue_offline_payments (
    group_id, amount_minor, currency_code, method, paid_on, note, recorded_by, idempotency_key, request_hash
  ) VALUES (
    p_group_id, p_amount_minor, v_group.currency_code, p_method,
    COALESCE(p_paid_on, (now() AT TIME ZONE public.issue_4490_venue_timezone(v_group.venue_id))::date),
    NULLIF(btrim(COALESCE(p_note, '')), ''), p_user_id, v_key, v_hash
  ) RETURNING * INTO v_row;
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now()
  WHERE id = p_group_id RETURNING * INTO v_group;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_offer_paid_at_venue', 'staff', p_user_id, 'paid-at-venue:' || v_row.id,
    jsonb_build_object('paymentId', v_row.id, 'amountMinor', p_amount_minor::text, 'method', p_method,
      'currencyCode', v_group.currency_code)
  );
  SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);
  RETURN jsonb_build_object('paymentId', v_row.id, 'replayed', false, 'balanceMinor', v_money.balance,
    'groupVersion', v_group.version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_record_offline_payment(
  p_group_id uuid,
  p_amount_minor bigint,
  p_method text,
  p_paid_on date,
  p_note text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_record_offline_payment_internal(
    p_group_id, p_amount_minor, p_method, p_paid_on, p_note, auth.uid(), p_idempotency_key);
END;
$function$;

-- The check-in edge function acts for the scanner it verified.
CREATE OR REPLACE FUNCTION public.issue_4490_record_offline_payment_for(
  p_user_id uuid,
  p_group_id uuid,
  p_amount_minor bigint,
  p_method text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_record_offline_payment_internal(
    p_group_id, p_amount_minor, p_method, NULL, NULL, p_user_id, p_idempotency_key);
END;
$function$;

-- Send the guest a balance reminder with their pay link (link built at send time).
CREATE OR REPLACE FUNCTION public.issue_4490_send_booking_reminder(p_group_id uuid, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_money record;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
BEGIN
  IF char_length(v_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_group.offer_kind IS NULL OR auth.uid() IS NULL
     OR NOT public.issue_4490_can_manage_venue(v_group.venue_id, 'venue.manage_bookings') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_reservation_events e
             WHERE e.group_id = p_group_id AND e.idempotency_key = 'manual-reminder:' || v_key) THEN
    RETURN jsonb_build_object('sent', true, 'replayed', true);
  END IF;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);
  IF v_money.balance <= 0 THEN
    RAISE EXCEPTION 'offer_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  IF NULLIF(v_group.guest_snapshot->>'email', '') IS NULL AND v_group.user_id IS NULL THEN
    RAISE EXCEPTION 'offer_guest_email_required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_reservation_events e
             WHERE e.group_id = p_group_id AND e.event_type = 'stay_offer_balance_due'
               AND e.idempotency_key LIKE 'manual-reminder:%' AND e.created_at > now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'offer_reminder_too_soon' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_offer_balance_due', 'staff', auth.uid(), 'manual-reminder:' || v_key,
    jsonb_build_object('amountMinor', v_money.balance::text, 'currencyCode', v_group.currency_code,
      'balanceDueAt', v_group.balance_due_at, 'reason', 'manual')
  );
  RETURN jsonb_build_object('sent', true, 'replayed', false, 'balanceMinor', v_money.balance);
END;
$function$;

-- Staff read of one booking: the guest projection (no pass codes) plus the
-- payments, payments taken at the venue and the history.
CREATE OR REPLACE FUNCTION public.issue_4490_get_booking(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  IF NOT FOUND OR v_group.offer_kind IS NULL OR auth.uid() IS NULL
     OR NOT public.issue_4490_can_view_venue(v_group.venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_booking_projection(p_group_id, NULL) || jsonb_build_object(
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('attemptId', a.id, 'stage', a.stage, 'state', a.state,
          'amountMinor', a.amount_minor, 'provider', a.provider, 'at', COALESCE(a.succeeded_at, a.created_at))
        ORDER BY a.attempt_ordinal)
      FROM public.stay_payment_attempts a WHERE a.group_id = p_group_id), '[]'::jsonb),
    'paidAtVenue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('paymentId', o.id, 'amountMinor', o.amount_minor, 'method', o.method,
          'paidOn', o.paid_on, 'note', o.note, 'at', o.created_at) ORDER BY o.created_at)
      FROM public.venue_offline_payments o WHERE o.group_id = p_group_id), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('type', e.event_type, 'by', e.actor_type, 'at', e.created_at)
        ORDER BY e.created_at, e.id)
      FROM public.stay_reservation_events e WHERE e.group_id = p_group_id), '[]'::jsonb),
    'canManageMoney', public.issue_4490_can_manage_money(v_group.venue_id, auth.uid()),
    'canChange', public.issue_4490_can_manage_venue(v_group.venue_id, 'venue.manage_bookings'));
END;
$function$;

-- Before closing a day: who is booked on it (closing does not cancel them;
-- staff cancel each with the operator refund, or move them).
CREATE OR REPLACE FUNCTION public.issue_4490_preview_day_closure(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_local_date IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH booked AS (
      SELECT g.id, g.public_reference, g.state, g.guest_snapshot->>'name' AS guest_name,
             (SELECT sum(public.issue_4490_line_guests(l.id)) FROM public.stay_reservation_lines l
              WHERE l.group_id = g.id AND l.state <> 'cancelled') AS guests,
             (SELECT o.name FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
              WHERE l.group_id = g.id ORDER BY l.created_at LIMIT 1) AS offer_name,
             m.net_paid
      FROM public.stay_reservation_groups g
      CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) m
      JOIN public.stay_place_windows w ON w.id = public.issue_4490_group_window_id(g.id)
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL
        AND g.state IN ('confirmed', 'partially_cancelled', 'instant_payment_pending', 'approved_payment_required')
        AND w.local_date = p_local_date
    )
    SELECT jsonb_build_object(
      'localDate', p_local_date,
      'count', count(*),
      'guests', COALESCE(sum(guests), 0),
      'paidMinor', COALESCE(sum(net_paid), 0),
      'bookings', COALESCE(jsonb_agg(jsonb_build_object('groupId', id, 'reference', public_reference, 'state', state,
        'guestName', guest_name, 'guests', guests, 'offerName', offer_name, 'paidMinor', net_paid)
        ORDER BY guest_name), '[]'::jsonb))
    FROM booked);
END;
$function$;

-- Check-in: the guest's own pay link for the balance (the edge function
-- re-derives the booking token from the stored hash and shows it as a QR on
-- the staff device; the guest pays on their phone). Check-in rights suffice:
-- staff never handle the money here.
CREATE OR REPLACE FUNCTION public.issue_4490_balance_link_info(p_venue_id uuid, p_group_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_money record;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4490_can_check_in(p_venue_id, p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups
  WHERE id = p_group_id AND venue_id = p_venue_id AND offer_kind IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);
  IF v_money.balance <= 0 THEN
    RAISE EXCEPTION 'offer_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  RETURN jsonb_build_object('groupId', v_group.id, 'tokenHashHex', encode(v_group.buyer_token_hash, 'hex'),
    'balanceMinor', v_money.balance, 'currencyCode', v_group.currency_code);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 16. Check-in and Today: the balance due on a booking, its current day and
--     party size (after changes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_pass_view(p_pass_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'passId', p.id,
    'groupId', p.group_id,
    'reference', g.public_reference,
    'holderName', p.holder_name,
    'offerName', o.name,
    'offerKind', o.kind,
    'admits', p.admits,
    'admittedCount', p.admitted_count,
    'remaining', p.admits - p.admitted_count,
    'validLocalDate', p.valid_local_date,
    'validFrom', p.valid_from,
    'validTo', p.valid_to,
    'dayLabel', to_char(p.valid_local_date, 'FMDay DD Mon'),
    'idCheckLabel', p.id_check_label,
    'idCheckCount', p.id_check_count,
    'idCheckedAt', p.id_checked_at,
    'firstAdmittedAt', p.first_admitted_at,
    'lastAdmittedAt', p.last_admitted_at,
    'status', p.status,
    'source', p.source,
    'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(p.group_id) m),
    'totalDueMinor', (SELECT m.total_due FROM public.issue_4490_booking_money(p.group_id) m),
    'currencyCode', g.currency_code,
    'canTakePayment', g.state IN ('confirmed', 'partially_cancelled'),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', l.price_snapshot->>'optionName', 'guests', public.issue_4490_line_guests(l.id),
        'idCheckLabel', l.price_snapshot->>'idCheckLabel')
        ORDER BY COALESCE((l.price_snapshot->>'sortOrder')::integer, 0), l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = p.group_id AND l.state <> 'cancelled'), '[]'::jsonb)
  )
  FROM public.venue_passes p
  JOIN public.stay_reservation_groups g ON g.id = p.group_id
  JOIN public.stay_offerings o ON o.id = p.offering_id
  WHERE p.id = p_pass_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_admit_pass(
  p_venue public.venue_listings,
  p_pass_id uuid,
  p_admit_count integer,
  p_id_checked boolean,
  p_scanner uuid,
  p_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pass public.venue_passes%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_result text;
  v_count integer;
  v_log uuid;
  v_today date := public.issue_4490_venue_local_date(p_venue.id);
BEGIN
  SELECT * INTO v_pass FROM public.venue_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN
    v_log := public.issue_4490_log_check_in(p_venue, NULL, NULL, NULL, 'not_found', 0, p_method, p_scanner, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
  END IF;
  IF v_pass.venue_id <> p_venue.id THEN
    v_log := public.issue_4490_log_check_in(p_venue, NULL, NULL, NULL, 'wrong_venue', 0, p_method, p_scanner,
      jsonb_build_object('passVenueId', v_pass.venue_id));
    RETURN jsonb_build_object('result', 'wrong_venue', 'logId', v_log,
      'venueName', (SELECT v.name FROM public.venue_listings v WHERE v.id = v_pass.venue_id));
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_pass.group_id;
  IF v_pass.status <> 'valid' OR v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    v_result := 'void';
  ELSIF now() >= v_pass.valid_to
     OR (now() < v_pass.valid_from AND v_today <> v_pass.valid_local_date) THEN
    v_result := 'wrong_day';
  ELSIF now() < v_pass.valid_from THEN
    v_result := 'not_yet';
  ELSIF v_pass.admitted_count >= v_pass.admits THEN
    v_result := 'already_used';
  ELSIF v_pass.id_check_label IS NOT NULL AND v_pass.id_checked_at IS NULL AND NOT COALESCE(p_id_checked, false) THEN
    v_result := 'id_required';
  END IF;
  IF v_result IS NOT NULL THEN
    v_log := public.issue_4490_log_check_in(p_venue, v_pass.id, NULL, NULL, v_result, 0, p_method, p_scanner, '{}'::jsonb);
    RETURN jsonb_build_object('result', v_result, 'logId', v_log) || jsonb_build_object('pass', public.issue_4490_pass_view(v_pass.id));
  END IF;
  v_count := COALESCE(p_admit_count, v_pass.admits - v_pass.admitted_count);
  IF v_count < 1 OR v_count > v_pass.admits - v_pass.admitted_count THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('remaining', v_pass.admits - v_pass.admitted_count)::text;
  END IF;
  UPDATE public.venue_passes
  SET admitted_count = admitted_count + v_count,
      id_checked_at = CASE WHEN id_check_label IS NOT NULL AND COALESCE(p_id_checked, false)
                           THEN COALESCE(id_checked_at, now()) ELSE id_checked_at END,
      first_admitted_at = COALESCE(first_admitted_at, now()),
      last_admitted_at = now(),
      version = version + 1, updated_at = now()
  WHERE id = v_pass.id AND admitted_count + v_count <= admits
  RETURNING * INTO v_pass;
  IF NOT FOUND THEN
    v_log := public.issue_4490_log_check_in(p_venue, p_pass_id, NULL, NULL, 'already_used', 0, p_method, p_scanner, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'already_used', 'logId', v_log, 'pass', public.issue_4490_pass_view(p_pass_id));
  END IF;
  v_log := public.issue_4490_log_check_in(p_venue, v_pass.id, NULL, NULL, 'admitted', v_count, p_method, p_scanner,
    jsonb_build_object('idChecked', COALESCE(p_id_checked, false)));
  RETURN jsonb_build_object('result', 'admitted', 'admitted', v_count, 'logId', v_log,
    'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(v_pass.group_id) m),
    'pass', public.issue_4490_pass_view(v_pass.id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_check_in_list(
  p_venue_id uuid,
  p_local_date date,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_tz text;
  v_date date;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_date := COALESCE(p_local_date, (now() AT TIME ZONE v_tz)::date);
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'passes', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pass_view(p.id) || jsonb_build_object(
          'kind', 'pass', 'time', w.starts_at, 'endsAt', w.ends_at)
        ORDER BY w.starts_at, p.holder_name, p.id)
      FROM public.venue_passes p
      JOIN public.stay_reservation_lines l ON l.id = p.reservation_line_id
      JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
      WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'kind', 'event_ticket',
          'ticketId', t.id,
          'eventId', e.id,
          'eventTitle', e.title,
          'holderName', COALESCE(t.holder_name, t.attendee_name, o.buyer_name),
          'ticketName', tt.name,
          'admits', COALESCE(t.admits_count, 1),
          'admittedCount', CASE WHEN t.status = 'used' OR t.used_at IS NOT NULL THEN COALESCE(t.admits_count, 1) ELSE 0 END,
          'status', t.status,
          'time', d.start_at)
        ORDER BY d.start_at, t.id)
      FROM public.events e
      JOIN public.event_dates d ON d.event_id = e.id
        AND (d.start_at AT TIME ZONE v_tz)::date = v_date
        AND COALESCE(d.status, 'scheduled') <> 'cancelled'
      JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('valid', 'used')
      JOIN public.orders o ON o.id = t.order_id
      LEFT JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE e.venue_id = p_venue_id AND e.deleted_at IS NULL), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'admits', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_date date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_date := COALESCE(p_local_date, (now() AT TIME ZONE v_tz)::date);
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'closed', public.issue_4490_day_closed(p_venue_id, v_date),
    'pools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'poolId', p.id, 'name', p.name,
          'dailyLimit', u.limit_effective, 'keptForWalkIns', u.kept,
          'used', u.used, 'soldOnline', u.used_online, 'soldAtGate', u.used_gate,
          'onlineLeft', u.online_left, 'walkInLeft', u.kept_left, 'gateLeft', u.gate_left,
          'closed', u.closed,
          'override', (SELECT jsonb_build_object('dailyLimit', ov.daily_limit, 'keptForWalkIns', ov.kept_for_walk_ins,
                         'closed', ov.closed, 'version', ov.version)
                       FROM public.venue_capacity_overrides ov WHERE ov.pool_id = p.id AND ov.local_date = v_date))
        ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      CROSS JOIN LATERAL public.issue_4490_pool_day_usage(p.id, v_date) u
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'offerId', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style, 'status', o.status,
          'poolId', o.capacity_pool_id,
          'sold', COALESCE((
            SELECT sum(c.quantity) FROM public.stay_inventory_commitments c
            JOIN public.stay_place_windows w ON w.id = c.place_window_id
            WHERE c.offering_id = o.id AND c.state = 'active' AND w.local_date = v_date), 0),
          'held', COALESCE((
            SELECT sum(s.quantity) FROM public.stay_inventory_hold_slices s
            JOIN public.stay_inventory_holds h ON h.id = s.hold_id
            JOIN public.stay_place_windows w ON w.id = s.place_window_id
            WHERE s.offering_id = o.id AND w.local_date = v_date
              AND h.state = 'active' AND h.expires_at > now()), 0))
        ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place') AND o.status IN ('live', 'paused')), '[]'::jsonb),
    'checkIn', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'expected', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date),
    'bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'groupId', g.id, 'reference', g.public_reference, 'state', g.state,
          'guestName', g.guest_snapshot->>'name', 'guests', (SELECT sum(public.issue_4490_line_guests(l.id))
            FROM public.stay_reservation_lines l WHERE l.group_id = g.id),
          'offerKind', g.offer_kind,
          'startsAt', (SELECT w.starts_at FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
          'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(g.id) m),
          'balanceDueAt', g.balance_due_at,
          'totalMinor', g.total_minor, 'currencyCode', g.currency_code,
          'source', g.booking_source, 'paymentCollection', g.payment_collection,
          'admittedCount', (SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id),
          'createdAt', g.created_at)
        ORDER BY g.created_at DESC)
      FROM public.stay_reservation_groups g
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL
        AND g.state IN ('confirmed', 'partially_cancelled', 'cancelled', 'reconciliation_required', 'instant_payment_pending')
        AND (SELECT w.local_date FROM public.stay_place_windows w
             WHERE w.id = public.issue_4490_group_window_id(g.id)) = v_date), '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 17. Notifications: balance due / overdue, booking changed, balance paid.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_enqueue_offer_event(
  p_event public.stay_reservation_events,
  p_group public.stay_reservation_groups
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_category text;
  v_email text;
BEGIN
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RETURN;
  END IF;
  v_category := CASE p_event.event_type
    WHEN 'stay_reservation_confirmed' THEN 'venue_booking_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'venue_booking_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'venue_refund_state'
    -- #4490 P3: balance and change messages.
    WHEN 'stay_offer_balance_due' THEN 'venue_balance_due'
    WHEN 'stay_offer_balance_overdue' THEN 'venue_balance_overdue'
    WHEN 'stay_offer_changed' THEN 'venue_booking_changed'
    WHEN 'stay_offer_balance_paid' THEN 'venue_balance_paid'
    WHEN 'stay_offer_paid_at_venue' THEN 'venue_balance_paid'
    ELSE NULL END;
  IF v_category IS NULL OR p_group.payment_collection <> 'mingla' THEN
    RETURN;
  END IF;
  v_email := NULLIF(lower(btrim(COALESCE(p_group.guest_snapshot->>'email', ''))), '');
  IF v_email IS NULL AND p_group.user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
  ) VALUES (
    v_category, p_group.user_id, v_email, p_group.brand_id,
    jsonb_build_object(
      'venue_group_id', p_group.id,
      'public_reference', p_group.public_reference,
      'venue_id', p_group.venue_id,
      'offer_kind', p_group.offer_kind,
      'amount_cents', COALESCE((p_event.safe_metadata->>'amountMinor')::bigint, p_group.total_minor),
      'currency', p_group.currency_code
    ) || jsonb_strip_nulls(jsonb_build_object(
      'balance_due_at', p_group.balance_due_at,
      'change_action', p_event.safe_metadata->>'action',
      'reminder_reason', p_event.safe_metadata->>'reason')),
    'venue-offer:' || p_event.id || ':' || v_category || ':guest',
    NULL
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels)
VALUES
  ('venue_balance_due', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_balance_overdue', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_booking_changed', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_balance_paid', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email'])
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 18. The offer sweep (edge venue-offer-sweep, every 15 minutes): lapsed
--     holds (belt and braces; the Stays sweep already expires them), balance
--     reminders before the due date (venue_booking_settings.balance_reminder_days,
--     default 7 and 1 days), overdue notices on the due date and 3 days
--     after (no auto-cancel; the host decides). Idempotent: every message is
--     one booking event keyed by booking and day; SKIP LOCKED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_offer_sweep(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_expired jsonb;
  v_row record;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_day integer;
  v_inserted integer;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Lapsed holds: the generic Stays expiry (offer groups included).
  v_expired := to_jsonb(public.issue_1388_expire_groups(v_limit, gen_random_uuid()));

  FOR v_row IN
    SELECT g.id, g.balance_due_at, g.created_at, g.currency_code, g.venue_id,
           COALESCE(s.balance_reminder_days, '{7,1}'::smallint[]) AS days, m.balance
    FROM public.stay_reservation_groups g
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id
    CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) m
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'confirmed'
      AND g.balance_due_at IS NOT NULL
      AND g.balance_due_at <= now() + interval '60 days'
      AND g.balance_due_at >= now() - interval '4 days'
      AND m.balance > 0
    ORDER BY g.balance_due_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF now() < v_row.balance_due_at THEN
      -- The nearest reminder day already reached, if the booking existed then.
      SELECT min(d) INTO v_day FROM unnest(v_row.days) d
      WHERE d > 0
        AND now() >= v_row.balance_due_at - make_interval(days => d)
        AND v_row.created_at <= v_row.balance_due_at - make_interval(days => d);
      IF v_day IS NOT NULL THEN
        INSERT INTO public.stay_reservation_events (
          group_id, event_type, actor_type, idempotency_key, safe_metadata
        ) VALUES (
          v_row.id, 'stay_offer_balance_due', 'service', 'balance-reminder:' || v_row.id || ':' || v_day,
          jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
            'balanceDueAt', v_row.balance_due_at, 'reason', 'reminder', 'daysBefore', v_day)
        ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_reminders := v_reminders + v_inserted;
      END IF;
    ELSE
      v_day := CASE WHEN now() >= v_row.balance_due_at + interval '3 days' THEN 3 ELSE 0 END;
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, idempotency_key, safe_metadata
      ) VALUES (
        v_row.id, 'stay_offer_balance_overdue', 'service', 'balance-overdue:' || v_row.id || ':' || v_day,
        jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
          'balanceDueAt', v_row.balance_due_at, 'reason', 'overdue', 'daysAfter', v_day)
      ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_overdue := v_overdue + v_inserted;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('expired', v_expired, 'reminders', v_reminders, 'overdue', v_overdue);
END;
$function$;

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4490_offer_sweep') THEN
    PERFORM cron.unschedule('issue_4490_offer_sweep');
  END IF;
END;
$block$;

SELECT cron.schedule(
  'issue_4490_offer_sweep',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'supabase_url'
        LIMIT 1
      ) || '/functions/v1/venue-offer-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- ---------------------------------------------------------------------------
-- 19. Grants. New functions: nobody by default; Host RPCs to authenticated
--     (each checks the venue capability itself); guest and sweep RPCs to the
--     service role only (edge venue-offers / venue-check-in / venue-offer-sweep).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_extras_valid(jsonb),
  public.issue_4490_inclusions_valid(jsonb),
  public.issue_4490_guard_append_only_money(),
  public.issue_4490_guard_booking_money_insert(),
  public.issue_4490_line_window_id(uuid),
  public.issue_4490_line_guests(uuid),
  public.issue_4490_group_window_id(uuid),
  public.issue_4490_booking_money(uuid),
  public.issue_4490_deposit_plan(uuid, uuid, bigint),
  public.issue_4490_pass_validity(uuid, uuid),
  public.issue_4490_manage_package(text, uuid, jsonb, bigint, text),
  public.issue_4490_quote_offer_internal(uuid, uuid, jsonb, text, uuid, text, boolean, jsonb, jsonb),
  public.issue_4490_quote_offer(uuid, uuid, jsonb, text, uuid, text, jsonb, jsonb),
  public.issue_4490_payment_components(uuid),
  public.issue_4490_prepare_offer_payment(uuid, bytea, uuid, text, bigint, text),
  public.issue_4490_finalize_followup_payment(uuid, text, text, text, bigint, text, bigint),
  public.issue_4490_change_rules(uuid),
  public.issue_4490_refund_amount_internal(uuid, bigint, text, uuid, bytea, text, text),
  public.issue_4490_change_booking_internal(uuid, text, jsonb, boolean, text, uuid, bytea, bigint, text),
  public.issue_4490_change_booking(uuid, text, jsonb, boolean, bigint, text),
  public.issue_4490_guest_change_booking(uuid, bytea, uuid, text, jsonb, boolean, bigint, text),
  public.issue_4490_record_offline_payment_internal(uuid, bigint, text, date, text, uuid, text),
  public.issue_4490_record_offline_payment(uuid, bigint, text, date, text, text),
  public.issue_4490_record_offline_payment_for(uuid, uuid, bigint, text, text),
  public.issue_4490_send_booking_reminder(uuid, text),
  public.issue_4490_get_booking(uuid),
  public.issue_4490_preview_day_closure(uuid, date),
  public.issue_4490_offer_sweep(integer),
  public.issue_4490_balance_link_info(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.issue_4490_extras_valid(jsonb),
  public.issue_4490_inclusions_valid(jsonb)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_manage_package(text, uuid, jsonb, bigint, text),
  public.issue_4490_change_booking(uuid, text, jsonb, boolean, bigint, text),
  public.issue_4490_record_offline_payment(uuid, bigint, text, date, text, text),
  public.issue_4490_send_booking_reminder(uuid, text),
  public.issue_4490_get_booking(uuid),
  public.issue_4490_preview_day_closure(uuid, date)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_line_window_id(uuid),
  public.issue_4490_line_guests(uuid),
  public.issue_4490_group_window_id(uuid),
  public.issue_4490_booking_money(uuid),
  public.issue_4490_deposit_plan(uuid, uuid, bigint),
  public.issue_4490_pass_validity(uuid, uuid),
  public.issue_4490_quote_offer(uuid, uuid, jsonb, text, uuid, text, jsonb, jsonb),
  public.issue_4490_payment_components(uuid),
  public.issue_4490_prepare_offer_payment(uuid, bytea, uuid, text, bigint, text),
  public.issue_4490_change_rules(uuid),
  public.issue_4490_guest_change_booking(uuid, bytea, uuid, text, jsonb, boolean, bigint, text),
  public.issue_4490_record_offline_payment_for(uuid, uuid, bigint, text, text),
  public.issue_4490_offer_sweep(integer),
  public.issue_4490_balance_link_info(uuid, uuid, uuid)
TO service_role;

COMMIT;
