-- #4111 tester fix (P1-2) — "Email confirmed" must be earned from the inbox.
--
-- Before: public-brand-enquiry answered 202 with the SAME token it emailed, and
-- the first valid GET of /m/{token} set guest_email_confirmed_at. Anyone could
-- type someone else's address, follow the 202 link in their own browser and
-- show the brand "Email confirmed".
--
-- After: every access token has a kind.
--   email    — only ever sent to the guest's inbox (receipt, reply digest,
--              "Email me a new link"). The ONLY kind that confirms the email.
--   browser  — returned to the browser that sent the enquiry, so "View
--              conversation" works at once. It can read and post, never confirm.
-- Existing rows were all emailed links, so they default to 'email'.
--
-- INVARIANT: {"id":"I-4111-ONLY-EMAILED-TOKEN-CONFIRMS","rule":"guest_email_confirmed_at is set only by a valid read of an access token of kind 'email'; a 'browser' token never confirms."}

BEGIN;

ALTER TABLE public.brand_enquiry_access_tokens
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'email';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brand_enquiry_access_tokens_kind_check'
      AND conrelid = 'public.brand_enquiry_access_tokens'::regclass
  ) THEN
    ALTER TABLE public.brand_enquiry_access_tokens
      ADD CONSTRAINT brand_enquiry_access_tokens_kind_check CHECK (kind IN ('email', 'browser'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.brand_enquiry_access_tokens.kind IS
  '#4111: email = a link sent to the guest inbox (confirms the email on first read); browser = the 202 link for the sending browser (reads and posts, never confirms).';

-- create_web_enquiry gains the browser token as a trailing, defaulted
-- parameter (old 18-argument callers keep working), stores the emailed token
-- as kind 'email' and the browser token as kind 'browser'.
DROP FUNCTION IF EXISTS public.issue_4111_create_web_enquiry(uuid,text,text,text,text,uuid,text,text,text,text,text,boolean,text,boolean,text[],text,text,text);
CREATE OR REPLACE FUNCTION public.issue_4111_create_web_enquiry(
  p_brand_id uuid,
  p_source text,
  p_origin text,
  p_entry text,
  p_context_kind text,
  p_context_id uuid,
  p_reason text,
  p_body text,
  p_name text,
  p_email text,
  p_phone text,
  p_ok_to_call boolean,
  p_ip_hash text,
  p_spam_flag boolean,
  p_moderation_categories text[],
  p_token_hash text,
  p_disclosure_text text,
  p_disclosure_version text,
  p_browser_token_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_kind text := COALESCE(NULLIF(btrim(p_context_kind), ''), 'none');
  v_hash text;
  v_facts jsonb;
  v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_source NOT IN ('web','site') OR v_kind NOT IN ('offering','venue','none')
     OR ((v_kind = 'none') <> (p_context_id IS NULL))
     OR p_entry NOT IN ('brand_page','offering','cancel_page','site')
     OR (p_entry = 'site' AND p_source <> 'site')
     OR (p_source = 'site' AND NULLIF(btrim(COALESCE(p_origin,'')),'') IS NULL)
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF NOT public.issue_4111_brand_takes_enquiries(p_brand_id) THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;
  v_hash := public.issue_4111_email_hash(v_email);
  IF public.issue_4111_is_blocked(p_brand_id, v_hash, NULL, p_ip_hash) THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  IF public.issue_4111_enquiry_rate_limited(p_brand_id, v_hash, p_ip_hash) THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;
  v_facts := public.issue_4111_context_facts(p_brand_id, v_kind, p_context_id, NULL);
  IF v_facts IS NULL THEN RETURN jsonb_build_object('status', 'invalid_context'); END IF;

  BEGIN
    v_result := public.issue_4111_open_enquiry(
      p_brand_id, p_source, p_origin, p_entry, v_kind, p_context_id, v_facts->>'offering_kind',
      p_reason, p_body, NULL, p_name, v_email, p_phone, p_ok_to_call, false,
      p_spam_flag, p_moderation_categories, p_disclosure_text, p_disclosure_version, p_ip_hash
    );
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23514' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END;

  -- The emailed token (receipt link): the only kind that confirms the email.
  INSERT INTO public.brand_enquiry_access_tokens(token_hash, enquiry_id, expires_at, kind)
  VALUES (p_token_hash, (v_result->>'enquiry_id')::uuid, now() + interval '90 days', 'email');
  -- The sending browser's token (the 202's thread_url): reads and posts only.
  IF p_browser_token_hash IS NOT NULL AND p_browser_token_hash ~ '^[0-9a-f]{64}$'
     AND p_browser_token_hash <> p_token_hash THEN
    INSERT INTO public.brand_enquiry_access_tokens(token_hash, enquiry_id, expires_at, kind)
    VALUES (p_browser_token_hash, (v_result->>'enquiry_id')::uuid, now() + interval '90 days', 'browser')
    ON CONFLICT (token_hash) DO NOTHING;
  END IF;

  RETURN v_result || jsonb_build_object('status', 'created');
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_create_web_enquiry(uuid,text,text,text,text,uuid,text,text,text,text,text,boolean,text,boolean,text[],text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_create_web_enquiry(uuid,text,text,text,text,uuid,text,text,text,text,text,boolean,text,boolean,text[],text,text,text,text)
  TO service_role;

-- Same contract as before, except only an emailed token confirms the email.
-- {status:'ok', thread} | {status:'expired', enquiry_id} | {status:'invalid'}
CREATE OR REPLACE FUNCTION public.issue_4111_thread_by_token(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enquiry uuid;
  v_kind text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  BEGIN
    v_enquiry := public.issue_4111_token_enquiry(p_token_hash);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('status', 'expired',
      'enquiry_id', (SELECT enquiry_id FROM public.brand_enquiry_access_tokens WHERE token_hash = p_token_hash));
  END;
  IF v_enquiry IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  SELECT kind INTO v_kind FROM public.brand_enquiry_access_tokens WHERE token_hash = p_token_hash;
  IF v_kind = 'email' THEN
    UPDATE public.brand_enquiries
    SET guest_email_confirmed_at = now(), updated_at = now()
    WHERE id = v_enquiry AND guest_email_confirmed_at IS NULL;
  END IF;
  RETURN jsonb_build_object('status', 'ok') || public.issue_4111_thread_json(v_enquiry, 'guest', 200);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_thread_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_thread_by_token(text) TO service_role;

COMMIT;
