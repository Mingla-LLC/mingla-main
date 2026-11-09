-- #4255 — work card emails a teammate can find and act on.
--   (1) The email subject names the card ("Seth tagged you: Roving Heights
--       Open Mic"), so Gmail no longer stacks every card email into a few
--       100-message conversations titled "<who> on a work card".
--   (2) Automatic cards that open and close in the same run, and every
--       "Feature Guide: <x> is Live" card, send no email. The in-app bell
--       item (team_mentions) is kept.
--   (3) Work card email (admin.team_mention, email) is on by default for every
--       active teammate. Only an explicit enabled = false row turns it off,
--       the same rule every other category already follows.
-- Ship (1)-(3) together: turning the default on without (1) and (2) would
-- send everyone today's flood.
--
-- I-4255-CARD-EMAIL-SUBJECT: an admin.team_mention outbox row's payload.title
--   names the card title; payload carries card_id.
-- I-4255-AUTO-CARD-NO-EMAIL: an automatic card (auto_key set) that is closed
--   in the transaction that created it leaves no pending admin.team_mention
--   outbox row; a guide_live card never adds one.
-- I-4255-CARD-EMAIL-DEFAULT-ON: can_send / denial reason / preference reads
--   treat a missing admin.team_mention email row as on.
-- Enforced by supabase/migrations/__tests__/issue_4255_work_card_email.implementor.pg17.test.sql.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. can_send: drop the admin.team_mention email opt-in rule.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_send(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cat public.notification_categories%ROWTYPE;
  v_pref_enabled boolean;
  v_category_scope text;
  v_suppressed boolean;
BEGIN
  SELECT * INTO v_cat FROM public.notification_categories WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN RETURN false; END IF;
  IF NOT (p_channel = ANY(v_cat.default_channels)) THEN RETURN false; END IF;

  v_pref_enabled := NULL;
  IF p_user_id IS NOT NULL THEN
    SELECT enabled INTO v_pref_enabled
    FROM public.notification_channel_prefs
    WHERE user_id = p_user_id
      AND category_key = p_category_key
      AND channel = p_channel;
  END IF;

  -- #4255: admin.team_mention email follows the shared rule (on unless off).
  IF v_pref_enabled IS NOT NULL AND v_pref_enabled = false THEN
    RETURN false;
  END IF;

  IF p_channel IN ('email', 'sms') THEN
    v_category_scope := CASE WHEN v_cat.is_transactional THEN 'transactional' ELSE 'marketing' END;
    SELECT EXISTS (
      SELECT 1 FROM public.channel_suppressions suppression
      WHERE suppression.channel = p_channel
        AND suppression.scope IN (v_category_scope, 'all')
        AND (
          (p_user_id IS NOT NULL AND suppression.user_id = p_user_id)
          OR (p_contact IS NOT NULL AND suppression.contact = lower(p_contact))
          OR (p_contact IS NOT NULL AND suppression.contact = p_contact)
        )
    ) INTO v_suppressed;
    IF v_suppressed THEN RETURN false; END IF;
  END IF;

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.can_send(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send(uuid, text, text, text) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Denial reason: the same rule, so the dispatcher's diagnostic stays true.
--    Body is the #4111 definition minus the team_mention opt-in block.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3720_notification_denial_reason(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat public.notification_categories%ROWTYPE;
  v_suppression_reason text;
BEGIN
  IF p_category_key NOT IN (
    'business.community_announcement',
    'business.community_roadmap_updated',
    'business.support_new_ticket',
    'business.brand_group_message',
    'admin.team_mention',
    'business.support_ticket_reply',
    'admin.support_staff_ticket',
    'admin.support_assigned',
    'admin.support_overdue',
    'admin.product_signal_new',
    'admin.product_signal_assigned',
    'admin.product_signal_progress',
    'business.brand_enquiry_new',
    'business.brand_enquiry_message',
    'business.brand_enquiry_nudge',
    'explorer.brand_enquiry_reply'
  ) THEN
    RETURN 'policy_denied';
  END IF;

  SELECT * INTO v_cat
  FROM public.notification_categories
  WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN RETURN 'category_inactive'; END IF;
  IF NOT (p_channel = ANY(v_cat.default_channels)) THEN RETURN 'channel_inactive'; END IF;

  IF p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notification_channel_prefs pref
    WHERE pref.user_id = p_user_id
      AND pref.category_key = p_category_key
      AND pref.channel = p_channel
      AND pref.enabled = false
  ) THEN
    RETURN 'preference_off';
  END IF;

  IF p_channel IN ('email', 'sms') THEN
    SELECT suppression.reason INTO v_suppression_reason
    FROM public.channel_suppressions suppression
    WHERE suppression.channel = p_channel
      AND suppression.scope IN (
        CASE WHEN v_cat.is_transactional THEN 'transactional' ELSE 'marketing' END,
        'all'
      )
      AND (
        (p_user_id IS NOT NULL AND suppression.user_id = p_user_id)
        OR (p_contact IS NOT NULL AND lower(suppression.contact) = lower(p_contact))
      )
    ORDER BY CASE suppression.reason
      WHEN 'complaint' THEN 1
      WHEN 'bounce' THEN 2
      ELSE 3
    END, suppression.created_at DESC
    LIMIT 1;

    IF v_suppression_reason = 'complaint' THEN RETURN 'complaint'; END IF;
    IF v_suppression_reason = 'bounce' THEN RETURN 'hard_bounce'; END IF;
    IF v_suppression_reason IS NOT NULL THEN RETURN 'legal_suppression'; END IF;
  END IF;

  RETURN 'policy_denied';
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Preference reads: a missing row reads as on.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3720_team_notification_preferences()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.issue_3720_active_team_member(auth.uid()) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'mention_inapp', true,
    'mention_email', COALESCE((
      SELECT pref.enabled FROM public.notification_channel_prefs pref
      WHERE pref.user_id = auth.uid()
        AND pref.category_key = 'admin.team_mention'
        AND pref.channel = 'email'
    ), true)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3988_email_alert_categories()
RETURNS TABLE(category_key text, default_on boolean, sort_order integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT * FROM (VALUES
    ('business.support_new_ticket', true, 1),
    ('business.support_ticket_reply', true, 2),
    ('admin.support_staff_ticket', true, 3),
    ('admin.support_assigned', true, 4),
    ('admin.support_overdue', true, 5),
    ('admin.product_signal_new', true, 6),
    ('admin.product_signal_assigned', true, 7),
    ('admin.team_mention', true, 8)
  ) AS c(category_key, default_on, sort_order);
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_email_alert_categories() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_email_alert_categories() TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. ops_notify_people: the subject names the card; guide_live cards and
--    cards closed in their own creating run give an in-app item only.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_notify_people(p_card_id uuid, p_event_id uuid, p_emails text[], p_actor_email text, p_excerpt text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email text; v_uid uuid; v_actor uuid; v_mention uuid; v_told integer := 0;
  v_link text := 'https://admin.usemingla.com/#/work-board?card=' || p_card_id::text;
  v_excerpt text := COALESCE(left(public.ops_one_line(p_excerpt), 280), 'A work card changed.');
  v_card public.ops_work_cards;
  v_action text;
  v_card_title text;
  v_who text;
  v_cut integer;
  v_title text;
  v_email_ok boolean;
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
    END IF;
    v_told := v_told + 1;
  END LOOP;
  RETURN v_told;
END;
$$;
-- Grants are unchanged (CREATE OR REPLACE keeps them).
COMMENT ON FUNCTION public.ops_notify_people(uuid, uuid, text[], text, text) IS
  'Issue #3980/#4255. The one work-card notice producer: team_mentions plus admin.team_mention (no country, no text message). The email subject names the card; guide_live cards and automatic cards closed in their own run get no email.';

-- ───────────────────────────────────────────────────────────────────────────
-- 5. An automatic card closed in the run that made it withdraws the emails
--    its "added" notices queued in that same run (not yet committed, so the
--    drain has never seen them). Earlier runs' rows are never touched.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4255_auto_card_withdraw_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM public.notification_outbox o
   WHERE o.category_key = 'admin.team_mention'
     AND o.status = 'pending'
     AND o.created_at = now()
     AND o.payload->>'card_id' = NEW.id::text;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4255_auto_card_withdraw_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4255_auto_card_withdraw_email ON public.ops_work_cards;
CREATE TRIGGER issue_4255_auto_card_withdraw_email
  AFTER UPDATE OF status ON public.ops_work_cards
  FOR EACH ROW
  WHEN (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done'
        AND NEW.auto_key IS NOT NULL AND NEW.created_at = now())
  EXECUTE FUNCTION public.issue_4255_auto_card_withdraw_email();

COMMIT;
