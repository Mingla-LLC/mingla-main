-- #4490 P2 migration 1 (P2-1) — the offer engine: venue offers are generalised
-- Stays offerings.
--
-- A venue sells OFFERS. An offer is a `stay_offerings` row of a new kind
-- (entry | group_package | private_hire | by_the_hour | membership), priced by
-- named price options, counted against a shared per-day capacity pool, and
-- booked through the same quote / group / hold / commitment / payment tables as
-- Stays. P2 sells kind `entry` only; the other kinds get their schema here and
-- their behaviour in P3–P6.
--
-- What this file adds
--   * stay_offerings: kind CHECK widened, a shape arm for the offer kinds, and
--     nullable offer columns (pool, entry style, inclusions, deposit, damage
--     deposit, min spend, extra guest, overtime, by-the-hour lengths, request
--     threshold). NULL / default means unused, so every Stay row is unchanged.
--   * venue_capacity_pools (+ venue_capacity_overrides), venue_booking_settings,
--     venue_offer_price_options, venue_offer_spaces. RLS: venue viewers read,
--     nobody writes directly; all writes go through SECURITY DEFINER RPCs.
--   * stay_price_versions.price_option_id + pricing unit 'place_hour'; one
--     current price per (offering, option) — a Stay row has no option, so it
--     still has exactly one current price.
--   * stay_policy_versions.refund_ladder / date_change_rule (empty = the Stays
--     free / late / no-show logic).
--   * quote and reservation lines: the offer kinds, price_option_id,
--     booked_minutes; quotes and groups: offer_kind; groups: deposit,
--     balance due, buyer token hash, payment plan snapshot, VB- references;
--     payment attempts: stage; cancel previews: guest token actor.
--   * Guards: Stays integrity / scope checks keep `venue_category='stay'` for
--     room/place rows and require a non-stay venue for offer rows (a live offer
--     also needs its feature on). Payment attempts and cancel previews of an
--     offer booking can only be written by the #4490 offer RPCs (the Stays
--     prepare / cancel RPCs cannot touch an offer booking).
--   * Stays reader isolation: pg_my_stay_reservation_groups lists Stays only;
--     issue_1389_line_start_at works without stay_settings.
--   * Offer authoring RPCs: issue_4490_manage_capacity_pool,
--     issue_4490_manage_offer, issue_4490_list_offers,
--     issue_4490_set_capacity_override, issue_4490_save_booking_settings,
--     issue_4490_admin_set_offer_status. Turning a kind's feature off pauses
--     that kind's live offers.
--   * `entry` joins issue_4490_built_features(), so hosts can switch it on.
--
-- Errors: validation 22023, missing P0002, permission 42501, readiness P0001
-- (`offer_not_ready:<reason>`), conflicts PT409 (`stale_write`). Never 40001.
--
-- Static SQL (no EXECUTE). Local stack only until Seth says otherwise.
--
-- Reverse (local only): DROP the new tables and functions, restore the Stays
-- function bodies from 20271231204134 / 20280212004188, and drop the added
-- columns; the widened CHECKs revert only while no offer rows exist.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Venue booking settings, capacity pools and per-day overrides.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_booking_settings (
  venue_id uuid PRIMARY KEY REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  timezone text NOT NULL,
  instant_payment_hold_minutes smallint NOT NULL DEFAULT 15
    CHECK (instant_payment_hold_minutes BETWEEN 5 AND 60),
  request_response_hours smallint NOT NULL DEFAULT 48
    CHECK (request_response_hours BETWEEN 1 AND 168),
  approved_payment_minutes integer NOT NULL DEFAULT 4320
    CHECK (approved_payment_minutes BETWEEN 10 AND 10080),
  booking_horizon_days smallint NOT NULL DEFAULT 365
    CHECK (booking_horizon_days BETWEEN 1 AND 730),
  vat_mode text NOT NULL DEFAULT 'included'
    CHECK (vat_mode IN ('included', 'added', 'none')),
  booking_state text NOT NULL DEFAULT 'active'
    CHECK (booking_state IN ('active', 'paused')),
  balance_reminder_days smallint[] NOT NULL DEFAULT '{7,1}',
  damage_deposit_release_days smallint NOT NULL DEFAULT 7
    CHECK (damage_deposit_release_days BETWEEN 1 AND 60),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT venue_booking_settings_reminders_valid CHECK (
    cardinality(balance_reminder_days) <= 5
    AND 0 <= ALL (balance_reminder_days)
    AND 60 >= ALL (balance_reminder_days)
  )
);

CREATE TABLE public.venue_capacity_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  daily_limit integer NOT NULL CHECK (daily_limit BETWEEN 1 AND 100000),
  kept_for_walk_ins integer NOT NULL DEFAULT 0,
  space_ids uuid[],
  archived_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT venue_capacity_pools_kept_valid
    CHECK (kept_for_walk_ins BETWEEN 0 AND daily_limit),
  CONSTRAINT venue_capacity_pools_spaces_valid
    CHECK (space_ids IS NULL OR cardinality(space_ids) BETWEEN 1 AND 50)
);
CREATE INDEX venue_capacity_pools_venue_idx ON public.venue_capacity_pools (venue_id);
CREATE UNIQUE INDEX venue_capacity_pools_name_uniq
  ON public.venue_capacity_pools (venue_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE TABLE public.venue_capacity_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES public.venue_capacity_pools(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  daily_limit integer CHECK (daily_limit BETWEEN 0 AND 100000),
  kept_for_walk_ins integer CHECK (kept_for_walk_ins BETWEEN 0 AND 100000),
  closed boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (pool_id, local_date),
  CONSTRAINT venue_capacity_overrides_kept_valid CHECK (
    daily_limit IS NULL OR kept_for_walk_ins IS NULL OR kept_for_walk_ins <= daily_limit
  )
);
CREATE INDEX venue_capacity_overrides_venue_date_idx
  ON public.venue_capacity_overrides (venue_id, local_date);

-- ---------------------------------------------------------------------------
-- 2. stay_offerings: the offer kinds and their columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stay_offerings DROP CONSTRAINT stay_offerings_kind_check;
ALTER TABLE public.stay_offerings ADD CONSTRAINT stay_offerings_kind_check CHECK (
  kind IN ('room', 'place', 'entry', 'group_package', 'private_hire', 'by_the_hour', 'membership')
);
ALTER TABLE public.stay_offerings DROP CONSTRAINT stay_offering_kind_shape;
ALTER TABLE public.stay_offerings ADD CONSTRAINT stay_offering_kind_shape CHECK (
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
      (inventory_basis = 'exclusive_units' AND quantity IS NOT NULL AND capacity IS NULL)
      OR
      (
        inventory_basis = 'shared_capacity'
        AND quantity IS NULL
        AND capacity IS NOT NULL
        AND unit_naming_mode = 'interchangeable'
      )
    )
  )
  OR
  (
    kind IN ('entry', 'group_package', 'private_hire', 'by_the_hour', 'membership')
    AND max_adults IS NULL
    AND max_children IS NULL
    AND place_pricing_basis IS NOT NULL
    AND access_scope = 'public'
    AND (
      (inventory_basis = 'exclusive_units' AND quantity IS NOT NULL AND capacity IS NULL)
      OR
      (
        inventory_basis = 'shared_capacity'
        AND quantity IS NULL
        AND capacity IS NOT NULL
        AND unit_naming_mode = 'interchangeable'
      )
    )
  )
);

ALTER TABLE public.stay_offerings
  ADD COLUMN capacity_pool_id uuid
    REFERENCES public.venue_capacity_pools(id) ON DELETE RESTRICT,
  ADD COLUMN entry_style text
    CHECK (entry_style IS NULL OR entry_style IN ('walk_in', 'day_pass', 'timed_session')),
  ADD COLUMN inclusions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(inclusions) = 'array' AND jsonb_array_length(inclusions) <= 30),
  ADD COLUMN staff_role_label text
    CHECK (staff_role_label IS NULL OR char_length(btrim(staff_role_label)) BETWEEN 1 AND 60),
  ADD COLUMN deposit_kind text NOT NULL DEFAULT 'none'
    CHECK (deposit_kind IN ('none', 'percent', 'fixed')),
  ADD COLUMN deposit_value bigint,
  ADD COLUMN balance_due_days_before smallint
    CHECK (balance_due_days_before IS NULL OR balance_due_days_before BETWEEN 0 AND 365),
  ADD COLUMN damage_deposit_minor bigint NOT NULL DEFAULT 0 CHECK (damage_deposit_minor >= 0),
  ADD COLUMN min_spend_minor bigint NOT NULL DEFAULT 0 CHECK (min_spend_minor >= 0),
  ADD COLUMN extra_guest_minor bigint CHECK (extra_guest_minor IS NULL OR extra_guest_minor >= 0),
  ADD COLUMN overtime_minor_per_hour bigint
    CHECK (overtime_minor_per_hour IS NULL OR overtime_minor_per_hour >= 0),
  ADD COLUMN booking_length_min_minutes integer
    CHECK (booking_length_min_minutes IS NULL OR booking_length_min_minutes BETWEEN 15 AND 1440),
  ADD COLUMN booking_length_max_minutes integer
    CHECK (booking_length_max_minutes IS NULL OR booking_length_max_minutes BETWEEN 15 AND 1440),
  ADD COLUMN booking_length_step_minutes integer
    CHECK (booking_length_step_minutes IS NULL OR booking_length_step_minutes IN (15, 30, 60)),
  ADD COLUMN request_only_above_guests integer
    CHECK (request_only_above_guests IS NULL OR request_only_above_guests BETWEEN 1 AND 100000),
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.stay_offerings
  ADD CONSTRAINT stay_offering_offer_columns_shape CHECK (
    (
      kind IN ('room', 'place')
      AND capacity_pool_id IS NULL
      AND entry_style IS NULL
      AND deposit_kind = 'none'
      AND deposit_value IS NULL
      AND booking_length_min_minutes IS NULL
      AND request_only_above_guests IS NULL
    )
    OR kind NOT IN ('room', 'place')
  ),
  ADD CONSTRAINT stay_offering_entry_style_required CHECK (
    kind <> 'entry' OR entry_style IS NOT NULL
  ),
  ADD CONSTRAINT stay_offering_pool_required_live CHECK (
    kind NOT IN ('entry', 'group_package')
    OR status IN ('draft', 'archived')
    OR capacity_pool_id IS NOT NULL
  ),
  ADD CONSTRAINT stay_offering_deposit_shape CHECK (
    (deposit_kind = 'none' AND deposit_value IS NULL)
    OR (deposit_kind = 'percent' AND deposit_value BETWEEN 1 AND 10000
        AND balance_due_days_before IS NOT NULL)
    OR (deposit_kind = 'fixed' AND deposit_value >= 1
        AND balance_due_days_before IS NOT NULL)
  ),
  ADD CONSTRAINT stay_offering_length_order CHECK (
    booking_length_min_minutes IS NULL OR booking_length_max_minutes IS NULL
    OR booking_length_max_minutes >= booking_length_min_minutes
  );
CREATE INDEX stay_offerings_pool_idx ON public.stay_offerings (capacity_pool_id)
  WHERE capacity_pool_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Price options and offer spaces.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_busy_rules_valid(p_rules jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT jsonb_typeof(p_rules) = 'array'
    AND jsonb_array_length(p_rules) <= 10
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_rules) rule
      WHERE jsonb_typeof(rule) <> 'object'
         OR jsonb_typeof(rule->'weekdays') <> 'array'
         OR jsonb_array_length(rule->'weekdays') NOT BETWEEN 1 AND 7
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(rule->'weekdays') d
           WHERE jsonb_typeof(d) <> 'number' OR d::text !~ '^[0-6]$'
         )
         OR COALESCE(rule->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR COALESCE(rule->>'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR jsonb_typeof(rule->'amount_minor') <> 'number'
         OR (rule->>'amount_minor') !~ '^[0-9]{1,12}$'
    );
$function$;

CREATE TABLE public.venue_offer_price_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  unit text NOT NULL CHECK (unit IN ('guest', 'booking', 'hour', 'unit')),
  guest_min integer NOT NULL,
  guest_max integer NOT NULL,
  weekdays smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  local_start_time time,
  local_end_time time,
  eligibility jsonb,
  busy_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT venue_offer_price_options_guests CHECK (
    guest_min >= 1 AND guest_min <= guest_max AND guest_max <= 100000
  ),
  CONSTRAINT venue_offer_price_options_weekdays CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  CONSTRAINT venue_offer_price_options_times CHECK (
    (local_start_time IS NULL) = (local_end_time IS NULL)
  ),
  CONSTRAINT venue_offer_price_options_eligibility CHECK (
    eligibility IS NULL OR (
      jsonb_typeof(eligibility) = 'object'
      AND jsonb_typeof(eligibility->'label') = 'string'
      AND char_length(btrim(eligibility->>'label')) BETWEEN 1 AND 80
      AND jsonb_typeof(eligibility->'check_at_gate') = 'boolean'
      AND eligibility - ARRAY['label', 'check_at_gate'] = '{}'::jsonb
    )
  ),
  CONSTRAINT venue_offer_price_options_busy CHECK (public.issue_4490_busy_rules_valid(busy_rules))
);
CREATE INDEX venue_offer_price_options_offering_idx
  ON public.venue_offer_price_options (offering_id, status, sort_order);
CREATE UNIQUE INDEX venue_offer_price_options_name_uniq
  ON public.venue_offer_price_options (offering_id, lower(btrim(name)))
  WHERE status = 'active';

CREATE TABLE public.venue_offer_spaces (
  offering_id uuid NOT NULL REFERENCES public.stay_offerings(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  combination_id uuid REFERENCES public.venue_space_combinations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offering_id, space_id)
);

-- ---------------------------------------------------------------------------
-- 4. Prices, policies, lines, quotes, groups, attempts, previews.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stay_price_versions
  ADD COLUMN price_option_id uuid
    REFERENCES public.venue_offer_price_options(id) ON DELETE RESTRICT;
ALTER TABLE public.stay_price_versions DROP CONSTRAINT stay_price_versions_pricing_unit_check;
ALTER TABLE public.stay_price_versions ADD CONSTRAINT stay_price_versions_pricing_unit_check CHECK (
  pricing_unit IN ('room_night', 'place_booking', 'place_unit', 'place_guest', 'place_hour')
);
DROP INDEX public.stay_price_one_current_idx;
CREATE UNIQUE INDEX stay_price_one_current_idx
  ON public.stay_price_versions (
    offering_id,
    COALESCE(price_option_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE effective_to IS NULL;

CREATE OR REPLACE FUNCTION public.issue_4490_refund_ladder_valid(p_ladder jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT jsonb_typeof(p_ladder) = 'array'
    AND jsonb_array_length(p_ladder) <= 6
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_ladder) WITH ORDINALITY AS rung(value, ord)
      WHERE jsonb_typeof(rung.value) <> 'object'
         OR COALESCE(rung.value->>'min_minutes_before', '') !~ '^[0-9]{1,7}$'
         OR COALESCE(rung.value->>'refund_bps', '') !~ '^[0-9]{1,5}$'
         OR (rung.value->>'refund_bps')::integer > 10000
         OR rung.value - ARRAY['min_minutes_before', 'refund_bps'] <> '{}'::jsonb
         OR (rung.ord > 1 AND (rung.value->>'min_minutes_before')::integer >= (
              (p_ladder->(rung.ord::integer - 2))->>'min_minutes_before')::integer)
    );
$function$;

ALTER TABLE public.stay_policy_versions
  ADD COLUMN refund_ladder jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (public.issue_4490_refund_ladder_valid(refund_ladder)),
  ADD COLUMN date_change_rule jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (
      jsonb_typeof(date_change_rule) = 'object'
      AND date_change_rule - ARRAY['allowed_until_minutes_before', 'fee_bps', 'max_changes',
                                   'guest_change_until_minutes_before'] = '{}'::jsonb
    );

ALTER TABLE public.stay_quote_lines DROP CONSTRAINT stay_quote_lines_kind_check;
ALTER TABLE public.stay_quote_lines ADD CONSTRAINT stay_quote_lines_kind_check CHECK (
  kind IN ('room', 'place', 'entry', 'group_package', 'private_hire', 'by_the_hour', 'membership')
);
ALTER TABLE public.stay_quote_lines DROP CONSTRAINT stay_quote_line_shape;
ALTER TABLE public.stay_quote_lines ADD CONSTRAINT stay_quote_line_shape CHECK (
  (
    kind = 'room'
    AND room_check_in IS NOT NULL
    AND room_check_out > room_check_in
    AND room_quantity BETWEEN 1 AND 100
    AND place_window_id IS NULL
    AND place_units IS NULL
    AND place_guests IS NULL
    AND (adults + children) > 0
  )
  OR
  (
    kind <> 'room'
    AND room_check_in IS NULL
    AND room_check_out IS NULL
    AND room_quantity IS NULL
    AND place_window_id IS NOT NULL
    AND (place_units IS NULL OR place_units BETWEEN 1 AND 100)
    AND place_guests BETWEEN 1 AND 1000
  )
);
ALTER TABLE public.stay_quote_lines
  ADD COLUMN price_option_id uuid REFERENCES public.venue_offer_price_options(id) ON DELETE RESTRICT,
  ADD COLUMN booked_minutes integer CHECK (booked_minutes IS NULL OR booked_minutes BETWEEN 15 AND 10080);
ALTER TABLE public.stay_quote_lines ADD CONSTRAINT stay_quote_line_offer_option CHECK (
  kind IN ('room', 'place') OR price_option_id IS NOT NULL
);
CREATE UNIQUE INDEX stay_quote_offer_option_unique
  ON public.stay_quote_lines (quote_id, offering_id, place_window_id, price_option_id)
  WHERE kind NOT IN ('room', 'place');

ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_kind_check;
ALTER TABLE public.stay_reservation_lines ADD CONSTRAINT stay_reservation_lines_kind_check CHECK (
  kind IN ('room', 'place', 'entry', 'group_package', 'private_hire', 'by_the_hour', 'membership')
);
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_line_shape;
ALTER TABLE public.stay_reservation_lines ADD CONSTRAINT stay_reservation_line_shape CHECK (
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
    kind <> 'room'
    AND room_check_in IS NULL
    AND room_check_out IS NULL
    AND room_quantity IS NULL
    AND place_window_id IS NOT NULL
    AND (place_units IS NULL OR place_units BETWEEN 1 AND 100)
    AND place_guests BETWEEN 1 AND 1000
  )
);
ALTER TABLE public.stay_reservation_lines
  ADD COLUMN price_option_id uuid REFERENCES public.venue_offer_price_options(id) ON DELETE RESTRICT,
  ADD COLUMN booked_minutes integer CHECK (booked_minutes IS NULL OR booked_minutes BETWEEN 15 AND 10080);

ALTER TABLE public.stay_quotes
  ADD COLUMN offer_kind text CHECK (
    offer_kind IS NULL OR offer_kind IN ('entry', 'group_package', 'private_hire', 'by_the_hour', 'membership')
  );

ALTER TABLE public.stay_reservation_groups
  ADD COLUMN offer_kind text CHECK (
    offer_kind IS NULL OR offer_kind IN ('entry', 'group_package', 'private_hire', 'by_the_hour', 'membership')
  ),
  ADD COLUMN deposit_minor bigint CHECK (deposit_minor IS NULL OR deposit_minor >= 0),
  ADD COLUMN balance_due_at timestamptz,
  ADD COLUMN buyer_token_hash bytea CHECK (buyer_token_hash IS NULL OR octet_length(buyer_token_hash) = 32),
  ADD COLUMN payment_plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payment_plan_snapshot) = 'object');
ALTER TABLE public.stay_reservation_groups
  ADD CONSTRAINT stay_group_offer_plan_present CHECK (
    offer_kind IS NULL OR payment_plan_snapshot <> '{}'::jsonb
  );
CREATE UNIQUE INDEX stay_reservation_groups_buyer_token_hash_key
  ON public.stay_reservation_groups (buyer_token_hash)
  WHERE buyer_token_hash IS NOT NULL;
CREATE INDEX stay_reservation_groups_offer_venue_idx
  ON public.stay_reservation_groups (venue_id, state)
  WHERE offer_kind IS NOT NULL;
ALTER TABLE public.stay_reservation_groups DROP CONSTRAINT stay_reservation_groups_public_reference_check;
ALTER TABLE public.stay_reservation_groups ADD CONSTRAINT stay_reservation_groups_public_reference_check CHECK (
  public_reference ~ '^(ST|VB)-[A-F0-9]{20}$'
  AND ((offer_kind IS NULL) = (public_reference LIKE 'ST-%'))
);

ALTER TABLE public.stay_payment_attempts
  ADD COLUMN stage text NOT NULL DEFAULT 'full'
    CHECK (stage IN ('full', 'deposit', 'balance', 'amendment', 'gate'));

ALTER TABLE public.stay_cancel_previews
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD COLUMN actor_token_hash bytea
    CHECK (actor_token_hash IS NULL OR octet_length(actor_token_hash) = 32);
ALTER TABLE public.stay_cancel_previews ADD CONSTRAINT stay_cancel_preview_actor_present CHECK (
  actor_user_id IS NOT NULL
  OR (actor_type = 'guest' AND actor_token_hash IS NOT NULL)
  OR actor_type = 'system'
);

-- ---------------------------------------------------------------------------
-- 5. RLS for the new tables (venue viewers read; no direct writes).
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_capacity_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_capacity_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_offer_price_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_offer_spaces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.venue_booking_settings, public.venue_capacity_pools,
  public.venue_capacity_overrides, public.venue_offer_price_options,
  public.venue_offer_spaces FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_booking_settings, public.venue_capacity_pools,
  public.venue_capacity_overrides, public.venue_offer_price_options,
  public.venue_offer_spaces TO authenticated;
GRANT ALL ON public.venue_booking_settings, public.venue_capacity_pools,
  public.venue_capacity_overrides, public.venue_offer_price_options,
  public.venue_offer_spaces TO service_role;

CREATE POLICY "venue booking settings readable by venue viewers"
  ON public.venue_booking_settings FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue capacity pools readable by venue viewers"
  ON public.venue_capacity_pools FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue capacity overrides readable by venue viewers"
  ON public.venue_capacity_overrides FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue offer price options readable by venue viewers"
  ON public.venue_offer_price_options FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue offer spaces readable by venue viewers"
  ON public.venue_offer_spaces FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));

CREATE TRIGGER issue_4490_venue_booking_settings_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_booking_settings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_venue_capacity_pools_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_capacity_pools
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_venue_capacity_overrides_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_capacity_overrides
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_venue_offer_price_options_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_offer_price_options
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_venue_offer_spaces_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_offer_spaces
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();

CREATE OR REPLACE FUNCTION public.issue_4490_assert_offer_child_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_TABLE_NAME IN ('venue_offer_price_options', 'venue_offer_spaces') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.stay_offerings o
      WHERE o.id = NEW.offering_id AND o.venue_id = NEW.venue_id
        AND o.kind NOT IN ('room', 'place')
    ) THEN
      RAISE EXCEPTION 'offer_scope_mismatch' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'venue_offer_spaces' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.venue_spaces s
        WHERE s.id = NEW.space_id AND s.venue_id = NEW.venue_id
      ) THEN
        RAISE EXCEPTION 'offer_scope_mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'venue_capacity_overrides' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venue_capacity_pools p
      WHERE p.id = NEW.pool_id AND p.venue_id = NEW.venue_id
    ) THEN
      RAISE EXCEPTION 'offer_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'venue_capacity_pools' THEN
    IF NEW.space_ids IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM unnest(NEW.space_ids) sid
        WHERE NOT EXISTS (
          SELECT 1 FROM public.venue_spaces s
          WHERE s.id = sid AND s.venue_id = NEW.venue_id AND s.archived_at IS NULL
        )
      ) THEN
        RAISE EXCEPTION 'pool_space_invalid' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_venue_offer_price_options_scope
  BEFORE INSERT OR UPDATE ON public.venue_offer_price_options
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_offer_child_scope();
CREATE TRIGGER issue_4490_venue_offer_spaces_scope
  BEFORE INSERT OR UPDATE ON public.venue_offer_spaces
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_offer_child_scope();
CREATE TRIGGER issue_4490_venue_capacity_overrides_scope
  BEFORE INSERT OR UPDATE ON public.venue_capacity_overrides
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_offer_child_scope();
CREATE TRIGGER issue_4490_venue_capacity_pools_scope
  BEFORE INSERT OR UPDATE ON public.venue_capacity_pools
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_offer_child_scope();

-- ---------------------------------------------------------------------------
-- 6. Feature / kind helpers, built features.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays', 'entry']::text[];
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_offer_kind_feature(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_kind
    WHEN 'entry' THEN 'entry'
    WHEN 'group_package' THEN 'group_packages'
    WHEN 'private_hire' THEN 'private_hire'
    WHEN 'by_the_hour' THEN 'by_the_hour'
    WHEN 'membership' THEN 'memberships'
    ELSE NULL
  END;
$function$;

-- Offer kinds whose selling flows have shipped (mirror of the built features).
CREATE OR REPLACE FUNCTION public.issue_4490_built_offer_kinds()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['entry']::text[];
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_feature_on(p_venue_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT r.enabled FROM public.issue_4490_venue_feature_rows(p_venue_id) r
    WHERE r.feature_key = p_key
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_flag_on(p_flag text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((SELECT f.is_enabled FROM public.feature_flags f WHERE f.flag_key = p_flag), false);
$function$;

-- A named user's venue capability (the #4188 grant rows), for service-role
-- RPCs that act for a user the edge function has already authenticated.
-- issue_4188_has_venue_capability only answers for auth.uid().
CREATE OR REPLACE FUNCTION public.issue_4490_user_has_venue_capability(p_venue_id uuid, p_user_id uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND p_capability LIKE 'venue.%' AND EXISTS (
    SELECT 1
    FROM public.brand_team_members member
    JOIN public.brand_team_member_venue_grants grant_row ON grant_row.member_id = member.id
    JOIN public.venue_listings venue ON venue.id = grant_row.venue_id AND venue.brand_id = member.brand_id
    WHERE member.user_id = p_user_id
      AND member.role = 'venue_staff'
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
      AND grant_row.venue_id = p_venue_id
      AND p_capability = ANY(grant_row.capabilities)
  );
$function$;

-- Money actions: venue.manage_money, or brand rank >= finance_manager (rank 30).
CREATE OR REPLACE FUNCTION public.issue_4490_can_manage_money(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND (
        public.biz_brand_effective_rank(venue.brand_id, p_user_id) >= public.biz_role_rank('finance_manager')
        OR public.issue_4490_user_has_venue_capability(venue.id, p_user_id, 'venue.manage_money')
      )
  );
$function$;

-- Check-in: venue.check_in, or brand rank >= scanner.
CREATE OR REPLACE FUNCTION public.issue_4490_can_check_in(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND (
        public.biz_brand_effective_rank(venue.brand_id, p_user_id) >= public.biz_role_rank('scanner')
        OR public.issue_4490_user_has_venue_capability(venue.id, p_user_id, 'venue.check_in')
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 7. Stays guards: keep `stay` for room/place rows, require a non-stay venue
--    (and, to go live, the feature) for offer rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1387_assert_stay_row_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_offering public.stay_offerings%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_kind text;
BEGIN
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = NEW.venue_id;
  IF NOT FOUND OR v_venue.brand_id <> NEW.brand_id THEN
    RAISE EXCEPTION 'stay_venue_brand_mismatch' USING ERRCODE = '23514';
  END IF;

  -- #4490: which kind of row is this? Stays rows (room/place, settings, bulk
  -- jobs) keep the `stay` venue rule; offer rows need a non-stay venue.
  IF TG_TABLE_NAME = 'stay_offerings' THEN
    v_kind := NEW.kind;
  ELSIF TG_TABLE_NAME IN ('stay_settings', 'stay_bulk_jobs') THEN
    v_kind := NULL;
  ELSIF NEW.offering_id IS NOT NULL THEN
    SELECT kind INTO v_kind FROM public.stay_offerings WHERE id = NEW.offering_id;
  END IF;
  IF v_kind IS NULL OR v_kind IN ('room', 'place') THEN
    IF v_venue.venue_category <> 'stay' THEN
      RAISE EXCEPTION 'stay_venue_brand_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_venue.venue_category = 'stay' THEN
      RAISE EXCEPTION 'offer_not_on_stay_venue' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'stay_offerings' THEN
      IF NEW.status = 'live' THEN
        IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'live' THEN
          IF NOT public.issue_4490_venue_feature_on(
            NEW.venue_id, public.issue_4490_offer_kind_feature(NEW.kind)
          ) THEN
            RAISE EXCEPTION 'offer_not_ready:feature_off' USING ERRCODE = 'P0001';
          END IF;
        END IF;
      END IF;
    END IF;
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
         AND v_offering.kind = 'room' THEN
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
      IF TG_TABLE_NAME = 'stay_price_versions' THEN
        IF v_offering.kind IN ('room', 'place') AND NEW.price_option_id IS NOT NULL THEN
          RAISE EXCEPTION 'stay_offering_scope_mismatch' USING ERRCODE = '23514';
        END IF;
        IF v_offering.kind NOT IN ('room', 'place') AND (
          NEW.price_option_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.venue_offer_price_options o
            WHERE o.id = NEW.price_option_id AND o.offering_id = NEW.offering_id
          )
        ) THEN
          RAISE EXCEPTION 'offer_price_option_required' USING ERRCODE = '23514';
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
    -- #4490: a Stays quote (offer_kind NULL) needs a stay venue; an offer
    -- quote needs a non-stay venue.
    IF NOT EXISTS (
      SELECT 1
      FROM public.venue_listings v
      WHERE v.id = NEW.venue_id
        AND v.brand_id = NEW.brand_id
        AND (
          (NEW.offer_kind IS NULL AND v.venue_category = 'stay')
          OR (NEW.offer_kind IS NOT NULL AND v.venue_category <> 'stay')
        )
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
       OR v_offering.kind <> NEW.kind
       OR (v_quote.offer_kind IS NULL) <> (NEW.kind IN ('room', 'place'))
       OR (v_quote.offer_kind IS NOT NULL AND v_quote.offer_kind <> NEW.kind) THEN
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
    IF NEW.price_option_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.id = NEW.price_option_id AND o.offering_id = NEW.offering_id
    ) THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
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
       OR v_quote.actor_key_hash <> NEW.actor_key_hash
       OR v_quote.offer_kind IS DISTINCT FROM NEW.offer_kind THEN
      RAISE EXCEPTION 'stay_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_lines' THEN
    SELECT * INTO v_group
    FROM public.stay_reservation_groups WHERE id = NEW.group_id;
    SELECT * INTO v_quote_line
    FROM public.stay_quote_lines WHERE id = NEW.quote_line_id;
    IF NOT FOUND OR v_quote_line.quote_id <> v_group.quote_id
       OR v_quote_line.offering_id <> NEW.offering_id
       OR v_quote_line.kind <> NEW.kind
       OR v_quote_line.price_option_id IS DISTINCT FROM NEW.price_option_id THEN
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

-- Immutable history: the #4490 snapshot columns are frozen like the rest.
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

-- Gate sales insert a walk-in group directly; every other insert path keeps
-- the #4188 rule (guests insert guest/mingla rows only).
CREATE OR REPLACE FUNCTION public.issue_4188_guard_stay_group_source_truth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.offer_kind IS NOT NULL
       AND NEW.booking_source = 'walk_in'
       AND NEW.payment_collection IN ('mingla', 'property')
       AND NEW.created_by_staff_user_id IS NOT NULL
       AND current_setting('mingla.issue_4490_gate_sale', true) = NEW.id::text THEN
      RETURN NEW;
    END IF;
    IF NEW.booking_source <> 'guest'
       OR NEW.payment_collection <> 'mingla'
       OR NEW.created_by_staff_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'stay_group_source_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.booking_source IS NOT DISTINCT FROM OLD.booking_source
     AND NEW.payment_collection IS NOT DISTINCT FROM OLD.payment_collection
     AND NEW.created_by_staff_user_id
       IS NOT DISTINCT FROM OLD.created_by_staff_user_id THEN
    RETURN NEW;
  END IF;
  IF OLD.payment_collection = 'property'
     AND NEW.booking_source = OLD.booking_source
     AND NEW.payment_collection = OLD.payment_collection
     AND OLD.created_by_staff_user_id IS NOT NULL
     AND NEW.created_by_staff_user_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM auth.users user_row
       WHERE user_row.id = OLD.created_by_staff_user_id
     ) THEN
    -- Preserve account deletion/erasure. The booking and immutable source stay
    -- intact; only the FK actor pointer is cleared after the auth row is gone.
    RETURN NEW;
  END IF;
  IF OLD.booking_source = 'guest'
     AND OLD.payment_collection = 'mingla'
     AND OLD.created_by_staff_user_id IS NULL
     AND NEW.booking_source IN (
       'phone', 'walk_in', 'website', 'instagram', 'mingla'
     )
     AND NEW.payment_collection = 'property'
     AND NEW.created_by_staff_user_id = auth.uid()
     AND OLD.state = 'finalizing'
     AND NEW.state = 'confirmed'
     AND current_setting(
       'mingla.issue_4188_staff_conversion', true
     ) = NEW.id::text
     AND public.issue_4188_has_stay_permission(
       NEW.venue_id, NEW.brand_id, auth.uid(), 'create'
     ) THEN
    RETURN NEW;
  END IF;
  IF OLD.booking_source = 'guest'
     AND OLD.payment_collection = 'mingla'
     AND OLD.created_by_staff_user_id IS NULL
     AND NEW.booking_source IN (
       'phone', 'walk_in', 'website', 'instagram', 'mingla'
     )
     AND NEW.payment_collection = 'mingla'
     AND NEW.created_by_staff_user_id = auth.uid()
     AND NEW.state IN ('instant_payment_pending', 'approved_payment_required')
     AND current_setting(
       'mingla.issue_4188_staff_conversion', true
     ) = NEW.id::text
     AND public.issue_4188_has_stay_permission(
       NEW.venue_id, NEW.brand_id, auth.uid(), 'create'
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stay_group_source_immutable' USING ERRCODE = '55000';
END;
$function$;

-- The Stays prepare / cancel RPCs cannot write money rows for an offer
-- booking: only the #4490 offer RPCs (which set the transaction-local rail
-- marker to the group id) may.
CREATE OR REPLACE FUNCTION public.issue_4490_guard_offer_money_rows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.stay_reservation_groups g
    WHERE g.id = NEW.group_id AND g.offer_kind IS NOT NULL
  ) AND current_setting('mingla.issue_4490_offer_rail', true) IS DISTINCT FROM NEW.group_id::text THEN
    RAISE EXCEPTION 'offer_rail_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_offer_attempts_rail
  BEFORE INSERT ON public.stay_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_offer_money_rows();
CREATE TRIGGER issue_4490_offer_previews_rail
  BEFORE INSERT ON public.stay_cancel_previews
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_offer_money_rows();
CREATE TRIGGER issue_4490_offer_refunds_rail
  BEFORE INSERT ON public.stay_refunds
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_offer_money_rows();

-- Line start without stay_settings (offer venues have none). Rooms still use
-- the Stay's timezone; every other line starts at its window.
CREATE OR REPLACE FUNCTION public.issue_1389_line_start_at(p_line_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE line.kind
    WHEN 'room' THEN
      line.room_check_in::timestamp AT TIME ZONE settings.timezone
    ELSE window_row.starts_at
  END
  FROM public.stay_reservation_lines line
  JOIN public.stay_reservation_groups group_row ON group_row.id = line.group_id
  LEFT JOIN public.stay_settings settings ON settings.venue_id = group_row.venue_id
  LEFT JOIN public.stay_place_windows window_row
    ON window_row.id = line.place_window_id
  WHERE line.id = p_line_id;
$function$;

-- Stays reader isolation: the guest's Stays list shows Stays only (venue
-- bookings are listed by issue_4490_my_offer_bookings).
CREATE OR REPLACE FUNCTION public.pg_my_stay_reservation_groups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'groupId', reservation_group.id,
      'publicReference', reservation_group.public_reference,
      'venueId', reservation_group.venue_id,
      'venueName', venue.name,
      'venueSlug', venue.slug,
      'brandId', reservation_group.brand_id,
      'brandName', brand.name,
      'brandSlug', brand.slug,
      'currencyCode', reservation_group.currency_code,
      'mode', reservation_group.mode,
      'state', reservation_group.state,
      'requestDeadline', reservation_group.request_deadline,
      'paymentDeadline', reservation_group.payment_deadline,
      'totalMinor', reservation_group.total_minor::text,
      'version', reservation_group.version,
      'createdAt', reservation_group.created_at,
      'updatedAt', reservation_group.updated_at,
      'lines', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'lineId', reservation_line.id,
          'kind', reservation_line.kind,
          'state', reservation_line.state,
          'name', reservation_line.offering_snapshot->>'name',
          'roomCheckIn', reservation_line.room_check_in,
          'roomCheckOut', reservation_line.room_check_out,
          'roomQuantity', reservation_line.room_quantity,
          'placeStartsAt', place_window.starts_at,
          'placeEndsAt', place_window.ends_at,
          'placeGuests', reservation_line.place_guests,
          'totalMinor', reservation_line.total_minor::text
        ) ORDER BY reservation_line.kind, reservation_line.id)
        FROM public.stay_reservation_lines reservation_line
        LEFT JOIN public.stay_place_windows place_window
          ON place_window.id = reservation_line.place_window_id
        WHERE reservation_line.group_id = reservation_group.id
      ), '[]'::jsonb)
    ) ORDER BY reservation_group.created_at DESC, reservation_group.id DESC)
    FROM public.stay_reservation_groups reservation_group
    JOIN public.venue_listings venue ON venue.id = reservation_group.venue_id
    JOIN public.brands brand ON brand.id = reservation_group.brand_id
    WHERE reservation_group.user_id = v_uid
      AND reservation_group.payment_collection = 'mingla'
      AND reservation_group.offer_kind IS NULL
  ), '[]'::jsonb);
END;
$function$;

-- Turning a kind's feature off pauses that kind's live offers (bookings stay).
CREATE OR REPLACE FUNCTION public.issue_4490_pause_offers_on_feature_off()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.enabled = false AND (TG_OP = 'INSERT' OR OLD.enabled IS DISTINCT FROM false) THEN
    UPDATE public.stay_offerings offering
    SET status = 'paused', version = version + 1, updated_at = now()
    WHERE offering.venue_id = NEW.venue_id
      AND offering.status = 'live'
      AND public.issue_4490_offer_kind_feature(offering.kind) = NEW.feature_key;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_venue_features_pause_offers
  AFTER INSERT OR UPDATE OF enabled ON public.venue_features
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_pause_offers_on_feature_off();

-- ---------------------------------------------------------------------------
-- 8. Offer authoring helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_timezone(p_venue_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT s.timezone FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id),
    (SELECT NULLIF(c.iana_timezone, '') FROM public.venue_availability_config c
      WHERE c.venue_id = p_venue_id AND c.iana_timezone IS NOT NULL LIMIT 1),
    (SELECT CASE upper(COALESCE(v.country_code, ''))
        WHEN 'NG' THEN 'Africa/Lagos'
        WHEN 'GH' THEN 'Africa/Accra'
        WHEN 'KE' THEN 'Africa/Nairobi'
        WHEN 'ZA' THEN 'Africa/Johannesburg'
        WHEN 'GB' THEN 'Europe/London'
        WHEN 'IE' THEN 'Europe/Dublin'
        WHEN 'BE' THEN 'Europe/Brussels'
        WHEN 'FR' THEN 'Europe/Paris'
        WHEN 'DE' THEN 'Europe/Berlin'
        WHEN 'NL' THEN 'Europe/Amsterdam'
        WHEN 'US' THEN 'America/New_York'
        WHEN 'CA' THEN 'America/Toronto'
        ELSE NULL END
     FROM public.venue_listings v WHERE v.id = p_venue_id),
    'UTC'
  );
$function$;

-- Lazily create the venue's booking settings (timezone from the venue).
CREATE OR REPLACE FUNCTION public.issue_4490_ensure_booking_settings(p_venue_id uuid)
RETURNS public.venue_booking_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.venue_booking_settings%ROWTYPE;
  v_tz text;
BEGIN
  SELECT * INTO v_row FROM public.venue_booking_settings WHERE venue_id = p_venue_id;
  IF FOUND THEN
    RETURN v_row;
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;
  INSERT INTO public.venue_booking_settings (venue_id, brand_id, timezone)
  SELECT v.id, v.brand_id, v_tz FROM public.venue_listings v WHERE v.id = p_venue_id
  ON CONFLICT (venue_id) DO NOTHING;
  SELECT * INTO v_row FROM public.venue_booking_settings WHERE venue_id = p_venue_id;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_option_pricing_unit(p_unit text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_unit
    WHEN 'guest' THEN 'place_guest'
    WHEN 'booking' THEN 'place_booking'
    WHEN 'hour' THEN 'place_hour'
    WHEN 'unit' THEN 'place_unit'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pool_projection(p_pool_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p.id,
    'venueId', p.venue_id,
    'name', p.name,
    'dailyLimit', p.daily_limit,
    'keptForWalkIns', p.kept_for_walk_ins,
    'spaceIds', to_jsonb(p.space_ids),
    'archived', p.archived_at IS NOT NULL,
    'version', p.version
  )
  FROM public.venue_capacity_pools p WHERE p.id = p_pool_id;
$function$;

-- Readiness: every reason the offer cannot go live (empty = ready).
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
  IF v_offer.deposit_kind <> 'none' THEN
    v_reasons := v_reasons || 'deposit_not_available_yet'::text;
  END IF;
  IF v_venue.venue_category = 'stay' THEN
    v_reasons := v_reasons || 'stay_venue'::text;
  END IF;
  RETURN v_reasons;
END;
$function$;

-- VAT: one current 'vat' fee version per offer, following the venue's mode.
CREATE OR REPLACE FUNCTION public.issue_4490_sync_offer_vat(p_offering_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_current public.stay_fee_versions%ROWTYPE;
  v_bps integer;
  v_display text;
  v_next integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  SELECT c.vat_rate_bps INTO v_bps
  FROM public.venue_listings v
  JOIN public.country_vat_config c ON c.country = upper(v.country_code)
  WHERE v.id = v_offer.venue_id;
  v_display := CASE v_settings.vat_mode WHEN 'added' THEN 'separate' ELSE 'included' END;
  SELECT * INTO v_current FROM public.stay_fee_versions
  WHERE offering_id = p_offering_id AND fee_key = 'vat' AND effective_to IS NULL
  FOR UPDATE;
  IF v_settings.vat_mode = 'none' OR COALESCE(v_bps, 0) = 0 THEN
    IF FOUND THEN
      UPDATE public.stay_fee_versions SET effective_to = now() WHERE id = v_current.id;
    END IF;
    RETURN;
  END IF;
  IF FOUND AND v_current.basis_points = v_bps AND v_current.display_mode = v_display THEN
    RETURN;
  END IF;
  IF FOUND THEN
    UPDATE public.stay_fee_versions SET effective_to = now() WHERE id = v_current.id;
  END IF;
  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next
  FROM public.stay_fee_versions WHERE offering_id = p_offering_id AND fee_key = 'vat';
  INSERT INTO public.stay_fee_versions (
    offering_id, brand_id, venue_id, fee_key, label, version_number, fee_kind,
    calculation, basis_points, display_mode, refund_treatment, created_by,
    supersedes_version_id
  ) VALUES (
    p_offering_id, v_offer.brand_id, v_offer.venue_id, 'vat', 'VAT', v_next, 'tax',
    'percentage_of_line_base', v_bps, v_display, 'same_as_line', auth.uid(),
    CASE WHEN v_current.id IS NULL THEN NULL ELSE v_current.id END
  );
END;
$function$;

-- Materialise windows for the active rules over the booking horizon.
CREATE OR REPLACE FUNCTION public.issue_4490_materialize_offer_windows(p_offering_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_rule public.stay_place_schedule_rules%ROWTYPE;
  v_today date;
  v_until date;
  v_count integer := 0;
  v_rows integer;
  v_span integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  v_today := (now() AT TIME ZONE v_settings.timezone)::date;
  v_until := v_today + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730));
  FOR v_rule IN
    SELECT * FROM public.stay_place_schedule_rules
    WHERE offering_id = p_offering_id AND active
    ORDER BY created_at, id
  LOOP
    IF v_rule.mode = 'full_day' THEN
      INSERT INTO public.stay_place_windows (
        offering_id, schedule_rule_id, brand_id, venue_id, local_date,
        starts_at, ends_at, sellable_capacity, dst_resolution
      )
      SELECT v_offer.id, v_rule.id, v_offer.brand_id, v_offer.venue_id, d::date,
        (d::date + v_rule.full_day_start_time) AT TIME ZONE v_rule.timezone,
        ((d::date + CASE WHEN v_rule.full_day_end_time <= v_rule.full_day_start_time THEN 1 ELSE 0 END)
          + v_rule.full_day_end_time) AT TIME ZONE v_rule.timezone,
        v_offer.capacity, 'unambiguous'
      FROM generate_series(
        GREATEST(v_rule.local_start_date, v_today)::timestamp,
        LEAST(COALESCE(v_rule.local_end_date, v_until), v_until)::timestamp,
        interval '1 day'
      ) d
      WHERE (extract(isodow FROM d)::integer - 1) = ANY(v_rule.weekdays)
      ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    ELSIF v_rule.mode = 'repeating_windows' THEN
      v_span := (extract(epoch FROM (v_rule.local_end_time - v_rule.local_start_time))::integer / 60);
      IF v_span <= 0 THEN
        v_span := v_span + 1440;
      END IF;
      INSERT INTO public.stay_place_windows (
        offering_id, schedule_rule_id, brand_id, venue_id, local_date,
        starts_at, ends_at, sellable_capacity, dst_resolution
      )
      SELECT v_offer.id, v_rule.id, v_offer.brand_id, v_offer.venue_id, d::date,
        (d::date + v_rule.local_start_time + make_interval(mins => k * v_rule.slot_interval_minutes))
          AT TIME ZONE v_rule.timezone,
        (d::date + v_rule.local_start_time
          + make_interval(mins => k * v_rule.slot_interval_minutes + v_rule.slot_duration_minutes))
          AT TIME ZONE v_rule.timezone,
        v_offer.capacity, 'unambiguous'
      FROM generate_series(
        GREATEST(v_rule.local_start_date, v_today)::timestamp,
        LEAST(COALESCE(v_rule.local_end_date, v_until), v_until)::timestamp,
        interval '1 day'
      ) d
      CROSS JOIN generate_series(
        0, GREATEST((v_span - v_rule.slot_duration_minutes) / v_rule.slot_interval_minutes, -1)
      ) k
      WHERE (extract(isodow FROM d)::integer - 1) = ANY(v_rule.weekdays)
      ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    END IF;
  END LOOP;
  RETURN v_count;
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
          'maxChanges', (p.date_change_rule->>'max_changes')::integer)),
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
    'readiness', to_jsonb(public.issue_4490_offer_readiness(o.id)),
    'createdAt', o.created_at,
    'updatedAt', o.updated_at
  )
  FROM public.stay_offerings o
  WHERE o.id = p_offering_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_policy_text(p_ladder jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN jsonb_array_length(p_ladder) = 0 THEN 'No refunds.'
    ELSE (
      SELECT string_agg(
        CASE
          WHEN (r->>'refund_bps')::integer = 0 THEN 'No refund'
          WHEN (r->>'refund_bps')::integer = 10000 THEN 'Full refund'
          ELSE ((r->>'refund_bps')::integer / 100)::text || '% refund'
        END
        || CASE
          WHEN (r->>'min_minutes_before')::integer = 0 THEN ' up to the start.'
          WHEN (r->>'min_minutes_before')::integer % 1440 = 0
            THEN ' up to ' || ((r->>'min_minutes_before')::integer / 1440)::text || ' day(s) before.'
          WHEN (r->>'min_minutes_before')::integer % 60 = 0
            THEN ' up to ' || ((r->>'min_minutes_before')::integer / 60)::text || ' hour(s) before.'
          ELSE ' up to ' || (r->>'min_minutes_before') || ' minutes before.'
        END, ' ' ORDER BY ord)
      FROM jsonb_array_elements(p_ladder) WITH ORDINALITY AS l(r, ord)
    )
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Authoring RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_manage_capacity_pool(
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
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_limit integer;
  v_kept integer;
  v_spaces uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('create', 'update', 'archive') OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
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
  v_replay := public.issue_4490_receipt_lookup('manage_capacity_pool:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  IF p_payload ? 'dailyLimit' THEN
    IF jsonb_typeof(p_payload->'dailyLimit') <> 'number' OR (p_payload->>'dailyLimit') !~ '^[0-9]{1,6}$'
       OR (p_payload->>'dailyLimit')::integer NOT BETWEEN 1 AND 100000 THEN
      RAISE EXCEPTION 'pool_daily_limit_invalid' USING ERRCODE = '22023';
    END IF;
    v_limit := (p_payload->>'dailyLimit')::integer;
  END IF;
  IF p_payload ? 'keptForWalkIns' THEN
    IF jsonb_typeof(p_payload->'keptForWalkIns') <> 'number' OR (p_payload->>'keptForWalkIns') !~ '^[0-9]{1,6}$' THEN
      RAISE EXCEPTION 'pool_kept_invalid' USING ERRCODE = '22023';
    END IF;
    v_kept := (p_payload->>'keptForWalkIns')::integer;
  END IF;
  IF p_payload ? 'spaceIds' AND jsonb_typeof(p_payload->'spaceIds') = 'array' THEN
    SELECT NULLIF(array_agg(value::uuid), '{}') INTO v_spaces FROM jsonb_array_elements_text(p_payload->'spaceIds');
  END IF;

  IF p_action = 'create' THEN
    IF char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'pool_name_required' USING ERRCODE = '22023';
    END IF;
    IF v_limit IS NULL THEN
      RAISE EXCEPTION 'pool_daily_limit_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_kept, 0) > v_limit THEN
      RAISE EXCEPTION 'pool_kept_over_limit' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.venue_capacity_pools (venue_id, brand_id, name, daily_limit, kept_for_walk_ins, space_ids, updated_by)
    VALUES (p_venue_id, v_venue.brand_id, btrim(p_payload->>'name'), v_limit, COALESCE(v_kept, 0), v_spaces, v_uid)
    RETURNING * INTO v_pool;
  ELSE
    SELECT * INTO v_pool FROM public.venue_capacity_pools
    WHERE id = NULLIF(p_payload->>'poolId', '')::uuid AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pool_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NULL OR v_pool.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
    IF p_action = 'archive' THEN
      IF EXISTS (
        SELECT 1 FROM public.stay_offerings o
        WHERE o.capacity_pool_id = v_pool.id AND o.status IN ('live', 'paused')
      ) THEN
        RAISE EXCEPTION 'pool_in_use' USING ERRCODE = 'PT409';
      END IF;
      UPDATE public.venue_capacity_pools
      SET archived_at = now(), version = version + 1, updated_at = now(), updated_by = v_uid
      WHERE id = v_pool.id RETURNING * INTO v_pool;
    ELSE
      IF COALESCE(v_kept, v_pool.kept_for_walk_ins) > COALESCE(v_limit, v_pool.daily_limit) THEN
        RAISE EXCEPTION 'pool_kept_over_limit' USING ERRCODE = '22023';
      END IF;
      IF v_limit IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.stay_offerings o
        JOIN public.venue_offer_price_options opt ON opt.offering_id = o.id AND opt.status = 'active'
        WHERE o.capacity_pool_id = v_pool.id AND o.status IN ('live', 'paused') AND opt.guest_max > v_limit
      ) THEN
        RAISE EXCEPTION 'pool_limit_below_option_max' USING ERRCODE = '22023';
      END IF;
      UPDATE public.venue_capacity_pools
      SET name = COALESCE(NULLIF(btrim(p_payload->>'name'), ''), name),
          daily_limit = COALESCE(v_limit, daily_limit),
          kept_for_walk_ins = COALESCE(v_kept, kept_for_walk_ins),
          space_ids = CASE WHEN p_payload ? 'spaceIds' THEN v_spaces ELSE space_ids END,
          version = version + 1, updated_at = now(), updated_by = v_uid
      WHERE id = v_pool.id RETURNING * INTO v_pool;
    END IF;
  END IF;

  v_result := public.issue_4490_pool_projection(v_pool.id);
  PERFORM public.issue_4490_receipt_store('manage_capacity_pool:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_manage_offer(
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
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_currency text;
  v_kind text;
  v_style text;
  v_reasons text[];
  v_weekdays smallint[];
  v_amount bigint;
  v_next integer;
  v_ladder jsonb;
  v_change jsonb;
  v_mode text;
  v_start time;
  v_end time;
  v_session integer;
  v_every integer;
  v_windows integer := 0;
  v_capacity integer;
  v_opt_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('create_draft', 'update', 'set_pool', 'upsert_price_option', 'archive_price_option',
                      'set_policy', 'set_schedule', 'publish', 'pause', 'archive')
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
  v_replay := public.issue_4490_receipt_lookup('manage_offer:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF v_venue.venue_category = 'stay' THEN
    RAISE EXCEPTION 'offer_not_on_stay_venue' USING ERRCODE = 'P0001';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  IF p_action = 'create_draft' THEN
    v_kind := p_payload->>'kind';
    IF v_kind IS NULL OR v_kind NOT IN ('entry', 'group_package', 'private_hire', 'by_the_hour') THEN
      RAISE EXCEPTION 'offer_kind_invalid' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_kind = ANY(public.issue_4490_built_offer_kinds())) THEN
      RAISE EXCEPTION 'offer_not_ready:kind_not_available_yet' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'offer_name_required' USING ERRCODE = '22023';
    END IF;
    v_style := p_payload->>'entryStyle';
    IF v_kind = 'entry' AND (v_style IS NULL OR v_style NOT IN ('walk_in', 'day_pass', 'timed_session')) THEN
      RAISE EXCEPTION 'entry_style_required' USING ERRCODE = '22023';
    END IF;
    v_capacity := 100000;
    IF v_style = 'timed_session' THEN
      IF jsonb_typeof(p_payload->'sessionCapacity') <> 'number'
         OR (p_payload->>'sessionCapacity') !~ '^[0-9]{1,6}$'
         OR (p_payload->>'sessionCapacity')::integer NOT BETWEEN 1 AND 100000 THEN
        RAISE EXCEPTION 'session_capacity_required' USING ERRCODE = '22023';
      END IF;
      v_capacity := (p_payload->>'sessionCapacity')::integer;
    END IF;
    INSERT INTO public.stay_offerings (
      venue_id, brand_id, kind, name, summary, description, status, confirmation_mode,
      inventory_basis, unit_naming_mode, capacity, min_guests, max_guests,
      place_pricing_basis, access_scope, entry_style, sort_order, created_by, updated_by
    ) VALUES (
      p_venue_id, v_venue.brand_id, v_kind, btrim(p_payload->>'name'),
      left(COALESCE(p_payload->>'summary', ''), 300), left(COALESCE(p_payload->>'description', ''), 5000),
      'draft', 'instant', 'shared_capacity', 'interchangeable', v_capacity, 1, 1000,
      'per_guest', 'public', v_style, COALESCE((p_payload->>'sortOrder')::integer, 0), v_uid, v_uid
    ) RETURNING * INTO v_offer;
  ELSE
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
    IF v_offer.status = 'archived' AND p_action <> 'archive' THEN
      RAISE EXCEPTION 'offer_archived' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  IF p_action = 'update' THEN
    IF p_payload ? 'name' AND char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'offer_name_required' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'entryStyle' AND v_offer.kind = 'entry'
       AND COALESCE(p_payload->>'entryStyle', '') NOT IN ('walk_in', 'day_pass', 'timed_session') THEN
      RAISE EXCEPTION 'entry_style_required' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'minNoticeMinutes' AND COALESCE(p_payload->>'minNoticeMinutes', '') !~ '^[0-9]{1,6}$' THEN
      RAISE EXCEPTION 'notice_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'maxAdvanceDays' AND p_payload->'maxAdvanceDays' <> 'null'::jsonb
       AND (COALESCE(p_payload->>'maxAdvanceDays', '') !~ '^[0-9]{1,3}$'
            OR (p_payload->>'maxAdvanceDays')::integer NOT BETWEEN 1 AND 730) THEN
      RAISE EXCEPTION 'advance_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'sessionCapacity' AND (COALESCE(p_payload->>'sessionCapacity', '') !~ '^[0-9]{1,6}$'
       OR (p_payload->>'sessionCapacity')::integer NOT BETWEEN 1 AND 100000) THEN
      RAISE EXCEPTION 'session_capacity_required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_offerings
    SET name = CASE WHEN p_payload ? 'name' THEN btrim(p_payload->>'name') ELSE name END,
        summary = CASE WHEN p_payload ? 'summary' THEN left(COALESCE(p_payload->>'summary', ''), 300) ELSE summary END,
        description = CASE WHEN p_payload ? 'description' THEN left(COALESCE(p_payload->>'description', ''), 5000) ELSE description END,
        entry_style = CASE WHEN p_payload ? 'entryStyle' AND kind = 'entry' THEN p_payload->>'entryStyle' ELSE entry_style END,
        min_notice_minutes = CASE WHEN p_payload ? 'minNoticeMinutes' THEN (p_payload->>'minNoticeMinutes')::integer ELSE min_notice_minutes END,
        max_advance_days = CASE WHEN p_payload ? 'maxAdvanceDays' THEN NULLIF(p_payload->>'maxAdvanceDays', '')::integer ELSE max_advance_days END,
        capacity = CASE
          WHEN p_payload ? 'sessionCapacity' THEN (p_payload->>'sessionCapacity')::integer
          WHEN p_payload ? 'entryStyle' AND p_payload->>'entryStyle' <> 'timed_session' THEN 100000
          ELSE capacity END,
        sort_order = CASE WHEN p_payload ? 'sortOrder' THEN (p_payload->>'sortOrder')::integer ELSE sort_order END,
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    IF v_offer.entry_style = 'timed_session' AND v_offer.capacity = 100000 AND NOT (p_payload ? 'sessionCapacity') THEN
      RAISE EXCEPTION 'session_capacity_required' USING ERRCODE = '22023';
    END IF;
  ELSIF p_action = 'set_pool' THEN
    SELECT * INTO v_pool FROM public.venue_capacity_pools
    WHERE id = NULLIF(p_payload->>'poolId', '')::uuid AND venue_id = p_venue_id AND archived_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pool_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offer.kind NOT IN ('entry', 'group_package') THEN
      RAISE EXCEPTION 'pool_not_for_kind' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_offerings
    SET capacity_pool_id = v_pool.id, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  ELSIF p_action = 'upsert_price_option' THEN
    IF char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'option_name_required' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'unit', '') NOT IN ('guest', 'booking', 'hour', 'unit') THEN
      RAISE EXCEPTION 'option_unit_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_offer.kind = 'entry' AND p_payload->>'unit' <> 'guest' THEN
      RAISE EXCEPTION 'option_unit_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'guestMin', '') !~ '^[0-9]{1,6}$' OR COALESCE(p_payload->>'guestMax', '') !~ '^[0-9]{1,6}$'
       OR (p_payload->>'guestMin')::integer < 1
       OR (p_payload->>'guestMax')::integer < (p_payload->>'guestMin')::integer
       OR (p_payload->>'guestMax')::integer > 100000 THEN
      RAISE EXCEPTION 'option_guests_invalid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_payload->'priceMinor') <> 'number' OR (p_payload->>'priceMinor') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'option_price_invalid' USING ERRCODE = '22023';
    END IF;
    v_amount := (p_payload->>'priceMinor')::bigint;
    IF p_payload ? 'weekdays' THEN
      IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
        RAISE EXCEPTION 'option_weekdays_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    ELSE
      v_weekdays := '{0,1,2,3,4,5,6}'::smallint[];
    END IF;
    IF (NULLIF(p_payload->>'startTime', '') IS NULL) <> (NULLIF(p_payload->>'endTime', '') IS NULL)
       OR COALESCE(NULLIF(p_payload->>'startTime', ''), '00:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR COALESCE(NULLIF(p_payload->>'endTime', ''), '00:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'option_times_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'eligibility' AND p_payload->'eligibility' <> 'null'::jsonb AND (
         jsonb_typeof(p_payload->'eligibility') <> 'object'
         OR char_length(btrim(COALESCE(p_payload->'eligibility'->>'label', ''))) NOT BETWEEN 1 AND 80
         OR jsonb_typeof(p_payload->'eligibility'->'checkAtGate') <> 'boolean') THEN
      RAISE EXCEPTION 'option_eligibility_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'busyRules' AND NOT public.issue_4490_busy_rules_valid(COALESCE(p_payload->'busyRules', '[]'::jsonb)) THEN
      RAISE EXCEPTION 'option_busy_rules_invalid' USING ERRCODE = '22023';
    END IF;
    v_opt_id := NULLIF(p_payload->>'optionId', '')::uuid;
    IF v_opt_id IS NULL THEN
      INSERT INTO public.venue_offer_price_options (
        offering_id, venue_id, brand_id, name, unit, guest_min, guest_max, weekdays,
        local_start_time, local_end_time, eligibility, busy_rules, sort_order, updated_by
      ) VALUES (
        v_offer.id, p_venue_id, v_venue.brand_id, btrim(p_payload->>'name'), p_payload->>'unit',
        (p_payload->>'guestMin')::integer, (p_payload->>'guestMax')::integer, v_weekdays,
        NULLIF(p_payload->>'startTime', '')::time, NULLIF(p_payload->>'endTime', '')::time,
        CASE WHEN p_payload->'eligibility' IS NULL OR p_payload->'eligibility' = 'null'::jsonb THEN NULL
             ELSE jsonb_build_object('label', btrim(p_payload->'eligibility'->>'label'),
                                     'check_at_gate', (p_payload->'eligibility'->>'checkAtGate')::boolean) END,
        COALESCE(p_payload->'busyRules', '[]'::jsonb),
        COALESCE((p_payload->>'sortOrder')::integer,
                 (SELECT COALESCE(max(sort_order), -1) + 1 FROM public.venue_offer_price_options WHERE offering_id = v_offer.id)),
        v_uid
      ) RETURNING * INTO v_option;
    ELSE
      UPDATE public.venue_offer_price_options
      SET name = btrim(p_payload->>'name'),
          unit = p_payload->>'unit',
          guest_min = (p_payload->>'guestMin')::integer,
          guest_max = (p_payload->>'guestMax')::integer,
          weekdays = v_weekdays,
          local_start_time = NULLIF(p_payload->>'startTime', '')::time,
          local_end_time = NULLIF(p_payload->>'endTime', '')::time,
          eligibility = CASE WHEN p_payload->'eligibility' IS NULL OR p_payload->'eligibility' = 'null'::jsonb THEN NULL
             ELSE jsonb_build_object('label', btrim(p_payload->'eligibility'->>'label'),
                                     'check_at_gate', (p_payload->'eligibility'->>'checkAtGate')::boolean) END,
          busy_rules = COALESCE(p_payload->'busyRules', '[]'::jsonb),
          sort_order = COALESCE((p_payload->>'sortOrder')::integer, sort_order),
          version = version + 1, updated_at = now(), updated_by = v_uid
      WHERE id = v_opt_id AND offering_id = v_offer.id AND status = 'active'
      RETURNING * INTO v_option;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'option_not_found' USING ERRCODE = 'P0002';
      END IF;
    END IF;
    SELECT * INTO v_price FROM public.stay_price_versions
    WHERE offering_id = v_offer.id AND price_option_id = v_option.id AND effective_to IS NULL
    FOR UPDATE;
    IF NOT FOUND OR v_price.amount_minor <> v_amount
       OR v_price.pricing_unit <> public.issue_4490_option_pricing_unit(v_option.unit)
       OR v_price.currency_code <> v_currency THEN
      IF FOUND THEN
        UPDATE public.stay_price_versions SET effective_to = now() WHERE id = v_price.id;
      END IF;
      SELECT COALESCE(max(version_number), 0) + 1 INTO v_next
      FROM public.stay_price_versions WHERE offering_id = v_offer.id;
      INSERT INTO public.stay_price_versions (
        offering_id, brand_id, venue_id, version_number, amount_minor, currency_code,
        pricing_unit, price_option_id, supersedes_version_id, created_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, v_offer.venue_id, v_next, v_amount, v_currency,
        public.issue_4490_option_pricing_unit(v_option.unit), v_option.id,
        CASE WHEN v_price.id IS NULL THEN NULL ELSE v_price.id END, v_uid
      );
    END IF;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  ELSIF p_action = 'archive_price_option' THEN
    UPDATE public.venue_offer_price_options
    SET status = 'archived', version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = NULLIF(p_payload->>'optionId', '')::uuid AND offering_id = v_offer.id AND status = 'active'
    RETURNING * INTO v_option;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'option_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.stay_price_versions SET effective_to = now()
    WHERE price_option_id = v_option.id AND effective_to IS NULL;
    IF v_offer.status = 'live' AND NOT EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
    ) THEN
      RAISE EXCEPTION 'offer_needs_one_option' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  ELSIF p_action = 'set_policy' THEN
    v_ladder := COALESCE(p_payload->'refundLadder', '[]'::jsonb);
    IF jsonb_typeof(v_ladder) <> 'array' THEN
      RAISE EXCEPTION 'refund_ladder_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'min_minutes_before', (r->>'minMinutesBefore')::integer,
        'refund_bps', (r->>'refundBps')::integer) ORDER BY (r->>'minMinutesBefore')::integer DESC), '[]'::jsonb)
    INTO v_ladder
    FROM jsonb_array_elements(v_ladder) r
    WHERE COALESCE(r->>'minMinutesBefore', '') ~ '^[0-9]{1,7}$' AND COALESCE(r->>'refundBps', '') ~ '^[0-9]{1,5}$';
    IF jsonb_array_length(v_ladder) <> jsonb_array_length(COALESCE(p_payload->'refundLadder', '[]'::jsonb))
       OR NOT public.issue_4490_refund_ladder_valid(v_ladder) THEN
      RAISE EXCEPTION 'refund_ladder_invalid' USING ERRCODE = '22023';
    END IF;
    v_change := COALESCE(p_payload->'dateChangeRule', '{}'::jsonb);
    IF jsonb_typeof(v_change) <> 'object'
       OR (v_change ? 'allowedUntilMinutesBefore' AND COALESCE(v_change->>'allowedUntilMinutesBefore', '') !~ '^[0-9]{1,7}$')
       OR (v_change ? 'feeBps' AND (COALESCE(v_change->>'feeBps', '') !~ '^[0-9]{1,5}$' OR (v_change->>'feeBps')::integer > 10000))
       OR (v_change ? 'maxChanges' AND COALESCE(v_change->>'maxChanges', '') !~ '^[0-9]{1,2}$') THEN
      RAISE EXCEPTION 'date_change_rule_invalid' USING ERRCODE = '22023';
    END IF;
    v_change := jsonb_strip_nulls(jsonb_build_object(
      'allowed_until_minutes_before', (v_change->>'allowedUntilMinutesBefore')::integer,
      'fee_bps', (v_change->>'feeBps')::integer,
      'max_changes', (v_change->>'maxChanges')::integer));
    SELECT * INTO v_policy FROM public.stay_policy_versions
    WHERE offering_id = v_offer.id AND effective_to IS NULL FOR UPDATE;
    IF FOUND THEN
      UPDATE public.stay_policy_versions SET effective_to = now() WHERE id = v_policy.id;
    END IF;
    SELECT COALESCE(max(version_number), 0) + 1 INTO v_next
    FROM public.stay_policy_versions WHERE offering_id = v_offer.id;
    INSERT INTO public.stay_policy_versions (
      offering_id, brand_id, venue_id, version_number, cancellation_policy,
      free_cancel_cutoff_minutes, late_refund_basis_points, no_show_refund_basis_points,
      operator_cancel_refund_basis_points, refund_ladder, date_change_rule, created_by
    ) VALUES (
      v_offer.id, v_offer.brand_id, v_offer.venue_id, v_next,
      COALESCE(NULLIF(btrim(p_payload->>'cancellationPolicy'), ''), public.issue_4490_policy_text(v_ladder)),
      0, 0, 0, 10000, v_ladder, v_change, v_uid
    );
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  ELSIF p_action = 'set_schedule' THEN
    v_mode := COALESCE(p_payload->>'mode', CASE WHEN v_offer.entry_style = 'timed_session' THEN 'sessions' ELSE 'full_day' END);
    IF v_mode NOT IN ('full_day', 'sessions') THEN
      RAISE EXCEPTION 'schedule_mode_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_offer.entry_style = 'timed_session' AND v_mode <> 'sessions' THEN
      RAISE EXCEPTION 'schedule_mode_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'startTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR COALESCE(p_payload->>'endTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'schedule_times_invalid' USING ERRCODE = '22023';
    END IF;
    v_start := (p_payload->>'startTime')::time;
    v_end := (p_payload->>'endTime')::time;
    IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
      RAISE EXCEPTION 'schedule_weekdays_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    IF v_mode = 'sessions' THEN
      IF COALESCE(p_payload->>'sessionMinutes', '') !~ '^[0-9]{1,4}$'
         OR (p_payload->>'sessionMinutes')::integer NOT BETWEEN 15 AND 1440
         OR COALESCE(p_payload->>'sessionEveryMinutes', p_payload->>'sessionMinutes') !~ '^[0-9]{1,4}$'
         OR COALESCE(p_payload->>'sessionEveryMinutes', p_payload->>'sessionMinutes')::integer NOT BETWEEN 15 AND 1440 THEN
        RAISE EXCEPTION 'schedule_sessions_invalid' USING ERRCODE = '22023';
      END IF;
      v_session := (p_payload->>'sessionMinutes')::integer;
      v_every := COALESCE(p_payload->>'sessionEveryMinutes', p_payload->>'sessionMinutes')::integer;
    END IF;
    -- Retire the old rule: future windows with nothing held or sold stop selling.
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
    INSERT INTO public.stay_place_schedule_rules (
      offering_id, brand_id, venue_id, mode, timezone, local_start_date, local_end_date, weekdays,
      local_start_time, local_end_time, slot_duration_minutes, slot_interval_minutes,
      full_day_start_time, full_day_end_time, created_by, updated_by
    ) VALUES (
      v_offer.id, v_offer.brand_id, v_offer.venue_id,
      CASE v_mode WHEN 'full_day' THEN 'full_day' ELSE 'repeating_windows' END,
      v_settings.timezone,
      COALESCE(NULLIF(p_payload->>'startDate', '')::date, (now() AT TIME ZONE v_settings.timezone)::date),
      NULLIF(p_payload->>'endDate', '')::date,
      v_weekdays,
      CASE WHEN v_mode = 'sessions' THEN v_start END,
      CASE WHEN v_mode = 'sessions' THEN v_end END,
      v_session, v_every,
      CASE WHEN v_mode = 'full_day' THEN v_start END,
      CASE WHEN v_mode = 'full_day' THEN v_end END,
      v_uid, v_uid
    );
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    IF v_offer.status = 'live' THEN
      v_windows := public.issue_4490_materialize_offer_windows(v_offer.id);
    END IF;
  ELSIF p_action = 'publish' THEN
    v_reasons := public.issue_4490_offer_readiness(v_offer.id);
    IF cardinality(v_reasons) > 0 THEN
      RAISE EXCEPTION 'offer_not_ready:%', v_reasons[1] USING ERRCODE = 'P0001',
        DETAIL = array_to_string(v_reasons, ',');
    END IF;
    PERFORM public.issue_4490_sync_offer_vat(v_offer.id);
    UPDATE public.stay_offerings
    SET status = 'live', version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    v_windows := public.issue_4490_materialize_offer_windows(v_offer.id);
  ELSIF p_action = 'pause' THEN
    IF v_offer.status <> 'live' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.stay_offerings
    SET status = 'paused', version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  ELSIF p_action = 'archive' THEN
    UPDATE public.stay_offerings
    SET status = 'archived', archived_at = now(), version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  END IF;

  v_result := public.issue_4490_offer_projection(v_offer.id) || jsonb_build_object('windowsCreated', v_windows);
  PERFORM public.issue_4490_receipt_store('manage_offer:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_list_offers(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'flags', jsonb_build_object(
      'reads', public.issue_4490_flag_on('VENUE_OFFERS_READS'),
      'writes', public.issue_4490_flag_on('VENUE_OFFERS_WRITES')),
    'settings', (
      SELECT jsonb_build_object(
        'timezone', s.timezone, 'vatMode', s.vat_mode,
        'vatRateBps', (SELECT c.vat_rate_bps FROM public.venue_listings v
                       JOIN public.country_vat_config c ON c.country = upper(v.country_code)
                       WHERE v.id = p_venue_id),
        'instantPaymentHoldMinutes', s.instant_payment_hold_minutes,
        'bookingHorizonDays', s.booking_horizon_days,
        'bookingState', s.booking_state, 'version', s.version)
      FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id),
    'pools', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pool_projection(p.id) ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(public.issue_4490_offer_projection(o.id) ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place') AND o.status <> 'archived'), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_set_capacity_override(
  p_venue_id uuid,
  p_pool_id uuid,
  p_local_date date,
  p_daily_limit integer,
  p_kept_for_walk_ins integer,
  p_closed boolean,
  p_clear boolean,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_row public.venue_capacity_overrides%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_local_date IS NULL OR (p_daily_limit IS NOT NULL AND p_daily_limit NOT BETWEEN 0 AND 100000)
     OR (p_kept_for_walk_ins IS NOT NULL AND p_kept_for_walk_ins NOT BETWEEN 0 AND 100000) THEN
    RAISE EXCEPTION 'override_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pool FROM public.venue_capacity_pools
  WHERE id = p_pool_id AND venue_id = p_venue_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pool_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'pool', p_pool_id, 'date', p_local_date, 'limit', p_daily_limit, 'kept', p_kept_for_walk_ins,
    'closed', p_closed, 'clear', p_clear)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('capacity_override:' || p_pool_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_pool.id FOR UPDATE;
  IF COALESCE(p_clear, false) THEN
    DELETE FROM public.venue_capacity_overrides WHERE pool_id = v_pool.id AND local_date = p_local_date;
  ELSE
    IF COALESCE(p_kept_for_walk_ins, v_pool.kept_for_walk_ins) > COALESCE(p_daily_limit, v_pool.daily_limit)
       AND NOT COALESCE(p_closed, false) THEN
      RAISE EXCEPTION 'pool_kept_over_limit' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.venue_capacity_overrides (pool_id, venue_id, brand_id, local_date, daily_limit, kept_for_walk_ins, closed, updated_by)
    VALUES (v_pool.id, p_venue_id, v_pool.brand_id, p_local_date, p_daily_limit, p_kept_for_walk_ins, COALESCE(p_closed, false), v_uid)
    ON CONFLICT (pool_id, local_date) DO UPDATE
      SET daily_limit = EXCLUDED.daily_limit,
          kept_for_walk_ins = EXCLUDED.kept_for_walk_ins,
          closed = EXCLUDED.closed,
          version = public.venue_capacity_overrides.version + 1,
          updated_at = now(), updated_by = v_uid
    RETURNING * INTO v_row;
  END IF;
  v_result := jsonb_build_object(
    'poolId', v_pool.id, 'localDate', p_local_date, 'cleared', COALESCE(p_clear, false),
    'dailyLimit', v_row.daily_limit, 'keptForWalkIns', v_row.kept_for_walk_ins,
    'closed', COALESCE(v_row.closed, false), 'version', v_row.version);
  PERFORM public.issue_4490_receipt_store('capacity_override:' || p_pool_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_save_booking_settings(
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
  v_row public.venue_booking_settings%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_offer uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR (p_payload ? 'vatMode' AND COALESCE(p_payload->>'vatMode', '') NOT IN ('included', 'added', 'none'))
     OR (p_payload ? 'instantPaymentHoldMinutes' AND (COALESCE(p_payload->>'instantPaymentHoldMinutes', '') !~ '^[0-9]{1,2}$'
         OR (p_payload->>'instantPaymentHoldMinutes')::integer NOT BETWEEN 5 AND 60))
     OR (p_payload ? 'bookingHorizonDays' AND (COALESCE(p_payload->>'bookingHorizonDays', '') !~ '^[0-9]{1,3}$'
         OR (p_payload->>'bookingHorizonDays')::integer NOT BETWEEN 1 AND 730))
     OR (p_payload ? 'bookingState' AND COALESCE(p_payload->>'bookingState', '') NOT IN ('active', 'paused')) THEN
    RAISE EXCEPTION 'booking_settings_invalid' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'payload', p_payload, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('booking_settings:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  v_row := public.issue_4490_ensure_booking_settings(p_venue_id);
  SELECT * INTO v_row FROM public.venue_booking_settings WHERE venue_id = p_venue_id FOR UPDATE;
  IF p_expected_version IS NOT NULL AND v_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_booking_settings
  SET vat_mode = COALESCE(p_payload->>'vatMode', vat_mode),
      instant_payment_hold_minutes = COALESCE((p_payload->>'instantPaymentHoldMinutes')::smallint, instant_payment_hold_minutes),
      booking_horizon_days = COALESCE((p_payload->>'bookingHorizonDays')::smallint, booking_horizon_days),
      booking_state = COALESCE(p_payload->>'bookingState', booking_state),
      version = version + 1, updated_at = now(), updated_by = v_uid
  WHERE venue_id = p_venue_id RETURNING * INTO v_row;
  FOR v_offer IN
    SELECT o.id FROM public.stay_offerings o
    WHERE o.venue_id = p_venue_id AND o.status IN ('live', 'paused') AND o.kind NOT IN ('room', 'place')
    ORDER BY o.id
  LOOP
    PERFORM public.issue_4490_sync_offer_vat(v_offer);
  END LOOP;
  v_result := jsonb_build_object(
    'venueId', p_venue_id, 'timezone', v_row.timezone, 'vatMode', v_row.vat_mode,
    'instantPaymentHoldMinutes', v_row.instant_payment_hold_minutes,
    'bookingHorizonDays', v_row.booking_horizon_days, 'bookingState', v_row.booking_state,
    'version', v_row.version);
  PERFORM public.issue_4490_receipt_store('booking_settings:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_admin_set_offer_status(
  p_offering_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('paused', 'live') OR char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = p_offering_id AND kind NOT IN ('room', 'place') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_status = 'live' AND cardinality(public.issue_4490_offer_readiness(v_offer.id)) > 0 THEN
    RAISE EXCEPTION 'offer_not_ready:%', (public.issue_4490_offer_readiness(v_offer.id))[1] USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.stay_offerings
  SET status = p_status, version = version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = v_offer.id RETURNING * INTO v_offer;
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata, actor_uid, reason)
  SELECT u.email, 'venue_offer_status', 'stay_offering', v_offer.id::text,
         jsonb_build_object('status', p_status), auth.uid(), btrim(p_reason)
  FROM auth.users u WHERE u.id = auth.uid();
  RETURN public.issue_4490_offer_projection(v_offer.id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_busy_rules_valid(jsonb),
  public.issue_4490_refund_ladder_valid(jsonb),
  public.issue_4490_offer_kind_feature(text),
  public.issue_4490_built_offer_kinds(),
  public.issue_4490_venue_feature_on(uuid, text),
  public.issue_4490_flag_on(text),
  public.issue_4490_can_manage_money(uuid, uuid),
  public.issue_4490_can_check_in(uuid, uuid),
  public.issue_4490_user_has_venue_capability(uuid, uuid, text),
  public.issue_4490_assert_offer_child_scope(),
  public.issue_4490_guard_offer_money_rows(),
  public.issue_4490_pause_offers_on_feature_off(),
  public.issue_4490_venue_timezone(uuid),
  public.issue_4490_ensure_booking_settings(uuid),
  public.issue_4490_option_pricing_unit(text),
  public.issue_4490_pool_projection(uuid),
  public.issue_4490_offer_readiness(uuid),
  public.issue_4490_sync_offer_vat(uuid),
  public.issue_4490_materialize_offer_windows(uuid),
  public.issue_4490_offer_projection(uuid),
  public.issue_4490_policy_text(jsonb),
  public.issue_4490_manage_capacity_pool(text, uuid, jsonb, bigint, text),
  public.issue_4490_manage_offer(text, uuid, jsonb, bigint, text),
  public.issue_4490_list_offers(uuid),
  public.issue_4490_set_capacity_override(uuid, uuid, date, integer, integer, boolean, boolean, text),
  public.issue_4490_save_booking_settings(uuid, jsonb, bigint, text),
  public.issue_4490_admin_set_offer_status(uuid, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.issue_4490_busy_rules_valid(jsonb),
  public.issue_4490_refund_ladder_valid(jsonb),
  public.issue_4490_offer_kind_feature(text),
  public.issue_4490_built_offer_kinds(),
  public.issue_4490_option_pricing_unit(text),
  public.issue_4490_policy_text(jsonb)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_manage_capacity_pool(text, uuid, jsonb, bigint, text),
  public.issue_4490_manage_offer(text, uuid, jsonb, bigint, text),
  public.issue_4490_list_offers(uuid),
  public.issue_4490_set_capacity_override(uuid, uuid, date, integer, integer, boolean, boolean, text),
  public.issue_4490_save_booking_settings(uuid, jsonb, bigint, text),
  public.issue_4490_admin_set_offer_status(uuid, text, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_venue_feature_on(uuid, text),
  public.issue_4490_flag_on(text),
  public.issue_4490_can_manage_money(uuid, uuid),
  public.issue_4490_can_check_in(uuid, uuid),
  public.issue_4490_user_has_venue_capability(uuid, uuid, text),
  public.issue_4490_venue_timezone(uuid),
  public.issue_4490_ensure_booking_settings(uuid),
  public.issue_4490_pool_projection(uuid),
  public.issue_4490_offer_readiness(uuid),
  public.issue_4490_sync_offer_vat(uuid),
  public.issue_4490_materialize_offer_windows(uuid),
  public.issue_4490_offer_projection(uuid)
TO service_role;

-- Rollout flags (default off; turned on locally / by Seth).
INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('VENUE_OFFERS_READS', false, '#4490 venue offers visible on public venue pages and availability'),
  ('VENUE_OFFERS_WRITES', false, '#4490 venue offers can be authored, sold, checked in and cancelled')
ON CONFLICT (flag_key) DO NOTHING;

-- New notification categories for venue bookings (templates: guest surfaces).
INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels)
VALUES
  ('venue_booking_confirmed', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email', 'sms']),
  ('venue_booking_cancelled', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_refund_state', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
