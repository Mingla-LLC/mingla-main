-- Issue #4571 (Work pipeline redesign), wave W2: links on subtasks, two new
-- link kinds, call outcomes.
--   1. A new subtask sent with no links starts with its parent's links,
--      except support conversations (ops_validate_card). links: [] means none.
--      An inherited event link is not the subtask's anchor: it stays due when
--      its parent is.
--   2. Removing a link from a card never removes it from its subtasks by
--      itself. ops_work_link_remove removes it from the card and, when asked,
--      from the card's open direct subtasks, in one step, and lists them.
--   3. Two new link kinds: call (a crm_activity phone touch) and booking (a
--      host book_call_leads row). Labels never carry an email or a number.
--      Board tiles and subtask rows get each link's stored label.
--   4. crm_activity gains call_outcome (six values, an outbound phone touch
--      only), duration_seconds (0 to 14,400, a phone touch only) and stage_at
--      (the record's stage when the entry was written; a BEFORE INSERT
--      trigger fills it for every writer; existing rows are backfilled from
--      the stage_move history).
--   5. crm_record_identifiers gains status ok/bad with a reason, when and by
--      whom. Logging a call with outcome wrong_number marks that number bad.
--   6. crm_record_log takes outcome, duration_seconds, the number dialled
--      (identifier_id, or identifier as written) and a Work card (work_card_id,
--      or work_card by number); a call sent with a card is linked to it
--      (ops_work_link_add). The answer may carry suggest_stage (never applied).
--
-- INVARIANT crm-call-outcome-phone-only: gate crm_activity_call_outcome_check
-- (and crm_record_log); test supabase/migrations/__tests__/issue_4571_w2_links_calls.implementor.pg17.test.sql
-- INVARIANT ops-subtask-inherits-links-not-support: gate ops_validate_card; same test
-- INVARIANT crm-activity-stage-at-written: gate ops_4571_activity_stage_at
-- (BEFORE INSERT on crm_activity) and the NOT NULL on crm_activity.stage_at; same test
--
-- Static SQL only. Every replaced body is copied from its latest definition
-- (named beside it) and each edit is marked "#4571 W2".
--
-- ROLLBACK (no down file): first count and delete ops_work_links rows of kind
-- call and booking (say how many on #4571), then restore
-- ops_work_links_kind_check from 20281121034420; drop ops_work_link_remove,
-- ops_work_link_add, ops_4571_call_outcome_label and the trigger
-- ops_4571_activity_stage_at (and its function); drop the crm_activity
-- columns call_outcome, duration_seconds, stage_at (with their checks and
-- crm_activity_counted) and the crm_record_identifiers columns status,
-- bad_reason, bad_at, bad_by (with their checks). Restore ops_validate_card,
-- ops_subtasks_json and ops_cards_json from 20281130014571; ops_link_label
-- and ops_links_check from 20281121034420; ops_link_search and crm_record_log
-- from 20271116003980; crm_activity_json from 20270820003802;
-- crm_identifiers_json from 20270831003802.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_work_links DROP CONSTRAINT ops_work_links_kind_check,
  ADD CONSTRAINT ops_work_links_kind_check CHECK (kind IN
    ('host','creator','brand','event','content','expected','card','roadmap_card','support_conversation','call','booking'));
CREATE INDEX ops_work_links_call ON public.ops_work_links (target_id) WHERE kind = 'call';

ALTER TABLE public.crm_activity
  ADD COLUMN call_outcome     text,
  ADD COLUMN duration_seconds integer,
  ADD COLUMN stage_at         text;
-- #4571 W2 gate for INVARIANT crm-call-outcome-phone-only. Dropping it lets an
-- outcome sit on an email touch; issue_4571_w2_links_calls.implementor.pg17.test.sql fails.
ALTER TABLE public.crm_activity
  ADD CONSTRAINT crm_activity_call_outcome_check CHECK (call_outcome IS NULL OR (
    kind = 'touch' AND channel = 'phone' AND direction = 'outbound'
    AND call_outcome IN ('demo_booked','spoke_follow_up','call_back','no_answer','not_interested','wrong_number'))),
  ADD CONSTRAINT crm_activity_duration_check CHECK (duration_seconds IS NULL OR (
    kind = 'touch' AND channel = 'phone' AND duration_seconds BETWEEN 0 AND 14400)),
  ADD CONSTRAINT crm_activity_stage_at_check CHECK (stage_at IS NULL OR char_length(stage_at) BETWEEN 1 AND 40);
COMMENT ON COLUMN public.crm_activity.call_outcome IS
  '#4571 W2: a call''s outcome (an outbound phone touch only): demo_booked, spoke_follow_up, call_back, no_answer, not_interested, wrong_number.';
COMMENT ON COLUMN public.crm_activity.stage_at IS
  '#4571 W2: the record''s stage when this entry was written (ops_4571_activity_stage_at fills it for every writer).';

ALTER TABLE public.crm_record_identifiers
  ADD COLUMN status     text NOT NULL DEFAULT 'ok',
  ADD COLUMN bad_reason text,
  ADD COLUMN bad_at     timestamptz,
  ADD COLUMN bad_by     text;
ALTER TABLE public.crm_record_identifiers
  ADD CONSTRAINT crm_record_identifiers_status_check CHECK (status IN ('ok','bad')),
  ADD CONSTRAINT crm_record_identifiers_bad_reason_check CHECK (bad_reason IS NULL OR bad_reason IN ('wrong_number','bounced','other')),
  ADD CONSTRAINT crm_record_identifiers_bad_pair CHECK (
    (status = 'ok'  AND bad_reason IS NULL     AND bad_at IS NULL     AND bad_by IS NULL) OR
    (status = 'bad' AND bad_reason IS NOT NULL AND bad_at IS NOT NULL AND bad_by IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 2. stage_at: one gate for every writer, then the backfill.
-- ---------------------------------------------------------------------------
-- #4571 W2 gate for INVARIANT crm-activity-stage-at-written. A stage move is
-- written in the stage it left; anything else in the record's stage now.
CREATE FUNCTION public.ops_4571_activity_stage_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.stage_at IS NULL THEN
    NEW.stage_at := CASE WHEN NEW.kind = 'stage_move' THEN NEW.from_stage
                         ELSE (SELECT r.stage FROM public.crm_records r WHERE r.id = NEW.record_id) END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_4571_activity_stage_at() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4571_activity_stage_at BEFORE INSERT ON public.crm_activity
  FOR EACH ROW EXECUTE FUNCTION public.ops_4571_activity_stage_at();
-- #4571 W2: ALWAYS, so a load run with session_replication_role = replica (a
-- data repair, a test fixture) still fills stage_at instead of failing the
-- NOT NULL below. It only fills a missing value; it never refuses a write.
ALTER TABLE public.crm_activity ENABLE ALWAYS TRIGGER ops_4571_activity_stage_at;

-- Existing rows: the latest stage move at or before the entry, else the
-- pipeline's first stage. A stage move keeps the stage it left.
UPDATE public.crm_activity a
   SET stage_at = COALESCE(
     CASE WHEN a.kind = 'stage_move' THEN a.from_stage END,
     (SELECT m.to_stage FROM public.crm_activity m
       WHERE m.record_id = a.record_id AND m.kind = 'stage_move' AND m.id <> a.id
         AND (m.occurred_at, m.created_at) <= (a.occurred_at, a.created_at)
       ORDER BY m.occurred_at DESC, m.created_at DESC, m.id DESC LIMIT 1),
     (SELECT CASE r.pipeline WHEN 'hosts' THEN 'prospect' ELSE 'identified' END FROM public.crm_records r WHERE r.id = a.record_id))
 WHERE a.stage_at IS NULL;
ALTER TABLE public.crm_activity ALTER COLUMN stage_at SET NOT NULL;
CREATE INDEX crm_activity_counted ON public.crm_activity (record_id, channel, stage_at)
  WHERE kind = 'touch' AND direction = 'outbound';

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- #4571 W2: the one server-side list of call outcomes and their words
-- (Admin's twin is CALL_OUTCOMES in mingla-admin/src/lib/crmModel.js).
CREATE FUNCTION public.ops_4571_call_outcome_label(p_outcome text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_outcome
    WHEN 'demo_booked'     THEN 'Demo booked'
    WHEN 'spoke_follow_up' THEN 'Spoke – follow up'
    WHEN 'call_back'       THEN 'Call back'
    WHEN 'no_answer'       THEN 'No answer'
    WHEN 'not_interested'  THEN 'Not interested'
    WHEN 'wrong_number'    THEN 'Wrong number'
  END
$$;
REVOKE ALL ON FUNCTION public.ops_4571_call_outcome_label(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_4571_call_outcome_label(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Link kinds call and booking
-- ---------------------------------------------------------------------------
-- From 20281121034420_issue_4420_tickets_on_work_board.sql:122. #4571 W2: call and booking labels.
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
  ELSIF p_kind = 'call' THEN
    -- #4571 W2: a call (a phone touch). Never the number or an email.
    SELECT 'Call · ' || c.name || ' · ' || COALESCE(public.ops_4571_call_outcome_label(a.call_outcome), 'logged')
           || ' · ' || to_char(a.occurred_at AT TIME ZONE 'UTC', 'FMDD Mon')
      INTO v FROM public.crm_activity a JOIN public.crm_records c ON c.id = a.record_id
     WHERE a.id = p_id AND a.kind = 'touch' AND a.channel = 'phone' AND c.deleted_at IS NULL;
  ELSIF p_kind = 'booking' THEN
    -- #4571 W2: a host demo booking. Never the booker's email or phone.
    SELECT 'Demo · ' || COALESCE(NULLIF(btrim(b.venue), ''), b.name) || ' · ' || to_char(b.call_at AT TIME ZONE 'UTC', 'FMDD Mon HH24:MI')
      INTO v FROM public.book_call_leads b WHERE b.id = p_id AND b.audience = 'host';
  END IF;
  RETURN btrim(left(COALESCE(NULLIF(btrim(v), ''), CASE WHEN v IS NOT NULL THEN 'Untitled' END), 160));
END;
$$;

-- From 20281121034420_issue_4420_tickets_on_work_board.sql:153. #4571 W2: accepts call and booking; the message names them.
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
      'message', 'Link kind must be host, creator, brand, event, content, expected, card, call, booking or support_conversation.')));
  END IF;
  IF jsonb_array_length(p_links) > 20 THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links', 'message', 'A card can link at most 20 records.'));
  END IF;
  FOR v_l IN SELECT e FROM jsonb_array_elements(p_links) e LOOP
    v_kind := CASE WHEN jsonb_typeof(v_l) = 'object' THEN v_l->>'kind' END;
    v_id := CASE WHEN jsonb_typeof(v_l) = 'object' THEN v_l->>'id' END;
    IF v_kind IS NULL OR v_kind NOT IN ('host','creator','brand','event','content','expected','card','roadmap_card','support_conversation','call','booking') THEN
      IF NOT v_bad_kind THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'links',
          'message', 'Link kind must be host, creator, brand, event, content, expected, card, call, booking or support_conversation.'));
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

-- From 20271116003980_issue_3980_wave1_work_board.sql:2282. #4571 W2: searches calls and host demo bookings.
CREATE OR REPLACE FUNCTION public.ops_link_search(p_kind text, p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; v_q text := public.ops_one_line(p_query); v_like text; v_rows jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_kind IS NULL OR p_kind NOT IN ('host','creator','brand','event','content','expected','card','call','booking') THEN
    RAISE EXCEPTION 'invalid_kind: Search for a host, creator, brand, event, content, expected event, card, call or demo booking.' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_q, '')) < 2 THEN RETURN jsonb_build_object('kind', p_kind, 'results', '[]'::jsonb); END IF;
  v_q := left(v_q, 160);
  -- %, _ and \ are searched for as typed, never as wildcards.
  v_like := replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  IF p_kind IN ('host','creator') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.name, 'sub', x.stage) ORDER BY x.prefix DESC, x.name, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT c.id, c.name, c.stage, (c.name ILIKE v_like || '%' ESCAPE E'\\') AS prefix FROM public.crm_records c
           WHERE c.deleted_at IS NULL AND c.pipeline = p_kind || 's' AND c.name ILIKE '%' || v_like || '%' ESCAPE E'\\'
           ORDER BY (c.name ILIKE v_like || '%' ESCAPE E'\\') DESC, c.name, c.id LIMIT 10) x;
  ELSIF p_kind = 'brand' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.name, 'sub', x.city) ORDER BY x.prefix DESC, x.name, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT b.id, b.name, b.city, (b.name ILIKE v_like || '%' ESCAPE E'\\') AS prefix FROM public.brands b
           WHERE b.deleted_at IS NULL AND b.name ILIKE '%' || v_like || '%' ESCAPE E'\\'
           ORDER BY (b.name ILIKE v_like || '%' ESCAPE E'\\') DESC, b.name, b.id LIMIT 10) x;
  ELSIF p_kind = 'event' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.title,
        'sub', concat_ws(' · ', x.city, CASE WHEN x.start_at IS NOT NULL THEN to_char(x.start_at AT TIME ZONE COALESCE(NULLIF(x.timezone, ''), 'UTC'), 'FMDD Mon YYYY') END,
                         CASE WHEN public.ops_event_public(x.id) THEN 'public' ELSE 'draft' END)) ORDER BY x.start_at NULLS LAST, x.title), '[]'::jsonb) INTO v_rows
    FROM (SELECT e.id, e.title, e.city, e.timezone, public.ops_event_first_start(e.id) AS start_at FROM public.events e
           WHERE e.deleted_at IS NULL AND e.title ILIKE '%' || v_like || '%' ESCAPE E'\\' AND public.ops_event_in_scope(e.id)
           ORDER BY e.created_at DESC LIMIT 10) x;
  ELSIF p_kind = 'content' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.title, 'sub', x.stage) ORDER BY x.title, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT i.id, i.title, i.stage FROM public.content_calendar_items i
           WHERE i.deleted_at IS NULL AND i.title ILIKE '%' || v_like || '%' ESCAPE E'\\' ORDER BY i.title, i.id LIMIT 10) x;
  ELSIF p_kind = 'expected' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.title, 'sub', to_char(x.expected_on, 'FMDD Mon YYYY')) ORDER BY x.expected_on, x.title), '[]'::jsonb) INTO v_rows
    FROM (SELECT z.id, z.title, z.expected_on FROM public.ops_expected_events z
           WHERE z.status = 'open' AND z.title ILIKE '%' || v_like || '%' ESCAPE E'\\' ORDER BY z.expected_on, z.title LIMIT 10) x;
  ELSIF p_kind = 'call' THEN
    -- #4571 W2: the latest calls (phone touches) of records whose name matches.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', public.ops_link_label('call', x.id),
        'sub', concat_ws(' · ', CASE x.pipeline WHEN 'hosts' THEN 'Host' ELSE 'Creator' END, x.stage_at)) ORDER BY x.occurred_at DESC, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT a.id, a.occurred_at, a.stage_at, c.pipeline FROM public.crm_activity a JOIN public.crm_records c ON c.id = a.record_id
           WHERE c.deleted_at IS NULL AND a.kind = 'touch' AND a.channel = 'phone' AND c.name ILIKE '%' || v_like || '%' ESCAPE E'\\'
           ORDER BY a.occurred_at DESC, a.id LIMIT 10) x;
  ELSIF p_kind = 'booking' THEN
    -- #4571 W2: host demo bookings by venue or booker name; no contact details.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', public.ops_link_label('booking', x.id), 'sub', x.status) ORDER BY x.call_at DESC, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT b.id, b.call_at, b.status FROM public.book_call_leads b
           WHERE b.audience = 'host' AND (COALESCE(b.venue, '') ILIKE '%' || v_like || '%' ESCAPE E'\\' OR b.name ILIKE '%' || v_like || '%' ESCAPE E'\\')
           ORDER BY b.call_at DESC, b.id LIMIT 10) x;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.title, 'sub', 'Card ' || x.number) ORDER BY x.number DESC), '[]'::jsonb) INTO v_rows
    FROM (SELECT w.id, w.title, w.number FROM public.ops_work_cards w
           WHERE w.archived_at IS NULL AND (w.title ILIKE '%' || v_like || '%' ESCAPE E'\\' OR w.number::text = v_q)
           ORDER BY w.number DESC LIMIT 10) x;
  END IF;
  RETURN jsonb_build_object('kind', p_kind, 'results', v_rows);
END;
$$;

-- #4571 W2: one link added to an open card by a server path (a call logged
-- with its Work card). Internal: service only. Writes one card event and
-- moves the card's revision; an existing link is left as it is.
CREATE FUNCTION public.ops_work_link_add(p_card_id uuid, p_kind text, p_target_id uuid, p_actor text, p_via text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE c public.ops_work_cards; n public.ops_work_cards; v_label text;
BEGIN
  IF p_kind = 'support_conversation' THEN
    RAISE EXCEPTION 'people_only: A person links support conversations to a card.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF c.status = 'done' THEN
    RAISE EXCEPTION '%', format('work_card_closed: Card %s is closed. Reopen it first.', c.number) USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = p_kind AND l.target_id = p_target_id) THEN
    RETURN false;
  END IF;
  v_label := public.ops_link_label(p_kind, p_target_id);
  IF v_label IS NULL THEN
    RAISE EXCEPTION '%', format('invalid_link: Linked %s %s does not exist or was removed.', p_kind, p_target_id) USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.ops_work_links l WHERE l.card_id = c.id) >= 20 THEN
    RAISE EXCEPTION '%', format('too_many_links: Card %s already links 20 records. Remove one first.', c.number) USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ops_work_links (card_id, kind, target_id, label, added_by, added_via)
  VALUES (c.id, p_kind, p_target_id, v_label, p_actor, p_via);
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = p_actor, updated_via = p_via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  PERFORM public.ops_card_event(c.id, p_actor, p_via, 'links', format('Linked %s to Card %s', v_label, c.number),
    NULL, jsonb_build_object('kind', p_kind, 'id', p_target_id), c.revision, n.revision);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_work_link_add(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_work_link_add(uuid, text, uuid, text, text) TO service_role;

-- #4571 W2: take one link off a card. A subtask's links are its own facts
-- once made, so they stay, unless p_from_subtasks: then the same link also
-- leaves the card's open direct subtasks (depth 1), in this one step. Every
-- change goes through ops_links_set, so the support conversation rule holds.
-- A link that is a card's anchor stays (change the anchor first); a subtask
-- anchored on it keeps it. One card event per changed card.
CREATE FUNCTION public.ops_work_link_remove(p_card_id uuid, p_kind text, p_target_id uuid, p_from_subtasks boolean, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; s public.ops_work_cards; sn public.ops_work_cards;
        v_today date; v_label text; v_changed jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_today := public.ops_today(NULL);
  IF p_card_id IS NULL OR p_kind IS NULL OR p_target_id IS NULL THEN
    RAISE EXCEPTION 'invalid_link: Say which card and which link to remove.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: Reload the card, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_card_id, p_expected_revision);
  SELECT l.label INTO v_label FROM public.ops_work_links l WHERE l.card_id = c.id AND l.kind = p_kind AND l.target_id = p_target_id;
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'stale_write: That link is not on this card any more. Reload the card.' USING ERRCODE = 'PT409';
  END IF;
  IF c.anchor_kind = p_kind AND c.anchor_id = p_target_id THEN
    RAISE EXCEPTION '%', format('anchor_link: Card %s is counted from %s. Pick another event for it to count from first.', c.number, v_label) USING ERRCODE = '22023';
  END IF;
  PERFORM public.ops_links_set(c.id, COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label))
                                                 FROM public.ops_work_links l WHERE l.card_id = c.id AND NOT (l.kind = p_kind AND l.target_id = p_target_id)), '[]'::jsonb),
                               v.actor_email, v.via);
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'links', format('Removed %s from Card %s', v_label, c.number),
    jsonb_build_object('kind', p_kind, 'id', p_target_id), NULL, c.revision, n.revision);
  IF COALESCE(p_from_subtasks, false) THEN
    FOR s IN SELECT w.* FROM public.ops_work_cards w
              WHERE w.parent_id = c.id AND w.archived_at IS NULL AND w.status <> 'done'
                AND NOT (w.anchor_kind IS NOT DISTINCT FROM p_kind AND w.anchor_id IS NOT DISTINCT FROM p_target_id)
                AND EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = w.id AND l.kind = p_kind AND l.target_id = p_target_id)
              ORDER BY w.position, w.number FOR UPDATE LOOP
      PERFORM public.ops_links_set(s.id, COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label))
                                                     FROM public.ops_work_links l WHERE l.card_id = s.id AND NOT (l.kind = p_kind AND l.target_id = p_target_id)), '[]'::jsonb),
                                   v.actor_email, v.via);
      UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
       WHERE id = s.id RETURNING * INTO sn;
      PERFORM public.ops_card_event(s.id, v.actor_email, v.via, 'links', format('Removed %s from Card %s (with Card %s)', v_label, s.number, c.number),
        jsonb_build_object('kind', p_kind, 'id', p_target_id), NULL, s.revision, sn.revision);
      v_changed := v_changed || jsonb_build_array(s.number);
    END LOOP;
  END IF;
  SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = c.id;
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'subtasks_changed', v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.ops_work_link_remove(uuid, text, uuid, boolean, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_work_link_remove(uuid, text, uuid, boolean, bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Subtasks start with their parent's links; tiles and rows carry labels.
-- ---------------------------------------------------------------------------
-- From 20281130014571_issue_4571_w1_people_and_goals.sql:227. #4571 W2: a new subtask sent with no links takes its parent's, except support conversations.
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
  v_links_inherited boolean := false; -- #4571 W2
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
  -- #4571 W2 gate for INVARIANT ops-subtask-inherits-links-not-support: a new
  -- subtask sent with no links key starts with its parent's links, except
  -- support conversations (only Support staff set those, so copying them
  -- would make ops_links_set refuse everyone else). links: [] means none.
  -- Deleting this branch leaves subtasks with no links and
  -- issue_4571_w2_links_calls.implementor.pg17.test.sql fails.
  IF v_parent_id IS NOT NULL AND p_mode <> 'update' AND NOT (p_item ? 'links') THEN
    v_links := public.ops_links_check(COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id) ORDER BY l.added_at, l.kind, l.target_id)
        FROM public.ops_work_links l
       WHERE l.card_id = v_parent_id AND l.kind <> 'support_conversation'
         AND public.ops_link_label(l.kind, l.target_id) IS NOT NULL), '[]'::jsonb));
    v_links_inherited := true;
  ELSE
    v_links := public.ops_links_check(p_item->'links');
  END IF;
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
  ELSIF NOT v_links_inherited THEN  -- #4571 W2: an inherited event link is not the subtask's anchor
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

-- From 20281130014571_issue_4571_w1_people_and_goals.sql:1323. #4571 W2: each subtask row carries its links.
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
      -- #4571 W2: a subtask row shows its links as chips.
      'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label) ORDER BY l.added_at, l.kind, l.target_id)
                           FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb),
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

-- From 20281130014571_issue_4571_w1_people_and_goals.sql:1349. #4571 W2: the board shape carries each link's stored label.
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
           -- only full checks each target still exists. #4571 W2: the board carries the
           -- stored label too, for the chips on a tile.
           jsonb_agg(CASE WHEN p_shape = 'full'
                          THEN jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label,
                                                  'exists', public.ops_link_label(l.kind, l.target_id) IS NOT NULL)
                          ELSE jsonb_build_object('kind', l.kind, 'id', l.target_id, 'label', l.label) END
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
-- 6. Calls: outcome, length, the number dialled, the Work card.
-- ---------------------------------------------------------------------------
-- From 20270820003802_issue_3802_wave1_crm_pipelines.sql:871. #4571 W2: outcome, duration_seconds, stage_at.
CREATE OR REPLACE FUNCTION public.crm_activity_json(a public.crm_activity) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'actor_email', a.actor_email,
    'actor_name', CASE WHEN a.actor_email IS NULL THEN 'System' ELSE public.crm_display_name(a.actor_email) END,
    'via', a.via, 'body', a.body, 'from_stage', a.from_stage, 'to_stage', a.to_stage,
    'channel', a.channel, 'direction', a.direction, 'message_ref', a.message_ref,
    'reply_class', a.reply_class, 'occurred_at', a.occurred_at,
    -- #4571 W2: a call's outcome and length, and the stage it was made in.
    'outcome', a.call_outcome, 'duration_seconds', a.duration_seconds, 'stage_at', a.stage_at)
$$;

-- From 20270831003802_issue_3802_wave4_agent_write_setup.sql:603. #4571 W2: each identifier's id and ok/bad status.
CREATE OR REPLACE FUNCTION public.crm_identifiers_json(p_record_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'platform', i.platform, 'value', i.value, 'key', i.value_key,
                                               'id', i.id, 'status', i.status, 'bad_reason', i.bad_reason)  -- #4571 W2
                            ORDER BY i.kind, i.value_key), '[]'::jsonb)
  FROM public.crm_record_identifiers i
  WHERE i.record_id = p_record_id
$$;

-- From 20271116003980_issue_3980_wave1_work_board.sql (crm_record_log). #4571 W2: outcome, duration_seconds, identifier(_id), work_card(_id), suggest_stage.
CREATE OR REPLACE FUNCTION public.crm_record_log(p_id uuid, p_entry jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v           record;
  v_res       jsonb;
  v_rec       public.crm_records;
  v_act       public.crm_activity;
  v_clean     jsonb;
  v_kind      text;
  v_body      text;
  v_channel   text;
  v_direction text;
  v_ref       text;
  v_class     text;
  v_when      timestamptz;
  v_now       timestamptz := clock_timestamp();
  v_other     jsonb;
  -- #4571 W2: a call's outcome, length, the number dialled and its Work card.
  v_outcome   text;
  v_duration  integer;
  v_ident     public.crm_record_identifiers;
  v_ident_in  text;
  v_card      public.ops_work_cards;
  v_card_in   text;
  v_suggest   jsonb;
  c_call_keys constant text[] := ARRAY['outcome','duration_seconds','identifier_id','identifier','work_card_id','work_card'];
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_res := public.crm_request_begin(v.actor_email, p_request_key, 'crm_record_log');
  IF v_res IS NOT NULL THEN
    RETURN v_res;
  END IF;

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id AND c.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: That record is no longer here. It may have been deleted.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.ops_claim_assert('crm_record', v_rec.id, v.actor_email, v.via);
  -- Normalised and checked in the shared helper (kind, text, channel,
  -- direction, reply classification, message reference, and the time window).
  -- #4571 W2: the call keys are checked below; the shared helper checks the rest.
  v_clean     := public.crm_validate_fields(v_rec.pipeline,
                   CASE WHEN jsonb_typeof(p_entry) = 'object' THEN p_entry - c_call_keys ELSE p_entry END, 'log');
  v_kind      := v_clean->>'kind';
  v_body      := v_clean->>'body';
  v_channel   := v_clean->>'channel';
  v_direction := v_clean->>'direction';
  v_ref       := v_clean->>'message_ref';
  v_class     := v_clean->>'reply_class';
  v_when      := COALESCE((v_clean->>'occurred_at')::timestamptz, v_now);

  -- #4571 W2 gate for INVARIANT crm-call-outcome-phone-only (backstopped by
  -- crm_activity_call_outcome_check): an outcome only on a call you made.
  IF jsonb_typeof(p_entry->'outcome') IS NOT NULL AND jsonb_typeof(p_entry->'outcome') <> 'null' THEN
    v_outcome := CASE WHEN jsonb_typeof(p_entry->'outcome') = 'string' THEN btrim(p_entry->>'outcome') END;
    IF public.ops_4571_call_outcome_label(v_outcome) IS NULL THEN
      RAISE EXCEPTION 'invalid_outcome: A call outcome is one of demo_booked, spoke_follow_up, call_back, no_answer, not_interested or wrong_number.' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_kind = 'touch' AND v_channel = 'phone' AND v_direction = 'outbound') THEN
      RAISE EXCEPTION 'outcome_not_a_call: Only a call you made (an outbound touch on phone) has an outcome. Log this without one.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF jsonb_typeof(p_entry->'duration_seconds') IS NOT NULL AND jsonb_typeof(p_entry->'duration_seconds') <> 'null' THEN
    IF jsonb_typeof(p_entry->'duration_seconds') <> 'number' OR (p_entry->>'duration_seconds') !~ '^\d{1,5}$'
       OR (p_entry->>'duration_seconds')::integer > 14400 THEN
      RAISE EXCEPTION 'invalid_duration: A call lasts whole seconds, from 0 to 14,400 (four hours).' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_kind = 'touch' AND v_channel = 'phone') THEN
      RAISE EXCEPTION 'duration_not_a_call: Only a call has a length.' USING ERRCODE = '22023';
    END IF;
    v_duration := (p_entry->>'duration_seconds')::integer;
  END IF;
  -- The number dialled: its id (Admin) or the number as written (agents).
  v_ident_in := COALESCE(CASE WHEN jsonb_typeof(p_entry->'identifier_id') = 'string' THEN btrim(p_entry->>'identifier_id') END,
                         CASE WHEN jsonb_typeof(p_entry->'identifier') = 'string' THEN btrim(p_entry->>'identifier') END);
  IF v_ident_in IS NOT NULL AND v_ident_in <> '' THEN
    IF v_ident_in ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT * INTO v_ident FROM public.crm_record_identifiers i
       WHERE i.id = v_ident_in::uuid AND i.record_id = v_rec.id AND i.kind = 'phone';
    ELSE
      SELECT * INTO v_ident FROM public.crm_record_identifiers i
       WHERE i.record_id = v_rec.id AND i.kind = 'phone'
         AND (i.value = v_ident_in OR right(regexp_replace(i.value_key, '\D', '', 'g'), 9) = right(regexp_replace(v_ident_in, '\D', '', 'g'), 9))
       ORDER BY i.created_at LIMIT 1;
    END IF;
    IF v_ident.id IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_identifier: That number is not one of "%s"''s phone numbers. Use a number on the card.', v_rec.name) USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_outcome = 'wrong_number' AND v_ident.id IS NULL THEN
    RAISE EXCEPTION 'identifier_required: Say which number was wrong, so it is marked and nobody calls it again.' USING ERRCODE = '22023';
  END IF;
  -- The Work card this call belongs to: its id, or its number.
  v_card_in := COALESCE(CASE WHEN jsonb_typeof(p_entry->'work_card_id') = 'string' THEN btrim(p_entry->>'work_card_id') END,
                        CASE WHEN jsonb_typeof(p_entry->'work_card') IN ('string','number') THEN btrim(p_entry->>'work_card') END);
  IF v_card_in IS NOT NULL AND v_card_in <> '' THEN
    IF v_card_in ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.id = v_card_in::uuid AND w.archived_at IS NULL;
    ELSIF v_card_in ~ '^#?[0-9]{1,9}$' THEN
      SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.number = ltrim(v_card_in, '#')::bigint AND w.archived_at IS NULL;
    END IF;
    IF v_card.id IS NULL THEN
      RAISE EXCEPTION 'invalid_work_card: That Work card is not on the board. Send its number or the id Mingla gave.' USING ERRCODE = '22023';
    ELSIF v_card.status = 'done' THEN
      RAISE EXCEPTION '%', format('work_card_closed: Card %s is closed. Reopen it first, or log the call without a card.', v_card.number) USING ERRCODE = '22023';
    ELSIF NOT (v_kind = 'touch' AND v_channel = 'phone') THEN
      RAISE EXCEPTION 'work_card_not_a_call: Only a call is linked to a Work card from the log.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- What an agent may log. A note and a reply always; an outbound touch only
  -- as the first message to someone who has never been contacted, and never
  -- on a record that carries a contact rule. A person is not held to this.
  IF v.via IS NOT NULL AND v_kind = 'touch' AND v_direction = 'outbound' THEN
    IF v_rec.contact_rule = 'do_not_contact' THEN
      RAISE EXCEPTION '%', format('do_not_contact: "%s" is marked Do not contact: %s. Nothing was logged. Do not message them; tell your person.',
          v_rec.name, v_rec.contact_rule_reason) USING ERRCODE = '42501';
    ELSIF v_rec.contact_rule = 'warm_intro_only' THEN
      RAISE EXCEPTION '%', format('warm_intro_only: "%s" is marked Warm intro only: %s. Nothing was logged. Ask your person to make the introduction.',
          v_rec.name, v_rec.contact_rule_reason) USING ERRCODE = '42501';
    END IF;
    -- The same person may sit on another record: a rule on any record that
    -- shares a contact detail with this one stops the touch too.
    SELECT h->'record' INTO v_other
      FROM jsonb_array_elements(public.crm_identifier_matches(v_rec.pipeline,
             (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'value', i.value, 'value_key', i.value_key)), '[]'::jsonb)
                FROM public.crm_record_identifiers i WHERE i.record_id = v_rec.id),
             v_rec.id)) WITH ORDINALITY AS t(h, ord)
     WHERE (h->'record'->>'contact_rule') IS NOT NULL
     ORDER BY ord LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION '%', format('%s: "%s" shares a contact detail with "%s", which is marked %s: %s. Nothing was logged. %s',
          v_other->>'contact_rule', v_rec.name, v_other->>'name',
          CASE v_other->>'contact_rule' WHEN 'do_not_contact' THEN 'Do not contact' ELSE 'Warm intro only' END,
          v_other->>'contact_rule_reason',
          CASE v_other->>'contact_rule' WHEN 'do_not_contact' THEN 'Do not message them; tell your person.'
                                        ELSE 'Ask your person to make the introduction.' END)
        USING ERRCODE = '42501';
    END IF;
    IF v_body IS NULL THEN
      RAISE EXCEPTION 'invalid_body: Log the message you sent, word for word.' USING ERRCODE = '22023';
    END IF;
    -- Counted by rows, not by when a touch says it happened.
    IF EXISTS (SELECT 1 FROM public.crm_activity a WHERE a.record_id = v_rec.id AND a.kind = 'touch') THEN
      RAISE EXCEPTION '%', format('needs_a_person: "%s" has already been contacted, so a follow-up or an answer is your person''s to send and log. Tell them what you would say.',
          v_rec.name) USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, channel, direction,
                                   message_ref, reply_class, occurred_at, created_at,
                                   call_outcome, duration_seconds, stage_at)  -- #4571 W2
  VALUES (v_rec.id, v_kind, v.actor_email, v.via, v_body, v_channel, v_direction, v_ref, v_class, v_when, v_now,
          v_outcome, v_duration, v_rec.stage)
  RETURNING * INTO v_act;
  -- #4571 W2: a wrong number is marked bad in the same transaction, so
  -- nobody dials it again; a call sent with a Work card is linked to it.
  IF v_outcome = 'wrong_number' THEN
    UPDATE public.crm_record_identifiers
       SET status = 'bad', bad_reason = 'wrong_number', bad_at = v_now, bad_by = v.actor_email
     WHERE id = v_ident.id AND status = 'ok';
  END IF;
  IF v_card.id IS NOT NULL THEN
    PERFORM public.ops_work_link_add(v_card.id, 'call', v_act.id, v.actor_email, v.via);
  END IF;
  UPDATE public.crm_records SET updated_by = v.actor_email, updated_at = v_now WHERE id = v_rec.id;
  -- The audit row never carries what was said.
  PERFORM public.crm_audit(v.actor_email, 'crm.log_add', 'crm_record', v_rec.id::text,
    jsonb_strip_nulls(jsonb_build_object('activity_id', v_act.id, 'kind', v_kind, 'channel', v_channel,
                                         'direction', v_direction, 'via', v.via)));

  SELECT * INTO v_rec FROM public.crm_records c WHERE c.id = p_id;
  v_res := jsonb_build_object('activity', public.crm_activity_json(v_act), 'record', public.crm_record_json(v_rec));
  -- #4571 W2: a suggested next step, never applied (stage moves stay explicit).
  v_suggest := CASE
    WHEN v_outcome = 'demo_booked' THEN
      jsonb_build_object('stage', NULL, 'note', 'Send the card''s scheduler link so the demo is booked and linked.')
    WHEN v_outcome = 'not_interested' AND v_rec.stage NOT IN ('lost', 'passed') THEN
      jsonb_build_object('stage', CASE v_rec.pipeline WHEN 'hosts' THEN 'lost' ELSE 'passed' END,
                         'note', format('Move the card to %s with a reason.', CASE v_rec.pipeline WHEN 'hosts' THEN 'Lost' ELSE 'Passed' END))
    WHEN v_outcome = 'wrong_number' AND NOT EXISTS (SELECT 1 FROM public.crm_record_identifiers i
                                                    WHERE i.record_id = v_rec.id AND i.kind = 'phone' AND i.status = 'ok') THEN
      jsonb_build_object('stage', NULL, 'note', 'Find a new number.')
  END;
  IF v_suggest IS NOT NULL THEN v_res := v_res || jsonb_build_object('suggest_stage', v_suggest); END IF;
  IF v_card.id IS NOT NULL THEN v_res := v_res || jsonb_build_object('work_card', jsonb_build_object('id', v_card.id, 'number', v_card.number)); END IF;
  PERFORM public.crm_request_finish(v.actor_email, p_request_key, 'crm_record_log', v_res);
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crm_record_log(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_log(uuid, jsonb, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ops_link_label(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_links_check(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_link_search(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_link_search(text, text) TO authenticated, service_role;

COMMIT;
