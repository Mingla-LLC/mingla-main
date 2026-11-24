-- #4490 P6-1 migration (20281203194490) — memberships, monthly.
--
-- A venue sells monthly membership PLANS. A member joins with no account (or
-- signed in), pays the first month at once and then gets an automatic payment
-- EMAIL before each renewal with a link to pay that month: no card is ever
-- charged in the background, nothing renews by itself.
--
-- What this file adds
--   * venue.manage_members (both grant CHECKs, the 4188 helper, the grant
--     writer). Members are managed by brand rank >= event_manager or that
--     capability; money actions (mark a month paid) need money rights.
--   * venue_membership_plans: name, what you get, price a month, entry
--     included (the entry offer whose day limit members count against),
--     meeting-room hours a month (linked to by-the-hour offers), guest passes
--     a month, a member discount on chosen offer kinds, maximum members,
--     minimum months, notice days, grace days, renewal email lead time.
--     Each plan owns one hidden stay_offerings row of kind 'membership': every
--     month's payment is a stay group on it, so payment, finalize, webhooks,
--     refunds and payouts are the existing rail (ruling 7).
--   * venue_membership_subscriptions (the member, a member token stored as
--     SHA-256 only, the pass code hash, status, the paid-through period,
--     pause / leave requests, the plan terms copied at join),
--     venue_membership_periods (one row per month, UNIQUE (member, start)),
--     venue_membership_events (the billing timeline, append-only),
--     venue_credit_ledger (room hours and guest passes: grant, spend, return,
--     expire; credits live inside their month), venue_member_visits (one
--     check-in a day; guests on guest passes). New tables carry no venue_id
--     column and no venue FK: a plan reaches its venue through its offering
--     (the #2099 pending-venue seal is unchanged).
--   * Status: pending (joined, first month not paid) -> active -> payment_due
--     (renewal day reached unpaid; can still check in) -> grace (3 days after,
--     second reminder; can still check in) -> lapsed (grace over: no check-in,
--     no credits; paying the link restores at once) ; paused (member at the
--     period end, or staff now) ; cancelled (left / ended / never paid).
--   * Billing run (service role, edge venue-membership-billing, hourly cron):
--     creates the next month and sends the renewal email N days before,
--     moves due / grace / lapsed by the clock, ends members who left, pauses
--     at the period end, closes never-paid joins after 2 days, expires unused
--     credits. Idempotent: UNIQUE (member, month start) and one email per
--     month and step.
--   * Member benefits at checkout (venue-offers quote with a membership):
--     the member's own entry free and guest passes for their guests (the
--     plan's entry offer), included room hours first on by-the-hour offers
--     (the pro-rata per-minute price applies to the rest), then the plan
--     discount on chosen kinds. Credits are spent when the booking is held
--     and come back if it is cancelled or the hold lapses. A booking that
--     owes nothing is confirmed at once.
--   * Member check-in on the venue's one check-in list (QR
--     mingla:v1:vmember:<id>:sig:<hex> or from the list): one visit a day;
--     a member on a plan with entry included counts against that entry
--     offer's day limit (drawn like a gate sale), guests on guest passes too.
--   * Reads: Host plans list, members list (tiles), member detail (timeline,
--     months, credits, visits); Admin read-only; the public page's
--     memberships block; memberships joins issue_4490_built_features().
--
-- Errors: 22023 bad input, 42501 not allowed, P0002 not found / wrong token,
-- PT409 conflict, P0001 refused by rule, 23505 idempotency conflict.
-- Static SQL (no EXECUTE). Local stack only until Seth says otherwise.
--
-- Reverse (local only): DROP the new tables and functions, drop
-- venue_check_in_log.subscription_id, restore the redefined functions from the
-- migrations named at each, and remove 'venue.manage_members' from the two
-- grant CHECKs (only while no grant holds it).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Capability venue.manage_members (both grant CHECKs).
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_invitation_venue_grants
  DROP CONSTRAINT brand_invitation_venue_capabilities_valid;
ALTER TABLE public.brand_invitation_venue_grants
  ADD CONSTRAINT brand_invitation_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations',
      'venue.manage_offers',
      'venue.manage_bookings',
      'venue.view_bookings',
      'venue.check_in',
      'venue.manage_money',
      'venue.manage_members'
    ]::text[]
  );
ALTER TABLE public.brand_team_member_venue_grants
  DROP CONSTRAINT brand_team_member_venue_capabilities_valid;
ALTER TABLE public.brand_team_member_venue_grants
  ADD CONSTRAINT brand_team_member_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations',
      'venue.manage_offers',
      'venue.manage_bookings',
      'venue.view_bookings',
      'venue.check_in',
      'venue.manage_money',
      'venue.manage_members'
    ]::text[]
  );

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL UNIQUE REFERENCES public.stay_offerings(id) ON DELETE RESTRICT,
  price_option_id uuid NOT NULL REFERENCES public.venue_offer_price_options(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 300),
  inclusions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(inclusions) = 'array' AND jsonb_array_length(inclusions) <= 6
  ),
  price_minor bigint NOT NULL CHECK (price_minor BETWEEN 1 AND 2147483647),
  currency_code character(3) NOT NULL,
  period text NOT NULL DEFAULT 'month' CHECK (period = 'month'),
  entry_included boolean NOT NULL DEFAULT false,
  entry_offering_id uuid REFERENCES public.stay_offerings(id) ON DELETE SET NULL,
  room_hours_per_period numeric(6,2) NOT NULL DEFAULT 0 CHECK (
    room_hours_per_period BETWEEN 0 AND 744 AND room_hours_per_period * 4 = trunc(room_hours_per_period * 4)
  ),
  hour_offering_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(hour_offering_ids) <= 20),
  guest_passes_per_period smallint NOT NULL DEFAULT 0 CHECK (guest_passes_per_period BETWEEN 0 AND 100),
  discount_bps integer NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
  discount_kinds text[] NOT NULL DEFAULT '{}' CHECK (
    discount_kinds <@ ARRAY['entry', 'group_package', 'private_hire', 'by_the_hour']::text[]
  ),
  max_members integer CHECK (max_members IS NULL OR max_members BETWEEN 1 AND 100000),
  min_months smallint NOT NULL DEFAULT 1 CHECK (min_months BETWEEN 1 AND 36),
  notice_days smallint NOT NULL DEFAULT 0 CHECK (notice_days BETWEEN 0 AND 90),
  grace_days smallint NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 30),
  renewal_notice_days smallint NOT NULL DEFAULT 7 CHECK (renewal_notice_days BETWEEN 1 AND 14),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'paused', 'archived')),
  sort_order integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_membership_plans_entry_shape CHECK (NOT entry_included OR entry_offering_id IS NOT NULL)
);
CREATE INDEX venue_membership_plans_brand_idx ON public.venue_membership_plans (brand_id);

CREATE TABLE public.venue_membership_subscriptions (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES public.venue_membership_plans(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  member_name text NOT NULL CHECK (char_length(btrim(member_name)) BETWEEN 1 AND 120),
  member_email text NOT NULL CHECK (
    char_length(member_email) <= 254 AND member_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  member_phone text CHECK (member_phone IS NULL OR member_phone ~ '^\+[1-9][0-9]{6,14}$'),
  member_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(member_token_hash) = 32),
  qr_token_hash text NOT NULL UNIQUE CHECK (qr_token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'active', 'payment_due', 'grace', 'lapsed', 'paused', 'cancelled')
  ),
  pause_reason text CHECK (pause_reason IS NULL OR pause_reason IN ('member', 'staff')),
  paused_since timestamptz,
  pause_at_period_end boolean NOT NULL DEFAULT false,
  pause_requested_by text CHECK (pause_requested_by IS NULL OR pause_requested_by IN ('member', 'staff')),
  start_on date NOT NULL,
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  cancel_requested_by text CHECK (cancel_requested_by IS NULL OR cancel_requested_by IN ('member', 'staff')),
  cancelled_at timestamptz,
  end_reason text CHECK (end_reason IS NULL OR end_reason IN ('left', 'cancelled_by_venue', 'not_paid')),
  terms jsonb NOT NULL CHECK (jsonb_typeof(terms) = 'object'),
  actor_key_hash text NOT NULL CHECK (actor_key_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_key_hash, idempotency_key),
  CONSTRAINT venue_membership_subscriptions_period_shape CHECK (
    (current_period_start IS NULL) = (current_period_end IS NULL)
    AND (current_period_end IS NULL OR current_period_end > current_period_start)
  ),
  CONSTRAINT venue_membership_subscriptions_paid_shape CHECK (
    status IN ('pending', 'cancelled') OR current_period_end IS NOT NULL
  ),
  CONSTRAINT venue_membership_subscriptions_pause_shape CHECK (
    (status = 'paused') = (pause_reason IS NOT NULL)
  ),
  CONSTRAINT venue_membership_subscriptions_end_shape CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL)
  )
);
CREATE INDEX venue_membership_subscriptions_plan_idx ON public.venue_membership_subscriptions (plan_id, status);
CREATE INDEX venue_membership_subscriptions_user_idx ON public.venue_membership_subscriptions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX venue_membership_subscriptions_clock_idx ON public.venue_membership_subscriptions (current_period_end)
  WHERE status IN ('active', 'payment_due', 'grace', 'lapsed', 'paused');

CREATE TABLE public.venue_membership_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.venue_membership_subscriptions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 1),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 2147483647),
  currency_code character(3) NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'link_sent' CHECK (status IN ('scheduled', 'link_sent', 'paid', 'overdue', 'void')),
  group_id uuid REFERENCES public.stay_reservation_groups(id) ON DELETE SET NULL,
  paid_at timestamptz,
  paid_via text CHECK (paid_via IS NULL OR paid_via IN ('online', 'venue')),
  paid_method text CHECK (paid_method IS NULL OR paid_method IN ('cash', 'transfer', 'card_at_venue', 'other')),
  paid_note text CHECK (paid_note IS NULL OR char_length(paid_note) <= 300),
  marked_paid_by uuid,
  reminder_steps text[] NOT NULL DEFAULT '{}',
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_start),
  UNIQUE (subscription_id, sequence),
  CONSTRAINT venue_membership_periods_order CHECK (period_end > period_start),
  CONSTRAINT venue_membership_periods_paid_shape CHECK (
    (status = 'paid') = (paid_at IS NOT NULL) AND (status = 'paid') = (paid_via IS NOT NULL)
  )
);
CREATE INDEX venue_membership_periods_group_idx ON public.venue_membership_periods (group_id) WHERE group_id IS NOT NULL;

CREATE TABLE public.venue_membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.venue_membership_subscriptions(id) ON DELETE CASCADE,
  period_id uuid REFERENCES public.venue_membership_periods(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type ~ '^member_[a-z_]{1,60}$'),
  actor_type text NOT NULL CHECK (actor_type IN ('member', 'staff', 'system')),
  actor_user_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_membership_events_sub_idx ON public.venue_membership_events (subscription_id, created_at);

CREATE TABLE public.venue_member_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.venue_membership_subscriptions(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  pool_id uuid REFERENCES public.venue_capacity_pools(id) ON DELETE SET NULL,
  guests smallint NOT NULL DEFAULT 0 CHECK (guests BETWEEN 0 AND 20),
  log_id uuid REFERENCES public.venue_check_in_log(id) ON DELETE RESTRICT,
  scanner_user_id uuid,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX venue_member_visits_one_a_day ON public.venue_member_visits (subscription_id, local_date)
  WHERE undone_at IS NULL;
CREATE INDEX venue_member_visits_pool_day_idx ON public.venue_member_visits (pool_id, local_date)
  WHERE undone_at IS NULL AND pool_id IS NOT NULL;

CREATE TABLE public.venue_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.venue_membership_subscriptions(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.venue_membership_periods(id) ON DELETE CASCADE,
  credit text NOT NULL CHECK (credit IN ('room_hours', 'guest_passes')),
  entry text NOT NULL CHECK (entry IN ('grant', 'spend', 'return', 'expire')),
  amount numeric(8,2) NOT NULL,
  group_id uuid REFERENCES public.stay_reservation_groups(id) ON DELETE SET NULL,
  visit_id uuid REFERENCES public.venue_member_visits(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_credit_ledger_sign CHECK (
    (entry IN ('grant', 'return') AND amount > 0) OR (entry IN ('spend', 'expire') AND amount < 0)
  ),
  CONSTRAINT venue_credit_ledger_expiry CHECK (expires_at > created_at - interval '400 days')
);
CREATE INDEX venue_credit_ledger_sub_idx ON public.venue_credit_ledger (subscription_id, credit, period_id);
CREATE INDEX venue_credit_ledger_group_idx ON public.venue_credit_ledger (group_id) WHERE group_id IS NOT NULL;

ALTER TABLE public.venue_check_in_log
  ADD COLUMN subscription_id uuid REFERENCES public.venue_membership_subscriptions(id) ON DELETE RESTRICT;
CREATE INDEX venue_check_in_log_subscription_idx ON public.venue_check_in_log (subscription_id)
  WHERE subscription_id IS NOT NULL;

-- Append-only history.
CREATE OR REPLACE FUNCTION public.issue_4490_guard_member_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'member_history_append_only' USING ERRCODE = '55000';
END;
$function$;
CREATE TRIGGER issue_4490_membership_events_append_only
  BEFORE UPDATE OR DELETE ON public.venue_membership_events
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_member_history();
CREATE TRIGGER issue_4490_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.venue_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_member_history();

-- ---------------------------------------------------------------------------
-- 3. Who: venue of a plan / member, readers, managers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_plan_venue(p_plan_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT o.venue_id FROM public.venue_membership_plans p
  JOIN public.stay_offerings o ON o.id = p.offering_id
  WHERE p.id = p_plan_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_member_venue(p_subscription_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT o.venue_id FROM public.venue_membership_subscriptions s
  JOIN public.venue_membership_plans p ON p.id = s.plan_id
  JOIN public.stay_offerings o ON o.id = p.offering_id
  WHERE s.id = p_subscription_id;
$function$;

-- Members' names and contacts: brand members, Mingla admins, and venue staff
-- with venue.manage_members or venue.view_bookings on that venue.
CREATE OR REPLACE FUNCTION public.issue_4490_can_view_members(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND (
        public.biz_is_brand_member_for_read_for_caller(venue.brand_id)
        OR public.is_admin_user()
        OR public.issue_4490_user_has_venue_capability(venue.id, auth.uid(), 'venue.manage_members')
        OR public.issue_4490_user_has_venue_capability(venue.id, auth.uid(), 'venue.view_bookings')
      )
  );
$function$;

-- Plans, pause, cancel, send the link: brand rank >= event_manager or
-- venue.manage_members.
CREATE OR REPLACE FUNCTION public.issue_4490_user_can_manage_members(p_venue_id uuid, p_user_id uuid)
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
        OR public.issue_4490_user_has_venue_capability(venue.id, p_user_id, 'venue.manage_members')
      )
  );
$function$;

-- RLS: readers of members (no direct writes; every write is an RPC).
ALTER TABLE public.venue_membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_membership_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_membership_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_membership_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_member_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_credit_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_membership_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_membership_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_membership_periods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_membership_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_member_visits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_credit_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_membership_plans TO authenticated;
GRANT SELECT ON public.venue_membership_periods TO authenticated;
GRANT SELECT ON public.venue_membership_events TO authenticated;
GRANT SELECT ON public.venue_member_visits TO authenticated;
GRANT SELECT ON public.venue_credit_ledger TO authenticated;
-- Subscriptions: every column but the token and pass hashes.
GRANT SELECT (id, plan_id, brand_id, user_id, member_name, member_email, member_phone, status, pause_reason,
  paused_since, pause_at_period_end, pause_requested_by, start_on, started_at, current_period_start,
  current_period_end, cancel_at, cancel_requested_by, cancelled_at, end_reason, terms, version, created_at,
  updated_at) ON public.venue_membership_subscriptions TO authenticated;
GRANT ALL ON public.venue_membership_plans, public.venue_membership_subscriptions, public.venue_membership_periods,
  public.venue_membership_events, public.venue_member_visits, public.venue_credit_ledger TO service_role;
CREATE POLICY "membership plans readable by venue viewers"
  ON public.venue_membership_plans FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(public.issue_4490_plan_venue(id)));
CREATE POLICY "members readable by member viewers"
  ON public.venue_membership_subscriptions FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_members(public.issue_4490_plan_venue(plan_id)));
CREATE POLICY "member months readable by member viewers"
  ON public.venue_membership_periods FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_members(public.issue_4490_member_venue(subscription_id)));
CREATE POLICY "member events readable by member viewers"
  ON public.venue_membership_events FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_members(public.issue_4490_member_venue(subscription_id)));
CREATE POLICY "member visits readable by member viewers"
  ON public.venue_member_visits FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_members(public.issue_4490_member_venue(subscription_id)));
CREATE POLICY "member credits readable by member viewers"
  ON public.venue_credit_ledger FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_members(public.issue_4490_member_venue(subscription_id)));

-- ---------------------------------------------------------------------------
-- 4. Helpers: the month after, credits left, the open month, events, emails.
-- ---------------------------------------------------------------------------
-- The same local clock time one calendar month later in the venue's zone.
CREATE OR REPLACE FUNCTION public.issue_4490_month_after(p_at timestamptz, p_tz text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT ((p_at AT TIME ZONE p_tz) + interval '1 month') AT TIME ZONE p_tz;
$function$;

-- Credits of one kind left in the paid month that covers p_at.
CREATE OR REPLACE FUNCTION public.issue_4490_member_credit_left(p_subscription_id uuid, p_credit text, p_at timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT GREATEST(COALESCE((
    SELECT sum(l.amount) FROM public.venue_credit_ledger l
    JOIN public.venue_membership_periods p ON p.id = l.period_id
    WHERE l.subscription_id = p_subscription_id AND l.credit = p_credit
      AND p.status = 'paid' AND p_at >= p.period_start AND p_at < p.period_end), 0), 0);
$function$;

-- The paid month that covers p_at (NULL when none).
CREATE OR REPLACE FUNCTION public.issue_4490_member_period_at(p_subscription_id uuid, p_at timestamptz)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id FROM public.venue_membership_periods p
  WHERE p.subscription_id = p_subscription_id AND p.status = 'paid'
    AND p_at >= p.period_start AND p_at < p.period_end
  ORDER BY p.period_start LIMIT 1;
$function$;

-- The month waiting to be paid (the earliest unpaid, not void).
CREATE OR REPLACE FUNCTION public.issue_4490_member_open_period(p_subscription_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id FROM public.venue_membership_periods p
  WHERE p.subscription_id = p_subscription_id AND p.status IN ('scheduled', 'link_sent', 'overdue')
  ORDER BY p.period_start LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_member_event(
  p_subscription_id uuid,
  p_period_id uuid,
  p_type text,
  p_actor_type text,
  p_actor_user uuid,
  p_detail jsonb,
  p_key text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  INSERT INTO public.venue_membership_events (
    subscription_id, period_id, event_type, actor_type, actor_user_id, detail, idempotency_key
  ) VALUES (
    p_subscription_id, p_period_id, p_type, p_actor_type, p_actor_user, COALESCE(p_detail, '{}'::jsonb), p_key
  ) ON CONFLICT (idempotency_key) DO NOTHING;
$function$;

-- A message to the member. Words and ids only: the private member link is
-- built when the email is sent (notify-outbox-drain), never stored.
CREATE OR REPLACE FUNCTION public.issue_4490_member_enqueue(
  p_subscription_id uuid,
  p_period_id uuid,
  p_category text,
  p_step text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_period public.venue_membership_periods%ROWTYPE;
  v_venue record;
  v_tz text;
  v_vat bigint := 0;
BEGIN
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RETURN;
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  IF p_period_id IS NOT NULL THEN
    SELECT * INTO v_period FROM public.venue_membership_periods WHERE id = p_period_id;
  END IF;
  SELECT v.id, v.name, v.slug, b.slug AS brand_slug INTO v_venue
  FROM public.stay_offerings o JOIN public.venue_listings v ON v.id = o.venue_id
  JOIN public.brands b ON b.id = v.brand_id WHERE o.id = v_plan.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  -- VAT added on top (the plan offering's current VAT version), for the
  -- email's money lines.
  IF v_period.id IS NOT NULL THEN
    SELECT COALESCE(sum(round(v_period.amount_minor::numeric * f.basis_points / 10000)::bigint), 0) INTO v_vat
    FROM public.stay_fee_versions f
    WHERE f.offering_id = v_plan.offering_id AND f.effective_to IS NULL AND f.fee_kind = 'tax'
      AND f.calculation = 'percentage_of_line_base' AND f.display_mode <> 'included';
  END IF;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
  ) VALUES (
    p_category, v_sub.user_id, lower(v_sub.member_email), v_sub.brand_id,
    jsonb_strip_nulls(jsonb_build_object(
      'subscription_id', v_sub.id,
      'venue_id', v_venue.id,
      'venue_name', v_venue.name,
      'brand_slug', v_venue.brand_slug,
      'venue_slug', v_venue.slug,
      'member_name', v_sub.member_name,
      'plan_name', v_plan.name,
      'step', p_step,
      'amount_cents', v_period.amount_minor,
      'vat_cents', CASE WHEN v_period.id IS NOT NULL THEN v_vat END,
      'total_cents', CASE WHEN v_period.id IS NOT NULL THEN v_period.amount_minor + v_vat END,
      'currency', COALESCE(v_period.currency_code, v_plan.currency_code),
      'period_start_date', (v_period.period_start AT TIME ZONE v_tz)::date,
      'period_end_date', (v_period.period_end AT TIME ZONE v_tz)::date,
      'renews_on', (v_sub.current_period_end AT TIME ZONE v_tz)::date,
      'paid_through', (v_sub.current_period_end AT TIME ZONE v_tz)::date,
      'grace_ends_on', CASE WHEN v_period.id IS NOT NULL
                            THEN ((v_period.due_at + make_interval(days => COALESCE((v_sub.terms->>'graceDays')::integer, 7)))
                                  AT TIME ZONE v_tz)::date END,
      'ends_on', (v_sub.cancel_at AT TIME ZONE v_tz)::date,
      'first', CASE WHEN v_period.sequence = 1 THEN true END)),
    'venue-member:' || v_sub.id || ':' || COALESCE(p_period_id::text, 'none') || ':' || p_category || ':' || COALESCE(p_step, '-'),
    NULL
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

-- The member's pass code: mingla:v1:vmember:<id>:sig:<hex>.
CREATE OR REPLACE FUNCTION public.issue_4490_member_qr_payload(p_subscription_id uuid, p_qr_hash text, p_pepper text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT 'mingla:v1:vmember:' || p_subscription_id::text || ':sig:' || encode(
    pg_catalog.sha256(convert_to('vmember:' || p_subscription_id::text || ':' || p_qr_hash || ':' || p_pepper, 'UTF8')),
    'hex');
$function$;

-- ---------------------------------------------------------------------------
-- 5. Plans (Host).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_membership_plan_projection(p_plan_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p.id,
    'venueId', o.venue_id,
    'name', p.name,
    'summary', p.summary,
    'inclusions', p.inclusions,
    'priceMinor', p.price_minor,
    'currencyCode', p.currency_code,
    'interval', p.period,
    'entryIncluded', p.entry_included,
    'entryOfferingId', p.entry_offering_id,
    'entryOfferName', (SELECT e.name FROM public.stay_offerings e WHERE e.id = p.entry_offering_id),
    'roomHours', p.room_hours_per_period,
    'hourOfferingIds', to_jsonb(p.hour_offering_ids),
    'hourOfferNames', COALESCE((SELECT jsonb_agg(h.name ORDER BY h.name) FROM public.stay_offerings h
                                WHERE h.id = ANY(p.hour_offering_ids)), '[]'::jsonb),
    'guestPasses', p.guest_passes_per_period,
    'discountBps', p.discount_bps,
    'discountKinds', to_jsonb(p.discount_kinds),
    'maxMembers', p.max_members,
    'minMonths', p.min_months,
    'noticeDays', p.notice_days,
    'graceDays', p.grace_days,
    'renewalNoticeDays', p.renewal_notice_days,
    'status', p.status,
    'sortOrder', p.sort_order,
    'version', p.version,
    'members', (SELECT count(*) FROM public.venue_membership_subscriptions s
                WHERE s.plan_id = p.id AND s.status IN ('active', 'payment_due', 'grace', 'lapsed', 'paused')),
    'activeMembers', (SELECT count(*) FROM public.venue_membership_subscriptions s
                      WHERE s.plan_id = p.id AND s.status IN ('active', 'payment_due', 'grace')),
    'full', p.max_members IS NOT NULL AND (
      SELECT count(*) FROM public.venue_membership_subscriptions s
      WHERE s.plan_id = p.id AND (s.status IN ('active', 'payment_due', 'grace', 'lapsed', 'paused')
                                  OR (s.status = 'pending' AND s.created_at > now() - interval '2 days'))) >= p.max_members,
    'updatedAt', p.updated_at)
  FROM public.venue_membership_plans p
  JOIN public.stay_offerings o ON o.id = p.offering_id
  WHERE p.id = p_plan_id;
$function$;

-- Plan payload checks (create and update share them).
CREATE OR REPLACE FUNCTION public.issue_4490_assert_plan_payload(p_venue_id uuid, p_payload jsonb, p_create boolean)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_int text := '^[0-9]{1,9}$';
BEGIN
  IF jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF (p_create OR p_payload ? 'name') AND char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'plan_name_required' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'summary' AND p_payload->'summary' <> 'null'::jsonb
     AND (jsonb_typeof(p_payload->'summary') <> 'string' OR char_length(p_payload->>'summary') > 300) THEN
    RAISE EXCEPTION 'plan_summary_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'inclusions' AND (
       jsonb_typeof(p_payload->'inclusions') <> 'array' OR jsonb_array_length(p_payload->'inclusions') > 6
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'inclusions') x
                  WHERE jsonb_typeof(x) <> 'string' OR char_length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 80)) THEN
    RAISE EXCEPTION 'plan_inclusions_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_create OR p_payload ? 'priceMinor') AND (
       jsonb_typeof(p_payload->'priceMinor') <> 'number' OR (p_payload->>'priceMinor') !~ '^[0-9]{1,10}$'
       OR (p_payload->>'priceMinor')::bigint NOT BETWEEN 1 AND 2147483647) THEN
    RAISE EXCEPTION 'plan_price_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'entryIncluded' AND jsonb_typeof(p_payload->'entryIncluded') <> 'boolean' THEN
    RAISE EXCEPTION 'plan_entry_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((p_payload->>'entryIncluded')::boolean, false) AND NOT EXISTS (
       SELECT 1 FROM public.stay_offerings o
       WHERE o.id = NULLIF(p_payload->>'entryOfferingId', '')::uuid AND o.venue_id = p_venue_id
         AND o.kind = 'entry' AND o.status <> 'archived') THEN
    RAISE EXCEPTION 'plan_entry_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'roomHours' AND (
       jsonb_typeof(p_payload->'roomHours') <> 'number' OR (p_payload->>'roomHours')::numeric NOT BETWEEN 0 AND 744
       OR (p_payload->>'roomHours')::numeric * 4 <> trunc((p_payload->>'roomHours')::numeric * 4)) THEN
    RAISE EXCEPTION 'plan_room_hours_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'hourOfferingIds' AND (
       jsonb_typeof(p_payload->'hourOfferingIds') <> 'array' OR jsonb_array_length(p_payload->'hourOfferingIds') > 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'hourOfferingIds') x
                  WHERE x !~ '^[0-9a-f-]{36}$' OR NOT EXISTS (
                    SELECT 1 FROM public.stay_offerings o WHERE o.id = x::uuid AND o.venue_id = p_venue_id
                      AND o.kind = 'by_the_hour' AND o.status <> 'archived'))) THEN
    RAISE EXCEPTION 'plan_room_offers_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'guestPasses' AND (COALESCE(p_payload->>'guestPasses', '') !~ '^[0-9]{1,3}$'
       OR (p_payload->>'guestPasses')::integer > 100) THEN
    RAISE EXCEPTION 'plan_guest_passes_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'discountBps' AND (COALESCE(p_payload->>'discountBps', '') !~ '^[0-9]{1,5}$'
       OR (p_payload->>'discountBps')::integer > 10000) THEN
    RAISE EXCEPTION 'plan_discount_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'discountKinds' AND (
       jsonb_typeof(p_payload->'discountKinds') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'discountKinds') k
                  WHERE k NOT IN ('entry', 'group_package', 'private_hire', 'by_the_hour'))) THEN
    RAISE EXCEPTION 'plan_discount_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'maxMembers' AND p_payload->'maxMembers' <> 'null'::jsonb AND (
       COALESCE(p_payload->>'maxMembers', '') !~ '^[0-9]{1,6}$' OR (p_payload->>'maxMembers')::integer NOT BETWEEN 1 AND 100000) THEN
    RAISE EXCEPTION 'plan_max_members_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'minMonths' AND (COALESCE(p_payload->>'minMonths', '') !~ v_int OR (p_payload->>'minMonths')::integer NOT BETWEEN 1 AND 36))
     OR (p_payload ? 'noticeDays' AND (COALESCE(p_payload->>'noticeDays', '') !~ v_int OR (p_payload->>'noticeDays')::integer > 90))
     OR (p_payload ? 'graceDays' AND (COALESCE(p_payload->>'graceDays', '') !~ v_int OR (p_payload->>'graceDays')::integer > 30))
     OR (p_payload ? 'renewalNoticeDays' AND (COALESCE(p_payload->>'renewalNoticeDays', '') !~ v_int
         OR (p_payload->>'renewalNoticeDays')::integer NOT BETWEEN 1 AND 14)) THEN
    RAISE EXCEPTION 'plan_terms_invalid' USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- Host: create / update / publish / pause / archive a plan. Creating a plan
-- makes its hidden 'membership' offering (one "Monthly" price, no refunds,
-- the venue's VAT) and its billing rule; updating the price writes a new
-- price version (members pay the new price from their next month).
CREATE OR REPLACE FUNCTION public.issue_4490_manage_membership_plan(
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
  v_plan public.venue_membership_plans%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_currency text;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_next integer;
  v_amount bigint;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('create', 'update', 'publish', 'pause', 'archive') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND OR NOT public.issue_4490_user_can_manage_members(p_venue_id, v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'venue', p_venue_id, 'payload', COALESCE(p_payload, '{}'::jsonb),
    'version', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('membership_plan:' || p_venue_id, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF v_venue.venue_category = 'stay' THEN
    RAISE EXCEPTION 'offer_not_on_stay_venue' USING ERRCODE = 'P0001';
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_venue.brand_id;
  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);

  IF p_action = 'create' THEN
    PERFORM public.issue_4490_assert_plan_payload(p_venue_id, COALESCE(p_payload, '{}'::jsonb), true);
    INSERT INTO public.stay_offerings (
      venue_id, brand_id, kind, name, summary, description, status, confirmation_mode,
      inventory_basis, unit_naming_mode, capacity, min_guests, max_guests,
      place_pricing_basis, access_scope, sort_order, created_by, updated_by
    ) VALUES (
      p_venue_id, v_venue.brand_id, 'membership', btrim(p_payload->>'name'), '', '',
      'draft', 'instant', 'shared_capacity', 'interchangeable', 100000, 1, 1,
      'per_booking', 'public', 0, v_uid, v_uid
    ) RETURNING * INTO v_offer;
    INSERT INTO public.venue_offer_price_options (
      offering_id, venue_id, brand_id, name, unit, guest_min, guest_max, weekdays, sort_order, updated_by
    ) VALUES (
      v_offer.id, p_venue_id, v_venue.brand_id, 'Monthly', 'booking', 1, 1, '{0,1,2,3,4,5,6}'::smallint[], 0, v_uid
    ) RETURNING * INTO v_option;
    INSERT INTO public.stay_price_versions (
      offering_id, brand_id, venue_id, version_number, amount_minor, currency_code,
      pricing_unit, price_option_id, created_by
    ) VALUES (
      v_offer.id, v_offer.brand_id, p_venue_id, 1, (p_payload->>'priceMinor')::bigint, v_currency,
      public.issue_4490_option_pricing_unit('booking'), v_option.id, v_uid
    );
    INSERT INTO public.stay_policy_versions (
      offering_id, brand_id, venue_id, version_number, cancellation_policy,
      free_cancel_cutoff_minutes, late_refund_basis_points, no_show_refund_basis_points,
      operator_cancel_refund_basis_points, refund_ladder, date_change_rule, created_by
    ) VALUES (
      v_offer.id, v_offer.brand_id, p_venue_id, 1,
      'A paid month is not refunded. Leave any time; your membership ends at the end of the month you paid for.',
      0, 0, 0, 0, '[]'::jsonb, '{}'::jsonb, v_uid
    );
    -- The billing rule (never materialised: each month gets its own window).
    INSERT INTO public.stay_place_schedule_rules (
      offering_id, brand_id, venue_id, mode, timezone, local_start_date, weekdays,
      local_start_time, local_end_time, active, created_by, updated_by
    ) VALUES (
      v_offer.id, v_offer.brand_id, p_venue_id, 'flexible', v_settings.timezone,
      (now() AT TIME ZONE v_settings.timezone)::date, '{0,1,2,3,4,5,6}'::smallint[],
      '00:00'::time, '23:59'::time, false, v_uid, v_uid
    );
    PERFORM public.issue_4490_sync_offer_vat(v_offer.id);
    INSERT INTO public.venue_membership_plans (
      offering_id, price_option_id, brand_id, name, summary, inclusions, price_minor, currency_code,
      entry_included, entry_offering_id, room_hours_per_period, hour_offering_ids, guest_passes_per_period,
      discount_bps, discount_kinds, max_members, min_months, notice_days, grace_days, renewal_notice_days,
      sort_order, created_by, updated_by
    ) VALUES (
      v_offer.id, v_option.id, v_venue.brand_id, btrim(p_payload->>'name'),
      NULLIF(btrim(COALESCE(p_payload->>'summary', '')), ''),
      COALESCE((SELECT jsonb_agg(btrim(x #>> '{}')) FROM jsonb_array_elements(p_payload->'inclusions') x), '[]'::jsonb),
      (p_payload->>'priceMinor')::bigint, v_currency,
      COALESCE((p_payload->>'entryIncluded')::boolean, false),
      CASE WHEN COALESCE((p_payload->>'entryIncluded')::boolean, false) THEN (p_payload->>'entryOfferingId')::uuid END,
      COALESCE((p_payload->>'roomHours')::numeric, 0),
      COALESCE((SELECT array_agg(DISTINCT x::uuid) FROM jsonb_array_elements_text(p_payload->'hourOfferingIds') x), '{}'),
      COALESCE((p_payload->>'guestPasses')::smallint, 0),
      COALESCE((p_payload->>'discountBps')::integer, 0),
      COALESCE((SELECT array_agg(DISTINCT k) FROM jsonb_array_elements_text(p_payload->'discountKinds') k), '{}'),
      NULLIF(p_payload->>'maxMembers', '')::integer,
      COALESCE((p_payload->>'minMonths')::smallint, 1),
      COALESCE((p_payload->>'noticeDays')::smallint, 0),
      COALESCE((p_payload->>'graceDays')::smallint, 7),
      COALESCE((p_payload->>'renewalNoticeDays')::smallint, 7),
      COALESCE((p_payload->>'sortOrder')::integer, 0), v_uid, v_uid
    ) RETURNING * INTO v_plan;
  ELSE
    SELECT p.* INTO v_plan FROM public.venue_membership_plans p
    JOIN public.stay_offerings o ON o.id = p.offering_id AND o.venue_id = p_venue_id
    WHERE p.id = NULLIF(p_payload->>'planId', '')::uuid
    FOR UPDATE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NULL OR v_plan.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
    IF v_plan.status = 'archived' THEN
      RAISE EXCEPTION 'plan_archived' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_plan.offering_id FOR UPDATE;
  END IF;

  IF p_action = 'update' THEN
    PERFORM public.issue_4490_assert_plan_payload(p_venue_id, p_payload, false);
    UPDATE public.venue_membership_plans p
    SET name = COALESCE(NULLIF(btrim(p_payload->>'name'), ''), p.name),
        summary = CASE WHEN p_payload ? 'summary' THEN NULLIF(btrim(COALESCE(p_payload->>'summary', '')), '') ELSE p.summary END,
        inclusions = CASE WHEN p_payload ? 'inclusions'
                          THEN COALESCE((SELECT jsonb_agg(btrim(x #>> '{}')) FROM jsonb_array_elements(p_payload->'inclusions') x), '[]'::jsonb)
                          ELSE p.inclusions END,
        price_minor = COALESCE((p_payload->>'priceMinor')::bigint, p.price_minor),
        entry_included = COALESCE((p_payload->>'entryIncluded')::boolean, p.entry_included),
        entry_offering_id = CASE WHEN p_payload ? 'entryIncluded'
                                 THEN CASE WHEN (p_payload->>'entryIncluded')::boolean THEN (p_payload->>'entryOfferingId')::uuid END
                                 ELSE p.entry_offering_id END,
        room_hours_per_period = COALESCE((p_payload->>'roomHours')::numeric, p.room_hours_per_period),
        hour_offering_ids = CASE WHEN p_payload ? 'hourOfferingIds'
                                 THEN COALESCE((SELECT array_agg(DISTINCT x::uuid) FROM jsonb_array_elements_text(p_payload->'hourOfferingIds') x), '{}')
                                 ELSE p.hour_offering_ids END,
        guest_passes_per_period = COALESCE((p_payload->>'guestPasses')::smallint, p.guest_passes_per_period),
        discount_bps = COALESCE((p_payload->>'discountBps')::integer, p.discount_bps),
        discount_kinds = CASE WHEN p_payload ? 'discountKinds'
                              THEN COALESCE((SELECT array_agg(DISTINCT k) FROM jsonb_array_elements_text(p_payload->'discountKinds') k), '{}')
                              ELSE p.discount_kinds END,
        max_members = CASE WHEN p_payload ? 'maxMembers' THEN NULLIF(p_payload->>'maxMembers', '')::integer ELSE p.max_members END,
        min_months = COALESCE((p_payload->>'minMonths')::smallint, p.min_months),
        notice_days = COALESCE((p_payload->>'noticeDays')::smallint, p.notice_days),
        grace_days = COALESCE((p_payload->>'graceDays')::smallint, p.grace_days),
        renewal_notice_days = COALESCE((p_payload->>'renewalNoticeDays')::smallint, p.renewal_notice_days),
        sort_order = COALESCE((p_payload->>'sortOrder')::integer, p.sort_order),
        version = p.version + 1, updated_at = now(), updated_by = v_uid
    WHERE p.id = v_plan.id
    RETURNING * INTO v_plan;
    UPDATE public.stay_offerings SET name = v_plan.name, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id;
    SELECT * INTO v_price FROM public.stay_price_versions
    WHERE offering_id = v_offer.id AND price_option_id = v_plan.price_option_id AND effective_to IS NULL FOR UPDATE;
    v_amount := v_plan.price_minor;
    IF NOT FOUND OR v_price.amount_minor <> v_amount OR v_price.currency_code <> v_currency THEN
      IF FOUND THEN
        UPDATE public.stay_price_versions SET effective_to = now() WHERE id = v_price.id;
      END IF;
      SELECT COALESCE(max(version_number), 0) + 1 INTO v_next FROM public.stay_price_versions WHERE offering_id = v_offer.id;
      INSERT INTO public.stay_price_versions (
        offering_id, brand_id, venue_id, version_number, amount_minor, currency_code,
        pricing_unit, price_option_id, supersedes_version_id, created_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, p_venue_id, v_next, v_amount, v_currency,
        public.issue_4490_option_pricing_unit('booking'), v_plan.price_option_id,
        CASE WHEN v_price.id IS NULL THEN NULL ELSE v_price.id END, v_uid
      );
    END IF;
    PERFORM public.issue_4490_sync_offer_vat(v_offer.id);
  ELSIF p_action = 'publish' THEN
    IF NOT public.issue_4490_venue_feature_on(p_venue_id, 'memberships') THEN
      RAISE EXCEPTION 'offer_not_ready:feature_off' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
      RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.issue_4490_sync_offer_vat(v_offer.id);
    UPDATE public.stay_offerings SET status = 'live', version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id AND status <> 'live';
    UPDATE public.venue_membership_plans SET status = 'live', version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_plan.id RETURNING * INTO v_plan;
  ELSIF p_action = 'pause' THEN
    -- Paused: no new members; members already in keep renewing.
    UPDATE public.venue_membership_plans SET status = 'paused', version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_plan.id RETURNING * INTO v_plan;
  ELSIF p_action = 'archive' THEN
    IF EXISTS (SELECT 1 FROM public.venue_membership_subscriptions s
               WHERE s.plan_id = v_plan.id AND s.status NOT IN ('cancelled')) THEN
      RAISE EXCEPTION 'plan_has_members' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_membership_plans SET status = 'archived', version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_plan.id RETURNING * INTO v_plan;
    UPDATE public.stay_offerings SET status = 'archived', archived_at = now(), version = version + 1, updated_at = now()
    WHERE id = v_offer.id;
  END IF;

  v_result := public.issue_4490_membership_plan_projection(v_plan.id) || jsonb_build_object('replayed', false);
  PERFORM public.issue_4490_receipt_store('membership_plan:' || p_venue_id, p_idempotency_key, v_hash, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_membership_plans(p_venue_id uuid)
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
    'featureOn', public.issue_4490_venue_feature_on(p_venue_id, 'memberships'),
    'canManage', public.issue_4490_user_can_manage_members(p_venue_id, auth.uid()),
    'entryOffers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.sort_order, o.created_at)
                             FROM public.stay_offerings o WHERE o.venue_id = p_venue_id AND o.kind = 'entry'
                               AND o.status <> 'archived'), '[]'::jsonb),
    'hourOffers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.sort_order, o.created_at)
                            FROM public.stay_offerings o WHERE o.venue_id = p_venue_id AND o.kind = 'by_the_hour'
                              AND o.status <> 'archived'), '[]'::jsonb),
    'plans', COALESCE((SELECT jsonb_agg(public.issue_4490_membership_plan_projection(p.id) ORDER BY p.sort_order, p.created_at)
                       FROM public.venue_membership_plans p JOIN public.stay_offerings o ON o.id = p.offering_id
                       WHERE o.venue_id = p_venue_id AND p.status <> 'archived'), '[]'::jsonb));
END;
$function$;

-- The guest's view of live plans (public page; anon through pg_public_venue_page).
CREATE OR REPLACE FUNCTION public.issue_4490_public_memberships(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') OR NOT ('memberships' = ANY(p_features)) THEN NULL
    ELSE (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
        'fromMinor', min(p.price_minor),
        'interval', 'month',
        'currencyCode', min(p.currency_code),
        'plans', jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.name, 'summary', p.summary, 'inclusions', p.inclusions,
          'priceMinor', p.price_minor, 'interval', p.period,
          'entryIncluded', p.entry_included, 'roomHours', p.room_hours_per_period,
          'guestPasses', p.guest_passes_per_period, 'discountBps', p.discount_bps,
          'discountKinds', to_jsonb(p.discount_kinds),
          'minMonths', p.min_months, 'noticeDays', p.notice_days, 'graceDays', p.grace_days,
          'renewalNoticeDays', p.renewal_notice_days,
          'full', (public.issue_4490_membership_plan_projection(p.id)->>'full')::boolean)
          ORDER BY p.sort_order, p.created_at)) END
      FROM public.venue_membership_plans p
      JOIN public.stay_offerings o ON o.id = p.offering_id
      WHERE o.venue_id = p_venue_id AND p.status = 'live')
    END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The member (projection, access rule).
-- ---------------------------------------------------------------------------
-- A member record opens only with its own member token or for its own
-- signed-in member (the booking-access rule; two-valued).
CREATE OR REPLACE FUNCTION public.issue_4490_member_actor_ok(
  p_sub public.venue_membership_subscriptions,
  p_token_hash bytea,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    p_sub.id IS NOT NULL AND (
      (p_token_hash IS NOT NULL AND p_sub.member_token_hash = p_token_hash)
      OR (p_user_id IS NOT NULL AND p_sub.user_id IS NOT NULL AND p_sub.user_id = p_user_id)
    ),
    false);
$function$;

-- Member read. p_view 'guest' (the member: pass code when a pepper is
-- given) or 'host' (+ timeline, months, credits, visits, contact).
CREATE OR REPLACE FUNCTION public.issue_4490_member_projection(p_subscription_id uuid, p_view text, p_qr_pepper text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_venue record;
  v_tz text;
  v_open public.venue_membership_periods%ROWTYPE;
  v_today date;
  v_result jsonb;
  v_can_enter boolean;
BEGIN
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  SELECT v.id, v.name, v.slug, b.slug AS brand_slug, b.name AS brand_name INTO v_venue
  FROM public.stay_offerings o JOIN public.venue_listings v ON v.id = o.venue_id
  JOIN public.brands b ON b.id = v.brand_id WHERE o.id = v_plan.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT * INTO v_open FROM public.venue_membership_periods
  WHERE id = public.issue_4490_member_open_period(v_sub.id);
  v_can_enter := v_sub.status IN ('active', 'payment_due', 'grace') AND v_sub.start_on <= v_today;
  v_result := jsonb_build_object(
    'subscriptionId', v_sub.id,
    'status', v_sub.status,
    'memberName', v_sub.member_name,
    'plan', jsonb_build_object(
      'id', v_plan.id, 'name', v_plan.name, 'priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'interval', v_plan.period, 'inclusions', v_plan.inclusions, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps, 'discountKinds', to_jsonb(v_plan.discount_kinds),
      'hourOfferingIds', to_jsonb(v_plan.hour_offering_ids), 'entryOfferingId', v_plan.entry_offering_id),
    'terms', v_sub.terms,
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'slug', v_venue.slug,
      'brandSlug', v_venue.brand_slug, 'brandName', v_venue.brand_name, 'timezone', v_tz),
    'startOn', v_sub.start_on,
    'startedAt', v_sub.started_at,
    'activeUntil', v_sub.current_period_end,
    'currentPeriod', CASE WHEN v_sub.current_period_start IS NULL THEN NULL ELSE jsonb_build_object(
      'start', v_sub.current_period_start, 'end', v_sub.current_period_end) END,
    'renewsOn', CASE WHEN v_sub.status IN ('active', 'payment_due', 'grace', 'lapsed')
                      AND NOT v_sub.pause_at_period_end
                      AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                     THEN v_sub.current_period_end END,
    'renewalEmailOn', CASE WHEN v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end
                            AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                           THEN v_sub.current_period_end - make_interval(days => v_plan.renewal_notice_days) END,
    'canCheckIn', v_can_enter,
    'paymentDue', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'periodId', v_open.id, 'amountMinor', v_open.amount_minor, 'currencyCode', v_open.currency_code,
      'periodStart', v_open.period_start, 'periodEnd', v_open.period_end, 'dueAt', v_open.due_at,
      'status', v_open.status, 'graceEndsAt', v_open.due_at + make_interval(days => COALESCE((v_sub.terms->>'graceDays')::integer, 7)),
      'paying', EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = v_open.group_id
                        AND a.state IN ('pending', 'ambiguous'))) END,
    'leaving', CASE WHEN v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled'
                    THEN jsonb_build_object('endsAt', v_sub.cancel_at, 'by', v_sub.cancel_requested_by) END,
    'pausing', CASE WHEN v_sub.pause_at_period_end THEN jsonb_build_object('from', v_sub.current_period_end,
                    'by', v_sub.pause_requested_by) END,
    'paused', CASE WHEN v_sub.status = 'paused' THEN jsonb_build_object('since', v_sub.paused_since, 'by', v_sub.pause_reason) END,
    'endedAt', v_sub.cancelled_at,
    'endReason', v_sub.end_reason,
    'credits', jsonb_build_object(
      'roomHoursLeft', public.issue_4490_member_credit_left(v_sub.id, 'room_hours', now()),
      'roomHoursPerMonth', v_plan.room_hours_per_period,
      'guestPassesLeft', public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', now()),
      'guestPassesPerMonth', v_plan.guest_passes_per_period),
    'inToday', EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = v_sub.id
                       AND x.local_date = v_today AND x.undone_at IS NULL),
    'canLeave', v_sub.status IN ('pending', 'active', 'payment_due', 'grace', 'lapsed', 'paused') AND v_sub.cancel_at IS NULL,
    'canStay', v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled' AND v_sub.cancel_requested_by = 'member',
    'canPause', v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end AND v_sub.cancel_at IS NULL,
    'canResume', v_sub.status = 'paused' OR v_sub.pause_at_period_end,
    'memberPath', '/visit/plan/' || v_sub.id,
    'version', v_sub.version,
    'createdAt', v_sub.created_at);
  IF p_view = 'guest' AND p_qr_pepper IS NOT NULL AND v_sub.status <> 'cancelled' THEN
    v_result := v_result || jsonb_build_object('pass', jsonb_build_object(
      'qrPayload', public.issue_4490_member_qr_payload(v_sub.id, v_sub.qr_token_hash, p_qr_pepper),
      'valid', v_can_enter));
  END IF;
  IF p_view = 'host' THEN
    v_result := v_result || jsonb_build_object(
      'email', v_sub.member_email,
      'phone', v_sub.member_phone,
      'signedIn', v_sub.user_id IS NOT NULL,
      'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'periodId', p.id, 'sequence', p.sequence, 'start', p.period_start, 'end', p.period_end,
          'amountMinor', p.amount_minor, 'currencyCode', p.currency_code, 'dueAt', p.due_at, 'status', p.status,
          'paidAt', p.paid_at, 'paidVia', p.paid_via, 'paidMethod', p.paid_method, 'remindersSent', to_jsonb(p.reminder_steps))
          ORDER BY p.period_start DESC)
        FROM public.venue_membership_periods p WHERE p.subscription_id = v_sub.id), '[]'::jsonb),
      'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'type', e.event_type, 'by', e.actor_type, 'at', e.created_at, 'periodId', e.period_id, 'detail', e.detail)
          ORDER BY e.created_at, e.id)
        FROM public.venue_membership_events e WHERE e.subscription_id = v_sub.id), '[]'::jsonb),
      'visits', COALESCE((SELECT jsonb_agg(jsonb_build_object('localDate', x.local_date, 'guests', x.guests,
          'at', x.created_at, 'undone', x.undone_at IS NOT NULL) ORDER BY x.created_at DESC)
        FROM (SELECT * FROM public.venue_member_visits WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 20) x),
        '[]'::jsonb),
      'credits', (v_result->'credits') || jsonb_build_object(
        'ledger', COALESCE((SELECT jsonb_agg(jsonb_build_object('credit', l.credit, 'entry', l.entry, 'amount', l.amount,
            'at', l.created_at, 'groupId', l.group_id) ORDER BY l.created_at DESC)
          FROM (SELECT * FROM public.venue_credit_ledger WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 40) l),
          '[]'::jsonb)),
      'canManage', public.issue_4490_user_can_manage_members(v_venue.id, auth.uid()),
      'canManageMoney', public.issue_4490_can_manage_money(v_venue.id, auth.uid()));
  END IF;
  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Join (edge venue-offers, service role). The edge makes the member id,
--    derives the member token from it and passes only its SHA-256. The
--    first month is created now; it is paid through
--    venue-membership-pay-link. A replay (same actor + key) returns the
--    first member.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_membership_join(
  p_subscription_id uuid,
  p_plan_id uuid,
  p_member jsonb,
  p_start_on date,
  p_actor_key text,
  p_user_id uuid,
  p_member_token_hash bytea,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_plan public.venue_membership_plans%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_existing public.venue_membership_subscriptions%ROWTYPE;
  v_hash text;
  v_tz text;
  v_today date;
  v_start date;
  v_start_at timestamptz;
  v_count integer;
  v_period uuid;
  v_email text;
  v_phone text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_subscription_id IS NULL OR p_plan_id IS NULL OR jsonb_typeof(p_member) IS DISTINCT FROM 'object'
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR p_member_token_hash IS NULL OR octet_length(p_member_token_hash) <> 32
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'membership_invalid' USING ERRCODE = '22023';
  END IF;
  v_email := lower(btrim(COALESCE(p_member->>'email', '')));
  v_phone := NULLIF(btrim(COALESCE(p_member->>'phone', '')), '');
  IF char_length(btrim(COALESCE(p_member->>'name', ''))) NOT BETWEEN 1 AND 120
     OR char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR (v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{6,14}$') THEN
    RAISE EXCEPTION 'membership_member_invalid' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'plan', p_plan_id, 'member', jsonb_build_object('name', btrim(p_member->>'name'), 'email', v_email, 'phone', v_phone),
    'startOn', p_start_on)::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':member-join:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.venue_membership_subscriptions
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_4490_member_projection(v_existing.id, 'guest', NULL) || jsonb_build_object('replayed', true);
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = p_plan_id FOR UPDATE;
  SELECT o.* INTO v_offer FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  WHERE o.id = v_plan.offering_id;
  IF v_plan.id IS NULL OR v_offer.id IS NULL OR v_plan.status <> 'live'
     OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, 'memberships') THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_plan.max_members IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.venue_membership_subscriptions s
    WHERE s.plan_id = v_plan.id AND (s.status IN ('active', 'payment_due', 'grace', 'lapsed', 'paused')
                                     OR (s.status = 'pending' AND s.created_at > now() - interval '2 days'));
    IF v_count >= v_plan.max_members THEN
      RAISE EXCEPTION 'plan_full' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  IF p_user_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.venue_membership_subscriptions s
       WHERE s.plan_id = v_plan.id AND s.user_id = p_user_id AND s.status IN ('active', 'payment_due', 'grace', 'paused')) THEN
    RAISE EXCEPTION 'membership_already_member' USING ERRCODE = 'PT409';
  END IF;
  IF NOT public.pg_brand_can_collect(v_plan.brand_id) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  v_tz := public.issue_4490_venue_timezone(v_offer.venue_id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_start := COALESCE(p_start_on, v_today);
  IF v_start < v_today OR v_start > v_today + 60 THEN
    RAISE EXCEPTION 'membership_start_invalid' USING ERRCODE = '22023';
  END IF;
  v_start_at := v_start::timestamp AT TIME ZONE v_tz;
  INSERT INTO public.venue_membership_subscriptions (
    id, plan_id, brand_id, user_id, member_name, member_email, member_phone, member_token_hash, qr_token_hash,
    status, start_on, terms, actor_key_hash, idempotency_key, request_hash
  ) VALUES (
    p_subscription_id, v_plan.id, v_plan.brand_id, p_user_id, btrim(p_member->>'name'), v_email, v_phone,
    p_member_token_hash, encode(pg_catalog.sha256(extensions.gen_random_bytes(32)), 'hex'),
    'pending', v_start,
    jsonb_build_object('priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'minMonths', v_plan.min_months, 'noticeDays', v_plan.notice_days, 'graceDays', v_plan.grace_days,
      'renewalNoticeDays', v_plan.renewal_notice_days, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps),
    p_actor_key, btrim(p_idempotency_key), v_hash
  );
  INSERT INTO public.venue_membership_periods (
    subscription_id, sequence, period_start, period_end, amount_minor, currency_code, due_at, status
  ) VALUES (
    p_subscription_id, 1, v_start_at, public.issue_4490_month_after(v_start_at, v_tz),
    v_plan.price_minor, v_plan.currency_code, now(), 'link_sent'
  ) RETURNING id INTO v_period;
  PERFORM public.issue_4490_member_event(p_subscription_id, v_period, 'member_joined', 'member', p_user_id,
    jsonb_build_object('plan', v_plan.name, 'startOn', v_start), 'join:' || p_subscription_id);
  RETURN public.issue_4490_member_projection(p_subscription_id, 'guest', NULL) || jsonb_build_object('replayed', false);
END;
$function$;

-- Member read for the member (token or own signed-in member).
CREATE OR REPLACE FUNCTION public.issue_4490_membership_get(
  p_subscription_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_qr_pepper text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND OR NOT public.issue_4490_member_actor_ok(v_sub, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_4490_member_projection(v_sub.id, 'guest', p_qr_pepper);
END;
$function$;

-- Signed-in member: their memberships.
CREATE OR REPLACE FUNCTION public.issue_4490_my_memberships()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(public.issue_4490_member_projection(s.id, 'guest', NULL) ORDER BY s.created_at DESC)
                   FROM public.venue_membership_subscriptions s WHERE s.user_id = auth.uid()), '[]'::jsonb);
END;
$function$;

-- When a member who leaves is free to go: the first month end on or after
-- the later of (now + notice) and (first paid month + minimum months).
CREATE OR REPLACE FUNCTION public.issue_4490_member_leave_at(p_subscription_id uuid, p_honour_terms boolean)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_tz text;
  v_floor timestamptz;
  v_end timestamptz;
  v_i integer := 0;
BEGIN
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF v_sub.current_period_end IS NULL THEN
    RETURN now();
  END IF;
  v_tz := public.issue_4490_venue_timezone(public.issue_4490_member_venue(v_sub.id));
  v_floor := now();
  IF p_honour_terms THEN
    v_floor := GREATEST(now() + make_interval(days => COALESCE((v_sub.terms->>'noticeDays')::integer, 0)),
      (SELECT min(p.period_start) FROM public.venue_membership_periods p
       WHERE p.subscription_id = v_sub.id AND p.status = 'paid')
      + make_interval(months => COALESCE((v_sub.terms->>'minMonths')::integer, 1)));
  END IF;
  v_end := v_sub.current_period_end;
  WHILE v_end < v_floor AND v_i < 48 LOOP
    v_end := public.issue_4490_month_after(v_end, v_tz);
    v_i := v_i + 1;
  END LOOP;
  RETURN v_end;
END;
$function$;

-- Member actions (edge venue-offers): leave (ends at the end of a paid month,
-- the plan's notice and minimum months applied), stay (undo leaving),
-- pause (from the end of the paid month), resume (undo pausing, or start
-- again: a new month to pay from today).
CREATE OR REPLACE FUNCTION public.issue_4490_membership_member_action(
  p_subscription_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_action text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('leave', 'stay', 'pause', 'resume')
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'membership_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_member_actor_ok(v_sub, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_membership_events e
             WHERE e.idempotency_key = 'member-action:' || v_sub.id || ':' || btrim(p_idempotency_key)) THEN
    RETURN public.issue_4490_member_projection(v_sub.id, 'guest', NULL) || jsonb_build_object('replayed', true);
  END IF;
  RETURN public.issue_4490_member_change(v_sub.id, p_action, 'member', p_user_id, '{}'::jsonb,
    'member-action:' || v_sub.id || ':' || btrim(p_idempotency_key), 'guest');
END;
$function$;

-- Shared by the member and the staff: the change itself.
CREATE OR REPLACE FUNCTION public.issue_4490_member_change(
  p_subscription_id uuid,
  p_action text,
  p_by text,
  p_user_id uuid,
  p_payload jsonb,
  p_event_key text,
  p_view text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_tz text;
  v_start timestamptz;
  v_seq integer;
  v_period uuid;
  v_now_mode boolean := COALESCE(p_payload->>'when', 'period_end') = 'now';
BEGIN
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  v_tz := public.issue_4490_venue_timezone(public.issue_4490_member_venue(v_sub.id));
  IF v_sub.status = 'cancelled' THEN
    RAISE EXCEPTION 'membership_ended' USING ERRCODE = 'PT409';
  END IF;

  IF p_action = 'leave' THEN
    IF v_sub.cancel_at IS NOT NULL THEN
      RAISE EXCEPTION 'membership_already_leaving' USING ERRCODE = 'PT409';
    END IF;
    IF v_sub.status = 'pending' OR (p_by = 'staff' AND v_now_mode) THEN
      -- Never paid, or the venue ends it now: ended at once.
      UPDATE public.venue_membership_subscriptions
      SET status = 'cancelled', cancelled_at = now(), cancel_at = now(), cancel_requested_by = p_by,
          end_reason = CASE WHEN p_by = 'staff' THEN 'cancelled_by_venue' ELSE 'left' END,
          pause_reason = NULL, pause_at_period_end = false, version = version + 1, updated_at = now()
      WHERE id = v_sub.id;
      UPDATE public.venue_membership_periods SET status = 'void', version = version + 1, updated_at = now()
      WHERE subscription_id = v_sub.id AND status IN ('scheduled', 'link_sent', 'overdue');
      PERFORM public.issue_4490_member_event(v_sub.id, NULL, 'member_ended', p_by, p_user_id,
        jsonb_build_object('reason', COALESCE(p_payload->>'reason', NULL), 'when', 'now'), p_event_key);
      IF v_sub.status <> 'pending' THEN
        PERFORM public.issue_4490_member_enqueue(v_sub.id, NULL, 'venue_membership_ended', 'now');
      END IF;
    ELSE
      UPDATE public.venue_membership_subscriptions
      SET cancel_at = public.issue_4490_member_leave_at(v_sub.id, p_by = 'member'),
          cancel_requested_by = p_by, pause_at_period_end = false, pause_requested_by = NULL,
          version = version + 1, updated_at = now()
      WHERE id = v_sub.id RETURNING * INTO v_sub;
      -- Months after the end are not owed.
      UPDATE public.venue_membership_periods SET status = 'void', version = version + 1, updated_at = now()
      WHERE subscription_id = v_sub.id AND status IN ('scheduled', 'link_sent', 'overdue')
        AND period_start >= v_sub.cancel_at;
      PERFORM public.issue_4490_member_event(v_sub.id, NULL, 'member_leaving', p_by, p_user_id,
        jsonb_build_object('endsAt', v_sub.cancel_at, 'reason', p_payload->>'reason'), p_event_key);
      PERFORM public.issue_4490_member_enqueue(v_sub.id, NULL, 'venue_membership_ended', 'leaving');
    END IF;
  ELSIF p_action = 'stay' THEN
    IF v_sub.cancel_at IS NULL THEN
      RAISE EXCEPTION 'membership_not_leaving' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_membership_subscriptions
    SET cancel_at = NULL, cancel_requested_by = NULL, version = version + 1, updated_at = now()
    WHERE id = v_sub.id;
    PERFORM public.issue_4490_member_event(v_sub.id, NULL, 'member_stays', p_by, p_user_id, '{}'::jsonb, p_event_key);
  ELSIF p_action = 'pause' THEN
    IF p_by = 'staff' AND v_now_mode THEN
      IF v_sub.status NOT IN ('active', 'payment_due', 'grace', 'lapsed') THEN
        RAISE EXCEPTION 'membership_cannot_pause' USING ERRCODE = 'PT409';
      END IF;
      UPDATE public.venue_membership_subscriptions
      SET status = 'paused', pause_reason = 'staff', paused_since = now(), pause_at_period_end = false,
          pause_requested_by = 'staff', version = version + 1, updated_at = now()
      WHERE id = v_sub.id;
      UPDATE public.venue_membership_periods SET status = 'void', version = version + 1, updated_at = now()
      WHERE subscription_id = v_sub.id AND status IN ('scheduled', 'link_sent', 'overdue')
        AND period_start >= v_sub.current_period_end;
    ELSE
      IF v_sub.status <> 'active' OR v_sub.pause_at_period_end OR v_sub.cancel_at IS NOT NULL THEN
        RAISE EXCEPTION 'membership_cannot_pause' USING ERRCODE = 'PT409';
      END IF;
      UPDATE public.venue_membership_subscriptions
      SET pause_at_period_end = true, pause_requested_by = p_by, version = version + 1, updated_at = now()
      WHERE id = v_sub.id;
      UPDATE public.venue_membership_periods SET status = 'void', version = version + 1, updated_at = now()
      WHERE subscription_id = v_sub.id AND status IN ('scheduled', 'link_sent', 'overdue')
        AND period_start >= v_sub.current_period_end;
    END IF;
    PERFORM public.issue_4490_member_event(v_sub.id, NULL, 'member_paused', p_by, p_user_id,
      jsonb_build_object('when', CASE WHEN p_by = 'staff' AND v_now_mode THEN 'now' ELSE 'period_end' END,
                         'reason', p_payload->>'reason'), p_event_key);
  ELSE -- resume
    IF v_sub.pause_at_period_end AND v_sub.status <> 'paused' THEN
      UPDATE public.venue_membership_subscriptions
      SET pause_at_period_end = false, pause_requested_by = NULL, version = version + 1, updated_at = now()
      WHERE id = v_sub.id;
    ELSIF v_sub.status = 'paused' AND v_sub.current_period_end > now() THEN
      -- Paused inside a paid month: back at once.
      UPDATE public.venue_membership_subscriptions
      SET status = 'active', pause_reason = NULL, paused_since = NULL, pause_requested_by = NULL,
          version = version + 1, updated_at = now()
      WHERE id = v_sub.id;
    ELSIF v_sub.status = 'paused' THEN
      -- Starting again: a month from today, active once paid.
      IF public.issue_4490_member_open_period(v_sub.id) IS NULL THEN
        v_start := date_trunc('minute', now());
        SELECT COALESCE(max(sequence), 0) + 1 INTO v_seq FROM public.venue_membership_periods WHERE subscription_id = v_sub.id;
        INSERT INTO public.venue_membership_periods (
          subscription_id, sequence, period_start, period_end, amount_minor, currency_code, due_at, status
        ) VALUES (
          v_sub.id, v_seq, v_start, public.issue_4490_month_after(v_start, v_tz), v_plan.price_minor,
          v_plan.currency_code, now(), 'link_sent'
        ) ON CONFLICT (subscription_id, period_start) DO NOTHING
        RETURNING id INTO v_period;
        IF v_period IS NOT NULL THEN
          PERFORM public.issue_4490_member_enqueue(v_sub.id, v_period, 'venue_membership_renewal', 'restart');
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'membership_not_paused' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.issue_4490_member_event(v_sub.id, v_period, 'member_resumed', p_by, p_user_id, '{}'::jsonb, p_event_key);
  END IF;
  RETURN public.issue_4490_member_projection(v_sub.id, p_view, NULL) || jsonb_build_object('replayed', false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Paying a month: a stay group on the plan's hidden offering, one window
--    per month, full payment, no refunds. Only the member (token / own
--    account) can start it; the group's own buyer hash is derived here from
--    the member token hash and the group id, so no guest path can open it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_membership_period_group(p_period_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_period public.venue_membership_periods%ROWTYPE;
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_rule uuid;
  v_window public.stay_place_windows%ROWTYPE;
  v_quote_id uuid := gen_random_uuid();
  v_line_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_hold_id uuid := gen_random_uuid();
  v_actor text;
  v_key text;
  v_n integer;
  v_base bigint;
  v_tax bigint;
  v_total bigint;
  v_tz text;
  v_hold_expires timestamptz;
BEGIN
  SELECT * INTO v_period FROM public.venue_membership_periods WHERE id = p_period_id FOR UPDATE;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = v_period.subscription_id;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_plan.offering_id;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  v_tz := v_settings.timezone;
  SELECT * INTO v_price FROM public.stay_price_versions
  WHERE offering_id = v_offer.id AND price_option_id = v_plan.price_option_id AND effective_to IS NULL;
  SELECT * INTO v_policy FROM public.stay_policy_versions WHERE offering_id = v_offer.id AND effective_to IS NULL;
  SELECT r.id INTO v_rule FROM public.stay_place_schedule_rules r WHERE r.offering_id = v_offer.id ORDER BY r.created_at LIMIT 1;
  IF v_price.id IS NULL OR v_policy.id IS NULL OR v_rule IS NULL THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.stay_place_windows (
    offering_id, schedule_rule_id, brand_id, venue_id, local_date, starts_at, ends_at,
    sellable_units, sellable_capacity, dst_resolution, booked_block
  ) VALUES (
    v_offer.id, v_rule, v_offer.brand_id, v_offer.venue_id, (v_period.period_start AT TIME ZONE v_tz)::date,
    v_period.period_start, v_period.period_end, NULL, 100000, 'unambiguous', true
  ) ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
  SELECT * INTO v_window FROM public.stay_place_windows
  WHERE offering_id = v_offer.id AND starts_at = v_period.period_start AND ends_at = v_period.period_end;

  v_actor := encode(pg_catalog.sha256(convert_to('membership-period:' || v_period.id::text, 'UTF8')), 'hex');
  SELECT count(*) + 1 INTO v_n FROM public.stay_reservation_groups g WHERE g.actor_key_hash = v_actor;
  v_key := 'member-period:' || v_period.id || ':' || v_n;
  v_base := v_period.amount_minor;
  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_quote_id, v_sub.user_id, v_actor, v_offer.venue_id, v_offer.brand_id, v_period.currency_code,
    'instant', 'building', 0, 0, 0, 0,
    encode(pg_catalog.sha256(convert_to(v_key, 'UTF8')), 'hex'), repeat('0', 64), repeat('0', 64), repeat('0', 64),
    v_key, now() + interval '15 minutes', 'membership'
  );
  INSERT INTO public.stay_quote_lines (
    id, quote_id, offering_id, kind, confirmation_mode, place_window_id, place_guests,
    base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id,
    offering_version, inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot, price_option_id
  ) VALUES (
    v_line_id, v_quote_id, v_offer.id, 'membership', 'instant', v_window.id, 1,
    v_base, 0, 0, v_base, v_price.id, v_policy.id, v_offer.version,
    jsonb_build_object('resources', jsonb_build_array(jsonb_build_object(
      'resourceType', 'place_window', 'windowId', v_window.id, 'version', v_window.version)),
      'localDate', v_window.local_date),
    jsonb_build_object('name', v_plan.name, 'kind', 'membership', 'venueId', v_offer.venue_id),
    jsonb_build_object('optionName', v_plan.name, 'unit', 'booking', 'unitPriceMinor', v_base,
      'listPriceMinor', v_price.amount_minor, 'currencyCode', v_period.currency_code, 'sortOrder', 0,
      'subscriptionId', v_sub.id, 'periodId', v_period.id,
      'periodStart', v_period.period_start, 'periodEnd', v_period.period_end, 'packageMinor', v_base),
    to_jsonb(v_policy) - 'created_by', v_plan.price_option_id
  );
  FOR v_fee IN
    SELECT * FROM public.stay_fee_versions WHERE offering_id = v_offer.id AND effective_to IS NULL ORDER BY fee_key, id
  LOOP
    v_tax := CASE
      WHEN v_fee.calculation = 'percentage_of_line_base' AND v_fee.display_mode = 'included'
        THEN round(v_base::numeric * v_fee.basis_points / (10000 + v_fee.basis_points))::bigint
      WHEN v_fee.calculation = 'percentage_of_line_base'
        THEN round(v_base::numeric * v_fee.basis_points / 10000)::bigint
      WHEN v_fee.calculation IN ('fixed_per_place_booking', 'fixed_per_place_guest') THEN v_fee.amount_minor
      ELSE 0 END;
    INSERT INTO public.stay_quote_fee_lines (
      quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor, included_in_base, refund_treatment, snapshot
    ) VALUES (
      v_quote_id, v_line_id, v_fee.id, v_fee.label, v_fee.fee_kind, v_tax,
      v_fee.display_mode = 'included', v_fee.refund_treatment, to_jsonb(v_fee)
    );
  END LOOP;
  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor, tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_quote_id GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;
  SELECT total_minor INTO v_total FROM public.stay_quote_lines WHERE id = v_line_id;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = l.base_minor, fee_total_minor = l.fee_minor,
      tax_total_minor = l.tax_minor, total_minor = l.total_minor,
      price_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.price_version_id::text || ':' || l.price_snapshot::text, 'UTF8')), 'hex'),
      inventory_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.offering_id::text || ':' || l.offering_version::text || ':' || l.inventory_snapshot::text, 'UTF8')), 'hex'),
      policy_snapshot_hash = encode(pg_catalog.sha256(convert_to(
        l.policy_version_id::text || ':' || l.policy_snapshot::text, 'UTF8')), 'hex')
  FROM public.stay_quote_lines l
  WHERE q.id = v_quote_id AND l.id = v_line_id;

  v_hold_expires := now() + make_interval(mins => v_settings.instant_payment_hold_minutes);
  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, state, guest_snapshot, source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash, offer_kind, buyer_token_hash, payment_plan_snapshot,
    booking_source, payment_collection
  )
  SELECT v_group_id, 'VB-' || upper(substr(replace(v_group_id::text, '-', ''), 1, 20)),
    q.id, v_sub.user_id, v_actor, q.venue_id, q.brand_id, q.currency_code,
    'instant', 'instant_payment_pending',
    jsonb_strip_nulls(jsonb_build_object('name', v_sub.member_name, 'email', v_sub.member_email, 'phone', v_sub.member_phone)),
    q.source_subtotal_minor, q.fee_total_minor, q.tax_total_minor, q.total_minor,
    v_key, q.request_hash, 'membership',
    pg_catalog.sha256(v_sub.member_token_hash || convert_to(v_group_id::text, 'UTF8')),
    jsonb_build_object('stagePlan', 'full', 'depositKind', 'none', 'depositValue', NULL, 'depositMinor', NULL,
      'balanceDueAt', NULL, 'payModes', jsonb_build_array('full'), 'currencyCode', q.currency_code,
      'vatMode', v_settings.vat_mode, 'refundLadder', '[]'::jsonb, 'dateChangeRule', '{}'::jsonb,
      'policyText', v_policy.cancellation_policy, 'operatorCancelRefundBps', 0, 'damageDepositMinor', 0,
      'minSpendMinor', 0, 'localDate', v_window.local_date,
      'membership', jsonb_build_object('subscriptionId', v_sub.id, 'periodId', v_period.id)),
    'guest', 'mingla'
  FROM public.stay_quotes q WHERE q.id = v_quote_id;
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id
  )
  SELECT gen_random_uuid(), v_group_id, l.id, l.offering_id, l.kind, 'payment_pending', l.place_window_id, l.place_guests,
         0, 0, l.base_minor, l.fee_minor, l.tax_minor, l.total_minor,
         l.offering_snapshot, l.price_snapshot, l.policy_snapshot, l.price_option_id
  FROM public.stay_quote_lines l WHERE l.id = v_line_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, v_group_id, 'active', v_hold_expires, 'instant_payment');
  INSERT INTO public.stay_inventory_hold_slices (hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity)
  SELECT v_hold_id, r.id, 'place_window', r.offering_id, r.place_window_id, 1
  FROM public.stay_reservation_lines r WHERE r.group_id = v_group_id;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1 WHERE id = v_quote_id;
  INSERT INTO public.stay_reservation_events (group_id, event_type, actor_type, idempotency_key, safe_metadata)
  VALUES (v_group_id, 'stay_offer_hold_created', 'guest', 'offer-hold:' || v_key,
          jsonb_build_object('holdExpiresAt', v_hold_expires, 'membershipPeriodId', v_period.id));
  UPDATE public.venue_membership_periods SET group_id = v_group_id, version = version + 1, updated_at = now()
  WHERE id = v_period.id;
  RETURN v_group_id;
END;
$function$;

-- Pay the open month (edge venue-membership-pay-link). Reuses the month's
-- group while its hold lasts, else makes a new one; then the normal offer
-- payment (full). A month already paid owes nothing: paying one link twice
-- is refused.
CREATE OR REPLACE FUNCTION public.issue_4490_membership_prepare_payment(
  p_subscription_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_period public.venue_membership_periods%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_group_id uuid;
  v_prepared jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'membership_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_member_actor_ok(v_sub, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Replay: the same key on a month already started returns that payment.
  SELECT g.* INTO v_group FROM public.stay_payment_attempts a
  JOIN public.stay_reservation_groups g ON g.id = a.group_id
  JOIN public.venue_membership_periods p ON p.group_id = g.id
  WHERE p.subscription_id = v_sub.id AND a.idempotency_key = btrim(p_idempotency_key)
  ORDER BY a.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN public.issue_4490_prepare_offer_payment(v_group.id,
      pg_catalog.sha256(v_sub.member_token_hash || convert_to(v_group.id::text, 'UTF8')), NULL,
      p_idempotency_key, v_group.version, 'full')
      || jsonb_build_object('groupId', v_group.id, 'subscriptionId', v_sub.id,
           'periodId', (SELECT p.id FROM public.venue_membership_periods p WHERE p.group_id = v_group.id));
  END IF;
  IF v_sub.status = 'cancelled' THEN
    RAISE EXCEPTION 'membership_ended' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_period FROM public.venue_membership_periods
  WHERE id = public.issue_4490_member_open_period(v_sub.id) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  IF v_period.group_id IS NOT NULL THEN
    SELECT g.* INTO v_group FROM public.stay_reservation_groups g
    JOIN public.stay_inventory_holds h ON h.group_id = g.id
    WHERE g.id = v_period.group_id AND g.state = 'instant_payment_pending'
      AND h.state = 'active' AND h.expires_at > now() + interval '2 minutes';
  END IF;
  v_group_id := CASE WHEN v_group.id IS NOT NULL THEN v_group.id
                     ELSE public.issue_4490_membership_period_group(v_period.id) END;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_group_id;
  v_prepared := public.issue_4490_prepare_offer_payment(v_group.id,
    pg_catalog.sha256(v_sub.member_token_hash || convert_to(v_group.id::text, 'UTF8')), NULL,
    p_idempotency_key, v_group.version, 'full');
  RETURN v_prepared || jsonb_build_object('groupId', v_group.id, 'subscriptionId', v_sub.id, 'periodId', v_period.id);
END;
$function$;

-- The month's group the member's return confirms (latest).
CREATE OR REPLACE FUNCTION public.issue_4490_membership_payment_group(
  p_subscription_id uuid,
  p_token_hash bytea,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND OR NOT public.issue_4490_member_actor_ok(v_sub, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN (SELECT p.group_id FROM public.venue_membership_periods p
          WHERE p.subscription_id = v_sub.id AND p.group_id IS NOT NULL
          ORDER BY p.updated_at DESC, p.sequence DESC LIMIT 1);
END;
$function$;

-- A month is paid (online through the group, or marked paid at the venue):
-- the member is active through its end, the month's room hours and guest
-- passes are granted, and the member is told.
CREATE OR REPLACE FUNCTION public.issue_4490_membership_period_paid(
  p_period_id uuid,
  p_group_id uuid,
  p_via text,
  p_method text,
  p_note text,
  p_staff uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_period public.venue_membership_periods%ROWTYPE;
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_hours numeric;
  v_passes numeric;
BEGIN
  SELECT * INTO v_period FROM public.venue_membership_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = v_period.subscription_id FOR UPDATE;
  IF v_period.status = 'paid' THEN
    IF p_group_id IS NOT NULL AND v_period.group_id IS DISTINCT FROM p_group_id THEN
      -- A second payment for the same month: kept for checking (no extension).
      PERFORM public.issue_4490_member_event(v_sub.id, v_period.id, 'member_paid_twice', 'system', NULL,
        jsonb_build_object('groupId', p_group_id), 'paid-twice:' || p_group_id);
    END IF;
    RETURN;
  END IF;
  v_tz := public.issue_4490_venue_timezone(public.issue_4490_member_venue(v_sub.id));
  v_start := v_period.period_start;
  v_end := v_period.period_end;
  -- Paid after the month should have started while not a member (never
  -- started, lapsed or paused): the month runs from now.
  IF v_sub.status IN ('pending', 'lapsed', 'paused')
     AND (now() AT TIME ZONE v_tz)::date > (v_period.period_start AT TIME ZONE v_tz)::date THEN
    v_start := date_trunc('minute', now());
    v_end := public.issue_4490_month_after(v_start, v_tz);
  END IF;
  UPDATE public.venue_membership_periods
  SET status = 'paid', paid_at = now(), paid_via = p_via, paid_method = p_method,
      paid_note = left(p_note, 300), marked_paid_by = p_staff,
      group_id = COALESCE(p_group_id, group_id),
      period_start = v_start, period_end = v_end, version = version + 1, updated_at = now()
  WHERE id = v_period.id
  RETURNING * INTO v_period;
  UPDATE public.venue_membership_subscriptions
  SET status = CASE WHEN status = 'cancelled' THEN status ELSE 'active' END,
      started_at = COALESCE(started_at, now()),
      current_period_start = CASE WHEN current_period_end IS NULL OR v_period.period_end > current_period_end
                                  THEN v_period.period_start ELSE current_period_start END,
      current_period_end = CASE WHEN current_period_end IS NULL OR v_period.period_end > current_period_end
                                THEN v_period.period_end ELSE current_period_end END,
      pause_reason = CASE WHEN status = 'cancelled' THEN pause_reason ELSE NULL END,
      paused_since = CASE WHEN status = 'cancelled' THEN paused_since ELSE NULL END,
      pause_requested_by = CASE WHEN status = 'paused' THEN NULL ELSE pause_requested_by END,
      version = version + 1, updated_at = now()
  WHERE id = v_sub.id;
  v_hours := COALESCE((v_sub.terms->>'roomHours')::numeric, 0);
  v_passes := COALESCE((v_sub.terms->>'guestPasses')::numeric, 0);
  IF v_hours > 0 THEN
    INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, expires_at, idempotency_key)
    VALUES (v_sub.id, v_period.id, 'room_hours', 'grant', v_hours, v_period.period_end, 'grant:' || v_period.id || ':room_hours')
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  IF v_passes > 0 THEN
    INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, expires_at, idempotency_key)
    VALUES (v_sub.id, v_period.id, 'guest_passes', 'grant', v_passes, v_period.period_end, 'grant:' || v_period.id || ':guest_passes')
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  PERFORM public.issue_4490_member_event(v_sub.id, v_period.id, 'member_paid', CASE WHEN p_staff IS NULL THEN 'member' ELSE 'staff' END,
    p_staff, jsonb_build_object('via', p_via, 'method', p_method, 'amountMinor', v_period.amount_minor,
      'periodStart', v_period.period_start, 'periodEnd', v_period.period_end), 'paid:' || v_period.id);
  PERFORM public.issue_4490_member_enqueue(v_sub.id, v_period.id, 'venue_membership_paid', CASE WHEN v_period.sequence = 1 THEN 'first' ELSE 'renewal' END);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Member benefits at checkout. The edge builds the normal quote, then asks
--    for the member's price: a new quote (same lines, the member's base) is
--    made and the first one expires. Order: the member's own entry free and
--    guest passes for their guests (the plan's entry offer); included room
--    hours first on by-the-hour offers (the rest at the per-minute pro-rata
--    price); then the plan discount on the kinds it names. VAT is worked out
--    again on the new base. Nothing is spent until the booking is held.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_member_quote(
  p_quote_id uuid,
  p_subscription_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_actor_key text,
  p_use_credits boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quote public.stay_quotes%ROWTYPE;
  v_new public.stay_quotes%ROWTYPE;
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_fee public.stay_quote_fee_lines%ROWTYPE;
  v_new_quote uuid := gen_random_uuid();
  v_new_line uuid;
  v_key text;
  v_at timestamptz;
  v_unit bigint;
  v_member_free integer := 0;
  v_passes_left numeric;
  v_hours_left numeric;
  v_passes_used integer := 0;
  v_minutes_used integer := 0;
  v_free integer;
  v_pass integer;
  v_minutes integer;
  v_credit_min integer;
  v_value bigint;
  v_discount bigint;
  v_new_base bigint;
  v_tax bigint;
  v_total_value bigint := 0;
  v_total_discount bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  v_snap jsonb;
  v_bps integer;
  v_map jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_quote FROM public.stay_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash IS DISTINCT FROM p_actor_key OR v_quote.offer_kind IS NULL
     OR v_quote.offer_kind = 'membership' THEN
    RAISE EXCEPTION 'offer_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_member_actor_ok(v_sub, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_key := left(v_quote.idempotency_key, 190) || ':member';
  SELECT * INTO v_new FROM public.stay_quotes WHERE actor_key_hash = p_actor_key AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN public.issue_4490_quote_projection(v_new.id) || jsonb_build_object('member', (
      SELECT jsonb_build_object('applied', true, 'subscriptionId', v_sub.id,
        'lines', COALESCE(jsonb_agg(l.price_snapshot->'member' ORDER BY l.price_option_id), '[]'::jsonb))
      FROM public.stay_quote_lines l WHERE l.quote_id = v_new.id), 'replayed', true);
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    RAISE EXCEPTION 'offer_quote_expired' USING ERRCODE = 'PT409';
  END IF;
  IF v_sub.status NOT IN ('active', 'payment_due', 'grace') THEN
    RAISE EXCEPTION 'member_not_active' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  IF public.issue_4490_plan_venue(v_plan.id) IS DISTINCT FROM v_quote.venue_id THEN
    RAISE EXCEPTION 'member_wrong_venue' USING ERRCODE = 'PT409';
  END IF;
  v_bps := COALESCE((v_sub.terms->>'discountBps')::integer, v_plan.discount_bps);

  -- Work the member's price out per line first.
  FOR v_line IN SELECT * FROM public.stay_quote_lines WHERE quote_id = v_quote.id ORDER BY price_option_id, id LOOP
    SELECT w.starts_at INTO v_at FROM public.stay_place_windows w WHERE w.id = v_line.place_window_id;
    v_unit := COALESCE((v_line.price_snapshot->>'unitPriceMinor')::bigint, 0);
    v_value := 0; v_free := 0; v_pass := 0; v_credit_min := 0;
    IF v_line.kind = 'entry' AND v_plan.entry_included AND v_line.offering_id = v_plan.entry_offering_id
       AND v_line.price_snapshot->>'unit' = 'guest' THEN
      v_free := LEAST(GREATEST(1 - v_member_free, 0), v_line.place_guests);
      v_member_free := v_member_free + v_free;
      IF p_use_credits THEN
        v_passes_left := public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', v_at) - v_passes_used;
        v_pass := LEAST(v_line.place_guests - v_free, floor(GREATEST(v_passes_left, 0))::integer);
        v_passes_used := v_passes_used + v_pass;
      END IF;
      v_value := v_unit * (v_free + v_pass);
    ELSIF v_line.kind = 'by_the_hour' AND p_use_credits AND v_plan.room_hours_per_period > 0
          AND (cardinality(v_plan.hour_offering_ids) = 0 OR v_line.offering_id = ANY(v_plan.hour_offering_ids)) THEN
      v_minutes := COALESCE((v_line.price_snapshot->>'minutes')::integer, v_line.booked_minutes, 0);
      v_hours_left := public.issue_4490_member_credit_left(v_sub.id, 'room_hours', v_at) - v_minutes_used / 60.0;
      v_credit_min := LEAST(v_minutes, floor(GREATEST(v_hours_left, 0) * 60)::integer);
      v_minutes_used := v_minutes_used + v_credit_min;
      v_value := COALESCE((v_line.price_snapshot->>'packageMinor')::bigint, (v_unit * v_minutes + 30) / 60)
                 - (v_unit * (v_minutes - v_credit_min) + 30) / 60;
    END IF;
    v_value := LEAST(GREATEST(v_value, 0), v_line.base_minor);
    v_discount := CASE WHEN v_bps > 0 AND v_line.kind = ANY(v_plan.discount_kinds)
                       THEN round((v_line.base_minor - v_value)::numeric * v_bps / 10000)::bigint ELSE 0 END;
    v_new_base := GREATEST(v_line.base_minor - v_value - v_discount, 0);
    v_total_value := v_total_value + v_value;
    v_total_discount := v_total_discount + v_discount;
    v_snap := jsonb_build_object('subscriptionId', v_sub.id, 'planName', v_plan.name,
      'listBaseMinor', v_line.base_minor, 'freeAdmissions', v_free, 'guestPassesUsed', v_pass,
      'roomMinutesUsed', v_credit_min, 'roomHoursUsed', round(v_credit_min / 60.0, 2),
      'includedMinor', v_value, 'discountBps', CASE WHEN v_discount > 0 THEN v_bps ELSE 0 END,
      'discountMinor', v_discount, 'periodId', public.issue_4490_member_period_at(v_sub.id, v_at));
    v_map := v_map || jsonb_build_object(v_line.id::text, jsonb_build_object('newBase', v_new_base, 'snap', v_snap));
    v_lines := v_lines || v_snap;
  END LOOP;
  IF v_total_value = 0 AND v_total_discount = 0 THEN
    RETURN public.issue_4490_quote_projection(v_quote.id) || jsonb_build_object('member', jsonb_build_object(
      'applied', false, 'subscriptionId', v_sub.id, 'reason', 'nothing_included'));
  END IF;

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_new_quote, v_quote.user_id, v_quote.actor_key_hash, v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    v_quote.mode, 'building', 0, 0, 0, 0,
    encode(pg_catalog.sha256(convert_to(v_quote.request_hash || ':member:' || v_sub.id::text, 'UTF8')), 'hex'),
    repeat('0', 64), repeat('0', 64), repeat('0', 64), v_key, v_quote.expires_at, v_quote.offer_kind
  );
  FOR v_line IN SELECT * FROM public.stay_quote_lines WHERE quote_id = v_quote.id ORDER BY price_option_id, id LOOP
    v_new_line := gen_random_uuid();
    v_new_base := (v_map->(v_line.id::text)->>'newBase')::bigint;
    v_snap := v_map->(v_line.id::text)->'snap';
    INSERT INTO public.stay_quote_lines (
      id, quote_id, offering_id, kind, confirmation_mode, room_check_in, room_check_out, room_quantity,
      place_window_id, place_units, place_guests, adults, children, named_unit_preferences,
      base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id, offering_version,
      inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot, price_option_id, booked_minutes
    ) VALUES (
      v_new_line, v_new_quote, v_line.offering_id, v_line.kind, v_line.confirmation_mode, v_line.room_check_in,
      v_line.room_check_out, v_line.room_quantity, v_line.place_window_id, v_line.place_units, v_line.place_guests,
      v_line.adults, v_line.children, v_line.named_unit_preferences,
      v_new_base, 0, 0, v_new_base, v_line.price_version_id, v_line.policy_version_id, v_line.offering_version,
      v_line.inventory_snapshot, v_line.offering_snapshot, v_line.price_snapshot || jsonb_build_object('member', v_snap),
      v_line.policy_snapshot, v_line.price_option_id, v_line.booked_minutes
    );
    FOR v_fee IN SELECT * FROM public.stay_quote_fee_lines WHERE quote_line_id = v_line.id ORDER BY fee_version_id, id LOOP
      v_tax := CASE
        WHEN v_fee.snapshot->>'calculation' = 'percentage_of_line_base' AND v_fee.included_in_base
          THEN round(v_new_base::numeric * (v_fee.snapshot->>'basis_points')::integer
                     / (10000 + (v_fee.snapshot->>'basis_points')::integer))::bigint
        WHEN v_fee.snapshot->>'calculation' = 'percentage_of_line_base'
          THEN round(v_new_base::numeric * (v_fee.snapshot->>'basis_points')::integer / 10000)::bigint
        ELSE v_fee.amount_minor END;
      INSERT INTO public.stay_quote_fee_lines (
        quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor, included_in_base, refund_treatment, snapshot
      ) VALUES (
        v_new_quote, v_new_line, v_fee.fee_version_id, v_fee.name, v_fee.fee_kind, v_tax,
        v_fee.included_in_base, v_fee.refund_treatment, v_fee.snapshot
      );
    END LOOP;
  END LOOP;
  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor, tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_new_quote GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;
  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = t.base, fee_total_minor = t.fee, tax_total_minor = t.tax, total_minor = t.total,
      price_revision_set_hash = t.price_hash, inventory_revision_set_hash = t.inv_hash, policy_snapshot_hash = t.policy_hash
  FROM (
    SELECT sum(l.base_minor) AS base, sum(l.fee_minor) AS fee, sum(l.tax_minor) AS tax, sum(l.total_minor) AS total,
      encode(pg_catalog.sha256(convert_to(string_agg(l.price_version_id::text || ':' || l.price_snapshot::text, '|'
        ORDER BY l.price_option_id, l.id), 'UTF8')), 'hex') AS price_hash,
      encode(pg_catalog.sha256(convert_to(string_agg(l.offering_id::text || ':' || l.offering_version::text || ':'
        || l.inventory_snapshot::text, '|' ORDER BY l.price_option_id, l.id), 'UTF8')), 'hex') AS inv_hash,
      encode(pg_catalog.sha256(convert_to(string_agg(l.policy_version_id::text || ':' || l.policy_snapshot::text, '|'
        ORDER BY l.price_option_id, l.id), 'UTF8')), 'hex') AS policy_hash
    FROM public.stay_quote_lines l WHERE l.quote_id = v_new_quote
  ) t
  WHERE q.id = v_new_quote;
  UPDATE public.stay_quotes SET status = 'expired', version = version + 1 WHERE id = v_quote.id;
  RETURN public.issue_4490_quote_projection(v_new_quote) || jsonb_build_object('member', jsonb_build_object(
    'applied', true, 'subscriptionId', v_sub.id, 'planName', v_plan.name,
    'includedMinor', v_total_value, 'discountMinor', v_total_discount,
    'roomHoursUsed', round(v_minutes_used / 60.0, 2), 'guestPassesUsed', v_passes_used,
    'freeAdmissions', v_member_free,
    'roomHoursLeftAfter', GREATEST(public.issue_4490_member_credit_left(v_sub.id, 'room_hours', now()) - v_minutes_used / 60.0, 0),
    'lines', v_lines), 'replayed', false);
END;
$function$;

-- Held: spend the credits the member's price used (fails the hold when the
-- month no longer has them). A booking that owes nothing is confirmed now.
CREATE OR REPLACE FUNCTION public.issue_4490_member_spend(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_line record;
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_hours numeric;
  v_passes numeric;
  v_period uuid;
  v_period_end timestamptz;
BEGIN
  FOR v_line IN
    SELECT l.id, l.price_snapshot->'member' AS member, w.starts_at
    FROM public.stay_reservation_lines l
    JOIN public.stay_place_windows w ON w.id = l.place_window_id
    WHERE l.group_id = p_group_id AND l.price_snapshot ? 'member'
    ORDER BY l.id
  LOOP
    SELECT * INTO v_sub FROM public.venue_membership_subscriptions
    WHERE id = (v_line.member->>'subscriptionId')::uuid FOR UPDATE;
    IF NOT FOUND OR v_sub.status NOT IN ('active', 'payment_due', 'grace') THEN
      RAISE EXCEPTION 'member_not_active' USING ERRCODE = 'PT409';
    END IF;
    v_hours := COALESCE((v_line.member->>'roomMinutesUsed')::numeric, 0) / 60.0;
    v_passes := COALESCE((v_line.member->>'guestPassesUsed')::numeric, 0);
    IF v_hours > 0 OR v_passes > 0 THEN
      v_period := public.issue_4490_member_period_at(v_sub.id, v_line.starts_at);
      IF v_period IS NULL
         OR public.issue_4490_member_credit_left(v_sub.id, 'room_hours', v_line.starts_at) < v_hours
         OR public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', v_line.starts_at) < v_passes THEN
        RAISE EXCEPTION 'member_credits_used_up' USING ERRCODE = 'PT409';
      END IF;
      SELECT period_end INTO v_period_end FROM public.venue_membership_periods WHERE id = v_period;
      IF v_hours > 0 THEN
        INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, group_id, expires_at, idempotency_key)
        VALUES (v_sub.id, v_period, 'room_hours', 'spend', -round(v_hours, 2), p_group_id, v_period_end, 'spend:' || v_line.id || ':room_hours');
      END IF;
      IF v_passes > 0 THEN
        INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, group_id, expires_at, idempotency_key)
        VALUES (v_sub.id, v_period, 'guest_passes', 'spend', -v_passes, p_group_id, v_period_end, 'spend:' || v_line.id || ':guest_passes');
      END IF;
    END IF;
  END LOOP;

  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF v_group.total_minor = 0 AND v_group.state = 'instant_payment_pending'
     AND EXISTS (SELECT 1 FROM public.stay_reservation_lines l WHERE l.group_id = p_group_id AND l.price_snapshot ? 'member') THEN
    SELECT * INTO v_hold FROM public.stay_inventory_holds WHERE group_id = p_group_id FOR UPDATE;
    UPDATE public.stay_reservation_groups SET state = 'finalizing', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    INSERT INTO public.stay_inventory_commitments (
      group_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
    )
    SELECT p_group_id, s.reservation_line_id, s.resource_type, s.offering_id, s.place_window_id, s.quantity
    FROM public.stay_inventory_hold_slices s WHERE s.hold_id = v_hold.id ORDER BY s.id;
    UPDATE public.stay_inventory_holds SET state = 'converted', reason = 'member_included', version = version + 1, updated_at = now()
    WHERE id = v_hold.id;
    UPDATE public.stay_reservation_lines SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE group_id = p_group_id AND state = 'payment_pending';
    UPDATE public.stay_reservation_groups SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    INSERT INTO public.stay_reservation_events (group_id, event_type, actor_type, idempotency_key, safe_metadata)
    VALUES (p_group_id, 'stay_reservation_confirmed', 'guest', 'member-included:' || p_group_id,
            jsonb_build_object('amountMinor', '0', 'memberIncluded', true));
  END IF;
END;
$function$;

-- A booking that spent credits is cancelled or its hold lapses: they return.
CREATE OR REPLACE FUNCTION public.issue_4490_member_return_credits(p_group_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, group_id, expires_at, idempotency_key)
  SELECT l.subscription_id, l.period_id, l.credit, 'return', -l.amount, l.group_id, l.expires_at, 'return:' || l.id
  FROM public.venue_credit_ledger l
  WHERE l.group_id = p_group_id AND l.entry = 'spend'
  ON CONFLICT (idempotency_key) DO NOTHING;
$function$;

-- ---------------------------------------------------------------------------
-- 10. The billing run (edge venue-membership-billing, hourly; service role).
--     p_now lets a test run the clock forward; production passes nothing.
--     Every step is idempotent: one month per (member, start), one email per
--     month and step (outbox key), state changes guarded by the current state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_membership_billing_run(
  p_now timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_row record;
  v_period public.venue_membership_periods%ROWTYPE;
  v_tz text;
  v_grace integer;
  v_seq integer;
  v_new uuid;
  v_revived boolean;
  v_created integer := 0;
  v_due integer := 0;
  v_grace_n integer := 0;
  v_lapsed integer := 0;
  v_ended integer := 0;
  v_paused integer := 0;
  v_unpaid_joins integer := 0;
  v_expired integer := 0;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- a. Members who left: ended at their end date.
  FOR v_row IN
    SELECT s.id FROM public.venue_membership_subscriptions s
    WHERE s.status <> 'cancelled' AND s.cancel_at IS NOT NULL AND s.cancel_at <= v_now
    ORDER BY s.cancel_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.venue_membership_subscriptions
    SET status = 'cancelled', cancelled_at = v_now,
        end_reason = CASE WHEN cancel_requested_by = 'staff' THEN 'cancelled_by_venue' ELSE 'left' END,
        pause_reason = NULL, pause_at_period_end = false, version = version + 1, updated_at = now()
    WHERE id = v_row.id;
    UPDATE public.venue_membership_periods SET status = 'void', version = version + 1, updated_at = now()
    WHERE subscription_id = v_row.id AND status IN ('scheduled', 'link_sent', 'overdue');
    PERFORM public.issue_4490_member_event(v_row.id, NULL, 'member_ended', 'system', NULL,
      jsonb_build_object('at', v_now), 'ended:' || v_row.id);
    PERFORM public.issue_4490_member_enqueue(v_row.id, NULL, 'venue_membership_ended', 'ended');
    v_ended := v_ended + 1;
  END LOOP;

  -- b. Paused from the end of the paid month.
  FOR v_row IN
    SELECT s.id FROM public.venue_membership_subscriptions s
    WHERE s.status IN ('active', 'payment_due', 'grace') AND s.pause_at_period_end AND s.current_period_end <= v_now
    ORDER BY s.current_period_end LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.venue_membership_subscriptions
    SET status = 'paused', pause_reason = COALESCE(pause_requested_by, 'member'), paused_since = v_now,
        pause_at_period_end = false, version = version + 1, updated_at = now()
    WHERE id = v_row.id;
    PERFORM public.issue_4490_member_event(v_row.id, NULL, 'member_pause_started', 'system', NULL,
      jsonb_build_object('at', v_now), 'pause-started:' || v_row.id || ':' || floor(extract(epoch FROM v_now))::bigint);
    v_paused := v_paused + 1;
  END LOOP;

  -- c. Joined but never paid: closed after 2 days.
  FOR v_row IN
    SELECT s.id FROM public.venue_membership_subscriptions s
    WHERE s.status = 'pending' AND s.created_at <= v_now - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM public.venue_membership_periods p
                      JOIN public.stay_payment_attempts a ON a.group_id = p.group_id
                      WHERE p.subscription_id = s.id AND a.state IN ('pending', 'ambiguous'))
    ORDER BY s.created_at LIMIT v_limit FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.venue_membership_subscriptions
    SET status = 'cancelled', cancelled_at = v_now, end_reason = 'not_paid', version = version + 1, updated_at = now()
    WHERE id = v_row.id;
    UPDATE public.venue_membership_periods SET status = 'void', version = version + 1, updated_at = now()
    WHERE subscription_id = v_row.id AND status IN ('scheduled', 'link_sent', 'overdue');
    PERFORM public.issue_4490_member_event(v_row.id, NULL, 'member_join_closed', 'system', NULL, '{}'::jsonb,
      'join-closed:' || v_row.id);
    v_unpaid_joins := v_unpaid_joins + 1;
  END LOOP;

  -- d. The next month, N days before the paid month ends (renewal email).
  FOR v_row IN
    SELECT s.*, p.price_minor, p.currency_code AS plan_currency, p.renewal_notice_days
    FROM public.venue_membership_subscriptions s
    JOIN public.venue_membership_plans p ON p.id = s.plan_id
    WHERE s.status IN ('active', 'payment_due', 'grace')
      AND NOT s.pause_at_period_end
      AND (s.cancel_at IS NULL OR s.cancel_at > s.current_period_end)
      AND s.current_period_end - make_interval(days => COALESCE((s.terms->>'renewalNoticeDays')::integer, p.renewal_notice_days)) <= v_now
      AND NOT EXISTS (SELECT 1 FROM public.venue_membership_periods x
                      WHERE x.subscription_id = s.id AND x.period_start >= s.current_period_end AND x.status <> 'void')
    ORDER BY s.current_period_end LIMIT v_limit FOR UPDATE OF s SKIP LOCKED
  LOOP
    v_tz := public.issue_4490_venue_timezone(public.issue_4490_member_venue(v_row.id));
    SELECT COALESCE(max(sequence), 0) + 1 INTO v_seq FROM public.venue_membership_periods WHERE subscription_id = v_row.id;
    v_new := NULL;
    -- A month voided earlier (a pause or leave that was undone) comes back.
    INSERT INTO public.venue_membership_periods (
      subscription_id, sequence, period_start, period_end, amount_minor, currency_code, due_at, status
    ) VALUES (
      v_row.id, v_seq, v_row.current_period_end, public.issue_4490_month_after(v_row.current_period_end, v_tz),
      v_row.price_minor, v_row.plan_currency, v_row.current_period_end, 'link_sent'
    ) ON CONFLICT (subscription_id, period_start) DO UPDATE
      SET status = 'link_sent', amount_minor = EXCLUDED.amount_minor, period_end = EXCLUDED.period_end,
          due_at = EXCLUDED.due_at, reminder_steps = '{}', group_id = NULL,
          version = public.venue_membership_periods.version + 1, updated_at = now()
      WHERE public.venue_membership_periods.status = 'void'
    RETURNING id, (version > 1) INTO v_new, v_revived;
    IF v_new IS NOT NULL THEN
      UPDATE public.venue_membership_periods SET reminder_steps = array_append(reminder_steps, 'renewal') WHERE id = v_new;
      PERFORM public.issue_4490_member_event(v_row.id, v_new, 'member_renewal_sent', 'system', NULL,
        jsonb_build_object('amountMinor', v_row.price_minor, 'dueAt', v_row.current_period_end), 'renewal-sent:' || v_new);
      PERFORM public.issue_4490_member_enqueue(v_row.id, v_new, 'venue_membership_renewal',
        CASE WHEN v_revived THEN 'renewal-' || floor(extract(epoch FROM v_now))::bigint ELSE 'renewal' END);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  -- e. The clock on an unpaid month: due (renewal day), grace (3 days after,
  --    second reminder), lapsed (grace over).
  FOR v_row IN
    SELECT s.id AS sub_id, s.status, s.terms, p.id AS period_id, p.due_at, p.reminder_steps
    FROM public.venue_membership_subscriptions s
    JOIN public.venue_membership_periods p ON p.subscription_id = s.id
    WHERE s.status IN ('active', 'payment_due', 'grace')
      AND p.status = 'link_sent' AND p.due_at <= v_now AND p.sequence > 1
    ORDER BY p.due_at LIMIT v_limit FOR UPDATE OF s, p SKIP LOCKED
  LOOP
    v_grace := COALESCE((v_row.terms->>'graceDays')::integer, 7);
    IF v_now >= v_row.due_at + make_interval(days => v_grace) THEN
      UPDATE public.venue_membership_subscriptions SET status = 'lapsed', version = version + 1, updated_at = now()
      WHERE id = v_row.sub_id;
      UPDATE public.venue_membership_periods
      SET status = 'overdue', reminder_steps = array_append(reminder_steps, 'lapsed'), version = version + 1, updated_at = now()
      WHERE id = v_row.period_id;
      PERFORM public.issue_4490_member_event(v_row.sub_id, v_row.period_id, 'member_lapsed', 'system', NULL,
        jsonb_build_object('at', v_now), 'lapsed:' || v_row.period_id);
      PERFORM public.issue_4490_member_enqueue(v_row.sub_id, v_row.period_id, 'venue_membership_lapsed', 'lapsed');
      v_lapsed := v_lapsed + 1;
    ELSIF v_now >= v_row.due_at + interval '3 days' AND v_grace > 3 THEN
      IF v_row.status <> 'grace' THEN
        UPDATE public.venue_membership_subscriptions SET status = 'grace', version = version + 1, updated_at = now()
        WHERE id = v_row.sub_id;
        UPDATE public.venue_membership_periods
        SET reminder_steps = array_append(reminder_steps, 'reminder'), version = version + 1, updated_at = now()
        WHERE id = v_row.period_id AND NOT ('reminder' = ANY(reminder_steps));
        PERFORM public.issue_4490_member_event(v_row.sub_id, v_row.period_id, 'member_reminder_sent', 'system', NULL,
          jsonb_build_object('at', v_now), 'reminder:' || v_row.period_id);
        PERFORM public.issue_4490_member_enqueue(v_row.sub_id, v_row.period_id, 'venue_membership_renewal', 'reminder');
        v_grace_n := v_grace_n + 1;
      END IF;
    ELSIF v_row.status = 'active' THEN
      UPDATE public.venue_membership_subscriptions SET status = 'payment_due', version = version + 1, updated_at = now()
      WHERE id = v_row.sub_id;
      UPDATE public.venue_membership_periods
      SET reminder_steps = array_append(reminder_steps, 'due'), version = version + 1, updated_at = now()
      WHERE id = v_row.period_id AND NOT ('due' = ANY(reminder_steps));
      PERFORM public.issue_4490_member_event(v_row.sub_id, v_row.period_id, 'member_payment_due', 'system', NULL,
        jsonb_build_object('at', v_now), 'due:' || v_row.period_id);
      PERFORM public.issue_4490_member_enqueue(v_row.sub_id, v_row.period_id, 'venue_membership_renewal', 'due');
      v_due := v_due + 1;
    END IF;
  END LOOP;

  -- f. Unused credits end with their month.
  FOR v_row IN
    SELECT l.subscription_id, l.period_id, l.credit, sum(l.amount) AS left_amount, max(l.expires_at) AS expires_at
    FROM public.venue_credit_ledger l
    JOIN public.venue_membership_periods p ON p.id = l.period_id
    WHERE p.period_end <= v_now
      AND NOT EXISTS (SELECT 1 FROM public.venue_credit_ledger e
                      WHERE e.period_id = l.period_id AND e.credit = l.credit AND e.entry = 'expire')
    GROUP BY l.subscription_id, l.period_id, l.credit
    HAVING sum(l.amount) > 0
    LIMIT v_limit
  LOOP
    INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, expires_at, idempotency_key)
    VALUES (v_row.subscription_id, v_row.period_id, v_row.credit, 'expire', -v_row.left_amount, v_row.expires_at,
            'expire:' || v_row.period_id || ':' || v_row.credit)
    ON CONFLICT (idempotency_key) DO NOTHING;
    v_expired := v_expired + 1;
  END LOOP;

  RETURN jsonb_build_object('at', v_now, 'renewalsSent', v_created, 'paymentDue', v_due, 'grace', v_grace_n,
    'lapsed', v_lapsed, 'ended', v_ended, 'paused', v_paused, 'unpaidJoinsClosed', v_unpaid_joins,
    'creditsExpired', v_expired);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Host reads and actions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_members(p_venue_id uuid, p_filter text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_today date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_members(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_filter, 'all') NOT IN ('all', 'active', 'payment_due', 'paused', 'ended', 'pending') THEN
    RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  RETURN (
    WITH members AS (
      SELECT s.*, p.name AS plan_name, p.max_members
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans p ON p.id = s.plan_id
      JOIN public.stay_offerings o ON o.id = p.offering_id
      WHERE o.venue_id = p_venue_id
    )
    SELECT jsonb_build_object(
      'venueId', p_venue_id,
      'localDate', v_today,
      'tiles', jsonb_build_object(
        'members', (SELECT count(*) FROM members WHERE status IN ('active', 'payment_due', 'grace', 'lapsed', 'paused')),
        'membersAllowed', (SELECT sum(pl.max_members) FROM public.venue_membership_plans pl
                           JOIN public.stay_offerings o ON o.id = pl.offering_id
                           WHERE o.venue_id = p_venue_id AND pl.status IN ('live', 'paused') AND pl.max_members IS NOT NULL),
        'inToday', (SELECT count(*) FROM public.venue_member_visits x JOIN members m ON m.id = x.subscription_id
                    WHERE x.local_date = v_today AND x.undone_at IS NULL),
        'paymentDue', (SELECT jsonb_build_object('count', count(DISTINCT m.id), 'amountMinor', COALESCE(sum(pe.amount_minor), 0))
                       FROM members m JOIN public.venue_membership_periods pe ON pe.subscription_id = m.id
                       WHERE m.status IN ('payment_due', 'grace', 'lapsed') AND pe.status IN ('link_sent', 'overdue')
                         AND pe.due_at <= now()),
        'renewingThisWeek', (SELECT count(*) FROM members m WHERE m.status = 'active' AND NOT m.pause_at_period_end
                             AND m.cancel_at IS NULL AND m.current_period_end < now() + interval '7 days')),
      'members', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'subscriptionId', m.id, 'name', m.member_name, 'email', m.member_email, 'phone', m.member_phone,
          'planId', m.plan_id, 'planName', m.plan_name, 'status', m.status,
          'activeUntil', m.current_period_end,
          'renewsOn', CASE WHEN m.status IN ('active', 'payment_due', 'grace') AND NOT m.pause_at_period_end
                            AND m.cancel_at IS NULL THEN m.current_period_end END,
          'leavingOn', CASE WHEN m.status <> 'cancelled' THEN m.cancel_at END,
          'pausingOn', CASE WHEN m.pause_at_period_end THEN m.current_period_end END,
          'roomHoursLeft', public.issue_4490_member_credit_left(m.id, 'room_hours', now()),
          'guestPassesLeft', public.issue_4490_member_credit_left(m.id, 'guest_passes', now()),
          'inToday', EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = m.id
                             AND x.local_date = v_today AND x.undone_at IS NULL),
          'amountDueMinor', (SELECT pe.amount_minor FROM public.venue_membership_periods pe
                             WHERE pe.id = public.issue_4490_member_open_period(m.id)),
          'version', m.version, 'joinedAt', m.created_at)
          ORDER BY CASE m.status WHEN 'lapsed' THEN 0 WHEN 'grace' THEN 1 WHEN 'payment_due' THEN 2 WHEN 'active' THEN 3
                                 WHEN 'paused' THEN 4 WHEN 'pending' THEN 5 ELSE 6 END, m.member_name, m.id)
        FROM members m
        WHERE CASE COALESCE(p_filter, 'all')
          WHEN 'all' THEN m.status <> 'cancelled' AND NOT (m.status = 'pending' AND m.created_at < now() - interval '2 days')
          WHEN 'active' THEN m.status IN ('active', 'payment_due', 'grace')
          WHEN 'payment_due' THEN m.status IN ('payment_due', 'grace', 'lapsed')
          WHEN 'paused' THEN m.status = 'paused'
          WHEN 'pending' THEN m.status = 'pending'
          ELSE m.status = 'cancelled' END), '[]'::jsonb)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_member(p_subscription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_subscription_id IS NULL
     OR NOT public.issue_4490_can_view_members(public.issue_4490_member_venue(p_subscription_id)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_member_projection(p_subscription_id, 'host', NULL);
END;
$function$;

-- Staff on one member: pause / resume / cancel (now or at the period end,
-- the plan's terms do not bind the venue), send the payment link again,
-- mark the open month paid at the venue (money rights).
CREATE OR REPLACE FUNCTION public.issue_4490_manage_member(
  p_subscription_id uuid,
  p_action text,
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
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_venue uuid;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_period public.venue_membership_periods%ROWTYPE;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('pause', 'resume', 'cancel', 'undo_cancel', 'send_link', 'mark_paid') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;
  v_venue := public.issue_4490_member_venue(p_subscription_id);
  IF v_uid IS NULL OR v_venue IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'mark_paid' THEN
    IF NOT public.issue_4490_can_manage_money(v_venue, v_uid) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.issue_4490_user_can_manage_members(v_venue, v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object'
     OR (v_payload ? 'when' AND v_payload->>'when' NOT IN ('now', 'period_end'))
     OR (v_payload ? 'reason' AND char_length(COALESCE(v_payload->>'reason', '')) > 300) THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object('sub', p_subscription_id, 'action', p_action,
    'payload', v_payload, 'version', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('member:' || p_subscription_id, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF p_expected_version IS NULL OR v_sub.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;

  IF p_action = 'cancel' THEN
    IF char_length(btrim(COALESCE(v_payload->>'reason', ''))) < 3 THEN
      RAISE EXCEPTION 'member_cancel_reason_required' USING ERRCODE = '22023';
    END IF;
    v_result := public.issue_4490_member_change(v_sub.id, 'leave', 'staff', v_uid, v_payload, NULL, 'host');
  ELSIF p_action = 'undo_cancel' THEN
    v_result := public.issue_4490_member_change(v_sub.id, 'stay', 'staff', v_uid, v_payload, NULL, 'host');
  ELSIF p_action IN ('pause', 'resume') THEN
    v_result := public.issue_4490_member_change(v_sub.id, p_action, 'staff', v_uid, v_payload, NULL, 'host');
  ELSIF p_action = 'send_link' THEN
    SELECT * INTO v_period FROM public.venue_membership_periods WHERE id = public.issue_4490_member_open_period(v_sub.id);
    IF NOT FOUND OR v_sub.status = 'cancelled' THEN
      RAISE EXCEPTION 'membership_nothing_to_pay' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_membership_events e WHERE e.subscription_id = v_sub.id
               AND e.event_type = 'member_link_sent' AND e.created_at > now() - interval '10 minutes') THEN
      RAISE EXCEPTION 'member_link_too_soon' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.issue_4490_member_event(v_sub.id, v_period.id, 'member_link_sent', 'staff', v_uid, '{}'::jsonb, NULL);
    PERFORM public.issue_4490_member_enqueue(v_sub.id, v_period.id, 'venue_membership_renewal',
      'resend-' || floor(extract(epoch FROM now()))::bigint);
    v_result := public.issue_4490_member_projection(v_sub.id, 'host', NULL);
  ELSE -- mark_paid
    IF COALESCE(v_payload->>'method', '') NOT IN ('cash', 'transfer', 'card_at_venue', 'other')
       OR char_length(COALESCE(v_payload->>'note', '')) > 300 THEN
      RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_period FROM public.venue_membership_periods
    WHERE id = COALESCE(NULLIF(v_payload->>'periodId', '')::uuid, public.issue_4490_member_open_period(v_sub.id))
      AND subscription_id = v_sub.id FOR UPDATE;
    IF NOT FOUND OR v_period.status NOT IN ('scheduled', 'link_sent', 'overdue') OR v_sub.status = 'cancelled' THEN
      RAISE EXCEPTION 'membership_nothing_to_pay' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = v_period.group_id
               AND a.state IN ('pending', 'ambiguous')) THEN
      RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
    END IF;
    PERFORM public.issue_4490_membership_period_paid(v_period.id, NULL, 'venue', v_payload->>'method',
      NULLIF(btrim(COALESCE(v_payload->>'note', '')), ''), v_uid);
    v_result := public.issue_4490_member_projection(v_sub.id, 'host', NULL);
  END IF;
  v_result := v_result || jsonb_build_object('replayed', false);
  PERFORM public.issue_4490_receipt_store('member:' || p_subscription_id, p_idempotency_key, v_hash, v_result);
  RETURN v_result;
END;
$function$;

-- Admin: read-only plans and members of one venue.
CREATE OR REPLACE FUNCTION public.issue_4490_admin_memberships(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'plans', COALESCE((SELECT jsonb_agg(public.issue_4490_membership_plan_projection(p.id) ORDER BY p.sort_order, p.created_at)
                       FROM public.venue_membership_plans p JOIN public.stay_offerings o ON o.id = p.offering_id
                       WHERE o.venue_id = p_venue_id), '[]'::jsonb),
    'members', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'subscriptionId', s.id, 'name', s.member_name, 'planName', p.name, 'status', s.status,
        'activeUntil', s.current_period_end, 'endedAt', s.cancelled_at, 'endReason', s.end_reason,
        'paidMonths', (SELECT count(*) FROM public.venue_membership_periods pe WHERE pe.subscription_id = s.id AND pe.status = 'paid'),
        'joinedAt', s.created_at) ORDER BY s.created_at DESC)
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans p ON p.id = s.plan_id
      JOIN public.stay_offerings o ON o.id = p.offering_id
      WHERE o.venue_id = p_venue_id), '[]'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Member check-in (scan or from the list): one visit a day; guests on
--     guest passes; a plan with entry included counts against its entry
--     offer's day limit (drawn like a gate sale; the member is always let in,
--     guests only while the day has room).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_admit_member(
  p_venue public.venue_listings,
  p_subscription_id uuid,
  p_guests integer,
  p_scanner uuid,
  p_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_today date := public.issue_4490_venue_local_date(p_venue.id);
  v_guests integer := COALESCE(p_guests, 0);
  v_result text;
  v_log uuid;
  v_visit uuid;
  v_pool uuid;
  v_usage record;
  v_period uuid;
  v_period_end timestamptz;
  v_view jsonb;
BEGIN
  IF v_guests NOT BETWEEN 0 AND 20 THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.venue_check_in_log (venue_id, brand_id, result, admitted_delta, method, scanner_user_id, local_date, detail)
    VALUES (p_venue.id, p_venue.brand_id, 'not_found', 0, p_method, p_scanner, v_today, '{"kind":"member"}'::jsonb)
    RETURNING id INTO v_log;
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log, 'kind', 'member');
  END IF;
  IF public.issue_4490_member_venue(v_sub.id) IS DISTINCT FROM p_venue.id THEN
    INSERT INTO public.venue_check_in_log (venue_id, brand_id, result, admitted_delta, method, scanner_user_id, local_date, detail)
    VALUES (p_venue.id, p_venue.brand_id, 'wrong_venue', 0, p_method, p_scanner, v_today, '{"kind":"member"}'::jsonb)
    RETURNING id INTO v_log;
    RETURN jsonb_build_object('result', 'wrong_venue', 'logId', v_log, 'kind', 'member',
      'venueName', (SELECT v.name FROM public.venue_listings v WHERE v.id = public.issue_4490_member_venue(v_sub.id)));
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  IF v_sub.status NOT IN ('active', 'payment_due', 'grace') THEN
    v_result := 'void';
  ELSIF v_sub.start_on > v_today THEN
    v_result := 'not_yet';
  ELSIF EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = v_sub.id
                AND x.local_date = v_today AND x.undone_at IS NULL) THEN
    v_result := 'already_used';
  END IF;
  IF v_result IS NOT NULL THEN
    INSERT INTO public.venue_check_in_log (venue_id, brand_id, subscription_id, result, admitted_delta, method,
      scanner_user_id, local_date, detail)
    VALUES (p_venue.id, p_venue.brand_id, v_sub.id, v_result, 0, p_method, p_scanner, v_today,
      jsonb_build_object('kind', 'member', 'memberStatus', v_sub.status))
    RETURNING id INTO v_log;
    RETURN jsonb_build_object('result', v_result, 'logId', v_log, 'kind', 'member',
      'member', public.issue_4490_member_projection(v_sub.id, 'check_in', NULL));
  END IF;
  IF v_guests > 0 AND public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', now()) < v_guests THEN
    RAISE EXCEPTION 'member_guest_passes_used_up' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('left', public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', now()))::text;
  END IF;
  IF v_plan.entry_included THEN
    SELECT o.capacity_pool_id INTO v_pool FROM public.stay_offerings o WHERE o.id = v_plan.entry_offering_id;
  END IF;
  IF v_pool IS NOT NULL THEN
    PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_pool FOR UPDATE;
    IF v_guests > 0 THEN
      SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_pool, v_today);
      IF COALESCE(v_usage.gate_left, 0) < 1 + v_guests THEN
        RAISE EXCEPTION 'member_guests_day_full' USING ERRCODE = 'PT409',
          DETAIL = jsonb_build_object('left', GREATEST(COALESCE(v_usage.gate_left, 0) - 1, 0))::text;
      END IF;
    END IF;
  END IF;
  INSERT INTO public.venue_check_in_log (venue_id, brand_id, subscription_id, result, admitted_delta, method,
    scanner_user_id, local_date, detail)
  VALUES (p_venue.id, p_venue.brand_id, v_sub.id, 'admitted', 1 + v_guests, p_method, p_scanner, v_today,
    jsonb_build_object('kind', 'member', 'guests', v_guests, 'memberStatus', v_sub.status))
  RETURNING id INTO v_log;
  INSERT INTO public.venue_member_visits (subscription_id, local_date, pool_id, guests, log_id, scanner_user_id)
  VALUES (v_sub.id, v_today, v_pool, v_guests, v_log, p_scanner)
  RETURNING id INTO v_visit;
  IF v_guests > 0 THEN
    v_period := public.issue_4490_member_period_at(v_sub.id, now());
    SELECT period_end INTO v_period_end FROM public.venue_membership_periods WHERE id = v_period;
    INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, visit_id, expires_at, idempotency_key)
    VALUES (v_sub.id, v_period, 'guest_passes', 'spend', -v_guests, v_visit, v_period_end, 'visit:' || v_visit || ':guest_passes');
  END IF;
  v_view := public.issue_4490_member_projection(v_sub.id, 'check_in', NULL);
  RETURN jsonb_build_object('result', 'admitted', 'admitted', 1 + v_guests, 'logId', v_log, 'kind', 'member',
    'balanceDueMinor', 0, 'paymentDue', v_sub.status IN ('payment_due', 'grace'), 'member', v_view);
END;
$function$;

-- From the list (edge venue-check-in action admit_member).
CREATE OR REPLACE FUNCTION public.issue_4490_check_in_member(
  p_venue_id uuid,
  p_subscription_id uuid,
  p_guests integer,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  IF p_subscription_id IS NULL THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN public.issue_4490_admit_member(v_venue, p_subscription_id, p_guests, p_scanner_user_id, 'manual');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 13. Redefined functions (each is its previous definition plus the marked
--     #4490 P6 change).
-- ---------------------------------------------------------------------------
-- 4188 venue capability helper: + venue.manage_members (from 20281203004490_issue_4490_p1_spaces_features.sql)
CREATE OR REPLACE FUNCTION public.issue_4188_has_venue_capability(
  p_venue_id uuid,
  p_user_id uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = auth.uid()
    AND p_capability = ANY(ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations',
      'venue.manage_offers',
      'venue.manage_bookings',
      'venue.view_bookings',
      'venue.check_in',
      'venue.manage_money',
      'venue.manage_members'
    ]::text[])
    AND EXISTS (
      SELECT 1
      FROM public.brand_team_members member
      JOIN public.brand_team_member_venue_grants grant_row
        ON grant_row.member_id = member.id
      JOIN public.venue_listings venue
        ON venue.id = grant_row.venue_id
       AND venue.brand_id = member.brand_id
      WHERE member.user_id = p_user_id
        AND member.role = 'venue_staff'
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
        AND grant_row.venue_id = p_venue_id
        AND p_capability = ANY(grant_row.capabilities)
    );
$function$;

-- grant writer: + venue.manage_members (from 20281203064490_issue_4490_p1_venue_grants.sql)
CREATE OR REPLACE FUNCTION public.issue_4188_set_member_venue_grants(
  p_brand_id uuid,
  p_member_id uuid,
  p_grants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
     OR public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_grants) <> 'array'
     OR jsonb_array_length(p_grants) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(*) <> count(DISTINCT grant_row->>'venueId')
    FROM jsonb_array_elements(p_grants) grant_row
  ) THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_member
  FROM public.brand_team_members member
  WHERE member.id = p_member_id
    AND member.brand_id = p_brand_id
    AND member.role = 'venue_staff'
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_grants) grant_row
    WHERE jsonb_typeof(grant_row) <> 'object'
      OR NOT (grant_row ? 'venueId')
      OR NOT (grant_row ? 'profile')
      OR NOT (grant_row ? 'capabilities')
      OR jsonb_typeof(grant_row->'capabilities') <> 'array'
      OR jsonb_array_length(grant_row->'capabilities') = 0
      OR grant_row->>'profile' NOT IN (
        'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.venue_listings venue
        WHERE venue.id = (grant_row->>'venueId')::uuid
          AND venue.brand_id = p_brand_id
          AND (
            (
              venue.venue_category = 'stay'
              AND grant_row->>'profile' IN ('front_desk', 'custom')
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'stay.%'
              )
            )
            OR (
              -- #4490: every non-stay venue type takes the venue capabilities.
              venue.venue_category IN (
                'restaurant', 'play', 'creative_and_arts', 'bar_lounge',
                'club', 'cafe', 'event_space', 'coworking'
              )
              AND grant_row->>'profile' IN (
                'restaurant_manager', 'kitchen_bar', 'custom'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'restaurant.%'
                  AND capability NOT LIKE 'venue.%'
              )
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(grant_row->'capabilities') capability
        WHERE capability <> ALL(ARRAY[
          'stay.view_reservations',
          'stay.create_reservations',
          'stay.manage_reservations',
          'stay.view_availability',
          'restaurant.view_orders',
          'restaurant.manage_orders',
          'restaurant.manage_menu',
          'restaurant.manage_qr',
          'restaurant.manage_reservations',
          'venue.manage_offers',
          'venue.manage_bookings',
          'venue.view_bookings',
          'venue.check_in',
          'venue.manage_money',
          'venue.manage_members'
        ]::text[])
      )
  ) THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.brand_team_member_venue_grants
  WHERE member_id = p_member_id;
  INSERT INTO public.brand_team_member_venue_grants (
    member_id, venue_id, access_profile, capabilities
  )
  SELECT
    p_member_id,
    (grant_row->>'venueId')::uuid,
    grant_row->>'profile',
    ARRAY(
      SELECT DISTINCT capability
      FROM jsonb_array_elements_text(grant_row->'capabilities') capability
      ORDER BY capability
    )
  FROM jsonb_array_elements(p_grants) grant_row;

  RETURN jsonb_build_object(
    'memberId', p_member_id,
    'venueCount', jsonb_array_length(p_grants)
  );
END;
$function$;

-- built features: + memberships (from 20281203164490_issue_4490_p5_tables_floor_hour.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays', 'entry',
               'group_packages', 'private_hire', 'floor_plan', 'pick_a_table', 'min_spend_tables',
               'by_the_hour', 'memberships']::text[];
$function$;

-- group state: membership months, credits back (from 20281203084490_issue_4490_p2_offer_checkout.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_on_offer_group_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.offer_kind IS NULL OR NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;
  -- #4490 P6: a membership month's payment marks the month paid (no pass).
  IF NEW.offer_kind = 'membership' THEN
    IF NEW.state = 'confirmed' THEN
      PERFORM public.issue_4490_membership_period_paid(
        (NEW.payment_plan_snapshot->'membership'->>'periodId')::uuid, NEW.id, 'online', NULL, NULL, NULL);
    END IF;
    RETURN NEW;
  END IF;
  -- #4490 P6: member credits spent on a booking come back when it is
  -- cancelled or its hold lapses.
  IF NEW.state IN ('cancelled', 'request_expired', 'declined') THEN
    PERFORM public.issue_4490_member_return_credits(NEW.id);
  END IF;
  IF NEW.state = 'confirmed' THEN
    PERFORM public.issue_4490_issue_offer_pass(NEW.id);
  ELSIF NEW.state IN ('cancelled', 'partially_cancelled') AND OLD.state IN ('confirmed', 'partially_cancelled') THEN
    UPDATE public.venue_passes
    SET status = CASE WHEN EXISTS (
          SELECT 1 FROM public.stay_refunds r WHERE r.group_id = NEW.id AND r.amount_minor > 0)
          THEN 'refunded' ELSE 'void' END,
        version = version + 1, updated_at = now()
    WHERE group_id = NEW.id AND status = 'valid' AND NEW.state = 'cancelled';
  END IF;
  RETURN NEW;
END;
$function$;

-- offer messages: membership months excluded (from 20281203154490_issue_4490_p4_private_hire.sql)
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
  v_host_category text;
  v_email text;
  v_payload jsonb;
  v_recipient record;
BEGIN
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RETURN;
  END IF;
  -- #4490 P6: membership months send their own messages (period paid).
  IF p_group.offer_kind = 'membership' THEN
    RETURN;
  END IF;
  v_category := CASE p_event.event_type
    WHEN 'stay_reservation_confirmed' THEN 'venue_booking_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'venue_booking_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'venue_refund_state'
    WHEN 'stay_offer_balance_due' THEN 'venue_balance_due'
    WHEN 'stay_offer_balance_overdue' THEN 'venue_balance_overdue'
    WHEN 'stay_offer_changed' THEN 'venue_booking_changed'
    WHEN 'stay_offer_balance_paid' THEN 'venue_balance_paid'
    WHEN 'stay_offer_paid_at_venue' THEN 'venue_balance_paid'
    -- #4490 P4: requests and holds.
    WHEN 'stay_offer_request_sent' THEN 'venue_request_received'
    WHEN 'stay_offer_request_approved' THEN 'venue_payment_required'
    WHEN 'stay_offer_hold_expiring' THEN 'venue_hold_expiring'
    WHEN 'stay_offer_request_declined' THEN 'venue_request_declined'
    WHEN 'stay_request_expired' THEN 'venue_request_expired'
    WHEN 'stay_offer_hold_released' THEN 'venue_request_expired'
    WHEN 'stay_offer_hold_force_expired' THEN 'venue_request_expired'
    ELSE NULL END;
  v_host_category := CASE p_event.event_type
    WHEN 'stay_offer_request_sent' THEN 'venue_request_action_needed'
    WHEN 'stay_offer_queue_released' THEN 'venue_request_action_needed'
    ELSE NULL END;
  IF (v_category IS NULL AND v_host_category IS NULL) OR p_group.payment_collection <> 'mingla' THEN
    RETURN;
  END IF;
  v_payload := jsonb_build_object(
      'venue_group_id', p_group.id,
      'public_reference', p_group.public_reference,
      'venue_id', p_group.venue_id,
      'offer_kind', p_group.offer_kind,
      'amount_cents', COALESCE((p_event.safe_metadata->>'amountMinor')::bigint, p_group.total_minor),
      'currency', p_group.currency_code
    ) || jsonb_strip_nulls(jsonb_build_object(
      'balance_due_at', p_group.balance_due_at,
      'change_action', p_event.safe_metadata->>'action',
      'reminder_reason', COALESCE(p_event.safe_metadata->>'reason',
        CASE p_event.event_type
          WHEN 'stay_offer_hold_released' THEN 'released'
          WHEN 'stay_offer_queue_released' THEN 'next_in_line'
          WHEN 'stay_request_expired' THEN
            CASE WHEN p_event.safe_metadata->>'priorState' = 'approved_payment_required' THEN 'not_paid' ELSE 'no_reply' END
        END),
      'hold_until', COALESCE(p_event.safe_metadata->>'holdUntil', p_event.safe_metadata->>'holdExpiresAt')));
  IF v_category IS NOT NULL THEN
    v_email := NULLIF(lower(btrim(COALESCE(p_group.guest_snapshot->>'email', ''))), '');
    IF v_email IS NOT NULL OR p_group.user_id IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
      ) VALUES (
        v_category, p_group.user_id, v_email, p_group.brand_id, v_payload,
        'venue-offer:' || p_event.id || ':' || v_category || ':guest', NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  IF v_host_category IS NOT NULL THEN
    -- The venue's people who answer requests (no guest link in their copy).
    FOR v_recipient IN
      SELECT DISTINCT r.user_id, lower(u.email) AS email
      FROM (
        SELECT b.account_id AS user_id FROM public.brands b WHERE b.id = p_group.brand_id
        UNION
        SELECT m.user_id FROM public.brand_team_members m
        WHERE m.brand_id = p_group.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
          AND m.role IN ('brand_owner', 'brand_admin', 'event_manager')
        UNION
        SELECT m.user_id FROM public.brand_team_members m
        JOIN public.brand_team_member_venue_grants gr ON gr.member_id = m.id
        WHERE m.brand_id = p_group.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
          AND gr.venue_id = p_group.venue_id AND 'venue.manage_bookings' = ANY(gr.capabilities)
      ) r
      JOIN auth.users u ON u.id = r.user_id
      ORDER BY r.user_id
    LOOP
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
      ) VALUES (
        v_host_category, v_recipient.user_id, v_recipient.email, p_group.brand_id, v_payload,
        'venue-offer:' || p_event.id || ':' || v_host_category || ':user:' || v_recipient.user_id, NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;
  END IF;
END;
$function$;

-- hold: member credits spent (from 20281203164490_issue_4490_p5_tables_floor_hour.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_create_offer_group(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_quotes q WHERE q.id = p_quote_id AND q.offer_kind IN ('private_hire', 'by_the_hour')) THEN
    v_id := public.issue_4490_hold_hire_internal(
      p_group_id, p_quote_id, p_guest, p_actor_key, p_user_id, p_buyer_token_hash, p_idempotency_key);
  ELSE
    v_id := public.issue_4490_hold_offer_internal(
      p_group_id, p_quote_id, p_guest, p_actor_key, p_user_id, p_buyer_token_hash,
      p_idempotency_key, false, NULL, 'mingla');
  END IF;
  -- #4490 P6: spend the member credits the price used; a booking that owes
  -- nothing is confirmed now.
  PERFORM public.issue_4490_member_spend(v_id);
  RETURN public.issue_4490_booking_projection(v_id, NULL);
END;
$function$;

-- Host offers list: plan offerings hidden (from 20281203134490_issue_4490_p3_collect_online.sql)
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
    'canCollectOnline', (SELECT public.issue_4490_can_collect_online(v.brand_id, v.id)
                         FROM public.venue_listings v WHERE v.id = p_venue_id),
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
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place', 'membership') AND o.status <> 'archived'), '[]'::jsonb)
  );
END;
$function$;

-- my bookings: membership months excluded (from 20281203084490_issue_4490_p2_offer_checkout.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_my_offer_bookings()
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
    SELECT jsonb_agg(public.issue_4490_booking_projection(g.id, NULL) ORDER BY g.created_at DESC, g.id DESC)
    FROM public.stay_reservation_groups g
    WHERE g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership' AND g.payment_collection = 'mingla'
      AND (g.user_id = v_uid OR g.booked_by_user_id = v_uid)
  ), '[]'::jsonb);
END;
$function$;

-- public page: memberships block (from 20281203164490_issue_4490_p5_tables_floor_hour.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_venue_page_payload(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row jsonb;
  v_features text[];
  v_currency text;
  v_brand_slug text;
  v_spaces jsonb;
  v_events jsonb;
  v_tables jsonb;
  v_version bigint;
  v_offers jsonb;
  v_vat jsonb;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_row := public.issue_4490_venue_page_row(p_venue_id);
  v_features := public.issue_4490_public_features(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')), b.slug
    INTO v_currency, v_brand_slug
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'setting', s.setting,
      'capacityStanding', s.capacity_standing,
      'capacitySeated', s.capacity_seated,
      'planShape', s.plan_shape,
      'photoUrls', (SELECT COALESCE(jsonb_agg(p->>'url' ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(s.photos) WITH ORDINALITY AS ph(p, i))
    )) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
  INTO v_spaces
  FROM public.venue_spaces s
  WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL;

  IF 'events_here' = ANY(v_features) THEN
    SELECT COALESCE(jsonb_agg(item ORDER BY starts_at), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT jsonb_build_object(
          'id', e.id,
          'kind', e.event_type,
          'title', e.title,
          'startsAt', nd.starts_at,
          'spaceName', sp.name,
          'fromMinor', (SELECT min(tt.price_cents) FROM public.ticket_types tt
                        WHERE tt.event_id = e.id AND tt.deleted_at IS NULL
                          AND NOT COALESCE(tt.is_hidden, false) AND NOT COALESCE(tt.is_disabled, false)),
          'href', CASE e.event_type
                    WHEN 'experience' THEN '/exp/' || v_brand_slug || '/' || e.slug
                    WHEN 'trip' THEN '/t/' || v_brand_slug || '/' || e.slug
                    ELSE '/e/' || v_brand_slug || '/' || e.slug END
        ) AS item,
        nd.starts_at
      FROM public.events e
      CROSS JOIN LATERAL (
        SELECT min(d.start_at) AS starts_at FROM public.event_dates d
        WHERE d.event_id = e.id AND d.start_at > now()
      ) nd
      LEFT JOIN public.venue_spaces sp ON sp.id = e.space_id
      WHERE e.venue_id = p_venue_id
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
        AND e.deleted_at IS NULL
        AND e.slug IS NOT NULL
        AND nd.starts_at IS NOT NULL
      ORDER BY nd.starts_at
      LIMIT 6
    ) upcoming;
  ELSE
    v_events := '[]'::jsonb;
  END IF;

  -- #4490 P5: the tables block (party cap incl. joined tables, pick a table,
  -- hold / minimum spend from, big-party request, guest waitlist).
  v_tables := public.issue_4490_public_tables(p_venue_id, v_features);

  -- #4490 P2: live offers of publicly enabled kinds, and the venue's VAT mode.
  v_offers := public.issue_4490_public_offers(p_venue_id, v_features);
  SELECT jsonb_build_object(
      'mode', s.vat_mode,
      'ratePct', COALESCE((SELECT c.vat_rate_bps FROM public.country_vat_config c
                           WHERE c.country = upper(v_venue.country_code)), 0)::numeric / 100)
    INTO v_vat
  FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id;
  IF jsonb_array_length(v_offers) = 0 THEN
    v_vat := NULL;
  END IF;

  SELECT GREATEST(
      COALESCE((SELECT max(f.version) FROM public.venue_features f WHERE f.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(s.version) FROM public.venue_spaces s WHERE s.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(o.version) FROM public.stay_offerings o
                WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place')), 0))
  INTO v_version;

  RETURN jsonb_build_object(
    'version', v_version,
    'venue', v_row,
    'currencyCode', v_currency,
    -- #4490 W3 fix 1: the exponent comes from its one owner (supported_brand_currencies).
    'minorUnitExponent', COALESCE((SELECT c.minor_unit_exponent FROM public.supported_brand_currencies c
                                   WHERE c.code = v_currency), 2),
    'vat', v_vat,
    'features', to_jsonb(v_features),
    'spaces', v_spaces,
    'hours', jsonb_build_object('weekly', v_row->'hours_windows', 'specialDays', v_row->'special_hours'),
    'events', jsonb_build_object('upcoming', v_events),
    'tables', v_tables,
    'offers', v_offers,
    'memberships', public.issue_4490_public_memberships(p_venue_id, v_features)
  );
END;
$function$;

-- pool day usage: member visits (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_pool_day_usage(p_pool_id uuid, p_local_date date)
RETURNS TABLE (
  limit_effective integer,
  kept integer,
  used integer,
  online_left integer,
  gate_left integer,
  closed boolean,
  used_online integer,
  used_gate integer,
  kept_left integer,
  hire_cut integer,
  venue_hired boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_override public.venue_capacity_overrides%ROWTYPE;
  v_limit integer;
  v_base integer;
  v_kept integer;
  v_online integer;
  v_gate integer;
  v_closed boolean;
  v_tz text;
  v_day tstzrange;
  v_scope uuid[];
  v_cut integer := 0;
  v_hired integer := 0;
BEGIN
  SELECT * INTO v_pool FROM public.venue_capacity_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_override FROM public.venue_capacity_overrides
  WHERE pool_id = p_pool_id AND local_date = p_local_date;
  v_closed := COALESCE(v_override.closed, false)
    OR public.issue_4490_day_closed(v_pool.venue_id, p_local_date);
  v_base := COALESCE(v_override.daily_limit, v_pool.daily_limit);
  -- #4490 P4: spaces under an active private hire or exclusive event that day.
  v_tz := public.issue_4490_venue_timezone(v_pool.venue_id);
  v_day := tstzrange(p_local_date::timestamp AT TIME ZONE v_tz, (p_local_date + 1)::timestamp AT TIME ZONE v_tz, '[)');
  v_scope := COALESCE(v_pool.space_ids, (
    SELECT array_agg(s.id) FROM public.venue_spaces s
    WHERE s.venue_id = v_pool.venue_id AND s.is_active AND s.archived_at IS NULL));
  IF v_scope IS NOT NULL THEN
    SELECT COALESCE(sum(COALESCE(s.capacity_standing, s.capacity_seated, 0)), 0)::integer, count(*)::integer
    INTO v_cut, v_hired
    FROM public.venue_spaces s
    WHERE s.id = ANY(v_scope)
      AND EXISTS (
        SELECT 1 FROM public.venue_space_claims c
        LEFT JOIN public.stay_reservation_groups g ON g.id = c.group_id
        WHERE c.space_id = s.id
          AND c.booked_range && v_day
          AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))
          AND (c.source = 'event' OR (c.source = 'booking' AND g.offer_kind = 'private_hire')));
  END IF;
  venue_hired := v_scope IS NOT NULL AND v_hired > 0 AND v_hired >= cardinality(v_scope);
  hire_cut := CASE WHEN venue_hired THEN v_base ELSE LEAST(v_cut, v_base) END;
  v_closed := v_closed OR venue_hired;
  v_limit := CASE WHEN v_closed THEN 0 ELSE GREATEST(v_base - hire_cut, 0) END;
  v_kept := LEAST(COALESCE(v_override.kept_for_walk_ins, v_pool.kept_for_walk_ins), v_limit);
  -- Usage by channel: gate sales (walk-in bookings) draw the kept seats first.
  SELECT COALESCE(sum(quantity) FILTER (WHERE NOT is_gate), 0)::integer,
         COALESCE(sum(quantity) FILTER (WHERE is_gate), 0)::integer
  INTO v_online, v_gate
  FROM (
    SELECT slice_row.quantity, group_row.booking_source = 'walk_in' AS is_gate
    FROM public.stay_inventory_hold_slices slice_row
    JOIN public.stay_inventory_holds hold_row ON hold_row.id = slice_row.hold_id
    JOIN public.stay_reservation_groups group_row ON group_row.id = hold_row.group_id
    JOIN public.stay_place_windows window_row ON window_row.id = slice_row.place_window_id
    JOIN public.stay_offerings offering ON offering.id = slice_row.offering_id
    WHERE offering.capacity_pool_id = p_pool_id
      AND window_row.local_date = p_local_date
      AND (
        (hold_row.state = 'active' AND hold_row.expires_at > now())
        OR hold_row.state = 'reconciliation_required'
      )
    UNION ALL
    SELECT commitment.quantity, group_row.booking_source = 'walk_in'
    FROM public.stay_inventory_commitments commitment
    JOIN public.stay_reservation_groups group_row ON group_row.id = commitment.group_id
    JOIN public.stay_place_windows window_row ON window_row.id = commitment.place_window_id
    JOIN public.stay_offerings offering ON offering.id = commitment.offering_id
    WHERE offering.capacity_pool_id = p_pool_id
      AND window_row.local_date = p_local_date
      AND commitment.state = 'active'
    -- #4490 P6: members (and their guests) checked in on a plan whose entry
    -- counts against this pool, drawn like gate sales.
    UNION ALL
    SELECT (1 + visit.guests)::integer, true
    FROM public.venue_member_visits visit
    WHERE visit.pool_id = p_pool_id
      AND visit.local_date = p_local_date
      AND visit.undone_at IS NULL
  ) usage_rows;
  limit_effective := v_limit;
  kept := v_kept;
  used := v_online + v_gate;
  used_online := v_online;
  used_gate := v_gate;
  kept_left := GREATEST(v_kept - v_gate, 0);
  online_left := GREATEST(v_limit - v_kept - v_online - GREATEST(v_gate - v_kept, 0), 0);
  gate_left := GREATEST(v_limit - v_online - v_gate, 0);
  closed := v_closed;
  RETURN NEXT;
END;
$function$;

-- scan: member passes (from 20281203094490_issue_4490_p2_check_in.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_check_in_scan(
  p_venue_id uuid,
  p_qr_payload text,
  p_admit_count integer,
  p_id_checked boolean,
  p_scanner_user_id uuid,
  p_qr_pepper text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_match text[];
  v_pass public.venue_passes%ROWTYPE;
  v_pepper text;
  v_ticket_id uuid;
  v_event_id uuid;
  v_event_venue uuid;
  v_scan jsonb;
  v_result text;
  v_log uuid;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_pepper);
  IF p_admit_count IS NOT NULL AND p_admit_count NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  -- #4490 P6: a member pass.
  v_match := regexp_match(COALESCE(btrim(p_qr_payload), ''),
    '^mingla:v1:vmember:([0-9a-f-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venue_membership_subscriptions s
      WHERE s.id = v_match[1]::uuid
        AND btrim(p_qr_payload) = public.issue_4490_member_qr_payload(s.id, s.qr_token_hash, v_pepper)) THEN
      v_log := public.issue_4490_log_check_in(v_venue, NULL, NULL, NULL, 'not_found', 0, 'scan', p_scanner_user_id,
        '{"kind":"member"}'::jsonb);
      RETURN jsonb_build_object('result', 'not_found', 'logId', v_log, 'kind', 'member');
    END IF;
    RETURN public.issue_4490_admit_member(v_venue, v_match[1]::uuid, GREATEST(COALESCE(p_admit_count, 1) - 1, 0),
      p_scanner_user_id, 'scan');
  END IF;

  v_match := regexp_match(COALESCE(btrim(p_qr_payload), ''),
    '^mingla:v1:vpass:([0-9a-f-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NOT NULL THEN
    SELECT * INTO v_pass FROM public.venue_passes WHERE id = v_match[1]::uuid;
    IF NOT FOUND OR btrim(p_qr_payload) <> public.issue_4490_pass_qr_payload(v_pass.id, v_pass.qr_token_hash, v_pepper) THEN
      v_log := public.issue_4490_log_check_in(v_venue, NULL, NULL, NULL, 'not_found', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
      RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
    END IF;
    RETURN public.issue_4490_admit_pass(v_venue, v_pass.id, p_admit_count, p_id_checked, p_scanner_user_id, 'scan');
  END IF;

  v_match := regexp_match(COALESCE(btrim(p_qr_payload), ''),
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NULL THEN
    v_log := public.issue_4490_log_check_in(v_venue, NULL, NULL, NULL, 'not_found', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
  END IF;
  v_ticket_id := v_match[1]::uuid;
  SELECT t.event_id, e.venue_id INTO v_event_id, v_event_venue
  FROM public.tickets t JOIN public.events e ON e.id = t.event_id
  WHERE t.id = v_ticket_id;
  IF v_event_id IS NULL THEN
    v_log := public.issue_4490_log_check_in(v_venue, NULL, v_ticket_id, NULL, 'not_found', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
  END IF;
  IF v_event_venue IS DISTINCT FROM v_venue.id THEN
    v_log := public.issue_4490_log_check_in(v_venue, NULL, v_ticket_id, v_event_id, 'wrong_venue', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'wrong_venue', 'logId', v_log, 'kind', 'event_ticket');
  END IF;
  BEGIN
    v_scan := public.biz_ticket_scan(v_event_id, btrim(p_qr_payload), p_scanner_user_id, v_pepper);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'scanner_not_authorized' THEN
      RAISE EXCEPTION 'event_scan_not_allowed' USING ERRCODE = '42501';
    END IF;
    RAISE;
  END;
  v_result := CASE v_scan->>'result'
    WHEN 'success' THEN 'admitted'
    WHEN 'duplicate' THEN 'already_used'
    WHEN 'void' THEN 'void'
    WHEN 'wrong_event' THEN 'wrong_venue'
    WHEN 'not_yet_open' THEN 'not_yet'
    WHEN 'event_ended' THEN 'wrong_day'
    ELSE 'not_found' END;
  v_log := public.issue_4490_log_check_in(v_venue, NULL, v_ticket_id, v_event_id, v_result,
    CASE WHEN v_result = 'admitted' THEN 1 ELSE 0 END, 'scan', p_scanner_user_id,
    jsonb_build_object('ticketResult', v_scan->>'result'));
  RETURN jsonb_build_object(
    'result', v_result, 'logId', v_log, 'kind', 'event_ticket', 'balanceDueMinor', 0,
    'ticket', jsonb_build_object(
      'ticketId', v_ticket_id, 'eventId', v_event_id,
      'holderName', v_scan->>'buyerName', 'ticketName', v_scan->>'ticketName',
      'nextStartAt', v_scan->'nextStartAt', 'lastEndAt', v_scan->'lastEndAt', 'scanId', v_scan->'scanId'));
END;
$function$;

-- undo: member check-ins (from 20281203094490_issue_4490_p2_check_in.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_check_in_undo(
  p_venue_id uuid,
  p_log_id uuid,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_log public.venue_check_in_log%ROWTYPE;
  v_pass public.venue_passes%ROWTYPE;
  v_new uuid;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  SELECT * INTO v_log FROM public.venue_check_in_log WHERE id = p_log_id;
  IF NOT FOUND OR v_log.venue_id <> v_venue.id THEN
    RAISE EXCEPTION 'check_in_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- #4490 P6: a member's check-in (the visit and its guest passes come back).
  IF v_log.subscription_id IS NOT NULL THEN
    IF v_log.result <> 'admitted' OR v_log.admitted_delta < 1 THEN
      RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
    END IF;
    IF v_log.created_at < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'check_in_undo_too_late' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_check_in_log u WHERE u.undoes_log_id = v_log.id) THEN
      RAISE EXCEPTION 'check_in_already_undone' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_member_visits SET undone_at = now() WHERE log_id = v_log.id AND undone_at IS NULL;
    INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, visit_id, expires_at, idempotency_key)
    SELECT l.subscription_id, l.period_id, l.credit, 'return', -l.amount, l.visit_id, l.expires_at, 'return:' || l.id
    FROM public.venue_credit_ledger l
    JOIN public.venue_member_visits x ON x.id = l.visit_id
    WHERE x.log_id = v_log.id AND l.entry = 'spend'
    ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.venue_check_in_log (venue_id, brand_id, subscription_id, result, admitted_delta, method,
      undoes_log_id, scanner_user_id, local_date, detail)
    VALUES (v_venue.id, v_venue.brand_id, v_log.subscription_id, 'undone', -v_log.admitted_delta, 'undo',
      v_log.id, p_scanner_user_id, public.issue_4490_venue_local_date(v_venue.id), '{"kind":"member"}'::jsonb)
    RETURNING id INTO v_new;
    RETURN jsonb_build_object('result', 'undone', 'logId', v_new, 'undid', v_log.admitted_delta, 'kind', 'member',
      'member', public.issue_4490_member_projection(v_log.subscription_id, 'check_in', NULL));
  END IF;
  IF v_log.result <> 'admitted' OR v_log.pass_id IS NULL OR v_log.admitted_delta < 1 THEN
    RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
  END IF;
  IF v_log.created_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'check_in_undo_too_late' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_check_in_log u WHERE u.undoes_log_id = v_log.id) THEN
    RAISE EXCEPTION 'check_in_already_undone' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_pass FROM public.venue_passes WHERE id = v_log.pass_id FOR UPDATE;
  IF v_pass.admitted_count < v_log.admitted_delta THEN
    RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_passes
  SET admitted_count = admitted_count - v_log.admitted_delta,
      first_admitted_at = CASE WHEN admitted_count - v_log.admitted_delta = 0 THEN NULL ELSE first_admitted_at END,
      last_admitted_at = CASE WHEN admitted_count - v_log.admitted_delta = 0 THEN NULL ELSE last_admitted_at END,
      version = version + 1, updated_at = now()
  WHERE id = v_pass.id
  RETURNING * INTO v_pass;
  v_new := public.issue_4490_log_check_in(v_venue, v_pass.id, NULL, NULL, 'undone', -v_log.admitted_delta, 'undo',
    p_scanner_user_id, '{}'::jsonb, v_log.id);
  RETURN jsonb_build_object('result', 'undone', 'logId', v_new, 'undid', v_log.admitted_delta,
    'pass', public.issue_4490_pass_view(v_pass.id));
END;
$function$;

-- check-in list: members (from 20281203144490_issue_4490_p3_packages_deposits.sql)
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
    -- #4490 P6: members who can come in today, and who is in.
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'kind', 'member',
          'subscriptionId', s.id,
          'holderName', s.member_name,
          'planName', p.name,
          'status', s.status,
          'paymentDue', s.status IN ('payment_due', 'grace'),
          'guestPassesLeft', public.issue_4490_member_credit_left(s.id, 'guest_passes', now()),
          'inToday', x.id IS NOT NULL,
          'guests', COALESCE(x.guests, 0),
          'logId', x.log_id,
          'checkedInAt', x.created_at)
        ORDER BY x.created_at NULLS LAST, s.member_name, s.id)
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans p ON p.id = s.plan_id
      JOIN public.stay_offerings o ON o.id = p.offering_id AND o.venue_id = p_venue_id
      LEFT JOIN public.venue_member_visits x ON x.subscription_id = s.id AND x.local_date = v_date AND x.undone_at IS NULL
      WHERE (s.status IN ('active', 'payment_due', 'grace') AND s.start_on <= v_date) OR x.id IS NOT NULL), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'admits', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date)
  );
END;
$function$;

-- Today: membership months excluded, members in (from 20281203144490_issue_4490_p3_packages_deposits.sql)
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
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place', 'membership') AND o.status IN ('live', 'paused')), '[]'::jsonb),
    -- #4490 P6: members checked in that day.
    'membersIn', (SELECT count(*) FROM public.venue_member_visits x
                  JOIN public.venue_membership_subscriptions s ON s.id = x.subscription_id
                  JOIN public.venue_membership_plans p ON p.id = s.plan_id
                  JOIN public.stay_offerings o ON o.id = p.offering_id
                  WHERE o.venue_id = p_venue_id AND x.local_date = v_date AND x.undone_at IS NULL),
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
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
        AND g.state IN ('confirmed', 'partially_cancelled', 'cancelled', 'reconciliation_required', 'instant_payment_pending')
        AND (SELECT w.local_date FROM public.stay_place_windows w
             WHERE w.id = public.issue_4490_group_window_id(g.id)) = v_date), '[]'::jsonb)
  );
END;
$function$;

-- day closure: membership months excluded (from 20281203144490_issue_4490_p3_packages_deposits.sql)
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
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
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

-- ---------------------------------------------------------------------------
-- 14. Messages (member only; the private member link is built at send time).
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels)
VALUES
  ('venue_membership_renewal', 'Venue bookings', true, 'high', ARRAY['inapp', 'email']),
  ('venue_membership_lapsed', 'Venue bookings', true, 'high', ARRAY['inapp', 'email']),
  ('venue_membership_paid', 'Venue bookings', true, 'normal', ARRAY['inapp', 'email']),
  ('venue_membership_ended', 'Venue bookings', true, 'normal', ARRAY['inapp', 'email'])
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 15. The billing clock: hourly (inactive on a local stack; the local start
--     script turns every cron job off).
-- ---------------------------------------------------------------------------
DO $issue_4490_membership_cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4490_membership_billing') THEN
    PERFORM cron.unschedule('issue_4490_membership_billing');
  END IF;
END
$issue_4490_membership_cron$;
SELECT cron.schedule(
  'issue_4490_membership_billing',
  '17 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'supabase_url'
        LIMIT 1
      ) || '/functions/v1/venue-membership-billing',
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
-- 16. Grants. Nobody by default; Host / member / Admin reads and writes to
--     authenticated (each checks its own rule); guest, billing and check-in
--     RPCs to the service role only (edge venue-offers,
--     venue-membership-pay-link, venue-membership-billing, venue-check-in).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_guard_member_history(),
  public.issue_4490_plan_venue(uuid),
  public.issue_4490_member_venue(uuid),
  public.issue_4490_can_view_members(uuid),
  public.issue_4490_user_can_manage_members(uuid, uuid),
  public.issue_4490_month_after(timestamptz, text),
  public.issue_4490_member_credit_left(uuid, text, timestamptz),
  public.issue_4490_member_period_at(uuid, timestamptz),
  public.issue_4490_member_open_period(uuid),
  public.issue_4490_member_event(uuid, uuid, text, text, uuid, jsonb, text),
  public.issue_4490_member_enqueue(uuid, uuid, text, text),
  public.issue_4490_member_qr_payload(uuid, text, text),
  public.issue_4490_membership_plan_projection(uuid),
  public.issue_4490_assert_plan_payload(uuid, jsonb, boolean),
  public.issue_4490_manage_membership_plan(text, uuid, jsonb, bigint, text),
  public.issue_4490_membership_plans(uuid),
  public.issue_4490_public_memberships(uuid, text[]),
  public.issue_4490_member_actor_ok(public.venue_membership_subscriptions, bytea, uuid),
  public.issue_4490_member_projection(uuid, text, text),
  public.issue_4490_membership_join(uuid, uuid, jsonb, date, text, uuid, bytea, text),
  public.issue_4490_membership_get(uuid, bytea, uuid, text),
  public.issue_4490_my_memberships(),
  public.issue_4490_member_leave_at(uuid, boolean),
  public.issue_4490_membership_member_action(uuid, bytea, uuid, text, text),
  public.issue_4490_member_change(uuid, text, text, uuid, jsonb, text, text),
  public.issue_4490_membership_period_group(uuid),
  public.issue_4490_membership_prepare_payment(uuid, bytea, uuid, text),
  public.issue_4490_membership_payment_group(uuid, bytea, uuid),
  public.issue_4490_membership_period_paid(uuid, uuid, text, text, text, uuid),
  public.issue_4490_member_quote(uuid, uuid, bytea, uuid, text, boolean),
  public.issue_4490_member_spend(uuid),
  public.issue_4490_member_return_credits(uuid),
  public.issue_4490_membership_billing_run(timestamptz, integer),
  public.issue_4490_venue_members(uuid, text),
  public.issue_4490_venue_member(uuid),
  public.issue_4490_manage_member(uuid, text, jsonb, bigint, text),
  public.issue_4490_admin_memberships(uuid),
  public.issue_4490_admit_member(public.venue_listings, uuid, integer, uuid, text),
  public.issue_4490_check_in_member(uuid, uuid, integer, uuid)
FROM PUBLIC, anon, authenticated;

-- Row-level reads call these as the reader.
GRANT EXECUTE ON FUNCTION
  public.issue_4490_plan_venue(uuid),
  public.issue_4490_member_venue(uuid),
  public.issue_4490_can_view_members(uuid)
TO authenticated, service_role;

-- Host, member and Admin RPCs (authenticated; each checks its own rule).
GRANT EXECUTE ON FUNCTION
  public.issue_4490_manage_membership_plan(text, uuid, jsonb, bigint, text),
  public.issue_4490_membership_plans(uuid),
  public.issue_4490_my_memberships(),
  public.issue_4490_venue_members(uuid, text),
  public.issue_4490_venue_member(uuid),
  public.issue_4490_manage_member(uuid, text, jsonb, bigint, text),
  public.issue_4490_admin_memberships(uuid)
TO authenticated;

-- Edge functions (service role).
GRANT EXECUTE ON FUNCTION
  public.issue_4490_membership_join(uuid, uuid, jsonb, date, text, uuid, bytea, text),
  public.issue_4490_membership_get(uuid, bytea, uuid, text),
  public.issue_4490_membership_member_action(uuid, bytea, uuid, text, text),
  public.issue_4490_membership_prepare_payment(uuid, bytea, uuid, text),
  public.issue_4490_membership_payment_group(uuid, bytea, uuid),
  public.issue_4490_member_quote(uuid, uuid, bytea, uuid, text, boolean),
  public.issue_4490_membership_billing_run(timestamptz, integer),
  public.issue_4490_check_in_member(uuid, uuid, integer, uuid)
TO service_role;

COMMIT;
