-- Issue #4255 (Work board v2 + Mingla team) rework after the independent test
-- (FAIL at bbe3579a02). Builds on 20280610014255_issue_4255_work_v2_functions.sql,
-- 20280611014255_issue_4255_team_chat_functions.sql and
-- 20280612004255_issue_4255_team_chat_fixups.sql; the latest body of every
-- function replaced below is copied from there, and each edit is marked
-- "#4255 rework" with its letter.
--
--   A. "Decisions for me" works: a card that gains a You send, You spend, You
--      publish or Needs your OK tag queues business.team_decision (not
--      business.team_mention) for each of its people, opening Mentions in the
--      Host app; the in-app switch decides whether it also makes a bell row.
--   B. Mention links open the card with its thread beside it
--      (#/work-board?card=<id>&side=thread:<id>); existing rows are rewritten
--      once.
--   C. "My cards due and late": one notice at 09:00 in each teammate's own
--      time zone (profiles.timezone) when they own open cards due today or
--      late. A team_mentions row (source_kind work_due) on Mentions and in
--      Admin Messages, plus one business.team_due push. pg_cron runs
--      ops_due_digest() at the top of every hour; the notice is once per
--      person per local day.
--   D. The card Thread badge counts unread for me: a per-person read marker
--      (ops_work_thread_reads) set when I open the thread (ops_thread_read)
--      or post in it (trigger); ops_work_get returns thread_unread.
--   E. team_badge stops counting a team chat mention twice: chat mentions
--      are in their chat's unread count, so the mentions part is the Mentions
--      tab only (Admin mentions, decisions and the due notice).
--   F. team_inbox names Mingla as the sender of the due notice.
--
-- Static SQL only (#1860 C7). Nothing here takes an expected revision, so no
-- conflict is raised; the PT409 rule elsewhere is untouched. Every new table
-- has RLS on and no client policy; every SECURITY DEFINER function sets
-- search_path; internals are revoked from PUBLIC, anon and authenticated.

BEGIN;

-- ---------------------------------------------------------------------------
-- C1. The due notice: its category and its team_mentions kind.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES ('business.team_due', 'team', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

ALTER TABLE public.team_mentions DROP CONSTRAINT team_mentions_source_kind_check;
ALTER TABLE public.team_mentions ADD CONSTRAINT team_mentions_source_kind_check
  CHECK (source_kind IN ('content_calendar_comment', 'work_card', 'team_message', 'work_due'));

-- ---------------------------------------------------------------------------
-- D1. Thread read markers: one row per card and teammate.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_work_thread_reads (
  card_id uuid NOT NULL REFERENCES public.ops_work_cards(id) ON DELETE CASCADE,
  email   text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, email)
);
ALTER TABLE public.ops_work_thread_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_work_thread_reads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_work_thread_reads TO service_role;
COMMENT ON TABLE public.ops_work_thread_reads IS
  'Issue #4255. When each teammate last read a work card''s thread (opened it or posted in it). The card Thread badge counts messages after it. No client access; ops_thread_read and the post trigger write it.';

-- Everything already in a thread counts as read today, so nobody opens the
-- board to a wall of old badges.
INSERT INTO public.ops_work_thread_reads (card_id, email, read_at)
SELECT DISTINCT m.card_id, lower(btrim(d.email)), now()
  FROM public.ops_work_messages m
  CROSS JOIN public.admin_team_directory() d
 WHERE d.status = 'active' AND btrim(COALESCE(d.email, '')) <> ''
ON CONFLICT (card_id, email) DO NOTHING;

-- Messages in a card's thread I have not read: by anyone else, or by an
-- agent working for me, after my marker; deleted ones never count.
CREATE FUNCTION public.ops_thread_unread(p_card_id uuid, p_email text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer
    FROM public.ops_work_messages m
   WHERE m.card_id = p_card_id AND m.deleted_at IS NULL
     AND NOT (m.author_email = lower(btrim(p_email)) AND m.via IS NULL)
     AND m.created_at > COALESCE((SELECT r.read_at FROM public.ops_work_thread_reads r
                                   WHERE r.card_id = p_card_id AND r.email = lower(btrim(p_email))), '-infinity'::timestamptz)
$$;

-- I opened the card's thread. Agents read for their person but never clear
-- the person's badge.
CREATE FUNCTION public.ops_thread_read(p_card_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF NOT EXISTS (SELECT 1 FROM public.ops_work_cards w WHERE w.id = p_card_id) THEN
    RAISE EXCEPTION 'not_found: That card is not here.' USING ERRCODE = 'P0002';
  END IF;
  IF v.via IS NULL THEN
    INSERT INTO public.ops_work_thread_reads (card_id, email, read_at)
    VALUES (p_card_id, lower(btrim(v.actor_email)), clock_timestamp())
    ON CONFLICT (card_id, email) DO UPDATE SET read_at = GREATEST(public.ops_work_thread_reads.read_at, EXCLUDED.read_at);
  END IF;
  RETURN jsonb_build_object('card_id', p_card_id, 'thread_unread', public.ops_thread_unread(p_card_id, v.actor_email));
END;
$$;

-- Posting in a thread means I have read it up to my own message.
CREATE FUNCTION public.ops_thread_read_on_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.via IS NULL AND btrim(COALESCE(NEW.author_email, '')) <> '' THEN
    INSERT INTO public.ops_work_thread_reads (card_id, email, read_at)
    VALUES (NEW.card_id, lower(btrim(NEW.author_email)), GREATEST(NEW.created_at, clock_timestamp()))
    ON CONFLICT (card_id, email) DO UPDATE SET read_at = GREATEST(public.ops_work_thread_reads.read_at, EXCLUDED.read_at);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER ops_work_messages_read_on_post
  AFTER INSERT ON public.ops_work_messages
  FOR EACH ROW EXECUTE FUNCTION public.ops_thread_read_on_post();

-- ---------------------------------------------------------------------------
-- D2. ops_work_get (from 20280610014255): the card carries thread_unread.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_work_get(p_id uuid, p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v record; c public.ops_work_cards; v_today date := public.ops_today(p_today);
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is not here.' USING ERRCODE = 'P0002'; END IF;
  -- #4255: the card's subtasks, files and breadcrumb come with it.
  RETURN jsonb_build_object('subtasks', public.ops_subtasks_json(c.id, v_today), 'files', public.ops_files_json(c.id),
                            'ancestors', public.ops_card_ancestors(c.id)) || jsonb_build_object(
    -- #4255 rework D: unread messages in the card's thread for me.
    'card', public.ops_card_json(c, v_today) || jsonb_build_object('thread_unread', public.ops_thread_unread(c.id, v.actor_email)),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'actor_name', public.ops_name(e.actor_email),
        'via', e.via, 'action', e.action, 'body', e.body, 'undone', e.undone_at IS NOT NULL,
        'undoable', (v.via IS NULL AND e.actor_email = v.actor_email AND e.at > clock_timestamp() - interval '60 seconds'
                     AND e.undone_at IS NULL AND c.revision = e.to_revision AND c.archived_at IS NULL
                     AND e.action IN ('updated','started','status','closed','pushed_back','reopened','people','links','plan','blocked','unblocked')))
        ORDER BY e.at DESC)
      FROM (SELECT * FROM public.ops_work_events x WHERE x.card_id = c.id ORDER BY x.at DESC LIMIT 100) e), '[]'::jsonb),
    'log', COALESCE((SELECT jsonb_agg(public.ops_log_entry_json(l) ORDER BY l.id DESC)
      FROM (SELECT * FROM public.ops_agent_log x WHERE x.card_id = c.id ORDER BY x.id DESC LIMIT 50) l), '[]'::jsonb),
    'claims', COALESCE((SELECT jsonb_agg(public.ops_claim_json(k) ORDER BY k.claimed_at)
      FROM public.ops_claims k
     WHERE k.released_at IS NULL AND k.last_seen_at >= clock_timestamp() - interval '30 minutes'
       AND (k.card_id = c.id OR (k.target_kind = 'work_card' AND k.target_id = c.id)
            OR EXISTS (SELECT 1 FROM public.ops_work_links l WHERE l.card_id = c.id AND l.target_id = k.target_id
                         AND k.target_kind = CASE l.kind WHEN 'host' THEN 'crm_record' WHEN 'creator' THEN 'crm_record'
                                                         WHEN 'card' THEN 'work_card' ELSE l.kind END))), '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- A + B. ops_notify_people (from 20280611014255).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_notify_people(p_card_id uuid, p_event_id uuid, p_emails text[], p_actor_email text, p_excerpt text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email text; v_uid uuid; v_actor uuid; v_mention uuid; v_told integer := 0;
  -- #4255 rework B: the card opens with its thread beside it.
  v_link text := 'https://admin.usemingla.com/#/work-board?card=' || p_card_id::text || '&side=thread:' || p_card_id::text;
  v_excerpt text := COALESCE(left(public.ops_one_line(p_excerpt), 280), 'A work card changed.');
  v_card public.ops_work_cards;
  v_action text;
  v_card_title text;
  v_who text;
  v_cut integer;
  v_title text;
  v_email_ok boolean;
  -- #4255 rework A: a tag that asks a person to act (ops_work_update ends its
  -- words with the tag's own words, the rule Admin Messages groups by).
  v_decision boolean := COALESCE(public.ops_one_line(p_excerpt), '') ~ '·\s*(You send|You spend|You publish|Needs your OK)\s*$';
  v_push_ok boolean;
  v_inapp_ok boolean;
BEGIN
  SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.id = p_card_id;
  SELECT e.action INTO v_action FROM public.ops_work_events e WHERE e.id = p_event_id;
  v_card_title := NULLIF(public.ops_one_line(v_card.title), '');

  -- Subject. A note tells only the people it tags: "<who> tagged you: <card>".
  -- Every other producer's excerpt already reads "<who> <did what>: <card>…".
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

  -- Email only for cards a person should act on. A "Feature Guide is Live"
  -- card, or any automatic card already closed in the run that made it, is a
  -- bell item only.
  v_email_ok := NOT (
    v_card.auto_key IS NOT NULL AND (
      split_part(v_card.auto_key, ':', 1) = 'guide_live'
      OR (v_card.status = 'done' AND v_card.created_at = now())
    )
  );

  SELECT u.id INTO v_actor FROM auth.users u WHERE lower(btrim(u.email)) = lower(btrim(p_actor_email)) ORDER BY u.created_at LIMIT 1;
  FOR v_email IN SELECT DISTINCT lower(btrim(x)) FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) x WHERE btrim(COALESCE(x, '')) <> '' LOOP
    CONTINUE WHEN v_email = lower(btrim(p_actor_email));
    v_uid := NULL;
    SELECT u.id INTO v_uid FROM auth.users u
     WHERE lower(btrim(u.email)) = v_email AND public.issue_3720_active_team_member(u.id)
     ORDER BY u.created_at LIMIT 1;
    CONTINUE WHEN v_uid IS NULL;
    v_mention := NULL;
    INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link)
    VALUES ('work_card', p_event_id, v_actor, v_uid, v_excerpt, v_link)
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
      -- #4255 W1b: one push to the teammate's Host app (Mentions there opens
      -- Admin at the card). Ids only; the template writes the words. Same
      -- quiet rule as the email; only a confirmed staff account.
      IF public.team_chat_staff(v_uid) THEN
        IF v_decision THEN
          -- #4255 rework A: a decision is business.team_decision, under its
          -- own switches. Push and in-app both off: nothing is queued; in-app
          -- off alone: it pushes without a bell row (payload.inapp false).
          v_push_ok := public.can_send(v_uid, 'business.team_decision', 'push', NULL);
          v_inapp_ok := public.can_send(v_uid, 'business.team_decision', 'inapp', NULL);
          IF v_push_ok OR v_inapp_ok THEN
            INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
            VALUES ('business.team_decision', v_uid, NULL,
              jsonb_build_object('source_kind', 'work_card', 'reason', 'decision',
                'mention_id', v_mention, 'source_id', p_event_id, 'card_id', p_card_id, 'actor_user_id', v_actor,
                'inapp', v_inapp_ok,
                'deep_link', 'mingla-business://team/mention/' || v_mention::text),
              'business.team_decision:' || v_mention::text, 'pending')
            ON CONFLICT (idempotency_key) DO NOTHING;
          END IF;
        ELSE
          INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
          VALUES ('business.team_mention', v_uid, NULL,
            jsonb_build_object('source_kind', 'work_card', 'reason', CASE WHEN v_action = 'note' THEN 'mention' ELSE 'work_update' END,
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
$$;
COMMENT ON FUNCTION public.ops_notify_people(uuid, uuid, text[], text, text) IS
  'Issue #3980/#4255. The one work-card notice producer: team_mentions (linking to the card with its thread open) plus admin.team_mention (no country, no text message) plus one Host app push for a confirmed staff account: business.team_decision when the card asks the person to act (You send, You spend, You publish, Needs your OK; under the Decisions for me switches), else business.team_mention. guide_live cards and automatic cards closed in their own run get no email and no push.';

-- The automatic-card withdraw (from 20280611014255): the decision push queued
-- beside the email is withdrawn with it too.
CREATE OR REPLACE FUNCTION public.issue_4255_auto_card_withdraw_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM public.notification_outbox o
   WHERE o.category_key IN ('admin.team_mention', 'business.team_mention', 'business.team_decision') -- #4255 rework A
     AND o.status = 'pending'
     AND o.created_at = now()
     AND o.payload->>'card_id' = NEW.id::text;
  RETURN NULL;
END;
$$;

-- B. Existing card links open the thread too (only the exact old shape).
UPDATE public.team_mentions tm
   SET deep_link = tm.deep_link || '&side=thread:' || substring(tm.deep_link FROM 'card=([0-9a-f-]{36})$')
 WHERE tm.source_kind = 'work_card'
   AND tm.deep_link ~ '^https://admin\.usemingla\.com/#/work-board\?card=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ---------------------------------------------------------------------------
-- C2. ops_due_digest: "My cards due and late", at 09:00 local.
-- ---------------------------------------------------------------------------
-- For every confirmed, active staff account whose own clock (profiles.timezone;
-- an empty or unknown zone reads as America/New_York, like the push quiet
-- hours) shows 09:xx at p_now, and who owns open cards due today or late:
-- one team_mentions row (once per local day: its source id is derived from
-- the person and the date) and, when either of their switches is on, one
-- business.team_due row (#1529 catalog: populating, explicit NULL country;
-- no team category routes SMS). Returns how many people were told.
CREATE FUNCTION public.ops_due_digest(p_now timestamptz DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, clock_timestamp());
  r record; v_local timestamp; v_day date; v_due integer; v_late integer; v_titles text;
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
    CONTINUE WHEN COALESCE(v_due, 0) + COALESCE(v_late, 0) = 0;
    v_excerpt := left(concat_ws(' · ',
                   CASE WHEN v_due = 1 THEN '1 due today' WHEN v_due > 1 THEN v_due || ' due today' END,
                   CASE WHEN v_late = 1 THEN '1 late' WHEN v_late > 1 THEN v_late || ' late' END)
                 || ': ' || public.ops_one_line(v_titles), 280);
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
$$;
COMMENT ON FUNCTION public.ops_due_digest(timestamptz) IS
  'Issue #4255. My cards due and late: at 09:00 in each staff member''s own time zone, one team_mentions row (work_due, once per local day) and one business.team_due push (ids only, explicit NULL country) when they own open cards due today or late. Run hourly by pg_cron (issue_4255_due_digest). Internal.';

-- ---------------------------------------------------------------------------
-- E. team_badge (from 20280612004255).
-- ---------------------------------------------------------------------------
-- The one count for the Host app icon and the Admin Messages button: chats
-- with unread messages (muted chats left out) plus unread mentions on the
-- Mentions tab, and whether the caller may mention everyone. A signed-in
-- person who is not staff gets staff false, admin false and zeros, so the
-- icon stays hidden without an error.
CREATE OR REPLACE FUNCTION public.team_badge() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
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
   WHERE tm.target_user_id = v_me AND tm.read_at IS NULL AND tm.source_kind <> 'team_message';
  -- #4255 fix-up B2: the same rule team_post enforces for @everyone.
  RETURN jsonb_build_object('staff', true, 'admin', public.team_chat_admin(v_me), 'chats', v_chats, 'messages', v_messages, 'mentions', v_mentions, 'total', v_chats + v_mentions);
END;
$$;
COMMENT ON FUNCTION public.team_badge() IS
  'Issue #4255. One call for the Host app Mingla team icon and the Admin Messages button: chats with unread messages (not muted) plus unread Mentions-tab items (Admin mentions, decisions, the due notice; team chat mentions are counted in their chat), and admin (owner or admin: may mention everyone). staff false, admin false and zeros for a signed-in person who is not staff.';

-- ---------------------------------------------------------------------------
-- F. team_inbox (from 20280611014255): the due notice is from Mingla.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_inbox(
  p_alert_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;
COMMENT ON FUNCTION public.team_inbox(text[], integer) IS
  'Issue #4130/#4255: the signed-in teammate''s own inbox. Mentions split into real mentions and Work updates with who did it (team chat mentions carry their thread_id and message_id; deleted or left ones are hidden; the 09:00 due notice is from Mingla); support alerts with whether their ticket is already resolved (then never unread). Own rows only.';

-- ---------------------------------------------------------------------------
-- Grants. Internal helpers: nobody but the service role. ops_thread_read:
-- signed-in people (crm_ctx checks the team itself).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ops_thread_unread(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_thread_read_on_post() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_due_digest(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_thread_unread(uuid, text), public.ops_due_digest(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.ops_thread_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_thread_read(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.ops_thread_unread(uuid, text) IS
  'Issue #4255. Messages in a card''s thread the teammate has not read (after their ops_work_thread_reads marker; their own posts and deleted messages never count; their agents'' posts do). Internal.';
COMMENT ON FUNCTION public.ops_thread_read(uuid) IS
  'Issue #4255. Marks a card''s thread read for the signed-in teammate (an agent call reads but never clears its person''s badge). Returns thread_unread.';
COMMENT ON FUNCTION public.ops_thread_read_on_post() IS
  'Issue #4255. Posting in a card''s thread marks it read for the author (people, not agents). Internal.';

-- ---------------------------------------------------------------------------
-- C3. Cron: pure SQL, no net.http, no vault. Hourly; ops_due_digest picks the
-- people whose own clock reads 09:xx. (A local replayed stack runs it too,
-- like every other job; turn local cron off.)
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #4255: pg_cron unavailable; issue_4255_due_digest not scheduled.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4255_due_digest') THEN
    PERFORM cron.unschedule('issue_4255_due_digest');
  END IF;
  PERFORM cron.schedule('issue_4255_due_digest', '0 * * * *',
    $job$SELECT public.ops_due_digest();$job$);
END
$cron$;

COMMIT;
