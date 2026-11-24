-- Issue #4490, spec 08 O1 (running the floor): the Till core.
-- One server-priced sale object (venue_till_sales, 1:1 with a sitting in
-- venue_order_sessions). Menu rounds stay ordinary venue_orders children;
-- offer and balance lines point at Stays objects; money is taken by
-- venue_till_payments. O1 takes cash and the venue's own card machine only
-- (no provider, no Mingla fee: I-PROPOSED-1767-VENUE-COLLECTED-IS-NOT-MINGLA-MONEY).
-- Card carriers (tap, scan) are O2; the columns and CHECK relaxations they need
-- land here so O2 adds no second venue_orders change.
-- Includes spec 08 §11 T1 (held / payment_only order states), T3 (floor staff
-- read orders), T9 (relabel, change server, payment server snapshot),
-- T10 (every payment carries the check version), T18 (legacy tabs appear in
-- Open checks) and spec 07 §11 B3 (guest-list reduced price sold in the Till).
-- Rollout: flag VENUE_TILL (default off) AND the venue feature `till`.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Checked patches preserve the cumulative function bodies: a drifted body
-- fails the migration instead of silently dropping a later fix.
CREATE FUNCTION pg_temp.issue_4490_o1_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O1 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. Rollout flag (default off).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('VENUE_TILL', false, '#4490 spec 08: the Till (sell in person). Stays off until the Host store build that carries it is live')
ON CONFLICT (flag_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Features `till` ("Sell in person") and `kitchen_screens` ("Kitchen and
--    bar screens"), kitchen_screens -> menu. Every list in Review item 5.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_features DROP CONSTRAINT venue_features_feature_key_check;
ALTER TABLE public.venue_features ADD CONSTRAINT venue_features_feature_key_check CHECK (feature_key IN (
  'entry', 'group_packages', 'private_hire', 'by_the_hour',
  'table_reservations', 'floor_plan', 'pick_a_table', 'menu',
  'table_ordering', 'min_spend_tables', 'guest_list', 'memberships',
  'stays', 'events_here', 'waitlist', 'till', 'kitchen_screens'
));

CREATE OR REPLACE FUNCTION public.issue_4490_feature_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY[
    'entry', 'group_packages', 'private_hire', 'by_the_hour',
    'table_reservations', 'floor_plan', 'pick_a_table', 'menu',
    'table_ordering', 'min_spend_tables', 'guest_list', 'memberships',
    'stays', 'events_here', 'waitlist', 'till', 'kitchen_screens'
  ]::text[];
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_feature_parents(p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_key
    WHEN 'table_ordering' THEN ARRAY['menu']::text[]
    WHEN 'pick_a_table' THEN ARRAY['floor_plan']::text[]
    WHEN 'floor_plan' THEN ARRAY['table_reservations']::text[]
    WHEN 'min_spend_tables' THEN ARRAY['table_reservations']::text[]
    WHEN 'kitchen_screens' THEN ARRAY['menu']::text[]
    ELSE '{}'::text[]
  END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays', 'entry',
               'group_packages', 'private_hire', 'floor_plan', 'pick_a_table', 'min_spend_tables',
               'by_the_hour', 'memberships', 'guest_list', 'till', 'kitchen_screens']::text[];
$function$;

-- Starting presets only (applied when a host picks a type).
CREATE OR REPLACE FUNCTION public.issue_4490_feature_preset(p_category text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE p_category
    WHEN 'restaurant' THEN ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'till', 'kitchen_screens']
    WHEN 'play' THEN ARRAY['entry', 'group_packages', 'private_hire', 'menu', 'table_ordering', 'events_here']
    WHEN 'creative_and_arts' THEN ARRAY['entry', 'by_the_hour', 'private_hire', 'memberships', 'events_here']
    WHEN 'stay' THEN ARRAY['stays']
    WHEN 'bar_lounge' THEN ARRAY['table_reservations', 'min_spend_tables', 'private_hire', 'menu', 'table_ordering', 'events_here', 'till']
    WHEN 'club' THEN ARRAY['entry', 'table_reservations', 'min_spend_tables', 'menu', 'table_ordering', 'events_here', 'till']
    WHEN 'cafe' THEN ARRAY['entry', 'by_the_hour', 'menu', 'table_ordering', 'events_here', 'till', 'kitchen_screens']
    WHEN 'event_space' THEN ARRAY['private_hire', 'events_here']
    WHEN 'coworking' THEN ARRAY['entry', 'by_the_hour', 'private_hire', 'memberships']
    ELSE NULL
  END::text[];
$function$;

-- ---------------------------------------------------------------------------
-- 3. Capabilities venue.sell, venue.kitchen, venue.till_device and the
--    "Till device" access profile.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_invitation_venue_grants
  DROP CONSTRAINT brand_invitation_venue_capabilities_valid;
ALTER TABLE public.brand_invitation_venue_grants
  ADD CONSTRAINT brand_invitation_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations', 'stay.create_reservations', 'stay.manage_reservations',
      'stay.view_availability', 'restaurant.view_orders', 'restaurant.manage_orders',
      'restaurant.manage_menu', 'restaurant.manage_qr', 'restaurant.manage_reservations',
      'venue.manage_offers', 'venue.manage_bookings', 'venue.view_bookings', 'venue.check_in',
      'venue.manage_money', 'venue.manage_members', 'venue.sell', 'venue.kitchen', 'venue.till_device'
    ]::text[]
  );
ALTER TABLE public.brand_team_member_venue_grants
  DROP CONSTRAINT brand_team_member_venue_capabilities_valid;
ALTER TABLE public.brand_team_member_venue_grants
  ADD CONSTRAINT brand_team_member_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations', 'stay.create_reservations', 'stay.manage_reservations',
      'stay.view_availability', 'restaurant.view_orders', 'restaurant.manage_orders',
      'restaurant.manage_menu', 'restaurant.manage_qr', 'restaurant.manage_reservations',
      'venue.manage_offers', 'venue.manage_bookings', 'venue.view_bookings', 'venue.check_in',
      'venue.manage_money', 'venue.manage_members', 'venue.sell', 'venue.kitchen', 'venue.till_device'
    ]::text[]
  );
ALTER TABLE public.brand_invitation_venue_grants
  DROP CONSTRAINT brand_invitation_venue_grants_access_profile_check;
ALTER TABLE public.brand_invitation_venue_grants
  ADD CONSTRAINT brand_invitation_venue_grants_access_profile_check CHECK (access_profile IN (
    'front_desk', 'restaurant_manager', 'kitchen_bar', 'till_device', 'custom'));
ALTER TABLE public.brand_team_member_venue_grants
  DROP CONSTRAINT brand_team_member_venue_grants_access_profile_check;
ALTER TABLE public.brand_team_member_venue_grants
  ADD CONSTRAINT brand_team_member_venue_grants_access_profile_check CHECK (access_profile IN (
    'front_desk', 'restaurant_manager', 'kitchen_bar', 'till_device', 'custom'));

SELECT pg_temp.issue_4490_o1_patch(
  'public.issue_4188_has_venue_capability(uuid,uuid,text)'::regprocedure,
  $old$      'venue.manage_members'
    ]::text[])$old$,
  $new$      'venue.manage_members',
      'venue.sell',
      'venue.kitchen',
      'venue.till_device'
    ]::text[])$new$
);

SELECT pg_temp.issue_4490_o1_patch(
  'public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)'::regprocedure,
  $old$          'venue.manage_members'
        ]::text[])$old$,
  $new$          'venue.manage_members',
          'venue.sell',
          'venue.kitchen',
          'venue.till_device'
        ]::text[])$new$
);
SELECT pg_temp.issue_4490_o1_patch(
  'public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)'::regprocedure,
  $old$      OR grant_row->>'profile' NOT IN (
        'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
      )$old$,
  $new$      OR grant_row->>'profile' NOT IN (
        'front_desk', 'restaurant_manager', 'kitchen_bar', 'till_device', 'custom'
      )$new$
);

-- A Stay venue takes the Till device profile too (spec 07 §J: Stays use the
-- same venue features).
SELECT pg_temp.issue_4490_o1_patch(
  'public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)'::regprocedure,
  $old$              AND grant_row->>'profile' IN (
                'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
              )$old$,
  $new$              AND grant_row->>'profile' IN (
                'front_desk', 'restaurant_manager', 'kitchen_bar', 'till_device', 'custom'
              )$new$
);

-- The named-user helper also answers the two order capabilities (can_kitchen).
SELECT pg_temp.issue_4490_o1_patch(
  'public.issue_4490_user_has_venue_capability(uuid,uuid,text)'::regprocedure,
  $old$p_capability LIKE 'venue.%' AND EXISTS ($old$,
  $new$(p_capability LIKE 'venue.%'
    OR p_capability IN ('restaurant.view_orders', 'restaurant.manage_orders')) AND EXISTS ($new$
);

CREATE OR REPLACE FUNCTION public.issue_4490_can_sell(p_venue_id uuid, p_user_id uuid)
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
        public.biz_brand_effective_rank(venue.brand_id, p_user_id) >= public.biz_role_rank('event_manager')
        OR public.issue_4490_user_has_venue_capability(venue.id, p_user_id, 'venue.sell')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_can_kitchen(p_venue_id uuid, p_user_id uuid)
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
        public.biz_brand_effective_rank(venue.brand_id, p_user_id) >= public.biz_role_rank('event_manager')
        OR public.issue_4490_user_has_venue_capability(venue.id, p_user_id, 'venue.kitchen')
        OR public.issue_4490_user_has_venue_capability(venue.id, p_user_id, 'restaurant.manage_orders')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_is_till_device(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_user_has_venue_capability(p_venue_id, p_user_id, 'venue.till_device');
$function$;

-- ---------------------------------------------------------------------------
-- 4. Tables.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_till_settings (
  venue_id uuid PRIMARY KEY REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  tips_enabled boolean NOT NULL DEFAULT true,
  tip_bps_options integer[] NOT NULL DEFAULT '{1000,1250,1500}'::integer[]
    CHECK (cardinality(tip_bps_options) BETWEEN 0 AND 6
           AND 0 <= ALL(tip_bps_options) AND 3000 >= ALL(tip_bps_options)),
  day_starts_at time NOT NULL DEFAULT '05:00',
  auto_lock_minutes smallint NOT NULL DEFAULT 2 CHECK (auto_lock_minutes BETWEEN 1 AND 10),
  print_paper text NOT NULL DEFAULT 'a4' CHECK (print_paper IN ('a4', 'roll_80', 'roll_58')),
  default_station text NOT NULL DEFAULT 'kitchen' CHECK (default_station IN ('kitchen', 'bar')),
  target_minutes jsonb NOT NULL DEFAULT '{"kitchen":15,"bar":5}'::jsonb
    CHECK (jsonb_typeof(target_minutes) = 'object'),
  screen_stations text[] NOT NULL DEFAULT '{kitchen,bar}'::text[]
    CHECK (screen_stations <@ ARRAY['kitchen', 'bar']::text[]),
  receipt_footer text NULL CHECK (receipt_footer IS NULL OR char_length(receipt_footer) <= 200),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.venue_till_settings IS
  '#4490 spec 08 O1: Settings > Selling in person. Written only by issue_4490_till_settings_set (brand_admin+).';

CREATE TABLE public.venue_till_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL UNIQUE REFERENCES public.venue_order_sessions(id) ON DELETE RESTRICT,
  check_label text NULL CHECK (check_label IS NULL OR char_length(btrim(check_label)) BETWEEN 1 AND 40),
  qr_spot_id uuid NULL REFERENCES public.qr_spots(id) ON DELETE SET NULL,
  reservation_id uuid NULL REFERENCES public.reservations(id) ON DELETE SET NULL,
  server_user_id uuid NOT NULL,
  opened_by_user_id uuid NOT NULL,
  opened_business_date date NOT NULL,
  carried_past date NULL,
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'paying', 'paid', 'voided', 'refunded', 'partially_refunded')),
  currency text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  service_charge_minor bigint NOT NULL DEFAULT 0 CHECK (service_charge_minor >= 0),
  total_due_minor bigint NOT NULL DEFAULT 0 CHECK (total_due_minor >= 0),
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  overpaid_minor bigint NOT NULL DEFAULT 0 CHECK (overpaid_minor >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  business_date date NULL,
  day_close_id uuid NULL,
  idempotency_key text NULL UNIQUE
    CHECK (idempotency_key IS NULL OR char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  paid_at timestamptz NULL,
  voided_at timestamptz NULL,
  voided_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_till_sales_totals CHECK (total_due_minor = subtotal_minor + service_charge_minor),
  CONSTRAINT venue_till_sales_paid_shape CHECK (
    (state IN ('paid', 'refunded', 'partially_refunded')) = (business_date IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX venue_till_sales_venue_state_idx ON public.venue_till_sales (venue_id, state, created_at DESC);
CREATE INDEX venue_till_sales_brand_idx ON public.venue_till_sales (brand_id, created_at DESC);
CREATE UNIQUE INDEX venue_till_sales_open_spot_uniq ON public.venue_till_sales (qr_spot_id)
  WHERE qr_spot_id IS NOT NULL AND state IN ('open', 'paying');
COMMENT ON TABLE public.venue_till_sales IS
  '#4490 spec 08 O1: one Till check (I-4490-TILL-ONE-PRICE). Totals are written only by issue_4490_till_reprice.';

CREATE TABLE public.venue_till_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.venue_till_sales(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('menu_round', 'entry', 'group_package', 'by_the_hour', 'table', 'plan', 'balance')),
  venue_order_id uuid NULL UNIQUE REFERENCES public.venue_orders(id) ON DELETE RESTRICT,
  stay_group_id uuid NULL REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  guest_list_entry_id uuid NULL REFERENCES public.venue_guest_list_entries(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  label_snapshot text NULL CHECK (label_snapshot IS NULL OR char_length(label_snapshot) <= 120),
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'committed', 'voided', 'refunded')),
  idempotency_key text NULL CHECK (idempotency_key IS NULL OR char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  voided_at timestamptz NULL,
  voided_by_user_id uuid NULL,
  void_reason text NULL CHECK (void_reason IS NULL OR char_length(void_reason) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_till_lines_shape CHECK (
    (kind = 'menu_round' AND venue_order_id IS NOT NULL AND stay_group_id IS NULL)
    OR (kind <> 'menu_round' AND venue_order_id IS NULL AND stay_group_id IS NOT NULL)),
  CONSTRAINT venue_till_lines_guest_list_entry CHECK (guest_list_entry_id IS NULL OR kind = 'entry'),
  CONSTRAINT venue_till_lines_void_shape CHECK ((state = 'voided') = (voided_at IS NOT NULL)),
  UNIQUE (sale_id, idempotency_key)
);
CREATE INDEX venue_till_lines_sale_idx ON public.venue_till_lines (sale_id, created_at);
CREATE INDEX venue_till_lines_group_idx ON public.venue_till_lines (stay_group_id) WHERE stay_group_id IS NOT NULL;

ALTER TABLE public.venue_order_items
  ADD COLUMN voided_at timestamptz NULL,
  ADD COLUMN voided_by_user_id uuid NULL,
  ADD COLUMN void_reason text NULL CHECK (void_reason IS NULL OR char_length(void_reason) <= 60),
  ADD CONSTRAINT venue_order_items_void_shape CHECK ((voided_at IS NULL) OR prep_state = 'voided');

CREATE TABLE public.venue_till_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.venue_till_sales(id) ON DELETE RESTRICT,
  share_id uuid NULL,
  method text NOT NULL CHECK (method IN ('tap', 'scan', 'cash', 'own_machine', 'room')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  service_charge_minor bigint NOT NULL DEFAULT 0 CHECK (service_charge_minor >= 0 AND service_charge_minor <= amount_minor),
  tip_minor bigint NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  charged_minor bigint NULL CHECK (charged_minor IS NULL OR charged_minor > 0),
  cash_given_minor bigint NULL CHECK (cash_given_minor IS NULL OR cash_given_minor > 0),
  provider_channel text NULL CHECK (provider_channel IS NULL OR provider_channel IN ('card', 'bank_transfer', 'ussd', 'bank')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  paid_late boolean NOT NULL DEFAULT false,
  carrier_order_id uuid NULL,
  taken_by_user_id uuid NOT NULL,
  device_user_id uuid NOT NULL,
  server_user_id uuid NOT NULL,
  paid_at timestamptz NULL,
  business_date date NULL,
  receipt_phone_e164 text NULL CHECK (receipt_phone_e164 IS NULL OR receipt_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  receipt_email text NULL CHECK (receipt_email IS NULL OR char_length(receipt_email) <= 254),
  receipt_token_hash bytea NULL CHECK (receipt_token_hash IS NULL OR octet_length(receipt_token_hash) = 32),
  receipt_sends smallint NOT NULL DEFAULT 0 CHECK (receipt_sends BETWEEN 0 AND 3),
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, client_request_id),
  CONSTRAINT venue_till_payments_carrier_shape CHECK ((method IN ('tap', 'scan')) = (carrier_order_id IS NOT NULL)),
  CONSTRAINT venue_till_payments_cash_shape CHECK (
    (method = 'cash' AND cash_given_minor IS NOT NULL AND cash_given_minor >= amount_minor + tip_minor)
    OR (method <> 'cash' AND cash_given_minor IS NULL)),
  CONSTRAINT venue_till_payments_paid_shape CHECK (
    (state IN ('paid', 'refunded', 'partially_refunded')) = (paid_at IS NOT NULL AND business_date IS NOT NULL)),
  CONSTRAINT venue_till_payments_one_payment_cap CHECK (amount_minor + tip_minor <= 2147483647)
);
CREATE INDEX venue_till_payments_sale_idx ON public.venue_till_payments (sale_id, created_at);
CREATE INDEX venue_till_payments_day_idx ON public.venue_till_payments (business_date) WHERE business_date IS NOT NULL;
-- W4-N3: one payment attempt per check at a time.
CREATE UNIQUE INDEX venue_till_payments_one_pending_uniq ON public.venue_till_payments (sale_id)
  WHERE state = 'pending';

CREATE TABLE public.venue_till_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.venue_till_payments(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  tip_minor bigint NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  method text NOT NULL CHECK (method IN ('tap', 'scan', 'cash', 'own_machine', 'room')),
  source_refund_id uuid NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 60),
  by_user_id uuid NOT NULL,
  device_user_id uuid NOT NULL,
  business_date date NOT NULL,
  restocked boolean NOT NULL DEFAULT false,
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, client_request_id),
  CONSTRAINT venue_till_refunds_positive CHECK (amount_minor + tip_minor > 0)
);
CREATE INDEX venue_till_refunds_payment_idx ON public.venue_till_refunds (payment_id);
CREATE INDEX venue_till_refunds_day_idx ON public.venue_till_refunds (business_date);

-- ---------------------------------------------------------------------------
-- 5. venue_orders: the carrier link (O2), T1 states, T9 label, T6 seam.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_orders
  ADD COLUMN till_payment_id uuid NULL REFERENCES public.venue_till_payments(id) ON DELETE RESTRICT,
  ADD COLUMN sent_at timestamptz NULL,
  ADD COLUMN station_rev integer NOT NULL DEFAULT 0 CHECK (station_rev >= 0),
  ADD COLUMN current_label text NULL CHECK (current_label IS NULL OR char_length(btrim(current_label)) BETWEEN 1 AND 60);
CREATE INDEX venue_orders_till_payment_idx ON public.venue_orders (till_payment_id) WHERE till_payment_id IS NOT NULL;
ALTER TABLE public.venue_till_payments
  ADD CONSTRAINT venue_till_payments_carrier_fk FOREIGN KEY (carrier_order_id)
  REFERENCES public.venue_orders(id) ON DELETE RESTRICT;

ALTER TABLE public.venue_orders DROP CONSTRAINT venue_orders_fulfillment_status_check;
ALTER TABLE public.venue_orders ADD CONSTRAINT venue_orders_fulfillment_status_check CHECK (fulfillment_status IN (
  'placed', 'acknowledged', 'in_progress', 'ready', 'delivered', 'cancelled', 'refunded',
  'held', 'payment_only'));
ALTER TABLE public.venue_orders DROP CONSTRAINT venue_orders_ack_precedes_progress;
ALTER TABLE public.venue_orders ADD CONSTRAINT venue_orders_ack_precedes_progress CHECK (
  fulfillment_status IN ('placed', 'cancelled', 'held', 'payment_only') OR acknowledged_at IS NOT NULL);
-- A tapped card has no contact; a counter Till round may have no name.
ALTER TABLE public.venue_orders DROP CONSTRAINT venue_orders_paid_needs_contact;
ALTER TABLE public.venue_orders ADD CONSTRAINT venue_orders_paid_needs_contact CHECK (
  money_path <> 'mingla' OR payment_status <> 'paid'
  OR (buyer_name IS NOT NULL AND buyer_email IS NOT NULL AND buyer_phone_e164 IS NOT NULL)
  OR till_payment_id IS NOT NULL);
ALTER TABLE public.venue_orders DROP CONSTRAINT venue_orders_destination_shape;
ALTER TABLE public.venue_orders ADD CONSTRAINT venue_orders_destination_shape CHECK (
  (qr_spot_id IS NOT NULL AND pickup_code IS NULL)
  OR (qr_spot_id IS NULL AND pickup_code IS NOT NULL AND buyer_name IS NOT NULL)
  OR till_payment_id IS NOT NULL
  OR (source = 'staff' AND qr_spot_id IS NULL AND pickup_code IS NOT NULL
      AND (metadata->>'till_sale_id') IS NOT NULL));
ALTER TABLE public.venue_order_sessions DROP CONSTRAINT venue_order_sessions_settlement_method_check;
ALTER TABLE public.venue_order_sessions ADD CONSTRAINT venue_order_sessions_settlement_method_check CHECK (
  settlement_method IS NULL OR settlement_method IN ('per_round', 'bill_to_phone', 'venue_collected', 'till'));

-- ---------------------------------------------------------------------------
-- 6. Revenue readers. A Till carrier is a payment instrument, never a sale;
--    Till children are sales, never Mingla money twice.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o1_patch(
  'public.venue_order_metrics_rollup(uuid,uuid)'::regprocedure,
  $old$coalesce(o.metadata->>'tab_settlement','') <> 'true'$old$,
  $new$coalesce(o.metadata->>'tab_settlement','') <> 'true' AND o.till_payment_id IS NULL$new$,
  2
);

CREATE OR REPLACE VIEW public.issue_3872_order_margin AS
SELECT 'ticket'::text order_kind, o.id order_id, e.brand_id,
  lower(o.currency::text) currency, o.created_at,
  COALESCE(o.list_subtotal_cents,o.net_subtotal_cents,o.total_cents)::bigint list_subtotal_cents,
  COALESCE(o.discount_cents,0)::bigint discount_cents,
  COALESCE(o.buyer_total_cents,o.total_cents)::bigint buyer_total_cents,
  COALESCE(o.stripe_application_fee_amount_cents,0)::bigint application_fee_cents,
  fs.provider_fee_cents::bigint provider_fee_cents,
  (COALESCE(o.stripe_application_fee_amount_cents,0)-COALESCE(fs.provider_fee_cents,0))::bigint mingla_margin_cents,
  COALESCE(o.discount_cents,0)>0 discounted
FROM public.orders o
JOIN public.events e ON e.id=o.event_id
LEFT JOIN public.payout_source_fee_snapshots fs
  ON fs.source_type='order' AND fs.source_id=o.id
WHERE o.payment_status IN ('paid','partial_refund','refunded')
  AND coalesce(o.source,'online_checkout')<>'door_sale'
UNION ALL
SELECT 'venue_order',v.id,v.brand_id,lower(v.currency),v.created_at,
  COALESCE(v.list_subtotal_cents,v.subtotal_cents)::bigint,
  COALESCE(v.discount_cents,0)::bigint,v.total_cents::bigint,
  (COALESCE(v.mingla_fee_cents,0)+COALESCE(v.platform_service_fee_cents,0))::bigint,
  fs.provider_fee_cents::bigint,
  (COALESCE(v.mingla_fee_cents,0)+COALESCE(v.platform_service_fee_cents,0)-COALESCE(fs.provider_fee_cents,0))::bigint,
  COALESCE(v.discount_cents,0)>0
FROM public.venue_orders v
LEFT JOIN public.payout_source_fee_snapshots fs
  ON fs.source_type='venue_menu_order' AND fs.source_id=v.id
WHERE v.payment_status IN ('paid','refunded')
  -- #4490 spec 08 O1: a Till child is never Mingla money; its card carrier is.
  AND (v.till_payment_id IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.venue_till_sales ts WHERE ts.session_id = v.session_id))
UNION ALL
SELECT 'reservation_deposit',s.id,s.brand_id,lower(s.currency::text),s.created_at,
  COALESCE(s.deposit_list_cents,s.amount_cents)::bigint,
  COALESCE(s.discount_cents,0)::bigint,s.amount_cents::bigint,
  COALESCE(s.application_fee_amount_cents,0)::bigint,NULL::bigint,
  COALESCE(s.application_fee_amount_cents,0)::bigint,
  COALESCE(s.discount_cents,0)>0
FROM public.reservation_checkout_sessions s
WHERE s.status='completed';
REVOKE ALL ON public.issue_3872_order_margin FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.issue_3872_order_margin TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Stays objects sold at the Till: groups collected by the Till, and the
--    offline payment row that pays them (booking money, Paid in today).
-- ---------------------------------------------------------------------------
ALTER TABLE public.stay_reservation_groups DROP CONSTRAINT stay_reservation_groups_payment_collection_check;
ALTER TABLE public.stay_reservation_groups ADD CONSTRAINT stay_reservation_groups_payment_collection_check
  CHECK (payment_collection IN ('mingla', 'property', 'till'));
ALTER TABLE public.stay_reservation_groups
  ADD COLUMN till_sale_id uuid NULL REFERENCES public.venue_till_sales(id) ON DELETE SET NULL;
CREATE INDEX stay_reservation_groups_till_sale_idx ON public.stay_reservation_groups (till_sale_id)
  WHERE till_sale_id IS NOT NULL;

-- A walk-in group is written under the gate GUC (issue_4490_hold_offer_internal
-- with p_gate) and may now be collected by the Till.
SELECT pg_temp.issue_4490_o1_patch(
  'public.issue_4188_guard_stay_group_source_truth()'::regprocedure,
  $old$       AND NEW.payment_collection IN ('mingla', 'property')
       AND NEW.created_by_staff_user_id IS NOT NULL
       AND current_setting('mingla.issue_4490_gate_sale', true) = NEW.id::text THEN$old$,
  $new$       AND NEW.payment_collection IN ('mingla', 'property', 'till')
       AND NEW.created_by_staff_user_id IS NOT NULL
       AND current_setting('mingla.issue_4490_gate_sale', true) = NEW.id::text THEN$new$
);

ALTER TABLE public.venue_offline_payments DROP CONSTRAINT venue_offline_payments_method_check;
ALTER TABLE public.venue_offline_payments ADD CONSTRAINT venue_offline_payments_method_check
  CHECK (method IN ('cash', 'transfer', 'card_at_venue', 'other', 'till'));
ALTER TABLE public.venue_offline_payments
  ADD COLUMN till_payment_id uuid NULL REFERENCES public.venue_till_payments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT venue_offline_payments_till_shape CHECK ((method = 'till') = (till_payment_id IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 8. Helpers.
-- ---------------------------------------------------------------------------
-- Business date of a moment at a venue: the venue's day starts at day_starts_at.
CREATE OR REPLACE FUNCTION public.issue_4490_till_business_date(p_venue_id uuid, p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ((p_at AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id))
          - COALESCE((SELECT s.day_starts_at FROM public.venue_till_settings s WHERE s.venue_id = p_venue_id),
                     time '05:00'))::date;
$function$;

-- The Till is on for a venue only when the rollout flag and the feature are on.
CREATE OR REPLACE FUNCTION public.issue_4490_till_enabled(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_flag_on('VENUE_TILL')
    AND public.issue_4490_venue_feature_on(p_venue_id, 'till');
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_sale_projection(p_sale_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', s.id, 'venueId', s.venue_id, 'brandId', s.brand_id, 'state', s.state,
    'checkLabel', s.check_label, 'spotId', s.qr_spot_id,
    'spotLabel', (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id),
    'serverUserId', s.server_user_id, 'openedByUserId', s.opened_by_user_id,
    'currency', s.currency, 'subtotalMinor', s.subtotal_minor, 'serviceChargeMinor', s.service_charge_minor,
    'totalDueMinor', s.total_due_minor, 'paidMinor', s.paid_minor,
    'remainingMinor', GREATEST(s.total_due_minor - s.paid_minor, 0), 'overpaidMinor', s.overpaid_minor,
    'version', s.version, 'openedBusinessDate', s.opened_business_date, 'businessDate', s.business_date,
    'paidAt', s.paid_at, 'createdAt', s.created_at,
    'pendingPayment', EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = s.id AND p.state = 'pending'),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', l.id, 'kind', l.kind, 'state', l.state, 'amountMinor', l.amount_minor,
          'label', l.label_snapshot, 'orderId', l.venue_order_id, 'groupId', l.stay_group_id,
          'guestListEntryId', l.guest_list_entry_id, 'voidReason', l.void_reason,
          'sent', CASE WHEN l.kind = 'menu_round' THEN o.fulfillment_status NOT IN ('held', 'cancelled') END,
          'fulfillmentStatus', o.fulfillment_status, 'pickupCode', o.pickup_code,
          'serviceChargeMinor', CASE WHEN l.kind = 'menu_round' THEN o.service_charge_cents END,
          'items', CASE WHEN l.kind = 'menu_round' THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'menuItemId', i.menu_item_id, 'name', i.item_name_at_order,
                'quantity', i.quantity, 'unitMinor', i.unit_price_cents + i.modifiers_total_cents,
                'lineTotalMinor', i.line_total_cents, 'notes', i.notes, 'prepState', i.prep_state,
                'voided', i.prep_state = 'voided', 'voidReason', i.void_reason,
                'modifiers', COALESCE((SELECT jsonb_agg(m.modifier_name_at_order ORDER BY m.modifier_name_at_order)
                  FROM public.venue_order_item_modifiers m WHERE m.venue_order_item_id = i.id), '[]'::jsonb))
              ORDER BY i.line_no)
            FROM public.venue_order_items i WHERE i.venue_order_id = o.id), '[]'::jsonb) END,
          'createdAt', l.created_at)
        ORDER BY l.created_at, l.id)
      FROM public.venue_till_lines l
      LEFT JOIN public.venue_orders o ON o.id = l.venue_order_id
      WHERE l.sale_id = s.id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'method', p.method, 'state', p.state, 'amountMinor', p.amount_minor,
          'serviceChargeMinor', p.service_charge_minor, 'tipMinor', p.tip_minor,
          'cashGivenMinor', p.cash_given_minor,
          'changeMinor', CASE WHEN p.cash_given_minor IS NOT NULL
            THEN p.cash_given_minor - p.amount_minor - p.tip_minor END,
          'paidLate', p.paid_late, 'paidAt', p.paid_at, 'takenByUserId', p.taken_by_user_id,
          'reference', upper(right(replace(p.id::text, '-', ''), 8)),
          'refundedMinor', COALESCE((SELECT sum(r.amount_minor + r.tip_minor) FROM public.venue_till_refunds r
                                     WHERE r.payment_id = p.id), 0),
          'receiptSends', p.receipt_sends)
        ORDER BY p.created_at, p.id)
      FROM public.venue_till_payments p WHERE p.sale_id = s.id), '[]'::jsonb)
  )
  FROM public.venue_till_sales s
  WHERE s.id = p_sale_id;
$function$;

-- Lock a sale for a mutation and check who may make it.
CREATE OR REPLACE FUNCTION public.issue_4490_till_lock(
  p_sale_id uuid,
  p_actor uuid,
  p_expected_version integer
)
RETURNS public.venue_till_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_till_enabled(v_sale.venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_sell(v_sale.venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_sale.version THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
  RETURN v_sale;
END;
$function$;

-- Totals come only from the children (I-4490-TILL-ONE-PRICE). Every mutation
-- calls this; it also adopts rounds a legacy tab took before the Till existed.
CREATE OR REPLACE FUNCTION public.issue_4490_till_reprice(p_sale_id uuid)
RETURNS public.venue_till_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_rounds_sub bigint;
  v_rounds_sc bigint;
  v_lines bigint;
  v_hold_minutes integer;
BEGIN
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.venue_till_lines (sale_id, kind, venue_order_id, amount_minor, state, created_at)
  SELECT v_sale.id, 'menu_round', o.id, o.total_cents, 'held', o.created_at
  FROM public.venue_orders o
  WHERE o.session_id = v_sale.session_id
    AND o.till_payment_id IS NULL
    AND coalesce(o.metadata->>'tab_settlement', '') <> 'true'
    AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = o.id);
  UPDATE public.venue_till_lines l
  SET amount_minor = o.total_cents,
      state = CASE WHEN o.fulfillment_status = 'cancelled' OR o.payment_status = 'cancelled' THEN 'voided'
                   WHEN o.payment_status = 'paid' THEN 'committed' ELSE l.state END,
      voided_at = CASE WHEN (o.fulfillment_status = 'cancelled' OR o.payment_status = 'cancelled')
                       THEN COALESCE(l.voided_at, now()) ELSE l.voided_at END,
      updated_at = now()
  FROM public.venue_orders o
  WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND o.id = l.venue_order_id
    AND (l.amount_minor <> o.total_cents
         OR (l.state <> 'voided' AND (o.fulfillment_status = 'cancelled' OR o.payment_status = 'cancelled')));
  SELECT COALESCE(sum(o.subtotal_cents), 0), COALESCE(sum(o.service_charge_cents), 0)
  INTO v_rounds_sub, v_rounds_sc
  FROM public.venue_till_lines l
  JOIN public.venue_orders o ON o.id = l.venue_order_id
  WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state IN ('held', 'committed');
  SELECT COALESCE(sum(l.amount_minor), 0) INTO v_lines
  FROM public.venue_till_lines l
  WHERE l.sale_id = v_sale.id AND l.kind <> 'menu_round' AND l.state IN ('held', 'committed');
  UPDATE public.venue_till_sales
  SET subtotal_minor = v_rounds_sub + v_lines,
      service_charge_minor = v_rounds_sc,
      total_due_minor = v_rounds_sub + v_lines + v_rounds_sc,
      version = version + 1,
      updated_at = now()
  WHERE id = v_sale.id
  RETURNING * INTO v_sale;
  -- Offer holds are refreshed on each reprice, up to 60 minutes in all.
  SELECT COALESCE(b.instant_payment_hold_minutes, 15) INTO v_hold_minutes
  FROM public.venue_booking_settings b WHERE b.venue_id = v_sale.venue_id;
  UPDATE public.stay_inventory_holds h
  SET expires_at = LEAST(h.created_at + interval '60 minutes',
                         now() + make_interval(mins => COALESCE(v_hold_minutes, 15))),
      updated_at = now()
  FROM public.venue_till_lines l
  WHERE l.sale_id = v_sale.id AND l.state = 'held' AND l.stay_group_id = h.group_id
    AND l.kind IN ('entry', 'group_package') AND h.state = 'active' AND h.expires_at > now();
  RETURN v_sale;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Settings.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_settings_set(
  p_venue_id uuid,
  p_patch jsonb,
  p_actor uuid,
  p_expected_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row public.venue_till_settings%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_actor IS NULL
     OR public.biz_brand_effective_rank(v_venue.brand_id, p_actor) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) k
    WHERE k NOT IN ('tipsEnabled', 'tipBpsOptions', 'dayStartsAt', 'autoLockMinutes', 'printPaper',
                    'defaultStation', 'targetMinutes', 'screenStations', 'receiptFooter')) THEN
    RAISE EXCEPTION 'till_settings_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.venue_till_settings (venue_id, brand_id) VALUES (v_venue.id, v_venue.brand_id)
  ON CONFLICT (venue_id) DO NOTHING;
  SELECT * INTO v_row FROM public.venue_till_settings WHERE venue_id = v_venue.id FOR UPDATE;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_row.version THEN
    RAISE EXCEPTION 'till_settings_changed' USING ERRCODE = 'PT409';
  END IF;
  BEGIN
    UPDATE public.venue_till_settings SET
      tips_enabled = COALESCE((p_patch->>'tipsEnabled')::boolean, tips_enabled),
      tip_bps_options = CASE WHEN p_patch ? 'tipBpsOptions'
        THEN ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(p_patch->'tipBpsOptions') x)
        ELSE tip_bps_options END,
      day_starts_at = COALESCE((p_patch->>'dayStartsAt')::time, day_starts_at),
      auto_lock_minutes = COALESCE((p_patch->>'autoLockMinutes')::smallint, auto_lock_minutes),
      print_paper = COALESCE(p_patch->>'printPaper', print_paper),
      default_station = COALESCE(p_patch->>'defaultStation', default_station),
      target_minutes = COALESCE(p_patch->'targetMinutes', target_minutes),
      screen_stations = CASE WHEN p_patch ? 'screenStations'
        THEN ARRAY(SELECT x FROM jsonb_array_elements_text(p_patch->'screenStations') x)
        ELSE screen_stations END,
      receipt_footer = CASE WHEN p_patch ? 'receiptFooter'
        THEN NULLIF(btrim(COALESCE(p_patch->>'receiptFooter', '')), '') ELSE receipt_footer END,
      version = version + 1, updated_by = p_actor, updated_at = now()
    WHERE venue_id = v_venue.id
    RETURNING * INTO v_row;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR datetime_field_overflow
                 OR invalid_datetime_format OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'till_settings_invalid' USING ERRCODE = '22023';
  END;
  RETURN public.issue_4490_till_settings_projection(v_venue.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_settings_projection(p_venue_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'tipsEnabled', COALESCE(s.tips_enabled, true),
    'tipBpsOptions', to_jsonb(COALESCE(s.tip_bps_options, '{1000,1250,1500}'::integer[])),
    'dayStartsAt', to_char(COALESCE(s.day_starts_at, time '05:00'), 'HH24:MI'),
    'autoLockMinutes', COALESCE(s.auto_lock_minutes, 2),
    'printPaper', COALESCE(s.print_paper, 'a4'),
    'defaultStation', COALESCE(s.default_station, 'kitchen'),
    'targetMinutes', COALESCE(s.target_minutes, '{"kitchen":15,"bar":5}'::jsonb),
    'screenStations', to_jsonb(COALESCE(s.screen_stations, '{kitchen,bar}'::text[])),
    'receiptFooter', s.receipt_footer,
    'version', COALESCE(s.version, 0))
  FROM (SELECT 1) one
  LEFT JOIN public.venue_till_settings s ON s.venue_id = p_venue_id;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Open a check; move it (T9); change its server (T9).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_open(
  p_venue_id uuid,
  p_actor uuid,
  p_server uuid,
  p_label text,
  p_spot_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_existing public.venue_till_sales%ROWTYPE;
  v_spot public.qr_spots%ROWTYPE;
  v_session uuid;
  v_sale_id uuid;
  v_server uuid := COALESCE(p_server, p_actor);
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_currency text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR (v_label IS NOT NULL AND char_length(v_label) > 40) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_till_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_sell(p_venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('till-open:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.venue_till_sales WHERE idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.venue_id <> p_venue_id THEN
      RAISE EXCEPTION 'till_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_4490_till_sale_projection(v_existing.id) || jsonb_build_object('replayed', true);
  END IF;
  IF v_server <> p_actor AND NOT public.issue_4490_can_sell(p_venue_id, v_server) THEN
    RAISE EXCEPTION 'till_server_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_spot_id IS NOT NULL THEN
    SELECT * INTO v_spot FROM public.qr_spots
    WHERE id = p_spot_id AND venue_id = p_venue_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'till_spot_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_till_sales s
               WHERE s.qr_spot_id = p_spot_id AND s.state IN ('open', 'paying')) THEN
      RAISE EXCEPTION 'till_spot_has_check' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  v_currency := upper(COALESCE(NULLIF(btrim((SELECT b.default_currency FROM public.brands b
                                             WHERE b.id = v_venue.brand_id)), ''), 'NGN'));
  INSERT INTO public.venue_order_sessions (brand_id, venue_id, qr_spot_id, currency)
  VALUES (v_venue.brand_id, v_venue.id, p_spot_id, v_currency)
  RETURNING id INTO v_session;
  INSERT INTO public.venue_till_sales (
    brand_id, venue_id, session_id, check_label, qr_spot_id, server_user_id, opened_by_user_id,
    opened_business_date, currency, idempotency_key
  ) VALUES (
    v_venue.brand_id, v_venue.id, v_session, v_label, p_spot_id, v_server, p_actor,
    public.issue_4490_till_business_date(v_venue.id, now()), v_currency, btrim(p_idempotency_key)
  ) RETURNING id INTO v_sale_id;
  RETURN public.issue_4490_till_sale_projection(v_sale_id) || jsonb_build_object('replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_relabel(
  p_sale_id uuid,
  p_spot_id uuid,
  p_label text,
  p_actor uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_spot public.qr_spots%ROWTYPE;
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
BEGIN
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_label IS NOT NULL AND char_length(v_label) > 40 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_spot_id IS NOT NULL THEN
    SELECT * INTO v_spot FROM public.qr_spots WHERE id = p_spot_id AND venue_id = v_sale.venue_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'till_spot_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_till_sales s
               WHERE s.qr_spot_id = p_spot_id AND s.id <> v_sale.id AND s.state IN ('open', 'paying')) THEN
      RAISE EXCEPTION 'till_spot_has_check' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  UPDATE public.venue_till_sales
  SET qr_spot_id = p_spot_id, check_label = v_label, version = version + 1, updated_at = now()
  WHERE id = v_sale.id;
  UPDATE public.venue_order_sessions SET qr_spot_id = p_spot_id, updated_at = now() WHERE id = v_sale.session_id;
  -- Tickets keep spot_label_at_order (provenance) and show current_label.
  UPDATE public.venue_orders o
  SET current_label = COALESCE(v_spot.label, v_label), station_rev = station_rev + 1, updated_at = now()
  WHERE o.session_id = v_sale.session_id AND o.till_payment_id IS NULL
    AND o.fulfillment_status NOT IN ('delivered', 'cancelled', 'refunded');
  RETURN public.issue_4490_till_sale_projection(v_sale.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_set_server(
  p_sale_id uuid,
  p_server uuid,
  p_actor uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
BEGIN
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF v_sale.state NOT IN ('open', 'paying') THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  IF p_server IS NULL OR NOT public.issue_4490_can_sell(v_sale.venue_id, p_server) THEN
    RAISE EXCEPTION 'till_server_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.venue_till_sales SET server_user_id = p_server, version = version + 1, updated_at = now()
  WHERE id = v_sale.id;
  RETURN public.issue_4490_till_sale_projection(v_sale.id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Lines: a menu round the edge priced and inserted (held), an offer, a
--     booking balance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_attach_round(
  p_sale_id uuid,
  p_order_id uuid,
  p_actor uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_order public.venue_orders%ROWTYPE;
BEGIN
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.session_id <> v_sale.session_id OR v_order.source <> 'staff'
     OR v_order.money_path <> 'venue_collected' OR v_order.payment_status <> 'pending'
     OR v_order.till_payment_id IS NOT NULL
     OR v_order.fulfillment_status NOT IN ('held', 'placed') THEN
    RAISE EXCEPTION 'till_round_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.venue_till_lines (sale_id, kind, venue_order_id, amount_minor, state)
  VALUES (v_sale.id, 'menu_round', v_order.id, v_order.total_cents, 'held')
  ON CONFLICT (venue_order_id) DO NOTHING;
  UPDATE public.venue_order_sessions SET last_order_at = now(), updated_at = now() WHERE id = v_sale.session_id;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_add_offer_line(
  p_sale_id uuid,
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor uuid,
  p_idempotency_key text,
  p_guest_list_entry_id uuid DEFAULT NULL,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_actor text;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_quote jsonb;
  v_group_id uuid;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_entry public.venue_guest_list_entries%ROWTYPE;
  v_terms public.venue_guest_list_terms%ROWTYPE;
  v_count integer;
BEGIN
  IF char_length(v_key) NOT BETWEEN 8 AND 200 OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.sale_id = v_sale.id AND l.idempotency_key = v_key) THEN
    RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', true);
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = p_offering_id AND venue_id = v_sale.venue_id AND kind IN ('entry', 'group_package') AND status = 'live';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_window_id IS NOT NULL THEN
    SELECT * INTO v_window FROM public.stay_place_windows w
    WHERE w.id = p_window_id AND w.offering_id = v_offer.id;
  ELSE
    SELECT * INTO v_window FROM public.stay_place_windows w
    WHERE w.offering_id = v_offer.id AND w.local_date = public.issue_4490_venue_local_date(v_sale.venue_id)
      AND NOT w.stop_sell AND now() < public.issue_4490_window_cutoff(v_offer.id, w.id)
    ORDER BY w.starts_at LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  -- Spec 07 §11 B3: a guest-list arrival in the reduced window, at the
  -- venue's reduced price option, for no more guests than are left.
  IF p_guest_list_entry_id IS NOT NULL THEN
    SELECT * INTO v_entry FROM public.venue_guest_list_entries
    WHERE id = p_guest_list_entry_id AND venue_id = v_sale.venue_id FOR UPDATE;
    IF NOT FOUND OR v_entry.status <> 'on_list' OR v_offer.kind <> 'entry' THEN
      RAISE EXCEPTION 'guest_list_entry_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_terms FROM public.venue_guest_list_terms WHERE venue_id = v_sale.venue_id;
    IF v_terms.reduced_until IS NULL OR now() >= public.issue_4490_guest_list_cutoff_at(
        v_sale.venue_id, v_entry.local_date, v_terms.reduced_until) THEN
      RAISE EXCEPTION 'guest_list_reduced_window_closed' USING ERRCODE = 'PT409';
    END IF;
    IF jsonb_array_length(p_lines) <> 1
       OR (p_lines->0->>'priceOptionId') IS DISTINCT FROM v_terms.reduced_price_option_id::text THEN
      RAISE EXCEPTION 'guest_list_reduced_price_invalid' USING ERRCODE = 'PT409';
    END IF;
    v_count := (p_lines->0->>'guests')::integer;
    IF v_count IS NULL OR v_count < 1 OR v_entry.arrived + v_count > 1 + v_entry.plus_ones THEN
      RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_actor := encode(pg_catalog.sha256(convert_to('till:' || p_actor::text, 'UTF8')), 'hex');
  v_quote := public.issue_4490_quote_offer_internal(
    v_offer.id, v_window.id, p_lines, v_actor, NULL, 'till-quote:' || v_key, true);
  v_group_id := public.issue_4490_hold_offer_internal(
    gen_random_uuid(), (v_quote->>'quoteId')::uuid,
    jsonb_build_object('name', COALESCE(v_sale.check_label, 'Walk-in')),
    v_actor, NULL, NULL, v_key, true, p_actor, 'till');
  UPDATE public.stay_reservation_groups SET till_sale_id = v_sale.id WHERE id = v_group_id
  RETURNING * INTO v_group;
  IF p_guest_list_entry_id IS NOT NULL THEN
    INSERT INTO public.venue_guest_list_sales (group_id, entry_id, admit_count)
    VALUES (v_group_id, v_entry.id, v_count)
    ON CONFLICT (group_id) DO NOTHING;
  END IF;
  INSERT INTO public.venue_till_lines (
    sale_id, kind, stay_group_id, guest_list_entry_id, amount_minor, label_snapshot, state, idempotency_key
  ) VALUES (
    v_sale.id, v_offer.kind, v_group_id, p_guest_list_entry_id, v_group.total_minor,
    left(v_offer.name, 120), 'held', v_key
  );
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_add_balance_line(
  p_sale_id uuid,
  p_group_id uuid,
  p_amount_minor bigint,
  p_actor uuid,
  p_idempotency_key text,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_money record;
  v_held bigint;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
BEGIN
  IF char_length(v_key) NOT BETWEEN 8 AND 200 OR p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.sale_id = v_sale.id AND l.idempotency_key = v_key) THEN
    RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', true);
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups
  WHERE id = p_group_id AND venue_id = v_sale.venue_id AND offer_kind IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(v_group.id);
  -- What other open checks already hold against this balance counts too.
  SELECT COALESCE(sum(l.amount_minor), 0) INTO v_held
  FROM public.venue_till_lines l
  JOIN public.venue_till_sales s ON s.id = l.sale_id
  WHERE l.stay_group_id = v_group.id AND l.kind = 'balance' AND l.state = 'held' AND s.state IN ('open', 'paying');
  IF p_amount_minor > v_money.balance - v_held THEN
    RAISE EXCEPTION 'offer_amount_over_balance' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('balanceMinor', GREATEST(v_money.balance - v_held, 0))::text;
  END IF;
  INSERT INTO public.venue_till_lines (
    sale_id, kind, stay_group_id, amount_minor, label_snapshot, state, idempotency_key
  ) VALUES (
    v_sale.id, 'balance', v_group.id, p_amount_minor, v_group.public_reference, 'held', v_key
  );
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Void (before payment). Unsent: venue.sell. Sent: money rights. Paid:
--     refused (refund instead).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_void(
  p_sale_id uuid,
  p_line_id uuid,
  p_order_item_id uuid,
  p_actor uuid,
  p_reason text,
  p_restock boolean,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_line public.venue_till_lines%ROWTYPE;
  v_order public.venue_orders%ROWTYPE;
  v_item public.venue_order_items%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_list bigint;
  v_disc bigint;
  v_sub bigint;
  v_sc bigint;
BEGIN
  IF (p_line_id IS NULL) = (p_order_item_id IS NULL) OR char_length(v_reason) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF v_sale.state IN ('paid', 'refunded', 'partially_refunded') THEN
    RAISE EXCEPTION 'till_line_paid' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  -- Money already taken on this check: what is paid is not voided (refund it).
  IF v_sale.paid_minor > 0 THEN
    RAISE EXCEPTION 'till_line_paid' USING ERRCODE = 'PT409';
  END IF;

  IF p_order_item_id IS NOT NULL THEN
    SELECT i.* INTO v_item FROM public.venue_order_items i
    JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE i.id = p_order_item_id AND o.session_id = v_sale.session_id
    FOR UPDATE OF i;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'till_line_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_order FROM public.venue_orders WHERE id = v_item.venue_order_id FOR UPDATE;
  ELSE
    SELECT * INTO v_line FROM public.venue_till_lines WHERE id = p_line_id AND sale_id = v_sale.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'till_line_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_line.state = 'voided' THEN
      RETURN public.issue_4490_till_sale_projection(v_sale.id);
    END IF;
    IF v_line.state <> 'held' THEN
      RAISE EXCEPTION 'till_line_paid' USING ERRCODE = 'PT409';
    END IF;
    IF v_line.kind = 'menu_round' THEN
      SELECT * INTO v_order FROM public.venue_orders WHERE id = v_line.venue_order_id FOR UPDATE;
    END IF;
  END IF;

  IF v_order.id IS NOT NULL THEN
    IF v_order.payment_status <> 'pending' THEN
      RAISE EXCEPTION 'till_line_paid' USING ERRCODE = 'PT409';
    END IF;
    IF v_order.fulfillment_status <> 'held'
       AND NOT public.issue_4490_can_manage_money(v_sale.venue_id, p_actor) THEN
      RAISE EXCEPTION 'till_void_needs_money_rights' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_item.id IS NOT NULL THEN
    IF v_item.prep_state = 'voided' THEN
      RETURN public.issue_4490_till_sale_projection(v_sale.id);
    END IF;
    UPDATE public.venue_order_items
    SET prep_state = 'voided', voided_at = now(), voided_by_user_id = p_actor, void_reason = v_reason
    WHERE id = v_item.id;
    SELECT COALESCE(sum(i.line_total_cents), 0) INTO v_list
    FROM public.venue_order_items i WHERE i.venue_order_id = v_order.id AND i.prep_state <> 'voided';
    IF v_list = 0 THEN
      UPDATE public.venue_orders
      SET fulfillment_status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(),
          station_rev = station_rev + 1, updated_at = now()
      WHERE id = v_order.id;
    ELSE
      -- Reprice the round the same way it was priced (P-20): list, discount
      -- capped at the list, service charge on the net (venue_collected: no fees).
      IF v_order.list_subtotal_cents IS NULL THEN
        v_disc := v_order.discount_cents;
        v_sub := v_list;
      ELSE
        v_disc := LEAST(COALESCE(v_order.discount_cents, 0), v_list);
        v_sub := v_list - v_disc;
      END IF;
      v_sc := round(v_sub::numeric * v_order.service_charge_bps / 10000);
      UPDATE public.venue_orders
      SET list_subtotal_cents = CASE WHEN v_order.list_subtotal_cents IS NULL THEN NULL ELSE v_list END,
          discount_cents = v_disc,
          subtotal_cents = v_sub,
          service_charge_cents = v_sc,
          buyer_subtotal_cents = v_sub + v_sc,
          total_cents = v_sub + v_sc + tip_cents,
          station_rev = station_rev + 1, updated_at = now()
      WHERE id = v_order.id;
    END IF;
  ELSIF v_order.id IS NOT NULL THEN
    UPDATE public.venue_order_items
    SET prep_state = 'voided', voided_at = now(), voided_by_user_id = p_actor, void_reason = v_reason
    WHERE venue_order_id = v_order.id AND prep_state <> 'voided';
    UPDATE public.venue_orders
    SET fulfillment_status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(),
        station_rev = station_rev + 1, updated_at = now()
    WHERE id = v_order.id;
    UPDATE public.venue_till_lines
    SET state = 'voided', voided_at = now(), voided_by_user_id = p_actor, void_reason = v_reason, updated_at = now()
    WHERE id = v_line.id;
  ELSE
    -- An offer line: release the held places now (the sweep would later).
    IF v_line.kind IN ('entry', 'group_package') THEN
      UPDATE public.stay_reservation_groups SET state = 'cancelled', version = version + 1, updated_at = now()
      WHERE id = v_line.stay_group_id AND state = 'instant_payment_pending';
      UPDATE public.stay_reservation_lines SET state = 'expired', version = version + 1, updated_at = now()
      WHERE group_id = v_line.stay_group_id AND state = 'payment_pending';
      UPDATE public.stay_inventory_holds
      SET state = 'expired', reason = 'till_void', version = version + 1, updated_at = now()
      WHERE group_id = v_line.stay_group_id AND state = 'active';
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
      ) VALUES (
        v_line.stay_group_id, 'stay_offer_till_voided', 'staff', p_actor, 'till-void:' || v_line.id,
        jsonb_build_object('reason', v_reason)
      ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
      DELETE FROM public.venue_guest_list_sales WHERE group_id = v_line.stay_group_id AND applied_at IS NULL;
    END IF;
    UPDATE public.venue_till_lines
    SET state = 'voided', voided_at = now(), voided_by_user_id = p_actor, void_reason = v_reason, updated_at = now()
    WHERE id = v_line.id;
  END IF;
  -- p_restock is the O5 stock seam: nothing is tracked until stock ships.
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 13. Send held rounds to the queue (T1: held -> placed only here).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_send(p_sale_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_sent uuid[];
BEGIN
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  IF v_sale.state NOT IN ('open', 'paying') THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  -- Stock is taken here once O5 ships (I-4490-STOCK-NEVER-NEGATIVE seam).
  WITH sent AS (
    UPDATE public.venue_orders o
    SET fulfillment_status = 'placed', sent_at = now(), updated_at = now()
    FROM public.venue_till_lines l
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.venue_order_id = o.id
      AND o.fulfillment_status = 'held'
    RETURNING o.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_sent FROM sent;
  IF cardinality(v_sent) > 0 THEN
    UPDATE public.venue_till_sales SET version = version + 1, updated_at = now() WHERE id = v_sale.id;
  END IF;
  RETURN public.issue_4490_till_sale_projection(v_sale.id)
    || jsonb_build_object('sentOrderIds', to_jsonb(v_sent));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Payments. The offline payment row that pays a Stays line (service only;
--     the Till payment is already proven).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_record_till_offer_payment(
  p_group_id uuid,
  p_amount_minor bigint,
  p_payment_id uuid,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_payment public.venue_till_payments%ROWTYPE;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > 2147483647
     OR char_length(v_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id;
  IF v_group.id IS NULL OR v_payment.id IS NULL OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_id FROM public.venue_offline_payments WHERE group_id = p_group_id AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  PERFORM set_config('mingla.issue_4490_booking_change', p_group_id::text, true);
  INSERT INTO public.venue_offline_payments (
    group_id, amount_minor, currency_code, method, paid_on, note, recorded_by, idempotency_key, request_hash,
    till_payment_id
  ) VALUES (
    p_group_id, p_amount_minor, v_group.currency_code, 'till', v_payment.business_date, NULL,
    v_payment.taken_by_user_id, v_key,
    encode(pg_catalog.sha256(convert_to(jsonb_build_object('payment', p_payment_id, 'amount', p_amount_minor::text)::text,
      'UTF8')), 'hex'),
    p_payment_id
  ) RETURNING id INTO v_id;
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now() WHERE id = p_group_id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_offer_paid_at_venue', 'staff', v_payment.taken_by_user_id, 'paid-at-till:' || v_id,
    jsonb_build_object('paymentId', v_id, 'amountMinor', p_amount_minor::text, 'method', 'till',
      'currencyCode', v_group.currency_code)
  );
  RETURN v_id;
END;
$function$;

-- The one finalizer, idempotent on the payment id. Money that lands after its
-- payment was cancelled is never dropped (I-4490-TILL-LATE-MONEY-NEVER-DROPPED).
CREATE OR REPLACE FUNCTION public.issue_4490_till_apply_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment public.venue_till_payments%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_line record;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_pass uuid;
  v_late boolean;
  v_room bigint;
  v_counts bigint;
  v_now timestamptz := now();
  v_day date;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment.state IN ('paid', 'refunded', 'partially_refunded') THEN
    RETURN jsonb_build_object('paymentId', v_payment.id, 'replayed', true);
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_payment.sale_id FOR UPDATE;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_sale.venue_id;
  v_late := v_payment.state IN ('cancelled', 'failed') OR v_sale.state NOT IN ('open', 'paying');
  v_day := public.issue_4490_till_business_date(v_sale.venue_id, v_now);
  UPDATE public.venue_till_payments
  SET state = 'paid', paid_late = v_late, paid_at = v_now, business_date = v_day, updated_at = v_now
  WHERE id = v_payment.id RETURNING * INTO v_payment;

  v_room := GREATEST(v_sale.total_due_minor - v_sale.paid_minor, 0);
  v_counts := LEAST(v_payment.amount_minor, v_room);
  IF v_late OR v_counts < v_payment.amount_minor THEN
    UPDATE public.venue_till_sales
    SET paid_minor = paid_minor + CASE WHEN v_late THEN 0 ELSE v_counts END,
        overpaid_minor = overpaid_minor + v_payment.amount_minor - CASE WHEN v_late THEN 0 ELSE v_counts END,
        version = version + 1, updated_at = v_now
    WHERE id = v_sale.id RETURNING * INTO v_sale;
  ELSE
    UPDATE public.venue_till_sales
    SET paid_minor = paid_minor + v_counts, version = version + 1, updated_at = v_now
    WHERE id = v_sale.id RETURNING * INTO v_sale;
  END IF;

  IF v_late OR v_sale.paid_minor < v_sale.total_due_minor THEN
    IF v_sale.state = 'paying' AND NOT v_late THEN
      UPDATE public.venue_till_sales SET state = 'open', updated_at = v_now WHERE id = v_sale.id;
    END IF;
    RETURN jsonb_build_object('paymentId', v_payment.id, 'replayed', false, 'salePaid', false, 'paidLate', v_late);
  END IF;

  -- Fully paid: every child becomes final.
  FOR v_line IN
    SELECT l.* FROM public.venue_till_lines l WHERE l.sale_id = v_sale.id AND l.state = 'held' ORDER BY l.created_at, l.id
  LOOP
    IF v_line.kind IN ('entry', 'group_package') THEN
      -- As the gate's cash path: holds become commitments, the booking is
      -- confirmed, today's entry admits the guests.
      SELECT * INTO v_hold FROM public.stay_inventory_holds
      WHERE group_id = v_line.stay_group_id AND state = 'active' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'till_hold_lapsed' USING ERRCODE = 'PT409';
      END IF;
      UPDATE public.stay_reservation_groups SET state = 'finalizing', version = version + 1, updated_at = v_now
      WHERE id = v_line.stay_group_id;
      INSERT INTO public.stay_inventory_commitments (
        group_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
      )
      SELECT v_line.stay_group_id, s.reservation_line_id, s.resource_type, s.offering_id, s.place_window_id, s.quantity
      FROM public.stay_inventory_hold_slices s WHERE s.hold_id = v_hold.id ORDER BY s.id;
      UPDATE public.stay_inventory_holds SET state = 'converted', reason = 'till_paid', version = version + 1,
        updated_at = v_now
      WHERE id = v_hold.id;
      UPDATE public.stay_reservation_lines SET state = 'confirmed', version = version + 1, updated_at = v_now
      WHERE group_id = v_line.stay_group_id AND state = 'payment_pending';
      UPDATE public.stay_reservation_groups SET state = 'confirmed', version = version + 1, updated_at = v_now
      WHERE id = v_line.stay_group_id;
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
      ) VALUES (
        v_line.stay_group_id, 'stay_offer_till_paid', 'staff', v_payment.taken_by_user_id,
        'till-paid:' || v_line.stay_group_id,
        jsonb_build_object('method', v_payment.method, 'amountMinor', v_line.amount_minor::text,
          'currencyCode', v_sale.currency, 'saleId', v_sale.id)
      );
      PERFORM public.issue_4490_record_till_offer_payment(
        v_line.stay_group_id, v_line.amount_minor, v_payment.id, 'till-line:' || v_line.id);
      SELECT id INTO v_pass FROM public.venue_passes WHERE group_id = v_line.stay_group_id;
      IF v_pass IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.venue_passes p
        WHERE p.id = v_pass AND p.valid_local_date = public.issue_4490_venue_local_date(v_sale.venue_id)) THEN
        PERFORM public.issue_4490_admit_pass(v_venue, v_pass, NULL, true, v_payment.taken_by_user_id, 'gate_sale');
      END IF;
    ELSIF v_line.kind = 'balance' THEN
      PERFORM public.issue_4490_record_till_offer_payment(
        v_line.stay_group_id, v_line.amount_minor, v_payment.id, 'till-line:' || v_line.id);
    END IF;
    UPDATE public.venue_till_lines SET state = 'committed', updated_at = v_now WHERE id = v_line.id;
  END LOOP;

  UPDATE public.venue_orders o
  SET payment_status = 'paid', confirmed_at = v_now, updated_at = v_now
  FROM public.venue_till_lines l
  WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.venue_order_id = o.id
    AND l.state = 'committed' AND o.payment_status = 'pending';
  UPDATE public.venue_order_sessions
  SET settlement_method = 'till',
      tab_state = CASE WHEN tab_state IN ('open', 'settling') THEN 'closed' ELSE tab_state END,
      closed_at = CASE WHEN tab_state IN ('open', 'settling') THEN v_now ELSE closed_at END,
      closed_by_user_id = CASE WHEN tab_state IN ('open', 'settling') THEN v_payment.taken_by_user_id
                               ELSE closed_by_user_id END,
      updated_at = v_now
  WHERE id = v_sale.session_id;
  UPDATE public.venue_till_sales
  SET state = 'paid', business_date = v_day, paid_at = v_now, version = version + 1, updated_at = v_now
  WHERE id = v_sale.id;
  RETURN jsonb_build_object('paymentId', v_payment.id, 'replayed', false, 'salePaid', true, 'paidLate', false);
END;
$function$;

-- Cash and the venue's own card machine (O1). Card and scan are O2.
CREATE OR REPLACE FUNCTION public.issue_4490_till_take_payment(
  p_sale_id uuid,
  p_method text,
  p_amount_minor bigint,
  p_tip_minor bigint,
  p_cash_given_minor bigint,
  p_actor uuid,
  p_device_user uuid,
  p_client_request_id uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_existing public.venue_till_payments%ROWTYPE;
  v_settings public.venue_till_settings%ROWTYPE;
  v_remaining bigint;
  v_sc_left bigint;
  v_sc bigint;
  v_tip bigint := COALESCE(p_tip_minor, 0);
  v_payment_id uuid;
  v_result jsonb;
BEGIN
  IF p_method NOT IN ('cash', 'own_machine') OR p_client_request_id IS NULL
     OR p_amount_minor IS NULL OR p_amount_minor <= 0 OR v_tip < 0
     OR (p_method = 'cash' AND (p_cash_given_minor IS NULL OR p_cash_given_minor < p_amount_minor + v_tip))
     OR (p_method <> 'cash' AND p_cash_given_minor IS NOT NULL) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  -- Replay first: a retried tap returns the payment it made.
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    PERFORM public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
    RETURN jsonb_build_object('paymentId', v_existing.id, 'replayed', true,
      'changeMinor', CASE WHEN v_existing.cash_given_minor IS NOT NULL
        THEN v_existing.cash_given_minor - v_existing.amount_minor - v_existing.tip_minor END,
      'sale', public.issue_4490_till_sale_projection(p_sale_id));
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF v_sale.state = 'paying' THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  -- T8: an unsent round is sent before any money moves.
  PERFORM public.issue_4490_till_send(v_sale.id, p_actor);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  v_remaining := v_sale.total_due_minor - v_sale.paid_minor;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'till_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  IF p_amount_minor > v_remaining THEN
    RAISE EXCEPTION 'till_amount_over_due' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('remainingMinor', v_remaining)::text;
  END IF;
  IF p_amount_minor + v_tip > 2147483647 THEN
    RAISE EXCEPTION 'till_payment_too_large' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_settings FROM public.venue_till_settings WHERE venue_id = v_sale.venue_id;
  IF v_tip > 0 AND (COALESCE(v_settings.tips_enabled, true) = false OR v_tip > p_amount_minor) THEN
    RAISE EXCEPTION 'till_tip_invalid' USING ERRCODE = '22023';
  END IF;
  -- Service charge share: pro rata of what is left (half up); the last payment
  -- takes the remainder.
  v_sc_left := v_sale.service_charge_minor - COALESCE((
    SELECT sum(p.service_charge_minor) FROM public.venue_till_payments p
    WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'refunded', 'partially_refunded') AND NOT p.paid_late), 0);
  v_sc_left := GREATEST(v_sc_left, 0);
  v_sc := CASE WHEN p_amount_minor = v_remaining THEN v_sc_left
               ELSE LEAST(floor((v_sc_left::numeric * p_amount_minor) / v_remaining + 0.5)::bigint, p_amount_minor) END;
  INSERT INTO public.venue_till_payments (
    sale_id, method, amount_minor, service_charge_minor, tip_minor, cash_given_minor, state,
    taken_by_user_id, device_user_id, server_user_id, client_request_id
  ) VALUES (
    v_sale.id, p_method, p_amount_minor, v_sc, v_tip, p_cash_given_minor, 'pending',
    p_actor, COALESCE(p_device_user, p_actor), v_sale.server_user_id, p_client_request_id
  ) RETURNING id INTO v_payment_id;
  v_result := public.issue_4490_till_apply_payment(v_payment_id);
  RETURN jsonb_build_object('paymentId', v_payment_id, 'replayed', false,
    'salePaid', COALESCE((v_result->>'salePaid')::boolean, false),
    'changeMinor', CASE WHEN p_method = 'cash' THEN p_cash_given_minor - p_amount_minor - v_tip END,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 15. Refund a cash or own-machine payment (money rights). Tip goes last.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_refund(
  p_payment_id uuid,
  p_amount_minor bigint,
  p_tip_minor bigint,
  p_reason text,
  p_restock boolean,
  p_actor uuid,
  p_device_user uuid,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment public.venue_till_payments%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_existing public.venue_till_refunds%ROWTYPE;
  v_done_amount bigint;
  v_done_tip bigint;
  v_amount bigint := COALESCE(p_amount_minor, 0);
  v_tip bigint := COALESCE(p_tip_minor, 0);
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_refund_id uuid;
  v_all_refunded boolean;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL OR v_amount < 0 OR v_tip < 0 OR v_amount + v_tip = 0
     OR char_length(v_reason) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_payment.sale_id FOR UPDATE;
  IF NOT public.issue_4490_till_enabled(v_sale.venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_manage_money(v_sale.venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM public.venue_till_refunds
  WHERE payment_id = v_payment.id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('refundId', v_existing.id, 'replayed', true,
      'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;
  IF v_payment.method NOT IN ('cash', 'own_machine') THEN
    RAISE EXCEPTION 'till_refund_method_unavailable' USING ERRCODE = 'PT409';
  END IF;
  IF v_payment.state NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'till_payment_not_refundable' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(sum(r.amount_minor), 0), COALESCE(sum(r.tip_minor), 0) INTO v_done_amount, v_done_tip
  FROM public.venue_till_refunds r WHERE r.payment_id = v_payment.id;
  IF v_amount > v_payment.amount_minor - v_done_amount OR v_tip > v_payment.tip_minor - v_done_tip THEN
    RAISE EXCEPTION 'till_refund_over_paid' USING ERRCODE = '22023';
  END IF;
  -- The tip is refunded last: only once the whole amount is back.
  IF v_tip > 0 AND v_done_amount + v_amount < v_payment.amount_minor THEN
    RAISE EXCEPTION 'till_refund_tip_last' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.venue_till_refunds (
    payment_id, amount_minor, tip_minor, method, reason, by_user_id, device_user_id, business_date,
    restocked, client_request_id
  ) VALUES (
    v_payment.id, v_amount, v_tip, v_payment.method, v_reason, p_actor, COALESCE(p_device_user, p_actor),
    public.issue_4490_till_business_date(v_sale.venue_id, now()), false, p_client_request_id
  ) RETURNING id INTO v_refund_id;
  v_all_refunded := v_done_amount + v_amount = v_payment.amount_minor AND v_done_tip + v_tip = v_payment.tip_minor;
  UPDATE public.venue_till_payments
  SET state = CASE WHEN v_all_refunded THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now()
  WHERE id = v_payment.id;
  IF v_sale.state IN ('paid', 'partially_refunded', 'refunded') THEN
    UPDATE public.venue_till_sales
    SET state = CASE WHEN NOT EXISTS (
          SELECT 1 FROM public.venue_till_payments p
          WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'partially_refunded')) THEN 'refunded'
        ELSE 'partially_refunded' END,
        version = version + 1, updated_at = now()
    WHERE id = v_sale.id;
  END IF;
  RETURN jsonb_build_object('refundId', v_refund_id, 'replayed', false,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 16. Open checks (and today's paid ones) for the venue (T21 A1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_checks(p_venue_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_day date;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4490_till_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_sell(p_venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_day := public.issue_4490_till_business_date(p_venue_id, now());
  RETURN jsonb_build_object(
    'businessDate', v_day,
    'open', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', s.id, 'checkLabel', s.check_label,
          'spotLabel', (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id),
          'serverUserId', s.server_user_id, 'state', s.state, 'currency', s.currency,
          'totalDueMinor', s.total_due_minor, 'paidMinor', s.paid_minor, 'createdAt', s.created_at,
          'version', s.version,
          'waitingForPayment', EXISTS (SELECT 1 FROM public.venue_till_payments p
                                       WHERE p.sale_id = s.id AND p.state = 'pending'))
        ORDER BY s.created_at)
      FROM public.venue_till_sales s
      WHERE s.venue_id = p_venue_id AND s.state IN ('open', 'paying')), '[]'::jsonb),
    'paid', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', s.id, 'checkLabel', s.check_label,
          'spotLabel', (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id),
          'serverUserId', s.server_user_id, 'state', s.state, 'currency', s.currency,
          'totalDueMinor', s.total_due_minor, 'paidMinor', s.paid_minor, 'paidAt', s.paid_at)
        ORDER BY s.paid_at DESC)
      FROM public.venue_till_sales s
      WHERE s.venue_id = p_venue_id AND s.business_date = v_day
        AND s.state IN ('paid', 'refunded', 'partially_refunded')), '[]'::jsonb));
END;
$function$;

-- What the Till sells: the venue's active menus (the edge marks which items
-- are orderable right now with the same rule as guest orders), tables, the
-- settings and what the caller may do.
CREATE OR REPLACE FUNCTION public.issue_4490_till_catalog(p_venue_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_till_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_sell(p_venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'brandId', v_venue.brand_id,
    'currency', upper(COALESCE(NULLIF(btrim((SELECT b.default_currency FROM public.brands b
                                             WHERE b.id = v_venue.brand_id)), ''), 'NGN')),
    'serviceChargeBps', COALESCE((SELECT o.service_charge_bps FROM public.venue_ordering_settings o
                                  WHERE o.venue_id = v_venue.id), 0),
    'settings', public.issue_4490_till_settings_projection(v_venue.id),
    'canManageMoney', public.issue_4490_can_manage_money(v_venue.id, p_actor),
    'menus', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'name', m.name,
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'name', i.name, 'description', i.description,
                'priceMinor', i.price_cents, 'currency', i.currency,
                'available', i.is_available AND i.price_cents IS NOT NULL,
                'allowsNotes', i.allows_notes, 'station', i.prep_station,
                'modifierGroups', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                      'id', g.id, 'name', g.name, 'selectionMode', g.selection_mode,
                      'minSelect', g.min_select, 'maxSelect', g.max_select,
                      'modifiers', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', md.id, 'name', md.name, 'priceDeltaMinor', md.price_delta_cents,
                            'available', md.is_available)
                          ORDER BY md.sort_order, md.created_at)
                        FROM public.menu_modifiers md WHERE md.group_id = g.id), '[]'::jsonb))
                    ORDER BY g.sort_order, g.created_at)
                  FROM public.menu_modifier_groups g WHERE g.menu_item_id = i.id AND g.is_active), '[]'::jsonb))
              ORDER BY i.sort_order, i.created_at)
            FROM public.menu_items i WHERE i.menu_id = m.id), '[]'::jsonb))
        ORDER BY m.sort_order, m.created_at)
      FROM public.menus m WHERE m.venue_id = v_venue.id AND m.is_active), '[]'::jsonb),
    'spots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', q.id, 'label', q.label,
          'hasCheck', EXISTS (SELECT 1 FROM public.venue_till_sales s
                              WHERE s.qr_spot_id = q.id AND s.state IN ('open', 'paying')))
        ORDER BY q.sort_order, q.label)
      FROM public.qr_spots q WHERE q.venue_id = v_venue.id AND q.is_active), '[]'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 17. Cutover + T18: every open legacy tab appears in Open checks. An old Host
--     app that opens a tab after this migration gets its check too.
--     [TRANSITIONAL] exit: the legacy tab_open action is removed (#4490).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_adopt_tab()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_id uuid;
BEGIN
  IF NEW.tab_state = 'open' AND NEW.opened_by_user_id IS NOT NULL THEN
    INSERT INTO public.venue_till_sales (
      brand_id, venue_id, session_id, check_label, qr_spot_id, server_user_id, opened_by_user_id,
      opened_business_date, currency, created_at
    ) VALUES (
      NEW.brand_id, NEW.venue_id, NEW.id,
      left((SELECT q.label FROM public.qr_spots q WHERE q.id = NEW.qr_spot_id), 40),
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.venue_till_sales s
                            WHERE s.qr_spot_id = NEW.qr_spot_id AND s.state IN ('open', 'paying'))
           THEN NEW.qr_spot_id END,
      NEW.opened_by_user_id, NEW.opened_by_user_id,
      public.issue_4490_till_business_date(NEW.venue_id, NEW.opened_at), NEW.currency, NEW.opened_at
    )
    ON CONFLICT (session_id) DO NOTHING
    RETURNING id INTO v_sale_id;
    IF v_sale_id IS NOT NULL THEN
      PERFORM public.issue_4490_till_reprice(v_sale_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_till_adopt_tab
  AFTER INSERT OR UPDATE OF tab_state ON public.venue_order_sessions
  FOR EACH ROW WHEN (NEW.tab_state = 'open')
  EXECUTE FUNCTION public.issue_4490_till_adopt_tab();

-- A round an old app adds to an adopted tab reprices its check.
CREATE OR REPLACE FUNCTION public.issue_4490_till_round_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_id uuid;
BEGIN
  IF NEW.till_payment_id IS NULL AND coalesce(NEW.metadata->>'tab_settlement', '') <> 'true' THEN
    SELECT s.id INTO v_sale_id FROM public.venue_till_sales s
    WHERE s.session_id = NEW.session_id AND s.state = 'open';
    IF v_sale_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = NEW.id) THEN
      PERFORM public.issue_4490_till_reprice(v_sale_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_till_round_added
  AFTER INSERT ON public.venue_orders
  FOR EACH ROW WHEN (NEW.source = 'staff' AND NEW.fulfillment_status <> 'held')
  EXECUTE FUNCTION public.issue_4490_till_round_added();

-- The backfill: one check per session with an open tab today.
INSERT INTO public.venue_till_sales (
  brand_id, venue_id, session_id, check_label, qr_spot_id, server_user_id, opened_by_user_id,
  opened_business_date, currency, created_at
)
SELECT
  session.brand_id, session.venue_id, session.id,
  left((SELECT q.label FROM public.qr_spots q WHERE q.id = session.qr_spot_id), 40),
  CASE WHEN row_number() OVER (PARTITION BY session.qr_spot_id ORDER BY session.opened_at DESC) = 1
       THEN session.qr_spot_id END,
  session.opened_by_user_id, session.opened_by_user_id,
  public.issue_4490_till_business_date(session.venue_id, session.opened_at), session.currency, session.opened_at
FROM public.venue_order_sessions session
WHERE session.tab_state = 'open' AND session.opened_by_user_id IS NOT NULL
ON CONFLICT (session_id) DO NOTHING;
SELECT public.issue_4490_till_reprice(s.id) FROM public.venue_till_sales s
WHERE s.state = 'open' AND s.idempotency_key IS NULL;

-- ---------------------------------------------------------------------------
-- 18. Guest list (spec 07 §11 B3): in the reduced window an updated Host app
--     sells in the Till; an older app (Till off) keeps the gate sale.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o1_patch(
  'public.issue_4490_admit_guest_list(uuid,uuid,integer,uuid)'::regprocedure,
  $old$    RETURN jsonb_build_object('result', 'sell', 'kind', 'guest_list',$old$,
  $new$    RETURN jsonb_build_object(
      'result', CASE WHEN public.issue_4490_till_enabled(p_venue_id) THEN 'sell_in_till' ELSE 'sell' END,
      'kind', 'guest_list',$new$
);

-- ---------------------------------------------------------------------------
-- 19. RLS. Reads for anyone who may view the venue; no direct writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_till_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_till_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_till_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_till_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_till_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_till_settings, public.venue_till_sales, public.venue_till_lines,
  public.venue_till_payments, public.venue_till_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_till_settings, public.venue_till_sales, public.venue_till_lines,
  public.venue_till_refunds TO authenticated;
-- Receipt contact and the receipt token hash never reach a client read.
GRANT SELECT (id, sale_id, share_id, method, amount_minor, service_charge_minor, tip_minor, charged_minor,
  cash_given_minor, provider_channel, state, paid_late, carrier_order_id, taken_by_user_id, device_user_id,
  server_user_id, paid_at, business_date, receipt_sends, client_request_id, created_at, updated_at)
  ON public.venue_till_payments TO authenticated;
GRANT ALL ON public.venue_till_settings, public.venue_till_sales, public.venue_till_lines,
  public.venue_till_payments, public.venue_till_refunds TO service_role;

CREATE POLICY "venue till settings venue readers" ON public.venue_till_settings
  FOR SELECT TO authenticated USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue till sales venue readers" ON public.venue_till_sales
  FOR SELECT TO authenticated USING (public.issue_4490_can_view_venue(venue_id));
CREATE POLICY "venue till lines venue readers" ON public.venue_till_lines
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.venue_till_sales s WHERE s.id = venue_till_lines.sale_id
      AND public.issue_4490_can_view_venue(s.venue_id)));
CREATE POLICY "venue till payments venue readers" ON public.venue_till_payments
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.venue_till_sales s WHERE s.id = venue_till_payments.sale_id
      AND public.issue_4490_can_view_venue(s.venue_id)));
CREATE POLICY "venue till refunds venue readers" ON public.venue_till_refunds
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
    WHERE p.id = venue_till_refunds.payment_id AND public.issue_4490_can_view_venue(s.venue_id)));

-- T3: floor staff (sell, kitchen) read their venue's orders; realtime honours it.
ALTER POLICY "venue order modifiers scoped staff can read" ON public."venue_order_item_modifiers"
  USING ((EXISTS ( SELECT 1
   FROM (public.venue_order_items item
     JOIN public.venue_orders order_row ON ((order_row.id = item.venue_order_id)))
  WHERE ((item.id = venue_order_item_modifiers.venue_order_item_id) AND (
    public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'restaurant.view_orders'::text)
    OR public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'restaurant.manage_orders'::text)
    OR public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'venue.kitchen'::text)
    OR public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'venue.sell'::text))))));
ALTER POLICY "venue order items scoped staff can read" ON public."venue_order_items"
  USING ((EXISTS ( SELECT 1
   FROM public.venue_orders order_row
  WHERE ((order_row.id = venue_order_items.venue_order_id) AND (
    public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'restaurant.view_orders'::text)
    OR public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'restaurant.manage_orders'::text)
    OR public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'venue.kitchen'::text)
    OR public.issue_4188_has_venue_capability(order_row.venue_id, ( SELECT auth.uid() AS uid), 'venue.sell'::text))))));
ALTER POLICY "venue order sessions scoped staff can read" ON public."venue_order_sessions"
  USING ((public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'restaurant.view_orders'::text)
    OR public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'restaurant.manage_orders'::text)
    OR public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'venue.kitchen'::text)
    OR public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'venue.sell'::text)));
ALTER POLICY "venue orders scoped staff can read" ON public."venue_orders"
  USING ((public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'restaurant.view_orders'::text)
    OR public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'restaurant.manage_orders'::text)
    OR public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'venue.kitchen'::text)
    OR public.issue_4188_has_venue_capability(venue_id, ( SELECT auth.uid() AS uid), 'venue.sell'::text)));

-- Realtime for the Till (useVenueTill subscribes per venue).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.venue_till_sales;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 20. Grants (every function has an explicit class in the privilege matrix).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_can_sell(uuid, uuid),
  public.issue_4490_can_kitchen(uuid, uuid),
  public.issue_4490_is_till_device(uuid, uuid),
  public.issue_4490_till_business_date(uuid, timestamptz),
  public.issue_4490_till_enabled(uuid),
  public.issue_4490_till_sale_projection(uuid),
  public.issue_4490_till_lock(uuid, uuid, integer),
  public.issue_4490_till_reprice(uuid),
  public.issue_4490_till_settings_set(uuid, jsonb, uuid, bigint),
  public.issue_4490_till_settings_projection(uuid),
  public.issue_4490_till_open(uuid, uuid, uuid, text, uuid, text),
  public.issue_4490_till_relabel(uuid, uuid, text, uuid, integer),
  public.issue_4490_till_set_server(uuid, uuid, uuid, integer),
  public.issue_4490_till_attach_round(uuid, uuid, uuid, integer),
  public.issue_4490_till_add_offer_line(uuid, uuid, uuid, jsonb, uuid, text, uuid, integer),
  public.issue_4490_till_add_balance_line(uuid, uuid, bigint, uuid, text, integer),
  public.issue_4490_till_void(uuid, uuid, uuid, uuid, text, boolean, integer),
  public.issue_4490_till_send(uuid, uuid),
  public.issue_4490_record_till_offer_payment(uuid, bigint, uuid, text),
  public.issue_4490_till_apply_payment(uuid),
  public.issue_4490_till_take_payment(uuid, text, bigint, bigint, bigint, uuid, uuid, uuid, integer),
  public.issue_4490_till_refund(uuid, bigint, bigint, text, boolean, uuid, uuid, uuid),
  public.issue_4490_till_checks(uuid, uuid),
  public.issue_4490_till_catalog(uuid, uuid),
  public.issue_4490_till_adopt_tab(),
  public.issue_4490_till_round_added()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_can_sell(uuid, uuid),
  public.issue_4490_can_kitchen(uuid, uuid),
  public.issue_4490_is_till_device(uuid, uuid),
  public.issue_4490_till_business_date(uuid, timestamptz),
  public.issue_4490_till_enabled(uuid),
  public.issue_4490_till_sale_projection(uuid),
  public.issue_4490_till_lock(uuid, uuid, integer),
  public.issue_4490_till_reprice(uuid),
  public.issue_4490_till_settings_set(uuid, jsonb, uuid, bigint),
  public.issue_4490_till_settings_projection(uuid),
  public.issue_4490_till_open(uuid, uuid, uuid, text, uuid, text),
  public.issue_4490_till_relabel(uuid, uuid, text, uuid, integer),
  public.issue_4490_till_set_server(uuid, uuid, uuid, integer),
  public.issue_4490_till_attach_round(uuid, uuid, uuid, integer),
  public.issue_4490_till_add_offer_line(uuid, uuid, uuid, jsonb, uuid, text, uuid, integer),
  public.issue_4490_till_add_balance_line(uuid, uuid, bigint, uuid, text, integer),
  public.issue_4490_till_void(uuid, uuid, uuid, uuid, text, boolean, integer),
  public.issue_4490_till_send(uuid, uuid),
  public.issue_4490_record_till_offer_payment(uuid, bigint, uuid, text),
  public.issue_4490_till_apply_payment(uuid),
  public.issue_4490_till_take_payment(uuid, text, bigint, bigint, bigint, uuid, uuid, uuid, integer),
  public.issue_4490_till_refund(uuid, bigint, bigint, text, boolean, uuid, uuid, uuid),
  public.issue_4490_till_checks(uuid, uuid),
  public.issue_4490_till_catalog(uuid, uuid)
TO service_role;

COMMIT;
