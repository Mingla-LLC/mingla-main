-- Issue #3980, Wave 2: the Calendar, the team's read of events, and host
-- sync.
--
-- What this adds:
--   * One read-only team view of events for the Calendar. It shows events
--     that are public on Mingla, plus draft listings of brands already linked
--     to a host card (shown as not public). Private and hidden events never
--     show. It returns titles, brand, city, status, dates and runway only:
--     never an address, a theme, the organiser's contact, prices, orders or
--     buyers. admin_list_offerings and the Offerings console are untouched.
--   * Runway on every event, worked out from the public time and the first
--     date, never typed: 28 days or more is a full launch, 21 to 27 tight,
--     under 21 organic only. An event that is not public yet shows the date
--     it must go live by, and "missed" once fewer than 21 days are left.
--   * Expected events on host cards: the next event a host has promised, with
--     its date. It shows dashed on the Calendar with its go-live deadline.
--     When the host's brand lists a public event within 3 days of that date,
--     the expected event is linked to it by the ten-minute housekeeping run,
--     and the work cards counted from it move to the real event.
--   * A runway report, the launch kit status of one event, a host card's
--     events on Mingla, and a promotions layer: the date giveaway and ads may
--     start (21 days before) and content linked to the event through a work
--     card. The promotions function is the one place ads and giveaway records
--     will join later; it reads no ad table today.
--   * The connector's calendar tools (list_calendar, runway_report,
--     set_expected_event) now work. plan_work stays closed until Wave 3.
--   * An agent that moves a card that needs a person back to To do (or Doing)
--     must say why. The reason is written to the agent log and the card's
--     owners and watchers are told.
--
-- Existing functions replaced: ops_work_update, ops_reconcile and
-- ops_agent_call (all from 20271116003980_issue_3980_wave1_work_board.sql),
-- each copied whole with only the lines described above added. Signatures,
-- attributes and grants are unchanged.
--
-- NOT modified: is_admin_user(), team_agent_call, admin_list_offerings, role
-- areas, any crm_ table, any ad table. Nothing here reaches outside the
-- database.
--
-- ROLLBACK (no down-migration file): roll the admin web client and the
-- team-agent function back first, then in one transaction restore
-- ops_work_update, ops_reconcile and ops_agent_call from the Wave 1 migration
-- and drop the functions this file creates. Expected events already saved
-- stay in ops_expected_events (created in Wave 1).

BEGIN;

-- A stuck lock aborts the apply instead of hanging.
SET LOCAL lock_timeout = '10s';

-- Remembered for the self-check at the end.
CREATE TEMP TABLE issue3980_w2_guard ON COMMIT DROP AS
SELECT md5(pg_get_functiondef('public.is_admin_user()'::regprocedure)) AS is_admin_hash,
       md5(pg_get_functiondef('public.admin_list_offerings'::regproc)) AS offerings_hash;

-- ---------------------------------------------------------------------------
-- 1. Internal helpers (service_role only; clients cannot run them).
-- ---------------------------------------------------------------------------

-- A window of days the calendar functions accept: at most 100 days.
CREATE FUNCTION public.ops_window_check(p_from date, p_to date) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 99 THEN
    RAISE EXCEPTION 'invalid_window: Ask for at most 100 days at a time.' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Events the team may see whose first date falls in a window, each as an
-- anchor (title, brand, city, status, dates, runway; never an address).
CREATE FUNCTION public.ops_events_in_window(p_from date, p_to date, p_today date) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT y.a
    FROM (SELECT DISTINCT d.event_id FROM public.event_dates d
           WHERE d.start_at >= ((p_from - 2)::timestamp AT TIME ZONE 'UTC')
             AND d.start_at < ((p_to + 3)::timestamp AT TIME ZONE 'UTC')) x
    CROSS JOIN LATERAL (SELECT public.ops_anchor('event', x.event_id, p_today) AS a) y
   WHERE y.a IS NOT NULL AND y.a->>'start_on' IS NOT NULL
     AND (y.a->>'start_on')::date BETWEEN p_from AND p_to
$$;

-- A host card in a few words: its name and its owners' names.
CREATE FUNCTION public.ops_host_json(p_record_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('record_id', c.id, 'name', c.name,
    'owners', COALESCE((SELECT jsonb_agg(public.ops_name(o.owner_email) ORDER BY o.owner_email)
                          FROM public.crm_record_owners o WHERE o.record_id = c.id), '[]'::jsonb))
    FROM public.crm_records c
   WHERE c.id = p_record_id AND c.deleted_at IS NULL AND c.pipeline = 'hosts'
$$;

-- How many open and done cards count from, or link to, an event or an
-- expected event.
CREATE FUNCTION public.ops_anchor_card_counts(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('open', count(*) FILTER (WHERE w.status <> 'done'), 'done', count(*) FILTER (WHERE w.status = 'done'))
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL
     AND ((w.anchor_kind = p_kind AND w.anchor_id = p_id)
          OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = p_kind AND l.target_id = p_id))
$$;

-- A card in a few words, for lists beside an event or a host.
CREATE FUNCTION public.ops_card_lite(c public.ops_work_cards) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title, 'status', c.status, 'blocked', c.blocked,
    'blocked_reason', c.blocked_reason, 'person_reason', c.person_reason, 'kind', c.kind, 'kit_step', c.kit_step,
    'due_on', c.due_on, 'close_kind', c.close_kind, 'anchor_kind', c.anchor_kind, 'anchor_id', c.anchor_id)
$$;

-- An expected event as the screens and the connector see it.
CREATE FUNCTION public.ops_expected_json(x public.ops_expected_events, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_host jsonb := public.ops_host_json(x.record_id);
BEGIN
  RETURN jsonb_build_object('id', x.id, 'record_id', x.record_id, 'host_name', v_host->>'name', 'title', x.title,
    'event_type', x.event_type, 'expected_on', x.expected_on, 'city', x.city, 'note', x.note, 'status', x.status,
    'event_id', x.event_id, 'cancel_reason', x.cancel_reason, 'revision', x.revision, 'updated_at', x.updated_at,
    'runway', public.ops_runway(false, NULL, (x.expected_on::timestamp AT TIME ZONE 'UTC'), 'UTC', COALESCE(p_today, public.ops_today(NULL))),
    'owners', COALESCE(v_host->'owners', '[]'::jsonb),
    'cards', public.ops_anchor_card_counts('expected', x.id));
END;
$$;

-- An event on the Calendar.
CREATE FUNCTION public.ops_calendar_event_json(a jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', a->'id', 'title', a->'title', 'event_type', a->'event_type',
    'brand', jsonb_build_object('id', a->'brand_id', 'name', a->'brand_name'), 'city', a->'city', 'status', a->'status',
    'visibility', a->'visibility', 'is_public', a->'is_public', 'published_at', a->'published_at',
    'published_at_inferred', a->'published_at_inferred', 'start_at', a->'start_at', 'start_on', a->'start_on',
    'timezone', a->'timezone', 'runway', a->'runway',
    'host', public.ops_host_json((a->>'record_id')::uuid),
    'cards', public.ops_anchor_card_counts('event', (a->>'id')::uuid))
$$;

-- The promotions layer.
CREATE FUNCTION public.ops_promotions(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
-- Seam: ads (#3697) and giveaway (#3922) records join here as further sources. This function reads no ad table today.
DECLARE v_today date := public.ops_today(NULL); v_out jsonb; v_tz constant text := 'UTC';
BEGIN
  SELECT COALESCE(jsonb_agg(s.r ORDER BY s.r->>'date', s.r->>'label'), '[]'::jsonb) INTO v_out FROM (
    (SELECT jsonb_build_object('date', a->'runway'->'promo_from', 'source', 'promo_start', 'anchor_kind', 'event',
              'anchor_id', a->'id', 'label', 'Promo starts: ' || (a->>'title'), 'band', a->'runway'->'band') AS r
       FROM public.ops_events_in_window(p_from + 21, p_to + 21, v_today) a
      WHERE a->'runway'->>'band' IN ('full', 'tight', 'not_live'))
    UNION ALL
    (SELECT jsonb_build_object('date', x.expected_on - 21, 'source', 'promo_start', 'anchor_kind', 'expected',
              'anchor_id', x.id, 'label', 'Promo starts: ' || x.title, 'band', 'not_live')
       FROM public.ops_expected_events x
      WHERE x.status = 'open' AND x.expected_on - 21 BETWEEN p_from AND p_to AND v_today <= x.expected_on - 21)
    UNION ALL
    (SELECT DISTINCT ON (i.id, w.anchor_kind, w.anchor_id)
            jsonb_build_object('date', (i.publish_at AT TIME ZONE v_tz)::date, 'source', 'content', 'anchor_kind', w.anchor_kind,
              'anchor_id', w.anchor_id, 'label', i.title, 'content_id', i.id)
       FROM public.ops_work_links l
       JOIN public.ops_work_cards w ON w.id = l.card_id AND w.archived_at IS NULL AND w.anchor_id IS NOT NULL
       JOIN public.content_calendar_items i ON i.id = l.target_id AND i.deleted_at IS NULL
      WHERE l.kind = 'content' AND i.publish_at IS NOT NULL
        AND (i.publish_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to)
  ) s;
  RETURN v_out;
END;
$$;

-- Move the cards counted from a fulfilled expected event to the real event:
-- the anchor, the due date counted from it, the event link, and the giveaway
-- and ads rule for promo cards (an override is kept). Each card on its own;
-- a card whose kit step the event already has stays where it is.
CREATE FUNCTION public.ops_reanchor_expected(p_expected_id uuid, p_actor text, p_via text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  x public.ops_expected_events; a jsonb; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL);
  v_before jsonb; v_due date; v_gate jsonb; v_label text; v_moved integer := 0; v_gated boolean;
BEGIN
  SELECT * INTO x FROM public.ops_expected_events z WHERE z.id = p_expected_id AND z.status = 'fulfilled';
  IF NOT FOUND THEN RETURN 0; END IF;
  a := public.ops_anchor('event', x.event_id, v_today);
  IF a IS NULL THEN RETURN 0; END IF;
  v_label := left(COALESCE(NULLIF(btrim(a->>'title'), ''), 'An event'), 160);
  FOR c IN SELECT * FROM public.ops_work_cards w
            WHERE w.anchor_kind = 'expected' AND w.anchor_id = x.id AND w.archived_at IS NULL ORDER BY w.number LOOP
    BEGIN
      v_before := public.ops_card_snapshot(c.id);
      v_due := c.due_on;
      IF a->>'start_on' IS NOT NULL THEN
        IF c.due_source = 'kit' AND c.kit_step IS NOT NULL THEN v_due := (a->>'start_on')::date + c.kit_step;
        ELSIF c.due_source = 'event' THEN v_due := (a->>'start_on')::date - 1; END IF;
      END IF;
      v_gated := c.kind = 'promo' AND c.override_at IS NULL AND c.status <> 'done'
                 AND (c.blocked_kind IS NULL OR c.blocked_kind IN ('waiting_go_live', 'organic_only'));
      v_gate := CASE WHEN v_gated THEN public.ops_promo_gate(a, v_today) END;
      UPDATE public.ops_work_cards w SET anchor_kind = 'event', anchor_id = x.event_id, due_on = v_due,
             sprint_id = CASE WHEN v_due IS DISTINCT FROM c.due_on THEN public.ops_sprint_for(v_due, v_today) ELSE w.sprint_id END,
             blocked = CASE WHEN v_gated THEN (v_gate->>'blocked')::boolean ELSE w.blocked END,
             blocked_kind = CASE WHEN v_gated THEN CASE WHEN (v_gate->>'blocked')::boolean THEN v_gate->>'kind' END ELSE w.blocked_kind END,
             blocked_reason = CASE WHEN v_gated THEN CASE WHEN (v_gate->>'blocked')::boolean THEN v_gate->>'reason' END ELSE w.blocked_reason END,
             revision = w.revision + 1, updated_by = p_actor, updated_via = p_via, updated_at = now()
       WHERE w.id = c.id RETURNING * INTO n;
      INSERT INTO public.ops_work_links (card_id, kind, target_id, label, added_by, added_via)
      VALUES (c.id, 'event', x.event_id, v_label, p_actor, NULLIF(p_via, 'system'))
      ON CONFLICT (card_id, kind, target_id) DO NOTHING;
      PERFORM public.ops_card_event(c.id, p_actor, p_via, 're_anchored',
        format('Now counted from %s, which is on Mingla.', v_label), v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
      v_moved := v_moved + 1;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'ops_reanchor_expected: card % keeps its expected event; the event already has that kit step', c.number;
    END;
  END LOOP;
  RETURN v_moved;
END;
$$;

-- Link an open expected event to the real event and move its cards.
CREATE FUNCTION public.ops_expected_fulfil(p_expected_id uuid, p_event_id uuid, p_actor text, p_via text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.ops_expected_events x SET status = 'fulfilled', event_id = p_event_id, revision = x.revision + 1,
         updated_by = p_actor, updated_via = p_via, updated_at = now()
   WHERE x.id = p_expected_id AND x.status = 'open';
  IF NOT FOUND THEN RETURN 0; END IF;
  RETURN public.ops_reanchor_expected(p_expected_id, p_actor, p_via);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Client functions. Each one gates first through crm_ctx().
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.ops_calendar(p_from date, p_to date, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); v_base jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_window_check(p_from, p_to);
  -- Events from the window start to 28 days after its end: go-live deadlines
  -- in the window belong to events up to 28 days later.
  SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) INTO v_base FROM public.ops_events_in_window(p_from, p_to + 28, v_today) a;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'today', v_today,
    'events', COALESCE((SELECT jsonb_agg(public.ops_calendar_event_json(a) ORDER BY a->>'start_at', a->>'title')
                          FROM jsonb_array_elements(v_base) a WHERE (a->>'start_on')::date BETWEEN p_from AND p_to), '[]'::jsonb),
    'expected', COALESCE((SELECT jsonb_agg(public.ops_expected_json(x, v_today) ORDER BY x.expected_on, x.title)
                            FROM public.ops_expected_events x
                           WHERE x.status = 'open' AND x.expected_on BETWEEN p_from AND p_to), '[]'::jsonb),
    'deadlines', COALESCE((SELECT jsonb_agg(d.r ORDER BY d.r->>'date', d.r->>'label') FROM (
        SELECT jsonb_build_object('date', a->'runway'->'go_live_by', 'anchor_kind', 'event', 'anchor_id', a->'id',
                 'title', a->'title', 'label', 'Go live: ' || COALESCE(public.ops_host_json((a->>'record_id')::uuid)->>'name', a->>'title')) AS r
          FROM jsonb_array_elements(v_base) a
         WHERE NOT COALESCE((a->>'is_public')::boolean, false)
           AND (a->'runway'->>'go_live_by')::date BETWEEN p_from AND p_to
        UNION ALL
        SELECT jsonb_build_object('date', x.expected_on - 28, 'anchor_kind', 'expected', 'anchor_id', x.id,
                 'title', x.title, 'label', 'Go live: ' || COALESCE(public.ops_host_json(x.record_id)->>'name', x.title))
          FROM public.ops_expected_events x
         WHERE x.status = 'open' AND x.expected_on - 28 BETWEEN p_from AND p_to) d), '[]'::jsonb),
    'promotions', public.ops_promotions(p_from, p_to),
    'content', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'stage', i.stage,
                            'publish_at', i.publish_at, 'channels', to_jsonb(i.channels)) ORDER BY i.publish_at, i.title)
                           FROM public.content_calendar_items i
                          WHERE i.deleted_at IS NULL AND i.publish_at >= (p_from::timestamp AT TIME ZONE 'UTC')
                            AND i.publish_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')), '[]'::jsonb));
END;
$$;

CREATE FUNCTION public.ops_runway_report(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(p_today); v_from date; v_to date; v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_from := COALESCE(p_from, v_today);
  v_to := COALESCE(p_to, v_from + 90);
  PERFORM public.ops_window_check(v_from, v_to);
  SELECT COALESCE(jsonb_agg(s.r ORDER BY s.r->>'start_on', s.r->>'title'), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('anchor_kind', 'event', 'anchor_id', a->'id', 'title', a->'title', 'start_on', a->'start_on',
             'band', a->'runway'->'band', 'lead_days', a->'runway'->'lead_days', 'go_live_by', a->'runway'->'go_live_by',
             'is_public', a->'is_public', 'host_name', h.j->'name', 'record_id', a->'record_id',
             'owners', COALESCE(h.j->'owners', '[]'::jsonb)) AS r
      FROM public.ops_events_in_window(v_from, v_to, v_today) a
      LEFT JOIN LATERAL (SELECT public.ops_host_json((a->>'record_id')::uuid) AS j) h ON true
    UNION ALL
    SELECT jsonb_build_object('anchor_kind', 'expected', 'anchor_id', x.id, 'title', x.title, 'start_on', x.expected_on,
             'band', e.j->'runway'->'band', 'lead_days', NULL, 'go_live_by', e.j->'runway'->'go_live_by', 'is_public', false,
             'host_name', e.j->'host_name', 'record_id', x.record_id, 'owners', e.j->'owners')
      FROM public.ops_expected_events x
      CROSS JOIN LATERAL (SELECT public.ops_expected_json(x, v_today) AS j) e
     WHERE x.status = 'open' AND x.expected_on BETWEEN v_from AND v_to) s;
  RETURN jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today,
    'counts', jsonb_build_object(
      'full', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'full'),
      'tight', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'tight'),
      'organic', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'organic'),
      'not_live', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'not_live'),
      'missed', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'missed')),
    'rows', v_rows,
    'at_risk', COALESCE((SELECT jsonb_agg(r ORDER BY r->>'go_live_by', r->>'title') FROM jsonb_array_elements(v_rows) r
                          WHERE (r->>'band' = 'not_live' AND (r->>'go_live_by')::date <= v_today + 14) OR r->>'band' = 'missed'), '[]'::jsonb));
END;
$$;

CREATE FUNCTION public.ops_anchor_detail(p_kind text, p_id uuid, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(p_today); a jsonb; v_host jsonb; v_start date; v_band text; v_kit jsonb;
  v_hostname text; v_title text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_kind IS NULL OR p_kind NOT IN ('event', 'expected') THEN
    RAISE EXCEPTION 'invalid_kind: Ask for an event or an expected event.' USING ERRCODE = '22023';
  END IF;
  a := public.ops_anchor(p_kind, p_id, v_today);
  IF a IS NULL THEN
    RAISE EXCEPTION 'not_found: That event is not on Mingla or not visible to the team.' USING ERRCODE = 'P0002';
  END IF;
  v_host := public.ops_host_json((a->>'record_id')::uuid);
  v_start := (a->>'start_on')::date;
  v_band := a->'runway'->>'band';
  v_title := COALESCE(a->>'title', 'the event');
  v_hostname := COALESCE(v_host->>'name', a->>'brand_name', 'the host');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'step', (k->>'step')::integer, 'key', k->>'key',
           'date', CASE WHEN v_start IS NOT NULL THEN v_start + (k->>'step')::integer END,
           'title', replace(replace(replace(replace(k->>'title_template', '{title}', v_title), '{host}', v_hostname),
                    '{date21}', COALESCE(public.ops_day_words(v_start - 21), 'its promo date')),
                    '{date}', COALESCE(public.ops_day_words(v_start - 28), 'its go-live date')),
           'who', k->>'who', 'kind', k->>'kind', 'gate', (k->>'gate')::boolean,
           'card', CASE WHEN w.id IS NOT NULL THEN jsonb_build_object('id', w.id, 'number', w.number, 'status', w.status,
                                                                    'blocked', w.blocked, 'person_reason', w.person_reason) END,
           'state', CASE
             WHEN w.id IS NOT NULL THEN CASE WHEN w.status = 'done' THEN 'done' ELSE 'card' END
             WHEN k->>'kind' = 'promo' AND v_band IN ('organic', 'missed') THEN 'not_eligible'
             WHEN COALESCE((a->>'is_public')::boolean, false) AND (k->>'step')::integer <= -28 THEN 'done'
             WHEN v_start IS NOT NULL AND v_start + (k->>'step')::integer < v_today THEN 'passed'
             ELSE 'no_card' END)
           ORDER BY (k->>'step')::integer), '[]'::jsonb)
    INTO v_kit
    FROM jsonb_array_elements(public.ops_kit_template()) k
    LEFT JOIN LATERAL (SELECT c.id, c.number, c.status, c.blocked, c.person_reason FROM public.ops_work_cards c
                        WHERE c.anchor_kind = p_kind AND c.anchor_id = p_id AND c.kit_step = (k->>'step')::integer
                          AND c.archived_at IS NULL ORDER BY c.created_at DESC LIMIT 1) w ON true;
  RETURN jsonb_build_object('anchor', a, 'runway', a->'runway', 'kit', v_kit, 'host', v_host,
    'has_kit_card', EXISTS (SELECT 1 FROM public.ops_work_cards c WHERE c.anchor_kind = p_kind AND c.anchor_id = p_id
                              AND c.kit_step IS NOT NULL AND c.archived_at IS NULL),
    'cards', COALESCE((SELECT jsonb_agg(public.ops_card_lite(c) ORDER BY (c.status = 'done'), c.due_on, c.number)
                         FROM public.ops_work_cards c
                        WHERE c.archived_at IS NULL
                          AND ((c.anchor_kind = p_kind AND c.anchor_id = p_id)
                               OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = p_kind AND l.target_id = p_id))), '[]'::jsonb),
    'content', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', i.id, 'title', i.title, 'stage', i.stage, 'publish_at', i.publish_at))
                           FROM public.ops_work_cards c
                           JOIN public.ops_work_links l ON l.card_id = c.id AND l.kind = 'content'
                           JOIN public.content_calendar_items i ON i.id = l.target_id AND i.deleted_at IS NULL
                          WHERE c.archived_at IS NULL AND c.anchor_kind = p_kind AND c.anchor_id = p_id), '[]'::jsonb));
END;
$$;

CREATE FUNCTION public.ops_host_on_mingla(p_record_id uuid, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); r public.crm_records; v_brand jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO r FROM public.crm_records c WHERE c.id = p_record_id AND c.deleted_at IS NULL AND c.pipeline = 'hosts';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That host card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  SELECT jsonb_build_object('id', b.id, 'name', b.name) INTO v_brand
    FROM public.brands b WHERE b.id = r.brand_id AND b.deleted_at IS NULL;
  RETURN jsonb_build_object(
    'record', jsonb_build_object('id', r.id, 'name', r.name, 'brand_id', r.brand_id),
    'brand', v_brand,
    'events', CASE WHEN v_brand IS NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.a->'id', 'title', s.a->'title', 'event_type', s.a->'event_type',
                         'status', s.a->'status', 'is_public', s.a->'is_public', 'start_at', s.a->'start_at',
                         'start_on', s.a->'start_on', 'timezone', s.a->'timezone', 'runway', s.a->'runway')
                       ORDER BY s.a->>'start_at', s.a->>'title')
        FROM (SELECT y.a FROM public.events e
                CROSS JOIN LATERAL (SELECT public.ops_anchor('event', e.id, v_today) AS a) y
               WHERE e.brand_id = r.brand_id AND e.deleted_at IS NULL AND y.a IS NOT NULL
                 AND y.a->>'start_on' IS NOT NULL AND (y.a->>'start_on')::date >= v_today - 30
               ORDER BY y.a->>'start_at' LIMIT 50) s), '[]'::jsonb) END,
    'expected', COALESCE((SELECT jsonb_agg(public.ops_expected_json(x, v_today) ORDER BY (x.status <> 'open'), x.expected_on)
                            FROM public.ops_expected_events x
                           WHERE x.record_id = r.id
                             AND (x.status = 'open' OR (x.status = 'fulfilled' AND x.updated_at > now() - interval '60 days'))), '[]'::jsonb),
    'cards', COALESCE((SELECT jsonb_agg(public.ops_card_lite(c) ORDER BY c.due_on, c.number)
                         FROM public.ops_work_cards c
                        WHERE c.archived_at IS NULL AND c.status <> 'done'
                          AND EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = 'host' AND l.target_id = r.id)), '[]'::jsonb));
END;
$$;

CREATE FUNCTION public.ops_expected_event_set(p_item jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text; v_fixes jsonb := '[]'::jsonb;
  r public.crm_records; x public.ops_expected_events; n public.ops_expected_events; d public.ops_expected_events;
  v_update boolean := false; v_title text; v_type text; v_on date; v_city text; v_note text; v_cancel text;
  v_status text := 'open'; v_event uuid; v_result text; v_out jsonb; v_who text; v_moved integer := 0;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required: Send a request key, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'invalid_expected: Send the expected event as an object.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_item) k
   WHERE k NOT IN ('id','record_id','title','event_type','expected_on','city','note','status','cancel_reason','event_id') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: An expected event does not take "%s". It takes: record_id, id, title, event_type, expected_on, city, note, status, cancel_reason, event_id.', left(v_bad, 60)) USING ERRCODE = '22023';
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
  IF v_type IS NULL OR v_type NOT IN ('event', 'experience', 'trip', 'rsvp') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'event_type', 'message', 'Type must be event, experience, trip or rsvp.'));
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
    INSERT INTO public.ops_expected_events (record_id, title, event_type, expected_on, city, note, created_by, created_via, updated_by, updated_via)
    VALUES (r.id, v_title, v_type, v_on, v_city, v_note, v.actor_email, v.via, v.actor_email, v.via)
    RETURNING * INTO n;
    v_result := 'created';
  ELSIF v_status = 'cancelled' THEN
    UPDATE public.ops_expected_events z SET status = 'cancelled', cancel_reason = v_cancel, revision = z.revision + 1,
           updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE z.id = x.id RETURNING * INTO n;
    v_result := 'cancelled';
  ELSE
    UPDATE public.ops_expected_events z SET title = v_title, event_type = v_type, expected_on = v_on, city = v_city, note = v_note,
           revision = z.revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE z.id = x.id RETURNING * INTO n;
    v_result := 'updated';
  END IF;
  IF v_event IS NOT NULL AND n.status = 'open' THEN
    v_moved := public.ops_expected_fulfil(n.id, v_event, v.actor_email, v.via);
    SELECT * INTO n FROM public.ops_expected_events z WHERE z.id = n.id;
    v_result := 'fulfilled';
  END IF;
  PERFORM public.ops_log_write(v.actor_email, v.via, 'expected_set', 'ok', NULL, 'expected', n.id,
    format('%s %s the expected event %s on %s for %s.', v_who,
      CASE v_result WHEN 'created' THEN 'added' WHEN 'cancelled' THEN 'cancelled' WHEN 'fulfilled' THEN 'linked to Mingla' ELSE 'changed' END,
      n.title, public.ops_day_words(n.expected_on), r.name),
    jsonb_build_object('record_id', r.id, 'status', v_result, 'cards_moved', v_moved));
  v_out := jsonb_build_object('expected', public.ops_expected_json(n, v_today), 'status', v_result, 'cards_moved', v_moved, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'expected', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_expected: An open expected event with this title and date is already on this host card. Update that one instead.' USING ERRCODE = '22023';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Replaced from the Wave 1 migration, whole, with only the marked lines
-- added.
-- ---------------------------------------------------------------------------

-- ops_work_update: unchanged except the Wave 2 lines for leaving Needs a person.
CREATE OR REPLACE FUNCTION public.ops_work_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text;
  v_before jsonb; v_item jsonb; v_chk jsonb; cl jsonb; v_fixes jsonb; v_people jsonb; v_links_changed boolean := false;
  v_cats text[] := ARRAY[]::text[]; v_action text; v_event uuid; v_out jsonb; v_gate jsonb; v_week date; v_who text;
  v_status text; v_reason text; v_result text; v_breason text; v_owners text[]; v_watchers text[]; v_anchor_changed boolean := false;
  v_back boolean := false; v_back_reason text; -- Wave 2: leaving Needs a person
  v_removed_words text; -- #3980 rework 2: who was taken off, for the agent log
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one field to change.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('title','instructions','done_means','due_on','week','owners','watchers','links','anchor','plan','result',
                   'blocked','blocked_reason','status','person_reason','reason') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A card change does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'update',
    jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = '40001';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this card before changing it.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_before := public.ops_card_snapshot(c.id);
  v_who := public.ops_actor_label(v.actor_email, v.via);
  v_anchor_changed := p_changes ? 'anchor' AND (p_changes->'anchor' IS DISTINCT FROM
    CASE WHEN c.anchor_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) END);

  v_item := jsonb_build_object('id', c.id,
    'title', COALESCE(p_changes->'title', to_jsonb(c.title)),
    'instructions', COALESCE(p_changes->'instructions', to_jsonb(c.instructions)),
    'done_means', COALESCE(p_changes->'done_means', to_jsonb(c.done_means)),
    'owners', CASE WHEN p_changes ? 'owners' THEN p_changes->'owners' ELSE to_jsonb(public.ops_card_people(c.id, 'owner')) END,
    'watchers', CASE WHEN p_changes ? 'watchers' THEN p_changes->'watchers' ELSE to_jsonb(public.ops_card_people(c.id, 'watcher')) END,
    'links', CASE WHEN p_changes ? 'links' THEN p_changes->'links'
                  ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id)) FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb) END,
    'anchor', CASE WHEN p_changes ? 'anchor' THEN p_changes->'anchor'
                   WHEN c.anchor_id IS NOT NULL THEN jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) ELSE 'null'::jsonb END,
    'kit_step', to_jsonb(c.kit_step), 'kind', to_jsonb(c.kind),
    'person_reason', CASE WHEN p_changes ? 'person_reason' THEN p_changes->'person_reason' ELSE to_jsonb(c.person_reason) END,
    'plan', CASE WHEN p_changes ? 'plan' THEN p_changes->'plan' ELSE c.plan END,
    'due_on', CASE WHEN p_changes ? 'due_on' THEN p_changes->'due_on'
                   WHEN v_anchor_changed AND c.due_source <> 'explicit' THEN 'null'::jsonb ELSE to_jsonb(c.due_on) END,
    '_due_source', CASE WHEN p_changes ? 'due_on' THEN 'explicit' ELSE c.due_source END);
  IF p_changes ? 'links' AND NOT (p_changes ? 'anchor') AND c.anchor_id IS NOT NULL
     AND jsonb_typeof(p_changes->'links') = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'links') l WHERE l->>'kind' = c.anchor_kind AND lower(l->>'id') = c.anchor_id::text)
     AND c.kind = 'task' AND c.kit_step IS NULL THEN
    -- removing the anchor's link frees the card from its event
    v_item := jsonb_set(v_item, '{anchor}', 'null'::jsonb);
    IF c.due_source <> 'explicit' THEN v_item := jsonb_set(v_item, '{due_on}', to_jsonb(c.due_on)); v_item := jsonb_set(v_item, '{_due_source}', '"explicit"'); END IF;
    v_anchor_changed := true;
  END IF;
  v_chk := public.ops_validate_card(v_item, 'update', v.actor_email, v_today);
  v_fixes := v_chk->'fixes';
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' AND p_changes ? 'title' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message',
      format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
  END IF;
  cl := v_chk->'clean';

  -- status, needs a person, blocked, result, week
  v_status := c.status; v_reason := c.person_reason;
  IF p_changes ? 'status' THEN
    IF jsonb_typeof(p_changes->'status') <> 'string' OR p_changes->>'status' NOT IN ('todo','doing','person') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Status can be todo, doing or person. Close a card with proof, or push it back.'));
    ELSE v_status := p_changes->>'status'; END IF;
  END IF;
  IF p_changes ? 'person_reason' THEN v_reason := cl->>'person_reason'; END IF;
  IF v_status = 'person' AND v_reason IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'Needs a person must say why: send, spend, publish or other.'));
  END IF;
  IF v_status <> 'person' THEN v_reason := NULL; END IF;
  -- Wave 2: an agent moving a card that needs a person back to To do or
  -- Doing must say why; the log records it and owners and watchers are told.
  v_back := c.status = 'person' AND v_status <> 'person';
  IF v_back THEN
    v_back_reason := CASE WHEN jsonb_typeof(p_changes->'reason') = 'string' THEN left(public.ops_one_line(p_changes->>'reason'), 500) END;
    IF public.ops_has_control(v_back_reason) THEN v_back_reason := NULL; END IF;
    IF v.via IS NOT NULL AND v_back_reason IS NULL THEN
      RAISE EXCEPTION 'reason_required: Say why this card no longer needs a person. Your person and the card''s watchers are told.' USING ERRCODE = '22023';
    END IF;
  END IF;
  n := c;
  IF p_changes ? 'blocked' THEN
    IF jsonb_typeof(p_changes->'blocked') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked', 'message', 'Blocked must be true or false.'));
    ELSIF (p_changes->>'blocked')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      v_breason := public.ops_one_line(p_changes->>'blocked_reason');
      IF v_breason IS NULL OR char_length(v_breason) NOT BETWEEN 5 AND 300 THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.'));
      ELSE n.blocked := true; n.blocked_kind := 'manual'; n.blocked_reason := v_breason; END IF;
    ELSE
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked_reason' THEN
    v_breason := public.ops_one_line(p_changes->>'blocked_reason');
    IF c.blocked_kind = 'manual' AND v_breason IS NOT NULL AND char_length(v_breason) BETWEEN 5 AND 300 THEN n.blocked_reason := v_breason;
    ELSE v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.')); END IF;
  END IF;
  IF p_changes ? 'result' THEN
    v_result := CASE WHEN jsonb_typeof(p_changes->'result') = 'string' THEN public.ops_multi_line(p_changes->>'result') END;
    IF char_length(COALESCE(v_result, '')) > 2000 OR public.ops_has_control(v_result) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'result', 'message', 'Keep the result to 2,000 characters.'));
    ELSE n.result := v_result; END IF;
  END IF;
  IF p_changes ? 'week' AND jsonb_typeof(p_changes->'week') <> 'null' THEN
    BEGIN
      v_week := public.ops_monday((p_changes->>'week')::date);
      IF v_week NOT BETWEEN v_today - 730 AND v_today + 730 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'week', 'message', 'Sprint must be a real week within two years.'));
      v_week := NULL;
    END;
  END IF;
  IF jsonb_array_length(v_fixes) > 0 THEN
    RAISE EXCEPTION '%', 'invalid_card: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_fixes) f)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('fixes', v_fixes)::text;
  END IF;

  n.title := cl->>'title'; n.instructions := cl->>'instructions'; n.done_means := cl->>'done_means';
  n.anchor_kind := cl->>'anchor_kind'; n.anchor_id := (cl->>'anchor_id')::uuid;
  n.due_on := (cl->>'due_on')::date; n.due_source := cl->>'due_source'; n.plan := cl->'plan';
  n.status := v_status; n.person_reason := v_reason;
  IF v_status = 'doing' AND c.status <> 'doing' THEN n.started_at := COALESCE(c.started_at, clock_timestamp()); n.working_by := v.actor_email; n.working_via := v.via; END IF;
  n.sprint_id := CASE WHEN v_week IS NOT NULL THEN public.ops_sprint_ensure(v_week)
                      WHEN n.due_on IS DISTINCT FROM c.due_on THEN public.ops_sprint_for(n.due_on, v_today) ELSE c.sprint_id END;
  IF c.kind = 'promo' AND v_anchor_changed AND c.override_at IS NULL THEN
    v_gate := public.ops_promo_gate(cl->'anchor', v_today);
    n.blocked := (v_gate->>'blocked')::boolean;
    n.blocked_kind := CASE WHEN n.blocked THEN v_gate->>'kind' END;
    n.blocked_reason := CASE WHEN n.blocked THEN v_gate->>'reason' END;
  END IF;

  IF ROW(n.title, n.instructions, n.done_means, n.due_on, n.sprint_id, n.anchor_kind, n.anchor_id, n.result)
     IS DISTINCT FROM ROW(c.title, c.instructions, c.done_means, c.due_on, c.sprint_id, c.anchor_kind, c.anchor_id, c.result) THEN
    v_cats := v_cats || 'updated'::text;
  END IF;
  IF n.plan IS DISTINCT FROM c.plan THEN v_cats := v_cats || 'plan'::text; END IF;
  IF ROW(n.status, n.person_reason) IS DISTINCT FROM ROW(c.status, c.person_reason) THEN v_cats := v_cats || 'status'::text; END IF;
  IF ROW(n.blocked, n.blocked_kind, n.blocked_reason) IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason) THEN
    v_cats := v_cats || CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END;
  END IF;

  UPDATE public.ops_work_cards SET title = n.title, instructions = n.instructions, done_means = n.done_means,
    status = n.status, person_reason = n.person_reason, blocked = n.blocked, blocked_kind = n.blocked_kind, blocked_reason = n.blocked_reason,
    anchor_kind = n.anchor_kind, anchor_id = n.anchor_id, due_on = n.due_on, due_source = n.due_source, sprint_id = n.sprint_id,
    plan = n.plan, result = n.result, started_at = n.started_at, working_by = n.working_by, working_via = n.working_via
   WHERE id = c.id;
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  v_people := public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
  IF (v_people->>'changed')::boolean THEN v_cats := v_cats || 'people'::text; END IF;
  v_links_changed := public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
  IF v_links_changed THEN v_cats := v_cats || 'links'::text; END IF;

  IF cardinality(v_cats) = 0 THEN
    SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = c.id;
    v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', NULL, 'changed', false);
    PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
    RETURN v_out;
  END IF;
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_action := CASE WHEN cardinality(v_cats) = 1 THEN v_cats[1] ELSE 'updated' END;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, v_action, CASE WHEN v_back THEN v_back_reason END, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  -- "Gia, Hal": the people taken off the card, by name, for the agent log.
  -- A name another teammate shares carries the address: "Gia <gia@...>".
  SELECT string_agg(public.ops_name(x.email)
           || CASE WHEN EXISTS (SELECT 1 FROM public.admin_team_directory() d
                                 WHERE d.status = 'active' AND d.email <> x.email
                                   AND lower(public.crm_display_name(d.email)) = lower(public.ops_name(x.email)))
                   THEN ' <' || x.email || '>' ELSE '' END, ', ' ORDER BY x.ord) INTO v_removed_words
    FROM jsonb_array_elements_text(COALESCE(v_people->'removed', '[]'::jsonb)) WITH ORDINALITY AS x(email, ord);
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_owners')), v.actor_email,
    format('%s added you as owner: %s', v_who, n.title));
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_watchers')), v.actor_email,
    format('%s added you as watcher: %s', v_who, n.title));
  -- An agent that takes someone off a card tells them: who, which agent, and
  -- the card (the notice links to it). Guardrail, not a bottleneck.
  IF v.via IN ('claude', 'codex') THEN
    PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'removed')), v.actor_email,
      format('%s took you off this card: %s', v_who, n.title));
  END IF;
  IF n.status = 'person' AND c.status <> 'person' THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s: %s needs a person (%s)', v_who, n.title, CASE n.person_reason WHEN 'send' THEN 'send a message' WHEN 'spend' THEN 'spend money' WHEN 'publish' THEN 'publish an event' ELSE 'other' END));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
      format('Card %s needs a person: %s', n.number, n.title), jsonb_build_object('reason', n.person_reason));
  ELSIF v_back THEN
    -- Wave 2: told and logged when a card stops needing a person.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s moved %s back to %s from Needs a person%s', v_who, n.title, CASE n.status WHEN 'doing' THEN 'Doing' ELSE 'To do' END,
        COALESCE(': ' || v_back_reason, '')));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'info', c.id, 'work_card', c.id,
      format('Card %s no longer needs a person%s', n.number, COALESCE(': ' || v_back_reason, '.')),
      jsonb_build_object('changed', to_jsonb(v_cats), 'from', 'person', 'to', n.status, 'reason', v_back_reason));
  ELSIF v.via IS NOT NULL THEN
    PERFORM public.ops_log_write(v.actor_email, v.via,
      CASE v_action WHEN 'plan' THEN 'step' WHEN 'blocked' THEN 'blocked' WHEN 'unblocked' THEN 'unblocked' ELSE 'updated' END, 'ok', c.id, 'work_card', c.id,
      CASE WHEN v_action = 'plan' THEN format('Plan on Card %s: %s of %s steps done.', n.number,
             (SELECT count(*) FROM jsonb_array_elements(n.plan) s WHERE s->>'status' = 'done'), jsonb_array_length(n.plan))
           WHEN v_action = 'blocked' THEN format('Card %s blocked: %s', n.number, n.blocked_reason)
           -- #3980 rework 2: a removal says who was taken off, not "Updated".
           WHEN v_action = 'people' AND v_removed_words IS NOT NULL
                AND jsonb_array_length(v_people->'new_owners') = 0 AND jsonb_array_length(v_people->'new_watchers') = 0
             THEN format('Took %s off Card %s: %s', v_removed_words, n.number, n.title)
           WHEN v_removed_words IS NOT NULL THEN format('Updated Card %s: %s. Took %s off it.', n.number, n.title, v_removed_words)
           ELSE format('Updated Card %s: %s', n.number, n.title) END, jsonb_build_object('changed', to_jsonb(v_cats)));
  END IF;
  v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'invalid_card: An open card already has this title. Update that card instead.' USING ERRCODE = '22023';
END;
$$;

-- ops_reconcile: unchanged except the Wave 2 steps for expected events.
CREATE OR REPLACE FUNCTION public.ops_reconcile() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE r record; v_expired integer := 0; v_purged integer := 0; v_carried integer := 0; v_now timestamptz := clock_timestamp();
        v_mon date := public.ops_monday((clock_timestamp() AT TIME ZONE 'UTC')::date); v_cur uuid; v_n integer; c public.ops_work_cards;
        -- Wave 2: expected events
        v_exp public.ops_expected_events; v_ev uuid; v_today date := public.ops_today(NULL); v_fulfilled integer := 0; v_moved integer := 0; v_m integer;
BEGIN
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
  -- Wave 2: an open expected event whose host's brand now has a public event
  -- within 3 days of the expected date is linked to it, and its cards move.
  FOR v_exp IN SELECT * FROM public.ops_expected_events z WHERE z.status = 'open' ORDER BY z.expected_on, z.id LOOP
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
  RETURN jsonb_build_object('claims_expired', v_expired, 'request_keys_purged', v_purged, 'cards_carried', v_carried,
                            'expected_fulfilled', v_fulfilled, 'cards_re_anchored', v_moved);
END;
$$;

-- ops_agent_call: unchanged except list_calendar, runway_report and set_expected_event now answer.
CREATE OR REPLACE FUNCTION public.ops_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET statement_timeout = '25s'
AS $$
DECLARE
  c_tools constant text[] := ARRAY['read_log','claim','release','plan_work','add_work','start_work','update_work','close_work',
                                   'push_back','list_work','my_work','list_calendar','runway_report','set_expected_event'];
  c_writes constant text[] := ARRAY['claim','release','add_work','start_work','update_work','close_work','push_back','set_expected_event'];
  c_rules constant jsonb := $rules$[
    "Before any work, call read_log for the records you will touch and check the open claims.",
    "Claim the card and every record you will change or message with claim. A claim ends after 30 minutes without an update, so post each step with update_work.",
    "Write the plan on the card: each step names the connector tool that does it, or person when no tool can.",
    "After each step, read the record back and mark the step done only if the change is really there.",
    "Never report a step done that you could not do. Leave it to a person with exact instructions.",
    "Close a card only with close_work and proof that names what you read back. If it was already done, use push_back with already_done and the proof; if it should not be done, push_back with declined and the reason.",
    "You never send, spend money or publish. Set the card to Needs a person with the reason and stop.",
    "A message to someone Mingla messaged in the last 3 days is refused. Tell your person; only they can allow one more.",
    "close_work and push_back release your claims. Release any other claim with release when you stop."
  ]$rules$::jsonb;
  v_auth jsonb; v_key uuid; v_owner text; v_uid uuid; v_agent text; v_me jsonb; v_args jsonb;
  v_started timestamptz := clock_timestamp(); v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_lim jsonb := public.team_agent_limits(); v_n bigint; v_oldest timestamptz; v_retry integer; v_call uuid; v_tool text;
  v_token text; v_words text; v_match text[]; v_lock_before text; v_ok boolean := false; v_result jsonb; v_summary jsonb := '{}'::jsonb;
  v_items integer := 0; v_want integer := 0; v_q jsonb; v_date date; v_utc date := (now() AT TIME ZONE 'UTC')::date;
  v_changes jsonb; v_plan jsonb; v_found boolean; v_id uuid; v_rev bigint; v_note jsonb; v_rk text;
  -- Wave 2: calendar layers by the name an agent asks for
  c_layers constant jsonb := '{"live":"events","expected":"expected","deadlines":"deadlines","promotions":"promotions","content":"content"}'::jsonb;
BEGIN
  v_auth := public.team_agent_resolve(p_key_hash);
  IF v_auth->>'auth' IS DISTINCT FROM 'ok' THEN RETURN '{"auth":"invalid"}'::jsonb; END IF;
  v_key := (v_auth->>'key_id')::uuid; v_owner := v_auth->>'owner_email'; v_uid := (v_auth->>'uid')::uuid;
  v_agent := v_auth->>'agent'; v_me := jsonb_build_object('role', v_auth->>'role', 'agent', v_agent);
  v_args := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_tool := CASE WHEN p_tool = ANY (c_tools) THEN p_tool ELSE 'unknown' END;

  v_lock_before := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', (v_lim->>'key_wait_ms') || 'ms', true);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_limit:' || v_key::text, 0));
    PERFORM set_config('lock_timeout', v_lock_before, true);
  EXCEPTION WHEN lock_not_available THEN
    PERFORM set_config('lock_timeout', v_lock_before, true);
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
      VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started, 0, 'limited');
    RETURN jsonb_build_object('limited', jsonb_build_object('retry_after_s', 2, 'token', 'busy',
      'message', 'Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.'), 'me', v_me);
  END;
  SELECT count(*), min(c.started_at) INTO v_n, v_oldest FROM public.team_agent_calls c
   WHERE c.key_id = v_key AND c.started_at > v_started - interval '60 seconds' AND c.outcome <> 'limited';
  IF v_n >= (v_lim->>'requests_per_minute')::integer THEN
    v_retry := GREATEST(1, LEAST(60, ceil(60 - extract(epoch FROM (v_started - v_oldest)))::integer));
    v_token := 'rate_limited';
    v_words := format('Your agent has made a lot of requests in the last minute. Wait %s seconds, then carry on. Nothing was lost.', v_retry);
  ELSE
    SELECT count(*) INTO v_n FROM public.team_agent_calls c
     WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited' AND c.tool NOT LIKE 'mcp:%';
    IF v_n >= (v_lim->>'tool_calls_per_day')::integer THEN
      v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
      v_token := 'daily_limit';
      v_words := format('Your agent reached today''s limit of %s requests. It resets at midnight UTC. Ask the owner if you need more.', v_lim->>'tool_calls_per_day');
    ELSIF v_tool = ANY (c_writes) THEN
      SELECT COALESCE(sum(c.items), 0) INTO v_n FROM public.team_agent_calls c
       WHERE c.key_id = v_key AND c.started_at >= v_day AND c.outcome <> 'limited';
      v_want := CASE WHEN v_tool = 'add_work' AND jsonb_typeof(v_args->'cards') = 'array' THEN jsonb_array_length(v_args->'cards') ELSE 1 END;
      IF v_n + v_want > (v_lim->>'records_written_per_day')::integer THEN
        v_retry := GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day' - v_started)))::integer);
        v_token := 'daily_limit';
        v_words := 'This request would pass your daily write limit. Send fewer cards, or wait until midnight UTC.';
      END IF;
    END IF;
  END IF;
  IF v_token IS NOT NULL THEN
    INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at, duration_ms, outcome)
      VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started, 0, 'limited');
    RETURN jsonb_build_object('limited', jsonb_build_object('retry_after_s', v_retry, 'token', v_token, 'message', v_words), 'me', v_me);
  END IF;

  -- The request row. From here on, crm_ctx() answers "via" this agent for
  -- this person, in this transaction only.
  INSERT INTO public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
    VALUES (v_key, v_owner, v_uid, v_agent, v_tool, pg_current_xact_id(), v_started) RETURNING id INTO v_call;
  UPDATE public.team_agent_keys SET last_used_at = v_started,
         last_used_client = NULLIF(left(regexp_replace(COALESCE(p_client, ''), '[[:cntrl:]]', '', 'g'), 120), '')
   WHERE id = v_key AND (last_used_at IS NULL OR last_used_at < v_started - interval '60 seconds');

  BEGIN
    PERFORM 1 FROM public.crm_ctx();
    IF v_tool IN ('add_work', 'set_expected_event') OR (v_tool = 'update_work' AND v_args ? 'note') THEN
      IF jsonb_typeof(v_args->'request_key') IS DISTINCT FROM 'string' OR (v_args->>'request_key') !~ '^[A-Za-z0-9_-]{8,70}$' THEN
        RAISE EXCEPTION 'request_key_required: Send a request_key (8 to 70 letters, digits, - or _) with this request, and the same one if you repeat it, so a repeat changes nothing.' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_rk := v_args->>'request_key';
    -- "Today": the date the request names (within a day of UTC), else today
    -- in the zone the key remembers, else UTC.
    IF v_tool IN ('list_work', 'my_work', 'list_calendar', 'runway_report') THEN
      BEGIN
        v_date := (clock_timestamp() AT TIME ZONE COALESCE(v_auth->>'time_zone', 'UTC'))::date;
      EXCEPTION WHEN others THEN v_date := v_utc;
      END;
      IF v_args ? 'today' AND jsonb_typeof(v_args->'today') <> 'null' THEN
        BEGIN
          IF jsonb_typeof(v_args->'today') <> 'string' OR (v_args->>'today') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
          v_date := (v_args->>'today')::date;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'invalid_arguments: "today" is the wrong kind. Send your person''s own date, such as 2026-10-13.' USING ERRCODE = '22023';
        END;
        IF v_date NOT BETWEEN v_utc - 1 AND v_utc + 1 THEN
          RAISE EXCEPTION 'invalid_arguments: "today" must be your person''s own date today (within a day of the date in UTC), or leave it out.' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    CASE v_tool
      WHEN 'read_log' THEN
        v_q := jsonb_strip_nulls(jsonb_build_object(
          'who', CASE WHEN jsonb_typeof(v_args->'mine') = 'boolean' AND (v_args->>'mine')::boolean THEN 'mine' END,
          'card_id', v_args->'card_id',
          'target_kind', COALESCE(v_args->'target_kind', CASE WHEN v_args ? 'record_id' THEN '"crm_record"'::jsonb END),
          'target_id', v_args->'record_id', 'since', v_args->'since', 'limit', v_args->'limit'));
        v_result := public.ops_log_list(v_q) || jsonb_build_object('rules', c_rules);
        v_summary := jsonb_build_object('entries', jsonb_array_length(v_result->'entries'));
      WHEN 'claim' THEN
        v_result := public.ops_claim((v_args->>'card_id')::uuid, v_args->'targets');
        v_items := jsonb_array_length(v_result->'claims');
        v_summary := jsonb_build_object('claimed', jsonb_array_length(v_result->'claims'), 'held', jsonb_array_length(v_result->'held'));
      WHEN 'release' THEN
        v_result := public.ops_release((v_args->>'card_id')::uuid,
          CASE WHEN jsonb_typeof(v_args->'claim_ids') = 'array' THEN ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(v_args->'claim_ids') x) END);
        v_items := (v_result->>'released')::integer;
        v_summary := jsonb_build_object('released', (v_result->>'released')::integer);
      WHEN 'add_work' THEN
        v_result := public.ops_work_add(v_args->'cards', v_rk);
        v_items := COALESCE((v_result->>'added')::integer, 0);
        v_summary := jsonb_build_object('added', COALESCE((v_result->>'added')::integer, 0), 'refused', COALESCE((v_result->>'refused')::integer, 0),
                                        'duplicate', COALESCE((v_result->>'duplicate')::integer, 0));
      WHEN 'start_work' THEN
        v_result := public.ops_work_start((v_args->>'id')::uuid, (v_args->>'expected_revision')::bigint);
        v_items := 1; v_summary := '{"started":1}'::jsonb;
      WHEN 'update_work' THEN
        v_id := (v_args->>'id')::uuid; v_rev := (v_args->>'expected_revision')::bigint;
        v_changes := CASE WHEN jsonb_typeof(v_args->'changes') = 'object' THEN v_args->'changes' ELSE '{}'::jsonb END;
        IF jsonb_typeof(v_args->'step') = 'object' THEN
          SELECT w.plan INTO v_plan FROM public.ops_work_cards w WHERE w.id = v_id AND w.archived_at IS NULL;
          IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is no longer here.' USING ERRCODE = 'P0002'; END IF;
          v_plan := COALESCE(v_changes->'plan', v_plan);
          SELECT COALESCE(jsonb_agg(CASE WHEN s->>'n' = v_args->'step'->>'n'
                   THEN s || jsonb_strip_nulls(jsonb_build_object('status', v_args->'step'->'status', 'result', v_args->'step'->'result'))
                          || jsonb_build_object('checked_at', clock_timestamp())
                   ELSE s END ORDER BY (s->>'n')::integer), '[]'::jsonb),
                 COALESCE(bool_or(s->>'n' = v_args->'step'->>'n'), false)
            INTO v_plan, v_found FROM jsonb_array_elements(v_plan) s;
          IF NOT v_found THEN
            RAISE EXCEPTION '%', format('invalid_arguments: There is no step %s on this card. Read the plan with list_work.', left(COALESCE(v_args->'step'->>'n', ''), 4)) USING ERRCODE = '22023';
          END IF;
          v_changes := v_changes || jsonb_build_object('plan', v_plan);
        END IF;
        IF v_changes = '{}'::jsonb AND NOT (v_args ? 'note') THEN
          RAISE EXCEPTION 'invalid_arguments: Send changes, a step or a note.' USING ERRCODE = '22023';
        END IF;
        IF v_changes <> '{}'::jsonb THEN
          v_result := public.ops_work_update(v_id, v_changes, v_rev, CASE WHEN v_rk IS NOT NULL THEN v_rk || '_u' END);
        END IF;
        IF v_args ? 'note' THEN
          v_note := public.ops_work_note(v_id, v_args->>'note', ARRAY[]::text[], v_rk || '_n');
          v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('note', v_note);
        END IF;
        v_items := 1; v_summary := '{"updated":1}'::jsonb;
      WHEN 'close_work' THEN
        v_result := public.ops_work_close((v_args->>'id')::uuid, v_args->'proof', v_args->>'result', (v_args->>'expected_revision')::bigint);
        v_items := 1; v_summary := '{"closed":1}'::jsonb;
      WHEN 'push_back' THEN
        v_result := public.ops_work_push_back((v_args->>'id')::uuid, v_args->>'kind', v_args->>'reason',
          COALESCE(v_args->'proof', '[]'::jsonb), (v_args->>'expected_revision')::bigint);
        v_items := 1; v_summary := '{"pushed_back":1}'::jsonb;
      WHEN 'list_work' THEN
        v_result := public.ops_work_list((v_args - 'today') || jsonb_build_object('today', v_date));
        v_summary := jsonb_build_object('cards', jsonb_array_length(v_result->'cards'));
      WHEN 'my_work' THEN
        v_result := jsonb_build_object('today', v_date,
          'mine', public.ops_work_list(jsonb_build_object('who', 'mine', 'today', v_date, 'done_days', 0))->'cards',
          'watching', public.ops_work_list(jsonb_build_object('who', 'watching', 'today', v_date, 'done_days', 0))->'cards',
          'claims', public.ops_log_list('{"who":"mine","limit":1}'::jsonb)->'claims');
        v_summary := jsonb_build_object('mine', jsonb_array_length(v_result->'mine'), 'watching', jsonb_array_length(v_result->'watching'));
      WHEN 'list_calendar' THEN
        IF jsonb_typeof(v_args->'from') IS DISTINCT FROM 'string' OR jsonb_typeof(v_args->'to') IS DISTINCT FROM 'string'
           OR (v_args->>'from') !~ '^\d{4}-\d{2}-\d{2}$' OR (v_args->>'to') !~ '^\d{4}-\d{2}-\d{2}$' THEN
          RAISE EXCEPTION 'invalid_arguments: Send from and to as dates, such as 2026-11-01, at most 100 days apart.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_calendar((v_args->>'from')::date, (v_args->>'to')::date, v_date);
        IF jsonb_typeof(v_args->'layers') = 'array' THEN
          v_result := v_result - ARRAY(SELECT m.value FROM jsonb_each_text(c_layers) m
                                        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_args->'layers') l WHERE l = m.key));
        END IF;
        v_summary := jsonb_build_object('events', jsonb_array_length(COALESCE(v_result->'events', '[]'::jsonb)),
                                        'expected', jsonb_array_length(COALESCE(v_result->'expected', '[]'::jsonb)));
      WHEN 'runway_report' THEN
        IF (v_args ? 'from' AND (jsonb_typeof(v_args->'from') <> 'string' OR (v_args->>'from') !~ '^\d{4}-\d{2}-\d{2}$'))
           OR (v_args ? 'to' AND (jsonb_typeof(v_args->'to') <> 'string' OR (v_args->>'to') !~ '^\d{4}-\d{2}-\d{2}$')) THEN
          RAISE EXCEPTION 'invalid_arguments: Send from and to as dates, such as 2026-11-01, or leave them out for the next 90 days.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_runway_report((v_args->>'from')::date, (v_args->>'to')::date, v_date);
        v_summary := jsonb_build_object('rows', jsonb_array_length(v_result->'rows'), 'at_risk', jsonb_array_length(v_result->'at_risk'));
      WHEN 'set_expected_event' THEN
        v_result := public.ops_expected_event_set(v_args - 'request_key', v_rk);
        v_items := 1;
        v_summary := jsonb_build_object('expected', v_result->>'status');
      -- The launch kit tool answers from the Wave 3 migration of #3980, which replaces this gateway in the same release.
      WHEN 'plan_work' THEN RAISE EXCEPTION 'not_ready: This tool is not ready yet. Use the other work tools for now.' USING ERRCODE = '22023';
      ELSE
        RAISE EXCEPTION 'unknown_tool: That tool does not exist. Call tools/list to see what is available.' USING ERRCODE = '22023';
    END CASE;
    v_ok := true;
  EXCEPTION WHEN others THEN
    v_items := 0; v_summary := '{}'::jsonb;
    v_match := regexp_match(SQLERRM, '^([a-z_]+): (.+)$');
    v_token := CASE WHEN v_match IS NULL THEN NULL ELSE v_match[1] END;
    v_words := CASE WHEN v_token IS NULL THEN 'Something went wrong on our side. Nothing was saved. Send the same request again.' ELSE v_match[2] END;
    IF v_token IS NULL AND SQLSTATE IN ('22P02', '22007', '22008', '22003') THEN
      v_token := 'invalid_arguments';
      v_words := 'An id, a date or a number has the wrong shape. Read it again from Mingla and send it as it was given.';
    END IF;
    IF v_token IS NULL THEN
      v_token := 'server_error';
      RAISE WARNING 'ops_agent_call: tool % ended with an unexpected error (% %)', v_tool, SQLSTATE, SQLERRM;
    END IF;
  END;
  UPDATE public.team_agent_calls SET outcome = CASE WHEN v_ok THEN 'ok' ELSE left(v_token, 60) END, items = v_items, summary = v_summary,
         duration_ms = LEAST(2147483647, GREATEST(0, round(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)))::integer
   WHERE id = v_call;
  IF v_ok THEN RETURN jsonb_build_object('ok', true, 'result', v_result, 'me', v_me); END IF;
  RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('token', v_token, 'message', v_words), 'me', v_me);
END;
$$;
COMMENT ON FUNCTION public.ops_agent_call(text,text,jsonb,text) IS
  'Issue #3980. Fixed fourteen-tool work, log and calendar gateway. No send, spend, publish, archive or delete tool.';

-- ---------------------------------------------------------------------------
-- 4. Grants. Internal helpers: service_role only. Client functions:
-- authenticated (each gates through crm_ctx) and service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ops_window_check(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_events_in_window(date, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_host_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_anchor_card_counts(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_card_lite(public.ops_work_cards) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_expected_json(public.ops_expected_events, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_calendar_event_json(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_promotions(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_reanchor_expected(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_expected_fulfil(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_calendar(date, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_runway_report(date, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_anchor_detail(text, uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_host_on_mingla(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_expected_event_set(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_window_check(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_events_in_window(date, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_host_json(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_anchor_card_counts(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_card_lite(public.ops_work_cards) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_expected_json(public.ops_expected_events, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_calendar_event_json(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_promotions(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_reanchor_expected(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_expected_fulfil(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_calendar(date, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_runway_report(date, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_anchor_detail(text, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_host_on_mingla(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_expected_event_set(jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.ops_calendar(date, date, date) IS
  'Issue #3980. The team''s read-only Calendar: events public on Mingla and draft listings of brands linked to a host card, with runway; expected events, go-live deadlines, promotions and content. Never addresses, themes, contacts, prices, orders or buyers.';
COMMENT ON FUNCTION public.ops_promotions(date, date) IS
  'Issue #3980. The promotions layer and the one seam where ads and giveaway records will join. Reads no ad table.';

-- ---------------------------------------------------------------------------
-- 5. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $w2check3980$
DECLARE
  c_client constant text[] := ARRAY[
    'ops_config(date)','ops_work_list(jsonb)','ops_work_get(uuid,date)','ops_work_add(jsonb,text)',
    'ops_work_update(uuid,jsonb,bigint,text)','ops_work_start(uuid,bigint)','ops_work_close(uuid,jsonb,text,bigint)',
    'ops_work_push_back(uuid,text,text,jsonb,bigint)','ops_work_reopen(uuid,text,bigint)','ops_work_note(uuid,text,text[],text)',
    'ops_work_person_action(uuid,text,text,bigint)','ops_work_undo(uuid)','ops_work_archive(uuid,text)','ops_my_counts(date)',
    'ops_review_list(date)','ops_link_search(text,text)','ops_record_signals(uuid)','ops_contact_override(uuid,text)',
    'ops_log_list(jsonb)','ops_claim(uuid,jsonb)','ops_release(uuid,uuid[])','ops_sprint_set_goal(date,text)',
    'ops_calendar(date,date,date)','ops_runway_report(date,date,date)','ops_anchor_detail(text,uuid,date)',
    'ops_host_on_mingla(uuid,date)','ops_expected_event_set(jsonb,text)'];
  c_new constant text[] := ARRAY['ops_window_check','ops_events_in_window','ops_host_json','ops_anchor_card_counts','ops_card_lite',
    'ops_expected_json','ops_calendar_event_json','ops_promotions','ops_reanchor_expected','ops_expected_fulfil','ops_calendar',
    'ops_runway_report','ops_anchor_detail','ops_host_on_mingla','ops_expected_event_set'];
  r record; v_cfg text[]; v_names text; v_src text;
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'ops\_%' LOOP
    IF r.proname = 'ops_agent_call' THEN
      IF NOT r.prosecdef OR NOT ('search_path=""' = ANY (r.proconfig)) THEN
        RAISE EXCEPTION 'issue 3980 wave 2 self-check: the gateway attributes changed'; END IF;
      IF has_function_privilege('authenticated', r.oid, 'EXECUTE') OR has_function_privilege('anon', r.oid, 'EXECUTE')
         OR NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'issue 3980 wave 2 self-check: the gateway is not service_role only'; END IF;
      CONTINUE;
    END IF;
    SELECT array_agg(x) INTO v_cfg FROM unnest(r.proconfig) x WHERE x LIKE 'search_path=%';
    IF v_cfg IS NULL OR v_cfg[1] !~ ', pg_temp$' THEN
      RAISE EXCEPTION 'issue 3980 wave 2 self-check: % does not pin a search_path ending in pg_temp', r.sig; END IF;
    IF NOT r.prosecdef AND r.provolatile <> 'i' AND r.proname <> 'ops_agent_log_append_only' THEN
      RAISE EXCEPTION 'issue 3980 wave 2 self-check: % is not SECURITY DEFINER', r.sig; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR (SELECT bool_or(a.grantee = 0) FROM pg_catalog.pg_proc p2, aclexplode(COALESCE(p2.proacl, acldefault('f', p2.proowner))) a WHERE p2.oid = r.oid) THEN
      RAISE EXCEPTION 'issue 3980 wave 2 self-check: anon or PUBLIC can run %', r.sig; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') <> (replace(r.sig, 'public.', '') = ANY (c_client)) THEN
      RAISE EXCEPTION 'issue 3980 wave 2 self-check: client grant wrong for %', r.sig; END IF;
    IF r.proname = ANY (c_new) AND r.prosrc ~* '(location_text|location_geo|organiser_contact|theme|public\.ad_|public\.orders|price)' THEN
      RAISE EXCEPTION 'issue 3980 wave 2 self-check: % reads more of an event than the calendar may show', r.sig; END IF;
  END LOOP;
  IF (SELECT count(*) FROM unnest(c_client) s WHERE has_function_privilege('authenticated', 'public.' || s, 'EXECUTE')) <> cardinality(c_client) THEN
    RAISE EXCEPTION 'issue 3980 wave 2 self-check: a client function is missing'; END IF;
  IF md5(pg_get_functiondef('public.is_admin_user()'::regprocedure)) IS DISTINCT FROM (SELECT g.is_admin_hash FROM issue3980_w2_guard g)
     OR md5(pg_get_functiondef('public.admin_list_offerings'::regproc)) IS DISTINCT FROM (SELECT g.offerings_hash FROM issue3980_w2_guard g) THEN
    RAISE EXCEPTION 'issue 3980 wave 2 self-check: an untouchable function changed'; END IF;
  v_src := (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.ops_agent_call(text,text,jsonb,text)'::regprocedure);
  SELECT string_agg(DISTINCT m[1], ',' ORDER BY m[1]) INTO v_names FROM regexp_matches(v_src, 'WHEN ''([a-z_]+)''', 'g') m;
  IF v_names IS DISTINCT FROM 'add_work,claim,close_work,list_calendar,list_work,my_work,plan_work,push_back,read_log,release,runway_report,set_expected_event,start_work,update_work' THEN
    RAISE EXCEPTION 'issue 3980 wave 2 self-check: the gateway tool list changed (%)', v_names; END IF;
  IF v_src ~ 'WHEN ''(list_calendar|runway_report|set_expected_event)'' THEN RAISE' THEN
    RAISE EXCEPTION 'issue 3980 wave 2 self-check: a calendar tool still answers not ready'; END IF;
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.ops_work_update(uuid,jsonb,bigint,text)'::regprocedure) !~ 'reason_required' THEN
    RAISE EXCEPTION 'issue 3980 wave 2 self-check: leaving Needs a person does not ask an agent why'; END IF;
END;
$w2check3980$;

COMMIT;

NOTIFY pgrst, 'reload schema';
