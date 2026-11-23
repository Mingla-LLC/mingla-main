-- Issue #4571 (Work pipeline redesign), rework after the final test (FAIL,
-- tip ffcb44bc6d). Replaces six functions; adds no table, column or function.
--
--   1. crm_record_merge moves the duplicate's crm_email_log rows to the kept
--      card (skipping a message the kept card already has), and lists them in
--      the merge log (moved.emails); crm_record_unmerge moves them back.
--   2. crm_record_unmerge keeps INVARIANT crm-demo-before-demo-booked. When
--      the kept host sits in Demo booked, Onboarded or Live, is not
--      grandfathered, and its only booked demos are the ones going back to the
--      duplicate, the undo is refused with demo_in_use and writes nothing, the
--      same rule as crm_demo_unlink. Chosen over moving the kept card back by
--      itself: an automatic move would write a stage change nobody asked for,
--      and would undo real progress if the card moved again after the merge.
--      Refusing never invents state; the person moves the card back (a logged
--      move with their name), then undoes the merge.
--   3. ops_4571_activity_stage_at (W2's gate for INVARIANT
--      crm-activity-stage-at-written): a touch dated before the card's latest
--      stage move takes the stage the card was in at occurred_at, from the
--      stage-move history (crm_4571_stage_at), as cadence_sweep.py does. A
--      touch dated now, or written in the same transaction as the move after
--      it, keeps the card's stage now.
--   4. crm_outreach_numbers: Emails sent also counts outbound email touches
--      logged by hand (by who logged them), unless the mail log already has
--      outbound mail to that card that Lagos day, so one email counts once.
--   5. crm_cadence_sweep_configure keeps the stored report card when
--      p_report_card_id is not passed, and owns the pg_cron entry: Dry run or
--      On schedules issue_4571_crm_cadence_sweep, Off unschedules it. This
--      migration unschedules it, so the sweep ships unscheduled (the spec's
--      cutover). RUNBOOK change to 20281126084571: step 1 is "it ships with no
--      cron entry"; step 2 (Dry run) creates it; Switch-off removes it.
--   6. ops_link_search shows stage labels, not stage ids.
--
-- Email identifiers (tester P3, kept on purpose): crm_email_log_ingest matches
-- every email identifier on a card, ok or bad, not only ok ones. The Mac
-- cadence_sweep.py this replaces counts info@ mail to every email identifier
-- (its query has no status filter), and the W6c cadence must match it line by
-- line for the three-night dry-run comparison. A bounced address is marked
-- bad for outreach; mail that did reach it is still a real touch.
--
-- INVARIANT crm-demo-before-demo-booked: gate crm_record_unmerge (this file)
-- with crm_4571_demo_stage_guard; test
-- supabase/migrations/__tests__/issue_4571_w6d_rework.implementor.pg17.test.sql
--
-- ROLLBACK (no down file): re-run the CREATE OR REPLACE bodies of
-- crm_record_merge and crm_record_unmerge from 20281126064571,
-- crm_outreach_numbers from 20281126074571, crm_cadence_sweep_configure and
-- the cron DO block from 20281126084571, and ops_4571_activity_stage_at from
-- 20281126024571.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- From 20281126024571. #4571 rework: a backdated entry takes its stage from
-- the history at occurred_at.
CREATE OR REPLACE FUNCTION public.ops_4571_activity_stage_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.stage_at IS NULL THEN
    IF NEW.kind = 'stage_move' THEN
      NEW.stage_at := NEW.from_stage;
    ELSIF NEW.occurred_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.crm_activity m
             WHERE m.record_id = NEW.record_id AND m.kind = 'stage_move' AND m.occurred_at > NEW.occurred_at
               -- a move written earlier in this same transaction (a merge, the
               -- sweep, a fixture) is not history yet: the entry is not backdated.
               AND m.created_at < now()) THEN
      NEW.stage_at := public.crm_4571_stage_at(NEW.record_id, NEW.occurred_at);
    ELSE
      NEW.stage_at := (SELECT r.stage FROM public.crm_records r WHERE r.id = NEW.record_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.crm_email_log_ingest(text, jsonb) IS
  'Issue #4571 W6b. Log 1 to 50 emails against host and creator cards: outbound by To and Cc, inbound by From, matched to email identifiers (ok or bad, as cadence_sweep.py counts them) of live, not archived cards. Idempotent by (message id, card). Keeps the subject and the first 300 characters of the snippet. Mail that matches no card is not stored. Fed by the "Mail logging" agent run through the connector''s log_emails; Mingla stores no mail key. crm_ctx(): the Hosts and Creators area, agents included.';

-- From 20281126064571. #4571 rework: logged emails move with the merge.
CREATE OR REPLACE FUNCTION public.crm_record_merge(p_keep uuid, p_drop uuid, p_request_key text) RETURNS jsonb
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
  -- #4571 rework: the duplicate's logged emails (W6b crm_email_log), unless
  -- the kept card already has that message (one row per message per card).
  WITH m AS (UPDATE public.crm_email_log e SET record_id = v_keep.id
              WHERE e.record_id = v_drop.id
                AND NOT EXISTS (SELECT 1 FROM public.crm_email_log k WHERE k.record_id = v_keep.id AND k.message_id = e.message_id)
             RETURNING e.id)
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_ids FROM m;
  v_moved := v_moved || jsonb_build_object('emails', to_jsonb(v_ids));
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
  VALUES (v_drop.id, 'note', v_actor, format('Merged into %s. Its touches, notes, logged emails, contacts, people, demos, files and Work links moved there.', v_keep.name), v_now, v_now);
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
      'demos', jsonb_array_length(v_moved->'demos'), 'emails', jsonb_array_length(v_moved->'emails'), 'sources', jsonb_array_length(v_moved->'sources'),
      'files', jsonb_array_length(v_moved->'files'), 'links', jsonb_array_length(v_moved->'links') + jsonb_array_length(v_moved->'removed_links')),
    'stage_to', v_stage_to, 'stage_note', v_stage_note, 'undo_until', v_now + interval '7 days', 'replayed', false);
  UPDATE public.crm_record_merges SET result = v_result WHERE id = v_merge;
  PERFORM public.crm_audit(v_actor, 'crm.merge', 'crm_record', v_keep.id::text,
    jsonb_build_object('merge_id', v_merge, 'drop_id', v_drop.id, 'moved', v_result->'moved', 'stage_to', v_stage_to));
  RETURN v_result;
END;
$function$;

-- From 20281126064571. #4571 rework: the demo rule, and logged emails move back.
CREATE OR REPLACE FUNCTION public.crm_record_unmerge(p_merge_id uuid) RETURNS jsonb
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
  -- #4571 rework gate for INVARIANT crm-demo-before-demo-booked (the
  -- crm_demo_unlink rule): the demos go back to the duplicate, so a kept host
  -- in Demo booked, Onboarded or Live that would be left with no booked demo
  -- (and is not grandfathered) is refused. The undo writes nothing then; the
  -- person moves the kept card back first, as for an unlink.
  IF v_keep.pipeline = 'hosts' AND v_keep.stage IN ('meeting', 'onboarded', 'live') AND v_keep.demo_rule_exempt_at IS NULL
     AND EXISTS (SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                  WHERE d.record_id = v_keep.id AND k.status IN ('booked', 'moved')
                    AND d.booking_id IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'demos') e))
     AND NOT EXISTS (SELECT 1 FROM public.crm_record_demos d JOIN public.book_call_leads k ON k.id = d.booking_id
                      WHERE d.record_id = v_keep.id AND k.status IN ('booked', 'moved')
                        AND d.booking_id NOT IN (SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(m.moved->'demos') e)) THEN
    RAISE EXCEPTION '%', format('demo_in_use: %s is in %s on the demo that came from %s, and undoing the merge sends that demo back. Move %s back to %s first, then undo the merge.',
      v_keep.name, public.crm_stage_def('hosts', v_keep.stage)->>'label', v_drop.name, v_keep.name,
      COALESCE(public.crm_stage_def('hosts', CASE WHEN m.moved->>'keep_stage_before' IN ('meeting', 'onboarded', 'live') THEN 'replied'
                                                ELSE m.moved->>'keep_stage_before' END)->>'label', 'Replied'))
      USING ERRCODE = '22023';
  END IF;

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
  UPDATE public.crm_email_log e SET record_id = v_drop.id
   WHERE e.record_id = v_keep.id AND e.id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(COALESCE(m.moved->'emails', '[]'::jsonb)) x)
     AND NOT EXISTS (SELECT 1 FROM public.crm_email_log d WHERE d.record_id = v_drop.id AND d.message_id = e.message_id);
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
COMMENT ON FUNCTION public.crm_record_merge(uuid, uuid, text) IS
  'Issue #4571 W6a (rework). Merge a duplicate card (p_drop) into the card to keep (p_keep): same pipeline, both on the board, people only. Moves touches and notes, logged emails (crm_email_log) the keeper lacks, identifiers the keeper lacks, owners and watchers (never both, at most 10 each), demos, imports, files and host/creator Work links (with card events). Stage moves stay on each card. The keeper takes the later stage only if crm_record_move_stage (the W4 rule) allows it. The duplicate is archived with merged_into_id. Logged in crm_record_merges; crm_record_unmerge undoes it within 7 days. INVARIANT crm-merge-keeps-history.';
COMMENT ON FUNCTION public.crm_record_unmerge(uuid) IS
  'Issue #4571 W6a (rework). Undo a merge within 7 days: every row crm_record_merge moved (logged emails included) goes back to the duplicate, removed duplicate Work links come back, and the duplicate is unarchived. Refused (demo_in_use, nothing written) when the kept host is in Demo booked, Onboarded or Live and the demos going back are its only booked ones (INVARIANT crm-demo-before-demo-booked). A stage the merge moved otherwise stays (stage_note says so). People only.';

-- From 20281126074571. #4571 rework: hand-logged email touches count.
CREATE OR REPLACE FUNCTION public.crm_outreach_numbers(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_lo timestamptz; v_hi timestamptz; v_days jsonb; v_reps jsonb; v_tot jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 91 THEN
    RAISE EXCEPTION 'invalid_window: Pick a window of 1 to 92 days.' USING ERRCODE = '22023';
  END IF;
  v_lo := p_from::timestamp AT TIME ZONE 'Africa/Lagos';
  v_hi := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Lagos';
  WITH calls AS (
    SELECT a.actor_email AS rep, (a.occurred_at AT TIME ZONE 'Africa/Lagos')::date AS day, a.call_outcome
      FROM public.crm_activity a
     WHERE a.kind = 'touch' AND a.channel = 'phone' AND a.direction = 'outbound'
       AND a.actor_email IS NOT NULL AND a.occurred_at >= v_lo AND a.occurred_at < v_hi
  ),
  call_days AS (
    SELECT c.rep, c.day, count(*)::integer AS calls,
           count(*) FILTER (WHERE c.call_outcome IN ('demo_booked', 'spoke_follow_up', 'call_back', 'not_interested'))::integer AS connected,
           count(*) FILTER (WHERE c.call_outcome = 'demo_booked')::integer AS demos_booked,
           jsonb_build_object(
             'demo_booked', count(*) FILTER (WHERE c.call_outcome = 'demo_booked'),
             'spoke_follow_up', count(*) FILTER (WHERE c.call_outcome = 'spoke_follow_up'),
             'call_back', count(*) FILTER (WHERE c.call_outcome = 'call_back'),
             'no_answer', count(*) FILTER (WHERE c.call_outcome = 'no_answer'),
             'not_interested', count(*) FILTER (WHERE c.call_outcome = 'not_interested'),
             'wrong_number', count(*) FILTER (WHERE c.call_outcome = 'wrong_number'),
             'no_outcome', count(*) FILTER (WHERE c.call_outcome IS NULL)) AS outcomes
      FROM calls c GROUP BY c.rep, c.day
  ),
  linked AS (
    SELECT d.linked_by AS rep, (d.linked_at AT TIME ZONE 'Africa/Lagos')::date AS day, count(*)::integer AS demos_linked
      FROM public.crm_record_demos d
     WHERE d.linked_by IS NOT NULL AND d.linked_at >= v_lo AND d.linked_at < v_hi
     GROUP BY 1, 2
  ),
  mail AS (
    SELECT CASE WHEN e.direction = 'outbound' THEN e.from_address ELSE e.mailbox END AS rep,
           (e.sent_at AT TIME ZONE 'Africa/Lagos')::date AS day,
           count(DISTINCT e.message_id) FILTER (WHERE e.direction = 'outbound')::integer AS emails_sent,
           count(DISTINCT e.message_id) FILTER (WHERE e.direction = 'inbound')::integer AS replies
      FROM public.crm_email_log e
     WHERE e.sent_at >= v_lo AND e.sent_at < v_hi
     GROUP BY 1, 2
  ),
  -- #4571 rework: an outbound email touch logged by hand counts for the
  -- person who logged it, unless the mail log already has outbound mail to
  -- that card that Lagos day (the same email, counted once).
  hand AS (
    SELECT a.actor_email AS rep, (a.occurred_at AT TIME ZONE 'Africa/Lagos')::date AS day, count(*)::integer AS emails_sent
      FROM public.crm_activity a
     WHERE a.kind = 'touch' AND a.channel = 'email' AND a.direction = 'outbound'
       AND a.actor_email IS NOT NULL AND a.occurred_at >= v_lo AND a.occurred_at < v_hi
       AND NOT EXISTS (SELECT 1 FROM public.crm_email_log e
                        WHERE e.record_id = a.record_id AND e.direction = 'outbound'
                          AND (e.sent_at AT TIME ZONE 'Africa/Lagos')::date = (a.occurred_at AT TIME ZONE 'Africa/Lagos')::date)
     GROUP BY 1, 2
  ),
  keys AS (
    SELECT rep, day FROM call_days UNION SELECT rep, day FROM linked UNION SELECT rep, day FROM mail UNION SELECT rep, day FROM hand
  ),
  daily AS (
    SELECT k.rep, k.day,
           COALESCE(c.calls, 0) AS calls, COALESCE(c.connected, 0) AS connected, COALESCE(c.demos_booked, 0) AS demos_booked,
           COALESCE(c.outcomes, '{}'::jsonb) AS outcomes, COALESCE(l.demos_linked, 0) AS demos_linked,
           COALESCE(m.emails_sent, 0) + COALESCE(h.emails_sent, 0) AS emails_sent, COALESCE(m.replies, 0) AS replies
      FROM keys k
      LEFT JOIN call_days c ON c.rep = k.rep AND c.day = k.day
      LEFT JOIN linked l ON l.rep = k.rep AND l.day = k.day
      LEFT JOIN mail m ON m.rep = k.rep AND m.day = k.day
      LEFT JOIN hand h ON h.rep = k.rep AND h.day = k.day
  )
  SELECT COALESCE(jsonb_agg(r.j ORDER BY r.calls DESC, r.emails_sent DESC, r.rep), '[]'::jsonb) INTO v_reps
    FROM (
      SELECT d.rep, sum(d.calls) AS calls, sum(d.emails_sent) AS emails_sent,
             jsonb_build_object(
               'rep', d.rep, 'name', public.ops_name(d.rep),
               'is_team', EXISTS (SELECT 1 FROM public.admin_team_directory() t WHERE t.email = d.rep),
               'totals', public.crm_4571_numbers_row(sum(d.calls)::integer, sum(d.connected)::integer, sum(d.demos_booked)::integer,
                                                   sum(d.demos_linked)::integer, sum(d.emails_sent)::integer, sum(d.replies)::integer)
                         || jsonb_build_object('outcomes', (SELECT jsonb_object_agg(o.key, o.n) FROM (
                              SELECT e.key, sum((e.value #>> '{}')::integer) AS n
                                FROM daily dd, jsonb_each(dd.outcomes) e WHERE dd.rep = d.rep GROUP BY e.key) o)),
               'days', jsonb_agg(public.crm_4571_numbers_row(d.calls, d.connected, d.demos_booked, d.demos_linked, d.emails_sent, d.replies)
                                 || jsonb_build_object('day', d.day, 'outcomes', d.outcomes) ORDER BY d.day)) AS j
        FROM daily d GROUP BY d.rep) r;
  SELECT public.crm_4571_numbers_row(
           COALESCE(sum((x->'totals'->>'calls')::integer), 0)::integer, COALESCE(sum((x->'totals'->>'connected')::integer), 0)::integer,
           COALESCE(sum((x->'totals'->>'demos_booked')::integer), 0)::integer, COALESCE(sum((x->'totals'->>'demos_linked')::integer), 0)::integer,
           COALESCE(sum((x->'totals'->>'emails_sent')::integer), 0)::integer, COALESCE(sum((x->'totals'->>'replies')::integer), 0)::integer)
    INTO v_tot FROM jsonb_array_elements(v_reps) x;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'time_zone', 'Africa/Lagos', 'reps', v_reps, 'totals', v_tot,
    'mail_last_logged_at', (SELECT max(e.created_at) FROM public.crm_email_log e));
END;
$function$;
COMMENT ON FUNCTION public.crm_outreach_numbers(date, date) IS
  'Issue #4571 W6b (rework). The Team dashboard''s weekly numbers, per rep per Lagos day: calls (outbound phone touches) and their outcomes, connected (demo_booked, spoke_follow_up, call_back, not_interested), demos booked (outcome demo_booked), demos linked (W4, by who linked), emails sent (outbound crm_email_log by From, plus outbound email touches logged by hand by who logged them, unless the log has outbound mail to that card that Lagos day) and replies (inbound by mailbox), with connect_rate = connected / calls and demo_rate = demos booked / connected, null when the divisor is 0. Window 1 to 92 days. crm_ctx().';

-- From 20281126084571. #4571 rework: keeps the report card; owns the cron entry.
CREATE OR REPLACE FUNCTION public.crm_cadence_sweep_configure(p_mode text, p_report_card_id uuid DEFAULT NULL,
                                                   p_team text[] DEFAULT NULL, p_since date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v record; v_before jsonb := public.crm_4571_cadence_config(); v_after jsonb; v_team jsonb;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  PERFORM public.ops_owner_person_only('Only the owner can switch the nightly sweep.');
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'dry_run', 'apply') THEN
    RAISE EXCEPTION 'invalid_setting: Use off, dry_run or apply.' USING ERRCODE = '22023';
  END IF;
  IF p_report_card_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = p_report_card_id AND w.archived_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_setting: The report card must be a Work card on the board.' USING ERRCODE = '22023';
  END IF;
  IF p_team IS NOT NULL THEN
    IF cardinality(p_team) NOT BETWEEN 1 AND 20 OR EXISTS (SELECT 1 FROM unnest(p_team) e WHERE e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'invalid_setting: The sweep team is 1 to 20 email addresses.' USING ERRCODE = '22023';
    END IF;
    v_team := (SELECT jsonb_agg(DISTINCT lower(btrim(e))) FROM unnest(p_team) e);
  END IF;
  IF p_since IS NOT NULL AND (p_since < date '2026-01-01' OR p_since > (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date) THEN
    RAISE EXCEPTION 'invalid_setting: The restart date is a past day in 2026 or later.' USING ERRCODE = '22023';
  END IF;
  -- #4571 rework: a call without p_report_card_id keeps the stored report card.
  v_after := v_before || jsonb_build_object('mode', p_mode)
             || CASE WHEN p_report_card_id IS NOT NULL THEN jsonb_build_object('report_card_id', p_report_card_id) ELSE '{}'::jsonb END
             || CASE WHEN v_team IS NOT NULL THEN jsonb_build_object('team', v_team) ELSE '{}'::jsonb END
             || CASE WHEN p_since IS NOT NULL THEN jsonb_build_object('since', p_since) ELSE '{}'::jsonb END;
  INSERT INTO public.ops_settings (key, value, updated_by) VALUES ('cadence_sweep', v_after, v.actor_email)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM public.ops_log_write(v.actor_email, NULL, 'setting_changed', 'info', NULL, NULL, NULL,
    format('%s set the nightly cadence sweep to %s.', public.ops_name(v.actor_email),
           CASE p_mode WHEN 'apply' THEN 'on' WHEN 'dry_run' THEN 'dry run' ELSE 'off' END),
    jsonb_build_object('key', 'cadence_sweep', 'before', v_before, 'after', v_after));
  -- #4571 rework (spec cutover): the pg_cron job exists only while the sweep
  -- is on or in dry run. Off unschedules it, so it ships unscheduled.
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF p_mode = 'off' THEN
      PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'issue_4571_crm_cadence_sweep';
    ELSIF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'issue_4571_crm_cadence_sweep') THEN
      PERFORM cron.schedule('issue_4571_crm_cadence_sweep', '0 20 * * 1-5', 'SELECT public.crm_cadence_sweep_cron()');
    END IF;
  END IF;
  RETURN public.crm_4571_cadence_config();
END;
$function$;
COMMENT ON FUNCTION public.crm_cadence_sweep_configure(text, uuid, text[], date) IS
  'Issue #4571 W6c (rework). The sweep''s switch (off, dry_run, apply), the Work card its nightly report is posted on (#3659, optional; kept when not passed), its team and its restart date. Dry run or On schedules the pg_cron job issue_4571_crm_cadence_sweep (weekdays 20:00 UTC); Off unschedules it. Owner only, signed in; logged.';

-- Ship state (spec cutover): no cron entry until the owner picks Dry run.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'issue_4571_crm_cadence_sweep';
  END IF;
END
$cron$;

-- From 20281126024571 (ops_link_search, as replayed). #4571 rework: a host or
-- creator result, and a call's card, show the stage's label ("Replied"), not
-- its id ("replied"), in Pick another host and every link picker.
CREATE OR REPLACE FUNCTION public.ops_link_search(p_kind text, p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'label', x.name, 'sub', COALESCE(public.crm_stage_def(p_kind || 's', x.stage)->>'label', x.stage)) ORDER BY x.prefix DESC, x.name, x.id), '[]'::jsonb) INTO v_rows
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
        'sub', concat_ws(' · ', CASE x.pipeline WHEN 'hosts' THEN 'Host' ELSE 'Creator' END, COALESCE(public.crm_stage_def(x.pipeline, x.stage_at)->>'label', x.stage_at))) ORDER BY x.occurred_at DESC, x.id), '[]'::jsonb) INTO v_rows
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
$function$;

COMMIT;
