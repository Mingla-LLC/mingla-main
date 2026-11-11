-- Issue #4255 (Work board v2 + Mingla team) rework 2 after Retest 1 (FAIL at
-- 714b61e4e4). Builds on 20280614054255_issue_4255_team_rework.sql; the
-- latest body of ops_notify_people is copied from there, and each edit is
-- marked "#4255 rework 2" with its defect.
--
--   P1. A teammate's own time zone: team_set_my_timezone(p_timezone) saves the
--       device's IANA zone (checked against pg_timezone_names) on the
--       signed-in staff member's profile, only when it is empty or different.
--       Admin and the Host app call it on load, sign-in and foreground, so
--       quiet hours (22:00 to 07:00) and the 09:00 due notice read the
--       person's own clock instead of the New York fallback.
--   P2. business.team_decision goes to the card's owners only; a watcher of
--       the same tag change gets the plain business.team_mention update.
--   P3. A decision is the tag-change event itself (before: no tag; after: a
--       tag), read from ops_work_events, never from the words: a note ending
--       in "· You send" is a mention.
--
-- Static SQL only (#1860 C7). Nothing here takes an expected revision, so no
-- conflict is raised (the PT409 rule elsewhere is untouched). Every SECURITY
-- DEFINER function sets search_path.

BEGIN;

-- ---------------------------------------------------------------------------
-- P2 + P3. ops_notify_people (from 20280614054255).
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
  -- #4255 rework 2 (P3): a decision is the event that put a Send, Spend,
  -- Publish or Needs your OK tag on the card (its before snapshot has no tag,
  -- its after snapshot has one), never words that happen to end like a tag.
  v_before jsonb;
  v_after jsonb;
  v_tag_set boolean;
  v_decision boolean;
  v_push_ok boolean;
  v_inapp_ok boolean;
BEGIN
  SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.id = p_card_id;
  SELECT e.action, e.before, e.after INTO v_action, v_before, v_after FROM public.ops_work_events e WHERE e.id = p_event_id;
  v_tag_set := v_action IS DISTINCT FROM 'note'
    AND v_before IS NOT NULL AND v_after IS NOT NULL
    AND NULLIF(v_before->'fields'->>'person_reason', '') IS NULL
    AND NULLIF(v_after->'fields'->>'person_reason', '') IS NOT NULL;
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
        -- #4255 rework 2 (P2): only the card's owners are asked to decide;
        -- a watcher of the same tag change gets the plain update push.
        v_decision := v_tag_set AND EXISTS (
          SELECT 1 FROM public.ops_work_people w
           WHERE w.card_id = p_card_id AND w.role = 'owner' AND lower(btrim(w.email)) = v_email);
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
  'Issue #3980/#4255. The one work-card notice producer: team_mentions (linking to the card with its thread open) plus admin.team_mention (no country, no text message) plus one Host app push for a confirmed staff account: business.team_decision for an owner when the event put a You send, You spend, You publish or Needs your OK tag on the card (under the Decisions for me switches), else business.team_mention. guide_live cards and automatic cards closed in their own run get no email and no push.';

-- ---------------------------------------------------------------------------
-- P1. team_set_my_timezone: the device's zone on the teammate's own profile.
-- ---------------------------------------------------------------------------
-- Signed-in only. A host who is not staff is answered {staff:false} and
-- nothing is written (the team clock is for staff). An unknown zone is
-- refused (22023) and nothing is written. The same zone again writes nothing.
CREATE FUNCTION public.team_set_my_timezone(p_timezone text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_zone text := btrim(COALESCE(p_timezone, ''));
  v_current text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'team_timezone_signed_out' USING ERRCODE = '42501';
  END IF;
  IF v_zone = '' OR char_length(v_zone) > 64
     OR v_zone LIKE 'posix/%'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_zone) THEN
    RAISE EXCEPTION 'team_timezone_unknown' USING ERRCODE = '22023',
      DETAIL = 'Use an IANA time zone name, for example Africa/Lagos.';
  END IF;
  IF NOT public.team_chat_staff(v_uid) THEN
    RETURN jsonb_build_object('staff', false, 'timezone', NULL, 'changed', false);
  END IF;
  SELECT NULLIF(btrim(p.timezone), '') INTO v_current FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('staff', true, 'timezone', NULL, 'changed', false);
  END IF;
  IF v_current IS NOT DISTINCT FROM v_zone THEN
    RETURN jsonb_build_object('staff', true, 'timezone', v_zone, 'changed', false);
  END IF;
  UPDATE public.profiles p SET timezone = v_zone WHERE p.id = v_uid;
  RETURN jsonb_build_object('staff', true, 'timezone', v_zone, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.team_set_my_timezone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_set_my_timezone(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.team_set_my_timezone(text) IS
  'Issue #4255. Saves the signed-in staff member''s device time zone (an IANA name in pg_timezone_names) on profiles.timezone, only when it is empty or different; quiet hours and the 09:00 due notice read it. Non-staff: {staff:false}, nothing written. Unknown zone: 22023.';

COMMIT;
