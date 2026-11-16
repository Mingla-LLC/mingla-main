-- issue #4238 W2 (items 4 and 5): ads that follow the event.
--
-- 1. ad_plan_automation_events: one row per automatic action Mingla takes (or
--    offers) on a live Host ad: the goal ladder switch, the last-tickets offer,
--    the slow-sales nudge, an auto pause or an auto end. The ladder, the
--    last-tickets offer and the nudge happen at most once per plan and app
--    (I-4238-ONE-GOAL-SWITCH, I-4238-LOW-STOCK-ONCE): the partial unique index
--    refuses a second row, so two concurrent sweeps can never switch twice.
-- 2. ad_spend_daily gains the platform-reported result counts (purchases,
--    started checkouts, sign-ups) that the ladder reads.
-- 3. ad_offering_stock(event, occurrence_key): how much is left to sell, told
--    apart from "not on sale yet" (the same tier predicates as
--    ad_offering_destination_by_id, WITHOUT the sale-window test), so the
--    sweep pauses with the true reason (I-4238-TRUE-PAUSE-REASON).
--
-- Service role only. No backfill, no RAISE guards on existing rows.

CREATE TABLE IF NOT EXISTS public.ad_plan_automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.ad_plans(id) ON DELETE CASCADE,
  campaign_id uuid NULL REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('meta','tiktok','snapchat','google','reddit')),
  kind text NOT NULL CHECK (kind IN ('goal_promoted','low_stock_copy','slow_sales_nudge','auto_paused','auto_ended')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NULL);

CREATE UNIQUE INDEX IF NOT EXISTS ad_plan_automation_events_once
  ON public.ad_plan_automation_events (plan_id, platform, kind)
  WHERE kind IN ('goal_promoted','low_stock_copy','slow_sales_nudge');

CREATE INDEX IF NOT EXISTS ad_plan_automation_events_plan
  ON public.ad_plan_automation_events (plan_id, created_at DESC);

ALTER TABLE public.ad_plan_automation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_plan_automation_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ad_plan_automation_events TO service_role;

COMMENT ON TABLE public.ad_plan_automation_events IS
  'issue #4238 W2: automatic actions on a Host ad (goal ladder, last-tickets offer, '
  'slow-sales nudge, auto pause, auto end). goal_promoted / low_stock_copy / '
  'slow_sales_nudge are unique per plan and app. Service role only.';

ALTER TABLE public.ad_spend_daily
  ADD COLUMN IF NOT EXISTS purchase_events bigint NULL CHECK (purchase_events IS NULL OR purchase_events >= 0),
  ADD COLUMN IF NOT EXISTS checkout_events bigint NULL CHECK (checkout_events IS NULL OR checkout_events >= 0),
  ADD COLUMN IF NOT EXISTS signup_events  bigint NULL CHECK (signup_events  IS NULL OR signup_events  >= 0);

COMMENT ON COLUMN public.ad_spend_daily.purchase_events IS
  'issue #4238 W2: platform-reported purchases that day (NULL = not reported).';

CREATE OR REPLACE FUNCTION public.ad_offering_stock(
  p_event_id uuid,
  p_occurrence_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_e record;
  v_key text := nullif(btrim(coalesce(p_occurrence_key, '')), '');
  v_going integer;
  v_total bigint := 0;
  v_remaining bigint := 0;
  v_unlimited boolean := false;
  v_tiers integer := 0;
  v_all_free boolean := false;
  v_price integer;
  v_currency text;
BEGIN
  SELECT e.id, e.event_type, e.rsvp_capacity, e.rsvp_waitlist_enabled,
    e.capacity_scope
  INTO v_e
  FROM public.events e
  WHERE e.id = p_event_id AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'event_not_found');
  END IF;

  IF v_e.event_type = 'rsvp' THEN
    SELECT coalesce(sum(1 + coalesce(r.plus_count, 0)), 0)::integer
    INTO v_going
    FROM public.event_rsvps r
    WHERE r.event_id = v_e.id
      AND r.rsvp_status = 'going'
      AND r.approval_status = 'approved';
    RETURN jsonb_build_object(
      'ok', true,
      'kind', 'rsvp',
      'occurrence_key', v_key,
      'total', v_e.rsvp_capacity,
      'remaining', CASE WHEN v_e.rsvp_capacity IS NULL THEN NULL
        ELSE greatest(v_e.rsvp_capacity - v_going, 0) END,
      'unlimited', v_e.rsvp_capacity IS NULL,
      -- A full RSVP with a waitlist still takes people, so it is not sold out.
      'sold_out', v_e.rsvp_capacity IS NOT NULL AND v_going >= v_e.rsvp_capacity
        AND v_e.rsvp_waitlist_enabled IS NOT TRUE,
      'waitlist', v_e.rsvp_waitlist_enabled IS TRUE,
      'all_free', true,
      'typical_price_cents', NULL,
      'currency', NULL
    );
  END IF;

  -- Tickets: the sellable tiers of ad_offering_destination_by_id, WITHOUT the
  -- sale-window test, so "sold out" and "not on sale yet" are told apart.
  WITH tiers AS (
    SELECT tt.id, tt.quantity_total, tt.valid_occurrence_keys, tt.price_cents,
      tt.is_free, tt.currency,
      (coalesce(tt.is_unlimited, false) IS TRUE
        OR tt.quantity_total IS NULL
        OR (v_e.event_type = 'experience'
            AND coalesce(v_e.capacity_scope, 'total') IN ('per_day', 'per_start'))
      ) AS unlimited
    FROM public.ticket_types tt
    WHERE tt.event_id = v_e.id
      AND tt.deleted_at IS NULL
      AND coalesce(tt.is_hidden, false) IS NOT TRUE
      AND coalesce(tt.is_disabled, false) IS NOT TRUE
      AND coalesce(tt.available_online, true) IS NOT FALSE
      AND coalesce(tt.password_protected, false) IS NOT TRUE
      AND (v_key IS NULL OR tt.valid_occurrence_keys IS NULL
           OR v_key = ANY (tt.valid_occurrence_keys))
  ),
  dated AS (
    -- The future, active dates each keyed tier covers (one date when keyed).
    SELECT t.id AS tier_id, d.id AS date_id
    FROM tiers t
    JOIN public.event_dates d ON d.event_id = v_e.id
    WHERE t.valid_occurrence_keys IS NOT NULL
      AND d.cancelled_at IS NULL
      AND coalesce(d.status, 'active') = 'active'
      AND (CASE WHEN v_e.event_type = 'trip' THEN d.start_at ELSE d.end_at END) > now()
      AND d.occurrence_key = ANY (t.valid_occurrence_keys)
      AND (v_key IS NULL OR d.occurrence_key = v_key)
  ),
  counted AS (
    SELECT t.id, t.unlimited, t.price_cents, t.is_free, t.currency,
      CASE
        WHEN t.unlimited THEN 0
        WHEN t.valid_occurrence_keys IS NULL THEN t.quantity_total::bigint
        ELSE t.quantity_total::bigint
          * (SELECT count(*) FROM dated x WHERE x.tier_id = t.id)
      END AS total,
      CASE
        WHEN t.unlimited THEN 0
        WHEN t.valid_occurrence_keys IS NULL THEN greatest(t.quantity_total - (
          SELECT count(*)::integer FROM public.tickets k
          WHERE k.ticket_type_id = t.id
            AND k.status IN ('valid', 'used', 'transferred')), 0)::bigint
        ELSE coalesce((
          SELECT sum(greatest(t.quantity_total
            - public.issue_3313_ticket_type_occurrence_taken(t.id, x.date_id), 0))
          FROM dated x WHERE x.tier_id = t.id), 0)::bigint
      END AS remaining
    FROM tiers t
  )
  SELECT
    count(*)::integer,
    coalesce(bool_or(c.unlimited), false),
    coalesce(sum(c.total), 0),
    coalesce(sum(c.remaining), 0),
    count(*) > 0 AND bool_and(coalesce(c.is_free, false) IS TRUE
      AND coalesce(c.price_cents, 0) = 0),
    (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY c2.price_cents)
       FROM counted c2
      WHERE coalesce(c2.is_free, false) IS NOT TRUE AND c2.price_cents > 0),
    (SELECT max(c3.currency) FROM counted c3)
  INTO v_tiers, v_unlimited, v_total, v_remaining, v_all_free, v_price, v_currency
  FROM counted c;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'tickets',
    'occurrence_key', v_key,
    'tiers', v_tiers,
    'total', CASE WHEN v_unlimited THEN NULL ELSE v_total END,
    'remaining', CASE WHEN v_unlimited THEN NULL ELSE v_remaining END,
    'unlimited', v_unlimited,
    -- Sold out only when there is something to sell and none of it is left.
    'sold_out', v_tiers > 0 AND NOT v_unlimited AND v_remaining = 0,
    'waitlist', false,
    'all_free', coalesce(v_all_free, false),
    'typical_price_cents', v_price,
    'currency', v_currency
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_offering_stock(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_offering_stock(uuid, text) TO service_role;

COMMENT ON FUNCTION public.ad_offering_stock(uuid, text) IS
  'issue #4238 W2: what is left to sell for an event (or one date of it). Same '
  'tier predicates as ad_offering_destination_by_id without the sale window, so '
  'sold out and not-on-sale-yet are told apart. Service role only.';
