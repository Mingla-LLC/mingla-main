-- #4420 (Host polish pass), build step 1: tickets on the Work board (database).
--
-- A ticket is an ordinary Work card with kind 'ticket'. It keeps every card
-- rule: the person creating it picks the owner, the creator is the watcher
-- when they are not the owner, and owners, watchers, threads, files, GitHub
-- links and the agent Work tools work as for any card. Ticket facts (type,
-- product area, where it was made, its Product signal once sent to GitHub)
-- live in ops_work_tickets, read and written only through the functions here.
-- A ticket links the support conversations it came from (link kind
-- support_conversation); only Support staff, in person, change those links,
-- and only Support staff read the conversations through a ticket.
-- Closing a ticket writes one internal (staff-only) note on each linked
-- conversation; it notifies no customer.
--
-- Also in this migration (spec part 3 section 13, as amended on #4420 by
-- Seth's answers of 2026-11-21):
--   * the "roadmap updated" notice is retired (new notices refused, pending
--     scheduled ones cancelled). The shipped-wording pipeline stays: the
--     GitHub bridge still drafts "Recently shipped" cards and opens their
--     approval cards, because approved wordings answer "what shipped".
--     Every roadmap row stays stored and readable.
--   * nothing moves from the Product board; no default ticket owner.
--
-- Additive: no table, column, function or policy is dropped. Three CHECK
-- constraints are swapped for supersets of themselves. Functions replaced
-- with CREATE OR REPLACE copy their latest body and say where it came from.
-- Agents (team_agent_calls for the transaction) can read and update tickets
-- but never create one or change a ticket's support conversation links.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Schema
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ops_work_cards DROP CONSTRAINT ops_work_cards_kind_check,
  ADD CONSTRAINT ops_work_cards_kind_check CHECK (kind IN ('task','gate_live','promo','ticket'));
ALTER TABLE public.ops_work_cards DROP CONSTRAINT ops_work_cards_kind_anchor,
  ADD CONSTRAINT ops_work_cards_kind_anchor CHECK (kind IN ('task','ticket') OR anchor_id IS NOT NULL);
ALTER TABLE public.ops_work_links DROP CONSTRAINT ops_work_links_kind_check,
  ADD CONSTRAINT ops_work_links_kind_check CHECK (kind IN
    ('host','creator','brand','event','content','expected','card','roadmap_card','support_conversation'));

CREATE TABLE public.ops_work_tickets (
  card_id          uuid PRIMARY KEY REFERENCES public.ops_work_cards(id) ON DELETE CASCADE,
  ticket_type      text NOT NULL CHECK (ticket_type IN ('bug','idea','question','task')),
  product_area     text NOT NULL CHECK (product_area = btrim(product_area) AND char_length(product_area) BETWEEN 1 AND 120),
  created_from     text NOT NULL CHECK (created_from IN ('conversation','board','brand_group')),
  source_signal_id uuid UNIQUE REFERENCES public.support_product_signals(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ops_work_tickets ENABLE ROW LEVEL SECURITY;  -- no policies: functions only
REVOKE ALL ON public.ops_work_tickets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_work_tickets TO service_role;
COMMENT ON TABLE public.ops_work_tickets IS
  '#4420: ticket facts for Work cards of kind ticket. Read and written only through ops_ticket_* and issue_4420_* functions.';

CREATE INDEX ops_work_links_support_conversation ON public.ops_work_links (target_id) WHERE kind = 'support_conversation';

-- A ticket row belongs to a card of kind ticket.
CREATE FUNCTION public.ops_4420_ticket_row_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = NEW.card_id AND w.kind = 'ticket') THEN
    RAISE EXCEPTION 'invalid_ticket: Ticket details belong to a ticket card.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4420_ticket_row_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4420_ticket_row_guard BEFORE INSERT OR UPDATE OF card_id ON public.ops_work_tickets
  FOR EACH ROW EXECUTE FUNCTION public.ops_4420_ticket_row_guard();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Small helpers
-- ─────────────────────────────────────────────────────────────────────────
-- The agent acting in this transaction comes from crm_ctx() (agent keys
-- belong to Work board users); a caller without the Work board has none.
CREATE FUNCTION public.ops_4420_agent_via() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.admin_team_can('crm'), false) THEN RETURN NULL; END IF;
  RETURN (SELECT x.via FROM public.crm_ctx() x);
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4420_agent_via() FROM PUBLIC, anon, authenticated;

-- Who may use tickets: active Support staff, or Work board users (crm area).
CREATE FUNCTION public.ops_4420_ticket_ctx(OUT actor_email text, OUT via text, OUT is_support boolean, OUT is_crm boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT lower(btrim(u.email)) INTO actor_email FROM auth.users u WHERE u.id = auth.uid();
  END IF;
  is_support := auth.uid() IS NOT NULL AND COALESCE(public.is_support_staff(auth.uid()), false);
  is_crm := auth.uid() IS NOT NULL AND COALESCE(public.admin_team_can('crm'), false);
  IF actor_email IS NULL OR actor_email = '' OR NOT (is_support OR is_crm) THEN
    RAISE EXCEPTION 'forbidden: Only Support staff and Work board users can use tickets.' USING ERRCODE = '42501';
  END IF;
  via := public.ops_4420_agent_via();
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4420_ticket_ctx() FROM PUBLIC, anon, authenticated;

-- The ticket object on a ticket card's JSON. Counts only: no customer text.
CREATE FUNCTION public.ops_ticket_json(p_card_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('type', t.ticket_type, 'product_area', t.product_area, 'created_from', t.created_from,
           'reporter_count', (SELECT count(*) FROM public.ops_work_links l WHERE l.card_id = t.card_id AND l.kind = 'support_conversation'),
           'source_signal_id', t.source_signal_id)
    FROM public.ops_work_tickets t WHERE t.card_id = p_card_id;
$$;
REVOKE ALL ON FUNCTION public.ops_ticket_json(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Links: support conversations
-- ─────────────────────────────────────────────────────────────────────────
-- From its latest definition (20271202003980, #3980 W4). #4420: a support
-- conversation is labelled by its number only, never customer text.
CREATE OR REPLACE FUNCTION public.ops_link_label(p_kind text, p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v text;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  IF p_kind IN ('host', 'creator') THEN
    SELECT c.name INTO v FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL AND c.pipeline = p_kind || 's';
  ELSIF p_kind = 'brand' THEN
    SELECT b.name INTO v FROM public.brands b WHERE b.id = p_id AND b.deleted_at IS NULL;
  ELSIF p_kind = 'event' THEN
    IF public.ops_event_in_scope(p_id) THEN SELECT e.title INTO v FROM public.events e WHERE e.id = p_id; END IF;
  ELSIF p_kind = 'content' THEN
    SELECT i.title INTO v FROM public.content_calendar_items i WHERE i.id = p_id AND i.deleted_at IS NULL;
  ELSIF p_kind = 'expected' THEN
    SELECT x.title INTO v FROM public.ops_expected_events x WHERE x.id = p_id AND x.status <> 'cancelled';
  ELSIF p_kind = 'card' THEN
    SELECT w.title INTO v FROM public.ops_work_cards w WHERE w.id = p_id AND w.archived_at IS NULL;
  ELSIF p_kind = 'roadmap_card' THEN
    -- #3980 synced, Wave 2: a Community roadmap card (Bridge D drafts).
    SELECT r.public_title INTO v FROM public.community_roadmap_cards r WHERE r.id = p_id;
  ELSIF p_kind = 'support_conversation' THEN
    -- #4420: a support conversation (support_tickets row), by number only.
    SELECT 'Conversation ' || t.ticket_number INTO v FROM public.support_tickets t WHERE t.id = p_id;
  END IF;
  RETURN btrim(left(COALESCE(NULLIF(btrim(v), ''), CASE WHEN v IS NOT NULL THEN 'Untitled' END), 160));
END;
$$;

-- From its latest definition (20271130003980, #3980 W2). #4420: accepts
-- support_conversation; the message names it.
CREATE OR REPLACE FUNCTION public.ops_links_check(p_links jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_fixes jsonb := '[]'::jsonb; v_out jsonb := '[]'::jsonb; v_l jsonb; v_kind text; v_id text; v_label text; v_bad_kind boolean := false;
BEGIN
  IF p_links IS NULL OR jsonb_typeof(p_links) = 'null' THEN
    RETURN jsonb_build_object('links', '[]'::jsonb, 'fixes', '[]'::jsonb);
  END IF;
  IF jsonb_typeof(p_links) <> 'array' THEN
    RETURN jsonb_build_object('links', '[]'::jsonb, 'fixes', jsonb_build_array(jsonb_build_object('field', 'links',
      'message', 'Link kind must be host, creator, brand, event, content, expected, card or support_conversation.')));
  END IF;
  IF jsonb_array_length(p_links) > 20 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links', 'message', 'A card can link at most 20 records.'));
  END IF;
  FOR v_l IN SELECT e FROM jsonb_array_elements(p_links) e LOOP
    v_kind := CASE WHEN jsonb_typeof(v_l) = 'object' THEN v_l->>'kind' END;
    v_id := CASE WHEN jsonb_typeof(v_l) = 'object' THEN v_l->>'id' END;
    IF v_kind IS NULL OR v_kind NOT IN ('host','creator','brand','event','content','expected','card','roadmap_card','support_conversation') THEN
      IF NOT v_bad_kind THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links',
          'message', 'Link kind must be host, creator, brand, event, content, expected, card or support_conversation.'));
        v_bad_kind := true;
      END IF;
      CONTINUE;
    END IF;
    v_label := CASE WHEN public.ops_is_uuid(v_id) THEN public.ops_link_label(v_kind, v_id::uuid) END;
    IF v_label IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links',
        'message', format('Linked %s %s does not exist or was removed. Pick it again from live data.', v_kind, left(COALESCE(v_id, ''), 60))));
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) o WHERE o->>'kind' = v_kind AND o->>'id' = lower(v_id)) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', v_kind, 'id', lower(v_id), 'label', v_label));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('links', v_out, 'fixes', v_fixes);
END;
$$;

-- From its latest definition (20271116003980, #3980 Wave 1). #4420: every
-- writer of card links (add_work, update_work, tickets) passes here, so the
-- support conversation rule lives here once: only a person who is Support
-- staff adds or removes a support_conversation link. Calls that leave those
-- links as they are (an agent editing a ticket's title) are unaffected.
CREATE OR REPLACE FUNCTION public.ops_links_set(p_card_id uuid, p_links jsonb, p_actor text, p_via text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_before text; v_after text; v_sc_before text; v_sc_after text;
BEGIN
  SELECT string_agg(l.target_id::text, ',' ORDER BY l.target_id) INTO v_sc_before
    FROM public.ops_work_links l WHERE l.card_id = p_card_id AND l.kind = 'support_conversation';
  SELECT string_agg(x.id, ',' ORDER BY x.id) INTO v_sc_after
    FROM (SELECT DISTINCT lower(n->>'id') AS id FROM jsonb_array_elements(COALESCE(p_links, '[]'::jsonb)) n
           WHERE n->>'kind' = 'support_conversation') x;
  IF v_sc_before IS DISTINCT FROM v_sc_after THEN
    IF p_via IS NOT NULL OR public.ops_4420_agent_via() IS NOT NULL THEN
      RAISE EXCEPTION 'people_only: A person links support conversations to a card.' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NULL OR NOT COALESCE(public.is_support_staff(auth.uid()), false) THEN
      RAISE EXCEPTION 'support_required: Only Support staff link support conversations to a card.' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT string_agg(l.kind || ':' || l.target_id::text, ',' ORDER BY l.kind, l.target_id) INTO v_before FROM public.ops_work_links l WHERE l.card_id = p_card_id;
  DELETE FROM public.ops_work_links l WHERE l.card_id = p_card_id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_links) n WHERE n->>'kind' = l.kind AND (n->>'id')::uuid = l.target_id);
  INSERT INTO public.ops_work_links (card_id, kind, target_id, label, added_by, added_via)
  SELECT p_card_id, n->>'kind', (n->>'id')::uuid, left(n->>'label', 160), p_actor, p_via FROM jsonb_array_elements(p_links) n
  ON CONFLICT (card_id, kind, target_id) DO UPDATE SET label = EXCLUDED.label;
  SELECT string_agg(l.kind || ':' || l.target_id::text, ',' ORDER BY l.kind, l.target_id) INTO v_after FROM public.ops_work_links l WHERE l.card_id = p_card_id;
  RETURN v_before IS DISTINCT FROM v_after;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Work card functions (replaced from their latest bodies)
-- ─────────────────────────────────────────────────────────────────────────
-- From its latest definition (20280626004398, #4398). #4420: a stored ticket kind is kept in update mode and treated
-- like task for anchors; add mode refuses kind ticket (tickets are made with ops_ticket_create).
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
$function$

;

-- From its latest definition (20280626014398, #4398). #4420: adds the ticket object for kind ticket only.
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
        'waiting_on', public.ops_name((public.ops_card_people(c.id, 'watcher'))[1])) END,
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

-- From its latest definition (20280707004423, #4423 W2). #4420: adds the ticket object for kind ticket only.
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
           min(p.email) FILTER (WHERE p.role = 'watcher') AS first_watcher
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
           sp.id AS sp_id, sp.starts_on AS sp_starts_on, sp.ends_on AS sp_ends_on, sp.goal AS sp_goal,
           st.id AS st_id, st.name AS st_name, st.color AS st_color, st.grp AS st_grp,
           pc.id AS pc_id, pc.number AS pc_number, pc.title AS pc_title, pc.parent_id AS pc_parent_id,
           gl.id AS gl_id, gl.title AS gl_title, gl.state AS gl_state,
           pp.owners, pp.watchers, pp.first_watcher, lk.links, gh.github, k.total AS kids_total, k.done AS kids_done,
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
            'waiting_on', CASE WHEN p.first_watcher IS NULL THEN v_anon ELSE v_names->>p.first_watcher END)
          ELSE jsonb_build_object('requested_at', p.review_requested_at,
            'waiting_on', CASE WHEN p.first_watcher IS NULL THEN v_anon ELSE v_names->>p.first_watcher END) END,
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
                                       'ends_on', p.sp_ends_on, 'goal', p.sp_goal),
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

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Ticket functions
-- ─────────────────────────────────────────────────────────────────────────
-- Create a ticket. Support staff (from a conversation) or Work board users
-- (from the board). A person only: agents see and update tickets, never
-- create them. The creator picks the owner as on any card; the creator is the
-- watcher when they are not the owner (otherwise the caller names one).
CREATE FUNCTION public.ops_ticket_create(p_ticket jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text; v_fixes jsonb := '[]'::jsonb;
  v_type text; v_area text; v_from text; v_conv jsonb; v_brand text; v_links jsonb := '[]'::jsonb; v_x jsonb;
  v_owners jsonb; v_watchers jsonb; v_item jsonb; v_chk jsonb; cl jsonb; c public.ops_work_cards; v_event uuid;
  v_out jsonb; v_who text; v_o text[]; v_w text[]; v_ex_id uuid; v_ex_number bigint; v_ex_title text;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: Tickets are made by a person, with Create ticket in Admin.' USING ERRCODE = '42501';
  END IF;
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_ticket IS NULL OR jsonb_typeof(p_ticket) <> 'object' THEN
    RAISE EXCEPTION 'invalid_ticket: Send the ticket as an object.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_ticket) k
   WHERE k NOT IN ('type','title','what_is_wrong','product_area','conversation_ids','created_from','brand_id','owners','watchers','due_on')
   ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A ticket does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-ticket', 'add', p_ticket);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_who := public.ops_actor_label(v.actor_email, NULL);

  v_type := CASE WHEN jsonb_typeof(p_ticket->'type') = 'string' THEN p_ticket->>'type' END;
  IF v_type IS NULL OR v_type NOT IN ('bug','idea','question','task') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'type', 'message', 'Type must be bug, idea, question or task.'));
  END IF;
  v_area := CASE WHEN jsonb_typeof(p_ticket->'product_area') = 'string' THEN public.ops_one_line(p_ticket->>'product_area') END;
  IF v_area IS NULL OR char_length(v_area) NOT BETWEEN 1 AND 120 OR public.ops_has_control(v_area) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'product_area', 'message', 'Pick the product area (1 to 120 characters).'));
  END IF;
  v_from := COALESCE(CASE WHEN jsonb_typeof(p_ticket->'created_from') = 'string' THEN p_ticket->>'created_from' END, 'board');
  IF v_from NOT IN ('conversation','board','brand_group') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'created_from', 'message', 'A ticket is made from a conversation, the board or a Brand group.'));
  END IF;
  v_conv := COALESCE(p_ticket->'conversation_ids', '[]'::jsonb);
  IF jsonb_typeof(v_conv) <> 'array' OR jsonb_array_length(v_conv) > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_conv) e WHERE jsonb_typeof(e) <> 'string' OR NOT public.ops_is_uuid(e #>> '{}')) THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'conversation_ids', 'message', 'Link up to 20 conversations by their id.'));
    v_conv := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_conv) > 0 AND NOT v.is_support THEN
    RAISE EXCEPTION 'support_required: Only Support staff link support conversations to a ticket.' USING ERRCODE = '42501';
  END IF;
  IF v_from = 'conversation' AND jsonb_array_length(v_conv) = 0 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'conversation_ids', 'message', 'A ticket made from a conversation links that conversation.'));
  END IF;
  FOR v_x IN SELECT e FROM jsonb_array_elements(v_conv) e LOOP
    v_links := v_links || jsonb_build_array(jsonb_build_object('kind', 'support_conversation', 'id', lower(v_x #>> '{}')));
  END LOOP;
  v_brand := CASE WHEN jsonb_typeof(p_ticket->'brand_id') = 'string' THEN p_ticket->>'brand_id' END;
  IF v_brand IS NOT NULL THEN
    v_links := v_links || jsonb_build_array(jsonb_build_object('kind', 'brand', 'id', lower(v_brand)));
  ELSIF v_from = 'brand_group' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'brand_id', 'message', 'A ticket made from a Brand group links that brand.'));
  END IF;

  -- Ordinary card rules: the creator picks the owner; the creator watches
  -- when they are not the owner.
  v_owners := p_ticket->'owners';
  v_watchers := p_ticket->'watchers';
  IF (v_watchers IS NULL OR jsonb_typeof(v_watchers) = 'null' OR v_watchers = '[]'::jsonb)
     AND jsonb_typeof(v_owners) = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_owners) o WHERE lower(btrim(o)) = v.actor_email) THEN
    v_watchers := jsonb_build_array(v.actor_email);
  END IF;
  v_item := jsonb_build_object('title', p_ticket->'title', 'instructions', p_ticket->'what_is_wrong',
    'done_means', 'Fixed, answered or decided, and every reporter told.',
    'owners', v_owners, 'watchers', v_watchers, 'links', v_links)
    -- Every card has a due date (ops_validate_card); a ticket made without
    -- one is due in seven days, and its owner can move it like any card's.
    || jsonb_build_object('due_on', CASE WHEN p_ticket ? 'due_on' AND jsonb_typeof(p_ticket->'due_on') <> 'null'
                                         THEN p_ticket->'due_on' ELSE to_jsonb((v_today + 7)::text) END);
  v_chk := public.ops_validate_card(v_item, 'add', v.actor_email, v_today);
  v_fixes := v_fixes || (v_chk->'fixes');
  IF jsonb_array_length(v_fixes) > 0 THEN
    v_out := jsonb_build_object('status', 'refused', 'fixes', v_fixes, 'replayed', false);
    PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-ticket', 'add', v_out);
    RETURN v_out;
  END IF;
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
    v_out := jsonb_build_object('status', 'duplicate', 'existing', v_chk->'duplicate', 'replayed', false,
      'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number'));
    PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-ticket', 'add', v_out);
    RETURN v_out;
  END IF;
  cl := v_chk->'clean';
  v_o := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_w := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  BEGIN
    INSERT INTO public.ops_work_cards (title, instructions, done_means, status, kind, anchor_kind, anchor_id, due_on, due_source, sprint_id, plan,
      created_by, created_via, updated_by, updated_via, request_key)
    VALUES (cl->>'title', cl->>'instructions', cl->>'done_means', 'todo', 'ticket', cl->>'anchor_kind', (cl->>'anchor_id')::uuid,
      (cl->>'due_on')::date, cl->>'due_source', public.ops_sprint_for((cl->>'due_on')::date, v_today), '[]'::jsonb,
      v.actor_email, NULL, v.actor_email, NULL, p_request_key || '-t')
    RETURNING * INTO c;
  EXCEPTION WHEN unique_violation THEN
    SELECT w.id, w.number, w.title INTO v_ex_id, v_ex_number, v_ex_title FROM public.ops_work_cards w
     WHERE w.archived_at IS NULL AND w.title_key = public.crm_name_key(cl->>'title') AND w.status <> 'done' LIMIT 1;
    v_out := jsonb_build_object('status', 'duplicate', 'existing', jsonb_build_object('id', v_ex_id, 'number', v_ex_number, 'title', v_ex_title),
      'replayed', false, 'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_ex_title, v_ex_number));
    PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-ticket', 'add', v_out);
    RETURN v_out;
  END;
  INSERT INTO public.ops_work_tickets (card_id, ticket_type, product_area, created_from) VALUES (c.id, v_type, v_area, v_from);
  PERFORM public.ops_people_set(c.id, v_o, v_w, v.actor_email, NULL);
  PERFORM public.ops_links_set(c.id, cl->'links', v.actor_email, NULL);
  v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
  PERFORM public.ops_notify_people(c.id, v_event, v_o, v.actor_email, format('%s added you as owner: %s', v_who, c.title), 'assigned');
  PERFORM public.ops_notify_people(c.id, v_event, v_w, v.actor_email, format('%s added you as watcher: %s', v_who, c.title), 'assigned');
  PERFORM public.ops_log_write(v.actor_email, NULL, 'card_added', 'ok', c.id, 'work_card', c.id,
    format('Added Ticket %s: %s', c.number, c.title), jsonb_build_object('ticket', true, 'reporters', jsonb_array_length(v_conv)));
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = c.id;
  v_out := jsonb_build_object('status', 'added', 'card', public.ops_card_json(c, v_today), 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-ticket', 'add', v_out);
  RETURN v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM ~ '^[a-z_]+: ' THEN RAISE; END IF;
  RAISE WARNING 'ops_ticket_create: request stopped (% %)', SQLSTATE, SQLERRM;
  RAISE EXCEPTION 'try_again: Something went wrong on our side, so the ticket was not made. Send the same request again.' USING ERRCODE = 'PT409';
END;
$$;

-- Change a ticket's type or product area. Work board users and their agents
-- (agents update tickets).
CREATE FUNCTION public.ops_ticket_update(p_card_id uuid, p_changes jsonb, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; t public.ops_work_tickets; v_type text; v_area text; v_before jsonb; v_event uuid; n public.ops_work_cards;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('type','product_area')) THEN
    RAISE EXCEPTION 'invalid_changes: A ticket change takes type and product_area.' USING ERRCODE = '22023';
  END IF;
  c := public.ops_card_lock(p_card_id, p_expected_revision);
  SELECT * INTO t FROM public.ops_work_tickets x WHERE x.card_id = c.id FOR UPDATE;
  IF c.kind <> 'ticket' OR t.card_id IS NULL THEN RAISE EXCEPTION 'not_a_ticket: That card is not a ticket.' USING ERRCODE = '22023'; END IF;
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this card before changing it.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  v_type := COALESCE(CASE WHEN jsonb_typeof(p_changes->'type') = 'string' THEN p_changes->>'type' END, t.ticket_type);
  v_area := CASE WHEN p_changes ? 'product_area' THEN CASE WHEN jsonb_typeof(p_changes->'product_area') = 'string' THEN public.ops_one_line(p_changes->>'product_area') END ELSE t.product_area END;
  IF v_type NOT IN ('bug','idea','question','task') THEN
    RAISE EXCEPTION 'invalid_ticket: Type must be bug, idea, question or task.' USING ERRCODE = '22023';
  END IF;
  IF v_area IS NULL OR char_length(v_area) NOT BETWEEN 1 AND 120 OR public.ops_has_control(v_area) THEN
    RAISE EXCEPTION 'invalid_ticket: Pick the product area (1 to 120 characters).' USING ERRCODE = '22023';
  END IF;
  IF ROW(v_type, v_area) IS NOT DISTINCT FROM ROW(t.ticket_type, t.product_area) THEN
    RETURN jsonb_build_object('card', public.ops_card_json(c, public.ops_today(NULL)), 'changed', false);
  END IF;
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_tickets SET ticket_type = v_type, product_area = v_area, updated_at = now() WHERE card_id = c.id;
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'updated', format('Ticket: %s, %s.', v_type, v_area), v_before,
    public.ops_card_snapshot(c.id), c.revision, n.revision);
  RETURN jsonb_build_object('card', public.ops_card_json(n, public.ops_today(NULL)), 'event_id', v_event, 'changed', true);
END;
$$;

-- The menu Work count: open tickets I own still in To do. Its own function,
-- so ops_my_counts (read by the agent tools) is unchanged.
CREATE FUNCTION public.ops_ticket_counts() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  RETURN jsonb_build_object('tickets_new_mine', (SELECT count(*) FROM public.ops_work_cards w
    JOIN public.ops_work_people p ON p.card_id = w.id AND p.email = v.actor_email AND p.role = 'owner'
   WHERE w.kind = 'ticket' AND w.status = 'todo' AND w.archived_at IS NULL));
END;
$$;

-- Similar open tickets for a title being typed. Titles and counts only.
CREATE FUNCTION public.ops_ticket_similar(p_text text, p_limit integer DEFAULT 5) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_words text[]; v_out jsonb;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  v_words := ARRAY(SELECT DISTINCT w FROM unnest(regexp_split_to_array(lower(COALESCE(left(p_text, 300), '')), '[^[:alnum:]]+')) w
                    WHERE char_length(w) >= 3 LIMIT 20);
  IF cardinality(v_words) = 0 THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.hits DESC, x.created_at DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object('id', w.id, 'number', w.number, 'title', w.title, 'type', t.ticket_type,
             'reporter_count', (SELECT count(*) FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = 'support_conversation')) AS j,
           (SELECT count(*) FROM unnest(v_words) q WHERE lower(w.title) LIKE '%' || q || '%') AS hits, w.created_at
      FROM public.ops_work_cards w JOIN public.ops_work_tickets t ON t.card_id = w.id
     WHERE w.kind = 'ticket' AND w.status <> 'done' AND w.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM unnest(v_words) q WHERE lower(w.title) LIKE '%' || q || '%')
     ORDER BY 2 DESC, w.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 10)) x;
  RETURN v_out;
END;
$$;

-- "Link here": add a conversation to a ticket as a reporter. Support staff, in person.
CREATE FUNCTION public.ops_ticket_link_conversation(p_card_id uuid, p_support_ticket_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_links jsonb; v_chk jsonb; v_before jsonb; v_event uuid;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: A person links support conversations to a card.' USING ERRCODE = '42501';
  END IF;
  IF NOT v.is_support THEN
    RAISE EXCEPTION 'support_required: Only Support staff link support conversations to a card.' USING ERRCODE = '42501';
  END IF;
  c := public.ops_card_lock(p_card_id, p_expected_revision);
  IF c.kind <> 'ticket' THEN RAISE EXCEPTION 'not_a_ticket: That card is not a ticket.' USING ERRCODE = '22023'; END IF;
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this ticket before adding a reporter.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = 'support_conversation' AND l.target_id = p_support_ticket_id) THEN
    RETURN jsonb_build_object('card', public.ops_card_json(c, public.ops_today(NULL)), 'changed', false);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id) ORDER BY l.added_at), '[]'::jsonb) INTO v_links
    FROM public.ops_work_links l WHERE l.card_id = c.id;
  v_chk := public.ops_links_check(v_links || jsonb_build_array(jsonb_build_object('kind', 'support_conversation', 'id', p_support_ticket_id)));
  IF jsonb_array_length(v_chk->'fixes') > 0 THEN
    RAISE EXCEPTION '%', 'invalid_card: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_chk->'fixes') f) USING ERRCODE = '22023';
  END IF;
  v_before := public.ops_card_snapshot(c.id);
  PERFORM public.ops_links_set(c.id, v_chk->'links', v.actor_email, NULL);
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'links', 'Reporter added: ' || public.ops_link_label('support_conversation', p_support_ticket_id) || '.',
    v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  RETURN jsonb_build_object('card', public.ops_card_json(n, public.ops_today(NULL)), 'event_id', v_event, 'changed', true);
END;
$$;

-- A ticket's linked conversations, messages, photos and internal notes.
-- Support staff only; a Work board user without Support access gets the
-- reporter count and nothing else; anyone else is refused.
CREATE FUNCTION public.ops_ticket_conversations(p_card_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_count bigint; v_out jsonb;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.kind = 'ticket' AND w.archived_at IS NULL) THEN
    RAISE EXCEPTION 'not_found: That ticket is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*) INTO v_count FROM public.ops_work_links l WHERE l.card_id = p_card_id AND l.kind = 'support_conversation';
  IF NOT v.is_support THEN
    RETURN jsonb_build_object('access', 'support_required', 'reporter_count', v_count);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'support_ticket_id', st.id, 'ticket_number', st.ticket_number, 'subject', st.subject, 'status', st.status,
           'segment', st.requester_segment, 'requester_user_id', st.requester_user_id,
           'customer_name', (SELECT NULLIF(btrim(pr.display_name), '') FROM public.profiles pr WHERE pr.id = st.requester_user_id),
           'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'sender_id', m.sender_id,
                 'sender_kind', CASE WHEN m.sender_id = st.requester_user_id THEN 'customer' WHEN m.sender_id IS NULL THEN 'system' ELSE 'staff' END,
                 'content', m.content, 'message_type', m.message_type, 'is_internal', m.is_internal, 'created_at', m.created_at,
                 'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'storage_path', a.storage_path, 'kind', a.kind,
                                    'mime', a.mime, 'width', a.width, 'height', a.height, 'duration_ms', a.duration_ms, 'is_internal', a.is_internal)
                                    ORDER BY a.created_at, a.id)
                                  FROM public.support_attachments a WHERE a.message_id = m.id AND a.purge_started_at IS NULL), '[]'::jsonb))
               ORDER BY m.created_at, m.id)
              FROM (SELECT * FROM public.messages m0 WHERE m0.conversation_id = st.conversation_id AND m0.deleted_at IS NULL
                     ORDER BY m0.created_at DESC, m0.id DESC LIMIT 500) m), '[]'::jsonb))
         ORDER BY l.added_at, l.target_id), '[]'::jsonb) INTO v_out
    FROM public.ops_work_links l JOIN public.support_tickets st ON st.id = l.target_id
   WHERE l.card_id = p_card_id AND l.kind = 'support_conversation';
  RETURN jsonb_build_object('access', 'support', 'reporter_count', v_count, 'conversations', v_out);
END;
$$;

-- Ticket chips for the Support inbox. Support staff only.
CREATE FUNCTION public.issue_4420_conversation_tickets(p_support_ticket_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_out jsonb;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  IF NOT v.is_support THEN
    RAISE EXCEPTION 'support_required: Only Support staff see tickets on conversations.' USING ERRCODE = '42501';
  END IF;
  IF p_support_ticket_ids IS NULL OR cardinality(p_support_ticket_ids) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_support_ticket_ids) > 2000 THEN
    RAISE EXCEPTION 'invalid_query: Ask for at most 2,000 conversations at once.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('support_ticket_id', l.target_id, 'card_id', w.id, 'number', w.number,
           'title', w.title, 'type', t.ticket_type, 'status', w.status) ORDER BY l.target_id, w.number), '[]'::jsonb) INTO v_out
    FROM public.ops_work_links l
    JOIN public.ops_work_cards w ON w.id = l.card_id AND w.kind = 'ticket' AND w.archived_at IS NULL
    JOIN public.ops_work_tickets t ON t.card_id = w.id
   WHERE l.kind = 'support_conversation' AND l.target_id = ANY (p_support_ticket_ids);
  RETURN v_out;
END;
$$;

-- "Linked to: Support conversation" search, by number or customer name.
CREATE FUNCTION public.issue_4420_conversation_search(p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_q text := btrim(COALESCE(left(p_query, 120), '')); v_out jsonb;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  IF char_length(v_q) < 2 THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.last_message_at DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object('id', st.id, 'label', 'Conversation ' || st.ticket_number,
             'customer_name', NULLIF(btrim(pr.display_name), ''), 'segment', st.requester_segment) AS j, st.last_message_at
      FROM public.support_tickets st LEFT JOIN public.profiles pr ON pr.id = st.requester_user_id
     WHERE (v_q ~ '^[0-9]{1,12}$' AND st.ticket_number = v_q::bigint)
        OR (v_q !~ '^[0-9]{1,12}$' AND pr.display_name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     ORDER BY st.last_message_at DESC LIMIT 10) x;
  RETURN v_out;
END;
$$;

-- Old Product board deep links: the ticket a signal backs, if any.
CREATE FUNCTION public.issue_4420_ticket_for_signal(p_signal_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.ops_4420_ticket_ctx();
  RETURN (SELECT t.card_id FROM public.ops_work_tickets t WHERE t.source_signal_id = p_signal_id);
END;
$$;

-- "Send to GitHub" needs a Product signal: a ticket gets one the first time
-- it is sent. Product operators only. Idempotent.
CREATE FUNCTION public.issue_4420_ticket_signal_ensure(p_card_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE c public.ops_work_cards; t public.ops_work_tickets; v_id uuid; v_reporters integer; v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.is_product_operator(v_actor), false) THEN
    RAISE EXCEPTION 'forbidden: Only product operators send tickets to GitHub.' USING ERRCODE = '42501';
  END IF;
  IF public.ops_4420_agent_via() IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: A person sends a ticket to GitHub.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.archived_at IS NULL;
  SELECT * INTO t FROM public.ops_work_tickets x WHERE x.card_id = p_card_id FOR UPDATE;
  IF c.id IS NULL OR c.kind <> 'ticket' OR t.card_id IS NULL THEN
    RAISE EXCEPTION 'not_a_ticket: That card is not a ticket.' USING ERRCODE = '22023';
  END IF;
  IF t.source_signal_id IS NOT NULL THEN RETURN t.source_signal_id; END IF;
  IF t.ticket_type = 'task' THEN
    RAISE EXCEPTION 'not_for_github: A task ticket uses the card''s own GitHub field.' USING ERRCODE = '22023';
  END IF;
  SELECT GREATEST(count(*), 1)::integer INTO v_reporters FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = 'support_conversation';
  INSERT INTO public.support_product_signals (client_request_id, signal_kind, state, title, problem_statement, product_area,
    user_journey, impact_summary, affected_people, priority, owner_user_id, next_update_at, next_step, customer_reply_draft, created_by)
  VALUES (gen_random_uuid(), CASE t.ticket_type WHEN 'bug' THEN 'bug' WHEN 'idea' THEN 'feature' ELSE 'question' END, 'triaged',
    left(c.title, 200), left(c.instructions, 8000), t.product_area,
    format('From Work ticket %s.', c.number), format('%s reporter(s) on Work ticket %s.', v_reporters, c.number),
    v_reporters, 'normal', v_actor, now() + interval '7 days',
    format('Send to GitHub from Ticket %s.', c.number),
    format('No customer reply drafted; this item came from Work ticket %s.', c.number), v_actor)
  RETURNING id INTO v_id;
  INSERT INTO public.support_product_signal_sources (signal_id, source_kind, source_id, linked_by)
  SELECT v_id, 'support_ticket', l.target_id, v_actor FROM public.ops_work_links l
   WHERE l.card_id = c.id AND l.kind = 'support_conversation'
  ON CONFLICT DO NOTHING;
  UPDATE public.ops_work_tickets SET source_signal_id = v_id, updated_at = now() WHERE card_id = c.id;
  RETURN v_id;
END;
$$;

-- After a successful Send to GitHub: the signal's linked issue also goes on
-- the card's own GitHub list. Product operators only.
CREATE FUNCTION public.issue_4420_ticket_github_mirror(p_card_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE t public.ops_work_tickets; c public.ops_work_cards; v_issue integer; v_email text; v_added integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_product_operator(auth.uid()), false) THEN
    RAISE EXCEPTION 'forbidden: Only product operators send tickets to GitHub.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.ops_work_tickets x WHERE x.card_id = p_card_id;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.archived_at IS NULL;
  IF t.card_id IS NULL OR c.id IS NULL THEN RAISE EXCEPTION 'not_a_ticket: That card is not a ticket.' USING ERRCODE = '22023'; END IF;
  SELECT i.issue_number INTO v_issue FROM public.product_signal_avengers_links pl
    JOIN public.product_avengers_items i ON i.id = pl.item_id WHERE pl.signal_id = t.source_signal_id;
  IF v_issue IS NULL THEN RETURN jsonb_build_object('issue_number', NULL, 'added', false); END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.ops_work_github (card_id, kind, number, added_by, added_via)
  VALUES (c.id, 'issue', v_issue, v_email, NULL) ON CONFLICT (card_id, number) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    PERFORM public.ops_card_event(c.id, v_email, NULL, 'github', 'GitHub: #' || v_issue, NULL, NULL, c.revision, c.revision);
  END IF;
  RETURN jsonb_build_object('issue_number', v_issue, 'added', v_added > 0);
END;
$$;

-- Closing a ticket: one internal (staff-only) note on each linked
-- conversation, from the person who closed it. Never a customer message:
-- is_internal notes are hidden from customers by the restrictive policy
-- messages_support_internal_read_guard, and nothing here notifies anyone.
-- An ordinary AFTER UPDATE trigger: it runs as the caller (auth.uid()).
CREATE FUNCTION public.ops_4420_ticket_close_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); v_text text; v_n integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.ops_log_write(NEW.closed_by, NEW.closed_via, 'updated', 'info', NEW.id, 'work_card', NEW.id,
      format('Ticket %s closed with no person signed in: no conversation note written.', NEW.number), '{}'::jsonb);
    RETURN NULL;
  END IF;
  v_text := left(format('Ticket %s closed: %s', NEW.number,
    COALESCE(NULLIF(btrim(NEW.result), ''), NULLIF(btrim(NEW.close_reason), ''), 'no result given.')), 2000);
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, is_internal)
  SELECT st.conversation_id, v_uid, v_text, 'text', true
    FROM public.ops_work_links l JOIN public.support_tickets st ON st.id = l.target_id
   WHERE l.card_id = NEW.id AND l.kind = 'support_conversation';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4420_ticket_close_note() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4420_ticket_close_note AFTER UPDATE OF status ON public.ops_work_cards
  FOR EACH ROW WHEN (NEW.kind = 'ticket' AND NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done')
  EXECUTE FUNCTION public.ops_4420_ticket_close_note();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Roadmap: retire the "roadmap updated" notice. Roadmap rows stay.
-- ─────────────────────────────────────────────────────────────────────────
-- The one sender of the notice (called by community_notify_roadmap_change
-- and the scheduled-notice runner). Replaced, not copied: it now refuses.
CREATE OR REPLACE FUNCTION public.issue_4383_notify_roadmap_internal(p_request_key uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'retired: The roadmap updated notice was retired in #4420.' USING ERRCODE = '22023';
END;
$$;
CREATE OR REPLACE FUNCTION public.community_notify_roadmap_change(p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Admins only, as before (from 20280608004383); then refused: retired.
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'retired: The roadmap updated notice was retired in #4420.' USING ERRCODE = '22023';
END;
$$;
CREATE OR REPLACE FUNCTION public.issue_4383_roadmap_schedule_notice(p_scheduled_for timestamptz, p_timezone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Admins only, as before (from 20280608004383); then refused: retired.
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'retired: The roadmap updated notice was retired in #4420.' USING ERRCODE = '22023';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Grants
-- ─────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ops_ticket_create(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_ticket_update(uuid, jsonb, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_ticket_similar(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_ticket_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_ticket_link_conversation(uuid, uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_ticket_conversations(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4420_conversation_tickets(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4420_conversation_search(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4420_ticket_for_signal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4420_ticket_signal_ensure(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4420_ticket_github_mirror(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_ticket_create(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ticket_update(uuid, jsonb, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ticket_similar(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ticket_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ticket_link_conversation(uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ticket_conversations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_conversation_tickets(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_conversation_search(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_ticket_for_signal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_ticket_signal_ensure(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_ticket_github_mirror(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Data steps
-- ─────────────────────────────────────────────────────────────────────────
-- Pending scheduled roadmap notices are cancelled, as
-- issue_4383_roadmap_cancel_notice cancels one (status, cancelled_at, audit row).
WITH c AS (
  UPDATE public.community_roadmap_notices_scheduled
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE status = 'scheduled'
  RETURNING id
)
INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
SELECT NULL, 'cancel_roadmap_notice', 'community_roadmap_notice', c.id, jsonb_build_object('reason', 'Roadmap retired (#4420)')
  FROM c;
