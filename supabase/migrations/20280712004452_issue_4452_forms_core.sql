-- Issue #4452 M1 forms_core (spec Part 2 §1.1, §1.9; amendment A1.2.3).
-- Staff build forms in Admin; visitors' answers land in form_submissions.
--
--   1. The Website editor role ('website': areas role_home, website) and the
--      forms_can_edit() / forms_can_view() gates.
--   2. forms, form_versions (immutable), form_page_slugs (history, never
--      reused), form_submissions, form_submission_keys (idempotency side
--      table), forms_submit_attempts (salted IP hash only), form_owner_rotation.
--   3. forms_validate_definition / forms_validate_answers: the SQL mirror of
--      supabase/functions/_shared/formsContract.ts (R-1…R-26, same codes).
--   4. The admin_form_* RPCs and the service-role forms_submit_core (24 h
--      same-email dedupe under an advisory lock) and forms_route_submission
--      (A1: a pipeline card only when routing.card.on).
--
-- Every table: RLS on, no client policies, service_role only. Every function:
-- SECURITY DEFINER SET search_path = '' with REVOKE … FROM PUBLIC, anon.
-- Static SQL only (#1860 C7). Conflicts raise PT409.
--
-- ROLLBACK (manual, after M5 → M4 → M3 → M2 are rolled back; revoke every
-- 'website' member first):
--   DROP FUNCTION IF EXISTS public.forms_route_submission(uuid), public.forms_submit_core(jsonb),
--     public.forms_set_lead_event(uuid,text), public.admin_form_mark_tested(uuid),
--     public.admin_form_publish(uuid,integer), public.admin_form_unarchive(uuid),
--     public.admin_form_archive(uuid), public.admin_form_duplicate(uuid),
--     public.admin_form_save_draft(uuid,integer,jsonb), public.admin_form_create(text,text,text),
--     public.admin_form_get(uuid), public.forms_template_fields(text,text),
--     public.forms_default_definition(text,text), public.forms_validate_answers(jsonb,jsonb,date),
--     public.forms_validate_definition(jsonb), public.forms_text_ok(jsonb,integer,integer),
--     public.forms_clean_text(text,boolean), public.forms_can_view(), public.forms_can_edit();
--   DROP TABLE IF EXISTS public.form_owner_rotation, public.forms_submit_attempts,
--     public.form_submission_keys, public.form_submissions, public.form_page_slugs;
--   ALTER TABLE public.forms DROP CONSTRAINT forms_live_version_fk;
--   DROP TABLE IF EXISTS public.form_versions, public.forms;
--   DROP FUNCTION IF EXISTS public.forms_versions_immutable();
--   Restore admin_team_role_areas, admin_team_set_member and the two role
--   checks from 20280322004255_issue_4255_admin_access_email_drafts.sql.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. The Website editor role
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_team_members DROP CONSTRAINT admin_team_members_role_check;
ALTER TABLE public.admin_team_members ADD CONSTRAINT admin_team_members_role_check
  CHECK (role IN ('growth','partner','website'));
-- Inviting a website editor stores the role on the invitation too.
ALTER TABLE public.admin_team_invites DROP CONSTRAINT admin_team_invites_role_check;
ALTER TABLE public.admin_team_invites ADD CONSTRAINT admin_team_invites_role_check
  CHECK (role IN ('admin','growth','partner','website'));

CREATE OR REPLACE FUNCTION public.admin_team_role_areas(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p_role
    WHEN 'owner'   THEN ARRAY['admin_console','team_manage','crm','beta_leads','email_drafts','website']
    WHEN 'admin'   THEN ARRAY['admin_console','team_manage','crm','beta_leads','email_drafts','website']
    WHEN 'partner' THEN ARRAY['admin_console','team_manage','crm','beta_leads','email_drafts','website']
    WHEN 'growth'  THEN ARRAY['role_home','crm','beta_leads','email_drafts']
    WHEN 'website' THEN ARRAY['role_home','website']
    ELSE ARRAY[]::text[]
  END
$$;
COMMENT ON FUNCTION public.admin_team_role_areas(text) IS
  'Issue #3802, #4255, #4452. The one role-to-areas map. admin_console is held only by roles that live in admin_users (owner, admin, partner), so it stays equivalent to is_admin_user(). #4452 appends website (Website editor). Element order is pinned by tests.';

-- admin_team_set_member: the body from 20280322004255 with only the #4452
-- change: 'website' is an assignable role. Like growth, it lives in
-- admin_team_members (the ELSE branch).
CREATE OR REPLACE FUNCTION public.admin_team_set_member(p_email text, p_role text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor         text;
  v_email         text;
  v_prev_role     text;
  v_prev_status   text;
  v_prev_accepted timestamptz;
  v_accepted      timestamptz;
  v_action        text;
  v_previous      jsonb;
BEGIN
  -- Gate FIRST. #4255 (D4): the owner, admins and partners (team_manage) may
  -- add people, change a role or remove access. Never the owner, never themselves.
  IF NOT COALESCE(public.admin_team_can('team_manage'), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_email := lower(btrim(COALESCE(p_email, '')));
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin','growth','partner','website') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';       -- 'owner' can never be assigned
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('invited','active','revoked') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  IF v_email = v_actor THEN
    RAISE EXCEPTION 'cannot_change_self' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_team:' || v_email, 0));

  IF EXISTS (SELECT 1 FROM public.admin_users au
             WHERE lower(btrim(au.email)) = v_email AND au.role = 'owner') THEN
    RAISE EXCEPTION 'cannot_change_owner' USING ERRCODE = '42501';
  END IF;

  -- Current membership: the non-revoked row wins.
  SELECT x.r, x.s, x.aa INTO v_prev_role, v_prev_status, v_prev_accepted
  FROM (
    SELECT CASE WHEN au.role = 'partner' THEN 'partner' ELSE 'admin' END AS r,
           au.status AS s, au.accepted_at AS aa, au.created_at AS ca
    FROM public.admin_users au WHERE lower(btrim(au.email)) = v_email
    UNION ALL
    SELECT m.role, m.status, m.accepted_at, m.created_at
    FROM public.admin_team_members m WHERE m.email = v_email
  ) x
  ORDER BY (x.s <> 'revoked') DESC, x.aa DESC NULLS LAST, x.ca DESC
  LIMIT 1;

  v_previous := CASE WHEN v_prev_status IS NULL THEN NULL
                     ELSE jsonb_build_object('role', v_prev_role, 'status', v_prev_status) END;

  -- Removing someone who has no access: nothing to do.
  IF p_status = 'revoked' AND (v_prev_status IS NULL OR v_prev_status = 'revoked') THEN
    IF v_prev_status IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('email', v_email, 'role', v_prev_role, 'status', 'revoked',
                              'changed', false, 'previous', v_previous);
  END IF;

  -- A repeated request changes nothing.
  IF p_status <> 'revoked' AND v_prev_role = p_role AND v_prev_status = p_status THEN
    RETURN jsonb_build_object('email', v_email, 'role', p_role, 'status', p_status,
                              'changed', false, 'previous', v_previous);
  END IF;

  -- 'active' may only RESTORE someone who activated themselves before. The owner can
  -- never activate a mailbox whose holder has not signed in.
  IF p_status = 'active' AND v_prev_accepted IS NULL THEN
    RAISE EXCEPTION 'never_activated' USING ERRCODE = '22023';
  END IF;

  -- Any change to a person's membership ends their outstanding invitation.
  DELETE FROM public.admin_team_invites i WHERE i.email = v_email;

  v_accepted := CASE WHEN p_status = 'invited' THEN NULL ELSE v_prev_accepted END;

  IF p_status = 'revoked' THEN
    UPDATE public.admin_users
       SET status = 'revoked'
     WHERE lower(btrim(email)) = v_email AND status <> 'revoked';
    UPDATE public.admin_team_members
       SET status = 'revoked', updated_at = now()
     WHERE email = v_email AND status <> 'revoked';
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team_agent_key:' || v_email, 0));
    UPDATE public.team_agent_keys
       SET revoked_at = now(), revoked_by = v_actor, revoke_reason = 'access_removed'
     WHERE owner_email = v_email AND revoked_at IS NULL;
    UPDATE public.team_agent_setup_codes
       SET voided_at = now()
     WHERE owner_email = v_email AND consumed_at IS NULL AND voided_at IS NULL;
    v_action := 'team.remove';

  ELSIF p_role IN ('admin', 'partner') THEN
    -- Full admin seat (#4255: partner too): leave the non-admin table first
    -- (exclusivity guard), then admin_users.
    UPDATE public.admin_team_members
       SET status = 'revoked', updated_at = now()
     WHERE email = v_email AND status <> 'revoked';
    UPDATE public.admin_users
       SET role = p_role, status = p_status, accepted_at = v_accepted,
           invited_by = CASE WHEN p_status = 'invited' THEN v_actor ELSE invited_by END
     WHERE lower(btrim(email)) = v_email;
    IF NOT FOUND THEN
      INSERT INTO public.admin_users (email, role, status, invited_by, accepted_at)
      VALUES (v_email, p_role, p_status, v_actor, v_accepted);
    END IF;

  ELSE
    -- growth and (#4452) website: leave admin_users first (revoke, never
    -- delete: other records point at admin_users rows), then the team table.
    UPDATE public.admin_users
       SET status = 'revoked'
     WHERE lower(btrim(email)) = v_email AND status <> 'revoked';
    UPDATE public.admin_team_members
       SET role = p_role, status = p_status, accepted_at = v_accepted, updated_at = now(),
           invited_by = CASE WHEN p_status = 'invited' THEN v_actor ELSE invited_by END
     WHERE email = v_email;
    IF NOT FOUND THEN
      INSERT INTO public.admin_team_members (email, role, status, invited_by, accepted_at)
      VALUES (v_email, p_role, p_status, v_actor, v_accepted);
    END IF;
  END IF;

  IF v_action IS NULL THEN
    v_action := CASE
      WHEN v_prev_status IS NULL OR v_prev_status = 'revoked'
        THEN CASE WHEN p_status = 'invited' THEN 'team.invite' ELSE 'team.restore' END
      WHEN v_prev_role IS DISTINCT FROM p_role THEN 'team.role_change'
      ELSE 'team.status_change'
    END;
  END IF;

  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
  VALUES (v_actor, v_action, 'team_member', v_email,
          jsonb_build_object('before', v_previous,
                             'after', jsonb_build_object('role', p_role, 'status', p_status)));

  RETURN jsonb_build_object(
    'email', v_email,
    'role', CASE WHEN p_status = 'revoked' THEN v_prev_role ELSE p_role END,
    'status', p_status, 'changed', true, 'previous', v_previous);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Gates
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.forms_can_edit() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.is_admin_user() OR COALESCE(public.admin_team_can('website'), false) $$;

CREATE FUNCTION public.forms_can_view() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.forms_can_edit()
          OR COALESCE(public.admin_team_can('crm'), false)
          OR COALESCE(public.admin_team_can('beta_leads'), false) $$;
REVOKE ALL ON FUNCTION public.forms_can_edit(), public.forms_can_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_can_edit(), public.forms_can_view() TO authenticated, service_role;
COMMENT ON FUNCTION public.forms_can_edit() IS '#4452: full admins, partners and the Website editor role may edit forms and pages.';
COMMENT ON FUNCTION public.forms_can_view() IS '#4452: editors plus anyone with the crm or beta_leads area may view forms and submissions.';

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.forms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  audience        text NOT NULL CHECK (audience IN ('host','creator','local')),
  -- 'tool' is the system follow-up form of a free tool (Part 5 §6.9).
  template        text CHECK (template IN ('creators','locals','book_call_extra','tool')),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','archived')),
  draft           jsonb NOT NULL,
  draft_rev       integer NOT NULL DEFAULT 1 CHECK (draft_rev >= 1),
  live_version_id uuid,
  tested_at       timestamptz,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  CONSTRAINT forms_live_has_version CHECK (status <> 'live' OR live_version_id IS NOT NULL),
  CONSTRAINT forms_archived_at CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.forms FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.forms TO service_role;
CREATE INDEX forms_status_idx ON public.forms (status, updated_at DESC);
COMMENT ON TABLE public.forms IS '#4452: one row per staff-built form. The draft is a FormDefinition (formsContract.ts). RLS on, no policies: Admin reaches it through the admin_form_* RPCs only.';

CREATE TABLE public.form_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       uuid NOT NULL REFERENCES public.forms(id) ON DELETE RESTRICT,
  version       integer NOT NULL CHECK (version >= 1),
  definition    jsonb NOT NULL,
  definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[0-9a-f]{64}$'),
  published_by  uuid NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);
ALTER TABLE public.form_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.form_versions TO service_role;
ALTER TABLE public.forms ADD CONSTRAINT forms_live_version_fk
  FOREIGN KEY (live_version_id) REFERENCES public.form_versions(id) ON DELETE RESTRICT;

CREATE FUNCTION public.forms_versions_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'form_version_immutable' USING ERRCODE = '42501'; END $$;
REVOKE ALL ON FUNCTION public.forms_versions_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER form_versions_no_update BEFORE UPDATE OR DELETE ON public.form_versions
  FOR EACH ROW EXECUTE FUNCTION public.forms_versions_immutable();

-- A live version must belong to its own form (a forged id from another form is refused).
CREATE FUNCTION public.forms_live_version_same_form() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.live_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.form_versions v WHERE v.id = NEW.live_version_id AND v.form_id = NEW.id) THEN
    RAISE EXCEPTION 'live_version_other_form' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.forms_live_version_same_form() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER forms_live_version_same_form BEFORE INSERT OR UPDATE OF live_version_id ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.forms_live_version_same_form();

CREATE TABLE public.form_page_slugs (
  slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'),
  form_id    uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT form_page_slugs_retired CHECK (is_current = (retired_at IS NULL))
);
CREATE UNIQUE INDEX form_page_slugs_one_current ON public.form_page_slugs (form_id) WHERE is_current;
ALTER TABLE public.form_page_slugs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_page_slugs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.form_page_slugs TO service_role;

CREATE TABLE public.form_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id          uuid NOT NULL REFERENCES public.forms(id) ON DELETE RESTRICT,
  form_version_id  uuid NOT NULL REFERENCES public.form_versions(id) ON DELETE RESTRICT,
  lead_label       text NOT NULL CHECK (lead_label IN ('host','creator','local')),
  idempotency_key  uuid NOT NULL UNIQUE,
  email            text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(email) <= 254),
  name             text CHECK (name IS NULL OR length(btrim(name)) BETWEEN 2 AND 80),
  phone_e164       text CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_country    text CHECK (phone_country IS NULL OR phone_country ~ '^[A-Z]{2}$'),
  answers          jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  time_zone        text CHECK (time_zone IS NULL OR length(time_zone) <= 64),
  page_path        text NOT NULL CHECK (page_path ~ '^/' AND length(page_path) <= 300),
  placement        text NOT NULL CHECK (placement IN ('inline','popup','form_page','book_call_details')),
  spot_key         text CHECK (spot_key IS NULL OR spot_key ~ '^[a-z0-9-]{2,48}$'),
  block_id         uuid,
  utm_source       text CHECK (utm_source IS NULL OR length(utm_source) <= 100),
  utm_medium       text CHECK (utm_medium IS NULL OR length(utm_medium) <= 100),
  utm_campaign     text CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 150),
  utm_content      text CHECK (utm_content IS NULL OR length(utm_content) <= 150),
  utm_term         text CHECK (utm_term IS NULL OR length(utm_term) <= 150),
  utm_id           text CHECK (utm_id IS NULL OR length(utm_id) <= 100),
  click_source     text CHECK (click_source IS NULL OR click_source IN ('meta','google','tiktok','snap','reddit')),
  referrer_host    text CHECK (referrer_host IS NULL OR length(referrer_host) <= 253),
  ads_allowed      boolean NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_text     text CHECK (consent_text IS NULL OR length(consent_text) <= 300),
  consent_at       timestamptz,
  is_test          boolean NOT NULL DEFAULT false,
  resubmit_count   integer NOT NULL DEFAULT 0 CHECK (resubmit_count >= 0),
  last_resubmitted_at timestamptz,
  -- A1.2.3: leads live in Leads; a pipeline card is an opt-in extra.
  routing_status   text NOT NULL DEFAULT 'lead_only' CHECK (routing_status IN ('lead_only','routed','noted_existing','failed')),
  crm_record_id    uuid,
  lead_event_id    text CHECK (lead_event_id IS NULL OR length(lead_event_id) <= 120),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_submissions_consent_shape CHECK (marketing_consent = (consent_at IS NOT NULL)),
  CONSTRAINT form_submissions_consent_text CHECK (NOT marketing_consent OR consent_text IS NOT NULL)
);
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.form_submissions TO service_role;
CREATE INDEX form_submissions_dedupe_idx ON public.form_submissions (form_id, email, created_at DESC);
CREATE INDEX form_submissions_created_idx ON public.form_submissions (created_at DESC);
CREATE INDEX form_submissions_email_idx ON public.form_submissions (email);
COMMENT ON TABLE public.form_submissions IS '#4452: one row per person per form per 24 h (a resubmit updates the row). No raw click ids (they stay in ad_match_contexts). RLS on, no policies.';

-- Step 5 of the submit pipeline sees a resubmission's new key here.
CREATE TABLE public.form_submission_keys (
  idempotency_key uuid PRIMARY KEY,
  submission_id   uuid NOT NULL REFERENCES public.form_submissions(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.form_submission_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_submission_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.form_submission_keys TO service_role;

CREATE TABLE public.forms_submit_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  form_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('accepted','deduped','rejected','bot','rate_limited')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_submit_attempts_ip_idx ON public.forms_submit_attempts (ip_hash, created_at DESC);
ALTER TABLE public.forms_submit_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.forms_submit_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.forms_submit_attempts TO service_role;

CREATE TABLE public.form_owner_rotation (
  form_id          uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  owner_email      text NOT NULL CHECK (owner_email = lower(btrim(owner_email))),
  last_assigned_at timestamptz,
  PRIMARY KEY (form_id, owner_email)
);
ALTER TABLE public.form_owner_rotation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_owner_rotation FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.form_owner_rotation TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The shared contract in SQL (mirror of _shared/formsContract.ts)
-- ---------------------------------------------------------------------------
-- R-22: drop control characters (keep \n only when asked), trim spaces and newlines.
CREATE FUNCTION public.forms_clean_text(p text, p_keep_newlines boolean) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT btrim(
    CASE WHEN p_keep_newlines
      THEN regexp_replace(p, E'[\\x01-\\x09\\x0B-\\x1F\\x7F]', '', 'g')
      ELSE regexp_replace(p, E'[\\x01-\\x1F\\x7F]', '', 'g') END,
    E' \n')
$$;

-- A string whose cleaned length is in [min, max].
CREATE FUNCTION public.forms_text_ok(p jsonb, p_min integer, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_typeof(p) = 'string'
    AND length(public.forms_clean_text(p #>> '{}', false)) BETWEEN p_min AND p_max, false)
$$;

-- An absent/null value, or a string of at most p_max characters.
CREATE FUNCTION public.forms_opt_text(p jsonb, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT p IS NULL OR jsonb_typeof(p) = 'null' OR (jsonb_typeof(p) = 'string' AND length(p #>> '{}') <= p_max)
$$;

CREATE FUNCTION public.forms_validate_definition(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_err     jsonb := '[]'::jsonb;
  v_fields  jsonb;
  v_f       jsonb;
  v_i       integer;
  v_p       text;
  v_key     text;
  v_type    text;
  v_seen    text[] := ARRAY[]::text[];
  v_types   jsonb := '{}'::jsonb;   -- key -> type of earlier fields
  v_choice  text[] := ARRAY[]::text[]; -- earlier keys with option lists
  v_emails  integer := 0;
  v_names   integer := 0;
  v_phones  integer := 0;
  v_consent integer := 0;
  v_is_city boolean;
  v_opts    jsonb;
  v_ok      boolean;
  v_s       jsonb;
  v_target  text;
  v_card    jsonb;
  v_owner   jsonb;
  v_list    jsonb;
  v_own     jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('path', '', 'code', 'not_object')));
  END IF;
  IF COALESCE(p->>'audience', '') NOT IN ('host','creator','local') OR jsonb_typeof(p->'audience') <> 'string' THEN
    v_err := v_err || jsonb_build_object('path', 'audience', 'code', 'bad_audience');          -- R-5
  END IF;
  v_fields := p->'fields';
  IF v_fields IS NULL OR jsonb_typeof(v_fields) <> 'array'
     OR jsonb_array_length(v_fields) < 1 OR jsonb_array_length(v_fields) > 40 THEN
    v_err := v_err || jsonb_build_object('path', 'fields', 'code', 'bad_fields');
    RETURN jsonb_build_object('ok', false, 'errors', v_err);
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_fields) - 1 LOOP
    v_f := v_fields->v_i;
    v_p := format('fields[%s]', v_i);
    IF jsonb_typeof(v_f) <> 'object' THEN
      v_err := v_err || jsonb_build_object('path', v_p, 'code', 'bad_field');
      CONTINUE;
    END IF;
    v_key  := CASE WHEN jsonb_typeof(v_f->'key') = 'string' THEN v_f->>'key' END;
    v_type := CASE WHEN jsonb_typeof(v_f->'type') = 'string' THEN v_f->>'type' END;
    IF v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{1,39}$' THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.key', 'code', 'bad_key');
    ELSIF v_key = ANY (v_seen) THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.key', 'code', 'duplicate_key');     -- R-7
    END IF;
    IF v_type IS NULL OR v_type NOT IN ('name','email','phone','short','long','single','multi','dropdown','social','date','consent') THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.type', 'code', 'bad_type');
      CONTINUE;
    END IF;
    IF NOT public.forms_text_ok(v_f->'label', 1, 120) THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.label', 'code', 'bad_label');
    END IF;
    IF NOT public.forms_opt_text(v_f->'help', 200) THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.help', 'code', 'bad_help');
    END IF;
    IF NOT public.forms_opt_text(v_f->'placeholder', 60) THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.placeholder', 'code', 'bad_placeholder');
    END IF;
    IF jsonb_typeof(v_f->'required') IS DISTINCT FROM 'boolean' THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.required', 'code', 'bad_required');
    END IF;
    IF v_f ? 'locked' AND jsonb_typeof(v_f->'locked') <> 'boolean' THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.locked', 'code', 'bad_locked');
    END IF;
    IF v_f->'locked' = 'true'::jsonb AND v_f->'required' IS DISTINCT FROM 'true'::jsonb THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.required', 'code', 'locked_field');   -- R-6
    END IF;
    IF v_type = 'email' THEN
      v_emails := v_emails + 1;
      IF v_f->'required' IS DISTINCT FROM 'true'::jsonb THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.required', 'code', 'email_not_required'); -- R-1
      END IF;
    END IF;
    IF v_type = 'name' THEN v_names := v_names + 1; END IF;
    IF v_type = 'phone' THEN v_phones := v_phones + 1; END IF;
    IF v_type = 'consent' THEN
      v_consent := v_consent + 1;
      IF v_f->'required' = 'true'::jsonb THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.required', 'code', 'consent_required'); -- R-3
      END IF;
    END IF;
    v_is_city := v_type = 'dropdown' AND v_f->'source' = '"google_city"'::jsonb;
    IF v_type = 'dropdown' AND v_f ? 'source'
       AND v_f->'source' NOT IN ('"options"'::jsonb, '"google_city"'::jsonb) THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.source', 'code', 'bad_source');
    END IF;
    IF v_type IN ('single','multi','dropdown') AND NOT v_is_city THEN
      v_opts := v_f->'options';
      v_ok := jsonb_typeof(v_opts) = 'array' AND jsonb_array_length(v_opts) BETWEEN 1 AND 20
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) o WHERE NOT public.forms_text_ok(o, 1, 60))
        AND (SELECT count(DISTINCT public.forms_clean_text(o #>> '{}', false)) FROM jsonb_array_elements(v_opts) o)
            = jsonb_array_length(v_opts);
      IF NOT COALESCE(v_ok, false) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.options', 'code', 'bad_options');
      ELSIF v_key IS NOT NULL THEN
        v_choice := v_choice || v_key;
      END IF;
    ELSIF v_f ? 'options' AND NOT v_is_city THEN
      v_err := v_err || jsonb_build_object('path', v_p || '.options', 'code', 'bad_options');
    END IF;
    IF v_f ? 'show_if' THEN
      v_s := v_f->'show_if';
      v_target := CASE WHEN jsonb_typeof(v_s) = 'object' AND jsonb_typeof(v_s->'field_key') = 'string'
                       THEN v_s->>'field_key' END;
      IF jsonb_typeof(v_s) <> 'object' OR v_target IS NULL
         OR COALESCE(v_s->>'op', '') NOT IN ('is','is_not','includes') OR jsonb_typeof(v_s->'op') <> 'string'
         OR NOT public.forms_text_ok(v_s->'value', 1, 60) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.show_if', 'code', 'bad_show_if');
      ELSIF NOT (v_types ? v_target) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.show_if', 'code', 'show_if_order');  -- R-7
      ELSIF (v_types->>v_target) NOT IN ('single','multi','dropdown') OR NOT (v_target = ANY (v_choice)) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.show_if', 'code', 'show_if_type');
      END IF;
    END IF;
    IF v_key IS NOT NULL AND v_key ~ '^[a-z][a-z0-9_]{1,39}$' AND NOT (v_key = ANY (v_seen)) THEN
      v_seen := v_seen || v_key;
      v_types := v_types || jsonb_build_object(v_key, v_type);
    END IF;
  END LOOP;
  IF v_emails <> 1 THEN
    v_err := v_err || jsonb_build_object('path', 'fields', 'code', 'email_field_count');         -- R-1
  END IF;
  IF v_names > 1 OR v_phones > 1 OR v_consent > 1 THEN
    v_err := v_err || jsonb_build_object('path', 'fields', 'code', 'duplicate_singleton');       -- R-2
  END IF;

  IF jsonb_typeof(p->'ads') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'ads'->'lead_on') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p->'ads'->'goal') IS DISTINCT FROM 'string'
     OR (p->'ads'->>'goal') NOT IN ('call_booked','app_signup','approved','none') THEN
    v_err := v_err || jsonb_build_object('path', 'ads', 'code', 'bad_ads');
  END IF;

  v_card := p->'routing'->'card';
  IF jsonb_typeof(p->'routing') IS DISTINCT FROM 'object' OR jsonb_typeof(v_card) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_card->'on') IS DISTINCT FROM 'boolean' THEN
    v_err := v_err || jsonb_build_object('path', 'routing', 'code', 'bad_routing');
  ELSE
    IF v_card->'on' = 'true'::jsonb THEN
      IF p->'audience' = '"local"'::jsonb THEN
        v_err := v_err || jsonb_build_object('path', 'routing.card', 'code', 'card_local');      -- R-25
      ELSIF v_card->'pipeline' IS NULL OR v_card->'pipeline' NOT IN ('"hosts"'::jsonb, '"creators"'::jsonb) THEN
        v_err := v_err || jsonb_build_object('path', 'routing.card', 'code', 'card_needs_pipeline');
      ELSIF (p->'audience' = '"host"'::jsonb) <> (v_card->'pipeline' = '"hosts"'::jsonb) THEN
        v_err := v_err || jsonb_build_object('path', 'routing.card', 'code', 'card_pipeline_mismatch');
      END IF;
    ELSIF v_card ? 'pipeline' AND v_card->'pipeline' NOT IN ('"hosts"'::jsonb, '"creators"'::jsonb) THEN
      v_err := v_err || jsonb_build_object('path', 'routing.card', 'code', 'card_needs_pipeline');
    END IF;
    v_owner := p->'routing'->'owner';
    IF v_owner IS NOT NULL AND jsonb_typeof(v_owner) <> 'null' THEN
      IF v_card->'on' IS DISTINCT FROM 'true'::jsonb THEN
        v_err := v_err || jsonb_build_object('path', 'routing.owner', 'code', 'owner_without_card'); -- R-26
      ELSIF jsonb_typeof(v_owner) <> 'object' OR jsonb_typeof(v_owner->'mode') IS DISTINCT FROM 'string'
            OR (v_owner->>'mode') NOT IN ('unassigned','person','round_robin') THEN
        v_err := v_err || jsonb_build_object('path', 'routing.owner', 'code', 'bad_owner');
      ELSE
        v_list := CASE WHEN jsonb_typeof(v_owner->'emails') = 'array' THEN v_owner->'emails' ELSE '[]'::jsonb END;
        v_ok := jsonb_array_length(v_list) <= 10
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e
                          WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') > 254
                             OR lower(e #>> '{}') !~ E'^[^ \t\n\r\f\x0B@]+@[^ \t\n\r\f\x0B@]+\\.[a-z]{2,}$');
        IF NOT v_ok
           OR (v_owner->>'mode' = 'person' AND jsonb_array_length(v_list) <> 1)
           OR (v_owner->>'mode' = 'round_robin' AND jsonb_array_length(v_list) < 2)
           OR (v_owner->>'mode' = 'unassigned' AND jsonb_array_length(v_list) > 0) THEN
          v_err := v_err || jsonb_build_object('path', 'routing.owner', 'code', 'bad_owner');
        END IF;
      END IF;
    END IF;
  END IF;

  v_own := p->'own_page';
  IF v_own IS NOT NULL AND jsonb_typeof(v_own) <> 'null' THEN
    IF jsonb_typeof(v_own) <> 'object' OR jsonb_typeof(v_own->'on') IS DISTINCT FROM 'boolean' THEN
      v_err := v_err || jsonb_build_object('path', 'own_page', 'code', 'bad_own_page');
    ELSE
      IF v_own->'on' = 'true'::jsonb AND (jsonb_typeof(v_own->'slug') IS DISTINCT FROM 'string'
           OR (v_own->>'slug') !~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
           OR (v_own->>'slug') IN ('thanks','booked','preview','api','new')) THEN
        v_err := v_err || jsonb_build_object('path', 'own_page.slug', 'code', 'bad_slug');
      END IF;
      IF NOT public.forms_opt_text(v_own->'h', 28) OR NOT public.forms_opt_text(v_own->'em', 24)
         OR NOT public.forms_opt_text(v_own->'lead', 160) THEN
        v_err := v_err || jsonb_build_object('path', 'own_page', 'code', 'bad_own_page');
      END IF;
      IF v_own ? 'bg' AND v_own->'bg' NOT IN ('"night"'::jsonb, '"moss"'::jsonb, '"clay"'::jsonb, '"paper"'::jsonb) THEN
        v_err := v_err || jsonb_build_object('path', 'own_page.bg', 'code', 'bad_own_page');
      END IF;
      IF v_own ? 'index' AND jsonb_typeof(v_own->'index') <> 'boolean' THEN
        v_err := v_err || jsonb_build_object('path', 'own_page.index', 'code', 'bad_own_page');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(v_err) = 0, 'errors', v_err);
END;
$fn$;

-- R-19: is a field shown, given the raw answers? (show_if refers to earlier fields only.)
CREATE FUNCTION public.forms_field_visible(p_fields jsonb, p_field jsonb, p_answers jsonb, p_depth integer DEFAULT 0)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_s jsonb := p_field->'show_if';
  v_target jsonb;
  v_val jsonb;
  v_has boolean;
BEGIN
  IF v_s IS NULL OR jsonb_typeof(v_s) <> 'object' THEN RETURN true; END IF;
  IF p_depth > 40 THEN RETURN false; END IF;
  SELECT f INTO v_target FROM jsonb_array_elements(p_fields) f WHERE f->>'key' = v_s->>'field_key' LIMIT 1;
  IF v_target IS NULL OR NOT public.forms_field_visible(p_fields, v_target, p_answers, p_depth + 1) THEN
    RETURN false;
  END IF;
  v_val := p_answers->(v_s->>'field_key');
  v_has := CASE
    WHEN jsonb_typeof(v_val) = 'array' THEN v_val @> jsonb_build_array(v_s->'value')
    ELSE COALESCE(v_val = v_s->'value', false) END;
  IF v_s->>'op' = 'is_not' THEN RETURN NOT v_has; END IF;
  RETURN v_has;
END;
$fn$;

-- R-11: {country, dial, number} -> {e164, country} or NULL.
CREATE FUNCTION public.forms_phone_e164(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_raw text;
  v_digits text;
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'country') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v->'dial') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'number') IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  IF (v->>'country') !~ '^[A-Z]{2}$' OR (v->>'dial') !~ '^\+[1-9][0-9]{0,3}$' THEN RETURN NULL; END IF;
  v_raw := replace(v->>'number', '(0)', '');
  IF v_raw ~ '^[ ]*\+' THEN
    v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  ELSE
    v_digits := substr(v->>'dial', 2) || regexp_replace(regexp_replace(v_raw, '[^0-9]', '', 'g'), '^0+', '');
  END IF;
  IF v_digits !~ '^[1-9][0-9]{6,14}$' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('e164', '+' || v_digits, 'country', v->>'country');
END;
$fn$;

CREATE FUNCTION public.forms_real_date(p text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR substr(p, 1, 4)::integer < 1900 THEN RETURN false; END IF;
  RETURN to_char(make_date(substr(p,1,4)::integer, substr(p,6,2)::integer, substr(p,9,2)::integer), 'YYYY-MM-DD') = p;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$fn$;

CREATE FUNCTION public.forms_validate_answers(p_def jsonb, p_answers jsonb, p_today date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_fields jsonb := CASE WHEN jsonb_typeof(p_def->'fields') = 'array' THEN p_def->'fields' ELSE '[]'::jsonb END;
  v_errs   jsonb := '[]'::jsonb;
  v_vals   jsonb := '{}'::jsonb;
  v_f      jsonb;
  v_k      text;
  v_t      text;
  v_v      jsonb;
  v_s      text;
  v_empty  boolean;
  v_email  text;
  v_name   text;
  v_first  text;
  v_phone  jsonb;
  v_consent boolean := false;
  v_domain text;
  v_url    text;
  v_from   text;
  v_to     text;
  v_city   jsonb;
  v_today  text := to_char(p_today, 'YYYY-MM-DD');
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('key', '_', 'code', 'not_object')));
  END IF;
  -- R-21 backstop (the edge function enforces the exact 16 KB first).
  IF octet_length(p_answers::text) > 20480 THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('key', '_', 'code', 'too_large')));
  END IF;
  -- R-20: unknown keys.
  FOR v_k IN SELECT k FROM jsonb_object_keys(p_answers) k
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f->>'key' = k) LOOP
    v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'unknown_field');
  END LOOP;

  FOR v_f IN SELECT f FROM jsonb_array_elements(v_fields) WITH ORDINALITY AS t(f, o) ORDER BY o LOOP
    IF NOT public.forms_field_visible(v_fields, v_f, p_answers) THEN CONTINUE; END IF;  -- R-19
    v_k := v_f->>'key';
    v_t := v_f->>'type';
    v_v := p_answers->v_k;
    IF v_t = 'consent' THEN
      v_consent := COALESCE(v_v = 'true'::jsonb, false);                                  -- R-18
      v_vals := v_vals || jsonb_build_object(v_k, v_consent);
      CONTINUE;
    END IF;
    v_empty := v_v IS NULL OR jsonb_typeof(v_v) = 'null'
      OR (jsonb_typeof(v_v) = 'string' AND public.forms_clean_text(v_v #>> '{}', v_t = 'long') = '')
      OR (jsonb_typeof(v_v) = 'array' AND jsonb_array_length(v_v) = 0);
    IF v_empty THEN
      IF v_f->'required' = 'true'::jsonb THEN
        v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'required');
      END IF;
      CONTINUE;
    END IF;
    CASE v_t
      WHEN 'name' THEN
        v_s := CASE WHEN jsonb_typeof(v_v) = 'string' THEN public.forms_clean_text(v_v #>> '{}', false) ELSE '' END;
        IF length(v_s) < 2 OR length(v_s) > 80 THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
        ELSE
          v_vals := v_vals || jsonb_build_object(v_k, v_s);
          v_name := v_s;
          v_first := split_part(v_s, ' ', 1);
        END IF;
      WHEN 'email' THEN
        IF jsonb_typeof(v_v) <> 'string' THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
        ELSE
          v_s := lower(public.forms_clean_text(v_v #>> '{}', false));
          IF v_s = '' THEN
            v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'required');
          ELSIF length(v_s) > 254 OR v_s !~ E'^[^ \t\n\r\f\x0B@]+@[^ \t\n\r\f\x0B@]+\\.[a-z]{2,}$' THEN
            v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
          ELSE
            v_domain := substr(v_s, length(v_s) - strpos(reverse(v_s), '@') + 2);
            IF v_domain IN ('gmial.com','gamil.com','gmal.com','gmail.co','yaho.com','yahooo.com',
                            'hotmial.com','outlok.com','iclod.com') THEN
              v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'typo');           -- R-10
            ELSE
              v_vals := v_vals || jsonb_build_object(v_k, v_s);
              v_email := v_s;
            END IF;
          END IF;
        END IF;
      WHEN 'phone' THEN
        v_phone := public.forms_phone_e164(v_v);
        IF v_phone IS NULL THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
        ELSE
          v_vals := v_vals || jsonb_build_object(v_k, v_phone->'e164');
        END IF;
      WHEN 'short', 'long' THEN
        IF jsonb_typeof(v_v) <> 'string' THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
        ELSE
          v_s := public.forms_clean_text(v_v #>> '{}', v_t = 'long');
          IF length(v_s) > (CASE WHEN v_t = 'short' THEN 120 ELSE 2000 END) THEN
            v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'too_long');
          ELSE
            v_vals := v_vals || jsonb_build_object(v_k, v_s);
          END IF;
        END IF;
      WHEN 'single', 'dropdown' THEN
        IF v_t = 'dropdown' AND v_f->'source' = '"google_city"'::jsonb THEN
          IF jsonb_typeof(v_v) <> 'object' OR jsonb_typeof(v_v->'label') IS DISTINCT FROM 'string' THEN
            v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
          ELSE
            v_s := public.forms_clean_text(v_v->>'label', false);
            IF length(v_s) < 2 OR length(v_s) > 120 OR EXISTS (
                 SELECT 1 FROM unnest(ARRAY['city','region','country']) c
                  WHERE v_v ? c AND jsonb_typeof(v_v->c) <> 'null'
                    AND (jsonb_typeof(v_v->c) <> 'string' OR length(v_v->>c) > 80)) THEN
              v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
            ELSE
              v_city := jsonb_build_object('label', v_s);
              IF jsonb_typeof(v_v->'city') = 'string' THEN v_city := v_city || jsonb_build_object('city', public.forms_clean_text(v_v->>'city', false)); END IF;
              IF jsonb_typeof(v_v->'region') = 'string' THEN v_city := v_city || jsonb_build_object('region', public.forms_clean_text(v_v->>'region', false)); END IF;
              IF jsonb_typeof(v_v->'country') = 'string' THEN v_city := v_city || jsonb_build_object('country', public.forms_clean_text(v_v->>'country', false)); END IF;
              IF v_v->'free' = 'true'::jsonb THEN v_city := v_city || '{"free":true}'::jsonb; END IF;
              v_vals := v_vals || jsonb_build_object(v_k, v_city);
            END IF;
          END IF;
        ELSIF jsonb_typeof(v_v) <> 'string' OR NOT COALESCE(v_f->'options' @> jsonb_build_array(v_v), false) THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'bad_option');
        ELSE
          v_vals := v_vals || jsonb_build_object(v_k, v_v);
        END IF;
      WHEN 'multi' THEN
        IF jsonb_typeof(v_v) <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_v) x
                       WHERE jsonb_typeof(x) <> 'string' OR NOT COALESCE(v_f->'options' @> jsonb_build_array(x), false))
           OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(v_v) x) <> jsonb_array_length(v_v) THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'bad_option');
        ELSE
          v_vals := v_vals || jsonb_build_object(v_k, v_v);
        END IF;
      WHEN 'social' THEN
        v_url := NULL;
        IF jsonb_typeof(v_v) = 'object' AND jsonb_typeof(v_v->'value') = 'string'
           AND jsonb_typeof(v_v->'platform') = 'string'
           AND (v_v->>'platform') IN ('instagram','tiktok','youtube','website') THEN
          v_s := public.forms_clean_text(v_v->>'value', false);
          IF v_s ~ '^https?://' THEN
            v_url := CASE WHEN length(v_s) <= 300 THEN v_s END;
          ELSIF (v_v->>'platform') <> 'website' AND v_s ~ '^@?[A-Za-z0-9_.]{2,30}$' THEN
            v_s := regexp_replace(v_s, '^@', '');
            v_url := CASE v_v->>'platform'
              WHEN 'instagram' THEN 'https://instagram.com/' || v_s
              WHEN 'tiktok' THEN 'https://tiktok.com/@' || v_s
              ELSE 'https://youtube.com/@' || v_s END;
          END IF;
        END IF;
        IF v_url IS NULL THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
        ELSE
          v_vals := v_vals || jsonb_build_object(v_k, jsonb_build_object('platform', v_v->'platform', 'url', v_url));
        END IF;
      WHEN 'date' THEN
        v_from := CASE WHEN jsonb_typeof(v_v) = 'string' THEN v_v #>> '{}'
                       WHEN jsonb_typeof(v_v) = 'object' AND jsonb_typeof(v_v->'from') = 'string' THEN v_v->>'from' END;
        v_to := CASE WHEN jsonb_typeof(v_v) = 'object' AND jsonb_typeof(v_v->'to') = 'string' THEN v_v->>'to' END;
        IF v_from IS NULL OR NOT public.forms_real_date(v_from)
           OR (v_to IS NOT NULL AND (NOT public.forms_real_date(v_to) OR v_to < v_from)) THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
        ELSIF v_from < v_today THEN
          v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'past_date');
        ELSE
          v_vals := v_vals || jsonb_build_object(v_k, CASE WHEN v_to IS NULL THEN jsonb_build_object('from', v_from)
                                                           ELSE jsonb_build_object('from', v_from, 'to', v_to) END);
        END IF;
      ELSE
        v_errs := v_errs || jsonb_build_object('key', v_k, 'code', 'invalid');
    END CASE;
  END LOOP;

  SELECT COALESCE(jsonb_agg(e ORDER BY e->>'key' COLLATE "C", e->>'code' COLLATE "C"), '[]'::jsonb)
    INTO v_errs FROM jsonb_array_elements(v_errs) e;
  IF jsonb_array_length(v_errs) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errs, 'values', '{}'::jsonb, 'email', NULL, 'name', NULL,
      'first_name', NULL, 'phone_e164', NULL, 'phone_country', NULL, 'consent', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'errors', '[]'::jsonb, 'values', v_vals, 'email', v_email, 'name', v_name,
    'first_name', v_first, 'phone_e164', v_phone->'e164', 'phone_country', v_phone->'country', 'consent', v_consent);
END;
$fn$;

REVOKE ALL ON FUNCTION public.forms_clean_text(text, boolean), public.forms_text_ok(jsonb, integer, integer),
  public.forms_opt_text(jsonb, integer), public.forms_field_visible(jsonb, jsonb, jsonb, integer),
  public.forms_phone_e164(jsonb), public.forms_real_date(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_clean_text(text, boolean), public.forms_text_ok(jsonb, integer, integer),
  public.forms_opt_text(jsonb, integer), public.forms_field_visible(jsonb, jsonb, jsonb, integer),
  public.forms_phone_e164(jsonb), public.forms_real_date(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.forms_validate_definition(jsonb), public.forms_validate_answers(jsonb, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_validate_definition(jsonb), public.forms_validate_answers(jsonb, jsonb, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.forms_validate_definition(jsonb) IS '#4452 R-1…R-7, R-25, R-26: the SQL mirror of formsContract.ts validateDefinition (same paths and codes). Pure.';
COMMENT ON FUNCTION public.forms_validate_answers(jsonb, jsonb, date) IS '#4452 R-8…R-24: the SQL mirror of formsContract.ts validateAnswers (same codes and normalised values). Pure.';

-- ---------------------------------------------------------------------------
-- 5. Templates and defaults
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.forms_default_definition(p_audience text, p_template text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'v', 1,
    'audience', p_audience,
    'fields', CASE p_template
      WHEN 'creators' THEN jsonb_build_array(
        jsonb_build_object('key','name','type','name','label','Your name','required',true,'locked',true),
        jsonb_build_object('key','email','type','email','label','Email','help','We''ll send your next steps here.','required',true,'locked',true),
        jsonb_build_object('key','phone','type','phone','label','Phone','help','With country code, for WhatsApp.','required',true,'locked',true),
        jsonb_build_object('key','what_do_you_make','type','single','label','What do you make?','required',true,'options',jsonb_build_array('Video','Photo','Both')),
        jsonb_build_object('key','your_main_social','type','social','label','Your main social','help','Handle or profile link.','required',true),
        jsonb_build_object('key','city','type','dropdown','source','google_city','label','Your city','required',true),
        jsonb_build_object('key','consent','type','consent','label','Send me creator tips and new gigs by email. Unsubscribe any time.','required',false))
      WHEN 'locals' THEN jsonb_build_array(
        jsonb_build_object('key','name','type','name','label','Your name','required',true,'locked',true),
        jsonb_build_object('key','email','type','email','label','Email','required',true,'locked',true),
        jsonb_build_object('key','phone','type','phone','label','Phone','help','With country code, for WhatsApp.','required',true,'locked',true),
        jsonb_build_object('key','city','type','dropdown','source','google_city','label','Your city','required',true),
        jsonb_build_object('key','first_place','type','short','label','The first place you would review','required',false),
        jsonb_build_object('key','consent','type','consent','label','Send me occasional emails from Mingla. Unsubscribe anytime.','required',false))
      ELSE jsonb_build_array(
        jsonb_build_object('key','name','type','name','label','Your name','required',true),
        jsonb_build_object('key','email','type','email','label','Email','required',true),
        jsonb_build_object('key','consent','type','consent','label','Send me occasional emails from Mingla. Unsubscribe anytime.','required',false))
    END,
    'ads', jsonb_build_object('lead_on', p_template IS DISTINCT FROM 'book_call_extra' AND p_template IS DISTINCT FROM 'tool',
                              'goal', CASE WHEN p_template IN ('book_call_extra','tool') THEN 'none' ELSE 'call_booked' END),
    'routing', jsonb_build_object('card', jsonb_build_object('on', false)),
    'own_page', jsonb_build_object('on', false, 'index', false, 'bg', 'night'),
    'design', jsonb_build_object('layout','centre','text_pos','centre','align','left','text_color','#ffffff',
                                 'backdrop','night','tick','orange','columns',1,'phone_steps',false))
$$;
REVOKE ALL ON FUNCTION public.forms_default_definition(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_default_definition(text, text) TO authenticated, service_role;

-- R-6: a creators/locals template keeps name, email and phone, required and locked.
CREATE FUNCTION public.forms_locked_ok(p_template text, p_def jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT p_template IS NULL OR p_template NOT IN ('creators','locals') OR (
    SELECT count(*) = 3 FROM jsonb_array_elements(p_def->'fields') f
     WHERE f->>'type' IN ('name','email','phone') AND f->>'key' = f->>'type'
       AND f->'required' = 'true'::jsonb AND f->'locked' = 'true'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.forms_locked_ok(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_locked_ok(text, jsonb) TO authenticated, service_role;

CREATE FUNCTION public.forms_slugify(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT COALESCE(NULLIF(left(btrim(regexp_replace(lower(COALESCE(p, '')), '[^a-z0-9]+', '-', 'g'), '-'), 40), ''), 'form')
$$;
REVOKE ALL ON FUNCTION public.forms_slugify(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_slugify(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Admin RPCs
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.admin_form_get(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_live public.form_versions;
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_live FROM public.form_versions WHERE id = v_f.live_version_id;
  RETURN jsonb_build_object(
    'form', jsonb_build_object('id', v_f.id, 'key', v_f.key, 'name', v_f.name, 'audience', v_f.audience,
                               'template', v_f.template, 'status', v_f.status, 'tested_at', v_f.tested_at,
                               'updated_at', v_f.updated_at, 'archived_at', v_f.archived_at,
                               'can_edit', public.forms_can_edit()),
    'draft', v_f.draft,
    'draft_rev', v_f.draft_rev,
    'live_version', CASE WHEN v_live.id IS NULL THEN NULL ELSE
      jsonb_build_object('version', v_live.version, 'definition', v_live.definition, 'published_at', v_live.published_at) END,
    'versions', (SELECT COALESCE(max(version), 0) FROM public.form_versions WHERE form_id = v_f.id),
    'own_page', jsonb_build_object(
      'current_slug', (SELECT s.slug FROM public.form_page_slugs s WHERE s.form_id = v_f.id AND s.is_current),
      'old_slugs', COALESCE((SELECT jsonb_agg(s.slug ORDER BY s.retired_at DESC) FROM public.form_page_slugs s
                              WHERE s.form_id = v_f.id AND NOT s.is_current), '[]'::jsonb)));
END;
$fn$;

CREATE FUNCTION public.admin_form_create(p_name text, p_audience text, p_template text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_base text;
  v_key  text;
  v_n    integer := 1;
  v_id   uuid;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF length(v_name) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'bad_name' USING ERRCODE = '22023'; END IF;
  IF p_audience IS NULL OR p_audience NOT IN ('host','creator','local') THEN RAISE EXCEPTION 'bad_audience' USING ERRCODE = '22023'; END IF;
  IF p_template IS NOT NULL AND p_template NOT IN ('creators','locals','book_call_extra') THEN
    RAISE EXCEPTION 'bad_template' USING ERRCODE = '22023';
  END IF;
  v_base := public.forms_slugify(v_name);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('forms_key:' || v_base, 0));
  v_key := v_base;
  WHILE EXISTS (SELECT 1 FROM public.forms WHERE key = v_key) LOOP
    v_n := v_n + 1;
    v_key := left(v_base, 40) || '-' || v_n;
  END LOOP;
  INSERT INTO public.forms (key, name, audience, template, draft, created_by, updated_by)
  VALUES (v_key, v_name, p_audience, p_template, public.forms_default_definition(p_audience, p_template), auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'key', v_key);
END;
$fn$;

CREATE FUNCTION public.admin_form_save_draft(p_form_id uuid, p_expected_rev integer, p_draft jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_check jsonb;
  v_slug text;
  v_owner uuid;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'archived' THEN RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023'; END IF;
  IF v_f.draft_rev <> p_expected_rev THEN
    RAISE EXCEPTION 'form_draft_conflict' USING ERRCODE = 'PT409', DETAIL = jsonb_build_object('draft_rev', v_f.draft_rev)::text;
  END IF;
  -- The audience is the form's own; the draft cannot change it silently.
  IF p_draft->>'audience' IS DISTINCT FROM v_f.audience THEN
    RAISE EXCEPTION 'audience_mismatch' USING ERRCODE = '22023';
  END IF;
  v_check := public.forms_validate_definition(p_draft);
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'invalid_definition' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  IF NOT public.forms_locked_ok(v_f.template, p_draft) THEN
    RAISE EXCEPTION 'locked_field' USING ERRCODE = '22023';                                   -- R-6
  END IF;
  -- A slug used by another form, now or before, is never reused.
  v_slug := CASE WHEN p_draft->'own_page'->'on' = 'true'::jsonb THEN p_draft->'own_page'->>'slug' END;
  IF v_slug IS NOT NULL THEN
    SELECT form_id INTO v_owner FROM public.form_page_slugs WHERE slug = v_slug;
    IF FOUND AND v_owner <> p_form_id THEN
      RAISE EXCEPTION 'slug_taken' USING ERRCODE = '22023',
        DETAIL = jsonb_build_object('form', (SELECT name FROM public.forms WHERE id = v_owner))::text;
    END IF;
  END IF;
  UPDATE public.forms SET draft = p_draft, draft_rev = draft_rev + 1, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('draft_rev', v_f.draft_rev + 1);
END;
$fn$;

CREATE FUNCTION public.admin_form_duplicate(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_res jsonb;
  v_draft jsonb;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  v_res := public.admin_form_create(left(v_f.name, 73) || ' (copy)', v_f.audience,
                                    CASE WHEN v_f.template = 'tool' THEN NULL ELSE v_f.template END);
  -- No own page on the copy (a slug belongs to one form).
  v_draft := jsonb_set(v_f.draft, '{own_page}', jsonb_build_object('on', false, 'index', false, 'bg', 'night'));
  UPDATE public.forms SET draft = v_draft WHERE id = (v_res->>'id')::uuid;
  RETURN v_res;
END;
$fn$;

CREATE FUNCTION public.admin_form_archive(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.forms SET status = 'archived', archived_at = now(), updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id AND status <> 'archived';
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.forms WHERE id = p_form_id) THEN
    RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Its own page closes (the slug stays reserved in history).
  UPDATE public.form_page_slugs SET is_current = false, retired_at = now() WHERE form_id = p_form_id AND is_current;
  -- Its automation pauses (M3; nothing new enters, scheduled sends wait).
  IF to_regclass('public.form_automations') IS NOT NULL THEN
    UPDATE public.form_automations SET enabled = false, updated_by = auth.uid(), updated_at = now() WHERE form_id = p_form_id;
  END IF;
  RETURN jsonb_build_object('status', 'archived');
END;
$fn$;

CREATE FUNCTION public.admin_form_unarchive(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.forms SET status = 'draft', archived_at = NULL, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id AND status = 'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_archived' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('status', 'draft');
END;
$fn$;

CREATE FUNCTION public.admin_form_publish(p_form_id uuid, p_expected_rev integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.forms;
  v_check jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_version integer;
  v_vid uuid;
  v_slug text;
  v_flow jsonb;
  v_has_follow boolean := false;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'archived' THEN RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023'; END IF;
  IF v_f.draft_rev <> p_expected_rev THEN RAISE EXCEPTION 'form_draft_conflict' USING ERRCODE = 'PT409'; END IF;

  v_check := public.forms_validate_definition(v_f.draft);
  IF NOT (v_check->>'ok')::boolean THEN v_failed := v_failed || (v_check->'errors'); END IF;
  IF NOT public.forms_locked_ok(v_f.template, v_f.draft) THEN
    v_failed := v_failed || jsonb_build_object('path', 'fields', 'code', 'locked_field');
  END IF;
  -- The five design checks.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_f.draft->'fields') f
                  WHERE f->>'type' = 'email' AND f->'required' = 'true'::jsonb) THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'email_required');
  END IF;
  IF to_regclass('public.form_automations') IS NOT NULL THEN
    SELECT a.draft INTO v_flow FROM public.form_automations a WHERE a.form_id = p_form_id;
    v_has_follow := v_flow IS NOT NULL AND public.forms_flow_has_follow_up(v_flow);
  END IF;
  IF v_has_follow AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_f.draft->'fields') f WHERE f->>'type' = 'consent') THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'consent_for_follow_ups');   -- R-4
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_f.draft->'fields') f WHERE f->>'type' = 'consent' AND f->'required' = 'true'::jsonb) THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'consent_optional');
  END IF;
  IF COALESCE(v_f.draft->>'audience', '') NOT IN ('host','creator','local') THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'lead_label_set');
  END IF;
  IF v_f.tested_at IS NULL THEN
    v_failed := v_failed || jsonb_build_object('path', 'check', 'code', 'tested');
  END IF;
  IF jsonb_array_length(v_failed) > 0 THEN
    RAISE EXCEPTION 'publish_check_failed' USING ERRCODE = '22023', DETAIL = v_failed::text;
  END IF;

  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM public.form_versions WHERE form_id = p_form_id;
  INSERT INTO public.form_versions (form_id, version, definition, definition_sha256, published_by)
  VALUES (p_form_id, v_version, v_f.draft, encode(sha256(convert_to(v_f.draft::text, 'UTF8')), 'hex'), auth.uid())
  RETURNING id INTO v_vid;
  UPDATE public.forms SET status = 'live', live_version_id = v_vid, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;

  v_slug := CASE WHEN v_f.draft->'own_page'->'on' = 'true'::jsonb THEN v_f.draft->'own_page'->>'slug' END;
  IF v_slug IS NULL THEN
    UPDATE public.form_page_slugs SET is_current = false, retired_at = now() WHERE form_id = p_form_id AND is_current;
  ELSIF NOT EXISTS (SELECT 1 FROM public.form_page_slugs WHERE slug = v_slug AND form_id = p_form_id AND is_current) THEN
    IF EXISTS (SELECT 1 FROM public.form_page_slugs WHERE slug = v_slug AND form_id <> p_form_id) THEN
      RAISE EXCEPTION 'slug_taken' USING ERRCODE = '22023';
    END IF;
    UPDATE public.form_page_slugs SET is_current = false, retired_at = now() WHERE form_id = p_form_id AND is_current;
    INSERT INTO public.form_page_slugs (slug, form_id) VALUES (v_slug, p_form_id)
    ON CONFLICT (slug) DO UPDATE SET is_current = true, retired_at = NULL
      WHERE public.form_page_slugs.form_id = EXCLUDED.form_id;
  END IF;
  RETURN jsonb_build_object('version', v_version, 'slug', v_slug);
END;
$fn$;

CREATE FUNCTION public.admin_form_mark_tested(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.forms_can_edit() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.forms SET tested_at = now() WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('tested_at', now());
END;
$fn$;

-- F-6 walk (also used by M3): does any email come after a wait on its path?
CREATE FUNCTION public.forms_flow_has_follow_up(p_flow jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
BEGIN
  RETURN EXISTS (SELECT 1 FROM jsonb_each_text(public.forms_flow_kinds(p_flow)) k WHERE k.value = 'follow_up');
END;
$fn$;

-- F-6: step id -> confirmation | follow_up | team_alert.
CREATE FUNCTION public.forms_flow_kinds_walk(p_steps jsonb, p_waited boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_s jsonb;
  v_w boolean := p_waited;
BEGIN
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN RETURN v_out; END IF;
  FOR v_s IN SELECT s FROM jsonb_array_elements(p_steps) WITH ORDINALITY t(s, o) ORDER BY o LOOP
    IF v_s->>'type' = 'wait' THEN v_w := true;
    ELSIF v_s->>'type' = 'email' THEN v_out := v_out || jsonb_build_object(v_s->>'id', CASE WHEN v_w THEN 'follow_up' ELSE 'confirmation' END);
    ELSIF v_s->>'type' = 'team' THEN v_out := v_out || jsonb_build_object(v_s->>'id', 'team_alert');
    ELSIF v_s->>'type' = 'branch' THEN
      v_out := v_out || public.forms_flow_kinds_walk(v_s->'yes', v_w) || public.forms_flow_kinds_walk(v_s->'no', v_w);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$fn$;

CREATE FUNCTION public.forms_flow_kinds(p_flow jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT public.forms_flow_kinds_walk(p_flow->'steps', false) $$;

REVOKE ALL ON FUNCTION public.admin_form_get(uuid), public.admin_form_create(text, text, text),
  public.admin_form_save_draft(uuid, integer, jsonb), public.admin_form_duplicate(uuid),
  public.admin_form_archive(uuid), public.admin_form_unarchive(uuid), public.admin_form_publish(uuid, integer),
  public.admin_form_mark_tested(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_form_get(uuid), public.admin_form_create(text, text, text),
  public.admin_form_save_draft(uuid, integer, jsonb), public.admin_form_duplicate(uuid),
  public.admin_form_archive(uuid), public.admin_form_unarchive(uuid), public.admin_form_publish(uuid, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_form_mark_tested(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.forms_flow_has_follow_up(jsonb), public.forms_flow_kinds_walk(jsonb, boolean),
  public.forms_flow_kinds(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.forms_flow_has_follow_up(jsonb), public.forms_flow_kinds_walk(jsonb, boolean),
  public.forms_flow_kinds(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The submit core (service role only; called by forms-submit)
-- ---------------------------------------------------------------------------
-- A1.3 step 10: a pipeline card only when routing.card.on.
CREATE FUNCTION public.forms_route_submission(p_submission_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_s public.form_submissions;
  v_f public.forms;
  v_def jsonb;
  v_card jsonb;
  v_pipeline text;
  v_owners jsonb := '[]'::jsonb;
  v_owner jsonb;
  v_pick text;
  v_fields jsonb;
  v_res jsonb;
  v_rec uuid;
  v_status text;
  v_icp text;
  v_idents jsonb;
BEGIN
  SELECT * INTO v_s FROM public.form_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_f FROM public.forms WHERE id = v_s.form_id;
  SELECT definition INTO v_def FROM public.form_versions WHERE id = v_s.form_version_id;
  v_card := v_def->'routing'->'card';
  IF v_s.is_test OR v_card->'on' IS DISTINCT FROM 'true'::jsonb THEN
    UPDATE public.form_submissions SET routing_status = 'lead_only', updated_at = now() WHERE id = p_submission_id;
    RETURN jsonb_build_object('routing_status', 'lead_only');
  END IF;
  v_pipeline := v_card->>'pipeline';
  v_owner := v_def->'routing'->'owner';
  IF v_owner->>'mode' = 'person' THEN
    v_owners := jsonb_build_array(lower(v_owner->'emails'->>0));
  ELSIF v_owner->>'mode' = 'round_robin' THEN
    INSERT INTO public.form_owner_rotation (form_id, owner_email)
    SELECT v_s.form_id, lower(e) FROM jsonb_array_elements_text(v_owner->'emails') e
    ON CONFLICT DO NOTHING;
    SELECT r.owner_email INTO v_pick FROM public.form_owner_rotation r
     WHERE r.form_id = v_s.form_id
       AND r.owner_email IN (SELECT lower(e) FROM jsonb_array_elements_text(v_owner->'emails') e)
     ORDER BY r.last_assigned_at NULLS FIRST, r.owner_email
     LIMIT 1 FOR UPDATE;
    UPDATE public.form_owner_rotation SET last_assigned_at = clock_timestamp()
     WHERE form_id = v_s.form_id AND owner_email = v_pick;
    v_owners := jsonb_build_array(v_pick);
  END IF;
  v_icp := CASE WHEN v_pipeline = 'creators' THEN 'ugc_one_off'
                ELSE CASE v_s.answers->>'icp'
                       WHEN 'restaurant_bar' THEN 'restaurant_bar' WHEN 'venue_gallery' THEN 'venue_gallery'
                       WHEN 'event_organizer' THEN 'event_organizer' WHEN 'trip_stay_host' THEN 'trip_stay_host'
                       WHEN 'partner_org' THEN 'partner_org' ELSE 'community_host' END END;
  v_idents := jsonb_build_array(jsonb_build_object('kind', 'email', 'value', v_s.email));
  IF v_s.phone_e164 IS NOT NULL THEN
    v_idents := v_idents || jsonb_build_object('kind', 'phone', 'value', v_s.phone_e164);
  END IF;
  v_fields := jsonb_build_object(
    'name', COALESCE(v_s.name, split_part(v_s.email, '@', 1)),
    'contact', v_s.email, 'channel', 'email',
    'source', 'inbound',
    'icp', v_icp, 'identifiers', v_idents, 'owners', v_owners);
  BEGIN
    v_res := public.crm_record_create_core(v_pipeline, v_fields, 'forms@usemingla.com', left('form-' || v_f.key, 40));
    IF v_res->>'status' = 'created' THEN
      v_rec := (v_res->'record'->>'id')::uuid;
      v_status := 'routed';
      INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
      VALUES (v_rec, 'note', 'forms@usemingla.com', left('form-' || v_f.key, 40),
              left(format('Came from the form ''%s'' on %s', v_f.name, v_s.page_path), 4000), now(), now());
    ELSE
      v_rec := (v_res->'existing'->>'id')::uuid;
      v_status := 'noted_existing';
      INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
      VALUES (v_rec, 'note', 'forms@usemingla.com', left('form-' || v_f.key, 40),
              left(format('Sent the form ''%s'' from %s', v_f.name, v_s.page_path), 4000), now(), now());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The submission still stands; staff can Add to pipeline from Leads.
    RAISE WARNING '[forms_route_submission] failed sub=% sqlstate=%', p_submission_id, SQLSTATE;
    UPDATE public.form_submissions SET routing_status = 'failed', updated_at = now() WHERE id = p_submission_id;
    RETURN jsonb_build_object('routing_status', 'failed');
  END;
  UPDATE public.form_submissions SET routing_status = v_status, crm_record_id = v_rec, updated_at = now()
   WHERE id = p_submission_id;
  -- A1.3: link the person's lead to the card (M5), unless it is already linked.
  IF to_regclass('public.leads') IS NOT NULL THEN
    UPDATE public.leads SET crm_record_id = v_rec, crm_pipeline = v_pipeline, updated_at = now()
     WHERE email_key = v_s.email AND crm_record_id IS NULL;
  END IF;
  RETURN jsonb_build_object('routing_status', v_status, 'crm_record_id', v_rec);
END;
$fn$;

-- One call per accepted submit. p = {idempotency_key, form_id, email, name,
-- phone_e164, phone_country, answers, consent, consent_text, time_zone,
-- time_zone_source, page_path, placement, spot_key, block_id, utm:{…},
-- click_source, referrer_host, ads_allowed, is_test}.
-- The answers were validated by forms-submit with formsContract.ts; this
-- function re-validates them (defence in depth) and owns the 24 h dedupe.
CREATE FUNCTION public.forms_submit_core(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_key   uuid := (p->>'idempotency_key')::uuid;
  v_form  public.forms;
  v_ver   public.form_versions;
  v_email text := lower(btrim(COALESCE(p->>'email', '')));
  v_prev  public.form_submissions;
  v_sub   uuid;
  v_consent boolean := COALESCE(p->'consent' = 'true'::jsonb, false);
  v_test  boolean := COALESCE(p->'is_test' = 'true'::jsonb, false);
  v_check jsonb;
  v_route jsonb := NULL;
  v_run   uuid := NULL;
  v_existing uuid;
BEGIN
  -- Step 5: idempotency (the column and the side table).
  SELECT id INTO v_existing FROM public.form_submissions WHERE idempotency_key = v_key;
  IF NOT FOUND THEN
    SELECT submission_id INTO v_existing FROM public.form_submission_keys WHERE idempotency_key = v_key;
  END IF;
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.form_submissions WHERE id = v_existing;
    RETURN jsonb_build_object('replay', true, 'submission_id', v_prev.id, 'lead_event_id', v_prev.lead_event_id,
                              'deduped', v_prev.idempotency_key <> v_key, 'lead_label', v_prev.lead_label);
  END IF;

  SELECT * INTO v_form FROM public.forms WHERE id = (p->>'form_id')::uuid;
  IF NOT FOUND OR v_form.status <> 'live' THEN RAISE EXCEPTION 'form_closed' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_ver FROM public.form_versions WHERE id = v_form.live_version_id;
  v_check := public.forms_validate_answers(v_ver.definition, p->'answers',
               COALESCE((p->>'today')::date, (now() AT TIME ZONE 'UTC')::date));
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'validation' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  IF v_email <> COALESCE(v_check->>'email', '') THEN RAISE EXCEPTION 'validation' USING ERRCODE = '22023'; END IF;
  v_consent := (v_check->>'consent')::boolean;

  -- Step 9: one row per form, email and 24 h.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('forms_submit:' || v_form.id || ':' || v_email, 0));
  SELECT * INTO v_prev FROM public.form_submissions
   WHERE form_id = v_form.id AND email = v_email AND created_at > now() - interval '24 hours' AND NOT is_test
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND NOT v_test THEN
    UPDATE public.form_submissions SET
      answers = v_check->'values',
      name = COALESCE(v_check->>'name', name),
      phone_e164 = COALESCE(v_check->>'phone_e164', phone_e164),
      phone_country = COALESCE(v_check->>'phone_country', phone_country),
      -- consent only goes false -> true
      marketing_consent = marketing_consent OR v_consent,
      consent_text = CASE WHEN marketing_consent THEN consent_text WHEN v_consent THEN left(p->>'consent_text', 300) ELSE consent_text END,
      consent_at = CASE WHEN marketing_consent THEN consent_at WHEN v_consent THEN now() ELSE consent_at END,
      utm_source = COALESCE(left(p->'utm'->>'source', 100), utm_source),
      utm_medium = COALESCE(left(p->'utm'->>'medium', 100), utm_medium),
      utm_campaign = COALESCE(left(p->'utm'->>'campaign', 150), utm_campaign),
      utm_content = COALESCE(left(p->'utm'->>'content', 150), utm_content),
      utm_term = COALESCE(left(p->'utm'->>'term', 150), utm_term),
      utm_id = COALESCE(left(p->'utm'->>'id', 100), utm_id),
      resubmit_count = resubmit_count + 1,
      last_resubmitted_at = now(),
      updated_at = now()
     WHERE id = v_prev.id;
    INSERT INTO public.form_submission_keys (idempotency_key, submission_id) VALUES (v_key, v_prev.id);
    IF v_prev.crm_record_id IS NOT NULL THEN
      INSERT INTO public.crm_activity (record_id, kind, actor_email, via, body, occurred_at, created_at)
      VALUES (v_prev.crm_record_id, 'note', 'forms@usemingla.com', left('form-' || v_form.key, 40),
              left(format('Sent the form again: %s (%s)', v_form.name, COALESCE(p->>'page_path', '/')), 4000), now(), now());
    END IF;
    RETURN jsonb_build_object('replay', false, 'deduped', true, 'submission_id', v_prev.id,
                              'lead_event_id', v_prev.lead_event_id, 'lead_label', v_prev.lead_label);
  END IF;

  INSERT INTO public.form_submissions (
    form_id, form_version_id, lead_label, idempotency_key, email, name, phone_e164, phone_country, answers,
    time_zone, page_path, placement, spot_key, block_id, utm_source, utm_medium, utm_campaign, utm_content,
    utm_term, utm_id, click_source, referrer_host, ads_allowed, marketing_consent, consent_text, consent_at, is_test)
  VALUES (
    v_form.id, v_ver.id, v_form.audience, v_key, v_email, v_check->>'name', v_check->>'phone_e164',
    v_check->>'phone_country', v_check->'values', left(p->>'time_zone', 64), left(COALESCE(p->>'page_path', '/'), 300),
    p->>'placement', NULLIF(p->>'spot_key', ''), NULLIF(p->>'block_id', '')::uuid,
    left(p->'utm'->>'source', 100), left(p->'utm'->>'medium', 100), left(p->'utm'->>'campaign', 150),
    left(p->'utm'->>'content', 150), left(p->'utm'->>'term', 150), left(p->'utm'->>'id', 100),
    p->>'click_source', left(p->>'referrer_host', 253), COALESCE(p->'ads_allowed' = 'true'::jsonb, false),
    v_consent, CASE WHEN v_consent THEN left(COALESCE(p->>'consent_text', ''), 300) END,
    CASE WHEN v_consent THEN now() END, v_test)
  RETURNING id INTO v_sub;

  IF NOT v_test AND p->>'placement' IS DISTINCT FROM 'book_call_details' THEN
    v_route := public.forms_route_submission(v_sub);
  ELSE
    v_route := jsonb_build_object('routing_status', 'lead_only');
  END IF;
  -- Step 13: start the automation run (M3) for a live, enabled automation.
  IF to_regprocedure('public.forms_start_run(uuid,text,text)') IS NOT NULL
     AND p->>'placement' IS DISTINCT FROM 'book_call_details' AND NOT v_test THEN
    v_run := public.forms_start_run(v_sub, p->>'time_zone', COALESCE(p->>'time_zone_source', 'fallback_utc'));
  END IF;
  RETURN jsonb_build_object('replay', false, 'deduped', false, 'submission_id', v_sub, 'lead_event_id', NULL,
                            'lead_label', v_form.audience, 'routing_status', v_route->>'routing_status',
                            'run_id', v_run, 'goal', COALESCE(v_ver.definition->'ads'->>'goal', 'none'),
                            'lead_on', COALESCE(v_ver.definition->'ads'->'lead_on' = 'true'::jsonb, false),
                            'form_key', v_form.key);
END;
$fn$;

CREATE FUNCTION public.forms_set_lead_event(p_submission_id uuid, p_event_id text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.form_submissions SET lead_event_id = left(p_event_id, 120), updated_at = now()
   WHERE id = p_submission_id AND lead_event_id IS NULL
$$;

REVOKE ALL ON FUNCTION public.forms_route_submission(uuid), public.forms_submit_core(jsonb),
  public.forms_set_lead_event(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forms_route_submission(uuid), public.forms_submit_core(jsonb),
  public.forms_set_lead_event(uuid, text) TO service_role;
COMMENT ON FUNCTION public.forms_submit_core(jsonb) IS
  '#4452 submit pipeline steps 5, 9, 10, 13: idempotency, the 24 h same-email dedupe under an advisory lock, the optional pipeline card and the automation run. Service role only.';

COMMIT;
