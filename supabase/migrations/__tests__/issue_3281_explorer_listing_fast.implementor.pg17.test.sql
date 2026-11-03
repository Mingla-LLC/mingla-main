-- #3281 the Explorer listing rule gives the same answer as before, fast.
-- MINGLA-INVARIANT: I-3281-EXPLORER-LISTING-RULE-INLINED | issue #3281 | The Explorer listing rule lives once, in the inlinable SQL set functions issue_3281_buyable_ticket_dates and issue_3281_explorer_listable_dates (LANGUAGE sql, STABLE, not SECURITY DEFINER, no SET, not STRICT); discover_v2_event_base, discover_v2_items and discover_v2_nearest_city read them, the planner inlines them, issue_3313_event_day_choice runs at most once per event and issue_3313_ticket_type_occurrence_taken only for capped tiers counted per date. Answers equal the 20280320003281 helpers.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t3281f_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#3281 explorer listing fast FAIL: %', p_message; END IF;
END
$$;

-- The rule exactly as 20280320003281 shipped it (the reference answer).
CREATE FUNCTION pg_temp.t3281f_old_buyable(p_ticket_type_id uuid, p_event_date_id uuid)
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

CREATE FUNCTION pg_temp.t3281f_old_listable(p_event_id uuid, p_event_date_id uuid)
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
         AND pg_temp.t3281f_old_buyable(tt.id, p_event_date_id)
    );
$fn$;

CREATE FUNCTION pg_temp.t3281f_base_start(p_city text, p_event uuid)
RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (r->>'next_start_at')::timestamptz
    FROM public.discover_v2_event_base(ARRAY[p_city], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL) AS b(r)
   WHERE r->>'id' = p_event::text
$$;

CREATE FUNCTION pg_temp.t3281f_item_start(p_city text, p_event uuid)
RETURNS timestamptz LANGUAGE sql AS $$
  SELECT (i->>'startsAtUtc')::timestamptz
    FROM jsonb_array_elements(
      public.discover_v2_items('events', ARRAY[p_city], 0, 0, 1, 'UTC', '{}'::jsonb, 0, 50)->'items') AS x(i)
   WHERE i->>'id' = p_event::text
$$;

-- (b) Count the plpgsql owners' calls: the real functions keep their bodies
-- under a new name and a counting wrapper takes the name the rule calls.
ALTER FUNCTION public.issue_3313_event_day_choice(uuid) RENAME TO t3281f_real_day_choice;
CREATE FUNCTION public.issue_3313_event_day_choice(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM set_config('t3281f.day_choice_calls',
    (COALESCE(NULLIF(current_setting('t3281f.day_choice_calls', true), ''), '0')::integer + 1)::text, true);
  RETURN public.t3281f_real_day_choice(p_event_id);
END
$$;
ALTER FUNCTION public.issue_3313_ticket_type_occurrence_taken(uuid, uuid, uuid) RENAME TO t3281f_real_taken;
CREATE FUNCTION public.issue_3313_ticket_type_occurrence_taken(
  p_ticket_type_id uuid, p_event_date_id uuid, p_exclude_session_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM set_config('t3281f.taken_calls',
    (COALESCE(NULLIF(current_setting('t3281f.taken_calls', true), ''), '0')::integer + 1)::text, true);
  RETURN public.t3281f_real_taken(p_ticket_type_id, p_event_date_id, p_exclude_session_id);
END
$$;

CREATE FUNCTION pg_temp.t3281f_reset_counts()
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('t3281f.day_choice_calls', '0', true), set_config('t3281f.taken_calls', '0', true);
$$;
CREATE FUNCTION pg_temp.t3281f_count(p_name text)
RETURNS integer LANGUAGE sql AS $$
  SELECT COALESCE(NULLIF(current_setting('t3281f.' || p_name, true), ''), '0')::integer;
$$;

DO $test$
DECLARE
  v_owner uuid := '32819200-0000-4000-8500-000000000001';
  v_brand uuid := '32819200-0000-4000-8500-000000000002';
  v_ssns uuid := '32819200-0000-4000-8500-000000000010';      -- series, every sale closed
  v_pernight uuid := '32819200-0000-4000-8500-000000000011';  -- per-night cap, Dec full
  v_daylim uuid := '32819200-0000-4000-8500-000000000012';    -- tier valid only on Jan
  v_cancel uuid := '32819200-0000-4000-8500-000000000013';    -- Dec cancelled
  v_presale uuid := '32819200-0000-4000-8500-000000000014';   -- sale opens later
  v_rsvp uuid := '32819200-0000-4000-8500-000000000015';      -- RSVP, no tiers
  v_pool uuid := '32819200-0000-4000-8500-000000000016';      -- three capped tiers, pool sold out
  v_mixed uuid := '32819200-0000-4000-8500-000000000017';     -- pool sold out, unlimited tier open
  v_events uuid[];
  v_session uuid := '32819200-0000-4000-8500-000000000090';
  v_dec timestamptz := date_trunc('minute', now()) + interval '10 days';
  v_jan timestamptz := date_trunc('minute', now()) + interval '40 days';
  v_feb timestamptz := date_trunc('minute', now()) + interval '70 days';
  v_mar timestamptz := date_trunc('minute', now()) + interval '100 days';
  v_event uuid;
  v_i integer := 0;
  v_tt uuid;
  v_dec_id uuid;
  v_jan_id uuid;
  v_pairs integer := 0;
  v_true integer := 0;
  v_mismatch text;
  v_line text;
  v_plan text := '';
  v_calls integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'explorer-fast-owner@example.test');
  INSERT INTO public.profiles(id,email) VALUES(v_owner,'explorer-fast-owner@example.test');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES(v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_owner,'Explorer fast brand','explorer-fast-brand','USD',now(),now());
  INSERT INTO public.admin_internal_brands(brand_id,is_internal,reason,marked_by)
    VALUES(v_brand,false,'#3281 explorer listing fast fixture','pg17');

  v_events := ARRAY[v_ssns,v_pernight,v_daylim,v_cancel,v_presale,v_rsvp,v_pool,v_mixed];
  FOREACH v_event IN ARRAY v_events LOOP
    v_i := v_i + 1;
    INSERT INTO public.events(
      id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,
      city,location_geo,published_at,rsvp_discoverable,created_at,updated_at
    ) VALUES(
      v_event,v_brand,v_owner,'Explorer fast '||v_i,'explorer-fast-'||v_i,
      CASE WHEN v_event = v_rsvp THEN 'rsvp' ELSE 'event' END,
      'scheduled','public','UTC','USD','#3281F City '||v_i,
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
    VALUES (v_session,v_pernight,v_brand,'Holder','holder-fast@example.test','+15555550198',
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

  -- (a) Same answers as the shipped rule, every date and every tier/date pair.
  SELECT count(*), count(*) FILTER (WHERE old_listable),
         string_agg(format('%s/%s old=%s scalar=%s set=%s', e.title, d.occurrence_key,
           old_listable, new_scalar, new_set), '; ')
           FILTER (WHERE old_listable IS DISTINCT FROM new_scalar OR old_listable IS DISTINCT FROM new_set)
    INTO v_pairs, v_true, v_mismatch
    FROM public.events e
    JOIN public.event_dates d ON d.event_id = e.id
    CROSS JOIN LATERAL (SELECT
      pg_temp.t3281f_old_listable(e.id, d.id) AS old_listable,
      public.issue_3281_explorer_date_listable(e.id, d.id) AS new_scalar,
      d.id IN (SELECT l.event_date_id FROM public.issue_3281_explorer_listable_dates(e.id) l) AS new_set) x
   WHERE e.id = ANY (v_events);
  PERFORM pg_temp.t3281f_assert(v_mismatch IS NULL, '(a) listing differs from the shipped rule: ' || COALESCE(v_mismatch, ''));
  PERFORM pg_temp.t3281f_assert(v_pairs = 32 AND v_true BETWEEN 1 AND 31,
    format('(a) the comparison covers listable and unlisted dates (%s dates, %s listable)', v_pairs, v_true));

  SELECT count(*), count(*) FILTER (WHERE old_buyable),
         string_agg(format('%s %s/%s old=%s new=%s', e.title, tt.name, d.occurrence_key, old_buyable, new_buyable), '; ')
           FILTER (WHERE old_buyable IS DISTINCT FROM new_buyable)
    INTO v_pairs, v_true, v_mismatch
    FROM public.events e
    JOIN public.ticket_types tt ON tt.event_id = e.id
    JOIN public.event_dates d ON d.event_id = e.id
    CROSS JOIN LATERAL (SELECT
      pg_temp.t3281f_old_buyable(tt.id, d.id) AS old_buyable,
      public.issue_3281_ticket_buyable_on_date(tt.id, d.id) AS new_buyable) x
   WHERE e.id = ANY (v_events);
  PERFORM pg_temp.t3281f_assert(v_mismatch IS NULL, '(a) tier answer differs from the shipped rule: ' || COALESCE(v_mismatch, ''));
  PERFORM pg_temp.t3281f_assert(v_pairs = 44 AND v_true BETWEEN 1 AND 43,
    format('(a) the tier comparison covers buyable and unbuyable pairs (%s pairs, %s buyable)', v_pairs, v_true));

  -- (a) What each feed reader shows, scenario by scenario.
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 1',v_ssns) IS NULL
      AND pg_temp.t3281f_item_start('#3281F City 1',v_ssns) IS NULL,
    '(a) SSNS: a series whose sales all closed is not listed');
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 2',v_pernight) = v_jan
      AND pg_temp.t3281f_item_start('#3281F City 2',v_pernight) = v_jan,
    '(a) per-night capacity: Dec is full, the card shows Jan');
  SELECT id INTO v_jan_id FROM public.event_dates WHERE event_id = v_daylim AND start_at = v_jan;
  SELECT id INTO v_tt FROM public.ticket_types WHERE event_id = v_daylim;
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 3',v_daylim) = v_jan
      AND pg_temp.t3281f_item_start('#3281F City 3',v_daylim) = v_jan
      AND public.issue_3281_ticket_buyable_on_date(v_tt, v_jan_id)
      AND NOT public.issue_3281_ticket_buyable_on_date(v_tt,
        (SELECT id FROM public.event_dates WHERE event_id = v_daylim AND start_at = v_dec)),
    '(a) a day-limited tier is buyable on its date only, and the card shows that date');
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 4',v_cancel) = v_jan
      AND pg_temp.t3281f_item_start('#3281F City 4',v_cancel) = v_jan,
    '(a) a cancelled date is skipped');
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 5',v_presale) = v_dec
      AND pg_temp.t3281f_item_start('#3281F City 5',v_presale) = v_dec,
    '(a) a pre-sale lists at the next date');
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 6',v_rsvp) = v_dec
      AND pg_temp.t3281f_item_start('#3281F City 6',v_rsvp) = v_dec,
    '(a) an RSVP with no tiers lists at the next date');
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 7',v_pool) IS NULL,
    '(a) every capped tier sold out on the shared pool: not listed');
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_base_start('#3281F City 8',v_mixed) = v_dec,
    '(a) an open unlimited tier keeps the event listed');
  PERFORM pg_temp.t3281f_assert(COALESCE(public.discover_v2_nearest_city(-10, -30)->>'label', '') NOT LIKE '#3281F City 7%'
      AND public.discover_v2_nearest_city(-10, -10)->>'label' LIKE '#3281F City 8%',
    '(a) the empty-state city suggestion follows the same rule');

  -- (b) The planner inlines the rule: no function scan of it in a reader-shaped query.
  FOR v_line IN EXECUTE format(
    'EXPLAIN (COSTS OFF) SELECT d.id FROM public.event_dates d WHERE d.event_id = %L '
    'AND d.id IN (SELECT l.event_date_id FROM public.issue_3281_explorer_listable_dates(d.event_id) l)', v_pool)
  LOOP
    v_plan := v_plan || v_line || E'\n';
  END LOOP;
  PERFORM pg_temp.t3281f_assert(position('Function Scan' IN v_plan) = 0
      AND position('issue_3281_' IN v_plan) = 0,
    '(b) the listing rule is not inlined: ' || v_plan);
  PERFORM pg_temp.t3281f_assert((
    SELECT count(*) FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.issue_3281_buyable_ticket_dates(uuid)'::regprocedure,
                     'public.issue_3281_explorer_listable_dates(uuid)'::regprocedure)
       AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')
       AND p.proretset AND p.provolatile = 's'
       AND NOT p.prosecdef AND NOT p.proisstrict AND p.proconfig IS NULL) = 2,
    '(b) the rule functions are plain inlinable SQL (no SECURITY DEFINER, no SET, STABLE, not STRICT)');
  PERFORM pg_temp.t3281f_assert(
    NOT has_function_privilege('anon','public.issue_3281_buyable_ticket_dates(uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.issue_3281_explorer_listable_dates(uuid)','EXECUTE')
      AND has_function_privilege('service_role','public.issue_3281_explorer_listable_dates(uuid)','EXECUTE'),
    '(b) only service_role (and the owner) may execute the rule');

  -- (b) issue_3313_event_day_choice runs at most once for an event, not once per
  -- tier per date: the pool event has three capped tiers on four dates.
  PERFORM pg_temp.t3281f_reset_counts();
  PERFORM pg_temp.t3281f_base_start('#3281F City 7',v_pool);
  v_calls := pg_temp.t3281f_count('day_choice_calls');
  PERFORM pg_temp.t3281f_assert(v_calls BETWEEN 0 AND 1,
    format('(b) the Discover base asked issue_3313_event_day_choice %s times for one event', v_calls));
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_count('taken_calls') = 0,
    '(b) a shared-pool event never runs the per-night counter');
  PERFORM pg_temp.t3281f_reset_counts();
  PERFORM count(*) FROM public.issue_3281_explorer_listable_dates(v_pool);
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_count('day_choice_calls') <= 1,
    format('(b) the listing rule asked issue_3313_event_day_choice %s times for one event',
      pg_temp.t3281f_count('day_choice_calls')));
  -- An event with no capped tier never needs the answer.
  PERFORM pg_temp.t3281f_reset_counts();
  PERFORM count(*) FROM public.issue_3281_explorer_listable_dates(v_rsvp);
  PERFORM pg_temp.t3281f_assert(pg_temp.t3281f_count('day_choice_calls') = 0
      AND pg_temp.t3281f_count('taken_calls') = 0,
    '(b) an event without capped tiers runs neither plpgsql owner');
END;
$test$;

ROLLBACK;
