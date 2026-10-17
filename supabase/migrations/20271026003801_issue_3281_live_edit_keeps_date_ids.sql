-- issue #3281 Experience Round 1 PR 1c — live edit keeps date / stop ids
--
-- THE DEFECT. biz_update_live_experience (latest body: 20271014103827) ran
-- DELETE FROM event_dates / experience_stops then re-inserted with NEW ids on
-- every live save. orders.event_date_id and scan_events.event_date_id are
-- ON DELETE SET NULL; ticket_event_dates is RESTRICT since #3285. A sold
-- experience's bookings lost their day anchor; notice triggers also churned.
-- The events twin was fixed in #3285; this migration brings experiences to
-- the same reconcile-in-place contract (rule J).
--
-- ALSO. F-A: pg_topup_recurring_experiences filtered status IN
-- ('scheduled','published'); 'published' is not a legal events.status and
-- 'live' was excluded, so open-daily series that are live never topped up.
--
-- WHAT THIS MIGRATION DOES
--   §1 pg_expand_experience_recurrence — skip existing starts (count toward cap)
--   §2 pg_topup_recurring_experiences — status IN ('scheduled','live')
--   §3 biz_update_live_experience — reconcile stops by stop_order and dates by
--      start_at (P3 for single/recurring seed moves); held dates never deleted
--      via issue_3285_event_date_hold_reason; keep #3827 notice hunks + probe
--      pins; recurring date-shift gate compares the master seed only
--   §4 self-verify probe
--
-- DRAFT invariant (declared beside tests; registry frozen):
--   I-PROPOSED-3281-LIVE-EDIT-KEEPS-DATE-IDS — a live edit never changes the id
--   of an unchanged date; a held date is never deleted.
--
-- Apply via Seth's reviewed migration lane before any dependent edge merge.
-- Serialise with any other re-emitter of biz_update_live_experience.

BEGIN;

-- ===========================================================================
-- §1 — Expander skips existing starts so reconcile + top-up keep ids.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_expand_experience_recurrence(
  p_event_id      uuid,
  p_master_start  timestamptz,
  p_master_end    timestamptz,
  p_rule          jsonb,
  p_timezone      text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  c_hard_cap   constant integer := 52; -- mirror recurrenceRule.ts HARD_CAP
  c_safety     constant integer := 365 * 5; -- runaway-loop guard (5y of days)
  v_preset     text;
  v_byday      text;     -- MO|TU|WE|TH|FR|SA|SU
  v_bymonthday integer;  -- 1..28
  v_bysetpos   integer;  -- 1..4 | -1
  v_term_kind  text;     -- count | until | never
  v_term_count integer;
  v_until      date;
  v_max_count  integer;
  -- the master is occurrence #1; we emit up to (v_max_count - 1) more.
  v_emitted    integer := 0;
  v_duration   interval;
  v_tz         text := COALESCE(NULLIF(p_timezone, ''), 'UTC');
  -- walk the LOCAL calendar day (in the event's timezone) so weekday/day-of-month
  -- math matches the authored intent regardless of UTC offset.
  v_master_local date;
  v_cursor       date;
  v_local_time   time;
  v_next_start   timestamptz;
  v_safety       integer := c_safety;
  -- weekday index helpers (Postgres dow: 0=Sun..6=Sat).
  v_target_dow integer;
  v_occ_idx    integer;
  v_is_last    boolean;
BEGIN
  IF p_rule IS NULL THEN
    RETURN 0;
  END IF;

  v_preset     := NULLIF(p_rule->>'preset', '');
  v_byday      := NULLIF(p_rule->>'byDay', '');
  v_bymonthday := NULLIF(p_rule->>'byMonthDay', '')::integer;
  v_bysetpos   := NULLIF(p_rule->>'bySetPos', '')::integer;
  v_term_kind  := NULLIF(p_rule->'termination'->>'kind', '');
  v_term_count := NULLIF(p_rule->'termination'->>'count', '')::integer;
  v_until      := NULLIF(p_rule->'termination'->>'until', '')::date;

  IF v_preset IS NULL THEN
    RETURN 0; -- nothing to expand without a preset
  END IF;

  -- Termination cap (mirror recurrenceRule.ts expandRecurrenceToDates):
  --   count → min(count, HARD_CAP); until/never → HARD_CAP.
  IF v_term_kind = 'count' AND v_term_count IS NOT NULL THEN
    v_max_count := LEAST(v_term_count, c_hard_cap);
  ELSE
    v_max_count := c_hard_cap;
  END IF;
  IF v_max_count <= 1 THEN
    RETURN 0; -- master alone satisfies the count
  END IF;

  v_duration   := p_master_end - p_master_start;
  v_master_local := (p_master_start AT TIME ZONE v_tz)::date;
  v_local_time   := (p_master_start AT TIME ZONE v_tz)::time;
  v_cursor       := v_master_local;

  -- Walk forward day-by-day testing each calendar day for a preset match
  -- (mirrors the client matchesPreset walk). Master (#1) already inserted, so we
  -- emit while (emitted + 1) < v_max_count.
  WHILE v_safety > 0 AND (v_emitted + 1) < v_max_count LOOP
    v_safety := v_safety - 1;
    v_cursor := v_cursor + 1; -- next calendar day

    -- until-bound (inclusive): stop once we pass the until date.
    IF v_until IS NOT NULL AND v_cursor > v_until THEN
      EXIT;
    END IF;

    -- preset match (ports matchesPreset):
    IF (
      CASE v_preset
        WHEN 'daily' THEN true
        WHEN 'weekly' THEN
          v_byday IS NOT NULL
          AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
        WHEN 'biweekly' THEN
          v_byday IS NOT NULL
          AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
          -- only every other week from the master (round to whole weeks).
          AND (ROUND((v_cursor - v_master_local) / 7.0)::int % 2) = 0
        WHEN 'monthly_dom' THEN
          v_bymonthday IS NOT NULL
          AND EXTRACT(day FROM v_cursor)::int = v_bymonthday
        WHEN 'monthly_dow' THEN
          v_byday IS NOT NULL AND v_bysetpos IS NOT NULL
          AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
          AND (
            CASE
              WHEN v_bysetpos = -1 THEN
                -- last occurrence of this weekday in the month
                EXTRACT(month FROM (v_cursor + 7))::int <> EXTRACT(month FROM v_cursor)::int
              ELSE
                -- which occurrence (1..5) of this weekday is this calendar day
                CEIL(EXTRACT(day FROM v_cursor)::numeric / 7.0)::int = v_bysetpos
            END
          )
        ELSE false
      END
    ) THEN
      -- materialize this occurrence at the SAME local clock time + duration.
      -- issue #3281 1c: skip starts that already exist (live-edit / top-up keep ids).
      -- Count skips toward the cap so we do not walk past HARD_CAP inventing more.
      v_next_start := (v_cursor + v_local_time) AT TIME ZONE v_tz;
      IF EXISTS (
        SELECT 1 FROM public.event_dates ed
         WHERE ed.event_id = p_event_id AND ed.start_at = v_next_start
      ) THEN
        v_emitted := v_emitted + 1;
      ELSE
        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
        VALUES (p_event_id, v_next_start, v_next_start + v_duration, v_tz, false);
        v_emitted := v_emitted + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_emitted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pg_expand_experience_recurrence(uuid, timestamptz, timestamptz, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_expand_experience_recurrence(uuid, timestamptz, timestamptz, jsonb, text)
  TO service_role;

-- ===========================================================================
-- §2 — Top-up includes live experiences (F-A).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_topup_recurring_experiences(
  p_floor integer DEFAULT 14
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now            timestamptz := now();
  v_e              record;
  v_future_count   integer;
  v_forward_total  integer;
  v_room           integer;
  v_last_start     timestamptz;
  v_last_end       timestamptz;
  v_duration       interval;
  v_master_start   timestamptz;
  v_master_end     timestamptz;
  v_master_tz      text;
  v_synthetic_cap  integer;
  v_emitted        integer;
  v_topped         integer := 0;
BEGIN
  FOR v_e IN
    SELECT e.id, e.recurrence_rules, e.timezone
    FROM public.events e
    WHERE e.event_type = 'experience'
      AND e.is_recurring = true
      AND e.status IN ('scheduled','live')  -- issue #3281 1c F-A: 'published' is not legal; include live
      AND e.recurrence_rules IS NOT NULL
      AND e.deleted_at IS NULL
  LOOP
    -- Skip series the rule has already finished.
    IF public.pg_recurrence_is_terminated(v_e.recurrence_rules, v_e.id, v_now) THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_future_count
    FROM public.event_dates ed
    WHERE ed.event_id = v_e.id AND ed.start_at > v_now;

    -- Only top up when below the floor.
    IF v_future_count >= p_floor THEN
      CONTINUE;
    END IF;

    -- Room left under the 52-forward cap.
    v_room := 52 - v_future_count;
    IF v_room <= 0 THEN
      CONTINUE;
    END IF;

    -- Anchor the synthetic expansion at the LAST existing date (forward-only:
    -- the expander emits strictly after this start, never re-creating an
    -- existing (event_id, start_at)). Preserve the master's wall-clock + tz +
    -- duration so cadence math matches the original authored intent.
    SELECT ed.start_at, ed.end_at INTO v_last_start, v_last_end
    FROM public.event_dates ed
    WHERE ed.event_id = v_e.id
    ORDER BY ed.start_at DESC
    LIMIT 1;

    IF v_last_start IS NULL THEN
      -- No dates at all → the backfill (20261009000001) owns this casualty class;
      -- top-up never fabricates a first date.
      CONTINUE;
    END IF;

    SELECT ed.timezone INTO v_master_tz
    FROM public.event_dates ed
    WHERE ed.event_id = v_e.id AND ed.is_master = true
    LIMIT 1;
    v_master_tz := COALESCE(NULLIF(v_master_tz, ''), NULLIF(v_e.timezone, ''), 'UTC');

    v_duration     := COALESCE(v_last_end - v_last_start, INTERVAL '0');
    v_master_start := v_last_start;
    v_master_end   := v_last_start + v_duration;

    -- The expander caps total emitted at min(rule cap, 52) counting the anchor as
    -- #1. We want at most v_room NEW rows, so pass a synthetic rule whose count
    -- termination is (v_room + 1) — but only when the rule is a plain never/until
    -- (count rules are handled by termination above). Simplest correct approach:
    -- call the expander with the real rule; it self-caps at 52 emitted from the
    -- anchor. Then trim any rows beyond the 52-forward cap.
    v_synthetic_cap := v_room; -- documented; the expander self-caps at 52 too.

    v_emitted := public.pg_expand_experience_recurrence(
      v_e.id, v_master_start, v_master_end, v_e.recurrence_rules, v_master_tz
    );

    -- The expander never inserts its anchor row, so no duplicate of v_last_start
    -- is created. Enforce the 52-FORWARD cap (the expander caps emitted-from-
    -- anchor, but pre-existing forward rows + new ones could exceed 52): drop the
    -- newest forward rows beyond the cap (never the master, never past rows).
    SELECT count(*) INTO v_forward_total
    FROM public.event_dates ed
    WHERE ed.event_id = v_e.id AND ed.start_at > v_now;

    IF v_forward_total > 52 THEN
      DELETE FROM public.event_dates ed
      WHERE ed.id IN (
        SELECT id FROM public.event_dates
        WHERE event_id = v_e.id
          AND start_at > v_now
          AND is_master = false
        ORDER BY start_at DESC
        LIMIT (v_forward_total - 52)
      );
    END IF;

    IF v_emitted > 0 THEN
      v_topped := v_topped + 1;
      RAISE NOTICE 'ORCH-1153 top-up: event % +% occurrences (future now %)',
        v_e.id, v_emitted, LEAST(v_forward_total, 52);
    END IF;
  END LOOP;

  RETURN v_topped;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_topup_recurring_experiences(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_topup_recurring_experiences(integer) TO service_role;

-- ===========================================================================
-- §3 — biz_update_live_experience: reconcile in place (from 20271014103827).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.biz_update_live_experience(p_event_id uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- issue #3827 buyer email [H0 notice-declare]
  v_notice jsonb;
  v_user_id          uuid;
  v_existing         public.events%ROWTYPE;
  v_brand            record;
  v_now              timestamptz := now();
  v_trimmed_reason   text;
  v_total_sold       int;
  -- header / modes
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_old_resolved     integer;
  -- stops
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_existing_stop_keys text[];
  v_new_stop_keys    text[];
  v_dropped_stops    text[];
  -- single-mode shared place
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  -- dates
  v_when_mode        text;
  v_when             jsonb;
  v_multi_dates      jsonb;
  v_recurrence_rules jsonb;
  v_timezone         text;
  v_date_iso         text;
  v_doors            text;
  v_ends             text;
  v_start            timestamptz;
  v_end              timestamptz;
  v_date_entry       jsonb;
  v_min_start        timestamptz;
  v_is_recurring     boolean;
  v_is_multi_date    boolean;
  v_next_occurrence  timestamptz;
  v_new_date_starts  timestamptz[];
  v_old_date_starts  timestamptz[];
  v_old_date_ends    timestamptz[];
  v_new_date_ends    timestamptz[];
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across edited dates
  v_dates_changed    boolean := false;
  -- audit
  v_severity         text;
  v_changed_keys     text[];
  v_log_id           uuid;
  v_affected_order_ids uuid[];
  -- return
  v_event            public.events%ROWTYPE;
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
  -- issue #3281 1c — reconcile-in-place scratch
  v_stop_id          uuid;
  v_keep_stop_orders integer[] := '{}'::integer[];
  v_stop_order       integer;
  v_date_id          uuid;
  v_keep_date_ids    uuid[] := '{}'::uuid[];
  v_hold             text;
  v_master_id        uuid;
  v_existing_master_start timestamptz;
  v_existing_master_end   timestamptz;
  v_seed_unchanged   boolean := false;
BEGIN
  -- ---------- 1. Auth + reason ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Load + permission + status gate ----------
  SELECT * INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;

  IF v_existing.event_type <> 'experience' THEN
    RAISE EXCEPTION 'event_not_an_experience'
      USING HINT = 'biz_update_live_experience only handles event_type=experience rows.';
  END IF;

  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    -- Draft edits NEVER route here; non-live statuses are rejected so the live
    -- guards can never trip a draft.
    RETURN jsonb_build_object('ok', false, 'reason', 'experience_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_existing.brand_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- ---------- 3. Sold-count context ----------
  v_total_sold := public.biz_experience_sold_count(p_event_id);

  -- ---------- 4. Parse payload (mirror biz_publish_experience) ----------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;
  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'experience_description_invalid';
  END IF;

  -- META-ORCH-1059 Sub-E FIX (live-edit dropped the vibe): persist curated
  -- experience_intents on edit, mirroring biz_publish_experience. The wizard
  -- sends p_payload->'experience_intents' (1-4 of the 4 brand ids); validate +
  -- require >=1 so a live/published experience stays deck-eligible. Key absent
  -- => leave existing intents unchanged.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(DISTINCT btrim(elem))
      INTO v_intents
      FROM jsonb_array_elements_text(p_payload->'experience_intents') AS elem
     WHERE btrim(elem) <> '';
  ELSIF p_payload ? 'experience_intent'
        AND NULLIF(btrim(p_payload->>'experience_intent'), '') IS NOT NULL THEN
    v_intents := ARRAY[btrim(p_payload->>'experience_intent')];
  ELSE
    v_intents := v_existing.experience_intents;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF v_intents IS NULL OR array_length(v_intents, 1) IS NULL THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    NULLIF(v_existing.currency, '')::text,
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  v_location_mode := COALESCE(NULLIF(p_payload->>'location_mode', ''), 'single');
  v_pricing_mode  := COALESCE(NULLIF(p_payload->>'pricing_mode', ''), 'whole');
  IF v_location_mode NOT IN ('single','per_stop') OR v_pricing_mode NOT IN ('whole','per_stop') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  v_is_free  := COALESCE((p_payload->>'is_free')::boolean, false);
  v_capacity := NULLIF(p_payload->>'capacity', '')::integer;
  v_whole_price := COALESCE(NULLIF(p_payload->>'whole_price_cents', '')::integer, 0);

  v_stops := COALESCE(p_payload->'stops', '[]'::jsonb);
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN
    v_stops := '[]'::jsonb;
  END IF;
  v_stop_count := jsonb_array_length(v_stops);

  -- Live experiences are published: enforce the same 2–5 stop gate.
  IF v_stop_count < 2 OR v_stop_count > 5 THEN
    RAISE EXCEPTION 'experience_stop_count_invalid';
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
  END LOOP;

  -- Resolve the new ONE-ticket total (I-1).
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  -- ---------- 5. REFUND-GATE (only when sold > 0, except capacity) ----------

  -- 5a. Capacity can't drop below sold (applies whenever capacity present).
  IF (p_payload ? 'capacity') AND v_capacity IS NOT NULL AND v_capacity < v_total_sold THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'capacity_below_sold',
      'affected_order_count', v_total_sold
    );
  END IF;

  IF v_total_sold > 0 THEN
    -- 5b. Price lock — the ONE ticket's resolved price can't change once sold.
    SELECT price_cents INTO v_old_resolved
    FROM public.ticket_types
    WHERE event_id = p_event_id AND deleted_at IS NULL
    ORDER BY display_order ASC
    LIMIT 1;
    v_old_resolved := COALESCE(v_old_resolved, 0);

    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'price_change_with_sales',
        'affected_order_count', v_total_sold
      );
    END IF;

    -- 5c. Stop removal — removing an existing (by name) stop is destructive.
    SELECT array_agg(lower(btrim(place_name)))
      INTO v_existing_stop_keys
      FROM public.experience_stops
      WHERE event_id = p_event_id;
    v_existing_stop_keys := COALESCE(v_existing_stop_keys, '{}'::text[]);

    SELECT array_agg(lower(btrim(s->>'place_name')))
      INTO v_new_stop_keys
      FROM jsonb_array_elements(v_stops) s;
    v_new_stop_keys := COALESCE(v_new_stop_keys, '{}'::text[]);

    v_dropped_stops := (
      SELECT COALESCE(array_agg(k), '{}'::text[])
      FROM unnest(v_existing_stop_keys) k
      WHERE NOT (k = ANY (v_new_stop_keys))
    );

    IF array_length(v_dropped_stops, 1) > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'stop_removed_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_stops', to_jsonb(v_dropped_stops)
      );
    END IF;
  END IF;

  -- ---------- 6. Resolve the date model + date-shift gate ----------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), NULLIF(v_existing.timezone, ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');

  -- ORCH-1153 WS1 SEED-HARDENING (F-4). A stale client seed can send a recurring
  -- whenMode but a NULL recurrence_rules (e.g. firstRecurrenceRule returned null
  -- on an unexpected jsonb shape). Below, date reconcile + expand only run when
  -- recurrence_rules IS NOT NULL — so a dropped rule would leave the series
  -- without fresh children. Re-derive the rule from the PERSISTED
  -- events.recurrence_rules rather than draining the series. Net: a live-edit
  -- that omits the rule can never silently drain a recurring series.
  IF v_is_recurring
     AND v_recurrence_rules IS NULL
     AND v_existing.is_recurring = true
     AND v_existing.recurrence_rules IS NOT NULL THEN
    v_recurrence_rules := v_existing.recurrence_rules;
  END IF;

  IF v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- Build the proposed occurrence start/end arrays (sorted by start).
  IF v_when_mode IN ('single','recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    v_new_date_starts := ARRAY[v_start];
    v_new_date_ends   := ARRAY[v_end];
  ELSE
    IF v_multi_dates IS NULL
       OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_multi_dates) = 0 THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_new_date_starts := '{}'::timestamptz[];
    v_new_date_ends := '{}'::timestamptz[];
    FOR v_date_entry IN
      SELECT value FROM jsonb_array_elements(v_multi_dates)
      ORDER BY (value->>'date'), (value->>'startTime')
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      v_new_date_starts := v_new_date_starts || v_start;
      v_new_date_ends := v_new_date_ends || v_end;
    END LOOP;
  END IF;


  -- ORCH-1075 paid-publish integrity guards (experience live-edit) --------
  -- Q3: block ANY resulting PAID state while not Stripe-ready (free->paid AND
  -- paid->paid), and block shifting onto an already-past date. Structured
  -- return shape matches this RPC. FREE edits are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF NOT v_is_free AND v_resolved_total > 0 THEN
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
    END IF;
    SELECT max(d) INTO v_max_end FROM unnest(v_new_date_ends) AS d;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
    END IF;
  END IF;

  -- Date-shift gate (only with sales). Compare against current event_dates.
  -- issue #3281 1c: for recurring, only the master seed is in the payload; expanded
  -- children must not count as a shift on a title/price-neutral live edit.
  IF v_total_sold > 0 THEN
    IF v_when_mode = 'recurring' THEN
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id AND is_master = true;
    ELSE
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id;
    END IF;
    v_old_date_starts := COALESCE(v_old_date_starts, '{}'::timestamptz[]);
    v_old_date_ends   := COALESCE(v_old_date_ends, '{}'::timestamptz[]);

    IF COALESCE(array_length(v_old_date_starts, 1), 0)
         IS DISTINCT FROM COALESCE(array_length(v_new_date_starts, 1), 0) THEN
      v_dates_changed := true;
    ELSE
      FOR v_idx IN 1 .. COALESCE(array_length(v_old_date_starts, 1), 0)
      LOOP
        IF v_old_date_starts[v_idx] IS DISTINCT FROM v_new_date_starts[v_idx]
           OR v_old_date_ends[v_idx] IS DISTINCT FROM v_new_date_ends[v_idx] THEN
          v_dates_changed := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_dates_changed THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', (
          SELECT COALESCE(jsonb_agg(to_char(d AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '[]'::jsonb)
          FROM unnest(v_old_date_starts) d
        )
      );
    END IF;
  END IF;

  -- ---------- 7. APPLY (all gates passed) ----------
  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
  END IF;

  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    experience_intents = v_intents,
    experience_intent  = v_intent,
    currency          = v_currency,
    timezone          = v_timezone,
    location_mode     = v_location_mode,
    pricing_mode      = v_pricing_mode,
    whole_price_cents = CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    is_recurring      = v_is_recurring,
    is_multi_date     = v_is_multi_date,
    recurrence_rules  = v_recurrence_rules,
    pass_tax          = CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE pass_tax END,
    pass_mingla_fee   = CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE pass_mingla_fee END,
    pass_service_fee  = CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE pass_service_fee END,
    theme             = jsonb_set(
                          COALESCE(theme, '{}'::jsonb),
                          '{experience_meta,venue_text}',
                          to_jsonb(COALESCE(NULLIF(v_stops->0->>'address', ''), '')),
                          true
                        ),
    updated_at        = v_now
  WHERE id = p_event_id;

  -- issue #3281 1c — reconcile experience_stops in place (match by stop_order).
  -- Kept ids matter for R2/R3 per-stop address choice; never DELETE+reinsert.
  v_idx := 0;
  v_keep_stop_orders := '{}'::integer[];
  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF v_location_mode = 'single' THEN
      v_s_place_id := v_shared_place_id;
      v_s_address  := v_shared_place_addr;
      v_s_city     := v_shared_city;
      v_s_region   := v_shared_region;
      v_s_country  := v_shared_country;
      v_s_lat      := v_shared_lat;
      v_s_lng      := v_shared_lng;
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
    END IF;

    v_s_images := COALESCE(
      (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_stop->'image_urls') = 'array'
              THEN v_stop->'image_urls' ELSE '[]'::jsonb END)),
      ARRAY[]::text[]
    );
    v_s_start := NULLIF(v_stop->>'start_time', '')::time;
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;
    v_stop_order := COALESCE((v_stop->>'stop_order')::integer, v_idx);

    UPDATE public.experience_stops SET
      place_id     = v_s_place_id,
      place_name   = btrim(v_stop->>'place_name'),
      address      = COALESCE(v_s_address, ''),
      city         = v_s_city,
      region       = v_s_region,
      country_code = v_s_country,
      lat          = v_s_lat,
      lng          = v_s_lng,
      image_urls   = v_s_images,
      start_time   = v_s_start,
      price_cents  = v_s_price,
      ai_description = COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
    WHERE event_id = p_event_id AND stop_order = v_stop_order
    RETURNING id INTO v_stop_id;

    IF v_stop_id IS NULL THEN
      INSERT INTO public.experience_stops (
        event_id, stop_order, place_id, place_name, address,
        city, region, country_code, lat, lng,
        image_urls, start_time, price_cents, ai_description
      ) VALUES (
        p_event_id,
        v_stop_order,
        v_s_place_id,
        btrim(v_stop->>'place_name'),
        COALESCE(v_s_address, ''),
        v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
        v_s_images, v_s_start, v_s_price,
        COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
      );
    END IF;

    v_keep_stop_orders := v_keep_stop_orders || v_stop_order;
    v_stop_id := NULL;
    v_idx := v_idx + 1;
  END LOOP;

  DELETE FROM public.experience_stops
   WHERE event_id = p_event_id
     AND NOT (stop_order = ANY (v_keep_stop_orders));

  -- Rewrite the ONE ticket (I-1). Preserve identity by UPDATEing the live ticket
  -- in place (so existing order_line_items.ticket_type_id stays valid) rather
  -- than soft-delete + insert.
  UPDATE public.ticket_types SET
    name           = 'Standard',
    price_cents    = v_resolved_total,
    currency       = v_currency,
    quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
    is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
    is_free        = (v_resolved_total = 0),
    updated_at     = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  -- issue #3281 1c — reconcile event_dates in place (match by start_at; P3 for
  -- single/recurring one-occurrence moves). Held rows never deleted
  -- (issue_3285_event_date_hold_reason). Recurring children survive when the
  -- master seed is unchanged; the expander skips existing starts.
  v_min_start := NULL;
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    IF v_min_start IS NULL OR v_new_date_starts[v_idx] < v_min_start THEN
      v_min_start := v_new_date_starts[v_idx];
    END IF;
  END LOOP;

  SELECT ed.start_at, ed.end_at INTO v_existing_master_start, v_existing_master_end
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id AND ed.is_master = true
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  v_seed_unchanged := (
    v_when_mode = 'recurring'
    AND v_existing_master_start IS NOT DISTINCT FROM v_start
    AND v_existing_master_end IS NOT DISTINCT FROM v_end
  );

  v_keep_date_ids := '{}'::uuid[];
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    v_date_id := NULL;
    SELECT ed.id INTO v_date_id
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.start_at = v_new_date_starts[v_idx]
       AND NOT (ed.id = ANY (v_keep_date_ids))
     ORDER BY ed.id
     LIMIT 1;

    -- P3: a single/recurring experience's one seed occurrence keeps its id when
    -- its start moves (unsold path only; sold shifts are gated above).
    IF v_date_id IS NULL
       AND v_when_mode IN ('single', 'recurring')
       AND COALESCE(array_length(v_new_date_starts, 1), 0) = 1 THEN
      SELECT ed.id INTO v_date_id
        FROM public.event_dates ed
       WHERE ed.event_id = p_event_id
         AND ed.is_master = true
         AND NOT (ed.id = ANY (v_keep_date_ids))
       ORDER BY ed.start_at, ed.id
       LIMIT 1;
      IF v_date_id IS NULL THEN
        SELECT ed.id INTO v_date_id
          FROM public.event_dates ed
         WHERE ed.event_id = p_event_id
           AND NOT (ed.id = ANY (v_keep_date_ids))
         ORDER BY ed.start_at, ed.id
         LIMIT 1;
      END IF;
    END IF;

    IF v_date_id IS NOT NULL THEN
      UPDATE public.event_dates
         SET start_at = v_new_date_starts[v_idx],
             end_at = v_new_date_ends[v_idx],
             timezone = v_timezone
       WHERE id = v_date_id
         AND (start_at, end_at, timezone) IS DISTINCT FROM
             (v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone);
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    ELSE
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id, v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone,
        v_new_date_starts[v_idx] = v_min_start
      )
      RETURNING id INTO v_date_id;
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    END IF;
  END LOOP;

  -- Recurring children: keep when the master seed is unchanged.
  IF v_seed_unchanged THEN
    SELECT COALESCE(v_keep_date_ids, '{}'::uuid[])
           || COALESCE(array_agg(ed.id), '{}'::uuid[])
      INTO v_keep_date_ids
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.is_master = false
       AND NOT (ed.id = ANY (COALESCE(v_keep_date_ids, '{}'::uuid[])));
  END IF;

  -- Remove only unheld rows that are not in the keep set.
  FOR v_date_id IN
    SELECT ed.id FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND NOT (ed.id = ANY (v_keep_date_ids))
  LOOP
    v_hold := public.issue_3285_event_date_hold_reason(v_date_id);
    IF v_hold IS NOT NULL THEN
      RAISE EXCEPTION 'multi_date_remove_with_sales'
        USING DETAIL = format('issue #3281: occurrence %s is held (%s)', v_date_id, v_hold);
    END IF;
    DELETE FROM public.ticket_event_dates ted
     USING public.tickets t
     WHERE t.id = ted.ticket_id
       AND ted.event_date_id = v_date_id
       AND t.status NOT IN ('valid', 'used', 'transferred', 'refund_pending');
    DELETE FROM public.event_dates WHERE id = v_date_id;
  END LOOP;

  -- Exactly one master = the earliest occurrence.
  SELECT ed.id INTO v_master_id
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  UPDATE public.event_dates
     SET is_master = false
   WHERE event_id = p_event_id
     AND is_master
     AND id IS DISTINCT FROM v_master_id;
  IF v_master_id IS NOT NULL THEN
    UPDATE public.event_dates SET is_master = true WHERE id = v_master_id AND NOT is_master;
  END IF;

  v_next_occurrence := v_min_start;

  -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION on live-edit. Seed
  -- row(s) are reconciled above; for a `recurring` rule, expand the 2nd..Nth
  -- bookable occurrences (bounded 52-cap). The expander skips starts that
  -- already exist so surviving date ids stay put. I-4 preserved.
  IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN
    PERFORM public.pg_expand_experience_recurrence(
      p_event_id, v_start, v_end, v_recurrence_rules, v_timezone
    );

    -- ORCH-1153 WS1 live-edit DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN). After
    -- re-materialisation a recurring experience must never have zero future
    -- occurrences (unless the rule is count-exhausted / until-expired). Blocks a
    -- live-edit that would shift the master into the past with a non-productive
    -- rule. count/until series whose window legitimately closed are EXEMPT.
    IF NOT EXISTS (
          SELECT 1 FROM public.event_dates ed
          WHERE ed.event_id = p_event_id AND ed.start_at > v_now
        )
       AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)
    THEN
      RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';
    END IF;
  END IF;

  IF v_next_occurrence IS NOT NULL THEN
    UPDATE public.events
    SET theme = jsonb_set(
          COALESCE(theme, '{}'::jsonb),
          '{experience_meta,next_occurrence_at}',
          to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          true
        ),
        updated_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- ---------- 8. Audit log ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_payload));

  IF (p_payload ? 'capacity' OR p_payload ? 'stops' OR p_payload ? 'whenMode'
      OR p_payload ? 'whole_price_cents' OR p_payload ? 'pricing_mode') THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_affected_order_ids
    FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled');

  INSERT INTO public.experience_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_existing.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    jsonb_build_object('changed_keys', to_jsonb(v_changed_keys)),
    v_affected_order_ids,
    v_now
  ) RETURNING id INTO v_log_id;

  -- issue #3827 buyer email [H1 notice-flush]
  v_notice := public.event_edit_notice_flush(p_event_id, v_trimmed_reason, 'experience', false);

  -- ---------- 9. Return payload (mirror biz_publish_experience shape) ----------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys),
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0),
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    -- issue #3827 buyer email [H2 notice-result]
    'buyer_notice', v_notice
  );
END;
$function$
;

COMMENT ON FUNCTION public.biz_update_live_experience(uuid, jsonb, text) IS
  'META-ORCH-1059 Sub-E + #3827 notice + #3281 1c stable ids: atomic published-'
  'experience patch writer. Reconciles experience_stops (by stop_order) and '
  'event_dates (by start_at; held rows never deleted) in place so live edits '
  'never rewrite booking anchors. Buyer-protection refund-gate unchanged.';

-- ===========================================================================
-- §4 — Self-verify probe.
-- ===========================================================================
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef('public.biz_update_live_experience(uuid,jsonb,text)'::regprocedure)
    INTO v_src;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: biz_update_live_experience missing';
  END IF;
  IF position('DELETE FROM public.event_dates WHERE event_id = p_event_id' IN v_src) > 0 THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: biz_update_live_experience still deletes all event_dates';
  END IF;
  IF position('DELETE FROM public.experience_stops WHERE event_id = p_event_id' IN v_src) > 0 THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: biz_update_live_experience still deletes all experience_stops';
  END IF;
  IF position('issue_3285_event_date_hold_reason' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: hold_reason guard missing from live-edit reconcile';
  END IF;
  IF position('event_edit_notice_flush' IN v_src) = 0
     OR position('buyer_notice' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: #3827 notice hunks missing from biz_update_live_experience';
  END IF;
  IF position('dates_shifted_with_sales' IN v_src) = 0
     OR position('stop_removed_with_sales' IN v_src) = 0
     OR position('price_change_with_sales' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: sold-ticket refusals missing from biz_update_live_experience';
  END IF;

  SELECT pg_get_functiondef('public.pg_topup_recurring_experiences(integer)'::regprocedure)
    INTO v_src;
  IF position(CHR(39) || 'live' || CHR(39) IN v_src) = 0
     OR position(CHR(39) || 'published' || CHR(39) IN v_src) > 0 THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: pg_topup_recurring_experiences status filter not scheduled|live';
  END IF;

  SELECT pg_get_functiondef('public.pg_expand_experience_recurrence(uuid,timestamptz,timestamptz,jsonb,text)'::regprocedure)
    INTO v_src;
  IF position('issue #3281 1c' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3281_1c_verify: expander does not skip existing starts';
  END IF;
END
$verify$;

COMMIT;
