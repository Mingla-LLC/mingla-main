-- Issue #3980, synced program, Wave 4: the opt-in backfills and the Feature
-- Guide text.
--
-- What this adds:
--   * Link roadmap cards to GitHub, in bulk. The owner pastes up to 50
--     "card, issue" pairs; ops_roadmap_links_preview checks each one (the card
--     exists, the issue is an issue of Mingla's repository, it is not linked
--     already, it is not in the list twice) and writes nothing.
--     ops_roadmap_links_confirm checks them again and links only the ready
--     ones through ops_roadmap_link_set, once per request key.
--   * Brands without a host card. ops_brand_cards_preview lists every brand
--     that has no host card and what brand auto-link would do for it: link
--     (exactly one exact match), create (Onboarded, or Live when it has a
--     public listing), pick (several or near matches) or reopen (the match is
--     Lost). It writes nothing. ops_brand_cards_confirm runs brand auto-link
--     (ops_brand_autolink_one, the same decision in ops_brand_match) for the
--     brands the owner chose, once per request key.
--     All four are for the owner, signed in as a person, and nothing in any
--     migration runs them: a backfill happens only when the owner confirms.
--   * Feature Guide text for Needs you, Work, Agent activity, the Calendar,
--     the host and creator pipelines, Team and roles and My agent, written
--     from the production text read on 20 Oct, and a new planned entry,
--     Release records and the synced system. Each saved entry goes up one
--     revision with one audit row; no status changes and no evidence.
--
-- Replaced functions keep their signatures, attributes and grants; each names
-- the migration it was copied from.
--
-- NOT modified: is_admin_user(), team_agent_call, crm_ctx, admin_team_list and
-- the other admin_team_* functions, any issue_3720_* function,
-- community_upsert_roadmap_card, crm_apply_brand_link, crm_record_create_core,
-- ops_roadmap_link_set, ops_brand_autolink_one, any ad_ table.
--
-- ROLLBACK (no down-migration file): roll the admin web client back first,
-- then in one transaction drop the four new functions and the internal
-- helpers, restore ops_agent_log_action_check from 20271124003980, and restore the eight
-- Feature Guide rows from their audit history (the new entry can be deleted
-- while it is planned). Links and host cards made by a confirmed backfill
-- stay as history.

BEGIN;

-- A stuck lock aborts the apply instead of hanging.
SET LOCAL lock_timeout = '10s';

-- Remembered for the self-check at the end: the untouchable functions, and
-- the rows a backfill would change (nothing here may change them).
CREATE TEMP TABLE issue3980_sync_w4_guard ON COMMIT DROP AS
SELECT md5(pg_get_functiondef('public.is_admin_user()'::regprocedure)) AS is_admin_hash,
       md5(pg_get_functiondef('public.crm_ctx()'::regprocedure)) AS crm_ctx_hash,
       md5(pg_get_functiondef('public.team_agent_call(text,text,jsonb,text)'::regprocedure)) AS gateway_hash,
       md5(pg_get_functiondef('public.crm_apply_brand_link(uuid)'::regprocedure)) AS brand_link_hash,
       md5(pg_get_functiondef('public.crm_record_create_core(text,jsonb,text,text)'::regprocedure)) AS create_core_hash,
       md5(pg_get_functiondef('public.community_upsert_roadmap_card(uuid,text,text,text,text,text)'::regprocedure)) AS roadmap_hash,
       md5(pg_get_functiondef('public.ops_roadmap_link_set(uuid,text)'::regprocedure)) AS link_set_hash,
       md5(pg_get_functiondef('public.ops_brand_autolink_one(uuid)'::regprocedure)) AS autolink_hash,
       (SELECT count(*) FROM public.ops_roadmap_links) AS roadmap_links,
       (SELECT count(*) FROM public.crm_records) AS crm_records,
       (SELECT count(*) FROM public.crm_records WHERE brand_id IS NOT NULL) AS crm_branded,
       (SELECT count(*) FROM public.ops_work_cards) AS work_cards;

-- ---------------------------------------------------------------------------
-- 1. The agent log learns one action: an owner's confirmed backfill.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_agent_log DROP CONSTRAINT ops_agent_log_action_check;
ALTER TABLE public.ops_agent_log ADD CONSTRAINT ops_agent_log_action_check CHECK (action IN ('card_added','card_refused','claimed',
  'claim_refused','released','claim_expired','step','started','updated','blocked','unblocked','needs_person','closed','pushed_back',
  'reopened','gate_closed','gate_override','write_stopped','draft_stopped','person_changed_claimed','expected_set','launch_planned',
  'contact_override','converted','archived',
  'took_over','working_cleared','chat_named','auto_added','auto_closed','auto_redated','release_record','guide_live',
  'guide_incomplete','brand_linked','brand_card_added','sprint_moved','setting_changed',
  'backfill_confirmed'));

-- ---------------------------------------------------------------------------
-- 2. P3 backfills. Internal helpers first (service_role only), then the four
-- client functions (owner, signed in as a person).
-- ---------------------------------------------------------------------------

-- Checks a list of {card_id, issue} pairs; writes nothing. Each row is
-- ready, already_linked or invalid, with words saying why. The first of two
-- rows naming the same issue or the same card keeps its own verdict; the
-- second is invalid.
CREATE FUNCTION public.ops_roadmap_links_check(p_links jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  e jsonb; v_rows jsonb := '[]'::jsonb; v_ready integer := 0; v_card uuid; v_title text; v_parsed jsonb; v_n integer;
  v_status text; v_words text; v_have integer; v_other text; v_issue_title text;
  v_seen_issues integer[] := ARRAY[]::integer[]; v_seen_cards uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_links IS NULL OR jsonb_typeof(p_links) <> 'array' OR jsonb_array_length(p_links) = 0 THEN
    RAISE EXCEPTION 'invalid_links: Send at least one roadmap card and its GitHub issue.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_links) > 50 THEN
    RAISE EXCEPTION 'invalid_links: Send at most 50 links at a time.' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x.value FROM jsonb_array_elements(p_links) x LOOP
    v_card := NULL; v_title := NULL; v_n := NULL; v_issue_title := NULL; v_have := NULL; v_other := NULL;
    v_status := 'ready'; v_words := 'Ready to link.';
    IF jsonb_typeof(e) <> 'object' THEN
      v_status := 'invalid'; v_words := 'Each line needs a roadmap card and a GitHub issue.';
    ELSE
      IF public.ops_is_uuid(e->>'card_id') THEN
        v_card := (e->>'card_id')::uuid;
        SELECT rc.public_title INTO v_title FROM public.community_roadmap_cards rc WHERE rc.id = v_card;
      END IF;
      v_parsed := public.ops_github_parse(e->>'issue');
      IF v_title IS NULL THEN
        v_status := 'invalid'; v_words := 'That roadmap card does not exist.';
      ELSIF v_parsed ? 'error' THEN
        v_status := 'invalid'; v_words := v_parsed->>'error';
      ELSE
        v_n := (v_parsed->>'number')::integer;
        SELECT g.title INTO v_issue_title FROM public.ops_github_items g WHERE g.number = v_n;
        IF v_parsed->>'kind' = 'pull' OR EXISTS (SELECT 1 FROM public.ops_github_items g WHERE g.number = v_n AND g.kind = 'pull') THEN
          v_status := 'invalid'; v_words := 'Link the issue, not a pull request.';
        ELSIF v_n = ANY (v_seen_issues) THEN
          v_status := 'invalid'; v_words := format('#%s is in this list twice.', v_n);
        ELSIF v_card = ANY (v_seen_cards) THEN
          v_status := 'invalid'; v_words := 'This card is in this list twice.';
        ELSE
          SELECT l.issue_number INTO v_have FROM public.ops_roadmap_links l WHERE l.card_id = v_card;
          SELECT rc.public_title INTO v_other FROM public.ops_roadmap_links l JOIN public.community_roadmap_cards rc ON rc.id = l.card_id
           WHERE l.issue_number = v_n AND l.card_id <> v_card ORDER BY l.linked_at, l.card_id LIMIT 1;
          IF v_have = v_n THEN
            v_status := 'already_linked'; v_words := format('Already linked to #%s.', v_n);
          ELSIF v_other IS NOT NULL THEN
            v_status := 'already_linked'; v_words := format('#%s is already linked to "%s".', v_n, left(v_other, 120));
          ELSIF v_have IS NOT NULL THEN
            v_status := 'already_linked'; v_words := format('This card is already linked to #%s. Change it on the card.', v_have);
          END IF;
        END IF;
        v_seen_issues := v_seen_issues || v_n;
      END IF;
      IF v_title IS NOT NULL THEN v_seen_cards := v_seen_cards || v_card; END IF;
    END IF;
    IF v_status = 'ready' THEN v_ready := v_ready + 1; END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'card_id', v_card, 'title', v_title, 'issue_number', v_n, 'issue_title', v_issue_title,
      'status', v_status, 'words', v_words));
  END LOOP;
  RETURN jsonb_build_object('rows', v_rows, 'ready', v_ready);
END;
$$;

-- How many brands have no host card. Cheap: no matching is done, so the
-- Team dashboard can show the number without running the preview.
CREATE FUNCTION public.ops_brand_cards_total() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer FROM public.brands br
   WHERE br.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.crm_records h WHERE h.brand_id = br.id AND h.pipeline = 'hosts' AND h.deleted_at IS NULL)
$$;

-- One page of the brands without a host card, newest first, with what brand
-- auto-link would do for each (ops_brand_match). Writes nothing. A page holds
-- at most 100 brands; the totals count every brand without a card, and the
-- actions of this page.
CREATE FUNCTION public.ops_brand_cards_rows(p_offset integer, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_rows jsonb; v_total integer; v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
BEGIN
  v_total := public.ops_brand_cards_total();
  WITH page AS (
    SELECT br.id, br.created_at
      FROM public.brands br
     WHERE br.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.crm_records h WHERE h.brand_id = br.id AND h.pipeline = 'hosts' AND h.deleted_at IS NULL)
     ORDER BY br.created_at DESC, br.id
     OFFSET v_offset LIMIT v_limit
  ), m AS (
    SELECT page.id, page.created_at, public.ops_brand_match(page.id) AS d FROM page
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'brand_id', m.id, 'name', m.d->'brand'->>'name', 'created_at', m.created_at,
      'action', m.d->>'status',
      'record', m.d->'record', 'matched', m.d->>'matched', 'stage', m.d->>'stage', 'candidates', m.d->'candidates',
      'open_card', (SELECT jsonb_build_object('id', k.id, 'title', k.title) FROM public.ops_work_cards k
                     WHERE k.auto_key IN ('brand_pick:' || m.id, 'brand_lost:' || m.id) AND k.status <> 'done' AND k.archived_at IS NULL
                     ORDER BY k.created_at DESC LIMIT 1),
      'words', CASE m.d->>'status'
        WHEN 'link' THEN format('Link to %s: same %s.', m.d->'record'->>'name', m.d->>'matched')
        WHEN 'create' THEN format('Add a host card in %s.', CASE m.d->>'stage' WHEN 'live' THEN 'Live' ELSE 'Onboarded' END)
        WHEN 'reopen' THEN format('%s has the same %s and is Lost. A person decides whether to reopen it.', m.d->'record'->>'name', m.d->>'matched')
        WHEN 'pick' THEN CASE m.d->>'how'
          WHEN 'near' THEN format('Only near matches (%s). A person picks.', m.d->>'names')
          WHEN 'name' THEN 'A host card with this name already exists. A person picks.'
          ELSE format('Several host cards match (%s). A person picks.', m.d->>'names') END
        ELSE 'Nothing to do.' END)
      ORDER BY CASE m.d->>'status' WHEN 'link' THEN 1 WHEN 'create' THEN 2 WHEN 'pick' THEN 3 WHEN 'reopen' THEN 4 ELSE 5 END,
               lower(m.d->'brand'->>'name'), m.id), '[]'::jsonb)
    INTO v_rows FROM m;
  RETURN jsonb_build_object('rows', v_rows, 'totals', jsonb_build_object(
    'total', v_total, 'shown', jsonb_array_length(v_rows),
    'link', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'action' = 'link'),
    'create', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'action' = 'create'),
    'pick', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'action' = 'pick'),
    'reopen', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'action' = 'reopen')),
    'page', jsonb_build_object('offset', v_offset, 'limit', v_limit,
                               'more', v_offset + jsonb_array_length(v_rows) < v_total));
END;
$$;

-- The first page.
CREATE FUNCTION public.ops_brand_cards_rows() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$ SELECT public.ops_brand_cards_rows(0, 50) $$;

-- P3: the owner previews links between roadmap cards and GitHub issues.
-- Writes nothing.
CREATE FUNCTION public.ops_roadmap_links_preview(p_links jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.ops_owner_person_only('Only the owner links roadmap cards to GitHub in bulk.');
  RETURN public.ops_roadmap_links_check(p_links);
END;
$$;

-- P3: the owner confirms. Every pair is checked again; only the ready ones
-- are linked, each through ops_roadmap_link_set. The same request key
-- returns the first answer and links nothing again.
CREATE FUNCTION public.ops_roadmap_links_confirm(p_links jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_replay jsonb; v_check jsonb; r jsonb; v_linked integer := 0; v_skipped integer := 0;
  v_results jsonb := '[]'::jsonb; v_out jsonb; v_msg text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_owner_person_only('Only the owner links roadmap cards to GitHub in bulk.');
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 90 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'roadmap_links', p_links);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  -- The listed cards are locked, in id order, before they are checked again.
  -- A confirm racing this one on the same card waits here, then reads the
  -- card as already linked: a link is never written over.
  IF jsonb_typeof(p_links) = 'array' THEN
    PERFORM 1 FROM public.community_roadmap_cards rc
     WHERE rc.id IN (SELECT (x.value->>'card_id')::uuid FROM jsonb_array_elements(p_links) x
                      WHERE jsonb_typeof(x.value) = 'object' AND public.ops_is_uuid(x.value->>'card_id'))
     ORDER BY rc.id
       FOR UPDATE;
  END IF;
  v_check := public.ops_roadmap_links_check(p_links);
  FOR r IN SELECT x.value FROM jsonb_array_elements(v_check->'rows') x LOOP
    IF r->>'status' = 'ready' THEN
      BEGIN
        PERFORM public.ops_roadmap_link_set((r->>'card_id')::uuid, '#' || (r->>'issue_number'));
        v_linked := v_linked + 1;
        v_results := v_results || jsonb_build_array(r || jsonb_build_object('status', 'linked', 'words', format('Linked to #%s.', r->>'issue_number')));
      EXCEPTION WHEN others THEN
        v_skipped := v_skipped + 1;
        v_msg := regexp_replace(SQLERRM, '^[a-z_]+: ', '');
        v_results := v_results || jsonb_build_array(r || jsonb_build_object('status', 'skipped', 'words', left(v_msg, 300)));
      END;
    ELSE
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(r);
    END IF;
  END LOOP;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'backfill_confirmed', 'info', NULL, NULL, NULL,
    format('%s linked %s roadmap cards to GitHub; %s skipped.', public.ops_name(v.actor_email), v_linked, v_skipped),
    jsonb_build_object('backfill', 'roadmap_links', 'linked', v_linked, 'skipped', v_skipped));
  v_out := jsonb_build_object('linked', v_linked, 'skipped', v_skipped, 'replayed', false, 'results', v_results);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'roadmap_links', v_out);
  RETURN v_out;
END;
$$;

-- P3: the owner previews the brands without a host card, the newest 50
-- first. Writes nothing.
CREATE FUNCTION public.ops_brand_cards_preview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.ops_owner_person_only('Only the owner adds host cards for brands in bulk.');
  RETURN public.ops_brand_cards_rows();
END;
$$;

-- P3: the next pages of the same preview (at most 100 brands a page).
-- Writes nothing.
CREATE FUNCTION public.ops_brand_cards_preview_page(p_offset integer, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.ops_owner_person_only('Only the owner adds host cards for brands in bulk.');
  RETURN public.ops_brand_cards_rows(p_offset, p_limit);
END;
$$;

-- P3: the number of brands without a host card, for the Team dashboard
-- heading. No matching is run. Writes nothing.
CREATE FUNCTION public.ops_brand_cards_count() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.ops_owner_person_only('Only the owner adds host cards for brands in bulk.');
  RETURN jsonb_build_object('total', public.ops_brand_cards_total());
END;
$$;

-- P3: the owner confirms the chosen brands. Each runs brand auto-link
-- (ops_brand_autolink_one): link, a new host card, or the card a person
-- needs to pick or to reopen a Lost card. The same request key returns the
-- first answer and changes nothing again.
CREATE FUNCTION public.ops_brand_cards_confirm(p_brand_ids uuid[], p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_ids uuid[]; v_replay jsonb; v_id uuid; v_res jsonb; v_name text; v_linked integer := 0; v_created integer := 0;
  v_skipped integer := 0; v_results jsonb := '[]'::jsonb; v_out jsonb; v_status text; v_words text; v_card jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_owner_person_only('Only the owner adds host cards for brands in bulk.');
  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 90 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_brand_ids IS NULL OR cardinality(p_brand_ids) = 0 OR array_position(p_brand_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_brands: Choose at least one brand.' USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(p_brand_ids) x ORDER BY x);
  IF cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'invalid_brands: Choose at most 100 brands at a time.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'brand_cards', to_jsonb(v_ids));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT br.name INTO v_name FROM public.brands br WHERE br.id = v_id;
    BEGIN
      v_res := public.ops_brand_autolink_one(v_id);
      v_status := v_res->>'status';
    EXCEPTION WHEN others THEN
      v_status := 'failed'; v_res := jsonb_build_object('error', left(regexp_replace(SQLERRM, '^[a-z_]+: ', ''), 300));
    END;
    -- The words follow what happened to the card a person needs: "asks"
    -- only when a card was added just now.
    v_card := v_res->'card';
    v_words := CASE
      WHEN v_status = 'linked' THEN 'Linked to its host card.'
      WHEN v_status = 'created' THEN 'Host card added.'
      WHEN v_status IN ('pick', 'ask_reopen') AND v_card->>'status' = 'added' THEN
        CASE v_status WHEN 'pick' THEN 'A card asks a person to pick the right host card.'
                      ELSE 'A card asks a person whether to reopen the Lost host card.' END
      WHEN v_status IN ('pick', 'ask_reopen') AND v_card->>'status' = 'kept' AND v_card->>'id' IS NOT NULL THEN
        'A card already waits for a person; no second card was made.'
      WHEN v_status IN ('pick', 'ask_reopen') AND v_card->>'status' = 'kept' THEN
        'Its card for a person was closed in the last 14 days; nothing new was asked.'
      WHEN v_status IN ('pick', 'ask_reopen') THEN 'Not changed: the card for a person could not be made. Try again or add it by hand.'
      WHEN v_status = 'has_card' THEN 'It already has a host card.'
      WHEN v_status = 'gone' THEN 'This brand no longer exists.'
      ELSE 'Not changed: ' || COALESCE(v_res->>'error', 'try again.') END;
    IF v_status = 'linked' THEN v_linked := v_linked + 1;
    ELSIF v_status = 'created' THEN v_created := v_created + 1;
    ELSE v_skipped := v_skipped + 1; END IF;
    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'brand_id', v_id, 'name', v_name, 'status', v_status, 'words', v_words,
      'record_id', v_res->>'record_id', 'card_id', v_res->'card'->>'id')));
  END LOOP;
  PERFORM public.ops_log_write(v.actor_email, NULL, 'backfill_confirmed', 'info', NULL, NULL, NULL,
    format('%s confirmed host cards for %s brands: %s linked, %s added, %s left for a person.',
           public.ops_name(v.actor_email), cardinality(v_ids), v_linked, v_created, v_skipped),
    jsonb_build_object('backfill', 'brand_cards', 'linked', v_linked, 'created', v_created, 'skipped', v_skipped));
  v_out := jsonb_build_object('linked', v_linked, 'created', v_created, 'skipped', v_skipped, 'replayed', false, 'results', v_results);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'brand_cards', v_out);
  RETURN v_out;
END;
$$;

-- Grants. Internal helpers: service_role only. Client functions:
-- authenticated (each checks the caller) and service_role.
DO $grants3980syncw4$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.ops_roadmap_links_check(jsonb)', 'public.ops_brand_cards_rows()',
                           'public.ops_brand_cards_rows(integer,integer)', 'public.ops_brand_cards_total()',
                           'public.ops_roadmap_links_preview(jsonb)', 'public.ops_roadmap_links_confirm(jsonb,text)',
                           'public.ops_brand_cards_preview()', 'public.ops_brand_cards_preview_page(integer,integer)',
                           'public.ops_brand_cards_count()', 'public.ops_brand_cards_confirm(uuid[],text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$grants3980syncw4$;
GRANT EXECUTE ON FUNCTION public.ops_roadmap_links_preview(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_roadmap_links_confirm(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_brand_cards_preview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_brand_cards_preview_page(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_brand_cards_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_brand_cards_confirm(uuid[], text) TO authenticated;
COMMENT ON FUNCTION public.ops_roadmap_links_preview(jsonb) IS
  'Issue #3980 P3. Owner only, signed in as a person. Checks up to 50 {card_id, issue} pairs (card exists, issue of this repository, not linked already, not in the list twice) and writes nothing.';
COMMENT ON FUNCTION public.ops_roadmap_links_confirm(jsonb, text) IS
  'Issue #3980 P3. Owner only, signed in as a person. Checks the pairs again and links the ready ones through ops_roadmap_link_set; replay-safe per request key. Never run by a migration.';
COMMENT ON FUNCTION public.ops_brand_cards_preview() IS
  'Issue #3980 P3. Owner only, signed in as a person. Every brand without a host card and what brand auto-link would do (link, create, pick, reopen), from ops_brand_match. Writes nothing.';
COMMENT ON FUNCTION public.ops_brand_cards_preview_page(integer, integer) IS
  'Issue #3980 P3. Owner only, signed in as a person. One page (at most 100) of the brands without a host card, newest first, with what brand auto-link would do. Writes nothing.';
COMMENT ON FUNCTION public.ops_brand_cards_count() IS
  'Issue #3980 P3. Owner only, signed in as a person. How many brands have no host card; runs no matching. Writes nothing.';
COMMENT ON FUNCTION public.ops_brand_cards_confirm(uuid[], text) IS
  'Issue #3980 P3. Owner only, signed in as a person. Runs ops_brand_autolink_one for the chosen brands; replay-safe per request key. Never run by a migration.';

-- ---------------------------------------------------------------------------
-- 3. Feature Guide text (W4.2). Same shape as 20271119003980.
-- ---------------------------------------------------------------------------
DO $foundation3980sync$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_capability_evidence') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3980_sync_guide_foundation_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_truth_audit WHERE metadata->>'source' = 'issue_3720_feature_guide_content_truth')
     OR NOT EXISTS (SELECT 1 FROM public.product_truth_audit WHERE metadata->>'source' = 'issue_3980_ops_board_feature_guide') THEN
    RAISE EXCEPTION 'issue3980_sync_guide_needs_earlier_guide_first';
  END IF;
END;
$foundation3980sync$;

CREATE TEMP TABLE issue_3980_sync_guide ON COMMIT DROP AS
SELECT *
  FROM jsonb_to_recordset($guide3980sync$
[
  {
    "capability_key": "staff-drafts",
    "is_new": false,
    "title": "Needs you: messages to send, spend and publish approvals",
    "outcome_summary": "Everything that needs a person lands in Needs you in Mingla Admin. On Messages, outreach your connected agent wrote for hosts and creators (follow-ups and replies) waits for you to review, copy and send yourself, and Mingla then records the touch on the host or creator card. On Spend or publish, work cards wait for someone to approve money or confirm an event is published. The owner and admins also see What hosts are told, where the wording for shipped work waits until someone publishes it. Search words: needs you, drafts, approvals, mark sent, approve spend, publish, outreach drafts, follow-up, what hosts are told.",
    "how_to": "1. In Mingla Admin, open Pipeline > Needs you. The menu count shows your waiting messages plus your cards that need a person.\n2. Messages: switch between \"Waiting\", \"Sent\" and \"Discarded\". On a draft, press \"Edit\" to change it, or \"Open host\" / \"Open creator\" to see the record.\n3. Press \"Copy and mark sent\" to copy the text, then send it yourself by email, WhatsApp, DM or phone. Mingla logs it as sent.\n4. Press \"Discard\" to drop a draft. Both actions offer Undo for a short time; Undo changes Mingla only and does not recall a message you already sent.\n5. Spend or publish: click a card to see its plan and result. Press \"Approve spend\" with a short note, \"Mark published\" once the event is public on Mingla, or \"Send back\" with a note for the owner. Each choice is logged under your name.\n6. What hosts are told (owner and admins): when something ships, Mingla drafts a \"Recently shipped\" roadmap card. Change the wording if needed, then press \"Publish\" to show it on the roadmap, \"Write an announcement\" to tell hosts from Community & Support, or \"Not needed\" to drop it. Hosts see nothing until you publish.\n7. When nothing is waiting, the page says \"You're all caught up.\" Press \"Open My agent\" to connect an agent that can write drafts.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. Each person sees only their own message drafts; spend and publish cards show for their owners and watchers, and for the owner and admins. Mingla never sends a draft; the person sends it outside Mingla. Drafts are written by a connected agent (My agent), not created on this page. Approving spend records the decision and spends nothing, and Mark published only works once the event is public on Mingla. Agents cannot mark a message sent, approve spend or publish. What hosts are told is Owner and Admin only, and its drafts stay hidden from hosts until a person publishes them. Saving, marking and discarding need a connection.",
    "support_wording": "Mingla's team reviews every outreach message and every spend or publish decision by hand in an internal review queue. Mingla does not send these messages, spend money or publish events automatically.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-work-board",
    "is_new": false,
    "title": "Work: plan, assign and close team work with agents",
    "outcome_summary": "The team plans and tracks operations work as cards in Work in Mingla Admin. Each card has instructions, a done-means line, one or more owners and watchers from the team, a due date, a weekly sprint, links to real hosts, creators, brands, events and content, and the GitHub issues or pull requests behind it with their live status. When the owner switches on automatic steps, Mingla also makes the steps for every host's events by itself. People and their connected agents add cards after server checks, start them, close them with proof or push them back with a reason. Search words: work, work board, tasks, to-do, sprint, assign work, cards, needs attention, agent activity, GitHub status.",
    "how_to": "1. In Mingla Admin, open Pipeline > Work. It has three tabs: Board, Needs attention and Agent activity.\n2. Board: cards sit side by side in Needs you, To do, In progress and Done this week, each with a count. The strip above shows this week's sprint (Monday to Sunday) and its goal; use the arrows for other weeks, switch between Everyone, Mine and Watching, and use \"Group by\" for Status, Person or Event.\n3. Press \"Add card\". Fill in Title, Instructions, Done means, Owners and Watchers (type a name and pick from the team) and a Due date, or link an event and the due date is counted back from its start. Press \"Add card\". If something is missing, Mingla lists what to fix and adds nothing.\n4. Click a card to open it in a panel on the right. Changes save as you make them. Press \"Link\" under Linked records to link hosts, creators, brands, events, content or expected events, and \"Link\" under GitHub to add an issue or pull request, like #3980. Its chip shows Planned, In Progress, In Review, Shipped or Live and opens GitHub. Owners and watchers get a notice when they are added.\n5. Press \"Start\" to begin, \"Close with proof\" to finish (write what shows it is done), or \"Push back\" to mark it not needed or already done, with a reason. A done card can be reopened. Most changes offer Undo for a few seconds.\n6. Needs attention lists, with a count for each, cards and hosts with no owner, overdue cards, missing information, stuck cards, hosts with no next event and engineering follow-through. Fix one with a click, such as \"Assign to me\" or \"Fill in\", or press \"Ask my agent to fix these\" to copy a prompt for your agent.\n7. Cards marked \"from the timeline\" were made by Mingla from events: a go-live step for each event that is not public yet, a giveaway and ads step, a recap after the event and an ask for the host's next event. They move when the event moves and close when it is cancelled.\n8. Agent activity shows what every connected agent did and is doing.\n9. A giveaway and ads card that is held shows why. The owner or an admin can press \"Override\" and give a reason to let it start. Copy the agent prompt on a card to have your own agent do it.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. Every card needs a title, instructions, a done-means line, at least one current teammate as owner and a due date, and every link must point to a record that exists; a card that repeats an open card is refused with a link to it. A card closes only with proof. Steps that send a message, spend money or publish an event wait in Needs you for a person; agents cannot do them. Giveaway and ads cards stay blocked until the event is public with at least 21 days left, unless the owner or an admin overrides with a reason. A go-live gate card closes itself when its event is public on Mingla. Cards made by Mingla from events may have no owner until someone takes them. GitHub links must be issues or pull requests of Mingla's own repository. Removing a card is Owner and Admin only. Changes need a connection.",
    "support_wording": "Mingla's team tracks its own operations work, such as getting a host's event ready to go live, as cards on an internal Work board. Nothing on the board is sent to hosts or guests automatically; a team member sends every message.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)",
      "Claude Code or Codex on the person's own computer"
    ]
  },
  {
    "capability_key": "staff-agent-log",
    "is_new": false,
    "title": "Agent activity: what every connected agent is doing",
    "outcome_summary": "A shared feed in Mingla Admin of what each teammate's connected agent did and is doing: cards added or refused, records claimed and released, steps posted, cards closed with proof, and messages that were stopped. Each chat shows under its own name, such as \"Seth's Claude (Hosts sweep)\". It also lists which records are claimed right now, so no two agents do or send the same thing. Entries cannot be edited or removed. Search words: agent activity, activity feed, claims, who is working on this, chat name, agent history.",
    "how_to": "1. In Mingla Admin, open Pipeline > Work > Agent activity. Old links to this page open it too.\n2. The feed lists every entry, newest first: the person, their agent and the chat's name, what happened and the card it belongs to. Switch between \"All agents\" and \"Mine\", and press \"Show more\" for older entries.\n3. Click a card name to open the card.\n4. \"Claimed right now\" lists each claim, who holds it, since when and when it ends. The owner and admins can press \"Release\" to free a claim an agent left behind.\n5. When an agent starts a card, the card says it is on it. That mark stays for as long as the work takes, across days, until the card is closed, pushed back or released. The owner or an admin can clear it from the card.\n6. \"The rules every agent follows\" explains how agents read the log, claim, post updates and release.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. A claim on a record ends by itself 30 minutes after its last update. Cards are not claimed: while an agent's mark on a card had an update in the last 24 hours, another agent's changes to that card's status, plan or result are refused, and after 24 hours without an update another agent can take the card over. Notes are never refused. Two chats on one agent key are told apart and never write over each other; a chat without a name shows as a short code. While a record is claimed, another agent's change to it is refused and that agent is told who holds it; people can still make changes, and the log notes that they did. An agent cannot write a message for someone Mingla messaged in the last 3 days unless a person allows one more from the host or creator card. Refused messages, refused new cards and refused claims appear in the feed. Other refused changes, such as an agent's update to a host, creator, content or work card another agent has claimed, are told only to the agent that tried them and do not appear in the feed.",
    "support_wording": "Agent activity is an internal Mingla Admin record of what the team's own AI agents did. Hosts and guests cannot see it.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-content-calendar",
    "is_new": false,
    "title": "Calendar: events, go-live deadlines, promotions and content",
    "outcome_summary": "The team sees every upcoming event, trip, experience and RSVP on Mingla, and the events hosts have promised, on one calendar in Mingla Admin. Each event is in one of four plain states: Ready to promote (public 28 days or more before it starts), Promote now (21 to 27 days), Too late for promo (under 21 days, so no giveaway or ads) or Not live yet, with the date it must go live by. Social posts are still planned, approved and scheduled from Idea to Published. Search words: calendar, content calendar, ready to promote, promote now, too late for promo, not live yet, go-live deadline, social posts, schedule post.",
    "how_to": "1. In Mingla Admin, open Pipeline > Calendar. It opens on this month with today marked; press \"Today is\" to come back to it, and use the arrows for other months.\n2. Choose Events, Posts or Both, and Month or List. The buttons at the top count the events that need to go live, the events that can be promoted and the hosts with no next event.\n3. Each event has a dot for its state: Ready to promote, Promote now, Too late for promo, or a hollow dot for Not live yet, which is also used for events a host has promised. A day with more than two items shows \"+N more\".\n4. List groups upcoming events by state: Needs to go live, Promote now, Ready to promote and Too late for promo, each with a count.\n5. Click an event to see, on the right, its state in one sentence, what just happened to it, its host, and its steps. Once the owner switches on automatic steps, Mingla makes the eight launch steps automatically and shows how many are done; press \"Show all 8 steps\" to see each one, its date and who does it.\n6. Posts: press \"Add content\", type a title and press \"Add content\" again. The card starts in Idea and is assigned to you; Mingla warns if a similar title already exists. \"posts with no date\" lists the posts not on a day yet.\n7. Click a post to fill in Title, Owners, Channels, Publish date and time, Copy, Notes, Drive link, Live link, Audience, City and Format. Changes can be commented on, and a card can be removed with \"Delete card\".\n8. \"Posts board\" moves posts one stage at a time: Idea, Writing, Design, Review, Scheduled, Published. On the month, drag a post to a new day to reschedule it. Moving to Scheduled needs a publish date and time and at least one channel; moving to Published asks for the live link, or choose \"Publish without link\". Most changes offer Undo for a few seconds.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner (people who work the pipelines). The calendar shows events that are public on Mingla plus draft listings of brands linked to a host card; private and hidden events never show. An event's state is worked out from when it went public and its first date and cannot be typed; giveaway and ads can start only while it is Ready to promote or Promote now. The launch steps are made only while the owner has automatic steps switched on. Moving to Published only records the card as published; the calendar does not post to any social network. Assets are shared as a Drive link, not uploaded. Cards can move forward only one stage at a time. Editing needs a connection; offline you can only read.",
    "support_wording": "Mingla's team plans its promotion of upcoming events and its social posts on an internal calendar. Posts are published by the team on each channel; the calendar itself does not post anything. Events listed at least four weeks before they start give the team time for giveaways, creators and ads.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-crm",
    "is_new": false,
    "title": "Host and creator pipelines",
    "outcome_summary": "The team tracks outreach to hosts (venues, restaurants, event organisers) and creators (ambassadors, UGC) on two boards in Mingla Admin: add a record, set owner, region and ICP, log activity, and move it through the stages. Each host card shows its next event and its state, or that it has none, and a host can repeat every week or month or have promo moments. When the owner switches it on, a brand that signs up on Mingla is linked to its host card by itself, or gets a new host card. Beta leads can be added to Hosts, and owners and admins get a Team dashboard. Search words: CRM, pipeline, hosts board, creators board, outreach, leads, prospects, do not contact, next event, brand link.",
    "how_to": "1. In Mingla Admin, open Pipeline > Hosts or Pipeline > Creators.\n2. Use the toolbar to search, filter by ICP, Region and \"Whose records\" (\"Everyone\" or \"Mine\"), and switch the View between \"Board\", \"List\" and \"By region\". On Hosts, two more filters show hosts with \"No next event\" and hosts whose next event must \"Go live soon\" (within 14 days).\n3. Press \"Add host\" or \"Add creator\" to create a record; Mingla warns about possible duplicates.\n4. Click a card to open it. Changes save as you make them: Stage, ICP, Region, Channel, Source, Next action, Due, plus Followers, Agreement and Rate for creators. Mark a record Warm intro only or Do not contact with a one-line reason.\n5. Host stages: Prospect, Contacted, Replied, Meeting, Onboarded, Live, Lost. Creator stages: Identified, Contacted, Replied, Negotiating, Booked, Posted, Passed. Lost and Passed need a reason. Moves offer Undo.\n6. Each host card on the board shows its next event, its date and its state, or \"No next event\". Open a host to see \"On Mingla\": whether the brand is linked and the brand's upcoming events with their state; press one to see it on the Calendar. When a host signs up on Mingla with the same email, phone or handle as their card, Mingla links the brand by itself. Add the event the host has promised with What, Date, Type (Event, Trip, Experience, RSVP, or Promo moment for venues) and Repeats (every week or every month), then press \"Save. Steps and Calendar fill in by themselves\". For a repeating host Mingla keeps the next 4 dates on the Calendar. Open work for the host is listed under \"Work on this host\".\n7. If Mingla messaged someone in the last 3 days, their card says so; press \"Allow one more message\" with a reason if their agent really must write again sooner.\n8. Pipeline > Beta Leads: press \"Add to Hosts\" to turn a beta lead into a host record (once per lead).\n9. Owners and admins: Pipeline > Team dashboard shows hosts and creators by stage, everything due or overdue, monthly host targets, the Runway and Sprint panels, and how many host cards have no owner. The owner can also preview free-text next steps and turn the chosen ones into work cards, once per record, switch on a host card for every new brand, and preview the brands that have no host card yet and confirm which to link or add.",
    "limitations": "Hosts, Creators and Beta Leads open for Owner, Admin, Sales and marketing and Founding partner. Team dashboard and Tool Leads are Owner and Admin only. A host moves to Live by itself when its brand's first listing goes live and cannot be dragged there by hand. Nothing here sends messages; outreach is sent by the person outside Mingla and logged. Records marked Do not contact or Warm intro only cannot have outreach logged. Expected events are for hosts only. A brand is linked by itself only when exactly one host card has the same email, handle or whole phone number; several matches, a near match or a match on a Lost card wait for a person. Allowing one more message lasts 24 hours. Turning next steps into cards is Owner only, needs a confirm, and does not change the host or creator card.",
    "support_wording": "Mingla's team keeps track of hosts and creators it is talking to in an internal pipeline. If someone asks us to stop contacting them, the team marks their record Do not contact.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-team-roles",
    "is_new": false,
    "title": "Invite teammates and set roles",
    "outcome_summary": "The owner invites people into Mingla Admin and sets their role: Admin, Sales and marketing, or Founding partner. Invitees get an email with a one-time link that expires in 7 days. The owner also sets the name the team sees for each person and their GitHub username. Separately, admins give existing teammates a Community role (Moderator or Agent) under Community & Support, Team, People and roles, and grant support access from the Support desk.",
    "how_to": "Company access (owner): 1. In Mingla Admin open \"Team and roles\" under Company. 2. In \"Invite someone\", enter the \"Email address\", choose a role and send. 3. In \"People\", change a role from the row dropdown, \"Resend invite\", \"Invite again\" with a chosen role, or remove access (confirm \"Remove\"). Changes can be undone from the notice. 4. Under each person, type the name the team should see and, if they have one, their GitHub username; each saves when you leave the field or press Enter. Names show in every picker, in agent messages and in Agent activity; without one, Mingla uses the first part of the email.\n\nCommunity roles (Owner or Admin): 1. Open \"Community & Support\", then \"Team\", then \"People and roles\". 2. Click \"Invite teammate\", enter their Email and Display name, pick \"Moderator\" or \"Agent\" and \"Save\". 3. Use \"Manage\" on a row to change or \"Remove role\". The table shows each person's Community role, Support, Available now and Last active.",
    "limitations": "Team and roles is Owner only; nobody can change the owner's access. Invite links last 7 days, and changing a role or resending makes the old link stop working. An address that already has a Mingla account signing in another way (phone, Google or Apple) cannot be invited. In People and roles, \"Invite teammate\" does not send an invite: it assigns a role to someone who already has a Mingla profile with that email, and active Admins cannot be given a Community role. A Community role only opens the Community tabs for someone who is also an active Mingla Admin teammate. Removing access also turns off that person's agent keys. Every active teammate role can use Work, Needs you and Calendar. Only the owner sets names and GitHub usernames, and two people cannot share a GitHub username. The Team dashboard with its Runway and Sprint panels is Owner and Admin only, and turning free-text next steps into cards is Owner only.",
    "support_wording": "Only the account owner can invite people to Mingla Admin and set their role. Community and Support roles are given by an admin to people who are already on the team.",
    "who_can_use": [
      "Owner",
      "Admin (Community roles only)"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-my-agent",
    "is_new": false,
    "title": "My agent: connect your own Claude or Codex",
    "outcome_summary": "Team members connect their own Claude Code or Codex agent to Mingla. The agent works under the person's name and role: it can read and update their host and creator pipelines, log what happened, work the content calendar, write outreach drafts for review, and plan, start, do and close cards in Work with proof after reading the shared agent activity. Each chat can have its own name, so the team sees which chat did what. It never sends messages, spends money or publishes. Search words: my agent, AI agent, Claude, Codex, connect agent, agent key, MCP, work board.",
    "how_to": "1. In Mingla Admin, open System > My agent.\n2. Step 1, \"Copy your setup message\": choose your computer (\"macOS or Linux\" or \"Windows\") and copy the setup message for Claude or Codex. It works once, for 10 minutes.\n3. Step 2, \"Paste it into your agent\": paste it into Claude Code or Codex on your own computer and let it run the one command it contains.\n4. Step 3, \"Restart your agent, then just ask\": reopen the agent and ask \"What is on my plate in Mingla?\". If it fails, open \"Not working?\".\n5. Advanced lets you create a key by hand; it is shown once and hidden after 10 minutes.\n6. The page also lists \"What it can do now\", \"Work and calendar\", \"Not yet\", \"Guardrails\", suggested routines and \"What my agent did\". Try \"Do my cards for today.\" or the routine \"Log this chat's work\", which has the agent open a card in Work, post each step and close it with proof.\n7. Give each chat a short name the first time it uses a work tool, for example chat \"Hosts sweep\". Claims and Agent activity then show that name, and two chats on one key never write over each other. Use Disconnect to turn an agent off. Owners also see \"Agents on the team\" and can disconnect anyone's agent.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. One active key per person for each agent (one for Claude, one for Codex). The agent sees only what the person's role sees, cannot delete, manage keys or manage the team, never sends an email, DM or WhatsApp, may log only a cold first message, and cannot contact or unmark records set to Do not contact or Warm intro only. It must claim a record before changing it: a record another agent has claimed is refused until that claim is released or ends 30 minutes after its last update. Cards are not claimed: an agent that starts a card stays marked as working on it, and another agent cannot change that card until it has had no update for 24 hours. It cannot close a work card without proof, mark a message sent, approve spend, publish, override a giveaway or ads block, or remove a card. Undoing a move, adding beta leads to Hosts and setting targets are not available to the agent yet. Claude in the browser or on a phone is not supported yet. A key unused for a set number of days (90 by default) is turned off. Windows setup is untested.",
    "support_wording": "Mingla team members can connect their own Claude Code or Codex agent to help with pipeline and operations work. The agent acts under their own name and permissions, and it never sends messages, spends money or publishes for them.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)",
      "Claude Code or Codex on the person's own computer"
    ]
  },
  {
    "capability_key": "staff-release-records",
    "is_new": true,
    "title": "Release records and the synced system",
    "outcome_summary": "When a pull request merges, a bot posts its release record on each linked issue: PR, merge commit, migrations added and applied, deploy, live check and the Feature Guide entries it ships. Admin follows every linked GitHub issue, so Work cards, tickets and roadmap cards show its status, and an entry turns Live by itself when its record is complete. Search words: release record, live, shipped, GitHub status, Feature Guide, merge bot.",
    "how_to": "1. When you open a pull request, fill in the two lines the template asks for: \"Issue:\" with the issue it moves (toward #123, or Fixes #123 when it finishes the issue) and \"Feature Guide:\" with the entries it ships, or none.\n2. When it merges, the merge bot posts one release record on each linked issue, or on the pull request when no issue is linked. The record names the pull request, the merge commit, the migrations it adds and whether they are applied in production, the deploy, the live check and the Feature Guide entries. Each line fills in by itself as its step finishes.\n3. After you check the change in production, post a comment on the issue that starts with \"Live check:\" and says what you checked. The bot adds it to the record.\n4. In Mingla Admin, every linked GitHub issue shows its status on Work cards, support tickets and roadmap cards: Planned, In Progress, In Review, Shipped or Live.\n5. When a record is complete, each Feature Guide entry it names turns Live by itself, with the record, the pull request and the live check as its evidence. If evidence is missing, the record says which.\n6. Anything left unfinished, such as migrations not applied, a deploy that did not run or a live check still missing two days after merge, becomes a card for the person who merged, under Work > Needs attention > Engineering.",
    "limitations": "Only the merge bot writes release records. A record edited by hand is written over on the next refresh, and comments by anyone else are never read as records. A live check counts only from an owner, member or collaborator of the repository. An entry turns Live only when every kind of evidence it needs is current; an incomplete record changes nothing. Mingla reads GitHub every 5 minutes, so a status can take a few minutes to change. A web change deploys only when the merged title carries [deploy]. Follow-through cards count only work merged after the owner switched on automatic steps. Hosts never see release records.",
    "support_wording": "Mingla's team records every release and checks it in production before telling hosts it is live.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)",
      "GitHub (Mingla-LLC/mingla-main)"
    ]
  }
]
$guide3980sync$::jsonb) AS g(capability_key text, title text, outcome_summary text, how_to text, limitations text,
                           support_wording text, who_can_use jsonb, surfaces jsonb, is_new boolean);

-- The text each existing entry had in production on 20 Oct 2026, read
-- read-only right before this was written: title, outcome, how-to,
-- limitations, support wording, who can use it and where it appears
-- (prod-feature-guide-read.json; each hash recomputed from that read).
CREATE TEMP TABLE issue_3980_sync_guide_base ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('staff-agent-log', '55aa9f86773887a0f1a51113dc62e9a0'),
    ('staff-content-calendar', 'c84f7eca0fea034a1d5a8fc7885ff338'),
    ('staff-crm', '245d68a515d119f1fd7a744dbe71d03a'),
    ('staff-drafts', '7f37f901f92ba14a65b7a4cc8230ddff'),
    ('staff-my-agent', '5d93616a36f7f021a19f7829b04226c8'),
    ('staff-team-roles', 'a396b39eb3c90734def96796eb813d7f'),
    ('staff-work-board', 'a994090582720b41e2f8efe9c7db4901')
  ) AS b(capability_key, content_md5);

CREATE TEMP TABLE issue_3980_sync_guide_before ON COMMIT DROP AS
SELECT (SELECT count(*)::integer FROM public.product_capabilities c
         WHERE c.claimed_status = 'live' AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live') AS live_rows,
       (SELECT jsonb_object_agg(c.capability_key, jsonb_build_object('status', c.claimed_status, 'revision', c.revision))
          FROM public.product_capabilities c JOIN issue_3980_sync_guide g USING (capability_key)) AS rows_before,
       (SELECT count(*) FROM public.product_capability_evidence) AS evidence_rows;

DO $preflight3980sync$
DECLARE v_bad text;
BEGIN
  IF (SELECT count(*) FROM issue_3980_sync_guide) <> 8
     OR (SELECT count(DISTINCT capability_key) FROM issue_3980_sync_guide) <> 8
     OR (SELECT count(*) FROM issue_3980_sync_guide WHERE is_new) <> 1
     OR (SELECT count(*) FROM issue_3980_sync_guide_base) <> 7 THEN
    RAISE EXCEPTION 'issue3980_sync_guide_payload_shape';
  END IF;
  IF EXISTS (SELECT 1 FROM issue_3980_sync_guide
              WHERE capability_key IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')) THEN
    RAISE EXCEPTION 'issue3980_sync_guide_protected_live_entry';
  END IF;
  SELECT string_agg(g.capability_key, ', ' ORDER BY g.capability_key) INTO v_bad
    FROM issue_3980_sync_guide g
   WHERE NOT g.is_new AND NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = g.capability_key);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_sync_guide_missing_capability: %', v_bad; END IF;
  SELECT string_agg(g.capability_key, ', ' ORDER BY g.capability_key) INTO v_bad
    FROM issue_3980_sync_guide g
   WHERE g.is_new AND EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = g.capability_key);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_sync_guide_new_entry_exists: %', v_bad; END IF;
  -- A newer edit is never written over.
  SELECT string_agg(b.capability_key, ', ' ORDER BY b.capability_key) INTO v_bad
    FROM issue_3980_sync_guide_base b
    JOIN public.product_capabilities c USING (capability_key)
   WHERE md5(concat_ws('|', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording,
                       array_to_json(c.who_can_use)::text, array_to_json(c.surfaces)::text)) <> b.content_md5;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_sync_guide_entry_changed_since_read: %', v_bad; END IF;
  IF EXISTS (SELECT 1 FROM issue_3980_sync_guide g WHERE NOT g.is_new
               AND NOT EXISTS (SELECT 1 FROM issue_3980_sync_guide_base b WHERE b.capability_key = g.capability_key)) THEN
    RAISE EXCEPTION 'issue3980_sync_guide_base_shape';
  END IF;
END;
$preflight3980sync$;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET title = g.title,
         outcome_summary = g.outcome_summary,
         how_to = g.how_to,
         limitations = g.limitations,
         support_wording = g.support_wording,
         who_can_use = ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         surfaces = ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         revision = c.revision + 1,
         updated_at = now()
    FROM issue_3980_sync_guide g
   WHERE c.capability_key = g.capability_key
     AND NOT g.is_new
     AND (c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording, c.who_can_use, c.surfaces)
         IS DISTINCT FROM
         (g.title, g.outcome_summary, g.how_to, g.limitations, g.support_wording,
          ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
          ARRAY(SELECT jsonb_array_elements_text(g.surfaces)))
  RETURNING c.id, c.revision, c.claimed_status
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', saved.id,
       jsonb_build_object('source', 'issue_3980_synced_guide', 'issue', 3980,
                          'revision', saved.revision, 'claimed_status', saved.claimed_status, 'status_corrected', false)
  FROM saved;

WITH added AS (
  INSERT INTO public.product_capabilities(
    capability_key, title, outcome_summary, who_can_use, surfaces, how_to,
    limitations, support_wording, claimed_status, required_evidence_kinds, verification_due_at
  )
  SELECT g.capability_key, g.title, g.outcome_summary,
         ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         g.how_to, g.limitations, g.support_wording, 'planned',
         ARRAY['source', 'test', 'release_record', 'live_check'], NULL
    FROM issue_3980_sync_guide g
   WHERE g.is_new
  RETURNING id, revision, claimed_status
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', added.id,
       jsonb_build_object('source', 'issue_3980_synced_guide', 'issue', 3980,
                          'revision', added.revision, 'claimed_status', added.claimed_status, 'status_corrected', false)
  FROM added;

DO $postcheck3980sync$
DECLARE v_bad text;
BEGIN
  -- No template wording, and none of the old names or old state words.
  SELECT string_agg(c.capability_key, ', ' ORDER BY c.capability_key) INTO v_bad
    FROM public.product_capabilities c
    JOIN issue_3980_sync_guide g USING (capability_key)
   WHERE concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording)
         ILIKE ANY (ARRAY['%follow the on-screen%', '%complete this job through%',
                          '%Support must use the current evidence status%', '%brand groups%', '%verified test%',
                          '%Plan this launch%', '%full launch%', '%organic only%', '%> To review%', '%in To review%', '%open To review%',
                          '%agent log%', '%launch steps by itself%'])
      OR concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording) ~* '\m(tight|missed)\M'
      OR concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording) ~ 'To review';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'issue3980_sync_guide_wording: %', v_bad; END IF;
  -- No entry changed status, and no evidence was added.
  IF (SELECT count(*)::integer FROM public.product_capabilities c
       WHERE c.claimed_status = 'live' AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live')
     <> (SELECT live_rows FROM issue_3980_sync_guide_before)
     OR (SELECT count(*) FROM public.product_capability_evidence) <> (SELECT evidence_rows FROM issue_3980_sync_guide_before)
     OR EXISTS (SELECT 1 FROM public.product_capabilities c, issue_3980_sync_guide_before b
                 WHERE b.rows_before ? c.capability_key AND c.claimed_status <> b.rows_before->c.capability_key->>'status') THEN
    RAISE EXCEPTION 'issue3980_sync_guide_status_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM issue_3980_sync_guide g
               LEFT JOIN public.product_capabilities c USING (capability_key)
              WHERE c.id IS NULL OR c.title <> g.title OR c.how_to <> g.how_to OR c.limitations <> g.limitations
                 OR c.outcome_summary <> g.outcome_summary OR c.support_wording <> g.support_wording
                 OR (g.is_new AND (c.claimed_status <> 'planned' OR c.revision <> 1
                                   OR c.required_evidence_kinds <> ARRAY['source', 'test', 'release_record', 'live_check']))
                 OR (NOT g.is_new AND c.revision <> ((SELECT b.rows_before->g.capability_key->>'revision' FROM issue_3980_sync_guide_before b))::integer + 1)) THEN
    RAISE EXCEPTION 'issue3980_sync_guide_row_not_saved';
  END IF;
  IF (SELECT count(*) FROM public.product_truth_audit WHERE metadata->>'source' = 'issue_3980_synced_guide') <> 8 THEN
    RAISE EXCEPTION 'issue3980_sync_guide_audit_missing';
  END IF;
END;
$postcheck3980sync$;

-- ---------------------------------------------------------------------------
-- 4. Self-check. The apply stops here if anything above is not as stated.
-- ---------------------------------------------------------------------------
DO $w4sync3980$
DECLARE
  c_new_client constant text[] := ARRAY['ops_roadmap_links_preview(jsonb)', 'ops_roadmap_links_confirm(jsonb,text)',
                                        'ops_brand_cards_preview()', 'ops_brand_cards_preview_page(integer,integer)',
                                        'ops_brand_cards_count()', 'ops_brand_cards_confirm(uuid[],text)'];
  r record; g record;
BEGIN
  SELECT * INTO g FROM issue3980_sync_w4_guard;
  FOR r IN SELECT p.oid, p.proname, p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig, p.prosrc
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('ops_roadmap_links_check', 'ops_brand_cards_rows', 'ops_brand_cards_total', 'ops_roadmap_links_preview',
                                'ops_roadmap_links_confirm', 'ops_brand_cards_preview', 'ops_brand_cards_preview_page',
                                'ops_brand_cards_count', 'ops_brand_cards_confirm') LOOP
    IF NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) x WHERE x = 'search_path=pg_catalog, pg_temp') THEN
      RAISE EXCEPTION 'issue 3980 synced W4 self-check: % does not pin search_path = pg_catalog, pg_temp', r.sig; END IF;
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'issue 3980 synced W4 self-check: % is not SECURITY DEFINER', r.sig; END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR (SELECT bool_or(a.grantee = 0) FROM pg_catalog.pg_proc p2, aclexplode(COALESCE(p2.proacl, acldefault('f', p2.proowner))) a WHERE p2.oid = r.oid) THEN
      RAISE EXCEPTION 'issue 3980 synced W4 self-check: anon or PUBLIC can run %', r.sig; END IF;
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') <> (replace(r.sig, 'public.', '') = ANY (c_new_client)) THEN
      RAISE EXCEPTION 'issue 3980 synced W4 self-check: client grant wrong for %', r.sig; END IF;
    -- Previews and checks only read.
    IF r.proname IN ('ops_roadmap_links_check', 'ops_brand_cards_rows', 'ops_brand_cards_total', 'ops_roadmap_links_preview',
                     'ops_brand_cards_preview', 'ops_brand_cards_preview_page', 'ops_brand_cards_count')
       AND (r.provolatile <> 's' OR r.prosrc ~* '(update|insert\s+into|delete\s+from)\s' OR r.prosrc ~* '(_confirm|_link_set|autolink)\(') THEN
      RAISE EXCEPTION 'issue 3980 synced W4 self-check: % writes or calls a writer', r.sig; END IF;
    -- No new writer of pipeline tables, roadmap cards or ad tables.
    IF r.prosrc ~* '(update|insert\s+into|delete\s+from)\s+public\.(crm_|community_|ops_roadmap_links)' OR r.prosrc ~* '(public\.ad_|ad_plans|ad_campaigns)' THEN
      RAISE EXCEPTION 'issue 3980 synced W4 self-check: % writes a table it must not', r.sig; END IF;
  END LOOP;
  IF (SELECT count(*) FROM unnest(c_new_client) s WHERE has_function_privilege('authenticated', 'public.' || s, 'EXECUTE')) <> 6 THEN
    RAISE EXCEPTION 'issue 3980 synced W4 self-check: a client function is missing'; END IF;
  IF g.is_admin_hash IS DISTINCT FROM md5(pg_get_functiondef('public.is_admin_user()'::regprocedure))
     OR g.crm_ctx_hash IS DISTINCT FROM md5(pg_get_functiondef('public.crm_ctx()'::regprocedure))
     OR g.gateway_hash IS DISTINCT FROM md5(pg_get_functiondef('public.team_agent_call(text,text,jsonb,text)'::regprocedure))
     OR g.brand_link_hash IS DISTINCT FROM md5(pg_get_functiondef('public.crm_apply_brand_link(uuid)'::regprocedure))
     OR g.create_core_hash IS DISTINCT FROM md5(pg_get_functiondef('public.crm_record_create_core(text,jsonb,text,text)'::regprocedure))
     OR g.roadmap_hash IS DISTINCT FROM md5(pg_get_functiondef('public.community_upsert_roadmap_card(uuid,text,text,text,text,text)'::regprocedure))
     OR g.link_set_hash IS DISTINCT FROM md5(pg_get_functiondef('public.ops_roadmap_link_set(uuid,text)'::regprocedure))
     OR g.autolink_hash IS DISTINCT FROM md5(pg_get_functiondef('public.ops_brand_autolink_one(uuid)'::regprocedure)) THEN
    RAISE EXCEPTION 'issue 3980 synced W4 self-check: an untouchable function changed'; END IF;
  -- No backfill ran: no link, no host card, no brand link and no work card
  -- was made by this migration.
  IF g.roadmap_links <> (SELECT count(*) FROM public.ops_roadmap_links)
     OR g.crm_records <> (SELECT count(*) FROM public.crm_records)
     OR g.crm_branded <> (SELECT count(*) FROM public.crm_records WHERE brand_id IS NOT NULL)
     OR g.work_cards <> (SELECT count(*) FROM public.ops_work_cards)
     OR EXISTS (SELECT 1 FROM public.ops_agent_log l WHERE l.action = 'backfill_confirmed') THEN
    RAISE EXCEPTION 'issue 3980 synced W4 self-check: a backfill ran'; END IF;
END;
$w4sync3980$;

COMMIT;

NOTIFY pgrst, 'reload schema';
