-- Issue #4571 (Work pipeline redesign), wave W6a: Archived and Merge for
-- duplicate host and creator cards (SOP decision 7 "No archive and no merge").
--
--   1. crm_records gains archived_at, archived_by, archived_reason (1 to 300
--      characters, all three set together) and merged_into_id (the card a
--      merged card now lives in; only on an archived card).
--   2. crm_record_archive(p_id, p_reason) and crm_record_unarchive(p_id):
--      people only (an agent is refused). A merged card is unarchived only by
--      undoing its merge (crm_record_unmerge).
--   3. Archived cards are left out of the board (crm_records_list), out of
--      "My calls today" (crm_calls_queue) and out of demo suggestions
--      (crm_4571_demo_candidates). They stay in search (find_records) and in
--      the duplicate checks (crm_duplicate_check, which now says archived), so
--      a re-add finds the archived card and offers Unarchive. The live-name
--      unique index stays WHERE deleted_at IS NULL, so an archived name still
--      blocks a duplicate. crm_records_archived_list(p_pipeline) is the board's
--      "Show archived" list. The W6c sweep leaves archived cards alone.
--   4. crm_record_merge(p_keep, p_drop, p_request_key): people only, same
--      pipeline, both live and not archived. Both rows are locked in id order
--      (no deadlock). It moves, from the dropped card to the kept card:
--        - its touches and notes (crm_activity kind touch or note). Its
--          'created' row and stage moves stay on the dropped card, so the kept
--          card's stage history (and its earliest entry) is unchanged and the
--          W2 stage_at of every moved touch is kept as written;
--        - identifiers the kept card does not have (by kind and value_key);
--          exact duplicates stay on the dropped card, which still answers the
--          duplicate checks;
--        - owners and watchers the kept card does not have, never making a
--          watcher an owner or the other way round, at most 10 owners;
--        - linked demos (crm_record_demos), imports (crm_record_sources) and
--          files (ops_work_files.record_id);
--        - Work links of kind host / creator (and a Work card counted from the
--          dropped card), each with a card event; a card that already links
--          the kept card loses the duplicate link (kept in the merge log).
--      The kept card takes the dropped card's stage only when it is further
--      along, is not Live (it sets itself) and the move is allowed: it goes
--      through crm_record_move_stage, so the W4 demo rule decides (after the
--      demos moved). Otherwise the kept card keeps its own stage and the
--      answer says why. A note goes on both cards; the dropped card is
--      archived with merged_into_id. Everything moved is written to
--      crm_record_merges, and crm_record_unmerge(p_merge_id) puts it back
--      within 7 days (a stage the merge moved stays where it is; the answer
--      says so).
--   5. crm_duplicate_pairs(p_pipeline): the Monday "duplicate pairs" list:
--      live, not archived cards that share a working identifier, or whose
--      names contain each other. At most 200 pairs.
--
-- INVARIANT crm-archived-not-on-board: gate crm_records_list + crm_calls_queue
-- (archived_at IS NULL); test
-- supabase/migrations/__tests__/issue_4571_w6a_archive_merge.implementor.pg17.test.sql
-- INVARIANT crm-merge-keeps-history: gate crm_record_merge (the kept card's
-- touches and notes after = the sum of both cards' before + its merge note;
-- its stage moves are unchanged); same test
--
-- ROLLBACK (no down file): drop crm_record_unmerge(uuid), crm_record_merge(uuid,
-- uuid, text), crm_duplicate_pairs(text), crm_records_archived_list(text),
-- crm_record_unarchive(uuid), crm_record_archive(uuid, text) and the table
-- crm_record_merges; restore crm_records_list (20271116003980), crm_calls_queue
-- and crm_record_lite_json from 20281126034571, crm_4571_demo_candidates from
-- 20281126044571 and crm_record_json from 20281126044571; then drop the four
-- columns.

BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE public.crm_records
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by text,
  ADD COLUMN archived_reason text,
  ADD COLUMN merged_into_id uuid REFERENCES public.crm_records(id);

ALTER TABLE public.crm_records
  ADD CONSTRAINT crm_records_archived_set CHECK (
    (archived_at IS NULL AND archived_by IS NULL AND archived_reason IS NULL AND merged_into_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by IS NOT NULL
        AND char_length(btrim(COALESCE(archived_reason, ''))) BETWEEN 1 AND 300)),
  ADD CONSTRAINT crm_records_not_merged_into_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);

CREATE INDEX crm_records_archived ON public.crm_records (pipeline, archived_at DESC)
  WHERE archived_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX crm_records_merged_into ON public.crm_records (merged_into_id) WHERE merged_into_id IS NOT NULL;

-- Every merge, with everything it moved, so it can be undone or audited.
CREATE TABLE public.crm_record_merges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keep_id       uuid NOT NULL REFERENCES public.crm_records(id),
  drop_id       uuid NOT NULL REFERENCES public.crm_records(id),
  merged_by     text NOT NULL,
  merged_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_key   text NOT NULL,
  moved         jsonb NOT NULL,
  result        jsonb NOT NULL,
  unmerged_at   timestamptz,
  unmerged_by   text,
  CONSTRAINT crm_record_merges_two CHECK (keep_id <> drop_id),
  CONSTRAINT crm_record_merges_key CHECK (request_key ~ '^[A-Za-z0-9_-]{8,70}$'),
  CONSTRAINT crm_record_merges_undo_pair CHECK ((unmerged_at IS NULL) = (unmerged_by IS NULL)),
  CONSTRAINT crm_record_merges_moved_object CHECK (jsonb_typeof(moved) = 'object')
);
CREATE UNIQUE INDEX crm_record_merges_request ON public.crm_record_merges (merged_by, request_key);
CREATE INDEX crm_record_merges_by_drop ON public.crm_record_merges (drop_id, merged_at DESC);
CREATE INDEX crm_record_merges_by_keep ON public.crm_record_merges (keep_id, merged_at DESC);
ALTER TABLE public.crm_record_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_record_merges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crm_record_merges TO service_role;
COMMENT ON TABLE public.crm_record_merges IS
  'Issue #4571 W6a. One row per merge of two host or creator cards: who, when, and every row moved (moved), so crm_record_unmerge can put it back within 7 days. Read and written only through the crm_record_merge functions.';

-- The card shape gains its archive state. One hook so W6b and W6c add their
-- computed fields (suggest_replied, cadence) without another copy of
-- crm_record_json.
CREATE FUNCTION public.crm_4571_w6_json(r public.crm_records) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'archived_at', r.archived_at, 'archived_by', r.archived_by, 'archived_reason', r.archived_reason,
    'merged_into', CASE WHEN r.merged_into_id IS NULL THEN NULL ELSE
      (SELECT jsonb_build_object('id', m.id, 'name', m.name) FROM public.crm_records m WHERE m.id = r.merged_into_id) END)
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_w6_json(public.crm_records) FROM PUBLIC, anon, authenticated;

-- From 20281126044571 (crm_record_json). #4571 W6: || crm_4571_w6_json(r).
CREATE OR REPLACE FUNCTION public.crm_record_json(r crm_records)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id', r.id, 'pipeline', r.pipeline, 'name', r.name, 'icp', r.icp, 'region_id', r.region_id,
    'stage', r.stage, 'stage_reason', r.stage_reason, 'contact', r.contact, 'channel', r.channel,
    'source', r.source, 'next_action', r.next_action, 'due_on', r.due_on,
    'owners', COALESCE((SELECT jsonb_agg(o.owner_email ORDER BY o.owner_email)
                          FROM public.crm_record_owners o WHERE o.record_id = r.id), '[]'::jsonb),
    'brand_id', r.brand_id,
    'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = r.brand_id AND b.deleted_at IS NULL),
    'place_pool_id', r.place_id,
    'place_name', (SELECT p.name FROM public.place_pool p WHERE p.id = r.place_id AND p.deleted_at IS NULL),
    'beta_lead_id', r.beta_lead_id, 'followers', r.followers, 'agreement', r.agreement, 'rate', r.rate,
    'went_live_at', r.went_live_at,
    'identifiers', public.crm_identifiers_json(r.id),
    'contact_rule', r.contact_rule, 'contact_rule_reason', r.contact_rule_reason,
    'contact_rule_by', r.contact_rule_by, 'contact_rule_at', r.contact_rule_at,
    'last_touch_at', (SELECT max(a.occurred_at) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'touch_count', (SELECT count(*) FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'),
    'created_by', r.created_by, 'created_at', r.created_at, 'updated_at', r.updated_at)
  || jsonb_build_object(  -- #4571 W3
    'watchers', COALESCE((SELECT jsonb_agg(w.watcher_email ORDER BY w.watcher_email)
                            FROM public.crm_record_watchers w WHERE w.record_id = r.id), '[]'::jsonb),
    'last_touch', (SELECT jsonb_build_object('at', a.occurred_at, 'actor_name', public.ops_name(a.actor_email),
                                             'channel', a.channel, 'direction', a.direction, 'outcome', a.call_outcome)
                     FROM public.crm_activity a WHERE a.record_id = r.id AND a.kind = 'touch'
                    ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1),
    'open_work', (SELECT count(*) FROM public.ops_work_cards c
                   WHERE c.id IN (SELECT public.crm_record_work_ids(r.id)) AND c.status <> 'done'))
  || CASE WHEN r.pipeline = 'hosts' THEN jsonb_build_object(  -- #4571 W4
       'next_demo', (SELECT jsonb_build_object('booking_id', k.id, 'call_at', k.call_at, 'status', k.status)
                       FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                      WHERE d.record_id = r.id AND k.status IN ('booked', 'moved') AND k.call_at >= now() - interval '1 hour'
                      ORDER BY k.call_at, k.id LIMIT 1),
       'demo_gate', public.crm_demo_gate(r))
     ELSE '{}'::jsonb END
  || public.crm_4571_w6_json(r)  -- #4571 W6
$function$;

-- From 20281126034571 (crm_record_lite_json). #4571 W6a: the duplicate checks
-- say when the match is archived (and where a merged card went).
CREATE OR REPLACE FUNCTION public.crm_record_lite_json(r crm_records)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id', r.id, 'name', r.name, 'stage', r.stage,
    'contact_rule', r.contact_rule, 'contact_rule_reason', r.contact_rule_reason,
    'owners', COALESCE((SELECT jsonb_agg(o.owner_email ORDER BY o.owner_email)
                          FROM public.crm_record_owners o WHERE o.record_id = r.id), '[]'::jsonb),
    'archived', r.archived_at IS NOT NULL, 'merged_into_id', r.merged_into_id)
$function$;

-- From 20271116003980 (crm_records_list). #4571 W6a: archived cards are not on
-- the board. INVARIANT crm-archived-not-on-board (test
-- issue_4571_w6a_archive_merge.implementor.pg17.test.sql): keep both
-- archived_at IS NULL lines.
CREATE OR REPLACE FUNCTION public.crm_records_list(p_pipeline text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v       record;
  v_total bigint;
  v_rows  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.crm_records c
   WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NULL;
  SELECT COALESCE(jsonb_agg(public.crm_record_json(x) ORDER BY x.updated_at DESC, x.id), '[]'::jsonb) INTO v_rows
  FROM (SELECT c.* FROM public.crm_records c
         WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NULL
         ORDER BY c.updated_at DESC, c.id
         LIMIT 5000) x;
  RETURN jsonb_build_object('pipeline', p_pipeline, 'records', v_rows, 'truncated', v_total > 5000,
    'archived_count', (SELECT count(*) FROM public.crm_records c
                        WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL));
END;
$function$;

-- The board's "Show archived" list: newest archived first, at most 2000.
CREATE FUNCTION public.crm_records_archived_list(p_pipeline text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_total bigint; v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.crm_records c
   WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL;
  SELECT COALESCE(jsonb_agg(public.crm_record_json(x) ORDER BY x.archived_at DESC, x.id), '[]'::jsonb) INTO v_rows
  FROM (SELECT c.* FROM public.crm_records c
         WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL
         ORDER BY c.archived_at DESC, c.id LIMIT 2000) x;
  RETURN jsonb_build_object('pipeline', p_pipeline, 'records', v_rows, 'total', v_total, 'truncated', v_total > 2000);
END;
$function$;
COMMENT ON FUNCTION public.crm_records_archived_list(text) IS
  'Issue #4571 W6a. The board''s Show archived list: archived (not deleted) cards of one pipeline, newest archived first, at most 2000, with the total. crm_ctx(): the Hosts and Creators area.';
REVOKE ALL ON FUNCTION public.crm_records_archived_list(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_records_archived_list(text) TO authenticated, service_role;

-- From 20281126034571 (crm_calls_queue). #4571 W6a: archived cards are out.
-- INVARIANT crm-archived-not-on-board: keep the archived_at IS NULL line.
CREATE OR REPLACE FUNCTION public.crm_calls_queue(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v       record;
  v_today date;
  v_rows  jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_today := public.ops_today(p_today);
  SELECT COALESCE(jsonb_agg(q.j ORDER BY q.rank, q.due_on, q.name_key, q.id), '[]'::jsonb) INTO v_rows
  FROM (SELECT c.id, c.due_on, lower(c.name) AS name_key,
               array_position(ARRAY['replied','meeting','contacted','prospect'], c.stage) AS rank,
               jsonb_build_object('id', c.id, 'name', c.name, 'stage', c.stage, 'due_on', c.due_on,
                 'next_action', c.next_action, 'icp', c.icp, 'region_id', c.region_id,
                 'pinned', c.stage IN ('replied', 'meeting'),
                 'contact_rule', c.contact_rule, 'contact_rule_reason', c.contact_rule_reason,
                 'identifiers', public.crm_identifiers_json(c.id),
                 'last_touch', (SELECT jsonb_build_object('at', a.occurred_at, 'actor_name', public.ops_name(a.actor_email),
                                                          'channel', a.channel, 'direction', a.direction, 'outcome', a.call_outcome)
                                  FROM public.crm_activity a WHERE a.record_id = c.id AND a.kind = 'touch'
                                 ORDER BY a.occurred_at DESC, a.created_at DESC, a.id LIMIT 1)) AS j
          FROM public.crm_records c
         WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL
           AND c.archived_at IS NULL
           AND c.stage IN ('replied', 'meeting', 'contacted', 'prospect')
           AND c.due_on IS NOT NULL AND c.due_on <= v_today
           AND EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = c.id AND o.owner_email = v.actor_email)
         LIMIT 500) q;
  RETURN jsonb_build_object('today', v_today, 'count', jsonb_array_length(v_rows), 'records', v_rows);
END;
$function$;

-- From 20281126044571 (crm_4571_demo_candidates). #4571 W6a: an archived card
-- is never suggested for a demo.
CREATE OR REPLACE FUNCTION public.crm_4571_demo_candidates(p_booking_id uuid, p_viewer text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH k AS (
    SELECT b.* FROM public.book_call_leads b WHERE b.id = p_booking_id AND b.audience = 'host'
  ),
  live AS (
    SELECT c.* FROM public.crm_records c WHERE c.pipeline = 'hosts' AND c.deleted_at IS NULL AND c.archived_at IS NULL
  ),
  hits AS (
    -- 1. The viewer's own outbound call, 2 hours before to 15 minutes after the booking was made.
    SELECT l.id AS record_id, 1 AS rank, 'your_call'::text AS reason,
           max(a.occurred_at) AS at,
           round(extract(epoch FROM (k.created_at - max(a.occurred_at))) / 60)::integer AS minutes_before
      FROM k
      JOIN public.crm_activity a ON a.kind = 'touch' AND a.channel = 'phone' AND a.direction = 'outbound'
                                AND a.actor_email = p_viewer
                                AND a.occurred_at BETWEEN k.created_at - interval '2 hours' AND k.created_at + interval '15 minutes'
      JOIN live l ON l.id = a.record_id
     WHERE p_viewer IS NOT NULL
     GROUP BY l.id, k.created_at
    UNION ALL
    -- 2. The booking's email is a working email on the card.
    SELECT l.id, 2, 'email', NULL, NULL
      FROM k
      JOIN public.crm_record_identifiers i ON i.kind = 'email' AND i.status = 'ok'
                                          AND i.value_key = public.crm_ident_key('email', btrim(k.email))
      JOIN live l ON l.id = i.record_id
    UNION ALL
    -- 3. The booking's phone is a working phone on the card (the duplicate check's number rule).
    SELECT l.id, 3, 'phone', NULL, NULL
      FROM k
      CROSS JOIN LATERAL public.crm_identifier_hits('hosts',
        jsonb_build_array(jsonb_build_object('kind', 'phone', 'value_key', public.crm_ident_key('phone', k.phone_e164))), NULL) h
      JOIN public.crm_record_identifiers i ON i.record_id = h.record_id AND i.kind = 'phone'
                                          AND i.value_key = h.value_key AND i.status = 'ok'
      JOIN live l ON l.id = h.record_id
     WHERE k.phone_e164 IS NOT NULL AND public.crm_ident_key('phone', k.phone_e164) IS NOT NULL
    UNION ALL
    -- 4. The venue's name is the card's name (crm_name_key).
    SELECT l.id, 4, 'venue_name', NULL, NULL
      FROM k
      JOIN live l ON l.name_key = public.crm_name_key(btrim(k.venue))
     WHERE NULLIF(btrim(k.venue), '') IS NOT NULL AND public.crm_name_key(btrim(k.venue)) <> ''
  ),
  best AS (
    SELECT DISTINCT ON (h.record_id) h.record_id, h.rank, h.reason, h.at, h.minutes_before
      FROM hits h
     ORDER BY h.record_id, h.rank, h.at DESC NULLS LAST
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'record_id', c.id, 'name', c.name, 'stage', c.stage, 'reason', b.reason,
           'minutes_before', b.minutes_before)
         ORDER BY b.rank, b.at DESC NULLS LAST, lower(c.name), c.id), '[]'::jsonb)
  FROM (SELECT * FROM best ORDER BY rank, at DESC NULLS LAST LIMIT 8) b
  JOIN public.crm_records c ON c.id = b.record_id
$function$;

-- People only: the signed-in person, never an agent key.
CREATE FUNCTION public.crm_4571_person_ctx() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: A person archives and merges cards in Mingla Admin.' USING ERRCODE = '42501';
  END IF;
  RETURN v.actor_email;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_4571_person_ctx() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_record_archive(p_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_actor text; v_rec public.crm_records; v_reason text;
        v_now timestamptz := clock_timestamp(); v_act uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_actor := public.crm_4571_person_ctx();
  v_reason := regexp_replace(btrim(COALESCE(p_reason, '')), '\s+', ' ', 'g');
  IF char_length(v_reason) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'reason_required: Say why this card is archived, in 1 to 300 characters.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  IF v_rec.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false);
  END IF;
  UPDATE public.crm_records SET archived_at = v_now, archived_by = v_actor, archived_reason = v_reason,
         updated_by = v_actor, updated_at = v_now
   WHERE id = v_rec.id RETURNING * INTO v_rec;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, body, occurred_at, created_at)
  VALUES (v_rec.id, 'note', v_actor, 'Archived: ' || v_reason, v_now, v_now) RETURNING id INTO v_act;
  PERFORM public.crm_audit(v_actor, 'crm.archive', 'crm_record', v_rec.id::text,
    jsonb_build_object('reason', v_reason, 'activity_id', v_act));
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true);
END;
$function$;
COMMENT ON FUNCTION public.crm_record_archive(uuid, text) IS
  'Issue #4571 W6a. Archive a host or creator card with a reason (1 to 300 characters): it leaves the board, My calls today, demo suggestions and the cadence sweep, and stays in search and duplicate checks. People only. A note goes on the card and the change is audited.';
REVOKE ALL ON FUNCTION public.crm_record_archive(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_record_archive(uuid, text) TO authenticated, service_role;

CREATE FUNCTION public.crm_record_unarchive(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_actor text; v_rec public.crm_records; v_now timestamptz := clock_timestamp(); v_act uuid;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_actor := public.crm_4571_person_ctx();
  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  IF v_rec.archived_at IS NULL THEN
    RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', false);
  END IF;
  IF v_rec.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'merged_card: This card was merged into another card. Undo the merge from the card it went into (within 7 days), or open that card.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.crm_records SET archived_at = NULL, archived_by = NULL, archived_reason = NULL,
         updated_by = v_actor, updated_at = v_now
   WHERE id = v_rec.id RETURNING * INTO v_rec;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, body, occurred_at, created_at)
  VALUES (v_rec.id, 'note', v_actor, 'Unarchived.', v_now, v_now) RETURNING id INTO v_act;
  PERFORM public.crm_audit(v_actor, 'crm.unarchive', 'crm_record', v_rec.id::text, jsonb_build_object('activity_id', v_act));
  RETURN jsonb_build_object('record', public.crm_record_json(v_rec), 'changed', true);
END;
$function$;
COMMENT ON FUNCTION public.crm_record_unarchive(uuid) IS
  'Issue #4571 W6a. Put an archived card back on the board. People only. A merged card is refused (merged_card): undo its merge instead.';
REVOKE ALL ON FUNCTION public.crm_record_unarchive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_record_unarchive(uuid) TO authenticated, service_role;

-- Merge. INVARIANT crm-merge-keeps-history (test
-- issue_4571_w6a_archive_merge.implementor.pg17.test.sql): touches and notes
-- move to the kept card; created and stage_move rows never move.
CREATE FUNCTION public.crm_record_merge(p_keep uuid, p_drop uuid, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v record;
  v_actor text;
  v_now timestamptz := clock_timestamp();
  v_keep public.crm_records; v_drop public.crm_records; v_prev public.crm_record_merges;
  v_link_kind text; v_ids uuid[]; v_emails text[]; v_keys jsonb; v_links jsonb := '[]'::jsonb;
  v_dup_links jsonb := '[]'::jsonb; v_anchor uuid[]; v_moved jsonb; v_result jsonb;
  v_stage_note text; v_stage_to text; v_move jsonb; l record; n public.ops_work_cards; v_merge uuid;
  v_room integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_actor := public.crm_4571_person_ctx();
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,70}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request_key (8 to 70 letters, digits, - or _).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_prev FROM public.crm_record_merges m WHERE m.merged_by = v_actor AND m.request_key = p_request_key;
  IF FOUND THEN
    IF v_prev.keep_id = p_keep AND v_prev.drop_id = p_drop THEN
      RETURN v_prev.result || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'request_key_reused: That request_key was used for another merge. Send a new one.' USING ERRCODE = '22023';
  END IF;
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'invalid_merge: Pick two different cards: the one to keep and the duplicate.' USING ERRCODE = '22023';
  END IF;
  -- Both rows, locked in id order so two merges never wait on each other.
  PERFORM 1 FROM public.crm_records c WHERE c.id IN (p_keep, p_drop) ORDER BY c.id FOR UPDATE;
  SELECT * INTO v_keep FROM public.crm_records c WHERE c.id = p_keep AND c.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: The card to keep is no longer here.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_drop FROM public.crm_records c WHERE c.id = p_drop AND c.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: The duplicate card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF v_keep.pipeline <> v_drop.pipeline THEN
    RAISE EXCEPTION 'invalid_merge: Both cards must be in the same pipeline (hosts or creators).' USING ERRCODE = '22023';
  END IF;
  IF v_keep.archived_at IS NOT NULL OR v_drop.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived_card: Unarchive the card first; only cards on the board are merged.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ops_claim_assert('crm_record', v_keep.id, v_actor, NULL);
  PERFORM public.ops_claim_assert('crm_record', v_drop.id, v_actor, NULL);
  v_link_kind := CASE v_keep.pipeline WHEN 'hosts' THEN 'host' ELSE 'creator' END;

  -- Touches and notes (never created or stage_move rows).
  WITH m AS (UPDATE public.crm_activity a SET record_id = v_keep.id
              WHERE a.record_id = v_drop.id AND a.kind IN ('touch', 'note') RETURNING a.id)
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_ids FROM m;
  v_moved := jsonb_build_object('activity', to_jsonb(v_ids));

  -- Identifiers the kept card does not have.
  WITH m AS (UPDATE public.crm_record_identifiers i SET record_id = v_keep.id
              WHERE i.record_id = v_drop.id
                AND NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers k
                                 WHERE k.record_id = v_keep.id AND k.kind = i.kind AND k.value_key = i.value_key)
             RETURNING i.id)
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_ids FROM m;
  v_moved := v_moved || jsonb_build_object('identifiers', to_jsonb(v_ids));

  -- Owners (at most 10 on the kept card), never someone who watches it.
  v_room := GREATEST(0, 10 - (SELECT count(*) FROM public.crm_record_owners o WHERE o.record_id = v_keep.id))::integer;
  WITH pick AS (
    SELECT o.owner_email FROM public.crm_record_owners o
     WHERE o.record_id = v_drop.id
       AND NOT EXISTS (SELECT 1 FROM public.crm_record_owners k WHERE k.record_id = v_keep.id AND k.owner_email = o.owner_email)
       AND NOT EXISTS (SELECT 1 FROM public.crm_record_watchers w WHERE w.record_id = v_keep.id AND w.watcher_email = o.owner_email)
     ORDER BY o.added_at, o.owner_email LIMIT v_room),
  m AS (UPDATE public.crm_record_owners o SET record_id = v_keep.id
          FROM pick WHERE o.record_id = v_drop.id AND o.owner_email = pick.owner_email RETURNING o.owner_email)
  SELECT COALESCE(array_agg(m.owner_email), ARRAY[]::text[]) INTO v_emails FROM m;
  v_moved := v_moved || jsonb_build_object('owners', to_jsonb(v_emails));

  -- Watchers (at most 10), never someone who owns it.
  v_room := GREATEST(0, 10 - (SELECT count(*) FROM public.crm_record_watchers w WHERE w.record_id = v_keep.id))::integer;
  WITH pick AS (
    SELECT w.watcher_email FROM public.crm_record_watchers w
     WHERE w.record_id = v_drop.id
       AND NOT EXISTS (SELECT 1 FROM public.crm_record_watchers k WHERE k.record_id = v_keep.id AND k.watcher_email = w.watcher_email)
       AND NOT EXISTS (SELECT 1 FROM public.crm_record_owners o WHERE o.record_id = v_keep.id AND o.owner_email = w.watcher_email)
     ORDER BY w.added_at, w.watcher_email LIMIT v_room),
  m AS (UPDATE public.crm_record_watchers w SET record_id = v_keep.id
          FROM pick WHERE w.record_id = v_drop.id AND w.watcher_email = pick.watcher_email RETURNING w.watcher_email)
  SELECT COALESCE(array_agg(m.watcher_email), ARRAY[]::text[]) INTO v_emails FROM m;
  v_moved := v_moved || jsonb_build_object('watchers', to_jsonb(v_emails));

  -- Demos, imports and files.
  WITH m AS (UPDATE public.crm_record_demos d SET record_id = v_keep.id WHERE d.record_id = v_drop.id RETURNING d.booking_id)
  SELECT COALESCE(array_agg(m.booking_id), ARRAY[]::uuid[]) INTO v_ids FROM m;
  v_moved := v_moved || jsonb_build_object('demos', to_jsonb(v_ids));
  WITH m AS (UPDATE public.crm_record_sources s SET record_id = v_keep.id WHERE s.record_id = v_drop.id
             RETURNING s.source_system, s.source_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('system', m.source_system, 'id', m.source_id)), '[]'::jsonb) INTO v_keys FROM m;
  v_moved := v_moved || jsonb_build_object('sources', v_keys);
  WITH m AS (UPDATE public.ops_work_files f SET record_id = v_keep.id WHERE f.record_id = v_drop.id RETURNING f.id)
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_ids FROM m;
  v_moved := v_moved || jsonb_build_object('files', to_jsonb(v_ids));

  -- Work links, each with a card event on its card.
  FOR l IN SELECT w.* FROM public.ops_work_links w WHERE w.kind = v_link_kind AND w.target_id = v_drop.id ORDER BY w.card_id LOOP
    IF EXISTS (SELECT 1 FROM public.ops_work_links k WHERE k.card_id = l.card_id AND k.kind = l.kind AND k.target_id = v_keep.id) THEN
      DELETE FROM public.ops_work_links w WHERE w.card_id = l.card_id AND w.kind = l.kind AND w.target_id = v_drop.id;
      v_dup_links := v_dup_links || jsonb_build_array(to_jsonb(l));
    ELSE
      UPDATE public.ops_work_links w SET target_id = v_keep.id, label = left(v_keep.name, 160)
       WHERE w.card_id = l.card_id AND w.kind = l.kind AND w.target_id = v_drop.id;
      v_links := v_links || jsonb_build_array(jsonb_build_object('card_id', l.card_id, 'label', l.label));
    END IF;
    UPDATE public.ops_work_cards c SET revision = revision + 1, updated_by = v_actor, updated_via = NULL, updated_at = v_now
     WHERE c.id = l.card_id RETURNING * INTO n;
    PERFORM public.ops_card_event(l.card_id, v_actor, NULL, 'links',
      format('Merged %s into %s; this card now links %s', v_drop.name, v_keep.name, v_keep.name),
      jsonb_build_object('kind', l.kind, 'id', v_drop.id), jsonb_build_object('kind', l.kind, 'id', v_keep.id),
      n.revision - 1, n.revision);
  END LOOP;
  WITH m AS (UPDATE public.ops_work_cards c SET anchor_id = v_keep.id
              WHERE c.anchor_kind = v_link_kind AND c.anchor_id = v_drop.id RETURNING c.id)
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_anchor FROM m;
  v_moved := v_moved || jsonb_build_object('links', v_links, 'removed_links', v_dup_links, 'anchors', to_jsonb(v_anchor),
                                           'keep_stage_before', v_keep.stage);

  -- The later stage, only if the move is allowed (W4's rule decides).
  IF v_drop.stage <> v_keep.stage
     AND NOT COALESCE((public.crm_stage_def(v_keep.pipeline, v_drop.stage)->>'terminal')::boolean, false)
     AND NOT COALESCE((public.crm_stage_def(v_keep.pipeline, v_keep.stage)->>'terminal')::boolean, false)
     AND (public.crm_stage_def(v_keep.pipeline, v_drop.stage)->>'pos')::integer
         > (public.crm_stage_def(v_keep.pipeline, v_keep.stage)->>'pos')::integer THEN
    IF COALESCE((public.crm_stage_def(v_keep.pipeline, v_drop.stage)->>'auto')::boolean, false) THEN
      v_stage_note := format('Kept %s: %s sets itself when the brand has a public listing.',
        public.crm_stage_def(v_keep.pipeline, v_keep.stage)->>'label', public.crm_stage_def(v_keep.pipeline, v_drop.stage)->>'label');
    ELSE
      BEGIN
        v_move := public.crm_record_move_stage(v_keep.id, v_drop.stage, NULL, v_keep.stage);
        v_stage_to := v_drop.stage;
      EXCEPTION WHEN invalid_parameter_value OR insufficient_privilege THEN
        v_stage_note := format('Kept %s: %s', public.crm_stage_def(v_keep.pipeline, v_keep.stage)->>'label',
                               regexp_replace(SQLERRM, '^[a-z_]+: ', ''));
      END;
    END IF;
  END IF;
  v_moved := v_moved || jsonb_build_object('stage_to', v_stage_to);

  INSERT INTO public.crm_activity (record_id, kind, actor_email, body, occurred_at, created_at)
  VALUES (v_keep.id, 'note', v_actor, format('Merged %s into this card.', v_drop.name), v_now, v_now);
  INSERT INTO public.crm_activity (record_id, kind, actor_email, body, occurred_at, created_at)
  VALUES (v_drop.id, 'note', v_actor, format('Merged into %s. Its touches, notes, contacts, people, demos, files and Work links moved there.', v_keep.name), v_now, v_now);
  UPDATE public.crm_records SET archived_at = v_now, archived_by = v_actor,
         archived_reason = left('Merged into ' || v_keep.name, 300), merged_into_id = v_keep.id,
         updated_by = v_actor, updated_at = v_now
   WHERE id = v_drop.id;
  UPDATE public.crm_records SET updated_by = v_actor, updated_at = v_now WHERE id = v_keep.id;

  INSERT INTO public.crm_record_merges (keep_id, drop_id, merged_by, merged_at, request_key, moved, result)
  VALUES (v_keep.id, v_drop.id, v_actor, v_now, p_request_key, v_moved, '{}'::jsonb) RETURNING id INTO v_merge;
  SELECT * INTO v_keep FROM public.crm_records c WHERE c.id = p_keep;
  v_result := jsonb_build_object('merge_id', v_merge, 'record', public.crm_record_json(v_keep),
    'moved', jsonb_build_object(
      'activity', jsonb_array_length(v_moved->'activity'), 'identifiers', jsonb_array_length(v_moved->'identifiers'),
      'owners', jsonb_array_length(v_moved->'owners'), 'watchers', jsonb_array_length(v_moved->'watchers'),
      'demos', jsonb_array_length(v_moved->'demos'), 'sources', jsonb_array_length(v_moved->'sources'),
      'files', jsonb_array_length(v_moved->'files'), 'links', jsonb_array_length(v_moved->'links') + jsonb_array_length(v_moved->'removed_links')),
    'stage_to', v_stage_to, 'stage_note', v_stage_note, 'undo_until', v_now + interval '7 days', 'replayed', false);
  UPDATE public.crm_record_merges SET result = v_result WHERE id = v_merge;
  PERFORM public.crm_audit(v_actor, 'crm.merge', 'crm_record', v_keep.id::text,
    jsonb_build_object('merge_id', v_merge, 'drop_id', v_drop.id, 'moved', v_result->'moved', 'stage_to', v_stage_to));
  RETURN v_result;
END;
$function$;
COMMENT ON FUNCTION public.crm_record_merge(uuid, uuid, text) IS
  'Issue #4571 W6a. Merge a duplicate card (p_drop) into the card to keep (p_keep): same pipeline, both on the board, people only. Moves touches and notes, identifiers the keeper lacks, owners and watchers (never both, at most 10 each), demos, imports, files and host/creator Work links (with card events). Stage moves stay on each card. The keeper takes the later stage only if crm_record_move_stage (the W4 rule) allows it. The duplicate is archived with merged_into_id. Logged in crm_record_merges; crm_record_unmerge undoes it within 7 days. INVARIANT crm-merge-keeps-history.';
REVOKE ALL ON FUNCTION public.crm_record_merge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_record_merge(uuid, uuid, text) TO authenticated, service_role;

CREATE FUNCTION public.crm_record_unmerge(p_merge_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v record; v_actor text; v_now timestamptz := clock_timestamp();
  m public.crm_record_merges; v_keep public.crm_records; v_drop public.crm_records; v_kind text; l jsonb; n public.ops_work_cards;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_actor := public.crm_4571_person_ctx();
  SELECT * INTO m FROM public.crm_record_merges x WHERE x.id = p_merge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That merge is not here.' USING ERRCODE = 'P0002'; END IF;
  IF m.unmerged_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_undone: This merge was already undone.' USING ERRCODE = '22023';
  END IF;
  IF m.merged_at < v_now - interval '7 days' THEN
    RAISE EXCEPTION 'too_late: A merge can be undone for 7 days. Move what you need by hand; the merge log lists every row it moved.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.crm_records c WHERE c.id IN (m.keep_id, m.drop_id) ORDER BY c.id FOR UPDATE;
  SELECT * INTO v_keep FROM public.crm_records c WHERE c.id = m.keep_id;
  SELECT * INTO v_drop FROM public.crm_records c WHERE c.id = m.drop_id;
  IF v_keep.deleted_at IS NOT NULL OR v_drop.deleted_at IS NOT NULL OR v_drop.merged_into_id IS DISTINCT FROM v_keep.id THEN
    RAISE EXCEPTION 'cannot_undo: One of the two cards changed since (deleted, or no longer merged), so the merge cannot be undone.' USING ERRCODE = '22023';
  END IF;
  v_kind := CASE v_keep.pipeline WHEN 'hosts' THEN 'host' ELSE 'creator' END;

  UPDATE public.crm_activity a SET record_id = v_drop.id
   WHERE a.record_id = v_keep.id AND a.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'activity') e);
  UPDATE public.crm_record_identifiers i SET record_id = v_drop.id
   WHERE i.record_id = v_keep.id AND i.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'identifiers') e)
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers d WHERE d.record_id = v_drop.id AND d.kind = i.kind AND d.value_key = i.value_key);
  UPDATE public.crm_record_owners o SET record_id = v_drop.id
   WHERE o.record_id = v_keep.id AND o.owner_email IN (SELECT e #>> '{}' FROM jsonb_array_elements(m.moved->'owners') e)
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_owners d WHERE d.record_id = v_drop.id AND d.owner_email = o.owner_email);
  UPDATE public.crm_record_watchers w SET record_id = v_drop.id
   WHERE w.record_id = v_keep.id AND w.watcher_email IN (SELECT e #>> '{}' FROM jsonb_array_elements(m.moved->'watchers') e)
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_watchers d WHERE d.record_id = v_drop.id AND d.watcher_email = w.watcher_email);
  UPDATE public.crm_record_demos d SET record_id = v_drop.id
   WHERE d.record_id = v_keep.id AND d.booking_id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'demos') e);
  UPDATE public.crm_record_sources s SET record_id = v_drop.id
   WHERE s.record_id = v_keep.id
     AND (s.source_system, s.source_id) IN (SELECT e->>'system', e->>'id' FROM jsonb_array_elements(m.moved->'sources') e);
  UPDATE public.ops_work_files f SET record_id = v_drop.id
   WHERE f.record_id = v_keep.id AND f.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'files') e);
  FOR l IN SELECT e FROM jsonb_array_elements(m.moved->'links') e LOOP
    UPDATE public.ops_work_links w SET target_id = v_drop.id, label = l->>'label'
     WHERE w.card_id = (l->>'card_id')::uuid AND w.kind = v_kind AND w.target_id = v_keep.id;
    UPDATE public.ops_work_cards c SET revision = revision + 1, updated_by = v_actor, updated_via = NULL, updated_at = v_now
     WHERE c.id = (l->>'card_id')::uuid RETURNING * INTO n;
    IF n.id IS NOT NULL THEN
      PERFORM public.ops_card_event(n.id, v_actor, NULL, 'links', format('Undid the merge: this card links %s again', v_drop.name),
        NULL, jsonb_build_object('kind', v_kind, 'id', v_drop.id), n.revision - 1, n.revision);
    END IF;
  END LOOP;
  INSERT INTO public.ops_work_links (card_id, kind, target_id, label, added_by, added_via, added_at)
  SELECT (e->>'card_id')::uuid, e->>'kind', (e->>'target_id')::uuid, e->>'label', e->>'added_by', e->>'added_via', (e->>'added_at')::timestamptz
    FROM jsonb_array_elements(m.moved->'removed_links') e
   WHERE EXISTS (SELECT 1 FROM public.ops_work_cards c WHERE c.id = (e->>'card_id')::uuid)
  ON CONFLICT DO NOTHING;
  UPDATE public.ops_work_cards c SET anchor_id = v_drop.id
   WHERE c.anchor_kind = v_kind AND c.anchor_id = v_keep.id
     AND c.id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'anchors') e);

  UPDATE public.crm_records SET archived_at = NULL, archived_by = NULL, archived_reason = NULL, merged_into_id = NULL,
         updated_by = v_actor, updated_at = v_now WHERE id = v_drop.id;
  INSERT INTO public.crm_activity (record_id, kind, actor_email, body, occurred_at, created_at) VALUES
    (v_keep.id, 'note', v_actor, format('Undid the merge of %s.', v_drop.name), v_now, v_now),
    (v_drop.id, 'note', v_actor, format('Undid the merge into %s. This card is back on the board.', v_keep.name), v_now, v_now);
  UPDATE public.crm_record_merges SET unmerged_at = v_now, unmerged_by = v_actor WHERE id = m.id;
  PERFORM public.crm_audit(v_actor, 'crm.unmerge', 'crm_record', v_keep.id::text,
    jsonb_build_object('merge_id', m.id, 'drop_id', v_drop.id));
  SELECT * INTO v_drop FROM public.crm_records c WHERE c.id = m.drop_id;
  SELECT * INTO v_keep FROM public.crm_records c WHERE c.id = m.keep_id;
  RETURN jsonb_build_object('record', public.crm_record_json(v_drop), 'kept', public.crm_record_json(v_keep),
    'stage_note', CASE WHEN m.moved->>'stage_to' IS NOT NULL
      THEN format('%s stays in %s, where the merge moved it. Move it back yourself if that was wrong.', v_keep.name,
                  public.crm_stage_def(v_keep.pipeline, v_keep.stage)->>'label') END);
END;
$function$;
COMMENT ON FUNCTION public.crm_record_unmerge(uuid) IS
  'Issue #4571 W6a. Undo a merge within 7 days: every row crm_record_merge moved goes back to the duplicate, removed duplicate Work links come back, and the duplicate is unarchived. A stage the merge moved stays (stage_note says so). People only.';
REVOKE ALL ON FUNCTION public.crm_record_unmerge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_record_unmerge(uuid) TO authenticated, service_role;

-- A card's merges (both sides), newest first: the panel's "Merged" line and Undo.
CREATE FUNCTION public.crm_record_merges_json(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'merge_id', m.id, 'keep_id', m.keep_id, 'drop_id', m.drop_id,
      'keep_name', (SELECT c.name FROM public.crm_records c WHERE c.id = m.keep_id),
      'drop_name', (SELECT c.name FROM public.crm_records c WHERE c.id = m.drop_id),
      'merged_by_name', public.ops_name(m.merged_by), 'merged_at', m.merged_at,
      'moved', m.result->'moved', 'stage_to', m.result->'stage_to',
      'unmerged_at', m.unmerged_at,
      'can_undo', m.unmerged_at IS NULL AND m.merged_at >= clock_timestamp() - interval '7 days')
      ORDER BY m.merged_at DESC)
    FROM public.crm_record_merges m WHERE m.keep_id = p_id OR m.drop_id = p_id), '[]'::jsonb);
END;
$function$;
COMMENT ON FUNCTION public.crm_record_merges_json(uuid) IS
  'Issue #4571 W6a. The merges a card took part in (kept or merged away), newest first, with counts moved and whether Undo is still open (7 days). crm_ctx().';
REVOKE ALL ON FUNCTION public.crm_record_merges_json(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_record_merges_json(uuid) TO authenticated, service_role;

-- The Monday duplicate pairs.
CREATE FUNCTION public.crm_duplicate_pairs(p_pipeline text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_rows jsonb; v_total integer;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_pipeline IS NULL OR p_pipeline NOT IN ('hosts', 'creators') THEN
    RAISE EXCEPTION 'invalid_pipeline: Use hosts or creators.' USING ERRCODE = '22023';
  END IF;
  WITH live AS (
    SELECT c.* FROM public.crm_records c
     WHERE c.pipeline = p_pipeline AND c.deleted_at IS NULL AND c.archived_at IS NULL
  ),
  by_ident AS (
    SELECT LEAST(a.record_id, b.record_id) AS a_id, GREATEST(a.record_id, b.record_id) AS b_id,
           'shared_' || a.kind AS reason, 1 AS rank
      FROM public.crm_record_identifiers a
      JOIN public.crm_record_identifiers b ON b.kind = a.kind AND b.value_key = a.value_key AND b.record_id <> a.record_id
      JOIN live la ON la.id = a.record_id
      JOIN live lb ON lb.id = b.record_id
     WHERE a.status = 'ok' AND b.status = 'ok'
  ),
  by_name AS (
    SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), 'similar_name', 2
      FROM live a JOIN live b ON a.id < b.id
     WHERE char_length(a.name_key) >= 3 AND char_length(b.name_key) >= 3
       AND (position(a.name_key IN b.name_key) > 0 OR position(b.name_key IN a.name_key) > 0)
  ),
  pairs AS (
    SELECT DISTINCT ON (x.a_id, x.b_id) x.a_id, x.b_id, x.reason, x.rank
      FROM (SELECT * FROM by_ident UNION ALL SELECT * FROM by_name) x
     ORDER BY x.a_id, x.b_id, x.rank, x.reason
  )
  SELECT count(*)::integer,
         COALESCE(jsonb_agg(jsonb_build_object('reason', p.reason,
                    'a', public.crm_record_lite_json(ca) || jsonb_build_object('touch_count',
                         (SELECT count(*) FROM public.crm_activity t WHERE t.record_id = ca.id AND t.kind = 'touch'), 'created_at', ca.created_at),
                    'b', public.crm_record_lite_json(cb) || jsonb_build_object('touch_count',
                         (SELECT count(*) FROM public.crm_activity t WHERE t.record_id = cb.id AND t.kind = 'touch'), 'created_at', cb.created_at))
                  ORDER BY p.rank, lower(ca.name), lower(cb.name)) FILTER (WHERE p.n <= 200), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (SELECT pairs.*, row_number() OVER (ORDER BY pairs.rank, pairs.a_id, pairs.b_id) AS n FROM pairs) p
    JOIN public.crm_records ca ON ca.id = p.a_id
    JOIN public.crm_records cb ON cb.id = p.b_id;
  RETURN jsonb_build_object('pipeline', p_pipeline, 'pairs', v_rows, 'total', v_total, 'truncated', v_total > 200);
END;
$function$;
COMMENT ON FUNCTION public.crm_duplicate_pairs(text) IS
  'Issue #4571 W6a. The Monday hygiene list: pairs of live, not archived cards in one pipeline that share a working email, phone, handle or website (reason shared_<kind>), or whose names contain each other (similar_name). Shared identifiers first; at most 200 pairs with the total. crm_ctx().';
REVOKE ALL ON FUNCTION public.crm_duplicate_pairs(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_duplicate_pairs(text) TO authenticated, service_role;

COMMIT;
