-- #4111 Wave A — enquiry notifications, crons, and the signed-out
-- "Stay in the loop" subscribe (double opt-in).
--
-- Categories (notification_outbox -> notify-outbox-drain -> notify-dispatch):
--   business.brand_enquiry_new      inapp+push   team, new enquiry
--   business.brand_enquiry_message  inapp+push   team, guest wrote again
--   business.brand_enquiry_nudge    inapp+email  team + brands.contact_email, once,
--                                                no brand reply 24h after the guest
--   explorer.brand_enquiry_reply    inapp+push   Explorer guest, brand replied
--   web.brand_subscribe_confirm     sms          subscribe double opt-in text (dispatched
--                                                directly by public-brand-subscribe)
-- Web guests without an account get the batched reply email from the
-- brand-enquiry-guest-digest edge function (cron below), not from a category,
-- because each email carries a fresh access link that must never be stored raw.
--
-- Subscribe (service role, edge only):
--   issue_4111_create_subscribe_pending(...) -> jsonb
--   issue_4111_confirm_subscribe(p_token_hash) -> jsonb
-- Explorer (authenticated): claim_brand_subscriptions_for_user() -> integer
--
-- INVARIANT: {"id":"I-4111-SUBSCRIBE-SMS-SHARES-BLAST-CAP","rule":"Subscribe confirmation texts count against the same per-brand monthly SMS cap as host blasts, in both directions."}

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Categories + dispatcher diagnostics.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.notification_categories(
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('business.brand_enquiry_new', 'enquiries', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('business.brand_enquiry_message', 'enquiries', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('business.brand_enquiry_nudge', 'enquiries', true, 'normal', ARRAY['inapp','email']::text[], 'reach_once', true),
  ('explorer.brand_enquiry_reply', 'Messages', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  -- The subscribe double opt-in text. Sent by public-brand-subscribe through
  -- notify-dispatch (no stored row carries the link); STOP suppressions apply.
  ('web.brand_subscribe_confirm', 'Subscriptions', true, 'normal', ARRAY['sms']::text[], 'reach_once', true)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

-- Same body as 20271123023988 with the four #4111 categories added.
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

  IF p_category_key = 'admin.team_mention' AND p_channel = 'email'
     AND NOT EXISTS (
       SELECT 1 FROM public.notification_channel_prefs pref
       WHERE pref.user_id = p_user_id
         AND pref.category_key = p_category_key
         AND pref.channel = p_channel
         AND pref.enabled = true
     ) THEN
    RETURN 'preference_off';
  END IF;
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
-- 2. Crons: auto-resolve idle threads, the 24h nudge, the guest digest.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4111_auto_resolve_idle_enquiries()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_count integer;
BEGIN
  UPDATE public.brand_enquiries
  SET status = 'resolved', resolved_at = now(), resolved_by = NULL, updated_at = now()
  WHERE status <> 'resolved'
    AND GREATEST(last_guest_at, COALESCE(last_brand_at, last_guest_at)) < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_auto_resolve_idle_enquiries() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_auto_resolve_idle_enquiries() TO service_role;

-- Once per enquiry: the guest is waiting 24h after their last message and the
-- brand has not replied since. Team members get a user-addressed row (the drain
-- resolves each confirmed email); brands.contact_email gets a contact row.
CREATE OR REPLACE FUNCTION public.issue_4111_enquiry_nudge_sweep()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
  v_payload jsonb;
BEGIN
  FOR v_row IN
    SELECT e.*, b.name brand_name, lower(btrim(b.contact_email)) contact_email
    FROM public.brand_enquiries e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    WHERE e.status IN ('new','waiting')
      AND e.nudged_at IS NULL
      AND NOT e.spam_flag
      AND e.last_guest_at <= now() - interval '24 hours'
      AND (e.last_brand_at IS NULL OR e.last_brand_at < e.last_guest_at)
    ORDER BY e.last_guest_at
    LIMIT 200
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    v_payload := jsonb_build_object(
      'enquiry_id', v_row.id, 'conversation_id', v_row.conversation_id,
      'brand_id', v_row.brand_id, 'brand_name', v_row.brand_name,
      'guest_name', v_row.guest_name, 'topic_label', v_row.topic_label,
      'deep_link', 'mingla-business://messages/' || v_row.conversation_id::text
    );
    -- country_code: explicit NULL — the nudge has no SMS channel (#1529).
    INSERT INTO public.notification_outbox(category_key, user_id, brand_id, country_code, payload, idempotency_key, status)
    SELECT 'business.brand_enquiry_nudge', member.user_id, v_row.brand_id, NULL, v_payload,
      'business.brand_enquiry_nudge:' || v_row.id::text || ':' || member.user_id::text, 'pending'
    FROM (
      SELECT DISTINCT m.user_id FROM public.brand_team_members m
      WHERE m.brand_id = v_row.brand_id AND m.accepted_at IS NOT NULL
        AND m.removed_at IS NULL AND m.role <> 'scanner'
    ) member
    ON CONFLICT (idempotency_key) DO NOTHING;

    IF v_row.contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' AND NOT EXISTS (
      SELECT 1 FROM public.brand_team_members m
      JOIN auth.users u ON u.id = m.user_id
      WHERE m.brand_id = v_row.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
        AND m.role <> 'scanner' AND lower(u.email) = v_row.contact_email
    ) THEN
      INSERT INTO public.notification_outbox(category_key, user_id, contact, brand_id, country_code, payload, idempotency_key, status)
      VALUES ('business.brand_enquiry_nudge', NULL, v_row.contact_email, v_row.brand_id, NULL, v_payload,
        'business.brand_enquiry_nudge:' || v_row.id::text || ':contact', 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    UPDATE public.brand_enquiries SET nudged_at = now() WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_enquiry_nudge_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_enquiry_nudge_sweep() TO service_role;

DO $cron$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('issue_4111_enquiry_auto_resolve', 'issue_4111_enquiry_nudge', 'issue_4111_enquiry_guest_digest');

  PERFORM cron.schedule('issue_4111_enquiry_auto_resolve', '17 3 * * *',
    $job$SELECT public.issue_4111_auto_resolve_idle_enquiries()$job$);
  PERFORM cron.schedule('issue_4111_enquiry_nudge', '*/15 * * * *',
    $job$SELECT public.issue_4111_enquiry_nudge_sweep()$job$);
  PERFORM cron.schedule('issue_4111_enquiry_guest_digest', '*/5 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/brand-enquiry-guest-digest',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret
            FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      )
      WHERE EXISTS (
        SELECT 1 FROM public.brand_enquiries e
        WHERE e.guest_user_id IS NULL AND e.last_brand_at IS NOT NULL
          AND e.last_brand_at > COALESCE(e.guest_emailed_at, 'epoch'::timestamptz)
      );
    $job$);
END;
$cron$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Follow sources for subscribe confirmations. Same body as 20270807003682
--    with 'web_subscribe' and 'site_subscribe' allowed.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_auto_follow_brand(
  p_user_id uuid,
  p_brand_id uuid,
  p_source text DEFAULT 'purchase',
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'purchase');
  v_claim_count integer := 0;
  v_row_count integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'auto_follow_args_required' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN (
    'purchase', 'rsvp', 'booking', 'brand_page', 'web_email', 'web_follow_invite',
    'web_subscribe', 'site_subscribe'
  ) THEN
    RAISE EXCEPTION 'auto_follow_source_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_source IN ('purchase', 'rsvp', 'booking') AND p_order_id IS NULL THEN
    RAISE EXCEPTION 'auto_follow_order_required' USING ERRCODE = '22023';
  END IF;

  IF p_order_id IS NOT NULL THEN
    INSERT INTO public.brand_follow_auto_claims (order_id, user_id, brand_id, source)
    VALUES (p_order_id, p_user_id, p_brand_id, v_source)
    ON CONFLICT (order_id) DO NOTHING;
    GET DIAGNOSTICS v_claim_count = ROW_COUNT;
    IF v_claim_count = 0 THEN
      RETURN jsonb_build_object(
        'followed', false,
        'created', false,
        'skipped', 'already_claimed',
        'userId', p_user_id,
        'brandId', p_brand_id,
        'orderId', p_order_id,
        'source', v_source
      );
    END IF;
  END IF;

  INSERT INTO public.brand_follows (user_id, brand_id, source)
  VALUES (p_user_id, p_brand_id, v_source)
  ON CONFLICT ON CONSTRAINT brand_follows_user_brand_key DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'followed', true,
    'created', (v_row_count > 0),
    'userId', p_user_id,
    'brandId', p_brand_id,
    'orderId', p_order_id,
    'source', v_source
  );
END;
$f$;
REVOKE ALL ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text, uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. The monthly SMS cap is shared with subscribe confirmation texts.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4111_subscribe_sms_used(p_brand_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT count(*)::integer FROM public.brand_subscribe_pending p
  WHERE p.brand_id = p_brand_id
    AND p.sms_sent_at >= date_trunc('month', timezone('utc', now()));
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_subscribe_sms_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_subscribe_sms_used(uuid) TO service_role;

-- Same body as 20270809003682 plus subscribe texts in the SMS usage.
CREATE OR REPLACE FUNCTION public.biz_brand_blast_usage_v1(
  p_actor_id uuid,
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_sms_cap integer := 100;
  v_email_cap integer := 1000;
  v_sms_used integer := 0;
  v_email_used integer := 0;
  v_blasts_week integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
  v_week_start timestamptz := timezone('utc', now()) - interval '7 days';
BEGIN
  IF p_actor_id IS NULL OR p_brand_id IS NULL THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_sms_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = 'sms'
    AND e.confirmed_at >= v_month_start;
  v_sms_used := v_sms_used + public.issue_4111_subscribe_sms_used(p_brand_id);

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_email_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = 'email'
    AND e.confirmed_at >= v_month_start;

  SELECT COUNT(*)::integer
  INTO v_blasts_week
  FROM public.marketing_book_send_executions e
  WHERE e.brand_id = p_brand_id
    AND e.confirmed_at >= v_week_start;

  RETURN jsonb_build_object(
    'smsCap', v_sms_cap,
    'smsUsed', v_sms_used,
    'smsRemaining', GREATEST(v_sms_cap - v_sms_used, 0),
    'emailCap', v_email_cap,
    'emailUsed', v_email_used,
    'emailRemaining', GREATEST(v_email_cap - v_email_used, 0),
    'blastsThisWeek', v_blasts_week,
    'weekWarningAt', 3
  );
END;
$f$;

CREATE OR REPLACE FUNCTION public.biz_assert_brand_blast_allowance_v1(
  p_brand_id uuid,
  p_channel text,
  p_additional_reachable integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_cap integer;
  v_used integer := 0;
  v_month_start timestamptz := date_trunc('month', timezone('utc', now()));
BEGIN
  IF p_channel = 'push' OR COALESCE(p_additional_reachable, 0) <= 0 THEN
    RETURN;
  END IF;
  IF p_channel = 'sms' THEN
    v_cap := 100;
  ELSIF p_channel = 'email' THEN
    v_cap := 1000;
  ELSE
    RETURN;
  END IF;

  -- Serialize brand×channel confirm races so two campaigns cannot both pass
  -- the pre-insert read and exceed the monthly aggregate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('blast_cap:' || p_brand_id::text || ':' || p_channel, 3682)
  );

  SELECT COALESCE(SUM(e.reachable_count), 0)::integer
  INTO v_used
  FROM public.marketing_book_send_executions e
  JOIN public.marketing_campaigns c ON c.id = e.campaign_id
  WHERE e.brand_id = p_brand_id
    AND c.channel = p_channel
    AND e.confirmed_at >= v_month_start;
  IF p_channel = 'sms' THEN
    v_used := v_used + public.issue_4111_subscribe_sms_used(p_brand_id);
  END IF;

  IF v_used + p_additional_reachable > v_cap THEN
    RAISE EXCEPTION 'book_blast_monthly_cap_exceeded' USING ERRCODE = 'P0001';
  END IF;
END;
$f$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Subscribe (signed-out web / Mingla Sites). D2.
-- ───────────────────────────────────────────────────────────────────────────
-- {status:'created', pending_id, brand_name, brand_slug, send_sms}
-- | {status:'recent'|'rate_limited'|'unavailable'|'invalid'}
CREATE OR REPLACE FUNCTION public.issue_4111_create_subscribe_pending(
  p_brand_id uuid,
  p_source text,
  p_origin text,
  p_email text,
  p_phone text,
  p_wants_sms boolean,
  p_email_token_hash text,
  p_sms_token_hash text,
  p_ip_hash text,
  p_disclosure_text text,
  p_disclosure_version text,
  p_sms_disclosure_text text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_phone text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_wants_sms boolean := COALESCE(p_wants_sms, false) AND v_phone IS NOT NULL;
  v_send_sms boolean := false;
  v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_source, '') NOT IN ('web','site')
     OR (p_source = 'site' AND NULLIF(btrim(COALESCE(p_origin,'')),'') IS NULL)
     OR p_email_token_hash IS NULL OR p_email_token_hash !~ '^[0-9a-f]{64}$'
     OR (v_wants_sms AND (p_sms_token_hash IS NULL OR p_sms_token_hash !~ '^[0-9a-f]{64}$')) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unavailable'); END IF;

  IF (p_ip_hash IS NOT NULL AND public.biz_web_follow_rate_hit('sub:ip:' || p_ip_hash, 3600, 10))
     OR public.biz_web_follow_rate_hit('sub:eb:' || p_brand_id::text || ':' || public.issue_4111_email_hash(v_email), 86400, 3) THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;
  -- A pending row from the last 30 seconds for the same address: no resend.
  IF EXISTS (
    SELECT 1 FROM public.brand_subscribe_pending p
    WHERE p.brand_id = p_brand_id AND p.email = v_email
      AND p.email_confirmed_at IS NULL AND p.created_at > now() - interval '30 seconds'
  ) THEN
    RETURN jsonb_build_object('status', 'recent');
  END IF;

  IF v_wants_sms THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('blast_cap:' || p_brand_id::text || ':sms', 3682));
    v_send_sms := (
      SELECT COALESCE(SUM(e.reachable_count), 0)::integer
      FROM public.marketing_book_send_executions e
      JOIN public.marketing_campaigns c ON c.id = e.campaign_id
      WHERE e.brand_id = p_brand_id AND c.channel = 'sms'
        AND e.confirmed_at >= date_trunc('month', timezone('utc', now()))
    ) + public.issue_4111_subscribe_sms_used(p_brand_id) < 100;
  END IF;

  BEGIN
    INSERT INTO public.brand_subscribe_pending(
      brand_id, source, origin, email, phone_e164, wants_sms, email_token_hash,
      sms_token_hash, sms_sent_at, disclosure_text, disclosure_version,
      sms_disclosure_text, ip_hash, expires_at
    ) VALUES (
      p_brand_id, p_source, NULLIF(btrim(COALESCE(p_origin,'')),''), v_email, v_phone, v_wants_sms,
      p_email_token_hash, CASE WHEN v_send_sms THEN p_sms_token_hash END,
      CASE WHEN v_send_sms THEN now() END,
      p_disclosure_text, p_disclosure_version,
      CASE WHEN v_wants_sms THEN p_sms_disclosure_text END, p_ip_hash, now() + interval '72 hours'
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN SQLSTATE '23514' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END;

  RETURN jsonb_build_object('status', 'created', 'pending_id', v_id, 'brand_name', v_brand.name,
    'brand_slug', v_brand.slug, 'send_sms', v_send_sms);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_create_subscribe_pending(uuid,text,text,text,text,boolean,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_create_subscribe_pending(uuid,text,text,text,text,boolean,text,text,text,text,text,text)
  TO service_role;

-- Contact-book subscriber (no Mingla account): brand_people + contact method
-- with marketing permission granted, provenance 'newsletter'.
CREATE OR REPLACE FUNCTION public.issue_4111_upsert_newsletter_contact(
  p_brand_id uuid, p_pending_id uuid, p_channel text, p_value text, p_consent_id uuid,
  p_user_id uuid, p_display_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_person uuid;
  v_method uuid;
  v_link uuid;
BEGIN
  -- Existing person on this brand holding this address (any channel row).
  SELECT cm.brand_person_id INTO v_person
  FROM public.brand_person_contact_methods cm
  JOIN public.brand_people bp ON bp.id = cm.brand_person_id AND bp.record_status = 'active'
  WHERE cm.brand_id = p_brand_id AND cm.channel = p_channel AND cm.normalized_value = p_value
    AND cm.record_state = 'active'
  LIMIT 1;
  IF v_person IS NULL AND p_user_id IS NOT NULL THEN
    SELECT bp.id INTO v_person FROM public.brand_people bp
    WHERE bp.brand_id = p_brand_id AND bp.linked_user_id = p_user_id AND bp.record_status = 'active';
  END IF;
  IF v_person IS NULL THEN
    -- The person may already exist through the subscription's email row.
    SELECT cm.brand_person_id INTO v_person
    FROM public.brand_subscribe_pending p
    JOIN public.brand_person_contact_methods cm
      ON cm.brand_id = p.brand_id AND cm.channel = 'email' AND cm.normalized_value = p.email
     AND cm.record_state = 'active'
    WHERE p.id = p_pending_id
    LIMIT 1;
  END IF;
  IF v_person IS NULL THEN
    INSERT INTO public.brand_people(brand_id, linked_user_id, display_name)
    VALUES (p_brand_id, p_user_id, left(COALESCE(NULLIF(btrim(p_display_name),''), 'Subscriber'), 120))
    RETURNING id INTO v_person;
  END IF;

  INSERT INTO public.brand_person_source_links(
    brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at
  ) VALUES (
    p_brand_id, v_person, 'newsletter', p_pending_id, 'normalized_address', now()
  )
  ON CONFLICT (source_kind, source_id) WHERE detached_at IS NULL DO NOTHING
  RETURNING id INTO v_link;
  IF v_link IS NULL THEN
    SELECT id INTO v_link FROM public.brand_person_source_links
    WHERE source_kind = 'newsletter' AND source_id = p_pending_id AND detached_at IS NULL;
  END IF;

  SELECT id INTO v_method FROM public.brand_person_contact_methods
  WHERE brand_person_id = v_person AND channel = p_channel AND normalized_value = p_value
    AND record_state = 'active';
  IF v_method IS NULL THEN
    INSERT INTO public.brand_person_contact_methods(
      brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable,
      is_primary, marketing_consent_state, marketing_consent_record_id, marketing_consent_graded_at
    ) VALUES (
      p_brand_id, v_person, p_channel, p_value, 'brand_owned', true,
      NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods x
        WHERE x.brand_person_id = v_person AND x.channel = p_channel AND x.record_state = 'active' AND x.is_primary),
      'granted', p_consent_id, now()
    ) RETURNING id INTO v_method;
  ELSE
    UPDATE public.brand_person_contact_methods
    SET marketing_consent_state = 'granted', marketing_consent_record_id = p_consent_id,
        marketing_consent_graded_at = now(), updated_at = now()
    WHERE id = v_method;
  END IF;

  INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable)
  VALUES (v_method, v_link, 'newsletter', true)
  ON CONFLICT (contact_method_id, source_link_id) DO NOTHING;
  RETURN v_person;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_upsert_newsletter_contact(uuid,uuid,text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_upsert_newsletter_contact(uuid,uuid,text,text,uuid,uuid,text) TO service_role;

-- Confirm either link (email or text). Idempotent.
-- {status:'confirmed'|'already', channel:'email'|'sms', outcome:'followed'|'subscribed', brand_name, brand_slug}
-- | {status:'expired'|'invalid'}
CREATE OR REPLACE FUNCTION public.issue_4111_confirm_subscribe(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_pending public.brand_subscribe_pending%ROWTYPE;
  v_channel text;
  v_brand public.brands%ROWTYPE;
  v_user uuid;
  v_contact text;
  v_consent uuid;
  v_outcome text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT * INTO v_pending FROM public.brand_subscribe_pending
  WHERE email_token_hash = p_token_hash OR sms_token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  v_channel := CASE WHEN v_pending.email_token_hash = p_token_hash THEN 'email' ELSE 'sms' END;
  SELECT * INTO v_brand FROM public.brands WHERE id = v_pending.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;

  IF (v_channel = 'email' AND v_pending.email_confirmed_at IS NOT NULL)
     OR (v_channel = 'sms' AND v_pending.sms_confirmed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('status', 'already', 'channel', v_channel,
      'outcome', COALESCE(v_pending.outcome, 'subscribed'),
      'brand_name', v_brand.name, 'brand_slug', v_brand.slug);
  END IF;
  IF v_pending.expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'expired', 'brand_name', v_brand.name, 'brand_slug', v_brand.slug);
  END IF;

  -- Exact normalized equality with a Mingla account's email (never ilike).
  SELECT p.id INTO v_user FROM public.profiles p
  WHERE lower(btrim(p.email)) = v_pending.email
  ORDER BY p.created_at LIMIT 1;
  v_contact := CASE WHEN v_channel = 'email' THEN v_pending.email ELSE v_pending.phone_e164 END;

  INSERT INTO public.consent_records(
    user_id, contact, channel, scope, action, source, disclosure_text, ip_hash,
    brand_id, disclosure_version, brand_attribution
  ) VALUES (
    v_user, v_contact, v_channel, 'marketing', 'granted',
    CASE WHEN v_pending.source = 'site' THEN 'site_subscribe' ELSE 'brand_page_subscribe' END,
    CASE WHEN v_channel = 'sms' THEN COALESCE(v_pending.sms_disclosure_text, v_pending.disclosure_text)
      ELSE v_pending.disclosure_text END,
    v_pending.ip_hash, v_pending.brand_id, v_pending.disclosure_version, 'captured'
  ) RETURNING id INTO v_consent;

  IF v_user IS NOT NULL THEN
    PERFORM public.biz_auto_follow_brand(v_user, v_pending.brand_id,
      CASE WHEN v_pending.source = 'site' THEN 'site_subscribe' ELSE 'web_subscribe' END, NULL);
    INSERT INTO public.brand_follow_channel_prefs(user_id, brand_id, channel, enabled, updated_at)
    VALUES (v_user, v_pending.brand_id, v_channel, true, now())
    ON CONFLICT (user_id, brand_id, channel) DO UPDATE SET enabled = true, updated_at = now();
    v_outcome := 'followed';
  ELSE
    PERFORM public.issue_4111_upsert_newsletter_contact(
      v_pending.brand_id, v_pending.id, CASE WHEN v_channel = 'email' THEN 'email' ELSE 'phone' END,
      v_contact, v_consent, NULL, split_part(v_pending.email, '@', 1));
    v_outcome := 'subscribed';
  END IF;

  UPDATE public.brand_subscribe_pending
  SET email_confirmed_at = CASE WHEN v_channel = 'email' THEN now() ELSE email_confirmed_at END,
      sms_confirmed_at = CASE WHEN v_channel = 'sms' THEN now() ELSE sms_confirmed_at END,
      outcome = COALESCE(outcome, v_outcome)
  WHERE id = v_pending.id;

  RETURN jsonb_build_object('status', 'confirmed', 'channel', v_channel, 'outcome', v_outcome,
    'brand_name', v_brand.name, 'brand_slug', v_brand.slug);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_confirm_subscribe(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_confirm_subscribe(text) TO service_role;

-- Explorer, after email-OTP sign-in: newsletter subscriptions confirmed with
-- this verified email become follows (email channel on).
CREATE OR REPLACE FUNCTION public.claim_brand_subscriptions_for_user()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_brand uuid;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  v_email := public.issue_3720_notification_email(v_user);
  IF v_email IS NULL THEN RETURN 0; END IF;
  FOR v_brand IN
    SELECT DISTINCT p.brand_id FROM public.brand_subscribe_pending p
    JOIN public.brands b ON b.id = p.brand_id AND b.deleted_at IS NULL
    WHERE p.email = v_email AND p.email_confirmed_at IS NOT NULL AND p.outcome = 'subscribed'
      AND NOT EXISTS (SELECT 1 FROM public.brand_follows f WHERE f.user_id = v_user AND f.brand_id = p.brand_id)
  LOOP
    PERFORM public.biz_auto_follow_brand(v_user, v_brand, 'web_subscribe', NULL);
    INSERT INTO public.brand_follow_channel_prefs(user_id, brand_id, channel, enabled, updated_at)
    VALUES (v_user, v_brand, 'email', true, now())
    ON CONFLICT (user_id, brand_id, channel) DO UPDATE SET enabled = true, updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_brand_subscriptions_for_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_brand_subscriptions_for_user() TO authenticated, service_role;

COMMIT;
