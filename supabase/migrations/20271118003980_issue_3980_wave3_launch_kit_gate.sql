-- Issue #3980, Wave 3: the launch kit, the giveaway and ads rule, the Team
-- dashboard's Runway and Sprint panels, and turning free-text next steps
-- into cards.
--
-- What this adds:
--   * Plan a launch: the eight launch kit cards for an event or an expected
--     event, counted back from its first date, with owners from the host
--     card (else the people named, else the person planning) for the host
--     steps and the planner for the marketing steps. It proposes only; the
--     cards are added through the same checked add as every other card.
--     Steps that already have a card, that are already done because the
--     event is public, or whose date has passed are listed as skipped, with
--     the reason. People and agents get the same answer.
--   * The giveaway and ads rule, kept by the ten-minute housekeeping run: a
--     giveaway and ads card is free to start only when its event is public
--     with 21 days or more left; otherwise it waits for go-live, or is held
--     as organic only. The owner or an admin can override it, with a reason
--     that is written to the agent log; an override is never undone by the
--     housekeeping run, and a card blocked by hand is left alone. When the
--     run frees a held card, its owners and watchers are told and the agent
--     log says so.
--   * A go-live gate card closes itself once its event is public on Mingla,
--     with the public time as its proof; its owners and watchers are told.
--   * The Team dashboard's overview for the owner and admins: runway counts
--     and what is at risk, this week's sprint by person, and how many host
--     cards have no owner.
--   * For the owner only: a preview of every open host and creator with a
--     free-text next step, and a convert that turns the chosen ones into
--     cards once each. Each card is titled "<next step> · <record name>",
--     so the same next step on different records gives different cards;
--     two records with the same name and next step give one card, and the
--     preview lists every record that is skipped, with the reason. It reads
--     the records and never changes them. This migration does not run it.
--   * The connector's plan_work tool now answers.
--   * A launch kit card sent back with the date the kit counted for it is
--     counted from the event (it keeps following the event's date).
--
-- Existing functions replaced: ops_validate_card (from
-- 20271116003980_issue_3980_wave1_work_board.sql), ops_reconcile and
-- ops_agent_call (from 20271117003980_issue_3980_wave2_calendar_host_sync.sql),
-- each copied whole with only the lines described above added. Signatures,
-- attributes and grants are unchanged.
--
-- NOT modified: is_admin_user(), team_agent_call, admin_list_offerings, role
-- areas, any crm_ table (read only), any ad table. Nothing here reaches
-- outside the database.
--
-- ROLLBACK (no down-migration file): roll the admin web client and the
-- team-agent function back first, then in one transaction restore
-- ops_validate_card from the Wave 1 migration and ops_reconcile and
-- ops_agent_call from the Wave 2 migration, and drop the functions this file
-- creates. Cards already added stay; conversions already recorded stay in
-- ops_next_action_conversions (created in Wave 1).

BEGIN;

-- A stuck lock aborts the apply instead of hanging.
SET LOCAL lock_timeout = '10s';

-- Remembered for the self-check at the end.
CREATE TEMP TABLE issue3980_w3_guard ON COMMIT DROP AS
SELECT md5(pg_get_functiondef('public.is_admin_user()'::regprocedure)) AS is_admin_hash,
       md5(pg_get_functiondef('public.admin_list_offerings'::regproc)) AS offerings_hash;

-- ---------------------------------------------------------------------------
-- 1. Internal helpers (service_role only; clients cannot run them).
-- ---------------------------------------------------------------------------

-- A list of up to 10 current teammates named in plan options, as emails.
CREATE FUNCTION public.ops_kit_people(p_value jsonb, p_label text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_out text[] := ARRAY[]::text[]; v_val jsonb; v_email text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN v_out; END IF;
  IF jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) > 10 THEN
    RAISE EXCEPTION '%', format('invalid_owners: %s takes a list of up to 10 current teammates.', p_label) USING ERRCODE = '22023';
  END IF;
  FOR v_val IN SELECT e FROM jsonb_array_elements(p_value) e LOOP
    v_email := CASE WHEN jsonb_typeof(v_val) = 'string' THEN public.ops_team_email(v_val #>> '{}') END;
    IF v_email IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_owners: "%s" is not on the team. Pick from %s.',
        left(COALESCE(v_val #>> '{}', ''), 80), public.ops_team_names()) USING ERRCODE = '22023';
    END IF;
    IF NOT v_email = ANY (v_out) THEN v_out := v_out || v_email; END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

-- The owners of a pipeline record who are on the team now.
CREATE FUNCTION public.ops_record_team_owners(p_record_id uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(array_agg(o.owner_email ORDER BY o.owner_email), ARRAY[]::text[])
    FROM public.crm_record_owners o
   WHERE o.record_id = p_record_id AND public.ops_team_email(o.owner_email) = o.owner_email
$$;

-- Open hosts and creators with a free-text next step, each with the card it
-- would become and what stops it, if anything. Reads the records only.
-- A card's title is "<next step> · <record name>" (at most 160 characters;
-- when it is longer, the next step is cut short with an ellipsis), so the
-- same next step on two different records gives two different cards. Two
-- records with the same name and the same next step give one card: the
-- later one is listed as duplicate_record, naming the one it repeats.
CREATE FUNCTION public.ops_next_action_rows(p_ids uuid[], p_limit integer, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record; v_rows jsonb := '[]'::jsonb; v_seen jsonb := '{}'::jsonb; v_title text; v_key text; v_owners text[];
  v_issue text; v_singular text; v_due date; v_name text; v_step text; v_room integer; v_part text;
  v_dup jsonb; v_open record; v_reason text;
BEGIN
  FOR r IN SELECT c.id, c.pipeline, c.name, c.stage, c.next_action, c.due_on FROM public.crm_records c
            WHERE c.deleted_at IS NULL AND c.pipeline IN ('hosts', 'creators') AND c.stage NOT IN ('lost', 'passed')
              AND btrim(COALESCE(c.next_action, '')) <> '' AND (p_ids IS NULL OR c.id = ANY (p_ids))
            ORDER BY c.due_on NULLS LAST, c.name, c.id
            LIMIT p_limit LOOP
    v_step := public.ops_one_line(r.next_action);
    v_singular := CASE r.pipeline WHEN 'hosts' THEN 'host' ELSE 'creator' END;
    v_name := COALESCE(public.ops_one_line(r.name), 'this ' || v_singular);
    -- The title: "<next step> · <name>", cut to the 160-character card title
    -- rule. A very long name keeps its first 80 characters; the next step
    -- takes the room left and ends with an ellipsis when it is cut.
    v_part := CASE WHEN char_length(v_name) > 80 THEN rtrim(left(v_name, 79)) || '…' ELSE v_name END;
    IF v_step IS NULL THEN
      v_title := NULL;
    ELSIF char_length(v_step) + 3 + char_length(v_part) <= 160 THEN
      v_title := v_step || ' · ' || v_part;
    ELSE
      v_room := 160 - 3 - char_length(v_part);
      v_title := rtrim(left(v_step, v_room - 1)) || '…' || ' · ' || v_part;
    END IF;
    v_key := CASE WHEN v_title IS NULL THEN '' ELSE public.crm_name_key(v_title) END;
    v_owners := public.ops_record_team_owners(r.id);
    v_due := CASE WHEN r.due_on IS NOT NULL AND r.due_on >= p_today THEN r.due_on ELSE p_today + 2 END;
    v_dup := NULL; v_reason := NULL;
    SELECT w.id, w.number, w.title INTO v_open FROM public.ops_work_cards w
     WHERE v_key <> '' AND w.title_key = v_key AND w.status <> 'done' AND w.archived_at IS NULL
     ORDER BY w.number LIMIT 1;
    v_issue := CASE
      WHEN EXISTS (SELECT 1 FROM public.ops_next_action_conversions x WHERE x.record_id = r.id) THEN 'already_converted'
      WHEN v_step IS NULL OR char_length(v_step) < 3 OR public.crm_name_key(v_step) = '' OR public.ops_has_control(v_step)
        OR public.ops_has_control(v_title) THEN 'too_short'
      WHEN v_seen ? v_key THEN 'duplicate_record'
      WHEN v_open.id IS NOT NULL THEN 'duplicate_title'
      WHEN cardinality(v_owners) = 0 THEN 'no_owner' END;
    IF v_issue = 'duplicate_record' THEN
      v_dup := v_seen->v_key;
      v_reason := format('Same name and next step as %s, which becomes the one card for both.', v_dup->>'name');
    ELSIF v_issue = 'duplicate_title' THEN
      v_dup := jsonb_build_object('card_id', v_open.id, 'card_number', v_open.number, 'title', v_open.title);
      v_reason := format('Card %s already has this title and is still open. Update that card, or change the next step on the record.', v_open.number);
    ELSIF v_issue = 'already_converted' THEN
      v_reason := 'This record''s next step is already a card. Each record is turned into a card once.';
    ELSIF v_issue = 'too_short' THEN
      v_reason := 'The next step is too short to be a card title. Write it out on the record first.';
    ELSIF v_issue = 'no_owner' THEN
      v_reason := 'Nobody on the team owns this record. It becomes a card only if you pick an owner for records nobody owns.';
    END IF;
    IF (v_issue IS NULL OR v_issue IN ('no_owner', 'already_converted')) AND v_key <> '' AND NOT v_seen ? v_key THEN
      v_seen := v_seen || jsonb_build_object(v_key, jsonb_build_object('record_id', r.id, 'name', r.name));
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'record_id', r.id, 'pipeline', r.pipeline, 'name', r.name, 'stage', r.stage, 'next_action', r.next_action, 'due_on', r.due_on,
      'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', x, 'name', public.ops_name(x)) ORDER BY x) FROM unnest(v_owners) x), '[]'::jsonb),
      'proposed', jsonb_build_object(
        'title', v_title,
        'instructions', left(format('Follow up with %s (%s): %s. Log what happens on the card.', v_name, v_singular, rtrim(COALESCE(v_step, ''), '.')), 4000),
        'done_means', left(format('The next step for %s is done and logged on the record.', v_name), 300),
        'owners', to_jsonb(v_owners), 'due_on', v_due,
        'links', jsonb_build_array(jsonb_build_object('kind', v_singular, 'id', r.id))),
      'issue', v_issue, 'reason', v_reason, 'duplicate_of', v_dup));
  END LOOP;
  RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Client functions. Each gates through crm_ctx() first (the crm area).
-- ---------------------------------------------------------------------------

-- The launch kit for one event or expected event, as cards ready to add.
-- Proposes only: nothing is written.
CREATE FUNCTION public.ops_launch_kit_preview(p_anchor_kind text, p_anchor_id uuid, p_options jsonb DEFAULT '{}'::jsonb,
                                              p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(p_today); a jsonb; v_opt jsonb; v_bad text; v_rec uuid; v_host jsonb;
  v_host_owners text[]; v_mkt text[]; v_watch text[]; v_rec_owners text[]; v_start date; v_public boolean; v_band text;
  v_title text; v_hostname text; v_d28 text; v_d21 text; k jsonb; v_step integer; v_due date; v_owners text[]; v_watchers text[];
  v_links jsonb; v_cards jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb; v_fill_title text;
  w_id uuid; w_number bigint; w_title text; w_status text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_anchor_kind IS NULL OR p_anchor_kind NOT IN ('event', 'expected') OR p_anchor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_anchor: Name the event or the expected event to plan.' USING ERRCODE = '22023';
  END IF;
  v_opt := CASE WHEN p_options IS NULL OR jsonb_typeof(p_options) = 'null' THEN '{}'::jsonb ELSE p_options END;
  IF jsonb_typeof(v_opt) <> 'object' THEN
    RAISE EXCEPTION 'invalid_options: Plan options take host_owner_emails, marketing_owner_emails and watcher_emails.' USING ERRCODE = '22023';
  END IF;
  SELECT o INTO v_bad FROM jsonb_object_keys(v_opt) o
   WHERE o NOT IN ('host_owner_emails', 'marketing_owner_emails', 'watcher_emails') ORDER BY o LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_options: Plan options take host_owner_emails, marketing_owner_emails and watcher_emails.' USING ERRCODE = '22023';
  END IF;
  v_host_owners := public.ops_kit_people(v_opt->'host_owner_emails', 'host_owner_emails');
  v_mkt := public.ops_kit_people(v_opt->'marketing_owner_emails', 'marketing_owner_emails');
  v_watch := public.ops_kit_people(v_opt->'watcher_emails', 'watcher_emails');

  a := public.ops_anchor(p_anchor_kind, p_anchor_id, v_today);
  IF a IS NULL THEN
    RAISE EXCEPTION 'not_found: That event is not on Mingla or not visible to the team.' USING ERRCODE = 'P0002';
  END IF;
  v_host := public.ops_host_json((a->>'record_id')::uuid);
  v_rec := CASE WHEN v_host IS NOT NULL THEN (a->>'record_id')::uuid END;
  v_rec_owners := CASE WHEN v_rec IS NOT NULL THEN public.ops_record_team_owners(v_rec) ELSE ARRAY[]::text[] END;
  v_start := (a->>'start_on')::date;
  v_public := COALESCE((a->>'is_public')::boolean, false);
  v_band := a->'runway'->>'band';
  v_title := COALESCE(a->>'title', 'the event');
  v_hostname := COALESCE(v_host->>'name', a->>'brand_name', 'the host');
  v_d28 := COALESCE(public.ops_day_words(v_start - 28), 'its go-live date');
  v_d21 := COALESCE(public.ops_day_words(v_start - 21), 'its promo date');
  v_links := jsonb_build_array(jsonb_build_object('kind', p_anchor_kind, 'id', p_anchor_id));
  IF v_rec IS NOT NULL THEN v_links := v_links || jsonb_build_array(jsonb_build_object('kind', 'host', 'id', v_rec)); END IF;

  FOR k IN SELECT e FROM jsonb_array_elements(public.ops_kit_template()) e ORDER BY (e->>'step')::integer LOOP
    v_step := (k->>'step')::integer;
    v_fill_title := left(replace(replace(replace(replace(k->>'title_template', '{title}', v_title), '{host}', v_hostname),
                                         '{date21}', v_d21), '{date}', v_d28), 160);
    SELECT c.id, c.number, c.title, c.status INTO w_id, w_number, w_title, w_status
      FROM public.ops_work_cards c
     WHERE c.anchor_kind = p_anchor_kind AND c.anchor_id = p_anchor_id AND c.kit_step = v_step AND c.archived_at IS NULL
     ORDER BY c.created_at DESC LIMIT 1;
    IF FOUND THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('kit_step', v_step, 'title', v_fill_title, 'reason', 'card_exists',
        'card', jsonb_build_object('id', w_id, 'number', w_number, 'title', w_title, 'status', w_status)));
      CONTINUE;
    END IF;
    IF v_start IS NULL THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('kit_step', v_step, 'title', v_fill_title, 'reason', 'no_date'));
      CONTINUE;
    END IF;
    IF v_public AND v_step IN (-35, -31, -28) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('kit_step', v_step, 'title', v_fill_title, 'reason', 'already_public'));
      CONTINUE;
    END IF;
    v_due := v_start + v_step;
    IF v_due < v_today AND v_step <> 2 AND NOT (v_step = -28 AND NOT v_public AND v_band IS DISTINCT FROM 'missed') THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('kit_step', v_step, 'title', v_fill_title, 'reason', 'date_passed', 'due_on', v_due));
      CONTINUE;
    END IF;
    v_owners := CASE WHEN k->>'who' = 'host_owner'
                     THEN COALESCE(NULLIF(v_rec_owners, ARRAY[]::text[]), NULLIF(v_host_owners, ARRAY[]::text[]), ARRAY[v.actor_email])
                     ELSE COALESCE(NULLIF(v_mkt, ARRAY[]::text[]), ARRAY[v.actor_email]) END;
    v_watchers := ARRAY(SELECT x FROM unnest(v_watch) x WHERE NOT x = ANY (v_owners) ORDER BY x);
    v_cards := v_cards || jsonb_build_array(jsonb_build_object(
      'kit_step', v_step, 'kind', k->>'kind', 'title', v_fill_title,
      'instructions', left(replace(replace(replace(replace(k->>'instructions_template', '{title}', v_title), '{host}', v_hostname),
                                           '{date21}', v_d21), '{date}', v_d28), 4000),
      'done_means', left(replace(replace(replace(replace(k->>'done_means_template', '{title}', v_title), '{host}', v_hostname),
                                         '{date21}', v_d21), '{date}', v_d28), 300),
      'owners', to_jsonb(v_owners), 'watchers', to_jsonb(v_watchers), 'due_on', v_due,
      'anchor', jsonb_build_object('kind', p_anchor_kind, 'id', p_anchor_id), 'links', v_links));
  END LOOP;
  RETURN jsonb_build_object('anchor', a, 'runway', a->'runway', 'host', v_host,
    'promo_gate', public.ops_promo_gate(a, v_today), 'cards', v_cards, 'skipped', v_skipped);
END;
$$;

-- The owner or an admin lets a giveaway and ads card start before its event
-- meets the rule, with a reason that is logged. People only.
CREATE FUNCTION public.ops_gate_override(p_card_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_reason text;
        v_before jsonb; v_event uuid; v_who text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'forbidden: Only the owner or an admin can let a giveaway and ads card start early.' USING ERRCODE = '42501';
  END IF;
  c := public.ops_card_lock(p_card_id, NULL);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: This card is already closed. Reopen it first.' USING ERRCODE = '22023'; END IF;
  IF c.kind <> 'promo' OR NOT c.blocked OR c.blocked_kind NOT IN ('waiting_go_live', 'organic_only') THEN
    RAISE EXCEPTION 'not_blocked: This card is not held by the giveaway and ads rule.' USING ERRCODE = '22023';
  END IF;
  v_reason := public.ops_one_line(p_reason);
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 10 AND 300 OR public.ops_has_control(v_reason) THEN
    RAISE EXCEPTION 'reason_required: Say why in 10 to 300 characters.' USING ERRCODE = '22023';
  END IF;
  v_who := public.ops_actor_label(v.actor_email, v.via);
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards w SET blocked = false, blocked_kind = NULL, blocked_reason = NULL,
         override_reason = v_reason, override_by = v.actor_email, override_at = clock_timestamp(),
         revision = revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
   WHERE w.id = c.id RETURNING w.* INTO n;
  v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'gate_override', v_reason, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(v.actor_email, NULL, 'gate_override', 'ok', c.id, 'work_card', c.id,
    format('%s let Card %s start before go-live: %s', v_who, n.number, v_reason),
    jsonb_build_object('was', c.blocked_kind, 'reason', v_reason));
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
    format('%s let "%s" start before go-live: %s', v_who, n.title, v_reason));
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$$;

-- The Team dashboard: runway, this week's sprint by person, host cards with
-- no owner. Owner and admins.
CREATE FUNCTION public.ops_team_overview(p_today date DEFAULT NULL) RETURNS jsonb
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
    'expected_soon', v_report->'at_risk');
END;
$$;

-- The owner's preview of free-text next steps turned into cards. Reads only.
CREATE FUNCTION public.ops_next_action_preview(p_limit integer DEFAULT 600) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(NULL); v_limit integer := COALESCE(p_limit, 600); v_rows jsonb; v_eligible bigint;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL OR public.admin_team_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'owner_only: Only the owner can turn next steps into cards.' USING ERRCODE = '42501';
  END IF;
  IF v_limit NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'invalid_limit: Ask for 1 to 600 records.' USING ERRCODE = '22023';
  END IF;
  v_rows := public.ops_next_action_rows(NULL, v_limit, v_today);
  SELECT count(*) INTO v_eligible FROM public.crm_records c
   WHERE c.deleted_at IS NULL AND c.pipeline IN ('hosts', 'creators') AND c.stage NOT IN ('lost', 'passed')
     AND btrim(COALESCE(c.next_action, '')) <> '';
  -- Every record that will not simply become a card, with the reason.
  RETURN jsonb_build_object('today', v_today, 'rows', v_rows,
    'skipped', COALESCE((SELECT jsonb_agg(jsonb_build_object('record_id', r->'record_id', 'pipeline', r->'pipeline', 'name', r->'name',
                          'next_action', r->'next_action', 'title', r->'proposed'->'title', 'issue', r->'issue', 'reason', r->'reason',
                          'duplicate_of', r->'duplicate_of') ORDER BY o)
                          FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(r, o) WHERE r->>'issue' IS NOT NULL), '[]'::jsonb),
    'totals', jsonb_build_object(
      'rows', jsonb_array_length(v_rows),
      'eligible', v_eligible,
      'truncated', v_eligible > jsonb_array_length(v_rows),
      'ready', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'issue' IS NULL),
      'no_owner', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'issue' = 'no_owner'),
      'already_converted', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'issue' = 'already_converted'),
      'duplicate_title', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'issue' = 'duplicate_title'),
      'duplicate_record', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'issue' = 'duplicate_record'),
      'skipped', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'issue' IS NOT NULL),
      'too_short', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'issue' = 'too_short')));
END;
$$;

-- The owner turns chosen next steps into cards, once per record. Cards go
-- through the same checked add as every other card; the records are read,
-- never changed.
CREATE FUNCTION public.ops_next_action_convert(p_record_ids uuid[], p_fallback_owner text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_ids uuid[]; v_fb text; v_replay jsonb; v_rows jsonb; r jsonb; v_id uuid;
  v_results jsonb := '[]'::jsonb; v_added integer := 0; v_skipped integer := 0; v_refused integer := 0; v_item jsonb; v_res jsonb;
  v_first jsonb; v_out jsonb; v_owners jsonb; v_card uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL OR public.admin_team_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'owner_only: Only the owner can turn next steps into cards.' USING ERRCODE = '42501';
  END IF;
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,70}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 70 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_record_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL ORDER BY x);
  IF cardinality(v_ids) NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'invalid_records: Choose 1 to 600 records.' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_fallback_owner, '')) <> '' THEN
    v_fb := public.ops_team_email(p_fallback_owner);
    IF v_fb IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_owner: "%s" is not on the team. Pick from %s.', left(p_fallback_owner, 80), public.ops_team_names())
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-convert', 'convert',
    jsonb_build_object('ids', to_jsonb(v_ids), 'fallback', v_fb));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  v_rows := public.ops_next_action_rows(v_ids, 600, v_today);
  FOREACH v_id IN ARRAY v_ids LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE e->>'record_id' = v_id::text);
    v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'refused', 'fixes', jsonb_build_array(
      jsonb_build_object('field', 'record', 'message', 'This record has no next step to turn into a card, or it is closed or removed.'))));
    v_refused := v_refused + 1;
  END LOOP;
  -- In the preview's order, so the record a repeat points at is done first.
  FOR r IN SELECT e FROM jsonb_array_elements(v_rows) e LOOP
    v_id := (r->>'record_id')::uuid;
    IF r->>'issue' = 'duplicate_record' THEN
      -- Same name and next step as a record above: one card for both. When
      -- that record's card exists, this record is recorded against it too,
      -- so it is never turned into a second card.
      v_card := (SELECT x.card_id FROM public.ops_next_action_conversions x WHERE x.record_id = (r->'duplicate_of'->>'record_id')::uuid);
      IF v_card IS NOT NULL THEN
        INSERT INTO public.ops_next_action_conversions (record_id, card_id, next_action_text, converted_by)
        VALUES (v_id, v_card, r->>'next_action', v.actor_email);
      END IF;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'skipped', 'reason', 'duplicate_record',
        'message', r->>'reason', 'duplicate_of', r->'duplicate_of', 'card_id', v_card));
      v_skipped := v_skipped + 1;
      CONTINUE;
    ELSIF r->>'issue' = 'already_converted' THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'skipped', 'reason', 'already_converted'));
      v_skipped := v_skipped + 1;
      CONTINUE;
    ELSIF r->>'issue' = 'too_short' THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'refused', 'fixes', jsonb_build_array(
        jsonb_build_object('field', 'title', 'message', 'The next step is too short to be a card title. Write it out on the record first.'))));
      v_refused := v_refused + 1;
      CONTINUE;
    ELSIF r->>'issue' = 'duplicate_title' THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'refused', 'fixes', jsonb_build_array(
        jsonb_build_object('field', 'title', 'message', format('Card %s already has the title "%s" and is still open. Change the next step on the record, or update that card.',
          r->'duplicate_of'->>'card_number', r->'proposed'->>'title')))));
      v_refused := v_refused + 1;
      CONTINUE;
    ELSIF r->>'issue' = 'no_owner' AND v_fb IS NULL THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'refused', 'fixes', jsonb_build_array(
        jsonb_build_object('field', 'owners', 'message', 'Nobody on the team owns this record. Pick a fallback owner.'))));
      v_refused := v_refused + 1;
      CONTINUE;
    END IF;
    v_owners := CASE WHEN r->>'issue' = 'no_owner' THEN jsonb_build_array(v_fb) ELSE r->'proposed'->'owners' END;
    v_item := (r->'proposed') || jsonb_build_object('owners', v_owners);
    v_res := public.ops_work_add(jsonb_build_array(v_item), 'nac' || substr(md5(p_request_key || ':' || v_id::text), 1, 24));
    v_first := v_res->'results'->0;
    IF v_first->>'status' = 'added' THEN
      v_card := (v_first->'card'->>'id')::uuid;
      INSERT INTO public.ops_next_action_conversions (record_id, card_id, next_action_text, converted_by)
      VALUES (v_id, v_card, r->>'next_action', v.actor_email);
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'added', 'card_id', v_card,
        'card_number', v_first->'card'->'number', 'title', v_first->'card'->'title'));
      v_added := v_added + 1;
    ELSIF v_first->>'status' = 'duplicate' THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'refused', 'fixes', jsonb_build_array(
        jsonb_build_object('field', 'title', 'message', v_first->>'message'))));
      v_refused := v_refused + 1;
    ELSE
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_id', v_id, 'status', 'refused',
        'fixes', COALESCE(v_first->'fixes', '[]'::jsonb)));
      v_refused := v_refused + 1;
    END IF;
  END LOOP;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'converted', 'info', NULL, NULL, NULL,
    format('Turned %s next steps into cards (%s skipped as already a card, %s not turned).', v_added, v_skipped, v_refused),
    jsonb_build_object('added', v_added, 'skipped', v_skipped, 'refused', v_refused));
  v_out := jsonb_build_object('results', v_results, 'added', v_added, 'skipped', v_skipped, 'refused', v_refused, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-convert', 'convert', v_out);
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Existing functions replaced, each copied whole with only the lines
-- named in its note added.
-- ---------------------------------------------------------------------------

-- ops_validate_card: unchanged except a launch kit card sent back with the
-- date the kit counted for it keeps following its event.
CREATE OR REPLACE FUNCTION public.ops_validate_card(p_item jsonb, p_mode text, p_actor text, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_keys constant text[] := ARRAY['title','instructions','done_means','owners','watchers','due_on','links','anchor','kit_step','kind','plan','person_reason'];
  v_fixes jsonb := '[]'::jsonb; v_bad text; v_title text; v_instr text; v_done text; v_people jsonb; v_links jsonb;
  v_anchor jsonb; v_anchor_kind text; v_anchor_id uuid; v_kit integer; v_kind text; v_due date; v_due_source text;
  v_plan jsonb; v_reason text; v_dup_id uuid; v_dup_number bigint; v_dup_title text; v_self uuid; v_dates integer;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RETURN jsonb_build_object('clean', NULL, 'fixes', jsonb_build_array(jsonb_build_object('field', 'item', 'message', 'Each card must be an object.')));
  END IF;
  IF p_mode = 'update' THEN
    v_self := (p_item->>'id')::uuid;
  ELSE
    SELECT k INTO v_bad FROM jsonb_object_keys(p_item) k WHERE NOT k = ANY (c_keys) ORDER BY k LIMIT 1;
    IF v_bad IS NOT NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'item', 'message',
        format('A card does not take "%s". It takes: title, instructions, done_means, owners, watchers, due_on, links, anchor, kit_step, kind, plan, person_reason.', left(v_bad, 60))));
    END IF;
  END IF;

  v_title := CASE WHEN jsonb_typeof(p_item->'title') = 'string' THEN public.ops_one_line(p_item->>'title') END;
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 160 OR public.crm_name_key(v_title) = '' OR public.ops_has_control(v_title) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message', 'Title is missing. Say what the work is in 3 to 160 characters.'));
    v_title := NULL;
  END IF;
  v_instr := CASE WHEN jsonb_typeof(p_item->'instructions') = 'string' THEN public.ops_multi_line(p_item->>'instructions') END;
  IF v_instr IS NULL OR char_length(v_instr) NOT BETWEEN 10 AND 4000 OR public.ops_has_control(v_instr) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'instructions', 'message', 'Instructions are missing. Say what the person or their agent should do (10 to 4,000 characters).'));
  END IF;
  v_done := CASE WHEN jsonb_typeof(p_item->'done_means') = 'string' THEN public.ops_one_line(p_item->>'done_means') END;
  IF v_done IS NULL OR char_length(v_done) NOT BETWEEN 5 AND 300 OR public.ops_has_control(v_done) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'done_means', 'message', 'Done means is empty. Add one line the work is checked against.'));
  END IF;

  v_people := public.ops_people_check(p_item->'owners', p_item->'watchers');
  v_fixes := v_fixes || (v_people->'fixes');
  v_links := public.ops_links_check(p_item->'links');
  v_fixes := v_fixes || (v_links->'fixes');

  -- kind
  v_kind := COALESCE(CASE WHEN jsonb_typeof(p_item->'kind') = 'string' THEN p_item->>'kind' END, 'task');
  IF v_kind NOT IN ('task','gate_live','promo') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kind', 'message', 'Kind must be task. Only the launch kit makes go-live gate and giveaway cards.'));
    v_kind := 'task';
  END IF;

  -- kit step
  IF p_item ? 'kit_step' AND jsonb_typeof(p_item->'kit_step') <> 'null' THEN
    IF jsonb_typeof(p_item->'kit_step') <> 'number' OR (p_item->>'kit_step') !~ '^-?\d{1,3}$'
       OR (p_item->>'kit_step')::integer NOT IN (-35,-31,-28,-26,-21,-14,-7,2) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kit_step', 'message', 'Kit step must be one of -35, -31, -28, -26, -21, -14, -7 or 2, and needs a linked event.'));
    ELSE
      v_kit := (p_item->>'kit_step')::integer;
    END IF;
  END IF;
  IF p_mode <> 'update' AND v_kind = 'gate_live' AND v_kit IS DISTINCT FROM -28 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kind', 'message', 'Only the launch kit makes go-live gate cards.'));
  END IF;
  IF p_mode <> 'update' AND v_kind = 'promo' AND v_kit IS DISTINCT FROM -21 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kind', 'message', 'Only the launch kit makes giveaway and ads cards.'));
  END IF;

  -- anchor: given, or the one event or expected event linked
  IF p_item ? 'anchor' AND jsonb_typeof(p_item->'anchor') <> 'null' THEN
    IF jsonb_typeof(p_item->'anchor') = 'object' AND p_item->'anchor'->>'kind' IN ('event','expected') AND public.ops_is_uuid(p_item->'anchor'->>'id') THEN
      v_anchor_kind := p_item->'anchor'->>'kind'; v_anchor_id := (p_item->'anchor'->>'id')::uuid;
      v_anchor := public.ops_anchor(v_anchor_kind, v_anchor_id, p_today);
    END IF;
    IF v_anchor IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'anchor', 'message', 'The event this card is counted from does not exist on Mingla or is not visible to the team.'));
      v_anchor_kind := NULL; v_anchor_id := NULL;
    END IF;
  ELSE
    SELECT count(*) INTO v_dates FROM jsonb_array_elements(v_links->'links') l WHERE l->>'kind' IN ('event','expected');
    IF v_dates = 1 THEN
      SELECT l->>'kind', (l->>'id')::uuid INTO v_anchor_kind, v_anchor_id FROM jsonb_array_elements(v_links->'links') l WHERE l->>'kind' IN ('event','expected');
      v_anchor := public.ops_anchor(v_anchor_kind, v_anchor_id, p_today);
    ELSIF v_dates > 1 AND (NOT (p_item ? 'due_on') OR jsonb_typeof(p_item->'due_on') = 'null' OR v_kit IS NOT NULL OR v_kind <> 'task') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'anchor', 'message', 'Several events are linked. Say which one this card is counted from (anchor).'));
    END IF;
  END IF;
  IF v_kit IS NOT NULL AND v_anchor IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' IN ('kit_step','anchor')) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kit_step', 'message', 'Kit step must be one of -35, -31, -28, -26, -21, -14, -7 or 2, and needs a linked event.'));
  END IF;
  IF v_kind <> 'task' AND v_anchor IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'anchor') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'anchor', 'message', 'The event this card is counted from does not exist on Mingla or is not visible to the team.'));
  END IF;
  -- the anchor is always also a link
  IF v_anchor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_links->'links') l WHERE l->>'kind' = v_anchor_kind AND l->>'id' = v_anchor_id::text) THEN
    v_links := jsonb_set(v_links, '{links}', (v_links->'links') || jsonb_build_array(jsonb_build_object('kind', v_anchor_kind, 'id', v_anchor_id, 'label', left(v_anchor->>'title', 160))));
    IF jsonb_array_length(v_links->'links') > 20 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'message' = 'A card can link at most 20 records.') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links', 'message', 'A card can link at most 20 records.'));
    END IF;
  END IF;

  -- due date: given, else counted back from the anchor
  IF p_item ? 'due_on' AND jsonb_typeof(p_item->'due_on') <> 'null' THEN
    BEGIN
      IF jsonb_typeof(p_item->'due_on') <> 'string' OR (p_item->>'due_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
      v_due := (p_item->>'due_on')::date; v_due_source := COALESCE(NULLIF(p_item->>'_due_source', ''), 'explicit');
    EXCEPTION WHEN others THEN v_due := NULL; v_due_source := 'bad';
    END;
    -- Wave 3: a launch kit card sent back with the date the kit counted for
    -- it is counted from the event, even when that date has just passed.
    IF p_mode <> 'update' AND v_due IS NOT NULL AND v_kit IS NOT NULL AND v_anchor IS NOT NULL
       AND (v_anchor->>'start_on') IS NOT NULL AND v_due = (v_anchor->>'start_on')::date + v_kit THEN
      v_due_source := 'kit';
    ELSIF v_due IS NULL OR (p_mode <> 'update' AND v_due < p_today - 1) OR v_due > p_today + 730 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'due_on', 'message', 'Due date must be a real date from today up to two years ahead.'));
      v_due := NULL;
    END IF;
  ELSIF v_anchor IS NOT NULL AND (v_anchor->>'start_on') IS NOT NULL THEN
    IF v_kit IS NOT NULL THEN v_due := (v_anchor->>'start_on')::date + v_kit; v_due_source := 'kit';
    ELSE v_due := (v_anchor->>'start_on')::date - 1; v_due_source := 'event'; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'anchor') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'due_on', 'message', 'No due date. Add one, or link an event and it is counted back from the start.'));
  END IF;

  -- needs a person
  IF p_item ? 'person_reason' AND jsonb_typeof(p_item->'person_reason') <> 'null' THEN
    IF jsonb_typeof(p_item->'person_reason') <> 'string' OR p_item->>'person_reason' NOT IN ('send','spend','publish','other') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'Needs a person must say why: send, spend, publish or other.'));
    ELSE v_reason := p_item->>'person_reason'; END IF;
  END IF;

  v_plan := public.ops_plan_check(p_item->'plan');
  IF v_plan IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'plan', 'message', 'Plan steps need a number, the step in words, and the tool that does it, or person.'));
  END IF;

  -- duplicates: an open card with the same title, or a card for the same kit step
  IF v_title IS NOT NULL THEN
    SELECT w.id, w.number, w.title INTO v_dup_id, v_dup_number, v_dup_title FROM public.ops_work_cards w
     WHERE w.title_key = public.crm_name_key(v_title) AND w.status <> 'done' AND w.archived_at IS NULL
       AND (v_self IS NULL OR w.id <> v_self) LIMIT 1;
  END IF;
  IF v_dup_id IS NULL AND v_kit IS NOT NULL AND v_anchor_id IS NOT NULL THEN
    SELECT w.id, w.number, w.title INTO v_dup_id, v_dup_number, v_dup_title FROM public.ops_work_cards w
     WHERE w.anchor_kind = v_anchor_kind AND w.anchor_id = v_anchor_id AND w.kit_step = v_kit AND w.archived_at IS NULL
       AND (v_self IS NULL OR w.id <> v_self) LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'clean', jsonb_build_object('title', v_title, 'instructions', v_instr, 'done_means', v_done,
      'owners', v_people->'owners', 'watchers', v_people->'watchers', 'links', v_links->'links',
      'anchor_kind', v_anchor_kind, 'anchor_id', v_anchor_id, 'anchor', v_anchor, 'kit_step', v_kit, 'kind', v_kind,
      'due_on', v_due, 'due_source', v_due_source, 'plan', COALESCE(v_plan, '[]'::jsonb), 'person_reason', v_reason),
    'fixes', v_fixes,
    'duplicate', CASE WHEN v_dup_id IS NOT NULL THEN jsonb_build_object('id', v_dup_id, 'number', v_dup_number, 'title', v_dup_title) END);
END;
$$;



-- ops_reconcile: unchanged except the Wave 3 steps for giveaway and ads cards
-- and go-live gate cards.
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
  RETURN jsonb_build_object('claims_expired', v_expired, 'request_keys_purged', v_purged, 'cards_carried', v_carried,
                            'expected_fulfilled', v_fulfilled, 'cards_re_anchored', v_moved,
                            'promo_unblocked', v_unblocked, 'promo_blocked', v_blocked, 'gates_closed', v_gates);
END;
$$;


-- ops_agent_call: unchanged except plan_work now answers.
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
    IF v_tool IN ('list_work', 'my_work', 'list_calendar', 'runway_report', 'plan_work') THEN
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
      WHEN 'plan_work' THEN
        IF (CASE WHEN jsonb_typeof(v_args->'event_id') = 'string' THEN 1 ELSE 0 END)
           + (CASE WHEN jsonb_typeof(v_args->'expected_event_id') = 'string' THEN 1 ELSE 0 END) <> 1 THEN
          RAISE EXCEPTION 'invalid_arguments: Send event_id or expected_event_id, one of them, as Mingla gave it.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_launch_kit_preview(
          CASE WHEN jsonb_typeof(v_args->'event_id') = 'string' THEN 'event' ELSE 'expected' END,
          (COALESCE(v_args->>'event_id', v_args->>'expected_event_id'))::uuid,
          jsonb_strip_nulls(jsonb_build_object('host_owner_emails', v_args->'host_owner_emails',
            'marketing_owner_emails', v_args->'marketing_owner_emails', 'watcher_emails', v_args->'watcher_emails')),
          v_date);
        v_summary := jsonb_build_object('cards', jsonb_array_length(v_result->'cards'), 'skipped', jsonb_array_length(v_result->'skipped'));
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
REVOKE ALL ON FUNCTION public.ops_kit_people(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_record_team_owners(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_next_action_rows(uuid[], integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_launch_kit_preview(text, uuid, jsonb, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_gate_override(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_team_overview(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_next_action_preview(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_next_action_convert(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_kit_people(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_record_team_owners(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_next_action_rows(uuid[], integer, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_launch_kit_preview(text, uuid, jsonb, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_gate_override(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_team_overview(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_next_action_preview(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_next_action_convert(uuid[], text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.ops_launch_kit_preview(text, uuid, jsonb, date) IS
  'Issue #3980. The launch kit cards for one event or expected event, counted back from its first date, ready for the checked add. Proposes only.';
COMMENT ON FUNCTION public.ops_gate_override(uuid, text) IS
  'Issue #3980. The owner or an admin lets a giveaway and ads card start before its event meets the rule, with a logged reason. People only.';
COMMENT ON FUNCTION public.ops_next_action_convert(uuid[], text, text) IS
  'Issue #3980. Owner only: turns chosen free-text next steps into cards, once per record. Reads the records and never changes them.';

-- ---------------------------------------------------------------------------
-- 5. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $w3check3980$
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
    'ops_next_action_preview(integer)','ops_next_action_convert(uuid[],text,text)'];
  c_new constant text[] := ARRAY['ops_kit_people','ops_record_team_owners','ops_next_action_rows','ops_launch_kit_preview',
    'ops_gate_override','ops_team_overview','ops_next_action_preview','ops_next_action_convert'];
  r record; v_cfg text[]; v_names text; v_src text;
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'ops\_%' LOOP
    IF r.proname = 'ops_agent_call' THEN
      IF NOT r.prosecdef OR NOT ('search_path=""' = ANY (r.proconfig)) THEN
        RAISE EXCEPTION 'issue 3980 wave 3 self-check: the gateway attributes changed'; END IF;
      IF has_function_privilege('authenticated', r.oid, 'EXECUTE') OR has_function_privilege('anon', r.oid, 'EXECUTE')
         OR NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'issue 3980 wave 3 self-check: the gateway is not service_role only'; END IF;
      CONTINUE;
    END IF;
    SELECT array_agg(x) INTO v_cfg FROM unnest(r.proconfig) x WHERE x LIKE 'search_path=%';
    IF v_cfg IS NULL OR v_cfg[1] !~ ', pg_temp$' THEN
      RAISE EXCEPTION 'issue 3980 wave 3 self-check: % does not pin a search_path ending in pg_temp', r.sig; END IF;
    IF NOT r.prosecdef AND r.provolatile <> 'i' AND r.proname <> 'ops_agent_log_append_only' THEN
      RAISE EXCEPTION 'issue 3980 wave 3 self-check: % is not SECURITY DEFINER', r.sig; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR (SELECT bool_or(a.grantee = 0) FROM pg_catalog.pg_proc p2, aclexplode(COALESCE(p2.proacl, acldefault('f', p2.proowner))) a WHERE p2.oid = r.oid) THEN
      RAISE EXCEPTION 'issue 3980 wave 3 self-check: anon or PUBLIC can run %', r.sig; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') <> (replace(r.sig, 'public.', '') = ANY (c_client)) THEN
      RAISE EXCEPTION 'issue 3980 wave 3 self-check: client grant wrong for %', r.sig; END IF;
    IF r.proname = ANY (c_new) AND r.prosrc ~* '(location_text|location_geo|organiser_contact|theme|public\.ad_|public\.orders|price)' THEN
      RAISE EXCEPTION 'issue 3980 wave 3 self-check: % reads more of an event than the team may see', r.sig; END IF;
    IF r.prosrc ~* '(update|insert\s+into|delete\s+from)\s+public\.crm_' THEN
      RAISE EXCEPTION 'issue 3980 wave 3 self-check: % writes a pipeline table', r.sig; END IF;
    IF replace(r.sig, 'public.', '') = ANY (c_client) AND (SELECT count(*) FROM pg_catalog.pg_proc p3 WHERE p3.oid = r.oid
          AND EXISTS (SELECT 1 FROM unnest(COALESCE(p3.proargnames, ARRAY[]::text[])) an
                       WHERE an ~ '^p_(via|actor|actor_email|uid|user_id|owner_email|email|key_hash|agent_name|as_user)$')) > 0 THEN
      RAISE EXCEPTION 'issue 3980 wave 3 self-check: % takes who is calling as an argument', r.sig; END IF;
  END LOOP;
  IF (SELECT count(*) FROM unnest(c_client) s WHERE has_function_privilege('authenticated', 'public.' || s, 'EXECUTE')) <> cardinality(c_client) THEN
    RAISE EXCEPTION 'issue 3980 wave 3 self-check: a client function is missing'; END IF;
  IF md5(pg_get_functiondef('public.is_admin_user()'::regprocedure)) IS DISTINCT FROM (SELECT g.is_admin_hash FROM issue3980_w3_guard g)
     OR md5(pg_get_functiondef('public.admin_list_offerings'::regproc)) IS DISTINCT FROM (SELECT g.offerings_hash FROM issue3980_w3_guard g) THEN
    RAISE EXCEPTION 'issue 3980 wave 3 self-check: an untouchable function changed'; END IF;
  v_src := (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.ops_agent_call(text,text,jsonb,text)'::regprocedure);
  SELECT string_agg(DISTINCT m[1], ',' ORDER BY m[1]) INTO v_names FROM regexp_matches(v_src, 'WHEN ''([a-z_]+)''', 'g') m;
  IF v_names IS DISTINCT FROM 'add_work,claim,close_work,list_calendar,list_work,my_work,plan_work,push_back,read_log,release,runway_report,set_expected_event,start_work,update_work' THEN
    RAISE EXCEPTION 'issue 3980 wave 3 self-check: the gateway tool list changed (%)', v_names; END IF;
  IF v_src ~ 'not_ready' OR v_src !~ 'ops_launch_kit_preview' THEN
    RAISE EXCEPTION 'issue 3980 wave 3 self-check: a work tool still answers not ready'; END IF;
  v_src := (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.ops_reconcile()'::regprocedure);
  IF v_src !~ 'gate_closed' OR v_src !~ 'ops_promo_gate' OR v_src !~ 'override_at IS NULL'
     OR v_src !~ 'The giveaway and ads card can start' THEN
    RAISE EXCEPTION 'issue 3980 wave 3 self-check: housekeeping does not keep the giveaway and ads rule'; END IF;
  IF jsonb_array_length(public.ops_kit_template()) <> 8 THEN
    RAISE EXCEPTION 'issue 3980 wave 3 self-check: the launch kit does not have eight steps'; END IF;
END;
$w3check3980$;

COMMIT;

NOTIFY pgrst, 'reload schema';
