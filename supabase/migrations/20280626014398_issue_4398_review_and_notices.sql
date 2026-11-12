-- Issue #4398 (Work board v3), migration 2 of 4: Done needs the watcher,
-- fewer bot cards, and notifications that carry only what matters (spec v1
-- Part C and spec v3 sections 2 and 3; approved by Seth on 11 Nov 2026).
--
--   C.  Seth's "In review" column (ops_work_statuses 8564cb07-..., created by
--       seth@usemingla.com on 11 Nov; by name when that id is not here, and
--       made when neither is) is the review column (role = 'review'). Every
--       person close path (ops_work_close, a drag to Done through
--       ops_work_move, ops_work_person_action, ops_work_push_back) calls
--       ops_work_finish: a signed-in watcher's own close is the confirm and
--       closes; anyone else's sends the card to In review with the result and
--       proof saved, and the watcher is told. ops_work_confirm and
--       ops_work_send_back (a reason of 5 to 300 characters) are the
--       watcher's, signed in only (an agent is refused 42501). A trigger
--       refuses any write that closes a card without the confirm (SQLSTATE
--       42501 review_required), except a system close (closed_via system,
--       proven by data), the subtasks of a closed card, and plan steps ticked
--       through their card's plan. Leaving In review clears the request; the
--       watcher leaves it only by Confirm or Send back.
--   S2. Fewer bot cards. guide_live makes no card: it is one Admin activity
--       notice. Feature Guide coverage is one standing card
--       (feature_guide_gap:current) updated in place. The six per-PR release
--       kinds are one card per PR, "Finish the release of PR #<n>", whose
--       checklist is read live from the release record (ops_release_items:
--       one owner per truth, nothing copied); it closes itself when nothing
--       is left. Open cards of the old kinds are closed into it as a system
--       close that names the new card.
--   S3. ops_notify_people(card, event, emails, actor, excerpt, kind) decides
--       from ONE table (ops_notify_push): mention, review, sent_back, status
--       and assigned by a person or their agent push to the Host app and
--       email; bot, guide, edit and alert are Admin-only unread; the actor
--       never hears about their own action. Every caller passes what
--       happened. team_mentions keeps the kind and the push verdict; the Host
--       app (team_inbox, team_badge) reads push rows only; Admin reads both
--       through team_activity.
--
-- Static SQL only (no EXECUTE of built strings). A stale write raises PT409,
-- never 40001. Every function copied here is copied from its latest
-- definition (named beside it); each edit is marked "#4398".
--
-- ROLLBACK (no down file): roll the Admin, Host app and connector back
-- first, then restore each function body from the migration named beside
-- it, drop ops_notify_people(uuid,uuid,text[],text,text,text) after
-- recreating the five-argument one, drop the triggers and functions added
-- here, and drop the new columns.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- C1. The review column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_work_statuses ADD COLUMN role text;
ALTER TABLE public.ops_work_statuses ADD CONSTRAINT ops_work_statuses_role_check
  CHECK (role IS NULL OR (role = 'review' AND grp = 'doing'));
CREATE UNIQUE INDEX ops_work_statuses_one_review ON public.ops_work_statuses ((role)) WHERE role = 'review';
COMMENT ON COLUMN public.ops_work_statuses.role IS
  'Issue #4398. review: the one column where a card the owner finished waits for its watcher to confirm (grp doing, so counts and sorts are unchanged).';

UPDATE public.ops_work_statuses SET role = 'review'
 WHERE id = '8564cb07-5f36-498e-8555-e222a56cee82' AND archived_at IS NULL AND grp = 'doing';
UPDATE public.ops_work_statuses SET role = 'review'
 WHERE id = (SELECT s.id FROM public.ops_work_statuses s
              WHERE lower(s.name) = 'in review' AND s.archived_at IS NULL AND s.grp = 'doing'
              ORDER BY s.created_at, s.id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.ops_work_statuses x WHERE x.role = 'review');
-- Neither is here (a fresh database): make it, after the Active columns.
UPDATE public.ops_work_statuses SET position = position + 1
 WHERE grp = 'done' AND NOT EXISTS (SELECT 1 FROM public.ops_work_statuses x WHERE x.role = 'review');
INSERT INTO public.ops_work_statuses (id, name, color, grp, position, role, created_by, updated_by)
SELECT '8564cb07-5f36-498e-8555-e222a56cee82', 'In review', '#7a4fd1', 'doing',
       COALESCE((SELECT max(s.position) FROM public.ops_work_statuses s WHERE s.grp IN ('todo', 'doing')), 0) + 1,
       'review', 'system@usemingla.com', 'system@usemingla.com'
 WHERE NOT EXISTS (SELECT 1 FROM public.ops_work_statuses x WHERE x.role = 'review')
   AND NOT EXISTS (SELECT 1 FROM public.ops_work_statuses x WHERE lower(x.name) = 'in review' AND x.archived_at IS NULL);

CREATE FUNCTION public.ops_review_status_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$ SELECT s.id FROM public.ops_work_statuses s WHERE s.role = 'review' AND s.archived_at IS NULL LIMIT 1 $function$;
REVOKE ALL ON FUNCTION public.ops_review_status_id() FROM PUBLIC, anon, authenticated;

-- From 20280624004255: a card that only knows its group never lands in the
-- review column (In progress is the first Active column that is not it).
CREATE OR REPLACE FUNCTION public.ops_status_default(p_grp text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT s.id FROM public.ops_work_statuses s
   WHERE s.grp = CASE WHEN p_grp = 'person' THEN 'todo' ELSE p_grp END AND s.archived_at IS NULL
     AND s.role IS NULL  -- #4398
   ORDER BY s.position, s.created_at, s.id LIMIT 1
$function$;

-- From 20280624014255: the column says it is the review column.
CREATE OR REPLACE FUNCTION public.ops_status_json(s public.ops_work_statuses) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'grp', s.grp,
    'group_label', CASE s.grp WHEN 'todo' THEN 'Not started' WHEN 'doing' THEN 'Active' ELSE 'Closed' END,
    'position', s.position, 'revision', s.revision, 'archived', s.archived_at IS NOT NULL,
    'role', s.role,  -- #4398
    'cards', (SELECT count(*) FROM public.ops_work_cards w WHERE w.status_id = s.id AND w.archived_at IS NULL AND w.parent_id IS NULL))
$function$;

-- The review column stays: it can be renamed or recoloured, never archived
-- or moved to another group.
CREATE FUNCTION public.ops_4398_review_column_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF OLD.role = 'review' AND (NEW.archived_at IS NOT NULL OR NEW.grp <> 'doing' OR NEW.role IS DISTINCT FROM 'review') THEN
    RAISE EXCEPTION 'review_column: In review is where finished cards wait for their watcher. Rename or recolour it, but keep it.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_4398_review_column_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4398_review_column_guard BEFORE UPDATE ON public.ops_work_statuses
  FOR EACH ROW EXECUTE FUNCTION public.ops_4398_review_column_guard();

-- ---------------------------------------------------------------------------
-- C2. What a card in review carries.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_work_cards
  ADD COLUMN review_requested_at  timestamptz,
  ADD COLUMN review_requested_by  text,
  ADD COLUMN review_requested_via text,
  ADD COLUMN review_kind          text,
  ADD COLUMN review_reason        text,
  ADD COLUMN review_close_children boolean NOT NULL DEFAULT false,
  ADD COLUMN review_close_status_id uuid REFERENCES public.ops_work_statuses(id),
  ADD COLUMN confirmed_by         text,
  ADD COLUMN confirmed_at         timestamptz,
  ADD COLUMN sent_back_reason     text,
  ADD COLUMN sent_back_by         text,
  ADD COLUMN sent_back_at         timestamptz;
ALTER TABLE public.ops_work_cards
  ADD CONSTRAINT ops_work_cards_review_pair CHECK ((review_requested_at IS NULL) = (review_requested_by IS NULL)
                                                   AND (review_requested_at IS NULL) = (review_kind IS NULL)),
  ADD CONSTRAINT ops_work_cards_review_kind_check CHECK (review_kind IS NULL OR review_kind IN ('done','already_done','declined')),
  ADD CONSTRAINT ops_work_cards_review_via_check CHECK (review_requested_via IS NULL OR review_requested_via IN ('claude','codex')),
  ADD CONSTRAINT ops_work_cards_review_open CHECK (review_requested_at IS NULL OR status <> 'done'),
  ADD CONSTRAINT ops_work_cards_review_reason_check CHECK (review_reason IS NULL OR char_length(review_reason) BETWEEN 1 AND 500),
  ADD CONSTRAINT ops_work_cards_confirmed_pair CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  ADD CONSTRAINT ops_work_cards_sent_back_pair CHECK ((sent_back_reason IS NULL) = (sent_back_at IS NULL) AND (sent_back_at IS NULL) = (sent_back_by IS NULL)),
  ADD CONSTRAINT ops_work_cards_sent_back_check CHECK (sent_back_reason IS NULL OR char_length(sent_back_reason) BETWEEN 5 AND 300);
COMMENT ON COLUMN public.ops_work_cards.review_requested_at IS
  'Issue #4398. Set while the card waits In review for its watcher: who asked (review_requested_by, _via), how it would close (review_kind, review_reason) and whether its subtasks close with it.';
COMMENT ON COLUMN public.ops_work_cards.confirmed_by IS
  'Issue #4398. The watcher who confirmed the close (or whose own close was the confirm). NULL for a system close.';
COMMENT ON COLUMN public.ops_work_cards.sent_back_reason IS
  'Issue #4398. What the watcher said was missing when they sent it back; cleared when it is asked to review again or closes.';

-- Cards already sitting in In review wait for their watcher from now.
UPDATE public.ops_work_cards w SET review_requested_at = now(), review_requested_by = COALESCE(w.working_by, w.updated_by),
       review_kind = 'done'
 WHERE w.status_id = public.ops_review_status_id() AND w.status <> 'done' AND w.archived_at IS NULL AND w.review_requested_at IS NULL;

-- Thread events for the review steps.
ALTER TABLE public.ops_work_events DROP CONSTRAINT ops_work_events_action_check;
ALTER TABLE public.ops_work_events ADD CONSTRAINT ops_work_events_action_check CHECK (action = ANY (ARRAY[
  'added','updated','started','status','blocked','unblocked','closed','pushed_back','reopened','note','people','links','plan',
  'gate_closed','gate_override','carried','re_anchored','undone','archived','took_over','working_cleared','auto_closed','redated',
  'sprint_moved','github','review','confirmed','sent_back']::text[]));

-- ---------------------------------------------------------------------------
-- C3. The backstop: no close without the watcher's confirm.
-- ---------------------------------------------------------------------------
-- INVARIANT ops-card-review-before-done: an open card becomes Done only by
-- its watcher's confirm (or the watcher's own close), a system close proven
-- by data (closed_via = 'system'), closing with its closed parent, or a plan
-- step ticked through its card's plan. Gate: ops_4398_review_guard.
-- Test: supabase/migrations/__tests__/issue_4398_work_board_v3.implementor.pg17.test.sql
CREATE FUNCTION public.ops_4398_review_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_review uuid := public.ops_review_status_id();
BEGIN
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done') THEN
    IF NEW.closed_via = 'system'
       OR COALESCE(current_setting('ops.review_confirmed', true), '') = NEW.id::text
       OR (NEW.plan_step IS NOT NULL AND (TG_OP = 'INSERT' OR COALESCE(current_setting('ops.plan_sync', true), '') = 'on'))
       OR (NEW.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ops_work_cards p WHERE p.id = NEW.parent_id AND p.status = 'done')) THEN
      IF COALESCE(current_setting('ops.review_confirmed', true), '') = NEW.id::text THEN
        NEW.confirmed_by := COALESCE(NEW.confirmed_by, NULLIF(current_setting('ops.review_confirmer', true), ''));
        NEW.confirmed_at := COALESCE(NEW.confirmed_at, CASE WHEN NEW.confirmed_by IS NOT NULL THEN clock_timestamp() END);
      END IF;
      NEW.review_requested_at := NULL; NEW.review_requested_by := NULL; NEW.review_requested_via := NULL;
      NEW.review_kind := NULL; NEW.review_reason := NULL; NEW.review_close_children := false; NEW.review_close_status_id := NULL;
      NEW.sent_back_reason := NULL; NEW.sent_back_by := NULL; NEW.sent_back_at := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'review_required: The watcher confirms this card first.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'done' AND NEW.status <> 'done' THEN
    NEW.confirmed_by := NULL; NEW.confirmed_at := NULL;  -- reopened: no longer confirmed
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status_id = v_review AND NEW.status_id IS DISTINCT FROM v_review AND NEW.status <> 'done'
     AND OLD.review_requested_at IS NOT NULL THEN
    NEW.review_requested_at := NULL; NEW.review_requested_by := NULL; NEW.review_requested_via := NULL;
    NEW.review_kind := NULL; NEW.review_reason := NULL; NEW.review_close_children := false; NEW.review_close_status_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_4398_review_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ops_4398_review_guard
  BEFORE INSERT OR UPDATE OF status, status_id ON public.ops_work_cards
  FOR EACH ROW EXECUTE FUNCTION public.ops_4398_review_guard();
-- An ordinary trigger (not ALWAYS): only a superuser in replica mode (a
-- restore or a fixture load) writes past it.

-- A card waiting In review leaves it by the watcher's Confirm or Send back;
-- its owner (or anyone else) may take it back out, which withdraws the ask.
CREATE FUNCTION public.ops_review_leave_check(p_card public.ops_work_cards, p_actor text, p_via text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_card.review_requested_at IS NOT NULL AND p_via IS NULL
     AND p_actor = (public.ops_card_people(p_card.id, 'watcher'))[1] THEN
    RAISE EXCEPTION 'use_send_back: You watch this card. Confirm it, or send it back with what is missing.' USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_review_leave_check(public.ops_work_cards, text, text) FROM PUBLIC, anon, authenticated;

-- The first Active column that is not In review.
CREATE FUNCTION public.ops_status_in_progress() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$ SELECT public.ops_status_default('doing') $function$;
REVOKE ALL ON FUNCTION public.ops_status_in_progress() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- S3. Who hears about what: the one table.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_mentions ADD COLUMN event_kind text NOT NULL DEFAULT 'mention';
ALTER TABLE public.team_mentions ADD COLUMN push boolean NOT NULL DEFAULT true;
ALTER TABLE public.team_mentions ADD CONSTRAINT team_mentions_event_kind_check
  CHECK (event_kind IN ('mention','review','sent_back','status','assigned','bot','guide','edit','alert'));
ALTER TABLE public.team_mentions DROP CONSTRAINT team_mentions_source_kind_check;
ALTER TABLE public.team_mentions ADD CONSTRAINT team_mentions_source_kind_check
  CHECK (source_kind = ANY (ARRAY['content_calendar_comment','work_card','team_message','work_due','ops_activity']::text[]));
CREATE INDEX team_mentions_target_push_unread ON public.team_mentions (target_user_id, push) WHERE read_at IS NULL;
COMMENT ON COLUMN public.team_mentions.event_kind IS
  'Issue #4398. What happened (the caller of ops_notify_people says): mention, review, sent_back, status, assigned, bot, guide, edit or alert.';
COMMENT ON COLUMN public.team_mentions.push IS
  'Issue #4398. The ops_notify_push verdict: true goes to the Host app and email; false is an Admin-only unread (Admin > Activity).';

-- The one rule. A person or their agent mentioning you, asking you to
-- confirm, sending a card back to you, changing the status of a card you own
-- or watch, or giving you a card: push. Anything a bot does, Feature Guide
-- notices, edits and system alerts: Admin only. Your own action: never (the
-- caller's recipient list never carries the actor; ops_notify_people drops
-- them anyway).
CREATE FUNCTION public.ops_notify_push(p_kind text, p_actor_email text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT p_kind IN ('mention','review','sent_back','status','assigned')
     AND lower(btrim(COALESCE(p_actor_email, ''))) <> 'system@usemingla.com'
$function$;
REVOKE ALL ON FUNCTION public.ops_notify_push(text, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.ops_notify_push(text, text) IS
  'Issue #4398. The one table for Work notices: push (Host app + email) for mention, review, sent_back, status and assigned by a person or their agent; Admin-only for bot, guide, edit, alert and anything system@usemingla.com does.';

-- From 20280624064255 (rework 2). #4398 (S3): the caller says what happened
-- (p_kind) and ops_notify_push decides: push rows get the email and the Host
-- app push as before; Admin-only rows are a team_mentions row with
-- push = false and nothing else. The decision flag and its push stay for an
-- owner asked to decide (a tag change) and for a watcher asked to confirm.
DROP FUNCTION public.ops_notify_people(uuid, uuid, text[], text, text);
CREATE FUNCTION public.ops_notify_people(p_card_id uuid, p_event_id uuid, p_emails text[], p_actor_email text, p_excerpt text, p_kind text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_email text; v_uid uuid; v_actor uuid; v_mention uuid; v_told integer := 0;
  v_link text := 'https://admin.usemingla.com/#/work-board?card=' || p_card_id::text || '&side=thread:' || p_card_id::text;
  v_excerpt text := COALESCE(left(public.ops_one_line(p_excerpt), 280), 'A work card changed.');
  v_card public.ops_work_cards;
  v_action text;
  v_card_title text;
  v_who text;
  v_cut integer;
  v_title text;
  v_email_ok boolean;
  v_before jsonb;
  v_after jsonb;
  v_tag_set boolean;
  v_decision boolean;
  v_push_ok boolean;
  v_inapp_ok boolean;
  v_kind text := CASE WHEN p_kind IN ('mention','review','sent_back','status','assigned','bot','guide','edit','alert') THEN p_kind ELSE 'edit' END;
  v_push boolean;  -- #4398
BEGIN
  v_push := public.ops_notify_push(v_kind, p_actor_email);
  SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.id = p_card_id;
  SELECT e.action, e.before, e.after INTO v_action, v_before, v_after FROM public.ops_work_events e WHERE e.id = p_event_id;
  v_tag_set := v_action IS DISTINCT FROM 'note'
    AND v_before IS NOT NULL AND v_after IS NOT NULL
    AND NULLIF(v_after->'fields'->>'person_reason', '') IS NOT NULL
    AND NULLIF(v_before->'fields'->>'person_reason', '') IS DISTINCT FROM NULLIF(v_after->'fields'->>'person_reason', '');
  v_card_title := NULLIF(public.ops_one_line(v_card.title), '');

  IF v_action = 'note' AND v_card_title IS NOT NULL THEN
    v_cut := position(' on ' || v_card_title || ': ' IN v_excerpt);
    v_who := CASE WHEN v_cut > 1 THEN left(v_excerpt, v_cut - 1) ELSE public.ops_name(p_actor_email) END;
    v_title := v_who || ' tagged you: ' || v_card_title;
  ELSIF v_card_title IS NOT NULL AND position(v_card_title IN v_excerpt) > 0 THEN
    v_title := v_excerpt;
  ELSIF v_card_title IS NOT NULL THEN
    v_title := public.ops_name(p_actor_email) || ' on a work card: ' || v_card_title;
  ELSE
    v_title := public.ops_name(p_actor_email) || ' on a work card';
  END IF;
  IF char_length(v_title) > 150 THEN v_title := left(v_title, 149) || '…'; END IF;

  -- #4398: email and push only for the push class (bot cards never push).
  v_email_ok := v_push;

  SELECT u.id INTO v_actor FROM auth.users u WHERE lower(btrim(u.email)) = lower(btrim(p_actor_email)) ORDER BY u.created_at LIMIT 1;
  FOR v_email IN SELECT DISTINCT lower(btrim(x)) FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) x WHERE btrim(COALESCE(x, '')) <> '' LOOP
    CONTINUE WHEN v_email = lower(btrim(p_actor_email));
    v_uid := NULL;
    SELECT u.id INTO v_uid FROM auth.users u
     WHERE lower(btrim(u.email)) = v_email AND public.issue_3720_active_team_member(u.id)
     ORDER BY u.created_at LIMIT 1;
    CONTINUE WHEN v_uid IS NULL;
    -- An owner asked to decide (a different tag) or a watcher asked to
    -- confirm (#4398) gets the decision.
    v_decision := v_push AND ((v_tag_set AND EXISTS (
      SELECT 1 FROM public.ops_work_people w
       WHERE w.card_id = p_card_id AND w.role = 'owner' AND lower(btrim(w.email)) = v_email)) OR v_kind = 'review');
    v_mention := NULL;
    INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link, decision, event_kind, push)
    VALUES ('work_card', p_event_id, v_actor, v_uid, v_excerpt, v_link, v_decision, v_kind, v_push)
    ON CONFLICT (source_kind, source_id, target_user_id) DO NOTHING
    RETURNING id INTO v_mention;
    CONTINUE WHEN v_mention IS NULL;
    IF v_email_ok THEN
      INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
      VALUES ('admin.team_mention', v_uid, NULL,
        jsonb_build_object('title', v_title, 'body', left(v_excerpt, 180), 'mention_id', v_mention,
          'source_kind', 'work_card', 'source_id', p_event_id, 'deep_link', v_link,
          'card_id', p_card_id, 'card_title', v_card_title),
        'admin.team_mention:' || v_mention::text, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
      IF public.team_chat_staff(v_uid) THEN
        IF v_decision OR v_kind = 'sent_back' THEN
          v_push_ok := public.can_send(v_uid, 'business.team_decision', 'push', NULL);
          v_inapp_ok := public.can_send(v_uid, 'business.team_decision', 'inapp', NULL);
          IF v_push_ok OR v_inapp_ok THEN
            INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
            VALUES ('business.team_decision', v_uid, NULL,
              jsonb_build_object('source_kind', 'work_card', 'reason', CASE WHEN v_kind IN ('review','sent_back') THEN v_kind ELSE 'decision' END,
                'mention_id', v_mention, 'source_id', p_event_id, 'card_id', p_card_id, 'actor_user_id', v_actor,
                'inapp', v_inapp_ok,
                'deep_link', 'mingla-business://team/mention/' || v_mention::text),
              'business.team_decision:' || v_mention::text, 'pending')
            ON CONFLICT (idempotency_key) DO NOTHING;
          END IF;
        ELSE
          INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
          VALUES ('business.team_mention', v_uid, NULL,
            jsonb_build_object('source_kind', 'work_card', 'reason', CASE WHEN v_kind = 'mention' THEN 'mention' ELSE 'work_update' END,
              'mention_id', v_mention, 'source_id', p_event_id, 'card_id', p_card_id,
              'deep_link', 'mingla-business://team/mention/' || v_mention::text),
            'business.team_mention:' || v_mention::text, 'pending')
          ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      END IF;
    END IF;
    v_told := v_told + 1;
  END LOOP;
  RETURN v_told;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_notify_people(uuid, uuid, text[], text, text, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.ops_notify_people(uuid, uuid, text[], text, text, text) IS
  'Issue #3980/#4255/#4398. The one work-card notice producer. The caller passes what happened (mention, review, sent_back, status, assigned, bot, guide, edit, alert); ops_notify_push decides: push rows are a team_mentions row plus admin.team_mention email plus one Host app push (business.team_decision for an owner asked to decide or a watcher asked to confirm, and for sent back; else business.team_mention); Admin-only rows are a team_mentions row with push = false and nothing else. The actor is never told about their own action.';

-- An Admin-only notice that is not about one card (a Feature Guide entry
-- turning Live): one team_mentions row per person, push = false.
CREATE FUNCTION public.ops_activity_notice(p_kind text, p_source_id uuid, p_emails text[], p_excerpt text, p_link text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_email text; v_uid uuid; v_told integer := 0;
BEGIN
  FOR v_email IN SELECT DISTINCT lower(btrim(x)) FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) x WHERE btrim(COALESCE(x, '')) <> '' LOOP
    v_uid := NULL;
    SELECT u.id INTO v_uid FROM auth.users u
     WHERE lower(btrim(u.email)) = v_email AND public.issue_3720_active_team_member(u.id) ORDER BY u.created_at LIMIT 1;
    CONTINUE WHEN v_uid IS NULL;
    INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link, event_kind, push)
    VALUES ('ops_activity', p_source_id, NULL, v_uid, COALESCE(left(public.ops_one_line(p_excerpt), 280), 'Mingla activity.'),
            left(COALESCE(p_link, 'https://admin.usemingla.com/#/work-board'), 500),
            CASE WHEN p_kind IN ('bot','guide','edit','alert') THEN p_kind ELSE 'alert' END, false)
    ON CONFLICT (source_kind, source_id, target_user_id) DO NOTHING;
    IF FOUND THEN v_told := v_told + 1; END IF;
  END LOOP;
  RETURN v_told;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_activity_notice(text, uuid, text[], text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- C4. Finish, confirm, send back.
-- ---------------------------------------------------------------------------
-- Every person close path calls this after its own checks (rules, claims,
-- proof). A signed-in watcher's own close is the confirm: the flag is set
-- for this card and NULL comes back, so the caller closes it as before.
-- Anyone else (the owner, their agent, a teammate) sends it to In review:
-- the result, proof and how it would close are kept, the watcher is told,
-- and the answer says so.
CREATE FUNCTION public.ops_work_finish(p_card public.ops_work_cards, p_actor text, p_via text, p_kind text, p_reason text,
                                       p_result text, p_proof jsonb, p_close_children boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE c public.ops_work_cards := p_card; n public.ops_work_cards; v_watcher text := (public.ops_card_people(p_card.id, 'watcher'))[1];
        v_col uuid := public.ops_review_status_id(); v_before jsonb; v_event uuid; v_who text; v_wname text; v_open integer;
        v_today date := public.ops_today(NULL);
BEGIN
  IF p_via IS NULL AND p_actor = v_watcher THEN
    PERFORM set_config('ops.review_confirmed', c.id::text, true);
    PERFORM set_config('ops.review_confirmer', p_actor, true);
    RETURN NULL;
  END IF;
  IF c.auto_key LIKE 'eng\_release:%' AND p_kind = 'done' THEN
    RAISE EXCEPTION 'self_closing: This card closes by itself when the release record shows nothing left. Fix the open items on its checklist.' USING ERRCODE = '22023';
  END IF;
  IF v_watcher IS NULL THEN
    RAISE EXCEPTION 'card_people: A card needs exactly one owner and one watcher, and they must be different people.' USING ERRCODE = '23514';
  END IF;
  v_wname := public.ops_name(v_watcher);
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
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY[v_watcher], p_actor,
    format('%s says Card %s is %s. Confirm or send back: %s', v_who, n.number,
      CASE p_kind WHEN 'declined' THEN 'not needed' WHEN 'already_done' THEN 'already done' ELSE 'done' END, n.title), 'review');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event,
    'review', jsonb_build_object('watcher', v_watcher, 'watcher_name', v_wname),
    'message', format('Sent to %s for review. The card waits In review until %s confirms it or sends it back.', v_wname, v_wname));
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_work_finish(public.ops_work_cards, text, text, text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- The watcher confirms a card waiting In review: it closes as its owner
-- asked (done, already done or not needed), closed by the owner and
-- confirmed by the watcher. A person's step only.
CREATE FUNCTION public.ops_work_confirm(p_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid; v_watcher text; v_name text;
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
  v_watcher := (public.ops_card_people(c.id, 'watcher'))[1];
  IF v.actor_email IS DISTINCT FROM v_watcher THEN
    RAISE EXCEPTION '%', format('not_watcher: Only the watcher, %s, confirms this card.', COALESCE(public.ops_name(v_watcher), 'nobody yet'))
      USING ERRCODE = '42501';
  END IF;
  v_name := public.ops_name(v.actor_email);
  PERFORM set_config('ops.review_confirmed', c.id::text, true);
  PERFORM set_config('ops.review_confirmer', v.actor_email, true);
  IF c.review_close_children THEN PERFORM set_config('ops.close_children', 'on', true); END IF;
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
  PERFORM public.ops_claims_release_card(c.id, 'closed', v.actor_email);
  v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'confirmed', format('%s confirmed it. Done.', v_name),
    v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(v.actor_email, NULL, 'closed', 'ok', c.id, 'work_card', c.id,
    left(format('%s confirmed Card %s: %s', v_name, n.number, n.title), 300), jsonb_build_object('confirmed', true));
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, 'owner') || c.review_requested_by, v.actor_email,
    format('%s confirmed: %s', v_name, n.title), 'status');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_work_confirm(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_work_confirm(uuid, bigint) TO authenticated;

-- The watcher sends a card waiting In review back to In progress with what
-- is missing (5 to 300 characters); the reason goes in the card's thread and
-- to its owner. A person's step only.
CREATE FUNCTION public.ops_work_send_back(p_id uuid, p_reason text, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid; v_watcher text; v_name text;
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
  v_watcher := (public.ops_card_people(c.id, 'watcher'))[1];
  IF v.actor_email IS DISTINCT FROM v_watcher THEN
    RAISE EXCEPTION '%', format('not_watcher: Only the watcher, %s, sends this card back.', COALESCE(public.ops_name(v_watcher), 'nobody yet'))
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
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_work_send_back(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_work_send_back(uuid, text, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- S2. One release card per pull request: its checklist, read live.
-- ---------------------------------------------------------------------------
-- What is left of a merged pull request's release, read from its release
-- record every time (the record is the one owner of these facts; the card
-- keeps no copy). Each item: key, text, done. NULL when there is no record.
CREATE FUNCTION public.ops_release_items(p_pr integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE r public.ops_release_records; v_items jsonb := '[]'::jsonb; v_proj text;
BEGIN
  SELECT * INTO r FROM public.ops_release_records x WHERE x.pr = p_pr;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'record', 'text', 'Release record written', 'done', true));
  v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'issue', 'text', 'The pull request names its issue',
    'done', NOT ('no_issue' = ANY (r.problems)) OR EXISTS (SELECT 1 FROM jsonb_object_keys(r.comment_urls) k WHERE k ~ '^[0-9]+$')));
  v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'guide', 'text', 'Feature Guide line on the pull request',
    'done', NOT (r.problems && ARRAY['feature_guide_missing','feature_guide_invalid']::text[])));
  FOR v_proj IN SELECT e.k FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) e(k, val) WHERE e.val <> 'failed' ORDER BY e.k LOOP
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'deploy:' || v_proj, 'text', format('%s deployed to production', v_proj),
      'done', r.deploy->'web'->>v_proj <> 'not_deployed'
              OR EXISTS (SELECT 1 FROM public.ops_release_records y WHERE y.merged_at > r.merged_at AND y.deploy->'web'->>v_proj = 'ready')));
  END LOOP;
  IF cardinality(r.migrations_added) > 0 THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'migrations', 'text', 'Migrations applied in production',
      'done', NOT ('migrations_pending' = ANY (r.problems))));
  END IF;
  v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'live_check', 'text', 'Live check posted on the issue',
    'done', NOT ('live_check_missing' = ANY (r.problems))));
  RETURN v_items;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_release_items(integer) FROM PUBLIC, anon, authenticated;

-- From 20280624064255 (rework 2). #4398 (A3): routing. Signature unchanged
-- (the #3355 weekly digest calls it with its own prefix; an unrouted kind
-- uses the fallback and never errors).
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
      || jsonb_build_object('parent', v_route->>'parent_id', 'owners', jsonb_build_array(v_route->>'owner'), 'watchers', jsonb_build_array(v_route->>'watcher'));
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

-- From 20271129003980 (synced w1). #4398 (S3): a bot close is Admin-only.
CREATE OR REPLACE FUNCTION public.ops_auto_card_close(p_card_id uuid, p_reason text, p_proof jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE c_actor constant text := 'system@usemingla.com'; c public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid;
        v_reason text := left(COALESCE(public.ops_one_line(p_reason), 'Done.'), 500); v_proof jsonb;
BEGIN
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR c.status = 'done' THEN RETURN jsonb_build_object('status', 'kept'); END IF;
  v_proof := COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', 'text', 'text', left(COALESCE(public.ops_one_line(p->>'text'), 'Checked by Mingla.'), 500),
                        'id', NULL, 'verified', true, 'checked_at', clock_timestamp(), 'by_name', 'Mingla', 'by_agent', false))
                        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_proof) = 'array' THEN p_proof ELSE '[]'::jsonb END) WITH ORDINALITY x(p, i)
                       WHERE x.i <= 10), '[]'::jsonb);
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards w SET status = 'done', person_reason = NULL, blocked = false, blocked_kind = NULL, blocked_reason = NULL,
         close_kind = 'system', close_reason = v_reason, closed_at = clock_timestamp(), closed_by = c_actor, closed_via = 'system',
         proof = v_proof, working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
         revision = revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
   WHERE w.id = c.id RETURNING w.* INTO n;
  PERFORM public.ops_claims_release_card(c.id, 'closed', c_actor);
  v_event := public.ops_card_event(c.id, c_actor, 'system', 'auto_closed', v_reason, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(c_actor, 'system', 'auto_closed', 'ok', c.id, 'work_card', c.id,
    format('Card %s closed itself: %s', n.number, v_reason), jsonb_build_object('auto_key', c.auto_key));
  -- #3980 proof fix P3-5: a "Feature Guide: ... is Live" card is made and
  -- closed at once only to tell Support; its "Mingla added" notice is the one
  -- notice, so closing it tells nobody a second time.
  IF c.auto_key IS NULL OR split_part(c.auto_key, ':', 1) <> 'guide_live' THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), c_actor, format('Mingla closed: %s. %s', n.title, v_reason), 'bot');
  END IF;
  RETURN jsonb_build_object('status', 'closed', 'id', c.id);
END;
$function$;

-- From 20271129003980 (synced w1). #4398 (C): ops_work_finish.
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
  IF c.review_requested_at IS NOT NULL AND v.via IS NULL AND v.actor_email = (public.ops_card_people(c.id, 'watcher'))[1] THEN
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

-- From 20271129003980 (synced w1). #4398 (C): ops_work_finish.
CREATE OR REPLACE FUNCTION public.ops_work_push_back(p_id uuid, p_kind text, p_reason text, p_proof jsonb DEFAULT '[]'::jsonb, p_expected_revision bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
        v_proof jsonb; v_reason text := public.ops_one_line(p_reason); v_who text; v_fin jsonb; -- #4398
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_kind IS NULL OR p_kind NOT IN ('declined', 'already_done') THEN
    RAISE EXCEPTION 'invalid_kind: Push back as declined (not needed) or already_done.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 10 AND 500 OR public.ops_has_control(v_reason) THEN
    RAISE EXCEPTION 'reason_required: Say why in one or two sentences.' USING ERRCODE = '22023';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: This card is already closed. Reopen it first.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_close_rules(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_proof := public.ops_proof_check(c, p_proof, v.actor_email, v.via, CASE WHEN p_kind = 'already_done' THEN 1 ELSE 0 END);
  -- #4398 (C): pushed back by anyone but the signed-in watcher, the card goes
  -- to In review with the reason; the watcher confirms the push back or sends
  -- it back. The watcher's own push back closes it.
  v_fin := public.ops_work_finish(c, v.actor_email, v.via, p_kind, v_reason, NULL, v_proof, false);
  IF v_fin IS NOT NULL THEN RETURN v_fin; END IF;
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards SET status = 'done', person_reason = NULL, blocked = false, blocked_kind = NULL, blocked_reason = NULL,
    close_kind = p_kind, close_reason = v_reason, closed_at = clock_timestamp(), closed_by = v.actor_email, closed_via = v.via,
    proof = v_proof, working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL, revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  PERFORM public.ops_claims_release_card(c.id, 'pushed_back', v.actor_email);
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'pushed_back', v_reason, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  v_who := public.ops_actor_label(v.actor_email, v.via);
  PERFORM public.ops_log_write(v.actor_email, v.via, 'pushed_back', 'ok', c.id, 'work_card', c.id,
    format('Pushed back Card %s as %s: %s', n.number, CASE p_kind WHEN 'declined' THEN 'not needed' ELSE 'already done' END, v_reason),
    jsonb_build_object('kind', p_kind));
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
    format('%s pushed back: %s — %s', v_who, n.title, v_reason), 'status');
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_recently_removed(c.id), v.actor_email,
    format('%s closed a card you were taken off in the last 24 hours: %s — %s', v_who, n.title, v_reason), 'edit');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;

-- From 20280427004270 (#4270 w1). #4398 (C): ops_work_finish.
CREATE OR REPLACE FUNCTION public.ops_work_person_action(p_id uuid, p_action text, p_note text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
        v_note text := public.ops_one_line(p_note); v_proof jsonb; v_name text; v_need text; v_fin jsonb; -- #4398
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN
    RAISE EXCEPTION 'people_only: Only a person can do this. It is waiting in To review.' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('mark_sent','approve_spend','mark_published','send_back') THEN
    RAISE EXCEPTION 'wrong_action: Use mark_sent, approve_spend, mark_published or send_back.' USING ERRCODE = '22023';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' OR c.person_reason IS NULL THEN RAISE EXCEPTION 'wrong_action: This card has no Send, Spend or Publish tag.' USING ERRCODE = '22023'; END IF;
  v_need := CASE c.person_reason WHEN 'send' THEN 'mark_sent' WHEN 'spend' THEN 'approve_spend' WHEN 'publish' THEN 'mark_published' END;
  IF p_action <> 'send_back' AND p_action IS DISTINCT FROM v_need THEN
    RAISE EXCEPTION 'wrong_action: That is not what this card is waiting for. Use the action that matches its reason, or send it back.' USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('approve_spend', 'send_back') AND (v_note IS NULL OR char_length(v_note) NOT BETWEEN 5 AND 300) THEN
    RAISE EXCEPTION '%', CASE WHEN p_action = 'approve_spend' THEN 'note_required: Say what was approved.' ELSE 'note_required: Say what the owner should change.' END USING ERRCODE = '22023';
  END IF;
  IF p_action = 'mark_published' AND NOT (c.anchor_kind = 'event' AND public.ops_event_public(c.anchor_id)) THEN
    RAISE EXCEPTION 'not_public_yet: The event is not public on Mingla yet. Publish it in Mingla Business, then try again.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_name := public.ops_name(v.actor_email);
  v_before := public.ops_card_snapshot(c.id);
  IF p_action = 'send_back' THEN
    UPDATE public.ops_work_cards SET status = 'todo', person_reason = NULL, working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL, revision = revision + 1,
      updated_by = v.actor_email, updated_via = NULL, updated_at = now()
     WHERE id = c.id RETURNING * INTO n;
    v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'status', v_note, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
    PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', c.id, 'work_card', c.id,
      format('%s sent Card %s back: %s', v_name, n.number, v_note), '{}'::jsonb);
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, 'owner'), v.actor_email,
      format('%s sent back: %s — %s', v_name, n.title, v_note), 'sent_back');
  ELSE
    v_proof := public.ops_proof_check(c, CASE p_action
        WHEN 'mark_sent' THEN jsonb_build_array(jsonb_build_object('kind', 'text', 'text', 'Marked sent by ' || v_name))
        WHEN 'approve_spend' THEN jsonb_build_array(jsonb_build_object('kind', 'text', 'text', left('Spend approved by ' || v_name || ': ' || v_note, 500)))
        ELSE jsonb_build_array(jsonb_build_object('kind', 'event_public', 'id', c.anchor_id, 'text', 'Public on Mingla, confirmed by ' || v_name)) END,
      v.actor_email, NULL, 1);
    -- #4398 (C): marked sent, spend approved or published by anyone but the
    -- watcher, the card waits In review for the watcher.
    v_fin := public.ops_work_finish(c, v.actor_email, NULL, 'done', NULL, NULL, c.proof || v_proof, false);
    IF v_fin IS NOT NULL THEN RETURN v_fin; END IF;
    UPDATE public.ops_work_cards SET status = 'done', person_reason = NULL, blocked = false, blocked_kind = NULL, blocked_reason = NULL,
      close_kind = 'done', close_reason = NULL, closed_at = clock_timestamp(), closed_by = v.actor_email, closed_via = NULL,
      proof = c.proof || v_proof, working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL, revision = revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
     WHERE id = c.id RETURNING * INTO n;
    PERFORM public.ops_claims_release_card(c.id, 'closed', v.actor_email);
    v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'closed', v_note, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
    PERFORM public.ops_log_write(v.actor_email, NULL, 'closed', 'ok', c.id, 'work_card', c.id,
      format('%s %s Card %s: %s', v_name, CASE p_action WHEN 'mark_sent' THEN 'marked sent' WHEN 'approve_spend' THEN 'approved spend on' ELSE 'confirmed published' END, n.number, n.title),
      jsonb_build_object('action', p_action));
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s closed: %s', v_name, n.title), 'status');
  END IF;
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;

-- From 20271129003980 (synced w1). #4398 (B2): reopening is never a dead end.
-- Missing people come from the parent card (its owner and watcher); a card
-- with no parent can be reopened with the owner and watcher the person picks
-- (p_owner, p_watcher), and is otherwise refused with words that say exactly
-- who to add.
DROP FUNCTION public.ops_work_reopen(uuid, text, bigint);
CREATE FUNCTION public.ops_work_reopen(p_id uuid, p_reason text, p_expected_revision bigint,
                                       p_owner text DEFAULT NULL, p_watcher text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
        v_reason text := public.ops_one_line(p_reason);
        v_owners text[]; v_watchers text[]; v_owner text; v_watcher text;  -- #4398
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF char_length(COALESCE(v_reason, '')) > 500 OR public.ops_has_control(v_reason) THEN
    RAISE EXCEPTION 'invalid_reason: Keep the reason to 500 characters.' USING ERRCODE = '22023';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status <> 'done' THEN RAISE EXCEPTION 'not_closed: This card is still open.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  -- #4398 (B2): an open card has one owner and one watcher.
  v_owners := public.ops_card_people(c.id, 'owner'); v_watchers := public.ops_card_people(c.id, 'watcher');
  IF p_owner IS NOT NULL THEN
    v_owner := public.ops_team_email(p_owner);
    IF v_owner IS NULL THEN RAISE EXCEPTION '%', format('invalid_card: Owner "%s" is not on the team. Pick from %s.', left(p_owner, 80), public.ops_team_names()) USING ERRCODE = '22023'; END IF;
  ELSIF cardinality(v_owners) = 1 THEN v_owner := v_owners[1];
  ELSIF cardinality(v_owners) = 0 AND c.parent_id IS NOT NULL THEN v_owner := (public.ops_card_people(c.parent_id, 'owner'))[1];
  END IF;
  IF p_watcher IS NOT NULL THEN
    v_watcher := public.ops_team_email(p_watcher);
    IF v_watcher IS NULL THEN RAISE EXCEPTION '%', format('invalid_card: Watcher "%s" is not on the team. Pick from %s.', left(p_watcher, 80), public.ops_team_names()) USING ERRCODE = '22023'; END IF;
  ELSIF cardinality(v_watchers) = 1 AND v_watchers[1] IS DISTINCT FROM v_owner THEN v_watcher := v_watchers[1];
  ELSIF cardinality(v_watchers) = 0 AND c.parent_id IS NOT NULL THEN
    v_watcher := (public.ops_card_people(c.parent_id, 'watcher'))[1];
    IF v_watcher IS NOT DISTINCT FROM v_owner THEN v_watcher := (public.ops_card_people(c.parent_id, 'owner'))[1]; END IF;
  END IF;
  IF v_owner IS NOT NULL AND v_owner = v_watcher THEN v_watcher := NULL; END IF;
  IF v_owner IS NULL OR v_watcher IS NULL THEN
    RAISE EXCEPTION '%', 'card_people: ' || CASE
        WHEN v_owner IS NULL AND v_watcher IS NULL THEN
          CASE WHEN cardinality(v_owners) > 1 THEN format('This card has %s owners and no watcher. Pick one owner and one watcher, then reopen it.', cardinality(v_owners))
               ELSE 'This card has no owner and no watcher. Pick one owner and one watcher, then reopen it.' END
        WHEN v_owner IS NULL AND cardinality(v_owners) > 1 THEN format('This card has %s owners. Pick the one owner (not %s, the watcher), then reopen it.', cardinality(v_owners), public.ops_name(v_watcher))
        WHEN v_owner IS NULL THEN format('This card has no owner. Pick one owner (not %s, the watcher), then reopen it.', public.ops_name(v_watcher))
        WHEN cardinality(v_watchers) > 1 THEN format('This card has %s watchers. Pick the one watcher (not %s, the owner), then reopen it.', cardinality(v_watchers), public.ops_name(v_owner))
        ELSE format('This card has no watcher. Pick one watcher (not %s, the owner), then reopen it.', public.ops_name(v_owner)) END
      USING ERRCODE = '23514';
  END IF;
  IF ARRAY[v_owner] IS DISTINCT FROM v_owners OR ARRAY[v_watcher] IS DISTINCT FROM v_watchers THEN
    PERFORM public.ops_people_set(c.id, ARRAY[v_owner], ARRAY[v_watcher], v.actor_email, v.via);
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
REVOKE ALL ON FUNCTION public.ops_work_reopen(uuid, text, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_work_reopen(uuid, text, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_work_reopen(uuid, text, bigint, text, text) TO service_role;

-- From 20280624014255 (#4255 functions). #4398 (C): In review.
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
    IF v.via IS NULL AND v.actor_email = (public.ops_card_people(c.id, 'watcher'))[1] THEN
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

-- From 20280624064255 (#4255 rework 2). #4398: kinds of notice, review exit.
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
  v_goal uuid; v_goal_sprint uuid; v_new_parent uuid; -- #4255
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_chat := CASE WHEN v.via IS NOT NULL THEN public.ops_ctx_chat() END;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one field to change.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('title','instructions','done_means','due_on','week','owners','watchers','links','anchor','plan','result',
                   'blocked','blocked_reason','status','person_reason','reason','github','blocked_on_github','files_url','on_brand_plan',
                   'description','start_on','estimate_minutes','goal','in_backlog','parent') ORDER BY k LIMIT 1;
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
    -- #4255: a new description is the instructions too (its first 4,000 characters)
    'instructions', CASE WHEN p_changes ? 'instructions' THEN p_changes->'instructions'
                         WHEN p_changes ? 'description' AND jsonb_typeof(p_changes->'description') = 'string'
                              AND char_length(COALESCE(public.ops_multi_line(left(p_changes->>'description', 4000)), '')) >= 10 THEN 'null'::jsonb
                         ELSE to_jsonb(c.instructions) END,
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
    -- #4255
    'parent', CASE WHEN p_changes ? 'parent' THEN p_changes->'parent' ELSE to_jsonb(c.parent_id) END,
    'description', CASE WHEN p_changes ? 'description' THEN p_changes->'description' ELSE to_jsonb(c.description_md) END,
    'start_on', CASE WHEN p_changes ? 'start_on' THEN p_changes->'start_on' ELSE to_jsonb(c.start_on) END,
    'estimate_minutes', CASE WHEN p_changes ? 'estimate_minutes' THEN p_changes->'estimate_minutes' ELSE to_jsonb(c.estimate_minutes) END,
    'goal', CASE WHEN p_changes ? 'goal' THEN p_changes->'goal' ELSE to_jsonb(c.goal_id) END,
    'in_backlog', CASE WHEN p_changes ? 'in_backlog' THEN p_changes->'in_backlog' ELSE to_jsonb(c.in_backlog) END,
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
  -- #4398 (C): the watcher takes a card out of In review only by Confirm or Send back.
  IF v_status IS DISTINCT FROM c.status THEN PERFORM public.ops_review_leave_check(c, v.actor_email, v.via); END IF;
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
  -- #4255: a goal belongs to one sprint, and the card must be in it. A card
  -- that moves week leaves its old sprint's goal behind.
  v_goal := (cl->>'goal_id')::uuid;
  IF v_goal IS NOT NULL THEN
    SELECT g.sprint_id INTO v_goal_sprint FROM public.ops_sprint_goals g WHERE g.id = v_goal;
    IF v_goal_sprint IS DISTINCT FROM (CASE WHEN v_week IS NOT NULL THEN (SELECT s.id FROM public.ops_sprints s WHERE s.starts_on = v_week) ELSE c.sprint_id END) THEN
      IF p_changes ? 'goal' THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'goal', 'message', 'That goal belongs to another sprint. Move the card to that week, or pick one of its sprint''s goals.'));
      END IF;
      v_goal := NULL;
    END IF;
  END IF;
  -- #4255: an agent moves a card only under a card its person owns.
  v_new_parent := (cl->>'parent_id')::uuid;
  IF v.via IS NOT NULL AND p_changes ? 'parent' AND v_new_parent IS DISTINCT FROM c.parent_id AND v_new_parent IS NOT NULL
     AND NOT public.ops_is_person_on(v_new_parent, v.actor_email, ARRAY['owner']) THEN
    RAISE EXCEPTION 'not_your_card: Your person is not an owner of that parent card.' USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'parent' AND jsonb_typeof(p_changes->'parent') <> 'null' AND v_new_parent IS NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fixes) f WHERE f->>'field' = 'parent') THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'The parent card is not on the board. Use an id returned by Mingla.'));
  END IF;
  IF jsonb_array_length(v_fixes) > 0 THEN
    RAISE EXCEPTION '%', 'invalid_card: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_fixes) f)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('fixes', v_fixes)::text;
  END IF;

  n.title := cl->>'title'; n.instructions := cl->>'instructions'; n.done_means := cl->>'done_means';
  n.anchor_kind := cl->>'anchor_kind'; n.anchor_id := (cl->>'anchor_id')::uuid;
  n.due_on := (cl->>'due_on')::date; n.due_source := cl->>'due_source'; n.plan := cl->'plan';
  n.status := v_status; n.person_reason := v_reason; n.files_url := cl->>'files_url';
  -- #4255
  n.parent_id := v_new_parent; n.description_md := cl->>'description'; n.start_on := (cl->>'start_on')::date;
  n.estimate_minutes := (cl->>'estimate_minutes')::integer; n.goal_id := v_goal;
  n.in_backlog := COALESCE((cl->>'in_backlog')::boolean, c.in_backlog);
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

  IF ROW(n.title, n.instructions, n.done_means, n.due_on, n.sprint_id, n.anchor_kind, n.anchor_id, n.result, n.files_url, n.on_brand_plan,
         n.parent_id, n.description_md, n.start_on, n.estimate_minutes, n.goal_id, n.in_backlog)
     IS DISTINCT FROM ROW(c.title, c.instructions, c.done_means, c.due_on, c.sprint_id, c.anchor_kind, c.anchor_id, c.result, c.files_url, c.on_brand_plan,
         c.parent_id, c.description_md, c.start_on, c.estimate_minutes, c.goal_id, c.in_backlog) THEN
    v_cats := v_cats || 'updated'::text;
  END IF;
  -- #4255: the plan is the card's subtasks.
  IF p_changes ? 'plan' AND n.plan IS DISTINCT FROM public.ops_plan_from_subtasks(c.id) THEN v_cats := v_cats || 'plan'::text; END IF;
  IF ROW(n.status, n.person_reason) IS DISTINCT FROM ROW(c.status, c.person_reason) THEN v_cats := v_cats || 'status'::text; END IF;
  IF ROW(n.blocked, n.blocked_kind, n.blocked_reason) IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason) THEN
    v_cats := v_cats || CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END;
  END IF;

  UPDATE public.ops_work_cards SET title = n.title, instructions = n.instructions, done_means = n.done_means,
    status = n.status, person_reason = n.person_reason, files_url = n.files_url, on_brand_plan = n.on_brand_plan, blocked = n.blocked, blocked_kind = n.blocked_kind, blocked_reason = n.blocked_reason,
    anchor_kind = n.anchor_kind, anchor_id = n.anchor_id, due_on = n.due_on, due_source = n.due_source, sprint_id = n.sprint_id,
    parent_id = n.parent_id, description_md = n.description_md, start_on = n.start_on, estimate_minutes = n.estimate_minutes,  -- #4255
    goal_id = n.goal_id, in_backlog = n.in_backlog,
    plan = c.plan, result = n.result, started_at = n.started_at, working_by = n.working_by, working_via = n.working_via,
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
  IF 'plan' = ANY (v_cats) THEN PERFORM public.ops_plan_sync(c.id, cl->'plan', v.actor_email, v.via); END IF;  -- #4255
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
    format('%s added you as owner: %s', v_who, n.title), 'assigned');
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_watchers')), v.actor_email,
    format('%s added you as watcher: %s', v_who, n.title), 'assigned');
  -- An agent that takes someone off a card tells them: who, which agent, and
  -- the card (the notice links to it). Guardrail, not a bottleneck.
  IF v.via IN ('claude', 'codex') THEN
    PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'removed')), v.actor_email,
      format('%s took you off this card: %s', v_who, n.title), 'edit');
  END IF;
  -- #4270: a card that gets a Send, Spend or Publish tag stays in its column
  -- and waits for a person; owners and watchers are told.
  -- #4255 Retest 2 (P3): a different ask is a new decision too (Send to
  -- Spend, You publish to Needs your OK), not only no tag to a tag. The same
  -- ask again never reaches here (no change, no event).
  IF n.person_reason IS NOT NULL AND n.person_reason IS DISTINCT FROM c.person_reason THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      -- #4270 rework (P3-4): the tag's own words, never "needs a person".
      format('%s: %s · %s', v_who, n.title, CASE n.person_reason WHEN 'send' THEN 'You send' WHEN 'spend' THEN 'You spend' WHEN 'publish' THEN 'You publish' ELSE 'Needs your OK' END), 'status');
    PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
      format('Card %s is tagged %s: %s', n.number, CASE n.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title), jsonb_build_object('reason', n.person_reason));
  ELSIF v_back THEN
    -- Wave 2: told and logged when a card's tag comes off.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s took the %s tag off %s%s', v_who, CASE c.person_reason WHEN 'send' THEN 'Send' WHEN 'spend' THEN 'Spend' WHEN 'publish' THEN 'Publish' ELSE 'Needs your OK' END, n.title,
        COALESCE(': ' || v_back_reason, '')), 'edit');
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
  -- #4398 (S3): a person (or their agent) moving a card between To do and In
  -- progress tells its owner and watcher (a push); an edit to its words,
  -- links or dates is an Admin-only notice for them.
  IF n.status IS DISTINCT FROM c.status THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s moved %s to %s', v_who, n.title, CASE n.status WHEN 'doing' THEN 'In progress' ELSE 'To do' END), 'status');
  ELSIF v_cats && ARRAY['updated','links','github','plan','blocked','unblocked']::text[] THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s edited %s', v_who, n.title), 'edit');
  END IF;
  v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'invalid_card: An open card already has this title. Update that card instead.' USING ERRCODE = '22023';
END;

$function$;

-- From 20280624064255 (#4255 rework 2). #4398 (S3): a person giving you a card is a push.
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
    ELSIF v.via IS NOT NULL AND v_chk->'clean'->>'parent_id' IS NOT NULL
          AND NOT public.ops_is_person_on((v_chk->'clean'->>'parent_id')::uuid, v.actor_email, ARRAY['owner']) THEN
      -- #4255: an agent adds subtasks only under a card its person owns.
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused',
        'fixes', jsonb_build_array(jsonb_build_object('field', 'parent', 'message', 'Your person is not an owner of the parent card. Add a note there instead, or ask an owner.')),
        'title', v_chk->'clean'->'title'));
      v_refused := v_refused + 1;
    ELSE
      cl := v_chk->'clean';
      v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
      v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
      v_gate := CASE WHEN cl->>'kind' = 'promo' THEN public.ops_promo_gate(cl->'anchor', v_today) END;
      BEGIN
        INSERT INTO public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, person_reason, files_url,
          on_brand_plan, brand_plan_source, kind, kit_step, anchor_kind, anchor_id, due_on, due_source, sprint_id, plan, created_by, created_via, updated_by, updated_via, request_key,
          parent_id, description_md, start_on, estimate_minutes, goal_id, in_backlog)  -- #4255
        VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
          'todo', -- #4270: a tagged card waits in To do; the tag is person_reason
          COALESCE((v_gate->>'blocked')::boolean, false),
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'kind' END,
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'reason' END,
          cl->>'person_reason', cl->>'files_url', COALESCE((cl->>'on_brand_plan')::boolean, false), v_source, cl->>'kind', (cl->>'kit_step')::integer, cl->>'anchor_kind', (cl->>'anchor_id')::uuid,
          -- #4255: a subtask is in its parent's sprint; the plan is subtasks
          (cl->>'due_on')::date, cl->>'due_source', COALESCE((cl->>'parent_sprint_id')::uuid, public.ops_sprint_for((cl->>'due_on')::date, v_today)), '[]'::jsonb,
          v.actor_email, v.via, v.actor_email, v.via, p_request_key || '-i' || v_idx,
          (cl->>'parent_id')::uuid, cl->>'description', (cl->>'start_on')::date, (cl->>'estimate_minutes')::integer,
          (cl->>'goal_id')::uuid, COALESCE((cl->>'in_backlog')::boolean, false))
        RETURNING * INTO c;
        PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
        PERFORM public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
        PERFORM public.ops_plan_sync(c.id, cl->'plan', v.actor_email, v.via);  -- #4255
        v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
        IF public.ops_github_set(c.id, cl->'github', v.actor_email, v.via) THEN
          PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'github',
            'GitHub: ' || (SELECT string_agg('#' || (g->>'number'), ', ') FROM jsonb_array_elements(cl->'github') g), NULL, NULL, c.revision, c.revision);
        END IF;
        PERFORM public.ops_notify_people(c.id, v_event, v_owners, v.actor_email, format('%s added you as owner: %s', v_who, c.title), 'assigned');
        PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v.actor_email, format('%s added you as watcher: %s', v_who, c.title), 'assigned');
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
$function$;

-- From its latest definition (#4255 work v2 functions). #4398 (S3): kinds of notice.
CREATE OR REPLACE FUNCTION public.ops_work_start(p_id uuid, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_before jsonb; v_event uuid;
        v_chat text; v_sprint uuid; v_mon date; v_from text; v_takeover boolean := false; v_prev text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_chat := CASE WHEN v.via IS NOT NULL THEN public.ops_ctx_chat() END;
  c := public.ops_card_lock(p_id, p_expected_revision);
  -- #3980 W2 rework 4: an agent never starts a roadmap approval card, in any
  -- status, and gets no working mark on it. A person still can.
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%' THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person starts this card.' USING ERRCODE = '42501';
  END IF;
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this card before changing it.' USING ERRCODE = '22023'; END IF;
  IF c.status = 'doing' THEN
    IF v.via IS NULL THEN
      RETURN jsonb_build_object('card', public.ops_card_json(c, v_today), 'event_id', NULL, 'changed', false);
    END IF;
    PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
    IF c.working_via IS NOT NULL AND public.ops_same_agent(c.working_by, c.working_via, c.working_chat, v.actor_email, v.via, v_chat) THEN
      UPDATE public.ops_work_cards SET working_seen_at = clock_timestamp() WHERE id = c.id RETURNING * INTO n;
      RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', NULL, 'changed', false);
    END IF;
    IF c.working_via IS NOT NULL AND COALESCE(c.working_seen_at, c.started_at) > clock_timestamp() - interval '24 hours' THEN
      PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
    END IF;
    -- Quiet for 24 hours, or nobody's agent on it: this agent takes it.
    v_takeover := c.working_via IS NOT NULL;
    v_prev := CASE WHEN v_takeover THEN public.ops_actor_label(c.working_by, c.working_via, c.working_chat) END;
    v_before := public.ops_card_snapshot(c.id);
    UPDATE public.ops_work_cards SET working_by = v.actor_email, working_via = v.via, working_chat = v_chat, working_seen_at = clock_timestamp(),
      revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
     WHERE id = c.id RETURNING * INTO n;
    v_event := public.ops_card_event(c.id, v.actor_email, v.via, CASE WHEN v_takeover THEN 'took_over' ELSE 'started' END,
      CASE WHEN v_takeover THEN format('Took over from %s after 24 hours without an update.', v_prev) END,
      v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
    PERFORM public.ops_log_write(v.actor_email, v.via, CASE WHEN v_takeover THEN 'took_over' ELSE 'started' END, 'ok', c.id, 'work_card', c.id,
      CASE WHEN v_takeover THEN format('Took over Card %s from %s: %s', n.number, v_prev, n.title)
           ELSE format('Started Card %s: %s', n.number, n.title) END, '{}'::jsonb);
    IF v_takeover THEN
      PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, 'owner') || c.working_by, v.actor_email,
        format('%s took over %s from %s after 24 hours without an update.', public.ops_actor_label(v.actor_email, v.via, v_chat), n.title, v_prev), 'edit');
    END IF;
    RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
  END IF;
  IF c.status <> 'todo' THEN RAISE EXCEPTION 'wrong_status: Only a card in To do can be started.' USING ERRCODE = '22023'; END IF;
  IF c.blocked THEN RAISE EXCEPTION '%', format('blocked: %s', c.blocked_reason) USING ERRCODE = '42501'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_before := public.ops_card_snapshot(c.id);
  v_mon := public.ops_monday(v_today);
  SELECT CASE WHEN s.starts_on > v_mon THEN public.ops_sprint_ensure(v_today) ELSE c.sprint_id END,
         CASE WHEN s.starts_on > v_mon THEN public.ops_day_words(s.starts_on) END
    INTO v_sprint, v_from FROM public.ops_sprints s WHERE s.id = c.sprint_id;
  UPDATE public.ops_work_cards SET status = 'doing', started_at = clock_timestamp(), working_by = v.actor_email, working_via = v.via,
    working_chat = v_chat, working_seen_at = CASE WHEN v.via IS NOT NULL THEN clock_timestamp() END,
    sprint_id = COALESCE(v_sprint, c.sprint_id),
    revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'started', NULL, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  IF v_from IS NOT NULL THEN
    PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'sprint_moved',
      format('Moved to this week from the week of %s: started cards belong to the week they start.', v_from), NULL, NULL, n.revision, n.revision);
  END IF;
  IF v.via IS NOT NULL THEN
    PERFORM public.ops_log_write(v.actor_email, v.via, 'started', 'ok', c.id, 'work_card', c.id, format('Started Card %s: %s', n.number, n.title), '{}'::jsonb);
  END IF;
  -- #4398 (S3): moving it to In progress tells its owner and watcher.
  PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
    format('%s started %s', public.ops_actor_label(v.actor_email, v.via, v_chat), n.title), 'status');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
END;
$function$;

-- From its latest definition. #4398 (S3): kinds of notice.
CREATE OR REPLACE FUNCTION public.ops_gate_override(p_card_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    format('%s let "%s" start before go-live: %s', v_who, n.title, v_reason), 'status');
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event);
END;
$function$;

-- From its latest definition. #4398: bot notices are Admin-only; the route picks the people.
CREATE OR REPLACE FUNCTION public.ops_github_bridges()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
        format('%s. "%s" can go ahead.', v_words, n.title), 'bot');
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
        JOIN public.product_capabilities pc ON pc.capability_key = f.k
       -- #3980 proof fix P3-8: a staff entry (staff-*) is team wording, never
       -- what hosts are told. Its issue drafts only from a linked roadmap card.
       WHERE pc.capability_key NOT LIKE 'staff-%';
      v_title := COALESCE(v_rc_title, v_cap_title);
      CONTINUE WHEN v_title IS NULL;
      v_body := 'Now live: ' || COALESCE(public.ops_first_sentence(v_cap_outcome), public.ops_first_sentence(v_rc_body), v_title || '.');
      v_draft := public.ops_roadmap_draft_add(v_title, v_body, v_issue);
      v_res := public.ops_auto_card_upsert('roadmap_shipped:issue-' || v_issue, jsonb_build_object(
        'title', left(format('Approve "Recently shipped": %s', v_title), 160),
        'instructions', 'Check the wording of the drafted Recently shipped card and publish it, or say it is not needed. Nothing reaches hosts until you publish it. You can also write an announcement from it.',
        'done_means', 'The card is published or marked not needed.',

        'due_on', public.ops_today(NULL) + 2, 'person_reason', 'publish',
        'links', jsonb_build_array(jsonb_build_object('kind', 'roadmap_card', 'id', v_draft)),
        'github', jsonb_build_array('#' || v_issue)), 'task', NULL);
      IF v_res->>'status' = 'added' THEN v_drafted := v_drafted + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_github_bridges: drafting for issue % stopped (% %)', v_issue, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- The approval card closes itself once a person has published the draft
  -- or archived it as not needed. #3980 W2 rework 4: the draft is the one
  -- Bridge D recorded for the card's issue (ops_roadmap_shipped_draft), not
  -- whatever the card's editable links point at, so adding, swapping or
  -- removing a link never closes the card or keeps it open.
  FOR l IN SELECT w.id, rc.status FROM public.ops_work_cards w
             JOIN public.community_roadmap_cards rc ON rc.id = public.ops_roadmap_shipped_draft(w.auto_key)
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
$function$;

-- From its latest definition. #4398 (S3): bot notices are Admin-only.
CREATE OR REPLACE FUNCTION public.ops_reconcile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
        -- #3980 synced, Wave 3: brand auto-link and automatic steps
        v_brands jsonb; v_steps jsonb;
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
  -- #3980 synced, Wave 3: brands made after the owner switched brand cards on
  -- are linked to their one host card, or get one.
  IF COALESCE((public.ops_setting('brand_auto_cards') #>> '{}')::boolean, false) THEN
    BEGIN
      v_brands := public.ops_brand_autolink();
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: brand auto-link stopped (% %)', SQLSTATE, SQLERRM;
    END;
  END IF;
  -- Wave 2: an open expected event whose host's brand now has a public event
  -- within 3 days of the expected date is linked to it, and its cards move.
  FOR v_exp IN SELECT * FROM public.ops_expected_events z WHERE z.status = 'open' AND z.repeats = 'none' ORDER BY z.expected_on, z.id LOOP
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
  -- #3980 synced, Wave 3: automatic steps from the timeline, only while the
  -- owner has them switched on.
  IF COALESCE((public.ops_setting('auto_steps') #>> '{}')::boolean, false) THEN
    BEGIN
      v_steps := public.ops_auto_steps(v_today, NULL);
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_reconcile: automatic steps stopped (% %)', SQLSTATE, SQLERRM;
    END;
  END IF;
  -- Wave 3: giveaway and ads cards follow their event. Public with 21 days
  -- or more left: free to start. Otherwise held, waiting for go-live or
  -- too late for promo. A card the owner or an admin overrode, or a person
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
            COALESCE(a->>'title', 'the event'), COALESCE(v_gate->>'lead_days', '21 or more')), 'bot');
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
        format('Go-live met: %s is public on Mingla. The gate card closed itself.', COALESCE(a->>'title', 'the event')), 'bot');
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
                            'engineering_cards', v_eng, 'github_bridges', v_bridges, 'feature_guide', v_guide,
                            'brand_autolink', v_brands, 'auto_steps', v_steps);
END;

$function$;

-- From its latest definition. #4398 (S3): kinds of notice.
CREATE OR REPLACE FUNCTION public.ops_working_clear(p_card_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; c public.ops_work_cards; n public.ops_work_cards; v_reason text := public.ops_one_line(p_reason); v_before jsonb;
        v_event uuid; v_holder text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only the owner or an admin can clear a working mark.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 200 OR public.ops_has_control(v_reason) THEN
    RAISE EXCEPTION 'reason_required: Say why in 5 to 200 characters.' USING ERRCODE = '22023';
  END IF;
  c := public.ops_card_lock(p_card_id, NULL);
  IF c.working_via IS NULL THEN
    RAISE EXCEPTION 'not_working: No agent is working on this card.' USING ERRCODE = '22023';
  END IF;
  v_holder := public.ops_actor_label(c.working_by, c.working_via, c.working_chat);
  v_before := public.ops_card_snapshot(c.id);
  UPDATE public.ops_work_cards SET working_by = NULL, working_via = NULL, working_chat = NULL, working_seen_at = NULL,
         revision = revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_event := public.ops_card_event(c.id, v.actor_email, NULL, 'working_cleared', format('Cleared %s''s working mark: %s', v_holder, v_reason),
    v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  PERFORM public.ops_log_write(v.actor_email, NULL, 'working_cleared', 'info', c.id, 'work_card', c.id,
    format('%s cleared %s''s working mark on Card %s: %s', public.ops_name(v.actor_email), v_holder, n.number, v_reason), '{}'::jsonb);
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY[c.working_by], v.actor_email,
    format('%s cleared %s''s working mark on %s: %s', public.ops_name(v.actor_email), v_holder, n.title, v_reason), 'edit');
  RETURN jsonb_build_object('card', public.ops_card_json(n, public.ops_today(NULL)), 'event_id', v_event);
END;
$function$;

-- From its latest definition. #4398 (S3): a note tells the people it tags (a mention push).
CREATE OR REPLACE FUNCTION public.ops_message_post(p_card_id uuid, p_body text, p_mentions text[] DEFAULT '{}'::text[], p_parent_message_id uuid DEFAULT NULL::uuid, p_file_ids uuid[] DEFAULT NULL::uuid[], p_everyone boolean DEFAULT false, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; c public.ops_work_cards; m public.ops_work_messages; pm public.ops_work_messages; v_body text := COALESCE(public.ops_multi_line(p_body), '');
  v_replay jsonb; v_m text; v_email text; v_emails text[] := ARRAY[]::text[]; v_tell text[]; v_event uuid; v_told integer; v_out jsonb;
  v_files uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_file_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL); v_ok integer;
  v_chat text; v_words text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'message',
    jsonb_build_object('id', p_card_id, 'body', p_body, 'mentions', to_jsonb(COALESCE(p_mentions, ARRAY[]::text[])),
                       'parent', p_parent_message_id, 'files', to_jsonb(v_files), 'everyone', COALESCE(p_everyone, false)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_card_id AND w.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF v.via IS NOT NULL AND NOT public.ops_is_person_on(c.id, v.actor_email, ARRAY['owner','watcher']) THEN
    RAISE EXCEPTION 'not_your_card: Your person is not an owner or watcher of this card. Ask an owner to add them.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_body) > 10000 OR public.ops_has_control(v_body) THEN
    RAISE EXCEPTION 'invalid_message: A message is up to 10,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_body = '' AND cardinality(v_files) = 0 THEN
    RAISE EXCEPTION 'invalid_message: Write something or attach a file.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_files) > 10 THEN
    RAISE EXCEPTION 'too_many_files: A message carries up to 10 files.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_ok FROM public.ops_work_files f
   WHERE f.id = ANY (v_files) AND f.card_id = c.id AND f.message_id IS NULL AND f.archived_at IS NULL
     AND f.added_by = v.actor_email AND (f.kind = 'link' OR public.ops_file_uploaded(f.storage_path));
  IF v_ok <> cardinality(v_files) THEN
    RAISE EXCEPTION 'invalid_message: A file is not on this card, is already in a message, or has not finished uploading.' USING ERRCODE = '22023';
  END IF;
  IF p_parent_message_id IS NOT NULL THEN
    SELECT * INTO pm FROM public.ops_work_messages x WHERE x.id = p_parent_message_id;
    IF NOT FOUND OR pm.card_id <> c.id OR pm.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'not_found: That message is no longer in this thread.' USING ERRCODE = 'P0002';
    END IF;
    -- Replies are one level: a reply to a reply joins the same message.
    IF pm.parent_message_id IS NOT NULL THEN
      SELECT * INTO pm FROM public.ops_work_messages x WHERE x.id = pm.parent_message_id;
    END IF;
  END IF;
  IF COALESCE(p_everyone, false) THEN
    IF v.via IS NOT NULL OR NOT COALESCE(public.is_admin_user(), false) THEN
      RAISE EXCEPTION 'forbidden: Only the owner or an admin can mention everyone.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ops_work_messages x WHERE x.author_email = v.actor_email AND x.mention_everyone
                AND x.created_at > clock_timestamp() - interval '10 minutes') THEN
      RAISE EXCEPTION 'too_soon: You mentioned everyone in the last 10 minutes. Mention the people who need it.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF cardinality(COALESCE(p_mentions, ARRAY[]::text[])) > 20 THEN
    RAISE EXCEPTION 'too_many_mentions: Mention at most 20 teammates in one message.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_m IN ARRAY COALESCE(p_mentions, ARRAY[]::text[]) LOOP
    v_email := public.ops_team_email(v_m);
    IF v_email IS NULL THEN
      RAISE EXCEPTION '%', format('invalid_mention_recipient: %s is not on the team.', left(COALESCE(v_m, ''), 80)) USING ERRCODE = '22023';
    END IF;
    IF NOT v_email = ANY (v_emails) THEN v_emails := v_emails || v_email; END IF;
  END LOOP;
  v_chat := CASE WHEN v.via IN ('claude', 'codex') THEN public.ops_ctx_chat() END;
  v_words := CASE WHEN v_body <> '' THEN v_body
                  WHEN cardinality(v_files) = 1 THEN 'sent a file'
                  ELSE format('sent %s files', cardinality(v_files)) END;
  -- The note event: the history line and the source every notice points at.
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'note', left(v_words, 2000), NULL, NULL, NULL, NULL);
  INSERT INTO public.ops_work_messages (card_id, parent_message_id, author_email, via, chat, body_md, mentions, mention_everyone, event_id, request_key)
  VALUES (c.id, pm.id, v.actor_email, v.via, v_chat, v_body, v_emails, COALESCE(p_everyone, false), v_event, p_request_key)
  RETURNING * INTO m;
  UPDATE public.ops_work_files f SET message_id = m.id WHERE f.id = ANY (v_files);
  IF v.via IS NOT NULL AND c.working_via IS NOT NULL AND c.status <> 'done'
     AND public.ops_same_agent(c.working_by, c.working_via, c.working_chat, v.actor_email, v.via, public.ops_ctx_chat()) THEN
    UPDATE public.ops_work_cards SET working_seen_at = clock_timestamp() WHERE id = c.id;
  END IF;
  v_tell := v_emails
    || CASE WHEN COALESCE(p_everyone, false) THEN ARRAY(SELECT d.email FROM public.admin_team_directory() d WHERE d.status = 'active') ELSE ARRAY[]::text[] END
    || CASE WHEN pm.id IS NOT NULL THEN ARRAY[pm.author_email] ELSE ARRAY[]::text[] END;
  v_told := public.ops_notify_people(c.id, v_event, v_tell, v.actor_email,
    format('%s on %s: %s', public.ops_actor_label(v.actor_email, v.via, public.ops_ctx_chat()), c.title, v_words), 'mention');
  v_out := jsonb_build_object('message', public.ops_message_json(m, v.actor_email, v.via), 'event_id', v_event, 'told', v_told);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'message', v_out);
  RETURN v_out;
END;
$function$;

-- From 20280323004256 (#4256). #4398: the route picks the people; reopened cards go under their route; bot notices are Admin-only.
CREATE OR REPLACE FUNCTION public.ops_auto_steps(p_today date, p_record_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c_cap constant integer := 50;
  v_today date := public.ops_today(p_today);
  v_added integer := 0; v_closed integer := 0; v_redated integer := 0; v_deferred integer := 0;
  c public.ops_work_cards; n public.ops_work_cards; a jsonb; st jsonb; x public.ops_expected_events; h record; e record;
  v_res jsonb; v_want jsonb := '[]'::jsonb; w jsonb; v_owners text[]; v_mkt text; v_mkt_owners text[];
  v_auto_promo boolean := COALESCE((public.ops_setting('auto_promo_cards') #>> '{}')::boolean, false);
  v_start date; v_title text; v_due date; v_before jsonb; v_event uuid; v_next jsonb; v_first date; v_occ jsonb;
  v_hostnext jsonb := '{}'::jsonb; v_words text; v_past boolean; v_new_title text; v_rid uuid; v_rtitle text; v_ron date;
  v_ins text; v_parked uuid;
  c_series_parked constant text := 'All 4 coming dates are live. This card opens again when the next date needs publishing.';
  c_golive_repeat constant text := 'The dates now repeat. One rolling card keeps them live.';
BEGIN

  -- 1. Cancelled or removed events: their open automatic and launch kit
  -- cards close with the reason.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND (w0.auto_key IS NOT NULL OR w0.kit_step IS NOT NULL)
              AND w0.anchor_id IS NOT NULL
              AND ((w0.anchor_kind = 'event' AND NOT EXISTS (SELECT 1 FROM public.events ev
                                                              WHERE ev.id = w0.anchor_id AND ev.deleted_at IS NULL AND ev.status <> 'cancelled'))
                   OR (w0.anchor_kind = 'expected' AND EXISTS (SELECT 1 FROM public.ops_expected_events z
                                                                WHERE z.id = w0.anchor_id AND z.status = 'cancelled')))
              AND (p_record_id IS NULL OR public.ops_card_of_host(w0, p_record_id))
            ORDER BY w0.number LOOP
    BEGIN
      v_res := public.ops_auto_card_close(c.id, 'Event cancelled.',
        jsonb_build_array(jsonb_build_object('text', 'The event this card was counted from was cancelled or removed.')));
      IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: closing card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- 2. An event or expected event whose first date moved: its open cards
  -- counted from the launch kit follow it. A due date a person typed is
  -- never changed.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.due_source = 'kit' AND w0.kit_step IS NOT NULL
              AND w0.anchor_id IS NOT NULL
              AND (p_record_id IS NULL OR public.ops_card_of_host(w0, p_record_id))
            ORDER BY w0.number LOOP
    BEGIN
      a := public.ops_anchor(c.anchor_kind, c.anchor_id, v_today);
      CONTINUE WHEN a IS NULL OR a->>'start_on' IS NULL;
      v_start := (a->>'start_on')::date;
      v_due := v_start + c.kit_step;
      CONTINUE WHEN v_due IS NOT DISTINCT FROM c.due_on;
      v_before := public.ops_card_snapshot(c.id);
      v_new_title := c.title;
      v_ins := c.instructions;
      -- The card's words follow the new dates too.
      IF c.auto_key LIKE 'golive:%' THEN
        v_new_title := left(format('Get %s live by %s', left(COALESCE(a->>'title', 'the event'), 120), public.ops_day_words(v_start - 28)), 160);
        v_ins := format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                        public.ops_day_words(v_start - 35), public.ops_day_words(v_start - 31));
      ELSIF c.auto_key LIKE 'promo:%' THEN
        v_ins := format('Starts %s. Creators post %s, reminder %s. Money is spent only after a person approves it in Needs you.',
                        public.ops_day_words(v_start - 21), public.ops_day_words(v_start - 14), public.ops_day_words(v_start - 7));
      END IF;
      UPDATE public.ops_work_cards w0 SET due_on = v_due, title = v_new_title, instructions = v_ins, revision = w0.revision + 1,
             updated_by = c_actor, updated_via = 'system', updated_at = now()
       WHERE w0.id = c.id RETURNING w0.* INTO n;
      v_words := format('Re-dated to %s: %s now starts %s.', public.ops_day_words(v_due), COALESCE(a->>'title', 'the event'), public.ops_day_words(v_start));
      v_event := public.ops_card_event(c.id, c_actor, 'system', 'redated', v_words, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
      PERFORM public.ops_log_write(c_actor, 'system', 'auto_redated', 'info', c.id, c.anchor_kind, c.anchor_id,
        format('Card %s re-dated to %s: %s moved to %s.', n.number, public.ops_day_words(v_due), COALESCE(a->>'title', 'the event'), public.ops_day_words(v_start)),
        jsonb_build_object('from', c.due_on, 'to', v_due));
      PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), c_actor,
        format('Mingla re-dated "%s" to %s: the event moved to %s.', n.title, public.ops_day_words(v_due), public.ops_day_words(v_start)), 'bot');
      v_redated := v_redated + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: re-dating card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- The hosts this run looks at, with their next dated thing.
  SELECT COALESCE(jsonb_object_agg(r0->>'record_id', r0), '{}'::jsonb) INTO v_hostnext
    FROM jsonb_array_elements(public.ops_host_next_rows(ARRAY(
           SELECT c0.id FROM public.crm_records c0
            WHERE c0.pipeline = 'hosts' AND c0.deleted_at IS NULL AND c0.stage <> 'lost'
              AND (p_record_id IS NULL OR c0.id = p_record_id)), v_today)) r0;

  -- 3. "Ask for their first or next event" closes once something is coming up.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.auto_key LIKE 'ask:%'
              AND (p_record_id IS NULL OR w0.auto_key = 'ask:' || p_record_id) ORDER BY w0.number LOOP
    BEGIN
      v_next := v_hostnext->split_part(c.auto_key, ':', 2)->'next';
      CONTINUE WHEN v_next IS NULL OR jsonb_typeof(v_next) <> 'object';
      v_res := public.ops_auto_card_close(c.id,
        format('Next event set: %s on %s.', left(v_next->>'title', 160), public.ops_day_words((v_next->>'start_on')::date)),
        jsonb_build_array(jsonb_build_object('text', format('%s on %s is on the Calendar.', left(v_next->>'title', 160),
          public.ops_day_words((v_next->>'start_on')::date)))));
      IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: closing card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- 4. A repeating host's rolling card follows its series on every run: the
  -- next date to publish, its words and its due date (that date less 28
  -- days) are worked out again. A due date is never moved into the past
  -- unless it was already there, so a recompute never makes a card overdue
  -- by itself. When all 4 kept dates are live the card closes and says why;
  -- it opens again when a new unpublished date comes into the window. A
  -- series that stops repeating, ends or is cancelled closes its card.
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND w0.auto_key LIKE 'series:%'
              AND (p_record_id IS NULL OR public.ops_card_of_host(w0, p_record_id)) ORDER BY w0.number LOOP
    BEGIN
      x := NULL;
      SELECT z.* INTO x FROM public.ops_expected_events z WHERE z.id::text = split_part(c.auto_key, ':', 2);
      IF x.id IS NULL OR x.status <> 'open' OR x.repeats = 'none' THEN
        v_words := CASE WHEN x.id IS NULL OR x.status = 'cancelled' THEN 'Event cancelled.'
                        WHEN x.status <> 'open' THEN 'The repeating dates have ended.'
                        ELSE 'The dates no longer repeat, so this card is not needed.' END;
        v_res := public.ops_auto_card_close(c.id, v_words,
          jsonb_build_array(jsonb_build_object('text', CASE WHEN x.id IS NOT NULL AND x.status = 'open'
            THEN format('%s now happens once, on %s.', left(x.title, 160), public.ops_day_long(x.expected_on))
            ELSE 'The repeating dates this card kept live were stopped.' END)));
        IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
        CONTINUE;
      END IF;
      v_first := NULL;
      SELECT (o->>'on')::date INTO v_first FROM jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
       WHERE NOT (o->>'live')::boolean ORDER BY (o->>'on')::date LIMIT 1;
      IF v_first IS NULL THEN
        v_res := public.ops_auto_card_close(c.id, c_series_parked,
          jsonb_build_array(jsonb_build_object('text', format('The next 4 dates of %s are public on Mingla.', left(x.title, 160)))));
        IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
        CONTINUE;
      END IF;
      v_due := GREATEST(v_first - 28, LEAST(COALESCE(c.due_on, v_today), v_today));
      v_ins := format('Repeats every %s. Next date to publish: %s.', CASE WHEN x.repeats = 'week' THEN 'week' ELSE 'month' END,
                      public.ops_day_long(v_first));
      CONTINUE WHEN v_due IS NOT DISTINCT FROM c.due_on AND v_ins IS NOT DISTINCT FROM c.instructions;
      v_before := public.ops_card_snapshot(c.id);
      UPDATE public.ops_work_cards w0 SET due_on = v_due, instructions = v_ins,
             revision = w0.revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
       WHERE w0.id = c.id RETURNING w0.* INTO n;
      v_words := format('Moved on: the next date to publish is %s.', public.ops_day_long(v_first));
      v_event := public.ops_card_event(c.id, c_actor, 'system', 'redated', v_words, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
      PERFORM public.ops_log_write(c_actor, 'system', 'auto_redated', 'info', c.id, 'expected', x.id,
        format('Card %s moved on: the next %s date to publish is %s.', n.number, x.title, public.ops_day_words(v_first)),
        jsonb_build_object('from', c.due_on, 'to', v_due));
      v_redated := v_redated + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: rolling card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- A one-off promised date that now repeats: its go-live card closes, the
  -- one rolling card covers the series (never two cards for one host's dates).
  FOR c IN SELECT w0.* FROM public.ops_work_cards w0
             JOIN public.ops_expected_events z ON w0.auto_key = 'golive:expected:' || z.id
            WHERE w0.status <> 'done' AND w0.archived_at IS NULL AND z.status = 'open' AND z.repeats <> 'none'
              AND (p_record_id IS NULL OR z.record_id = p_record_id)
            ORDER BY w0.number LOOP
    BEGIN
      v_res := public.ops_auto_card_close(c.id, c_golive_repeat,
        jsonb_build_array(jsonb_build_object('text', 'The host''s dates repeat now, so the rolling card for the series covers them.')));
      IF v_res->>'status' = 'closed' THEN v_closed := v_closed + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: closing card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- 5. The cards the timeline asks for. Each key makes at most one open card.
  FOR h IN SELECT c0.id, c0.name, c0.brand_id, c0.stage FROM public.crm_records c0
            WHERE c0.pipeline = 'hosts' AND c0.deleted_at IS NULL AND c0.stage <> 'lost'
              AND (p_record_id IS NULL OR c0.id = p_record_id)
            ORDER BY c0.id LOOP
    -- #4398 (A3): the route gives each card its owner and watcher.
    -- A1 go-live and A2 giveaway and ads, for the brand's events.
    IF h.brand_id IS NOT NULL THEN
      FOR e IN SELECT ev.id FROM public.events ev
                WHERE ev.brand_id = h.brand_id AND ev.deleted_at IS NULL AND ev.status IN ('draft', 'scheduled', 'live')
                  AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = ev.id
                               AND d.start_at >= ((v_today - 2)::timestamp AT TIME ZONE 'UTC'))
                ORDER BY ev.id LOOP
        a := public.ops_anchor('event', e.id, v_today);
        CONTINUE WHEN a IS NULL OR a->>'start_on' IS NULL OR (a->>'start_on')::date < v_today;
        CONTINUE WHEN public.ops_event_in_series(h.id, e.id, v_today);
        st := public.ops_plain_state(a, v_today);
        v_start := (a->>'start_on')::date;
        v_title := left(COALESCE(NULLIF(btrim(a->>'title'), ''), 'The event'), 120);
        IF st->>'k' = 'notlive'
           -- one go-live card per dated thing: a promised date within 3 days stands for this draft
           AND NOT EXISTS (SELECT 1 FROM public.ops_expected_events z WHERE z.record_id = h.id AND z.status = 'open'
                            AND z.repeats = 'none' AND abs(z.expected_on - v_start) <= 3)
           AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.anchor_kind = 'event' AND k.anchor_id = e.id
                            AND k.kit_step = -28 AND k.archived_at IS NULL) THEN
          v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'golive:event:' || e.id, 'kind', 'gate_live', 'due', v_start - 28,
            'anchor', jsonb_build_object('kind', 'event', 'id', e.id),
            'item', jsonb_build_object(
              'title', left(format('Get %s live by %s', v_title, public.ops_day_words(v_start - 28)), 160),
              'instructions', format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                                     public.ops_day_words(v_start - 35), public.ops_day_words(v_start - 31)),
              'done_means', left(format('%s is public on Mingla.', v_title), 300),
              'kit_step', -28,
              'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
        -- #4256: giveaway and ads cards are opened by a person; Mingla makes
        -- them by itself only while auto_promo_cards is on (off as shipped).
        ELSIF st->>'k' IN ('ready', 'short') AND v_auto_promo
           AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.anchor_kind = 'event' AND k.anchor_id = e.id
                            AND k.kit_step = -21 AND k.archived_at IS NULL) THEN
          v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'promo:event:' || e.id, 'kind', 'promo', 'due', v_start - 21,
            'anchor', jsonb_build_object('kind', 'event', 'id', e.id),
            'item', jsonb_build_object(
              'title', left(format('Giveaway and ads for %s', v_title), 160),
              'instructions', format('Starts %s. Creators post %s, reminder %s. Money is spent only after a person approves it in Needs you.',
                                     public.ops_day_words(v_start - 21), public.ops_day_words(v_start - 14), public.ops_day_words(v_start - 7)),
              'done_means', 'The giveaway is open and the ads plan is approved by a person.',
              'kit_step', -21,
              'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
        END IF;
      END LOOP;
    END IF;
    -- A1 go-live for one-off promised dates and promo moments.
    FOR x IN SELECT z.* FROM public.ops_expected_events z
              WHERE z.record_id = h.id AND z.status = 'open' AND z.repeats = 'none' AND z.expected_on >= v_today ORDER BY z.expected_on, z.id LOOP
      st := public.ops_plain_state(public.ops_expected_anchor(x, x.expected_on), v_today);
      CONTINUE WHEN st->>'k' <> 'notlive';
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.anchor_kind = 'expected' AND k.anchor_id = x.id
                             AND k.kit_step = -28 AND k.archived_at IS NULL AND k.status <> 'done');
      v_title := left(x.title, 120);
      -- #3980 W3 rework 2: one open go-live card per promised date. A card
      -- from an earlier round (closed by Mingla when the dates began to
      -- repeat, or closed before a rolling card of a later round was made)
      -- opens again: the same card, with its history. A card a person closed
      -- in this round stays closed.
      v_parked := NULL;
      SELECT k.id INTO v_parked FROM public.ops_work_cards k
       WHERE k.anchor_kind = 'expected' AND k.anchor_id = x.id AND k.kit_step = -28 AND k.archived_at IS NULL AND k.status = 'done'
       ORDER BY k.closed_at DESC NULLS LAST, k.number DESC LIMIT 1;
      IF v_parked IS NOT NULL THEN
        SELECT * INTO c FROM public.ops_work_cards k WHERE k.id = v_parked;
        IF (c.close_kind = 'system' AND c.close_reason = c_golive_repeat)
           OR EXISTS (SELECT 1 FROM public.ops_work_cards s WHERE s.auto_key = 'series:' || x.id AND s.created_at > COALESCE(c.closed_at, c.created_at)) THEN
          BEGIN
            v_before := public.ops_card_snapshot(v_parked);
            SELECT * INTO c FROM public.ops_work_cards k WHERE k.id = v_parked FOR UPDATE;
            UPDATE public.ops_work_cards w0 SET status = 'todo', person_reason = NULL, close_kind = NULL, close_reason = NULL, closed_at = NULL,
                   closed_by = NULL, closed_via = NULL, proof = '[]'::jsonb,
                   title = left(format('Get %s live by %s', v_title, public.ops_day_words(x.expected_on - 28)), 160),
                   instructions = format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                                         public.ops_day_words(x.expected_on - 35), public.ops_day_words(x.expected_on - 31)),
                   due_on = x.expected_on - 28, due_source = 'kit', sprint_id = public.ops_sprint_ensure(v_today),
                   revision = w0.revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
             WHERE w0.id = v_parked RETURNING w0.* INTO n;
            v_words := format('Opened again: %s happens once, on %s, and is not live yet.', v_title, public.ops_day_long(x.expected_on));
            v_event := public.ops_card_event(n.id, c_actor, 'system', 'reopened', v_words, v_before, public.ops_card_snapshot(n.id), c.revision, n.revision);
            PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', n.id, 'expected', x.id,
              format('Card %s opened again: %s happens once, on %s.', n.number, v_title, public.ops_day_words(x.expected_on)),
              jsonb_build_object('auto_key', n.auto_key, 'reopened', true));
            PERFORM public.ops_auto_card_reroute(n.id);  -- #4398: under its route, with its people
            PERFORM public.ops_notify_people(n.id, v_event, public.ops_card_people(n.id, NULL), c_actor,
              format('Mingla opened "%s" again: the dates no longer repeat.', n.title), 'bot');
            v_added := v_added + 1;
          EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: reopening card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
          END;
        END IF;
        CONTINUE;
      END IF;
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'golive:expected:' || x.id, 'kind', 'gate_live', 'due', x.expected_on - 28,
        'anchor', jsonb_build_object('kind', 'expected', 'id', x.id),
        'item', jsonb_build_object(
          'title', left(format('Get %s live by %s', v_title, public.ops_day_words(x.expected_on - 28)), 160),
          'instructions', format('Host owner. Steps before it: get the flyer, logo, prices and date (%s), build the listing with the host (%s).',
                                 public.ops_day_words(x.expected_on - 35), public.ops_day_words(x.expected_on - 31)),
          'done_means', left(format('%s is public on Mingla.', v_title), 300),
          'kit_step', -28,
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
    END LOOP;
    -- A5 one rolling card per repeating series.
    FOR x IN SELECT z.* FROM public.ops_expected_events z
              WHERE z.record_id = h.id AND z.status = 'open' AND z.repeats <> 'none' ORDER BY z.expected_on, z.id LOOP
      v_first := NULL;
      SELECT (o->>'on')::date INTO v_first FROM jsonb_array_elements(public.ops_expected_occurrences(x, v_today, 4)) o
       WHERE NOT (o->>'live')::boolean ORDER BY (o->>'on')::date LIMIT 1;
      CONTINUE WHEN v_first IS NULL OR v_first - 28 > v_today + 7;
      v_ins := format('Repeats every %s. Next date to publish: %s.', CASE WHEN x.repeats = 'week' THEN 'week' ELSE 'month' END,
                      public.ops_day_long(v_first));
      -- A card closed because every kept date was live opens again (same
      -- card, same history) once a date needs publishing.
      v_parked := NULL;
      IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.auto_key = 'series:' || x.id AND k.status <> 'done' AND k.archived_at IS NULL) THEN
        SELECT k.id INTO v_parked FROM public.ops_work_cards k
         WHERE k.auto_key = 'series:' || x.id AND k.status = 'done' AND k.archived_at IS NULL
           AND k.close_kind = 'system' AND k.close_reason = c_series_parked
         ORDER BY k.closed_at DESC, k.number DESC LIMIT 1;
      END IF;
      IF v_parked IS NOT NULL THEN
        BEGIN
          v_before := public.ops_card_snapshot(v_parked);
          SELECT * INTO c FROM public.ops_work_cards k WHERE k.id = v_parked FOR UPDATE;
          UPDATE public.ops_work_cards w0 SET status = 'todo', close_kind = NULL, close_reason = NULL, closed_at = NULL,
                 closed_by = NULL, closed_via = NULL, proof = '[]'::jsonb, instructions = v_ins,
                 due_on = GREATEST(v_first - 28, v_today), sprint_id = public.ops_sprint_ensure(v_today),
                 revision = w0.revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
           WHERE w0.id = v_parked RETURNING w0.* INTO n;
          v_words := format('Opened again: %s needs publishing.', public.ops_day_long(v_first));
          v_event := public.ops_card_event(n.id, c_actor, 'system', 'reopened', v_words, v_before, public.ops_card_snapshot(n.id), c.revision, n.revision);
          PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', n.id, 'expected', x.id,
            format('Card %s opened again: the next %s date to publish is %s.', n.number, x.title, public.ops_day_words(v_first)),
            jsonb_build_object('auto_key', n.auto_key, 'reopened', true));
          PERFORM public.ops_auto_card_reroute(n.id);  -- #4398: under its route, with its people
          PERFORM public.ops_notify_people(n.id, v_event, public.ops_card_people(n.id, NULL), c_actor,
            format('Mingla opened "%s" again: %s needs publishing.', n.title, public.ops_day_long(v_first)), 'bot');
          v_added := v_added + 1;
        EXCEPTION WHEN others THEN RAISE WARNING 'ops_auto_steps: reopening card % stopped (% %)', c.number, SQLSTATE, SQLERRM;
        END;
        CONTINUE;
      END IF;
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'series:' || x.id, 'kind', 'task', 'due', GREATEST(v_first - 28, v_today),
        'anchor', NULL,
        'item', jsonb_build_object(
          'title', left(format('Keep 4 weeks of %s dates live', left(h.name, 120)), 160),
          'instructions', v_ins,
          'done_means', left(format('The next 4 dates of %s are public on Mingla.', left(h.name, 120)), 300),
          'due_on', GREATEST(v_first - 28, v_today),
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id), jsonb_build_object('kind', 'expected', 'id', x.id)))));
    END LOOP;
    -- A3 recap after the host's latest event, and A4 ask for the first or
    -- next event, only when nothing is coming up.
    v_next := v_hostnext->(h.id::text)->'next';
    CONTINUE WHEN v_next IS NOT NULL AND jsonb_typeof(v_next) = 'object';
    v_rid := NULL; v_rtitle := NULL; v_ron := NULL;
    IF h.brand_id IS NOT NULL THEN
      SELECT ev.id, ev.title, (s.st AT TIME ZONE 'UTC')::date INTO v_rid, v_rtitle, v_ron
        FROM public.events ev
        JOIN LATERAL (SELECT public.ops_event_first_start(ev.id) AS st) s ON true
       WHERE ev.brand_id = h.brand_id AND ev.deleted_at IS NULL AND public.ops_event_public(ev.id) AND s.st IS NOT NULL
         AND (s.st AT TIME ZONE 'UTC')::date BETWEEN v_today - 7 AND v_today - 1
       ORDER BY s.st DESC, ev.id LIMIT 1;
    END IF;
    IF v_rid IS NOT NULL THEN
      v_title := left(COALESCE(NULLIF(btrim(v_rtitle), ''), 'the event'), 100);
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'recap:' || v_rid, 'kind', 'task', 'due', GREATEST(v_ron + 2, v_today),
        'anchor', NULL,
        'item', jsonb_build_object(
          'title', left(format('Recap %s and ask %s for their next event', v_title, left(h.name, 50)), 160),
          'instructions', 'Sales, check-ins, what to repeat. Then set their next event on the card.',
          'done_means', 'A recap note is on the host card and their next event is set.',
          'due_on', GREATEST(v_ron + 2, v_today),
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
    ELSIF h.stage IN ('replied', 'meeting', 'onboarded')
          AND NOT EXISTS (SELECT 1 FROM public.ops_work_cards k
                           JOIN public.ops_work_links l ON l.card_id = k.id AND l.kind = 'host' AND l.target_id = h.id
                          WHERE k.auto_key LIKE 'recap:%' AND k.status <> 'done' AND k.archived_at IS NULL) THEN
      v_past := (h.brand_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.events ev JOIN LATERAL (SELECT public.ops_event_first_start(ev.id) AS st) s ON true
                    WHERE ev.brand_id = h.brand_id AND ev.deleted_at IS NULL AND ev.status <> 'cancelled' AND s.st < now()))
                OR EXISTS (SELECT 1 FROM public.ops_expected_events z WHERE z.record_id = h.id AND z.status = 'fulfilled');
      v_want := v_want || jsonb_build_array(jsonb_build_object('key', 'ask:' || h.id, 'kind', 'task', 'due', v_today + 3,
        'anchor', NULL,
        'item', jsonb_build_object(
          'title', left(format('Ask %s for their %s event and date', left(h.name, 120), CASE WHEN v_past THEN 'next' ELSE 'first' END), 160),
          'instructions', 'Set it on their host card. The steps and the Calendar fill in from there.',
          'done_means', 'Their next event and its date are on the host card.',
          'due_on', v_today + 3,
          'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', h.id)))));
    END IF;
  END LOOP;

  -- Make them, soonest first, at most 50 a run.
  FOR w IN SELECT value FROM jsonb_array_elements(v_want) ORDER BY (value->>'due')::date, value->>'key' LOOP
    IF v_added >= c_cap THEN
      IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.auto_key = w->>'key' AND k.status <> 'done' AND k.archived_at IS NULL) THEN
        v_deferred := v_deferred + 1;
      END IF;
      CONTINUE;
    END IF;
    BEGIN
      v_res := public.ops_auto_card_upsert(w->>'key', w->'item', w->>'kind',
        CASE WHEN jsonb_typeof(w->'anchor') = 'object' THEN w->'anchor' END);
      IF v_res->>'status' = 'added' THEN v_added := v_added + 1; END IF;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'ops_auto_steps: % kept (an open card already covers it)', w->>'key';
    WHEN others THEN
      RAISE WARNING 'ops_auto_steps: % stopped (% %)', w->>'key', SQLSTATE, SQLERRM;
    END;
  END LOOP;
  IF v_deferred > 0 THEN
    PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', NULL, NULL, NULL,
      format('Mingla made %s cards from the timeline; %s more wait for the next run.', v_added, v_deferred),
      jsonb_build_object('added', v_added, 'deferred', v_deferred));
  END IF;
  RETURN jsonb_build_object('added', v_added, 'closed', v_closed, 'redated', v_redated, 'deferred', v_deferred);
END;
$function$;

-- From its latest definition. #4398: a reopened card goes under its route; bot notices are Admin-only.
CREATE OR REPLACE FUNCTION public.ops_brand_card_ask(p_auto_key text, p_item jsonb, p_card_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c_actor constant text := 'system@usemingla.com'; v_today date := public.ops_today(NULL);
  v_id uuid := p_card_id; c public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid;
BEGIN
  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.auto_key = p_auto_key AND k.archived_at IS NULL AND k.status <> 'done') THEN
      RETURN public.ops_auto_card_upsert(p_auto_key, p_item, 'task', NULL);
    END IF;
    SELECT k.id INTO v_id FROM public.ops_work_cards k
     WHERE k.auto_key = p_auto_key AND k.archived_at IS NULL AND k.status = 'done'
     ORDER BY k.closed_at DESC NULLS LAST, k.number DESC LIMIT 1;
    IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.ops_work_cards k WHERE k.id = v_id AND k.closed_via IN ('claude', 'codex')
                                     AND k.close_kind IN ('done', 'already_done', 'declined')) THEN
      RETURN public.ops_auto_card_upsert(p_auto_key, p_item, 'task', NULL);
    END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops_auto_card:' || p_auto_key, 0));
  v_before := public.ops_card_snapshot(v_id);
  SELECT * INTO c FROM public.ops_work_cards k WHERE k.id = v_id FOR UPDATE;
  IF c.id IS NULL OR c.archived_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'refused'); END IF;
  IF c.status <> 'done' THEN RETURN jsonb_build_object('status', 'kept', 'id', c.id); END IF;
  UPDATE public.ops_work_cards w0 SET status = 'todo', person_reason = NULL, close_kind = NULL, close_reason = NULL, closed_at = NULL,
         closed_by = NULL, closed_via = NULL, proof = '[]'::jsonb,
         title = left(p_item->>'title', 160), instructions = left(p_item->>'instructions', 4000),
         done_means = left(p_item->>'done_means', 300), due_on = GREATEST((p_item->>'due_on')::date, v_today),
         sprint_id = public.ops_sprint_ensure(v_today),
         revision = w0.revision + 1, updated_by = c_actor, updated_via = 'system', updated_at = now()
   WHERE w0.id = v_id RETURNING w0.* INTO n;
  PERFORM public.ops_links_set(n.id, COALESCE((
    SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'id', x.id, 'label', x.label))
      FROM (SELECT l->>'kind' AS kind, l->>'id' AS id, public.ops_link_label(l->>'kind', (l->>'id')::uuid) AS label
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_item->'links') = 'array' THEN p_item->'links' ELSE '[]'::jsonb END) l
             WHERE public.ops_is_uuid(l->>'id')) x
     WHERE x.label IS NOT NULL), '[]'::jsonb), c_actor, NULL);
  v_event := public.ops_card_event(n.id, c_actor, 'system', 'reopened',
    CASE WHEN p_card_id IS NOT NULL THEN 'Opened again: a new host card matches exactly since this was decided.'
         ELSE 'Opened again: an agent closed it, and only a person decides which host card a brand belongs to.' END,
    v_before, public.ops_card_snapshot(n.id), c.revision, n.revision);
  PERFORM public.ops_log_write(c_actor, 'system', 'auto_added', 'info', n.id, 'work_card', n.id,
    format('Card %s opened again: %s', n.number, n.title), jsonb_build_object('auto_key', n.auto_key, 'reopened', true));
  PERFORM public.ops_auto_card_reroute(n.id);  -- #4398: under its route, with its people
  PERFORM public.ops_notify_people(n.id, v_event, public.ops_card_people(n.id, NULL), c_actor, format('Mingla opened "%s" again.', n.title), 'bot');
  RETURN jsonb_build_object('status', 'reopened', 'id', n.id, 'number', n.number);
END;
$function$;

-- From its latest definition (#4270 w3). #4398 (B2): one owner and one watcher.
CREATE OR REPLACE FUNCTION public.brand_plan_host_add(p_brand_id uuid, p_item jsonb, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); b public.brands; v_actor text; v_name text; v_today date; v_replay jsonb; v_out jsonb;
  cl jsonb; v_title text; v_shown text; v_on date; v_record uuid; v_record_name text; v_owners text[]; v_watchers text[]; v_route jsonb; v_owner text; v_watcher text; -- #4398
  i public.content_calendar_items; c public.ops_work_cards; v_event uuid; v_n integer;
BEGIN
  IF v_uid IS NULL OR NOT public.brand_plan_can_read(p_brand_id, v_uid) THEN
    RAISE EXCEPTION 'not_found: This plan is not here.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.brand_plan_can_write(p_brand_id, v_uid) THEN
    RAISE EXCEPTION 'read_only: You can see this plan. Ask your brand admin to let you add to it.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT b FROM public.brands x WHERE x.id = p_brand_id;
  v_actor := public.brand_plan_host_actor(v_uid);
  v_name := public.brand_plan_host_name(v_uid);
  v_today := (now() AT TIME ZONE COALESCE(NULLIF(b.default_timezone, ''), 'UTC'))::date;
  IF p_request_key IS NOT NULL AND p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v_actor, p_request_key, 'brand_plan_host_add', jsonb_build_object('brand_id', p_brand_id, 'item', p_item));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  cl := public.brand_plan_clean_item(p_item, ARRAY['type','title','on','link','note'], v_today, true);
  v_shown := cl->>'title'; v_title := v_shown; v_on := (cl->>'on')::date;
  -- At most 30 adds a day for one person on one brand.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brand_plan_host_add:' || v_uid::text || ':' || p_brand_id::text, 0));
  SELECT (SELECT count(*) FROM public.content_calendar_items x
           WHERE x.brand_id = p_brand_id AND x.brand_plan_author_id = v_uid AND x.created_at > now() - interval '1 day')
       + (SELECT count(*) FROM public.ops_work_cards w
           WHERE w.brand_plan_author_id = v_uid AND w.created_at > now() - interval '1 day'
             AND public.brand_plan_card_brand(w.id) = p_brand_id) INTO v_n;
  IF v_n >= 30 THEN
    RAISE EXCEPTION 'too_many: You''ve added a lot today. Try again tomorrow.' USING ERRCODE = '22023';
  END IF;
  v_record := public.brand_plan_host_record(p_brand_id);
  v_owners := ARRAY(SELECT o.owner_email FROM public.crm_record_owners o WHERE o.record_id = v_record ORDER BY o.added_at, o.owner_email);

  IF cl->>'type' = 'post' THEN
    -- D24 (rework, P3-3): always "{title} · {brand}" on the Calendar; hosts
    -- see the plain title (D29).
    v_title := public.brand_plan_host_title('post', v_shown, b.id, NULL);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.content_calendar_items (title, plan_title, owner_emails, publish_at, notes, brand_id, plan_link_url,
      brand_plan_author_id, brand_plan_source, created_by, updated_by)
    VALUES (v_title, v_shown, v_owners, (v_on::timestamp + time '12:00') AT TIME ZONE 'UTC',
      format('Added by %s in the Host app.', v_name) || COALESCE(' Note: ' || (cl->>'note'), ''),
      b.id, cl->>'link', v_uid, 'host_app', v_actor, v_actor)
    RETURNING * INTO i;
    PERFORM public.content_calendar_audit_write(i.id, v_actor, NULL, 'content.created',
      jsonb_build_object('to_revision', i.revision, 'source', 'host_app',
        'changed_fields', jsonb_build_array('title','owners','stage','publish_at','brand_id','plan_link_url')));
    PERFORM public.brand_plan_line(b.id, format('%s added “%s” to the plan for %s.', v_name, v_shown, public.brand_plan_day_words(v_on)));
    v_out := jsonb_build_object('kind', 'post', 'status', 'added',
      'item', public.brand_plan_post_item(i, true, v_uid, true));
  ELSE
    IF v_record IS NULL THEN
      RAISE EXCEPTION 'no_host_card: Mingla hasn''t set up your brand yet. Message the Brand group instead.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_title) < 3 THEN
      RAISE EXCEPTION 'invalid_title: Say what it is in 3 to 160 characters.' USING ERRCODE = '22023';
    END IF;
    v_title := public.brand_plan_host_title('task', v_shown, b.id, NULL);
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
    END IF;
    SELECT x.name INTO v_record_name FROM public.crm_records x WHERE x.id = v_record;
    v_watchers := ARRAY(SELECT DISTINCT o.owner_email FROM public.crm_record_owners o JOIN public.crm_records x ON x.id = o.record_id
                         WHERE x.brand_id = b.id AND x.pipeline = 'hosts' AND x.deleted_at IS NULL AND x.id <> v_record
                           AND NOT (o.owner_email = ANY (v_owners)));
    INSERT INTO public.ops_work_cards (title, plan_title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan,
      files_url, on_brand_plan, brand_plan_author_id, brand_plan_source, created_by, created_via, updated_by, updated_via)
    VALUES (v_title, v_shown,
      format('Added by %s from the Brand group plan.', v_name) || COALESCE(' Note: ' || (cl->>'note'), ''),
      'Done and the host is told in the Brand group.', 'todo', 'task', v_on, 'explicit',
      public.ops_sprint_for(v_on, public.ops_today(NULL)), '[]'::jsonb,
      cl->>'link', true, v_uid, 'host_app', v_actor, NULL, v_actor, NULL)
    RETURNING * INTO c;
    -- #4398 (B2): one owner and one watcher. The owner is the host card's
    -- first owner still on the team (else the brand_plan route's owner); the
    -- watcher is the route's watcher (its owner when that is the same person).
    v_route := public.ops_auto_route('brand_plan');
    v_owner := (SELECT x FROM unnest(v_owners) WITH ORDINALITY u(x, o) WHERE public.ops_team_email(x) IS NOT NULL ORDER BY u.o LIMIT 1);
    v_owner := COALESCE(v_owner, v_route->>'owner', public.ops_owner_email());
    v_watcher := CASE WHEN v_route->>'watcher' IS DISTINCT FROM v_owner THEN v_route->>'watcher' ELSE v_route->>'owner' END;
    IF v_watcher IS NULL OR v_watcher = v_owner THEN
      v_watcher := (SELECT x FROM unnest(v_watchers || v_owners) x WHERE x IS DISTINCT FROM v_owner AND public.ops_team_email(x) IS NOT NULL LIMIT 1);
    END IF;
    IF v_watcher IS NULL THEN  -- nobody else on the host card and no route: the board owner, or the first other active admin
      v_watcher := (SELECT lower(btrim(au.email)) FROM public.admin_users au
                     WHERE au.status = 'active' AND lower(btrim(au.email)) IS DISTINCT FROM v_owner AND public.ops_team_email(au.email) IS NOT NULL
                     ORDER BY (au.role = 'owner') DESC, au.accepted_at NULLS LAST, au.created_at LIMIT 1);
    END IF;
    v_owners := ARRAY[v_owner]; v_watchers := CASE WHEN v_watcher IS NOT NULL THEN ARRAY[v_watcher] ELSE ARRAY[]::text[] END;
    PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v_actor, NULL);
    PERFORM public.ops_links_set(c.id, jsonb_build_array(jsonb_build_object('kind', 'host', 'id', v_record, 'label', v_record_name)), v_actor, NULL);
    v_event := public.ops_card_event(c.id, v_actor, NULL, 'added', 'Added from the Host app.', NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
    PERFORM public.ops_notify_people(c.id, v_event, v_owners, v_actor, format('%s added a task on the %s plan: %s', v_name, b.name, c.title), 'assigned');
    PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v_actor, format('%s added a task on the %s plan: %s', v_name, b.name, c.title), 'assigned');
    PERFORM public.ops_log_write(v_actor, NULL, 'card_added', 'ok', c.id, 'work_card', c.id,
      format('Added Card %s from the Host app: %s', c.number, c.title), jsonb_build_object('source', 'host_app', 'owners', cardinality(v_owners)));
    PERFORM public.brand_plan_line(b.id, format('%s added “%s” to the plan for %s.', v_name, v_shown, public.brand_plan_day_words(v_on)));
    v_out := jsonb_build_object('kind', 'task', 'status', 'added',
      'item', public.brand_plan_card_item(c, true, v_uid, true));
  END IF;
  PERFORM public.ops_request_finish(v_actor, p_request_key, 'brand_plan_host_add', v_out);
  RETURN v_out;
-- Rework (W3 test P3-8): a same-title race gets the D24 words, never the raw
-- constraint.
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: Something with this name is already planned. Change the name a little.' USING ERRCODE = '23505';
END;
$function$;

-- From its latest definition. #4398 (A3, subtract before adding): an
-- automatic card takes its route's owner and watcher when it is made, and the
-- open-card invariant keeps one owner on every open card, so there is never
-- an ownerless card left to adopt. Kept as a no-op for its callers.
CREATE OR REPLACE FUNCTION public.ops_host_adopt_cards(p_record_id uuid, p_actor text, p_via text) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$ SELECT 0 $function$;

-- From 20280624014255 (#4255 functions). #4398 (C): undo of a review ask; undo of a reopen.
CREATE OR REPLACE FUNCTION public.ops_work_undo(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; e public.ops_work_events; c public.ops_work_cards; r public.ops_work_cards; n public.ops_work_cards; v_now_snap jsonb;
        v_today date := public.ops_today(NULL);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF v.via IS NOT NULL THEN RAISE EXCEPTION 'people_only: Only a person can undo a change.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.ops_work_events x WHERE x.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'undo_expired: That change can no longer be undone.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = e.card_id AND w.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR e.actor_email <> v.actor_email OR e.via IS NOT NULL OR e.undone_at IS NOT NULL
     OR e.at <= clock_timestamp() - interval '60 seconds' OR c.revision IS DISTINCT FROM e.to_revision OR e.before IS NULL
     OR e.action NOT IN ('updated','started','status','closed','pushed_back','reopened','people','links','plan','blocked','unblocked','review') THEN
    RAISE EXCEPTION 'undo_expired: That change can no longer be undone.' USING ERRCODE = '22023';
  END IF;
  v_now_snap := public.ops_card_snapshot(c.id);
  r := jsonb_populate_record(c, e.before->'fields');
  -- #4398 (C): undo puts back a close that was already the watcher's (undoing
  -- a reopen), so it is not a new close to review.
  IF r.status = 'done' AND c.status <> 'done' THEN
    PERFORM set_config('ops.review_confirmed', c.id::text, true);
    PERFORM set_config('ops.review_confirmer', COALESCE(r.confirmed_by, ''), true);
  END IF;
  BEGIN
    UPDATE public.ops_work_cards SET title = r.title, instructions = r.instructions, done_means = r.done_means,
      -- #4270: a snapshot from before the move reads person as To do (the move also bumped every revision).
      status = CASE WHEN r.status = 'person' THEN 'todo' ELSE r.status END, files_url = r.files_url,
      -- #4270 W2 rework (P3-5): Undo puts back Host can see this. Undo is a
      -- person's (an agent never undoes), so D15 still holds.
      on_brand_plan = r.on_brand_plan,
      -- The words hosts saw go back with the stored title (W4 retest P3 4).
      plan_title = r.plan_title,
      blocked = r.blocked, blocked_kind = r.blocked_kind, blocked_reason = r.blocked_reason, person_reason = r.person_reason,
      anchor_kind = r.anchor_kind, anchor_id = r.anchor_id, due_on = r.due_on, due_source = r.due_source, sprint_id = r.sprint_id,
      plan = r.plan, result = r.result, proof = r.proof, close_kind = r.close_kind, close_reason = r.close_reason,
      closed_at = r.closed_at, closed_by = r.closed_by, closed_via = r.closed_via, started_at = r.started_at,
      working_by = r.working_by, working_via = r.working_via, override_reason = r.override_reason, override_by = r.override_by,
      override_at = r.override_at,
      -- #4255: the column (a snapshot from before columns reads its group's first column), the tree and the new fields
      status_id = CASE WHEN e.before->'fields' ? 'status_id' THEN r.status_id
                       ELSE public.ops_status_default(CASE WHEN r.status = 'person' THEN 'todo' ELSE r.status END) END,
      parent_id = r.parent_id, description_md = r.description_md, start_on = r.start_on, estimate_minutes = r.estimate_minutes,
      goal_id = r.goal_id, in_backlog = r.in_backlog,
      revision = revision + 1, updated_by = v.actor_email, updated_via = NULL, updated_at = now()
     WHERE id = c.id RETURNING * INTO n;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'undo_expired: That change can no longer be undone: another open card now has this title.' USING ERRCODE = '22023';
  WHEN sqlstate '22023' OR sqlstate 'P0002' THEN
    RAISE EXCEPTION 'undo_expired: That change can no longer be undone: the board changed since (a column, a parent card or its subtasks).' USING ERRCODE = '22023';
  END;
  DELETE FROM public.ops_work_people p WHERE p.card_id = c.id;
  INSERT INTO public.ops_work_people (card_id, email, role, added_by, added_via, added_at)
  SELECT c.id, x->>'email', x->>'role', x->>'added_by', x->>'added_via', (x->>'added_at')::timestamptz FROM jsonb_array_elements(e.before->'people') x;
  DELETE FROM public.ops_work_links l WHERE l.card_id = c.id;
  INSERT INTO public.ops_work_links (card_id, kind, target_id, label, added_by, added_via, added_at)
  SELECT c.id, x->>'kind', (x->>'id')::uuid, x->>'label', x->>'added_by', x->>'added_via', (x->>'added_at')::timestamptz FROM jsonb_array_elements(e.before->'links') x;
  UPDATE public.ops_work_events SET undone_at = clock_timestamp(), undone_by = v.actor_email WHERE id = e.id;
  PERFORM public.ops_card_event(c.id, v.actor_email, NULL, 'undone', NULL, v_now_snap, public.ops_card_snapshot(c.id), c.revision, n.revision);
  RETURN jsonb_build_object('card', public.ops_card_json(n, v_today));
END;
$function$;

-- From 20280624014255 (#4255 functions). #4398: review, sent back, confirmed, release checklist.
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
        THEN public.ops_release_items(substring(c.auto_key FROM ':pr-([0-9]+)$')::integer) END);
END;
$function$;

-- From 20280624014255 (#4255 functions). #4398: close date and review for the subtask list.
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
                  'waiting_on', public.ops_name((public.ops_card_people(c.id, 'watcher'))[1])) END,
      'subtasks', (SELECT jsonb_build_object('total', count(*), 'done', count(*) FILTER (WHERE g.status = 'done'))
                     FROM public.ops_work_cards g WHERE g.parent_id = c.id AND g.archived_at IS NULL),
      'thread_count', (SELECT count(*) FROM public.ops_work_messages m WHERE m.card_id = c.id AND m.deleted_at IS NULL))
    ORDER BY c.position, c.number), '[]'::jsonb)
    FROM public.ops_work_cards c WHERE c.parent_id = p_card_id AND c.archived_at IS NULL
$function$;

-- From 20280624014255 (#4255 functions). #4398 (C): close_work lands in In review and says so.
CREATE OR REPLACE FUNCTION public.ops_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  c_tools constant text[] := ARRAY['read_log','claim','release','plan_work','add_work','start_work','update_work','close_work',
                                   'push_back','list_work','my_work','list_calendar','runway_report','set_expected_event',
                                   'post_message','add_subtask'];
  c_writes constant text[] := ARRAY['claim','release','add_work','start_work','update_work','close_work','push_back','set_expected_event',
                                    'post_message','add_subtask'];
  c_rules constant jsonb := $rules$[
    "Before any work, call read_log for the records you will touch and check the open claims.",
    "Claim every record you will change or message with claim. A claim ends after 30 minutes without an update. Cards are not claimed: start_work marks you as working on a card for as long as it takes; post each step with update_work.",
    "Write the plan on the card: each step names the connector tool that does it, or person when no tool can.",
    "After each step, read the record back and mark the step done only if the change is really there.",
    "Never report a step done that you could not do. Leave it to a person with exact instructions.",
    "Close a card only with close_work and proof that names what you read back. Your close sends the card to In review: its watcher confirms it in Mingla Admin or sends it back. If it was already done, use push_back with already_done and the proof; if it should not be done, push_back with declined and the reason.",
    "You never send, spend money or publish. Tag the card with the reason (status person with send, spend, publish or other) and stop. The card stays in To do for your person.",
    "A message to someone Mingla messaged in the last 3 days is refused. Tell your person; only they can allow one more.",
    "close_work and push_back release your claims. Release any other claim with release when you stop.",
    "Name this chat once with the chat argument on your first work tool, for example chat: \"Hosts sweep\", so claims and the log show which chat did what. Two chats on one key are told apart and never write over each other.",
    "Log this chat's operations work on the Work board: open a card with add_work at the start, post each step with update_work, and close it with close_work and proof, including PR and merge links for code. Code work itself is logged on its GitHub issue."
  ]$rules$::jsonb;
  v_auth jsonb; v_key uuid; v_owner text; v_uid uuid; v_agent text; v_me jsonb; v_args jsonb;
  v_started timestamptz := clock_timestamp(); v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_lim jsonb := public.team_agent_limits(); v_n bigint; v_oldest timestamptz; v_retry integer; v_call uuid; v_tool text;
  v_token text; v_words text; v_match text[]; v_lock_before text; v_ok boolean := false; v_result jsonb; v_summary jsonb := '{}'::jsonb;
  v_items integer := 0; v_want integer := 0; v_q jsonb; v_date date; v_utc date := (now() AT TIME ZONE 'UTC')::date;
  v_changes jsonb; v_plan jsonb; v_found boolean; v_id uuid; v_rev bigint; v_note jsonb; v_rk text;
  -- Wave 2: calendar layers by the name an agent asks for
  c_layers constant jsonb := '{"live":"events","expected":"expected","deadlines":"deadlines","promotions":"promotions","content":"content"}'::jsonb;
  -- #3980 synced: the chat's own name, and the key the connector derived
  v_chat_arg jsonb; v_chat_label text; v_chat_key text; v_chat_old text;
BEGIN
  v_auth := public.team_agent_resolve(p_key_hash);
  IF v_auth->>'auth' IS DISTINCT FROM 'ok' THEN RETURN '{"auth":"invalid"}'::jsonb; END IF;
  v_key := (v_auth->>'key_id')::uuid; v_owner := v_auth->>'owner_email'; v_uid := (v_auth->>'uid')::uuid;
  v_agent := v_auth->>'agent'; v_me := jsonb_build_object('role', v_auth->>'role', 'agent', v_agent);
  v_args := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  -- "chat" names this chat; it is never handed on to a tool.
  v_chat_arg := v_args->'chat';
  v_args := v_args - 'chat';
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
    IF v_chat_arg IS NOT NULL AND jsonb_typeof(v_chat_arg) IS DISTINCT FROM 'null' THEN
      v_chat_label := CASE WHEN jsonb_typeof(v_chat_arg) = 'string' THEN btrim(v_chat_arg #>> '{}') END;
      IF v_chat_label IS NULL OR v_chat_label !~ '^[^[:cntrl:]]{1,40}$' THEN
        RAISE EXCEPTION 'invalid_arguments: "chat" is a short name for this chat, 1 to 40 characters.' USING ERRCODE = '22023';
      END IF;
      v_chat_key := public.ops_ctx_chat();
      IF v_chat_key <> 'default' THEN
        SELECT c.label INTO v_chat_old FROM public.ops_agent_chats c
         WHERE c.owner_email = lower(btrim(v_owner)) AND c.via = v_agent AND c.chat_key = v_chat_key;
        INSERT INTO public.ops_agent_chats (owner_email, via, chat_key, label)
        VALUES (lower(btrim(v_owner)), v_agent, v_chat_key, v_chat_label)
        ON CONFLICT (owner_email, via, chat_key) DO UPDATE SET label = EXCLUDED.label, last_seen_at = now();
        IF v_chat_old IS DISTINCT FROM v_chat_label THEN
          PERFORM public.ops_log_write(lower(btrim(v_owner)), v_agent, 'chat_named', 'info', NULL, NULL, NULL,
            format('This chat is now named "%s".', v_chat_label), jsonb_build_object('chat_key', left(v_chat_key, 4)));
        END IF;
      END IF;
    END IF;
    IF v_tool IN ('add_work', 'set_expected_event', 'post_message', 'add_subtask') OR (v_tool = 'update_work' AND v_args ? 'note') THEN
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
          -- #4255: the plan is read from the card's subtasks; step n is the n-th.
          SELECT public.ops_plan_from_subtasks(w.id) INTO v_plan FROM public.ops_work_cards w WHERE w.id = v_id AND w.archived_at IS NULL;
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
        -- #4398 (C): an agent's close goes to In review; the answer says so.
        v_items := 1; v_summary := CASE WHEN v_result ? 'review' THEN '{"in_review":1}'::jsonb ELSE '{"closed":1}'::jsonb END;
      WHEN 'push_back' THEN
        v_result := public.ops_work_push_back((v_args->>'id')::uuid, v_args->>'kind', v_args->>'reason',
          COALESCE(v_args->'proof', '[]'::jsonb), (v_args->>'expected_revision')::bigint);
        v_items := 1; v_summary := CASE WHEN v_result ? 'review' THEN '{"in_review":1}'::jsonb ELSE '{"pushed_back":1}'::jsonb END;
      WHEN 'list_work' THEN
        -- #4270 rework: Done means closed since Monday in your person's time zone.
        v_result := public.ops_work_list((v_args - 'today' - 'tz' - 'per_status') || jsonb_build_object('today', v_date, 'tz', COALESCE(v_auth->>'time_zone', 'UTC')));
        v_summary := jsonb_build_object('cards', jsonb_array_length(v_result->'cards'));
      WHEN 'my_work' THEN
        v_result := jsonb_build_object('today', v_date,
          -- #4255: subtasks too; each names its parent.
          'mine', public.ops_work_list(jsonb_build_object('who', 'mine', 'today', v_date, 'done_days', 0, 'subtasks', true))->'cards',
          'watching', public.ops_work_list(jsonb_build_object('who', 'watching', 'today', v_date, 'done_days', 0, 'subtasks', true))->'cards',
          'claims', public.ops_log_list('{"who":"mine","limit":1}'::jsonb)->'claims',
          'working', public.ops_log_list('{"who":"mine","limit":1}'::jsonb)->'working');
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
      WHEN 'post_message' THEN
        -- #4255: a message in a card's thread (never a team chat).
        IF jsonb_typeof(v_args->'mentions') IS NOT NULL AND jsonb_typeof(v_args->'mentions') NOT IN ('array', 'null') THEN
          RAISE EXCEPTION 'invalid_arguments: "mentions" is a list of teammates.' USING ERRCODE = '22023';
        END IF;
        v_result := public.ops_message_post((v_args->>'card_id')::uuid, v_args->>'body',
          CASE WHEN jsonb_typeof(v_args->'mentions') = 'array' THEN ARRAY(SELECT x FROM jsonb_array_elements_text(v_args->'mentions') x) ELSE ARRAY[]::text[] END,
          CASE WHEN jsonb_typeof(v_args->'reply_to') = 'string' THEN (v_args->>'reply_to')::uuid END, NULL, false, v_rk);
        v_items := 1; v_summary := '{"posted":1}'::jsonb;
      WHEN 'add_subtask' THEN
        v_result := public.ops_subtask_add((v_args->>'parent_id')::uuid, v_args - 'parent_id' - 'request_key', v_rk);
        v_items := CASE WHEN v_result->>'status' = 'added' THEN 1 ELSE 0 END;
        v_summary := jsonb_build_object('subtask', v_result->>'status');
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
$function$;

-- From 20280624054255 (#4255 rework). #4398 (C): cards waiting for your confirm.
CREATE OR REPLACE FUNCTION public.ops_due_digest(p_now timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := COALESCE(p_now, clock_timestamp());
  r record; v_local timestamp; v_day date; v_due integer; v_late integer; v_titles text; v_review integer; -- #4398
  v_excerpt text; v_mention uuid; v_push_ok boolean; v_inapp_ok boolean; v_told integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (u.id) u.id AS uid, lower(btrim(u.email)) AS email,
           COALESCE((SELECT z.name FROM pg_catalog.pg_timezone_names z WHERE z.name = btrim(p.timezone)), 'America/New_York') AS tz
      FROM public.admin_team_directory() d
      JOIN auth.users u ON lower(btrim(u.email)) = lower(btrim(d.email))
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE d.status = 'active'
     ORDER BY u.id
  LOOP
    v_local := v_now AT TIME ZONE r.tz;
    CONTINUE WHEN extract(hour FROM v_local) <> 9;
    CONTINUE WHEN NOT public.team_chat_staff(r.uid);
    v_day := v_local::date;
    SELECT count(*) FILTER (WHERE c.due_on = v_day), count(*) FILTER (WHERE c.due_on < v_day),
           string_agg(c.title, ', ' ORDER BY c.due_on, c.number)
      INTO v_due, v_late, v_titles
      FROM public.ops_work_cards c
     WHERE c.archived_at IS NULL AND c.status <> 'done' AND c.due_on IS NOT NULL AND c.due_on <= v_day
       AND EXISTS (SELECT 1 FROM public.ops_work_people w WHERE w.card_id = c.id AND w.role = 'owner' AND lower(btrim(w.email)) = r.email);
    -- #4398 (C): cards waiting for this person's confirm are in the notice too.
    SELECT count(*) INTO v_review FROM public.ops_work_cards c
     WHERE c.archived_at IS NULL AND c.status <> 'done' AND c.review_requested_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.ops_work_people w WHERE w.card_id = c.id AND w.role = 'watcher' AND lower(btrim(w.email)) = r.email);
    CONTINUE WHEN COALESCE(v_due, 0) + COALESCE(v_late, 0) + COALESCE(v_review, 0) = 0;
    v_excerpt := left(concat_ws(' · ',
                   CASE WHEN v_due = 1 THEN '1 due today' WHEN v_due > 1 THEN v_due || ' due today' END,
                   CASE WHEN v_late = 1 THEN '1 late' WHEN v_late > 1 THEN v_late || ' late' END,
                   CASE WHEN v_review = 1 THEN '1 waiting for your confirm' WHEN v_review > 1 THEN v_review || ' waiting for your confirm' END)
                 || COALESCE(': ' || public.ops_one_line(v_titles), ''), 280);
    v_mention := NULL;
    INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link)
    VALUES ('work_due', md5('work_due:' || r.uid::text || ':' || v_day::text)::uuid, NULL, r.uid, v_excerpt,
            'https://admin.usemingla.com/#/work-board?view=today&who=mine')
    ON CONFLICT (source_kind, source_id, target_user_id) DO NOTHING
    RETURNING id INTO v_mention;
    CONTINUE WHEN v_mention IS NULL;
    v_push_ok := public.can_send(r.uid, 'business.team_due', 'push', NULL);
    v_inapp_ok := public.can_send(r.uid, 'business.team_due', 'inapp', NULL);
    IF v_push_ok OR v_inapp_ok THEN
      INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
      VALUES ('business.team_due', r.uid, NULL,
        jsonb_build_object('source_kind', 'work_due', 'reason', 'due', 'mention_id', v_mention,
          'due_today', v_due, 'late', v_late, 'inapp', v_inapp_ok,
          'deep_link', 'mingla-business://team/mention/' || v_mention::text),
        'business.team_due:' || v_mention::text, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    v_told := v_told + 1;
  END LOOP;
  RETURN v_told;
END;
$function$;

-- From its latest definition. #4398.
CREATE OR REPLACE FUNCTION public.ops_engineering_cards_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  r public.ops_release_records; m public.ops_main_commits; g public.ops_github_items; w public.ops_work_cards;
  v_added integer := 0; v_closed integer := 0; v_due date := public.ops_today(NULL) + 1;
  v_key text; v_res jsonb; v_list text; v_refused_at timestamptz; v_want jsonb := '{}'::jsonb; v_common jsonb;
  v_proj text; v_live boolean; v_since timestamptz; v_aged boolean; v_keep_only jsonb := '{}'::jsonb;
  v_before jsonb; v_target text; v_pending text[];
  -- #4398 (S2): one release card per pull request.
  v_items jsonb; v_rel_open boolean; v_rel_key text; v_rel_want boolean; v_rel_card public.ops_work_cards; v_pr integer;
BEGIN
  -- X3: follow-through counts only from the time the owner switched automatic
  -- steps on; before that (or with no time recorded) nothing is followed up.
  v_since := public.ops_try_timestamptz(public.ops_setting('follow_through_since') #>> '{}');
  -- Which keys should be open now, and the card each would make. Records
  -- older than 60 days make no new cards, but one that still has an open
  -- card keeps being checked: its card closes only when the problem is
  -- really gone, never because the record aged out.
  FOR r IN SELECT x.* FROM public.ops_release_records x
            WHERE (x.merged_at > now() - interval '60 days' AND v_since IS NOT NULL AND x.merged_at >= v_since)
               OR EXISTS (SELECT 1 FROM public.ops_work_cards oc
                           WHERE oc.status <> 'done' AND oc.archived_at IS NULL
                             AND oc.auto_key ~ ('^eng_[a-z_]+:pr-' || x.pr || '(:|$)'))
            ORDER BY x.merged_at LOOP
    v_aged := r.merged_at <= now() - interval '60 days' OR v_since IS NULL OR r.merged_at < v_since;
    v_before := v_want;
    -- The production ledger is read afresh for a record with pending
    -- migrations, so its card follows the ledger and not a stale copy.
    IF 'migrations_pending' = ANY (r.problems) THEN
      PERFORM public.ops_release_recompute(r.pr);
      SELECT * INTO r FROM public.ops_release_records x WHERE x.pr = r.pr;
    END IF;
    -- #4398 (A3): who works on a bot card is its route's owner and watcher
    -- (ops_auto_card_upsert); the maker no longer picks people.
    v_common := jsonb_build_object(
      'due_on', v_due,
      'github', jsonb_build_array('https://github.com/Mingla-LLC/mingla-main/pull/' || r.pr)
                || COALESCE((SELECT jsonb_agg('#' || (x->>'number')) FROM jsonb_array_elements(r.issues) x), '[]'::jsonb));
    -- #4398 (S2): the record, live check, Feature Guide line, issue link,
    -- not deployed and migrations are ONE card per pull request, whose
    -- checklist is read live from the record (ops_release_items). It is
    -- wanted when an item is open and due (the issue link, the Feature Guide
    -- line and a deploy at once; migrations after 24 hours; the live check
    -- after 48 hours; anything else on an incomplete record after 24 hours),
    -- and an open one stays wanted while any item is open.
    v_items := public.ops_release_items(r.pr);
    v_rel_key := 'eng_release:pr-' || r.pr;
    v_rel_open := EXISTS (SELECT 1 FROM public.ops_work_cards oc WHERE oc.auto_key = v_rel_key AND oc.status <> 'done' AND oc.archived_at IS NULL);
    v_rel_want := EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i WHERE NOT (i->>'done')::boolean
                            AND (i->>'key' IN ('issue', 'guide') OR i->>'key' LIKE 'deploy:%'
                                 OR (i->>'key' = 'migrations' AND r.merged_at < now() - interval '24 hours')
                                 OR (i->>'key' = 'live_check' AND r.merged_at < now() - interval '48 hours')
                                 OR v_rel_open))
      OR (NOT r.complete AND r.merged_at < now() - interval '24 hours'
          AND EXISTS (SELECT 1 FROM unnest(r.problems) p WHERE p NOT IN ('live_check_missing', 'web_deploy_failed', 'edge_deploy_failed', 'migrations_pending',
                                                                       'no_issue', 'feature_guide_missing', 'feature_guide_invalid', 'web_not_deployed')));
    IF v_rel_want THEN
      v_want := v_want || jsonb_build_object(v_rel_key, v_common || jsonb_build_object(
        'title', format('Finish the release of PR #%s', r.pr),
        'instructions', left(format('PR #%s (%s) is merged but its release is not finished. The checklist on this card is read from the release record and ticks itself: fix each open item (after editing the pull request, re-run "Release records" from the Actions tab with this PR number). The card closes by itself when nothing is left.', r.pr, left(r.title, 200)), 4000),
        'done_means', format('The release record of PR #%s shows nothing left to do.', r.pr)));
    END IF;
    -- One card per pull request and deploy target, each with its own title
    -- (two cards with one title would be refused as duplicates).
    FOR v_proj IN SELECT e.k FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) e(k, val) WHERE e.val = 'failed'
                  UNION ALL SELECT 'edge' WHERE r.deploy->>'edge' = 'failed' LOOP
      v_target := CASE WHEN v_proj = 'edge' THEN 'edge function' ELSE v_proj || ' web' END;
      v_want := v_want || jsonb_build_object(format('eng_deploy_failed:pr-%s:%s', r.pr, v_proj), v_common || jsonb_build_object(
        'title', format('Fix the failed %s deploy of PR #%s', v_target, r.pr),
        'instructions', format('The %s deploy for PR #%s failed. Read the run, fix it and redeploy through the reviewed path.', v_target, r.pr),
        'done_means', format('The %s deploy of PR #%s succeeded.', v_target, r.pr)));
    END LOOP;
    -- A deploy whose result has not arrived two hours after the merge is
    -- stuck, not quietly pending: one card per target.
    IF r.merged_at < now() - interval '2 hours' THEN
      FOR v_proj IN SELECT e.k FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) e(k, val) WHERE e.val = 'pending'
                    UNION ALL SELECT 'edge' WHERE r.deploy->>'edge' = 'pending' LOOP
        v_target := CASE WHEN v_proj = 'edge' THEN 'edge function' ELSE v_proj || ' web' END;
        v_want := v_want || jsonb_build_object(format('eng_deploy_pending:pr-%s:%s', r.pr, v_proj), v_common || jsonb_build_object(
          'title', format('Deploy still pending: %s for PR #%s', v_target, r.pr),
          'instructions', format('PR #%s merged more than two hours ago and its %s deploy has no result yet. Open %s, find the deploy for merge commit %s, and see whether it is still running, failed or never started. Then re-run "Release records" from the Actions tab with this PR number so the record shows the result.',
            r.pr, v_target, CASE WHEN v_proj = 'edge' THEN 'the "Deploy Supabase Edge Functions" runs in the Actions tab' ELSE 'the ' || v_proj || ' project on Vercel' END, left(r.merge_sha, 7)),
          'done_means', format('The release record of PR #%s shows the %s deploy result.', r.pr, v_target)));
      END LOOP;
    END IF;
    -- An aged record only keeps the cards it already has open.
    IF v_aged THEN
      SELECT v_keep_only || COALESCE(jsonb_object_agg(e.key, true), '{}'::jsonb) INTO v_keep_only
        FROM jsonb_each(v_want) e WHERE NOT v_before ? e.key
         AND NOT (e.key = v_rel_key AND EXISTS (SELECT 1 FROM public.ops_work_cards oc
                                                WHERE oc.status <> 'done' AND oc.archived_at IS NULL
                                                  AND oc.auto_key ~ ('^eng_(record_pending|live_check|guide_missing|no_issue|not_deployed|migrations):pr-' || r.pr || '(:|$)')));
    END IF;
  END LOOP;
  -- Issues Done on the board for a day without a complete record (once the
  -- bridge follows them). The day counts from the move to Done, never from
  -- the issue's last update: a comment does not restart it.
  FOR g IN SELECT x.* FROM public.ops_github_items x
            WHERE x.kind = 'issue' AND x.board_status = 'Done' AND NOT x.not_found AND x.done_since < now() - interval '24 hours'
              AND v_since IS NOT NULL AND x.done_since >= v_since LOOP
    v_live := COALESCE((SELECT y.complete FROM public.ops_release_records y
                         WHERE y.issues @> jsonb_build_array(jsonb_build_object('number', g.number)) ORDER BY y.merged_at DESC, y.pr DESC LIMIT 1), false);
    CONTINUE WHEN v_live;
    v_want := v_want || jsonb_build_object('eng_done_not_live:issue-' || g.number, jsonb_build_object(
      'title', format('Issue #%s is Done but not Live', g.number),
      'instructions', format('Issue #%s is Done on the board but no complete release record names it. Finish its release record, or move it back on the board.', g.number),
      'done_means', format('Issue #%s is Live.', g.number),
      'due_on', v_due, 'github', jsonb_build_array('#' || g.number)));
  END LOOP;
  -- Commits on main: pushed without a pull request, or merged with no record after 30 minutes.
  FOR m IN SELECT x.* FROM public.ops_main_commits x WHERE x.committed_at > now() - interval '14 days' AND v_since IS NOT NULL AND x.committed_at >= v_since ORDER BY x.committed_at LOOP
    v_common := jsonb_build_object('due_on', v_due);
    IF m.pr IS NULL THEN
      v_want := v_want || jsonb_build_object('eng_no_pr_push:' || left(m.sha, 7), v_common || jsonb_build_object(
        'title', format('Commit %s reached main without a pull request', left(m.sha, 7)),
        'instructions', format('"%s" was pushed to main directly. Open an issue comment or follow-up PR that records it, and make sure nothing skipped review.', left(m.subject, 200)),
        'done_means', 'The change is recorded on an issue.'));
    ELSIF m.seen_at < now() - interval '30 minutes' AND NOT EXISTS (SELECT 1 FROM public.ops_release_records y WHERE y.pr = m.pr) THEN
      v_want := v_want || jsonb_build_object('eng_bot_missing:pr-' || m.pr, v_common || jsonb_build_object(
        'title', format('The release record for PR #%s was not written', m.pr),
        'instructions', format('The merge bot did not write a record for PR #%s. Re-run "Release records" from the Actions tab with this PR number.', m.pr),
        'done_means', format('PR #%s has a release record.', m.pr),
        'github', jsonb_build_array('https://github.com/Mingla-LLC/mingla-main/pull/' || m.pr)));
    END IF;
  END LOOP;
  -- The sync token was refused a status post in the last hour, with no
  -- successful post since. #3980 proof fix P1-2: the key carries a ':' (the
  -- auto_key shape ops_auto_card_upsert accepts), and an open card stays open
  -- until a status post succeeds after the newest refusal, not merely
  -- because an hour went by without a new refusal.
  SELECT max(l.at) INTO v_refused_at FROM public.ops_agent_log l
   WHERE l.action = 'release_record' AND l.outcome = 'stopped' AND l.detail ? 'status_refused';
  IF v_refused_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ops_release_records y WHERE y.status_posted_at > v_refused_at)
     AND (v_refused_at > clock_timestamp() - interval '1 hour'
          OR EXISTS (SELECT 1 FROM public.ops_work_cards sk WHERE sk.auto_key = 'eng_status_token:sync'
                       AND sk.status <> 'done' AND sk.archived_at IS NULL)) THEN
    v_want := v_want || jsonb_build_object('eng_status_token:sync', jsonb_build_object(
      'title', 'The sync token cannot post commit statuses',
      'instructions', 'Give the sync token permission to post commit statuses so release records show applied migrations.',
      'done_means', 'A migrations status shows on the latest merge commit.',
      'due_on', v_due));
  END IF;

  -- Make the missing ones.
  FOR v_key, v_res IN SELECT e.key, e.value FROM jsonb_each(v_want) e ORDER BY e.key LOOP
    CONTINUE WHEN v_keep_only ? v_key;
    BEGIN
      v_res := public.ops_auto_card_upsert(v_key, v_res, 'task', NULL);
      IF v_res->>'status' = 'added' THEN v_added := v_added + 1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_engineering_cards_sync: % stopped (% %)', v_key, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  -- Close the open ones whose problem is gone. A commit pushed without a
  -- pull request is never closed by Mingla: a person closes it with proof.
  FOR w IN SELECT x.* FROM public.ops_work_cards x
            WHERE x.auto_key LIKE 'eng\_%' AND x.status <> 'done' AND x.archived_at IS NULL
              AND x.auto_key NOT LIKE 'eng\_no\_pr\_push:%' AND NOT v_want ? x.auto_key LOOP
    -- #4398 (S2): an open card of an old per-PR kind folds into its pull
    -- request's release card once that card is open (a system close naming
    -- it); while the release card is wanted but not made, it stays open.
    IF split_part(w.auto_key, ':', 1) IN ('eng_record_pending','eng_live_check','eng_guide_missing','eng_no_issue','eng_not_deployed','eng_migrations') THEN
      v_pr := substring(w.auto_key FROM ':pr-([0-9]+)')::integer;
      IF v_want ? ('eng_release:pr-' || v_pr) THEN
        v_rel_card := NULL;
        SELECT * INTO v_rel_card FROM public.ops_work_cards oc
         WHERE oc.auto_key = 'eng_release:pr-' || v_pr AND oc.status <> 'done' AND oc.archived_at IS NULL LIMIT 1;
        CONTINUE WHEN v_rel_card.id IS NULL;
        BEGIN
          PERFORM public.ops_auto_card_close(w.id, format('Folded into Card %s: Finish the release of PR #%s.', v_rel_card.number, v_pr),
            jsonb_build_array(jsonb_build_object('text', format('One card per pull request now: Card %s keeps the checklist.', v_rel_card.number))));
          v_closed := v_closed + 1;
        EXCEPTION WHEN others THEN RAISE WARNING 'ops_engineering_cards_sync: folding % stopped (% %)', w.auto_key, SQLSTATE, SQLERRM;
        END;
        CONTINUE;
      END IF;
    END IF;
    -- A migrations card closes only when the production ledger really has
    -- every version of its pull request.
    IF split_part(w.auto_key, ':', 1) = 'eng_migrations' THEN
      SELECT ARRAY(SELECT mv FROM unnest(y.migrations_added) mv WHERE NOT mv = ANY (public.ops_ledger_applied(y.migrations_added)))
        INTO v_pending FROM public.ops_release_records y WHERE y.pr = substring(w.auto_key FROM ':pr-([0-9]+)$')::integer;
      CONTINUE WHEN v_pending IS NULL OR cardinality(v_pending) > 0;
    END IF;
    BEGIN
      PERFORM public.ops_auto_card_close(w.id, CASE split_part(w.auto_key, ':', 1)
          WHEN 'eng_no_issue' THEN 'The pull request has an issue and a release record.'
          WHEN 'eng_guide_missing' THEN 'The release record shows a Feature Guide line.'
          WHEN 'eng_not_deployed' THEN 'A later production deployment of this project is READY.'
          WHEN 'eng_deploy_failed' THEN 'The deploy no longer shows as failed.'
          WHEN 'eng_deploy_pending' THEN 'The release record shows the deploy result.'
          WHEN 'eng_migrations' THEN 'Every migration is in the production ledger.'
          WHEN 'eng_record_pending' THEN 'The release record is complete apart from the live check.'
          WHEN 'eng_live_check' THEN 'The release record shows the live check.'
          WHEN 'eng_done_not_live' THEN 'The issue is Live, or no longer Done on the board.'
          WHEN 'eng_bot_missing' THEN 'The pull request has a release record.'
          WHEN 'eng_status_token' THEN 'A migrations status was posted.'
          WHEN 'eng_release' THEN 'Nothing is left in the release of this pull request.'
          ELSE 'The problem is gone.' END,
        jsonb_build_array(jsonb_build_object('text', 'Checked by Mingla against the release records and the production ledger.')));
      v_closed := v_closed + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'ops_engineering_cards_sync: closing % stopped (% %)', w.auto_key, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('added', v_added, 'closed', v_closed);
END;
$function$;

-- From its latest definition. #4398.
CREATE OR REPLACE FUNCTION public.ops_release_guide_apply()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c_repo constant text := 'https://github.com/Mingla-LLC/mingla-main/';
  r public.ops_release_records; k public.ops_release_guide_keys; v_k text; cap public.product_capabilities;
  v_new jsonb; v_kind text; v_missing text[]; v_results jsonb; v_record_url text;
  v_live_at timestamptz; v_live_url text; v_deploy text; v_test text; v_ev uuid; e jsonb; v_rev integer;
  v_live integer := 0; v_incomplete integer := 0; v_records integer := 0; v_watchers text[];
  v_boss text := public.ops_owner_email();
BEGIN
  FOR r IN SELECT x.* FROM public.ops_release_records x
            WHERE x.complete
              AND EXISTS (SELECT 1 FROM public.ops_release_guide_keys pending
                           WHERE pending.pr = x.pr AND pending.applied_at IS NULL)
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

    FOR k IN SELECT pending.* FROM public.ops_release_guide_keys pending
              WHERE pending.pr = r.pr AND pending.applied_at IS NULL
              ORDER BY pending.capability_key FOR UPDATE LOOP
      v_k := k.capability_key;
      SELECT * INTO cap FROM public.product_capabilities pc WHERE pc.capability_key = v_k FOR UPDATE;
      IF NOT FOUND THEN
        UPDATE public.ops_release_guide_keys SET result = 'unknown_key', last_attempt_at = now(),
          details = jsonb_build_object('missing','catalog entry') WHERE pr = r.pr AND capability_key = v_k;
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'result', 'unknown_key'));
        CONTINUE;
      END IF;
      IF cap.claimed_status = 'retired' THEN
        UPDATE public.ops_release_guide_keys SET result = 'retired', applied_at = now(), last_attempt_at = now(),
          details = '{}'::jsonb WHERE pr = r.pr AND capability_key = v_k;
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'retired'));
        CONTINUE;
      END IF;

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
      -- A named capability was dirtied by this merge. Its source citation
      -- must therefore move to this exact merge even when older source proof
      -- is still current.
      v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'source', 'url', c_repo || 'commit/' || r.merge_sha, 'at', r.merged_at,
        'details', format('Merge commit of PR #%s.', r.pr)));
      IF 'test' = ANY (cap.required_evidence_kinds) AND v_test IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.product_capability_evidence pe WHERE pe.capability_id = cap.id AND pe.evidence_kind = 'test'
                            AND pe.is_current AND pe.verdict = 'verified' AND (pe.expires_at IS NULL OR pe.expires_at > now())) THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'test', 'url', c_repo || 'blob/' || r.merge_sha || '/' || v_test, 'at', r.merged_at,
          'details', left(format('Test changed by PR #%s: %s', r.pr, v_test), 2000)));
      END IF;

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
        UPDATE public.ops_release_guide_keys SET result = 'incomplete', last_attempt_at = now(),
          details = jsonb_build_object('missing', to_jsonb(v_missing)) WHERE pr = r.pr AND capability_key = v_k;
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
        VALUES (NULL, 'evidence_recorded', cap.id, v_ev, jsonb_build_object('source', 'issue_4179_bridge_b', 'pr', r.pr,
          'evidence_kind', v_kind, 'verdict', 'verified'));
      END LOOP;
      UPDATE public.product_capabilities pc SET claimed_status = 'live', verification_due_at = now() + interval '90 days',
             last_verified_at = now(), revision = pc.revision + 1, updated_at = now()
       WHERE pc.id = cap.id RETURNING pc.revision INTO v_rev;
      INSERT INTO public.product_truth_audit (actor_user_id, action, capability_id, metadata)
      VALUES (NULL, 'capability_saved', cap.id, jsonb_build_object('source', 'issue_4179_bridge_b', 'pr', r.pr, 'revision', v_rev,
        'claimed_status', 'live'));
      UPDATE public.ops_release_guide_keys SET result = 'live', applied_at = now(), last_attempt_at = now(),
        details = jsonb_build_object('evidence', (SELECT jsonb_agg(x->>'kind') FROM jsonb_array_elements(v_new) x))
       WHERE pr = r.pr AND capability_key = v_k;
      PERFORM public.ops_log_write(c_actor, 'system', 'guide_live', 'ok', NULL, 'release', NULL,
        format('%s is Live in the Feature Guide (PR #%s).', cap.title, r.pr), jsonb_build_object('pr', r.pr, 'key', v_k));
      v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'live',
        'evidence', (SELECT jsonb_agg(x->>'kind') FROM jsonb_array_elements(v_new) x)));
      v_live := v_live + 1;
      BEGIN
        -- #4398 (S2): an entry turning Live is an Admin activity notice for
        -- the owner and Support, never a Work card (it made 404 in 30 days).
        v_watchers := ARRAY(SELECT d.email FROM public.admin_team_directory() d
                              JOIN auth.users u ON lower(btrim(u.email)) = d.email
                             WHERE d.status = 'active' AND d.email IS DISTINCT FROM v_boss AND public.is_support_staff(u.id)
                             GROUP BY d.email ORDER BY d.email LIMIT 10);
        PERFORM public.ops_activity_notice('guide', md5('guide_live:' || v_k || ':pr-' || r.pr)::uuid,
          CASE WHEN v_boss IS NOT NULL THEN ARRAY[v_boss] ELSE ARRAY[]::text[] END || v_watchers,
          left(format('Feature Guide: %s is Live (PR #%s).', cap.title, r.pr), 280),
          'https://admin.usemingla.com/#/community-support?tab=feature-guide');
      EXCEPTION WHEN others THEN RAISE WARNING 'ops_release_guide_apply: telling Support about % stopped (% %)', v_k, SQLSTATE, SQLERRM;
      END;
    END LOOP;

    UPDATE public.ops_release_records x SET
      guide_applied_at = CASE WHEN EXISTS (SELECT 1 FROM public.ops_release_guide_keys pending
                                           WHERE pending.pr = r.pr AND pending.applied_at IS NULL) THEN NULL ELSE now() END,
      guide_result = jsonb_build_object('keys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', state.capability_key, 'result', state.result, 'details', state.details
      ) ORDER BY state.capability_key) FROM public.ops_release_guide_keys state WHERE state.pr = r.pr), '[]'::jsonb)),
      updated_at = now()
     WHERE x.pr = r.pr;
    v_records := v_records + 1;
  END LOOP;
  RETURN jsonb_build_object('records', v_records, 'live', v_live, 'incomplete', v_incomplete);
END;
$function$;

-- From its latest definition. #4398.
CREATE OR REPLACE FUNCTION public.ops_feature_guide_coverage_reconcile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v public.ops_feature_guide_coverage; m public.ops_main_commits; r public.ops_release_records;
  v_current text; v_reason text; v_state text; v_boss text := public.ops_owner_email();
  v_res jsonb; w public.ops_work_cards; n public.ops_work_cards; v_before jsonb; v_event uuid; v_title text; v_instr text; -- #4398
BEGIN
  PERFORM public.ops_service_only();
  SELECT * INTO v FROM public.ops_feature_guide_coverage WHERE singleton FOR UPDATE;
  v_current := v.audited_through_sha;
  v_state := CASE WHEN v_current = v.observed_head_sha THEN 'current' ELSE 'pending' END;
  LOOP
    SELECT * INTO m FROM public.ops_main_commits c
     WHERE c.first_parent_sha = v_current
     ORDER BY c.committed_at, c.sha LIMIT 1;
    EXIT WHEN NOT FOUND;
    v_reason := NULL;
    IF m.pr IS NULL THEN
      v_reason := 'direct_push_has_no_pull_request';
    ELSE
      SELECT * INTO r FROM public.ops_release_records x
       WHERE x.pr = m.pr AND x.merge_sha = m.sha;
      IF NOT FOUND THEN
        v_reason := 'release_record_missing';
      ELSIF r.feature_guide IS NULL THEN
        v_reason := 'feature_guide_classification_missing';
      ELSIF cardinality(r.feature_guide) = 0 AND NULLIF(btrim(r.feature_guide_reason), '') IS NULL THEN
        v_reason := 'no_effect_reason_missing';
      ELSIF EXISTS (
        SELECT 1 FROM unnest(r.feature_guide) key
         WHERE NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = key)
      ) THEN
        v_reason := 'unknown_feature_guide_key';
      END IF;
    END IF;
    IF v_reason IS NOT NULL THEN
      v_state := 'gap';
      UPDATE public.ops_feature_guide_coverage SET
        audited_through_sha = v_current, state = 'gap', blocked_sha = m.sha,
        blocked_pr = m.pr, blocked_reason = v_reason, updated_at = now()
       WHERE singleton;
      EXIT;
    END IF;
    v_current := m.sha;
    v_state := CASE WHEN v_current = v.observed_head_sha THEN 'current' ELSE 'pending' END;
    UPDATE public.ops_feature_guide_coverage SET
      audited_through_sha = v_current, state = v_state, blocked_sha = NULL,
      blocked_pr = NULL, blocked_reason = NULL, updated_at = now()
     WHERE singleton;
    EXIT WHEN v_current = v.observed_head_sha;
  END LOOP;

  SELECT * INTO v FROM public.ops_feature_guide_coverage WHERE singleton;
  IF v.state = 'pending' THEN
    UPDATE public.ops_feature_guide_coverage SET state = 'gap',
      blocked_sha = observed_head_sha, blocked_pr = NULL,
      blocked_reason = 'first_parent_chain_missing', updated_at = now()
     WHERE singleton;
    SELECT * INTO v FROM public.ops_feature_guide_coverage WHERE singleton;
  END IF;
  IF v.state = 'gap' THEN
    -- #4398 (S2): one standing card, updated in place when coverage stops
    -- somewhere else (never one per commit). Its route gives it its people.
    v_title := left(format('Feature Guide coverage stopped at %s', left(v.blocked_sha, 9)), 160);
    v_instr := left(format('The Feature Guide cannot prove every main merge after %s. Resolve %s for %s, then let the five-minute bridge reconcile again.', left(v.audited_through_sha, 9), replace(v.blocked_reason, '_', ' '), CASE WHEN v.blocked_pr IS NULL THEN 'the direct push' ELSE 'PR #' || v.blocked_pr END), 4000);
    SELECT * INTO w FROM public.ops_work_cards card
     WHERE card.auto_key = 'feature_guide_gap:current' AND card.status <> 'done' AND card.archived_at IS NULL FOR UPDATE;
    IF w.id IS NULL THEN
      v_res := public.ops_auto_card_upsert('feature_guide_gap:current', jsonb_build_object(
          'title', v_title, 'instructions', v_instr,
          'done_means', 'The Feature Guide freshness state is current at the observed main head.',
          'due_on', public.ops_today(NULL)), 'task', NULL);
    ELSIF w.title IS DISTINCT FROM v_title OR w.instructions IS DISTINCT FROM v_instr THEN
      v_before := public.ops_card_snapshot(w.id);
      UPDATE public.ops_work_cards card SET title = v_title, instructions = v_instr, revision = card.revision + 1,
             updated_by = 'system@usemingla.com', updated_via = 'system', updated_at = now()
       WHERE card.id = w.id RETURNING card.* INTO n;
      v_event := public.ops_card_event(w.id, 'system@usemingla.com', 'system', 'updated', format('Coverage now stops at %s.', left(v.blocked_sha, 9)),
        v_before, public.ops_card_snapshot(w.id), w.revision, n.revision);
      PERFORM public.ops_notify_people(w.id, v_event, public.ops_card_people(w.id, NULL), 'system@usemingla.com',
        format('Mingla updated: %s', n.title), 'bot');
    END IF;
    -- The cards from before (one per commit) fold into the standing one.
    SELECT * INTO n FROM public.ops_work_cards card
     WHERE card.auto_key = 'feature_guide_gap:current' AND card.status <> 'done' AND card.archived_at IS NULL;
    IF n.id IS NOT NULL THEN
      FOR w IN SELECT * FROM public.ops_work_cards card
                WHERE card.auto_key LIKE 'feature\_guide\_gap:sha-%' ESCAPE '\'
                  AND card.status <> 'done' AND card.archived_at IS NULL FOR UPDATE LOOP
        PERFORM public.ops_auto_card_close(w.id, format('Folded into Card %s, the one Feature Guide coverage card.', n.number),
          jsonb_build_array(jsonb_build_object('text', 'Coverage is one standing card now.')));
      END LOOP;
    END IF;
  ELSE
    FOR w IN SELECT * FROM public.ops_work_cards card
      WHERE card.auto_key LIKE 'feature\_guide\_gap:%' ESCAPE '\'
        AND card.status <> 'done' AND card.archived_at IS NULL
      FOR UPDATE LOOP
      PERFORM public.ops_auto_card_close(w.id, 'Feature Guide merge coverage is current.',
        jsonb_build_array(jsonb_build_object('text','Audited through ' || v.audited_through_sha)));
    END LOOP;
  END IF;
  RETURN to_jsonb(v);
END;
$function$;

-- From 20280624064255 (#4255 rework 2). #4398 (S3): push notices only, with the card.
CREATE OR REPLACE FUNCTION public.team_inbox(p_alert_types text[] DEFAULT NULL::text[], p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_types text[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);

  RETURN (
    WITH m AS MATERIALIZED (
      SELECT tm.id, tm.source_kind, tm.created_at, tm.read_at, tm.body_excerpt, tm.deep_link,
             e.card_id, e.action,
             tm.decision, -- #4255 Retest 2 (P3b)
             tm.event_kind, -- #4398
             tmsg.thread_id, tmsg.id AS message_id, -- #4255 W1b
             public.team_inbox_kind(tm.source_kind, e.action) AS kind,
             COALESCE(
               CASE WHEN tm.source_kind = 'work_due' THEN 'Mingla' END, -- #4255 rework F
               CASE WHEN e.id IS NOT NULL THEN public.ops_actor_label(e.actor_email, e.via) END,
               public.crm_display_name(lower(btrim(u.email))),
               'A teammate') AS actor
        FROM public.team_mentions tm
        LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
        LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id -- #4255 W1b
        LEFT JOIN auth.users u ON u.id = tm.actor_user_id
       WHERE tm.target_user_id = v_me
         AND tm.push  -- #4398 (S3): the Host app and Messages list carry push notices only; the rest is Admin > Activity
         AND (tm.source_kind <> 'team_message'
              OR (tmsg.deleted_at IS NULL AND public.team_chat_can_read(tmsg.thread_id))) -- #4255 W1b
    ), a AS MATERIALIZED (
      SELECT n.id, n.type, n.title, n.body, n.deep_link, n.data, n.created_at, n.read_at,
             public.team_inbox_ticket_resolved(n.data) AS ticket_resolved
        FROM public.notifications n
       WHERE n.user_id = v_me AND n.type = ANY (v_types)
         AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
    )
    SELECT jsonb_build_object(
      'mentions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'kind', x.kind, 'source_kind', x.source_kind, 'card_id', x.card_id, 'action', x.action,
          'thread_id', x.thread_id, 'message_id', x.message_id, -- #4255 W1b
          'decision', x.decision, -- #4255 Retest 2 (P3b): the one decision flag
          -- #4398: what happened, whether it needs you, and the card as it is now (the Host app's read-only sheet)
          'event_kind', x.event_kind, 'needs_you', x.event_kind IN ('review', 'sent_back'),
          'card', (SELECT jsonb_build_object('number', w.number, 'title', w.title, 'status', w.status, 'due_on', w.due_on,
                     'closed_at', w.closed_at, 'column', s.name, 'in_review', w.review_requested_at IS NOT NULL,
                     'owner', public.ops_name((public.ops_card_people(w.id, 'owner'))[1]),
                     'watcher', public.ops_name((public.ops_card_people(w.id, 'watcher'))[1]),
                     'owner_email', (public.ops_card_people(w.id, 'owner'))[1],
                     'watcher_email', (public.ops_card_people(w.id, 'watcher'))[1],
                     'parent', (SELECT jsonb_build_object('number', p.number, 'title', p.title) FROM public.ops_work_cards p WHERE p.id = w.parent_id))
                     FROM public.ops_work_cards w LEFT JOIN public.ops_work_statuses s ON s.id = w.status_id WHERE w.id = x.card_id),
          'actor_name', x.actor, 'body_excerpt', x.body_excerpt, 'deep_link', x.deep_link,
          'created_at', x.created_at, 'read_at', x.read_at) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM m ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'deep_link', x.deep_link,
          'data', x.data, 'created_at', x.created_at, 'read_at', x.read_at,
          'ticket_resolved', x.ticket_resolved) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM a ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'unread', jsonb_build_object(
        'mentions', (SELECT count(*) FROM m WHERE kind = 'mention' AND read_at IS NULL),
        'work_updates', (SELECT count(*) FROM m WHERE kind = 'work_update' AND read_at IS NULL),
        'support', (SELECT count(*) FROM a WHERE read_at IS NULL AND NOT ticket_resolved))
    )
  );
END;
$function$;

-- From 20280624054255 (#4255 rework). #4398 (S3): push notices only.
CREATE OR REPLACE FUNCTION public.team_badge()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v_me uuid := auth.uid(); v_chats integer; v_messages integer; v_mentions integer;
BEGIN
  IF v_me IS NULL OR NOT public.team_chat_staff(v_me) THEN
    -- #4255 fix-up B1: admin says whether the caller may mention everyone.
    RETURN jsonb_build_object('staff', false, 'admin', false, 'chats', 0, 'messages', 0, 'mentions', 0, 'total', 0);
  END IF;
  SELECT count(*) FILTER (WHERE u.n > 0), COALESCE(sum(u.n), 0) INTO v_chats, v_messages
    FROM (SELECT public.team_chat_unread(t.id, v_me) AS n
            FROM public.team_threads t
            JOIN public.team_thread_members m ON m.thread_id = t.id AND m.user_id = v_me AND m.left_at IS NULL AND NOT m.muted
           WHERE t.archived_at IS NULL) u;
  -- #4255 rework E: a team chat mention is already in its chat's unread
  -- count (and lives in that chat, not on Mentions), so it is not counted
  -- again here.
  SELECT count(*) INTO v_mentions FROM public.team_mentions tm
   WHERE tm.target_user_id = v_me AND tm.read_at IS NULL AND tm.source_kind <> 'team_message'
     AND tm.push;  -- #4398 (S3): Admin-only notices never count on the phone
  -- #4255 fix-up B2: the same rule team_post enforces for @everyone.
  RETURN jsonb_build_object('staff', true, 'admin', public.team_chat_admin(v_me), 'chats', v_chats, 'messages', v_messages, 'mentions', v_mentions, 'total', v_chats + v_mentions);
END;
$function$;

-- From its latest definition. #4398 (S3): push notices only.
CREATE OR REPLACE FUNCTION public.team_inbox_mark_read(p_scope text DEFAULT 'all'::text, p_alert_types text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_types text[];
  v_m     integer := 0;
  v_a     integer := 0;
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('all', 'mentions', 'work_updates', 'support') THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);

  IF p_scope IN ('all', 'mentions', 'work_updates') THEN
    UPDATE public.team_mentions tm
       SET read_at = now()
      FROM (SELECT tm2.id, public.team_inbox_kind(tm2.source_kind, e.action) AS kind
              FROM public.team_mentions tm2
              LEFT JOIN public.ops_work_events e ON tm2.source_kind = 'work_card' AND e.id = tm2.source_id
             WHERE tm2.target_user_id = v_me AND tm2.read_at IS NULL
               AND tm2.push) k  -- #4398 (S3): Admin-only notices are cleared from Admin > Activity
     WHERE tm.id = k.id
       AND (p_scope = 'all' OR (p_scope = 'mentions' AND k.kind = 'mention')
            OR (p_scope = 'work_updates' AND k.kind = 'work_update'));
    GET DIAGNOSTICS v_m = ROW_COUNT;
  END IF;

  IF p_scope IN ('all', 'support') THEN
    UPDATE public.notifications n
       SET read_at = now(), is_read = true
     WHERE n.user_id = v_me AND n.type = ANY (v_types) AND n.read_at IS NULL;
    GET DIAGNOSTICS v_a = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('mentions', v_m, 'alerts', v_a);
END;
$function$;

-- ---------------------------------------------------------------------------
-- S3. Admin > Activity: "For you" (the push notices, as in the Host app) and
-- "Mingla activity" (everything else), grouped one line per kind per day.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.team_activity(p_days integer DEFAULT 14) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 14), 1), 60);
  v_tz text;
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE((SELECT z.name FROM pg_catalog.pg_timezone_names z WHERE z.name = btrim(p.timezone)), 'America/New_York') INTO v_tz
    FROM public.profiles p WHERE p.id = v_me;
  v_tz := COALESCE(v_tz, 'America/New_York');
  RETURN (
    WITH m AS MATERIALIZED (
      SELECT tm.id, tm.push, tm.event_kind, tm.source_kind, tm.body_excerpt, tm.deep_link, tm.created_at, tm.read_at,
             e.action, e.card_id,
             (tm.created_at AT TIME ZONE v_tz)::date AS day,
             CASE WHEN tm.event_kind = 'bot' AND e.action = 'added' THEN 'added'
                  WHEN tm.event_kind = 'bot' AND e.action IN ('auto_closed', 'gate_closed', 'closed') THEN 'closed'
                  WHEN tm.event_kind = 'bot' THEN 'changed' ELSE tm.event_kind END AS grp,
             CASE WHEN tm.source_kind = 'work_due' THEN 'Mingla'
                  WHEN e.id IS NOT NULL THEN public.ops_actor_label(e.actor_email, e.via) ELSE 'Mingla' END AS actor
        FROM public.team_mentions tm
        LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
       WHERE tm.target_user_id = v_me AND tm.source_kind <> 'team_message'
         AND tm.created_at > now() - make_interval(days => v_days)
    ), g AS (
      SELECT m.day, m.event_kind, m.grp, count(*) AS n, count(*) FILTER (WHERE m.read_at IS NULL) AS unread, max(m.created_at) AS last_at
        FROM m WHERE NOT m.push GROUP BY m.day, m.event_kind, m.grp
    ), gi AS (
      SELECT g.*, (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'text', i.body_excerpt, 'deep_link', i.deep_link, 'card_id', i.card_id,
                       'card', (SELECT jsonb_build_object('number', w.number, 'title', w.title,
                                  'parent', (SELECT jsonb_build_object('number', p.number, 'title', p.title) FROM public.ops_work_cards p WHERE p.id = w.parent_id))
                                  FROM public.ops_work_cards w WHERE w.id = i.card_id),
                       'read', i.read_at IS NOT NULL, 'at', i.created_at) ORDER BY i.created_at DESC)
                     FROM (SELECT * FROM m i0 WHERE NOT i0.push AND i0.day = g.day AND i0.event_kind = g.event_kind AND i0.grp = g.grp
                            ORDER BY i0.created_at DESC LIMIT 20) i) AS items
        FROM g
    )
    SELECT jsonb_build_object(
      'time_zone', v_tz,
      'you', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', y.id, 'event_kind', y.event_kind, 'source_kind', y.source_kind,
                 'needs_you', y.event_kind IN ('review', 'sent_back'), 'actor_name', y.actor, 'body_excerpt', y.body_excerpt,
                 'deep_link', y.deep_link, 'card_id', y.card_id, 'created_at', y.created_at, 'read_at', y.read_at)
                 ORDER BY y.created_at DESC, y.id DESC)
               FROM (SELECT * FROM m WHERE m.push ORDER BY m.created_at DESC, m.id DESC LIMIT 100) y), '[]'::jsonb),
      'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', g.day, 'kind', g.event_kind, 'group', g.grp, 'count', g.n,
                 'unread', g.unread, 'last_at', g.last_at, 'items', COALESCE(g.items, '[]'::jsonb))
                 ORDER BY g.day DESC, g.last_at DESC) FROM gi g), '[]'::jsonb),
      'unread', jsonb_build_object('you', (SELECT count(*) FROM m WHERE m.push AND m.read_at IS NULL),
                                   'mingla', (SELECT count(*) FROM m WHERE NOT m.push AND m.read_at IS NULL))));
  END;
$function$;
REVOKE ALL ON FUNCTION public.team_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_activity(integer) TO authenticated;
COMMENT ON FUNCTION public.team_activity(integer) IS
  'Issue #4398. Admin > Activity for the signed-in teammate: you (push notices, the Host app''s list) and groups (Admin-only notices, one line per kind per day in their time zone, up to 20 items each), with unread counts.';

-- Mark all read: tab you (push notices), mingla (Admin-only notices) or all.
CREATE FUNCTION public.team_activity_mark_read(p_tab text DEFAULT 'all') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_me uuid := auth.uid(); v_n integer;
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  IF p_tab IS NULL OR p_tab NOT IN ('all', 'you', 'mingla') THEN
    RAISE EXCEPTION 'invalid_scope: Mark you, mingla or all as read.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.team_mentions tm SET read_at = now()
   WHERE tm.target_user_id = v_me AND tm.read_at IS NULL AND tm.source_kind <> 'team_message'
     AND (p_tab = 'all' OR (p_tab = 'you' AND tm.push) OR (p_tab = 'mingla' AND NOT tm.push));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('marked', v_n);
END;
$function$;
REVOKE ALL ON FUNCTION public.team_activity_mark_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_activity_mark_read(text) TO authenticated;

COMMIT;
