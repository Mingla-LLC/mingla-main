-- #3281 the Explorer listing rule is asked one date at a time: same answers, and
-- the work grows with tiers x dates, never with tiers x dates x dates.
-- MINGLA-INVARIANT: I-3281-EXPLORER-LISTING-PER-DATE | issue #3281 | The tier rule lives once in issue_3281_date_buyable_ticket_types(event, date) and the listing rule in issue_3281_explorer_date_listable_rows(event, date), both inlinable SQL with EXECUTE for postgres and service_role only. The three discover_v2 readers ask it per date with EXISTS, answers equal the 20280320003281 helpers, and the card date walks idx_event_dates_event_id_start_at in start order so LIMIT 1 stops at the first buyable date.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t3281p_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#3281 explorer listing per date FAIL: %', p_message; END IF;
END
$$;

-- The rule exactly as 20280320003281 shipped it (the reference answer).
CREATE FUNCTION pg_temp.t3281p_old_buyable(p_ticket_type_id uuid, p_event_date_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE((
    SELECT tt.deleted_at IS NULL
       AND tt.is_hidden IS NOT TRUE
       AND tt.is_disabled IS NOT TRUE
       AND tt.available_online IS TRUE
       AND (tt.sale_end_at IS NULL OR tt.sale_end_at > now())
       AND d.end_at > now()
       AND d.cancelled_at IS NULL
       AND (tt.valid_occurrence_keys IS NULL OR d.occurrence_key = ANY (tt.valid_occurrence_keys))
       AND (
         tt.is_unlimited IS TRUE
         OR tt.quantity_total IS NULL
         OR CASE
           WHEN tt.valid_occurrence_keys IS NOT NULL
             OR COALESCE((public.issue_3313_event_day_choice(tt.event_id)->>'perOccurrenceCapacity')::boolean, false)
           THEN public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id) < tt.quantity_total
           ELSE COALESCE(tt.sold_count, 0) < tt.quantity_total
         END
       )
      FROM public.ticket_types tt
      JOIN public.event_dates d ON d.id = p_event_date_id AND d.event_id = tt.event_id
     WHERE tt.id = p_ticket_type_id
  ), false);
$fn$;

CREATE FUNCTION pg_temp.t3281p_old_listable(p_event_id uuid, p_event_date_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.ticket_types tt
       WHERE tt.event_id = p_event_id
         AND tt.deleted_at IS NULL
         AND tt.is_hidden IS NOT TRUE
         AND tt.is_disabled IS NOT TRUE
         AND tt.available_online IS TRUE
    )
    OR EXISTS (
      SELECT 1 FROM public.ticket_types tt
       WHERE tt.event_id = p_event_id
         AND pg_temp.t3281p_old_buyable(tt.id, p_event_date_id)
    );
$fn$;

-- The per-event sets exactly as 20280324003281 shipped them, the shape that ran
-- 5.36 s on production. The plan guard below must reject it.
CREATE FUNCTION pg_temp.t3281p_set_buyable(p_event_id uuid)
RETURNS TABLE(ticket_type_id uuid, event_date_id uuid)
LANGUAGE sql STABLE AS $fn$
  SELECT tt.id, d.id
    FROM (
      SELECT CASE
               WHEN EXISTS (
                 SELECT 1 FROM public.ticket_types capped
                  WHERE capped.event_id = p_event_id
                    AND capped.deleted_at IS NULL
                    AND capped.is_hidden IS NOT TRUE
                    AND capped.is_disabled IS NOT TRUE
                    AND capped.available_online IS TRUE
                    AND (capped.sale_end_at IS NULL OR capped.sale_end_at > now())
                    AND capped.is_unlimited IS NOT TRUE
                    AND capped.quantity_total IS NOT NULL
                    AND capped.valid_occurrence_keys IS NULL)
               THEN COALESCE((public.issue_3313_event_day_choice(p_event_id)->>'perOccurrenceCapacity')::boolean, false)
               ELSE false
             END AS per_occurrence_capacity
      OFFSET 0
    ) cap
    JOIN public.ticket_types tt ON tt.event_id = p_event_id
    JOIN public.event_dates d ON d.event_id = tt.event_id
   WHERE tt.deleted_at IS NULL
     AND tt.is_hidden IS NOT TRUE
     AND tt.is_disabled IS NOT TRUE
     AND tt.available_online IS TRUE
     AND (tt.sale_end_at IS NULL OR tt.sale_end_at > now())
     AND d.end_at > now()
     AND d.cancelled_at IS NULL
     AND (tt.valid_occurrence_keys IS NULL OR d.occurrence_key = ANY (tt.valid_occurrence_keys))
     AND (
       tt.is_unlimited IS TRUE
       OR tt.quantity_total IS NULL
       OR CASE
         WHEN tt.valid_occurrence_keys IS NOT NULL OR cap.per_occurrence_capacity
         THEN public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id) < tt.quantity_total
         ELSE COALESCE(tt.sold_count, 0) < tt.quantity_total
       END
     )
$fn$;

CREATE FUNCTION pg_temp.t3281p_set_listable(p_event_id uuid)
RETURNS TABLE(event_date_id uuid)
LANGUAGE sql STABLE AS $fn$
  SELECT d.id
    FROM public.event_dates d
   WHERE d.event_id = p_event_id
     AND (
       NOT EXISTS (
         SELECT 1 FROM public.ticket_types tt
          WHERE tt.event_id = p_event_id
            AND tt.deleted_at IS NULL
            AND tt.is_hidden IS NOT TRUE
            AND tt.is_disabled IS NOT TRUE
            AND tt.available_online IS TRUE
       )
       OR d.id IN (
         SELECT buyable.event_date_id
           FROM pg_temp.t3281p_set_buyable(p_event_id) buyable
       )
     )
$fn$;

CREATE FUNCTION pg_temp.t3281p_base_start(p_city text, p_event uuid)
RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (r->>'next_start_at')::timestamptz
    FROM public.discover_v2_event_base(ARRAY[p_city], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL) AS b(r)
   WHERE r->>'id' = p_event::text
$$;

CREATE FUNCTION pg_temp.t3281p_item_start(p_city text, p_event uuid)
RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (i->>'startsAtUtc')::timestamptz
    FROM jsonb_array_elements(
      public.discover_v2_items('events', ARRAY[p_city], 0, 0, 1, 'UTC', '{}'::jsonb, 0, 50)->'items') AS x(i)
   WHERE i->>'id' = p_event::text
$$;

-- Count the plpgsql owners' calls: the real functions keep their bodies under a
-- new name and a counting wrapper takes the name the rule calls.
ALTER FUNCTION public.issue_3313_event_day_choice(uuid) RENAME TO t3281p_real_day_choice;
CREATE FUNCTION public.issue_3313_event_day_choice(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM set_config('t3281p.day_choice_calls',
    (COALESCE(NULLIF(current_setting('t3281p.day_choice_calls', true), ''), '0')::integer + 1)::text, true);
  RETURN public.t3281p_real_day_choice(p_event_id);
END
$$;
ALTER FUNCTION public.issue_3313_ticket_type_occurrence_taken(uuid, uuid, uuid) RENAME TO t3281p_real_taken;
CREATE FUNCTION public.issue_3313_ticket_type_occurrence_taken(
  p_ticket_type_id uuid, p_event_date_id uuid, p_exclude_session_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM set_config('t3281p.taken_calls',
    (COALESCE(NULLIF(current_setting('t3281p.taken_calls', true), ''), '0')::integer + 1)::text, true);
  RETURN public.t3281p_real_taken(p_ticket_type_id, p_event_date_id, p_exclude_session_id);
END
$$;

CREATE FUNCTION pg_temp.t3281p_reset_counts()
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('t3281p.day_choice_calls', '0', true), set_config('t3281p.taken_calls', '0', true);
$$;
CREATE FUNCTION pg_temp.t3281p_count(p_name text)
RETURNS integer LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(current_setting('t3281p.' || p_name, true), ''), '0')::integer;
$$;

-- Runs a reader-shaped listing query under EXPLAIN (ANALYZE, FORMAT JSON) and
-- returns what it cost: plpgsql owner calls, the rows every scan of
-- ticket_types / event_dates produced summed over all its loops, the largest
-- loop count of any such scan, and whether any function was left un-inlined.
CREATE FUNCTION pg_temp.t3281p_measure(p_sql text,
  OUT taken_calls integer, OUT day_choice_calls integer,
  OUT scan_rows bigint, OUT max_loops bigint, OUT function_scans integer, OUT listed bigint)
LANGUAGE plpgsql AS $$
DECLARE
  v_plan jsonb;
BEGIN
  PERFORM pg_temp.t3281p_reset_counts();
  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || p_sql INTO v_plan;
  taken_calls := pg_temp.t3281p_count('taken_calls');
  day_choice_calls := pg_temp.t3281p_count('day_choice_calls');
  SELECT COALESCE(sum((n->>'Actual Rows')::numeric * (n->>'Actual Loops')::numeric), 0)::bigint,
         COALESCE(max((n->>'Actual Loops')::bigint), 0),
         count(*) FILTER (WHERE n->>'Node Type' = 'Function Scan')
    INTO scan_rows, max_loops, function_scans
    FROM jsonb_path_query(v_plan, 'strict $.**') AS x(n)
   WHERE jsonb_typeof(n) = 'object' AND n ? 'Node Type'
     AND (n->>'Relation Name' IN ('ticket_types', 'event_dates') OR n->>'Node Type' = 'Function Scan');
  SELECT (v_plan->0->'Plan'->>'Actual Rows')::bigint INTO listed;
END
$$;

DO $test$
DECLARE
  v_owner uuid := '32819400-0000-4000-8500-000000000001';
  v_brand uuid := '32819400-0000-4000-8500-000000000002';
  v_ssns uuid := '32819400-0000-4000-8500-000000000010';      -- series, every sale closed
  v_pernight uuid := '32819400-0000-4000-8500-000000000011';  -- per-night cap, Dec full
  v_daylim uuid := '32819400-0000-4000-8500-000000000012';    -- tier valid only on Jan
  v_cancel uuid := '32819400-0000-4000-8500-000000000013';    -- Dec cancelled
  v_presale uuid := '32819400-0000-4000-8500-000000000014';   -- sale opens later
  v_rsvp uuid := '32819400-0000-4000-8500-000000000015';      -- RSVP, no tiers
  v_pool uuid := '32819400-0000-4000-8500-000000000016';      -- three capped tiers, pool sold out
  v_mixed uuid := '32819400-0000-4000-8500-000000000017';     -- pool sold out, unlimited tier open
  v_events uuid[];
  v_many uuid[] := ARRAY[]::uuid[];
  v_session uuid := '32819400-0000-4000-8500-000000000090';
  v_dec timestamptz := date_trunc('minute', now()) + interval '10 days';
  v_jan timestamptz := date_trunc('minute', now()) + interval '40 days';
  v_feb timestamptz := date_trunc('minute', now()) + interval '70 days';
  v_mar timestamptz := date_trunc('minute', now()) + interval '100 days';
  v_event uuid;
  v_i integer := 0;
  v_n integer;
  v_t integer;
  v_kind text;
  v_tt uuid;
  v_tts uuid[];
  v_dates uuid[];
  v_dec_id uuid;
  v_jan_id uuid;
  v_pairs integer := 0;
  v_true integer := 0;
  v_mismatch text;
  v_dates_n integer;
  v_tier_dates integer;
  v_new record;
  v_old record;
  v_calls integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'explorer-perdate-owner@example.test');
  INSERT INTO public.profiles(id,email) VALUES(v_owner,'explorer-perdate-owner@example.test');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES(v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_owner,'Explorer per-date brand','explorer-perdate-brand','USD',now(),now());
  INSERT INTO public.admin_internal_brands(brand_id,is_internal,reason,marked_by)
    VALUES(v_brand,false,'#3281 explorer listing per-date fixture','pg17');

  -- ---------------------------------------------------------------------------
  -- Scenario fixture: four dates each.
  v_events := ARRAY[v_ssns,v_pernight,v_daylim,v_cancel,v_presale,v_rsvp,v_pool,v_mixed];
  FOREACH v_event IN ARRAY v_events LOOP
    v_i := v_i + 1;
    INSERT INTO public.events(
      id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
      city,location_geo,published_at,rsvp_discoverable,created_at,updated_at
    ) VALUES(
      v_event,v_brand,v_owner,'Explorer per-date '||v_i,'explorer-perdate-'||v_i,
      CASE WHEN v_event = v_rsvp THEN 'rsvp' ELSE 'event' END,
      'scheduled','public','UTC','USD','#3281P City '||v_i,
      point(-170 + v_i * 20, -10),now(),v_event = v_rsvp,now(),now()
    );
    UPDATE public.events SET is_recurring = true, is_multi_date = false
     WHERE id = v_event AND v_event IN (v_ssns,v_pernight);
    INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master,occurrence_key) VALUES
      (v_event,v_dec,v_dec + interval '4 hours','UTC',true,'dec'),
      (v_event,v_jan,v_jan + interval '4 hours','UTC',false,'jan'),
      (v_event,v_feb,v_feb + interval '4 hours','UTC',false,'feb'),
      (v_event,v_mar,v_mar + interval '4 hours','UTC',false,'mar');
  END LOOP;

  -- SSNS: two free tiers whose sale closed for the whole series.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_start_at,sale_end_at)
    VALUES
      (v_ssns,'Ready player one',0,'USD',true,70,false,1,4,true,false,0,now()-interval '20 days',now()-interval '2 days'),
      (v_ssns,'Player 1 + Player 2',0,'USD',true,70,false,1,4,true,false,1,now()-interval '20 days',now()-interval '2 days');
  -- Per-night capacity: two places, Dec fully held, the next nights open.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order)
    VALUES (v_pernight,'Two seats',0,'USD',true,2,false,1,2,true,false,0)
    RETURNING id INTO v_tt;
  SELECT id INTO v_dec_id FROM public.event_dates WHERE event_id = v_pernight AND start_at = v_dec;
  INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
      status,idempotency_key,expires_at)
    VALUES (v_session,v_pernight,v_brand,'Holder','holder-perdate@example.test','+15555550197',
      'pending_free','ticket_checkout:v2:'||v_pernight::text||':hold',now()+interval '15 minutes');
  INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,ticket_name_at_purchase,quantity)
    VALUES (v_session,v_tt,'Two seats',2);
  INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id,event_date_id)
    VALUES (v_session,v_dec_id);
  -- A day-limited tier, valid on Jan only.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,valid_occurrence_keys)
    VALUES (v_daylim,'January only',0,'USD',true,50,false,1,4,true,false,0,ARRAY['jan']);
  -- Dec cancelled; the open tier sells the other dates.
  UPDATE public.event_dates SET cancelled_at = now() WHERE event_id = v_cancel AND start_at = v_dec;
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order)
    VALUES (v_cancel,'General',0,'USD',true,40,false,1,4,true,false,0);
  -- A pre-sale: opens in five days.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sale_start_at,sale_end_at)
    VALUES (v_presale,'Early bird',0,'USD',true,50,false,1,4,true,false,0,now()+interval '5 days',now()+interval '9 days');
  -- Three capped tiers, the shared pool of each sold out (not per night).
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sold_count)
    VALUES
      (v_pool,'A',0,'USD',true,10,false,1,4,true,false,0,10),
      (v_pool,'B',0,'USD',true,10,false,1,4,true,false,1,10),
      (v_pool,'C',0,'USD',true,10,false,1,4,true,false,2,12);
  -- Pool sold out, but an unlimited tier is still open.
  INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
      min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sold_count)
    VALUES
      (v_mixed,'Capped',0,'USD',true,10,false,1,4,true,false,0,10),
      (v_mixed,'Open',0,'USD',true,NULL,true,1,4,true,false,1,0);

  -- ---------------------------------------------------------------------------
  -- Many-dates fixture, shaped like production's recurring events: four
  -- per-night events with 16 weekly dates and 4 capped tiers, the first 12
  -- nights fully held on every tier; two events whose 4 tiers each sell a few
  -- of 16 dates; one shared-pool event, 20 dates, 3 capped tiers sold out.
  FOR v_i IN 1..7 LOOP
    v_kind := CASE WHEN v_i <= 4 THEN 'pernight' WHEN v_i <= 6 THEN 'daylist' ELSE 'pool' END;
    v_event := ('32819400-0000-4000-8600-' || lpad(v_i::text, 12, '0'))::uuid;
    v_many := v_many || v_event;
    INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
        city,location_geo,published_at,is_recurring,is_multi_date,created_at,updated_at)
      VALUES(v_event,v_brand,v_owner,'Explorer many '||v_kind||' '||v_i,'explorer-perdate-many-'||v_i,
        'event','scheduled','public','UTC','USD','#3281P Many',point(-60 + v_i * 0.01, 40),now(),
        v_kind <> 'pool',false,now(),now());
    v_dates := ARRAY[]::uuid[];
    FOR v_n IN 1..CASE WHEN v_kind = 'pool' THEN 20 ELSE 16 END LOOP
      INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master,occurrence_key)
        VALUES(v_event, v_dec + make_interval(hours => v_i, days => (v_n - 1) * 7),
               v_dec + make_interval(hours => v_i + 4, days => (v_n - 1) * 7), 'UTC', v_n = 1, 'n'||v_n)
        RETURNING id INTO v_tt;
      v_dates := v_dates || v_tt;
    END LOOP;
    v_tts := ARRAY[]::uuid[];
    FOR v_t IN 1..CASE WHEN v_kind = 'pool' THEN 3 ELSE 4 END LOOP
      INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
          min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,
          valid_occurrence_keys,sold_count)
        VALUES(v_event,'Tier '||v_t,0,'USD',true,CASE WHEN v_kind = 'pernight' THEN 2 ELSE 30 END,false,
          1,2,true,false,v_t,
          CASE WHEN v_kind = 'daylist' THEN
            ARRAY(SELECT 'n'||g FROM generate_series(1,16) g WHERE g % 3 = v_t % 3 AND g > 8) END,
          CASE WHEN v_kind = 'pool' THEN 30 ELSE 0 END)
        RETURNING id INTO v_tt;
      v_tts := v_tts || v_tt;
    END LOOP;
    IF v_kind = 'pernight' THEN
      FOR v_n IN 1..12 LOOP
        FOREACH v_tt IN ARRAY v_tts LOOP
          INSERT INTO public.ticket_checkout_sessions(id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
              status,idempotency_key,expires_at)
            VALUES(gen_random_uuid(),v_event,v_brand,'Holder','holder-many@example.test','+15555550196',
              'pending_free','t3281p:'||v_event::text||':'||v_n||':'||v_tt::text,now()+interval '15 minutes')
            RETURNING id INTO v_session;
          INSERT INTO public.ticket_checkout_session_items(checkout_session_id,ticket_type_id,ticket_name_at_purchase,quantity)
            VALUES(v_session,v_tt,'Tier',2);
          INSERT INTO public.ticket_checkout_session_event_dates(checkout_session_id,event_date_id)
            VALUES(v_session,v_dates[v_n]);
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- (a) Same answers as the shipped rule, every date: the reference, both
  -- scalar helpers, the per-date rows and the per-event set.
  SELECT count(*), count(*) FILTER (WHERE old_listable),
         string_agg(format('%s/%s old=%s scalar=%s rows=%s set=%s', e.title, d.occurrence_key,
           old_listable, new_scalar, new_rows, new_set), '; ')
           FILTER (WHERE old_listable IS DISTINCT FROM new_scalar OR old_listable IS DISTINCT FROM new_rows
             OR old_listable IS DISTINCT FROM new_set)
    INTO v_pairs, v_true, v_mismatch
    FROM public.events e
    JOIN public.event_dates d ON d.event_id = e.id
    -- Each per-event set is built once per event, then matched to its dates.
    LEFT JOIN (SELECT l.event_date_id
                 FROM unnest(v_events || v_many) AS ev(id)
                 CROSS JOIN LATERAL public.issue_3281_explorer_listable_dates(ev.id) l) s
      ON s.event_date_id = d.id
    CROSS JOIN LATERAL (SELECT
      pg_temp.t3281p_old_listable(e.id, d.id) AS old_listable,
      public.issue_3281_explorer_date_listable(e.id, d.id) AS new_scalar,
      EXISTS (SELECT 1 FROM public.issue_3281_explorer_date_listable_rows(e.id, d.id)) AS new_rows,
      s.event_date_id IS NOT NULL AS new_set) x
   WHERE e.id = ANY (v_events || v_many);
  PERFORM pg_temp.t3281p_assert(v_mismatch IS NULL, '(a) listing differs from the shipped rule: ' || COALESCE(v_mismatch, ''));
  PERFORM pg_temp.t3281p_assert(v_pairs = 32 + 6 * 16 + 20 AND v_true BETWEEN 40 AND v_pairs - 40,
    format('(a) the comparison covers listable and unlisted dates (%s dates, %s listable)', v_pairs, v_true));

  SELECT count(*), count(*) FILTER (WHERE old_buyable),
         string_agg(format('%s %s/%s old=%s scalar=%s per_date=%s set=%s', e.title, tt.name, d.occurrence_key,
           old_buyable, new_scalar, new_per_date, new_set), '; ')
           FILTER (WHERE old_buyable IS DISTINCT FROM new_scalar OR old_buyable IS DISTINCT FROM new_per_date
             OR old_buyable IS DISTINCT FROM new_set)
    INTO v_pairs, v_true, v_mismatch
    FROM public.events e
    JOIN public.ticket_types tt ON tt.event_id = e.id
    JOIN public.event_dates d ON d.event_id = e.id
    LEFT JOIN (SELECT b.ticket_type_id, b.event_date_id
                 FROM unnest(v_events || v_many) AS ev(id)
                 CROSS JOIN LATERAL public.issue_3281_buyable_ticket_dates(ev.id) b) s
      ON s.ticket_type_id = tt.id AND s.event_date_id = d.id
    CROSS JOIN LATERAL (SELECT
      pg_temp.t3281p_old_buyable(tt.id, d.id) AS old_buyable,
      public.issue_3281_ticket_buyable_on_date(tt.id, d.id) AS new_scalar,
      tt.id IN (SELECT b.ticket_type_id FROM public.issue_3281_date_buyable_ticket_types(e.id, d.id) b) AS new_per_date,
      s.event_date_id IS NOT NULL AS new_set) x
   WHERE e.id = ANY (v_events || v_many);
  PERFORM pg_temp.t3281p_assert(v_mismatch IS NULL, '(a) tier answer differs from the shipped rule: ' || COALESCE(v_mismatch, ''));
  PERFORM pg_temp.t3281p_assert(v_pairs = 44 + 6 * 16 * 4 + 20 * 3 AND v_true BETWEEN 40 AND v_pairs - 40,
    format('(a) the tier comparison covers buyable and unbuyable pairs (%s pairs, %s buyable)', v_pairs, v_true));

  -- (a) What each feed reader shows, scenario by scenario.
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 1',v_ssns) IS NULL
      AND pg_temp.t3281p_item_start('#3281P City 1',v_ssns) IS NULL,
    '(a) SSNS: a series whose sales all closed is not listed');
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 2',v_pernight) = v_jan
      AND pg_temp.t3281p_item_start('#3281P City 2',v_pernight) = v_jan,
    '(a) per-night capacity: Dec is full, the card shows Jan');
  SELECT id INTO v_jan_id FROM public.event_dates WHERE event_id = v_daylim AND start_at = v_jan;
  SELECT id INTO v_tt FROM public.ticket_types WHERE event_id = v_daylim;
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 3',v_daylim) = v_jan
      AND pg_temp.t3281p_item_start('#3281P City 3',v_daylim) = v_jan
      AND public.issue_3281_ticket_buyable_on_date(v_tt, v_jan_id)
      AND NOT public.issue_3281_ticket_buyable_on_date(v_tt,
        (SELECT id FROM public.event_dates WHERE event_id = v_daylim AND start_at = v_dec)),
    '(a) a day-limited tier is buyable on its date only, and the card shows that date');
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 4',v_cancel) = v_jan
      AND pg_temp.t3281p_item_start('#3281P City 4',v_cancel) = v_jan,
    '(a) a cancelled date is skipped');
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 5',v_presale) = v_dec
      AND pg_temp.t3281p_item_start('#3281P City 5',v_presale) = v_dec,
    '(a) a pre-sale lists at the next date');
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 6',v_rsvp) = v_dec
      AND pg_temp.t3281p_item_start('#3281P City 6',v_rsvp) = v_dec,
    '(a) an RSVP with no tiers lists at the next date');
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 7',v_pool) IS NULL
      AND pg_temp.t3281p_item_start('#3281P City 7',v_pool) IS NULL,
    '(a) every capped tier sold out on the shared pool: not listed');
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_base_start('#3281P City 8',v_mixed) = v_dec
      AND pg_temp.t3281p_item_start('#3281P City 8',v_mixed) = v_dec,
    '(a) an open unlimited tier keeps the event listed');
  PERFORM pg_temp.t3281p_assert(COALESCE(public.discover_v2_nearest_city(-10, -30)->>'label', '') NOT LIKE '#3281P City 7%'
      AND public.discover_v2_nearest_city(-10, -10)->>'label' LIKE '#3281P City 8%',
    '(a) the empty-state city suggestion follows the same rule');
  -- Many dates: a per-night event shows its first open night (the 13th), a
  -- day-list event the first date one of its tiers sells (the 9th), the
  -- sold-out pool is not listed.
  PERFORM pg_temp.t3281p_assert(
      pg_temp.t3281p_base_start('#3281P Many', v_many[1]) = v_dec + make_interval(hours => 1, days => 12 * 7)
      AND pg_temp.t3281p_item_start('#3281P Many', v_many[1]) = v_dec + make_interval(hours => 1, days => 12 * 7)
      AND pg_temp.t3281p_base_start('#3281P Many', v_many[5]) = v_dec + make_interval(hours => 5, days => 8 * 7)
      AND pg_temp.t3281p_item_start('#3281P Many', v_many[5]) = v_dec + make_interval(hours => 5, days => 8 * 7)
      AND pg_temp.t3281p_base_start('#3281P Many', v_many[7]) IS NULL
      AND pg_temp.t3281p_item_start('#3281P Many', v_many[7]) IS NULL,
    '(a) many dates: each card shows the first date a guest can buy');

  -- ---------------------------------------------------------------------------
  -- (b) Shape: the rule functions are plain inlinable SQL, private, and the
  -- readers ask them per date.
  PERFORM pg_temp.t3281p_assert((
    SELECT count(*) FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.issue_3281_date_buyable_ticket_types(uuid,uuid)'::regprocedure,
                     'public.issue_3281_explorer_date_listable_rows(uuid,uuid)'::regprocedure,
                     'public.issue_3281_buyable_ticket_dates(uuid)'::regprocedure,
                     'public.issue_3281_explorer_listable_dates(uuid)'::regprocedure)
       AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')
       AND p.proretset AND p.provolatile = 's'
       AND NOT p.prosecdef AND NOT p.proisstrict AND p.proconfig IS NULL) = 4,
    '(b) the rule functions are plain inlinable SQL (no SECURITY DEFINER, no SET, STABLE, not STRICT)');
  PERFORM pg_temp.t3281p_assert(
    NOT has_function_privilege('anon','public.issue_3281_date_buyable_ticket_types(uuid,uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.issue_3281_date_buyable_ticket_types(uuid,uuid)','EXECUTE')
      AND NOT has_function_privilege('anon','public.issue_3281_explorer_date_listable_rows(uuid,uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.issue_3281_explorer_date_listable_rows(uuid,uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.issue_3281_explorer_date_listable(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.issue_3281_explorer_date_listable_rows(uuid,uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.issue_3281_date_buyable_ticket_types(uuid,uuid)','EXECUTE'),
    '(b) only service_role (and the owner) may execute the rule');
  PERFORM pg_temp.t3281p_assert((
    SELECT bool_and(position('issue_3281_explorer_date_listable_rows(' IN pg_get_functiondef(r)) > 0
                AND position('issue_3281_explorer_listable_dates' IN pg_get_functiondef(r)) = 0)
      FROM unnest(ARRAY[
        'public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8)'::regprocedure,
        'public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)'::regprocedure,
        'public.discover_v2_nearest_city(float8,float8)'::regprocedure]) r),
    '(b) every reader asks the listing rule per date');

  -- ---------------------------------------------------------------------------
  -- (c) Plan guard. The work for the many-dates events must grow with
  -- tiers x dates: each (tier, date) the readers ask about runs the per-date
  -- count at most once and each date the day choice at most once. The
  -- 20280324003281 set form re-enumerated the event's every tier x date for
  -- every date asked (tiers x dates x dates); it must fail the same bounds.
  SELECT count(*) INTO v_dates_n
    FROM public.event_dates d WHERE d.event_id = ANY (v_many) AND d.end_at >= now();
  SELECT count(*) INTO v_tier_dates
    FROM public.event_dates d JOIN public.ticket_types tt ON tt.event_id = d.event_id
   WHERE d.event_id = ANY (v_many) AND d.end_at >= now();

  SELECT * INTO v_new FROM pg_temp.t3281p_measure(format(
    'SELECT e.id, d.id FROM public.events e JOIN public.event_dates d ON d.event_id = e.id '
    'WHERE e.id = ANY (%L::uuid[]) AND d.end_at >= now() '
    'AND EXISTS (SELECT 1 FROM public.issue_3281_explorer_date_listable_rows(e.id, d.id))', v_many));
  SELECT * INTO v_old FROM pg_temp.t3281p_measure(format(
    'SELECT e.id, d.id FROM public.events e JOIN public.event_dates d ON d.event_id = e.id '
    'WHERE e.id = ANY (%L::uuid[]) AND d.end_at >= now() '
    'AND d.id IN (SELECT l.event_date_id FROM pg_temp.t3281p_set_listable(e.id) l)', v_many));
  RAISE NOTICE '#3281 plan guard: % dates, % tier-dates; per-date form %; 20280324003281 set form %',
    v_dates_n, v_tier_dates, v_new, v_old;

  PERFORM pg_temp.t3281p_assert(v_new.listed = v_old.listed AND v_new.listed BETWEEN 1 AND v_dates_n - 1,
    format('(c) both forms list the same dates (%s / %s of %s)', v_new.listed, v_old.listed, v_dates_n));
  PERFORM pg_temp.t3281p_assert(v_new.function_scans = 0,
    '(c) the per-date rule is inlined: no Function Scan in the reader-shaped plan');
  PERFORM pg_temp.t3281p_assert(v_new.taken_calls BETWEEN 1 AND v_tier_dates,
    format('(c) the per-night counter ran %s times for %s tier-dates', v_new.taken_calls, v_tier_dates));
  PERFORM pg_temp.t3281p_assert(v_new.day_choice_calls BETWEEN 1 AND v_dates_n,
    format('(c) the day choice ran %s times for %s dates', v_new.day_choice_calls, v_dates_n));
  PERFORM pg_temp.t3281p_assert(v_new.scan_rows <= 2 * v_tier_dates + 6 * v_dates_n,
    format('(c) tier and date scans produced %s rows for %s tier-dates and %s dates',
      v_new.scan_rows, v_tier_dates, v_dates_n));
  -- The guard can tell: the shipped set form breaks every bound above.
  PERFORM pg_temp.t3281p_assert(v_old.taken_calls > v_tier_dates
      AND v_old.scan_rows > 2 * v_tier_dates + 6 * v_dates_n,
    format('(c) the guard no longer rejects the 20280324003281 set form: %s', v_old));

  -- The readers over the same events, for the log only: how often a reader
  -- re-runs its LATERAL (per brand row, say) is the reader plan's choice, not
  -- the rule's, so these counts are printed, not bounded. The rule's own cost
  -- per asked date is bounded above.
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM count(*) FROM public.discover_v2_event_base(ARRAY['#3281P Many'], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  RAISE NOTICE '#3281 discover_v2_event_base: per-night counter %, day choice %',
    pg_temp.t3281p_count('taken_calls'), pg_temp.t3281p_count('day_choice_calls');
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM public.discover_v2_items('events', ARRAY['#3281P Many'], 40, -60, 1, 'UTC', '{}'::jsonb, 0, 50);
  RAISE NOTICE '#3281 discover_v2_items(events): per-night counter %, day choice %',
    pg_temp.t3281p_count('taken_calls'), pg_temp.t3281p_count('day_choice_calls');
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM public.discover_v2_nearest_city(40, -60);
  RAISE NOTICE '#3281 discover_v2_nearest_city: per-night counter %, day choice %',
    pg_temp.t3281p_count('taken_calls'), pg_temp.t3281p_count('day_choice_calls');

  -- ---------------------------------------------------------------------------
  -- (d) The card date stops at the first buyable date. Two 20-date events whose
  -- first date is buyable: a shared pool (capped tiers without a day list, so
  -- every date asked runs the day choice exactly once) and a per-night event
  -- (every date asked runs the per-night counter for its first tier). Asking
  -- the rule on every date and sorting after would cost 20 calls each.
  FOR v_i IN 1..2 LOOP
    v_event := ('32819400-0000-4000-8700-' || lpad(v_i::text, 12, '0'))::uuid;
    INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
        city,location_geo,published_at,is_recurring,is_multi_date,created_at,updated_at)
      VALUES(v_event,v_brand,v_owner,'Explorer early '||v_i,'explorer-perdate-early-'||v_i,
        'event','scheduled','public','UTC','USD','#3281P Early '||v_i,point(60 + v_i, 40),now(),
        v_i = 2,false,now(),now());
    INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master,occurrence_key)
      SELECT v_event, v_dec + make_interval(days => (g - 1) * 3), v_dec + make_interval(days => (g - 1) * 3, hours => 4),
             'UTC', g = 1, 'e'||g
        FROM generate_series(1, 20) g;
    INSERT INTO public.ticket_types(event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
        min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,sold_count)
      SELECT v_event,'Tier '||t,0,'USD',true,CASE WHEN v_i = 1 THEN 30 ELSE 2 END,false,1,2,true,false,t,0
        FROM generate_series(1, CASE WHEN v_i = 1 THEN 3 ELSE 4 END) t;
  END LOOP;
  PERFORM pg_temp.t3281p_assert(
      pg_temp.t3281p_base_start('#3281P Early 1', '32819400-0000-4000-8700-000000000001') = v_dec
      AND pg_temp.t3281p_item_start('#3281P Early 2', '32819400-0000-4000-8700-000000000002') = v_dec,
    '(d) a 20-date event whose first date is buyable shows its first date');
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM count(*) FROM public.discover_v2_event_base(ARRAY['#3281P Early 1'], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_count('day_choice_calls') BETWEEN 1 AND 2,
    format('(d) discover_v2_event_base asked the rule on %s of 20 dates (day choice calls) before picking the first',
      pg_temp.t3281p_count('day_choice_calls')));
  -- The base only walks to the card date: it does not price per date (since
  -- 20280330004265 discover_v2_items prices the cards it shows).
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM count(*) FROM public.discover_v2_event_base(ARRAY['#3281P Early 2'], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_count('taken_calls') BETWEEN 1 AND 2,
    format('(d) discover_v2_event_base ran the per-night counter %s times on a 20-date event whose first night is open',
      pg_temp.t3281p_count('taken_calls')));
  -- discover_v2_items reads the base, then walks its own window: one date each.
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM public.discover_v2_items('events', ARRAY['#3281P Early 1'], 40, 61, 1, 'UTC', '{}'::jsonb, 0, 50);
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_count('day_choice_calls') BETWEEN 2 AND 4,
    format('(d) discover_v2_items asked the rule on %s dates for a 20-date event whose first date is buyable',
      pg_temp.t3281p_count('day_choice_calls')));
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM public.discover_v2_items('events', ARRAY['#3281P Early 2'], 40, 62, 1, 'UTC', '{}'::jsonb, 0, 50);
  -- The base walk and the items window walk (one date each), and the card
  -- priced once over its 4 capped tiers on the night it shows.
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_count('taken_calls') BETWEEN 2 + 4 AND 4 + 4,
    format('(d) discover_v2_items ran the per-night counter %s times for a 20-date event whose first night is open',
      pg_temp.t3281p_count('taken_calls')));
  -- With a price filter the card is priced once before the page, and the page
  -- reuses that price: the same bound.
  PERFORM pg_temp.t3281p_reset_counts();
  v_calls := jsonb_array_length(public.discover_v2_items('events', ARRAY['#3281P Early 2'], 40, 62, 1, 'UTC',
    '{"price":["free_ticket"]}'::jsonb, 0, 50)->'items');
  PERFORM pg_temp.t3281p_assert(v_calls = 1 AND pg_temp.t3281p_count('taken_calls') BETWEEN 2 + 4 AND 4 + 4,
    format('(d) discover_v2_items with a price filter listed %s card(s) and ran the per-night counter %s times',
      v_calls, pg_temp.t3281p_count('taken_calls')));
  -- The order the walk reads is served by an index on (event_id, start_at, id).
  PERFORM pg_temp.t3281p_assert(
    pg_get_indexdef(to_regclass('public.idx_event_dates_event_id_start_at'))
      LIKE 'CREATE INDEX idx_event_dates_event_id_start_at ON public.event_dates USING btree (event_id, start_at, id)',
    '(d) idx_event_dates_event_id_start_at (event_id, start_at, id) exists');

  -- An event with no capped tier never runs either plpgsql owner.
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM count(*) FROM public.event_dates d
   WHERE d.event_id = v_rsvp
     AND EXISTS (SELECT 1 FROM public.issue_3281_explorer_date_listable_rows(v_rsvp, d.id));
  PERFORM pg_temp.t3281p_assert(pg_temp.t3281p_count('day_choice_calls') = 0
      AND pg_temp.t3281p_count('taken_calls') = 0,
    '(c) an event without capped tiers runs neither plpgsql owner');
  -- A shared-pool event asks the day choice (its tiers are capped without a
  -- day list) but never the per-night counter.
  PERFORM pg_temp.t3281p_reset_counts();
  PERFORM count(*) FROM public.event_dates d
   WHERE d.event_id = v_pool
     AND EXISTS (SELECT 1 FROM public.issue_3281_explorer_date_listable_rows(v_pool, d.id));
  v_calls := pg_temp.t3281p_count('day_choice_calls');
  PERFORM pg_temp.t3281p_assert(v_calls BETWEEN 1 AND 4 AND pg_temp.t3281p_count('taken_calls') = 0,
    format('(c) a shared-pool event on four dates: day choice %s times, per-night counter %s times',
      v_calls, pg_temp.t3281p_count('taken_calls')));
END;
$test$;

ROLLBACK;
