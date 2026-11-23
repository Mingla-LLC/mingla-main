-- Issue #4571 (Work pipeline redesign), wave W1: people and goals.
--
--   1. Work cards take 1 to 10 owners and 1 to 10 watchers, nobody in both.
--      The #4398 exactly-one trigger (ops_4398_card_people_check) is replaced
--      by ops_4571_card_people_check in this same transaction, so there is
--      no moment without a gate. ops_people_check refuses a watcher who is
--      also an owner (it used to drop them without a word).
--   2. Subtasks, plan steps, reopened cards and automatic cards copy all of
--      their parent's or route's people, not the first of each.
--   3. Any one watcher confirms or sends back; the other watchers are told.
--      Card JSON gains waiting_on_all; team_inbox gains owners/watchers
--      arrays and keeps its single keys for Host app builds on phones.
--   4. Sprint goals: no five-goal cap, titles 3 to 120 characters, an
--      optional note. The met tick is the existing manual state 'done'.
--   5. The dead single sprint goal is removed: ops_sprint_set_goal and
--      ops_sprints.goal (the 'goal' key leaves ops_sprint_json,
--      ops_card_json, ops_cards_json and ops_team_overview; no client reads
--      it).
--
-- INVARIANT ops-card-owners-and-watchers (replaces
-- ops-card-one-owner-one-watcher, #4398): gate ops_4571_card_people_check;
-- test supabase/migrations/__tests__/issue_4571_w1_people_and_goals.implementor.pg17.test.sql
--
-- Static SQL only. Every function body is copied from its latest definition
-- (named beside it) and each edit is marked "#4571".
--
-- ROLLBACK (no down file): drop ops_4571_card_people_people,
-- ops_4571_card_people_cards and ops_4571_card_people_check(), then re-run
-- the trigger block of 20280626034398 only if every open card again has
-- exactly one owner and one watcher (its precheck says). Restore each
-- function from the migration named beside it (ops_work_reopen and
-- ops_sprint_goal_add need their old signatures dropped first). Re-adding
-- ops_sprints.goal restores the column empty (goal text has lived in
-- ops_sprint_goals since #4255).

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Precheck: no open card lacks an owner or a watcher. Nothing changes if
-- one does.
-- ---------------------------------------------------------------------------
DO $precheck$
DECLARE v_bad integer; v_list text;
BEGIN
  SELECT count(*), string_agg('#' || x.number, ', ' ORDER BY x.number) INTO v_bad, v_list
    FROM (SELECT w.number FROM public.ops_work_cards w
           WHERE w.status <> 'done' AND w.archived_at IS NULL
             AND (NOT EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.role = 'owner')
               OR NOT EXISTS (SELECT 1 FROM public.ops_work_people p WHERE p.card_id = w.id AND p.role = 'watcher'))
           ORDER BY w.number LIMIT 50) x;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'issue_4571_precheck: % open cards have no owner or no watcher (%). Fix them first; nothing was changed.', v_bad, v_list
      USING ERRCODE = '23514';
  END IF;
END
$precheck$;

-- ---------------------------------------------------------------------------
-- 2. The open-card gate: 1 to 10 owners and 1 to 10 watchers.
-- ---------------------------------------------------------------------------
DROP TRIGGER ops_4398_card_people_people ON public.ops_work_people;
DROP TRIGGER ops_4398_card_people_cards ON public.ops_work_cards;
DROP FUNCTION public.ops_4398_card_people_check();

-- #4571 gate for INVARIANT ops-card-owners-and-watchers. Deleting this check
-- lets a card with no watcher commit; issue_4571_w1_people_and_goals.implementor.pg17.test.sql fails.
CREATE FUNCTION public.ops_4571_card_people_check() RETURNS trigger
-- SECURITY DEFINER for the same reason as #4398: a deferred check fires at
-- COMMIT as the signed-in role, which cannot read the ops tables.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_card uuid; v_open boolean; v_owners integer; v_watchers integer;
BEGIN
  IF TG_TABLE_NAME = 'ops_work_cards' THEN
    v_card := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_card := OLD.card_id;
  ELSE
    v_card := NEW.card_id;
  END IF;
  SELECT w.status <> 'done' AND w.archived_at IS NULL INTO v_open FROM public.ops_work_cards w WHERE w.id = v_card;
  IF NOT COALESCE(v_open, false) THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE p.role = 'owner'), count(*) FILTER (WHERE p.role = 'watcher') INTO v_owners, v_watchers
    FROM public.ops_work_people p WHERE p.card_id = v_card;
  -- The (card_id, email) primary key of ops_work_people already keeps one
  -- person out of both roles.
  IF v_owners NOT BETWEEN 1 AND 10 OR v_watchers NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'card_people: A card needs at least one owner and at least one watcher, and nobody can be both.'
      USING ERRCODE = '23514', DETAIL = format('card %s has %s owners and %s watchers (1 to 10 of each)', v_card, v_owners, v_watchers);
  END IF;
  -- An UPDATE that moves people from one card to another checks the old one too.
  IF TG_TABLE_NAME = 'ops_work_people' AND TG_OP = 'UPDATE' THEN
   IF OLD.card_id IS DISTINCT FROM NEW.card_id THEN
    SELECT w.status <> 'done' AND w.archived_at IS NULL INTO v_open FROM public.ops_work_cards w WHERE w.id = OLD.card_id;
    SELECT count(*) FILTER (WHERE p.role = 'owner'), count(*) FILTER (WHERE p.role = 'watcher') INTO v_owners, v_watchers
      FROM public.ops_work_people p WHERE p.card_id = OLD.card_id;
    IF COALESCE(v_open, false) AND (v_owners NOT BETWEEN 1 AND 10 OR v_watchers NOT BETWEEN 1 AND 10) THEN
      RAISE EXCEPTION 'card_people: A card needs at least one owner and at least one watcher, and nobody can be both.' USING ERRCODE = '23514';
    END IF;
   END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_4571_card_people_check() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER ops_4571_card_people_people
  AFTER INSERT OR UPDATE OR DELETE ON public.ops_work_people
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ops_4571_card_people_check();
CREATE CONSTRAINT TRIGGER ops_4571_card_people_cards
  AFTER INSERT OR UPDATE OF status, status_id, archived_at, parent_id ON public.ops_work_cards
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ops_4571_card_people_check();

-- ---------------------------------------------------------------------------
-- 3. Helpers.
-- ---------------------------------------------------------------------------

-- #4571: the watchers a card under p_parent takes when it is given none: the
-- parent's watchers who are not among its owners, else the parent's owners
-- who are not among its owners, else the first other active admin.
CREATE FUNCTION public.ops_4571_inherit_watchers(p_parent uuid, p_owners text[]) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT CASE
           WHEN cardinality(w.x) > 0 THEN w.x
           WHEN cardinality(o.x) > 0 THEN o.x
           ELSE ARRAY(SELECT lower(btrim(au.email)) FROM public.admin_users au
                       WHERE au.status = 'active' AND public.ops_team_email(au.email) IS NOT NULL
                         AND NOT lower(btrim(au.email)) = ANY (COALESCE(p_owners, ARRAY[]::text[]))
                       ORDER BY (au.role = 'owner') DESC, au.accepted_at NULLS LAST, au.created_at LIMIT 1) END
    FROM (SELECT ARRAY(SELECT e FROM unnest(public.ops_card_people(p_parent, 'watcher')) e
                        WHERE NOT e = ANY (COALESCE(p_owners, ARRAY[]::text[])) ORDER BY e) AS x) w,
         (SELECT ARRAY(SELECT e FROM unnest(public.ops_card_people(p_parent, 'owner')) e
                        WHERE NOT e = ANY (COALESCE(p_owners, ARRAY[]::text[])) ORDER BY e) AS x) o
$function$;
REVOKE ALL ON FUNCTION public.ops_4571_inherit_watchers(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- #4571: names in words, "Ada", "Ada or Tunde", "Ada, Tunde or Kemi".
CREATE FUNCTION public.ops_4571_any_of(p_emails text[]) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT CASE WHEN cardinality(n.x) = 0 THEN NULL
              WHEN cardinality(n.x) = 1 THEN n.x[1]
              ELSE array_to_string(n.x[1:cardinality(n.x) - 1], ', ') || ' or ' || n.x[cardinality(n.x)] END
    FROM (SELECT ARRAY(SELECT public.ops_name(u.e) FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) WITH ORDINALITY u(e, o) ORDER BY u.o) AS x) n
$function$;
REVOKE ALL ON FUNCTION public.ops_4571_any_of(text[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. People checks and inheritance.
-- ---------------------------------------------------------------------------

-- From 20280626004398_issue_4398_routes_and_people.sql:254. #4571: 1 to 10 owners and watchers; an owner named as a watcher is refused.
CREATE OR REPLACE FUNCTION public.ops_people_check(p_owners jsonb, p_watchers jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
-- #4571: a card has 1 to 10 owners and 1 to 10 watchers, nobody in both.
-- Names are checked against the team as before. A watcher who is also an
-- owner is refused by name (it was dropped without a word). The open-card
-- trigger ops_4571_card_people_check backstops every writer at commit.
DECLARE
  v_fixes jsonb := '[]'::jsonb; v_owners text[] := ARRAY[]::text[]; v_watchers text[] := ARRAY[]::text[];
  v_names text := public.ops_team_names(); v_val jsonb; v_email text; v_bad integer := 0; v_bad_w integer := 0; v_both text[] := ARRAY[]::text[];  -- #4571
BEGIN
  IF p_owners IS NOT NULL AND jsonb_typeof(p_owners) NOT IN ('array', 'null') THEN
    v_bad := 1;
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'owners', 'message', 'A card needs at least one owner.'));
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
  IF v_bad = 0 AND cardinality(v_owners) = 0 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'owners', 'message', 'A card needs at least one owner.'));
  ELSIF v_bad = 0 AND cardinality(v_owners) > 10 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'owners', 'message', 'A card has at most 10 owners.'));
  END IF;
  IF p_watchers IS NOT NULL AND jsonb_typeof(p_watchers) NOT IN ('array', 'null') THEN
    v_bad_w := 1;
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message', 'A card needs at least one watcher, who is not an owner.'));
  ELSIF jsonb_typeof(p_watchers) = 'array' THEN
    FOR v_val IN SELECT e FROM jsonb_array_elements(p_watchers) e LOOP
      v_email := CASE WHEN jsonb_typeof(v_val) = 'string' THEN public.ops_team_email(v_val #>> '{}') END;
      IF v_email IS NULL THEN
        v_bad_w := v_bad_w + 1;
        IF v_bad_w <= 5 THEN
          v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message',
            format('Watcher "%s" is not on the team. Pick from %s.', left(COALESCE(v_val #>> '{}', ''), 80), v_names)));
        END IF;
      ELSIF v_email = ANY (v_owners) THEN
        -- #4571: refused, never silently dropped.
        IF NOT v_email = ANY (v_both) THEN
          v_both := v_both || v_email;
          v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message',
            format('%s owns this card, so they cannot also watch it.', public.ops_name(v_email))));
        END IF;
      ELSIF NOT v_email = ANY (v_watchers) THEN
        v_watchers := v_watchers || v_email;
      END IF;
    END LOOP;
  END IF;
  IF v_bad_w = 0 AND cardinality(v_both) = 0 AND cardinality(v_watchers) = 0 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message', 'A card needs at least one watcher, who is not an owner.'));
  ELSIF v_bad_w = 0 AND cardinality(v_watchers) > 10 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'watchers', 'message', 'A card has at most 10 watchers.'));
  END IF;
  RETURN jsonb_build_object('owners', to_jsonb(ARRAY(SELECT x FROM unnest(v_owners) x ORDER BY x)),
                            'watchers', to_jsonb(ARRAY(SELECT x FROM unnest(v_watchers) x ORDER BY x)),
                            'fixes', v_fixes);
END;
$function$;

-- From 20281121034420_issue_4420_tickets_on_work_board.sql:232. #4571: a subtask given no people takes all of its parent's.
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

  -- #4571: every card has 1 to 10 owners and 1 to 10 watchers, for every
  -- mode. A subtask given no owners takes ALL of its parent's owners; given
  -- no watchers, all the parent's watchers who are not its owners, else the
  -- parent's owners who are not its owners, else the first other admin
  -- (ops_4571_inherit_watchers).
  v_owners_in := p_item->'owners'; v_watchers_in := p_item->'watchers';
  IF v_parent_id IS NOT NULL THEN
    IF (v_owners_in IS NULL OR jsonb_typeof(v_owners_in) = 'null' OR v_owners_in = '[]'::jsonb)
       AND cardinality(public.ops_card_people(v_parent_id, 'owner')) > 0 THEN
      v_owners_in := to_jsonb(public.ops_card_people(v_parent_id, 'owner'));
    END IF;
    IF v_watchers_in IS NULL OR jsonb_typeof(v_watchers_in) = 'null' OR v_watchers_in = '[]'::jsonb THEN
      v_watchers_in := to_jsonb(public.ops_4571_inherit_watchers(v_parent_id,
        ARRAY(SELECT jsonb_array_elements_text(public.ops_people_check(v_owners_in, '[]'::jsonb)->'owners'))));
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
  IF v_kind = 'ticket' AND p_mode = 'update' THEN
    NULL;  -- #4420: a stored ticket stays a ticket (update_work reads the stored kind)
  ELSIF v_kind = 'ticket' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kind', 'message', 'Tickets are made with Create ticket in Admin.'));
    v_kind := 'task';
  ELSIF v_kind NOT IN ('task','gate_live','promo') THEN
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
    ELSIF v_dates > 1 AND (NOT (p_item ? 'due_on') OR jsonb_typeof(p_item->'due_on') = 'null' OR v_kit IS NOT NULL OR v_kind NOT IN ('task','ticket')) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'anchor', 'message', 'Several events are linked. Say which one this card is counted from (anchor).'));
    END IF;
  END IF;
  IF v_kit IS NOT NULL AND v_anchor IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' IN ('kit_step','anchor')) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'kit_step', 'message', 'Kit step must be one of -35, -31, -28, -26, -21, -14, -7 or 2, and needs a linked event.'));
  END IF;
  IF v_kind NOT IN ('task','ticket') AND v_anchor IS NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'anchor') THEN
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
$function$;

-- From 20280626004398_issue_4398_routes_and_people.sql:625. #4571: a new plan step takes all of its parent's people.
CREATE OR REPLACE FUNCTION public.ops_plan_sync(p_card_id uuid, p_plan jsonb, p_actor text, p_via text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  p public.ops_work_cards; x public.ops_work_cards; n public.ops_work_cards; v_subs uuid[]; s jsonb; i integer := 0; v_title text; v_step jsonb;
  v_done boolean; v_changed integer := 0; v_owners text[]; v_owner text; v_watcher text; v_watchers text[]; /* #4571 */ v_id uuid; v_before jsonb; v_action text;
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
      -- #4571: a new step's owners are the step's one named person, else ALL
      -- the parent's owners; its watchers come by the subtask rule
      -- (ops_4571_inherit_watchers). Steps that already exist keep their people.
      v_owners := public.ops_4255_step_owners(s->>'text', s->>'tool', p.id);
      v_owners := CASE WHEN cardinality(v_owners) = 1 THEN v_owners ELSE public.ops_card_people(p.id, 'owner') END;
      v_watchers := public.ops_4571_inherit_watchers(p.id, v_owners);
      INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via)
      SELECT v_id, o, 'owner', p_actor, v_people_via FROM unnest(v_owners) o WHERE o IS NOT NULL ON CONFLICT DO NOTHING;
      INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via)
      SELECT v_id, o, 'watcher', p_actor, v_people_via FROM unnest(v_watchers) o
       WHERE o IS NOT NULL AND NOT o = ANY (v_owners) ON CONFLICT DO NOTHING;
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
$function$;

DROP FUNCTION public.ops_work_reopen(uuid, text, bigint, text, text);

-- From 20280626014398_issue_4398_review_and_notices.sql:952. #4571: reopening takes lists of owners and watchers.
CREATE FUNCTION public.ops_work_reopen(p_id uuid, p_reason text, p_expected_revision bigint,
                                       p_owners jsonb DEFAULT NULL, p_watchers jsonb DEFAULT NULL)  -- #4571: lists
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
        v_reason text := public.ops_one_line(p_reason);
        v_owners text[]; v_watchers text[]; v_o jsonb; v_w jsonb; v_chk jsonb; v_new_o text[]; v_new_w text[];  -- #4571
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF char_length(COALESCE(v_reason, '')) > 500 OR public.ops_has_control(v_reason) THEN
    RAISE EXCEPTION 'invalid_reason: Keep the reason to 500 characters.' USING ERRCODE = '22023';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status <> 'done' THEN RAISE EXCEPTION 'not_closed: This card is still open.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  -- #4571: an open card has 1 to 10 owners and 1 to 10 watchers. People
  -- given here replace the card's; none given keeps the card's own, else
  -- takes all of the parent's (watchers by ops_4571_inherit_watchers).
  v_owners := public.ops_card_people(c.id, 'owner'); v_watchers := public.ops_card_people(c.id, 'watcher');
  IF p_owners IS NOT NULL AND jsonb_typeof(p_owners) <> 'null' AND p_owners <> '[]'::jsonb THEN v_o := p_owners;
  ELSIF cardinality(v_owners) > 0 THEN v_o := to_jsonb(v_owners);
  ELSIF c.parent_id IS NOT NULL THEN v_o := to_jsonb(public.ops_card_people(c.parent_id, 'owner'));
  ELSE v_o := '[]'::jsonb;
  END IF;
  v_new_o := ARRAY(SELECT jsonb_array_elements_text(public.ops_people_check(v_o, '[]'::jsonb)->'owners'));
  IF p_watchers IS NOT NULL AND jsonb_typeof(p_watchers) <> 'null' AND p_watchers <> '[]'::jsonb THEN v_w := p_watchers;
  ELSE
    v_new_w := ARRAY(SELECT x FROM unnest(v_watchers) x WHERE NOT x = ANY (v_new_o));
    IF cardinality(v_new_w) = 0 AND c.parent_id IS NOT NULL THEN v_new_w := public.ops_4571_inherit_watchers(c.parent_id, v_new_o); END IF;
    v_w := to_jsonb(v_new_w);
  END IF;
  v_chk := public.ops_people_check(v_o, v_w);
  IF jsonb_array_length(v_chk->'fixes') > 0 THEN
    RAISE EXCEPTION '%', 'card_people: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_chk->'fixes') f)
      || ' Pick the people, then reopen it.' USING ERRCODE = '23514';
  END IF;
  v_new_o := ARRAY(SELECT jsonb_array_elements_text(v_chk->'owners'));
  v_new_w := ARRAY(SELECT jsonb_array_elements_text(v_chk->'watchers'));
  IF v_new_o IS DISTINCT FROM v_owners OR v_new_w IS DISTINCT FROM v_watchers THEN
    PERFORM public.ops_people_set(c.id, v_new_o, v_new_w, v.actor_email, v.via);
  END IF;
  v_before := public.ops_card_snapshot(c.id);
  BEGIN
    UPDATE public.ops_work_cards SET status = 'todo', close_kind = NULL, close_reason = NULL, closed_at = NULL, closed_by = NULL, closed_via = NULL,
      started_at = NULL, working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL, proof = '[]'::jsonb,
      sprint_id = public.ops_sprint_for(c.due_on, v_today),
      revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE id = c.id RETURNING * INTO n;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate: Another open card already has this title, so this one cannot be reopened. Update that card instead.' USING ERRCODE = '22023';
  END;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'reopened', v_reason, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(v.actor_email, v.via, 'reopened', 'ok', c.id, 'work_card', c.id,
    format('Reopened Card %s: %s', n.number, n.title), '{}'::jsonb);
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
    format('%s reopened: %s', public.ops_actor_label(v.actor_email, v.via), n.title), 'status');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_work_reopen(uuid, text, bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_work_reopen(uuid, text, bigint, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_work_reopen(uuid, text, bigint, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Automatic cards copy all of their route card's people.
-- ---------------------------------------------------------------------------

-- From 20280626004398_issue_4398_routes_and_people.sql:101. #4571: a route card has 1 to 10 owners and watchers.
CREATE OR REPLACE FUNCTION public.ops_auto_route_target(p_card_id uuid) RETURNS public.ops_work_cards
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE c public.ops_work_cards; v_cursor uuid := p_card_id; v_hops integer := 0;
BEGIN
  WHILE v_cursor IS NOT NULL AND v_hops < 4 LOOP
    v_hops := v_hops + 1;
    SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = v_cursor;
    EXIT WHEN NOT FOUND;
    IF c.status <> 'done' AND c.archived_at IS NULL AND c.depth <= 1
       AND cardinality(public.ops_card_people(c.id, 'owner')) BETWEEN 1 AND 10  -- #4571: 1 to 10 of each
       AND cardinality(public.ops_card_people(c.id, 'watcher')) BETWEEN 1 AND 10 THEN
      RETURN c;
    END IF;
    v_cursor := c.parent_id;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- From 20280626004398_issue_4398_routes_and_people.sql:124. #4571: returns every owner and watcher of the route card.
CREATE OR REPLACE FUNCTION public.ops_auto_route(p_kind text) RETURNS jsonb
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
    'owners', to_jsonb(public.ops_card_people(t.id, 'owner')), 'watchers', to_jsonb(public.ops_card_people(t.id, 'watcher')),
    -- #4571: owner and watcher (the first of each) stay for brand_plan_host_add,
    -- which keeps its own rule (the host card's owner owns a Host app task).
    'owner', (public.ops_card_people(t.id, 'owner'))[1], 'watcher', (public.ops_card_people(t.id, 'watcher'))[1], 'via', v_via);
END;
$function$;

-- From 20280626004398_issue_4398_routes_and_people.sql:149. #4571: owners and watchers as name lists.
CREATE OR REPLACE FUNCTION public.ops_auto_routes_json() RETURNS jsonb
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
                     'owners', to_jsonb(ARRAY(SELECT public.ops_name(e) FROM unnest(public.ops_card_people(c.id, 'owner')) e)),
                     'watchers', to_jsonb(ARRAY(SELECT public.ops_name(e) FROM unnest(public.ops_card_people(c.id, 'watcher')) e))) END,
      'state', CASE WHEN v_use IS NULL THEN 'nowhere' WHEN (v_use->>'parent_id')::uuid IS NOT DISTINCT FROM c.id THEN 'open' ELSE 'using' END,
      'using', CASE WHEN v_use IS NOT NULL AND (v_use->>'parent_id')::uuid IS DISTINCT FROM c.id
                    THEN jsonb_build_object('id', v_use->'parent_id', 'number', v_use->'number', 'title', v_use->'title') END));
  END LOOP;
  RETURN jsonb_build_object('routes', v_rows,
    'fallback', CASE WHEN v_fb.id IS NOT NULL THEN jsonb_build_object('id', v_fb.id, 'number', v_fb.number, 'title', v_fb.title,
                  'open', v_fb.status <> 'done' AND v_fb.archived_at IS NULL,
                  'owners', to_jsonb(ARRAY(SELECT public.ops_name(e) FROM unnest(public.ops_card_people(v_fb.id, 'owner')) e)),
                  'watchers', to_jsonb(ARRAY(SELECT public.ops_name(e) FROM unnest(public.ops_card_people(v_fb.id, 'watcher')) e))) END);
END;
$function$;

-- From 20280626014398_issue_4398_review_and_notices.sql:668. #4571: the card takes every owner and watcher of its route card.
CREATE OR REPLACE FUNCTION public.ops_auto_card_upsert(p_auto_key text, p_item jsonb, p_kind text, p_anchor jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  c_actor constant text := 'system@usemingla.com'; v_today date := public.ops_today(NULL); v_item jsonb; v_chk jsonb; cl jsonb;
  c public.ops_work_cards; v_event uuid; v_owners text[]; v_watchers text[]; v_existing uuid;
  v_kind text := split_part(COALESCE(p_auto_key, ''), ':', 1); v_route jsonb; v_alarm uuid;  -- #4398
BEGIN
  IF p_auto_key IS NULL OR p_auto_key !~ '^[a-z_]+:[A-Za-z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION 'invalid_auto_key: An automatic card needs a key like eng_no_issue:pr-12.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_auto_card:' || p_auto_key, 0));
  -- A4: the open-card check is by auto_key, whatever its parent: moving a
  -- card between parents never makes a second one.
  SELECT w.id INTO v_existing FROM public.ops_work_cards w
   WHERE w.auto_key = p_auto_key AND w.archived_at IS NULL AND w.status <> 'done' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('status', 'kept', 'id', v_existing); END IF;
  -- A standing card (feature_guide_gap:current) and the route alarm come
  -- back whenever their problem does, even soon after a person closed them.
  IF v_kind NOT IN ('route_missing') AND p_auto_key <> 'feature_guide_gap:current'
     AND EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.auto_key = p_auto_key AND w.status = 'done'
              AND w.close_kind IN ('done','already_done','declined') AND w.closed_at > now() - interval '14 days') THEN
    RETURN jsonb_build_object('status', 'kept', 'id', NULL);
  END IF;
  v_item := COALESCE(p_item, '{}'::jsonb) || jsonb_build_object('kind', COALESCE(p_kind, 'task'));
  IF p_anchor IS NOT NULL AND jsonb_typeof(p_anchor) = 'object' THEN v_item := v_item || jsonb_build_object('anchor', p_anchor); END IF;
  -- #4398 (A3): the card goes under its kind's route (walked up to the first
  -- open card), else the fallback, with exactly that card's owner and
  -- watcher, whatever the maker passed. Nowhere to go: one top-level alarm
  -- card, never this card at the top level. Only the alarm itself is made
  -- at the top level, with the people it names.
  IF v_kind <> 'route_missing' THEN
    v_route := public.ops_auto_route(v_kind);
    IF v_route IS NULL THEN
      v_alarm := public.ops_auto_route_missing(v_kind, p_auto_key, CASE WHEN jsonb_typeof(v_item->'title') = 'string' THEN v_item->>'title' END);
      RETURN jsonb_build_object('status', 'refused', 'route_missing', v_alarm,
        'fixes', jsonb_build_array(jsonb_build_object('field', 'parent', 'message',
          format('No open main task takes "%s" cards. Point them at one in Admin > Settings > Automatic cards.', public.ops_auto_kind_words(v_kind)))));
    END IF;
    v_item := (v_item - 'owners' - 'watchers' - 'parent')
      || jsonb_build_object('parent', v_route->>'parent_id', 'owners', v_route->'owners', 'watchers', v_route->'watchers');  -- #4571: everyone
    IF (v_route->>'depth')::integer >= 1 THEN
      -- The card lands two levels down: it takes no subtasks.
      IF jsonb_typeof(v_item->'plan') = 'array' AND jsonb_array_length(v_item->'plan') > 0 THEN
        RAISE WARNING 'ops_auto_card_upsert: % refused (a plan under a card two levels down)', p_auto_key;
        RETURN jsonb_build_object('status', 'refused', 'fixes', jsonb_build_array(jsonb_build_object('field', 'plan', 'message',
          'too_deep: Subtasks go two levels deep at most (card, subtask, sub-subtask). Route this kind to a main task, or send no plan.')));
      END IF;
      v_item := v_item || jsonb_build_object('plan', '[]'::jsonb);
    END IF;
  END IF;
  v_chk := public.ops_validate_card(v_item, 'auto', c_actor, v_today);
  IF jsonb_array_length(v_chk->'fixes') > 0 THEN
    RAISE WARNING 'ops_auto_card_upsert: % refused (%)', p_auto_key, (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_chk->'fixes') f);
    RETURN jsonb_build_object('status', 'refused', 'fixes', v_chk->'fixes');
  END IF;
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
    RETURN jsonb_build_object('status', 'duplicate', 'existing', v_chk->'duplicate');
  END IF;
  cl := v_chk->'clean';
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  INSERT INTO public.ops_work_cards (title, instructions, done_means, status, person_reason, kind, kit_step, anchor_kind, anchor_id, due_on, due_source,
    sprint_id, plan, created_by, created_via, updated_by, updated_via, auto_key, parent_id)
  VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
    'todo', cl->>'person_reason', cl->>'kind', (cl->>'kit_step')::integer,
    cl->>'anchor_kind', (cl->>'anchor_id')::uuid, (cl->>'due_on')::date, cl->>'due_source',
    public.ops_sprint_ensure(v_today), '[]'::jsonb, c_actor, 'system', c_actor, 'system', p_auto_key,
    (cl->>'parent_id')::uuid)  -- #4398
  RETURNING * INTO c;
  PERFORM public.ops_people_set(c.id, v_owners, v_watchers, c_actor, NULL);
  PERFORM public.ops_links_set(c.id, cl->'links', c_actor, NULL);
  PERFORM public.ops_github_set(c.id, cl->'github', c_actor, NULL);
  PERFORM public.ops_plan_sync(c.id, cl->'plan', c_actor, 'system');  -- #4255: the plan is subtasks
  v_event := public.ops_card_event(c.id, c_actor, 'system', 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
  PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', c.id, 'work_card', c.id,
    format('Mingla added Card %s: %s', c.number, c.title), jsonb_build_object('auto_key', p_auto_key, 'owners', cardinality(v_owners),
      'parent', v_route->'number', 'route', v_route->'via'));
  PERFORM public.ops_notify_people(c.id, v_event, v_owners || v_watchers, c_actor, format('Mingla added: %s', c.title), 'bot');
  RETURN jsonb_build_object('status', 'added', 'id', c.id, 'number', c.number, 'parent_id', c.parent_id);
END;
$function$;

-- From 20280626004398_issue_4398_routes_and_people.sql:220. #4571: a re-filed card takes every owner and watcher of its route card.
CREATE OR REPLACE FUNCTION public.ops_auto_card_reroute(p_card_id uuid) RETURNS boolean
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
      PERFORM public.ops_people_set(c.id, ARRAY(SELECT jsonb_array_elements_text(v_route->'owners')),
        ARRAY(SELECT jsonb_array_elements_text(v_route->'watchers')), 'system@usemingla.com', NULL);  -- #4571: everyone
      v_done := true;
    END IF;
  END IF;
  -- #4571: an open card without 1 to 10 owners and watchers would fail at
  -- commit; say so here, where the caller can still keep the rest of its run.
  IF c.status <> 'done' AND (cardinality(public.ops_card_people(c.id, 'owner')) NOT BETWEEN 1 AND 10
                             OR cardinality(public.ops_card_people(c.id, 'watcher')) NOT BETWEEN 1 AND 10) THEN
    RAISE EXCEPTION 'card_people: A card needs at least one owner and at least one watcher, and nobody can be both.' USING ERRCODE = '23514';
  END IF;
  RETURN v_done;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Review by any one watcher.
-- ---------------------------------------------------------------------------

-- From 20280626014398_issue_4398_review_and_notices.sql:221. #4571: any watcher.
CREATE OR REPLACE FUNCTION public.ops_review_leave_check(p_card public.ops_work_cards, p_actor text, p_via text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_card.review_requested_at IS NOT NULL AND p_via IS NULL
     AND p_actor = ANY (public.ops_card_people(p_card.id, 'watcher')) THEN  -- #4571: any watcher
    RAISE EXCEPTION 'use_send_back: You watch this card. Confirm it, or send it back with what is missing.' USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- From 20280626014398_issue_4398_review_and_notices.sql:438. #4571: every watcher is asked; any one of them confirming by closing is the confirm.
CREATE OR REPLACE FUNCTION public.ops_work_finish(p_card public.ops_work_cards, p_actor text, p_via text, p_kind text, p_reason text,
                                       p_result text, p_proof jsonb, p_close_children boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE c public.ops_work_cards := p_card; n public.ops_work_cards; v_watchers text[] := public.ops_card_people(p_card.id, 'watcher');  -- #4571: every watcher
        v_col uuid := public.ops_review_status_id(); v_before jsonb; v_event uuid; v_who text; v_wname text; v_open integer;
        v_today date := public.ops_today(NULL);
BEGIN
  IF p_via IS NULL AND p_actor = ANY (v_watchers) THEN  -- #4571: any watcher's own close is the confirm
    IF COALESCE(current_setting('ops.review_confirmed', true), '') <> 'on' THEN PERFORM set_config('ops.review_confirmed', c.id::text, true); END IF;
    PERFORM set_config('ops.review_confirmer', p_actor, true);
    RETURN NULL;
  END IF;
  IF c.auto_key LIKE 'eng\_release:%' AND p_kind = 'done' THEN
    RAISE EXCEPTION 'self_closing: This card closes by itself when the release record shows nothing left. Fix the open items on its checklist.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_watchers) = 0 THEN
    RAISE EXCEPTION 'card_people: A card needs at least one owner and at least one watcher, and nobody can be both.' USING ERRCODE = '23514';
  END IF;
  v_wname := public.ops_4571_any_of(v_watchers);  -- #4571: "Ada or Tunde"
  IF c.review_requested_at IS NOT NULL THEN
    RAISE EXCEPTION '%', format('in_review: This card already waits for %s to confirm it.', v_wname) USING ERRCODE = '22023';
  END IF;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'review_column_missing: The board has no In review column. Ask an admin to add it back.' USING ERRCODE = '22023';
  END IF;
  -- The children rule, as a close would apply it, at the time the owner asks.
  IF p_kind = 'done' AND NOT COALESCE(p_close_children, false) THEN
    SELECT count(*) INTO v_open FROM public.ops_work_cards x
     WHERE x.parent_id = c.id AND x.status <> 'done' AND x.archived_at IS NULL AND x.plan_step IS NULL;
    IF v_open > 0 THEN
      RAISE EXCEPTION '%', format('open_subtasks: This card has %s open %s. Close %s first, or choose to close %s too.',
          v_open, CASE WHEN v_open = 1 THEN 'subtask' ELSE 'subtasks' END,
          CASE WHEN v_open = 1 THEN 'it' ELSE 'them' END, CASE WHEN v_open = 1 THEN 'it' ELSE 'them' END)
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_who := public.ops_actor_label(p_actor, p_via);
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards w SET status_id = v_col, person_reason = NULL,
    review_requested_at = clock_timestamp(), review_requested_by = p_actor, review_requested_via = CASE WHEN p_via IN ('claude','codex') THEN p_via END,
    review_kind = p_kind, review_reason = left(NULLIF(public.ops_one_line(p_reason), ''), 500), review_close_children = COALESCE(p_close_children, false),
    -- the Closed column the owner chose (a move to a custom Closed column), kept for the confirm
    review_close_status_id = (SELECT s.id FROM public.ops_work_statuses s
                               WHERE s.id = NULLIF(current_setting('ops.close_to', true), '')::uuid AND s.grp = 'done' AND s.archived_at IS NULL),
    sent_back_reason = NULL, sent_back_by = NULL, sent_back_at = NULL,
    result = COALESCE(p_result, w.result), proof = COALESCE(p_proof, w.proof),
    working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
    revision = w.revision + 1, updated_by = p_actor, updated_via = CASE WHEN p_via IN ('claude','codex') THEN p_via END, updated_at = now()
   WHERE w.id = c.id RETURNING w.* INTO n;
  PERFORM public.ops_claims_release_card(c.id, 'closed', p_actor);
  v_event := public.ops_card_event(c.id, p_actor, CASE WHEN p_via IN ('claude','codex') THEN p_via END, 'review',
    left(format('%s says this is %s. Waiting on %s to confirm.', v_who,
      CASE p_kind WHEN 'declined' THEN 'not needed' WHEN 'already_done' THEN 'already done' ELSE 'done' END, v_wname)
      || COALESCE(' ' || NULLIF(public.ops_one_line(p_reason), ''), ''), 2000),
    v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(p_actor, CASE WHEN p_via IN ('claude','codex') THEN p_via END, 'updated', 'ok', c.id, 'work_card', c.id,
    left(format('Card %s is in review, waiting on %s: %s', n.number, v_wname, n.title), 300),
    jsonb_build_object('review', true, 'kind', p_kind));
  PERFORM public.ops_notify_people(c.id, v_event, v_watchers, p_actor,  -- #4571: every watcher
    format('%s says Card %s is %s. Confirm or send back: %s', v_who, n.number,
      CASE p_kind WHEN 'declined' THEN 'not needed' WHEN 'already_done' THEN 'already done' ELSE 'done' END, n.title), 'review');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event,
    'review', jsonb_build_object('watcher', v_watchers[1], 'watcher_name', v_wname, 'watchers', to_jsonb(v_watchers)),
    'message', format('Sent to %s for review. The card waits In review until %s confirms it or sends it back.', v_wname,
                      CASE WHEN cardinality(v_watchers) > 1 THEN 'one of them' ELSE v_wname END));
END;
$function$;

-- From 20280626014398_issue_4398_review_and_notices.sql:510. #4571: any one watcher confirms; the other watchers are told.
CREATE OR REPLACE FUNCTION public.ops_work_confirm(p_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid; v_watchers text[]; v_name text;  -- #4571
        v_open uuid[] := ARRAY[]::uuid[]; v_closed jsonb := '[]'::jsonb;  -- #4398: the subtasks this confirm closes
        v_today date := public.ops_today(NULL);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: Confirming is a person''s step. Ask your person to confirm it in Mingla Admin.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: This card is already closed.' USING ERRCODE = '22023'; END IF;
  IF c.review_requested_at IS NULL THEN
    RAISE EXCEPTION 'not_in_review: This card is not waiting for a confirm.' USING ERRCODE = '22023';
  END IF;
  -- #4571 gate (ops-review-any-watcher): any one watcher confirms. Two at
  -- once are serialised by ops_card_lock; the second gets PT409.
  v_watchers := public.ops_card_people(c.id, 'watcher');
  IF v.actor_email IS NULL OR NOT v.actor_email = ANY (v_watchers) THEN
    RAISE EXCEPTION '%', format('not_watcher: Only a watcher of this card confirms it (%s).', COALESCE(public.ops_4571_any_of(v_watchers), 'nobody yet'))
      USING ERRCODE = '42501';
  END IF;
  v_name := public.ops_name(v.actor_email);
  IF COALESCE(current_setting('ops.review_confirmed', true), '') <> 'on' THEN PERFORM set_config('ops.review_confirmed', c.id::text, true); END IF;
  PERFORM set_config('ops.review_confirmer', v.actor_email, true);
  IF c.review_close_children THEN
    PERFORM set_config('ops.close_children', 'on', true);
    -- #4398 retest (P3-A): the open subtasks (and theirs) this confirm will close, nearest first.
    v_open := ARRAY(WITH RECURSIVE d AS (
        SELECT w.id, 1 AS depth FROM public.ops_work_cards w WHERE w.parent_id = c.id AND w.status <> 'done' AND w.archived_at IS NULL
        UNION ALL
        SELECT w.id, d.depth + 1 FROM public.ops_work_cards w JOIN d ON w.parent_id = d.id WHERE w.status <> 'done' AND w.archived_at IS NULL AND d.depth < 5)
      SELECT d.id FROM d ORDER BY d.depth, d.id);
  END IF;
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards w SET status = 'done',
    status_id = COALESCE((SELECT s.id FROM public.ops_work_statuses s WHERE s.id = c.review_close_status_id AND s.archived_at IS NULL),
                         public.ops_status_default('done')),
    person_reason = NULL, blocked = false, blocked_kind = NULL, blocked_reason = NULL,
    close_kind = c.review_kind, close_reason = CASE WHEN c.review_kind <> 'done' THEN COALESCE(c.review_reason, 'Confirmed by the watcher.') END,
    closed_at = clock_timestamp(), closed_by = c.review_requested_by, closed_via = c.review_requested_via,
    confirmed_by = v.actor_email, confirmed_at = clock_timestamp(),
    working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
    revision = w.revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
   WHERE w.id = c.id RETURNING w.* INTO n;
  PERFORM set_config('ops.close_children', '', true);
  -- #4398 retest (P3-A): the close event of each subtask closed here, kept on the confirm's record so
  -- Undo reopens exactly these (subtasks closed before stay Done).
  IF cardinality(v_open) > 0 THEN
    v_closed := COALESCE((SELECT jsonb_agg(x.ev ORDER BY x.ord) FROM (
        SELECT (SELECT ev.id FROM public.ops_work_events ev WHERE ev.card_id = o.id AND ev.action = 'closed' ORDER BY ev.at DESC LIMIT 1) AS ev, o.ord
          FROM unnest(v_open) WITH ORDINALITY o(id, ord)
         WHERE EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = o.id AND w.status = 'done')) x WHERE x.ev IS NOT NULL), '[]'::jsonb);
    v_before := v_before || jsonb_build_object('closed_children', v_closed);
  END IF;
  PERFORM public.ops_claims_release_card(c.id, 'closed', v.actor_email);
  v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'confirmed', format('%s confirmed it. Done.', v_name),
    v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(v.actor_email, NULL, 'closed', 'ok', c.id, 'work_card', c.id,
    left(format('%s confirmed Card %s: %s', v_name, n.number, n.title), 300), jsonb_build_object('confirmed', true));
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, 'owner') || c.review_requested_by, v.actor_email,
    format('%s confirmed: %s', v_name, n.title), 'status');
  -- #4571: the other watchers are told too.
  PERFORM public.ops_notify_people(c.id, v_event,
    ARRAY(SELECT x FROM unnest(v_watchers) x WHERE x <> v.actor_email
            AND NOT x = ANY (public.ops_card_people(c.id, 'owner') || c.review_requested_by)), v.actor_email,
    format('%s confirmed: %s', v_name, n.title), 'status');
  -- People taken off the card in the last day still hear that it closed (the #3980 guardrail), now at the confirm.
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_recently_removed(c.id), v.actor_email,
    format('%s closed a card you were taken off in the last 24 hours: %s', public.ops_actor_label(c.review_requested_by, c.review_requested_via), n.title), 'edit');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;

-- From 20280626014398_issue_4398_review_and_notices.sql:586. #4571: any one watcher sends back; the other watchers are told.
CREATE OR REPLACE FUNCTION public.ops_work_send_back(p_id uuid, p_reason text, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid; v_watchers text[]; v_name text;  -- #4571
        v_reason text := public.ops_one_line(p_reason); v_today date := public.ops_today(NULL);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: Sending a card back is a person''s step. Ask your person to do it in Mingla Admin.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 300 OR public.ops_has_control(v_reason) THEN
    RAISE EXCEPTION 'reason_required: Say what is missing in 5 to 300 characters. The owner sees it.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: This card is already closed. Reopen it instead.' USING ERRCODE = '22023'; END IF;
  IF c.review_requested_at IS NULL THEN
    RAISE EXCEPTION 'not_in_review: This card is not waiting for a confirm.' USING ERRCODE = '22023';
  END IF;
  v_watchers := public.ops_card_people(c.id, 'watcher');  -- #4571: any one watcher
  IF v.actor_email IS NULL OR NOT v.actor_email = ANY (v_watchers) THEN
    RAISE EXCEPTION '%', format('not_watcher: Only a watcher of this card sends it back (%s).', COALESCE(public.ops_4571_any_of(v_watchers), 'nobody yet'))
      USING ERRCODE = '42501';
  END IF;
  v_name := public.ops_name(v.actor_email);
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards w SET status_id = public.ops_status_in_progress(),
    sent_back_reason = v_reason, sent_back_by = v.actor_email, sent_back_at = clock_timestamp(),
    revision = w.revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
   WHERE w.id = c.id RETURNING w.* INTO n;
  v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'sent_back', v_reason, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  INSERT INTO public.ops_work_messages (card_id, author_email, via, body_md, event_id)
  VALUES (c.id, v.actor_email, NULL, left('Sent back: ' || v_reason, 10000), v_event);
  PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', c.id, 'work_card', c.id,
    left(format('%s sent Card %s back: %s', v_name, n.number, v_reason), 300), jsonb_build_object('sent_back', true));
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, 'owner') || c.review_requested_by, v.actor_email,
    format('%s sent back: %s — %s', v_name, n.title, v_reason), 'sent_back');
  -- #4571: the other watchers are told.
  PERFORM public.ops_notify_people(c.id, v_event,
    ARRAY(SELECT x FROM unnest(v_watchers) x WHERE x <> v.actor_email
            AND NOT x = ANY (public.ops_card_people(c.id, 'owner') || c.review_requested_by)), v.actor_email,
    format('%s sent back: %s — %s', v_name, n.title, v_reason), 'status');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;

-- From 20280626014398_issue_4398_review_and_notices.sql:788. #4571: any watcher closing a card that waits for them is the confirm.
CREATE OR REPLACE FUNCTION public.ops_work_close(p_id uuid, p_proof jsonb, p_result text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
        v_proof jsonb; v_result text; v_fin jsonb; -- #4398
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: This card is already closed. Reopen it first.' USING ERRCODE = '22023'; END IF;
  -- #4398 (C): the watcher closing a card that waits for them is the confirm.
  IF c.review_requested_at IS NOT NULL AND v.via IS NULL AND v.actor_email = ANY (public.ops_card_people(c.id, 'watcher')) THEN  -- #4571
    RETURN public.ops_work_confirm(p_id, p_expected_revision);
  END IF;
  PERFORM public.ops_close_rules(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_result := COALESCE(public.ops_multi_line(p_result), c.result);
  IF char_length(COALESCE(v_result, '')) > 2000 OR public.ops_has_control(v_result) THEN
    RAISE EXCEPTION 'invalid_result: Keep the result to 2,000 characters.' USING ERRCODE = '22023';
  END IF;
  v_proof := public.ops_proof_check(c, p_proof, v.actor_email, v.via, 1);
  -- #4398 (C): a close by anyone but the signed-in watcher goes to In review.
  v_fin := public.ops_work_finish(c, v.actor_email, v.via, 'done', NULL, v_result, v_proof,
    COALESCE(current_setting('ops.close_children', true), '') = 'on');
  IF v_fin IS NOT NULL THEN RETURN v_fin; END IF;
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards SET status = 'done', person_reason = NULL, blocked = false, blocked_kind = NULL, blocked_reason = NULL,
    close_kind = 'done', close_reason = NULL, closed_at = clock_timestamp(), closed_by = v.actor_email, closed_via = v.via,
    result = v_result, proof = v_proof, working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL, revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  PERFORM public.ops_claims_release_card(c.id, 'closed', v.actor_email);
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'closed', NULL, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(v.actor_email, v.via, 'closed', 'ok', c.id, 'work_card', c.id,
    format('Closed Card %s with %s proof: %s', n.number, jsonb_array_length(v_proof), n.title),
    jsonb_build_object('verified', (SELECT count(*) FROM jsonb_array_elements(v_proof) p WHERE (p->>'verified')::boolean)));
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
    format('%s closed: %s', public.ops_actor_label(v.actor_email, v.via), n.title), 'status');
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_recently_removed(c.id), v.actor_email,
    format('%s closed a card you were taken off in the last 24 hours: %s', public.ops_actor_label(v.actor_email, v.via), n.title), 'edit');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;

-- From 20280626014398_issue_4398_review_and_notices.sql:1025. #4571: own_review for any watcher.
CREATE OR REPLACE FUNCTION public.ops_work_move(p_id uuid, p_status_id uuid, p_expected_revision bigint, p_proof jsonb DEFAULT NULL::jsonb, p_result text DEFAULT NULL::text, p_close_children boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; s public.ops_work_statuses; v_out jsonb; v_rev bigint;
        v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO s FROM public.ops_work_statuses x WHERE x.id = p_status_id;
  IF NOT FOUND OR s.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_found: That column is no longer on the board. Reload it, then try again.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status_id = s.id THEN
    RETURN jsonb_build_object('card', public.ops_card_json(c, v_today), 'event_id', NULL, 'changed', false);
  END IF;
  -- #4398 (C): the watcher leaves In review only by Confirm (a move to a
  -- closed column) or Send back.
  IF s.grp <> 'done' AND c.status <> 'done' THEN PERFORM public.ops_review_leave_check(c, v.actor_email, v.via); END IF;
  IF s.role = 'review' AND c.status <> 'done' THEN
    -- A move into In review asks the watcher to confirm, like Mark done.
    IF v.via IS NULL AND v.actor_email = ANY (public.ops_card_people(c.id, 'watcher')) THEN  -- #4571
      RAISE EXCEPTION 'own_review: You watch this card, so it needs no review. Move it to Done to close it.' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_close_children, false) THEN PERFORM set_config('ops.close_children', 'on', true); END IF;
    v_out := public.ops_work_close(p_id, COALESCE(p_proof, '[]'::jsonb), p_result, p_expected_revision);
    PERFORM set_config('ops.close_children', '', true);
    SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = p_id;
    RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_out->'event_id', 'changed', true,
      'review', v_out->'review', 'message', v_out->'message');
  END IF;
  IF s.grp = 'done' THEN
    IF COALESCE(p_close_children, false) THEN PERFORM set_config('ops.close_children', 'on', true); END IF;
    PERFORM set_config('ops.close_to', s.id::text, true);  -- #4398: kept for the confirm
    v_out := public.ops_work_close(p_id, COALESCE(p_proof, '[]'::jsonb), p_result, p_expected_revision);
    PERFORM set_config('ops.close_children', '', true);
    PERFORM set_config('ops.close_to', '', true);
  ELSIF c.status = 'done' THEN
    v_out := public.ops_work_reopen(p_id, NULL, p_expected_revision);
    IF s.grp = 'doing' THEN
      v_rev := (v_out->'card'->>'revision')::bigint;
      v_out := public.ops_work_update(p_id, '{"status":"doing"}'::jsonb, v_rev, NULL);
    END IF;
  ELSIF s.grp <> c.status THEN
    v_out := public.ops_work_update(p_id, jsonb_build_object('status', s.grp), p_expected_revision, NULL);
  ELSE
    -- Another column of the same group.
    PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
    PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
    IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%' THEN
      RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person moves this card.' USING ERRCODE = '42501';
    END IF;
    v_before := public.ops_card_snapshot(c.id);
    UPDATE public.ops_work_cards w SET status_id = s.id, revision = w.revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE w.id = c.id RETURNING w.* INTO n;
    v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'status', format('Moved to %s.', s.name), v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
    -- #4398 (S3): a person (or their agent) moving a card tells its owner and watcher.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s moved %s to %s', public.ops_actor_label(v.actor_email, v.via), n.title, s.name), 'status');
    IF v.via IS NOT NULL THEN
      PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'ok', c.id, 'work_card', c.id,
        format('Moved Card %s to %s: %s', n.number, s.name, n.title), jsonb_build_object('changed', '["status"]'::jsonb));
    END IF;
    v_out := jsonb_build_object('event_id', v_event);
  END IF;
  -- The group's rules put the card in the group's first column: now the one chosen.
  -- (#4398: never onto a card that went to In review instead of closing.)
  UPDATE public.ops_work_cards w SET status_id = s.id WHERE w.id = p_id AND w.status_id <> s.id AND w.status = s.grp AND w.review_requested_at IS NULL;
  SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = p_id;
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_out->'event_id', 'changed', true,
    'review', v_out->'review', 'message', v_out->'message');  -- #4398
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Card JSON: waiting on any of the watchers; the sprint goal key leaves.
-- ---------------------------------------------------------------------------

-- From 20281121034420_issue_4420_tickets_on_work_board.sql:549. #4571: waiting_on_all; no sprint goal key.
CREATE OR REPLACE FUNCTION public.ops_card_json(c ops_work_cards, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    'sprint', jsonb_build_object('id', v_sprint.id, 'starts_on', v_sprint.starts_on, 'ends_on', v_sprint.ends_on),  -- #4571: ops_sprints.goal is gone
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
    'plan', public.ops_plan_from_subtasks(c.id), 'result', c.result, 'proof', c.proof, 'close_kind', c.close_kind, 'close_reason', c.close_reason,
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
    'archived', c.archived_at IS NOT NULL)
    -- #4255: the column, the tree, the description, files, thread and goal.
    || jsonb_build_object(
    'status_id', c.status_id,
    'column', (SELECT jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'grp', s.grp)
                 FROM public.ops_work_statuses s WHERE s.id = c.status_id),
    'parent', CASE WHEN c.parent_id IS NOT NULL THEN (SELECT jsonb_build_object('id', p.id, 'number', p.number, 'title', p.title, 'parent_id', p.parent_id)
                                                        FROM public.ops_work_cards p WHERE p.id = c.parent_id) END,
    'depth', c.depth, 'position', c.position, 'start_on', c.start_on, 'estimate_minutes', c.estimate_minutes,
    'description', c.description_md, 'plan_step', c.plan_step,
    'subtasks', (SELECT jsonb_build_object('total', count(*), 'done', count(*) FILTER (WHERE x.status = 'done'))
                   FROM public.ops_work_cards x WHERE x.parent_id = c.id AND x.archived_at IS NULL),
    'files_count', (SELECT count(*) FROM public.ops_work_files f WHERE f.card_id = c.id AND f.archived_at IS NULL
                     AND (f.kind = 'link' OR public.ops_file_uploaded(f.storage_path))),
    'thread_count', (SELECT count(*) FROM public.ops_work_messages m WHERE m.card_id = c.id AND m.deleted_at IS NULL),
    'goal', CASE WHEN c.goal_id IS NOT NULL THEN (SELECT jsonb_build_object('id', g.id, 'title', g.title, 'state', g.state)
                                                   FROM public.ops_sprint_goals g WHERE g.id = c.goal_id AND g.archived_at IS NULL) END,
    'in_backlog', c.in_backlog)
    -- #4398: review, send back, confirm, and a release card's live checklist.
    || jsonb_build_object(
    'review', CASE WHEN c.review_requested_at IS NOT NULL THEN jsonb_build_object(
        'requested_at', c.review_requested_at, 'requested_by_name', public.ops_name(c.review_requested_by),
        'requested_via', c.review_requested_via, 'kind', c.review_kind, 'reason', c.review_reason,
        -- #4571 TEMPORARY: waiting_on (the first watcher) stays for older readers; remove once none reads it.
        'waiting_on', public.ops_name((public.ops_card_people(c.id, 'watcher'))[1]),
        'waiting_on_all', COALESCE((SELECT jsonb_agg(public.ops_name(p.email) ORDER BY p.added_at, p.email)
                                    FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'watcher'), '[]'::jsonb)) END,
    'sent_back', CASE WHEN c.sent_back_at IS NOT NULL THEN jsonb_build_object('reason', c.sent_back_reason,
        'by_name', public.ops_name(c.sent_back_by), 'at', c.sent_back_at) END,
    'confirmed_by_name', CASE WHEN c.confirmed_by IS NOT NULL THEN public.ops_name(c.confirmed_by) END,
    'confirmed_at', c.confirmed_at,
    'release_items', CASE WHEN c.auto_key ~ '^eng_release:pr-[0-9]+$'
        THEN public.ops_release_items(substring(c.auto_key FROM ':pr-([0-9]+)$')::integer) END)
    -- #4420: a ticket carries its ticket object; every other card is unchanged.
    || CASE WHEN c.kind = 'ticket' THEN jsonb_build_object('ticket', public.ops_ticket_json(c.id)) ELSE '{}'::jsonb END;
END;
$function$;

-- From 20280626014398_issue_4398_review_and_notices.sql:3146. #4571: waiting_on_all.
CREATE OR REPLACE FUNCTION public.ops_subtasks_json(p_card_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(public.ops_card_lite(c) || jsonb_build_object(
      'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', p.email, 'name', public.ops_name(p.email)) ORDER BY p.added_at, p.email)
                            FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'owner'), '[]'::jsonb),
      'revision', c.revision, 'overdue', (c.due_on < p_today AND c.status <> 'done'), 'start_on', c.start_on,
      'plan_step', c.plan_step,
      -- #4398: the due label reads the close date; a subtask in review says so.
      'closed_at', c.closed_at,
      'review', CASE WHEN c.review_requested_at IS NOT NULL THEN jsonb_build_object('requested_at', c.review_requested_at,
                  -- #4571 TEMPORARY: waiting_on stays for older readers; remove once none reads it.
                  'waiting_on', public.ops_name((public.ops_card_people(c.id, 'watcher'))[1]),
                  'waiting_on_all', COALESCE((SELECT jsonb_agg(public.ops_name(p.email) ORDER BY p.added_at, p.email)
                                    FROM public.ops_work_people p WHERE p.card_id = c.id AND p.role = 'watcher'), '[]'::jsonb)) END,
      'subtasks', (SELECT jsonb_build_object('total', count(*), 'done', count(*) FILTER (WHERE g.status = 'done'))
                     FROM public.ops_work_cards g WHERE g.parent_id = c.id AND g.archived_at IS NULL),
      'thread_count', (SELECT count(*) FROM public.ops_work_messages m WHERE m.card_id = c.id AND m.deleted_at IS NULL))
    ORDER BY c.position, c.number), '[]'::jsonb)
    FROM public.ops_work_cards c WHERE c.parent_id = p_card_id AND c.archived_at IS NULL
$function$;

-- From 20281121034420_issue_4420_tickets_on_work_board.sql:626. #4571: waiting_on_all; no sprint goal key.
CREATE OR REPLACE FUNCTION public.ops_cards_json(p_ids uuid[], p_today date, p_shape text DEFAULT 'full')
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_names jsonb; v_anon text := public.ops_name(NULL); v_out jsonb; v_full boolean := p_shape = 'full';
BEGIN
  IF p_shape IS NULL OR p_shape NOT IN ('full', 'board', 'board_text') THEN
    RAISE EXCEPTION 'invalid_query: shape must be full or board.' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Every email any card field names, resolved once.
  SELECT COALESCE(jsonb_object_agg(n.email, n.name), '{}'::jsonb) INTO v_names
    FROM public.ops_names_for(ARRAY(
      SELECT e.x FROM public.ops_work_cards w
       CROSS JOIN LATERAL unnest(ARRAY[w.closed_by, w.working_by, w.override_by, w.created_by,
                                       w.review_requested_by, w.sent_back_by, w.confirmed_by]) e(x)
       WHERE w.id = ANY (p_ids) AND e.x IS NOT NULL
      UNION
      SELECT p.email FROM public.ops_work_people p WHERE p.card_id = ANY (p_ids))) n;

  WITH ids AS (
    SELECT u.id, min(u.ord) AS ord FROM unnest(p_ids) WITH ORDINALITY u(id, ord) GROUP BY u.id
  ), ppl AS (
    SELECT p.card_id,
           jsonb_agg(jsonb_build_object('email', p.email, 'name', v_names->>p.email) ORDER BY p.added_at, p.email)
             FILTER (WHERE p.role = 'owner') AS owners,
           jsonb_agg(jsonb_build_object('email', p.email, 'name', v_names->>p.email) ORDER BY p.added_at, p.email)
             FILTER (WHERE p.role = 'watcher') AS watchers,
           min(p.email) FILTER (WHERE p.role = 'watcher') AS first_watcher,
           jsonb_agg(v_names->>p.email ORDER BY p.added_at, p.email) FILTER (WHERE p.role = 'watcher') AS watcher_names  -- #4571
      FROM public.ops_work_people p WHERE p.card_id = ANY (p_ids) GROUP BY p.card_id
  ), lnk AS (
    SELECT l.card_id,
           -- board links carry kind and id (the linked filter and the draft split);
           -- only full carries the label and checks each target still exists.
           jsonb_agg(CASE WHEN p_shape = 'full'
                          THEN jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label,
                                                  'exists', public.ops_link_label(l.kind, l.target_id) IS NOT NULL)
                          ELSE jsonb_build_object('kind', l.kind, 'id', l.target_id) END
                     ORDER BY l.added_at, l.kind, l.target_id) AS links
      FROM public.ops_work_links l WHERE l.card_id = ANY (p_ids) GROUP BY l.card_id
  ), gh AS (
    SELECT g.card_id,
           jsonb_agg(public.ops_github_status(g.number) || jsonb_build_object('kind', g.kind) ORDER BY g.added_at, g.number) AS github
      FROM public.ops_work_github g WHERE g.card_id = ANY (p_ids) AND p_shape = 'full' GROUP BY g.card_id
  ), kids AS (
    SELECT x.parent_id, count(*) AS total, count(*) FILTER (WHERE x.status = 'done') AS done
      FROM public.ops_work_cards x WHERE x.parent_id = ANY (p_ids) AND x.archived_at IS NULL GROUP BY x.parent_id
  ), plan AS (
    -- ops_plan_from_subtasks, for every card at once (full only).
    SELECT y.parent_id,
           jsonb_agg(jsonb_build_object(
             'n', y.rn,
             'text', left(y.title, 200),
             'tool', COALESCE(NULLIF(y.plan_step->>'tool', ''), 'person'),
             'status', CASE WHEN y.status = 'done' THEN 'done'
                            WHEN y.plan_step->>'status' IN ('failed', 'person') THEN y.plan_step->>'status'
                            ELSE 'todo' END,
             'result', CASE WHEN jsonb_typeof(y.plan_step->'result') = 'string' THEN y.plan_step->'result' END,
             'checked_at', CASE WHEN jsonb_typeof(y.plan_step->'checked_at') = 'string' THEN y.plan_step->'checked_at' END)
             ORDER BY y.rn) AS plan
      FROM (SELECT x.parent_id, x.title, x.status, x.plan_step,
                   row_number() OVER (PARTITION BY x.parent_id ORDER BY x.position, x.number)::integer AS rn
              FROM public.ops_work_cards x
             WHERE x.parent_id = ANY (p_ids) AND x.archived_at IS NULL AND p_shape = 'full') y
     WHERE y.rn <= 20
     GROUP BY y.parent_id
  ), files AS (
    SELECT f.card_id, count(*) AS n
      FROM public.ops_work_files f
     WHERE f.card_id = ANY (p_ids) AND f.archived_at IS NULL
       AND (f.kind = 'link'
            OR (f.storage_path IS NOT NULL
                AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ops-work-files' AND o.name = f.storage_path)))
     GROUP BY f.card_id
  ), msgs AS (
    SELECT m.card_id, count(*) AS n
      FROM public.ops_work_messages m WHERE m.card_id = ANY (p_ids) AND m.deleted_at IS NULL GROUP BY m.card_id
  ), base AS (
    SELECT i.ord, c.id, c.number, c.title, c.instructions, c.done_means, c.status, c.blocked, c.blocked_kind, c.blocked_reason,
           c.person_reason, c.files_url, c.on_brand_plan, c.brand_plan_source, c.kind, c.kit_step, c.anchor_kind, c.anchor_id,
           c.due_on, c.due_source, c.carried_count, c.plan AS card_plan, c.result, c.proof, c.close_kind, c.close_reason,
           c.closed_at, c.closed_by, c.closed_via, c.started_at, c.working_by, c.working_via, c.working_chat, c.working_seen_at,
           c.override_at, c.override_by, c.override_reason, c.created_by, c.created_via, c.created_at, c.updated_at, c.revision,
           c.auto_key, c.archived_at, c.status_id, c.parent_id, c.depth, c.position, c.start_on, c.estimate_minutes,
           c.description_md, c.plan_step, c.goal_id, c.in_backlog, c.review_requested_at, c.review_requested_by,
           c.review_requested_via, c.review_kind, c.review_reason, c.sent_back_at, c.sent_back_by, c.sent_back_reason,
           c.confirmed_by, c.confirmed_at,
           sp.id AS sp_id, sp.starts_on AS sp_starts_on, sp.ends_on AS sp_ends_on,  -- #4571: no sprint goal
          
           st.id AS st_id, st.name AS st_name, st.color AS st_color, st.grp AS st_grp,
           pc.id AS pc_id, pc.number AS pc_number, pc.title AS pc_title, pc.parent_id AS pc_parent_id,
           gl.id AS gl_id, gl.title AS gl_title, gl.state AS gl_state,
           pp.owners, pp.watchers, pp.first_watcher, pp.watcher_names, lk.links, gh.github, k.total AS kids_total, k.done AS kids_done,
           pl.plan AS kids_plan, fl.n AS files_n, ms.n AS msgs_n,
           CASE WHEN c.working_via IS NOT NULL AND c.working_by IS NOT NULL AND c.status <> 'done' THEN
             CASE WHEN c.working_chat IS NULL OR c.working_chat = 'default' THEN NULL
                  ELSE COALESCE(ac.label, 'chat ' || left(c.working_chat, 4)) END END AS chat_label
      FROM ids i
      JOIN public.ops_work_cards c ON c.id = i.id
      LEFT JOIN public.ops_sprints sp ON sp.id = c.sprint_id
      LEFT JOIN public.ops_work_statuses st ON st.id = c.status_id
      LEFT JOIN public.ops_work_cards pc ON pc.id = c.parent_id
      LEFT JOIN public.ops_sprint_goals gl ON gl.id = c.goal_id AND gl.archived_at IS NULL
      LEFT JOIN public.ops_agent_chats ac ON ac.owner_email = c.working_by AND ac.via = c.working_via AND ac.chat_key = c.working_chat
      LEFT JOIN ppl pp ON pp.card_id = c.id
      LEFT JOIN lnk lk ON lk.card_id = c.id
      LEFT JOIN gh ON gh.card_id = c.id
      LEFT JOIN kids k ON k.parent_id = c.id
      LEFT JOIN plan pl ON pl.parent_id = c.id
      LEFT JOIN files fl ON fl.card_id = c.id
      LEFT JOIN msgs ms ON ms.card_id = c.id
  ), parts AS (
    SELECT b.*,
           -- ops_working_json, with names from the map.
           CASE WHEN b.working_via IS NOT NULL AND b.working_by IS NOT NULL AND b.status <> 'done' THEN
             jsonb_build_object(
               'name', (v_names->>b.working_by)
                       || CASE b.working_via WHEN 'claude' THEN '''s Claude' WHEN 'codex' THEN '''s Codex'
                                                    WHEN 'system' THEN ' (Mingla)' ELSE '' END
                       || CASE WHEN b.working_via IN ('claude', 'codex') AND b.chat_label IS NOT NULL
                               THEN ' (' || b.chat_label || ')' ELSE '' END,
               'person_name', v_names->>b.working_by, 'via', b.working_via,
               'chat_label', b.chat_label,
               'since', COALESCE(b.started_at, b.working_seen_at),
               'last_update_at', COALESCE(b.working_seen_at, b.started_at),
               'quiet', COALESCE(b.working_seen_at, b.started_at) < clock_timestamp() - interval '24 hours',
               'stuck', COALESCE(b.working_seen_at, b.started_at) < clock_timestamp() - interval '7 days') END AS working,
           CASE WHEN b.anchor_id IS NOT NULL THEN public.ops_card_anchor(b.anchor_kind, b.anchor_id, p_today) END AS anchor,
           CASE WHEN b.auto_key ~ '^eng_release:pr-[0-9]+$'
                THEN public.ops_release_items(substring(b.auto_key FROM ':pr-([0-9]+)$')::integer) END AS release_items
      FROM base b
  ), j AS (
    SELECT p.ord,
      -- The fields both shapes carry: exactly ops_card_json's values for full,
      -- trimmed to what the Admin list reads for board (rework 1, P3-2).
      jsonb_build_object(
        'id', p.id, 'number', p.number, 'title', p.title, 'status', p.status,
        'blocked', p.blocked,
        'person_reason', p.person_reason, 'tag', p.person_reason,
        'anchor', CASE WHEN NOT v_full AND jsonb_typeof(p.anchor) = 'object' THEN jsonb_build_object('kind', p.anchor->'kind') ELSE p.anchor END,
        'due_on', p.due_on, 'overdue', (p.due_on < p_today AND p.status <> 'done'),
        'owners', COALESCE(p.owners, '[]'::jsonb), 'watchers', COALESCE(p.watchers, '[]'::jsonb),
        'links', COALESCE(p.links, '[]'::jsonb),
        'proof', CASE WHEN v_full OR jsonb_typeof(p.proof) IS DISTINCT FROM 'array' THEN p.proof
                      ELSE (SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(x.e) = 'object'
                                                            THEN jsonb_build_object('kind', x.e->'kind', 'id', x.e->'id') ELSE x.e END
                                                       ORDER BY x.o), '[]'::jsonb)
                              FROM jsonb_array_elements(p.proof) WITH ORDINALITY x(e, o)) END,
        'closed_at', p.closed_at,
        'working', CASE WHEN v_full OR p.working IS NULL THEN p.working
                        ELSE jsonb_build_object('name', p.working->'name', 'quiet', p.working->'quiet',
                                                'last_update_at', p.working->'last_update_at') END,
        'revision', p.revision,
        'auto', p.auto_key IS NOT NULL,
        'auto_kind', CASE WHEN p.auto_key IS NOT NULL THEN split_part(p.auto_key, ':', 1) END,
        'archived', p.archived_at IS NOT NULL)
      || jsonb_build_object(
        'status_id', p.status_id,
        'parent', CASE WHEN p.parent_id IS NOT NULL AND p.pc_id IS NOT NULL THEN
                    CASE WHEN v_full THEN jsonb_build_object('id', p.pc_id, 'number', p.pc_number, 'title', p.pc_title,
                                                             'parent_id', p.pc_parent_id)
                         ELSE jsonb_build_object('id', p.pc_id, 'number', p.pc_number, 'title', p.pc_title) END END,
        'depth', p.depth, 'position', p.position,
        'estimate_minutes', p.estimate_minutes,
        'subtasks', jsonb_build_object('total', COALESCE(p.kids_total, 0), 'done', COALESCE(p.kids_done, 0)),
        'files_count', COALESCE(p.files_n, 0), 'thread_count', COALESCE(p.msgs_n, 0),
        'goal', CASE WHEN p.goal_id IS NOT NULL AND p.gl_id IS NOT NULL THEN
                  CASE WHEN v_full THEN jsonb_build_object('id', p.gl_id, 'title', p.gl_title, 'state', p.gl_state)
                       ELSE jsonb_build_object('id', p.gl_id, 'title', p.gl_title) END END,
        'review', CASE WHEN p.review_requested_at IS NULL THEN NULL
          WHEN v_full THEN jsonb_build_object(
            'requested_at', p.review_requested_at, 'requested_by_name', v_names->>p.review_requested_by,
            'requested_via', p.review_requested_via, 'kind', p.review_kind, 'reason', p.review_reason,
            -- #4571 TEMPORARY: waiting_on stays for older readers; remove once none reads it.
            'waiting_on', CASE WHEN p.first_watcher IS NULL THEN v_anon ELSE v_names->>p.first_watcher END,
            'waiting_on_all', COALESCE(p.watcher_names, '[]'::jsonb))
          ELSE jsonb_build_object('requested_at', p.review_requested_at,
            'waiting_on', CASE WHEN p.first_watcher IS NULL THEN v_anon ELSE v_names->>p.first_watcher END,
            'waiting_on_all', COALESCE(p.watcher_names, '[]'::jsonb)) END,
        'sent_back', CASE WHEN p.sent_back_at IS NULL THEN NULL
          WHEN v_full THEN jsonb_build_object('reason', p.sent_back_reason, 'by_name', v_names->>p.sent_back_by, 'at', p.sent_back_at)
          ELSE jsonb_build_object('reason', p.sent_back_reason) END,
        'release_items', p.release_items) AS common,
      -- The fields only 'full' carries.
      CASE WHEN p_shape = 'full' THEN
        -- Read by no Admin list (rework 1, P3-2), so full only.
        jsonb_build_object(
          'blocked_kind', p.blocked_kind, 'carried_count', p.carried_count, 'start_on', p.start_on, 'in_backlog', p.in_backlog,
          'claim', CASE WHEN p.working IS NOT NULL AND NOT (p.working->>'quiet')::boolean THEN jsonb_build_object(
            'holder_name', v_names->>p.working_by, 'holder_via', p.working_via,
            'holder_chat_label', p.working->'chat_label', 'since', p.working->'since',
            'ends_at', COALESCE(p.working_seen_at, p.started_at) + interval '24 hours') END)
        || jsonb_build_object(
          'sprint', jsonb_build_object('id', p.sp_id, 'starts_on', p.sp_starts_on,
                                       'ends_on', p.sp_ends_on),
          'column', CASE WHEN p.st_id IS NOT NULL THEN jsonb_build_object('id', p.st_id, 'name', p.st_name,
                                                                          'color', p.st_color, 'grp', p.st_grp) END,
          'updated_at', p.updated_at,
          'instructions', p.instructions, 'done_means', p.done_means,
          'blocked_reason', p.blocked_reason, 'files_url', p.files_url,
          'on_brand_plan', p.on_brand_plan, 'brand_plan_source', p.brand_plan_source,
          'kind', p.kind, 'kit_step', p.kit_step, 'due_source', p.due_source,
          'github', COALESCE(p.github, '[]'::jsonb),
          'plan', COALESCE(p.kids_plan, p.card_plan, '[]'::jsonb),
          'result', p.result, 'close_kind', p.close_kind, 'close_reason', p.close_reason,
          'closed_by_name', CASE WHEN p.closed_by IS NOT NULL THEN v_names->>p.closed_by END,
          'closed_via', p.closed_via, 'started_at', p.started_at,
          'working_by_name', CASE WHEN p.working_by IS NOT NULL THEN v_names->>p.working_by END,
          'working_via', p.working_via,
          'override', CASE WHEN p.override_at IS NOT NULL THEN jsonb_build_object('reason', p.override_reason,
                         'by_name', CASE WHEN p.override_by IS NULL THEN v_anon ELSE v_names->>p.override_by END,
                         'at', p.override_at) END,
          'created_by_name', v_names->>p.created_by, 'created_via', p.created_via, 'created_at', p.created_at,
          'description', p.description_md, 'plan_step', p.plan_step,
          'confirmed_by_name', CASE WHEN p.confirmed_by IS NOT NULL THEN v_names->>p.confirmed_by END,
          'confirmed_at', p.confirmed_at)
      WHEN p_shape = 'board_text' THEN jsonb_build_object('instructions', p.instructions)
      ELSE '{}'::jsonb END AS extra,
      -- #4420: a ticket carries its ticket object; every other card is unchanged.
      CASE WHEN p.kind = 'ticket' THEN jsonb_build_object('ticket', public.ops_ticket_json(p.id)) ELSE '{}'::jsonb END AS ticket_part
      FROM parts p
  )
  SELECT COALESCE(jsonb_agg(j.common || j.extra || j.ticket_part ORDER BY j.ord), '[]'::jsonb) INTO v_out FROM j;
  RETURN v_out;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Host app feed: every owner and watcher; the single keys stay for builds
-- already on phones.
-- ---------------------------------------------------------------------------

-- From 20280707034423_issue_4423_w2_team_inbox_limit_first.sql:36. #4571: card owners and watchers as lists.
CREATE OR REPLACE FUNCTION public.team_inbox(p_alert_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me      uuid := auth.uid();
  v_types   text[];
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_threads uuid[];
  v_names   jsonb;
  v_anon    text := public.ops_name(NULL);
  v_ids     uuid[];
  v_page    jsonb;
  v_alerts  jsonb;
  v_unread_mentions bigint;
  v_unread_updates  bigint;
  v_unread_support  bigint;
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);
  -- team_chat_can_read(thread) for this caller, once: an open membership and chat staff.
  v_threads := CASE WHEN public.team_chat_staff(v_me)
                    THEN ARRAY(SELECT tmm.thread_id FROM public.team_thread_members tmm
                                WHERE tmm.user_id = v_me AND tmm.left_at IS NULL)
                    ELSE ARRAY[]::uuid[] END;

  -- 1. The page, newest first, before any label (ids only).
  SELECT COALESCE(array_agg(pg.id ORDER BY pg.created_at DESC, pg.id DESC), ARRAY[]::uuid[]) INTO v_ids
    FROM (SELECT tm.id, tm.created_at
            FROM public.team_mentions tm
            LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id
           WHERE tm.target_user_id = v_me
             AND tm.push
             AND (tm.source_kind <> 'team_message'
                  OR (tmsg.deleted_at IS NULL AND tmsg.thread_id = ANY (v_threads)))
           ORDER BY tm.created_at DESC, tm.id DESC
           LIMIT v_limit) pg;

  -- 2. Labels for the page only.
  SELECT COALESCE(jsonb_object_agg(n.email, n.name), '{}'::jsonb) INTO v_names
    FROM public.ops_names_for(ARRAY(
      SELECT e.actor_email FROM public.team_mentions x
        JOIN public.ops_work_events e ON x.source_kind = 'work_card' AND e.id = x.source_id
       WHERE x.id = ANY (v_ids)
      UNION
      SELECT p.email FROM public.team_mentions x
        JOIN public.ops_work_events e ON x.source_kind = 'work_card' AND e.id = x.source_id
        JOIN public.ops_work_people p ON p.card_id = e.card_id AND p.role IN ('owner', 'watcher')
       WHERE x.id = ANY (v_ids))) n;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', x.id, 'kind', public.team_inbox_kind(x.source_kind, e.action), 'source_kind', x.source_kind,
      'card_id', e.card_id, 'action', e.action,
      'thread_id', tmsg.thread_id, 'message_id', tmsg.id, -- #4255 W1b
      -- #4398 retest (P3): a decision or an ask stands only while it is still open.
      'decision', x.decision AND wc.status IS DISTINCT FROM 'done'
                  AND (x.event_kind IS DISTINCT FROM 'review' OR wc.review_requested_at IS NOT NULL),
      'event_kind', x.event_kind,
      'needs_you', CASE WHEN x.event_kind = 'review' THEN wc.status IS DISTINCT FROM 'done' AND wc.review_requested_at IS NOT NULL
                        WHEN x.event_kind = 'sent_back' THEN wc.status IS DISTINCT FROM 'done' AND wc.review_requested_at IS NULL
                        ELSE false END,
      'card', CASE WHEN wc.id IS NOT NULL THEN jsonb_build_object('number', wc.number, 'title', wc.title, 'status', wc.status,
                 'due_on', wc.due_on, 'closed_at', wc.closed_at, 'column', st.name, 'in_review', wc.review_requested_at IS NOT NULL,
                 -- #4571: every owner and watcher, in the order they were added.
                 'owners', COALESCE((SELECT jsonb_agg(COALESCE(v_names->>u.e, v_anon) ORDER BY u.o) FROM unnest(pp.owner_emails) WITH ORDINALITY u(e, o)), '[]'::jsonb),
                 'watchers', COALESCE((SELECT jsonb_agg(COALESCE(v_names->>u.e, v_anon) ORDER BY u.o) FROM unnest(pp.watcher_emails) WITH ORDINALITY u(e, o)), '[]'::jsonb),
                 'owner_emails', COALESCE(to_jsonb(pp.owner_emails), '[]'::jsonb),
                 'watcher_emails', COALESCE(to_jsonb(pp.watcher_emails), '[]'::jsonb),
                 -- #4571 TEMPORARY: read by Host app builds before the next store floor; remove after it (owner, watcher, owner_email, watcher_email).
                 'owner', CASE WHEN pp.owner_email IS NULL THEN v_anon ELSE v_names->>pp.owner_email END,
                 'watcher', CASE WHEN pp.watcher_email IS NULL THEN v_anon ELSE v_names->>pp.watcher_email END,
                 'owner_email', pp.owner_email,
                 'watcher_email', pp.watcher_email,
                 'parent', CASE WHEN par.id IS NOT NULL THEN jsonb_build_object('number', par.number, 'title', par.title) END) END,
      'actor_name', COALESCE(
                      CASE WHEN x.source_kind = 'work_due' THEN 'Mingla' END, -- #4255 rework F
                      CASE WHEN e.id IS NOT NULL THEN (v_names->>e.actor_email)
                             || CASE e.via WHEN 'claude' THEN '''s Claude' WHEN 'codex' THEN '''s Codex'
                                           WHEN 'system' THEN ' (Mingla)' ELSE '' END END,
                      public.crm_display_name(lower(btrim(u.email))),
                      'A teammate'),
      'body_excerpt', x.body_excerpt, 'deep_link', x.deep_link,
      'created_at', x.created_at, 'read_at', x.read_at) ORDER BY o.ord), '[]'::jsonb)
    INTO v_page
    FROM unnest(v_ids) WITH ORDINALITY o(id, ord)
    JOIN public.team_mentions x ON x.id = o.id
    LEFT JOIN public.team_messages tmsg ON x.source_kind = 'team_message' AND tmsg.id = x.source_id
    LEFT JOIN public.ops_work_events e ON x.source_kind = 'work_card' AND e.id = x.source_id
    LEFT JOIN public.ops_work_cards wc ON wc.id = e.card_id
    LEFT JOIN public.ops_work_statuses st ON st.id = wc.status_id
    LEFT JOIN public.ops_work_cards par ON par.id = wc.parent_id
    LEFT JOIN LATERAL (SELECT min(p.email) FILTER (WHERE p.role = 'owner') AS owner_email,
                              min(p.email) FILTER (WHERE p.role = 'watcher') AS watcher_email,
                              array_agg(p.email ORDER BY p.added_at, p.email) FILTER (WHERE p.role = 'owner') AS owner_emails,  -- #4571
                              array_agg(p.email ORDER BY p.added_at, p.email) FILTER (WHERE p.role = 'watcher') AS watcher_emails
                         FROM public.ops_work_people p WHERE p.card_id = wc.id) pp ON true
    LEFT JOIN auth.users u ON u.id = x.actor_user_id;

  -- 3. Unread counts over unread rows only.
  SELECT count(*) FILTER (WHERE public.team_inbox_kind(tm.source_kind, e.action) = 'mention'),
         count(*) FILTER (WHERE public.team_inbox_kind(tm.source_kind, e.action) = 'work_update')
    INTO v_unread_mentions, v_unread_updates
    FROM public.team_mentions tm
    LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
    LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id
   WHERE tm.target_user_id = v_me
     AND tm.push
     AND tm.read_at IS NULL
     AND (tm.source_kind <> 'team_message'
          OR (tmsg.deleted_at IS NULL AND tmsg.thread_id = ANY (v_threads)));

  -- 4. Alerts: the page first, then the ticket check for those rows only.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'deep_link', x.deep_link,
      'data', x.data, 'created_at', x.created_at, 'read_at', x.read_at,
      'ticket_resolved', public.team_inbox_ticket_resolved(x.data)) ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb)
    INTO v_alerts
    FROM (SELECT n.id, n.type, n.title, n.body, n.deep_link, n.data, n.created_at, n.read_at
            FROM public.notifications n
           WHERE n.user_id = v_me AND n.type = ANY (v_types)
             AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
           ORDER BY n.created_at DESC, n.id DESC
           LIMIT v_limit) x;
  SELECT count(*) INTO v_unread_support
    FROM public.notifications n
   WHERE n.user_id = v_me AND n.type = ANY (v_types)
     AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
     AND n.read_at IS NULL
     AND NOT public.team_inbox_ticket_resolved(n.data);

  RETURN jsonb_build_object(
    'mentions', v_page,
    'alerts', v_alerts,
    'unread', jsonb_build_object('mentions', v_unread_mentions, 'work_updates', v_unread_updates, 'support', v_unread_support));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Sprint goals: any number, 3 to 120 characters, an optional note.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_sprint_goals DROP CONSTRAINT ops_sprint_goals_title_check;
-- #4571 gate (ops-sprint-goal-title-3-120).
ALTER TABLE public.ops_sprint_goals ADD CONSTRAINT ops_sprint_goals_title_check
  CHECK (title = btrim(title) AND char_length(title) BETWEEN 3 AND 120 AND title !~ E'[\\r\\n]');
ALTER TABLE public.ops_sprint_goals ADD COLUMN note text NULL
  CONSTRAINT ops_sprint_goals_note_check CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 500));
COMMENT ON TABLE public.ops_sprint_goals IS
  'Issue #4255. Any number of live goals per sprint (#4571). state_source manual means a person set state; it holds while the automatic verdict is still manual_basis (the verdict when it was set), and gives way at the next automatic change of direction. The met tick is state done set by hand (#4571).';
COMMENT ON COLUMN public.ops_sprint_goals.note IS 'Issue #4571. An optional note on the goal, 1 to 500 characters.';

DROP FUNCTION public.ops_sprint_goal_add(uuid, text, text);

-- From 20280624014255_issue_4255_work_v2_functions.sql:2330. #4571: no cap, 3 to 120 characters, a note.
CREATE FUNCTION public.ops_sprint_goal_add(p_sprint_id uuid, p_title text, p_owner_email text DEFAULT NULL, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; s public.ops_sprints; g public.ops_sprint_goals; v_title text := public.ops_one_line(p_title); v_owner text; v_live integer; v_note text := public.ops_multi_line(p_note);  -- #4571
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  s := public.ops_sprint_row(p_sprint_id);  -- locks the sprint: goal positions cannot race
  IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 120 OR public.ops_has_control(v_title) THEN  -- #4571: 120
    RAISE EXCEPTION 'invalid_goal: Say the goal in 3 to 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 500 OR public.ops_has_control(v_note) THEN
    RAISE EXCEPTION 'invalid_goal: Keep the note to 500 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_owner_email IS NOT NULL AND btrim(p_owner_email) <> '' THEN
    v_owner := public.ops_team_email(p_owner_email);
    IF v_owner IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_goal: %s is not on the team.', left(p_owner_email, 80)) USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT count(*) INTO v_live FROM public.ops_sprint_goals x WHERE x.sprint_id = s.id AND x.archived_at IS NULL;
  -- #4571: no cap on the number of goals.
  INSERT INTO public.ops_sprint_goals (sprint_id, title, owner_email, note, position, created_by, updated_by)
  VALUES (s.id, v_title, v_owner, v_note, v_live, v.actor_email, v.actor_email) RETURNING * INTO g;
  RETURN jsonb_build_object('goal', public.ops_goal_json(g, public.ops_today(NULL)));
END;
$$;

REVOKE ALL ON FUNCTION public.ops_sprint_goal_add(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_sprint_goal_add(uuid, text, text, text) TO authenticated;

-- From 20280624014255_issue_4255_work_v2_functions.sql:2359. #4571: title 3 to 120; a note.
CREATE OR REPLACE FUNCTION public.ops_sprint_goal_update(p_goal_id uuid, p_changes jsonb, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; g public.ops_sprint_goals; v_bad text; v_title text; v_owner text; v_state text; v_source text; v_basis text; v_pos integer; v_note text;  -- #4571
        v_today date := public.ops_today(NULL); v_live integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_people_only(v.via);
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send what changes: title, owner, note, state or position.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('title', 'owner', 'note', 'state', 'position') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A goal change takes title, owner, note, state and position, not "%s".', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  SELECT * INTO g FROM public.ops_sprint_goals x WHERE x.id = p_goal_id AND x.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That goal is no longer in the sprint.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.ops_sprint_row(g.sprint_id);
  SELECT * INTO g FROM public.ops_sprint_goals x WHERE x.id = p_goal_id FOR UPDATE;
  IF p_expected_revision IS NULL OR g.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This goal changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  v_title := g.title; v_owner := g.owner_email; v_state := g.state; v_source := g.state_source; v_basis := g.manual_basis; v_pos := g.position; v_note := g.note;
  IF p_changes ? 'title' THEN
    v_title := public.ops_one_line(p_changes->>'title');
    IF v_title IS NULL OR char_length(v_title) NOT BETWEEN 3 AND 120 OR public.ops_has_control(v_title) THEN  -- #4571: 120
      RAISE EXCEPTION 'invalid_goal: Say the goal in 3 to 120 characters.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- #4571: a note; null or blank clears it.
  IF p_changes ? 'note' THEN
    IF jsonb_typeof(p_changes->'note') = 'null' THEN v_note := NULL;
    ELSIF jsonb_typeof(p_changes->'note') <> 'string' THEN
      RAISE EXCEPTION 'invalid_goal: A note is text.' USING ERRCODE = '22023';
    ELSE
      v_note := public.ops_multi_line(p_changes->>'note');
      IF char_length(COALESCE(v_note, '')) > 500 OR public.ops_has_control(v_note) THEN
        RAISE EXCEPTION 'invalid_goal: Keep the note to 500 characters.' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  IF p_changes ? 'owner' THEN
    IF jsonb_typeof(p_changes->'owner') = 'null' OR btrim(COALESCE(p_changes->>'owner', '')) = '' THEN v_owner := NULL;
    ELSE
      v_owner := public.ops_team_email(p_changes->>'owner');
      IF v_owner IS NULL THEN
        RAISE EXCEPTION '%', format('invalid_goal: %s is not on the team.', left(p_changes->>'owner', 80)) USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  IF p_changes ? 'state' THEN
    IF jsonb_typeof(p_changes->'state') = 'null' THEN
      v_source := 'auto'; v_basis := NULL; v_state := public.ops_goal_json(g, v_today)->>'auto_state';
    ELSIF p_changes->>'state' IN ('on_track', 'at_risk', 'done', 'missed') THEN
      v_state := p_changes->>'state'; v_source := 'manual'; v_basis := public.ops_goal_json(g, v_today)->>'auto_state';
    ELSE
      RAISE EXCEPTION 'invalid_goal: A goal is on_track, at_risk, done or missed.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_changes ? 'position' THEN
    IF jsonb_typeof(p_changes->'position') <> 'number' OR (p_changes->>'position') !~ '^\d{1,2}$' THEN
      RAISE EXCEPTION 'invalid_goal: Say where the goal goes (0 is first).' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_live FROM public.ops_sprint_goals x WHERE x.sprint_id = g.sprint_id AND x.archived_at IS NULL;
    v_pos := LEAST((p_changes->>'position')::integer, v_live - 1);
    UPDATE public.ops_sprint_goals x SET position = x.position - 1 WHERE x.sprint_id = g.sprint_id AND x.archived_at IS NULL AND x.position > g.position;
    UPDATE public.ops_sprint_goals x SET position = x.position + 1 WHERE x.sprint_id = g.sprint_id AND x.archived_at IS NULL AND x.id <> g.id AND x.position >= v_pos;
  END IF;
  UPDATE public.ops_sprint_goals x SET title = v_title, owner_email = v_owner, state = v_state, state_source = v_source, manual_basis = v_basis, note = v_note,
    position = v_pos, revision = x.revision + 1, updated_by = v.actor_email, updated_at = now()
   WHERE x.id = g.id RETURNING * INTO g;
  RETURN jsonb_build_object('goal', public.ops_goal_json(g, v_today));
END;
$$;

-- From 20280624014255_issue_4255_work_v2_functions.sql:2216. #4571: the note.
CREATE OR REPLACE FUNCTION public.ops_goal_json(g public.ops_sprint_goals, p_today date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE s public.ops_sprints; v_cards integer; v_done integer; v_open_min bigint; v_left numeric; v_days integer; v_auto text; v_state text;
BEGIN
  SELECT * INTO s FROM public.ops_sprints x WHERE x.id = g.sprint_id;
  SELECT count(*), count(*) FILTER (WHERE w.status = 'done'), COALESCE(sum(w.estimate_minutes) FILTER (WHERE w.status <> 'done'), 0)
    INTO v_cards, v_done, v_open_min
    FROM public.ops_work_cards w WHERE w.goal_id = g.id AND w.sprint_id = g.sprint_id AND w.archived_at IS NULL;
  v_days := LEAST(7, GREATEST(0, s.starts_on + 6 - p_today + 1));
  SELECT sum(public.ops_capacity_hours(g.sprint_id, o.email)) * v_days / 7.0 INTO v_left
    FROM (SELECT DISTINCT p.email FROM public.ops_work_people p JOIN public.ops_work_cards w ON w.id = p.card_id
           WHERE w.goal_id = g.id AND w.sprint_id = g.sprint_id AND w.archived_at IS NULL AND w.status <> 'done' AND p.role = 'owner') o;
  v_auto := CASE WHEN v_cards > 0 AND v_done = v_cards THEN 'done'
                 WHEN p_today > s.starts_on + 6 AND v_cards > v_done THEN 'missed'
                 WHEN v_left IS NOT NULL AND v_open_min / 60.0 > v_left THEN 'at_risk'
                 ELSE 'on_track' END;
  v_state := CASE WHEN g.state_source = 'manual' AND g.manual_basis IS NOT DISTINCT FROM v_auto THEN g.state ELSE v_auto END;
  RETURN jsonb_build_object('id', g.id, 'sprint_id', g.sprint_id, 'title', g.title, 'note', g.note, 'owner_email', g.owner_email,
    'owner_name', CASE WHEN g.owner_email IS NOT NULL THEN public.ops_name(g.owner_email) END,
    'state', v_state, 'auto_state', v_auto, 'set_by_hand', g.state_source = 'manual' AND g.manual_basis IS NOT DISTINCT FROM v_auto,
    'position', g.position, 'revision', g.revision, 'archived', g.archived_at IS NOT NULL,
    'cards', v_cards, 'done', v_done, 'open_minutes', v_open_min,
    'hours_left', CASE WHEN v_left IS NOT NULL THEN round(v_left, 1) END);
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. The dead single sprint goal (ops_sprint_set_goal, ops_sprints.goal).
-- ---------------------------------------------------------------------------
DROP FUNCTION public.ops_sprint_set_goal(date, text);

-- From 20280624014255_issue_4255_work_v2_functions.sql:2532. #4571: no single sprint goal.
CREATE OR REPLACE FUNCTION public.ops_sprint_json(p_monday date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', s.id, 'starts_on', p_monday, 'ends_on', p_monday + 6,  -- #4571: no single goal
                            'carried_in', COALESCE(s.carried_in, 0))
         -- #4255: the sprint's goals and its plan
         || jsonb_build_object('goals', COALESCE((SELECT jsonb_agg(public.ops_goal_json(g, public.ops_today(NULL)) ORDER BY g.position, g.created_at)
                                                    FROM public.ops_sprint_goals g WHERE g.sprint_id = s.id AND g.archived_at IS NULL), '[]'::jsonb),
                               'planned_at', s.planned_at, 'review_note', s.review_note, 'revision', s.revision)
  FROM (SELECT p_monday AS m) x LEFT JOIN public.ops_sprints s ON s.starts_on = x.m
$$;

-- From 20280427004270_issue_4270_w1_work_board_three_columns.sql:921. #4571: no single sprint goal.
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
    'sprint', jsonb_build_object('week', v_mon, 'ends_on', v_mon + 6, 'id', v_sprint.id,  -- #4571: no single goal
      'carried_in', COALESCE(v_sprint.carried_in, 0),
      'by_person', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('email', d.email, 'name', public.ops_name(d.email),
                 'open', (SELECT count(*) FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = d.email AND p.role = 'owner'
                           WHERE w.archived_at IS NULL AND w.status <> 'done'),
                 -- #4270: Needs your OK (open cards with a tag) and Overdue; needs_person stays (= needs_ok) for one release.
                 'needs_ok', (SELECT count(*) FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = d.email AND p.role = 'owner'
                               WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason IS NOT NULL),
                 'needs_person', (SELECT count(*) FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = d.email AND p.role = 'owner'
                                   WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.person_reason IS NOT NULL),
                 'overdue', (SELECT count(*) FROM public.ops_work_cards w JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = d.email AND p.role = 'owner'
                              WHERE w.archived_at IS NULL AND w.status <> 'done' AND w.due_on < v_today),
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

ALTER TABLE public.ops_sprints DROP COLUMN goal;

COMMIT;
