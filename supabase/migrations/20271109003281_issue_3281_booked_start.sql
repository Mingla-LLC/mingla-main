-- issue #3281 Round 1 PR 1b — save the guest-chosen experience start.
--
-- Additive columns on ticket_checkout_sessions + orders. Flag
-- experience_require_booked_start defaults OFF so old clients keep checking
-- out until both OTAs ship. Re-emits create_session_base (from #2947),
-- create-session wrapper (from #2696), finalize_base + biz_ticket_scan
-- (from #2160), and pg_notify_reminders_enqueue (from #1210).
--
-- BEFORE MERGE: apply this migration on production (Seth's migration chat).
-- Edge auto-deploys after merge; clients send bookedStartAt behind the same
-- PR with the flag still off.
--
-- DRAFT invariants:
--   I-PROPOSED-3281-BOOKED-START-SAVED
--   I-PROPOSED-3281-REMINDER-AND-SCAN-USE-BOOKED-START

BEGIN;

-- ---------------------------------------------------------------------------
-- Columns + index
-- ---------------------------------------------------------------------------
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS booked_start_at timestamptz NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS booked_start_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS orders_event_id_booked_start_at_idx
  ON public.orders (event_id, booked_start_at)
  WHERE booked_start_at IS NOT NULL;

COMMENT ON COLUMN public.ticket_checkout_sessions.booked_start_at IS
  'issue #3281 — guest-chosen open-daily start; NULL for slots/legacy/flag-off.';
COMMENT ON COLUMN public.orders.booked_start_at IS
  'issue #3281 — copied from the checkout session at finalize; reminder+scan key.';

-- ---------------------------------------------------------------------------
-- Feature flag (default OFF until OTAs verified)
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('experience_require_booked_start', false,
   '#3281 Round 1: when on, open-daily experience checkout that names a date MUST send booked_start_at. Off during OTA transition so old builds still check out.')
ON CONFLICT (flag_key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- issue #3281 — validate optional/required booked start for experiences.
-- SECURITY DEFINER, service_role only. RAISE codes map to edge 422 names.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3281_validate_booked_start(
  p_event_id uuid,
  p_event_date_id uuid,
  p_booked_start_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event record;
  v_date record;
  v_flag_on boolean := false;
  v_open_daily boolean := false;
  v_required boolean := false;
  v_offset_secs bigint;
BEGIN
  SELECT e.id, e.event_type, e.is_recurring, e.recurrence_rules
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Nothing to do for non-experiences when no start is sent.
  IF v_event.event_type IS DISTINCT FROM 'experience' THEN
    IF p_booked_start_at IS NOT NULL THEN
      RAISE EXCEPTION 'booked_start_invalid';
    END IF;
    RETURN;
  END IF;

  SELECT COALESCE(
    (SELECT f.is_enabled FROM public.feature_flags f
      WHERE f.flag_key = 'experience_require_booked_start'),
    false
  ) INTO v_flag_on;

  v_open_daily := (
    COALESCE(v_event.is_recurring, false)
    AND jsonb_typeof(v_event.recurrence_rules) = 'object'
    AND v_event.recurrence_rules->>'preset' = 'daily'
    AND v_event.recurrence_rules->'termination'->>'kind' = 'never'
  );

  v_required := v_flag_on AND v_open_daily AND p_event_date_id IS NOT NULL;

  IF p_booked_start_at IS NULL THEN
    IF v_required THEN
      RAISE EXCEPTION 'booked_start_required';
    END IF;
    RETURN;
  END IF;

  -- A start without a named date cannot be validated against a window.
  IF p_event_date_id IS NULL THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;

  SELECT ed.id, ed.event_id, ed.start_at, ed.end_at
    INTO v_date
    FROM public.event_dates ed
   WHERE ed.id = p_event_date_id;
  IF NOT FOUND OR v_date.event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;

  IF p_booked_start_at < now() THEN
    RAISE EXCEPTION 'booked_start_in_past';
  END IF;

  IF p_booked_start_at < v_date.start_at OR p_booked_start_at >= v_date.end_at THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;

  -- 30-minute grid relative to the occurrence open (R1; R3 adds spacing setting).
  v_offset_secs := EXTRACT(EPOCH FROM (p_booked_start_at - v_date.start_at))::bigint;
  IF v_offset_secs < 0 OR (v_offset_secs % (30 * 60)) <> 0 THEN
    RAISE EXCEPTION 'booked_start_off_grid';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3281_validate_booked_start(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_validate_booked_start(uuid, uuid, timestamptz)
  TO service_role;


-- ---------------------------------------------------------------------------
-- Re-emit create_session_base + wrapper with p_booked_start_at
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[]
);
DROP FUNCTION IF EXISTS public.biz_ticket_checkout_create_session(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[]
);

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_create_session_base(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  -- META-ORCH-1174 B1: per-line installment locals. v_first_ticket_type_id is
  -- retained for compatibility but the schedule is now computed PER LINE in a
  -- second loop, not off the first tier only.
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_line_total bigint;          -- THIS line's total (price_cents × qty)
  v_line_deposit_cents bigint;  -- THIS line's deposit
  v_line_running bigint;        -- THIS line's running installment total
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  -- Aggregate accumulators across all lines:
  v_due_today_cents bigint := 0;          -- Σ deposits + Σ non-plan full
  v_any_installments boolean := false;    -- did ANY line produce a schedule?
  v_unioned jsonb := '[]'::jsonb;         -- all lines' raw installment entries
  v_full_price_cents bigint := 0;         -- Σ of all line totals (the trip total)
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
  -- issue #2160 DELTA 2 of 6 — the day set, the mode, and the multiplier.
  v_day_ids uuid[];
  v_day_count integer := 0;
  v_pricing_mode text := 'per_day';
  v_day_multiplier integer := 1;
  v_qty_raw integer;
  v_cart_qty_for_type integer;
  v_day_id uuid;
  -- issue #3313: whether a day must be chosen, and capacity per night.
  v_day_choice jsonb;
  v_per_occurrence boolean := false;
  v_night_taken integer;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility NOT IN ('public', 'hidden') OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- ══ issue #2562 — AN EVENT THAT HAS ALREADY HAPPENED CANNOT BE SOLD ═══
  --
  -- Before this, NOTHING on the reservation path asked whether the event was
  -- over. `event_not_selling` above checks `events.status`, and a finished
  -- event is still `scheduled` — status describes the LISTING, not the clock.
  -- The only thing standing between a guest and paying for a past event was an
  -- OPTIONAL per-tier `sale_end_at`, and six live tiers do not have one.
  --
  -- Proven against production before this guard existed: a checkout session for
  -- FIFA Grill Night — last occurrence ended 2026-07-26 — came back
  -- `status=requires_payment total=2000 currency=USD`, a month after the event.
  -- The buyer web blocked it; the Explorer app offered "Buy ticket"; the server
  -- accepted. A guarantee cannot rest on an optional field being filled in.
  --
  -- SCOPE, and both halves are deliberate:
  --   * Only fires when the event HAS occurrences. No rows means we do not know
  --     when it is, and refusing on unknown would be a different bug — one live
  --     event legitimately carries none.
  --   * `end_at > now()` allows an event that is CURRENTLY RUNNING, so walk-up
  --     sales during the event still work. It refuses only once every occurrence
  --     has finished.
  --
  -- This is the EVENT-level backstop. #2160's `occurrence_not_available` already
  -- refuses an individual chosen day that has passed; that guard only runs when
  -- the guest sent a day set, which is exactly why this one is needed too.
  --
  -- DELETE THIS BLOCK and a past event becomes payable again.
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_event_id AND d.end_at > now()
     ) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- ══ issue #2160 DELTA 3 of 6 — VALIDATE THE DAY SET, READ THE MODE ════
  -- Distinct, ordered by start_at, and every id must be an occurrence OF
  -- THIS EVENT that has not already ended. A day the guest cannot attend is
  -- never allowed to become an entitlement.
  --
  -- DELETE THIS BLOCK and a guest can mint a pass for another event's
  -- occurrence, or for a day that is already over.
  IF p_event_date_ids IS NOT NULL AND array_length(p_event_date_ids, 1) > 0 THEN
    SELECT ARRAY(
             SELECT d.id FROM public.event_dates d
              WHERE d.event_id = p_event_id
                AND d.id = ANY (p_event_date_ids)
              ORDER BY d.start_at, d.id
           )
      INTO v_day_ids;
    IF COALESCE(array_length(v_day_ids, 1), 0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_event_date_ids) AS x) THEN
      RAISE EXCEPTION 'occurrence_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_dates d
                WHERE d.id = ANY (v_day_ids) AND d.end_at <= now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_day_count := COALESCE(array_length(v_day_ids, 1), 0);
  END IF;

  -- ══ issue #3313 — NO ORDER WITHOUT A NIGHT ═════════════════════════════
  -- A checkout on an event with more than one bookable date used to finish
  -- with NO day set: orders.event_date_id NULL, no ticket_event_dates, and a
  -- pass that admits on ANY night (I-PROPOSED-2160-A). One predicate decides,
  -- the same one the public reader turns into `isMultiDate`, so the chooser a
  -- guest sees and the refusal here cannot disagree:
  --   * a recurring event with exactly one upcoming date binds to it;
  --   * an event that requires a choice and received none is refused.
  -- Trips, experiences and single-date events: requiresChoice is false and
  -- there is no sole date, so this block is a no-op for them.
  -- DELETE THIS BLOCK and a no-night order is issued again.
  v_day_choice := public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence := COALESCE((v_day_choice ->> 'perOccurrenceCapacity')::boolean, false);
  IF v_day_count = 0 AND (v_day_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_day_ids := ARRAY[(v_day_choice ->> 'soleOccurrenceId')::uuid];
    v_day_count := 1;
  END IF;
  IF v_day_count = 0 AND COALESCE((v_day_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;

  -- The organiser's choice. Read ONCE, here, so the whole function agrees.
  SELECT COALESCE(e.multi_date_pricing_mode, 'per_day')
    INTO v_pricing_mode
    FROM public.events e WHERE e.id = p_event_id;

  -- THE ONE MULTIPLIER, APPLIED IN ONE PLACE.
  --   per_day , D days -> D  (D admissions, D passes, D units of capacity)
  --   all_days, D days -> 1  (one pass sold once)
  --   no days chosen    -> 1  (byte-identical to pre-#2160)
  -- Because it multiplies the stored line QUANTITY, pricing, capacity and
  -- the mint loop all see the same number with no special-casing anywhere
  -- downstream (amendment §1 and §8).
  IF v_day_count > 0 AND v_pricing_mode = 'per_day' THEN
    v_day_multiplier := v_day_count;
  END IF;

  -- issue #3281 Round 1 — optional booked start (open-daily experiences).
  -- Required only when experience_require_booked_start is on AND the experience
  -- is open-daily AND a date is named; otherwise optional. Meaning lives here.
  PERFORM public.issue_3281_validate_booked_start(
    p_event_id,
    CASE WHEN v_day_count >= 1 THEN v_day_ids[1] ELSE NULL END,
    p_booked_start_at
  );

  -- ══ issue #2462 — CANONICAL LOCK ORDER, TAKEN BEFORE PASS 1 ═══════════
  -- Pass 1 below takes `SELECT … FROM ticket_types … FOR UPDATE` once per
  -- line, in the order the CLIENT sent them, because
  -- `jsonb_array_elements(p_lines)` has no ORDER BY. The cart appends lines in
  -- the order the buyer TAPPED them (CartContext.tsx:290-292), so two guests
  -- who add the same two ticket types in opposite orders take the same two row
  -- locks in opposite orders and DEADLOCK. Postgres kills one; the RPC raises;
  -- the guest is told "Nothing was reserved — please try again". It can only
  -- happen under concurrency, on a multi-ticket-type cart, which is why it
  -- never reproduces in testing.
  --
  -- Proven on production: lines sent as [Day 2, Day 1] were processed
  -- [Day 2, Day 1] — lock order follows the client array verbatim.
  --
  -- Taking every lock ONCE here, ordered by primary key, makes the order
  -- total and identical for every caller. Pass 1's per-line FOR UPDATE then
  -- re-acquires a lock this transaction already holds, which is a no-op, so
  -- NOTHING below changes — including the order line items are inserted in,
  -- which the response's `items` array and its tests depend on.
  --
  -- DELETE THIS BLOCK and the deadlock returns under load.
  PERFORM 1
     FROM public.ticket_types tt
    WHERE tt.id IN (
            SELECT DISTINCT (l ->> 'ticketTypeId')::uuid
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId') IS NOT NULL
          )
      AND tt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    ORDER BY tt.id
      FOR UPDATE;

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
    v_qty := v_qty_raw;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    -- #2879 / #2947 slice 7 — pre-sale queue: an armed tier may mint an
    -- infinity hold before sale_start_at so rule 6's join can form. Ordinary
    -- (finite-expiry) creates still refuse until the sale opens.
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      IF NOT (
        p_expires_at = 'infinity'::timestamptz
        AND EXISTS (
          SELECT 1 FROM public.ticket_queue_arming a
           WHERE a.ticket_type_id = v_ticket_type.id
             AND a.disarmed_at IS NULL
        )
      ) THEN
        RAISE EXCEPTION 'ticket_sales_not_started';
      END IF;
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    -- ══ issue #2160 DELTA 4 of 6 — THE PER-DAY MULTIPLIER ═══════════════
    -- Applied AFTER min_purchase_qty / max_purchase_qty, which stay per LINE
    -- and therefore mean "per day" — an organiser capping a guest at 4
    -- tickets means 4 per day, not 4 across a three-day festival. Applied
    -- BEFORE capacity and pricing, which must both see the real number of
    -- admissions. v_day_multiplier is 1 on every pre-#2160 path.
    v_qty := v_qty_raw * v_day_multiplier;

    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      -- issue #2491 C2 step 3 — THE COUNTER, not the count.
      -- Was: COUNT(*) over public.tickets, measured at 18.71 ms per call once a
      -- ticket type holds 100k rows, executed INSIDE the serialized critical
      -- section so every other buyer waits behind it. Now a column read.
      -- sold_count is maintained by issue_2491_tickets_counters, which fires on
      -- INSERT, DELETE and UPDATE OF (status, ticket_type_id) — precisely the
      -- columns this formula reads — and RECOMPUTES from
      -- issue_2491_derived_sold rather than incrementing. Its only failure mode
      -- is structural (the trigger removed), never gradual, and 288 consecutive
      -- shadow observations over 77.7 h reported zero drift across 699 sales.
      -- ══ issue #3313 — CAPACITY PER NIGHT ON A RECURRING EVENT (Seth) ═══
      -- quantity_total is the capacity of EACH night, not of the whole run.
      -- For every chosen night: places already taken that night (sold + held,
      -- issue_3313_ticket_type_occurrence_taken — the ONE per-night counter,
      -- also used by the public reader's `remaining`) plus this cart's raw
      -- quantity of the type must fit. per_day stores quantity x D and mints q
      -- passes per night; all_days mints q passes valid on every chosen night;
      -- both consume q places per night. Every other event keeps the shared
      -- check below, verbatim.
      -- DELETE THIS BRANCH and a recurring event's 60 places are shared by
      -- every night of the run.
      IF v_per_occurrence AND v_day_count > 0 THEN
        SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
          INTO v_cart_qty_for_type
          FROM jsonb_array_elements(p_lines) AS l
         WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
        IF v_ticket_type.quantity_total IS NOT NULL THEN
          FOREACH v_day_id IN ARRAY v_day_ids LOOP
            v_night_taken := public.issue_3313_ticket_type_occurrence_taken(
              v_ticket_type.id, v_day_id
            );
            IF v_night_taken + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
              RAISE EXCEPTION 'ticket_capacity_exceeded';
            END IF;
          END LOOP;
        END IF;
      ELSE
      -- (the shared check, verbatim from 20270609002879)
      SELECT tt2.sold_count
        INTO v_sold
        FROM public.ticket_types tt2
       WHERE tt2.id = v_ticket_type.id;

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');

      -- ══ issue #2160 DELTA 5 of 6 — CAPACITY AGGREGATES PER TICKET TYPE ═
      -- THIS ONE PROTECTS MONEY. The pre-#2160 check compared
      -- `v_sold + v_reserved + v_qty` where v_qty is THIS LINE alone, and
      -- the current session's own items are inserted AFTER this loop — so a
      -- second line of the SAME ticket_type in the same cart was invisible
      -- to the first line's check and both passed independently.
      --
      -- Honest scoping: under the amendment's session-level day set, lines
      -- are never expanded, so multi-day does NOT create this shape. The
      -- hole is real but LATENT, exactly as it is today — this is hardening,
      -- not the load-bearing fix the pre-amendment spec described. It is
      -- kept because it is two lines inside a function being re-emitted
      -- anyway and any future feature that sends two lines of one type
      -- (bundles, add-ons) walks straight into it.
      --
      -- DELETE THE AGGREGATION and a cart with two lines of a
      -- quantity_total=1 ticket type mints 2 tickets against a cap of 1.
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
      END IF;
    END IF;

    -- issue #1014 delta (2): null-safe cart mixing. An all-NULL (all-free)
    -- cart never raises; two DIFFERENT non-null currencies always raise;
    -- null-vs-non-null mixing is checked AFTER the loop (raises only when
    -- the cart carries money — see the post-loop gate).
    IF v_ticket_type.currency IS NOT NULL THEN
      IF v_currency IS NULL THEN
        v_currency := v_ticket_type.currency;
      ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN
        RAISE EXCEPTION 'mixed_currency_cart';
      END IF;
    ELSE
      v_saw_null_currency := true;
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- ---------------- Pass 2: per-line installment math (META-ORCH-1174 B1). ----------------
  -- For trips only, walk the BUILT line items (v_items carries the per-line
  -- totals). For each line, look up its package's tier_metadata.installments.
  -- A line with a plan (and not opted to pay-full) contributes its OWN deposit
  -- to "due today" + its OWN installment entries to the union; a line without a
  -- plan contributes its full total to "due today". The union is then re-
  -- numbered ordinal 1..M sorted by dueAt.
  --
  -- ORCH-0915 opt-out: p_payment_plan_choice='full' ⇒ NO line installments at
  -- all (every line pays full now). This is the session-wide pay-in-full path.
  IF v_is_trip AND p_payment_plan_choice <> 'full' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_total := (v_line ->> 'totalCents')::bigint;
      v_tier_metadata := NULL;

      SELECT tpt.tier_metadata
        INTO v_tier_metadata
        FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = p_event_id
         AND tpt.ticket_type_id = (v_line ->> 'ticketTypeId')::uuid;

      v_installments_input := CASE
        WHEN v_tier_metadata IS NOT NULL THEN v_tier_metadata -> 'installments'
        ELSE NULL
      END;

      IF v_installments_input IS NOT NULL
         AND jsonb_typeof(v_installments_input) = 'object' THEN
        -- This package carries a payment plan → compute its per-line schedule.
        v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
        v_inst_array := v_installments_input -> 'installments';

        IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
          RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
        END IF;
        IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
          RAISE EXCEPTION 'installment_schedule_malformed';
        END IF;

        v_inst_count := jsonb_array_length(v_inst_array);
        IF v_inst_count < 1 OR v_inst_count > 11 THEN
          RAISE EXCEPTION 'installment_count_out_of_range';
        END IF;

        -- First pass over THIS line's installments: validate + accumulate pct.
        v_pct_sum := v_deposit_pct;
        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
          v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_ord <> v_i + 1 THEN
            RAISE EXCEPTION 'installment_ordinal_invalid';
          END IF;
          IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
            RAISE EXCEPTION 'installment_pct_out_of_range';
          END IF;
          IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
             OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
            RAISE EXCEPTION 'installment_due_mode_invalid';
          END IF;

          v_pct_sum := v_pct_sum + v_inst_pct;
        END LOOP;

        IF abs(v_pct_sum - 100) > 0.01 THEN
          RAISE EXCEPTION 'installment_pct_sum_mismatch';
        END IF;

        -- Second pass: amounts scaled by THIS LINE's total, last-absorbs-rounding.
        v_line_deposit_cents := floor(v_line_total::numeric * v_deposit_pct / 100)::bigint;
        v_line_running := 0;

        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := (v_inst_item ->> 'ordinal')::int;
          v_inst_pct := (v_inst_item ->> 'pct')::numeric;
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_days IS NOT NULL THEN
            IF v_inst_days < 1 THEN
              RAISE EXCEPTION 'installment_days_after_booking_invalid';
            END IF;
            v_inst_due := v_now + (v_inst_days || ' days')::interval;
          ELSE
            v_inst_due := (v_inst_fixed)::timestamptz;
          END IF;

          IF v_i = 0 AND v_inst_due <= v_now THEN
            RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
          END IF;

          IF v_i < v_inst_count - 1 THEN
            v_inst_amount := floor(v_line_total::numeric * v_inst_pct / 100)::bigint;
            v_line_running := v_line_running + v_inst_amount;
          ELSE
            v_inst_amount := v_line_total - v_line_deposit_cents - v_line_running;
            IF v_inst_amount <= 0 THEN
              RAISE EXCEPTION 'installment_rounding_invalid';
            END IF;
          END IF;

          -- Append to the UNION with a sortable dueAt (ordinal re-numbered below).
          v_unioned := v_unioned || jsonb_build_array(jsonb_build_object(
            'pct', v_inst_pct,
            'amountCents', v_inst_amount,
            'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sourceTicketTypeId', (v_line ->> 'ticketTypeId'),
            'sourceOrdinal', v_inst_ord
          ));
        END LOOP;

        v_due_today_cents := v_due_today_cents + v_line_deposit_cents;
        v_any_installments := true;
      ELSE
        -- No plan on this package → its full total is due today.
        v_due_today_cents := v_due_today_cents + v_line_total;
      END IF;
    END LOOP;
  END IF;

  -- ---------------- Finalize the schedule + the deposit override. ----------------
  -- When at least one line produced installments, override v_total to the summed
  -- "due today" (Σ deposits + Σ non-plan fulls) and build the unioned schedule
  -- with sequential ordinals 1..M sorted by dueAt (then stable source order). The
  -- persisted shape is byte-identical to the single-line ORCH-0869 schedule.
  IF v_any_installments THEN
    v_total := v_due_today_cents::integer;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'ordinal', rn,
               'pct', (elem ->> 'pct')::numeric,
               'amountCents', (elem ->> 'amountCents')::bigint,
               'dueAt', elem ->> 'dueAt'
             )
             ORDER BY rn
           ), '[]'::jsonb)
      INTO v_unioned
      FROM (
        SELECT elem,
               row_number() OVER (
                 ORDER BY (elem ->> 'dueAt') ASC, (elem ->> 'sourceOrdinal')::int ASC
               ) AS rn
        FROM jsonb_array_elements(v_unioned) AS elem
      ) ranked;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  -- issue #1014 delta (3): belt-and-braces — money never enters a session
  -- without a currency (unreachable given the (a) CHECKs: paid tickets always
  -- carry currency — but the RPC stays self-defending).
  IF v_total > 0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule,
    -- issue #2160 — the mode this reservation was PRICED under. Finalize mints
    -- under this value, never a fresh read (§A.7).
    multi_date_pricing_mode_snapshot,
    -- issue #3281 — guest-chosen start (open-daily); NULL = legacy / slots / flag-off.
    booked_start_at
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END,
    v_pricing_mode,
    p_booked_start_at
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  -- ══ issue #2160 DELTA 6 of 6 — PERSIST THE CHOSEN DAY SET ═════════════
  -- The finalize base reads these rows to distribute ticket_event_dates
  -- entitlements. DELETE THIS LOOP and every pass mints with zero days, so
  -- a guest who chose Saturday is silently admitted on every day of the
  -- event — and a guest who paid for two days gets one pass, not two.
  IF v_day_count > 0 THEN
    FOREACH v_day_id IN ARRAY v_day_ids LOOP
      INSERT INTO public.ticket_checkout_session_event_dates (
        checkout_session_id, event_date_id
      ) VALUES (v_session_id, v_day_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_existing record;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_decision text;
  v_replay_decision text;
  v_snapshot jsonb;
  v_mode text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  -- #2101 A3.1 — brand lock immediately after the event lock.
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- #2101 — fresh decision BEFORE the idempotency replay owner.
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, p_buyer_user_id);
  IF v_decision='sign_in_required' THEN
    RAISE EXCEPTION 'checkout_sign_in_required';
  END IF;
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN
    RAISE EXCEPTION 'checkout_restricted';
  END IF;
  v_snapshot := public.issue_2101_current_access_snapshot(p_event_id,p_buyer_user_id);
  v_mode := v_snapshot->>'mode';

  -- issue #2696 — SCOPED TO THE EVENT BEING BOUGHT.
  --
  -- This lookup resolved a session by idempotency key ALONE. The key is globally
  -- UNIQUE with no event or brand column, and its event-scoping was only ever an
  -- implicit property of how the edge composed it. That made it defeatable the
  -- moment a caller could supply their own key, which the edge accepted verbatim
  -- until #2696 removed it.
  --
  -- The conjunct here is the durable half of that fix: even a caller-supplied or
  -- colliding key can no longer return a session belonging to a different event.
  -- Without it, a request naming event B could be answered with event A's
  -- session, and every decision after this point — the #2101 access mode, the
  -- named-buyer cross-check, the status-token write — was then made against B's
  -- rules on A's row.
  --
  -- NOT A BEHAVIOUR CHANGE: all 179 live sessions already satisfy
  -- `idempotency_key LIKE 'ticket_checkout:' || event_id || ':%'`, and 0 do not.
  -- A legitimate resubmit derives the same key for the same event and still
  -- finds its row.
  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key=p_idempotency_key
     AND event_id=p_event_id;

  IF FOUND THEN
    -- ═══════════════════════════════════════════════════════════════════════
    -- issue #2150 — A COMPLETED **FREE** RESERVATION IS RETURNED, NOT REMINTED.
    --
    -- This block is evaluated BEFORE the ORCH-0791 terminal tombstone and
    -- before the ORCH-0829-B D-1 expiry tombstone, and it is the ONLY thing
    -- that changed in this function. Every conjunct is load-bearing:
    --
    --   status='free_completed'  the only status `biz_ticket_checkout_finalize`
    --                            assigns when `total_cents = 0`.
    --   total_cents = 0          independent proof this carried NO money, so
    --                            the paid arm cannot enter here even if a
    --                            status were corrupted. THIS is the conjunct
    --                            that scopes the change to the zero-total case.
    --   order_id IS NOT NULL     there is something to hand back.
    --   revoked_at IS NULL       the sale was not revoked (#2079 / #1930).
    --   buyer identity matches   an anonymous guest is (NULL,NULL) and matches
    --                            itself; a DIFFERENT signed-in user presenting
    --                            the same derived key falls through to today's
    --                            behaviour rather than being handed someone
    --                            else's passes.
    --   a live ticket exists     a cancelled / refunded / voided reservation is
    --                            NOT a reservation the guest still holds, so it
    --                            falls through and they can re-reserve.
    --
    -- On a match the guest's ORIGINAL session is returned untouched: the key is
    -- NOT renamed, no row is inserted, and `ticket-checkout-create` answers
    -- with that same order's already-issued tickets — one order, one ticket,
    -- one confirmation email and one SMS, however many times they submit.
    -- ═══════════════════════════════════════════════════════════════════════
    IF v_existing.status='free_completed'
       AND COALESCE(v_existing.total_cents,0)=0
       AND v_existing.order_id IS NOT NULL
       AND v_existing.revoked_at IS NULL
       AND v_existing.buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
       AND EXISTS(SELECT 1 FROM public.tickets t
                   WHERE t.order_id=v_existing.order_id
                     AND t.status IN ('valid','used','transferred')) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;

    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key=idempotency_key || ':tombstone:' || id::text,
             status=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at=now()
       WHERE id=v_existing.id;
    ELSE
      v_replay_decision := public.issue_2101_ticket_checkout_access_decision(
        p_event_id, v_existing.buyer_user_id,
        v_existing.checkout_access_mode_snapshot,
        v_existing.checkout_access_restrictive_epoch_snapshot,
        v_existing.checkout_access_membership_id_snapshot,
        v_existing.checkout_access_membership_epoch_snapshot);
      IF v_replay_decision NOT IN ('allowed_unrestricted','allowed_named')
         OR (v_mode='named_buyers'
             AND v_existing.buyer_user_id IS DISTINCT FROM p_buyer_user_id) THEN
        RAISE EXCEPTION 'checkout_restricted';
      END IF;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;
  END IF;

  -- issue #2160 DELTA 2 of 2 — forward the day set. NOTHING ELSE IN THIS
  -- FUNCTION CHANGED: the #2150 free-completed exemption above, the ORCH-0791
  -- terminal tombstone, the ORCH-0829-B expiry tombstone, the #2101 fresh
  -- decision, the event -> brand lock order and the access snapshot write-back
  -- are byte-preserved from 20270419002150:158-358.
  -- issue #3281 — forward optional booked start. Nothing else in this wrapper changed.
  v_result:=public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice,p_event_date_ids,
    p_booked_start_at);

  v_session_id := (v_result->>'checkoutSessionId')::uuid;
  IF v_session_id IS NOT NULL THEN
    UPDATE public.ticket_checkout_sessions SET
      checkout_access_mode_snapshot=v_mode,
      checkout_access_restrictive_epoch_snapshot=
        COALESCE((v_snapshot->>'restrictiveEpoch')::bigint,0),
      checkout_access_membership_id_snapshot=
        NULLIF(v_snapshot->>'membershipId','')::uuid,
      checkout_access_membership_epoch_snapshot=
        NULLIF(v_snapshot->>'membershipEpoch','')::bigint
    WHERE id=v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId',v_result->'checkoutSessionId',
    'eventId',v_result->'eventId',
    'brandId',v_result->'brandId',
    'status',v_result->'status',
    'totalCents',v_result->'totalCents',
    'subtotalCents',v_result->'subtotalCents',
    'currency',v_result->'currency',
    'stripeAccountId',v_result->'stripeAccountId',
    'orderId',v_result->'orderId',
    'items',v_result->'items',
    'lineItems',v_result->'lineItems',
    'installmentSchedule',v_result->'installmentSchedule'
  );
END $function$;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz
) TO service_role;

-- ---------------------------------------------------------------------------
-- Re-emit finalize_base (copy booked_start_at onto orders)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_stripe_payment_method_type text,
  p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,
  p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_session record;
  v_item record;
  v_order_id uuid;
  v_ticket_id uuid;
  v_token text;
  v_token_hash text;
  v_qr text;
  v_tickets jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_method text;
  v_qr_token_pepper text;
  i integer;
  v_schedule jsonb;
  v_inst_array jsonb;
  v_inst_item jsonb;
  v_inst_count int;
  v_idx int;
  v_inst_amount bigint;
  v_inst_currency char(3);
  v_inst_due timestamptz;
  -- issue #2160 DELTA 1 of 4 — the pricing mode and the chosen day set.
  v_pricing_mode text := 'per_day';
  v_days uuid[];
  v_day_count integer := 0;
  v_day_id uuid;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  SELECT *
    INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    -- ORCH-0921: replace the silent early-return with compare-and-correct.
    -- When the second caller passes p_installment_plan_root=true AND the
    -- existing order row has installment_plan_root=false AND the session
    -- carries an installment_schedule AND zero order_installments rows exist,
    -- backfill the missing installment-plan state. Idempotent: re-running
    -- after the backfill is a no-op (the EXISTS checks prevent duplicate
    -- INSERTs and redundant UPDATEs).
    IF p_installment_plan_root
       AND v_session.installment_schedule IS NOT NULL
       AND p_stripe_customer_id_on_connected_account IS NOT NULL
       AND p_saved_payment_method_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.orders
         WHERE id = v_session.order_id
           AND installment_plan_root = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.order_installments
         WHERE order_id = v_session.order_id
       )
    THEN
      v_schedule := v_session.installment_schedule;
      v_inst_array := v_schedule -> 'installments';
      v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
      v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

      FOR v_idx IN 0 .. v_inst_count - 1 LOOP
        v_inst_item := v_inst_array -> v_idx;
        v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
        v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

        IF v_inst_amount <= 0 THEN
          RAISE EXCEPTION 'installment_amount_invalid';
        END IF;

        INSERT INTO public.order_installments (
          order_id, ordinal, amount_cents, currency, due_at, status
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled'
        );
      END LOOP;

      UPDATE public.orders
         SET installment_plan_root = true,
             stripe_customer_id_on_connected_account = p_stripe_customer_id_on_connected_account,
             saved_payment_method_id = p_saved_payment_method_id,
             updated_at = now()
       WHERE id = v_session.order_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'ticketTypeId', t.ticket_type_id,
      'ticketName', tt.name,
      'qrPayload', t.qr_code,
      'status', t.status,
      -- issue #2160 DELTA 2 of 4 — the days THIS pass admits, so the client
      -- can label it without a second read. `[]` for every pre-#2160 pass,
      -- which is what "not day-scoped" looks like on the wire.
      'eventDateIds', COALESCE((
        SELECT jsonb_agg(ted.event_date_id ORDER BY ed.start_at, ed.id)
          FROM public.ticket_event_dates ted
          JOIN public.event_dates ed ON ed.id = ted.event_date_id
         WHERE ted.ticket_id = t.id), '[]'::jsonb)
    ) ORDER BY t.created_at), '[]'::jsonb)
      INTO v_tickets
      FROM public.tickets t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = v_session.order_id;

    RETURN jsonb_build_object(
      'orderId', v_session.order_id,
      'checkoutSessionId', v_session.id,
      'eventId', v_session.event_id,
      'paymentStatus', 'paid',
      'totalCents', v_session.total_cents,
      'currency', trim(v_session.currency),
      'tickets', v_tickets,
      'notificationStatus', 'queued',
      'installmentPlanRoot', (
        SELECT installment_plan_root FROM public.orders WHERE id = v_session.order_id
      )
    );
  END IF;

  IF v_session.total_cents > 0 AND COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id) IS NULL THEN
    RAISE EXCEPTION 'payment_intent_required';
  END IF;

  v_order_id := gen_random_uuid();
  v_method := CASE
    WHEN v_session.total_cents = 0 THEN 'free'
    WHEN p_stripe_payment_method_type = 'apple_pay' THEN 'apple_pay'
    WHEN p_stripe_payment_method_type = 'google_pay' THEN 'google_pay'
    ELSE 'online_card'
  END;

  v_schedule := v_session.installment_schedule;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at,
    installment_plan_root,
    stripe_customer_id_on_connected_account,
    saved_payment_method_id,
    pricing_breakdown,
    -- ORCH-1188 FIX 3b: persist the buyer's selected occurrence (NULL-safe).
    event_date_id,
    -- issue #3281 — copy session booked start onto the paid order.
    booked_start_at
  ) VALUES (
    v_order_id, v_session.event_id, v_session.buyer_user_id, v_session.buyer_email,
    v_session.buyer_name, v_session.buyer_phone_e164, v_session.buyer_phone_e164,
    v_session.total_cents, v_session.currency, v_method, 'paid',
    COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id),
    p_stripe_charge_id, false,
    jsonb_build_object(
      'checkout_session_id', v_session.id,
      'marketing_opt_in', v_session.marketing_opt_in
    ),
    v_session.id, 'online_checkout', v_now, 'pending',
    COALESCE(v_session.stripe_application_fee_amount_cents, 0), v_session.stripe_account_id,
    p_stripe_payment_method_type,
    CASE WHEN v_session.total_cents = 0 THEN NULL ELSE 'succeeded' END,
    v_now, v_now,
    COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false),
    CASE WHEN p_installment_plan_root THEN p_stripe_customer_id_on_connected_account ELSE NULL END,
    CASE WHEN p_installment_plan_root THEN p_saved_payment_method_id ELSE NULL END,
    v_session.pricing_breakdown,
    -- ORCH-1188 FIX 3b: the occurrence the buyer booked, read from the session
    -- metadata jsonb (NULL for single-date events / no selection). NULLIF guards
    -- an empty string, ::uuid is NULL-safe on NULL input.
    NULLIF(v_session.metadata->>'event_date_id', '')::uuid,
    v_session.booked_start_at
  );

  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    IF p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;

    v_inst_array := v_schedule -> 'installments';
    v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
    v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

    FOR v_idx IN 0 .. v_inst_count - 1 LOOP
      v_inst_item := v_inst_array -> v_idx;
      v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
      v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'installment_amount_invalid';
      END IF;

      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled'
      );
    END LOOP;
  END IF;

  INSERT INTO public.order_line_items (
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_type_id, quantity, unit_price_cents, total_cents
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = v_session.id;

  -- ══ issue #2160 DELTA 3 of 4 — MINT UNDER THE MODE THE GUEST WAS QUOTED ═
  --
  -- THE SNAPSHOT, NOT A FRESH READ OF `events`. The session was PRICED and
  -- SIZED under `multi_date_pricing_mode_snapshot` at create; minting under a
  -- different value issues a pass that does not match what the guest paid for,
  -- in both directions (§A.7 states the two reproductions). The lock cannot
  -- prevent the flip, because an in-flight session holds no ticket yet — which
  -- is precisely the window this line closes.
  --
  -- DELETE THE SNAPSHOT READ and an organiser flipping the mode mid-checkout
  -- either takes a two-day guest's money and admits them on one day, or sells
  -- two admissions and lets four people in.
  --
  -- COALESCE to the live event ONLY for a session created before the column
  -- existed, so anything already in flight at deploy still finalizes.
  SELECT COALESCE(
           v_session.multi_date_pricing_mode_snapshot,
           (SELECT e.multi_date_pricing_mode FROM public.events e
             WHERE e.id = v_session.event_id),
           'per_day')
    INTO v_pricing_mode;

  -- The day set, ordered by start_at so the per_day round-robin below is
  -- deterministic and testable, not incidental.

  SELECT ARRAY(
           SELECT d.event_date_id
             FROM public.ticket_checkout_session_event_dates d
             JOIN public.event_dates ed ON ed.id = d.event_date_id
            WHERE d.checkout_session_id = v_session.id
            ORDER BY ed.start_at, ed.id
         ) INTO v_days;
  v_day_count := COALESCE(array_length(v_days, 1), 0);

  FOR v_item IN
    SELECT *
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = v_session.id
     ORDER BY created_at, id
  LOOP
    FOR i IN 1..v_item.quantity LOOP
      v_ticket_id := gen_random_uuid();
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      v_token_hash := public.biz_ticket_checkout_token_hash(v_token, v_qr_token_pepper);
      v_qr := public.biz_ticket_checkout_qr_payload(
        v_ticket_id,
        v_token_hash,
        v_qr_token_pepper
      );

      INSERT INTO public.tickets (
        id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
        attendee_phone, qr_code, qr_token_hash, status, approval_status, created_at,
        issued_at
      ) VALUES (
        v_ticket_id, v_order_id, v_item.ticket_type_id, v_session.event_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr, v_token_hash, 'valid', 'auto', v_now, v_now
      );

      -- ══ issue #2160 DELTA 4 of 4 — MINT THE ADMISSION ENTITLEMENTS ═════
      -- A pass admits the days it has rows for. The mint loop itself is
      -- UNCHANGED — `v_item.quantity` already carries the per-day multiplier
      -- from the create-session base (amendment §1), so all that differs
      -- between the modes is how the days are DISTRIBUTED.
      --
      --   zero days   -> NO ROWS. Not day-scoped. Today's any-occurrence
      --                  admission window, byte-identical, which is what
      --                  every pass issued before #2160 has and must keep.
      --   all_days    -> one row per chosen day on the SINGLE pass.
      --   per_day     -> ONE row, dealt round-robin across the ordered day
      --                  set: with quantity = qty x D this yields exactly
      --                  `qty` passes per day, deterministically.
      --
      -- DELETE THIS BLOCK and every pass mints with zero days, so a guest is
      -- admitted on a day they did not pay for and the whole issue reverts.
      IF v_day_count > 0 THEN
        IF v_pricing_mode = 'all_days' THEN
          FOREACH v_day_id IN ARRAY v_days LOOP
            INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
            VALUES (v_ticket_id, v_day_id) ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
          VALUES (v_ticket_id, v_days[((i - 1) % v_day_count) + 1])
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
        'ticketId', v_ticket_id,
        'ticketTypeId', v_item.ticket_type_id,
        'ticketName', v_item.ticket_name_at_purchase,
        'qrPayload', v_qr,
        'status', 'valid',
        'eventDateIds', CASE
          WHEN v_day_count = 0 THEN '[]'::jsonb
          WHEN v_pricing_mode = 'all_days' THEN to_jsonb(v_days)
          ELSE jsonb_build_array(v_days[((i - 1) % v_day_count) + 1])
        END
      ));
    END LOOP;
  END LOOP;

  PERFORM public.add_buyer_to_event_chat(
    v_session.event_id,
    v_session.buyer_user_id,
    v_order_id,
    v_session.buyer_email
  );

  INSERT INTO public.ticket_order_notifications (
    order_id, event_id, channel, recipient, idempotency_key, payload
  ) VALUES
    (
      v_order_id,
      v_session.event_id,
      'email',
      v_session.buyer_email,
      'ticket_confirmation:' || v_order_id::text || ':email',
      jsonb_build_object('checkoutSessionId', v_session.id)
    ),
    (
      v_order_id,
      v_session.event_id,
      'sms',
      v_session.buyer_phone_e164,
      'ticket_confirmation:' || v_order_id::text || ':sms',
      jsonb_build_object('checkoutSessionId', v_session.id)
    )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.ticket_checkout_sessions
     SET order_id = v_order_id,
         status = CASE WHEN total_cents = 0 THEN 'free_completed' ELSE 'paid_completed' END,
         stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
         completed_at = v_now,
         updated_at = v_now
   WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'paymentStatus', 'paid',
    'totalCents', v_session.total_cents,
    'currency', trim(v_session.currency),
    'tickets', v_tickets,
    'notificationStatus', 'queued',
    'installmentPlanRoot', COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid, text, text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid, text, text, text, text, text, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Re-emit reminders (F-B)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_notify_reminders_enqueue(
  p_lead_hours    int,
  p_lead_bucket   text,
  p_window_minutes int DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_low      timestamptz;
  v_high     timestamptz;
  v_half_mins int;
  v_inserted int := 0;
  v_n        int;
BEGIN
  IF p_lead_bucket NOT IN ('24h','2h') THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: invalid lead bucket %', p_lead_bucket;
  END IF;
  IF p_lead_hours IS NULL OR p_lead_hours <= 0 THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: lead hours must be positive (got %)', p_lead_hours;
  END IF;

  -- #1210 — integer half-window; never pass numeric into make_interval(mins => …).
  v_half_mins := (p_window_minutes / 2)::int;

  v_low  := now() + make_interval(hours => p_lead_hours)
                  - make_interval(mins  => v_half_mins);
  v_high := now() + make_interval(hours => p_lead_hours)
                  + make_interval(mins  => v_half_mins);

  -- 1. EVENT/trip/experience reminders → buyer of a PAID order on an upcoming date.
  -- issue #3281 F-B — experience orders with booked_start_at enqueue from that
  -- instant (not every occurrence). Orders without it keep today's join.
  WITH upcoming AS (
    SELECT
      o.id              AS order_id,
      o.buyer_user_id   AS buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id        AS brand_id,
      e.title           AS event_title,
      o.booked_start_at AS start_at
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE e.event_type = 'experience'
      AND o.booked_start_at IS NOT NULL
      AND o.booked_start_at >= v_low
      AND o.booked_start_at <  v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled','live')
      AND o.payment_status = 'paid'
      AND (o.buyer_user_id IS NOT NULL OR o.buyer_email IS NOT NULL OR o.buyer_phone_e164 IS NOT NULL)
    UNION ALL
    SELECT
      o.id              AS order_id,
      o.buyer_user_id   AS buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id        AS brand_id,
      e.title           AS event_title,
      ed.start_at       AS start_at
    FROM public.event_dates ed
    JOIN public.events e ON e.id = ed.event_id
    JOIN public.orders o ON o.event_id = e.id
    WHERE ed.start_at >= v_low
      AND ed.start_at <  v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled','live')
      AND o.payment_status = 'paid'
      AND (o.buyer_user_id IS NOT NULL OR o.buyer_email IS NOT NULL OR o.buyer_phone_e164 IS NOT NULL)
      AND NOT (e.event_type = 'experience' AND o.booked_start_at IS NOT NULL)
  ), ins AS (
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
    SELECT
      'buyer_event_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_build_object(
        'order_id',    u.order_id,
        'event_title', u.event_title,
        'reserved_for', u.start_at,
        'lead_bucket', p_lead_bucket
      ),
      'buyer_event_reminder:' || u.order_id::text || ':' || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  -- 2. RESERVATION reminders → upcoming CONFIRMED reservations only.
  WITH upcoming AS (
    SELECT
      r.id                AS reservation_id,
      r.consumer_user_id  AS buyer_user_id,
      COALESCE(r.guest_phone_e164, r.guest_email) AS contact,
      r.brand_id          AS brand_id,
      r.reserved_for      AS reserved_for,
      r.party_size        AS party_size,
      r.guest_name        AS guest_name
    FROM public.reservations r
    WHERE r.reserved_for >= v_low
      AND r.reserved_for <  v_high
      AND r.status = 'confirmed'
      AND (r.consumer_user_id IS NOT NULL OR r.guest_email IS NOT NULL OR r.guest_phone_e164 IS NOT NULL)
  ), ins AS (
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
    SELECT
      'buyer_reservation_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_build_object(
        'reservation_id', u.reservation_id,
        'reserved_for',   u.reserved_for,
        'party_size',     u.party_size,
        'guest_name',     u.guest_name,
        'lead_bucket',    p_lead_bucket
      ),
      'buyer_reservation_reminder:' || u.reservation_id::text || ':' || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Re-emit biz_ticket_scan (F-C)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_ticket_scan(
  p_event_id uuid,
  p_qr_payload text,
  p_scanner_user_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  -- Grace constants — SPEC §3.1 Decision-1. Tuning outside [60min, 24h]
  -- requires SPEC review.
  c_grace_before constant interval := interval '120 minutes';
  c_grace_after  constant interval := interval '360 minutes';

  v_match text[];
  v_ticket_id uuid;
  v_token text;
  v_ticket record;
  v_scan_result text;
  v_scan_id uuid;
  v_qr_token_pepper text;
  v_scan_event_id uuid;
  v_has_event_dates boolean;
  v_in_window boolean;
  v_next_start timestamptz;
  v_last_end timestamptz;
  -- issue #2160 — the day ladder's locals.
  v_day_count integer := 0;      -- how many days this pass admits (0 = legacy)
  v_target_day uuid;             -- the occurrence being presented against NOW
  v_admitted_day uuid;           -- the occurrence actually admitted (success)
  v_all_days_consumed boolean;   -- no unadmitted day left after this one
  -- issue #3281 F-C
  v_booked_start timestamptz;
  v_booked_duration interval;
  v_order_event_type text;
  v_order_event_date_id uuid;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  -- ORCH-1051: permission gate now honors EITHER event-scoped scanner
  -- (event_scanners; preserved verbatim) OR brand-scoped scanner
  -- (brand_team_members.role='scanner', accepted, not removed) on the
  -- event's brand. Inline predicates per [[feedback-rls-returning-owner-gap]].
  IF NOT (
    EXISTS (
      SELECT 1
        FROM public.event_scanners es
       WHERE es.event_id = p_event_id
         AND es.user_id = p_scanner_user_id
         AND es.removed_at IS NULL
         AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
        INNER JOIN public.brand_team_members m ON m.brand_id = e.brand_id
       WHERE e.id = p_event_id
         AND m.user_id = p_scanner_user_id
         AND m.role = 'scanner'
         AND m.removed_at IS NULL
         AND m.accepted_at IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'scanner_not_authorized';
  END IF;

  v_match := regexp_match(
    p_qr_payload,
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$'
  );

  IF v_match IS NULL THEN
    v_scan_result := 'not_found';
  ELSE
    v_ticket_id := v_match[1]::uuid;
    v_token := v_match[2];

    SELECT t.*, o.buyer_name, o.payment_status, tt.name AS ticket_name
      INTO v_ticket
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.id = v_ticket_id
     FOR UPDATE OF t;

    IF NOT FOUND OR p_qr_payload IS DISTINCT FROM public.biz_ticket_checkout_qr_payload(v_ticket_id, v_ticket.qr_token_hash, v_qr_token_pepper) THEN
      v_scan_result := 'not_found';
    ELSIF v_ticket.event_id <> p_event_id THEN
      v_scan_result := 'wrong_event';
    ELSIF v_ticket.payment_status <> 'paid' THEN
      v_scan_result := 'void';
    ELSE
      -- ══════════════════════════════════════════════════════════════════════
      -- issue #2160 — THE DAY LADDER. THIS IS THE SINGLE ENFORCEMENT SITE FOR
      -- "a pass is refused on a day it was not issued for, and a scan records
      -- which day it admitted". There must never be a second one.
      --
      -- A pass admits the days it has `ticket_event_dates` rows for. The ladder
      -- never asks which pricing mode minted it — per_day gives N passes with
      -- one row each, all_days gives one pass with N rows, and both are the
      -- same sentence here.
      --
      -- ⚠️  DELETE THE `v_day_count > 0` BRANCH and a guest who bought Saturday
      --     walks in on Sunday, and a Sunday guest is refused on Saturday.
      -- ══════════════════════════════════════════════════════════════════════
      SELECT count(*) INTO v_day_count
        FROM public.ticket_event_dates ted
       WHERE ted.ticket_id = v_ticket.id;

      IF v_day_count = 0 THEN
        -- ── LEGACY / SINGLE-DATE PATH. Byte-for-behaviour identical to
        --    pre-#2160, including the one-shot `status='used'` lifecycle. Every
        --    pass ever issued before this migration is on this path and stays
        --    on it: nothing is backfilled (§A.1).
        IF v_ticket.status = 'used' THEN
          v_scan_result := 'duplicate';
        ELSIF v_ticket.status <> 'valid' THEN
          v_scan_result := 'void';
        ELSE
          -- issue #3281 F-C — experience pass with a booked start: admit only
          -- inside [booked_start - grace, booked_start + duration + grace].
          -- Duration = the named date's length when present, else 2 hours.
          -- Legacy orders (NULL booked_start) keep the any-occurrence window.
          SELECT o.booked_start_at, e.event_type, o.event_date_id
            INTO v_booked_start, v_order_event_type, v_order_event_date_id
            FROM public.orders o
            JOIN public.events e ON e.id = o.event_id
           WHERE o.id = v_ticket.order_id;

          IF v_order_event_type = 'experience' AND v_booked_start IS NOT NULL THEN
            SELECT COALESCE(ed.end_at - ed.start_at, interval '2 hours')
              INTO v_booked_duration
              FROM public.event_dates ed
             WHERE ed.id = v_order_event_date_id;
            IF v_booked_duration IS NULL OR v_booked_duration < interval '2 hours' THEN
              v_booked_duration := interval '2 hours';
            END IF;

            IF now() BETWEEN (v_booked_start - c_grace_before)
                          AND (v_booked_start + v_booked_duration + c_grace_after) THEN
              v_scan_result := 'success';
              v_admitted_day := v_order_event_date_id;
            ELSIF now() < (v_booked_start - c_grace_before) THEN
              v_scan_result := 'not_yet_open';
              v_next_start := v_booked_start;
            ELSE
              v_scan_result := 'event_ended';
              v_last_end := v_booked_start + v_booked_duration;
            END IF;
          ELSE
            -- ORCH-0793 — event time-window check. Reads event_dates per
            -- I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY. Multi-date events
            -- succeed if now() lies in ANY date row's grace-extended window
            -- (most-permissive policy — SPEC §3.1 Decision-2).
            SELECT EXISTS (
              SELECT 1 FROM public.event_dates ed
               WHERE ed.event_id = p_event_id
            ) INTO v_has_event_dates;

            IF NOT v_has_event_dates THEN
              v_scan_result := 'success';
            ELSE
              SELECT EXISTS (
                SELECT 1 FROM public.event_dates ed
                 WHERE ed.event_id = p_event_id
                   AND now() BETWEEN (ed.start_at - c_grace_before)
                                  AND (ed.end_at   + c_grace_after)
              ) INTO v_in_window;

              IF v_in_window THEN
                v_scan_result := 'success';
                SELECT ed.id INTO v_admitted_day
                  FROM public.event_dates ed
                 WHERE ed.event_id = p_event_id
                   AND now() BETWEEN (ed.start_at - c_grace_before)
                                  AND (ed.end_at   + c_grace_after)
                 ORDER BY ed.start_at ASC, ed.id ASC
                 LIMIT 1;
              ELSE
                SELECT MIN(ed.start_at) INTO v_next_start
                  FROM public.event_dates ed
                 WHERE ed.event_id = p_event_id
                   AND ed.start_at - c_grace_before > now();

                IF v_next_start IS NOT NULL THEN
                  v_scan_result := 'not_yet_open';
                ELSE
                  v_scan_result := 'event_ended';
                  SELECT MAX(ed.end_at) INTO v_last_end
                    FROM public.event_dates ed
                   WHERE ed.event_id = p_event_id;
                END IF;
              END IF;
            END IF;
          END IF;

          IF v_scan_result = 'success' THEN
            UPDATE public.tickets
               SET status = 'used',
                   used_at = now(),
                   used_by_scanner_id = p_scanner_user_id
             WHERE id = v_ticket.id;
          END IF;
        END IF;

      ELSE
        -- ── DAY-SCOPED PATH.
        --
        -- `status='used'` here means "FULLY CONSUMED", not "has been scanned":
        -- an all_days pass admitting 2 of its 3 days is still `valid`. The
        -- per-day admission truth is the `scan_events` ledger row, NOT the
        -- status — which is why the duplicate rung below queries the ledger
        -- rather than the status. `'transferred'` is admitted alongside
        -- `'valid'`/`'used'` nowhere: only valid/used are live here, matching
        -- the legacy rungs it replaces.
        --
        -- THE ROSTER NEEDS NO CHANGE, and that was verified rather than
        -- assumed: biz_guest_roster_project counts check-ins as
        -- `status='used' OR used_at IS NOT NULL`
        -- (20270319000873:304), and `used_at` is set on the FIRST admission
        -- below — so a partly-admitted multi-day guest already counts as
        -- checked in with that function completely untouched.
        --
        -- THE WRITE IS LEGAL, and that was verified rather than assumed:
        -- `biz_tickets_enforce_update` (baseline squash:3420-3477) forbids a
        -- scanner-role caller from touching `used_at` outside a strict
        -- valid -> used transition, which would have made this design illegal.
        -- Its FIRST statement is `IF auth.uid() IS NULL THEN RETURN NEW`, and
        -- this function is SECURITY DEFINER invoked by the `scan-ticket` edge
        -- function under the service key, so auth.uid() is NULL and the guard
        -- short-circuits. THE TRIGGER IS NOT MODIFIED.
        IF v_ticket.status NOT IN ('valid', 'used') THEN
          v_scan_result := 'void';
        ELSE
          -- WHICH DAY IS THIS PASS BEING PRESENTED AGAINST RIGHT NOW?
          -- Two occurrences of one event CAN overlap once the 8-hour combined
          -- grace is applied (a day ending 18:00 and the next starting 11:00 do
          -- not; a same-day double session could). The tie-break is specified,
          -- not left to LIMIT 1 without ORDER BY: prefer an occurrence with NO
          -- success row yet (false sorts before true), then the earliest
          -- start_at, then the id. If every in-window day is already admitted
          -- we deliberately land on the earliest so the answer is `duplicate`,
          -- never a silent second admission.
          SELECT ed.id INTO v_target_day
            FROM public.ticket_event_dates ted
            JOIN public.event_dates ed ON ed.id = ted.event_date_id
           WHERE ted.ticket_id = v_ticket.id
             AND now() BETWEEN (ed.start_at - c_grace_before)
                            AND (ed.end_at   + c_grace_after)
           ORDER BY EXISTS (
                      SELECT 1 FROM public.scan_events se
                       WHERE se.ticket_id = v_ticket.id
                         AND se.event_date_id = ed.id
                         AND se.scan_result = 'success'
                    ) ASC,
                    ed.start_at ASC, ed.id ASC
           LIMIT 1;

          IF v_target_day IS NULL THEN
            -- Not inside ANY of THIS PASS'S days. The window is the pass's own
            -- set, never the event's — that is the whole point of the issue.
            SELECT MIN(ed.start_at) INTO v_next_start
              FROM public.ticket_event_dates ted
              JOIN public.event_dates ed ON ed.id = ted.event_date_id
             WHERE ted.ticket_id = v_ticket.id
               AND ed.start_at - c_grace_before > now();

            IF v_next_start IS NOT NULL THEN
              v_scan_result := 'not_yet_open';
            ELSE
              v_scan_result := 'event_ended';
              SELECT MAX(ed.end_at) INTO v_last_end
                FROM public.ticket_event_dates ted
                JOIN public.event_dates ed ON ed.id = ted.event_date_id
               WHERE ted.ticket_id = v_ticket.id;
            END IF;

            -- Attributable refusal: record the day they were TRYING to use.
            SELECT ed.id INTO v_target_day
              FROM public.ticket_event_dates ted
              JOIN public.event_dates ed ON ed.id = ted.event_date_id
             WHERE ted.ticket_id = v_ticket.id
             ORDER BY ed.start_at ASC, ed.id ASC
             LIMIT 1;

          ELSIF EXISTS (
            SELECT 1 FROM public.scan_events se
             WHERE se.ticket_id = v_ticket.id
               AND se.event_date_id = v_target_day
               AND se.scan_result = 'success'
          ) THEN
            -- DEDUPE BY LEDGER, NOT BY STATUS. An all_days pass legitimately
            -- admits once PER DAY, so `status` cannot answer this question.
            -- DELETE THIS RUNG and a two-day pass admits twice on day one.
            v_scan_result := 'duplicate';

          ELSE
            v_scan_result := 'success';
            v_admitted_day := v_target_day;

            -- Is any day of this pass left unadmitted after this one?
            SELECT NOT EXISTS (
              SELECT 1 FROM public.ticket_event_dates ted
               WHERE ted.ticket_id = v_ticket.id
                 AND ted.event_date_id <> v_target_day
                 AND NOT EXISTS (
                   SELECT 1 FROM public.scan_events se
                    WHERE se.ticket_id = v_ticket.id
                      AND se.event_date_id = ted.event_date_id
                      AND se.scan_result = 'success')
            ) INTO v_all_days_consumed;

            UPDATE public.tickets
               SET used_at = COALESCE(used_at, now()),
                   used_by_scanner_id = p_scanner_user_id,
                   -- 'used' means FULLY CONSUMED. Flipped only when no
                   -- unadmitted day remains, so an all_days pass stays 'valid'
                   -- between day 1 and day 2 and can be scanned again.
                   status = CASE WHEN v_all_days_consumed THEN 'used' ELSE status END
             WHERE id = v_ticket.id;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    v_scan_event_id := CASE
      WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id
      ELSE p_event_id
    END;

    INSERT INTO public.scan_events (
      ticket_id, event_id, scanner_user_id, scan_result, client_offline,
      -- issue #2160 — WHICH DAY. On success it is the occurrence that
      -- admitted them (day-scoped AND legacy alike, SC-10); on a day-scoped
      -- refusal it is the day they presented against, so the refusal is
      -- attributable rather than anonymous. NULL on every non-day-scoped
      -- refusal and on not_found / wrong_event, where there is no honest day.
      event_date_id,
      synced_at, metadata
    ) VALUES (
      v_ticket_id, v_scan_event_id, p_scanner_user_id, v_scan_result, false,
      COALESCE(v_admitted_day, v_target_day), now(),
      jsonb_build_object(
        'source', 'scan-ticket',
        'requestedEventId', p_event_id,
        'buyerName', COALESCE(v_ticket.buyer_name, ''),
        'ticketName', COALESCE(v_ticket.ticket_name, ''),
        'nextStartAt', v_next_start,
        'lastEndAt', v_last_end
      )
    )
    RETURNING id INTO v_scan_id;
  END IF;

  RETURN jsonb_build_object(
    'result', v_scan_result,
    'scanId', v_scan_id,
    'ticketId', v_ticket_id,
    'orderId', v_ticket.order_id,
    'buyerName', v_ticket.buyer_name,
    'ticketName', v_ticket.ticket_name,
    'nextStartAt', v_next_start,
    'lastEndAt', v_last_end,
    -- issue #2160 — the day this scan admitted, for the scanner UI.
    'eventDateId', v_admitted_day
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;


-- ---------------------------------------------------------------------------
-- Self-verify probe (fail closed on missing hunks / ACL drift)
-- ---------------------------------------------------------------------------
DO $probe$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='orders' AND column_name='booked_start_at'
  ) THEN
    RAISE EXCEPTION 'issue #3281 probe: orders.booked_start_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ticket_checkout_sessions'
       AND column_name='booked_start_at'
  ) THEN
    RAISE EXCEPTION 'issue #3281 probe: ticket_checkout_sessions.booked_start_at missing';
  END IF;

  v_def := pg_get_functiondef('public.issue_3281_validate_booked_start'::regproc);
  IF position('booked_start_required' IN v_def) = 0
     OR position('booked_start_off_grid' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: validate helper missing refusal codes';
  END IF;

  v_def := pg_get_functiondef('public.issue_1930_ticket_checkout_create_session_base'::regproc);
  IF position('issue_3281_validate_booked_start(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: create_session_base does not call validate';
  END IF;
  IF position('p_booked_start_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: create_session_base missing p_booked_start_at';
  END IF;
  IF position('ticket_sales_not_started' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: #2947 sale_start guard lost';
  END IF;
  IF position('issue_3313_ticket_type_occurrence_taken(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: #3313 per-night capacity lost';
  END IF;

  v_def := pg_get_functiondef('public.biz_ticket_checkout_create_session'::regproc);
  IF position('p_booked_start_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: wrapper missing p_booked_start_at forward';
  END IF;
  IF position('AND event_id=p_event_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: #2696 event-scoped lookup lost';
  END IF;

  v_def := pg_get_functiondef('public.issue_1930_ticket_checkout_finalize_base'::regproc);
  IF position('v_session.booked_start_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: finalize does not copy booked_start_at';
  END IF;

  v_def := pg_get_functiondef('public.pg_notify_reminders_enqueue'::regproc);
  IF position('o.booked_start_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: reminders do not key off booked_start_at';
  END IF;

  v_def := pg_get_functiondef('public.biz_ticket_scan'::regproc);
  IF position('v_booked_start' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3281 probe: scan missing booked-start admit window';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3281 probe: create_session_base must stay service_role-only';
  END IF;
  IF has_function_privilege(
       'authenticated',
       'public.issue_3281_validate_booked_start(uuid,uuid,timestamptz)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3281 probe: validate must stay service_role-only';
  END IF;

  RAISE NOTICE 'issue #3281 booked_start probe: OK';
END
$probe$;

COMMIT;

NOTIFY pgrst, 'reload schema';
