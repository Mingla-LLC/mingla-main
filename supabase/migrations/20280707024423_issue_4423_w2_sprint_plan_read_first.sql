-- #4423 Wave 2 (W2.4): the sprint plan reads first and writes nothing on its
-- poll path.
--
-- Before: ops_sprint_plan_get(NULL, ...) called ops_sprint_ensure on every
-- poll, an INSERT ... ON CONFLICT DO NOTHING, so every Admin refresh was a
-- write transaction. Cron did not make the row ahead of time: ops_reconcile
-- called ops_sprint_ensure only inside its Monday rollover loop.
--
-- After:
--   ops_reconcile() first ensures this week's and next week's rows (it runs
--     at minutes 7, 17, ..., 57), inside its own exception block like every
--     other step, so a failure there never stops the rest of reconcile.
--   ops_sprint_plan_get reads the row for this Monday first and calls
--     ops_sprint_ensure only when no row exists. It stays VOLATILE because of
--     that fallback. The fallback now returns the new row: the old body read
--     the sprint in the same statement that made it, so the first poll of a
--     new week got a sprint with no id (found while testing this wave).
--   in_sprint and backlog are built by ops_plan_cards_json (exactly
--     ops_plan_card_json per card, proved by the parity test); capacity names
--     and planned_by_name resolve once per email.
--
-- Rollback: re-apply ops_sprint_plan_get from
-- 20280624014255_issue_4255_work_v2_functions.sql and ops_reconcile from
-- 20280626014398_issue_4398_review_and_notices.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.ops_sprint_plan_get(p_sprint_id uuid DEFAULT NULL::uuid, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_today date := public.ops_today(p_today); s public.ops_sprints; prev public.ops_sprints; v_planned boolean;
        v_review jsonb; v_goals jsonb; v_capacity jsonb; v_in jsonb; v_backlog jsonb; v_cap_min numeric; v_est_min numeric;
        v_names jsonb; v_in_ids uuid[]; v_backlog_ids uuid[]; v_sid uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_sprint_id IS NULL THEN
    -- #4423 W2.4: read first. ops_reconcile makes this week's and next week's
    -- rows ahead of time, so the poll path writes nothing; only a missing row
    -- (minutes before cron runs) falls back to ops_sprint_ensure.
    SELECT * INTO s FROM public.ops_sprints x WHERE x.starts_on = public.ops_monday(v_today);
    IF NOT FOUND THEN
      -- Its own statement, so the row it makes is visible to the read below.
      -- (The old one-statement form ran ops_sprint_ensure once per sprint row
      -- scanned and could not see the row it had just made, so the first poll
      -- of a new week returned a sprint with no id.)
      v_sid := public.ops_sprint_ensure(v_today);
      SELECT * INTO s FROM public.ops_sprints x WHERE x.id = v_sid;
    END IF;
  ELSE
    SELECT * INTO s FROM public.ops_sprints x WHERE x.id = p_sprint_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That sprint is not here.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_planned := s.planned_at IS NOT NULL;
  SELECT * INTO prev FROM public.ops_sprints x WHERE x.starts_on = s.starts_on - 7;
  IF prev.id IS NOT NULL THEN
    SELECT COALESCE(sum(public.ops_capacity_hours(prev.id, d.email)), 0) * 60 INTO v_cap_min
      FROM public.admin_team_directory() d WHERE d.status = 'active';
    SELECT COALESCE(sum(w.estimate_minutes), 0) INTO v_est_min
      FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL;
    v_review := jsonb_build_object('sprint', public.ops_sprint_json(prev.starts_on),
      'planned', CASE WHEN prev.plan_baseline IS NOT NULL THEN jsonb_array_length(prev.plan_baseline)
                      ELSE (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL AND w.parent_id IS NULL) END,
      'done', (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = prev.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND w.status = 'done'),
      'carried', (SELECT count(*) FROM public.ops_work_cards w WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND w.carried_count > 0),
      'goals', (SELECT count(*) FROM public.ops_sprint_goals g WHERE g.sprint_id = prev.id AND g.archived_at IS NULL),
      'goals_hit', (SELECT count(*) FROM public.ops_sprint_goals g WHERE g.sprint_id = prev.id AND g.archived_at IS NULL
                     AND public.ops_goal_json(g, v_today)->>'state' = 'done'),
      'capacity_used_pct', CASE WHEN v_cap_min > 0 THEN round(100 * v_est_min / v_cap_min) END,
      'note', prev.review_note, 'revision', prev.revision);
  END IF;
  SELECT COALESCE(jsonb_agg(public.ops_goal_json(g, v_today) ORDER BY g.position, g.created_at), '[]'::jsonb) INTO v_goals
    FROM public.ops_sprint_goals g WHERE g.sprint_id = s.id AND g.archived_at IS NULL;
  -- #4423 W2.4: names once per email for the capacity rows and planned_by.
  SELECT COALESCE(jsonb_object_agg(n.email, n.name), '{}'::jsonb) INTO v_names
    FROM public.ops_names_for(ARRAY(SELECT d.email FROM public.admin_team_directory() d WHERE d.status = 'active'
                                    UNION SELECT s.planned_by WHERE s.planned_by IS NOT NULL)) n;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', d.email, 'name', v_names->>d.email,
           'hours', k.hours, 'hours_default', CASE WHEN k.hours IS NULL THEN ch.hours END,
           'planned_minutes', pl.minutes,
           'over', COALESCE(pl.minutes > COALESCE(k.hours, ch.hours) * 60, false))
         ORDER BY (d.role = 'owner') DESC, d.email), '[]'::jsonb) INTO v_capacity
    FROM public.admin_team_directory() d
    LEFT JOIN public.ops_sprint_capacity k ON k.sprint_id = s.id AND k.email = d.email
    CROSS JOIN LATERAL (SELECT public.ops_capacity_hours(s.id, d.email) AS hours) ch
    CROSS JOIN LATERAL (SELECT COALESCE(sum(w.estimate_minutes), 0) AS minutes
                          FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.role = 'owner' AND p.email = d.email
                         WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.status <> 'done' AND NOT w.in_backlog) pl
   WHERE d.status = 'active';
  -- #4423 W2.4: the same cards, in the same order, built set-based.
  SELECT array_agg(w.id ORDER BY w.carried_count DESC, w.due_on, w.number) INTO v_in_ids
    FROM public.ops_work_cards w WHERE w.sprint_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL AND NOT w.in_backlog;
  v_in := public.ops_plan_cards_json(v_in_ids, s.plan_baseline, v_planned);
  SELECT array_agg(x.id ORDER BY x.carried DESC, x.due_on, x.number) INTO v_backlog_ids
    FROM (SELECT w.id, w.carried_count AS carried, w.due_on, w.number
            FROM public.ops_work_cards w JOIN public.ops_sprints ws ON ws.id = w.sprint_id
           WHERE w.archived_at IS NULL AND w.parent_id IS NULL AND w.status <> 'done'
             AND (w.in_backlog OR ws.starts_on > s.starts_on)
           ORDER BY w.carried_count DESC, w.due_on, w.number LIMIT 300) x;
  v_backlog := public.ops_plan_cards_json(v_backlog_ids, s.plan_baseline, false);
  RETURN jsonb_build_object('sprint', public.ops_sprint_json(s.starts_on), 'planned', v_planned, 'planned_at', s.planned_at,
    'planned_by_name', CASE WHEN s.planned_by IS NOT NULL THEN v_names->>s.planned_by END,
    'revision', s.revision, 'review', v_review, 'goals', v_goals, 'capacity', v_capacity, 'in_sprint', v_in, 'backlog', v_backlog,
    'today', v_today, 'can_plan', v.via IS NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ops_reconcile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE r record; v_expired integer := 0; v_purged integer := 0; v_carried integer := 0; v_now timestamptz := clock_timestamp();
        v_mon date := public.ops_monday((clock_timestamp() AT TIME ZONE 'UTC')::date); v_cur uuid; v_n integer; c public.ops_work_cards;
        -- Wave 2: expected events
        v_exp public.ops_expected_events; v_ev uuid; v_today date := public.ops_today(NULL); v_fulfilled integer := 0; v_moved integer := 0; v_m integer;
        -- Wave 3: the giveaway and ads rule, and go-live gate cards
        a jsonb; v_gate jsonb; n public.ops_work_cards; v_before jsonb; v_event uuid; v_proof jsonb; v_words text;
        v_unblocked integer := 0; v_blocked integer := 0; v_gates integer := 0;
        -- #3980 synced, Wave 1: engineering follow-through
        v_eng jsonb;
        -- #3980 synced, Wave 2: the GitHub bridges
        v_bridges jsonb; v_guide jsonb;
        -- #3980 synced, Wave 3: brand auto-link and automatic steps
        v_brands jsonb; v_steps jsonb;
BEGIN
  -- #4423 W2.4: this week's and next week's sprint rows always exist before
  -- anyone reads them, so ops_sprint_plan_get never writes on its poll path.
  BEGIN
    PERFORM public.ops_sprint_ensure(v_today);
    PERFORM public.ops_sprint_ensure(v_today + 7);
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: sprint ensure stopped (% %)', SQLSTATE, SQLERRM;
  END;
  BEGIN
    FOR r IN SELECT DISTINCT x.target_kind, x.target_id FROM public.ops_claims x
              WHERE x.released_at IS NULL AND x.last_seen_at < v_now - interval '30 minutes' LOOP
      PERFORM public.ops_claim_sweep(r.target_kind, r.target_id);
      v_expired := v_expired + 1;
    END LOOP;
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: claim expiry stopped (% %)', SQLSTATE, SQLERRM;
  END;
  BEGIN
    DELETE FROM public.ops_request_keys k WHERE k.created_at < now() - interval '30 days';
    GET DIAGNOSTICS v_purged = ROW_COUNT;
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: request key purge stopped (% %)', SQLSTATE, SQLERRM;
  END;
  IF v_now >= (v_mon::timestamp + interval '12 hours') AT TIME ZONE 'UTC' THEN
    FOR r IN SELECT s.id, s.starts_on FROM public.ops_sprints s WHERE s.ends_on < v_mon AND s.rolled_over_at IS NULL ORDER BY s.starts_on LOOP
      BEGIN
        v_cur := public.ops_sprint_ensure(v_mon);
        v_n := 0;
        FOR c IN UPDATE public.ops_work_cards w SET sprint_id = v_cur, carried_count = carried_count + 1,
                        revision = revision + 1, updated_by = 'system@usemingla.com', updated_via = 'system', updated_at = now()
                  WHERE w.sprint_id = r.id AND w.status <> 'done' AND w.archived_at IS NULL RETURNING w.* LOOP
          PERFORM public.ops_card_event(c.id, 'system@usemingla.com', 'system', 'carried', format('Carried from the week of %s.', public.ops_day_words(r.starts_on)),
            NULL, NULL, c.revision - 1, c.revision);
          v_n := v_n + 1;
        END LOOP;
        UPDATE public.ops_sprints SET carried_in = carried_in + v_n, updated_at = now() WHERE id = v_cur;
        UPDATE public.ops_sprints SET rolled_over_at = now(), updated_at = now() WHERE id = r.id;
        v_carried := v_carried + v_n;
      EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: sprint % rollover stopped (% %)', r.starts_on, SQLSTATE, SQLERRM;
      END;
    END LOOP;
  END IF;
  -- #3980 synced, Wave 3: brands made after the owner switched brand cards on
  -- are linked to their one host card, or get one.
  IF COALESCE((public.ops_setting('brand_auto_cards') #>> '{}')::boolean, false) THEN
    BEGIN
      v_brands := public.ops_brand_autolink();
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: brand auto-link stopped (% %)', SQLSTATE, SQLERRM;
    END;
  END IF;
  -- Wave 2: an open expected event whose host's brand now has a public event
  -- within 3 days of the expected date is linked to it, and its cards move.
  FOR v_exp IN SELECT * FROM public.ops_expected_events z WHERE z.status = 'open' AND z.repeats = 'none' ORDER BY z.expected_on, z.id LOOP
    BEGIN
      v_ev := NULL;
      SELECT e.id INTO v_ev
        FROM public.crm_records hc
        JOIN public.events e ON e.brand_id = hc.brand_id AND e.deleted_at IS NULL
        CROSS JOIN LATERAL (SELECT public.ops_anchor('event', e.id, v_today) AS a) y
       WHERE hc.id = v_exp.record_id AND hc.deleted_at IS NULL AND hc.brand_id IS NOT NULL
         AND y.a IS NOT NULL AND COALESCE((y.a->>'is_public')::boolean, false) AND y.a->>'start_on' IS NOT NULL
         AND abs((y.a->>'start_on')::date - v_exp.expected_on) <= 3
       ORDER BY abs((y.a->>'start_on')::date - v_exp.expected_on), y.a->>'start_at', e.id
       LIMIT 1;
      IF v_ev IS NOT NULL THEN
        v_m := public.ops_expected_fulfil(v_exp.id, v_ev, 'system@usemingla.com', 'system');
        v_fulfilled := v_fulfilled + 1;
        v_moved := v_moved + v_m;
        PERFORM public.ops_log_write('system@usemingla.com', 'system', 'expected_set', 'info', NULL, 'expected', v_exp.id,
          format('%s is now on Mingla: the expected event is linked to it and %s cards count from it.', v_exp.title, v_m),
          jsonb_build_object('record_id', v_exp.record_id, 'event_id', v_ev, 'cards_moved', v_m));
      END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: expected event % stopped (% %)', v_exp.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  -- Wave 2: cards still counted from an expected event that is already linked.
  FOR v_exp IN SELECT z.* FROM public.ops_expected_events z
            WHERE z.status = 'fulfilled'
              AND EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.anchor_kind = 'expected' AND w.anchor_id = z.id AND w.archived_at IS NULL) LOOP
    BEGIN
      v_moved := v_moved + public.ops_reanchor_expected(v_exp.id, 'system@usemingla.com', 'system');
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: cards of expected event % stopped (% %)', v_exp.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  -- #3980 synced, Wave 3: automatic steps from the timeline, only while the
  -- owner has them switched on.
  IF COALESCE((public.ops_setting('auto_steps') #>> '{}')::boolean, false) THEN
    BEGIN
      v_steps := public.ops_auto_steps(v_today, NULL);
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: automatic steps stopped (% %)', SQLSTATE, SQLERRM;
    END;
  END IF;
  -- Wave 3: giveaway and ads cards follow their event. Public with 21 days
  -- or more left: free to start. Otherwise held, waiting for go-live or
  -- too late for promo. A card the owner or an admin overrode, or a person
  -- blocked by hand, is left as it is.
  FOR c IN SELECT w.* FROM public.ops_work_cards w
            WHERE w.kind = 'promo' AND w.status <> 'done' AND w.archived_at IS NULL AND w.override_at IS NULL
              AND w.anchor_id IS NOT NULL AND (w.blocked_kind IS NULL OR w.blocked_kind <> 'manual')
            ORDER BY w.number LOOP
    BEGIN
      a := public.ops_anchor(c.anchor_kind, c.anchor_id, v_today);
      v_gate := public.ops_promo_gate(a, v_today);
      CONTINUE WHEN ROW((v_gate->>'blocked')::boolean, CASE WHEN (v_gate->>'blocked')::boolean THEN v_gate->>'kind' END,
                        CASE WHEN (v_gate->>'blocked')::boolean THEN v_gate->>'reason' END)
                    IS NOT DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason);
      v_before := public.ops_card_snapshot(c.id);
      UPDATE public.ops_work_cards w SET blocked = (v_gate->>'blocked')::boolean,
             blocked_kind = CASE WHEN (v_gate->>'blocked')::boolean THEN v_gate->>'kind' END,
             blocked_reason = CASE WHEN (v_gate->>'blocked')::boolean THEN v_gate->>'reason' END,
             revision = revision + 1, updated_by = 'system@usemingla.com', updated_via = 'system', updated_at = now()
       WHERE w.id = c.id RETURNING w.* INTO n;
      IF n.blocked THEN
        v_words := n.blocked_reason;
        v_blocked := v_blocked + 1;
      ELSE
        v_words := format('Go-live met: %s days ahead.', COALESCE(v_gate->>'lead_days', '21 or more'));
        v_unblocked := v_unblocked + 1;
      END IF;
      v_event := public.ops_card_event(c.id, 'system@usemingla.com', 'system', CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END,
        v_words, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
      PERFORM public.ops_log_write('system@usemingla.com', 'system', CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END, 'info',
        c.id, 'work_card', c.id, format('Card %s: %s', n.number, v_words), jsonb_build_object('blocked_kind', n.blocked_kind));
      -- Freed: its owners and watchers are told, as when a gate card closes.
      IF NOT n.blocked THEN
        PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), 'system@usemingla.com',
          format('Go-live met: %s is public on Mingla with %s days left. The giveaway and ads card can start.',
            COALESCE(a->>'title', 'the event'), COALESCE(v_gate->>'lead_days', '21 or more')), 'bot');
      END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: giveaway card % stopped (% %)', c.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  -- Wave 3: a go-live gate card closes itself once its event is public on
  -- Mingla, with the public time as proof. A card still counted from an
  -- expected event waits for the expected event to be linked (above).
  FOR c IN SELECT w.* FROM public.ops_work_cards w
            WHERE w.kind = 'gate_live' AND w.status <> 'done' AND w.archived_at IS NULL
              AND w.anchor_kind = 'event' AND public.ops_event_public(w.anchor_id)
            ORDER BY w.number LOOP
    BEGIN
      a := public.ops_anchor('event', c.anchor_id, v_today);
      CONTINUE WHEN a IS NULL OR NOT COALESCE((a->>'is_public')::boolean, false);
      v_words := CASE WHEN a->'runway'->>'lead_days' IS NOT NULL
        THEN format('Public on Mingla since %s, %s days before it starts.',
               public.ops_day_words(((a->>'published_at')::timestamptz AT TIME ZONE 'UTC')::date), a->'runway'->>'lead_days')
        ELSE format('Public on Mingla since %s.', public.ops_day_words(((a->>'published_at')::timestamptz AT TIME ZONE 'UTC')::date)) END;
      v_proof := jsonb_build_array(jsonb_build_object('kind', 'event_public', 'id', c.anchor_id, 'text', v_words,
        'verified', true, 'checked_at', clock_timestamp(), 'by_name', 'Mingla'));
      v_before := public.ops_card_snapshot(c.id);
      UPDATE public.ops_work_cards w SET status = 'done', person_reason = NULL, blocked = false, blocked_kind = NULL, blocked_reason = NULL,
             close_kind = 'system', close_reason = NULL, closed_at = clock_timestamp(), closed_by = 'system@usemingla.com', closed_via = 'system',
             proof = v_proof, revision = revision + 1, updated_by = 'system@usemingla.com', updated_via = 'system', updated_at = now()
       WHERE w.id = c.id RETURNING w.* INTO n;
      PERFORM public.ops_claims_release_card(c.id, 'closed', 'system@usemingla.com');
      v_event := public.ops_card_event(c.id, 'system@usemingla.com', 'system', 'gate_closed', v_words, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
      PERFORM public.ops_log_write('system@usemingla.com', 'system', 'gate_closed', 'ok', c.id, 'event', c.anchor_id,
        format('Card %s closed itself: %s %s', n.number, COALESCE(a->>'title', 'the event'), lower(left(v_words, 1)) || substr(v_words, 2)),
        jsonb_build_object('lead_days', a->'runway'->'lead_days'));
      PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), 'system@usemingla.com',
        format('Go-live met: %s is public on Mingla. The gate card closed itself.', COALESCE(a->>'title', 'the event')), 'bot');
      v_gates := v_gates + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: gate card % stopped (% %)', c.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  -- Wave 2: Bridges B, D, E and the roadmap suggestions, each on its own.
  BEGIN
    v_guide := public.ops_release_guide_apply();
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: Feature Guide step stopped (% %)', SQLSTATE, SQLERRM;
  END;
  BEGIN
    v_bridges := public.ops_github_bridges();
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: GitHub bridges stopped (% %)', SQLSTATE, SQLERRM;
  END;
  BEGIN
    v_eng := public.ops_engineering_cards_sync();
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: engineering cards stopped (% %)', SQLSTATE, SQLERRM;
  END;
  RETURN jsonb_build_object('claims_expired', v_expired, 'request_keys_purged', v_purged, 'cards_carried', v_carried,
                            'expected_fulfilled', v_fulfilled, 'cards_re_anchored', v_moved,
                            'promo_unblocked', v_unblocked, 'promo_blocked', v_blocked, 'gates_closed', v_gates,
                            'engineering_cards', v_eng, 'github_bridges', v_bridges, 'feature_guide', v_guide,
                            'brand_autolink', v_brands, 'auto_steps', v_steps);
END;

$function$;

COMMIT;
