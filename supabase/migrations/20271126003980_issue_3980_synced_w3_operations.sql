-- Issue #3980, synced program, Wave 3: the operations redesign.
--
-- What this adds:
--   * Four plain states for every dated thing (Ready to promote, Promote
--     now, Too late for promo, Not live yet or Draft, not live), plus
--     Happened for the past. One function decides it; the Calendar, the
--     host board, the host card and the event panel all read it.
--   * Repeating hosts: an expected event can repeat every week or month.
--     Mingla keeps its next 4 dates on the Calendar and matches each to a
--     public event of the host's brand within 3 days. A venue's promo moment
--     is an expected event of type promo_moment and behaves like an event.
--   * The next dated thing of each host, and "needs a next event" for hosts
--     past Replied with nothing coming up.
--   * Needs attention: hosts and cards with no owner, overdue cards, missing
--     information, stuck cards, hosts with no next event and engineering
--     follow-through. Every count is the length of its own list.
--   * What just happened: the automatic changes on an event or a host in the
--     last three days, in plain words.
--   * Automatic steps, made from the timeline: a go-live card for every
--     dated thing that is not public yet, a giveaway and ads card for every
--     event public early enough, a recap card after an event, an "ask for
--     their first or next event" card, and one rolling card per repeating
--     host. They re-date when the event moves and close when it is
--     cancelled. They are made only while the owner has switched them on
--     (ops_settings.auto_steps, off by default).
--   * Brand auto-link: a brand made on Mingla after the owner switched brand
--     cards on is linked to the one host card that has its email or phone,
--     or gets a new host card; two or more matching cards make a card for a
--     person to pick. Off by default (ops_settings.brand_auto_cards). This is
--     the one new writer of crm_records and crm_activity (ops_brand_autolink).
--   * Engineering follow-through cards fire only for pull requests merged,
--     commits pushed and issues moved to Done at or after the time the owner
--     switched automatic steps on (ops_settings.follow_through_since). Issues
--     linked from before only show their status.
--   * The Needs you page lists the "Recently shipped" wording cards on their
--     own tab for the owner and admins.
--
-- Replaced functions keep their signatures, attributes and grants unless a
-- default argument is added (named); each names the migration it was
-- copied from.
--
-- NOT modified: is_admin_user(), team_agent_call, crm_ctx, admin_team_list
-- and the other admin_team_* functions, any issue_3720_* function,
-- community_upsert_roadmap_card, crm_apply_brand_link,
-- crm_record_create_core, any ad_ table. Nothing here reaches outside the
-- database.
--
-- ROLLBACK (no down-migration file): roll the admin web client back first,
-- then in one transaction restore each replaced function from the migration
-- named above it, drop the new functions, restore ops_settings_key_check
-- (delete the follow_through_since row first) and drop
-- ops_github_items.done_seen_at. Cards and host cards made while the
-- switches were on stay as history.

BEGIN;

-- A stuck lock aborts the apply instead of hanging.
SET LOCAL lock_timeout = '10s';

-- Remembered for the self-check at the end.
CREATE TEMP TABLE issue3980_sync_w3_guard ON COMMIT DROP AS
SELECT md5(pg_get_functiondef('public.is_admin_user()'::regprocedure)) AS is_admin_hash,
       md5(pg_get_functiondef('public.crm_ctx()'::regprocedure)) AS crm_ctx_hash,
       md5(pg_get_functiondef('public.team_agent_call(text,text,jsonb,text)'::regprocedure)) AS gateway_hash,
       md5(pg_get_functiondef('public.crm_apply_brand_link(uuid)'::regprocedure)) AS brand_link_hash,
       md5(pg_get_functiondef('public.crm_record_create_core(text,jsonb,text,text)'::regprocedure)) AS create_core_hash,
       md5(pg_get_functiondef('public.community_upsert_roadmap_card(uuid,text,text,text,text,text)'::regprocedure)) AS roadmap_hash;

-- ---------------------------------------------------------------------------
-- 1. Changes to existing ops tables.
-- ---------------------------------------------------------------------------

-- X3: the time follow-through cards start counting from. NULL until the owner
-- switches automatic steps on.
ALTER TABLE public.ops_settings DROP CONSTRAINT ops_settings_key_check;
ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_key_check
  CHECK (key IN ('auto_steps','brand_auto_cards','brand_auto_since','marketing_owner','follow_through_since'));
INSERT INTO public.ops_settings (key, value, updated_by)
VALUES ('follow_through_since', 'null'::jsonb, 'system@usemingla.com')
ON CONFLICT (key) DO NOTHING;

-- X3: when the bridge first saw an issue move to Done. NULL when it was
-- already Done the first time Mingla read it (history, never followed up).
ALTER TABLE public.ops_github_items ADD COLUMN done_seen_at timestamptz NULL;

-- ---------------------------------------------------------------------------
-- 2. New internal helpers (service_role only; clients cannot run them).
-- ---------------------------------------------------------------------------

-- "Tue 20 Oct".
CREATE FUNCTION public.ops_day_long(p_date date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$ SELECT to_char(p_date, 'Dy FMDD Mon') $$;

-- The plain state of a dated thing, from its anchor (an event or an
-- expected event as ops_anchor returns it, or the same keys for one date of
-- a repeating series): Happened, Draft, not live / Not live yet, Ready to
-- promote, Promote now, or Too late for promo, with one sentence that says
-- why using the real dates.
CREATE FUNCTION public.ops_plain_state(p_anchor jsonb, p_today date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_start date; v_by date; v_lead integer; v_draft boolean; v_public boolean;
BEGIN
  IF p_anchor IS NULL OR jsonb_typeof(p_anchor) <> 'object' OR p_today IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(p_anchor->>'start_on', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('k', 'nodate', 'name', 'No date yet', 'say', 'It has no date yet. Add the date to see when it must go live.');
  END IF;
  v_start := (p_anchor->>'start_on')::date;
  v_public := COALESCE((p_anchor->>'is_public')::boolean, false);
  v_draft := NOT v_public AND p_anchor->>'kind' = 'event' AND p_anchor->>'status' = 'draft';
  IF v_start < p_today THEN
    RETURN jsonb_build_object('k', 'done', 'name', 'Happened', 'say', 'This happened on ' || public.ops_day_long(v_start) || '.');
  END IF;
  IF NOT v_public THEN
    v_by := v_start - 28;
    IF p_today > v_start - 21 THEN
      RETURN jsonb_build_object('k', 'late', 'name', 'Too late for promo', 'by', v_by,
        'say', CASE WHEN v_draft THEN 'There’s a draft in Mingla Business, but it' ELSE 'It' END
               || ' isn’t live and the 3-week line has passed, so it gets posts only.');
    END IF;
    RETURN jsonb_build_object('k', 'notlive', 'name', CASE WHEN v_draft THEN 'Draft, not live' ELSE 'Not live yet' END, 'by', v_by,
      'say', CASE WHEN v_draft THEN 'The host has a draft in Mingla Business. ' ELSE 'The host promised this. ' END
             || 'Get it live by ' || public.ops_day_long(v_by) || ' for the full promo.');
  END IF;
  v_lead := GREATEST(COALESCE(CASE WHEN COALESCE(p_anchor->'runway'->>'lead_days', '') ~ '^-?\d+$'
                                   THEN (p_anchor->'runway'->>'lead_days')::integer END, 0), 0);
  IF v_lead >= 28 THEN
    RETURN jsonb_build_object('k', 'ready', 'name', 'Ready to promote', 'lead', v_lead,
      'say', format('Went live %s days before it starts, so it gets the full promo: giveaway, creators and ads.', v_lead));
  ELSIF v_lead >= 21 THEN
    RETURN jsonb_build_object('k', 'short', 'name', 'Promote now', 'lead', v_lead,
      'say', format('Went live %s days ahead. Enough for the full promo if it starts this week.', v_lead));
  END IF;
  RETURN jsonb_build_object('k', 'late', 'name', 'Too late for promo', 'lead', v_lead,
    'say', format('Went live only %s days ahead. Under 3 weeks gets posts and shares, no giveaway or ads.', v_lead));
END;
$$;

-- The anchor-shaped object for one date of an expected event (one-off or a
-- date of a repeating series): never public.
CREATE FUNCTION public.ops_expected_anchor(x public.ops_expected_events, p_on date) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('kind', 'expected', 'id', x.id, 'title', x.title, 'event_type', x.event_type, 'is_public', false,
    'status', x.status, 'start_on', p_on, 'record_id', x.record_id, 'repeats', x.repeats)
$$;

-- R5: the dates of an expected event. One-off: its date. Repeating: the next
-- p_count dates on or after p_from, every 7 days or every month. Each date is
-- matched to a public event of the host's brand within 3 days, and is then
-- shown as that event.
CREATE FUNCTION public.ops_expected_occurrences(p_exp public.ops_expected_events, p_from date, p_count integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_brand uuid; v_out jsonb := '[]'::jsonb; v_k integer; v_d date; v_n integer := 0; v_ev uuid; v_guard integer := 0;
  v_count integer := LEAST(GREATEST(COALESCE(p_count, 4), 1), 12); v_from date := COALESCE(p_from, p_exp.expected_on);
BEGIN
  IF p_exp.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT c.brand_id INTO v_brand FROM public.crm_records c WHERE c.id = p_exp.record_id AND c.deleted_at IS NULL;
  IF p_exp.repeats = 'week' THEN
    v_k := GREATEST(0, ceil((v_from - p_exp.expected_on) / 7.0)::integer);
  ELSIF p_exp.repeats = 'month' THEN
    v_k := GREATEST(0, ((extract(year FROM v_from)::integer - extract(year FROM p_exp.expected_on)::integer) * 12
                         + extract(month FROM v_from)::integer - extract(month FROM p_exp.expected_on)::integer) - 1);
  END IF;
  LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_guard > 40;
    IF p_exp.repeats = 'week' THEN v_d := p_exp.expected_on + 7 * v_k;
    ELSIF p_exp.repeats = 'month' THEN v_d := (p_exp.expected_on + make_interval(months => v_k))::date;
    ELSE v_d := p_exp.expected_on; END IF;
    IF p_exp.repeats = 'none' OR v_d >= v_from THEN
      v_ev := NULL;
      IF v_brand IS NOT NULL THEN
        SELECT e.id INTO v_ev
          FROM public.events e
          JOIN LATERAL (SELECT public.ops_event_first_start(e.id) AS st) s ON true
         WHERE e.brand_id = v_brand AND e.deleted_at IS NULL AND s.st IS NOT NULL
           AND abs((s.st AT TIME ZONE 'UTC')::date - v_d) <= 3 AND public.ops_event_public(e.id)
         ORDER BY abs((s.st AT TIME ZONE 'UTC')::date - v_d), s.st, e.id
         LIMIT 1;
      END IF;
      v_out := v_out || jsonb_build_array(jsonb_build_object('on', v_d, 'event_id', v_ev, 'live', v_ev IS NOT NULL));
      v_n := v_n + 1;
    END IF;
    EXIT WHEN p_exp.repeats = 'none' OR v_n >= v_count;
    v_k := v_k + 1;
  END LOOP;
  RETURN v_out;
END;
$$;

-- True when a public event of the host's brand stands for a date of one of
-- the host's open repeating series (it is then part of the series' one
-- rolling card, never its own go-live or promo card).
CREATE FUNCTION public.ops_event_in_series(p_record_id uuid, p_event_id uuid, p_today date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ops_expected_events x
     CROSS JOIN LATERAL jsonb_array_elements(public.ops_expected_occurrences(x, p_today - 7, 8)) o
     WHERE x.record_id = p_record_id AND x.status = 'open' AND x.repeats <> 'none'
       AND o->>'event_id' = p_event_id::text)
$$;

-- R1: each host's next dated thing (a public or draft event of its brand,
-- the next open date it promised, or a promo moment), with its plain state,
-- and whether it needs a next event (Replied, Meeting, Onboarded or Live
-- with nothing coming up).
CREATE FUNCTION public.ops_host_next_rows(p_record_ids uuid[], p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record; a jsonb; x public.ops_expected_events; o jsonb; v_next jsonb; v_cand jsonb; v_out jsonb := '[]'::jsonb;
  v_today date := COALESCE(p_today, (now() AT TIME ZONE 'UTC')::date);
BEGIN
  FOR r IN SELECT c.id, c.brand_id, c.stage FROM public.crm_records c
            WHERE c.id = ANY (COALESCE(p_record_ids, ARRAY[]::uuid[])) AND c.pipeline = 'hosts' AND c.deleted_at IS NULL
            ORDER BY c.id LOOP
    v_next := NULL;
    IF r.brand_id IS NOT NULL THEN
      SELECT y.a INTO a
        FROM public.events e
        CROSS JOIN LATERAL (SELECT public.ops_anchor('event', e.id, v_today) AS a) y
       WHERE e.brand_id = r.brand_id AND e.deleted_at IS NULL AND e.status IN ('draft', 'scheduled', 'live')
         AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = e.id
                      AND d.start_at >= ((v_today - 2)::timestamp AT TIME ZONE 'UTC'))
         AND y.a IS NOT NULL AND y.a->>'start_on' IS NOT NULL AND (y.a->>'start_on')::date >= v_today
       ORDER BY (y.a->>'start_on')::date, y.a->>'start_at', e.id
       LIMIT 1;
      IF a IS NOT NULL THEN
        v_next := jsonb_build_object('kind', 'event', 'id', a->'id', 'title', a->'title', 'start_on', a->'start_on',
          'event_type', a->'event_type', 'repeats', false, 'promo_moment', false, 'state', public.ops_plain_state(a, v_today));
      END IF;
    END IF;
    FOR x IN SELECT z.* FROM public.ops_expected_events z WHERE z.record_id = r.id AND z.status = 'open' ORDER BY z.expected_on, z.id LOOP
      SELECT e INTO o FROM jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) e
       WHERE (e->>'on')::date >= v_today AND NOT (e->>'live')::boolean ORDER BY (e->>'on')::date LIMIT 1;
      CONTINUE WHEN o IS NULL;
      IF v_next IS NULL OR (o->>'on')::date < (v_next->>'start_on')::date THEN
        v_cand := public.ops_expected_anchor(x, (o->>'on')::date);
        v_next := jsonb_build_object('kind', 'expected', 'id', x.id, 'title', x.title, 'start_on', o->'on',
          'event_type', x.event_type, 'repeats', x.repeats <> 'none', 'promo_moment', x.event_type = 'promo_moment',
          'state', public.ops_plain_state(v_cand, v_today));
      END IF;
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object('record_id', r.id, 'next', v_next,
      'needs_next', v_next IS NULL AND r.stage IN ('replied', 'meeting', 'onboarded', 'live')));
  END LOOP;
  RETURN v_out;
END;
$$;

-- The six live numbers the Needs attention tab prints under its lists.
CREATE FUNCTION public.ops_live_totals(p_today date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
    'hosts_no_owner', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = c.id)),
    'overdue', count(*) FILTER (WHERE c.due_on < p_today),
    'no_contact', count(*) FILTER (WHERE btrim(COALESCE(c.contact, '')) = ''
                                     AND NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers i WHERE i.record_id = c.id)),
    'no_region', count(*) FILTER (WHERE c.region_id IS NULL),
    'no_icp', count(*) FILTER (WHERE btrim(COALESCE(c.icp, '')) = ''),
    'brands_without_card', (SELECT count(*) FROM public.brands b
                             WHERE b.deleted_at IS NULL
                               AND NOT EXISTS (SELECT 1 FROM public.crm_records h
                                                WHERE h.brand_id = b.id AND h.pipeline = 'hosts' AND h.deleted_at IS NULL)))
  FROM public.crm_records c
  WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.stage <> 'lost'
$$;

-- What a host card is missing, in the words the screens use.
CREATE FUNCTION public.ops_host_missing(c public.crm_records) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN btrim(COALESCE(c.icp, '')) = '' THEN 'type' END,
    CASE WHEN c.region_id IS NULL THEN 'region' END,
    CASE WHEN btrim(COALESCE(c.contact, '')) = ''
              AND NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers i WHERE i.record_id = c.id) THEN 'contact' END], NULL)
$$;

-- ---------------------------------------------------------------------------
-- 3. Automatic steps (R2, R3, R5). Called by ops_reconcile while the owner
-- has automatic steps switched on, and by ops_expected_event_set for one
-- host right after a save. Never by a client.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ops_auto_steps(p_today date, p_record_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c_cap constant integer := 50;
  v_today date := public.ops_today(p_today);
  v_added integer := 0; v_closed integer := 0; v_redated integer := 0; v_deferred integer := 0;
  c public.ops_work_cards; n public.ops_work_cards; a jsonb; st jsonb; x public.ops_expected_events; h record; e record;
  v_res jsonb; v_want jsonb := '[]'::jsonb; w jsonb; v_owners text[]; v_mkt text; v_mkt_owners text[];
  v_start date; v_title text; v_due date; v_before jsonb; v_event uuid; v_next jsonb; v_first date; v_occ jsonb;
  v_hostnext jsonb := '{}'::jsonb; v_words text; v_past boolean; v_new_title text; v_rid uuid; v_rtitle text; v_ron date;
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
            ORDER BY w0.number LOOP
    BEGIN
      a := public.ops_anchor(c.anchor_kind, c.anchor_id, v_today);
      CONTINUE WHEN a IS NULL OR a->>'start_on' IS NULL;
      v_start := (a->>'start_on')::date;
      v_due := v_start + c.kit_step;
      CONTINUE WHEN v_due IS NOT DISTINCT FROM c.due_on;
      v_before := public.ops_card_snapshot(c.id);
      v_new_title := c.title;
      IF c.auto_key LIKE 'golive:%' THEN
        v_new_title := left(format('Get %s live by %s', left(COALESCE(a->>'title', 'the event'), 120), public.ops_day_words(v_start - 28)), 160);
      END IF;
      UPDATE public.ops_work_cards w0 SET due_on = v_due, title = v_new_title, revision = w0.revision + 1,
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
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.auto_key LIKE 'ask:%' ORDER BY w0.number LOOP
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

  -- 4. A repeating host's rolling card moves on as dates go live.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.auto_key LIKE 'series:%' ORDER BY w0.number LOOP
    BEGIN
      SELECT z.* INTO x FROM public.ops_expected_events z WHERE z.id::text = split_part(c.auto_key, ':', 2) AND z.status = 'open';
      CONTINUE WHEN NOT FOUND;
      SELECT (o->>'on')::date INTO v_first FROM jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
       WHERE NOT (o->>'live')::boolean ORDER BY (o->>'on')::date LIMIT 1;
      CONTINUE WHEN v_first IS NULL OR c.due_on IS NULL OR v_first - 28 <= c.due_on;
      v_due := v_first - 28;
      v_before := public.ops_card_snapshot(c.id);
      UPDATE public.ops_work_cards w0 SET due_on = v_due,
             instructions = format('Repeats every %s. Next date to publish: %s.', x.repeats, public.ops_day_long(v_first)),
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
        ELSIF st->>'k' IN ('ready', 'short')
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
                             AND k.kit_step = -28 AND k.archived_at IS NULL);
      v_title := left(x.title, 120);
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
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'series:' || x.id, 'kind', 'task', 'due', GREATEST(v_first - 28, v_today),
        'anchor', NULL,
        'item', jsonb_build_object(
          'title', left(format('Keep 4 weeks of %s dates live', left(h.name, 120)), 160),
          'instructions', format('Repeats every %s. Next date to publish: %s.', x.repeats, public.ops_day_long(v_first)),
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

-- ---------------------------------------------------------------------------
-- 4. Brand auto-link (R4, D-9). The one new writer of crm_records and
-- crm_activity. Called by ops_reconcile while the owner has brand cards
-- switched on; at most 25 brands a run, only brands made after the switch.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ops_brand_autolink_one(p_brand_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com';
  b record; v_idents jsonb := '[]'::jsonb; v_key text; v_hits jsonb; v_rec public.crm_records; v_kind text; v_res jsonb;
  v_boss text := public.ops_owner_email(); v_names text;
BEGIN
  SELECT br.id, br.name, br.contact_email, br.contact_phone, br.account_id INTO b
    FROM public.brands br WHERE br.id = p_brand_id AND br.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'gone'); END IF;
  IF EXISTS (SELECT 1 FROM public.crm_records h WHERE h.brand_id = b.id AND h.pipeline = 'hosts' AND h.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('status', 'has_card');
  END IF;
  -- The brand's contact email, contact phone and its account's sign-in email.
  FOR v_kind, v_key IN
      SELECT 'email'::text, b.contact_email WHERE btrim(COALESCE(b.contact_email, '')) <> ''
      UNION ALL SELECT 'phone'::text, b.contact_phone WHERE btrim(COALESCE(b.contact_phone, '')) <> ''
      UNION ALL SELECT 'email'::text, u.email::text FROM auth.users u WHERE u.id = b.account_id AND btrim(COALESCE(u.email, '')) <> '' LOOP
    BEGIN
      v_key := public.crm_ident_key(v_kind, v_key);
    EXCEPTION WHEN others THEN v_key := NULL;
    END;
    IF v_key IS NOT NULL AND NOT v_idents @> jsonb_build_array(jsonb_build_object('kind', v_kind, 'value_key', v_key)) THEN
      v_idents := v_idents || jsonb_build_array(jsonb_build_object('kind', v_kind, 'value_key', v_key));
    END IF;
  END LOOP;
  v_hits := CASE WHEN jsonb_array_length(v_idents) > 0 THEN public.crm_identifier_matches('hosts', v_idents, NULL) ELSE '[]'::jsonb END;

  IF jsonb_array_length(v_hits) = 1 THEN
    SELECT * INTO v_rec FROM public.crm_records c
     WHERE c.id = (v_hits->0->'record'->>'id')::uuid AND c.deleted_at IS NULL AND c.pipeline = 'hosts' FOR UPDATE;
    IF FOUND AND v_rec.brand_id IS NULL THEN
      v_kind := COALESCE(v_hits->0->'matched_on'->0->>'kind', 'email');
      UPDATE public.crm_records SET brand_id = b.id, updated_by = c_actor, updated_at = clock_timestamp() WHERE id = v_rec.id;
      INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body)
      VALUES (v_rec.id, 'note', NULL, 'system',
              left(format('Brand %s linked by itself: same %s as this card.', b.name, CASE WHEN v_kind = 'phone' THEN 'phone' ELSE 'email' END), 4000));
      PERFORM public.crm_apply_brand_link(v_rec.id);
      PERFORM public.ops_log_write(c_actor, 'system', 'brand_linked', 'info', NULL, 'crm_record', v_rec.id,
        format('Brand %s linked by itself to %s: same %s.', b.name, v_rec.name, CASE WHEN v_kind = 'phone' THEN 'phone' ELSE 'email' END),
        jsonb_build_object('brand_id', b.id, 'matched', v_kind));
      RETURN jsonb_build_object('status', 'linked', 'record_id', v_rec.id);
    END IF;
  END IF;

  IF jsonb_array_length(v_hits) = 0 THEN
    v_res := public.crm_record_create_core('hosts',
      jsonb_build_object('name', left(b.name, 200), 'brand_id', b.id, 'source', 'inbound', 'owners', '[]'::jsonb), c_actor, NULL);
    IF v_res->>'status' = 'created' THEN
      PERFORM public.ops_log_write(c_actor, 'system', 'brand_card_added', 'info', NULL, 'crm_record', (v_res->'record'->>'id')::uuid,
        format('New brand on Mingla: %s. Host card made in %s.', b.name, COALESCE(initcap(v_res->>'moved_to'), 'the pipeline')),
        jsonb_build_object('brand_id', b.id));
      RETURN jsonb_build_object('status', 'created', 'record_id', v_res->'record'->'id');
    END IF;
  END IF;

  -- Two or more cards share its details (or the one that does is linked to
  -- another brand, or a card of that name exists): a person picks.
  SELECT string_agg(h->'record'->>'name', ', ' ORDER BY h->'record'->>'name') INTO v_names FROM jsonb_array_elements(v_hits) h;
  v_res := public.ops_auto_card_upsert('brand_pick:' || b.id, jsonb_build_object(
    'title', left(format('Pick the host card for %s', b.name), 160),
    'instructions', left(CASE WHEN v_names IS NOT NULL
      THEN format('%s signed up on Mingla. These host cards share its email or phone: %s. Link the brand on the right card, or add a new card.', b.name, v_names)
      ELSE format('%s signed up on Mingla, and a host card with that name already exists. Link the brand on the right card, or add a new card.', b.name) END, 4000),
    'done_means', left(format('%s is linked to one host card.', b.name), 300),
    'owners', CASE WHEN v_boss IS NOT NULL THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END, 'watchers', '[]'::jsonb,
    'due_on', public.ops_today(NULL) + 1,
    'links', jsonb_build_array(jsonb_build_object('kind', 'brand', 'id', b.id))
             || COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', 'host', 'id', h->'record'->>'id')) FROM jsonb_array_elements(v_hits) h), '[]'::jsonb)),
    'task', NULL);
  RETURN jsonb_build_object('status', 'pick', 'card', v_res);
END;
$$;

CREATE FUNCTION public.ops_brand_autolink() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_since timestamptz; b record; v_res jsonb; v_linked integer := 0; v_created integer := 0; v_pick integer := 0;
BEGIN
  v_since := public.ops_try_timestamptz(public.ops_setting('brand_auto_since') #>> '{}');
  IF v_since IS NULL THEN RETURN jsonb_build_object('linked', 0, 'created', 0, 'pick', 0); END IF;
  FOR b IN SELECT br.id FROM public.brands br
            WHERE br.deleted_at IS NULL AND br.created_at >= v_since
              AND NOT EXISTS (SELECT 1 FROM public.crm_records h WHERE h.brand_id = br.id AND h.pipeline = 'hosts' AND h.deleted_at IS NULL)
              AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.auto_key = 'brand_pick:' || br.id AND k.status <> 'done' AND k.archived_at IS NULL)
            ORDER BY br.created_at, br.id LIMIT 25 LOOP
    BEGIN
      v_res := public.ops_brand_autolink_one(b.id);
      CASE v_res->>'status' WHEN 'linked' THEN v_linked := v_linked + 1; WHEN 'created' THEN v_created := v_created + 1;
                            WHEN 'pick' THEN v_pick := v_pick + 1; ELSE NULL; END CASE;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_brand_autolink: brand % stopped (% %)', b.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('linked', v_linked, 'created', v_created, 'pick', v_pick);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. New client functions. Each gates first through crm_ctx() and never
-- takes who is calling as an argument.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.ops_host_next(p_record_ids uuid[], p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF cardinality(COALESCE(p_record_ids, ARRAY[]::uuid[])) > 1000 THEN
    RAISE EXCEPTION 'invalid_records: Ask for at most 1,000 host cards at a time.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('today', v_today, 'hosts', public.ops_host_next_rows(p_record_ids, v_today));
END;
$$;

-- R7 + G5: Needs attention. Every group's count is the length of its list.
CREATE FUNCTION public.ops_attention(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(p_today); v_groups jsonb; v_nonext jsonb; v_next jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT public.ops_host_next_rows(ARRAY(SELECT c.id FROM public.crm_records c
                                          WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL
                                            AND c.stage IN ('replied', 'meeting', 'onboarded', 'live')), v_today) INTO v_next;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'host', 'id', c.id, 'title', c.name,
           'reason', initcap(c.stage) || ', nothing on the Calendar', 'fix', NULL) ORDER BY lower(c.name), c.id), '[]'::jsonb)
    INTO v_nonext
    FROM jsonb_array_elements(v_next) r JOIN public.crm_records c ON c.id = (r->>'record_id')::uuid
   WHERE (r->>'needs_next')::boolean;
  v_groups := jsonb_build_object(
    'noowner', (SELECT COALESCE(jsonb_agg(i ORDER BY i->>'sort'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('kind', 'host', 'id', c.id, 'title', c.name, 'reason', 'Host with no owner', 'fix', 'assign_me',
                                  'sort', '1' || lower(c.name) || c.id) AS i
          FROM public.crm_records c
         WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.stage <> 'lost'
           AND NOT EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = c.id)
        UNION ALL
        SELECT jsonb_build_object('kind', 'card', 'id', w.id, 'title', w.title, 'reason', 'Card with no owner', 'fix', 'assign_me',
                                  'number', w.number, 'sort', '0' || lpad(w.number::text, 10, '0'))
          FROM public.ops_work_cards w
         WHERE w.archived_at IS NULL AND w.status IN ('todo', 'doing')
           AND NOT EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.role = 'owner')) s),
    'overdue', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'card', 'id', w.id, 'title', w.title, 'number', w.number,
                  'reason', format('Due %s, %s %s ago', public.ops_day_words(w.due_on), v_today - w.due_on,
                                   CASE WHEN v_today - w.due_on = 1 THEN 'day' ELSE 'days' END), 'fix', NULL) ORDER BY w.due_on, w.number), '[]'::jsonb)
                  FROM public.ops_work_cards w
                 WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.due_on < v_today),
    'missing', (SELECT COALESCE(jsonb_agg(i ORDER BY i->>'sort'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('kind', 'host', 'id', c.id, 'title', c.name,
                 'reason', 'Missing ' || array_to_string(public.ops_host_missing(c), ', '), 'fix', 'fill_in',
                 'missing', to_jsonb(public.ops_host_missing(c)), 'sort', '1' || lower(c.name) || c.id) AS i
          FROM public.crm_records c
         WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.stage <> 'lost' AND cardinality(public.ops_host_missing(c)) > 0
        UNION ALL
        SELECT jsonb_build_object('kind', 'card', 'id', w.id, 'title', w.title, 'number', w.number,
                 'reason', format('GitHub #%s is not on GitHub', min(g.number)), 'fix', NULL, 'sort', '0' || lpad(w.number::text, 10, '0'))
          FROM public.ops_work_cards w
          JOIN public.ops_work_github wg ON wg.card_id = w.id
          JOIN public.ops_github_items g ON g.number = wg.number AND g.not_found
         WHERE w.archived_at IS NULL AND w.status <> 'done'
         GROUP BY w.id, w.title, w.number) s),
    'stuck', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'card', 'id', w.id, 'title', w.title, 'number', w.number,
                'reason', CASE WHEN w.working_via IS NOT NULL AND w.working_seen_at < now() - interval '7 days'
                               THEN format('%s has posted no update for %s days', public.ops_actor_label(w.working_by, w.working_via, w.working_chat),
                                           extract(day FROM now() - w.working_seen_at)::integer)
                               ELSE format('In progress, no update for %s days',
                                           extract(day FROM now() - COALESCE((SELECT max(ev.at) FROM public.ops_work_events ev WHERE ev.card_id = w.id), w.updated_at))::integer) END,
                'fix', NULL) ORDER BY w.number), '[]'::jsonb)
                FROM public.ops_work_cards w
               WHERE w.archived_at IS NULL AND w.status = 'doing'
                 AND (COALESCE((SELECT max(ev.at) FROM public.ops_work_events ev WHERE ev.card_id = w.id), w.updated_at) < now() - interval '7 days'
                      OR (w.working_via IS NOT NULL AND w.working_seen_at < now() - interval '7 days'))),
    'nonext', v_nonext,
    'engineering', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'card', 'id', w.id, 'title', w.title, 'number', w.number,
                      'reason', w.done_means, 'fix', CASE WHEN NOT EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.role = 'owner')
                                                          THEN 'assign_me' END) ORDER BY w.due_on, w.number), '[]'::jsonb)
                      FROM public.ops_work_cards w
                     WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.auto_key LIKE 'eng\_%'));
  -- The sort helper is internal.
  v_groups := (SELECT jsonb_object_agg(g.key, (SELECT COALESCE(jsonb_agg(i - 'sort'), '[]'::jsonb) FROM jsonb_array_elements(g.value) i))
                 FROM jsonb_each(v_groups) g);
  RETURN jsonb_build_object('today', v_today, 'groups', v_groups,
    'counts', (SELECT jsonb_object_agg(g.key, jsonb_array_length(g.value)) FROM jsonb_each(v_groups) g),
    'total', (SELECT sum(jsonb_array_length(g.value))::integer FROM jsonb_each(v_groups) g),
    'live_totals', public.ops_live_totals(v_today));
END;
$$;

-- R10: the automatic changes on an event, an expected event or a host in
-- the last p_hours, newest first, at most 8, in plain words.
CREATE FUNCTION public.ops_recent_changes(p_kind text, p_id uuid, p_hours integer DEFAULT 72) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_hours integer := LEAST(GREATEST(COALESCE(p_hours, 72), 1), 720); v_since timestamptz; v_host uuid;
  v_cards uuid[]; v_items jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_kind IS NULL OR p_kind NOT IN ('event', 'expected', 'host') THEN
    RAISE EXCEPTION 'invalid_kind: Ask for an event, an expected event or a host.' USING ERRCODE = '22023';
  END IF;
  v_since := now() - make_interval(hours => v_hours);
  IF p_kind = 'host' THEN
    v_host := p_id;
    v_cards := ARRAY(SELECT w.id FROM public.ops_work_cards w WHERE w.archived_at IS NULL
                       AND (EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = 'host' AND l.target_id = p_id)
                            OR (w.anchor_kind = 'expected' AND w.anchor_id IN (SELECT z.id FROM public.ops_expected_events z WHERE z.record_id = p_id))
                            OR (w.anchor_kind = 'event' AND w.anchor_id IN (SELECT e.id FROM public.events e JOIN public.crm_records c
                                                                              ON c.brand_id = e.brand_id AND c.id = p_id))));
  ELSE
    v_host := (public.ops_anchor(p_kind, p_id, NULL)->>'record_id')::uuid;
    v_cards := ARRAY(SELECT w.id FROM public.ops_work_cards w WHERE w.archived_at IS NULL
                       AND ((w.anchor_kind = p_kind AND w.anchor_id = p_id)
                            OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = p_kind AND l.target_id = p_id)));
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', s.at, 'words', s.words) ORDER BY s.at DESC), '[]'::jsonb) INTO v_items FROM (
    SELECT DISTINCT ON (u.words) u.at, u.words FROM (
      SELECT l.at, l.summary AS words FROM public.ops_agent_log l
       WHERE l.actor_email = 'system@usemingla.com' AND l.at > v_since
         AND ((l.target_kind = CASE p_kind WHEN 'host' THEN 'crm_record' ELSE p_kind END AND l.target_id = p_id)
              OR l.card_id = ANY (v_cards))
      UNION ALL
      SELECT a.occurred_at, a.body FROM public.crm_activity a
       WHERE a.record_id = v_host AND a.via = 'system' AND a.occurred_at > v_since AND btrim(COALESCE(a.body, '')) <> ''
) u
     ORDER BY u.words, u.at DESC) s;
  RETURN jsonb_build_object('items', COALESCE((SELECT jsonb_agg(i) FROM (SELECT i FROM jsonb_array_elements(v_items) WITH ORDINALITY t(i, o)
                                                                       WHERE t.o <= 8 ORDER BY t.o) z), '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Replaced functions.
-- ---------------------------------------------------------------------------

-- From 20271117003980. Every event carries its plain state.
CREATE OR REPLACE FUNCTION public.ops_events_in_window(p_from date, p_to date, p_today date) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT y.a || jsonb_build_object('state', public.ops_plain_state(y.a, COALESCE(p_today, (now() AT TIME ZONE 'UTC')::date)))
    FROM (SELECT DISTINCT d.event_id FROM public.event_dates d
           WHERE d.start_at >= ((p_from - 2)::timestamp AT TIME ZONE 'UTC')
             AND d.start_at < ((p_to + 3)::timestamp AT TIME ZONE 'UTC')) x
    CROSS JOIN LATERAL (SELECT public.ops_anchor('event', x.event_id, p_today) AS a) y
   WHERE y.a IS NOT NULL AND y.a->>'start_on' IS NOT NULL
     AND (y.a->>'start_on')::date BETWEEN p_from AND p_to
$$;

-- From 20271117003980. Adds repeats, the plain state of its next date and
-- the next 4 dates of a repeating series.
CREATE OR REPLACE FUNCTION public.ops_expected_json(x public.ops_expected_events, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_host jsonb := public.ops_host_json(x.record_id); v_today date := COALESCE(p_today, public.ops_today(NULL)); v_occ jsonb;
        v_next date;
BEGIN
  v_occ := CASE WHEN x.repeats <> 'none' AND x.status = 'open' THEN public.ops_expected_occurrences(x, v_today, 4) ELSE NULL END;
  v_next := COALESCE((SELECT (o->>'on')::date FROM jsonb_array_elements(v_occ) o WHERE NOT (o->>'live')::boolean ORDER BY (o->>'on')::date LIMIT 1),
                     x.expected_on);
  RETURN jsonb_build_object('id', x.id, 'record_id', x.record_id, 'host_name', v_host->>'name', 'title', x.title,
    'event_type', x.event_type, 'expected_on', x.expected_on, 'city', x.city, 'note', x.note, 'status', x.status,
    'event_id', x.event_id, 'cancel_reason', x.cancel_reason, 'revision', x.revision, 'updated_at', x.updated_at,
    'repeats', x.repeats, 'promo_moment', x.event_type = 'promo_moment', 'next_on', v_next, 'occurrences', v_occ,
    'state', public.ops_plain_state(public.ops_expected_anchor(x, v_next), v_today),
    'runway', public.ops_runway(false, NULL, (v_next::timestamp AT TIME ZONE 'UTC'), 'UTC', v_today),
    'owners', COALESCE(v_host->'owners', '[]'::jsonb),
    'cards', public.ops_anchor_card_counts('expected', x.id));
END;
$$;

-- From 20271117003980. Events and expected dates carry their plain state; a
-- repeating series shows each of its next 4 dates not yet stood for by a
-- public event; posts with no date are counted.
CREATE OR REPLACE FUNCTION public.ops_calendar(p_from date, p_to date, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); v_base jsonb; v_expected jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_window_check(p_from, p_to);
  -- Events from the window start to 28 days after its end: go-live deadlines
  -- in the window belong to events up to 28 days later.
  SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) INTO v_base FROM public.ops_events_in_window(p_from, p_to + 28, v_today) a;
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'expected_on', r->>'title'), '[]'::jsonb) INTO v_expected FROM (
    SELECT public.ops_expected_json(x, v_today) || jsonb_build_object('occurrence', false) AS r
      FROM public.ops_expected_events x
     WHERE x.status = 'open' AND x.repeats = 'none' AND x.expected_on BETWEEN p_from AND p_to
    UNION ALL
    SELECT public.ops_expected_json(x, v_today)
           || jsonb_build_object('occurrence', true, 'series_id', x.id, 'expected_on', o->'on', 'next_on', o->'on',
                                 'state', public.ops_plain_state(public.ops_expected_anchor(x, (o->>'on')::date), v_today),
                                 'runway', public.ops_runway(false, NULL, ((o->>'on')::date::timestamp AT TIME ZONE 'UTC'), 'UTC', v_today))
      FROM public.ops_expected_events x
     CROSS JOIN LATERAL jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
     WHERE x.status = 'open' AND x.repeats <> 'none' AND NOT (o->>'live')::boolean
       AND (o->>'on')::date BETWEEN p_from AND p_to) s;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'today', v_today,
    'events', COALESCE((SELECT jsonb_agg(public.ops_calendar_event_json(a) || jsonb_build_object('state', a->'state')
                                         ORDER BY a->>'start_at', a->>'title')
                          FROM jsonb_array_elements(v_base) a WHERE (a->>'start_on')::date BETWEEN p_from AND p_to), '[]'::jsonb),
    'expected', v_expected,
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
         WHERE x.status = 'open' AND x.repeats = 'none' AND x.expected_on - 28 BETWEEN p_from AND p_to) d), '[]'::jsonb),
    'promotions', public.ops_promotions(p_from, p_to),
    'content', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'stage', i.stage,
                            'publish_at', i.publish_at, 'channels', to_jsonb(i.channels)) ORDER BY i.publish_at, i.title)
                           FROM public.content_calendar_items i
                          WHERE i.deleted_at IS NULL AND i.publish_at >= (p_from::timestamp AT TIME ZONE 'UTC')
                            AND i.publish_at < ((p_to + 1)::timestamp AT TIME ZONE 'UTC')), '[]'::jsonb),
    'posts_undated', (SELECT count(*) FROM public.content_calendar_items i WHERE i.deleted_at IS NULL AND i.publish_at IS NULL));
END;
$$;

-- From 20271117003980. Rows carry their plain state; a repeating series
-- lists its open dates.
CREATE OR REPLACE FUNCTION public.ops_runway_report(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_today date DEFAULT NULL) RETURNS jsonb
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
             'is_public', a->'is_public', 'host_name', h.j->'name', 'record_id', a->'record_id', 'state', a->'state',
             'owners', COALESCE(h.j->'owners', '[]'::jsonb)) AS r
      FROM public.ops_events_in_window(v_from, v_to, v_today) a
      LEFT JOIN LATERAL (SELECT public.ops_host_json((a->>'record_id')::uuid) AS j) h ON true
    UNION ALL
    SELECT jsonb_build_object('anchor_kind', 'expected', 'anchor_id', x.id, 'title', x.title, 'start_on', x.expected_on,
             'band', e.j->'runway'->'band', 'lead_days', NULL, 'go_live_by', e.j->'runway'->'go_live_by', 'is_public', false,
             'host_name', e.j->'host_name', 'record_id', x.record_id, 'owners', e.j->'owners', 'state', e.j->'state',
             'promo_moment', x.event_type = 'promo_moment')
      FROM public.ops_expected_events x
      CROSS JOIN LATERAL (SELECT public.ops_expected_json(x, v_today) AS j) e
     WHERE x.status = 'open' AND x.repeats = 'none' AND x.expected_on BETWEEN v_from AND v_to
    UNION ALL
    SELECT jsonb_build_object('anchor_kind', 'expected', 'anchor_id', x.id, 'title', x.title, 'start_on', o->'on',
             'band', public.ops_runway(false, NULL, ((o->>'on')::date::timestamp AT TIME ZONE 'UTC'), 'UTC', v_today)->'band',
             'lead_days', NULL, 'go_live_by', (o->>'on')::date - 28, 'is_public', false,
             'host_name', public.ops_host_json(x.record_id)->'name', 'record_id', x.record_id,
             'owners', COALESCE(public.ops_host_json(x.record_id)->'owners', '[]'::jsonb), 'repeats', x.repeats,
             'state', public.ops_plain_state(public.ops_expected_anchor(x, (o->>'on')::date), v_today))
      FROM public.ops_expected_events x
      CROSS JOIN LATERAL jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
     WHERE x.status = 'open' AND x.repeats <> 'none' AND NOT (o->>'live')::boolean
       AND (o->>'on')::date BETWEEN v_from AND v_to) s;
  RETURN jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today,
    'counts', jsonb_build_object(
      'full', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'full'),
      'tight', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'tight'),
      'organic', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'organic'),
      'not_live', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'not_live'),
      'missed', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'band' = 'missed')),
    'states', jsonb_build_object(
      'ready', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->'state'->>'k' = 'ready'),
      'short', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->'state'->>'k' = 'short'),
      'late', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->'state'->>'k' = 'late'),
      'notlive', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->'state'->>'k' = 'notlive')),
    'rows', v_rows,
    'at_risk', COALESCE((SELECT jsonb_agg(r ORDER BY r->>'go_live_by', r->>'title') FROM jsonb_array_elements(v_rows) r
                          WHERE (r->>'band' = 'not_live' AND (r->>'go_live_by')::date <= v_today + 14) OR r->>'band' = 'missed'), '[]'::jsonb));
END;
$$;

-- From 20271117003980. Adds the state and its sentence, the eight steps as a
-- computed checklist (the artifact's wording and rules), how many are done,
-- and what just happened. The old "kit" key stays for one release.
CREATE OR REPLACE FUNCTION public.ops_anchor_detail(p_kind text, p_id uuid, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(p_today); a jsonb; v_host jsonb; v_start date; v_band text; v_kit jsonb;
  v_hostname text; v_title text; v_state jsonb; v_steps jsonb; v_public boolean; v_host_owners text; v_mkt text; v_mkt_name text;
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
  v_public := COALESCE((a->>'is_public')::boolean, false);
  v_state := public.ops_plain_state(a, v_today);
  v_host_owners := COALESCE((SELECT string_agg(o #>> '{}', ', ') FROM jsonb_array_elements(v_host->'owners') o), 'No owner yet');
  v_mkt := public.ops_setting('marketing_owner') #>> '{}';
  v_mkt_name := CASE WHEN v_mkt IS NOT NULL THEN public.ops_name(v_mkt) ELSE v_host_owners END;
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
             WHEN v_public AND (k->>'step')::integer <= -28 THEN 'done'
             WHEN v_start IS NOT NULL AND v_start + (k->>'step')::integer < v_today THEN 'passed'
             ELSE 'no_card' END)
           ORDER BY (k->>'step')::integer), '[]'::jsonb)
    INTO v_kit
    FROM jsonb_array_elements(public.ops_kit_template()) k
    LEFT JOIN LATERAL (SELECT c.id, c.number, c.status, c.blocked, c.person_reason FROM public.ops_work_cards c
                        WHERE c.anchor_kind = p_kind AND c.anchor_id = p_id AND c.kit_step = (k->>'step')::integer
                          AND c.archived_at IS NULL ORDER BY c.created_at DESC LIMIT 1) w ON true;
  -- The eight steps, made by themselves: public means every step up to
  -- go-live is done; the giveaway step is skipped when it went live too
  -- late; a public event's past steps are done.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'step', s.t, 'date', CASE WHEN v_start IS NOT NULL THEN v_start + s.t END, 'title', s.title,
           'who', CASE WHEN s.mkt THEN v_mkt_name ELSE v_host_owners END, 'key', s.t IN (-28, -21),
           'state', CASE
             WHEN v_public AND s.t <= -28 THEN 'done'
             WHEN s.t = -21 AND v_state->>'k' = 'late' THEN 'skip'
             WHEN v_public AND v_start IS NOT NULL AND v_start + s.t < v_today THEN 'done'
             WHEN w.status = 'done' THEN 'done'
             ELSE 'open' END,
           'card', CASE WHEN w.id IS NOT NULL THEN jsonb_build_object('id', w.id, 'number', w.number, 'status', w.status) END)
           ORDER BY s.t), '[]'::jsonb)
    INTO v_steps
    FROM (VALUES (-35, 'Get the flyer, logo, prices and date', false), (-31, 'Build the listing with the host', false),
                 (-28, 'Live on Mingla', false), (-26, 'Write the brief, pick creators', true),
                 (-21, 'Start the giveaway and ads', true), (-14, 'Creators post', true),
                 (-7, 'Reminder push', true), (2, 'Recap and ask for the next event', false)) AS s(t, title, mkt)
    LEFT JOIN LATERAL (SELECT c.id, c.number, c.status FROM public.ops_work_cards c
                        WHERE c.anchor_kind = p_kind AND c.anchor_id = p_id AND c.kit_step = s.t
                          AND c.archived_at IS NULL ORDER BY c.created_at DESC LIMIT 1) w ON true;
  RETURN jsonb_build_object('anchor', a, 'runway', a->'runway', 'kit', v_kit, 'host', v_host,
    'state', v_state, 'say', v_state->>'say', 'steps', v_steps,
    'done_count', (SELECT count(*) FROM jsonb_array_elements(v_steps) x WHERE x->>'state' = 'done'),
    'changes', public.ops_recent_changes(p_kind, p_id, 72)->'items',
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

-- From 20271117003980. Events and expected events carry their plain state;
-- adds the brand link words, past events, the work on this host (open cards
-- linked to it or counted from its events) and what just happened.
CREATE OR REPLACE FUNCTION public.ops_host_on_mingla(p_record_id uuid, p_today date DEFAULT NULL) RETURNS jsonb
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
    'record', jsonb_build_object('id', r.id, 'name', r.name, 'brand_id', r.brand_id, 'stage', r.stage),
    'brand', v_brand,
    'events', CASE WHEN v_brand IS NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.a->'id', 'title', s.a->'title', 'event_type', s.a->'event_type',
                         'status', s.a->'status', 'is_public', s.a->'is_public', 'start_at', s.a->'start_at',
                         'start_on', s.a->'start_on', 'timezone', s.a->'timezone', 'runway', s.a->'runway',
                         'state', public.ops_plain_state(s.a, v_today))
                       ORDER BY s.a->>'start_at', s.a->>'title')
        FROM (SELECT y.a FROM public.events e
                CROSS JOIN LATERAL (SELECT public.ops_anchor('event', e.id, v_today) AS a) y
               WHERE e.brand_id = r.brand_id AND e.deleted_at IS NULL AND y.a IS NOT NULL
                 AND y.a->>'start_on' IS NOT NULL AND (y.a->>'start_on')::date >= v_today - 30
               ORDER BY y.a->>'start_at' LIMIT 50) s), '[]'::jsonb) END,
    'past', CASE WHEN r.brand_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'start_on', p.on_day) ORDER BY p.on_day DESC)
        FROM (SELECT e.id, e.title, (s.st AT TIME ZONE 'UTC')::date AS on_day FROM public.events e
                JOIN LATERAL (SELECT public.ops_event_first_start(e.id) AS st) s ON true
               WHERE e.brand_id = r.brand_id AND e.deleted_at IS NULL AND public.ops_event_in_scope(e.id)
                 AND s.st IS NOT NULL AND (s.st AT TIME ZONE 'UTC')::date < v_today
               ORDER BY s.st DESC LIMIT 5) p), '[]'::jsonb) END,
    'expected', COALESCE((SELECT jsonb_agg(public.ops_expected_json(x, v_today) ORDER BY (x.status <> 'open'), x.expected_on)
                            FROM public.ops_expected_events x
                           WHERE x.record_id = r.id
                             AND (x.status = 'open' OR (x.status = 'fulfilled' AND x.updated_at > now() - interval '60 days'))), '[]'::jsonb),
    'next', (public.ops_host_next_rows(ARRAY[r.id], v_today)->0),
    'cards', COALESCE((SELECT jsonb_agg(public.ops_card_lite(c) ORDER BY c.due_on, c.number)
                         FROM public.ops_work_cards c
                        WHERE c.archived_at IS NULL AND c.status <> 'done'
                          AND EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = 'host' AND l.target_id = r.id)), '[]'::jsonb),
    'work', COALESCE((SELECT jsonb_agg(public.ops_card_lite(c) ORDER BY (c.status = 'done'), c.due_on, c.number)
                        FROM public.ops_work_cards c
                       WHERE c.archived_at IS NULL
                         AND (c.status <> 'done' OR c.closed_at > now() - interval '7 days')
                         AND (EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = 'host' AND l.target_id = r.id)
                              OR (c.anchor_kind = 'expected' AND c.anchor_id IN (SELECT z.id FROM public.ops_expected_events z WHERE z.record_id = r.id))
                              OR (c.anchor_kind = 'event' AND r.brand_id IS NOT NULL
                                  AND c.anchor_id IN (SELECT e.id FROM public.events e WHERE e.brand_id = r.brand_id)))), '[]'::jsonb),
    'changes', public.ops_recent_changes('host', r.id, 72)->'items');
END;
$$;

-- From 20271117003980. Accepts repeats (none, week or month) and the type
-- promo_moment; while automatic steps are on, this host's steps are made at
-- once, so "its steps are in Work" is true when the screen says so.
CREATE OR REPLACE FUNCTION public.ops_expected_event_set(p_item jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text; v_fixes jsonb := '[]'::jsonb;
  r public.crm_records; x public.ops_expected_events; n public.ops_expected_events; d public.ops_expected_events;
  v_update boolean := false; v_title text; v_type text; v_on date; v_city text; v_note text; v_cancel text;
  v_status text := 'open'; v_event uuid; v_result text; v_out jsonb; v_who text; v_moved integer := 0;
  v_repeats text; v_steps jsonb;
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
  IF COALESCE((public.ops_setting('auto_steps') #>> '{}')::boolean, false) THEN
    BEGIN
      v_steps := public.ops_auto_steps(v_today, r.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'ops_expected_event_set: automatic steps stopped (% %)', SQLSTATE, SQLERRM;
      v_steps := NULL;
    END;
  END IF;
  v_out := jsonb_build_object('expected', public.ops_expected_json(n, v_today), 'status', v_result, 'cards_moved', v_moved,
    'steps', v_steps, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'expected', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_expected: An open expected event with this title and date is already on this host card. Update that one instead.' USING ERRCODE = '22023';
END;
$$;

-- From 20271116003980. The "Recently shipped" wording cards (Bridge D) are
-- listed on their own, for the owner and admins only, with the drafted
-- roadmap wording; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.ops_review_list(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); v_admin boolean := public.is_admin_user(); v_out jsonb; v_need jsonb;
        v_wording jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT jsonb_build_object(
    'cards', COALESCE(jsonb_agg(public.ops_card_json(w, v_today) ORDER BY array_position(ARRAY['spend','publish','other'], w.person_reason), w.due_on, w.number), '[]'::jsonb),
    'counts', jsonb_build_object('spend', count(*) FILTER (WHERE w.person_reason = 'spend'),
                                 'publish', count(*) FILTER (WHERE w.person_reason = 'publish'),
                                 'other', count(*) FILTER (WHERE w.person_reason = 'other')))
    INTO v_out
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status = 'person' AND w.person_reason IN ('spend','publish','other')
     AND (w.auto_key IS NULL OR w.auto_key NOT LIKE 'roadmap\_shipped:%')
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  SELECT COALESCE(jsonb_agg(public.ops_card_json(w, v_today) ORDER BY w.due_on, w.number), '[]'::jsonb) INTO v_need
    FROM public.ops_work_cards w
   WHERE w.archived_at IS NULL AND w.status = 'person' AND w.person_reason = 'send'
     AND NOT public.ops_send_draft_waiting(w.id, w.proof)
     AND (v_admin OR EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.email = v.actor_email));
  -- What hosts are told: only the owner and admins see and decide it.
  SELECT COALESCE(jsonb_agg(public.ops_card_json(w, v_today) || jsonb_build_object('roadmap', (
           SELECT jsonb_build_object('id', rc.id, 'public_title', rc.public_title, 'public_body', rc.public_body,
                                     'internal_note', rc.internal_note, 'lane', rc.lane, 'status', rc.status)
             FROM public.ops_work_links l JOIN public.community_roadmap_cards rc ON rc.id = l.target_id
            WHERE l.card_id = w.id AND l.kind = 'roadmap_card' LIMIT 1))
           ORDER BY w.due_on, w.number), '[]'::jsonb) INTO v_wording
    FROM public.ops_work_cards w
   WHERE v_admin AND v.via IS NULL AND w.archived_at IS NULL AND w.status = 'person' AND w.auto_key LIKE 'roadmap\_shipped:%';
  RETURN v_out || jsonb_build_object('draft_needed', v_need, 'wording', v_wording,
    'counts', (v_out->'counts') || jsonb_build_object('draft_needed', jsonb_array_length(v_need), 'wording', jsonb_array_length(v_wording)));
END;
$$;

-- From 20271116003980. Adds the wording cards for the owner and admins.
CREATE OR REPLACE FUNCTION public.ops_my_counts(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); v_review jsonb := public.ops_review_list(p_today);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  RETURN (SELECT jsonb_build_object(
    'open_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner'),
    'needs_person_mine', jsonb_array_length(v_review->'cards'),
    'draft_needed_mine', jsonb_array_length(v_review->'draft_needed'),
    'wording_mine', jsonb_array_length(v_review->'wording'),
    'overdue_mine', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'owner' AND w.due_on < v_today),
    'watching_open', count(*) FILTER (WHERE w.status <> 'done' AND p.role = 'watcher'))
    FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = v.actor_email
   WHERE w.archived_at IS NULL);
END;
$$;

-- From 20271118003980. Adds the live totals and the switches.
CREATE OR REPLACE FUNCTION public.ops_team_overview(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); v_mon date; v_report jsonb; v_sprint public.ops_sprints;
        v_from timestamptz; v_to timestamptz;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'forbidden: The Team dashboard is for the owner and admins.' USING ERRCODE = '42501';
  END IF;
  v_mon := public.ops_monday(v_today);
  v_from := v_mon::timestamp AT TIME ZONE 'UTC';
  v_to := (v_mon + 7)::timestamp AT TIME ZONE 'UTC';
  SELECT * INTO v_sprint FROM public.ops_sprints s WHERE s.starts_on = v_mon;
  v_report := public.ops_runway_report(NULL, NULL, v_today);
  RETURN jsonb_build_object(
    'today', v_today,
    'runway', jsonb_build_object('from', v_report->'from', 'to', v_report->'to', 'counts', v_report->'counts', 'at_risk', v_report->'at_risk'),
    'sprint', jsonb_build_object('week', v_mon, 'ends_on', v_mon + 6, 'id', v_sprint.id, 'goal', v_sprint.goal,
      'carried_in', COALESCE(v_sprint.carried_in, 0),
      'by_person', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('email', d.email, 'name', public.ops_name(d.email),
                 'open', (SELECT count(*) FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = d.email AND p.role = 'owner'
                           WHERE w.archived_at IS NULL AND w.status <> 'done'),
                 'needs_person', (SELECT count(*) FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = d.email AND p.role = 'owner'
                                   WHERE w.archived_at IS NULL AND w.status = 'person'),
                 'closed_by_agent', (SELECT count(*) FROM public.ops_work_cards w
                                      WHERE w.archived_at IS NULL AND w.status = 'done' AND w.closed_by = d.email
                                        AND w.closed_via IN ('claude', 'codex') AND w.closed_at >= v_from AND w.closed_at < v_to),
                 'carried', (SELECT count(*) FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = d.email AND p.role = 'owner'
                              WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.carried_count > 0 AND w.sprint_id = v_sprint.id))
               ORDER BY (d.role = 'owner') DESC, d.email)
          FROM public.admin_team_directory() d WHERE d.status = 'active'), '[]'::jsonb)),
    'hosts_without_owner', (SELECT count(*) FROM public.crm_records c
                             WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL
                               AND NOT EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = c.id)),
    'expected_soon', v_report->'at_risk',
    'live_totals', public.ops_live_totals(v_today),
    'settings', public.ops_settings_get());
END;
$$;

-- From 20271124003980. Adds follow_through_since (X3).
CREATE OR REPLACE FUNCTION public.ops_settings_get() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_mo text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_mo := public.ops_setting('marketing_owner') #>> '{}';
  RETURN jsonb_build_object(
    'auto_steps', COALESCE((public.ops_setting('auto_steps') #>> '{}')::boolean, false),
    'brand_auto_cards', COALESCE((public.ops_setting('brand_auto_cards') #>> '{}')::boolean, false),
    'brand_auto_since', public.ops_setting('brand_auto_since'),
    'follow_through_since', public.ops_setting('follow_through_since'),
    'marketing_owner', CASE WHEN v_mo IS NOT NULL THEN jsonb_build_object('email', v_mo, 'name', public.ops_name(v_mo)) END,
    'can_edit', COALESCE(v.via IS NULL AND public.admin_team_role() = 'owner', false));
END;
$$;

-- From 20271124003980. X3: switching automatic steps on records, once, the
-- time engineering follow-through starts counting from. Everything else is
-- unchanged.
CREATE OR REPLACE FUNCTION public.ops_setting_set(p_key text, p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_value jsonb := p_value; v_email text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_owner_person_only('Only the owner can change these switches.');
  IF p_key IN ('auto_steps', 'brand_auto_cards') THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'invalid_setting: Switch it on or off.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'marketing_owner' THEN
    IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
      v_value := 'null'::jsonb;
    ELSE
      v_email := CASE WHEN jsonb_typeof(p_value) = 'string' THEN lower(btrim(p_value #>> '{}')) END;
      IF v_email IS NULL OR NOT EXISTS (SELECT 1 FROM public.admin_team_directory() d WHERE d.email = v_email AND d.status = 'active') THEN
        RAISE EXCEPTION 'invalid_setting: The marketing owner must be an active teammate, or nobody.' USING ERRCODE = '22023';
      END IF;
      v_value := to_jsonb(v_email);
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_setting: That switch does not exist.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ops_settings SET value = v_value, updated_by = v.actor_email, updated_at = now() WHERE key = p_key;
  IF p_key = 'brand_auto_cards' AND v_value = 'true'::jsonb AND public.ops_setting('brand_auto_since') = 'null'::jsonb THEN
    UPDATE public.ops_settings SET value = to_jsonb(now()), updated_by = v.actor_email, updated_at = now() WHERE key = 'brand_auto_since';
  END IF;
  IF p_key = 'auto_steps' AND v_value = 'true'::jsonb AND public.ops_setting('follow_through_since') = 'null'::jsonb THEN
    UPDATE public.ops_settings SET value = to_jsonb(now()), updated_by = v.actor_email, updated_at = now() WHERE key = 'follow_through_since';
  END IF;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'setting_changed', 'info', NULL, NULL, NULL,
    format('%s set %s to %s.', public.ops_name(v.actor_email), replace(p_key, '_', ' '), COALESCE(v_value #>> '{}', 'nobody')),
    jsonb_build_object('key', p_key));
  RETURN jsonb_build_object('settings', public.ops_settings_get());
END;
$$;

-- From 20271125003980. X3: remembers when Mingla first saw an issue move to
-- Done (never for an issue already Done the first time it was read).
-- Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.ops_github_items_apply(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i jsonb; g public.ops_github_items; v_n integer; v_kind text; v_state text; v_url text; v_old text; v_new text;
  v_applied integer := 0; v_skipped integer := 0; v_changed integer[] := ARRAY[]::integer[]; v_bridges jsonb; v_board text;
BEGIN
  PERFORM public.ops_service_only();
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'invalid_items: Send a list of at most 200 GitHub items.' USING ERRCODE = '22023';
  END IF;
  FOR i IN SELECT e FROM jsonb_array_elements(p_items) e LOOP
    IF jsonb_typeof(i) <> 'object' OR jsonb_typeof(i->'number') <> 'number' OR (i->>'number') !~ '^[0-9]{1,7}$'
       OR jsonb_typeof(i->'found') <> 'boolean' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    v_n := (i->>'number')::integer;
    SELECT * INTO g FROM public.ops_github_items x WHERE x.number = v_n FOR UPDATE;
    IF NOT FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    v_old := public.ops_github_status(v_n)->>'label';
    IF NOT (i->>'found')::boolean THEN
      UPDATE public.ops_github_items x SET not_found = true, synced_at = now() WHERE x.number = v_n;
    ELSE
      v_kind := CASE i->>'kind' WHEN 'pull' THEN 'pull' WHEN 'issue' THEN 'issue' END;
      IF v_kind IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
      v_state := CASE WHEN v_kind = 'pull' AND jsonb_typeof(i->'merged') = 'boolean' AND (i->>'merged')::boolean THEN 'MERGED'
                      WHEN upper(i->>'state') IN ('OPEN', 'CLOSED', 'MERGED') THEN upper(i->>'state') END;
      v_url := 'https://github.com/Mingla-LLC/mingla-main/' || CASE v_kind WHEN 'pull' THEN 'pull/' ELSE 'issues/' END || v_n;
      v_board := CASE WHEN i->>'board_status' IN ('Todo','In Progress','In Review','Done') THEN i->>'board_status' END;
      UPDATE public.ops_github_items x SET kind = v_kind,
             title = NULLIF(left(btrim(regexp_replace(COALESCE(i->>'title', ''), '[[:cntrl:]]', ' ', 'g')), 300), ''),
             url = v_url, state = v_state,
             board_status = v_board,
             board_horizon = CASE WHEN i->>'board_horizon' IN ('Now','Next','Later') THEN i->>'board_horizon' END,
             merged_at = public.ops_try_timestamptz(i->>'merged_at'),
             merge_sha = CASE WHEN i->>'merge_sha' ~ '^[0-9a-f]{40}$' THEN i->>'merge_sha' END,
             closing_issues = ARRAY(SELECT (c #>> '{}')::integer FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i->'closing_issues') = 'array'
                                      THEN i->'closing_issues' ELSE '[]'::jsonb END) WITH ORDINALITY t(c, o)
                                     WHERE t.o <= 10 AND jsonb_typeof(c) = 'number' AND (c #>> '{}') ~ '^[0-9]{1,7}$' ORDER BY t.o),
             github_updated_at = public.ops_try_timestamptz(i->>'updated_at'),
             -- X3: a move to Done Mingla saw happen; history stays unmarked.
             done_seen_at = CASE WHEN v_board IS DISTINCT FROM 'Done' THEN NULL
                                 WHEN g.synced_at IS NOT NULL AND g.board_status IS DISTINCT FROM 'Done' THEN now()
                                 ELSE g.done_seen_at END,
             not_found = false, synced_at = now()
       WHERE x.number = v_n;
      UPDATE public.ops_work_github w SET kind = v_kind WHERE w.number = v_n AND w.kind <> v_kind;
    END IF;
    v_new := public.ops_github_status(v_n)->>'label';
    IF g.synced_at IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
      PERFORM public.ops_log_write('system@usemingla.com', 'system', 'release_record', 'info', NULL, 'github', NULL,
        format('GitHub #%s is now %s (was %s).', v_n, v_new, v_old), jsonb_build_object('number', v_n, 'from', v_old, 'to', v_new));
      v_changed := v_changed || v_n;
    END IF;
    v_applied := v_applied + 1;
  END LOOP;
  BEGIN
    v_bridges := public.ops_github_bridges();
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_github_items_apply: bridges stopped (% %)', SQLSTATE, SQLERRM;
  END;
  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped, 'changed', to_jsonb(v_changed), 'bridges', v_bridges);
END;
$$;

-- From 20271124003980. X3: follow-through cards fire only for pull
-- requests merged, issues moved to Done and commits pushed at or after the
-- time the owner switched automatic steps on.
CREATE OR REPLACE FUNCTION public.ops_engineering_cards_sync() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r public.ops_release_records; m public.ops_main_commits; g public.ops_github_items; w public.ops_work_cards;
  v_added integer := 0; v_closed integer := 0; v_owner text; v_watch text; v_due date := public.ops_today(NULL) + 1;
  v_key text; v_res jsonb; v_list text; v_refused_at timestamptz; v_want jsonb := '{}'::jsonb; v_common jsonb;
  v_proj text; v_live boolean; v_boss text := public.ops_owner_email(); v_since timestamptz;
BEGIN
  -- X3: follow-through counts only from the time the owner switched automatic
  -- steps on; before that (or with no time recorded) nothing is followed up.
  v_since := public.ops_try_timestamptz(public.ops_setting('follow_through_since') #>> '{}');
  -- Which keys should be open now, and the card each would make.
  FOR r IN SELECT x.* FROM public.ops_release_records x WHERE x.merged_at > now() - interval '60 days' AND v_since IS NOT NULL AND x.merged_at >= v_since ORDER BY x.merged_at LOOP
    v_owner := public.ops_release_owner(r.merged_by_login, r.author_login);
    v_common := jsonb_build_object(
      'owners', CASE WHEN v_owner IS NOT NULL THEN jsonb_build_array(v_owner) ELSE '[]'::jsonb END,
      'watchers', CASE WHEN v_boss IS NOT NULL AND v_boss IS DISTINCT FROM v_owner THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END,
      'due_on', v_due,
      'github', jsonb_build_array('https://github.com/Mingla-LLC/mingla-main/pull/' || r.pr)
                || COALESCE((SELECT jsonb_agg('#' || (x->>'number')) FROM jsonb_array_elements(r.issues) x), '[]'::jsonb));
    IF 'no_issue' = ANY (r.problems) AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(r.comment_urls) k WHERE k ~ '^[0-9]+$') THEN
      v_want := v_want || jsonb_build_object('eng_no_issue:pr-' || r.pr, v_common || jsonb_build_object(
        'title', format('Link an issue to PR #%s', r.pr),
        'instructions', format('PR #%s (%s) merged without an issue link. Find or open its issue on the Mingla Avengers board, add "toward #<issue>" to the PR description, then re-run "Release records" from the Actions tab with this PR number; the merge bot then writes its release record on the issue.', r.pr, left(r.title, 200)),
        'done_means', format('PR #%s has an issue and a release record.', r.pr)));
    END IF;
    IF r.problems && ARRAY['feature_guide_missing','feature_guide_invalid'] THEN
      v_want := v_want || jsonb_build_object('eng_guide_missing:pr-' || r.pr, v_common || jsonb_build_object(
        'title', format('Add the Feature Guide line for PR #%s', r.pr),
        'instructions', format('Edit PR #%s''s description and add "Feature Guide: <entry keys>" or "Feature Guide: none", then re-run "Release records" from the Actions tab with this PR number. The card closes by itself once the record shows the line.', r.pr),
        'done_means', 'The release record shows a Feature Guide line.'));
    END IF;
    FOR v_proj IN SELECT e.k FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) e(k, val) WHERE e.val = 'not_deployed' ORDER BY e.k LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.ops_release_records y WHERE y.merged_at > r.merged_at AND y.deploy->'web'->>v_proj = 'ready');
      v_want := v_want || jsonb_build_object(format('eng_not_deployed:pr-%s:%s', r.pr, v_proj), v_common || jsonb_build_object(
        'title', format('Deploy %s: PR #%s merged without [deploy]', v_proj, r.pr),
        'instructions', format('PR #%s changed %s but its title had no [deploy], so Vercel built nothing. Merge a follow-up commit whose subject contains [deploy], then confirm the production deployment is READY.', r.pr, v_proj),
        'done_means', format('%s production deployment is READY for this change.', v_proj)));
    END LOOP;
    FOR v_proj IN SELECT e.k FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) e(k, val) WHERE e.val = 'failed'
                  UNION ALL SELECT 'edge' WHERE r.deploy->>'edge' = 'failed' LOOP
      v_want := v_want || jsonb_build_object(format('eng_deploy_failed:pr-%s:%s', r.pr, v_proj), v_common || jsonb_build_object(
        'title', format('Fix the failed deploy of PR #%s', r.pr),
        'instructions', format('The %s deploy for PR #%s failed. Read the run, fix it and redeploy through the reviewed path.',
          CASE WHEN v_proj = 'edge' THEN 'edge function' ELSE v_proj || ' web' END, r.pr),
        'done_means', 'The deploy succeeded.'));
    END LOOP;
    IF 'migrations_pending' = ANY (r.problems) AND r.merged_at < now() - interval '24 hours' THEN
      v_want := v_want || jsonb_build_object('eng_migrations:pr-' || r.pr, v_common || jsonb_build_object(
        'title', format('Apply the migrations of PR #%s to production', r.pr),
        'instructions', format('PR #%s merged with migrations %s that the production ledger does not show yet. Apply them through the reviewed path with Seth''s go.',
          r.pr, array_to_string(ARRAY(SELECT x FROM unnest(r.migrations_added) x WHERE NOT x = ANY (r.migrations_applied)), ', ')),
        'done_means', format('Every migration of PR #%s is in the production ledger.', r.pr)));
    END IF;
    IF NOT r.complete AND r.merged_at < now() - interval '24 hours' AND EXISTS (SELECT 1 FROM unnest(r.problems) p WHERE p <> 'live_check_missing') THEN
      SELECT string_agg(public.ops_release_problem_words(p), ', ' ORDER BY p) INTO v_list FROM unnest(r.problems) p WHERE p <> 'live_check_missing';
      v_want := v_want || jsonb_build_object('eng_record_pending:pr-' || r.pr, v_common || jsonb_build_object(
        'title', format('Finish the release record of PR #%s', r.pr),
        'instructions', format('The release record of PR #%s is missing: %s. Fix each item; the record refreshes by itself.', r.pr, v_list),
        'done_means', format('The release record of PR #%s says Complete.', r.pr)));
    END IF;
    IF NOT r.complete AND r.merged_at < now() - interval '48 hours' AND r.problems = ARRAY['live_check_missing']::text[] THEN
      v_want := v_want || jsonb_build_object('eng_live_check:pr-' || r.pr, v_common || jsonb_build_object(
        'title', format('Do the live check for PR #%s', r.pr),
        'instructions', format('Check PR #%s''s change in production, then comment on the issue: "Live check: <what you checked and saw>".', r.pr),
        'done_means', 'The release record shows the live check.'));
    END IF;
  END LOOP;
  -- Issues Done on the board for a day without a complete record (once the bridge follows them).
  FOR g IN SELECT x.* FROM public.ops_github_items x
            WHERE x.kind = 'issue' AND x.board_status = 'Done' AND NOT x.not_found
              AND v_since IS NOT NULL AND x.done_seen_at >= v_since AND x.done_seen_at < now() - interval '24 hours' LOOP
    v_live := COALESCE((SELECT y.complete FROM public.ops_release_records y
                         WHERE y.issues @> jsonb_build_array(jsonb_build_object('number', g.number)) ORDER BY y.merged_at DESC LIMIT 1), false);
    CONTINUE WHEN v_live;
    v_want := v_want || jsonb_build_object('eng_done_not_live:issue-' || g.number, jsonb_build_object(
      'title', format('Issue #%s is Done but not Live', g.number),
      'instructions', format('Issue #%s is Done on the board but no complete release record names it. Finish its release record, or move it back on the board.', g.number),
      'done_means', format('Issue #%s is Live.', g.number),
      'owners', CASE WHEN v_boss IS NOT NULL THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END, 'watchers', '[]'::jsonb,
      'due_on', v_due, 'github', jsonb_build_array('#' || g.number)));
  END LOOP;
  -- Commits on main: pushed without a pull request, or merged with no record after 30 minutes.
  FOR m IN SELECT x.* FROM public.ops_main_commits x WHERE x.committed_at > now() - interval '14 days' AND v_since IS NOT NULL AND x.committed_at >= v_since ORDER BY x.committed_at LOOP
    v_owner := COALESCE(public.ops_login_email(m.author_login), v_boss);
    v_common := jsonb_build_object('owners', CASE WHEN v_owner IS NOT NULL THEN jsonb_build_array(v_owner) ELSE '[]'::jsonb END,
      'watchers', CASE WHEN v_boss IS NOT NULL AND v_boss IS DISTINCT FROM v_owner THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END,
      'due_on', v_due);
    IF m.pr IS NULL THEN
      v_want := v_want || jsonb_build_object('eng_no_pr_push:' || left(m.sha, 7), v_common || jsonb_build_object(
        'title', format('Commit %s reached main without a pull request', left(m.sha, 7)),
        'instructions', format('"%s" was pushed to main directly. Open an issue comment or follow-up PR that records it, and make sure nothing skipped review.', left(m.subject, 200)),
        'done_means', 'The change is recorded on an issue.'));
    ELSIF m.seen_at < now() - interval '30 minutes' AND NOT EXISTS (SELECT 1 FROM public.ops_release_records y WHERE y.pr = m.pr) THEN
      v_want := v_want || jsonb_build_object('eng_bot_missing:pr-' || m.pr, v_common || jsonb_build_object(
        'title', format('The release record for PR #%s was not written', m.pr),
        'instructions', format('The merge bot did not write a record for PR #%s. Re-run "Release records" from the Actions tab with this PR number.', m.pr),
        'done_means', format('PR #%s has a release record.', m.pr),
        'github', jsonb_build_array('https://github.com/Mingla-LLC/mingla-main/pull/' || m.pr)));
    END IF;
  END LOOP;
  -- The sync token was refused a status post in the last hour, with no successful post since.
  SELECT max(l.at) INTO v_refused_at FROM public.ops_agent_log l
   WHERE l.action = 'release_record' AND l.outcome = 'stopped' AND l.detail ? 'status_refused' AND l.at > clock_timestamp() - interval '1 hour';
  IF v_refused_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ops_release_records y WHERE y.status_posted_at > v_refused_at) THEN
    v_want := v_want || jsonb_build_object('eng_status_token', jsonb_build_object(
      'title', 'The sync token cannot post commit statuses',
      'instructions', 'Give the sync token permission to post commit statuses so release records show applied migrations.',
      'done_means', 'A migrations status shows on the latest merge commit.',
      'owners', CASE WHEN v_boss IS NOT NULL THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END, 'watchers', '[]'::jsonb,
      'due_on', v_due));
  END IF;

  -- Make the missing ones.
  FOR v_key, v_res IN SELECT e.key, e.value FROM jsonb_each(v_want) e ORDER BY e.key LOOP
    BEGIN
      v_res := public.ops_auto_card_upsert(v_key, v_res, 'task', NULL);
      IF v_res->>'status' = 'added' THEN v_added := v_added + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_engineering_cards_sync: % stopped (% %)', v_key, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  -- Close the open ones whose problem is gone. A commit pushed without a
  -- pull request is never closed by Mingla: a person closes it with proof.
  FOR w IN SELECT x.* FROM public.ops_work_cards x
            WHERE x.auto_key LIKE 'eng\_%' AND x.status <> 'done' AND x.archived_at IS NULL
              AND x.auto_key NOT LIKE 'eng\_no\_pr\_push:%' AND NOT v_want ? x.auto_key LOOP
    BEGIN
      PERFORM public.ops_auto_card_close(w.id, CASE split_part(w.auto_key, ':', 1)
          WHEN 'eng_no_issue' THEN 'The pull request has an issue and a release record.'
          WHEN 'eng_guide_missing' THEN 'The release record shows a Feature Guide line.'
          WHEN 'eng_not_deployed' THEN 'A later production deployment of this project is READY.'
          WHEN 'eng_deploy_failed' THEN 'The deploy no longer shows as failed.'
          WHEN 'eng_migrations' THEN 'Every migration is in the production ledger.'
          WHEN 'eng_record_pending' THEN 'The release record is complete apart from the live check.'
          WHEN 'eng_live_check' THEN 'The release record shows the live check.'
          WHEN 'eng_done_not_live' THEN 'The issue is Live, or no longer Done on the board.'
          WHEN 'eng_bot_missing' THEN 'The pull request has a release record.'
          WHEN 'eng_status_token' THEN 'A migrations status was posted.'
          ELSE 'The problem is gone.' END,
        jsonb_build_array(jsonb_build_object('text', 'Checked by Mingla against the release records and the production ledger.')));
      v_closed := v_closed + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_engineering_cards_sync: closing % stopped (% %)', w.auto_key, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('added', v_added, 'closed', v_closed);
END;
$$;

-- From 20271125003980. Adds brand auto-link and automatic steps,
-- each only while the owner has it switched on, and leaves repeating
-- expected events open (each date is matched by itself).
CREATE OR REPLACE FUNCTION public.ops_reconcile() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
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
  -- organic only. A card the owner or an admin overrode, or a person
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
            COALESCE(a->>'title', 'the event'), COALESCE(v_gate->>'lead_days', '21 or more')));
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
        format('Go-live met: %s is public on Mingla. The gate card closed itself.', COALESCE(a->>'title', 'the event')));
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

$$;

-- ---------------------------------------------------------------------------
-- 7. Grants. Internal helpers: service_role only. Client functions:
-- authenticated (each checks the caller) and service_role. Replaced
-- functions keep their grants.
-- ---------------------------------------------------------------------------
DO $grants3980syncw3$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ops_day_long(date)', 'public.ops_plain_state(jsonb,date)',
    'public.ops_expected_anchor(public.ops_expected_events,date)',
    'public.ops_expected_occurrences(public.ops_expected_events,date,integer)', 'public.ops_event_in_series(uuid,uuid,date)',
    'public.ops_host_next_rows(uuid[],date)', 'public.ops_live_totals(date)', 'public.ops_host_missing(public.crm_records)',
    'public.ops_auto_steps(date,uuid)', 'public.ops_brand_autolink_one(uuid)', 'public.ops_brand_autolink()',
    'public.ops_host_next(uuid[],date)', 'public.ops_attention(date)', 'public.ops_recent_changes(text,uuid,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$grants3980syncw3$;
GRANT EXECUTE ON FUNCTION public.ops_host_next(uuid[], date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_attention(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_recent_changes(text, uuid, integer) TO authenticated;
COMMENT ON FUNCTION public.ops_plain_state(jsonb, date) IS
  'Issue #3980. The plain state of a dated thing: Happened, Draft, not live / Not live yet (go live 28 days before), Ready to promote (live 28+ days ahead), Promote now (21 to 27) or Too late for promo, with one sentence using the real dates.';
COMMENT ON FUNCTION public.ops_auto_steps(date, uuid) IS
  'Issue #3980. Automatic steps from the timeline: at most one open card per key (go-live, giveaway and ads, recap, ask for the next event, one rolling card per repeating host), re-dated when the event moves and closed when it is cancelled. Run only while ops_settings.auto_steps is on; at most 50 new cards a run.';
COMMENT ON FUNCTION public.ops_brand_autolink() IS
  'Issue #3980. Brand auto-link for brands made after brand cards were switched on: one matching host card is linked, none makes a host card, two or more make a card for a person to pick. The only ops function that writes crm_records or crm_activity.';
COMMENT ON FUNCTION public.ops_attention(date) IS
  'Issue #3980. Needs attention: no owner, overdue, missing info, stuck, no next event and engineering follow-through. Each count is the length of its own list.';
COMMENT ON FUNCTION public.ops_recent_changes(text, uuid, integer) IS
  'Issue #3980. What just happened: the automatic changes on an event, an expected event or a host card, newest first, at most 8, in plain words.';

-- ---------------------------------------------------------------------------
-- 8. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $w3sync3980$
DECLARE
  c_client constant text[] := ARRAY[
    'ops_config(date)','ops_work_list(jsonb)','ops_work_get(uuid,date)','ops_work_add(jsonb,text)',
    'ops_work_update(uuid,jsonb,bigint,text)','ops_work_start(uuid,bigint)','ops_work_close(uuid,jsonb,text,bigint)',
    'ops_work_push_back(uuid,text,text,jsonb,bigint)','ops_work_reopen(uuid,text,bigint)','ops_work_note(uuid,text,text[],text)',
    'ops_work_person_action(uuid,text,text,bigint)','ops_work_undo(uuid)','ops_work_archive(uuid,text)','ops_my_counts(date)',
    'ops_review_list(date)','ops_link_search(text,text)','ops_record_signals(uuid)','ops_contact_override(uuid,text)',
    'ops_log_list(jsonb)','ops_claim(uuid,jsonb)','ops_release(uuid,uuid[])','ops_sprint_set_goal(date,text)',
    'ops_calendar(date,date,date)','ops_runway_report(date,date,date)','ops_anchor_detail(text,uuid,date)',
    'ops_host_on_mingla(uuid,date)','ops_expected_event_set(jsonb,text)',
    'ops_launch_kit_preview(text,uuid,jsonb,date)','ops_gate_override(uuid,text)','ops_team_overview(date)',
    'ops_next_action_preview(integer)','ops_next_action_convert(uuid[],text,text)',
    'ops_people_directory()','ops_profiles_list()','ops_profile_set(text,text,text)','ops_settings_get()',
    'ops_setting_set(text,jsonb)','ops_working_clear(uuid,text)',
    'ops_github_status_list(integer[])','ops_ticket_engineering(text,uuid)','ops_roadmap_links_list()',
    'ops_roadmap_link_set(uuid,text)','ops_roadmap_suggestion_decide(uuid,text)','ops_release_records_list(jsonb)',
    'ops_feature_guide_release(text)',
    -- Wave 3
    'ops_host_next(uuid[],date)','ops_attention(date)','ops_recent_changes(text,uuid,integer)'];
  r record; v_cfg text[];
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'ops\_%' AND p.proname <> 'ops_agent_call' LOOP
    SELECT array_agg(x) INTO v_cfg FROM unnest(r.proconfig) x WHERE x LIKE 'search_path=%';
    IF v_cfg IS NULL OR v_cfg[1] !~ ', pg_temp$' THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: % does not pin a search_path ending in pg_temp', r.sig; END IF;
    IF NOT r.prosecdef AND r.provolatile <> 'i' AND r.proname <> 'ops_agent_log_append_only' THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: % is not SECURITY DEFINER', r.sig; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR (SELECT bool_or(a.grantee = 0) FROM pg_catalog.pg_proc p2, aclexplode(COALESCE(p2.proacl, acldefault('f', p2.proowner))) a WHERE p2.oid = r.oid) THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: anon or PUBLIC can run %', r.sig; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') <> (replace(r.sig, 'public.', '') = ANY (c_client)) THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: client grant wrong for %', r.sig; END IF;
    -- D-9: one function writes pipeline tables, and only these two.
    IF r.prosrc ~* '(update|insert\s+into|delete\s+from)\s+public\.crm_' AND r.proname <> 'ops_brand_autolink_one' THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: % writes a pipeline table', r.sig; END IF;
    IF r.proname = 'ops_brand_autolink_one' AND (r.prosrc ~* '(update|insert\s+into|delete\s+from)\s+public\.crm_(?!records\s|activity\s)'
                                               OR r.prosrc ~* 'delete\s+from\s+public\.crm_'
                                               OR r.prosrc ~* 'insert\s+into\s+public\.crm_records') THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: % writes more than the brand link', r.sig; END IF;
    IF r.prosrc ~* '(public\.ad_|ad_plans|ad_campaigns)' THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: % reaches an ad table', r.sig; END IF;
    IF r.prosrc ~* 'insert\s+into\s+public\.community_roadmap_cards' AND r.proname <> 'ops_roadmap_draft_add' THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: % writes roadmap cards', r.sig; END IF;
    IF r.prosrc ~* '(update|delete\s+from)\s+public\.community_roadmap_cards' OR r.prosrc ~* 'community_announcement' THEN
      RAISE EXCEPTION 'issue 3980 synced W3 self-check: % changes what hosts are told', r.sig; END IF;
  END LOOP;
  IF (SELECT count(*) FROM unnest(c_client) s WHERE has_function_privilege('authenticated', 'public.' || s, 'EXECUTE')) <> cardinality(c_client) THEN
    RAISE EXCEPTION 'issue 3980 synced W3 self-check: a client function is missing'; END IF;
  IF (SELECT g.is_admin_hash FROM issue3980_sync_w3_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.is_admin_user()'::regprocedure))
     OR (SELECT g.crm_ctx_hash FROM issue3980_sync_w3_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.crm_ctx()'::regprocedure))
     OR (SELECT g.gateway_hash FROM issue3980_sync_w3_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.team_agent_call(text,text,jsonb,text)'::regprocedure))
     OR (SELECT g.brand_link_hash FROM issue3980_sync_w3_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.crm_apply_brand_link(uuid)'::regprocedure))
     OR (SELECT g.create_core_hash FROM issue3980_sync_w3_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.crm_record_create_core(text,jsonb,text,text)'::regprocedure))
     OR (SELECT g.roadmap_hash FROM issue3980_sync_w3_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.community_upsert_roadmap_card(uuid,text,text,text,text,text)'::regprocedure)) THEN
    RAISE EXCEPTION 'issue 3980 synced W3 self-check: an untouchable function changed'; END IF;
  -- Off by default: nothing is made by itself until the owner switches it on.
  IF COALESCE((SELECT (s.value #>> '{}')::boolean FROM public.ops_settings s WHERE s.key = 'auto_steps'), true)
     OR COALESCE((SELECT (s.value #>> '{}')::boolean FROM public.ops_settings s WHERE s.key = 'brand_auto_cards'), true) THEN
    RAISE EXCEPTION 'issue 3980 synced W3 self-check: an automatic switch is not off'; END IF;
  IF has_table_privilege('authenticated', 'public.ops_settings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ops_github_items', 'SELECT') THEN
    RAISE EXCEPTION 'issue 3980 synced W3 self-check: a table opened to clients'; END IF;
END;
$w3sync3980$;

COMMIT;

NOTIFY pgrst, 'reload schema';
