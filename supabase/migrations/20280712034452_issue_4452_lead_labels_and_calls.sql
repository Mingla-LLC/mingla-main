-- Issue #4452 M4 lead_labels_and_calls (spec Part 2 §1.4, Part 4 §4; A1.2.3).
--
--   1. book_call_leads gains phone, UTM, click source, the form link and the
--      lead/goal event ids (11 columns). Old rows keep NULLs; nothing back-fills.
--   2. ad_conversions accepts event_type 'call_booked' and carries lead_label
--      (host | creator | local). Old lead rows stay NULL (read as host).
--   3. admin_google_conversion_kinds(): which Google conversion kinds have an
--      action of their own (ready true/false only; never a resource name).
--
-- A1.2.3: admin_inbound_leads is NOT changed here (the Leads list replaces it).
--
-- ROLLBACK (manual, after M5):
--   DROP FUNCTION IF EXISTS public.admin_google_conversion_kinds();
--   ALTER TABLE public.ad_conversions DROP COLUMN IF EXISTS lead_label;
--   ALTER TABLE public.ad_conversions DROP CONSTRAINT IF EXISTS ad_conversions_event_type_check;
--   ALTER TABLE public.ad_conversions ADD CONSTRAINT ad_conversions_event_type_check
--     CHECK (event_type IN ('purchase','reservation','lead','view','host_signup','host_first_publish','host_first_sale'));
--   DROP INDEX IF EXISTS public.idx_book_call_leads_email_lower, public.idx_book_call_leads_form_submission;
--   REVOKE UPDATE (lead_event_id, goal_event_id) ON public.book_call_leads FROM service_role;
--   ALTER TABLE public.book_call_leads DROP COLUMN phone_e164, DROP COLUMN utm_source, DROP COLUMN utm_medium,
--     DROP COLUMN utm_campaign, DROP COLUMN utm_content, DROP COLUMN utm_term, DROP COLUMN utm_id,
--     DROP COLUMN click_source, DROP COLUMN form_submission_id, DROP COLUMN lead_event_id, DROP COLUMN goal_event_id;

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.book_call_leads
  ADD COLUMN phone_e164 text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  ADD COLUMN utm_source text CHECK (utm_source IS NULL OR length(utm_source) <= 100),
  ADD COLUMN utm_medium text CHECK (utm_medium IS NULL OR length(utm_medium) <= 100),
  ADD COLUMN utm_campaign text CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 150),
  ADD COLUMN utm_content text CHECK (utm_content IS NULL OR length(utm_content) <= 150),
  ADD COLUMN utm_term text CHECK (utm_term IS NULL OR length(utm_term) <= 150),
  ADD COLUMN utm_id text CHECK (utm_id IS NULL OR length(utm_id) <= 100),
  ADD COLUMN click_source text CHECK (click_source IS NULL OR click_source IN ('meta','google','tiktok','snap','reddit')),
  ADD COLUMN form_submission_id uuid REFERENCES public.form_submissions(id) ON DELETE SET NULL,
  ADD COLUMN lead_event_id text CHECK (lead_event_id IS NULL OR length(lead_event_id) <= 120),
  ADD COLUMN goal_event_id text CHECK (goal_event_id IS NULL OR length(goal_event_id) <= 120);
CREATE INDEX idx_book_call_leads_email_lower ON public.book_call_leads (lower(email), created_at DESC);
CREATE INDEX idx_book_call_leads_form_submission ON public.book_call_leads (form_submission_id) WHERE form_submission_id IS NOT NULL;
-- growth-tools-book records the two event ids after the conversions fire (the row id is the subject).
GRANT UPDATE (lead_event_id, goal_event_id) ON public.book_call_leads TO service_role;
COMMENT ON COLUMN public.book_call_leads.form_submission_id IS
  '#4452: the form submission this in-form booking came from (same email, within 7 days); NULL for a direct /schedule booking.';
COMMENT ON COLUMN public.book_call_leads.goal_event_id IS
  '#4452: the <label>_call:<booking id> event id of the call_booked conversion.';

ALTER TABLE public.ad_conversions DROP CONSTRAINT IF EXISTS ad_conversions_event_type_check;
ALTER TABLE public.ad_conversions ADD CONSTRAINT ad_conversions_event_type_check
  CHECK (event_type IN ('purchase','reservation','lead','view',
                        'host_signup','host_first_publish','host_first_sale','call_booked'));
ALTER TABLE public.ad_conversions
  ADD COLUMN lead_label text CHECK (lead_label IS NULL OR lead_label IN ('host','creator','local'));
COMMENT ON COLUMN public.ad_conversions.lead_label IS
  '#4452: the label a Lead or call_booked row carries (host | creator | local). NULL on rows from before #4452 (all host).';

-- §7.8 the Ads setup card: kind -> {ready}. No resource names or ids.
CREATE FUNCTION public.admin_google_conversion_kinds() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_actions jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT CASE WHEN jsonb_typeof(c.extra->'conversion_actions') = 'object' THEN c.extra->'conversion_actions' ELSE '{}'::jsonb END
    INTO v_actions
    FROM public.ad_connections c WHERE c.platform = 'google' AND c.lane = 'consumer' LIMIT 1;
  RETURN jsonb_build_object(
    'connected', v_actions IS NOT NULL,
    'kinds', (SELECT jsonb_object_agg(k, jsonb_build_object('ready',
                COALESCE(jsonb_typeof(v_actions->k) = 'string' AND length(v_actions->>k) > 0, false)))
              FROM unnest(ARRAY['host_lead','creator_lead','local_lead','host_call_booked','creator_call_booked','local_call_booked']) k));
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_google_conversion_kinds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_google_conversion_kinds() TO authenticated, service_role;

COMMIT;
