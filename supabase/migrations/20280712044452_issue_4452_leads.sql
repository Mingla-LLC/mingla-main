-- Issue #4452 M5 leads (amendment A1): every lead in one list.
--
-- One person is one row (public.leads, unique email_key); every source row is
-- one history entry (public.lead_events, unique source_table + source_id).
-- Database triggers on form_submissions, book_call_leads, tool_leads (web
-- lane), beta_access_leads and explorer_app_leads keep it current, so no
-- writer needs new code; an ingest error never blocks the source write and
-- lead_reconcile() (daily, and as the backfill below) repairs any gap.
--
-- Labels: forms -> lead_label; bookings -> audience; web tools -> host;
-- beta (organiser) -> host; Explorer waitlist -> explorer (Q-A1-1).
-- Consent: forms, bookings and tools carry their own box (Q-A1-2). The beta
-- and Explorer checkbox wording is not a marketing-email agreement that this
-- repo can show, so both map to false (A1.2.2; probe on #4452).
--
-- MINGLA-INVARIANT: I-4452-ONE-LEAD-PER-EMAIL | issue #4452 | leads.email_key is UNIQUE (issue_4452_leads A1-T-2).
-- MINGLA-INVARIANT: I-4452-LEADS-ONE-FILTER | issue #4452 | every lead read goes through leads_filtered_ids (A1-T-6).
-- MINGLA-INVARIANT: I-4452-LEADS-EXPORT-NO-CLICK-IDS | issue #4452 | admin_leads_export reads no ad_match_contexts column (A1-T-8).
--
-- ROLLBACK (manual, never automatic):
--   SELECT cron.unschedule('leads-reconcile');
--   DROP TRIGGER IF EXISTS lead_ingest ON public.form_submissions; DROP TRIGGER IF EXISTS lead_ingest ON public.book_call_leads;
--   DROP TRIGGER IF EXISTS lead_ingest ON public.beta_access_leads; DROP TRIGGER IF EXISTS lead_ingest ON public.explorer_app_leads;
--   DROP TRIGGER IF EXISTS lead_ingest ON public.tool_leads; DROP TRIGGER IF EXISTS lead_forget ON public.tool_leads;
--   DROP FUNCTION IF EXISTS (every function created below);
--   DROP INDEX IF EXISTS public.channel_suppressions_email_key_idx, public.marketing_unsubscribes_email_key_idx,
--     public.admin_email_recipient_deliveries_email_key_idx;
--   DROP TABLE IF EXISTS public.leads_export_log, public.lead_audience_selections, public.lead_ingest_failures,
--     public.lead_events, public.leads;
--   ALTER TABLE public.book_call_leads DROP CONSTRAINT book_call_leads_consent_shape, DROP COLUMN marketing_consent,
--     DROP COLUMN consent_text, DROP COLUMN consent_at;
--   ALTER TABLE public.tool_leads DROP CONSTRAINT tool_leads_consent_shape, DROP COLUMN marketing_consent,
--     DROP COLUMN consent_text, DROP COLUMN consent_at;
-- Data loss: only derived rows and the new consent answers; the source tables stay the record.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_key        text NOT NULL UNIQUE
                   CHECK (email_key = lower(btrim(email_key)) AND length(email_key) <= 254
                          AND email_key ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  name             text CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 120),
  primary_label    text NOT NULL CHECK (primary_label IN ('host','creator','local','explorer')),
  labels           text[] NOT NULL CHECK (cardinality(labels) >= 1 AND labels <@ ARRAY['host','creator','local','explorer']),
  sources          text[] NOT NULL CHECK (cardinality(sources) >= 1 AND sources <@ ARRAY['form','book_a_call','tool','beta']),
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_at       timestamptz,
  consent_event_id uuid,
  is_test          boolean NOT NULL DEFAULT false,
  event_count      integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  first_seen_at    timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL,
  crm_record_id    uuid,
  crm_pipeline     text CHECK (crm_pipeline IS NULL OR crm_pipeline IN ('hosts','creators')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_consent_shape CHECK (marketing_consent = (consent_at IS NOT NULL)),
  CONSTRAINT leads_crm_shape CHECK ((crm_record_id IS NULL) = (crm_pipeline IS NULL)),
  CONSTRAINT leads_seen_order CHECK (first_seen_at <= last_seen_at)
);
CREATE INDEX leads_last_seen_idx ON public.leads (last_seen_at DESC, id DESC);
CREATE INDEX leads_labels_gin ON public.leads USING gin (labels);
CREATE INDEX leads_sources_gin ON public.leads USING gin (sources);

CREATE TABLE public.lead_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('form','book_a_call','tool','beta')),
  source_table     text NOT NULL CHECK (source_table IN
                   ('form_submissions','book_call_leads','tool_leads','beta_access_leads','explorer_app_leads')),
  source_id        uuid NOT NULL,
  label            text NOT NULL CHECK (label IN ('host','creator','local','explorer')),
  form_id          uuid REFERENCES public.forms(id) ON DELETE SET NULL,
  page_path        text CHECK (page_path IS NULL OR (page_path ~ '^/' AND length(page_path) <= 300)),
  utm_source       text CHECK (utm_source IS NULL OR length(utm_source) <= 100),
  utm_medium       text CHECK (utm_medium IS NULL OR length(utm_medium) <= 100),
  utm_campaign     text CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 150),
  click_source     text CHECK (click_source IS NULL OR click_source IN ('meta','google','tiktok','snap','reddit')),
  marketing_consent boolean NOT NULL DEFAULT false,
  is_test          boolean NOT NULL DEFAULT false,
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb
                   CHECK (jsonb_typeof(summary) = 'object'
                          AND NOT (summary ?| ARRAY['email','phone','phone_e164','fbc','fbp','gclid','fbclid',
                                                   'ttclid','ttp','scid','sccid','rdt_cid','click_id',
                                                   'ip_hash','user_agent','referer'])),
  occurred_at      timestamptz NOT NULL,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_events_source_row UNIQUE (source_table, source_id)
);
CREATE INDEX lead_events_lead_idx ON public.lead_events (lead_id, occurred_at DESC);
CREATE INDEX lead_events_form_idx ON public.lead_events (form_id, occurred_at DESC) WHERE form_id IS NOT NULL;
CREATE INDEX lead_events_source_idx ON public.lead_events (source, occurred_at DESC);
CREATE INDEX lead_events_campaign_idx ON public.lead_events (lower(utm_campaign)) WHERE utm_campaign IS NOT NULL;

-- The email-status reads (lead_email_status) match a lead's email_key against
-- three existing tables by lower(btrim(...)). These expression indexes turn each
-- read into an index probe, so the Leads page and its email_status filter stay
-- inside the A1.4 budget however large the send history grows.
CREATE INDEX IF NOT EXISTS channel_suppressions_email_key_idx
  ON public.channel_suppressions (lower(btrim(contact))) WHERE channel = 'email';
CREATE INDEX IF NOT EXISTS marketing_unsubscribes_email_key_idx
  ON public.marketing_unsubscribes (lower(btrim(contact_email)));
CREATE INDEX IF NOT EXISTS admin_email_recipient_deliveries_email_key_idx
  ON public.admin_email_recipient_deliveries (lower(btrim(recipient_email)));

-- Ingest failures: SQLSTATE only, never the message (it can contain an email).
CREATE TABLE public.lead_ingest_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL, source_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('invalid_email','error')),
  sqlstate text CHECK (sqlstate IS NULL OR sqlstate ~ '^[0-9A-Z]{5}$'),
  -- #4452 rework 1 (P3-16): one row per source row; a repeat failure counts up.
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

-- A frozen audience handed from Leads to the Email composer.
CREATE TABLE public.lead_audience_selections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  lead_ids   uuid[] CHECK (lead_ids IS NULL OR cardinality(lead_ids) BETWEEN 1 AND 5000),
  filter     jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  CONSTRAINT lead_audience_one_kind CHECK ((lead_ids IS NULL) <> (filter IS NULL))
);
CREATE INDEX lead_audience_selections_actor_idx ON public.lead_audience_selections (created_by, created_at DESC);

CREATE TABLE public.leads_export_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor uuid NOT NULL, filter jsonb NOT NULL, row_count integer NOT NULL CHECK (row_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_events TO service_role;
ALTER TABLE public.lead_ingest_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_ingest_failures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_ingest_failures TO service_role;
ALTER TABLE public.lead_audience_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_audience_selections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_audience_selections TO service_role;
ALTER TABLE public.leads_export_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads_export_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.leads_export_log TO service_role;

-- Q-A1-2: the optional, unticked "Send me occasional emails" box on Book a call and the tool email step.
ALTER TABLE public.book_call_leads
  ADD COLUMN marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_text text CHECK (consent_text IS NULL OR length(consent_text) <= 300),
  ADD COLUMN consent_at timestamptz,
  ADD CONSTRAINT book_call_leads_consent_shape CHECK (marketing_consent = (consent_at IS NOT NULL));
ALTER TABLE public.tool_leads
  ADD COLUMN marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_text text CHECK (consent_text IS NULL OR length(consent_text) <= 300),
  ADD COLUMN consent_at timestamptz,
  ADD CONSTRAINT tool_leads_consent_shape CHECK (marketing_consent = (consent_at IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 2. Gates
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.leads_can_view() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.forms_can_view() $$;   -- admin, website, crm, beta_leads
CREATE FUNCTION public.leads_can_export() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.is_admin_user() OR COALESCE(public.admin_team_can('crm'), false) $$;
REVOKE ALL ON FUNCTION public.leads_can_view(), public.leads_can_export() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_can_view(), public.leads_can_export() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Ingest
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.lead_recompute(p_lead uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.lead_events WHERE lead_id = p_lead;
  IF v_n = 0 THEN
    DELETE FROM public.leads WHERE id = p_lead;
    RETURN;
  END IF;
  UPDATE public.leads l SET
    labels = x.labels, sources = x.sources, primary_label = x.primary_label,
    name = x.name, event_count = x.n, first_seen_at = x.first_at, last_seen_at = x.last_at,
    marketing_consent = x.consent_event IS NOT NULL, consent_at = x.consent_at, consent_event_id = x.consent_event,
    is_test = public.inbound_lead_is_test(l.email_key, x.name) OR NOT x.has_real,
    updated_at = now()
  FROM (
    SELECT
      (SELECT array_agg(DISTINCT e.label ORDER BY e.label) FROM public.lead_events e WHERE e.lead_id = p_lead) AS labels,
      (SELECT array_agg(DISTINCT e.source ORDER BY e.source) FROM public.lead_events e WHERE e.lead_id = p_lead) AS sources,
      (SELECT e.label FROM public.lead_events e WHERE e.lead_id = p_lead ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS primary_label,
      (SELECT left(btrim(e.summary->>'name'), 120) FROM public.lead_events e
        WHERE e.lead_id = p_lead AND NULLIF(btrim(e.summary->>'name'), '') IS NOT NULL
        ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS name,
      v_n AS n,
      (SELECT min(e.occurred_at) FROM public.lead_events e WHERE e.lead_id = p_lead) AS first_at,
      (SELECT max(e.occurred_at) FROM public.lead_events e WHERE e.lead_id = p_lead) AS last_at,
      (SELECT e.id FROM public.lead_events e WHERE e.lead_id = p_lead AND e.marketing_consent
        ORDER BY e.occurred_at, e.id LIMIT 1) AS consent_event,
      (SELECT e.occurred_at FROM public.lead_events e WHERE e.lead_id = p_lead AND e.marketing_consent
        ORDER BY e.occurred_at, e.id LIMIT 1) AS consent_at,
      EXISTS (SELECT 1 FROM public.lead_events e WHERE e.lead_id = p_lead AND NOT e.is_test) AS has_real
  ) x
  WHERE l.id = p_lead;
END;
$fn$;

-- #4452 rework 1 (P3-16): record an ingest failure once per source row (an upsert
-- with a count), so a row that keeps failing never grows the table each run.
CREATE FUNCTION public.lead_note_failure(p_table text, p_id uuid, p_reason text, p_sqlstate text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.lead_ingest_failures AS f (source_table, source_id, reason, sqlstate)
  VALUES (p_table, p_id, p_reason, p_sqlstate)
  ON CONFLICT (source_table, source_id) DO UPDATE
    SET attempts = f.attempts + 1, reason = EXCLUDED.reason, sqlstate = EXCLUDED.sqlstate, last_failed_at = now()
$$;

-- p: {source, source_table, source_id, email, label, form_id, page_path, utm_source, utm_medium,
--     utm_campaign, click_source, marketing_consent, is_test, summary, occurred_at}
CREATE FUNCTION public.lead_upsert_event(p jsonb) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_key   text := lower(btrim(COALESCE(p->>'email', '')));
  v_lead  uuid;
  v_old   uuid;
  v_at    timestamptz := COALESCE((p->>'occurred_at')::timestamptz, now());
BEGIN
  -- 1. An email the leads list cannot hold is recorded, never guessed at.
  IF v_key = '' OR length(v_key) > 254 OR v_key !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    PERFORM public.lead_note_failure(p->>'source_table', (p->>'source_id')::uuid, 'invalid_email', NULL);
    RETURN NULL;
  END IF;
  -- 2. One writer per person at a time.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lead:' || v_key, 0));
  -- 3. One lead per email.
  INSERT INTO public.leads (email_key, primary_label, labels, sources, first_seen_at, last_seen_at)
  VALUES (v_key, p->>'label', ARRAY[p->>'label'], ARRAY[p->>'source'], v_at, v_at)
  ON CONFLICT (email_key) DO NOTHING;
  SELECT id INTO v_lead FROM public.leads WHERE email_key = v_key;
  -- 4. One event per source row; consent only goes false -> true.
  SELECT lead_id INTO v_old FROM public.lead_events
   WHERE source_table = p->>'source_table' AND source_id = (p->>'source_id')::uuid;
  INSERT INTO public.lead_events (lead_id, source, source_table, source_id, label, form_id, page_path,
    utm_source, utm_medium, utm_campaign, click_source, marketing_consent, is_test, summary, occurred_at)
  VALUES (v_lead, p->>'source', p->>'source_table', (p->>'source_id')::uuid, p->>'label',
    NULLIF(p->>'form_id', '')::uuid, left(p->>'page_path', 300), left(p->>'utm_source', 100), left(p->>'utm_medium', 100),
    left(p->>'utm_campaign', 150), p->>'click_source', COALESCE(p->'marketing_consent' = 'true'::jsonb, false),
    COALESCE(p->'is_test' = 'true'::jsonb, false), COALESCE(jsonb_strip_nulls(p->'summary'), '{}'::jsonb), v_at)
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id, label = EXCLUDED.label, form_id = EXCLUDED.form_id, page_path = EXCLUDED.page_path,
    utm_source = EXCLUDED.utm_source, utm_medium = EXCLUDED.utm_medium, utm_campaign = EXCLUDED.utm_campaign,
    click_source = EXCLUDED.click_source,
    marketing_consent = public.lead_events.marketing_consent OR EXCLUDED.marketing_consent,
    is_test = EXCLUDED.is_test, summary = EXCLUDED.summary, occurred_at = EXCLUDED.occurred_at;
  -- 5. Recompute (and the old lead when the source row's email changed).
  PERFORM public.lead_recompute(v_lead);
  IF v_old IS NOT NULL AND v_old <> v_lead THEN PERFORM public.lead_recompute(v_old); END IF;
  RETURN v_lead;
END;
$fn$;

-- Erasure of a source row is real: its event goes, and an empty lead goes too.
CREATE FUNCTION public.lead_forget(p_table text, p_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_lead uuid;
BEGIN
  DELETE FROM public.lead_events WHERE source_table = p_table AND source_id = p_id RETURNING lead_id INTO v_lead;
  IF v_lead IS NOT NULL THEN PERFORM public.lead_recompute(v_lead); END IF;
END;
$fn$;

-- Static dispatch: one CASE per source table, the A1.2.2 mapping.
CREATE FUNCTION public.lead_ingest(p_table text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_s  public.form_submissions;
  v_k  public.book_call_leads;
  v_t  public.tool_leads;
  v_b  public.beta_access_leads;
  v_e  public.explorer_app_leads;
  v_form text;
BEGIN
  CASE p_table
    WHEN 'form_submissions' THEN
      SELECT * INTO v_s FROM public.form_submissions WHERE id = p_id;
      IF NOT FOUND THEN PERFORM public.lead_forget(p_table, p_id); RETURN NULL; END IF;
      SELECT name INTO v_form FROM public.forms WHERE id = v_s.form_id;
      RETURN public.lead_upsert_event(jsonb_build_object(
        'source', 'form', 'source_table', p_table, 'source_id', v_s.id, 'email', v_s.email, 'label', v_s.lead_label,
        'form_id', v_s.form_id, 'page_path', v_s.page_path, 'utm_source', v_s.utm_source, 'utm_medium', v_s.utm_medium,
        'utm_campaign', v_s.utm_campaign, 'click_source', v_s.click_source, 'marketing_consent', v_s.marketing_consent,
        'is_test', v_s.is_test, 'occurred_at', v_s.created_at,
        'summary', jsonb_build_object('name', v_s.name, 'form_name', v_form, 'spot_key', v_s.spot_key,
                                      'placement', v_s.placement, 'resubmit_count', v_s.resubmit_count)));
    WHEN 'book_call_leads' THEN
      SELECT * INTO v_k FROM public.book_call_leads WHERE id = p_id;
      IF NOT FOUND THEN PERFORM public.lead_forget(p_table, p_id); RETURN NULL; END IF;
      RETURN public.lead_upsert_event(jsonb_build_object(
        'source', 'book_a_call', 'source_table', p_table, 'source_id', v_k.id, 'email', v_k.email, 'label', v_k.audience,
        'form_id', (SELECT s.form_id FROM public.form_submissions s WHERE s.id = v_k.form_submission_id),
        'page_path', CASE v_k.audience WHEN 'creator' THEN '/schedule/creators' WHEN 'local' THEN '/schedule/locals' ELSE '/schedule' END,
        'utm_source', v_k.utm_source, 'utm_medium', v_k.utm_medium, 'utm_campaign', v_k.utm_campaign,
        'click_source', v_k.click_source, 'marketing_consent', v_k.marketing_consent,
        'is_test', public.inbound_lead_is_test(v_k.email, COALESCE(NULLIF(btrim(v_k.venue), ''), v_k.name)),
        'occurred_at', v_k.created_at,
        'summary', jsonb_build_object('name', v_k.name, 'business', v_k.venue, 'city', v_k.city, 'icp', v_k.icp,
                                      'call_at', v_k.call_at, 'status', v_k.status)));
    WHEN 'tool_leads' THEN
      SELECT * INTO v_t FROM public.tool_leads WHERE id = p_id;
      IF NOT FOUND OR v_t.lane IS DISTINCT FROM 'web' OR NULLIF(btrim(v_t.email), '') IS NULL THEN
        PERFORM public.lead_forget(p_table, p_id); RETURN NULL;
      END IF;
      RETURN public.lead_upsert_event(jsonb_build_object(
        'source', 'tool', 'source_table', p_table, 'source_id', v_t.id, 'email', v_t.email, 'label', 'host',
        'page_path', CASE v_t.tool WHEN 'venues' THEN '/tools/venues' WHEN 'events' THEN '/tools/events'
                                   WHEN 'trips' THEN '/tools/trips' WHEN 'experiences' THEN '/tools/pricing' ELSE NULL END,
        'utm_source', CASE WHEN jsonb_typeof(v_t.utm) = 'object' THEN v_t.utm->>'utm_source' END,
        'utm_medium', CASE WHEN jsonb_typeof(v_t.utm) = 'object' THEN v_t.utm->>'utm_medium' END,
        'utm_campaign', CASE WHEN jsonb_typeof(v_t.utm) = 'object' THEN v_t.utm->>'utm_campaign' END,
        'marketing_consent', v_t.marketing_consent,
        'is_test', public.inbound_lead_is_test(v_t.email, v_t.input->>'name'),
        'occurred_at', v_t.created_at,
        'summary', jsonb_build_object('business', v_t.input->>'name', 'city', v_t.input->>'city',
                                      'tool', v_t.tool, 'status', v_t.status)));
    WHEN 'beta_access_leads' THEN
      SELECT * INTO v_b FROM public.beta_access_leads WHERE id = p_id;
      IF NOT FOUND THEN PERFORM public.lead_forget(p_table, p_id); RETURN NULL; END IF;
      RETURN public.lead_upsert_event(jsonb_build_object(
        'source', 'beta', 'source_table', p_table, 'source_id', v_b.id, 'email', v_b.email, 'label', 'host',
        'marketing_consent', false,   -- the beta box is not shown to be a marketing-email agreement (probe on #4452)
        'is_test', public.inbound_lead_is_test(v_b.email, v_b.brand_name),
        'occurred_at', v_b.created_at,
        'summary', jsonb_build_object('name', v_b.contact_name, 'business', v_b.brand_name, 'city', v_b.city,
                                      'sub_source', v_b.source)));
    WHEN 'explorer_app_leads' THEN
      SELECT * INTO v_e FROM public.explorer_app_leads WHERE id = p_id;
      IF NOT FOUND THEN PERFORM public.lead_forget(p_table, p_id); RETURN NULL; END IF;
      RETURN public.lead_upsert_event(jsonb_build_object(
        'source', 'beta', 'source_table', p_table, 'source_id', v_e.id, 'email', v_e.email, 'label', 'explorer',
        'marketing_consent', false,   -- same rule as beta
        'is_test', public.inbound_lead_is_test(v_e.email, v_e.name),
        'occurred_at', v_e.created_at,
        'summary', jsonb_build_object('name', v_e.name, 'city', v_e.city, 'interest', to_jsonb(v_e.interest),
                                      'platform', v_e.platform, 'sub_source', 'explorer_app')));
    ELSE
      RAISE EXCEPTION 'unknown_source_table' USING ERRCODE = '22023';
  END CASE;
END;
$fn$;

-- One trigger function for every source table. An ingest error never blocks the source write.
CREATE FUNCTION public.lead_ingest_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      PERFORM public.lead_forget(TG_TABLE_NAME, v_id);
    ELSE
      PERFORM public.lead_ingest(TG_TABLE_NAME, v_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.lead_note_failure(TG_TABLE_NAME, v_id, 'error', SQLSTATE);
  END;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER lead_ingest AFTER INSERT OR UPDATE OR DELETE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lead_ingest_trigger();
CREATE TRIGGER lead_ingest AFTER INSERT OR UPDATE OR DELETE ON public.book_call_leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_ingest_trigger();
CREATE TRIGGER lead_ingest AFTER INSERT OR UPDATE OR DELETE ON public.beta_access_leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_ingest_trigger();
CREATE TRIGGER lead_ingest AFTER INSERT OR UPDATE OR DELETE ON public.explorer_app_leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_ingest_trigger();
CREATE TRIGGER lead_ingest AFTER INSERT OR UPDATE OF email, marketing_consent ON public.tool_leads
  FOR EACH ROW WHEN (NEW.lane = 'web') EXECUTE FUNCTION public.lead_ingest_trigger();
CREATE TRIGGER lead_forget AFTER DELETE ON public.tool_leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_ingest_trigger();

-- Ingest every source row that has no event yet (one anti-join per table), then clear repaired failures.
-- #4452 rework 1 (P2-10): each row is its own subtransaction. A row whose ingest
-- keeps failing is recorded in lead_ingest_failures and the run moves on, so one
-- bad row never stops the repair (or the M5 backfill) for everyone else.
CREATE FUNCTION public.lead_reconcile() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n integer := 0;
  v_t text;
  v_id uuid;
BEGIN
  FOR v_t, v_id IN
      SELECT 'form_submissions'::text, s.id FROM public.form_submissions s WHERE NOT EXISTS
        (SELECT 1 FROM public.lead_events e WHERE e.source_table = 'form_submissions' AND e.source_id = s.id)
      UNION ALL
      SELECT 'book_call_leads', k.id FROM public.book_call_leads k WHERE NOT EXISTS
        (SELECT 1 FROM public.lead_events e WHERE e.source_table = 'book_call_leads' AND e.source_id = k.id)
      UNION ALL
      SELECT 'tool_leads', t.id FROM public.tool_leads t WHERE t.lane = 'web' AND t.email IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM public.lead_events e WHERE e.source_table = 'tool_leads' AND e.source_id = t.id)
      UNION ALL
      SELECT 'beta_access_leads', b.id FROM public.beta_access_leads b WHERE NOT EXISTS
        (SELECT 1 FROM public.lead_events e WHERE e.source_table = 'beta_access_leads' AND e.source_id = b.id)
      UNION ALL
      SELECT 'explorer_app_leads', x.id FROM public.explorer_app_leads x WHERE NOT EXISTS
        (SELECT 1 FROM public.lead_events e WHERE e.source_table = 'explorer_app_leads' AND e.source_id = x.id)
  LOOP
    BEGIN
      IF public.lead_ingest(v_t, v_id) IS NOT NULL THEN v_n := v_n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.lead_note_failure(v_t, v_id, 'error', SQLSTATE);
    END;
  END LOOP;
  DELETE FROM public.lead_ingest_failures f
   WHERE EXISTS (SELECT 1 FROM public.lead_events e WHERE e.source_table = f.source_table AND e.source_id = f.source_id);
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.lead_recompute(uuid), public.lead_upsert_event(jsonb), public.lead_forget(text, uuid),
  public.lead_ingest(text, uuid), public.lead_ingest_trigger(), public.lead_reconcile(),
  public.lead_note_failure(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recompute(uuid), public.lead_upsert_event(jsonb), public.lead_forget(text, uuid),
  public.lead_ingest(text, uuid), public.lead_reconcile() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Filter, status, list, drawer
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.leads_filter_normalize(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_k text;
  v_v jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN v_out; END IF;
  IF jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023'; END IF;
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p) LOOP
    CONTINUE WHEN jsonb_typeof(v_v) = 'null';
    CASE v_k
      WHEN 'q' THEN
        IF jsonb_typeof(v_v) <> 'string' OR length(btrim(v_v #>> '{}')) NOT BETWEEN 1 AND 80 THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object('q', lower(btrim(v_v #>> '{}')));
      WHEN 'labels', 'sources' THEN
        IF jsonb_typeof(v_v) <> 'array' OR jsonb_array_length(v_v) = 0 OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_v) x WHERE jsonb_typeof(x) <> 'string'
                OR (v_k = 'labels' AND x #>> '{}' NOT IN ('host','creator','local','explorer'))
                OR (v_k = 'sources' AND x #>> '{}' NOT IN ('form','book_a_call','tool','beta'))) THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object(v_k, (SELECT jsonb_agg(DISTINCT x ORDER BY x) FROM jsonb_array_elements(v_v) x));
      WHEN 'form_id' THEN
        IF jsonb_typeof(v_v) <> 'string' OR (v_v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object('form_id', v_v);
      WHEN 'page_path' THEN
        IF jsonb_typeof(v_v) <> 'string' OR (v_v #>> '{}') !~ '^/' OR length(v_v #>> '{}') > 300 THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object('page_path', v_v);
      WHEN 'utm_source', 'utm_campaign' THEN
        IF jsonb_typeof(v_v) <> 'string' OR length(btrim(v_v #>> '{}')) NOT BETWEEN 1 AND 150 THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object(v_k, lower(btrim(v_v #>> '{}')));
      WHEN 'click_source' THEN
        IF jsonb_typeof(v_v) <> 'string' OR (v_v #>> '{}') NOT IN ('meta','google','tiktok','snap','reddit') THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object('click_source', v_v);
      WHEN 'from', 'to' THEN
        IF jsonb_typeof(v_v) <> 'string' OR NOT public.forms_real_date(v_v #>> '{}') THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object(v_k, v_v);
      WHEN 'consent', 'in_pipeline' THEN
        IF jsonb_typeof(v_v) <> 'string' OR (v_v #>> '{}') NOT IN ('yes','no') THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object(v_k, v_v);
      WHEN 'email_status' THEN
        IF jsonb_typeof(v_v) <> 'string'
           OR (v_v #>> '{}') NOT IN ('unsubscribed','follow_ups_active','follow_ups_stopped','emailed','never_emailed') THEN
          RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
        END IF;
        v_out := v_out || jsonb_build_object('email_status', v_v);
      WHEN 'show_test' THEN
        IF jsonb_typeof(v_v) <> 'boolean' THEN RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023'; END IF;
        IF v_v = 'true'::jsonb THEN v_out := v_out || '{"show_test":true}'::jsonb; END IF;
      ELSE
        RAISE EXCEPTION 'bad_filter' USING ERRCODE = '22023';
    END CASE;
  END LOOP;
  RETURN v_out;
END;
$fn$;

CREATE FUNCTION public.lead_email_status(p_email_key text, p_lead uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.channel_suppressions c
                  WHERE lower(btrim(c.contact)) = p_email_key AND c.channel = 'email' AND c.scope IN ('marketing','all'))
      OR EXISTS (SELECT 1 FROM public.marketing_unsubscribes u WHERE lower(btrim(u.contact_email)) = p_email_key)
      THEN 'unsubscribed'
    WHEN EXISTS (SELECT 1 FROM public.lead_events e JOIN public.form_automation_runs r ON r.submission_id = e.source_id
                  WHERE e.lead_id = p_lead AND e.source_table = 'form_submissions' AND r.status = 'active'
                    AND EXISTS (SELECT 1 FROM public.form_automation_sends s WHERE s.run_id = r.id AND s.status = 'scheduled'))
      THEN 'follow_ups_active'
    WHEN EXISTS (SELECT 1 FROM public.lead_events e JOIN public.form_automation_runs r ON r.submission_id = e.source_id
                  WHERE e.lead_id = p_lead AND e.source_table = 'form_submissions' AND r.status = 'stopped')
      THEN 'follow_ups_stopped'
    WHEN EXISTS (SELECT 1 FROM public.lead_events e JOIN public.form_automation_runs r ON r.submission_id = e.source_id
                  JOIN public.form_automation_sends s ON s.run_id = r.id
                  WHERE e.lead_id = p_lead AND e.source_table = 'form_submissions' AND s.status = 'sent')
      OR EXISTS (SELECT 1 FROM public.admin_email_recipient_deliveries d
                  WHERE lower(btrim(d.recipient_email)) = p_email_key AND d.accepted_at IS NOT NULL)
      THEN 'emailed'
    ELSE 'never_emailed' END
$$;

-- The same rule as lead_email_status, for every lead at once: each membership
-- test is an uncorrelated IN (a hashed subplan, read once), so the email_status
-- filter costs one pass instead of one function call per lead. The two must
-- agree for every lead (issue_4452_leads, A1 email-status parity).
CREATE FUNCTION public.leads_email_status_all() RETURNS TABLE(lead_id uuid, email_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT l.id, CASE
    WHEN l.email_key IN (SELECT lower(btrim(c.contact)) FROM public.channel_suppressions c
                          WHERE c.channel = 'email' AND c.scope IN ('marketing','all') AND c.contact IS NOT NULL)
      OR l.email_key IN (SELECT lower(btrim(u.contact_email)) FROM public.marketing_unsubscribes u WHERE u.contact_email IS NOT NULL)
      THEN 'unsubscribed'
    WHEN l.id IN (SELECT e.lead_id FROM public.lead_events e JOIN public.form_automation_runs r ON r.submission_id = e.source_id
                   WHERE e.source_table = 'form_submissions' AND r.status = 'active'
                     AND EXISTS (SELECT 1 FROM public.form_automation_sends s WHERE s.run_id = r.id AND s.status = 'scheduled'))
      THEN 'follow_ups_active'
    WHEN l.id IN (SELECT e.lead_id FROM public.lead_events e JOIN public.form_automation_runs r ON r.submission_id = e.source_id
                   WHERE e.source_table = 'form_submissions' AND r.status = 'stopped')
      THEN 'follow_ups_stopped'
    WHEN l.id IN (SELECT e.lead_id FROM public.lead_events e JOIN public.form_automation_runs r ON r.submission_id = e.source_id
                   JOIN public.form_automation_sends s ON s.run_id = r.id
                   WHERE e.source_table = 'form_submissions' AND s.status = 'sent')
      OR l.email_key IN (SELECT lower(btrim(d.recipient_email)) FROM public.admin_email_recipient_deliveries d
                          WHERE d.accepted_at IS NOT NULL AND d.recipient_email IS NOT NULL)
      THEN 'emailed'
    ELSE 'never_emailed' END
  FROM public.leads l
$$;

-- The ONLY place a filter is applied (I-4452-LEADS-ONE-FILTER). Event-level
-- keys combine on the same event.
--
-- leads_filter_scan walks the leads and their events ONCE and answers, per
-- lead: does it match the filter (hit); would it match with test leads shown
-- (hit_with_test); and, for the facet chips, would it match with the label
-- (or source) dimension replaced by each single value. The list, its total,
-- its facets and test_hidden all read this one scan, so a page costs one pass
-- over lead_events instead of eleven (A1.4 budget: p95 <= 300 ms at 20k/60k).
-- leads_filtered_ids is the hit column of the same scan, so every other reader
-- (selection, audience, export) still applies the identical predicates.
CREATE FUNCTION public.leads_filter_scan(p_f jsonb)
RETURNS TABLE(lead_id uuid, last_seen_at timestamptz, hit boolean, hit_with_test boolean,
              fl_host boolean, fl_creator boolean, fl_local boolean, fl_explorer boolean,
              fs_form boolean, fs_book_a_call boolean, fs_tool boolean, fs_beta boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  f jsonb := public.leads_filter_normalize(p_f);
  v_test boolean := COALESCE(f->'show_test' = 'true'::jsonb, false);
  v_ev boolean := f ?| ARRAY['labels','sources','form_id','page_path','utm_source','utm_campaign','click_source','from','to'];
  v_q text := CASE WHEN f ? 'q' THEN '%' || replace(replace(replace(f->>'q', '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  v_labels text[] := CASE WHEN f ? 'labels' THEN ARRAY(SELECT jsonb_array_elements_text(f->'labels')) END;
  v_sources text[] := CASE WHEN f ? 'sources' THEN ARRAY(SELECT jsonb_array_elements_text(f->'sources')) END;
  v_form uuid := (f->>'form_id')::uuid;
  v_from timestamptz := CASE WHEN f ? 'from' THEN (f->>'from')::date::timestamp AT TIME ZONE 'UTC' END;
  v_to timestamptz := CASE WHEN f ? 'to' THEN ((f->>'to')::date + 1)::timestamp AT TIME ZONE 'UTC' END;
BEGIN
  RETURN QUERY
  SELECT l.id, l.last_seen_at,
         (v_test OR NOT l.is_test) AND (NOT v_ev OR COALESCE(bool_or(m.c AND m.pl AND m.ps AND m.t), false)),
         (NOT v_ev OR COALESCE(bool_or(m.c AND m.pl AND m.ps), false)),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.ps AND m.t AND m.label = 'host'), false),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.ps AND m.t AND m.label = 'creator'), false),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.ps AND m.t AND m.label = 'local'), false),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.ps AND m.t AND m.label = 'explorer'), false),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.pl AND m.t AND m.source = 'form'), false),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.pl AND m.t AND m.source = 'book_a_call'), false),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.pl AND m.t AND m.source = 'tool'), false),
         (v_test OR NOT l.is_test) AND COALESCE(bool_or(m.c AND m.pl AND m.t AND m.source = 'beta'), false)
    FROM public.leads l
    LEFT JOIN (
      SELECT e.lead_id, e.label, e.source,
             (v_test OR NOT e.is_test) AS t,
             (v_labels IS NULL OR e.label = ANY (v_labels)) AS pl,
             (v_sources IS NULL OR e.source = ANY (v_sources)) AS ps,
             ((v_form IS NULL OR e.form_id = v_form)
              AND (NOT (f ? 'page_path') OR e.page_path = f->>'page_path')
              AND (NOT (f ? 'utm_source') OR lower(e.utm_source) = f->>'utm_source')
              AND (NOT (f ? 'utm_campaign') OR lower(e.utm_campaign) = f->>'utm_campaign')
              AND (NOT (f ? 'click_source') OR e.click_source = f->>'click_source')
              AND (v_from IS NULL OR e.occurred_at >= v_from)
              AND (v_to IS NULL OR e.occurred_at < v_to)) AS c
        FROM public.lead_events e
    ) m ON m.lead_id = l.id
   WHERE (v_q IS NULL OR l.email_key LIKE v_q ESCAPE '\' OR lower(COALESCE(l.name, '')) LIKE v_q ESCAPE '\')
     AND (NOT (f ? 'consent') OR l.marketing_consent = (f->>'consent' = 'yes'))
     AND (NOT (f ? 'in_pipeline') OR (l.crm_record_id IS NOT NULL) = (f->>'in_pipeline' = 'yes'))
     AND (NOT (f ? 'email_status')
          OR l.id IN (SELECT st.lead_id FROM public.leads_email_status_all() st WHERE st.email_status = f->>'email_status'))
   GROUP BY l.id;
END;
$fn$;

CREATE FUNCTION public.leads_filtered_ids(p_f jsonb) RETURNS TABLE(lead_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.lead_id FROM public.leads_filter_scan(p_f) s WHERE s.hit
$$;

CREATE FUNCTION public.lead_crm_json(p_record uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', r.id, 'pipeline', r.pipeline, 'name', r.name, 'stage', r.stage)
    FROM public.crm_records r WHERE r.id = p_record AND r.deleted_at IS NULL
$$;

CREATE FUNCTION public.admin_leads_list(p_filter jsonb DEFAULT '{}'::jsonb, p_after jsonb DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  f jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_after_at timestamptz;
  v_after_id uuid;
  v_rows jsonb;
  v_next jsonb;
  v_total bigint;
  v_with_test bigint;
  v_flabels jsonb;
  v_fsources jsonb;
BEGIN
  IF NOT public.leads_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  f := public.leads_filter_normalize(p_filter);
  IF p_after IS NOT NULL AND jsonb_typeof(p_after) <> 'null' THEN
    BEGIN
      v_after_at := (p_after->>'last_seen_at')::timestamptz;
      v_after_id := (p_after->>'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'bad_cursor' USING ERRCODE = '22023';
    END;
    IF v_after_at IS NULL OR v_after_id IS NULL THEN RAISE EXCEPTION 'bad_cursor' USING ERRCODE = '22023'; END IF;
  END IF;

  -- One scan answers the page, the total, the facets and test_hidden (A1.4 budget).
  WITH s AS MATERIALIZED (
    SELECT * FROM public.leads_filter_scan(f)
  ), page AS (
    SELECT l.* FROM s JOIN public.leads l ON l.id = s.lead_id
     WHERE s.hit
       AND (v_after_at IS NULL OR (s.last_seen_at, s.lead_id) < (v_after_at, v_after_id))
     ORDER BY s.last_seen_at DESC, s.lead_id DESC
     LIMIT v_limit + 1
  ), numbered AS (
    SELECT p.*, row_number() OVER (ORDER BY p.last_seen_at DESC, p.id DESC) AS rn FROM page p
  ), counts AS (
    SELECT count(*) FILTER (WHERE s.hit) AS total,
           count(*) FILTER (WHERE s.hit_with_test) AS with_test,
           jsonb_build_object('host', count(*) FILTER (WHERE s.fl_host), 'creator', count(*) FILTER (WHERE s.fl_creator),
                              'local', count(*) FILTER (WHERE s.fl_local), 'explorer', count(*) FILTER (WHERE s.fl_explorer)) AS labels,
           jsonb_build_object('form', count(*) FILTER (WHERE s.fs_form), 'book_a_call', count(*) FILTER (WHERE s.fs_book_a_call),
                              'tool', count(*) FILTER (WHERE s.fs_tool), 'beta', count(*) FILTER (WHERE s.fs_beta)) AS sources
      FROM s
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'name', n.name, 'email', n.email_key, 'primary_label', n.primary_label, 'labels', to_jsonb(n.labels),
      'sources', to_jsonb(n.sources), 'event_count', n.event_count, 'first_seen_at', n.first_seen_at,
      'last_seen_at', n.last_seen_at,
      'latest', (SELECT jsonb_build_object('source', e.source, 'label', e.label, 'form_id', e.form_id,
                        'form_name', (SELECT fo.name FROM public.forms fo WHERE fo.id = e.form_id),
                        'page_path', e.page_path, 'spot_key', e.summary->>'spot_key', 'utm_source', e.utm_source,
                        'utm_campaign', e.utm_campaign, 'occurred_at', e.occurred_at)
                   FROM public.lead_events e WHERE e.lead_id = n.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1),
      'marketing_consent', n.marketing_consent,
      'email_status', public.lead_email_status(n.email_key, n.id),
      'crm', CASE WHEN n.crm_record_id IS NULL THEN NULL ELSE public.lead_crm_json(n.crm_record_id) END,
      'is_test', n.is_test) ORDER BY n.last_seen_at DESC, n.id DESC) FROM numbered n WHERE n.rn <= v_limit), '[]'::jsonb),
    (SELECT jsonb_build_object('last_seen_at', m.last_seen_at, 'id', m.id) FROM numbered m
      WHERE m.rn = v_limit AND (SELECT count(*) FROM numbered) > v_limit),
    c.total, c.with_test, c.labels, c.sources
  INTO v_rows, v_next, v_total, v_with_test, v_flabels, v_fsources
  FROM counts c;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'next', v_next,
    'total', v_total,
    'facets', jsonb_build_object('labels', v_flabels, 'sources', v_fsources),
    'test_hidden', CASE WHEN f ? 'show_test' THEN 0 ELSE v_with_test - v_total END,
    'can', jsonb_build_object('email', public.leads_can_view(), 'export', public.leads_can_export(),
                              'add_to_pipeline', public.is_admin_user() OR COALESCE(public.admin_team_can('crm'), false)),
    'as_of', now());
END;
$fn$;

CREATE FUNCTION public.admin_lead_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_l public.leads;
BEGIN
  IF NOT public.leads_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_l FROM public.leads WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'lead', jsonb_build_object('id', v_l.id, 'email', v_l.email_key, 'name', v_l.name, 'primary_label', v_l.primary_label,
                               'labels', to_jsonb(v_l.labels), 'sources', to_jsonb(v_l.sources),
                               'marketing_consent', v_l.marketing_consent, 'consent_at', v_l.consent_at,
                               'consent_source', (SELECT e.source FROM public.lead_events e WHERE e.id = v_l.consent_event_id),
                               'is_test', v_l.is_test, 'first_seen_at', v_l.first_seen_at, 'last_seen_at', v_l.last_seen_at,
                               'email_status', public.lead_email_status(v_l.email_key, v_l.id)),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'source', e.source, 'source_table', e.source_table, 'source_id', e.source_id, 'label', e.label,
        'form_id', e.form_id, 'page_path', e.page_path, 'utm_source', e.utm_source, 'utm_campaign', e.utm_campaign,
        'marketing_consent', e.marketing_consent, 'is_test', e.is_test, 'summary', e.summary, 'occurred_at', e.occurred_at,
        -- The ad line: the platform only, never a click id.
        'ad', CASE
          WHEN e.source_table = 'form_submissions' THEN (SELECT CASE WHEN NOT s.ads_allowed THEN 'ads_off'
                                                                   WHEN s.click_source IS NOT NULL THEN s.click_source || '_click' ELSE 'none' END
                                                              FROM public.form_submissions s WHERE s.id = e.source_id)
          WHEN e.click_source IS NOT NULL THEN e.click_source || '_click' ELSE 'none' END,
        'answers', CASE WHEN e.source_table = 'form_submissions' THEN (
          SELECT jsonb_build_object(
            'values', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', fd->>'key', 'label', fd->>'label', 'type', fd->>'type',
                                                                      'value', s.answers->(fd->>'key'))
                                                   ORDER BY o)
                                  FROM jsonb_array_elements(v.definition->'fields') WITH ORDINALITY t(fd, o)
                                 WHERE s.answers ? (fd->>'key') AND fd->>'type' <> 'consent'), '[]'::jsonb),
            'phone', s.phone_e164, 'time_zone', s.time_zone, 'placement', s.placement, 'spot', s.spot_key,
            'routing_status', s.routing_status, 'resubmit_count', s.resubmit_count, 'version', v.version,
            'run', (SELECT jsonb_build_object('id', r.id, 'status', r.status, 'stop_reason', r.stop_reason,
                                              'time_zone', r.time_zone, 'time_zone_source', r.time_zone_source)
                      FROM public.form_automation_runs r WHERE r.submission_id = s.id))
            FROM public.form_submissions s JOIN public.form_versions v ON v.id = s.form_version_id WHERE s.id = e.source_id) END,
        'booking', CASE WHEN e.source_table = 'book_call_leads' THEN (
          SELECT jsonb_build_object('audience', k.audience, 'icp', k.icp, 'city', k.city, 'call_at', k.call_at,
                                    'original_call_at', k.original_call_at, 'status_changed_at', k.status_changed_at,
                                    'status', k.status, 'social_url', k.social_url, 'website', k.website,
                                    'phone', k.phone_e164, 'meet_url', k.meet_url, 'creator_makes', k.creator_makes,
                                    'first_place', k.first_place)
            FROM public.book_call_leads k WHERE k.id = e.source_id) END)
      ORDER BY e.occurred_at DESC, e.id DESC) FROM public.lead_events e WHERE e.lead_id = v_l.id), '[]'::jsonb),
    'emails', jsonb_build_object(
      'campaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object('subject', c.subject, 'status', d.status,
                                                                 'at', COALESCE(d.accepted_at, d.last_attempt_at, d.created_at))
                                               ORDER BY d.created_at DESC)
                               FROM public.admin_email_recipient_deliveries d JOIN public.admin_email_log c ON c.id = d.campaign_id
                              WHERE lower(btrim(d.recipient_email)) = v_l.email_key), '[]'::jsonb),
      'automation', COALESCE((SELECT jsonb_agg(jsonb_build_object('send_id', s.id, 'step_id', s.step_id, 'kind', s.email_kind,
                                                                  'status', s.status, 'skip_reason', s.skip_reason,
                                                                  'due_at', s.due_at, 'sent_at', s.sent_at,
                                                                  'opened', s.opened_at IS NOT NULL, 'clicked', s.clicked_at IS NOT NULL,
                                                                  'error', s.last_error, 'submission_id', r.submission_id)
                                                ORDER BY s.created_at)
                                FROM public.lead_events e JOIN public.form_automation_runs r ON r.submission_id = e.source_id
                                JOIN public.form_automation_sends s ON s.run_id = r.id
                               WHERE e.lead_id = v_l.id AND e.source_table = 'form_submissions'
                                 AND s.email_kind <> 'team_alert'), '[]'::jsonb)),
    'crm', CASE WHEN v_l.crm_record_id IS NULL THEN NULL ELSE public.lead_crm_json(v_l.crm_record_id) END,
    'can', jsonb_build_object('email', true, 'export', public.leads_can_export(),
                              'add_to_pipeline', public.is_admin_user() OR COALESCE(public.admin_team_can('crm'), false),
                              'stop_emails', public.forms_can_edit()));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Email audience hand-off (A1.5)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.leads_selection_ids(p_selection_id uuid) RETURNS TABLE(lead_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_s public.lead_audience_selections;
BEGIN
  SELECT * INTO v_s FROM public.lead_audience_selections WHERE id = p_selection_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_s.lead_ids IS NOT NULL THEN
    RETURN QUERY SELECT l.id FROM public.leads l WHERE l.id = ANY (v_s.lead_ids);
  ELSE
    RETURN QUERY SELECT x.lead_id FROM public.leads_filtered_ids(v_s.filter) x;
  END IF;
END;
$fn$;

-- The one count both the Leads banner and the composer estimate read (A1-SC-21).
CREATE FUNCTION public.leads_audience_counts(p_selection_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH sel AS (
    SELECT l.id, l.is_test, l.marketing_consent, public.lead_email_status(l.email_key, l.id) = 'unsubscribed' AS unsub
      FROM public.leads l WHERE l.id IN (SELECT s.lead_id FROM public.leads_selection_ids(p_selection_id) s)
  )
  SELECT jsonb_build_object(
    'selection_id', p_selection_id,
    'selected', (SELECT count(*) FROM sel),
    'test', (SELECT count(*) FROM sel WHERE is_test),
    'unsubscribed', (SELECT count(*) FROM sel WHERE NOT is_test AND unsub),
    'no_consent', (SELECT count(*) FROM sel WHERE NOT is_test AND NOT unsub AND NOT marketing_consent),
    'marketable', (SELECT count(*) FROM sel WHERE NOT is_test AND NOT unsub AND marketing_consent))
$$;

CREATE FUNCTION public.admin_lead_selection_create(p_lead_ids uuid[] DEFAULT NULL, p_filter jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.leads_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF (p_lead_ids IS NULL) = (p_filter IS NULL) THEN RAISE EXCEPTION 'one_of_ids_or_filter' USING ERRCODE = '22023'; END IF;
  IF p_lead_ids IS NOT NULL AND cardinality(p_lead_ids) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'bad_selection' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lead_selection:' || v_actor, 0));
  IF (SELECT count(*) FROM public.lead_audience_selections
       WHERE created_by = v_actor AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'selection_limit' USING ERRCODE = 'PT429';
  END IF;
  INSERT INTO public.lead_audience_selections (created_by, lead_ids, filter)
  VALUES (v_actor, (SELECT array_agg(DISTINCT x) FROM unnest(p_lead_ids) x),
          CASE WHEN p_filter IS NULL THEN NULL ELSE public.leads_filter_normalize(p_filter) END)
  RETURNING id INTO v_id;
  RETURN public.leads_audience_counts(v_id);
END;
$fn$;

-- Service role only: the recipients behind a selection, for admin-send-email.
CREATE FUNCTION public.leads_audience_resolve(p_selection_id uuid, p_actor uuid)
RETURNS TABLE(lead_id uuid, email text, display_name text, first_name text, marketing_consent text, is_internal boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lead_audience_selections s
                  WHERE s.id = p_selection_id AND s.created_by = p_actor AND s.expires_at > now()) THEN
    RAISE EXCEPTION 'selection_expired' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT l.id, l.email_key, l.name, NULLIF(split_part(COALESCE(l.name, ''), ' ', 1), ''),
         CASE WHEN public.lead_email_status(l.email_key, l.id) = 'unsubscribed' THEN 'unsubscribed'
              WHEN l.marketing_consent THEN 'yes' ELSE 'no' END,
         l.is_test
    FROM public.leads l WHERE l.id IN (SELECT x.lead_id FROM public.leads_selection_ids(p_selection_id) x)
   ORDER BY l.last_seen_at DESC, l.id DESC;
END;
$fn$;

-- One lead for a one-to-one reply (service role only).
CREATE FUNCTION public.lead_reply_recipient(p_lead uuid)
RETURNS TABLE(lead_id uuid, email text, display_name text, first_name text, marketing_consent text, is_internal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT l.id, l.email_key, l.name, NULLIF(split_part(COALESCE(l.name, ''), ' ', 1), ''),
         CASE WHEN l.marketing_consent THEN 'yes' ELSE 'no' END, l.is_test
    FROM public.leads l WHERE l.id = p_lead
$$;

-- ---------------------------------------------------------------------------
-- 6. Export (A1.7) and linking a card (A1.3)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_leads_export(p_filter jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  f jsonb;
  v_n integer;
  v_fields jsonb := '[]'::jsonb;
  v_rows jsonb;
BEGIN
  IF NOT public.leads_can_export() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  f := public.leads_filter_normalize(p_filter);
  SELECT count(*) INTO v_n FROM public.leads_filtered_ids(f);
  IF v_n > 10000 THEN RAISE EXCEPTION 'export_too_large' USING ERRCODE = '22023'; END IF;
  IF f ? 'form_id' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('key', fd->>'key', 'label', fd->>'label') ORDER BY o), '[]'::jsonb)
      INTO v_fields
      FROM public.forms fo JOIN public.form_versions v ON v.id = fo.live_version_id,
           jsonb_array_elements(v.definition->'fields') WITH ORDINALITY t(fd, o)
     WHERE fo.id = (f->>'form_id')::uuid AND fd->>'type' NOT IN ('consent','phone','email','name');
  END IF;
  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'last_seen_at') DESC, r->>'lead_id' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'lead_id', l.id, 'email', l.email_key, 'name', l.name, 'primary_label', l.primary_label,
      'labels', array_to_string(l.labels, '|'), 'sources', array_to_string(l.sources, '|'),
      'first_seen_at', l.first_seen_at, 'last_seen_at', l.last_seen_at, 'event_count', l.event_count,
      'marketing_consent', l.marketing_consent, 'consent_at', l.consent_at,
      'email_status', public.lead_email_status(l.email_key, l.id), 'crm_pipeline', l.crm_pipeline,
      'latest_form', (SELECT fo.name FROM public.forms fo WHERE fo.id = le.form_id),
      'latest_page', le.page_path, 'latest_spot', le.summary->>'spot_key',
      'utm_source', le.utm_source, 'utm_medium', le.utm_medium, 'utm_campaign', le.utm_campaign,
      'click_source', le.click_source,
      'answers', CASE WHEN f ? 'form_id' THEN (
        SELECT jsonb_object_agg(x->>'key', s.answers->(x->>'key'))
          FROM jsonb_array_elements(v_fields) x,
               LATERAL (SELECT sub.answers FROM public.form_submissions sub
                         WHERE sub.form_id = (f->>'form_id')::uuid AND sub.email = l.email_key
                         ORDER BY sub.created_at DESC LIMIT 1) s) END) AS r
      FROM public.leads l
      LEFT JOIN LATERAL (SELECT e.* FROM public.lead_events e WHERE e.lead_id = l.id
                          ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) le ON true
     WHERE l.id IN (SELECT x.lead_id FROM public.leads_filtered_ids(f) x)) q;
  INSERT INTO public.leads_export_log (actor, filter, row_count)
  VALUES (auth.uid(), CASE WHEN f ? 'q' THEN jsonb_set(f, '{q}', '"[search]"') ELSE f END, v_n);
  RETURN jsonb_build_object('columns', jsonb_build_array('lead_id','email','name','primary_label','labels','sources',
      'first_seen_at','last_seen_at','event_count','marketing_consent','consent_at','email_status','crm_pipeline',
      'latest_form','latest_page','latest_spot','utm_source','utm_medium','utm_campaign','click_source'),
    'answer_fields', v_fields, 'rows', v_rows, 'row_count', v_n);
END;
$fn$;

CREATE FUNCTION public.admin_lead_link_crm(p_lead_id uuid, p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_l public.leads;
  v_pipe text;
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(public.admin_team_can('crm'), false)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT pipeline INTO v_pipe FROM public.crm_records WHERE id = p_record_id AND deleted_at IS NULL;
  IF v_pipe IS NULL OR v_pipe NOT IN ('hosts','creators') THEN RAISE EXCEPTION 'record_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_l FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_l.crm_record_id IS NOT NULL AND v_l.crm_record_id <> p_record_id THEN
    RAISE EXCEPTION 'lead_already_linked' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.leads SET crm_record_id = p_record_id, crm_pipeline = v_pipe, updated_at = now() WHERE id = p_lead_id;
  RETURN jsonb_build_object('crm', public.lead_crm_json(p_record_id));
END;
$fn$;

REVOKE ALL ON FUNCTION public.leads_filter_normalize(jsonb), public.lead_email_status(text, uuid),
  public.leads_email_status_all(), public.leads_filter_scan(jsonb), public.leads_filtered_ids(jsonb), public.lead_crm_json(uuid), public.leads_selection_ids(uuid),
  public.leads_audience_counts(uuid), public.leads_audience_resolve(uuid, uuid), public.lead_reply_recipient(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_filter_normalize(jsonb), public.lead_email_status(text, uuid),
  public.leads_email_status_all(), public.leads_filter_scan(jsonb), public.leads_filtered_ids(jsonb), public.lead_crm_json(uuid), public.leads_selection_ids(uuid),
  public.leads_audience_counts(uuid), public.leads_audience_resolve(uuid, uuid), public.lead_reply_recipient(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.admin_leads_list(jsonb, jsonb, integer), public.admin_lead_get(uuid),
  public.admin_lead_selection_create(uuid[], jsonb), public.admin_leads_export(jsonb), public.admin_lead_link_crm(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_leads_list(jsonb, jsonb, integer), public.admin_lead_get(uuid),
  public.admin_lead_selection_create(uuid[], jsonb), public.admin_leads_export(jsonb), public.admin_lead_link_crm(uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Backfill (the same mapping, no second code path) and CRM links carried over
-- ---------------------------------------------------------------------------
SELECT public.lead_reconcile();

-- Beta rows: through crm_records.beta_lead_id.
UPDATE public.leads l SET crm_record_id = x.record_id, crm_pipeline = 'hosts', updated_at = now()
  FROM (SELECT DISTINCT ON (e.lead_id) e.lead_id, r.id AS record_id
          FROM public.lead_events e JOIN public.crm_records r
            ON r.beta_lead_id = e.source_id AND r.pipeline = 'hosts' AND r.deleted_at IS NULL
         WHERE e.source_table = 'beta_access_leads'
         ORDER BY e.lead_id, e.occurred_at DESC) x
 WHERE l.id = x.lead_id AND l.crm_record_id IS NULL;
-- Host bookings and web tool rows: the admin_inbound_leads name match, only when exactly one live host card matches.
UPDATE public.leads l SET crm_record_id = x.record_id, crm_pipeline = 'hosts', updated_at = now()
  FROM (SELECT m.lead_id, min(m.record_id::text)::uuid AS record_id
          FROM (SELECT e.lead_id, r.id AS record_id
                  FROM public.lead_events e
                  JOIN public.book_call_leads k ON e.source_table = 'book_call_leads' AND k.id = e.source_id AND k.audience = 'host'
                  JOIN public.crm_records r ON r.pipeline = 'hosts' AND r.deleted_at IS NULL
                   AND r.name_key = public.crm_name_key(COALESCE(NULLIF(btrim(k.venue), ''), k.name))
                UNION
                SELECT e.lead_id, r.id
                  FROM public.lead_events e
                  JOIN public.tool_leads t ON e.source_table = 'tool_leads' AND t.id = e.source_id
                  JOIN public.crm_records r ON r.pipeline = 'hosts' AND r.deleted_at IS NULL
                   AND NULLIF(btrim(t.input->>'name'), '') IS NOT NULL
                   AND r.name_key = public.crm_name_key(t.input->>'name')) m
         GROUP BY m.lead_id HAVING count(DISTINCT m.record_id) = 1) x
 WHERE l.id = x.lead_id AND l.crm_record_id IS NULL;

-- Daily repair at 03:20 UTC (pure SQL job).
DO $cron$
DECLARE
  v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '#4452: pg_cron unavailable; leads-reconcile not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'leads-reconcile';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('leads-reconcile', '20 3 * * *', $job$SELECT public.lead_reconcile()$job$);
END;
$cron$;

COMMIT;
