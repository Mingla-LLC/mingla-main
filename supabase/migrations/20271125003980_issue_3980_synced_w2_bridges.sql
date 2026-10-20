-- Issue #3980, synced program, Wave 2: the bridges.
--
-- What this adds:
--   * Bridge A: Mingla follows every GitHub issue and pull request linked
--     from a Work card, a support ticket (through the Product Inbox) or a
--     Community roadmap card, and from recent release records. The 5-minute
--     sync reads them from GitHub (read only) and hands their status here;
--     every place a link shows reads the same status chip: Planned,
--     In Progress, In Review, Shipped or Live (Open, Merged, Closed or Live
--     for a pull request).
--   * Bridge B: a complete release record turns the Feature Guide entries it
--     names Live, with the evidence the record proves. When an entry still
--     misses a kind of evidence it requires, nothing about it changes and
--     the record says what is missing. Support teammates are told through
--     one Work card notice.
--   * Bridge C: a support ticket or staff thread linked to an issue shows
--     its engineering status.
--   * Bridge D: an issue going Live drafts one "Recently shipped" roadmap
--     card and asks a person to approve it. The draft is never published
--     here; hosts see nothing until a person publishes it.
--   * Bridge E: a Work card can wait for its GitHub issues; it unblocks by
--     itself when every one is Live, and its owners and watchers are told.
--   * Roadmap suggestions: the lane GitHub's Status and Horizon suggest for a
--     linked roadmap card. Nothing here moves a card; a person applies the
--     suggestion through the existing roadmap editor, or dismisses it.
--
-- Replaced functions keep their signatures, attributes and grants; each
-- names the migration it was copied from.
--
-- NOT modified: is_admin_user(), team_agent_call, crm_ctx, admin_team_list
-- and the other admin_team_* functions, any issue_3720_* function,
-- community_upsert_roadmap_card, any crm_ table, any ad_ table. Nothing here
-- writes to GitHub or reaches outside the database.
--
-- ROLLBACK (no down-migration file): roll the admin web client and
-- product-avengers-sync back first, then in one transaction restore each
-- replaced function from the migration named above it, restore the two
-- altered check constraints (no card or link may still use 'github' or
-- 'roadmap_card'), drop ops_release_records.test_files, put back the plain
-- ops_roadmap_links_issue index in place of ops_roadmap_links_issue_unique
-- and drop the new ops_ functions. Feature Guide evidence and roadmap drafts written by the
-- bridges stay as audited history.

BEGIN;

-- A stuck lock aborts the apply instead of hanging.
SET LOCAL lock_timeout = '10s';

-- Remembered for the self-check at the end.
CREATE TEMP TABLE issue3980_sync_w2_guard ON COMMIT DROP AS
SELECT md5(pg_get_functiondef('public.is_admin_user()'::regprocedure)) AS is_admin_hash,
       md5(pg_get_functiondef('public.crm_ctx()'::regprocedure)) AS crm_ctx_hash,
       md5(pg_get_functiondef('public.team_agent_call(text,text,jsonb,text)'::regprocedure)) AS gateway_hash,
       md5(pg_get_functiondef('public.community_upsert_roadmap_card(uuid,text,text,text,text,text)'::regprocedure)) AS roadmap_hash,
       md5(pg_get_functiondef('public.issue_3720_record_feature_evidence(uuid,integer,text,text,text,text,timestamptz,timestamptz)'::regprocedure)) AS evidence_hash,
       md5(pg_get_functiondef('public.issue_3720_apply_product_avengers_snapshot(uuid,uuid,text,jsonb)'::regprocedure)) AS snapshot_hash;

-- ---------------------------------------------------------------------------
-- 1. Changes to existing ops tables.
-- ---------------------------------------------------------------------------

-- A card can wait for its GitHub issues to be Live (Bridge E).
ALTER TABLE public.ops_work_cards DROP CONSTRAINT ops_work_cards_blocked_kind_check;
ALTER TABLE public.ops_work_cards ADD CONSTRAINT ops_work_cards_blocked_kind_check
  CHECK (blocked_kind IS NULL OR blocked_kind IN ('manual','waiting_go_live','organic_only','github'));

-- A card can link the roadmap card Bridge D drafted.
ALTER TABLE public.ops_work_links DROP CONSTRAINT ops_work_links_kind_check;
ALTER TABLE public.ops_work_links ADD CONSTRAINT ops_work_links_kind_check
  CHECK (kind IN ('host','creator','brand','event','content','expected','card','roadmap_card'));

-- The test files a merged pull request changed, as its release record lists
-- them (Bridge B cites the first one as test evidence).
ALTER TABLE public.ops_release_records ADD COLUMN test_files text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.ops_release_records ADD CONSTRAINT ops_release_records_test_files_check CHECK (cardinality(test_files) <= 50);

-- One GitHub issue belongs to one roadmap card: two people linking the same
-- issue at the same moment cannot both win (ops_roadmap_link_set says which
-- card has it). Replaces the plain index Wave 1 made.
DROP INDEX public.ops_roadmap_links_issue;
CREATE UNIQUE INDEX ops_roadmap_links_issue_unique ON public.ops_roadmap_links (issue_number);

-- ---------------------------------------------------------------------------
-- 2. Replaced helpers.
-- ---------------------------------------------------------------------------


-- From 20271116003980. Adds the roadmap_card kind (Bridge D).
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
  END IF;
  RETURN left(COALESCE(NULLIF(btrim(v), ''), CASE WHEN v IS NOT NULL THEN 'Untitled' END), 160);
END;
$$;


-- From 20271116003980. Accepts the roadmap_card kind (Bridge D); the words
-- people read are unchanged.
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
      'message', 'Link kind must be host, creator, brand, event, content, expected or card.')));
  END IF;
  IF jsonb_array_length(p_links) > 20 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links', 'message', 'A card can link at most 20 records.'));
  END IF;
  FOR v_l IN SELECT e FROM jsonb_array_elements(p_links) e LOOP
    v_kind := CASE WHEN jsonb_typeof(v_l) = 'object' THEN v_l->>'kind' END;
    v_id := CASE WHEN jsonb_typeof(v_l) = 'object' THEN v_l->>'id' END;
    IF v_kind IS NULL OR v_kind NOT IN ('host','creator','brand','event','content','expected','card','roadmap_card') THEN
      IF NOT v_bad_kind THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links',
          'message', 'Link kind must be host, creator, brand, event, content, expected or card.'));
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



-- From 20271124003980. A system card that needs a person (Bridge D) starts
-- in Needs a person; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.ops_auto_card_upsert(p_auto_key text, p_item jsonb, p_kind text, p_anchor jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; v_today date := public.ops_today(NULL); v_item jsonb; v_chk jsonb; cl jsonb;
  c public.ops_work_cards; v_event uuid; v_owners text[]; v_watchers text[]; v_existing uuid;
BEGIN
  IF p_auto_key IS NULL OR p_auto_key !~ '^[a-z_]+:[A-Za-z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION 'invalid_auto_key: An automatic card needs a key like eng_no_issue:pr-12.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_auto_card:' || p_auto_key, 0));
  SELECT w.id INTO v_existing FROM public.ops_work_cards w
   WHERE w.auto_key = p_auto_key AND w.archived_at IS NULL AND w.status <> 'done' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('status', 'kept', 'id', v_existing); END IF;
  IF EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.auto_key = p_auto_key AND w.status = 'done'
              AND w.close_kind IN ('done','already_done','declined') AND w.closed_at > now() - interval '14 days') THEN
    RETURN jsonb_build_object('status', 'kept', 'id', NULL);
  END IF;
  v_item := COALESCE(p_item, '{}'::jsonb) || jsonb_build_object('kind', COALESCE(p_kind, 'task'));
  IF p_anchor IS NOT NULL AND jsonb_typeof(p_anchor) = 'object' THEN v_item := v_item || jsonb_build_object('anchor', p_anchor); END IF;
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
    sprint_id, plan, created_by, created_via, updated_by, updated_via, auto_key)
  VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
    CASE WHEN cl->>'person_reason' IS NOT NULL THEN 'person' ELSE 'todo' END, cl->>'person_reason', cl->>'kind', (cl->>'kit_step')::integer,
    cl->>'anchor_kind', (cl->>'anchor_id')::uuid, (cl->>'due_on')::date, cl->>'due_source',
    public.ops_sprint_ensure(v_today), cl->'plan', c_actor, 'system', c_actor, 'system', p_auto_key)
  RETURNING * INTO c;
  PERFORM public.ops_people_set(c.id, v_owners, v_watchers, c_actor, NULL);
  PERFORM public.ops_links_set(c.id, cl->'links', c_actor, NULL);
  PERFORM public.ops_github_set(c.id, cl->'github', c_actor, NULL);
  v_event := public.ops_card_event(c.id, c_actor, 'system', 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
  PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', c.id, 'work_card', c.id,
    format('Mingla added Card %s: %s', c.number, c.title), jsonb_build_object('auto_key', p_auto_key, 'owners', cardinality(v_owners)));
  PERFORM public.ops_notify_people(c.id, v_event, v_owners || v_watchers, c_actor, format('Mingla added: %s', c.title));
  RETURN jsonb_build_object('status', 'added', 'id', c.id, 'number', c.number);
END;
$$;


-- From 20271124003980. #3980 W2 rework: of two release records naming an
-- issue that merged at the same moment, the higher pull request number is
-- the newest, every time. Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.ops_github_status(p_number integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE g public.ops_github_items; v_kind text; v_label text; v_live boolean := false; v_complete boolean; v_fixed boolean;
BEGIN
  SELECT * INTO g FROM public.ops_github_items i WHERE i.number = p_number;
  v_kind := COALESCE(g.kind, (SELECT w.kind FROM public.ops_work_github w WHERE w.number = p_number ORDER BY (w.kind = 'pull') DESC LIMIT 1), 'issue');
  IF g.number IS NULL OR g.synced_at IS NULL THEN
    v_label := 'Checking GitHub';
  ELSIF g.not_found THEN
    v_label := 'Not on GitHub';
  ELSIF v_kind = 'pull' THEN
    v_live := COALESCE((SELECT r.complete FROM public.ops_release_records r WHERE r.pr = p_number), false);
    v_label := CASE WHEN v_live THEN 'Live' WHEN g.state = 'MERGED' THEN 'Merged' WHEN g.state = 'CLOSED' THEN 'Closed' ELSE 'Open' END;
  ELSE
    SELECT r.complete INTO v_complete FROM public.ops_release_records r
     WHERE r.issues @> jsonb_build_array(jsonb_build_object('number', p_number))
     ORDER BY r.merged_at DESC, r.pr DESC LIMIT 1;
    v_fixed := EXISTS (SELECT 1 FROM public.ops_release_records r
                        WHERE r.issues @> jsonb_build_array(jsonb_build_object('number', p_number, 'relation', 'fixes')));
    v_live := g.board_status = 'Done' AND COALESCE(v_complete, false);
    v_label := CASE WHEN v_live THEN 'Live'
                    WHEN g.board_status = 'Done' OR v_fixed THEN 'Shipped'
                    WHEN g.board_status = 'In Review' THEN 'In Review'
                    WHEN g.board_status = 'In Progress' THEN 'In Progress'
                    ELSE 'Planned' END;
  END IF;
  RETURN jsonb_build_object('number', p_number, 'kind', v_kind,
    'url', COALESCE(g.url, 'https://github.com/Mingla-LLC/mingla-main/' || CASE v_kind WHEN 'pull' THEN 'pull/' ELSE 'issues/' END || p_number),
    'title', g.title, 'label', v_label, 'board_status', g.board_status, 'state', g.state, 'merged_at', g.merged_at,
    'live', v_live, 'checked', g.synced_at IS NOT NULL, 'not_found', COALESCE(g.not_found, false));
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. New internal helpers (service_role only; clients cannot run them).
-- ---------------------------------------------------------------------------

-- A time GitHub or the merge bot wrote, or NULL when it is not one.
CREATE FUNCTION public.ops_try_timestamptz(p text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN RETURN NULL; END IF;
  RETURN p::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- The first sentence of a text, at most 300 characters, ending in a full stop.
CREATE FUNCTION public.ops_first_sentence(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN btrim(COALESCE(p, '')) = '' THEN NULL ELSE
    (SELECT CASE WHEN s ~ '[.!?]$' THEN s ELSE s || '.' END
       FROM (SELECT left(btrim(COALESCE((regexp_match(btrim(regexp_replace(p, '\s+', ' ', 'g')), '^(.*?[.!?])(\s|$)'))[1],
                                       btrim(regexp_replace(p, '\s+', ' ', 'g')))), 300) AS s) x) END
$$;

-- D-15: an issue is Live when it is Done on the board and the newest release
-- record naming it is complete; a pull request when its record is complete.
CREATE FUNCTION public.ops_github_live(p_number integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$ SELECT COALESCE((public.ops_github_status(p_number)->>'live')::boolean, false) $$;

-- The one place this program inserts into community_roadmap_cards: a draft
-- in "Recently shipped", never published, with an audit row saying where it
-- came from. Hosts read only published cards.
CREATE FUNCTION public.ops_roadmap_draft_add(p_title text, p_body text, p_issue integer) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_id uuid; v_sort integer; v_title text := left(btrim(regexp_replace(COALESCE(p_title, ''), '[[:cntrl:]]', ' ', 'g')), 200);
BEGIN
  IF char_length(v_title) < 1 THEN
    RAISE EXCEPTION 'invalid_title: A roadmap draft needs a title.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(r.sort_order), -1) + 1 INTO v_sort FROM public.community_roadmap_cards r;
  INSERT INTO public.community_roadmap_cards (public_title, public_body, lane, status, sort_order, shipped_at)
  VALUES (v_title, NULLIF(left(btrim(COALESCE(p_body, '')), 2000), ''), 'shipped', 'draft', v_sort, NULL)
  RETURNING id INTO v_id;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, 'draft_roadmap_card', 'community_roadmap_card', v_id,
          jsonb_build_object('source', 'issue_3980_bridge_d', 'issue', p_issue, 'lane', 'shipped', 'status', 'draft'));
  RETURN v_id;
END;
$$;

-- B6: the lane GitHub suggests for linked roadmap cards (all, or one).
-- Stored only when it differs from the card's lane and from a lane a person
-- dismissed. Nothing here writes the card.
CREATE FUNCTION public.ops_roadmap_suggest(p_card_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE r record; v_lane text; v_reason text; v_done date; v_n integer := 0;
BEGIN
  FOR r IN SELECT l.card_id, l.issue_number, l.suggested_lane, l.suggested_reason, l.dismissed_lane, rc.lane AS card_lane, rc.status AS card_status,
                  g.number AS g_number, g.kind AS g_kind, g.synced_at, g.not_found, g.board_status, g.board_horizon
             FROM public.ops_roadmap_links l
             JOIN public.community_roadmap_cards rc ON rc.id = l.card_id
             LEFT JOIN public.ops_github_items g ON g.number = l.issue_number
            WHERE p_card_id IS NULL OR l.card_id = p_card_id
            ORDER BY l.card_id FOR UPDATE OF l LOOP
    v_lane := NULL; v_reason := NULL;
    IF r.g_number IS NULL OR r.synced_at IS NULL OR r.not_found OR r.g_kind <> 'issue' OR r.card_status = 'archived' THEN
      v_lane := NULL;
    ELSIF public.ops_github_live(r.issue_number) THEN
      SELECT (x.completed_at AT TIME ZONE 'UTC')::date INTO v_done FROM public.ops_release_records x
       WHERE x.issues @> jsonb_build_array(jsonb_build_object('number', r.issue_number)) AND x.complete
       ORDER BY x.merged_at DESC, x.pr DESC LIMIT 1;
      v_lane := 'shipped'; v_reason := 'Live on ' || public.ops_day_words(COALESCE(v_done, (now() AT TIME ZONE 'UTC')::date));
    ELSIF r.board_status IN ('In Progress', 'In Review') THEN
      v_lane := 'now'; v_reason := 'GitHub: ' || r.board_status;
    ELSIF r.board_horizon = 'Now' THEN
      v_lane := 'now'; v_reason := 'GitHub: Horizon Now';
    ELSIF r.board_horizon = 'Next' THEN
      v_lane := 'next'; v_reason := 'GitHub: Horizon Next';
    ELSIF r.board_horizon = 'Later' THEN
      v_lane := 'later'; v_reason := 'GitHub: Horizon Later';
    ELSE
      v_lane := 'later'; v_reason := 'GitHub: no horizon';
    END IF;
    IF v_lane IS NULL OR v_lane = r.card_lane OR v_lane IS NOT DISTINCT FROM r.dismissed_lane THEN
      IF r.suggested_lane IS NOT NULL THEN
        UPDATE public.ops_roadmap_links SET suggested_lane = NULL, suggested_reason = NULL, suggested_at = NULL WHERE card_id = r.card_id;
      END IF;
    ELSIF v_lane IS DISTINCT FROM r.suggested_lane OR v_reason IS DISTINCT FROM r.suggested_reason THEN
      UPDATE public.ops_roadmap_links SET suggested_lane = v_lane, suggested_reason = v_reason, suggested_at = now() WHERE card_id = r.card_id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- The GitHub bridges, in this order: B5 (Bridge E) unblocks cards that wait
-- for GitHub, B6 stores roadmap lane suggestions, B4 (Bridge D) drafts
-- "Recently shipped" cards with their approval cards, and then approval
-- cards close themselves once a person published or archived their draft.
-- Run by ops_github_items_apply after each batch GitHub answered and by
-- ops_reconcile (housekeeping). Each card and each issue has its own block,
-- as do the suggestions, so one failure never stops the others. Returns the
-- counts: unblocked, suggested, drafted, approvals_closed.
CREATE FUNCTION public.ops_github_bridges() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid;
  v_list text; v_cnt integer; v_unblocked integer := 0; v_suggested integer := 0; v_drafted integer := 0; v_closed integer := 0;
  v_issue integer; v_rc_title text; v_rc_body text; v_cap_title text; v_cap_outcome text; v_title text; v_body text; v_draft uuid; v_res jsonb; v_boss text := public.ops_owner_email();
  v_words text; l record;
BEGIN
  -- B5 (Bridge E): a card waiting for GitHub unblocks when every linked
  -- issue or pull request is Live. Its status does not change.
  FOR c IN SELECT w.* FROM public.ops_work_cards w
            WHERE w.status <> 'done' AND w.archived_at IS NULL AND w.blocked AND w.blocked_kind = 'github'
              AND EXISTS (SELECT 1 FROM public.ops_work_github g WHERE g.card_id = w.id)
              AND NOT EXISTS (SELECT 1 FROM public.ops_work_github g WHERE g.card_id = w.id AND NOT public.ops_github_live(g.number))
            ORDER BY w.number LOOP
    BEGIN
      SELECT string_agg('#' || g.number, ', ' ORDER BY g.number), count(*) INTO v_list, v_cnt FROM public.ops_work_github g WHERE g.card_id = c.id;
      v_words := format('%s %s Live', v_list, CASE WHEN v_cnt > 1 THEN 'are' ELSE 'is' END);
      v_before := public.ops_card_snapshot(c.id);
      UPDATE public.ops_work_cards w SET blocked = false, blocked_kind = NULL, blocked_reason = NULL,
             revision = revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
       WHERE w.id = c.id AND w.blocked_kind = 'github' RETURNING w.* INTO n;
      CONTINUE WHEN n.id IS NULL;
      v_event := public.ops_card_event(c.id, c_actor, 'system', 'unblocked', format('Unblocked: %s.', v_words), v_before,
        public.ops_card_snapshot(c.id), c.revision, n.revision);
      PERFORM public.ops_log_write(c_actor, 'system', 'unblocked', 'info', c.id, 'work_card', c.id,
        format('Card %s unblocked: %s.', n.number, v_words), jsonb_build_object('github', v_list));
      PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), c_actor,
        format('%s. "%s" can go ahead.', v_words, n.title));
      v_unblocked := v_unblocked + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_github_bridges: unblocking card % stopped (% %)', c.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- B6: roadmap stage suggestions.
  BEGIN
    v_suggested := public.ops_roadmap_suggest(NULL);
  EXCEPTION WHEN others THEN RAISE WARNING 'ops_github_bridges: roadmap suggestions stopped (% %)', SQLSTATE, SQLERRM;
  END;

  -- B4 (Bridge D): an issue linked to a roadmap card, or named by a complete
  -- record that ships Feature Guide entries, that is Live gets one drafted
  -- "Recently shipped" card and one person card to approve it. Once per
  -- issue, ever: the audit row of an earlier draft stops another. Two runs
  -- at once (the 5-minute sync and housekeeping) queue on a lock per issue,
  -- and the second one looks for the first one's draft again after it.
  FOR v_issue IN SELECT DISTINCT x.n FROM (
                   SELECT l2.issue_number AS n FROM public.ops_roadmap_links l2
                   UNION
                   SELECT (i->>'number')::integer FROM public.ops_release_records r, jsonb_array_elements(r.issues) i
                    WHERE r.complete AND cardinality(COALESCE(r.feature_guide, ARRAY[]::text[])) > 0) x
                  WHERE NOT EXISTS (SELECT 1 FROM public.community_audit_log a
                                     WHERE a.action = 'draft_roadmap_card' AND a.metadata->>'source' = 'issue_3980_bridge_d'
                                       AND a.metadata->>'issue' = x.n::text)
                  ORDER BY x.n LOOP
    BEGIN
      CONTINUE WHEN NOT public.ops_github_live(v_issue);
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ops_roadmap_shipped'), v_issue);
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.community_audit_log a
                             WHERE a.action = 'draft_roadmap_card' AND a.metadata->>'source' = 'issue_3980_bridge_d'
                               AND a.metadata->>'issue' = v_issue::text);
      v_rc_title := NULL; v_rc_body := NULL; v_cap_title := NULL; v_cap_outcome := NULL;
      SELECT rc.public_title, rc.public_body INTO v_rc_title, v_rc_body FROM public.ops_roadmap_links l3
        JOIN public.community_roadmap_cards rc ON rc.id = l3.card_id
       WHERE l3.issue_number = v_issue ORDER BY l3.linked_at, l3.card_id LIMIT 1;
      SELECT pc.title, pc.outcome_summary INTO v_cap_title, v_cap_outcome FROM (
          SELECT r.feature_guide[1] AS k FROM public.ops_release_records r
           WHERE r.complete AND r.issues @> jsonb_build_array(jsonb_build_object('number', v_issue))
             AND cardinality(COALESCE(r.feature_guide, ARRAY[]::text[])) > 0
           ORDER BY r.merged_at DESC, r.pr DESC LIMIT 1) f
        JOIN public.product_capabilities pc ON pc.capability_key = f.k;
      v_title := COALESCE(v_rc_title, v_cap_title);
      CONTINUE WHEN v_title IS NULL;
      v_body := 'Now live: ' || COALESCE(public.ops_first_sentence(v_cap_outcome), public.ops_first_sentence(v_rc_body), v_title || '.');
      v_draft := public.ops_roadmap_draft_add(v_title, v_body, v_issue);
      v_res := public.ops_auto_card_upsert('roadmap_shipped:issue-' || v_issue, jsonb_build_object(
        'title', left(format('Approve "Recently shipped": %s', v_title), 160),
        'instructions', 'Check the wording of the drafted Recently shipped card and publish it, or say it is not needed. Nothing reaches hosts until you publish it. You can also write an announcement from it.',
        'done_means', 'The card is published or marked not needed.',
        'owners', CASE WHEN v_boss IS NOT NULL THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END, 'watchers', '[]'::jsonb,
        'due_on', public.ops_today(NULL) + 2, 'person_reason', 'publish',
        'links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_draft)),
        'github', jsonb_build_array('#' || v_issue)), 'task', NULL);
      IF v_res->>'status' = 'added' THEN v_drafted := v_drafted + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_github_bridges: drafting for issue % stopped (% %)', v_issue, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- The approval card closes itself once a person has published the draft
  -- or archived it as not needed.
  FOR l IN SELECT w.id, rc.status FROM public.ops_work_cards w
             JOIN public.ops_work_links k ON k.card_id = w.id AND k.kind = 'roadmap_card'
             JOIN public.community_roadmap_cards rc ON rc.id = k.target_id
            WHERE w.auto_key LIKE 'roadmap\_shipped:%' AND w.status <> 'done' AND w.archived_at IS NULL
              AND rc.status IN ('published', 'archived') LOOP
    BEGIN
      PERFORM public.ops_auto_card_close(l.id,
        CASE WHEN l.status = 'published' THEN 'A person published the Recently shipped card.' ELSE 'A person marked the Recently shipped card not needed.' END,
        jsonb_build_array(jsonb_build_object('text', 'Checked by Mingla on the Community roadmap.')));
      v_closed := v_closed + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_github_bridges: closing approval card % stopped (% %)', l.id, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('unblocked', v_unblocked, 'suggested', v_suggested, 'drafted', v_drafted, 'approvals_closed', v_closed);
END;
$$;

-- B2 (Bridge B): each complete release record that names Feature Guide
-- entries and was not applied yet. Per entry, the evidence the record
-- proves (D-16) is written and the entry turns Live only when every kind of
-- evidence it requires is then current and verified; otherwise nothing about
-- the entry changes and the record says what is missing. Applied once per
-- record either way. Support teammates are told through one closed card.
CREATE FUNCTION public.ops_release_guide_apply() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c_repo constant text := 'https://github.com/Mingla-LLC/mingla-main/';
  r public.ops_release_records; v_k text; cap public.product_capabilities; v_new jsonb; v_kind text; v_missing text[]; v_results jsonb;
  v_record_url text; v_live_at timestamptz; v_live_url text; v_deploy text; v_test text; v_ev uuid; e jsonb; v_rev integer;
  v_live integer := 0; v_incomplete integer := 0; v_records integer := 0; v_watchers text[]; v_res jsonb; v_boss text := public.ops_owner_email();
BEGIN
  FOR r IN SELECT x.* FROM public.ops_release_records x
            WHERE x.complete AND x.guide_applied_at IS NULL AND cardinality(COALESCE(x.feature_guide, ARRAY[]::text[])) > 0
            ORDER BY x.merged_at, x.pr FOR UPDATE LOOP
    v_results := '[]'::jsonb;
    v_record_url := (SELECT u.value FROM jsonb_each_text(r.comment_urls) u ORDER BY (u.key = 'pr'), u.key LIMIT 1);
    v_live_url := CASE WHEN r.live_check->>'url' ~ '^https://github[.]com/Mingla-LLC/mingla-main/(issues|pull)/[0-9]+#issuecomment-[0-9]+$'
                       THEN r.live_check->>'url' END;
    v_live_at := LEAST(COALESCE(public.ops_try_timestamptz(r.live_check->>'at'), r.completed_at, now()), now());
    SELECT string_agg(d, '; ') INTO v_deploy FROM (
      SELECT w.key || ' READY' AS d FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) w WHERE w.value = 'ready'
      UNION ALL SELECT 'edge functions ' || array_to_string(r.edge_functions, ', ') || ' deployed' WHERE r.deploy->>'edge' = 'deployed') z;
    v_test := (SELECT t FROM unnest(r.test_files) WITH ORDINALITY u(t, o) ORDER BY u.o LIMIT 1);
    FOREACH v_k IN ARRAY r.feature_guide LOOP
      SELECT * INTO cap FROM public.product_capabilities pc WHERE pc.capability_key = v_k FOR UPDATE;
      IF NOT FOUND THEN
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'result', 'unknown_key'));
        CONTINUE;
      END IF;
      IF cap.claimed_status = 'retired' THEN
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'retired'));
        CONTINUE;
      END IF;
      -- The evidence this record proves (D-16), never anything it does not.
      v_new := '[]'::jsonb;
      IF v_record_url IS NOT NULL THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'release_record', 'url', v_record_url, 'at', COALESCE(r.completed_at, now()),
          'details', format('Release record of PR #%s (merge %s) is complete.', r.pr, left(r.merge_sha, 9))));
      END IF;
      v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'pull_request', 'url', r.pr_url, 'at', r.merged_at,
        'details', format('PR #%s merged %s UTC.', r.pr, to_char(r.merged_at AT TIME ZONE 'UTC', 'FMDD Mon YYYY HH24:MI'))));
      IF cardinality(r.migrations_added) > 0 AND r.migrations_added <@ r.migrations_applied THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'migration', 'url', r.pr_url || '/files', 'at', r.merged_at,
          'details', format('Migrations %s are in the production ledger.', array_to_string(r.migrations_added, ', '))));
      END IF;
      IF v_deploy IS NOT NULL THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'deployment', 'url', c_repo || 'commit/' || r.merge_sha, 'at', r.merged_at,
          'details', format('Deployed: %s.', v_deploy)));
      END IF;
      IF v_live_url IS NOT NULL THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'live_check', 'url', v_live_url, 'at', v_live_at,
          'expires_at', v_live_at + interval '90 days',
          'details', left(format('Live check by @%s: %s', COALESCE(NULLIF(r.live_check->>'by_login', ''), 'a teammate'),
                                 COALESCE(NULLIF(btrim(r.live_check->>'text'), ''), 'checked in production.')), 2000)));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.product_capability_evidence pe WHERE pe.capability_id = cap.id AND pe.evidence_kind = 'source'
                        AND pe.is_current AND pe.verdict = 'verified' AND (pe.expires_at IS NULL OR pe.expires_at > now())) THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'source', 'url', c_repo || 'commit/' || r.merge_sha, 'at', r.merged_at,
          'details', format('Merge commit of PR #%s.', r.pr)));
      END IF;
      IF 'test' = ANY (cap.required_evidence_kinds) AND v_test IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.product_capability_evidence pe WHERE pe.capability_id = cap.id AND pe.evidence_kind = 'test'
                            AND pe.is_current AND pe.verdict = 'verified' AND (pe.expires_at IS NULL OR pe.expires_at > now())) THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'test', 'url', c_repo || 'blob/' || r.merge_sha || '/' || v_test, 'at', r.merged_at,
          'details', left(format('Test changed by PR #%s: %s', r.pr, v_test), 2000)));
      END IF;
      -- Would every required kind be current and verified, with nothing in
      -- conflict or expired, once this evidence is written?
      v_missing := ARRAY(
        SELECT 'no ' || replace(req.kind, '_', ' ') || ' evidence' FROM unnest(cap.required_evidence_kinds) WITH ORDINALITY req(kind, o)
         WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) nw WHERE nw->>'kind' = req.kind
                              AND (nw->>'expires_at' IS NULL OR (nw->>'expires_at')::timestamptz > now()))
           AND NOT EXISTS (SELECT 1 FROM public.product_capability_evidence pe WHERE pe.capability_id = cap.id AND pe.evidence_kind = req.kind
                              AND pe.is_current AND pe.verdict = 'verified' AND (pe.expires_at IS NULL OR pe.expires_at > now()))
         ORDER BY req.o)
        || ARRAY(
        SELECT replace(pe.evidence_kind, '_', ' ') || ' evidence is ' || CASE WHEN pe.verdict = 'conflict' THEN 'in conflict' ELSE 'out of date' END
          FROM public.product_capability_evidence pe
         WHERE pe.capability_id = cap.id AND pe.is_current AND (pe.verdict = 'conflict' OR (pe.expires_at IS NOT NULL AND pe.expires_at <= now()))
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) nw WHERE nw->>'kind' = pe.evidence_kind)
         ORDER BY pe.evidence_kind);
      IF cardinality(v_missing) > 0 THEN
        -- Nothing about the entry changes; the record says what is missing.
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'incomplete',
          'status', cap.claimed_status, 'missing', to_jsonb(v_missing)));
        PERFORM public.ops_log_write(c_actor, 'system', 'guide_incomplete', 'info', NULL, 'release', NULL,
          format('%s stays %s: %s (PR #%s).', cap.title, initcap(cap.claimed_status), array_to_string(v_missing, ', '), r.pr),
          jsonb_build_object('pr', r.pr, 'key', v_k, 'missing', to_jsonb(v_missing)));
        v_incomplete := v_incomplete + 1;
        CONTINUE;
      END IF;
      FOR e IN SELECT x FROM jsonb_array_elements(v_new) x LOOP
        v_kind := e->>'kind';
        UPDATE public.product_capability_evidence pe SET is_current = false
         WHERE pe.capability_id = cap.id AND pe.evidence_kind = v_kind AND pe.is_current;
        INSERT INTO public.product_capability_evidence (capability_id, evidence_kind, evidence_url, verdict, details, observed_at, expires_at, recorded_by)
        VALUES (cap.id, v_kind, e->>'url', 'verified', e->>'details', (e->>'at')::timestamptz, (e->>'expires_at')::timestamptz, NULL)
        RETURNING id INTO v_ev;
        INSERT INTO public.product_truth_audit (actor_user_id, action, capability_id, evidence_id, metadata)
        VALUES (NULL, 'evidence_recorded', cap.id, v_ev, jsonb_build_object('source', 'issue_3980_bridge_b', 'pr', r.pr,
          'evidence_kind', v_kind, 'verdict', 'verified'));
      END LOOP;
      UPDATE public.product_capabilities pc SET claimed_status = 'live', verification_due_at = now() + interval '90 days',
             last_verified_at = now(), revision = pc.revision + 1, updated_at = now()
       WHERE pc.id = cap.id RETURNING pc.revision INTO v_rev;
      INSERT INTO public.product_truth_audit (actor_user_id, action, capability_id, metadata)
      VALUES (NULL, 'capability_saved', cap.id, jsonb_build_object('source', 'issue_3980_bridge_b', 'pr', r.pr, 'revision', v_rev,
        'claimed_status', 'live'));
      PERFORM public.ops_log_write(c_actor, 'system', 'guide_live', 'ok', NULL, 'release', NULL,
        format('%s is Live in the Feature Guide (PR #%s).', cap.title, r.pr), jsonb_build_object('pr', r.pr, 'key', v_k));
      v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'live',
        'evidence', (SELECT jsonb_agg(x->>'kind') FROM jsonb_array_elements(v_new) x)));
      v_live := v_live + 1;
      -- Support is told by the one notice producer: a system card for the
      -- owner, watched by every Support teammate, made and closed at once.
      BEGIN
        v_watchers := ARRAY(SELECT d.email FROM public.admin_team_directory() d
                              JOIN auth.users u ON lower(btrim(u.email)) = d.email
                             WHERE d.status = 'active' AND d.email IS DISTINCT FROM v_boss AND public.is_support_staff(u.id)
                             GROUP BY d.email ORDER BY d.email LIMIT 10);
        v_res := public.ops_auto_card_upsert(format('guide_live:%s:pr-%s', v_k, r.pr), jsonb_build_object(
          'title', left(format('Feature Guide: %s is Live', cap.title), 160),
          'instructions', left(format('%s turned Live in the Feature Guide from the release record of PR #%s. When a host asks, answer with the entry''s support wording.', cap.title, r.pr), 4000),
          'done_means', 'Support knows the entry is Live.',
          'owners', CASE WHEN v_boss IS NOT NULL THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END,
          'watchers', to_jsonb(v_watchers), 'due_on', public.ops_today(NULL)), 'task', NULL);
        IF v_res->>'status' = 'added' THEN
          PERFORM public.ops_auto_card_close((v_res->>'id')::uuid, format('%s is Live in the Feature Guide.', cap.title),
            jsonb_build_array(jsonb_build_object('text', 'Release record: ' || COALESCE(v_record_url, r.pr_url))));
        END IF;
      EXCEPTION WHEN others THEN RAISE WARNING 'ops_release_guide_apply: telling Support about % stopped (% %)', v_k, SQLSTATE, SQLERRM;
      END;
    END LOOP;
    UPDATE public.ops_release_records x SET guide_applied_at = now(), guide_result = jsonb_build_object('keys', v_results), updated_at = now()
     WHERE x.pr = r.pr;
    v_records := v_records + 1;
  END LOOP;
  RETURN jsonb_build_object('records', v_records, 'live', v_live, 'incomplete', v_incomplete);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Bridge A, for the 5-minute sync (service role only).
-- ---------------------------------------------------------------------------

-- The numbers to read from GitHub now: links on Work cards (open, or closed
-- in the last 30 days), roadmap links, issues of release records merged in
-- the last 60 days and issues linked from the Product Inbox. Numbers not
-- seen before get a placeholder ("Checking GitHub"). Never read first, then
-- the longest unread.
CREATE FUNCTION public.ops_github_follow_list(p_limit integer DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200); v_out jsonb;
BEGIN
  PERFORM public.ops_service_only();
  INSERT INTO public.ops_github_items (number, kind)
  SELECT f.number, (array_agg(f.kind ORDER BY (f.kind = 'pull') DESC))[1]
    FROM (SELECT g.number, g.kind FROM public.ops_work_github g JOIN public.ops_work_cards w ON w.id = g.card_id
           WHERE w.archived_at IS NULL AND (w.status <> 'done' OR w.closed_at > now() - interval '30 days')
          UNION ALL SELECT l.issue_number, 'issue' FROM public.ops_roadmap_links l
          UNION ALL SELECT (i->>'number')::integer, 'issue' FROM public.ops_release_records r, jsonb_array_elements(r.issues) i
                     WHERE r.merged_at > now() - interval '60 days'
          UNION ALL SELECT a.issue_number, 'issue' FROM public.product_avengers_items a) f
   WHERE f.number BETWEEN 1 AND 9999999
   GROUP BY f.number
  ON CONFLICT (number) DO NOTHING;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('number', x.number, 'kind_hint', x.kind) ORDER BY x.never DESC, x.synced_at NULLS FIRST, x.number), '[]'::jsonb)
    INTO v_out
    FROM (SELECT gi.number, gi.kind, gi.synced_at, gi.synced_at IS NULL AS never FROM public.ops_github_items gi
           WHERE gi.number IN (
             SELECT g.number FROM public.ops_work_github g JOIN public.ops_work_cards w ON w.id = g.card_id
              WHERE w.archived_at IS NULL AND (w.status <> 'done' OR w.closed_at > now() - interval '30 days')
             UNION SELECT l.issue_number FROM public.ops_roadmap_links l
             UNION SELECT (i->>'number')::integer FROM public.ops_release_records r, jsonb_array_elements(r.issues) i
                    WHERE r.merged_at > now() - interval '60 days'
             UNION SELECT a.issue_number FROM public.product_avengers_items a)
           ORDER BY gi.synced_at IS NULL DESC, gi.synced_at NULLS FIRST, gi.number
           LIMIT v_limit) x;
  RETURN v_out;
END;
$$;

-- What GitHub said about followed numbers, at most 200 items. Only numbers
-- Mingla follows (rows of ops_github_items) are taken; a malformed item (no
-- number, no "found", or a kind that is neither issue nor pull) is skipped
-- and nothing Mingla knew about it is cleared. A number GitHub does not have
-- is marked "Not on GitHub". Otherwise the title is cleaned, the address is
-- built here from the number (GitHub's own url is never stored), board
-- fields and times are taken only when they are valid, and a link saved as
-- an issue that GitHub says is a pull request is corrected. Status changes
-- of numbers read before are logged. Then the bridges run once for the
-- batch; a bridge failure is a warning and never undoes what was applied.
CREATE FUNCTION public.ops_github_items_apply(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i jsonb; g public.ops_github_items; v_n integer; v_kind text; v_state text; v_url text; v_old text; v_new text;
  v_applied integer := 0; v_skipped integer := 0; v_changed integer[] := ARRAY[]::integer[]; v_bridges jsonb;
BEGIN
  PERFORM public.ops_service_only();
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'invalid_items: Send a list of at most 200 GitHub items.' USING ERRCODE = '22023';
  END IF;
  FOR i IN SELECT e FROM jsonb_array_elements(p_items) e LOOP
    -- An item without a number or without "found" is malformed: skipped,
    -- and nothing Mingla knew about that number is cleared.
    IF jsonb_typeof(i) IS DISTINCT FROM 'object' OR jsonb_typeof(i->'number') IS DISTINCT FROM 'number'
       OR (i->>'number') !~ '^[0-9]{1,7}$' OR (i->>'number') IS NULL
       OR jsonb_typeof(i->'found') IS DISTINCT FROM 'boolean' THEN
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
      UPDATE public.ops_github_items x SET kind = v_kind,
             title = NULLIF(left(btrim(regexp_replace(COALESCE(i->>'title', ''), '[[:cntrl:]]', ' ', 'g')), 300), ''),
             url = v_url, state = v_state,
             board_status = CASE WHEN i->>'board_status' IN ('Todo','In Progress','In Review','Done') THEN i->>'board_status' END,
             board_horizon = CASE WHEN i->>'board_horizon' IN ('Now','Next','Later') THEN i->>'board_horizon' END,
             merged_at = public.ops_try_timestamptz(i->>'merged_at'),
             merge_sha = CASE WHEN i->>'merge_sha' ~ '^[0-9a-f]{40}$' THEN i->>'merge_sha' END,
             closing_issues = ARRAY(SELECT (c #>> '{}')::integer FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i->'closing_issues') = 'array'
                                      THEN i->'closing_issues' ELSE '[]'::jsonb END) WITH ORDINALITY t(c, o)
                                     WHERE t.o <= 10 AND jsonb_typeof(c) = 'number' AND (c #>> '{}') ~ '^[0-9]{1,7}$' ORDER BY t.o),
             github_updated_at = public.ops_try_timestamptz(i->>'updated_at'),
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

-- ---------------------------------------------------------------------------
-- 5. Replaced functions.
-- ---------------------------------------------------------------------------


-- From 20271124003980. Keeps the test files the PR changed, and runs Bridge
-- B when a record becomes complete; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.ops_release_records_ingest(p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i jsonb; d jsonb; v_ingested integer := 0; v_invalid integer := 0; v_completed integer[] := ARRAY[]::integer[]; v_pr integer;
  v_was boolean; v_new boolean; v_url text; v_slot text; v_ok boolean;
  v_tests text[]; -- #3980 synced, Wave 2: the test files the PR changed
BEGIN
  PERFORM public.ops_service_only();
  IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) > 100 THEN
    RAISE EXCEPTION 'invalid_records: Send a list of at most 100 release records.' USING ERRCODE = '22023';
  END IF;
  FOR i IN SELECT e FROM jsonb_array_elements(p_records) e LOOP
    d := CASE WHEN jsonb_typeof(i) = 'object' THEN i->'data' END;
    v_ok := d IS NOT NULL AND jsonb_typeof(d) = 'object'
      AND d->>'v' = '1' AND d->>'repo' = 'Mingla-LLC/mingla-main'
      AND jsonb_typeof(d->'pr') = 'number' AND (d->>'pr') ~ '^[0-9]{1,7}$'
      AND jsonb_typeof(d->'title') = 'string' AND char_length(d->>'title') BETWEEN 1 AND 300
      AND d->>'pr_url' ~ '^https://github[.]com/Mingla-LLC/mingla-main/pull/[0-9]+$'
      AND d->>'pr_url' = 'https://github.com/Mingla-LLC/mingla-main/pull/' || (d->>'pr')
      AND jsonb_typeof(d->'merged_at') = 'string' AND d->>'merged_at' ~ '^\d{4}-\d{2}-\d{2}T'
      AND d->>'merge_sha' ~ '^[0-9a-f]{40}$'
      AND jsonb_typeof(d->'issues') = 'array' AND jsonb_array_length(d->'issues') <= 10
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'issues') x
                       WHERE jsonb_typeof(x) <> 'object' OR jsonb_typeof(x->'number') <> 'number' OR (x->>'number') !~ '^[0-9]{1,7}$'
                          OR x->>'relation' NOT IN ('toward','fixes'))
      AND jsonb_typeof(d->'migrations_added') = 'array'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'migrations_added') x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' !~ '^[0-9]{14}$')
      AND jsonb_typeof(d->'edge_functions') = 'array'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'edge_functions') x WHERE jsonb_typeof(x) <> 'string' OR char_length(x #>> '{}') > 80)
      AND jsonb_typeof(d->'web_projects') = 'array'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'web_projects') x
                       WHERE NOT (x #>> '{}') = ANY (ARRAY['mingla-admin','mingla-business','mingla-marketing','mingla-site-cms','mingla-sites']))
      AND jsonb_typeof(d->'deploy_marker') = 'boolean'
      AND jsonb_typeof(d->'deploy') = 'object'
      AND (d->'feature_guide' IS NULL OR jsonb_typeof(d->'feature_guide') IN ('array','null'))
      AND (jsonb_typeof(d->'feature_guide') IS DISTINCT FROM 'array' OR (jsonb_array_length(d->'feature_guide') <= 20
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'feature_guide') x WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')))
      AND (d->'live_check' IS NULL OR jsonb_typeof(d->'live_check') IN ('object','null'))
      AND jsonb_typeof(d->'problems') = 'array';
    IF NOT v_ok THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    BEGIN
      v_pr := (d->>'pr')::integer;
      -- Wave 2: test files the PR changed (Bridge B cites the first one).
      v_tests := ARRAY(SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d->'test_files') = 'array' THEN d->'test_files' ELSE '[]'::jsonb END)
                                     WITH ORDINALITY t(x, o)
                        WHERE t.o <= 50 AND char_length(x) <= 300 AND x ~ '^[A-Za-z0-9._/@+-]+$' AND x !~ '(^|/)[.][.](/|$)' ORDER BY t.o);
      v_url := CASE WHEN jsonb_typeof(i->'comment_url') = 'string'
                         AND i->>'comment_url' ~ '^https://github[.]com/Mingla-LLC/mingla-main/(issues|pull)/[0-9]+#issuecomment-[0-9]+$'
                    THEN i->>'comment_url' END;
      v_slot := CASE WHEN jsonb_typeof(i->'issue_number') = 'number' AND (i->>'issue_number') ~ '^[0-9]{1,7}$' AND (i->>'issue_number')::integer <> v_pr
                     THEN i->>'issue_number' ELSE 'pr' END;
      SELECT x.complete INTO v_was FROM public.ops_release_records x WHERE x.pr = v_pr;
      v_new := NOT FOUND;
      INSERT INTO public.ops_release_records AS r (pr, title, pr_url, merged_at, merge_sha, merged_by_login, author_login, issues,
        migrations_added, edge_functions, web_projects, deploy_marker, deploy, feature_guide, live_check, problems, comment_urls, test_files)
      VALUES (v_pr, left(d->>'title', 300), d->>'pr_url', (d->>'merged_at')::timestamptz, d->>'merge_sha',
        NULLIF(left(d->>'merged_by', 39), ''), NULLIF(left(d->>'author', 39), ''), d->'issues',
        ARRAY(SELECT x FROM jsonb_array_elements_text(d->'migrations_added') x ORDER BY x),
        ARRAY(SELECT x FROM jsonb_array_elements_text(d->'edge_functions') x),
        ARRAY(SELECT x FROM jsonb_array_elements_text(d->'web_projects') x),
        (d->>'deploy_marker')::boolean, d->'deploy',
        CASE WHEN jsonb_typeof(d->'feature_guide') = 'array' THEN ARRAY(SELECT x FROM jsonb_array_elements_text(d->'feature_guide') x) END,
        CASE WHEN jsonb_typeof(d->'live_check') = 'object' THEN jsonb_build_object('text', left(d->'live_check'->>'text', 500),
          'by_login', left(d->'live_check'->>'by_login', 39), 'url', left(d->'live_check'->>'url', 300), 'at', d->'live_check'->>'at') END,
        ARRAY(SELECT left(x, 60) FROM jsonb_array_elements_text(d->'problems') x),
        CASE WHEN v_url IS NOT NULL THEN jsonb_build_object(v_slot, v_url) ELSE '{}'::jsonb END, v_tests)
      ON CONFLICT (pr) DO UPDATE SET title = EXCLUDED.title, merged_at = EXCLUDED.merged_at, merge_sha = EXCLUDED.merge_sha,
        merged_by_login = EXCLUDED.merged_by_login, author_login = EXCLUDED.author_login, issues = EXCLUDED.issues,
        migrations_added = EXCLUDED.migrations_added, edge_functions = EXCLUDED.edge_functions, web_projects = EXCLUDED.web_projects,
        deploy_marker = EXCLUDED.deploy_marker, deploy = EXCLUDED.deploy, feature_guide = EXCLUDED.feature_guide,
        live_check = EXCLUDED.live_check, problems = EXCLUDED.problems,
        comment_urls = r.comment_urls || EXCLUDED.comment_urls, test_files = EXCLUDED.test_files, updated_at = now();
      IF v_new THEN
        PERFORM public.ops_log_write('system@usemingla.com', 'system', 'release_record', 'info', NULL, 'release', NULL,
          format('Release record of PR #%s read from GitHub: %s', v_pr, left(d->>'title', 200)), jsonb_build_object('pr', v_pr));
      END IF;
      IF public.ops_release_recompute(v_pr) AND NOT COALESCE(v_was, false) THEN
        v_completed := v_completed || v_pr;
      END IF;
      v_ingested := v_ingested + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'ops_release_records_ingest: record skipped (% %)', SQLSTATE, SQLERRM;
      v_invalid := v_invalid + 1;
    END;
  END LOOP;
  -- Wave 2 (Bridge B): a record that just became complete turns the
  -- Feature Guide entries it names Live, when their evidence is complete.
  IF cardinality(v_completed) > 0 THEN
    BEGIN
      PERFORM public.ops_release_guide_apply();
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_release_records_ingest: Feature Guide step stopped (% %)', SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('ingested', v_ingested, 'invalid', v_invalid, 'completed', to_jsonb(v_completed));
END;
$$;


-- From 20271124003980. Takes blocked_on_github: the card waits until every
-- linked issue or pull request is Live (Bridge E lifts it). A person can
-- lift the wait; an agent cannot. Everything else is unchanged.
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
                   'blocked','blocked_reason','status','person_reason','reason','github','blocked_on_github') ORDER BY k LIMIT 1;
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
  n.status := v_status; n.person_reason := v_reason;
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


-- From 20271124003980. Adds Bridge B and the GitHub bridges, each in its
-- own step that never stops the others.
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
                            'engineering_cards', v_eng, 'github_bridges', v_bridges, 'feature_guide', v_guide);
END;

$$;


-- ---------------------------------------------------------------------------
-- 6. New client functions. Each checks who is calling itself and never takes
-- the caller as an argument.
-- ---------------------------------------------------------------------------

-- Status chips for up to 50 GitHub numbers, for anyone on the pipelines,
-- Support or an admin. Reading never adds a number to what Mingla follows.
CREATE FUNCTION public.ops_github_status_list(p_numbers integer[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (COALESCE(public.admin_team_can('crm'), false) OR COALESCE(public.is_support_staff(auth.uid()), false)
                                OR COALESCE(public.is_admin_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: Your account cannot read engineering status. Ask the owner for team access.' USING ERRCODE = '42501';
  END IF;
  IF p_numbers IS NULL OR cardinality(p_numbers) > 50 OR EXISTS (SELECT 1 FROM unnest(p_numbers) n WHERE n IS NULL OR n NOT BETWEEN 1 AND 9999999) THEN
    RAISE EXCEPTION 'invalid_numbers: Send up to 50 GitHub issue or pull request numbers.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('items', COALESCE((SELECT jsonb_agg(public.ops_github_status(x.n) ORDER BY x.o)
                                                 FROM (SELECT DISTINCT ON (n) n, o FROM unnest(p_numbers) WITH ORDINALITY u(n, o) ORDER BY n, o) x), '[]'::jsonb));
END;
$$;

-- B3 (Bridge C): the engineering status of a support ticket or staff thread,
-- through its Product Inbox signal and that signal's Avengers issue. Support
-- and admins only.
CREATE FUNCTION public.ops_ticket_engineering(p_source_kind text, p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_issue integer; v_title text; v_url text; v_board text; v_updated timestamptz; v_status jsonb; v_label text; v_rec jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (COALESCE(public.is_support_staff(auth.uid()), false) OR COALESCE(public.is_admin_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: Only Support and admins can read a ticket''s engineering status.' USING ERRCODE = '42501';
  END IF;
  IF p_source_kind IS NULL OR p_source_kind NOT IN ('support_ticket', 'internal_thread') OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'invalid_source: Name a support ticket or a staff thread.' USING ERRCODE = '22023';
  END IF;
  SELECT a.issue_number, a.issue_title, a.issue_url, a.board_status, a.issue_updated_at
    INTO v_issue, v_title, v_url, v_board, v_updated
    FROM public.support_product_signal_sources s
    JOIN public.product_signal_avengers_links l ON l.signal_id = s.signal_id
    JOIN public.product_avengers_items a ON a.id = l.item_id
   WHERE s.source_kind = p_source_kind AND s.source_id = p_source_id
   LIMIT 1;
  IF v_issue IS NULL THEN RETURN jsonb_build_object('linked', false); END IF;
  -- Once the bridge has read the issue, its word wins, "Not on GitHub"
  -- included: the Product Inbox's board word is only a stand-in before that.
  IF EXISTS (SELECT 1 FROM public.ops_github_items g WHERE g.number = v_issue AND g.synced_at IS NOT NULL) THEN
    v_status := public.ops_github_status(v_issue);
    v_label := v_status->>'label';
    v_board := CASE WHEN (v_status->>'not_found')::boolean THEN NULL ELSE COALESCE(v_status->>'board_status', v_board) END;
    v_title := COALESCE(v_status->>'title', v_title);
    SELECT COALESCE(g.github_updated_at, g.synced_at) INTO v_updated FROM public.ops_github_items g WHERE g.number = v_issue;
  ELSE
    v_label := CASE v_board WHEN 'Done' THEN 'Shipped' WHEN 'In Review' THEN 'In Review' WHEN 'In Progress' THEN 'In Progress' ELSE 'Planned' END;
  END IF;
  SELECT jsonb_build_object('pr', r.pr, 'complete', r.complete, 'url', r.pr_url) INTO v_rec FROM public.ops_release_records r
   WHERE r.issues @> jsonb_build_array(jsonb_build_object('number', v_issue)) ORDER BY r.merged_at DESC, r.pr DESC LIMIT 1;
  RETURN jsonb_build_object('linked', true,
    'issue', jsonb_build_object('number', v_issue, 'url', COALESCE(v_url, 'https://github.com/Mingla-LLC/mingla-main/issues/' || v_issue), 'title', v_title),
    'label', v_label, 'live', v_label = 'Live', 'board_status', v_board, 'updated_at', v_updated, 'record', v_rec);
END;
$$;

-- Every roadmap card with its GitHub issue, its status chip and the lane
-- GitHub suggests (only while it differs from the card's lane). Admins only.
CREATE FUNCTION public.ops_roadmap_links_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin manages the roadmap.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('cards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'card_id', rc.id, 'lane', rc.lane, 'status', rc.status,
      'issue', CASE WHEN l.card_id IS NOT NULL THEN public.ops_github_status(l.issue_number) END,
      'suggestion', CASE WHEN l.suggested_lane IS NOT NULL AND l.suggested_lane <> rc.lane
                              AND l.suggested_lane IS DISTINCT FROM l.dismissed_lane
                         THEN jsonb_build_object('lane', l.suggested_lane, 'reason', l.suggested_reason, 'at', l.suggested_at) END,
      'from_github', EXISTS (SELECT 1 FROM public.community_audit_log a WHERE a.action = 'draft_roadmap_card'
                                AND a.entity_id = rc.id AND a.metadata->>'source' = 'issue_3980_bridge_d'))
      ORDER BY rc.sort_order, rc.id)
    FROM public.community_roadmap_cards rc LEFT JOIN public.ops_roadmap_links l ON l.card_id = rc.id), '[]'::jsonb));
END;
$$;

-- An owner or admin links a roadmap card to its GitHub issue, or removes the
-- link (blank). The issue must be an issue of this repository and is linked
-- to one card only.
CREATE FUNCTION public.ops_roadmap_link_set(p_card_id uuid, p_issue text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_parsed jsonb; v_n integer; v_other text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin links roadmap cards to GitHub.' USING ERRCODE = '42501';
  END IF;
  IF p_card_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.community_roadmap_cards rc WHERE rc.id = p_card_id) THEN
    RAISE EXCEPTION 'not_found: That roadmap card does not exist.' USING ERRCODE = 'P0002';
  END IF;
  IF btrim(COALESCE(p_issue, '')) = '' THEN
    DELETE FROM public.ops_roadmap_links l WHERE l.card_id = p_card_id;
    RETURN jsonb_build_object('card_id', p_card_id, 'issue_number', NULL, 'issue', NULL);
  END IF;
  v_parsed := public.ops_github_parse(p_issue);
  IF v_parsed ? 'error' THEN
    RAISE EXCEPTION '%', 'invalid_github_link: ' || (v_parsed->>'error') USING ERRCODE = '22023';
  END IF;
  IF v_parsed->>'kind' = 'pull' THEN
    RAISE EXCEPTION 'not_an_issue: Link the issue, not a pull request.' USING ERRCODE = '22023';
  END IF;
  v_n := (v_parsed->>'number')::integer;
  SELECT rc.public_title INTO v_other FROM public.ops_roadmap_links l JOIN public.community_roadmap_cards rc ON rc.id = l.card_id
   WHERE l.issue_number = v_n AND l.card_id <> p_card_id LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION '%', format('issue_taken: #%s is already linked to "%s".', v_n, left(v_other, 120)) USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.ops_roadmap_links (card_id, issue_number, linked_by)
    VALUES (p_card_id, v_n, v.actor_email)
    ON CONFLICT (card_id) DO UPDATE SET issue_number = EXCLUDED.issue_number, linked_by = EXCLUDED.linked_by, linked_at = now(),
      suggested_lane = NULL, suggested_reason = NULL, suggested_at = NULL, dismissed_lane = NULL, dismissed_at = NULL
      WHERE public.ops_roadmap_links.issue_number IS DISTINCT FROM EXCLUDED.issue_number;
  EXCEPTION WHEN unique_violation THEN
    -- Another card took this issue at the same moment.
    SELECT rc.public_title INTO v_other FROM public.ops_roadmap_links l JOIN public.community_roadmap_cards rc ON rc.id = l.card_id
     WHERE l.issue_number = v_n AND l.card_id <> p_card_id LIMIT 1;
    RAISE EXCEPTION '%', format('issue_taken: #%s is already linked to "%s".', v_n, left(COALESCE(v_other, 'another roadmap card'), 120)) USING ERRCODE = '22023';
  END;
  INSERT INTO public.ops_github_items (number, kind) VALUES (v_n, 'issue') ON CONFLICT (number) DO NOTHING;
  PERFORM public.ops_roadmap_suggest(p_card_id);
  RETURN jsonb_build_object('card_id', p_card_id, 'issue_number', v_n, 'issue', public.ops_github_status(v_n));
END;
$$;

-- An owner or admin decides on GitHub's lane suggestion. Apply returns the
-- lane; the screen then saves the card through the existing roadmap editor
-- (one writer of the lane, one audit row). Dismiss hides this suggestion.
CREATE FUNCTION public.ops_roadmap_suggestion_decide(p_card_id uuid, p_decision text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; l public.ops_roadmap_links; v_lane text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin decides on roadmap suggestions.' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('apply', 'dismiss') THEN
    RAISE EXCEPTION 'invalid_decision: Apply or dismiss the suggestion.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM public.ops_roadmap_links x WHERE x.card_id = p_card_id FOR UPDATE;
  SELECT rc.lane INTO v_lane FROM public.community_roadmap_cards rc WHERE rc.id = p_card_id;
  IF NOT FOUND OR l.card_id IS NULL OR l.suggested_lane IS NULL OR l.suggested_lane = v_lane THEN
    RAISE EXCEPTION 'no_suggestion: There is no GitHub suggestion for this card.' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'apply' THEN
    RETURN jsonb_build_object('card_id', p_card_id, 'decision', 'apply', 'lane', l.suggested_lane);
  END IF;
  UPDATE public.ops_roadmap_links x SET dismissed_lane = l.suggested_lane, dismissed_at = now(),
         suggested_lane = NULL, suggested_reason = NULL, suggested_at = NULL
   WHERE x.card_id = p_card_id;
  RETURN jsonb_build_object('card_id', p_card_id, 'decision', 'dismiss', 'lane', l.suggested_lane);
END;
$$;

-- Release records read back from GitHub, newest first, with what each still
-- misses in plain words.
CREATE FUNCTION public.ops_release_records_list(p_query jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; q jsonb := COALESCE(p_query, '{}'::jsonb); v_bad text; v_issue integer; v_pr integer; v_inc boolean; v_limit integer := 50;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF jsonb_typeof(q) <> 'object' THEN
    RAISE EXCEPTION 'invalid_query: Send an object with issue, pr, incomplete or limit.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(q) k WHERE k NOT IN ('issue', 'pr', 'incomplete', 'limit') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('invalid_query: The list does not take "%s". It takes issue, pr, incomplete and limit.', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  IF q ? 'issue' THEN
    IF jsonb_typeof(q->'issue') <> 'number' OR (q->>'issue') !~ '^[0-9]{1,7}$' THEN
      RAISE EXCEPTION 'invalid_query: issue is an issue number.' USING ERRCODE = '22023'; END IF;
    v_issue := (q->>'issue')::integer;
  END IF;
  IF q ? 'pr' THEN
    IF jsonb_typeof(q->'pr') <> 'number' OR (q->>'pr') !~ '^[0-9]{1,7}$' THEN
      RAISE EXCEPTION 'invalid_query: pr is a pull request number.' USING ERRCODE = '22023'; END IF;
    v_pr := (q->>'pr')::integer;
  END IF;
  IF q ? 'incomplete' THEN
    IF jsonb_typeof(q->'incomplete') <> 'boolean' THEN
      RAISE EXCEPTION 'invalid_query: incomplete is true or false.' USING ERRCODE = '22023'; END IF;
    v_inc := (q->>'incomplete')::boolean;
  END IF;
  IF q ? 'limit' THEN
    IF jsonb_typeof(q->'limit') <> 'number' OR (q->>'limit') !~ '^[0-9]{1,3}$' OR (q->>'limit')::integer NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'invalid_query: limit is 1 to 100.' USING ERRCODE = '22023'; END IF;
    v_limit := (q->>'limit')::integer;
  END IF;
  RETURN jsonb_build_object('records', COALESCE((SELECT jsonb_agg(x.j ORDER BY x.merged_at DESC, x.pr DESC) FROM (
    SELECT r.merged_at, r.pr, jsonb_build_object('pr', r.pr, 'title', r.title, 'pr_url', r.pr_url, 'merged_at', r.merged_at,
      'merge_sha', r.merge_sha, 'merged_by_login', r.merged_by_login, 'issues', r.issues, 'migrations_added', to_jsonb(r.migrations_added),
      'migrations_applied', to_jsonb(r.migrations_applied), 'edge_functions', to_jsonb(r.edge_functions), 'web_projects', to_jsonb(r.web_projects),
      'deploy', r.deploy, 'feature_guide', to_jsonb(r.feature_guide), 'live_check', r.live_check, 'complete', r.complete,
      'completed_at', r.completed_at, 'comment_urls', r.comment_urls, 'guide_result', r.guide_result,
      'problems', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', p, 'words', public.ops_release_problem_words(p)) ORDER BY p)
                              FROM unnest(r.problems) p), '[]'::jsonb)) AS j
      FROM public.ops_release_records r
     WHERE (v_issue IS NULL OR r.issues @> jsonb_build_array(jsonb_build_object('number', v_issue)))
       AND (v_pr IS NULL OR r.pr = v_pr)
       AND (v_inc IS NULL OR r.complete = NOT v_inc)
     ORDER BY r.merged_at DESC, r.pr DESC LIMIT v_limit) x), '[]'::jsonb));
END;
$$;

-- What shipped a Feature Guide entry: the newest complete release record
-- naming it and what Bridge B did with it, and a newer record that is not
-- complete yet with what it misses. Admins and Support.
CREATE FUNCTION public.ops_feature_guide_release(p_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE r public.ops_release_records; p public.ops_release_records; v_record jsonb; v_result jsonb; v_pending jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (COALESCE(public.is_admin_user(), false) OR COALESCE(public.is_support_staff(auth.uid()), false)) THEN
    RAISE EXCEPTION 'forbidden: Only admins and Support read Feature Guide releases.' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR char_length(p_key) > 80 THEN
    RAISE EXCEPTION 'invalid_key: A Feature Guide key is lowercase words joined by hyphens.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.ops_release_records x WHERE x.complete AND x.feature_guide @> ARRAY[p_key]
   ORDER BY x.merged_at DESC, x.pr DESC LIMIT 1;
  IF r.pr IS NOT NULL THEN
    v_record := jsonb_build_object('pr', r.pr, 'title', r.title, 'pr_url', r.pr_url, 'merged_at', r.merged_at, 'completed_at', r.completed_at,
      'comment_url', (SELECT u.value FROM jsonb_each_text(r.comment_urls) u ORDER BY (u.key = 'pr'), u.key LIMIT 1));
    v_result := (SELECT k FROM jsonb_array_elements(COALESCE(r.guide_result->'keys', '[]'::jsonb)) k WHERE k->>'key' = p_key LIMIT 1);
  END IF;
  SELECT * INTO p FROM public.ops_release_records x WHERE NOT x.complete AND x.feature_guide @> ARRAY[p_key]
     AND (r.pr IS NULL OR x.merged_at > r.merged_at)
   ORDER BY x.merged_at DESC, x.pr DESC LIMIT 1;
  IF p.pr IS NOT NULL THEN
    v_pending := jsonb_build_object('pr', p.pr, 'title', p.title, 'pr_url', p.pr_url, 'merged_at', p.merged_at,
      'missing', COALESCE((SELECT jsonb_agg(public.ops_release_problem_words(x) ORDER BY x) FROM unnest(p.problems) x), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('record', v_record, 'result', v_result, 'pending', v_pending);
END;
$$;


-- ---------------------------------------------------------------------------
-- 7. Grants. Internal helpers and bridge functions: service_role only.
-- Client functions: authenticated (each checks the caller) and service_role.
-- Replaced functions keep their grants.
-- ---------------------------------------------------------------------------
DO $grants3980syncw2$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ops_try_timestamptz(text)', 'public.ops_first_sentence(text)', 'public.ops_github_live(integer)',
    'public.ops_roadmap_draft_add(text,text,integer)', 'public.ops_roadmap_suggest(uuid)', 'public.ops_github_bridges()',
    'public.ops_release_guide_apply()', 'public.ops_github_follow_list(integer)', 'public.ops_github_items_apply(jsonb)',
    'public.ops_github_status_list(integer[])', 'public.ops_ticket_engineering(text,uuid)', 'public.ops_roadmap_links_list()',
    'public.ops_roadmap_link_set(uuid,text)', 'public.ops_roadmap_suggestion_decide(uuid,text)', 'public.ops_release_records_list(jsonb)',
    'public.ops_feature_guide_release(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$grants3980syncw2$;
GRANT EXECUTE ON FUNCTION public.ops_github_status_list(integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ticket_engineering(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_roadmap_links_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_roadmap_link_set(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_roadmap_suggestion_decide(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_release_records_list(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_feature_guide_release(text) TO authenticated;
COMMENT ON FUNCTION public.ops_github_items_apply(jsonb) IS
  'Issue #3980. Bridge A: the status GitHub reported for followed issues and pull requests, then Bridges D and E and the roadmap suggestions. Service role only; nothing here writes to GitHub.';
COMMENT ON FUNCTION public.ops_release_guide_apply() IS
  'Issue #3980. Bridge B: a complete release record turns the Feature Guide entries it names Live only when every required kind of evidence is then current and verified; otherwise nothing changes and the record says what is missing.';
COMMENT ON FUNCTION public.ops_roadmap_draft_add(text, text, integer) IS
  'Issue #3980. Bridge D: the only insert this program makes into community_roadmap_cards, always a draft. Hosts see nothing until a person publishes it.';
COMMENT ON FUNCTION public.ops_roadmap_suggestion_decide(uuid, text) IS
  'Issue #3980. A person applies or dismisses the lane GitHub suggests; apply only returns the lane, which the screen saves through community_upsert_roadmap_card.';

-- ---------------------------------------------------------------------------
-- 8. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $w2sync3980$
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
    -- Wave 2
    'ops_github_status_list(integer[])','ops_ticket_engineering(text,uuid)','ops_roadmap_links_list()',
    'ops_roadmap_link_set(uuid,text)','ops_roadmap_suggestion_decide(uuid,text)','ops_release_records_list(jsonb)',
    'ops_feature_guide_release(text)'];
  r record; v_cfg text[];
BEGIN
  FOR r IN SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'ops\_%' AND p.proname <> 'ops_agent_call' LOOP
    SELECT array_agg(x) INTO v_cfg FROM unnest(r.proconfig) x WHERE x LIKE 'search_path=%';
    IF v_cfg IS NULL OR v_cfg[1] !~ ', pg_temp$' THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: % does not pin a search_path ending in pg_temp', r.sig; END IF;
    IF NOT r.prosecdef AND r.provolatile <> 'i' AND r.proname <> 'ops_agent_log_append_only' THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: % is not SECURITY DEFINER', r.sig; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR (SELECT bool_or(a.grantee = 0) FROM pg_catalog.pg_proc p2, aclexplode(COALESCE(p2.proacl, acldefault('f', p2.proowner))) a WHERE p2.oid = r.oid) THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: anon or PUBLIC can run %', r.sig; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') <> (replace(r.sig, 'public.', '') = ANY (c_client)) THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: client grant wrong for %', r.sig; END IF;
    IF r.prosrc ~* '(update|insert\s+into|delete\s+from)\s+public\.crm_' THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: % writes a pipeline table', r.sig; END IF;
    IF r.prosrc ~* '(public\.ad_|ad_plans|ad_campaigns)' THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: % reaches an ad table', r.sig; END IF;
    -- Hosts are told only by a person: one function inserts roadmap drafts,
    -- none updates a roadmap card or writes an announcement.
    IF r.prosrc ~* 'insert\s+into\s+public\.community_roadmap_cards' AND r.proname <> 'ops_roadmap_draft_add' THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: % writes roadmap cards', r.sig; END IF;
    IF r.prosrc ~* '(update|delete\s+from)\s+public\.community_roadmap_cards' OR r.prosrc ~* 'community_announcement' THEN
      RAISE EXCEPTION 'issue 3980 synced W2 self-check: % changes what hosts are told', r.sig; END IF;
  END LOOP;
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = 'public.ops_roadmap_draft_add(text,text,integer)'::regprocedure) ~* 'published' THEN
    RAISE EXCEPTION 'issue 3980 synced W2 self-check: the roadmap draft can be published'; END IF;
  IF (SELECT count(*) FROM unnest(c_client) s WHERE has_function_privilege('authenticated', 'public.' || s, 'EXECUTE')) <> cardinality(c_client) THEN
    RAISE EXCEPTION 'issue 3980 synced W2 self-check: a client function is missing'; END IF;
  IF (SELECT g.is_admin_hash FROM issue3980_sync_w2_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.is_admin_user()'::regprocedure))
     OR (SELECT g.crm_ctx_hash FROM issue3980_sync_w2_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.crm_ctx()'::regprocedure))
     OR (SELECT g.gateway_hash FROM issue3980_sync_w2_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.team_agent_call(text,text,jsonb,text)'::regprocedure))
     OR (SELECT g.roadmap_hash FROM issue3980_sync_w2_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.community_upsert_roadmap_card(uuid,text,text,text,text,text)'::regprocedure))
     OR (SELECT g.evidence_hash FROM issue3980_sync_w2_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.issue_3720_record_feature_evidence(uuid,integer,text,text,text,text,timestamptz,timestamptz)'::regprocedure))
     OR (SELECT g.snapshot_hash FROM issue3980_sync_w2_guard g) IS DISTINCT FROM md5(pg_get_functiondef('public.issue_3720_apply_product_avengers_snapshot(uuid,uuid,text,jsonb)'::regprocedure)) THEN
    RAISE EXCEPTION 'issue 3980 synced W2 self-check: an untouchable function changed'; END IF;
  IF has_column_privilege('authenticated', 'public.community_roadmap_cards', 'internal_note', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ops_github_items', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ops_roadmap_links', 'SELECT') THEN
    RAISE EXCEPTION 'issue 3980 synced W2 self-check: a table opened to clients'; END IF;
END;
$w2sync3980$;

COMMIT;

NOTIFY pgrst, 'reload schema';
