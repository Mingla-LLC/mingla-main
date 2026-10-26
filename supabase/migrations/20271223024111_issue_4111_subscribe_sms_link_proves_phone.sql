-- #4111 tester fix — a subscribe TEXT link proves the phone, not the email.
--
-- issue_4111_confirm_subscribe (20271222004111) looked up a Mingla account by
-- the pending row's email for BOTH links. The email was typed by whoever filled
-- the form and is only proven by the email link. Proven on the pg17 replay:
-- typing someone else's account email with your own mobile and tapping the
-- text link made that account follow the brand with texts switched on, and
-- wrote a marketing consent row in that account's name.
--
-- Now the text link never touches an account: it records the proven phone in
-- the brand's contact book (marketing consent for that phone only). The email
-- link is unchanged: an account email follows with email on; any other email
-- joins the contact book. Same body as 20271222004111 except the two lines
-- marked "#4111 tester fix".
--
-- INVARIANT: {"id":"I-4111-SUBSCRIBE-SMS-LINK-NO-ACCOUNT","rule":"Confirming a subscribe text link never follows, enables a channel for, or records consent under a Mingla account; only the email link can."}

BEGIN;

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
    AND v_channel = 'email' -- #4111 tester fix: only the email link proves the email
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
      v_contact, v_consent, NULL,
      CASE WHEN v_channel = 'email' THEN split_part(v_pending.email, '@', 1) END); -- #4111 tester fix: no name from an unproven email
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

COMMIT;
