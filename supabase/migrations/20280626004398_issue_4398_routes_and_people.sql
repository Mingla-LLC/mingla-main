-- Issue #4398 (Work board v3), migration 1 of 4: every automatic card goes
-- under its main task with that task's one owner and one watcher, and every
-- card has exactly one owner and one watcher (spec v1 Parts A and B, kept by
-- spec v3; approved by Seth on 11 Nov 2026).
--
--   A1. ops setting auto_card_routes: {"routes": {<kind>: <card id>},
--       "fallback": <card id>}. Routes are kept by card id (the key the
--       database enforces), seeded here by looking today's live cards up by
--       number. Edited only through ops_setting_set (owner or admin, signed
--       in, audited), which refuses a card that does not exist, is archived
--       or sits two levels down.
--   A3. ops_auto_card_upsert (signature unchanged: the #3355 digest calls
--       it) resolves the route for the key's kind, walks up to the first open
--       card, then the fallback, and otherwise keeps ONE top-level alarm card
--       route_missing:<kind> and logs a stopped entry. It writes parent_id and
--       takes exactly the route card's owner and watcher, whatever the maker
--       passed. A card that lands two levels down takes no plan.
--   B2. ops_people_check refuses anything but one owner and one different
--       watcher, for every mode (the auto and subtask "No owner" exemptions
--       are removed). A subtask given no people takes its parent's. New plan
--       steps (ops_plan_sync) and subtasks (ops_subtask_add, through
--       ops_work_add) get one owner and one watcher; existing steps keep
--       their people.
--
-- The invariant trigger that backstops all of this at commit is the last
-- migration of the set (20280626034398). Static SQL only (no EXECUTE of
-- built strings). Every function copied here is copied from its latest
-- definition (named beside it) and each edit is marked "#4398".
--
-- ROLLBACK (no down file): drop the trigger of 20280626034398 first, then
-- restore the function bodies from the migrations named beside each one and
-- delete the auto_card_routes row.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- A1. The routes setting.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_settings DROP CONSTRAINT ops_settings_key_check;
ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_key_check CHECK (key = ANY (ARRAY[
  'auto_steps', 'brand_auto_cards', 'brand_auto_since', 'marketing_owner', 'follow_through_since', 'auto_promo_cards',
  'tap_to_pay_release', 'auto_card_routes']::text[]));

-- A2. The first routes, by today's card numbers (spec v1 A2 plus the
-- confirmed defaults: guide_live is no longer a card; feature_guide_gap goes
-- under #2974; recap, promo and brand_pick under #2966; the fallback is
-- #2960). The six per-PR release kinds are one card per PR now
-- (eng_release, under #2971). series (one rolling card per repeating host
-- series) is a host-launch kind, so it goes under #2966 too. ari_gap_digest
-- (#3355) goes under #2989 "Ari quality and gaps (weekly digest)". A number
-- that is not on this database (a fresh replay) is left out: its kind uses
-- the fallback.
INSERT INTO public.ops_settings (key, value, updated_by)
SELECT 'auto_card_routes', jsonb_build_object(
    'routes', COALESCE((SELECT jsonb_object_agg(r.kind, w.id ORDER BY r.kind)
                          FROM (VALUES ('eng_deploy_failed', 2970), ('eng_deploy_pending', 2970),
                                       ('eng_release', 2971), ('eng_bot_missing', 2971), ('eng_status_token', 2971),
                                       ('eng_done_not_live', 2973),
                                       ('eng_no_pr_push', 2974), ('feature_guide_gap', 2974),
                                       ('roadmap_shipped', 2961), ('ask', 2963),
                                       ('golive', 2966), ('recap', 2966), ('promo', 2966), ('brand_pick', 2966), ('series', 2966), ('brand_plan', 2966),
                                       ('ari_gap_digest', 2989)) r(kind, num)
                          JOIN public.ops_work_cards w ON w.number = r.num AND w.archived_at IS NULL AND w.depth <= 1), '{}'::jsonb),
    'fallback', (SELECT to_jsonb(w.id) FROM public.ops_work_cards w WHERE w.number = 2960 AND w.archived_at IS NULL AND w.depth <= 1)),
  'system@usemingla.com'
ON CONFLICT (key) DO NOTHING;
COMMENT ON TABLE public.ops_settings IS
  'Issue #3980. Owner switches. #4398: auto_card_routes maps each automatic card kind (the auto_key text before the first colon) to the card it goes under, by card id, plus a fallback card; ops_auto_card_upsert reads it.';

-- Plain words for each kind (Admin > Settings > Automatic cards).
CREATE FUNCTION public.ops_auto_kind_words(p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT CASE p_kind
    WHEN 'eng_deploy_failed' THEN 'A deploy failed'
    WHEN 'eng_deploy_pending' THEN 'A deploy has no result yet'
    WHEN 'eng_release' THEN 'Finish the release of a pull request'
    WHEN 'eng_bot_missing' THEN 'A release record was not written'
    WHEN 'eng_status_token' THEN 'The sync token cannot post statuses'
    WHEN 'eng_done_not_live' THEN 'An issue is Done but not Live'
    WHEN 'eng_no_pr_push' THEN 'A commit reached main without a pull request'
    WHEN 'feature_guide_gap' THEN 'Feature Guide coverage stopped'
    WHEN 'roadmap_shipped' THEN 'Approve a Recently shipped announcement'
    WHEN 'ask' THEN 'Ask a host for their first event'
    WHEN 'golive' THEN 'Get an event live'
    WHEN 'recap' THEN 'Recap a host''s event'
    WHEN 'promo' THEN 'Giveaway and ads for an event'
    WHEN 'brand_pick' THEN 'Pick the host card for a brand'
    WHEN 'series' THEN 'Keep a repeating series live'
    WHEN 'ari_gap_digest' THEN 'Ari quality and gaps (weekly digest)'
    WHEN 'brand_plan' THEN 'A host adds a task to their plan (owner and watcher only)'
    ELSE replace(COALESCE(p_kind, 'automatic'), '_', ' ') END
$function$;
REVOKE ALL ON FUNCTION public.ops_auto_kind_words(text) FROM PUBLIC, anon, authenticated;

-- From the route card, up: the first card that is open, not archived, at
-- most one level down (so a card under it is at most two down) and has
-- exactly one owner and one watcher. NULL when nothing on the chain is.
CREATE FUNCTION public.ops_auto_route_target(p_card_id uuid) RETURNS public.ops_work_cards
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE c public.ops_work_cards; v_cursor uuid := p_card_id; v_hops integer := 0;
BEGIN
  WHILE v_cursor IS NOT NULL AND v_hops < 4 LOOP
    v_hops := v_hops + 1;
    SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = v_cursor;
    EXIT WHEN NOT FOUND;
    IF c.status <> 'done' AND c.archived_at IS NULL AND c.depth <= 1
       AND cardinality(public.ops_card_people(c.id, 'owner')) = 1
       AND cardinality(public.ops_card_people(c.id, 'watcher')) = 1 THEN
      RETURN c;
    END IF;
    v_cursor := c.parent_id;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_auto_route_target(uuid) FROM PUBLIC, anon, authenticated;

-- Where a kind's card goes: {parent_id, number, depth, owner, watcher, via}
-- with via 'route' or 'fallback'; NULL when neither has an open card.
CREATE FUNCTION public.ops_auto_route(p_kind text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_set jsonb := COALESCE(public.ops_setting('auto_card_routes'), '{}'::jsonb); v_id text; t public.ops_work_cards; v_via text;
BEGIN
  v_id := v_set->'routes'->>p_kind;
  IF v_id IS NOT NULL AND public.ops_is_uuid(v_id) THEN
    t := public.ops_auto_route_target(v_id::uuid); v_via := 'route';
  END IF;
  IF t.id IS NULL THEN
    v_id := v_set->>'fallback';
    IF v_id IS NOT NULL AND public.ops_is_uuid(v_id) THEN
      t := public.ops_auto_route_target(v_id::uuid); v_via := 'fallback';
    END IF;
  END IF;
  IF t.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('parent_id', t.id, 'number', t.number, 'title', t.title, 'depth', t.depth,
    'owner', (public.ops_card_people(t.id, 'owner'))[1], 'watcher', (public.ops_card_people(t.id, 'watcher'))[1], 'via', v_via);
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_auto_route(text) FROM PUBLIC, anon, authenticated;

-- The routes as Admin shows them: each kind in words, the card it goes
-- under (number, title, owner, watcher) and its state: open, closed and
-- using another card, or nowhere to go.
CREATE FUNCTION public.ops_auto_routes_json() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_set jsonb := COALESCE(public.ops_setting('auto_card_routes'), '{}'::jsonb); v_rows jsonb := '[]'::jsonb; r record;
        c public.ops_work_cards; v_use jsonb; v_fb public.ops_work_cards;
BEGIN
  IF public.ops_is_uuid(v_set->>'fallback') THEN SELECT * INTO v_fb FROM public.ops_work_cards w WHERE w.id = (v_set->>'fallback')::uuid; END IF;
  FOR r IN SELECT e.key AS kind, e.value #>> '{}' AS card_id FROM jsonb_each(COALESCE(v_set->'routes', '{}'::jsonb)) e ORDER BY e.key LOOP
    c := NULL;
    IF public.ops_is_uuid(r.card_id) THEN SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = r.card_id::uuid; END IF;
    v_use := public.ops_auto_route(r.kind);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('kind', r.kind, 'words', public.ops_auto_kind_words(r.kind),
      'card', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'number', c.number, 'title', c.title, 'depth', c.depth,
                     'open', c.status <> 'done' AND c.archived_at IS NULL,
                     'owner', public.ops_name((public.ops_card_people(c.id, 'owner'))[1]),
                     'watcher', public.ops_name((public.ops_card_people(c.id, 'watcher'))[1])) END,
      'state', CASE WHEN v_use IS NULL THEN 'nowhere' WHEN (v_use->>'parent_id')::uuid IS NOT DISTINCT FROM c.id THEN 'open' ELSE 'using' END,
      'using', CASE WHEN v_use IS NOT NULL AND (v_use->>'parent_id')::uuid IS DISTINCT FROM c.id
                    THEN jsonb_build_object('id', v_use->'parent_id', 'number', v_use->'number', 'title', v_use->'title') END));
  END LOOP;
  RETURN jsonb_build_object('routes', v_rows,
    'fallback', CASE WHEN v_fb.id IS NOT NULL THEN jsonb_build_object('id', v_fb.id, 'number', v_fb.number, 'title', v_fb.title,
                  'open', v_fb.status <> 'done' AND v_fb.archived_at IS NULL,
                  'owner', public.ops_name((public.ops_card_people(v_fb.id, 'owner'))[1]),
                  'watcher', public.ops_name((public.ops_card_people(v_fb.id, 'watcher'))[1])) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_auto_routes_json() FROM PUBLIC, anon, authenticated;

-- The one alarm when a kind has nowhere to go: a top-level card
-- route_missing:<kind> on the board owner, watched by the first other active
-- admin, due today, naming the card that could not be filed. One stopped
-- log line per kind per day. Returns the alarm card's id (or NULL when there
-- is no second admin to watch it, which is logged).
CREATE FUNCTION public.ops_auto_route_missing(p_kind text, p_auto_key text, p_title text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE c_actor constant text := 'system@usemingla.com'; v_owner text := public.ops_owner_email(); v_watcher text; v_res jsonb; v_id uuid;
        v_words text := public.ops_auto_kind_words(p_kind);
BEGIN
  SELECT lower(btrim(au.email)) INTO v_watcher FROM public.admin_users au
   WHERE au.status = 'active' AND lower(btrim(au.email)) IS DISTINCT FROM v_owner
     AND public.ops_team_email(au.email) IS NOT NULL
   ORDER BY (au.role = 'admin') DESC, au.accepted_at NULLS LAST, au.created_at LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.ops_agent_log l WHERE l.action = 'card_refused' AND l.outcome = 'stopped'
                  AND l.detail->>'route_missing' = p_kind AND l.at > now() - interval '1 day') THEN
    PERFORM public.ops_log_write(c_actor, 'system', 'card_refused', 'stopped', NULL, NULL, NULL,
      left(format('No open main task takes "%s" cards, so Mingla did not make: %s', v_words, COALESCE(p_title, p_auto_key)), 300),
      jsonb_build_object('route_missing', p_kind, 'auto_key', p_auto_key));
  END IF;
  IF v_owner IS NULL OR v_watcher IS NULL THEN
    RAISE WARNING 'ops_auto_route_missing: no owner and second admin for the % alarm', p_kind;
    RETURN NULL;
  END IF;
  v_res := public.ops_auto_card_upsert('route_missing:' || p_kind, jsonb_build_object(
    'title', left(format('Point automatic "%s" cards at an open main task', v_words), 160),
    'instructions', left(format('Mingla could not file an automatic card because no open main task takes "%s" cards (%s) and the fallback is closed or not set. The card waiting: %s (key %s). Open Admin > Settings > Automatic cards and point it at an open main task; the next run files it.',
      v_words, p_kind, COALESCE(p_title, 'untitled'), p_auto_key), 4000),
    'done_means', left(format('Automatic "%s" cards have an open main task to go under.', v_words), 300),
    'owners', jsonb_build_array(v_owner), 'watchers', jsonb_build_array(v_watcher),
    'due_on', public.ops_today(NULL)), 'task', NULL);
  v_id := CASE WHEN public.ops_is_uuid(v_res->>'id') THEN (v_res->>'id')::uuid END;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_auto_route_missing(text, text, text) FROM PUBLIC, anon, authenticated;

-- A card Mingla opens again by itself (a parked go-live or series card, a
-- brand pick) goes under its kind's route with the route's people, as a new
-- one would. Nothing happens when the kind has nowhere to go, the card is
-- already there, or its own subtasks would end up too deep.
CREATE FUNCTION public.ops_auto_card_reroute(p_card_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE c public.ops_work_cards; v_route jsonb; v_parent uuid; v_below integer; v_done boolean := false;
BEGIN
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id FOR UPDATE;
  IF NOT FOUND OR c.auto_key IS NULL THEN RETURN false; END IF;
  v_route := public.ops_auto_route(split_part(c.auto_key, ':', 1));
  IF v_route IS NOT NULL THEN
    v_parent := (v_route->>'parent_id')::uuid;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.ops_work_cards x WHERE x.parent_id = c.id) THEN 1 ELSE 0 END INTO v_below;
    IF v_parent <> c.id AND (v_route->>'depth')::integer + 1 + v_below <= 2 THEN
      IF c.parent_id IS DISTINCT FROM v_parent THEN
        UPDATE public.ops_work_cards w SET parent_id = v_parent WHERE w.id = c.id;
      END IF;
      PERFORM public.ops_people_set(c.id, ARRAY[v_route->>'owner'], ARRAY[v_route->>'watcher'], 'system@usemingla.com', NULL);
      v_done := true;
    END IF;
  END IF;
  -- An open card without one owner and one watcher would fail at commit;
  -- say so here, where the caller can still keep the rest of its run.
  IF c.status <> 'done' AND (cardinality(public.ops_card_people(c.id, 'owner')) <> 1 OR cardinality(public.ops_card_people(c.id, 'watcher')) <> 1) THEN
    RAISE EXCEPTION 'card_people: A card needs exactly one owner and one watcher, and they must be different people.' USING ERRCODE = '23514';
  END IF;
  RETURN v_done;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_auto_card_reroute(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B2. One owner and one watcher, checked on every write.
-- ---------------------------------------------------------------------------

-- From 20271116003980 (wave 1).
CREATE OR REPLACE FUNCTION public.ops_people_check(p_owners jsonb, p_watchers jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
-- #4398 (Part B): a card has exactly one owner and exactly one watcher, who
-- is a different person. Names are checked against the team as before; the
-- counts are the fix: "A card has one owner. Pick one person." and "A card
-- has one watcher, who is not the owner." (the open-card invariant trigger
-- ops_4398_card_people_check backstops every writer at commit).
DECLARE
  v_fixes jsonb := '[]'::jsonb; v_owners text[] := ARRAY[]::text[]; v_watchers text[] := ARRAY[]::text[];
  v_names text := public.ops_team_names(); v_val jsonb; v_email text; v_bad integer := 0; v_bad_w integer := 0;
BEGIN
  IF p_owners IS NOT NULL AND jsonb_typeof(p_owners) NOT IN ('array', 'null') THEN
    v_bad := 1;
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'owners', 'message', 'A card has one owner. Pick one person.'));
  ELSIF jsonb_typeof(p_owners) = 'array' THEN
    FOR v_val IN SELECT e FROM jsonb_array_elements(p_owners) e LOOP
      v_email := CASE WHEN jsonb_typeof(v_val) = 'string' THEN public.ops_team_email(v_val #>> '{}') END;
      IF v_email IS NULL THEN
        v_bad := v_bad + 1;
        IF v_bad <= 5 THEN
          v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'owners', 'message',
            format('Owner "%s" is not on the team. Pick from %s.', left(COALESCE(v_val #>> '{}', ''), 80), v_names)));
        END IF;
      ELSIF NOT v_email = ANY (v_owners) THEN
        v_owners := v_owners || v_email;
      END IF;
    END LOOP;
  END IF;
  IF v_bad = 0 AND cardinality(v_owners) <> 1 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'owners', 'message', 'A card has one owner. Pick one person.'));
  END IF;
  IF p_watchers IS NOT NULL AND jsonb_typeof(p_watchers) NOT IN ('array', 'null') THEN
    v_bad_w := 1;
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message', 'A card has one watcher, who is not the owner.'));
  ELSIF jsonb_typeof(p_watchers) = 'array' THEN
    FOR v_val IN SELECT e FROM jsonb_array_elements(p_watchers) e LOOP
      v_email := CASE WHEN jsonb_typeof(v_val) = 'string' THEN public.ops_team_email(v_val #>> '{}') END;
      IF v_email IS NULL THEN
        v_bad_w := v_bad_w + 1;
        IF v_bad_w <= 5 THEN
          v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message',
            format('Watcher "%s" is not on the team. Pick from %s.', left(COALESCE(v_val #>> '{}', ''), 80), v_names)));
        END IF;
      ELSIF NOT v_email = ANY (v_owners) AND NOT v_email = ANY (v_watchers) THEN
        v_watchers := v_watchers || v_email;
      END IF;
    END LOOP;
  END IF;
  IF v_bad_w = 0 AND cardinality(v_watchers) <> 1 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message', 'A card has one watcher, who is not the owner.'));
  END IF;
  RETURN jsonb_build_object('owners', to_jsonb(ARRAY(SELECT x FROM unnest(v_owners) x ORDER BY x)),
                            'watchers', to_jsonb(ARRAY(SELECT x FROM unnest(v_watchers) x ORDER BY x)),
                            'fixes', v_fixes);
END;
$function$;

-- From 20280624014255 (#4255 functions). #4398 (B2): one owner and one watcher for every mode; a subtask takes its parent's.
CREATE OR REPLACE FUNCTION public.ops_validate_card(p_item jsonb, p_mode text, p_actor text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c_keys constant text[] := ARRAY['title','instructions','done_means','owners','watchers','due_on','links','anchor','kit_step','kind','plan','person_reason','github','files_url','on_brand_plan',
                                  'parent','description','start_on','estimate_minutes','goal','in_backlog'];  -- #4255
  v_fixes jsonb := '[]'::jsonb; v_bad text; v_title text; v_instr text; v_done text; v_people jsonb; v_links jsonb;
  v_anchor jsonb; v_anchor_kind text; v_anchor_id uuid; v_kit integer; v_kind text; v_due date; v_due_source text;
  v_parent public.ops_work_cards; v_parent_id uuid; v_sub boolean := false; v_desc text; v_start date; v_est integer; -- #4255
  v_goal uuid; v_goal_week date; v_backlog boolean;
  v_owners_in jsonb; v_watchers_in jsonb; v_p_owner text; v_p_watcher text; v_one_owner text; -- #4398
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
        format('A card does not take "%s". It takes: title, instructions, done_means, owners, watchers, due_on, links, anchor, kit_step, kind, plan, person_reason, github, files_url, on_brand_plan, parent, description, start_on, estimate_minutes, goal, in_backlog.', left(v_bad, 60))));
    END IF;
  END IF;

  -- #4255: a subtask names its parent. It may come without instructions, a
  -- done-means line, an owner or a due date: those come from the parent.
  IF p_item ? 'parent' AND jsonb_typeof(p_item->'parent') <> 'null' THEN
    v_sub := true;
    IF jsonb_typeof(p_item->'parent') = 'string' AND public.ops_is_uuid(p_item->>'parent') THEN
      SELECT * INTO v_parent FROM public.ops_work_cards w WHERE w.id = (p_item->>'parent')::uuid AND w.archived_at IS NULL;
    END IF;
    IF v_parent.id IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'The parent card is not on the board. Use an id returned by Mingla.'));
    ELSIF v_parent.id = v_self THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'A card cannot be its own subtask.'));
    ELSIF v_parent.depth >= 2 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'Subtasks go two levels deep at most (card, subtask, sub-subtask).'));
    ELSIF p_mode <> 'update' AND v_parent.status = 'done' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'The parent card is closed. Reopen it first.'));
    ELSE
      v_parent_id := v_parent.id;
    END IF;
  END IF;
  -- #4255: one description, in Markdown, up to 20,000 characters.
  IF p_item ? 'description' AND jsonb_typeof(p_item->'description') <> 'null' THEN
    v_desc := CASE WHEN jsonb_typeof(p_item->'description') = 'string' THEN public.ops_multi_line(p_item->>'description') END;
    IF jsonb_typeof(p_item->'description') <> 'string' OR char_length(COALESCE(v_desc, '')) > 20000 OR public.ops_has_control(v_desc) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'description', 'message', 'Keep the description to 20,000 characters.'));
      v_desc := NULL;
    END IF;
  END IF;

  v_title := CASE WHEN jsonb_typeof(p_item->'title') = 'string' THEN public.ops_one_line(p_item->>'title') END;
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 160 OR public.crm_name_key(v_title) = '' OR public.ops_has_control(v_title) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message', 'Title is missing. Say what the work is in 3 to 160 characters.'));
    v_title := NULL;
  END IF;
  v_instr := CASE WHEN jsonb_typeof(p_item->'instructions') = 'string' THEN public.ops_multi_line(p_item->>'instructions') END;
  -- #4255: with no instructions, the description is the source (its first
  -- 4,000 characters); a subtask with neither says whose subtask it is.
  IF v_instr IS NULL AND jsonb_typeof(p_item->'instructions') IS DISTINCT FROM 'string'
     AND char_length(COALESCE(public.ops_multi_line(left(v_desc, 4000)), '')) >= 10 THEN
    v_instr := public.ops_multi_line(left(v_desc, 4000));
  END IF;
  IF v_instr IS NULL AND jsonb_typeof(p_item->'instructions') IS DISTINCT FROM 'string' AND v_parent_id IS NOT NULL AND v_title IS NOT NULL THEN
    v_instr := format('Subtask of Card %s: %s', v_parent.number, v_title);
  END IF;
  IF v_instr IS NULL OR char_length(v_instr) NOT BETWEEN 10 AND 4000 OR public.ops_has_control(v_instr) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'instructions', 'message', 'Instructions are missing. Say what the person or their agent should do (10 to 4,000 characters).'));
  END IF;
  v_done := CASE WHEN jsonb_typeof(p_item->'done_means') = 'string' THEN public.ops_one_line(p_item->>'done_means') END;
  IF v_done IS NULL AND jsonb_typeof(p_item->'done_means') IS DISTINCT FROM 'string' AND v_sub THEN v_done := 'This subtask is done.'; END IF;  -- #4255
  IF v_done IS NULL OR char_length(v_done) NOT BETWEEN 5 AND 300 OR public.ops_has_control(v_done) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'done_means', 'message', 'Done means is empty. Add one line the work is checked against.'));
  END IF;

  -- #4398 (Part B): every card has exactly one owner and one watcher, for
  -- every mode; the "No owner" exemptions for automatic cards and subtasks
  -- are gone. A subtask given no owner or no watcher takes its parent's: the
  -- parent's owner, and the parent's watcher (or the parent's owner when
  -- that watcher is the subtask's owner).
  v_owners_in := p_item->'owners'; v_watchers_in := p_item->'watchers';
  IF v_parent_id IS NOT NULL THEN
    v_p_owner := (public.ops_card_people(v_parent_id, 'owner'))[1];
    v_p_watcher := (public.ops_card_people(v_parent_id, 'watcher'))[1];
    IF (v_owners_in IS NULL OR jsonb_typeof(v_owners_in) = 'null' OR v_owners_in = '[]'::jsonb) AND v_p_owner IS NOT NULL THEN
      v_owners_in := jsonb_build_array(v_p_owner);
    END IF;
    IF v_watchers_in IS NULL OR jsonb_typeof(v_watchers_in) = 'null' OR v_watchers_in = '[]'::jsonb THEN
      v_one_owner := public.ops_people_check(v_owners_in, '[]'::jsonb)->'owners'->>0;
      v_watchers_in := CASE WHEN v_p_watcher IS NOT NULL AND v_p_watcher IS DISTINCT FROM v_one_owner THEN jsonb_build_array(v_p_watcher)
                            WHEN v_p_owner IS NOT NULL AND v_p_owner IS DISTINCT FROM v_one_owner THEN jsonb_build_array(v_p_owner)
                            ELSE v_watchers_in END;
    END IF;
  END IF;
  v_people := public.ops_people_check(v_owners_in, v_watchers_in);
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
  ELSIF v_parent.id IS NOT NULL THEN
    v_due := v_parent.due_on; v_due_source := 'explicit';  -- #4255: a subtask is due when its parent is
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
          OR v_files !~ '^https://[^/?#:@\\]' OR public.brand_plan_link_hidden(v_files) THEN
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

  -- #4255: start date, estimate, sprint goal and backlog.
  IF p_item ? 'start_on' AND jsonb_typeof(p_item->'start_on') <> 'null' THEN
    BEGIN
      IF jsonb_typeof(p_item->'start_on') <> 'string' OR (p_item->>'start_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
      v_start := (p_item->>'start_on')::date;
      IF v_start NOT BETWEEN p_today - 730 AND p_today + 730 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_start := NULL;
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'start_on', 'message', 'Start date must be a real date within two years.'));
    END;
  END IF;
  IF v_start IS NOT NULL AND v_due IS NOT NULL AND v_start > v_due THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'start_on', 'message', 'Start must be on or before the due date.'));
  END IF;
  IF p_item ? 'estimate_minutes' AND jsonb_typeof(p_item->'estimate_minutes') <> 'null' THEN
    IF jsonb_typeof(p_item->'estimate_minutes') <> 'number' OR (p_item->>'estimate_minutes') !~ '^\d{1,5}$'
       OR (p_item->>'estimate_minutes')::integer NOT BETWEEN 1 AND 60000 THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'estimate_minutes', 'message', 'An estimate is whole minutes, from 1 to 60,000.'));
    ELSE
      v_est := (p_item->>'estimate_minutes')::integer;
    END IF;
  END IF;
  IF p_item ? 'goal' AND jsonb_typeof(p_item->'goal') <> 'null' THEN
    IF jsonb_typeof(p_item->'goal') = 'string' AND public.ops_is_uuid(p_item->>'goal') THEN
      SELECT g.id, s.starts_on INTO v_goal, v_goal_week FROM public.ops_sprint_goals g JOIN public.ops_sprints s ON s.id = g.sprint_id
       WHERE g.id = (p_item->>'goal')::uuid AND g.archived_at IS NULL;
    END IF;
    IF v_goal IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'goal', 'message', 'That sprint goal is not there any more. Pick one of the sprint''s goals.'));
    ELSIF p_mode <> 'update' AND v_goal_week IS DISTINCT FROM
          COALESCE((SELECT s.starts_on FROM public.ops_sprints s WHERE s.id = v_parent.sprint_id), public.ops_monday(p_today)) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'goal', 'message', 'That goal belongs to another sprint. Pick one of this sprint''s goals.'));
      v_goal := NULL;
    END IF;
  END IF;
  IF p_item ? 'in_backlog' AND jsonb_typeof(p_item->'in_backlog') <> 'null' THEN
    IF jsonb_typeof(p_item->'in_backlog') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'in_backlog', 'message', 'Backlog must be true or false.'));
    ELSE
      v_backlog := (p_item->>'in_backlog')::boolean;
    END IF;
  END IF;

  -- duplicates: an open card with the same title, or a card for the same kit step
  -- (#4255: among top-level cards; subtasks often share words)
  IF v_title IS NOT NULL AND NOT v_sub THEN
    SELECT w.id, w.number, w.title INTO v_dup_id, v_dup_number, v_dup_title FROM public.ops_work_cards w
     WHERE w.title_key = public.crm_name_key(v_title) AND w.status <> 'done' AND w.archived_at IS NULL AND w.parent_id IS NULL
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
      'due_on', v_due, 'due_source', v_due_source, 'plan', COALESCE(v_plan, '[]'::jsonb), 'person_reason', v_reason, 'github', v_gh, 'files_url', v_files, 'on_brand_plan', v_on_plan)
      || jsonb_build_object('parent_id', v_parent_id, 'parent_sprint_id', v_parent.sprint_id, 'description', v_desc,  -- #4255
                            'start_on', v_start, 'estimate_minutes', v_est, 'goal_id', v_goal, 'in_backlog', v_backlog),
    'fixes', v_fixes,
    'duplicate', CASE WHEN v_dup_id IS NOT NULL THEN jsonb_build_object('id', v_dup_id, 'number', v_dup_number, 'title', v_dup_title) END);
END;
$function$

;

-- From 20280624014255 (#4255 functions). #4398 (B2): new steps get one owner and one watcher.
CREATE OR REPLACE FUNCTION public.ops_plan_sync(p_card_id uuid, p_plan jsonb, p_actor text, p_via text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  p public.ops_work_cards; x public.ops_work_cards; n public.ops_work_cards; v_subs uuid[]; s jsonb; i integer := 0; v_title text; v_step jsonb;
  v_done boolean; v_changed integer := 0; v_owners text[]; v_owner text; v_watcher text; v_id uuid; v_before jsonb; v_action text;
  v_via text := CASE WHEN p_via IN ('claude', 'codex', 'system') THEN p_via END;
  v_people_via text := CASE WHEN p_via IN ('claude', 'codex') THEN p_via END;
BEGIN
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'array' THEN RETURN 0; END IF;
  -- #4398 (Part C): a plan step ticked through its card's plan is a checklist
  -- tick, not a close the watcher confirms (the card itself is reviewed).
  PERFORM set_config('ops.plan_sync', 'on', true);
  SELECT * INTO p FROM public.ops_work_cards w WHERE w.id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_subs := ARRAY(SELECT c.id FROM public.ops_work_cards c WHERE c.parent_id = p_card_id AND c.archived_at IS NULL ORDER BY c.position, c.number);
  FOR s IN SELECT e FROM jsonb_array_elements(p_plan) e ORDER BY (e->>'n')::integer LOOP
    i := i + 1;
    v_title := btrim(left(COALESCE(public.ops_one_line(s->>'text'), ''), 160));
    IF char_length(v_title) < 3 OR public.crm_name_key(v_title) = '' THEN v_title := format('Step %s', i); END IF;
    v_step := jsonb_build_object('tool', COALESCE(NULLIF(s->>'tool', ''), 'person'), 'status', COALESCE(s->>'status', 'todo'),
                                 'result', s->'result', 'checked_at', s->'checked_at');
    v_done := COALESCE(s->>'status', 'todo') = 'done';
    IF i <= cardinality(v_subs) THEN
      SELECT * INTO x FROM public.ops_work_cards w WHERE w.id = v_subs[i] FOR UPDATE;
      IF x.plan_step IS NULL THEN v_title := x.title; END IF;
      CONTINUE WHEN x.title IS NOT DISTINCT FROM v_title AND x.plan_step IS NOT DISTINCT FROM v_step AND (x.status = 'done') = v_done;
      v_before := public.ops_card_snapshot(x.id);
      IF v_done AND x.status <> 'done' THEN
        UPDATE public.ops_work_cards w SET title = v_title, plan_step = v_step, status = 'done', person_reason = NULL,
          blocked = false, blocked_kind = NULL, blocked_reason = NULL, close_kind = 'done', close_reason = NULL,
          closed_at = clock_timestamp(), closed_by = p_actor, closed_via = v_via,
          working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
          revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
         WHERE w.id = x.id RETURNING w.* INTO n;
        v_action := 'closed';
      ELSIF NOT v_done AND x.status = 'done' THEN
        UPDATE public.ops_work_cards w SET title = v_title, plan_step = v_step, status = 'todo',
          close_kind = NULL, close_reason = NULL, closed_at = NULL, closed_by = NULL, closed_via = NULL, proof = '[]'::jsonb,
          revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
         WHERE w.id = x.id RETURNING w.* INTO n;
        v_action := 'reopened';
      ELSE
        UPDATE public.ops_work_cards w SET title = v_title, plan_step = v_step,
          revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
         WHERE w.id = x.id RETURNING w.* INTO n;
        v_action := 'updated';
      END IF;
      PERFORM public.ops_card_event(x.id, p_actor, v_via, v_action, format('From the plan of Card %s.', p.number),
        v_before, public.ops_card_snapshot(x.id), x.revision, n.revision);
    ELSE
      INSERT INTO public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan, plan_step,
        parent_id, goal_id, close_kind, closed_at, closed_by, closed_via, created_by, created_via, updated_by, updated_via)
      VALUES (v_title, left(format('Step %s of Card %s: %s', i, p.number, COALESCE(public.ops_one_line(s->>'text'), v_title)), 4000),
        'This step is done and read back.', CASE WHEN v_done THEN 'done' ELSE 'todo' END, 'task', p.due_on, 'explicit',
        p.sprint_id, '[]'::jsonb, v_step, p.id, p.goal_id,
        CASE WHEN v_done THEN 'done' END, CASE WHEN v_done THEN clock_timestamp() END,
        CASE WHEN v_done THEN p_actor END, CASE WHEN v_done THEN v_via END,
        p_actor, v_via, p_actor, v_via)
      RETURNING id INTO v_id;
      -- #4398 (Part B): a new step has one owner and one watcher. Owner: the
      -- step's one named person, else the parent's owner. Watcher: the
      -- parent's watcher, or the parent's owner when that is the step's owner.
      -- Steps that already exist keep their people.
      v_owners := public.ops_4255_step_owners(s->>'text', s->>'tool', p.id);
      v_owner := CASE WHEN cardinality(v_owners) = 1 THEN v_owners[1] ELSE (public.ops_card_people(p.id, 'owner'))[1] END;
      v_watcher := (public.ops_card_people(p.id, 'watcher'))[1];
      IF v_watcher IS NOT DISTINCT FROM v_owner THEN v_watcher := (public.ops_card_people(p.id, 'owner'))[1]; END IF;
      IF v_watcher IS NOT DISTINCT FROM v_owner THEN v_watcher := NULL; END IF;
      INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via)
      SELECT v_id, o, 'owner', p_actor, v_people_via FROM unnest(ARRAY[v_owner]) o WHERE o IS NOT NULL ON CONFLICT DO NOTHING;
      INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via)
      SELECT v_id, o, 'watcher', p_actor, v_people_via FROM unnest(ARRAY[v_watcher]) o WHERE o IS NOT NULL ON CONFLICT DO NOTHING;
      PERFORM public.ops_card_event(v_id, p_actor, v_via, 'added', format('From the plan of Card %s.', p.number),
        NULL, public.ops_card_snapshot(v_id), NULL, 1);
    END IF;
    v_changed := v_changed + 1;
  END LOOP;
  -- What the new plan no longer has.
  FOR x IN SELECT w.* FROM public.ops_work_cards w
            WHERE w.id = ANY (v_subs[i + 1:]) AND w.plan_step IS NOT NULL AND w.status <> 'done' AND w.archived_at IS NULL FOR UPDATE LOOP
    UPDATE public.ops_work_cards w SET archived_at = now(), archived_by = p_actor, archive_reason = 'Taken out of the plan.',
      working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
      revision = w.revision + 1, updated_by = p_actor, updated_via = v_via, updated_at = now()
     WHERE w.id = x.id;
    PERFORM public.ops_card_event(x.id, p_actor, v_via, 'archived', format('Taken out of the plan of Card %s.', p.number), NULL, NULL, x.revision, x.revision + 1);
    v_changed := v_changed + 1;
  END LOOP;
  PERFORM set_config('ops.plan_sync', '', true);
  RETURN v_changed;
END;
$function$

;

-- From 20271201003980 (synced w3). #4398 (A1): the routes.
CREATE OR REPLACE FUNCTION public.ops_setting_set(p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_value jsonb := p_value; v_email text; v_before jsonb; -- #4398
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_key = 'auto_card_routes' THEN
    -- #4398 (A1): the routes are the owner's or an admin's to change, signed
    -- in (never an agent), and audited like every switch.
    IF v.via IS NOT NULL OR public.admin_team_role() IS DISTINCT FROM 'owner' AND public.admin_team_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'forbidden: Only the owner or an admin can change where automatic cards go.' USING ERRCODE = '42501';
    END IF;
  ELSE
    PERFORM public.ops_owner_person_only('Only the owner can change these switches.');
  END IF;
  IF p_key = 'auto_card_routes' THEN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR jsonb_typeof(p_value->'routes') IS DISTINCT FROM 'object'
       OR (p_value ? 'fallback' AND jsonb_typeof(p_value->'fallback') NOT IN ('string', 'null'))
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('routes', 'fallback'))
       OR (SELECT count(*) FROM jsonb_object_keys(p_value->'routes')) > 60 THEN
      RAISE EXCEPTION 'invalid_setting: Send routes as {"routes": {"<kind>": "<card id>"}, "fallback": "<card id>"}.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(p_value->'routes') e
                WHERE e.key !~ '^[a-z_]{2,40}$' OR jsonb_typeof(e.value) <> 'string' OR NOT public.ops_is_uuid(e.value #>> '{}')
                   OR NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = (e.value #>> '{}')::uuid AND w.archived_at IS NULL AND w.depth <= 1))
       OR (jsonb_typeof(p_value->'fallback') = 'string' AND (NOT public.ops_is_uuid(p_value->>'fallback')
           OR NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = (p_value->>'fallback')::uuid AND w.archived_at IS NULL AND w.depth <= 1))) THEN
      RAISE EXCEPTION 'invalid_setting: A route goes to a card on the board that is not removed and is at most one level down (its cards would be too deep otherwise).' USING ERRCODE = '22023';
    END IF;
    v_value := jsonb_build_object('routes', p_value->'routes', 'fallback', COALESCE(p_value->'fallback', 'null'::jsonb));
  ELSIF p_key IN ('auto_steps', 'brand_auto_cards') THEN
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
  v_before := public.ops_setting(p_key);
  UPDATE public.ops_settings SET value = v_value, updated_by = v.actor_email, updated_at = now() WHERE key = p_key;
  IF p_key = 'brand_auto_cards' AND v_value = 'true'::jsonb AND public.ops_setting('brand_auto_since') = 'null'::jsonb THEN
    UPDATE public.ops_settings SET value = to_jsonb(now()), updated_by = v.actor_email, updated_at = now() WHERE key = 'brand_auto_since';
  END IF;
  IF p_key = 'auto_steps' AND v_value = 'true'::jsonb AND public.ops_setting('follow_through_since') = 'null'::jsonb THEN
    UPDATE public.ops_settings SET value = to_jsonb(now()), updated_by = v.actor_email, updated_at = now() WHERE key = 'follow_through_since';
  END IF;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'setting_changed', 'info', NULL, NULL, NULL,
    CASE WHEN p_key = 'auto_card_routes' THEN format('%s changed where automatic cards go.', public.ops_name(v.actor_email))
         ELSE format('%s set %s to %s.', public.ops_name(v.actor_email), replace(p_key, '_', ' '), COALESCE(v_value #>> '{}', 'nobody')) END,
    jsonb_build_object('key', p_key) || CASE WHEN p_key = 'auto_card_routes' THEN jsonb_build_object('before', v_before, 'after', v_value) ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('settings', public.ops_settings_get());
END;
$function$;

-- From 20271201003980 (synced w3). #4398 (A5): the routes on screen.
CREATE OR REPLACE FUNCTION public.ops_settings_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    'can_edit', COALESCE(v.via IS NULL AND public.admin_team_role() = 'owner', false))
    -- #4398 (A5): where automatic cards go, and who may change it.
    || jsonb_build_object('auto_card_routes', public.ops_auto_routes_json(),
         'can_edit_routes', COALESCE(v.via IS NULL AND public.admin_team_role() IN ('owner', 'admin'), false));
END;
$function$;

COMMIT;
