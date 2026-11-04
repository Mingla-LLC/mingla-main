-- Issue #4270 (Wave 2) — the host card opens on what to do, and a Brand
-- group opens its host.
--
--   1. ops_work_cards gains on_brand_plan ("Host can see this task on their
--      plan"; off by default, D4), brand_plan_source (host_card or host_app)
--      and brand_plan_author_id (the host who added it, Wave 3). Read in
--      Wave 3; stored now.
--   2. ops_validate_card, ops_work_add and ops_work_update take on_brand_plan.
--      A person decides what hosts see: an agent cannot switch it on (D15,
--      42501 people_only). ops_work_add takes quick: true from the host card's
--      "Add work item" and writes the instructions and done means itself
--      (C-6); the card's source is host_card.
--   3. ops_card_json and ops_card_lite carry on_brand_plan and
--      brand_plan_source (and the lite card its tag).
--   4. ops_host_on_mingla: events, experiences and trips each say their kind
--      and whether they are on now; a trip or experience on now stays listed
--      (C-3; private and hidden events stay off). todo: open cards for any
--      host record of the brand, oldest due first, with owners and watchers.
--      team: Mingla owners and the brand's accepted team (names and roles, no
--      emails). The brand gains photo_url and slug. work and cards stay for
--      one release.
--   5. ops_expected_event_set refuses a new promised event (D9, D16), from the
--      host card and from the agent tool set_expected_event. A saved one can
--      still change, repeat, cancel or link to its event.
--   6. New ops_brand_host_record(brand_id): the host card for a brand, for the
--      Brand group header (staff with Hosts access only).
--
-- Static SQL only (no EXECUTE of built strings); write conflicts keep PT409.
-- CREATE OR REPLACE keeps every owner and grant. Do not auto-apply. Release
-- through the governed migration lane, after 20280403004270.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. What a host can see, and where a plan item came from.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_work_cards ADD COLUMN on_brand_plan boolean NOT NULL DEFAULT false;
ALTER TABLE public.ops_work_cards ADD COLUMN brand_plan_author_id uuid;
ALTER TABLE public.ops_work_cards ADD COLUMN brand_plan_source text;
ALTER TABLE public.ops_work_cards ADD CONSTRAINT ops_work_cards_plan_source_check
  CHECK (brand_plan_source IS NULL OR brand_plan_source IN ('host_card','host_app'));
ALTER TABLE public.ops_work_cards ADD CONSTRAINT ops_work_cards_plan_author_pair
  CHECK (brand_plan_author_id IS NULL OR brand_plan_source = 'host_app');
CREATE INDEX ops_work_cards_on_plan ON public.ops_work_cards (id) WHERE on_brand_plan AND archived_at IS NULL;
COMMENT ON COLUMN public.ops_work_cards.on_brand_plan IS
  'Issue #4270. Host can see this task on their brand plan. Off unless a person switches it on (an agent never does).';
COMMENT ON COLUMN public.ops_work_cards.brand_plan_source IS
  'Issue #4270. Where a plan item came from: host_card (staff, Add work item) or host_app (a host).';
COMMENT ON COLUMN public.ops_work_cards.brand_plan_author_id IS
  'Issue #4270. The host user who added this card from the Host app (Wave 3). Only with brand_plan_source host_app.';

-- ---------------------------------------------------------------------------
-- 2-5. Readers and writers (bodies copied from their latest definitions;
--      only the #4270 W2 lines change).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_validate_card(p_item jsonb, p_mode text, p_actor text, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_keys constant text[] := ARRAY['title','instructions','done_means','owners','watchers','due_on','links','anchor','kit_step','kind','plan','person_reason','github','files_url','on_brand_plan'];
  v_fixes jsonb := '[]'::jsonb; v_bad text; v_title text; v_instr text; v_done text; v_people jsonb; v_links jsonb;
  v_anchor jsonb; v_anchor_kind text; v_anchor_id uuid; v_kit integer; v_kind text; v_due date; v_due_source text;
  v_plan jsonb; v_reason text; v_files text; v_on_plan boolean := false; v_gh jsonb := '[]'::jsonb; v_g jsonb; v_p jsonb; v_dup_id uuid; v_dup_number bigint; v_dup_title text; v_self uuid; v_dates integer;
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
        format('A card does not take "%s". It takes: title, instructions, done_means, owners, watchers, due_on, links, anchor, kit_step, kind, plan, person_reason, github, files_url, on_brand_plan.', left(v_bad, 60))));
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
  IF p_mode = 'auto' THEN
    -- A card Mingla makes by itself may wait for someone to take it.
    v_people := jsonb_set(v_people, '{fixes}', COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(v_people->'fixes') f
                                                         WHERE f->>'message' NOT LIKE 'No owner.%'), '[]'::jsonb));
  END IF;
  v_fixes := v_fixes || (v_people->'fixes');
  -- GitHub links: issues and pull requests of this repository only.
  IF p_item ? 'github' AND jsonb_typeof(p_item->'github') <> 'null' THEN
    IF jsonb_typeof(p_item->'github') <> 'array' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message',
        'GitHub links must be a list, like ["#3980"].'));
    ELSIF jsonb_array_length(p_item->'github') > 10 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'A card can link at most 10 GitHub issues or pull requests.'));
    ELSE
      FOR v_g IN SELECT e FROM jsonb_array_elements(p_item->'github') e LOOP
        IF jsonb_typeof(v_g) = 'object' AND v_g->>'kind' IN ('issue','pull') AND (v_g->>'number') ~ '^[0-9]{1,7}$' THEN
          v_p := public.ops_github_parse(v_g->>'number');
          IF v_p ? 'number' THEN v_p := jsonb_build_object('kind', v_g->>'kind', 'number', v_p->'number'); END IF;
        ELSE
          v_p := public.ops_github_parse(CASE WHEN jsonb_typeof(v_g) = 'string' THEN v_g #>> '{}' END);
        END IF;
        IF v_p ? 'error' THEN
          v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message',
            format('GitHub link "%s": %s', left(COALESCE(CASE WHEN jsonb_typeof(v_g) = 'string' THEN v_g #>> '{}' ELSE v_g::text END, ''), 120), v_p->>'error')));
        ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_gh) x WHERE x->'number' = v_p->'number') THEN
          v_gh := v_gh || jsonb_build_array(v_p);
        END IF;
      END LOOP;
    END IF;
  END IF;
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

  -- the Send, Spend or Publish tag (#4270: a tag, not a status)
  IF p_item ? 'person_reason' AND jsonb_typeof(p_item->'person_reason') <> 'null' THEN
    IF jsonb_typeof(p_item->'person_reason') <> 'string' OR p_item->>'person_reason' NOT IN ('send','spend','publish','other') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'A Send, Spend or Publish tag must say which: send, spend, publish or other.'));
    ELSE v_reason := p_item->>'person_reason'; END IF;
  END IF;

  -- #4270: one Files link, https only (an empty string clears it)
  IF p_item ? 'files_url' AND jsonb_typeof(p_item->'files_url') <> 'null' THEN
    v_files := CASE WHEN jsonb_typeof(p_item->'files_url') = 'string' THEN btrim(p_item->>'files_url') END;
    IF v_files = '' THEN v_files := NULL;
    ELSIF v_files IS NULL OR char_length(v_files) NOT BETWEEN 9 AND 2000 OR v_files !~ '^https://[^[:space:]]+$'
          OR public.ops_has_control(v_files) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'files_url', 'message', 'Links start with https:// and stay under 2,000 characters.'));
      v_files := NULL;
    END IF;
  END IF;

  -- #4270 W2: "Host can see this task on their plan" (true or false).
  IF p_item ? 'on_brand_plan' AND jsonb_typeof(p_item->'on_brand_plan') <> 'null' THEN
    IF jsonb_typeof(p_item->'on_brand_plan') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'on_brand_plan', 'message', 'Host can see this must be true or false.'));
    ELSE v_on_plan := (p_item->>'on_brand_plan')::boolean; END IF;
  END IF;

  v_plan := public.ops_plan_check(p_item->'plan');
  IF v_plan IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'plan', 'message',
      COALESCE(public.ops_plan_problem(p_item->'plan'), 'Plan steps need a number, the step in words, and the tool that does it, or person.')));
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
      'due_on', v_due, 'due_source', v_due_source, 'plan', COALESCE(v_plan, '[]'::jsonb), 'person_reason', v_reason, 'github', v_gh, 'files_url', v_files, 'on_brand_plan', v_on_plan),
    'fixes', v_fixes,
    'duplicate', CASE WHEN v_dup_id IS NOT NULL THEN jsonb_build_object('id', v_dup_id, 'number', v_dup_number, 'title', v_dup_title) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_work_add(p_items jsonb, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_item jsonb; v_idx integer := 0; v_rows jsonb := '[]'::jsonb;
  v_chk jsonb; cl jsonb; c public.ops_work_cards; v_event uuid; v_gate jsonb; v_added integer := 0; v_refused integer := 0;
  v_dups integer := 0; v_out jsonb; v_fields text; v_owners text[]; v_watchers text[]; v_ex_id uuid; v_ex_number bigint; v_ex_title text; v_who text;
  v_quick boolean; v_host_name text; v_source text; -- #4270 W2: a quick add from a host card
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_cards: Send a list of 1 to 50 cards.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-add', 'add', p_items);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_who := public.ops_actor_label(v.actor_email, v.via);
  -- #4270 W2 (D15): a person decides what hosts see. An agent never adds a
  -- card the host can see on their plan.
  IF v.via IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
                                    WHERE jsonb_typeof(e) = 'object' AND e->'on_brand_plan' = 'true'::jsonb) THEN
    RAISE EXCEPTION 'people_only: A person decides what hosts see.' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY e(value, ord) ORDER BY e.ord LOOP
    -- #4270 W2 (C-6): a quick add from a host card says what, who and when;
    -- Mingla writes the instructions and done means, and staff can edit them.
    v_quick := jsonb_typeof(v_item) = 'object' AND v_item->'quick' = 'true'::jsonb;
    v_source := NULL;
    IF jsonb_typeof(v_item) = 'object' AND v_item ? 'quick' THEN
      v_item := v_item - 'quick';
    END IF;
    IF v_quick THEN
      v_source := 'host_card';
      SELECT r.name INTO v_host_name FROM public.crm_records r
       WHERE r.deleted_at IS NULL AND r.pipeline = 'hosts'
         AND r.id = (SELECT CASE WHEN public.ops_is_uuid(l->>'id') THEN (l->>'id')::uuid END
                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_item->'links') = 'array' THEN v_item->'links' ELSE '[]'::jsonb END) l
                      WHERE l->>'kind' = 'host' LIMIT 1);
      IF NOT (v_item ? 'instructions') OR jsonb_typeof(v_item->'instructions') <> 'string' OR btrim(v_item->>'instructions') = '' THEN
        v_item := v_item || jsonb_build_object('instructions',
          format('Added by %s from %s''s host card.', v_who, COALESCE(v_host_name, 'a host')));
      END IF;
      IF NOT (v_item ? 'done_means') OR jsonb_typeof(v_item->'done_means') <> 'string' OR btrim(v_item->>'done_means') = '' THEN
        v_item := v_item || jsonb_build_object('done_means',
          CASE WHEN v_item->'on_brand_plan' = 'true'::jsonb THEN 'Done and the host is told in the Brand group.' ELSE 'Done with proof on this card.' END);
      END IF;
    END IF;
    v_chk := public.ops_validate_card(v_item, 'add', v.actor_email, v_today);
    IF jsonb_array_length(v_chk->'fixes') > 0 THEN
      SELECT string_agg(DISTINCT public.ops_field_words(f->>'field'), ', ') INTO v_fields FROM jsonb_array_elements(v_chk->'fixes') f;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused', 'fixes', v_chk->'fixes',
        'title', v_chk->'clean'->'title'));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', NULL, NULL, NULL,
        format('Card not added (%s): %s to fix.', COALESCE(v_chk->'clean'->>'title', 'no title'), v_fields),
        jsonb_build_object('fields', (SELECT jsonb_agg(DISTINCT f->>'field') FROM jsonb_array_elements(v_chk->'fixes') f)));
      v_refused := v_refused + 1;
    ELSIF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate', 'existing', v_chk->'duplicate',
        'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', (v_chk->'duplicate'->>'id')::uuid, 'work_card', (v_chk->'duplicate'->>'id')::uuid,
        format('Card not added: it repeats Card %s.', v_chk->'duplicate'->>'number'), '{}'::jsonb);
      v_dups := v_dups + 1;
    ELSE
      cl := v_chk->'clean';
      v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
      v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
      v_gate := CASE WHEN cl->>'kind' = 'promo' THEN public.ops_promo_gate(cl->'anchor', v_today) END;
      BEGIN
        INSERT INTO public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, person_reason, files_url,
          on_brand_plan, brand_plan_source, kind, kit_step, anchor_kind, anchor_id, due_on, due_source, sprint_id, plan, created_by, created_via, updated_by, updated_via, request_key)
        VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
          'todo', -- #4270: a tagged card waits in To do; the tag is person_reason
          COALESCE((v_gate->>'blocked')::boolean, false),
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'kind' END,
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'reason' END,
          cl->>'person_reason', cl->>'files_url', COALESCE((cl->>'on_brand_plan')::boolean, false), v_source, cl->>'kind', (cl->>'kit_step')::integer, cl->>'anchor_kind', (cl->>'anchor_id')::uuid,
          (cl->>'due_on')::date, cl->>'due_source', public.ops_sprint_for((cl->>'due_on')::date, v_today), cl->'plan',
          v.actor_email, v.via, v.actor_email, v.via, p_request_key || '-i' || v_idx)
        RETURNING * INTO c;
        PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
        PERFORM public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
        v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
        IF public.ops_github_set(c.id, cl->'github', v.actor_email, v.via) THEN
          PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'github',
            'GitHub: ' || (SELECT string_agg('#' || (g->>'number'), ', ') FROM jsonb_array_elements(cl->'github') g), NULL, NULL, c.revision, c.revision);
        END IF;
        PERFORM public.ops_notify_people(c.id, v_event, v_owners, v.actor_email, format('%s added you as owner: %s', v_who, c.title));
        PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v.actor_email, format('%s added you as watcher: %s', v_who, c.title));
        PERFORM public.ops_log_write(v.actor_email, v.via, 'card_added', 'ok', c.id, 'work_card', c.id,
          format('Added Card %s: %s', c.number, c.title), jsonb_build_object('owners', cardinality(v_owners), 'watchers', cardinality(v_watchers)));
        IF c.person_reason IS NOT NULL THEN
          PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
            format('Card %s is tagged %s: %s', c.number, CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, c.title), jsonb_build_object('reason', c.person_reason));
        END IF;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'added', 'card', public.ops_card_json(c, v_today)));
        v_added := v_added + 1;
      EXCEPTION WHEN unique_violation THEN
        SELECT w.id, w.number, w.title INTO v_ex_id, v_ex_number, v_ex_title FROM public.ops_work_cards w
         WHERE w.archived_at IS NULL AND ((w.title_key = public.crm_name_key(cl->>'title') AND w.status <> 'done')
            OR (w.anchor_kind = cl->>'anchor_kind' AND w.anchor_id = (cl->>'anchor_id')::uuid AND w.kit_step = (cl->>'kit_step')::integer))
         LIMIT 1;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate',
          'existing', jsonb_build_object('id', v_ex_id, 'number', v_ex_number, 'title', v_ex_title),
          'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_ex_title, v_ex_number)));
        v_dups := v_dups + 1;
      END;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  v_out := jsonb_build_object('results', v_rows, 'added', v_added, 'refused', v_refused, 'duplicate', v_dups, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-add', 'add', v_out);
  RETURN v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM ~ '^[a-z_]+: ' THEN RAISE; END IF;
  RAISE WARNING 'ops_work_add: request stopped (% %)', SQLSTATE, SQLERRM;
  RAISE EXCEPTION 'try_again: Something went wrong on our side, so nothing in this request was added. Send the same request again.' USING ERRCODE = 'PT409';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ops_work_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text;
  v_before jsonb; v_item jsonb; v_chk jsonb; cl jsonb; v_fixes jsonb; v_people jsonb; v_links_changed boolean := false;
  v_cats text[] := ARRAY[]::text[]; v_action text; v_event uuid; v_out jsonb; v_gate jsonb; v_week date; v_who text;
  v_status text; v_reason text; v_result text; v_breason text; v_owners text[]; v_watchers text[]; v_anchor_changed boolean := false;
  v_back boolean := false; v_back_reason text; -- Wave 2: leaving Needs a person; #4270: taking the tag off
  v_alias boolean := false; -- #4270: the old status person, read as To do with a tag
  v_removed_words text; -- #3980 rework 2: who was taken off, for the agent log
  v_gh_changed boolean := false; v_chat text;
  v_gh_list text; v_gh_wait boolean := false; -- #3980 synced, Wave 2: waiting for GitHub
  v_gh_cur text; -- #3980 W2 rework: the links a waiting card has now
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_chat := CASE WHEN v.via IS NOT NULL THEN public.ops_ctx_chat() END;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one field to change.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('title','instructions','done_means','due_on','week','owners','watchers','links','anchor','plan','result',
                   'blocked','blocked_reason','status','person_reason','reason','github','blocked_on_github','files_url','on_brand_plan') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A card change does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'update',
    jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
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
    'files_url', CASE WHEN p_changes ? 'files_url' THEN p_changes->'files_url' ELSE to_jsonb(c.files_url) END,
    'on_brand_plan', CASE WHEN p_changes ? 'on_brand_plan' THEN p_changes->'on_brand_plan' ELSE to_jsonb(c.on_brand_plan) END,
    'plan', CASE WHEN p_changes ? 'plan' THEN p_changes->'plan' ELSE c.plan END,
    'github', CASE WHEN p_changes ? 'github' THEN p_changes->'github'
                   ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', g.kind, 'number', g.number) ORDER BY g.number)
                                    FROM public.ops_work_github g WHERE g.card_id = c.id), '[]'::jsonb) END,
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

  -- status, the Send/Spend/Publish tag, blocked, result, week
  -- #4270: status is todo or doing. The old status person is still accepted
  -- from agents and old prompts: it means To do with a tag (person_reason),
  -- which is then required. A status change never clears the tag.
  v_status := c.status; v_reason := c.person_reason;
  IF p_changes ? 'status' THEN
    IF jsonb_typeof(p_changes->'status') <> 'string' OR p_changes->>'status' NOT IN ('todo','doing','person') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Status can be todo or doing. Close a card with proof, or push it back.'));
    ELSIF p_changes->>'status' = 'person' THEN v_status := 'todo'; v_alias := true;
    ELSE v_status := p_changes->>'status'; END IF;
  END IF;
  IF p_changes ? 'person_reason' THEN v_reason := cl->>'person_reason'; END IF;
  IF v_alias AND v_reason IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'A Send, Spend or Publish tag must say which: send, spend, publish or other.'));
  END IF;
  -- Wave 2 / #4270: taking the tag off a card (what leaving Needs a person
  -- was) needs a reason from an agent; the log records it and owners and
  -- watchers are told.
  -- #4270 rework (P3-2): a tag that is not one of the four words (an empty
  -- string, say) is refused as a bad tag below, not as a missing reason.
  v_back := c.person_reason IS NOT NULL AND v_reason IS NULL
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'person_reason');
  IF v_back THEN
    v_back_reason := CASE WHEN jsonb_typeof(p_changes->'reason') = 'string' THEN left(public.ops_one_line(p_changes->>'reason'), 500) END;
    IF public.ops_has_control(v_back_reason) THEN v_back_reason := NULL; END IF;
    IF v.via IS NOT NULL AND v_back_reason IS NULL THEN
      RAISE EXCEPTION 'reason_required: Say why this card no longer needs its Send, Spend or Publish tag. Your person and the card''s watchers are told.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- #3980 W2 rework 3: an agent never moves a roadmap approval card or
  -- changes what it waits for, so it cannot send it back and then close it.
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (v_status IS DISTINCT FROM c.status OR v_reason IS DISTINCT FROM c.person_reason) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person moves this card.' USING ERRCODE = '42501';
  END IF;
  n := c;
  -- #4270 W2 (D15): "Host can see this". A person decides what hosts see: an
  -- agent cannot switch it on.
  IF p_changes ? 'on_brand_plan' AND jsonb_typeof(p_changes->'on_brand_plan') = 'boolean' THEN
    IF v.via IS NOT NULL AND (p_changes->>'on_brand_plan')::boolean AND NOT c.on_brand_plan THEN
      RAISE EXCEPTION 'people_only: A person decides what hosts see.' USING ERRCODE = '42501';
    END IF;
    n.on_brand_plan := (p_changes->>'on_brand_plan')::boolean;
  END IF;
  -- Wave 2: the GitHub issues and pull requests the card waits for.
  SELECT string_agg('#' || (x->>'number'), ', ' ORDER BY (x->>'number')::integer) INTO v_gh_list
    FROM jsonb_array_elements(COALESCE(cl->'github', '[]'::jsonb)) x;
  SELECT string_agg('#' || g.number, ', ' ORDER BY g.number) INTO v_gh_cur FROM public.ops_work_github g WHERE g.card_id = c.id;
  -- #3980 W2 rework: an agent cannot change what a waiting card waits for
  -- (adding, removing or swapping a link would let it lift the wait); a
  -- person can, and the agent log says who did.
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL AND p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_cur, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL
     AND ((p_changes ? 'blocked_on_github' AND jsonb_typeof(p_changes->'blocked_on_github') = 'boolean' AND NOT (p_changes->>'blocked_on_github')::boolean)
          OR (NOT (p_changes ? 'blocked_on_github') AND p_changes ? 'blocked')) THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_list, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'blocked_on_github' THEN
    v_gh_wait := true;
    IF jsonb_typeof(p_changes->'blocked_on_github') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_on_github', 'message', 'Blocked until Live must be true or false.'));
    ELSIF (p_changes->>'blocked_on_github')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      IF v_gh_list IS NULL THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'Link a GitHub issue or pull request first; the card then waits for it to be Live.'));
      ELSE n.blocked := true; n.blocked_kind := 'github'; n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
    ELSIF c.blocked_kind = 'github' THEN
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked' THEN
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
  -- Wave 2: a card waiting for GitHub keeps its reason in step with its links.
  IF NOT v_gh_wait AND n.blocked_kind = 'github' AND p_changes ? 'github' THEN
    IF v_gh_list IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'A card waiting for GitHub keeps at least one GitHub link. Lift the wait first.'));
    ELSE n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
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
  n.status := v_status; n.person_reason := v_reason; n.files_url := cl->>'files_url';
  IF v_status = 'doing' AND c.status <> 'doing' THEN n.started_at := COALESCE(c.started_at, clock_timestamp()); n.working_by := v.actor_email; n.working_via := v.via; END IF;
  -- Back to To do: nobody is working on it any more, so the mark ends.
  IF v_status = 'todo' AND c.status = 'doing' THEN n.working_by := NULL; n.working_via := NULL; END IF;
  n.sprint_id := CASE WHEN v_week IS NOT NULL THEN public.ops_sprint_ensure(v_week) ELSE c.sprint_id END;
  IF c.kind = 'promo' AND v_anchor_changed AND c.override_at IS NULL THEN
    v_gate := public.ops_promo_gate(cl->'anchor', v_today);
    n.blocked := (v_gate->>'blocked')::boolean;
    n.blocked_kind := CASE WHEN n.blocked THEN v_gate->>'kind' END;
    n.blocked_reason := CASE WHEN n.blocked THEN v_gate->>'reason' END;
  END IF;

  -- #3980 W2 rework 4: on a roadmap approval card an agent changes nothing
  -- that ties it to its draft or decides whether it is open: its links, its
  -- GitHub links, blocked or waiting, or its anchor. Its wording, plan,
  -- result and due date stay editable. (A trigger refuses the same for every
  -- other writer.)
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (ROW(n.blocked, n.blocked_kind, n.blocked_reason, n.anchor_kind, n.anchor_id)
            IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason, c.anchor_kind, c.anchor_id)
          OR (p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur)
          OR (p_changes ? 'links' AND
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT l.kind || ':' || l.target_id::text AS k FROM public.ops_work_links l WHERE l.card_id = c.id) a)
              IS DISTINCT FROM
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT (x->>'kind') || ':' || lower(x->>'id') AS k FROM jsonb_array_elements(COALESCE(cl->'links', '[]'::jsonb)) x) b))) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes what this card links to or waits for.' USING ERRCODE = '42501';
  END IF;
  -- #3980 W2 follow-up: nor who owns or watches it (the same test
  -- ops_people_set uses for "changed"; a trigger backstops every writer).
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (public.ops_card_people(c.id, 'owner')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)) x ORDER BY x)
          OR public.ops_card_people(c.id, 'watcher')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'watchers', '[]'::jsonb)) x
                                    WHERE NOT x = ANY (ARRAY(SELECT jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)))) ORDER BY x)) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes who owns or watches this card.' USING ERRCODE = '42501';
  END IF;

  IF ROW(n.title, n.instructions, n.done_means, n.due_on, n.sprint_id, n.anchor_kind, n.anchor_id, n.result, n.files_url, n.on_brand_plan)
     IS DISTINCT FROM ROW(c.title, c.instructions, c.done_means, c.due_on, c.sprint_id, c.anchor_kind, c.anchor_id, c.result, c.files_url, c.on_brand_plan) THEN
    v_cats := v_cats || 'updated'::text;
  END IF;
  IF n.plan IS DISTINCT FROM c.plan THEN v_cats := v_cats || 'plan'::text; END IF;
  IF ROW(n.status, n.person_reason) IS DISTINCT FROM ROW(c.status, c.person_reason) THEN v_cats := v_cats || 'status'::text; END IF;
  IF ROW(n.blocked, n.blocked_kind, n.blocked_reason) IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason) THEN
    v_cats := v_cats || CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END;
  END IF;

  UPDATE public.ops_work_cards SET title = n.title, instructions = n.instructions, done_means = n.done_means,
    status = n.status, person_reason = n.person_reason, files_url = n.files_url, on_brand_plan = n.on_brand_plan, blocked = n.blocked, blocked_kind = n.blocked_kind, blocked_reason = n.blocked_reason,
    anchor_kind = n.anchor_kind, anchor_id = n.anchor_id, due_on = n.due_on, due_source = n.due_source, sprint_id = n.sprint_id,
    plan = n.plan, result = n.result, started_at = n.started_at, working_by = n.working_by, working_via = n.working_via,
    working_chat = CASE WHEN v_status = 'doing' AND c.status <> 'doing' THEN v_chat
                        WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_chat END,
    working_seen_at = CASE WHEN v_status = 'doing' AND c.status <> 'doing' AND v.via IS NOT NULL THEN clock_timestamp()
                           WHEN v_status = 'doing' AND c.status <> 'doing' THEN NULL
                           WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_seen_at END
   WHERE id = c.id;
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  v_people := public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
  IF (v_people->>'changed')::boolean THEN v_cats := v_cats || 'people'::text; END IF;
  v_links_changed := public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
  IF v_links_changed THEN v_cats := v_cats || 'links'::text; END IF;
  IF p_changes ? 'github' THEN
    v_gh_changed := public.ops_github_set(c.id, cl->'github', v.actor_email, v.via);
    IF v_gh_changed THEN v_cats := v_cats || 'github'::text; END IF;
    -- #3980 W2 rework: a person changing what a waiting card waits for is logged by name.
    IF v_gh_changed AND c.blocked_kind = 'github' AND v.via IS NULL THEN
      PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', c.id, 'work_card', c.id,
        format('%s changed what Card %s waits for: %s (was %s).', v_who, c.number, COALESCE(v_gh_list, 'nothing'), COALESCE(v_gh_cur, 'nothing')),
        jsonb_build_object('changed', '["github"]'::jsonb, 'from', v_gh_cur, 'to', v_gh_list, 'waiting', true));
    END IF;
  END IF;

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
  -- #4270: a card that gets a Send, Spend or Publish tag stays in its column
  -- and waits for a person; owners and watchers are told.
  IF n.person_reason IS NOT NULL AND c.person_reason IS NULL THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      -- #4270 rework (P3-4): the tag's own words, never "needs a person".
      format('%s: %s · %s', v_who, n.title, CASE n.person_reason WHEN 'send' THEN 'You send' WHEN 'spend' THEN 'You spend' WHEN 'publish' THEN 'You publish' ELSE 'Needs your OK' END));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
      format('Card %s is tagged %s: %s', n.number, CASE n.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title), jsonb_build_object('reason', n.person_reason));
  ELSIF v_back THEN
    -- Wave 2: told and logged when a card's tag comes off.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s took the %s tag off %s%s', v_who, CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title,
        COALESCE(': ' || v_back_reason, '')));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'info', c.id, 'work_card', c.id,
      format('Card %s no longer has its %s tag%s', n.number,
        CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END,
        COALESCE(': ' || v_back_reason, '.')),
      jsonb_build_object('changed', to_jsonb(v_cats), 'from', c.person_reason, 'to', n.status, 'reason', v_back_reason));
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

$function$
;

CREATE OR REPLACE FUNCTION public.ops_card_json(c public.ops_work_cards, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_sprint public.ops_sprints; v_working jsonb := public.ops_working_json(c);
BEGIN
  SELECT * INTO v_sprint FROM public.ops_sprints s WHERE s.id = c.sprint_id;
  RETURN jsonb_build_object(
    'id', c.id, 'number', c.number, 'title', c.title, 'instructions', c.instructions, 'done_means', c.done_means,
    'status', c.status, 'blocked', c.blocked, 'blocked_kind', c.blocked_kind, 'blocked_reason', c.blocked_reason,
    'person_reason', c.person_reason, 'tag', c.person_reason, 'files_url', c.files_url,
    'on_brand_plan', c.on_brand_plan, 'brand_plan_source', c.brand_plan_source, 'kind', c.kind, 'kit_step', c.kit_step,
    'anchor', public.ops_card_anchor(c.anchor_kind, c.anchor_id, p_today),
    'due_on', c.due_on, 'due_source', c.due_source, 'overdue', (c.due_on < p_today AND c.status <> 'done'),
    'sprint', jsonb_build_object('id', v_sprint.id, 'starts_on', v_sprint.starts_on, 'ends_on', v_sprint.ends_on, 'goal', v_sprint.goal),
    'carried_count', c.carried_count,
    'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', p.email, 'name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                          FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb),
    'watchers', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', p.email, 'name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                            FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'watcher'), '[]'::jsonb),
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label,
                                                           'exists', public.ops_link_label(l.kind, l.target_id) IS NOT NULL) ORDER BY l.added_at, l.kind, l.target_id)
                         FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb),
    'github', COALESCE((SELECT jsonb_agg(public.ops_github_status(g.number) || jsonb_build_object('kind', g.kind) ORDER BY g.added_at, g.number)
                          FROM public.ops_work_github g WHERE g.card_id = c.id), '[]'::jsonb),
    'plan', c.plan, 'result', c.result, 'proof', c.proof, 'close_kind', c.close_kind, 'close_reason', c.close_reason,
    'closed_at', c.closed_at, 'closed_by_name', CASE WHEN c.closed_by IS NOT NULL THEN public.ops_name(c.closed_by) END,
    'closed_via', c.closed_via, 'started_at', c.started_at,
    'working_by_name', CASE WHEN c.working_by IS NOT NULL THEN public.ops_name(c.working_by) END, 'working_via', c.working_via,
    'working', v_working,
    'override', CASE WHEN c.override_at IS NOT NULL THEN jsonb_build_object('reason', c.override_reason, 'by_name', public.ops_name(c.override_by), 'at', c.override_at) END,
    'created_by_name', public.ops_name(c.created_by), 'created_via', c.created_via, 'created_at', c.created_at,
    'updated_at', c.updated_at, 'revision', c.revision,
    'claim', CASE WHEN v_working IS NOT NULL AND NOT (v_working->>'quiet')::boolean THEN jsonb_build_object(
      'holder_name', public.ops_name(c.working_by), 'holder_via', c.working_via,
      'holder_chat_label', v_working->'chat_label', 'since', v_working->'since',
      'ends_at', COALESCE(c.working_seen_at, c.started_at) + interval '24 hours') END,
    'auto', c.auto_key IS NOT NULL,
    'auto_kind', CASE WHEN c.auto_key IS NOT NULL THEN split_part(c.auto_key, ':', 1) END,
    'archived', c.archived_at IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_card_lite(c public.ops_work_cards) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title, 'status', c.status, 'blocked', c.blocked,
    'blocked_reason', c.blocked_reason, 'person_reason', c.person_reason, 'tag', c.person_reason, 'files_url', c.files_url,
    'on_brand_plan', c.on_brand_plan, 'brand_plan_source', c.brand_plan_source, 'kind', c.kind, 'kit_step', c.kit_step,
    'due_on', c.due_on, 'close_kind', c.close_kind, 'anchor_kind', c.anchor_kind, 'anchor_id', c.anchor_id)
$$;

CREATE OR REPLACE FUNCTION public.ops_field_words(p_field text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_field
    WHEN 'title' THEN 'title' WHEN 'instructions' THEN 'instructions' WHEN 'done_means' THEN 'done means'
    WHEN 'owners' THEN 'owners' WHEN 'watchers' THEN 'watchers' WHEN 'due_on' THEN 'due date'
    WHEN 'links' THEN 'links' WHEN 'anchor' THEN 'event' WHEN 'kit_step' THEN 'launch kit step'
    WHEN 'kind' THEN 'card type' WHEN 'plan' THEN 'plan' WHEN 'person_reason' THEN 'Send, Spend or Publish tag' WHEN 'files_url' THEN 'files link' WHEN 'on_brand_plan' THEN 'Host can see this'
    WHEN 'status' THEN 'status' WHEN 'week' THEN 'sprint week' WHEN 'blocked_reason' THEN 'what blocks it'
    WHEN 'result' THEN 'result' WHEN 'blocked' THEN 'blocked' WHEN 'item' THEN 'the card'
    ELSE 'a field' END
$$;

CREATE OR REPLACE FUNCTION public.ops_expected_event_set(p_item jsonb, p_request_key text) RETURNS jsonb
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

  -- #4270 W2 (D9, D16): no new promised events, from the host card or an
  -- agent. Hosts create events in the Host app. A promised event already
  -- saved can still change, repeat, cancel or link to its event.
  IF NOT (p_item ? 'id') OR jsonb_typeof(p_item->'id') = 'null' THEN
    RAISE EXCEPTION 'gone: Promised dates can no longer be added. Hosts create events in the Host app.' USING ERRCODE = '22023';
  END IF;
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

CREATE OR REPLACE FUNCTION public.ops_host_on_mingla(p_record_id uuid, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_today date := public.ops_today(p_today); r public.crm_records; v_brand jsonb;
  v_records uuid[]; -- #4270 W2: every host record of this brand
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO r FROM public.crm_records c WHERE c.id = p_record_id AND c.deleted_at IS NULL AND c.pipeline = 'hosts';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That host card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  -- #4270 W2: the brand once, with its photo and slug for the header.
  SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'photo_url', b.profile_photo_url) INTO v_brand
    FROM public.brands b WHERE b.id = r.brand_id AND b.deleted_at IS NULL;
  v_records := CASE WHEN r.brand_id IS NULL THEN ARRAY[r.id]
                    ELSE ARRAY(SELECT x.id FROM public.crm_records x
                                WHERE x.deleted_at IS NULL AND x.pipeline = 'hosts' AND (x.id = r.id OR x.brand_id = r.brand_id)) END;
  RETURN jsonb_build_object(
    'record', jsonb_build_object('id', r.id, 'name', r.name, 'brand_id', r.brand_id, 'stage', r.stage),
    'brand', v_brand,
    'events', CASE WHEN v_brand IS NULL THEN '[]'::jsonb ELSE COALESCE((
      -- #4270 W2 (D10, C-3): events, experiences and trips, each with its
      -- kind, and whether it is on right now (a trip or experience that has
      -- started and not ended stays listed however long ago it began).
      -- Private and hidden events stay off (ops_anchor reads only what is in
      -- scope).
      SELECT jsonb_agg(jsonb_build_object('id', s.a->'id', 'title', s.a->'title', 'event_type', s.a->'event_type',
                         'kind', CASE WHEN s.a->>'event_type' IN ('event','experience','trip','rsvp') THEN s.a->>'event_type' ELSE 'event' END,
                         'status', s.a->'status', 'is_public', s.a->'is_public', 'start_at', s.a->'start_at',
                         'start_on', s.a->'start_on', 'timezone', s.a->'timezone', 'runway', s.a->'runway',
                         'ends_at', s.ends_at, 'live', s.live,
                         'state', public.ops_plain_state(s.a, v_today))
                       ORDER BY s.a->>'start_at', s.a->>'title')
        FROM (SELECT y.a, d.ends_at, (d.starts_at <= now() AND d.ends_at > now()) AS live FROM public.events e
                CROSS JOIN LATERAL (SELECT public.ops_anchor('event', e.id, v_today) AS a) y
                LEFT JOIN LATERAL (SELECT min(ed.start_at) AS starts_at, max(COALESCE(ed.end_at, ed.start_at)) AS ends_at
                                     FROM public.event_dates ed
                                    WHERE ed.event_id = e.id AND COALESCE(ed.status, 'scheduled') <> 'cancelled') d ON true
               WHERE e.brand_id = r.brand_id AND e.deleted_at IS NULL AND y.a IS NOT NULL
                 AND y.a->>'start_on' IS NOT NULL
                 AND ((y.a->>'start_on')::date >= v_today - 30 OR (d.starts_at <= now() AND d.ends_at > now()))
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
    -- #4270 W2: To do on the host card: open cards only, for any host record
    -- of this brand (and what "Work on this host" read: this host's promised
    -- events and the brand's events), oldest due first, with their owners.
    'todo', COALESCE((SELECT jsonb_agg(public.ops_card_lite(c) || jsonb_build_object(
                        'overdue', c.due_on < v_today,
                        -- names only: the host card's reads carry no email (X-SCOPE)
                        'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                                              FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb),
                        'watchers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                                                FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'watcher'), '[]'::jsonb))
                        ORDER BY c.due_on, c.number)
                        FROM public.ops_work_cards c
                       WHERE c.archived_at IS NULL AND c.status <> 'done'
                         AND (EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = 'host' AND l.target_id = ANY (v_records))
                              OR (c.anchor_kind = 'expected' AND c.anchor_id IN (SELECT z.id FROM public.ops_expected_events z WHERE z.record_id = ANY (v_records)))
                              OR (c.anchor_kind = 'event' AND r.brand_id IS NOT NULL
                                  AND c.anchor_id IN (SELECT e.id FROM public.events e WHERE e.brand_id = r.brand_id)))), '[]'::jsonb),
    'done_count', (SELECT count(*) FROM public.ops_work_cards c
                    WHERE c.archived_at IS NULL AND c.status = 'done' AND c.closed_at > now() - interval '7 days'
                      AND EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = 'host' AND l.target_id = ANY (v_records))),
    -- #4270 W2: Brand and team. Mingla owners by name; the brand's accepted
    -- team by display name and role (never their email).
    'team', jsonb_build_object(
      'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', public.ops_name(o.owner_email)) ORDER BY o.added_at, o.owner_email)
                            FROM public.crm_record_owners o WHERE o.record_id = r.id), '[]'::jsonb),
      'brand_members', CASE WHEN r.brand_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'A teammate'),
                                            'role', m.role) ORDER BY array_position(ARRAY['brand_owner','brand_admin','event_manager','finance_manager','marketing_manager','scanner','venue_staff'], m.role), m.accepted_at)
          FROM public.brand_team_members m LEFT JOIN public.profiles p ON p.id = m.user_id
         WHERE m.brand_id = r.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL), '[]'::jsonb) END),
    'changes', public.ops_recent_changes('host', r.id, 72)->'items');
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. The host card for a brand (the Brand group header's host avatar).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ops_brand_host_record(p_brand_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; r public.crm_records;
BEGIN
  -- Hosts and Creators access only (crm_ctx refuses everyone else, 42501).
  SELECT * INTO v FROM public.crm_ctx();
  IF p_brand_id IS NULL THEN RETURN jsonb_build_object('record_id', NULL); END IF;
  SELECT * INTO r FROM public.crm_records c
   WHERE c.brand_id = p_brand_id AND c.deleted_at IS NULL AND c.pipeline = 'hosts'
   ORDER BY c.created_at, c.id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('record_id', NULL); END IF;
  RETURN jsonb_build_object('record_id', r.id, 'name', r.name, 'stage', r.stage,
    'owners', COALESCE((SELECT jsonb_agg(public.ops_name(o.owner_email) ORDER BY o.added_at, o.owner_email)
                          FROM public.crm_record_owners o WHERE o.record_id = r.id), '[]'::jsonb),
    'other_record_ids', COALESCE((SELECT jsonb_agg(c.id ORDER BY c.created_at, c.id) FROM public.crm_records c
                                   WHERE c.brand_id = p_brand_id AND c.deleted_at IS NULL AND c.pipeline = 'hosts' AND c.id <> r.id), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.ops_brand_host_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_brand_host_record(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.ops_brand_host_record(uuid) IS
  'Issue #4270. The first host card (oldest) for a brand, for the Brand group header in Admin; other host records of the brand by id. Hosts and Creators access only.';

-- ---------------------------------------------------------------------------
-- 7. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $check4270w2$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.ops_work_cards'::regclass AND conname = 'ops_work_cards_plan_source_check')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.ops_work_cards'::regclass AND conname = 'ops_work_cards_plan_author_pair')
     OR EXISTS (SELECT 1 FROM public.ops_work_cards WHERE on_brand_plan) THEN
    RAISE EXCEPTION 'issue 4270 wave 2 self-check: the plan columns are not as stated';
  END IF;
  IF pg_catalog.pg_get_functiondef('public.ops_expected_event_set(jsonb,text)'::regprocedure) NOT LIKE '%gone: Promised dates can no longer be added%' THEN
    RAISE EXCEPTION 'issue 4270 wave 2 self-check: ops_expected_event_set still adds promised events';
  END IF;
  IF pg_catalog.pg_get_functiondef('public.ops_work_add(jsonb,text)'::regprocedure) NOT LIKE '%people_only: A person decides what hosts see.%'
     OR pg_catalog.pg_get_functiondef('public.ops_work_update(uuid,jsonb,bigint,text)'::regprocedure) NOT LIKE '%people_only: A person decides what hosts see.%' THEN
    RAISE EXCEPTION 'issue 4270 wave 2 self-check: an agent could switch on Host can see this';
  END IF;
  FOR r IN SELECT p.oid, p.oid::regprocedure::text AS sig FROM pg_catalog.pg_proc p
            WHERE p.oid IN ('public.ops_validate_card(jsonb,text,text,date)'::regprocedure,
                            'public.ops_work_add(jsonb,text)'::regprocedure,
                            'public.ops_work_update(uuid,jsonb,bigint,text)'::regprocedure,
                            'public.ops_card_json(public.ops_work_cards,date)'::regprocedure,
                            'public.ops_card_lite(public.ops_work_cards)'::regprocedure,
                            'public.ops_host_on_mingla(uuid,date)'::regprocedure,
                            'public.ops_expected_event_set(jsonb,text)'::regprocedure,
                            'public.ops_brand_host_record(uuid)'::regprocedure) LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue 4270 wave 2 self-check: anon can run %', r.sig;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.ops_brand_host_record(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ops_host_on_mingla(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 4270 wave 2 self-check: the host card lost its grants';
  END IF;
END;
$check4270w2$;

COMMIT;
