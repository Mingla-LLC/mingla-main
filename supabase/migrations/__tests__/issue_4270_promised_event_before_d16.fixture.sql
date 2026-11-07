-- Issue #4270 (Wave 2) -- test fixture, not a suite. Included with \ir by the
-- #3980 suites that need a promised (expected) event to exist.
--
-- D9 / D16: nothing can add a promised event any more; ops_expected_event_set
-- refuses a new one (22023 gone) for people and agents alike. Promised events
-- saved before that keep working, so the #3980 suites still prove how a saved
-- one behaves (its Calendar row, its steps, changing, repeating, cancelling,
-- linking). They make one the way the save did before #4270, with
-- pg_temp.t4270_promise: a new item goes to a copy of the #3980 synced W3
-- save (20271201003980, verbatim apart from its name and schema); an item
-- with an id goes to the real public.ops_expected_event_set. Everything stays
-- inside the including suite's transaction and is rolled back with it.

CREATE FUNCTION pg_temp.t4270_promise_create(p_item jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text; v_fixes jsonb := '[]'::jsonb;
  r public.crm_records; x public.ops_expected_events; n public.ops_expected_events; d public.ops_expected_events;
  v_update boolean := false; v_title text; v_type text; v_on date; v_city text; v_note text; v_cancel text;
  v_status text := 'open'; v_event uuid; v_result text; v_out jsonb; v_who text; v_moved integer := 0;
  v_repeats text; v_steps jsonb; v_auto_on boolean; v_json jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required: Send a request key, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'invalid_expected: Send the expected event as an object.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_item) k
   WHERE k NOT IN ('id','record_id','title','event_type','expected_on','city','note','status','cancel_reason','event_id','repeats') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: An expected event does not take "%s". It takes: record_id, id, title, event_type, expected_on, repeats, city, note, status, cancel_reason, event_id.', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'expected', p_item);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_who := public.ops_actor_label(v.actor_email, v.via);

  IF NOT public.ops_is_uuid(p_item->>'record_id') THEN
    RAISE EXCEPTION 'not_a_host: Expected events are for hosts.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.crm_records c
   WHERE c.id = (p_item->>'record_id')::uuid AND c.deleted_at IS NULL AND c.pipeline = 'hosts';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_host: Expected events are for hosts.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_claim_assert('crm_record', r.id, v.actor_email, v.via);

  IF p_item ? 'id' AND jsonb_typeof(p_item->'id') <> 'null' THEN
    v_update := true;
    IF NOT public.ops_is_uuid(p_item->>'id') THEN
      RAISE EXCEPTION 'not_found: That expected event is no longer on this host card.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO x FROM public.ops_expected_events z WHERE z.id = (p_item->>'id')::uuid AND z.record_id = r.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That expected event is no longer on this host card.' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.ops_claim_assert('expected', x.id, v.actor_email, v.via);
    IF x.status = 'fulfilled' THEN
      RAISE EXCEPTION 'expected_closed: This expected event is already on Mingla. Add a new one for the next event.' USING ERRCODE = '22023';
    ELSIF x.status = 'cancelled' THEN
      RAISE EXCEPTION 'expected_closed: This expected event was cancelled. Add a new one.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Fields: what is sent, else what is saved.
  v_title := CASE WHEN p_item ? 'title' THEN CASE WHEN jsonb_typeof(p_item->'title') = 'string' THEN public.ops_one_line(p_item->>'title') END ELSE x.title END;
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 160 OR public.ops_has_control(v_title) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message', 'Title is missing. Say what the event is in 3 to 160 characters.'));
  END IF;
  v_type := CASE WHEN p_item ? 'event_type' THEN p_item->>'event_type' ELSE x.event_type END;
  IF v_type IS NULL OR v_type NOT IN ('event', 'experience', 'trip', 'rsvp', 'promo_moment') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'event_type', 'message', 'Type must be event, experience, trip, rsvp or promo_moment.'));
  END IF;
  v_repeats := CASE WHEN p_item ? 'repeats' AND jsonb_typeof(p_item->'repeats') <> 'null' THEN p_item->>'repeats'
                    ELSE COALESCE(x.repeats, 'none') END;
  IF v_repeats IS NULL OR v_repeats NOT IN ('none', 'week', 'month') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'repeats', 'message', 'Repeats must be none, week or month.'));
  END IF;
  IF p_item ? 'expected_on' OR NOT v_update THEN
    BEGIN
      IF jsonb_typeof(p_item->'expected_on') IS DISTINCT FROM 'string' OR (p_item->>'expected_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'bad' USING ERRCODE = '22007';
      END IF;
      v_on := (p_item->>'expected_on')::date;
      IF v_on NOT BETWEEN v_today AND v_today + 540 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_on := NULL;
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'expected_on', 'message', 'Date must be a real date from today up to 18 months ahead.'));
    END;
  ELSE
    v_on := x.expected_on;
    -- #3980 W3 rework 2: a series that already started and now happens once,
    -- with no date sent, keeps its next coming date, never a past one.
    IF v_update AND x.repeats <> 'none' AND v_repeats = 'none' AND v_on < v_today THEN
      v_on := (SELECT (o->>'on')::date FROM jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 1)) o
                WHERE (o->>'on')::date >= v_today ORDER BY (o->>'on')::date LIMIT 1);
      IF v_on IS NULL OR v_on > v_today + 540 THEN
        v_on := NULL;
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'expected_on', 'message',
          'This series has no coming date to keep. Send the date it happens once.'));
      END IF;
    END IF;
  END IF;
  IF p_item ? 'city' THEN
    v_city := CASE WHEN jsonb_typeof(p_item->'city') = 'string' THEN public.ops_one_line(p_item->>'city') END;
    IF jsonb_typeof(p_item->'city') NOT IN ('string', 'null') OR char_length(COALESCE(v_city, '')) > 120 OR public.ops_has_control(v_city) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'city', 'message', 'City can be up to 120 characters.'));
    END IF;
  ELSE v_city := x.city; END IF;
  IF p_item ? 'note' THEN
    v_note := CASE WHEN jsonb_typeof(p_item->'note') = 'string' THEN public.ops_multi_line(p_item->>'note') END;
    IF jsonb_typeof(p_item->'note') NOT IN ('string', 'null') OR char_length(COALESCE(v_note, '')) > 500 OR public.ops_has_control(v_note) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'note', 'message', 'A note can be up to 500 characters.'));
    END IF;
  ELSE v_note := x.note; END IF;
  IF p_item ? 'status' AND jsonb_typeof(p_item->'status') <> 'null' THEN
    IF p_item->>'status' NOT IN ('open', 'cancelled') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Status can be open or cancelled.'));
    ELSIF p_item->>'status' = 'cancelled' AND NOT v_update THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Only an expected event that was saved can be cancelled.'));
    ELSE v_status := p_item->>'status'; END IF;
  END IF;
  IF v_status = 'cancelled' THEN
    v_cancel := CASE WHEN jsonb_typeof(p_item->'cancel_reason') = 'string' THEN public.ops_one_line(p_item->>'cancel_reason') END;
    IF v_cancel IS NULL OR char_length(v_cancel) NOT BETWEEN 3 AND 300 OR public.ops_has_control(v_cancel) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'cancel_reason', 'message', 'Say why it was cancelled in 3 to 300 characters.'));
    END IF;
  ELSIF p_item ? 'cancel_reason' AND jsonb_typeof(p_item->'cancel_reason') <> 'null' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'cancel_reason', 'message', 'A cancel reason goes with status cancelled.'));
  END IF;
  IF p_item ? 'event_id' AND jsonb_typeof(p_item->'event_id') <> 'null' THEN
    IF NOT public.ops_is_uuid(p_item->>'event_id') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'event_id', 'message', 'That event is not one of this host''s events on Mingla. Link the host''s brand on the card first.'));
    ELSE
      v_event := (p_item->>'event_id')::uuid;
      IF v_status = 'cancelled' THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'event_id', 'message', 'A cancelled expected event cannot be linked to an event.'));
      ELSIF v_repeats <> 'none' THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'event_id', 'message', 'A repeating event stays open: each date is matched to its public event by itself.'));
      ELSIF r.brand_id IS NULL OR NOT public.ops_event_in_scope(v_event)
            OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event AND e.brand_id = r.brand_id AND e.deleted_at IS NULL) THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'event_id', 'message', 'That event is not one of this host''s events on Mingla. Link the host''s brand on the card first.'));
      END IF;
    END IF;
  END IF;
  IF jsonb_array_length(v_fixes) > 0 THEN
    RAISE EXCEPTION '%', 'invalid_expected: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_fixes) f)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('fixes', v_fixes)::text;
  END IF;

  IF NOT v_update OR v_status = 'open' THEN
    SELECT * INTO d FROM public.ops_expected_events z
     WHERE z.record_id = r.id AND z.expected_on = v_on AND z.title_key = public.crm_name_key(v_title) AND z.status = 'open'
       AND (NOT v_update OR z.id <> x.id);
    IF FOUND THEN
      RAISE EXCEPTION '%', format('duplicate_expected: An open expected event already matches: "%s" on %s (id %s). Update that one instead.',
        d.title, public.ops_day_words(d.expected_on), d.id) USING ERRCODE = '22023', DETAIL = jsonb_build_object('existing', jsonb_build_object('id', d.id, 'title', d.title))::text;
    END IF;
  END IF;

  IF NOT v_update THEN
    INSERT INTO public.ops_expected_events (record_id, title, event_type, expected_on, city, note, repeats, created_by, created_via, updated_by, updated_via)
    VALUES (r.id, v_title, v_type, v_on, v_city, v_note, v_repeats, v.actor_email, v.via, v.actor_email, v.via)
    RETURNING * INTO n;
    v_result := 'created';
  ELSIF v_status = 'cancelled' THEN
    UPDATE public.ops_expected_events z SET status = 'cancelled', cancel_reason = v_cancel, revision = z.revision + 1,
           updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE z.id = x.id RETURNING * INTO n;
    v_result := 'cancelled';
  ELSE
    UPDATE public.ops_expected_events z SET title = v_title, event_type = v_type, expected_on = v_on, city = v_city, note = v_note,
           repeats = v_repeats, revision = z.revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE z.id = x.id RETURNING * INTO n;
    v_result := 'updated';
  END IF;
  IF v_event IS NOT NULL AND n.status = 'open' THEN
    v_moved := public.ops_expected_fulfil(n.id, v_event, v.actor_email, v.via);
    SELECT * INTO n FROM public.ops_expected_events z WHERE z.id = n.id;
    v_result := 'fulfilled';
  END IF;
  PERFORM public.ops_log_write(v.actor_email, v.via, 'expected_set', 'ok', NULL, 'expected', n.id,
    format('%s %s the expected event %s on %s for %s%s.', v_who,
      CASE v_result WHEN 'created' THEN 'added' WHEN 'cancelled' THEN 'cancelled' WHEN 'fulfilled' THEN 'linked to Mingla' ELSE 'changed' END,
      n.title, public.ops_day_words(n.expected_on), r.name,
      CASE n.repeats WHEN 'week' THEN ', repeating every week' WHEN 'month' THEN ', repeating every month' ELSE '' END),
    jsonb_build_object('record_id', r.id, 'status', v_result, 'cards_moved', v_moved, 'repeats', n.repeats));
  -- Automatic steps for this host, at once, while the owner has them on.
  -- The answer says whether they were on, so the screen tells the truth
  -- ("steps are in Work" only when they were made).
  v_auto_on := COALESCE((public.ops_setting('auto_steps') #>> '{}')::boolean, false);
  IF v_auto_on THEN
    BEGIN
      v_steps := public.ops_auto_steps(v_today, r.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'ops_expected_event_set: automatic steps stopped (% %)', SQLSTATE, SQLERRM;
      v_steps := jsonb_build_object('stopped', true);
    END;
    -- #3980 W3 rework 2: how many steps of it are open now, so the screen
    -- never says steps are in Work when none exist yet (a series whose first
    -- date is still far off).
    IF v_steps IS NOT NULL AND NOT COALESCE((v_steps->>'stopped')::boolean, false) THEN
      -- #3980 W3 rework 3: and how many were already finished or declined
      -- (Mingla does not add those again), so the screen never promises steps
      -- "nearer the date" that will not come.
      v_steps := v_steps || jsonb_build_object('open', (
        SELECT count(*) FROM public.ops_work_cards k
         WHERE k.archived_at IS NULL AND k.status <> 'done'
           AND ((k.anchor_kind = 'expected' AND k.anchor_id = n.id) OR k.auto_key = 'series:' || n.id
                OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = k.id AND l.kind = 'expected' AND l.target_id = n.id))),
        'settled', (
        SELECT count(*) FROM public.ops_work_cards k
         WHERE k.archived_at IS NULL AND k.status = 'done' AND k.close_kind IN ('done', 'already_done', 'declined')
           AND ((k.anchor_kind = 'expected' AND k.anchor_id = n.id) OR k.auto_key = 'series:' || n.id
                OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = k.id AND l.kind = 'expected' AND l.target_id = n.id))));
    END IF;
  END IF;
  v_json := public.ops_expected_json(n, v_today);
  -- #3980 W4 rework (W3 retest P3): when its next date is already past the
  -- go-live line (Too late for promo), no launch steps will come, so the
  -- screen says that instead of "nearer the date".
  IF v_steps IS NOT NULL AND NOT COALESCE((v_steps->>'stopped')::boolean, false) THEN
    v_steps := v_steps || jsonb_build_object('past_go_live', n.status = 'open' AND v_json->'state'->>'k' = 'late');
  END IF;
  v_out := jsonb_build_object('expected', v_json, 'status', v_result, 'cards_moved', v_moved,
    'steps', v_steps, 'auto_steps', v_auto_on, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'expected', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_expected: An open expected event with this title and date is already on this host card. Update that one instead.' USING ERRCODE = '22023';
END;
$$;



CREATE FUNCTION pg_temp.t4270_promise(p_item jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_item IS NOT NULL AND jsonb_typeof(p_item) = 'object' AND p_item ? 'id' AND jsonb_typeof(p_item->'id') <> 'null' THEN
    RETURN public.ops_expected_event_set(p_item, p_request_key);
  END IF;
  RETURN pg_temp.t4270_promise_create(p_item, p_request_key);
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t4270_promise(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.t4270_promise_create(jsonb, text) TO authenticated;
