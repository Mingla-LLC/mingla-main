-- Issue #4256. The Work board stops making "Giveaway and ads for <event>"
-- cards by itself. Mingla does not run giveaways by default: a person opens a
-- giveaway card when one is wanted. The automatic step now runs only while
-- ops_settings.auto_promo_cards is on, and it ships off. Every other
-- automatic step (go-live, recap, ask for the next event, rolling cards) is
-- unchanged, and giveaway cards already on the board keep their promo gate.
--
-- ops_auto_steps is redefined from 20271201003980 with only those two lines
-- changed; its grants and owner are kept by CREATE OR REPLACE.

ALTER TABLE public.ops_settings DROP CONSTRAINT ops_settings_key_check;
ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_key_check
  CHECK (key IN ('auto_steps','brand_auto_cards','brand_auto_since','marketing_owner','follow_through_since','auto_promo_cards'));
INSERT INTO public.ops_settings (key, value, updated_by)
VALUES ('auto_promo_cards', 'false'::jsonb, 'system@usemingla.com')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ops_auto_steps(p_today date, p_record_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c_cap constant integer := 50;
  v_today date := public.ops_today(p_today);
  v_added integer := 0; v_closed integer := 0; v_redated integer := 0; v_deferred integer := 0;
  c public.ops_work_cards; n public.ops_work_cards; a jsonb; st jsonb; x public.ops_expected_events; h record; e record;
  v_res jsonb; v_want jsonb := '[]'::jsonb; w jsonb; v_owners text[]; v_mkt text; v_mkt_owners text[];
  v_auto_promo boolean := COALESCE((public.ops_setting('auto_promo_cards') #>> '{}')::boolean, false);
  v_start date; v_title text; v_due date; v_before jsonb; v_event uuid; v_next jsonb; v_first date; v_occ jsonb;
  v_hostnext jsonb := '{}'::jsonb; v_words text; v_past boolean; v_new_title text; v_rid uuid; v_rtitle text; v_ron date;
  v_ins text; v_parked uuid;
  c_series_parked constant text := 'All 4 coming dates are live. This card opens again when the next date needs publishing.';
  c_golive_repeat constant text := 'The dates now repeat. One rolling card keeps them live.';
BEGIN
  -- The marketing owner, when one is set and still on the team.
  v_mkt := public.ops_setting('marketing_owner') #>> '{}';
  IF v_mkt IS NOT NULL AND public.ops_team_email(v_mkt) IS DISTINCT FROM v_mkt THEN v_mkt := NULL; END IF;

  -- 1. Cancelled or removed events: their open automatic and launch kit
  -- cards close with the reason.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND (w0.auto_key IS NOT NULL OR w0.kit_step IS NOT NULL)
              AND w0.anchor_id IS NOT NULL
              AND ((w0.anchor_kind = 'event' AND NOT EXISTS (SELECT 1 FROM public.events ev
                                                              WHERE ev.id = w0.anchor_id AND ev.deleted_at IS NULL AND ev.status <> 'cancelled'))
                   OR (w0.anchor_kind = 'expected' AND EXISTS (SELECT 1 FROM public.ops_expected_events z
                                                                WHERE z.id = w0.anchor_id AND z.status = 'cancelled')))
              AND (p_record_id IS NULL OR public.ops_card_of_host(w0, p_record_id))
            ORDER BY w0.number LOOP
    BEGIN
      v_res := public.ops_auto_card_close(c.id, 'Event cancelled.',
        jsonb_build_array(jsonb_build_object('text', 'The event this card was counted from was cancelled or removed.')));
      IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: closing card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- 2. An event or expected event whose first date moved: its open cards
  -- counted from the launch kit follow it. A due date a person typed is
  -- never changed.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.due_source = 'kit' AND w0.kit_step IS NOT NULL
              AND w0.anchor_id IS NOT NULL
              AND (p_record_id IS NULL OR public.ops_card_of_host(w0, p_record_id))
            ORDER BY w0.number LOOP
    BEGIN
      a := public.ops_anchor(c.anchor_kind, c.anchor_id, v_today);
      CONTINUE WHEN a IS NULL OR a->>'start_on' IS NULL;
      v_start := (a->>'start_on')::date;
      v_due := v_start + c.kit_step;
      CONTINUE WHEN v_due IS NOT DISTINCT FROM c.due_on;
      v_before := public.ops_card_snapshot(c.id);
      v_new_title := c.title;
      v_ins := c.instructions;
      -- The card's words follow the new dates too.
      IF c.auto_key LIKE 'golive:%' THEN
        v_new_title := left(format('Get %s live by %s', left(COALESCE(a->>'title', 'the event'), 120), public.ops_day_words(v_start - 28)), 160);
        v_ins := format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                        public.ops_day_words(v_start - 35), public.ops_day_words(v_start - 31));
      ELSIF c.auto_key LIKE 'promo:%' THEN
        v_ins := format('Starts %s. Creators post %s, reminder %s. Money is spent only after a person approves it in Needs you.',
                        public.ops_day_words(v_start - 21), public.ops_day_words(v_start - 14), public.ops_day_words(v_start - 7));
      END IF;
      UPDATE public.ops_work_cards w0 SET due_on = v_due, title = v_new_title, instructions = v_ins, revision = w0.revision + 1,
             updated_by = c_actor, updated_via = 'system', updated_at = now()
       WHERE w0.id = c.id RETURNING w0.* INTO n;
      v_words := format('Re-dated to %s: %s now starts %s.', public.ops_day_words(v_due), COALESCE(a->>'title', 'the event'), public.ops_day_words(v_start));
      v_event := public.ops_card_event(c.id, c_actor, 'system', 'redated', v_words, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
      PERFORM public.ops_log_write(c_actor, 'system', 'auto_redated', 'info', c.id, c.anchor_kind, c.anchor_id,
        format('Card %s re-dated to %s: %s moved to %s.', n.number, public.ops_day_words(v_due), COALESCE(a->>'title', 'the event'), public.ops_day_words(v_start)),
        jsonb_build_object('from', c.due_on, 'to', v_due));
      PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), c_actor,
        format('Mingla re-dated "%s" to %s: the event moved to %s.', n.title, public.ops_day_words(v_due), public.ops_day_words(v_start)));
      v_redated := v_redated + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: re-dating card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- The hosts this run looks at, with their next dated thing.
  SELECT COALESCE(jsonb_object_agg(r0->>'record_id', r0), '{}'::jsonb) INTO v_hostnext
    FROM jsonb_array_elements(public.ops_host_next_rows(ARRAY(
           SELECT c0.id FROM public.crm_records c0
            WHERE c0.pipeline = 'hosts' AND c0.deleted_at IS NULL AND c0.stage <> 'lost'
              AND (p_record_id IS NULL OR c0.id = p_record_id)), v_today)) r0;

  -- 3. "Ask for their first or next event" closes once something is coming up.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.auto_key LIKE 'ask:%'
              AND (p_record_id IS NULL OR w0.auto_key = 'ask:' || p_record_id) ORDER BY w0.number LOOP
    BEGIN
      v_next := v_hostnext->split_part(c.auto_key, ':', 2)->'next';
      CONTINUE WHEN v_next IS NULL OR jsonb_typeof(v_next) <> 'object';
      v_res := public.ops_auto_card_close(c.id,
        format('Next event set: %s on %s.', left(v_next->>'title', 160), public.ops_day_words((v_next->>'start_on')::date)),
        jsonb_build_array(jsonb_build_object('text', format('%s on %s is on the Calendar.', left(v_next->>'title', 160),
          public.ops_day_words((v_next->>'start_on')::date)))));
      IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: closing card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- 4. A repeating host's rolling card follows its series on every run: the
  -- next date to publish, its words and its due date (that date less 28
  -- days) are worked out again. A due date is never moved into the past
  -- unless it was already there, so a recompute never makes a card overdue
  -- by itself. When all 4 kept dates are live the card closes and says why;
  -- it opens again when a new unpublished date comes into the window. A
  -- series that stops repeating, ends or is cancelled closes its card.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.auto_key LIKE 'series:%'
              AND (p_record_id IS NULL OR public.ops_card_of_host(w0, p_record_id)) ORDER BY w0.number LOOP
    BEGIN
      x := NULL;
      SELECT z.* INTO x FROM public.ops_expected_events z WHERE z.id::text = split_part(c.auto_key, ':', 2);
      IF x.id IS NULL OR x.status <> 'open' OR x.repeats = 'none' THEN
        v_words := CASE WHEN x.id IS NULL OR x.status = 'cancelled' THEN 'Event cancelled.'
                        WHEN x.status <> 'open' THEN 'The repeating dates have ended.'
                        ELSE 'The dates no longer repeat, so this card is not needed.' END;
        v_res := public.ops_auto_card_close(c.id, v_words,
          jsonb_build_array(jsonb_build_object('text', CASE WHEN x.id IS NOT NULL AND x.status = 'open'
            THEN format('%s now happens once, on %s.', left(x.title, 160), public.ops_day_long(x.expected_on))
            ELSE 'The repeating dates this card kept live were stopped.' END)));
        IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
        CONTINUE;
      END IF;
      v_first := NULL;
      SELECT (o->>'on')::date INTO v_first FROM jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
       WHERE NOT (o->>'live')::boolean ORDER BY (o->>'on')::date LIMIT 1;
      IF v_first IS NULL THEN
        v_res := public.ops_auto_card_close(c.id, c_series_parked,
          jsonb_build_array(jsonb_build_object('text', format('The next 4 dates of %s are public on Mingla.', left(x.title, 160)))));
        IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
        CONTINUE;
      END IF;
      v_due := GREATEST(v_first - 28, LEAST(COALESCE(c.due_on, v_today), v_today));
      v_ins := format('Repeats every %s. Next date to publish: %s.', CASE WHEN x.repeats = 'week' THEN 'week' ELSE 'month' END,
                      public.ops_day_long(v_first));
      CONTINUE WHEN v_due IS NOT DISTINCT FROM c.due_on AND v_ins IS NOT DISTINCT FROM c.instructions;
      v_before := public.ops_card_snapshot(c.id);
      UPDATE public.ops_work_cards w0 SET due_on = v_due, instructions = v_ins,
             revision = w0.revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
       WHERE w0.id = c.id RETURNING w0.* INTO n;
      v_words := format('Moved on: the next date to publish is %s.', public.ops_day_long(v_first));
      v_event := public.ops_card_event(c.id, c_actor, 'system', 'redated', v_words, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
      PERFORM public.ops_log_write(c_actor, 'system', 'auto_redated', 'info', c.id, 'expected', x.id,
        format('Card %s moved on: the next %s date to publish is %s.', n.number, x.title, public.ops_day_words(v_first)),
        jsonb_build_object('from', c.due_on, 'to', v_due));
      v_redated := v_redated + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: rolling card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- A one-off promised date that now repeats: its go-live card closes, the
  -- one rolling card covers the series (never two cards for one host's dates).
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
             JOIN public.ops_expected_events z ON w0.auto_key = 'golive:expected:' || z.id
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND z.status = 'open' AND z.repeats <> 'none'
              AND (p_record_id IS NULL OR z.record_id = p_record_id)
            ORDER BY w0.number LOOP
    BEGIN
      v_res := public.ops_auto_card_close(c.id, c_golive_repeat,
        jsonb_build_array(jsonb_build_object('text', 'The host''s dates repeat now, so the rolling card for the series covers them.')));
      IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: closing card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- 5. The cards the timeline asks for. Each key makes at most one open card.
  FOR h IN SELECT c0.id, c0.name, c0.brand_id, c0.stage FROM public.crm_records c0
            WHERE c0.pipeline = 'hosts' AND c0.deleted_at IS NULL AND c0.stage <> 'lost'
              AND (p_record_id IS NULL OR c0.id = p_record_id)
            ORDER BY c0.id LOOP
    v_owners := public.ops_record_team_owners(h.id);
    v_mkt_owners := CASE WHEN v_mkt IS NOT NULL THEN ARRAY[v_mkt] ELSE v_owners END;
    -- A1 go-live and A2 giveaway and ads, for the brand's events.
    IF h.brand_id IS NOT NULL THEN
      FOR e IN SELECT ev.id FROM public.events ev
                WHERE ev.brand_id = h.brand_id AND ev.deleted_at IS NULL AND ev.status IN ('draft', 'scheduled', 'live')
                  AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = ev.id
                               AND d.start_at >= ((v_today - 2)::timestamp AT TIME ZONE 'UTC'))
                ORDER BY ev.id LOOP
        a := public.ops_anchor('event', e.id, v_today);
        CONTINUE WHEN a IS NULL OR a->>'start_on' IS NULL OR (a->>'start_on')::date < v_today;
        CONTINUE WHEN public.ops_event_in_series(h.id, e.id, v_today);
        st := public.ops_plain_state(a, v_today);
        v_start := (a->>'start_on')::date;
        v_title := left(COALESCE(NULLIF(btrim(a->>'title'), ''), 'The event'), 120);
        IF st->>'k' = 'notlive'
           -- one go-live card per dated thing: a promised date within 3 days stands for this draft
           AND NOT EXISTS (SELECT 1 FROM public.ops_expected_events z WHERE z.record_id = h.id AND z.status = 'open'
                            AND z.repeats = 'none' AND abs(z.expected_on - v_start) <= 3)
           AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.anchor_kind = 'event' AND k.anchor_id = e.id
                            AND k.kit_step = -28 AND k.archived_at IS NULL) THEN
          v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'golive:event:' || e.id, 'kind', 'gate_live', 'due', v_start - 28,
            'anchor', jsonb_build_object('kind', 'event', 'id', e.id),
            'item', jsonb_build_object(
              'title', left(format('Get %s live by %s', v_title, public.ops_day_words(v_start - 28)), 160),
              'instructions', format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                                     public.ops_day_words(v_start - 35), public.ops_day_words(v_start - 31)),
              'done_means', left(format('%s is public on Mingla.', v_title), 300),
              'owners', to_jsonb(v_owners), 'watchers', '[]'::jsonb, 'kit_step', -28,
              'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
        -- #4256: giveaway and ads cards are opened by a person; Mingla makes
        -- them by itself only while auto_promo_cards is on (off as shipped).
        ELSIF st->>'k' IN ('ready', 'short') AND v_auto_promo
           AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.anchor_kind = 'event' AND k.anchor_id = e.id
                            AND k.kit_step = -21 AND k.archived_at IS NULL) THEN
          v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'promo:event:' || e.id, 'kind', 'promo', 'due', v_start - 21,
            'anchor', jsonb_build_object('kind', 'event', 'id', e.id),
            'item', jsonb_build_object(
              'title', left(format('Giveaway and ads for %s', v_title), 160),
              'instructions', format('Starts %s. Creators post %s, reminder %s. Money is spent only after a person approves it in Needs you.',
                                     public.ops_day_words(v_start - 21), public.ops_day_words(v_start - 14), public.ops_day_words(v_start - 7)),
              'done_means', 'The giveaway is open and the ads plan is approved by a person.',
              'owners', to_jsonb(v_mkt_owners), 'watchers', '[]'::jsonb, 'kit_step', -21,
              'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
        END IF;
      END LOOP;
    END IF;
    -- A1 go-live for one-off promised dates and promo moments.
    FOR x IN SELECT z.* FROM public.ops_expected_events z
              WHERE z.record_id = h.id AND z.status = 'open' AND z.repeats = 'none' AND z.expected_on >= v_today ORDER BY z.expected_on, z.id LOOP
      st := public.ops_plain_state(public.ops_expected_anchor(x, x.expected_on), v_today);
      CONTINUE WHEN st->>'k' <> 'notlive';
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.anchor_kind = 'expected' AND k.anchor_id = x.id
                             AND k.kit_step = -28 AND k.archived_at IS NULL AND k.status <> 'done');
      v_title := left(x.title, 120);
      -- #3980 W3 rework 2: one open go-live card per promised date. A card
      -- from an earlier round (closed by Mingla when the dates began to
      -- repeat, or closed before a rolling card of a later round was made)
      -- opens again: the same card, with its history. A card a person closed
      -- in this round stays closed.
      v_parked := NULL;
      SELECT k.id INTO v_parked FROM public.ops_work_cards k
       WHERE k.anchor_kind = 'expected' AND k.anchor_id = x.id AND k.kit_step = -28 AND k.archived_at IS NULL AND k.status = 'done'
       ORDER BY k.closed_at DESC NULLS LAST, k.number DESC LIMIT 1;
      IF v_parked IS NOT NULL THEN
        SELECT * INTO c FROM public.ops_work_cards k WHERE k.id = v_parked;
        IF (c.close_kind = 'system' AND c.close_reason = c_golive_repeat)
           OR EXISTS (SELECT 1 FROM public.ops_work_cards s WHERE s.auto_key = 'series:' || x.id AND s.created_at > COALESCE(c.closed_at, c.created_at)) THEN
          BEGIN
            v_before := public.ops_card_snapshot(v_parked);
            SELECT * INTO c FROM public.ops_work_cards k WHERE k.id = v_parked FOR UPDATE;
            UPDATE public.ops_work_cards w0 SET status = 'todo', person_reason = NULL, close_kind = NULL, close_reason = NULL, closed_at = NULL,
                   closed_by = NULL, closed_via = NULL, proof = '[]'::jsonb,
                   title = left(format('Get %s live by %s', v_title, public.ops_day_words(x.expected_on - 28)), 160),
                   instructions = format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                                         public.ops_day_words(x.expected_on - 35), public.ops_day_words(x.expected_on - 31)),
                   due_on = x.expected_on - 28, due_source = 'kit', sprint_id = public.ops_sprint_ensure(v_today),
                   revision = w0.revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
             WHERE w0.id = v_parked RETURNING w0.* INTO n;
            v_words := format('Opened again: %s happens once, on %s, and is not live yet.', v_title, public.ops_day_long(x.expected_on));
            v_event := public.ops_card_event(n.id, c_actor, 'system', 'reopened', v_words, v_before, public.ops_card_snapshot(n.id), c.revision, n.revision);
            PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', n.id, 'expected', x.id,
              format('Card %s opened again: %s happens once, on %s.', n.number, v_title, public.ops_day_words(x.expected_on)),
              jsonb_build_object('auto_key', n.auto_key, 'reopened', true));
            PERFORM public.ops_notify_people(n.id, v_event, public.ops_card_people(n.id, NULL), c_actor,
              format('Mingla opened "%s" again: the dates no longer repeat.', n.title));
            v_added := v_added + 1;
          EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: reopening card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
          END;
        END IF;
        CONTINUE;
      END IF;
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'golive:expected:' || x.id, 'kind', 'gate_live', 'due', x.expected_on - 28,
        'anchor', jsonb_build_object('kind', 'expected', 'id', x.id),
        'item', jsonb_build_object(
          'title', left(format('Get %s live by %s', v_title, public.ops_day_words(x.expected_on - 28)), 160),
          'instructions', format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                                 public.ops_day_words(x.expected_on - 35), public.ops_day_words(x.expected_on - 31)),
          'done_means', left(format('%s is public on Mingla.', v_title), 300),
          'owners', to_jsonb(v_owners), 'watchers', '[]'::jsonb, 'kit_step', -28,
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
    END LOOP;
    -- A5 one rolling card per repeating series.
    FOR x IN SELECT z.* FROM public.ops_expected_events z
              WHERE z.record_id = h.id AND z.status = 'open' AND z.repeats <> 'none' ORDER BY z.expected_on, z.id LOOP
      v_first := NULL;
      SELECT (o->>'on')::date INTO v_first FROM jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
       WHERE NOT (o->>'live')::boolean ORDER BY (o->>'on')::date LIMIT 1;
      CONTINUE WHEN v_first IS NULL OR v_first - 28 > v_today + 7;
      v_ins := format('Repeats every %s. Next date to publish: %s.', CASE WHEN x.repeats = 'week' THEN 'week' ELSE 'month' END,
                      public.ops_day_long(v_first));
      -- A card closed because every kept date was live opens again (same
      -- card, same history) once a date needs publishing.
      v_parked := NULL;
      IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.auto_key = 'series:' || x.id AND k.status <> 'done' AND k.archived_at IS NULL) THEN
        SELECT k.id INTO v_parked FROM public.ops_work_cards k
         WHERE k.auto_key = 'series:' || x.id AND k.status = 'done' AND k.archived_at IS NULL
           AND k.close_kind = 'system' AND k.close_reason = c_series_parked
         ORDER BY k.closed_at DESC, k.number DESC LIMIT 1;
      END IF;
      IF v_parked IS NOT NULL THEN
        BEGIN
          v_before := public.ops_card_snapshot(v_parked);
          SELECT * INTO c FROM public.ops_work_cards k WHERE k.id = v_parked FOR UPDATE;
          UPDATE public.ops_work_cards w0 SET status = 'todo', close_kind = NULL, close_reason = NULL, closed_at = NULL,
                 closed_by = NULL, closed_via = NULL, proof = '[]'::jsonb, instructions = v_ins,
                 due_on = GREATEST(v_first - 28, v_today), sprint_id = public.ops_sprint_ensure(v_today),
                 revision = w0.revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
           WHERE w0.id = v_parked RETURNING w0.* INTO n;
          v_words := format('Opened again: %s needs publishing.', public.ops_day_long(v_first));
          v_event := public.ops_card_event(n.id, c_actor, 'system', 'reopened', v_words, v_before, public.ops_card_snapshot(n.id), c.revision, n.revision);
          PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', n.id, 'expected', x.id,
            format('Card %s opened again: the next %s date to publish is %s.', n.number, x.title, public.ops_day_words(v_first)),
            jsonb_build_object('auto_key', n.auto_key, 'reopened', true));
          PERFORM public.ops_notify_people(n.id, v_event, public.ops_card_people(n.id, NULL), c_actor,
            format('Mingla opened "%s" again: %s needs publishing.', n.title, public.ops_day_long(v_first)));
          v_added := v_added + 1;
        EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: reopening card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
        END;
        CONTINUE;
      END IF;
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'series:' || x.id, 'kind', 'task', 'due', GREATEST(v_first - 28, v_today),
        'anchor', NULL,
        'item', jsonb_build_object(
          'title', left(format('Keep 4 weeks of %s dates live', left(h.name, 120)), 160),
          'instructions', v_ins,
          'done_means', left(format('The next 4 dates of %s are public on Mingla.', left(h.name, 120)), 300),
          'owners', to_jsonb(v_owners), 'watchers', '[]'::jsonb, 'due_on', GREATEST(v_first - 28, v_today),
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id), jsonb_build_object('kind', 'expected', 'id', x.id)))));
    END LOOP;
    -- A3 recap after the host's latest event, and A4 ask for the first or
    -- next event, only when nothing is coming up.
    v_next := v_hostnext->(h.id::text)->'next';
    CONTINUE WHEN v_next IS NOT NULL AND jsonb_typeof(v_next) = 'object';
    v_rid := NULL; v_rtitle := NULL; v_ron := NULL;
    IF h.brand_id IS NOT NULL THEN
      SELECT ev.id, ev.title, (s.st AT TIME ZONE 'UTC')::date INTO v_rid, v_rtitle, v_ron
        FROM public.events ev
        JOIN LATERAL (SELECT public.ops_event_first_start(ev.id) AS st) s ON true
       WHERE ev.brand_id = h.brand_id AND ev.deleted_at IS NULL AND public.ops_event_public(ev.id) AND s.st IS NOT NULL
         AND (s.st AT TIME ZONE 'UTC')::date BETWEEN v_today - 7 AND v_today - 1
       ORDER BY s.st DESC, ev.id LIMIT 1;
    END IF;
    IF v_rid IS NOT NULL THEN
      v_title := left(COALESCE(NULLIF(btrim(v_rtitle), ''), 'the event'), 100);
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'recap:' || v_rid, 'kind', 'task', 'due', GREATEST(v_ron + 2, v_today),
        'anchor', NULL,
        'item', jsonb_build_object(
          'title', left(format('Recap %s and ask %s for their next event', v_title, left(h.name, 50)), 160),
          'instructions', 'Sales, check-ins, what to repeat. Then set their next event on the card.',
          'done_means', 'A recap note is on the host card and their next event is set.',
          'owners', to_jsonb(v_owners), 'watchers', '[]'::jsonb, 'due_on', GREATEST(v_ron + 2, v_today),
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
    ELSIF h.stage IN ('replied', 'meeting', 'onboarded')
          AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k
                           JOIN public.ops_work_links l ON l.card_id = k.id AND l.kind = 'host' AND l.target_id = h.id
                          WHERE k.auto_key LIKE 'recap:%' AND k.status <> 'done' AND k.archived_at IS NULL) THEN
      v_past := (h.brand_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.events ev JOIN LATERAL (SELECT public.ops_event_first_start(ev.id) AS st) s ON true
                    WHERE ev.brand_id = h.brand_id AND ev.deleted_at IS NULL AND ev.status <> 'cancelled' AND s.st < now()))
                OR EXISTS (SELECT 1 FROM public.ops_expected_events z WHERE z.record_id = h.id AND z.status = 'fulfilled');
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'ask:' || h.id, 'kind', 'task', 'due', v_today + 3,
        'anchor', NULL,
        'item', jsonb_build_object(
          'title', left(format('Ask %s for their %s event and date', left(h.name, 120), CASE WHEN v_past THEN 'next' ELSE 'first' END), 160),
          'instructions', 'Set it on their host card. The steps and the Calendar fill in from there.',
          'done_means', 'Their next event and its date are on the host card.',
          'owners', to_jsonb(v_owners), 'watchers', '[]'::jsonb, 'due_on', v_today + 3,
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
    END IF;
  END LOOP;

  -- Make them, soonest first, at most 50 a run.
  FOR w IN SELECT value FROM jsonb_array_elements(v_want) ORDER BY (value->>'due')::date, value->>'key' LOOP
    IF v_added >= c_cap THEN
      IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.auto_key = w->>'key' AND k.status <> 'done' AND k.archived_at IS NULL) THEN
        v_deferred := v_deferred + 1;
      END IF;
      CONTINUE;
    END IF;
    BEGIN
      v_res := public.ops_auto_card_upsert(w->>'key', w->'item', w->>'kind',
        CASE WHEN jsonb_typeof(w->'anchor') = 'object' THEN w->'anchor' END);
      IF v_res->>'status' = 'added' THEN v_added := v_added + 1; END IF;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'ops_auto_steps: % kept (an open card already covers it)', w->>'key';
    WHEN others THEN
      RAISE WARNING 'ops_auto_steps: % stopped (% %)', w->>'key', SQLSTATE, SQLERRM;
    END;
  END LOOP;
  IF v_deferred > 0 THEN
    PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', NULL, NULL, NULL,
      format('Mingla made %s cards from the timeline; %s more wait for the next run.', v_added, v_deferred),
      jsonb_build_object('added', v_added, 'deferred', v_deferred));
  END IF;
  RETURN jsonb_build_object('added', v_added, 'closed', v_closed, 'redated', v_redated, 'deferred', v_deferred);
END;
$$;

COMMENT ON FUNCTION public.ops_auto_steps(date, uuid) IS
  'Issue #3980, #4256. Automatic steps from the timeline: at most one open card per key (go-live, recap, ask for the next event, one rolling card per repeating host, and giveaway and ads only while ops_settings.auto_promo_cards is on), re-dated when the event moves and closed when it is cancelled; a rolling card follows its next unpublished date, closes when all 4 kept dates are live or the dates stop repeating, and opens again when a date needs publishing. Run only while ops_settings.auto_steps is on; at most 50 new cards a run.';
