-- Issue #4514 wave 1: brand forms, the database and server core.
--
-- Hosts build their own forms in Promote -> Forms, attach one to any page
-- (RSVP, event, experience, trip) and send personal links. Contract: BUILD
-- CONTRACT v2 parts 1-3 on #4514, then "open points settled by Seth", the
-- "OP-1 addendum" and "Contract v2 corrections (binding)"; the later wins.
--
-- This file holds:
--   1. The emergency off switch (row in public.feature_flags, C8).
--   2. Tables: brand_forms, brand_form_versions (immutable), brand_form_attachments
--      (mode: optional_on_page | required_step | after_purchase; one active per
--      page), brand_form_responses (exactly one subject), brand_form_links
--      (hashed tokens), brand_form_submit_attempts (salted IP hash only),
--      brand_form_door_reads (C4 log of full-answer reads).
--   3. The one-time code rail: public.contact_challenges (#4063) gains the
--      purpose 'brand_form_access'; codes settle through the existing
--      issue_4063_settle_contact_challenge. No new sender.
--   4. validate_brand_form_definition / brand_form_definition_errors and
--      brand_form_check_answers / brand_form_validate_answers.
--   5. Host RPCs (biz_brand_form_*), public reads, the service-role submit core,
--      link issue and resolve, code begin, the door reads, grants.
--
-- Wave 4 (12c): Ask guests to answer, Remind and the automatic reminder. Per
-- decision 17 they never create invites: their delivery record is
-- brand_form_request_sends with a brand form link, sent through notify v2, so the
-- C6 form_request invite purpose is not added.
--
-- Wave 5: the checkout answer stash, its finalize trigger and the after-purchase
-- link (section at the end of this file).
--
-- Not here (later waves): the RSVP wrapper submit_event_rsvp_with_form (after
-- #4508 merges), the ticket_id subject (OP-6).
--
-- Roles (C5): read forms and Responses at marketing_manager (20) and up; build
-- (save, publish, close, reopen, archive) at marketing_manager and up; attach,
-- detach and export at event_manager (40) and up. Door (C4): anyone who may scan
-- that event reads the marked line and, when the form allows it or the caller is
-- event_manager and up, one guest's full answers per call, logged.
--
-- Every table: RLS on, no INSERT/UPDATE/DELETE grant to anon or authenticated.
-- Every function: SECURITY DEFINER SET search_path = '' (or IMMUTABLE pure).
-- Stale writes raise PT409, never 40001.
--
-- READ-ONLY PROBE (run before applying; 19 Nov returned null, null, 20281118014238, 13, 0):
--   SELECT to_regclass('public.brand_forms'), to_regclass('public.brand_form_links'),
--     (SELECT max(version) FROM supabase_migrations.schema_migrations),
--     (SELECT count(*) FROM public.trip_intake_schemas),
--     (SELECT count(*) FROM public.orders WHERE intake_form_data IS NOT NULL);
--
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS every function named public.brand_form_* / public.biz_brand_form_* /
--     public.public_brand_form_for_event / public.brand_forms_my_pending /
--     public.validate_brand_form_definition;
--   ALTER TABLE public.contact_challenges DROP COLUMN brand_form_link_id; restore the
--     purpose and shape checks from 20280805004473_issue_4473_purchase_shared_holders.sql;
--   DROP TRIGGER brand_form_finalize_checkout_answers ON public.ticket_checkout_sessions;
--   DROP TABLE public.brand_form_checkout_answers;
--   DROP TABLE public.brand_form_auto_reminder_runs, public.brand_form_request_sends;
--   DELETE FROM public.notification_categories WHERE key IN ('brand_form_request', 'business.brand_form_reminder_held');
--   DROP TABLE public.brand_form_door_reads, public.brand_form_submit_attempts,
--     public.brand_form_links, public.brand_form_responses, public.brand_form_attachments;
--   ALTER TABLE public.brand_forms DROP CONSTRAINT brand_forms_live_version_fk;
--   DROP TABLE public.brand_form_versions, public.brand_forms;
--   DELETE FROM public.feature_flags WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. The emergency off switch (C8: switches live in the database)
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (flag_key, is_enabled, description)
VALUES ('BRAND_FORMS_KILL_SWITCH', false,
        '#4514: emergency off for brand forms. On: brand-form-submit answers 503, public reads report no form, required forms stop blocking.')
ON CONFLICT (flag_key) DO UPDATE SET description = EXCLUDED.description;

CREATE FUNCTION public.brand_forms_switched_off() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT COALESCE((SELECT f.is_enabled FROM public.feature_flags f
                    WHERE f.flag_key = 'BRAND_FORMS_KILL_SWITCH'), false);
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Definition validator (schema mingla.brand_form.v1)
-- ---------------------------------------------------------------------------
-- Returns a jsonb array of {path, code}; empty means valid. Pure (IMMUTABLE).
CREATE FUNCTION public.brand_form_definition_errors(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_q jsonb;
  v_o jsonb;
  v_src jsonb;
  v_i integer := 0;
  v_type text;
  v_path text;
  v_ids text[] := '{}';
  v_positions integer[] := '{}';
  v_opt_ids text[];
  v_door integer := 0;
  v_key text;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_array(jsonb_build_object('path', '', 'code', 'not_object'));
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p) LOOP
    IF v_key NOT IN ('schema', 'title', 'intro', 'questions') THEN
      v_errors := v_errors || jsonb_build_object('path', v_key, 'code', 'unknown_key');
    END IF;
  END LOOP;
  IF p->>'schema' IS DISTINCT FROM 'mingla.brand_form.v1' THEN
    v_errors := v_errors || jsonb_build_object('path', 'schema', 'code', 'schema_version');
  END IF;
  IF p ? 'title' AND (jsonb_typeof(p->'title') <> 'string' OR char_length(p->>'title') > 120) THEN
    v_errors := v_errors || jsonb_build_object('path', 'title', 'code', 'title_invalid');
  END IF;
  IF p ? 'intro' AND (jsonb_typeof(p->'intro') <> 'string' OR char_length(p->>'intro') > 500) THEN
    v_errors := v_errors || jsonb_build_object('path', 'intro', 'code', 'intro_invalid');
  END IF;
  IF jsonb_typeof(p->'questions') IS DISTINCT FROM 'array' THEN
    RETURN v_errors || jsonb_build_object('path', 'questions', 'code', 'questions_not_array');
  END IF;
  IF jsonb_array_length(p->'questions') > 20 THEN
    v_errors := v_errors || jsonb_build_object('path', 'questions', 'code', 'too_many_questions');
  END IF;

  -- First pass: shape of each question.
  FOR v_q IN SELECT value FROM jsonb_array_elements(p->'questions') LOOP
    v_path := 'questions[' || v_i || ']';
    v_i := v_i + 1;
    IF jsonb_typeof(v_q) <> 'object' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path, 'code', 'question_not_object');
      CONTINUE;
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_q) LOOP
      IF v_key NOT IN ('id', 'position', 'type', 'label', 'help', 'required', 'options',
                       'show_if', 'show_at_door', 'door_label') THEN
        v_errors := v_errors || jsonb_build_object('path', v_path || '.' || v_key, 'code', 'unknown_key');
      END IF;
    END LOOP;
    IF jsonb_typeof(v_q->'id') IS DISTINCT FROM 'string' OR (v_q->>'id') !~ v_uuid THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.id', 'code', 'id_invalid');
    ELSIF lower(v_q->>'id') = ANY (v_ids) THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.id', 'code', 'duplicate_id');
    ELSE
      v_ids := v_ids || lower(v_q->>'id');
    END IF;
    IF jsonb_typeof(v_q->'position') IS DISTINCT FROM 'number'
       OR (v_q->>'position') !~ '^[0-9]{1,4}$' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.position', 'code', 'position_invalid');
    ELSIF (v_q->>'position')::integer = ANY (v_positions) THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.position', 'code', 'duplicate_position');
    ELSE
      v_positions := v_positions || (v_q->>'position')::integer;
    END IF;
    v_type := v_q->>'type';
    IF v_type = 'file_upload' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.type', 'code', 'file_upload_unavailable');
    ELSIF v_type IS NULL OR v_type NOT IN ('short_text', 'long_text', 'number', 'date', 'single_choice', 'multi_choice') THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.type', 'code', 'type_invalid');
    END IF;
    IF jsonb_typeof(v_q->'label') IS DISTINCT FROM 'string'
       OR char_length(btrim(v_q->>'label')) < 1 OR char_length(v_q->>'label') > 200 THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.label', 'code', 'label_invalid');
    END IF;
    IF v_q ? 'help' AND jsonb_typeof(v_q->'help') <> 'null'
       AND (jsonb_typeof(v_q->'help') <> 'string' OR char_length(v_q->>'help') > 300) THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.help', 'code', 'help_invalid');
    END IF;
    IF jsonb_typeof(v_q->'required') IS DISTINCT FROM 'boolean' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.required', 'code', 'required_invalid');
    END IF;
    IF v_type IN ('single_choice', 'multi_choice') THEN
      IF jsonb_typeof(v_q->'options') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_q->'options') NOT BETWEEN 2 AND 10 THEN
        v_errors := v_errors || jsonb_build_object('path', v_path || '.options', 'code', 'options_count');
      ELSE
        v_opt_ids := '{}';
        FOR v_o IN SELECT value FROM jsonb_array_elements(v_q->'options') LOOP
          IF jsonb_typeof(v_o) <> 'object'
             OR jsonb_typeof(v_o->'id') IS DISTINCT FROM 'string'
             OR (v_o->>'id') !~ '^[A-Za-z0-9_-]{1,64}$'
             OR jsonb_typeof(v_o->'label') IS DISTINCT FROM 'string'
             OR char_length(btrim(v_o->>'label')) < 1 OR char_length(v_o->>'label') > 80
             OR (SELECT count(*) FROM jsonb_object_keys(v_o)) <> 2 THEN
            v_errors := v_errors || jsonb_build_object('path', v_path || '.options', 'code', 'option_invalid');
          ELSIF (v_o->>'id') = ANY (v_opt_ids) THEN
            v_errors := v_errors || jsonb_build_object('path', v_path || '.options', 'code', 'duplicate_option_id');
          ELSE
            v_opt_ids := v_opt_ids || (v_o->>'id');
          END IF;
        END LOOP;
      END IF;
    ELSIF v_q ? 'options' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.options', 'code', 'options_not_allowed');
    END IF;
    IF v_q ? 'show_at_door' AND jsonb_typeof(v_q->'show_at_door') <> 'boolean' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.show_at_door', 'code', 'show_at_door_invalid');
    ELSIF COALESCE((v_q->>'show_at_door')::boolean, false) THEN
      IF v_type NOT IN ('single_choice', 'multi_choice', 'short_text', 'number', 'date') THEN
        v_errors := v_errors || jsonb_build_object('path', v_path || '.show_at_door', 'code', 'door_type_not_allowed');
      END IF;
      v_door := v_door + 1;
    END IF;
    IF v_q ? 'door_label' AND jsonb_typeof(v_q->'door_label') <> 'null'
       AND (jsonb_typeof(v_q->'door_label') <> 'string'
            OR char_length(btrim(v_q->>'door_label')) < 1 OR char_length(v_q->>'door_label') > 16) THEN
      v_errors := v_errors || jsonb_build_object('path', v_path || '.door_label', 'code', 'door_label_invalid');
    END IF;
  END LOOP;
  IF v_door > 3 THEN
    v_errors := v_errors || jsonb_build_object('path', 'questions', 'code', 'too_many_door_questions');
  END IF;

  -- Second pass: show_if may point only at an EARLIER single_choice question
  -- (by position) that has no show_if of its own (one level deep), and at one
  -- of its options.
  v_i := 0;
  FOR v_q IN SELECT value FROM jsonb_array_elements(p->'questions') LOOP
    v_path := 'questions[' || v_i || '].show_if';
    v_i := v_i + 1;
    IF jsonb_typeof(v_q) <> 'object' OR NOT (v_q ? 'show_if') OR jsonb_typeof(v_q->'show_if') = 'null' THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_q->'show_if') <> 'object'
       OR jsonb_typeof(v_q->'show_if'->'question_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_q->'show_if'->'option_id') IS DISTINCT FROM 'string'
       OR (SELECT count(*) FROM jsonb_object_keys(v_q->'show_if')) <> 2 THEN
      v_errors := v_errors || jsonb_build_object('path', v_path, 'code', 'show_if_invalid');
      CONTINUE;
    END IF;
    SELECT s.value INTO v_src FROM jsonb_array_elements(p->'questions') s
     WHERE jsonb_typeof(s.value) = 'object'
       AND lower(s.value->>'id') = lower(v_q->'show_if'->>'question_id')
     LIMIT 1;
    IF v_src IS NULL THEN
      v_errors := v_errors || jsonb_build_object('path', v_path, 'code', 'show_if_unknown_question');
    ELSIF v_src->>'type' IS DISTINCT FROM 'single_choice' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path, 'code', 'show_if_not_single_choice');
    ELSIF (v_src->>'position') !~ '^[0-9]{1,4}$' OR (v_q->>'position') !~ '^[0-9]{1,4}$'
          OR (v_src->>'position')::integer >= (v_q->>'position')::integer THEN
      v_errors := v_errors || jsonb_build_object('path', v_path, 'code', 'show_if_not_earlier');
    ELSIF v_src ? 'show_if' AND jsonb_typeof(v_src->'show_if') <> 'null' THEN
      v_errors := v_errors || jsonb_build_object('path', v_path, 'code', 'show_if_too_deep');
    ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_src->'options', '[]'::jsonb)) o
                       WHERE o.value->>'id' = v_q->'show_if'->>'option_id') THEN
      v_errors := v_errors || jsonb_build_object('path', v_path, 'code', 'show_if_unknown_option');
    END IF;
    v_src := NULL;
  END LOOP;
  RETURN v_errors;
END;
$fn$;

CREATE FUNCTION public.validate_brand_form_definition(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT jsonb_array_length(public.brand_form_definition_errors(p)) = 0;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Answer validator
-- ---------------------------------------------------------------------------
-- Pure: {ok, answers (hidden questions dropped, empty values dropped, numbers
-- normalised), errors:[{questionId, code}]}. Answer shapes: short_text and
-- long_text a string (200 / 2,000), number a JSON number or a decimal string,
-- date 'YYYY-MM-DD', single_choice an option id, multi_choice an array of
-- distinct option ids.
CREATE FUNCTION public.brand_form_check_answers(p_definition jsonb, p_answers jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_out jsonb := '{}'::jsonb;
  v_q jsonb;
  v_key text;
  v_val jsonb;
  v_id text;
  v_type text;
  v_visible boolean;
  v_src_val jsonb;
  v_opts text[];
  v_txt text;
  v_elem jsonb;
  v_seen text[];
  v_y integer;
  v_m integer;
  v_d integer;
  v_dim integer;
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'answers', '{}'::jsonb,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'answers_not_object')));
  END IF;
  -- Callers may pass any definition (the builder checks drafts); only a valid one
  -- is walked, so nothing below can raise on a hostile definition either.
  IF NOT public.validate_brand_form_definition(p_definition) THEN
    RETURN jsonb_build_object('ok', false, 'answers', '{}'::jsonb,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'definition_invalid')));
  END IF;
  -- Every key must be a question of this version.
  FOR v_key IN SELECT jsonb_object_keys(p_answers) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_definition->'questions') q
                    WHERE lower(q.value->>'id') = lower(v_key)) THEN
      v_errors := v_errors || jsonb_build_object('questionId', v_key, 'code', 'unknown_question');
    END IF;
  END LOOP;

  FOR v_q IN SELECT q.value FROM jsonb_array_elements(p_definition->'questions') q
              ORDER BY (q.value->>'position')::integer LOOP
    v_id := v_q->>'id';
    v_type := v_q->>'type';
    SELECT a.value INTO v_val FROM jsonb_each(p_answers) a WHERE lower(a.key) = lower(v_id) LIMIT 1;
    -- Visibility: a show_if source is always a top-level single choice, so its
    -- own answer decides. An answer is "the option id".
    v_visible := true;
    IF v_q ? 'show_if' AND jsonb_typeof(v_q->'show_if') = 'object' THEN
      SELECT a.value INTO v_src_val FROM jsonb_each(p_answers) a
       WHERE lower(a.key) = lower(v_q->'show_if'->>'question_id') LIMIT 1;
      v_visible := jsonb_typeof(v_src_val) = 'string' AND (v_src_val #>> '{}') = v_q->'show_if'->>'option_id';
      v_src_val := NULL;
    END IF;
    IF NOT v_visible THEN
      v_val := NULL;          -- dropped before any check; a hidden question is never required
      CONTINUE;
    END IF;
    -- Normalise "empty".
    IF v_val IS NOT NULL AND (jsonb_typeof(v_val) = 'null'
        OR (jsonb_typeof(v_val) = 'string' AND btrim(v_val #>> '{}') = '')
        OR (jsonb_typeof(v_val) = 'array' AND jsonb_array_length(v_val) = 0)) THEN
      v_val := NULL;
    END IF;
    IF v_val IS NULL THEN
      IF COALESCE((v_q->>'required')::boolean, false) THEN
        v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'required');
      END IF;
      CONTINUE;
    END IF;
    SELECT COALESCE(array_agg(o.value->>'id'), '{}') INTO v_opts
      FROM jsonb_array_elements(COALESCE(v_q->'options', '[]'::jsonb)) o;
    CASE v_type
      WHEN 'short_text', 'long_text' THEN
        IF jsonb_typeof(v_val) <> 'string' THEN
          v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'type');
        ELSIF char_length(v_val #>> '{}') > (CASE WHEN v_type = 'short_text' THEN 200 ELSE 2000 END) THEN
          v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'too_long');
        ELSE
          v_out := v_out || jsonb_build_object(v_id, btrim(v_val #>> '{}'));
        END IF;
      WHEN 'number' THEN
        v_txt := btrim(v_val #>> '{}');
        IF jsonb_typeof(v_val) NOT IN ('number', 'string') OR v_txt !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' THEN
          v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'type');
        ELSE
          v_out := v_out || jsonb_build_object(v_id, v_txt::numeric);
        END IF;
      WHEN 'date' THEN
        -- A real calendar date, checked with arithmetic only: nothing here can
        -- raise (to_date / make_date on 2026-02-30 or year 0 would, as 22008).
        v_txt := CASE WHEN jsonb_typeof(v_val) = 'string' THEN v_val #>> '{}' END;
        IF v_txt IS NULL OR v_txt !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
          v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'type');
        ELSE
          v_y := substr(v_txt, 1, 4)::integer;
          v_m := substr(v_txt, 6, 2)::integer;
          v_d := substr(v_txt, 9, 2)::integer;
          v_dim := CASE
               WHEN v_m = 2 THEN CASE WHEN (v_y % 4 = 0 AND v_y % 100 <> 0) OR v_y % 400 = 0 THEN 29 ELSE 28 END
               WHEN v_m IN (4, 6, 9, 11) THEN 30
               ELSE 31 END;
          IF v_y < 1 OR v_d > v_dim THEN
            v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'type');
          ELSE
            v_out := v_out || jsonb_build_object(v_id, v_txt);
          END IF;
        END IF;
      WHEN 'single_choice' THEN
        IF jsonb_typeof(v_val) <> 'string' OR NOT ((v_val #>> '{}') = ANY (v_opts)) THEN
          v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'option');
        ELSE
          v_out := v_out || jsonb_build_object(v_id, v_val);
        END IF;
      WHEN 'multi_choice' THEN
        IF jsonb_typeof(v_val) <> 'array' THEN
          v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'type');
        ELSE
          v_seen := '{}';
          FOR v_elem IN SELECT value FROM jsonb_array_elements(v_val) LOOP
            IF jsonb_typeof(v_elem) <> 'string' OR NOT ((v_elem #>> '{}') = ANY (v_opts))
               OR (v_elem #>> '{}') = ANY (v_seen) THEN
              v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'option');
              v_seen := NULL;
              EXIT;
            END IF;
            v_seen := v_seen || (v_elem #>> '{}');
          END LOOP;
          IF v_seen IS NOT NULL THEN
            v_out := v_out || jsonb_build_object(v_id, to_jsonb(v_seen));
          END IF;
        END IF;
      ELSE
        v_errors := v_errors || jsonb_build_object('questionId', v_id, 'code', 'type');
    END CASE;
  END LOOP;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'answers', v_out, 'errors', v_errors);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.brand_forms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'closed', 'archived')),
  draft             jsonb NOT NULL CONSTRAINT brand_forms_draft_valid CHECK (public.validate_brand_form_definition(draft)),
  draft_rev         integer NOT NULL DEFAULT 1 CHECK (draft_rev >= 1),
  live_version_id   uuid,
  -- C4: a form setting outside the versioned definition; changing it needs no publish.
  door_full_answers boolean NOT NULL DEFAULT true,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  archived_at       timestamptz,
  CONSTRAINT brand_forms_live_has_version CHECK (status NOT IN ('live', 'closed') OR live_version_id IS NOT NULL),
  CONSTRAINT brand_forms_closed_at CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT brand_forms_archived_at CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX brand_forms_brand_idx ON public.brand_forms (brand_id, updated_at DESC);
ALTER TABLE public.brand_forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_forms FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.brand_forms TO authenticated;
-- No TRUNCATE for anyone but the owner (default privileges would grant it).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_forms TO service_role;
COMMENT ON TABLE public.brand_forms IS '#4514: one row per host-built form (BUILD CONTRACT v2 §3.1). Writes only through the biz_brand_form_* RPCs; brand members at marketing_manager and up read their brand''s rows.';

CREATE TABLE public.brand_form_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id           uuid NOT NULL REFERENCES public.brand_forms(id) ON DELETE RESTRICT,
  version           integer NOT NULL CHECK (version >= 1),
  definition        jsonb NOT NULL CONSTRAINT brand_form_versions_definition_valid
                      CHECK (public.validate_brand_form_definition(definition)),
  definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[0-9a-f]{64}$'),
  published_by      uuid NOT NULL,
  published_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);
ALTER TABLE public.brand_form_versions ENABLE ROW LEVEL SECURITY;
-- The platform's default privileges hand every new table ALL to service_role; a
-- published version is append-only, so the service role keeps SELECT and INSERT
-- only (no UPDATE, DELETE or TRUNCATE).
REVOKE ALL ON public.brand_form_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.brand_form_versions TO authenticated;
GRANT SELECT, INSERT ON public.brand_form_versions TO service_role;
ALTER TABLE public.brand_forms ADD CONSTRAINT brand_forms_live_version_fk
  FOREIGN KEY (live_version_id) REFERENCES public.brand_form_versions(id) ON DELETE RESTRICT;

-- MINGLA-INVARIANT: I-4514-FORM-VERSIONS-IMMUTABLE | issue #4514 | a published brand form version is never updated or deleted (this trigger; pg17 test T-IMM).
CREATE FUNCTION public.brand_form_versions_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN RAISE EXCEPTION 'brand_form_version_immutable' USING ERRCODE = '42501'; END $fn$;
REVOKE ALL ON FUNCTION public.brand_form_versions_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER brand_form_versions_no_change BEFORE UPDATE OR DELETE ON public.brand_form_versions
  FOR EACH ROW EXECUTE FUNCTION public.brand_form_versions_immutable();
-- A row trigger never fires for TRUNCATE; this statement trigger covers it.
CREATE TRIGGER brand_form_versions_no_truncate BEFORE TRUNCATE ON public.brand_form_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.brand_form_versions_immutable();

CREATE FUNCTION public.brand_forms_live_version_same_form() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.live_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.brand_form_versions v WHERE v.id = NEW.live_version_id AND v.form_id = NEW.id) THEN
    RAISE EXCEPTION 'live_version_other_form' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.brand_id <> OLD.brand_id THEN
    RAISE EXCEPTION 'brand_form_brand_fixed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.brand_forms_live_version_same_form() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER brand_forms_live_version_same_form BEFORE INSERT OR UPDATE ON public.brand_forms
  FOR EACH ROW EXECUTE FUNCTION public.brand_forms_live_version_same_form();

CREATE TABLE public.brand_form_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id     uuid NOT NULL REFERENCES public.brand_forms(id) ON DELETE RESTRICT,
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  mode        text NOT NULL DEFAULT 'required_step'
                CHECK (mode IN ('optional_on_page', 'required_step', 'after_purchase')),
  auto_remind boolean NOT NULL DEFAULT false,
  -- Wave 4: the channels the automatic reminder may use after push ("Push first,
  -- free; then only the channels ticked above"). Free channels by default.
  auto_remind_channels text[] NOT NULL DEFAULT ARRAY['email']
    CHECK (auto_remind_channels <@ ARRAY['email', 'push', 'sms']::text[] AND cardinality(auto_remind_channels) >= 1),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  detached_by uuid
);
-- One active form per page (decision 9).
CREATE UNIQUE INDEX brand_form_attachments_one_active ON public.brand_form_attachments (event_id)
  WHERE detached_at IS NULL;
CREATE INDEX brand_form_attachments_form_idx ON public.brand_form_attachments (form_id) WHERE detached_at IS NULL;
ALTER TABLE public.brand_form_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_attachments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.brand_form_attachments TO authenticated;
-- No TRUNCATE for anyone but the owner (default privileges would grant it).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_form_attachments TO service_role;

CREATE FUNCTION public.brand_form_attachments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.form_id <> OLD.form_id OR NEW.event_id <> OLD.event_id
                           OR NEW.brand_id <> OLD.brand_id OR OLD.detached_at IS NOT NULL) THEN
    RAISE EXCEPTION 'attachment_fixed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_forms f WHERE f.id = NEW.form_id AND f.brand_id = NEW.brand_id)
     OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.brand_id = NEW.brand_id) THEN
    RAISE EXCEPTION 'attachment_brand_mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.brand_form_attachments_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER brand_form_attachments_guard BEFORE INSERT OR UPDATE ON public.brand_form_attachments
  FOR EACH ROW EXECUTE FUNCTION public.brand_form_attachments_guard();

CREATE TABLE public.brand_form_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id        uuid NOT NULL REFERENCES public.brand_forms(id) ON DELETE RESTRICT,
  version_id     uuid NOT NULL REFERENCES public.brand_form_versions(id) ON DELETE RESTRICT,
  brand_id       uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  attachment_id  uuid REFERENCES public.brand_form_attachments(id) ON DELETE SET NULL,
  -- The page the answer was given for (null for an answer given with no page).
  event_id       uuid REFERENCES public.events(id) ON DELETE SET NULL,
  -- Exactly one subject.
  rsvp_id        uuid REFERENCES public.event_rsvps(id) ON DELETE CASCADE,
  rsvp_guest_id  uuid REFERENCES public.event_rsvp_guests(id) ON DELETE CASCADE,
  order_id       uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_name   text CHECK (contact_name IS NULL OR char_length(btrim(contact_name)) BETWEEN 1 AND 80),
  contact_email  text CHECK (contact_email IS NULL OR (contact_email = lower(btrim(contact_email))
                    AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND char_length(contact_email) <= 254)),
  contact_phone  text CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  answers        jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  source         text NOT NULL CHECK (source IN ('signup', 'page', 'link', 'pass', 'purchase_redirect', 'blast')),
  verified       boolean NOT NULL DEFAULT true,
  via_link       boolean NOT NULL DEFAULT false,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  edit_count     integer NOT NULL DEFAULT 0 CHECK (edit_count >= 0),
  CONSTRAINT brand_form_responses_one_subject CHECK (
    num_nonnulls(rsvp_id, rsvp_guest_id, order_id, user_id, contact_name) = 1),
  CONSTRAINT brand_form_responses_open_contact CHECK (
    (contact_name IS NULL AND contact_email IS NULL AND contact_phone IS NULL)
    OR (contact_name IS NOT NULL AND num_nonnulls(contact_email, contact_phone) >= 1)),
  -- Only open-link contacts are unverified.
  CONSTRAINT brand_form_responses_verified CHECK (verified = (contact_name IS NULL))
);
CREATE UNIQUE INDEX brand_form_responses_one_per_rsvp ON public.brand_form_responses (form_id, rsvp_id) WHERE rsvp_id IS NOT NULL;
CREATE UNIQUE INDEX brand_form_responses_one_per_rsvp_guest ON public.brand_form_responses (form_id, rsvp_guest_id) WHERE rsvp_guest_id IS NOT NULL;
CREATE UNIQUE INDEX brand_form_responses_one_per_order ON public.brand_form_responses (form_id, order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX brand_form_responses_one_per_user ON public.brand_form_responses (form_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX brand_form_responses_event_idx ON public.brand_form_responses (form_id, event_id);
CREATE INDEX brand_form_responses_rsvp_idx ON public.brand_form_responses (rsvp_id) WHERE rsvp_id IS NOT NULL;
CREATE INDEX brand_form_responses_order_idx ON public.brand_form_responses (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX brand_form_responses_user_idx ON public.brand_form_responses (user_id) WHERE user_id IS NOT NULL;
ALTER TABLE public.brand_form_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_responses FROM PUBLIC, anon, authenticated, service_role;
-- No TRUNCATE for anyone but the owner (default privileges would grant it).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_form_responses TO service_role;
COMMENT ON TABLE public.brand_form_responses IS '#4514: one response per person per form (one partial unique per subject column). No client grants: hosts read through biz_brand_form_responses, guests through brand_form_my_response.';

CREATE FUNCTION public.brand_form_responses_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brand_form_versions v JOIN public.brand_forms f ON f.id = v.form_id
                  WHERE v.id = NEW.version_id AND v.form_id = NEW.form_id AND f.brand_id = NEW.brand_id) THEN
    RAISE EXCEPTION 'response_version_mismatch' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.form_id <> OLD.form_id OR NEW.brand_id <> OLD.brand_id
       OR NEW.rsvp_id IS DISTINCT FROM OLD.rsvp_id OR NEW.rsvp_guest_id IS DISTINCT FROM OLD.rsvp_guest_id
       OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'response_subject_fixed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.brand_form_responses_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER brand_form_responses_guard BEFORE INSERT OR UPDATE ON public.brand_form_responses
  FOR EACH ROW EXECUTE FUNCTION public.brand_form_responses_guard();

CREATE TABLE public.brand_form_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       uuid NOT NULL REFERENCES public.brand_forms(id) ON DELETE CASCADE,
  attachment_id uuid REFERENCES public.brand_form_attachments(id) ON DELETE SET NULL,
  event_id      uuid REFERENCES public.events(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('person', 'open')),
  rsvp_id       uuid REFERENCES public.event_rsvps(id) ON DELETE CASCADE,
  rsvp_guest_id uuid REFERENCES public.event_rsvp_guests(id) ON DELETE CASCADE,
  order_id      uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- C2: ends automatic recognition only, never access.
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  use_count     integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_form_links_subject CHECK (
    (kind = 'open' AND num_nonnulls(rsvp_id, rsvp_guest_id, order_id, user_id) = 0)
    OR (kind = 'person' AND num_nonnulls(rsvp_id, rsvp_guest_id, order_id, user_id) = 1))
);
CREATE INDEX brand_form_links_form_idx ON public.brand_form_links (form_id, created_at DESC);
ALTER TABLE public.brand_form_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_links FROM PUBLIC, anon, authenticated, service_role;
-- No TRUNCATE for anyone but the owner (default privileges would grant it).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_form_links TO service_role;

CREATE TABLE public.brand_form_submit_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash    text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  form_id    uuid,
  outcome    text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'rate_limited', 'paused')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_form_submit_attempts_ip_idx ON public.brand_form_submit_attempts (ip_hash, created_at DESC);
ALTER TABLE public.brand_form_submit_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_submit_attempts FROM PUBLIC, anon, authenticated, service_role;
-- No TRUNCATE for anyone but the owner (default privileges would grant it).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_form_submit_attempts TO service_role;

-- C4: every full-answer read at the door, with who, which guest and when.
CREATE TABLE public.brand_form_door_reads (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid NOT NULL,
  event_id     uuid NOT NULL,
  form_id      uuid,
  subject_kind text NOT NULL CHECK (subject_kind IN ('rsvp', 'order')),
  subject_id   uuid NOT NULL,
  via          text NOT NULL CHECK (via IN ('scan', 'search')),
  result       text NOT NULL CHECK (result IN ('full', 'line_only', 'not_answered', 'no_form', 'rate_limited')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_form_door_reads_actor_idx ON public.brand_form_door_reads (actor_id, created_at DESC);
ALTER TABLE public.brand_form_door_reads ENABLE ROW LEVEL SECURITY;
-- C4 audit log: append-only for the service role (no UPDATE, DELETE or TRUNCATE).
REVOKE ALL ON public.brand_form_door_reads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.brand_form_door_reads TO service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS: hosts read their own brand's forms, versions and attachments
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.brand_form_can_read_brand(p_brand_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND public.biz_brand_effective_rank(p_brand_id, auth.uid()) >= public.biz_role_rank('marketing_manager');
$fn$;

CREATE POLICY brand_forms_host_read ON public.brand_forms
  FOR SELECT TO authenticated USING (public.brand_form_can_read_brand(brand_id));
CREATE POLICY brand_form_versions_host_read ON public.brand_form_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.brand_forms f WHERE f.id = form_id AND public.brand_form_can_read_brand(f.brand_id)));
CREATE POLICY brand_form_attachments_host_read ON public.brand_form_attachments
  FOR SELECT TO authenticated USING (public.brand_form_can_read_brand(brand_id));

-- ---------------------------------------------------------------------------
-- 6. The one-time code rail (#4063 contact_challenges, reused)
-- ---------------------------------------------------------------------------
DO $challenge$
BEGIN
  IF to_regclass('public.contact_challenges') IS NULL THEN
    RETURN;   -- the filtered pre-#1931 replay lanes omit #4063
  END IF;
  ALTER TABLE public.contact_challenges
    ADD COLUMN brand_form_link_id uuid REFERENCES public.brand_form_links(id) ON DELETE CASCADE;
  ALTER TABLE public.contact_challenges DROP CONSTRAINT IF EXISTS contact_challenges_purpose_check;
  ALTER TABLE public.contact_challenges ADD CONSTRAINT contact_challenges_purpose_check
    CHECK (purpose IN ('claim_sign_in', 'add_contact', 'claim_add_contact', 'brand_form_access'));
  ALTER TABLE public.contact_challenges DROP CONSTRAINT IF EXISTS contact_challenges_shape;
  ALTER TABLE public.contact_challenges ADD CONSTRAINT contact_challenges_shape CHECK (
    (purpose = 'add_contact' AND user_id IS NOT NULL AND claim_code IS NULL)
    OR (purpose = 'claim_sign_in' AND user_id IS NULL AND claim_code IS NOT NULL AND channel = 'email')
    OR (purpose = 'claim_add_contact' AND user_id IS NOT NULL AND claim_code IS NOT NULL)
    OR (purpose = 'brand_form_access' AND user_id IS NULL AND claim_code IS NULL));
  ALTER TABLE public.contact_challenges ADD CONSTRAINT contact_challenges_brand_form_link
    CHECK ((purpose = 'brand_form_access') = (brand_form_link_id IS NOT NULL));
  CREATE INDEX contact_challenges_brand_form_link_recent
    ON public.contact_challenges (brand_form_link_id, created_at DESC) WHERE brand_form_link_id IS NOT NULL;
END;
$challenge$;

-- ---------------------------------------------------------------------------
-- 7. Small helpers
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.brand_form_token_hash(p_token text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$ SELECT encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex'); $fn$;

-- The brand header every guest-facing form view draws (§5.1), read live.
CREATE FUNCTION public.brand_form_brand_header(p_brand_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT jsonb_build_object('brandId', b.id, 'displayName', b.name, 'photo', b.profile_photo_url,
           'coverMediaUrl', b.cover_media_url, 'coverMediaType', b.cover_media_type,
           'accent', b.theme_color, 'slug', b.slug)
    FROM public.brands b WHERE b.id = p_brand_id;
$fn$;

-- "{first name} {initial}." from a full name.
CREATE FUNCTION public.brand_form_short_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN NULLIF(btrim(p_name), '') IS NULL THEN NULL
    WHEN array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) = 1 THEN btrim(p_name)
    ELSE (regexp_split_to_array(btrim(p_name), '\s+'))[1] || ' '
         || upper(left((regexp_split_to_array(btrim(p_name), '\s+'))[2], 1)) || '.'
  END;
$fn$;

-- The event of one subject {kind, id}, or null.
CREATE FUNCTION public.brand_form_subject_event(p_kind text, p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE p_kind
    WHEN 'rsvp' THEN (SELECT r.event_id FROM public.event_rsvps r WHERE r.id = p_id)
    WHEN 'order' THEN (SELECT o.event_id FROM public.orders o WHERE o.id = p_id)
    ELSE NULL END;
$fn$;

-- A page anyone may open by its link: the same rule the existing public event
-- reads apply (#1929/#1931 exact-link readers): public or unlisted ('hidden'),
-- not deleted, its brand not deleted, not blocked by private-event access, and
-- (for forms) still taking answers: scheduled or live.
-- (plpgsql so the filtered historical replay lanes that omit #1931 still create it.)
CREATE FUNCTION public.brand_form_event_public(p_event_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  RETURN COALESCE((
    SELECT e.visibility IN ('public', 'hidden') AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND e.status IN ('scheduled', 'live')
       AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      FROM public.events e JOIN public.brands b ON b.id = e.brand_id
     WHERE e.id = p_event_id), false);
END;
$fn$;

-- One response of a form for a subject; for an RSVP or an order it also finds
-- the holder's own signed-in response (OP-5: the same person meets the same form).
CREATE FUNCTION public.brand_form_find_response(p_form_id uuid, p_kind text, p_id uuid)
RETURNS public.brand_form_responses
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v public.brand_form_responses;
  v_user uuid;
BEGIN
  IF p_kind = 'rsvp' THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND rsvp_id = p_id;
    IF FOUND THEN RETURN v; END IF;
    SELECT r.user_id INTO v_user FROM public.event_rsvps r WHERE r.id = p_id;
  ELSIF p_kind = 'order' THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND order_id = p_id;
    IF FOUND THEN RETURN v; END IF;
    SELECT o.buyer_user_id INTO v_user FROM public.orders o WHERE o.id = p_id;
  ELSIF p_kind = 'user' THEN
    v_user := p_id;
  ELSIF p_kind = 'rsvp_guest' THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND rsvp_guest_id = p_id;
    RETURN v;
  END IF;
  IF v_user IS NOT NULL THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND user_id = v_user;
  END IF;
  RETURN v;
END;
$fn$;

-- MINGLA-INVARIANT: I-4514-ONE-PERSON-ONE-RESPONSE | issue #4514 | the write path (brand_form_submit_core) and every read path find a person's existing answer with this one rule, lock on the person, and update that row rather than insert a second one (pg17 T-PERSON).
-- The same person's existing response to a form, for every path (read and write):
-- an RSVP or order finds its own row, else its holder's signed-in row
-- (brand_form_find_response); a signed-in user on a page finds, in order, their
-- RSVP's row at that page, their paid order's row at that page, then their own row.
CREATE FUNCTION public.brand_form_person_response(p_form_id uuid, p_kind text, p_id uuid, p_event_id uuid)
RETURNS public.brand_form_responses
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v public.brand_form_responses;
  v_rsvp uuid;
  v_order uuid;
BEGIN
  IF p_kind <> 'user' OR p_event_id IS NULL THEN
    RETURN public.brand_form_find_response(p_form_id, p_kind, p_id);
  END IF;
  SELECT r.id INTO v_rsvp FROM public.event_rsvps r WHERE r.event_id = p_event_id AND r.user_id = p_id
   ORDER BY r.created_at DESC LIMIT 1;
  IF v_rsvp IS NOT NULL THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND rsvp_id = v_rsvp;
    IF FOUND THEN RETURN v; END IF;
  END IF;
  SELECT o.id INTO v_order FROM public.orders o WHERE o.event_id = p_event_id AND o.buyer_user_id = p_id
     AND o.payment_status IN ('paid', 'partial_refund') ORDER BY o.created_at DESC LIMIT 1;
  IF v_order IS NOT NULL THEN
    SELECT * INTO v FROM public.brand_form_responses WHERE form_id = p_form_id AND order_id = v_order;
    IF FOUND THEN RETURN v; END IF;
  END IF;
  RETURN public.brand_form_find_response(p_form_id, 'user', p_id);
END;
$fn$;

-- The advisory-lock key for one person and one form: the signed-in user behind
-- the subject when there is one (so an RSVP, an order and a signed-in answer by
-- the same user serialise), else the subject itself.
CREATE FUNCTION public.brand_form_person_lock_key(p_form_id uuid, p_kind text, p_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT hashtextextended('brand_form_person:' || p_form_id::text || ':' || COALESCE(
    'user:' || (CASE p_kind
      WHEN 'user' THEN p_id
      WHEN 'rsvp' THEN (SELECT r.user_id FROM public.event_rsvps r WHERE r.id = p_id)
      WHEN 'order' THEN (SELECT o.buyer_user_id FROM public.orders o WHERE o.id = p_id)
      ELSE NULL END)::text,
    p_kind || ':' || p_id::text), 0);
$fn$;

-- The event's active attachment with its form, when that form has a live version.
CREATE FUNCTION public.brand_form_active_for_event(p_event_id uuid)
RETURNS TABLE (attachment_id uuid, form_id uuid, mode text, auto_remind boolean,
               form_status text, live_version_id uuid, form_name text, brand_id uuid,
               door_full_answers boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT a.id, f.id, a.mode, a.auto_remind, f.status, f.live_version_id, f.name, f.brand_id, f.door_full_answers
    FROM public.brand_form_attachments a
    JOIN public.brand_forms f ON f.id = a.form_id
    JOIN public.events e ON e.id = a.event_id
   WHERE a.event_id = p_event_id AND a.detached_at IS NULL
     AND f.live_version_id IS NOT NULL AND f.status IN ('live', 'closed')
     AND f.brand_id = e.brand_id;
$fn$;

-- One answer as door/display text, using the version it was given against.
CREATE FUNCTION public.brand_form_answer_text(p_question jsonb, p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN NULL
    WHEN p_question->>'type' = 'single_choice' THEN
      (SELECT o.value->>'label' FROM jsonb_array_elements(p_question->'options') o
        WHERE o.value->>'id' = p_value #>> '{}' LIMIT 1)
    WHEN p_question->>'type' = 'multi_choice' AND jsonb_typeof(p_value) = 'array' THEN
      (SELECT string_agg(o.value->>'label', ', ' ORDER BY o.ordinality)
         FROM jsonb_array_elements(p_question->'options') WITH ORDINALITY o
        WHERE p_value ? (o.value->>'id'))
    ELSE p_value #>> '{}'
  END;
$fn$;

CREATE FUNCTION public.brand_form_cut(p_text text, p_max integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_text IS NULL THEN NULL
              WHEN char_length(p_text) <= p_max THEN p_text
              ELSE rtrim(left(p_text, p_max - 1)) || '…' END;
$fn$;

-- Service-role wrapper: validate answers against one stored version.
CREATE FUNCTION public.brand_form_validate_answers(p_version_id uuid, p_answers jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_def jsonb;
BEGIN
  SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public.brand_form_check_answers(v_def, p_answers);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Host RPCs
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.brand_form_require_rank(p_brand_id uuid, p_role text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR p_brand_id IS NULL
     OR public.biz_brand_effective_rank(p_brand_id, auth.uid()) < public.biz_role_rank(p_role) THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_create(p_brand_id uuid, p_name text, p_draft jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_draft jsonb := COALESCE(p_draft, jsonb_build_object('schema', 'mingla.brand_form.v1', 'title', '', 'questions', '[]'::jsonb));
  v_errors jsonb;
  v_id uuid;
BEGIN
  PERFORM public.brand_form_require_rank(p_brand_id, 'marketing_manager');
  IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'name_invalid' USING ERRCODE = '22023';
  END IF;
  v_errors := public.brand_form_definition_errors(v_draft);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid_definition' USING ERRCODE = '22023', DETAIL = v_errors::text;
  END IF;
  INSERT INTO public.brand_forms (brand_id, name, draft, created_by, updated_by)
  VALUES (p_brand_id, btrim(p_name), v_draft, auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('formId', v_id, 'draftRev', 1, 'status', 'draft');
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_save_draft(p_form_id uuid, p_draft jsonb, p_draft_rev integer, p_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_errors jsonb;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF v_f.status = 'archived' THEN RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023'; END IF;
  IF v_f.draft_rev IS DISTINCT FROM p_draft_rev THEN
    RAISE EXCEPTION 'form_draft_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('draftRev', v_f.draft_rev)::text;
  END IF;
  IF p_name IS NOT NULL AND char_length(btrim(p_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'name_invalid' USING ERRCODE = '22023';
  END IF;
  v_errors := public.brand_form_definition_errors(p_draft);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid_definition' USING ERRCODE = '22023', DETAIL = v_errors::text;
  END IF;
  UPDATE public.brand_forms
     SET draft = p_draft, draft_rev = draft_rev + 1, name = COALESCE(btrim(p_name), name),
         updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('draftRev', v_f.draft_rev + 1);
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_publish(p_form_id uuid, p_draft_rev integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_errors jsonb;
  v_version integer;
  v_vid uuid;
  v_status text;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF v_f.status = 'archived' THEN RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023'; END IF;
  IF v_f.draft_rev IS DISTINCT FROM p_draft_rev THEN
    RAISE EXCEPTION 'form_draft_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('draftRev', v_f.draft_rev)::text;
  END IF;
  v_errors := public.brand_form_definition_errors(v_f.draft);
  IF jsonb_array_length(COALESCE(v_f.draft->'questions', '[]'::jsonb)) = 0 THEN
    v_errors := v_errors || jsonb_build_object('path', 'questions', 'code', 'no_questions');
  END IF;
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid_definition' USING ERRCODE = '22023', DETAIL = v_errors::text;
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM public.brand_form_versions WHERE form_id = p_form_id;
  INSERT INTO public.brand_form_versions (form_id, version, definition, definition_sha256, published_by)
  VALUES (p_form_id, v_version, v_f.draft, encode(sha256(convert_to(v_f.draft::text, 'UTF8')), 'hex'), auth.uid())
  RETURNING id INTO v_vid;
  -- A closed form stays closed when its changes are published.
  v_status := CASE WHEN v_f.status = 'closed' THEN 'closed' ELSE 'live' END;
  UPDATE public.brand_forms
     SET status = v_status, live_version_id = v_vid, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('versionId', v_vid, 'version', v_version, 'status', v_status,
    -- C12: the client offers "Ask earlier guests?" for each live page with guests.
    'attachedEventIds', COALESCE((SELECT jsonb_agg(a.event_id) FROM public.brand_form_attachments a
                                   WHERE a.form_id = p_form_id AND a.detached_at IS NULL), '[]'::jsonb),
    -- Wave 3: per live page, the guests who signed up and have not answered.
    'earlierGuests', CASE WHEN v_status = 'live' THEN public.brand_form_earlier_guests(p_form_id) ELSE '[]'::jsonb END);
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_close(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_f public.brand_forms;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF v_f.status <> 'live' THEN RAISE EXCEPTION 'form_not_live' USING ERRCODE = '22023'; END IF;
  UPDATE public.brand_forms SET status = 'closed', closed_at = now(), updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('status', 'closed');
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_reopen(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_f public.brand_forms;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF v_f.status <> 'closed' THEN RAISE EXCEPTION 'form_not_closed' USING ERRCODE = '22023'; END IF;
  UPDATE public.brand_forms SET status = 'live', closed_at = NULL, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('status', 'live');
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_archive(p_form_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_f public.brand_forms;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF v_f.status = 'archived' THEN RETURN jsonb_build_object('status', 'archived'); END IF;
  -- Removing a form from a page is an event-manager action; archiving never does it silently.
  IF EXISTS (SELECT 1 FROM public.brand_form_attachments a WHERE a.form_id = p_form_id AND a.detached_at IS NULL) THEN
    RAISE EXCEPTION 'form_attached' USING ERRCODE = '22023';
  END IF;
  UPDATE public.brand_forms SET status = 'archived', archived_at = now(), closed_at = NULL,
         updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('status', 'archived');
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_set_door_full_answers(p_form_id uuid, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_f public.brand_forms;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF p_on IS NULL THEN RAISE EXCEPTION 'value_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.brand_forms SET door_full_answers = p_on, updated_by = auth.uid(), updated_at = now()
   WHERE id = p_form_id;
  RETURN jsonb_build_object('doorFullAnswers', p_on);
END;
$fn$;

-- Attach (event_manager+). Replaces the event's active attachment. p_expected_attachment_id
-- is the attachment the caller saw on the page (null: none); a different one raises PT409.
CREATE FUNCTION public.biz_brand_form_attach(
  p_form_id uuid, p_event_id uuid, p_mode text, p_auto_remind boolean DEFAULT false,
  p_expected_attachment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_e record;
  v_current uuid;
  v_id uuid;
  v_guests integer;
BEGIN
  SELECT e.id, e.brand_id, e.event_type, e.deleted_at INTO v_e FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_e.brand_id, 'event_manager');
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id;
  IF NOT FOUND OR v_f.brand_id <> v_e.brand_id THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'archived' THEN RAISE EXCEPTION 'form_archived' USING ERRCODE = '22023'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('optional_on_page', 'required_step', 'after_purchase') THEN
    RAISE EXCEPTION 'mode_invalid' USING ERRCODE = '22023';
  END IF;
  -- Trips keep their existing questions step until the trip slice.
  IF v_e.event_type = 'trip' AND p_mode IN ('optional_on_page', 'required_step') THEN
    RAISE EXCEPTION 'trip_uses_intake' USING ERRCODE = '22023';
  END IF;
  SELECT a.id INTO v_current FROM public.brand_form_attachments a
   WHERE a.event_id = p_event_id AND a.detached_at IS NULL FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_attachment_id THEN
    RAISE EXCEPTION 'attachment_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('attachmentId', v_current)::text;
  END IF;
  IF v_current IS NOT NULL THEN
    UPDATE public.brand_form_attachments SET detached_at = now(), detached_by = auth.uid() WHERE id = v_current;
  END IF;
  INSERT INTO public.brand_form_attachments (form_id, brand_id, event_id, mode, auto_remind, created_by)
  VALUES (p_form_id, v_e.brand_id, p_event_id, p_mode, COALESCE(p_auto_remind, false), auth.uid())
  RETURNING id INTO v_id;
  -- For the "Ask earlier guests?" prompt (§4.6): people already signed up.
  SELECT (SELECT count(*) FROM public.event_rsvps r WHERE r.event_id = p_event_id AND r.rsvp_status = 'going')
       + (SELECT count(*) FROM public.orders o WHERE o.event_id = p_event_id AND o.payment_status IN ('paid', 'partial_refund'))
    INTO v_guests;
  RETURN jsonb_build_object('attachmentId', v_id, 'mode', p_mode, 'autoRemind', COALESCE(p_auto_remind, false),
    'autoRemindChannels', (SELECT to_jsonb(a.auto_remind_channels) FROM public.brand_form_attachments a WHERE a.id = v_id),
    'formStatus', v_f.status, 'replacedAttachmentId', v_current, 'existingGuests', v_guests,
    -- Wave 3 (C12): signed up and not answered; only a live form asks anyone.
    'earlierGuests', CASE WHEN v_f.status = 'live'
                          THEN COALESCE((SELECT (g->>'count')::integer FROM jsonb_array_elements(
                                 public.brand_form_earlier_guests(p_form_id, p_event_id)) g), 0)
                          ELSE 0 END);
END;
$fn$;

CREATE FUNCTION public.biz_brand_form_detach(p_attachment_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_a public.brand_form_attachments;
BEGIN
  SELECT * INTO v_a FROM public.brand_form_attachments WHERE id = p_attachment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_a.brand_id, 'event_manager');
  IF v_a.detached_at IS NULL THEN
    UPDATE public.brand_form_attachments SET detached_at = now(), detached_by = auth.uid() WHERE id = p_attachment_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- Responses that belong to one event (by page, RSVP, order, or a holder's own response).
CREATE FUNCTION public.brand_form_event_responses(p_form_id uuid, p_event_id uuid)
RETURNS SETOF public.brand_form_responses
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT r.* FROM public.brand_form_responses r
   WHERE r.form_id = p_form_id
     AND (p_event_id IS NULL
       OR r.event_id = p_event_id
       OR EXISTS (SELECT 1 FROM public.event_rsvps x WHERE x.id = r.rsvp_id AND x.event_id = p_event_id)
       OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = r.order_id AND o.event_id = p_event_id)
       OR (r.user_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.event_rsvps x WHERE x.event_id = p_event_id AND x.user_id = r.user_id AND x.rsvp_status = 'going')
         OR EXISTS (SELECT 1 FROM public.orders o WHERE o.event_id = p_event_id AND o.buyer_user_id = r.user_id
                      AND o.payment_status IN ('paid', 'partial_refund')))));
$fn$;

-- Responses page (marketing_manager+). p_filter: 'all' | 'earlier_version'. Counts per
-- option are computed from the same rows as the list (before paging). Names only:
-- contact columns stay with the roster export (event_manager+).
CREATE FUNCTION public.biz_brand_form_responses(
  p_form_id uuid, p_event_id uuid DEFAULT NULL, p_filter text DEFAULT 'all',
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_live jsonb;
  v_rows jsonb;
  v_counts jsonb;
  v_total integer;
  v_versions jsonb;
  v_not jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'marketing_manager');
  IF p_event_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_f.brand_id) THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_filter, 'all') NOT IN ('all', 'earlier_version') THEN
    RAISE EXCEPTION 'filter_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT v.definition INTO v_live FROM public.brand_form_versions v WHERE v.id = v_f.live_version_id;

  SELECT count(*) INTO v_total
    FROM public.brand_form_event_responses(p_form_id, p_event_id) r
   WHERE COALESCE(p_filter, 'all') = 'all' OR r.version_id IS DISTINCT FROM v_f.live_version_id;

  -- Per option: {questionId: {optionId: n}} over every row in scope.
  SELECT COALESCE(jsonb_object_agg(q.qid, q.opts), '{}'::jsonb) INTO v_counts
    FROM (
      SELECT c.qid, jsonb_object_agg(c.oid, c.n) AS opts
        FROM (
          SELECT a.key AS qid, x.oid, count(*) AS n
            FROM (SELECT x.* FROM public.brand_form_event_responses(p_form_id, p_event_id) x WHERE COALESCE(p_filter, 'all') = 'all' OR x.version_id IS DISTINCT FROM v_f.live_version_id) r
            CROSS JOIN LATERAL jsonb_each(r.answers) a
            CROSS JOIN LATERAL (
              SELECT a.value #>> '{}' AS oid WHERE jsonb_typeof(a.value) = 'string'
              UNION ALL
              SELECT e.value #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.value) = 'array' THEN a.value ELSE '[]'::jsonb END) e
            ) x
            JOIN public.brand_form_versions v ON v.id = r.version_id
           WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'questions') q
                          WHERE q.value->>'id' = a.key AND q.value->>'type' IN ('single_choice', 'multi_choice'))
           GROUP BY a.key, x.oid
        ) c GROUP BY c.qid
    ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'responseId', r.id, 'versionId', r.version_id, 'version', v.version,
           'earlierVersion', r.version_id IS DISTINCT FROM v_f.live_version_id,
           'answers', r.answers, 'source', r.source, 'verified', r.verified, 'viaLink', r.via_link,
           'editCount', r.edit_count, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at,
           'subject', CASE
              WHEN r.rsvp_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp', 'id', r.rsvp_id,
                     'name', (SELECT x.guest_name FROM public.event_rsvps x WHERE x.id = r.rsvp_id))
              WHEN r.order_id IS NOT NULL THEN jsonb_build_object('kind', 'order', 'id', r.order_id,
                     'name', (SELECT o.buyer_name FROM public.orders o WHERE o.id = r.order_id))
              WHEN r.user_id IS NOT NULL THEN jsonb_build_object('kind', 'user', 'id', r.user_id)
              WHEN r.rsvp_guest_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp_guest', 'id', r.rsvp_guest_id)
              ELSE jsonb_build_object('kind', 'contact', 'name', r.contact_name) END,
           -- Wave 3: a signed-in answer, tied to the person's RSVP or order at this page,
           -- so the guest list can show it on that guest (ids only; names stay as above).
           'holder', CASE WHEN p_event_id IS NOT NULL AND r.user_id IS NOT NULL THEN jsonb_build_object(
              'rsvpId', (SELECT x.id FROM public.event_rsvps x WHERE x.event_id = p_event_id AND x.user_id = r.user_id
                          ORDER BY x.created_at DESC LIMIT 1),
              'orderIds', COALESCE((SELECT jsonb_agg(o.id ORDER BY o.created_at) FROM public.orders o
                          WHERE o.event_id = p_event_id AND o.buyer_user_id = r.user_id
                            AND o.payment_status IN ('paid', 'partial_refund')), '[]'::jsonb)) END
         ) ORDER BY r.updated_at DESC, r.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT * FROM (SELECT x.* FROM public.brand_form_event_responses(p_form_id, p_event_id) x WHERE COALESCE(p_filter, 'all') = 'all' OR x.version_id IS DISTINCT FROM v_f.live_version_id) s ORDER BY updated_at DESC, id
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) r
    JOIN public.brand_form_versions v ON v.id = r.version_id;

  -- Not answered: going RSVPs and live orders of the event with no response.
  IF p_event_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(n.item ORDER BY n.at), '[]'::jsonb) INTO v_not
      FROM (
        SELECT jsonb_build_object('kind', 'rsvp', 'id', x.id, 'name', x.guest_name, 'addedByHost', false) AS item, x.created_at AS at
          FROM public.event_rsvps x
         WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
           AND (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'order', 'id', o.id, 'name', o.buyer_name,
                 'addedByHost', o.source IN ('door_sale', 'manual_import') OR o.is_door_sale), o.created_at
          FROM public.orders o
         WHERE o.event_id = p_event_id AND o.payment_status IN ('paid', 'partial_refund')
           AND (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NULL
      ) n;
  END IF;

  SELECT COALESCE(jsonb_object_agg(v.id, jsonb_build_object('version', v.version, 'definition', v.definition)), '{}'::jsonb)
    INTO v_versions FROM public.brand_form_versions v WHERE v.form_id = p_form_id;

  RETURN jsonb_build_object(
    'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
              'liveVersionId', v_f.live_version_id, 'doorFullAnswers', v_f.door_full_answers),
    'mode', (SELECT a.mode FROM public.brand_form_attachments a
              WHERE a.form_id = p_form_id AND a.event_id = p_event_id AND a.detached_at IS NULL),
    'versions', v_versions, 'total', v_total, 'answeredCount', v_total,
    'counts', v_counts, 'rows', v_rows, 'notAnswered', v_not);
END;
$fn$;

-- Export feed (event_manager+, C5): one column per question per version, for the
-- existing roster export. Values are display text.
CREATE FUNCTION public.biz_brand_form_responses_export(p_form_id uuid, p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_cols jsonb;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_f.brand_id, 'event_manager');
  IF p_event_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_f.brand_id AND e.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', v.version || ':' || (q.value->>'id'),
           'versionId', v.id, 'version', v.version, 'questionId', q.value->>'id',
           'label', q.value->>'label', 'type', q.value->>'type')
           ORDER BY v.version, (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_cols
    FROM public.brand_form_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
   WHERE v.form_id = p_form_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'responseId', r.id, 'rsvpId', r.rsvp_id, 'orderId', r.order_id, 'userId', r.user_id,
           'rsvpGuestId', r.rsvp_guest_id, 'version', v.version, 'submittedAt', r.submitted_at,
           'updatedAt', r.updated_at, 'verified', r.verified,
           'values', (SELECT COALESCE(jsonb_object_agg(v.version || ':' || (q.value->>'id'),
                        public.brand_form_answer_text(q.value, r.answers->(q.value->>'id'))), '{}'::jsonb)
                        FROM jsonb_array_elements(v.definition->'questions') q
                       WHERE r.answers ? (q.value->>'id'))
         ) ORDER BY r.submitted_at, r.id), '[]'::jsonb)
    INTO v_rows
    FROM public.brand_form_event_responses(p_form_id, p_event_id) r
    JOIN public.brand_form_versions v ON v.id = r.version_id;
  RETURN jsonb_build_object('formId', p_form_id, 'eventId', p_event_id, 'columns', v_cols, 'rows', v_rows);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 9. Public and guest reads
-- ---------------------------------------------------------------------------
-- The form on a public page, with the brand header (§3.4, C7). Never responses or counts.
-- The page's form as a buyer reads it (§3.4): the mode, the form name and
-- question count, the definition and required form for the on-page modes, the
-- door switch and the brand header. Never responses or counts. ONE owner of this
-- shape: the public read below and the checkout read (brand_form_checkout_form,
-- wave 5) both return it, each after its own visibility rule.
CREATE FUNCTION public.brand_form_page_form(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record;
  v_def jsonb;
BEGIN
  -- OP-7 / C8: switched off, nothing is asked and nothing blocks.
  IF public.brand_forms_switched_off() THEN
    RETURN jsonb_build_object('active', false, 'switchedOff', true);
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND OR v_a.form_status <> 'live' THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_a.live_version_id;
  RETURN jsonb_build_object(
    'active', true, 'mode', v_a.mode, 'formId', v_a.form_id, 'name', v_a.form_name,
    'questionCount', jsonb_array_length(v_def->'questions'),
    'versionId', CASE WHEN v_a.mode <> 'after_purchase' THEN v_a.live_version_id END,
    'definition', CASE WHEN v_a.mode <> 'after_purchase' THEN v_def END,
    'requiredForm', CASE WHEN v_a.mode = 'required_step'
                     THEN jsonb_build_object('formId', v_a.form_id, 'versionId', v_a.live_version_id) END,
    'doorFullAnswers', v_a.door_full_answers,
    'brand', public.brand_form_brand_header(v_a.brand_id));
END;
$fn$;

CREATE FUNCTION public.public_brand_form_for_event(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- Nothing for a page that is not publicly visible (private, draft, deleted, ended).
  IF NOT public.brand_form_event_public(p_event_id) THEN RETURN jsonb_build_object('active', false); END IF;
  RETURN public.brand_form_page_form(p_event_id);
END;
$fn$;

-- A consumed one-time code for this link within the last 30 minutes.
CREATE FUNCTION public.brand_form_code_grant_ok(p_link_id uuid, p_challenge_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF p_challenge_id IS NULL OR p_link_id IS NULL OR to_regclass('public.contact_challenges') IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.contact_challenges c
                  WHERE c.id = p_challenge_id AND c.purpose = 'brand_form_access'
                    AND c.brand_form_link_id = p_link_id
                    AND c.consumed_at IS NOT NULL AND c.consumed_at > now() - interval '30 minutes');
END;
$fn$;

-- A personal link by raw token: the link row, or null.
CREATE FUNCTION public.brand_form_link_by_token(p_token text) RETURNS public.brand_form_links
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT l.* FROM public.brand_form_links l
   WHERE p_token IS NOT NULL AND char_length(p_token) BETWEEN 32 AND 128
     AND l.token_hash = public.brand_form_token_hash(p_token);
$fn$;

CREATE FUNCTION public.brand_form_link_subject(p_link public.brand_form_links) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_link.rsvp_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp', 'id', p_link.rsvp_id)
    WHEN p_link.order_id IS NOT NULL THEN jsonb_build_object('kind', 'order', 'id', p_link.order_id)
    WHEN p_link.user_id IS NOT NULL THEN jsonb_build_object('kind', 'user', 'id', p_link.user_id)
    WHEN p_link.rsvp_guest_id IS NOT NULL THEN jsonb_build_object('kind', 'rsvp_guest', 'id', p_link.rsvp_guest_id)
    ELSE NULL END;
$fn$;

-- The person a subject names: {name, email, phone} (contact on file). Server only.
CREATE FUNCTION public.brand_form_subject_contact(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE p_kind
    WHEN 'rsvp' THEN (SELECT jsonb_build_object('name', r.guest_name,
                        'email', NULLIF(lower(btrim(r.guest_email)), ''),
                        'phone', CASE WHEN btrim(r.guest_phone) ~ '^\+[1-9][0-9]{6,14}$' THEN btrim(r.guest_phone) END)
                        FROM public.event_rsvps r WHERE r.id = p_id)
    WHEN 'order' THEN (SELECT jsonb_build_object('name', o.buyer_name,
                         'email', NULLIF(lower(btrim(o.buyer_email)), ''),
                         'phone', CASE WHEN o.buyer_phone_e164 ~ '^\+[1-9][0-9]{6,14}$' THEN o.buyer_phone_e164 END)
                         FROM public.orders o WHERE o.id = p_id)
    WHEN 'user' THEN (SELECT jsonb_build_object(
                        'name', COALESCE(NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name),
                        'email', NULLIF(lower(btrim(COALESCE(pr.email, u.email))), ''),
                        'phone', CASE WHEN btrim(pr.phone) ~ '^\+[1-9][0-9]{6,14}$' THEN btrim(pr.phone) END)
                        FROM auth.users u LEFT JOIN public.profiles pr ON pr.id = u.id WHERE u.id = p_id)
    ELSE NULL END;
$fn$;

-- The guest's own response (§3.5): by personal link (+ one-time code for an
-- existing answer, or after recognition ends, C2), or by sign-in.
CREATE FUNCTION public.brand_form_my_response(
  p_form_id uuid, p_event_id uuid DEFAULT NULL, p_token text DEFAULT NULL, p_challenge_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_link public.brand_form_links;
  v_subject jsonb;
  v_resp public.brand_form_responses;
  v_def jsonb;
  v_state text;
  v_identity text;
  v_uid uuid := auth.uid();
  v_event uuid := p_event_id;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id AND status IN ('live', 'closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_f.live_version_id;

  IF p_token IS NOT NULL THEN
    v_link := public.brand_form_link_by_token(p_token);
    IF v_link.id IS NULL OR v_link.form_id <> p_form_id THEN
      RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501';
    END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    v_subject := public.brand_form_link_subject(v_link);
    IF v_subject IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    -- The same person rule as the write path (I-4514-ONE-PERSON-ONE-RESPONSE).
    v_resp := public.brand_form_person_response(p_form_id, v_subject->>'kind', (v_subject->>'id')::uuid, v_link.event_id);
    v_identity := public.brand_form_short_name(public.brand_form_subject_contact(v_subject->>'kind', (v_subject->>'id')::uuid)->>'name');
    v_event := COALESCE(v_link.event_id, v_event);
    IF (v_resp.id IS NOT NULL OR v_link.expires_at <= now())
       AND NOT public.brand_form_code_grant_ok(v_link.id, p_challenge_id) THEN
      -- A forwarded link never reveals an existing answer.
      RETURN jsonb_build_object('state', 'code_required', 'answered', v_resp.id IS NOT NULL,
        'recognized', v_link.expires_at > now(), 'identity', v_identity,
        'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status),
        'brand', public.brand_form_brand_header(v_f.brand_id));
    END IF;
  ELSIF v_uid IS NOT NULL THEN
    v_resp := public.brand_form_person_response(p_form_id, 'user', v_uid, v_event);
    -- The questions go only to a caller with a real relation to this form: their
    -- own answer; or a page that carries the form where they hold an RSVP, a paid
    -- order or a ticket; or a publicly visible page offering it as optional.
    IF v_resp.id IS NULL AND NOT (v_event IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.brand_form_attachments a
          WHERE a.event_id = v_event AND a.form_id = p_form_id AND a.detached_at IS NULL
            AND (EXISTS (SELECT 1 FROM public.event_rsvps r
                          WHERE r.event_id = v_event AND r.user_id = v_uid AND r.rsvp_status = 'going')
              OR EXISTS (SELECT 1 FROM public.orders o
                          WHERE o.event_id = v_event AND o.buyer_user_id = v_uid
                            AND o.payment_status IN ('paid', 'partial_refund'))
              OR EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_event AND t.holder_user_id = v_uid AND t.status IN ('valid', 'used'))
              OR (a.mode = 'optional_on_page' AND public.brand_form_event_public(v_event))))) THEN
      RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;

  v_state := CASE WHEN v_resp.id IS NULL THEN 'unanswered' ELSE 'answered' END;
  RETURN jsonb_build_object(
    'state', v_state, 'identity', v_identity, 'recognized', true,
    'form', jsonb_build_object('id', v_f.id, 'name', v_f.name, 'status', v_f.status,
              'versionId', v_f.live_version_id, 'definition', v_def, 'doorFullAnswers', v_f.door_full_answers),
    'eventId', v_event,
    'brand', public.brand_form_brand_header(v_f.brand_id),
    'response', CASE WHEN v_resp.id IS NULL THEN NULL ELSE jsonb_build_object(
       'id', v_resp.id, 'versionId', v_resp.version_id,
       'definition', (SELECT v.definition FROM public.brand_form_versions v WHERE v.id = v_resp.version_id),
       'isCurrentVersion', v_resp.version_id = v_f.live_version_id,
       'answers', v_resp.answers, 'editCount', v_resp.edit_count, 'updatedAt', v_resp.updated_at) END);
END;
$fn$;

-- Pending or editable forms for every item the signed-in caller holds, in one call.
CREATE FUNCTION public.brand_forms_my_pending() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  IF public.brand_forms_switched_off() THEN RETURN '[]'::jsonb; END IF;
  WITH held AS (
    SELECT r.event_id, 'rsvp'::text AS kind, r.id AS subject_id FROM public.event_rsvps r
     WHERE r.user_id = v_uid AND r.rsvp_status = 'going'
    UNION ALL
    SELECT o.event_id, 'order', o.id FROM public.orders o
     WHERE o.buyer_user_id = v_uid AND o.payment_status IN ('paid', 'partial_refund')
  ), items AS (
    SELECT DISTINCT ON (h.event_id) h.event_id, h.kind, h.subject_id, a.*
      FROM held h
      JOIN public.events e ON e.id = h.event_id AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
      CROSS JOIN LATERAL public.brand_form_active_for_event(h.event_id) a
     ORDER BY h.event_id, h.kind
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'eventId', i.event_id,
           'eventTitle', (SELECT e.title FROM public.events e WHERE e.id = i.event_id),
           'subject', jsonb_build_object('kind', i.kind, 'id', i.subject_id),
           'attachmentId', i.attachment_id, 'mode', i.mode, 'required', i.mode = 'required_step',
           'formId', i.form_id, 'formName', i.form_name, 'formStatus', i.form_status,
           'versionId', i.live_version_id, 'doorFullAnswers', i.door_full_answers,
           'answered', resp.id IS NOT NULL, 'responseId', resp.id,
           'answeredVersionId', resp.version_id, 'answeredSource', resp.source,
           'brand', public.brand_form_brand_header(i.brand_id)) ORDER BY i.event_id), '[]'::jsonb)
    INTO v_out
    FROM items i
    CROSS JOIN LATERAL (SELECT (public.brand_form_find_response(i.form_id, i.kind, i.subject_id)).*) resp
   -- A closed form shows only when this person answered it ("Answers closed · View").
   WHERE i.form_status = 'live' OR resp.id IS NOT NULL;
  RETURN v_out;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Personal links (service role)
-- ---------------------------------------------------------------------------
-- MINGLA-INVARIANT: I-4514-FORM-LINK-ONE-FORM-ONE-RECIPIENT | issue #4514 | a personal link token is stored only as a hash, names one form and one person, and is refused on any other form (brand_form_submit_core; Deno test in brand-form-submit, pg17 T-LINK).
CREATE FUNCTION public.brand_form_link_issue(
  p_form_id uuid, p_event_id uuid, p_subject jsonb, p_created_by uuid DEFAULT NULL, p_ttl_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_f public.brand_forms;
  v_kind text := p_subject->>'kind';
  v_id uuid;
  v_event uuid;
  v_token text;
  v_link uuid;
  v_exp timestamptz;
  v_att uuid;
BEGIN
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id AND status IN ('live', 'closed');
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'order', 'user') OR COALESCE(p_subject->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_id := (p_subject->>'id')::uuid;
  IF v_kind IN ('rsvp', 'order') THEN
    v_event := public.brand_form_subject_event(v_kind, v_id);
    IF v_event IS NULL OR v_event IS DISTINCT FROM p_event_id THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_id) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_event_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_f.brand_id) THEN
      RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
    END IF;
    SELECT a.id INTO v_att FROM public.brand_form_attachments a
     WHERE a.event_id = p_event_id AND a.form_id = p_form_id AND a.detached_at IS NULL;
    IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  END IF;
  -- 244 random bits (two v4 UUIDs); only the hash is stored.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => LEAST(GREATEST(COALESCE(p_ttl_days, 30), 1), 30));
  INSERT INTO public.brand_form_links (form_id, attachment_id, event_id, kind, rsvp_id, order_id, user_id,
                                       token_hash, expires_at, created_by)
  VALUES (p_form_id, v_att, p_event_id, 'person',
          CASE WHEN v_kind = 'rsvp' THEN v_id END, CASE WHEN v_kind = 'order' THEN v_id END,
          CASE WHEN v_kind = 'user' THEN v_id END,
          public.brand_form_token_hash(v_token), v_exp, p_created_by)
  RETURNING id INTO v_link;
  RETURN jsonb_build_object('linkId', v_link, 'token', v_token, 'expiresAt', v_exp, 'formId', p_form_id);
END;
$fn$;

CREATE FUNCTION public.brand_form_link_resolve(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_link public.brand_form_links;
  v_subject jsonb;
  v_contact jsonb;
  v_resp public.brand_form_responses;
BEGIN
  v_link := public.brand_form_link_by_token(p_token);
  IF v_link.id IS NULL THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  IF v_link.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'revoked'); END IF;
  v_subject := public.brand_form_link_subject(v_link);
  v_contact := public.brand_form_subject_contact(v_subject->>'kind', (v_subject->>'id')::uuid);
  v_resp := public.brand_form_person_response(v_link.form_id, v_subject->>'kind', (v_subject->>'id')::uuid, v_link.event_id);
  RETURN jsonb_build_object('outcome', 'ok', 'linkId', v_link.id, 'formId', v_link.form_id,
    'eventId', v_link.event_id, 'attachmentId', v_link.attachment_id, 'kind', v_link.kind,
    'subject', v_subject, 'recognized', v_link.expires_at > now(), 'answered', v_resp.id IS NOT NULL,
    'identity', public.brand_form_short_name(v_contact->>'name'),
    'channels', to_jsonb(array_remove(ARRAY[CASE WHEN v_contact->>'email' IS NOT NULL THEN 'email' END,
                                            CASE WHEN v_contact->>'phone' IS NOT NULL THEN 'phone' END], NULL)));
END;
$fn$;

-- One-time code (C2): start a challenge to the contact on file of the link's person.
-- The edge sends the code (email: it passes the code hash; phone: the provider's
-- verify service) and settles it with the existing issue_4063_settle_contact_challenge.
CREATE FUNCTION public.brand_form_code_begin(
  p_challenge_id uuid, p_token text, p_channel text, p_code_hash text, p_ip_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_link public.brand_form_links;
  v_subject jsonb;
  v_target text;
BEGIN
  IF to_regclass('public.contact_challenges') IS NULL THEN RETURN jsonb_build_object('outcome', 'unavailable'); END IF;
  IF p_challenge_id IS NULL OR p_channel NOT IN ('email', 'phone') THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  v_link := public.brand_form_link_by_token(p_token);
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.kind <> 'person' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  v_subject := public.brand_form_link_subject(v_link);
  -- A code is needed only to see or change an existing answer, or after the
  -- link's recognition period ends (C2). Otherwise no code is sent; the refusal
  -- has the same shape as every other one, so nothing is enumerable.
  IF v_link.expires_at > now()
     AND (public.brand_form_person_response(v_link.form_id, v_subject->>'kind',
            (v_subject->>'id')::uuid, v_link.event_id)).id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  v_target := public.brand_form_subject_contact(v_subject->>'kind', (v_subject->>'id')::uuid)->>p_channel;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('outcome', CASE WHEN p_channel = 'email' THEN 'no_email' ELSE 'no_phone' END);
  END IF;
  -- Per link, per address (form codes only, so form codes and the #4063 claim
  -- sign-ins never throttle each other), per contact per day, and the existing
  -- #4063 per-phone limit (2 texts to one number per 10 minutes, every purpose:
  -- it protects the number, whoever asks).
  IF (SELECT count(*) FROM public.contact_challenges c
       WHERE c.brand_form_link_id = v_link.id AND c.created_at > now() - interval '10 minutes') >= 3
     OR (p_ip_hash IS NOT NULL AND (SELECT count(*) FROM public.contact_challenges c
       WHERE c.ip_hash = p_ip_hash AND c.purpose = 'brand_form_access'
         AND c.created_at > now() - interval '10 minutes') >= 10)
     OR (SELECT count(*) FROM public.contact_challenges c
       WHERE c.target_value = v_target AND c.purpose = 'brand_form_access'
         AND c.created_at > now() - interval '24 hours') >= 20
     OR (p_channel = 'phone' AND (SELECT count(*) FROM public.contact_challenges c
       WHERE c.channel = 'phone' AND c.target_value = v_target
         AND c.created_at > now() - interval '10 minutes') >= 2) THEN
    RETURN jsonb_build_object('outcome', 'rate_limited');
  END IF;
  IF p_channel = 'email' AND NULLIF(btrim(COALESCE(p_code_hash, '')), '') IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  INSERT INTO public.contact_challenges (id, purpose, channel, target_value, code_hash, ip_hash, brand_form_link_id)
  VALUES (p_challenge_id, 'brand_form_access', p_channel, v_target,
          CASE WHEN p_channel = 'email' THEN p_code_hash END, p_ip_hash, v_link.id);
  -- target goes to the edge only (to send the code); never to a client.
  RETURN jsonb_build_object('outcome', 'started', 'challengeId', p_challenge_id, 'channel', p_channel, 'target', v_target);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('outcome', 'invalid');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 11. The submit core (service role; brand-form-submit is the only caller)
-- ---------------------------------------------------------------------------
-- p: {formId, versionId?, eventId?, answers, source, expectedEditCount?,
--     credential: {kind:'link', token, challengeId?} | {kind:'user', userId, rsvpId?, orderId?}}
-- Raises (message = code): forms_paused, form_not_found, form_not_live, form_closed,
-- form_changed (PT409), response_stale (PT409), form_answers_invalid (DETAIL errors),
-- link_invalid, link_wrong_form, link_revoked, code_required, not_holder,
-- form_not_on_event (also: a signed-in answer with no page that carries the form),
-- subject_unavailable, credential_invalid. The existing answer is found by the
-- person rule (brand_form_person_response), so a link and a sign-in by the same
-- person edit one row, and a link edit of any existing answer needs the code.
CREATE FUNCTION public.brand_form_submit_core(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_form_id uuid;
  v_f public.brand_forms;
  v_cred jsonb := p->'credential';
  v_link public.brand_form_links;
  v_kind text;
  v_sid uuid;
  v_user uuid;
  v_event uuid;
  v_att uuid;
  v_version uuid;
  v_check jsonb;
  v_existing public.brand_form_responses;
  v_source text := COALESCE(p->>'source', 'page');
  v_via_link boolean := false;
  v_id uuid;
  v_edit integer;
  v_expected integer;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF public.brand_forms_switched_off() THEN RAISE EXCEPTION 'forms_paused' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR COALESCE(p->>'formId', '') !~ v_uuid
     OR jsonb_typeof(v_cred) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN ('signup', 'page', 'link', 'pass', 'purchase_redirect', 'blast') THEN
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  v_form_id := (p->>'formId')::uuid;
  SELECT * INTO v_f FROM public.brand_forms WHERE id = v_form_id FOR SHARE;
  IF NOT FOUND OR v_f.status = 'archived' THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_f.status = 'draft' THEN RAISE EXCEPTION 'form_not_live' USING ERRCODE = '22023'; END IF;
  IF v_f.status = 'closed' THEN RAISE EXCEPTION 'form_closed' USING ERRCODE = '22023'; END IF;
  -- A newer published version: nothing is written.
  IF p ? 'versionId' AND jsonb_typeof(p->'versionId') <> 'null'
     AND (p->>'versionId') IS DISTINCT FROM v_f.live_version_id::text THEN
    RAISE EXCEPTION 'form_changed' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('versionId', v_f.live_version_id)::text;
  END IF;
  v_version := v_f.live_version_id;

  -- Who is answering.
  IF v_cred->>'kind' = 'link' THEN
    v_link := public.brand_form_link_by_token(v_cred->>'token');
    IF v_link.id IS NULL THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
    IF v_link.form_id <> v_form_id THEN RAISE EXCEPTION 'link_wrong_form' USING ERRCODE = '42501'; END IF;
    IF v_link.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'link_revoked' USING ERRCODE = '42501'; END IF;
    IF v_link.kind <> 'person' THEN RAISE EXCEPTION 'subject_unavailable' USING ERRCODE = '22023'; END IF;
    v_kind := public.brand_form_link_subject(v_link)->>'kind';
    v_sid := (public.brand_form_link_subject(v_link)->>'id')::uuid;
    v_event := v_link.event_id;
    v_via_link := true;
  ELSIF v_cred->>'kind' = 'user' THEN
    IF (v_cred->>'userId') !~ v_uuid THEN RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023'; END IF;
    v_user := (v_cred->>'userId')::uuid;
    IF (v_cred->>'rsvpId') ~ v_uuid THEN
      v_kind := 'rsvp'; v_sid := (v_cred->>'rsvpId')::uuid;
      SELECT r.event_id INTO v_event FROM public.event_rsvps r WHERE r.id = v_sid AND r.user_id = v_user;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
    ELSIF (v_cred->>'orderId') ~ v_uuid THEN
      v_kind := 'order'; v_sid := (v_cred->>'orderId')::uuid;
      SELECT o.event_id INTO v_event FROM public.orders o
       WHERE o.id = v_sid AND o.buyer_user_id = v_user AND o.payment_status IN ('paid', 'partial_refund');
      IF NOT FOUND THEN RAISE EXCEPTION 'not_holder' USING ERRCODE = '42501'; END IF;
    ELSE
      v_kind := 'user'; v_sid := v_user;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user) THEN
        RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
      END IF;
      IF (p->>'eventId') ~ v_uuid THEN v_event := (p->>'eventId')::uuid; END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'credential_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'order', 'user') THEN
    -- [TRANSITIONAL] plus-ones (rsvp_guest) answer after claiming: needs #4508's
    -- claimed_at; lifted in wave 5 once #4508 is on main.
    RAISE EXCEPTION 'subject_unavailable' USING ERRCODE = '22023';
  END IF;

  -- A signed-in answer is always for a page that carries this form: no page, no answer.
  IF NOT v_via_link AND v_event IS NULL THEN
    RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501';
  END IF;
  -- The answers must be for this event's form (form X's answers to event Y are refused).
  -- A personal link answers through its own page's attachment.
  IF v_event IS NOT NULL THEN
    SELECT a.id INTO v_att FROM public.brand_form_attachments a
     WHERE a.event_id = v_event AND a.form_id = v_form_id AND a.detached_at IS NULL;
    IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  END IF;

  -- One response per person per form (I-4514-ONE-PERSON-ONE-RESPONSE): lock on the
  -- person, then find their existing answer with the same rule every read path uses.
  PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_form_id, v_kind, v_sid));
  v_existing := public.brand_form_person_response(v_form_id, v_kind, v_sid, v_event);

  -- C2: through a link, an existing answer (or a link past recognition) needs the code.
  IF v_via_link AND (v_existing.id IS NOT NULL OR v_link.expires_at <= now())
     AND NOT public.brand_form_code_grant_ok(v_link.id,
           CASE WHEN (v_cred->>'challengeId') ~ v_uuid THEN (v_cred->>'challengeId')::uuid END) THEN
    RAISE EXCEPTION 'code_required' USING ERRCODE = '42501';
  END IF;
  -- Two devices: the edit must start from what is stored now (an expected count that
  -- is not a small whole number never matches, so it can never raise a cast error).
  v_expected := CASE WHEN jsonb_typeof(p->'expectedEditCount') = 'number'
                          AND (p->>'expectedEditCount') ~ '^[0-9]{1,9}$'
                     THEN (p->>'expectedEditCount')::integer
                     WHEN jsonb_typeof(p->'expectedEditCount') = 'number' THEN -1 END;
  IF (v_expected IS NOT NULL AND (v_existing.id IS NULL OR v_existing.edit_count <> v_expected))
     OR (v_expected IS NULL AND v_existing.id IS NOT NULL) THEN
    RAISE EXCEPTION 'response_stale' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('editCount', v_existing.edit_count)::text;
  END IF;

  -- Bad input is a validation error, never a server error: anything the
  -- validator could still raise on (a data exception) becomes form_answers_invalid.
  BEGIN
    v_check := public.brand_form_validate_answers(v_version, p->'answers');
  EXCEPTION WHEN data_exception THEN
    v_check := jsonb_build_object('ok', false,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type')));
  END;
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, attachment_id, event_id,
      rsvp_id, order_id, user_id, answers, source, via_link)
    VALUES (v_form_id, v_version, v_f.brand_id, v_att, v_event,
      CASE WHEN v_kind = 'rsvp' THEN v_sid END, CASE WHEN v_kind = 'order' THEN v_sid END,
      CASE WHEN v_kind = 'user' THEN v_sid END, v_check->'answers', v_source, v_via_link)
    RETURNING id, edit_count INTO v_id, v_edit;
  ELSE
    UPDATE public.brand_form_responses
       SET answers = v_check->'answers', version_id = v_version, edit_count = edit_count + 1,
           updated_at = now(), source = v_source, via_link = via_link OR v_via_link,
           attachment_id = COALESCE(v_att, attachment_id), event_id = COALESCE(event_id, v_event)
     WHERE id = v_existing.id
    RETURNING id, edit_count INTO v_id, v_edit;
  END IF;
  IF v_via_link THEN
    UPDATE public.brand_form_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link.id;
  END IF;
  RETURN jsonb_build_object('responseId', v_id, 'editCount', v_edit, 'versionId', v_version,
                            'created', v_existing.id IS NULL, 'eventId', v_event);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 12. Door reads (service role; called by the scan functions with the actor)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.brand_form_door_authority(p_actor_id uuid, p_event_id uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_brand uuid;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF v_brand IS NULL OR p_actor_id IS NULL OR NOT (
       public.issue_3827_can_door_scan(p_event_id, p_actor_id)
       OR public.biz_brand_effective_rank(v_brand, p_actor_id) >= public.biz_role_rank('event_manager')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.biz_brand_effective_rank(v_brand, p_actor_id);
END;
$fn$;

-- §6 / decision 15: the "From {first name} {initial}.'s order" header for a scanned
-- ticket that is not the buyer's own; null for the buyer's own ticket. The buyer's
-- own ticket is the one whose holder is the buyer (by user, else by holder or
-- attendee email); with no holder on the ticket, the order's first ticket. A ticket
-- sent to a friend (#4063, transfer_state 'claimed') is another ticket of the order.
CREATE FUNCTION public.brand_form_door_order_header(p_order_id uuid, p_ticket_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_ticket_id IS NULL OR EXISTS (
       SELECT 1 FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
        WHERE t.id = p_ticket_id AND t.order_id = p_order_id
          AND CASE
                WHEN t.holder_user_id IS NOT NULL THEN t.holder_user_id = o.buyer_user_id
                WHEN NULLIF(btrim(COALESCE(t.holder_email, t.attendee_email)), '') IS NOT NULL
                  THEN lower(btrim(COALESCE(t.holder_email, t.attendee_email))) = lower(btrim(COALESCE(o.buyer_email, '')))
                ELSE t.id = (SELECT t2.id FROM public.tickets t2 WHERE t2.order_id = o.id
                              ORDER BY t2.created_at, t2.id LIMIT 1)
              END) THEN NULL
    ELSE (SELECT public.brand_form_short_name(o.buyer_name) FROM public.orders o WHERE o.id = p_order_id) END;
$fn$;

-- The automatic line (§6): only questions marked "show at the door" in BOTH the
-- version answered and the current live version; null when there is nothing to show.
-- MINGLA-INVARIANT: I-4514-DOOR-READ-ONE-GUEST-OF-THIS-EVENT | issue #4514 | door reads take one guest of the scanned event per call, refuse another event's guest, show the marked line only (both-versions filter), and return full answers only when the form allows it or the caller is event_manager+ (pg17 T-DOOR*).
CREATE FUNCTION public.brand_form_door_answers(p_actor_id uuid, p_event_id uuid, p_subject jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_kind text := p_subject->>'kind';
  v_sid uuid;
  v_ticket uuid;
  v_a record;
  v_resp public.brand_form_responses;
  v_answered jsonb;
  v_live jsonb;
  v_items jsonb;
  v_added boolean := false;
  v_from text;
  v_rank integer;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_rank := public.brand_form_door_authority(p_actor_id, p_event_id);
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'order') OR COALESCE(p_subject->>'id', '') !~ v_uuid
     OR (p_subject ? 'ticketId' AND jsonb_typeof(p_subject->'ticketId') <> 'null'
         AND (v_kind <> 'order' OR COALESCE(p_subject->>'ticketId', '') !~ v_uuid)) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  -- The scanned ticket (optional): it must be a ticket of this order at this event.
  IF v_kind = 'order' AND (p_subject->>'ticketId') ~ v_uuid THEN
    v_ticket := (p_subject->>'ticketId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.id = v_ticket AND t.order_id = v_sid AND t.event_id = p_event_id) THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF public.brand_forms_switched_off() THEN RETURN NULL; END IF;
  -- A closed form keeps its answered line (hosts close before the event); only
  -- "Questions not answered" needs a live form.
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_resp := public.brand_form_find_response(v_a.form_id, v_kind, v_sid);
  -- A transferred ticket never shows the previous holder's (the order's) answer;
  -- its own holder's answer arrives with the ticket subject (OP-6, slice 2).
  IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
       WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
    v_resp := NULL;
  END IF;
  IF v_resp.id IS NULL THEN
    IF v_kind = 'order' THEN
      SELECT o.source IN ('door_sale', 'manual_import') OR COALESCE(o.is_door_sale, false) INTO v_added
        FROM public.orders o WHERE o.id = v_sid;
    END IF;
    -- "Questions not answered" only for a live required or after-purchase form,
    -- never for guests added by the host.
    IF v_a.form_status = 'live' AND v_a.mode IN ('required_step', 'after_purchase')
       AND NOT COALESCE(v_added, false) THEN
      RETURN jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name);
    END IF;
    RETURN NULL;
  END IF;
  SELECT v.definition INTO v_answered FROM public.brand_form_versions v WHERE v.id = v_resp.version_id;
  SELECT v.definition INTO v_live FROM public.brand_form_versions v WHERE v.id = v_a.live_version_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'label', public.brand_form_cut(COALESCE(NULLIF(btrim(q.value->>'door_label'), ''), q.value->>'label'), 40),
           'value', public.brand_form_cut(public.brand_form_answer_text(q.value, v_resp.answers->(q.value->>'id')), 60))
           ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_answered->'questions') q
   WHERE COALESCE((q.value->>'show_at_door')::boolean, false)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_live->'questions') l
                  WHERE l.value->>'id' = q.value->>'id' AND COALESCE((l.value->>'show_at_door')::boolean, false))
     AND public.brand_form_answer_text(q.value, v_resp.answers->(q.value->>'id')) IS NOT NULL;
  IF jsonb_array_length(v_items) = 0 THEN RETURN NULL; END IF;
  -- §6: another ticket of the same order shows the buyer's answers under
  -- "From {first name} {initial}.'s order" (a ticket moved by the older transfer
  -- already read nothing above).
  IF v_ticket IS NOT NULL THEN
    v_from := public.brand_form_door_order_header(v_sid, v_ticket);
  END IF;
  -- Wave 6: whether "See all answers" opens the full view for this actor (the
  -- host switch, or manager rank). brand_form_door_full_answers enforces it again.
  RETURN jsonb_strip_nulls(jsonb_build_object('state', 'answered', 'formName', v_a.form_name,
    'fromOrderOf', v_from,
    'fullAnswers', v_a.door_full_answers OR v_rank >= public.biz_role_rank('event_manager'),
    'items', (SELECT jsonb_agg(x.value) FROM jsonb_array_elements(v_items) WITH ORDINALITY x WHERE x.ordinality <= 3)));
END;
$fn$;

-- "See all answers" (C4): one current guest of this event per call, rate limited, logged.
-- Full answers when the form allows it or the caller is event_manager+; else the marked line.
CREATE FUNCTION public.brand_form_door_full_answers(p_actor_id uuid, p_event_id uuid, p_subject jsonb, p_via text DEFAULT 'scan')
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_kind text := p_subject->>'kind';
  v_sid uuid;
  v_rank integer;
  v_a record;
  v_resp public.brand_form_responses;
  v_def jsonb;
  v_questions jsonb;
  v_result text;
  v_out jsonb;
  v_current boolean;
  v_ticket uuid;
  v_from text;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_rank := public.brand_form_door_authority(p_actor_id, p_event_id);
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'order') OR COALESCE(p_subject->>'id', '') !~ v_uuid
     OR COALESCE(p_via, '') NOT IN ('scan', 'search')
     OR (p_subject ? 'ticketId' AND jsonb_typeof(p_subject->'ticketId') <> 'null'
         AND (v_kind <> 'order' OR COALESCE(p_subject->>'ticketId', '') !~ v_uuid)) THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
  END IF;
  -- Wave 6: the scanned ticket (optional) must be a ticket of this order at this
  -- event, exactly as the door line checks it.
  IF v_kind = 'order' AND (p_subject->>'ticketId') ~ v_uuid THEN
    v_ticket := (p_subject->>'ticketId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.id = v_ticket AND t.order_id = v_sid AND t.event_id = p_event_id) THEN
      RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Current guests only, by the door's own admission rule (biz_rsvp_scan: going and
  -- approved), or an order that is paid or partly refunded. A not-going, waitlisted,
  -- maybe or denied RSVP and a refunded, cancelled or unpaid order read nothing.
  -- (Plus-ones are not a door subject here; they arrive after claim, wave 5.)
  v_current := CASE v_kind
       WHEN 'rsvp' THEN EXISTS (SELECT 1 FROM public.event_rsvps r
                                 WHERE r.id = v_sid AND r.rsvp_status = 'going' AND r.approval_status = 'approved')
       ELSE EXISTS (SELECT 1 FROM public.orders o WHERE o.id = v_sid AND o.payment_status IN ('paid', 'partial_refund'))
     END;
  IF NOT v_current THEN
    RAISE EXCEPTION 'subject_not_current' USING ERRCODE = '42501';
  END IF;
  -- One counter per actor: serialise this actor's reads before counting, so
  -- parallel calls cannot all pass the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_door_reads:' || p_actor_id::text, 0));
  IF (SELECT count(*) FROM public.brand_form_door_reads d
       WHERE d.actor_id = p_actor_id AND d.created_at > now() - interval '10 minutes') >= 60 THEN
    INSERT INTO public.brand_form_door_reads (actor_id, event_id, subject_kind, subject_id, via, result)
    VALUES (p_actor_id, p_event_id, v_kind, v_sid, p_via, 'rate_limited');
    RETURN jsonb_build_object('state', 'rate_limited');
  END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  IF NOT FOUND OR public.brand_forms_switched_off() THEN
    v_result := 'no_form';
    v_out := jsonb_build_object('state', 'no_form');
  ELSE
    v_resp := public.brand_form_find_response(v_a.form_id, v_kind, v_sid);
    -- A ticket moved by the older transfer never opens the previous holder's
    -- (the order's) answers, the same rule as the door line (SC-38).
    IF v_ticket IS NOT NULL AND EXISTS (SELECT 1 FROM public.tickets t
         WHERE t.id = v_ticket AND (t.transferred_at IS NOT NULL OR t.status = 'transferred')) THEN
      v_resp := NULL;
    END IF;
    IF v_ticket IS NOT NULL THEN
      v_from := public.brand_form_door_order_header(v_sid, v_ticket);
    END IF;
    IF v_resp.id IS NULL THEN
      v_result := 'not_answered';
      v_out := jsonb_build_object('state', 'not_answered', 'formName', v_a.form_name,
                 'brand', public.brand_form_brand_header(v_a.brand_id));
    ELSIF NOT v_a.door_full_answers AND v_rank < public.biz_role_rank('event_manager') THEN
      v_result := 'line_only';
      v_out := jsonb_build_object('state', 'line_only', 'formName', v_a.form_name,
                 'line', public.brand_form_door_answers(p_actor_id, p_event_id, p_subject));
    ELSE
      v_result := 'full';
      SELECT v.definition INTO v_def FROM public.brand_form_versions v WHERE v.id = v_resp.version_id;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', q.value->>'id', 'label', q.value->>'label',
               'type', q.value->>'type', 'value', public.brand_form_answer_text(q.value, v_resp.answers->(q.value->>'id')))
               ORDER BY (q.value->>'position')::integer), '[]'::jsonb)
        INTO v_questions
        FROM jsonb_array_elements(v_def->'questions') q
       WHERE q.value->>'type' <> 'file_upload';
      -- Wave 6: the answered version (file questions left out) and the stored
      -- answers too, so the door draws them with the read-only form renderer.
      v_out := jsonb_strip_nulls(jsonb_build_object('state', 'answered', 'formName', v_a.form_name,
                 'brand', public.brand_form_brand_header(v_a.brand_id),
                 'answeredAt', v_resp.updated_at, 'isCurrentVersion', v_resp.version_id = v_a.live_version_id,
                 'fromOrderOf', v_from,
                 'questions', v_questions,
                 'definition', jsonb_set(v_def, '{questions}', COALESCE((SELECT jsonb_agg(q.value ORDER BY (q.value->>'position')::integer)
                     FROM jsonb_array_elements(v_def->'questions') q WHERE q.value->>'type' <> 'file_upload'), '[]'::jsonb)),
                 'answers', COALESCE((SELECT jsonb_object_agg(a.key, a.value) FROM jsonb_each(v_resp.answers) a
                     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_def->'questions') q
                                    WHERE q.value->>'id' = a.key AND q.value->>'type' <> 'file_upload')), '{}'::jsonb)));
    END IF;
  END IF;
  INSERT INTO public.brand_form_door_reads (actor_id, event_id, form_id, subject_kind, subject_id, via, result)
  VALUES (p_actor_id, p_event_id, v_a.form_id, v_kind, v_sid, p_via, v_result);
  RETURN v_out;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 12b. Wave 3: link-page codes, counts, earlier guests, roster export answers
-- ---------------------------------------------------------------------------
-- Guests of one page who have not answered: going RSVPs and paid or partly
-- refunded orders with no response by the person rule (the Responses page's
-- "Not answered" list, counted). One set-based anti-join per kind, the same rule
-- as brand_form_find_response: the RSVP's or order's own row, else a row of its
-- holder's signed-in user.
CREATE FUNCTION public.brand_form_unanswered_count(p_form_id uuid, p_event_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT (SELECT count(*) FROM public.event_rsvps x
           WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
             AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
                              WHERE r.form_id = p_form_id
                                AND (r.rsvp_id = x.id OR (x.user_id IS NOT NULL AND r.user_id = x.user_id))))::integer
       + (SELECT count(*) FROM public.orders o
           WHERE o.event_id = p_event_id AND o.payment_status IN ('paid', 'partial_refund')
             AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
                              WHERE r.form_id = p_form_id
                                AND (r.order_id = o.id OR (o.buyer_user_id IS NOT NULL AND r.user_id = o.buyer_user_id))))::integer;
$fn$;

-- The link page's one-time code (C2, decision 12): the challenge behind a code
-- check, only when it is a brand form challenge OF THIS LINK (a claim sign-in or
-- add-contact challenge id never resolves here: purpose isolation). Service role.
CREATE FUNCTION public.brand_form_code_challenge(p_challenge_id uuid, p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_link public.brand_form_links;
  v_c record;
BEGIN
  IF to_regclass('public.contact_challenges') IS NULL OR p_challenge_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  v_link := public.brand_form_link_by_token(p_token);
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'invalid'); END IF;
  EXECUTE 'SELECT c.channel, c.target_value, c.consumed_at, c.purpose, c.brand_form_link_id
             FROM public.contact_challenges c WHERE c.id = $1'
    INTO v_c USING p_challenge_id;
  IF v_c IS NULL OR v_c.purpose IS DISTINCT FROM 'brand_form_access'
     OR v_c.brand_form_link_id IS DISTINCT FROM v_link.id OR v_c.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'channel', v_c.channel, 'target', v_c.target_value,
                            'linkId', v_link.id, 'formId', v_link.form_id);
END;
$fn$;

-- Settle a link-page code: the same checks as brand_form_code_challenge, then the
-- existing #4063 settle (5 tries per challenge, 10 minute expiry, one use).
CREATE FUNCTION public.brand_form_code_settle(
  p_challenge_id uuid, p_token text, p_code_hash text, p_provider_approved boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_check jsonb;
  v_out jsonb;
BEGIN
  v_check := public.brand_form_code_challenge(p_challenge_id, p_token);
  IF v_check->>'outcome' <> 'ok' THEN RETURN v_check; END IF;
  EXECUTE 'SELECT public.issue_4063_settle_contact_challenge($1, $2, $3)'
    INTO v_out USING p_challenge_id, p_code_hash, COALESCE(p_provider_approved, false);
  IF v_out->>'outcome' = 'ok' THEN
    -- The grant is read by brand_form_code_grant_ok; nothing about the contact leaves.
    RETURN jsonb_build_object('outcome', 'ok', 'challengeId', p_challenge_id);
  END IF;
  RETURN v_out - 'value' - 'userId' - 'claimCode';
END;
$fn$;

-- Answered and to-answer counts (marketing_manager+, the Responses gate): per form
-- for the forms list cards, and per page (the active attachment) for the manage tile.
CREATE FUNCTION public.biz_brand_form_counts(p_brand_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_pages jsonb;
  v_forms jsonb;
BEGIN
  PERFORM public.brand_form_require_rank(p_brand_id, 'marketing_manager');
  WITH pages AS (
    SELECT a.event_id, a.form_id, f.status AS form_status,
           (SELECT count(*) FROM public.brand_form_event_responses(a.form_id, a.event_id) r WHERE r.verified)::integer AS answered,
           CASE WHEN f.status = 'live' THEN public.brand_form_unanswered_count(a.form_id, a.event_id) ELSE 0 END AS to_answer
      FROM public.brand_form_attachments a
      JOIN public.brand_forms f ON f.id = a.form_id
      JOIN public.events e ON e.id = a.event_id AND e.deleted_at IS NULL
     WHERE a.brand_id = p_brand_id AND a.detached_at IS NULL AND f.brand_id = p_brand_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId', p.event_id, 'formId', p.form_id,
           'formStatus', p.form_status, 'answered', p.answered, 'toAnswer', p.to_answer)
           ORDER BY p.event_id), '[]'::jsonb)
    INTO v_pages FROM pages p;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('formId', f.id,
           'answered', (SELECT count(*) FROM public.brand_form_responses r WHERE r.form_id = f.id AND r.verified)::integer,
           'toAnswer', COALESCE((SELECT sum((pg->>'toAnswer')::integer) FROM jsonb_array_elements(v_pages) pg
                                  WHERE (pg->>'formId')::uuid = f.id), 0)::integer,
           'pages', (SELECT count(*) FROM jsonb_array_elements(v_pages) pg WHERE (pg->>'formId')::uuid = f.id)::integer)
           ORDER BY f.id), '[]'::jsonb)
    INTO v_forms
    FROM public.brand_forms f WHERE f.brand_id = p_brand_id AND f.status <> 'archived';
  RETURN jsonb_build_object('forms', v_forms, 'pages', v_pages);
END;
$fn$;

-- C12 / §4.6: earlier guests on each live page a form is attached to (people who
-- signed up and have not answered), for "Ask earlier guests?" after attach or publish.
CREATE FUNCTION public.brand_form_earlier_guests(p_form_id uuid, p_event_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('eventId', x.event_id, 'count', x.n) ORDER BY x.event_id), '[]'::jsonb)
    FROM (
      SELECT a.event_id, public.brand_form_unanswered_count(a.form_id, a.event_id) AS n
        FROM public.brand_form_attachments a
        JOIN public.events e ON e.id = a.event_id
       WHERE a.form_id = p_form_id AND a.detached_at IS NULL
         AND (p_event_id IS NULL OR a.event_id = p_event_id)
         AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
    ) x
   WHERE x.n > 0;
$fn$;

-- The roster export's answer columns (§4.9: "the existing roster CSV plus one
-- column per question and version"). Service role: the export worker calls it for
-- an offering_guest_roster job, whose rank gate (brand_admin+, biz_export_brand_people
-- in 20270326001858) already ran when the job was created. That roster RPC is not
-- widened (C5): event managers export a page's answers through the answers-only
-- feed, biz_brand_form_responses_export (event_manager+). The page's active form
-- (live or closed); none: no columns. A person's answer is found from their RSVP,
-- then their order, at this page, by the one person rule.
CREATE FUNCTION public.brand_form_roster_export_answers(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_event uuid;
  v_brand uuid;
  v_form uuid;
  v_multi boolean;
  v_cols jsonb;
  v_rows jsonb;
BEGIN
  SELECT j.scope_id, j.brand_id INTO v_event, v_brand
    FROM public.brand_people_export_jobs j
   WHERE j.id = p_job_id AND j.export_kind = 'offering_guest_roster';
  IF v_event IS NULL THEN RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '{}'::jsonb); END IF;
  SELECT a.form_id INTO v_form FROM public.brand_form_active_for_event(v_event) a WHERE a.brand_id = v_brand;
  IF v_form IS NULL THEN RETURN jsonb_build_object('columns', '[]'::jsonb, 'rows', '{}'::jsonb); END IF;
  SELECT count(*) > 1 INTO v_multi FROM public.brand_form_versions v WHERE v.form_id = v_form;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', v.version || ':' || (q.value->>'id'),
           'header', CASE WHEN v_multi THEN (q.value->>'label') || ' (v' || v.version || ')' ELSE q.value->>'label' END)
           ORDER BY v.version, (q.value->>'position')::integer), '[]'::jsonb)
    INTO v_cols
    FROM public.brand_form_versions v
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
   WHERE v.form_id = v_form;
  WITH people AS (
    SELECT l.brand_person_id AS person_id,
           (array_agg(l.source_id ORDER BY l.linked_at) FILTER (WHERE l.source_kind = 'event_rsvp'
              AND EXISTS (SELECT 1 FROM public.event_rsvps r WHERE r.id = l.source_id AND r.event_id = v_event)))[1] AS rsvp_id,
           (array_agg(l.source_id ORDER BY l.linked_at) FILTER (WHERE l.source_kind = 'order'
              AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = l.source_id AND o.event_id = v_event)))[1] AS order_id
      FROM public.brand_person_source_links l
     WHERE l.brand_id = v_brand AND l.detached_at IS NULL AND l.source_kind IN ('event_rsvp', 'order')
     GROUP BY l.brand_person_id
  ), answered AS (
    -- (A not-found response is a row of nulls, not a null: test its id, never COALESCE.)
    SELECT p.person_id,
           CASE WHEN (public.brand_form_find_response(v_form, 'rsvp', p.rsvp_id)).id IS NOT NULL
                THEN public.brand_form_find_response(v_form, 'rsvp', p.rsvp_id)
                ELSE public.brand_form_find_response(v_form, 'order', p.order_id) END AS r
      FROM people p
     WHERE p.rsvp_id IS NOT NULL OR p.order_id IS NOT NULL
  )
  SELECT COALESCE(jsonb_object_agg(a.person_id, (
           SELECT COALESCE(jsonb_object_agg(v.version || ':' || (q.value->>'id'),
                    public.brand_form_answer_text(q.value, (a.r).answers->(q.value->>'id'))), '{}'::jsonb)
             FROM public.brand_form_versions v
             CROSS JOIN LATERAL jsonb_array_elements(v.definition->'questions') q
            WHERE v.id = (a.r).version_id AND (a.r).answers ? (q.value->>'id'))), '{}'::jsonb)
    INTO v_rows
    FROM answered a
   WHERE (a.r).id IS NOT NULL AND (a.r).verified;
  RETURN jsonb_build_object('formId', v_form, 'columns', v_cols, 'rows', v_rows);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 12c. Wave 4: sending (Ask guests to answer, Remind, the automatic reminder)
-- ---------------------------------------------------------------------------
-- Decision 17 (option b): a form request never creates an invite. Its delivery
-- record is a brand_form_request_sends row carrying a brand form link (kind
-- 'person', token hashed by brand_form_link_issue); nothing here reads or writes
-- brand_offering_invites, their delivery attempts, marketing send groups, RSVP
-- status or private-event access. The edge sends through the existing notify v2
-- dispatcher, so consent, suppression and the per-market SMS switches apply as
-- they do to RSVP and ticket messages.
--
-- Wave 4 review fixes: the sends table is also the queue. A host's Ask or
-- Remind and the automatic reminder only write 'queued' rows (one per person);
-- brand_form_request_claim_batch hands out pages of 25 (FOR UPDATE SKIP LOCKED)
-- to guest-roster-actions and notify-reminders, which resume after any crash: a
-- 'claimed' row left by a dead request is retried after 10 minutes (3 tries,
-- then 'failed'), so it never blocks the guest for 24 hours. Texts wait for
-- 9am-9pm in the page's own time zone. Guests with no reachable contact are
-- written as 'unreachable' (counted, never dropped). Push and the Explorer inbox
-- row wait for the Explorer /form route; contact routes are text then email.
--
-- MINGLA-INVARIANT: I-4514-FORM-REQUEST-NO-INVITE | issue #4514 | a form request (Ask, Remind, the automatic reminder) writes no invite, no invite delivery attempt and no access grant, and leaves guest status and invite counts unchanged (pg17 T-W4-D17; Deno issue_4514_form_requests).
-- MINGLA-INVARIANT: I-4514-FORM-REQUEST-THROTTLE | issue #4514 | one form request per person per form per 24 hours (a queued, claimed or sent row for the same person key), enforced in brand_form_request_enqueue under the brand lock (pg17 T-W4-THROTTLE, T-W4-CONC).
-- MINGLA-INVARIANT: I-4514-FORM-REQUEST-QUEUED | issue #4514 | form requests are delivered from the queue in pages of at most 100 by brand_form_request_claim_batch; a stale claim is retried or failed, never left blocking (pg17 T-W4-QUEUE).

-- Decision 13: one automatic reminder per page and date, two days before each
-- guest's own date. 'held_form_closed' is decision 10 (held, host told).
CREATE TABLE public.brand_form_auto_reminder_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES public.brand_form_attachments(id) ON DELETE CASCADE,
  form_id       uuid NOT NULL REFERENCES public.brand_forms(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('sending', 'sent', 'failed', 'held_form_closed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz,
  CONSTRAINT brand_form_auto_reminder_runs_once UNIQUE (attachment_id, starts_at)
);
ALTER TABLE public.brand_form_auto_reminder_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_auto_reminder_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.brand_form_auto_reminder_runs TO service_role;

CREATE TABLE public.brand_form_request_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       uuid NOT NULL REFERENCES public.brand_forms(id) ON DELETE CASCADE,
  attachment_id uuid REFERENCES public.brand_form_attachments(id) ON DELETE SET NULL,
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id      uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  rsvp_id       uuid REFERENCES public.event_rsvps(id) ON DELETE CASCADE,
  order_id      uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  link_id       uuid REFERENCES public.brand_form_links(id) ON DELETE SET NULL,
  run_id        uuid REFERENCES public.brand_form_auto_reminder_runs(id) ON DELETE SET NULL,
  person_key    text NOT NULL CHECK (length(person_key) BETWEEN 3 AND 400),
  kind          text NOT NULL CHECK (kind IN ('ask', 'remind', 'auto')),
  route         text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (route <@ ARRAY['push', 'sms', 'email']::text[]),
  channel       text CHECK (channel IN ('push', 'sms', 'email')),
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'claimed', 'sent', 'failed', 'skipped', 'unreachable')),
  safe_reason   text CHECK (safe_reason ~ '^[a-z0-9_]{1,64}$'),
  starts_at     timestamptz,
  not_before    timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz,
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz,
  CONSTRAINT brand_form_request_sends_one_subject CHECK (num_nonnulls(rsvp_id, order_id) = 1)
);
CREATE INDEX brand_form_request_sends_rsvp_idx ON public.brand_form_request_sends (form_id, rsvp_id, created_at DESC) WHERE rsvp_id IS NOT NULL;
CREATE INDEX brand_form_request_sends_order_idx ON public.brand_form_request_sends (form_id, order_id, created_at DESC) WHERE order_id IS NOT NULL;
CREATE INDEX brand_form_request_sends_person_idx ON public.brand_form_request_sends (form_id, person_key, created_at DESC);
CREATE INDEX brand_form_request_sends_queue_idx ON public.brand_form_request_sends (not_before, created_at) WHERE status IN ('queued', 'claimed');
CREATE INDEX brand_form_request_sends_brand_texts_idx ON public.brand_form_request_sends (brand_id, created_at DESC) WHERE route[1] = 'sms';
CREATE INDEX brand_form_request_sends_event_idx ON public.brand_form_request_sends (form_id, event_id, created_at DESC);
CREATE UNIQUE INDEX brand_form_request_sends_auto_once ON public.brand_form_request_sends (run_id, person_key) WHERE run_id IS NOT NULL;
ALTER TABLE public.brand_form_request_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_request_sends FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.brand_form_request_sends TO service_role;

-- The two notify v2 categories: the guest's request (text or email to the
-- contact on file with their link) and the host's "reminder held" notice.
INSERT INTO public.notification_categories(key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES ('brand_form_request', 'RSVP', true, 'normal', ARRAY['inapp', 'push', 'email', 'sms'], 'reach_once'),
       ('business.brand_form_reminder_held', 'support', true, 'normal', ARRAY['inapp', 'push'], 'reach_once')
ON CONFLICT (key) DO UPDATE SET section = EXCLUDED.section, is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency, default_channels = EXCLUDED.default_channels, reach_mode = EXCLUDED.reach_mode,
  active = true;

-- The per-brand daily limit on form request texts (rolling 24 hours).
CREATE FUNCTION public.brand_form_request_text_cap() RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$ SELECT 300 $fn$;

-- Texts queued, being sent or sent for a brand in the last 24 hours.
CREATE FUNCTION public.brand_form_request_texts_today(p_brand_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT count(*)::integer FROM public.brand_form_request_sends s
   WHERE s.brand_id = p_brand_id AND s.route[1] = 'sms' AND s.status IN ('queued', 'claimed', 'sent')
     AND s.created_at > now() - interval '24 hours'
$fn$;

-- One person, one key: the signed-in account, else the booking (the RSVP,
-- order or trip-booking id). Never the phone or the email: two guests who share
-- a phone are two people, each with their own link. The 24-hour throttle and the
-- de-duplication of one account with several RSVPs or orders key on it.
CREATE FUNCTION public.brand_form_person_key(p_user_id uuid, p_kind text, p_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_user_id IS NOT NULL THEN 'u:' || p_user_id::text
              ELSE 's:' || p_kind || ':' || p_id::text END
$fn$;

-- The contact route for one guest: a text before an email, each only when the
-- host ticked it and the dispatcher's consent and suppression gate allows it.
CREATE FUNCTION public.brand_form_request_route(p_phone text, p_email text, p_channels text[])
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT ARRAY(SELECT v.c FROM (VALUES
      (1, 'sms', p_phone IS NOT NULL AND 'sms' = ANY (p_channels)
                 AND public.can_send(NULL, 'brand_form_request', 'sms', p_phone)),
      (2, 'email', p_email IS NOT NULL AND 'email' = ANY (p_channels)
                   AND public.can_send(NULL, 'brand_form_request', 'email', p_email))) v(o, c, ok)
    WHERE v.ok ORDER BY v.o)
$fn$;

-- Quiet hours: the first moment at or after p_at between 9am and 9pm in p_tz
-- (an unknown zone reads as UTC). Texts are delayed, never sent at night.
CREATE FUNCTION public.brand_form_text_window(p_tz text, p_at timestamptz) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
DECLARE
  v_tz text := COALESCE(NULLIF(btrim(p_tz), ''), 'UTC');
  v_local timestamp;
  v_hour integer;
BEGIN
  BEGIN
    v_local := p_at AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'UTC';
    v_local := p_at AT TIME ZONE 'UTC';
  END;
  v_hour := extract(hour FROM v_local)::integer;
  IF v_hour >= 9 AND v_hour < 21 THEN RETURN p_at; END IF;
  RETURN (date_trunc('day', v_local) + CASE WHEN v_hour >= 21 THEN interval '1 day' ELSE interval '0' END
          + interval '9 hours') AT TIME ZONE v_tz;
END;
$fn$;

-- Every current guest of a page for one form (going RSVPs; paid or partly
-- refunded orders), optionally narrowed to named guests, with the contact on
-- file, whether they answered and their person key. One row per booking; the
-- callers keep one row per person.
CREATE FUNCTION public.brand_form_request_guests(p_form_id uuid, p_event_id uuid, p_subjects jsonb DEFAULT NULL)
RETURNS TABLE (g_kind text, g_id uuid, g_user_id uuid, g_name text, g_answered boolean,
               g_phone text, g_email text, g_person_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  WITH guests AS (
    SELECT 'rsvp'::text AS kind, x.id, x.user_id, x.guest_name AS name,
           EXISTS (SELECT 1 FROM public.brand_form_responses r WHERE r.form_id = p_form_id
                    AND (r.rsvp_id = x.id OR (x.user_id IS NOT NULL AND r.user_id = x.user_id))) AS answered
      FROM public.event_rsvps x WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
    UNION ALL
    SELECT 'order', o.id, o.buyer_user_id, o.buyer_name,
           EXISTS (SELECT 1 FROM public.brand_form_responses r WHERE r.form_id = p_form_id
                    AND (r.order_id = o.id OR (o.buyer_user_id IS NOT NULL AND r.user_id = o.buyer_user_id)))
      FROM public.orders o WHERE o.event_id = p_event_id AND o.payment_status IN ('paid', 'partial_refund')
  ), picked AS (
    SELECT g.*, public.brand_form_subject_contact(g.kind, g.id) AS contact FROM guests g
     WHERE p_subjects IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_subjects) s
                                          WHERE s->>'kind' = g.kind AND lower(s->>'id') = g.id::text)
  )
  SELECT p.kind, p.id, p.user_id, p.name, p.answered, p.contact->>'phone', p.contact->>'email',
         public.brand_form_person_key(p.user_id, p.kind, p.id)
    FROM picked p
$fn$;

-- Each guest's own start time (the #3281 per-ticket-date pattern): an
-- experience order's booked slot; else each date on the order's tickets; else
-- (an RSVP, or an order with no dated ticket) the page's next date. Cancelled
-- dates never count.
CREATE FUNCTION public.brand_form_guest_dates(p_kind text, p_id uuid, p_event_id uuid)
RETURNS SETOF timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- Plain static SQL (the #4402 / #4226 precedent): a plpgsql body is not
  -- resolved at CREATE time, so the filtered #1931 template replay that skips
  -- the #3281 slot column and ticket-date table still creates this function
  -- (#2492 closure). pg17 T-W4-DATES-0 checks the columns it reads exist.
  IF p_kind = 'order' THEN
    RETURN QUERY
    SELECT o.booked_start_at FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE o.id = p_id AND e.event_type = 'experience' AND o.booked_start_at IS NOT NULL;
    IF FOUND THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ed.start_at FROM public.tickets t
      JOIN public.ticket_event_dates ted ON ted.ticket_id = t.id
      JOIN public.event_dates ed ON ed.id = ted.event_date_id AND ed.event_id = p_event_id
     WHERE t.order_id = p_id AND ed.cancelled_at IS NULL;
    IF FOUND THEN RETURN; END IF;
  END IF;
  RETURN QUERY
  SELECT min(ed.start_at) FROM public.event_dates ed
   WHERE ed.event_id = p_event_id AND ed.start_at > now() AND ed.cancelled_at IS NULL
  HAVING min(ed.start_at) IS NOT NULL;
END;
$fn$;

-- Who a request for one form on one page would reach (service role). The actor
-- needs event manager and up (C5); the form must be live and attached to the
-- page. Audience 'unanswered' (default) or 'everyone'; p_subjects narrows it to
-- named guests ([{kind:'rsvp'|'order', id}], at most 500). One row per person;
-- 'route' is the contact route for the ticked channels (empty: can't reach);
-- 'throttled' is a queued, claimed or sent request to the same person in the
-- last 24 hours. At most 500 people (the roster cap).
CREATE FUNCTION public.brand_form_request_audience(
  p_actor_id uuid, p_form_id uuid, p_event_id uuid, p_audience text DEFAULT 'unanswered',
  p_subjects jsonb DEFAULT NULL, p_channels text[] DEFAULT ARRAY['email', 'sms']
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_e record;
  v_f public.brand_forms;
  v_att uuid;
  v_rows jsonb;
  v_n integer;
  v_ch text[] := ARRAY(SELECT DISTINCT c FROM unnest(COALESCE(p_channels, ARRAY[]::text[])) c WHERE c IN ('sms', 'email'));
  v_window timestamptz;
BEGIN
  IF p_audience IS NULL OR p_audience NOT IN ('unanswered', 'everyone') THEN
    RAISE EXCEPTION 'audience_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_subjects IS NOT NULL AND (jsonb_typeof(p_subjects) <> 'array' OR jsonb_array_length(p_subjects) NOT BETWEEN 1 AND 500
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_subjects) s
                 WHERE jsonb_typeof(s) <> 'object' OR COALESCE(s->>'kind', '') NOT IN ('rsvp', 'order')
                    OR COALESCE(s->>'id', '') !~ '^[0-9a-fA-F-]{36}$')) THEN
    RAISE EXCEPTION 'subjects_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT e.id, e.brand_id, e.title, e.deleted_at, e.status, e.timezone INTO v_e FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND OR v_e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_actor_id IS NOT NULL
     AND public.biz_brand_effective_rank(v_e.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_f FROM public.brand_forms WHERE id = p_form_id AND brand_id = v_e.brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT a.id INTO v_att FROM public.brand_form_attachments a
   WHERE a.event_id = p_event_id AND a.form_id = p_form_id AND a.detached_at IS NULL;
  IF v_att IS NULL THEN RAISE EXCEPTION 'form_not_on_event' USING ERRCODE = '42501'; END IF;
  IF v_f.status <> 'live' THEN
    RAISE EXCEPTION '%', CASE WHEN v_f.status = 'draft' THEN 'form_not_live' ELSE 'form_closed' END USING ERRCODE = '22023';
  END IF;
  WITH people AS (
    SELECT DISTINCT ON (g.g_person_key) g.*
      FROM public.brand_form_request_guests(p_form_id, p_event_id, p_subjects) g
     ORDER BY g.g_person_key, g.g_answered DESC, g.g_kind, g.g_id
  ), picked AS (
    SELECT p.* FROM people p WHERE p_audience = 'everyone' OR NOT p.g_answered
  )
  SELECT count(*)::integer,
         COALESCE(jsonb_agg(jsonb_build_object(
           'kind', p.g_kind, 'id', p.g_id, 'userId', p.g_user_id, 'name', public.brand_form_short_name(p.g_name),
           'personKey', p.g_person_key, 'email', p.g_email, 'phone', p.g_phone, 'answered', p.g_answered,
           'route', to_jsonb(public.brand_form_request_route(p.g_phone, p.g_email, v_ch)),
           -- Opted out of texts: a phone on file the consent gate refuses.
           'smsOptedOut', p.g_phone IS NOT NULL AND 'sms' = ANY (v_ch)
                          AND NOT public.can_send(NULL, 'brand_form_request', 'sms', p.g_phone),
           'throttled', EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                 WHERE s.form_id = p_form_id AND s.person_key = p.g_person_key
                                   AND s.status IN ('queued', 'claimed', 'sent')
                                   AND s.created_at > now() - interval '24 hours'))
           ORDER BY p.g_kind, p.g_id), '[]'::jsonb)
    INTO v_n, v_rows
    FROM picked p;
  IF v_n > 500 THEN RAISE EXCEPTION 'audience_too_large' USING ERRCODE = '22023'; END IF;
  v_window := public.brand_form_text_window(v_e.timezone, now());
  RETURN jsonb_build_object('formId', p_form_id, 'eventId', p_event_id, 'attachmentId', v_att,
    'brandId', v_e.brand_id, 'eventTitle', v_e.title, 'formName', v_f.name,
    'brandName', (SELECT b.name FROM public.brands b WHERE b.id = v_e.brand_id),
    'eventStartsAt', (SELECT min(d.start_at) FROM public.event_dates d
                       WHERE d.event_id = p_event_id AND d.start_at > now() AND d.cancelled_at IS NULL),
    'textsToday', public.brand_form_request_texts_today(v_e.brand_id),
    'textCap', public.brand_form_request_text_cap(),
    'textsWaitUntil', CASE WHEN v_window > now() THEN v_window END,
    'recipients', v_rows);
END;
$fn$;

-- Queue a host's Ask or Remind (service role; guest-roster-actions after the
-- cost checks). Under the brand lock, so two Asks at once queue each person
-- once and the daily text limit cannot be overrun. Writes one 'queued' row per
-- reachable person (texts wait for 9am in the page's time zone) and one
-- 'unreachable' row per person with no route; skips throttled people and, for
-- Remind, people who answered. Over the daily text limit: form_request_text_cap.
CREATE FUNCTION public.brand_form_request_enqueue(
  p_actor_id uuid, p_form_id uuid, p_event_id uuid, p_kind text, p_audience text,
  p_subjects jsonb, p_channels text[]
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_aud jsonb;
  v_brand uuid;
  v_tz text;
  v_new_texts integer;
  v_queued integer := 0;
  v_unreachable integer := 0;
  v_throttled integer := 0;
  v_answered integer := 0;
  v_waiting integer := 0;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('ask', 'remind') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'brand_form_forbidden' USING ERRCODE = '42501'; END IF;
  -- Checks the role, the form and the page (and raises their errors).
  v_aud := public.brand_form_request_audience(p_actor_id, p_form_id, p_event_id,
             CASE WHEN p_kind = 'remind' THEN 'unanswered' ELSE p_audience END, p_subjects, p_channels);
  v_brand := (v_aud->>'brandId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_request:' || v_brand::text, 4514));
  -- Read again under the lock: a concurrent Ask has committed by now.
  v_aud := public.brand_form_request_audience(p_actor_id, p_form_id, p_event_id,
             CASE WHEN p_kind = 'remind' THEN 'unanswered' ELSE p_audience END, p_subjects, p_channels);
  SELECT e.timezone INTO v_tz FROM public.events e WHERE e.id = p_event_id;
  SELECT count(*) FILTER (WHERE throttled),
         count(*) FILTER (WHERE NOT throttled AND answered AND p_kind = 'remind'),
         count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND route[1] = 'sms')
    INTO v_throttled, v_answered, v_new_texts
    FROM (SELECT r->>'kind' AS kind, (r->>'id')::uuid AS id, r->>'personKey' AS person_key,
                 (r->>'answered')::boolean AS answered, (r->>'throttled')::boolean AS throttled,
                 ARRAY(SELECT jsonb_array_elements_text(r->'route')) AS route, (r->>'smsOptedOut')::boolean AS opted_out
            FROM jsonb_array_elements(v_aud->'recipients') r) x;
  IF v_new_texts > 0
     AND public.brand_form_request_texts_today(v_brand) + v_new_texts > public.brand_form_request_text_cap() THEN
    RAISE EXCEPTION 'form_request_text_cap' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.brand_form_request_sends (form_id, attachment_id, event_id, brand_id, rsvp_id, order_id,
         person_key, kind, route, status, safe_reason, not_before, created_by, settled_at)
  SELECT p_form_id, (v_aud->>'attachmentId')::uuid, p_event_id, v_brand,
         CASE WHEN x.kind = 'rsvp' THEN x.id END, CASE WHEN x.kind = 'order' THEN x.id END,
         x.person_key, p_kind, x.route,
         CASE WHEN cardinality(x.route) = 0 THEN 'unreachable' ELSE 'queued' END,
         CASE WHEN cardinality(x.route) > 0 THEN NULL WHEN x.opted_out THEN 'sms_opted_out' ELSE 'no_contact' END,
         CASE WHEN x.route[1] = 'sms' THEN public.brand_form_text_window(v_tz, now()) ELSE now() END,
         p_actor_id, CASE WHEN cardinality(x.route) = 0 THEN now() END
    FROM (SELECT r->>'kind' AS kind, (r->>'id')::uuid AS id, r->>'personKey' AS person_key,
                 (r->>'answered')::boolean AS answered, (r->>'throttled')::boolean AS throttled,
                 ARRAY(SELECT jsonb_array_elements_text(r->'route')) AS route, (r->>'smsOptedOut')::boolean AS opted_out
            FROM jsonb_array_elements(v_aud->'recipients') r) x
   WHERE NOT x.throttled AND NOT (x.answered AND p_kind = 'remind');
  SELECT count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND cardinality(route) > 0),
         count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND cardinality(route) = 0),
         count(*) FILTER (WHERE NOT throttled AND NOT (answered AND p_kind = 'remind') AND route[1] = 'sms'
                            AND public.brand_form_text_window(v_tz, now()) > now())
    INTO v_queued, v_unreachable, v_waiting
    FROM (SELECT r->>'kind' AS kind, (r->>'id')::uuid AS id, r->>'personKey' AS person_key,
                 (r->>'answered')::boolean AS answered, (r->>'throttled')::boolean AS throttled,
                 ARRAY(SELECT jsonb_array_elements_text(r->'route')) AS route, (r->>'smsOptedOut')::boolean AS opted_out
            FROM jsonb_array_elements(v_aud->'recipients') r) x;
  RETURN jsonb_build_object('queued', v_queued, 'unreachable', v_unreachable, 'throttled', v_throttled,
    'answered', v_answered, 'textsQueued', v_new_texts, 'waitingForMorning', v_waiting);
END;
$fn$;

-- Hand out the next page of queued requests (service role; the drain in
-- guest-roster-actions and notify-reminders). First: a 'claimed' row older than
-- 10 minutes (its request died) goes back to the queue, or fails after 3 tries;
-- a queued row older than 24 hours fails ('expired'); an automatic-reminder run
-- with nothing left settles as 'sent' (or 'failed' when nothing was sent and
-- something failed). Then up to p_limit due rows, each re-checked under the
-- person lock (form still live, still a guest, Remind and automatic: not yet
-- answered, texts inside 9am-9pm local) and given a fresh personal link. With
-- p_form_id and p_event_id, only that page's requests (the host's own send).
CREATE FUNCTION public.brand_form_request_claim_batch(
  p_limit integer DEFAULT 25, p_form_id uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_row record;
  v_out jsonb := '[]'::jsonb;
  v_link jsonb;
  v_contact jsonb;
  v_subject_kind text;
  v_subject_id uuid;
  v_window timestamptz;
  v_starts timestamptz;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.brand_form_request_sends
     SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
         safe_reason = CASE WHEN attempts >= 3 THEN 'claim_expired' ELSE 'claim_retried' END,
         settled_at = CASE WHEN attempts >= 3 THEN now() END,
         not_before = now()
   WHERE status = 'claimed' AND claimed_at < now() - interval '10 minutes';
  UPDATE public.brand_form_request_sends
     SET status = 'failed', safe_reason = 'expired', settled_at = now()
   WHERE status = 'queued' AND created_at < now() - interval '24 hours';
  UPDATE public.brand_form_auto_reminder_runs r
     SET outcome = CASE WHEN EXISTS (SELECT 1 FROM public.brand_form_request_sends s WHERE s.run_id = r.id AND s.status = 'sent')
                          OR NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s WHERE s.run_id = r.id AND s.status = 'failed')
                        THEN 'sent' ELSE 'failed' END,
         settled_at = now()
   WHERE r.outcome = 'sending'
     AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s WHERE s.run_id = r.id AND s.status IN ('queued', 'claimed'));

  FOR v_row IN
    SELECT s.id, s.form_id, s.event_id, s.rsvp_id, s.order_id, s.kind, s.route, s.created_by, s.starts_at,
           f.status AS form_status, e.timezone AS tz, e.title AS event_title, b.name AS brand_name
      FROM public.brand_form_request_sends s
      JOIN public.brand_forms f ON f.id = s.form_id
      JOIN public.events e ON e.id = s.event_id
      JOIN public.brands b ON b.id = s.brand_id
     WHERE s.status = 'queued' AND s.not_before <= now()
       AND (p_form_id IS NULL OR s.form_id = p_form_id) AND (p_event_id IS NULL OR s.event_id = p_event_id)
     ORDER BY s.not_before, s.created_at
     LIMIT p_limit
     FOR UPDATE OF s SKIP LOCKED
  LOOP
    v_subject_kind := CASE WHEN v_row.rsvp_id IS NOT NULL THEN 'rsvp' ELSE 'order' END;
    v_subject_id := COALESCE(v_row.rsvp_id, v_row.order_id);
    PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_row.form_id, v_subject_kind, v_subject_id));
    IF v_row.form_status <> 'live' THEN
      UPDATE public.brand_form_request_sends SET status = 'skipped', safe_reason = 'form_closed', settled_at = now()
       WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.event_rsvps x WHERE x.id = v_row.rsvp_id
                      AND x.event_id = v_row.event_id AND x.rsvp_status = 'going')
       AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = v_row.order_id
                          AND o.event_id = v_row.event_id AND o.payment_status IN ('paid', 'partial_refund')) THEN
      UPDATE public.brand_form_request_sends SET status = 'skipped', safe_reason = 'not_a_guest', settled_at = now()
       WHERE id = v_row.id;
      CONTINUE;
    END IF;
    -- The guest's own date has started (a text held for quiet hours, or a slow
    -- queue): too late to ask. The automatic reminder's date, else the guest's
    -- latest date (an RSVP's is the page's next date, so it never trips here).
    v_starts := COALESCE(v_row.starts_at,
                         (SELECT max(d.at) FROM public.brand_form_guest_dates(v_subject_kind, v_subject_id, v_row.event_id) d(at)));
    IF v_starts IS NOT NULL AND v_starts <= now() THEN
      UPDATE public.brand_form_request_sends SET status = 'skipped', safe_reason = 'event_started', settled_at = now()
       WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF v_row.kind IN ('remind', 'auto')
       AND (public.brand_form_person_response(v_row.form_id, v_subject_kind, v_subject_id, v_row.event_id)).id IS NOT NULL THEN
      UPDATE public.brand_form_request_sends SET status = 'skipped', safe_reason = 'answered', settled_at = now()
       WHERE id = v_row.id;
      CONTINUE;
    END IF;
    IF v_row.route[1] = 'sms' THEN
      v_window := public.brand_form_text_window(v_row.tz, now());
      IF v_window > now() THEN
        UPDATE public.brand_form_request_sends SET not_before = v_window WHERE id = v_row.id;
        CONTINUE;
      END IF;
    END IF;
    v_contact := public.brand_form_subject_contact(v_subject_kind, v_subject_id);
    v_link := public.brand_form_link_issue(v_row.form_id, v_row.event_id,
                jsonb_build_object('kind', v_subject_kind, 'id', v_subject_id), v_row.created_by);
    UPDATE public.brand_form_request_sends
       SET status = 'claimed', claimed_at = now(), attempts = attempts + 1, link_id = (v_link->>'linkId')::uuid
     WHERE id = v_row.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'sendId', v_row.id, 'token', v_link->>'token', 'formId', v_row.form_id, 'eventId', v_row.event_id,
      'kind', v_row.kind, 'subjectKind', v_subject_kind, 'subjectId', v_subject_id,
      'userId', COALESCE((SELECT x.user_id FROM public.event_rsvps x WHERE x.id = v_row.rsvp_id),
                         (SELECT o.buyer_user_id FROM public.orders o WHERE o.id = v_row.order_id)),
      'route', to_jsonb(v_row.route), 'phone', v_contact->>'phone', 'email', v_contact->>'email',
      'brandName', v_row.brand_name, 'eventTitle', v_row.event_title, 'eventTimezone', v_row.tz,
      'startsAt', COALESCE(v_row.starts_at, (SELECT min(d.start_at) FROM public.event_dates d
                                             WHERE d.event_id = v_row.event_id AND d.start_at > now()
                                               AND d.cancelled_at IS NULL))));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- Record how a claimed request went (service role). A failed request does not
-- count toward the throttle, so the host can try again.
CREATE FUNCTION public.brand_form_request_settle(
  p_send_id uuid, p_channel text, p_status text, p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent', 'failed', 'unreachable') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.brand_form_request_sends
     SET status = p_status, channel = p_channel, settled_at = now(),
         -- A guest emailed because the day's texts ran out keeps 'text_cap' in the log.
         safe_reason = CASE WHEN p_reason ~ '^[a-z0-9_]{1,64}$' THEN p_reason
                            WHEN p_status = 'sent' AND safe_reason = 'text_cap' THEN 'text_cap' END
   WHERE id = p_send_id AND status = 'claimed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$fn$;

-- The page's automatic reminder switch (decision 13), on the Responses page and
-- the "Ask earlier guests?" sheet. Event manager and up (C5). Push is dropped
-- until the Explorer /form route ships; at least text or email remains.
CREATE FUNCTION public.biz_brand_form_set_auto_remind(
  p_attachment_id uuid, p_on boolean, p_channels text[] DEFAULT ARRAY['email']
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a public.brand_form_attachments;
  v_ch text[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_channels, ARRAY[]::text[])) x
                        WHERE x <> 'push' ORDER BY x);
BEGIN
  IF (COALESCE(p_channels, ARRAY[]::text[]) <@ ARRAY['email', 'push', 'sms']::text[]) IS NOT TRUE OR cardinality(v_ch) = 0 THEN
    RAISE EXCEPTION 'channels_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.brand_form_attachments WHERE id = p_attachment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_a.brand_id, 'event_manager');
  IF v_a.detached_at IS NOT NULL THEN
    RAISE EXCEPTION 'attachment_conflict' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.brand_form_attachments SET auto_remind = COALESCE(p_on, false), auto_remind_channels = v_ch
   WHERE id = p_attachment_id;
  RETURN jsonb_build_object('attachmentId', p_attachment_id, 'autoRemind', COALESCE(p_on, false), 'channels', to_jsonb(v_ch),
    'remindAt', (SELECT min(d.start_at) - interval '2 days' FROM public.event_dates d
                  WHERE d.event_id = v_a.event_id AND d.start_at > now() AND d.cancelled_at IS NULL));
END;
$fn$;

-- The automatic reminders that are due (service role; notify-reminders, on its
-- five-minute cron). For each active attachment with the switch on, on a
-- scheduled or live page: the guests whose OWN date (brand_form_guest_dates)
-- starts in (now + 46 h, now + 48 h]. A live form: one run per page and date
-- and one 'queued' (or 'unreachable') row per person who has not answered and
-- was not asked in the last 24 hours, on the ticked text and email channels;
-- the drain sends them. A closed or archived form: the run is held
-- ('held_form_closed') and the attaching host (else the brand's account) is
-- told through the notify outbox with a link to the form (decision 10). A
-- draft form asks nobody. Nothing due: nothing written. It queues under the
-- same brand lock as brand_form_request_enqueue, so a host's Ask and the
-- reminder never both reach one person inside 24 hours, and it keeps to the
-- per-brand daily text limit: texts only up to what is left today; past that a
-- guest gets the email on their route ('text_cap' in the log), or, with no
-- email, is written 'skipped' with 'text_cap'.
CREATE FUNCTION public.brand_form_auto_reminders_due() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record;
  v_d record;
  v_run uuid;
  v_ch text[];
  v_n integer;
  v_left integer;
  v_runs integer := 0;
  v_queued integer := 0;
  v_held integer := 0;
BEGIN
  FOR v_a IN
    SELECT a.id AS attachment_id, a.form_id, a.event_id, a.brand_id, a.auto_remind_channels,
           COALESCE(a.created_by, b.account_id) AS host_id,
           f.status AS form_status, f.name AS form_name, e.title AS event_title, e.timezone AS tz
      FROM public.brand_form_attachments a
      JOIN public.brand_forms f ON f.id = a.form_id
      JOIN public.events e ON e.id = a.event_id
      JOIN public.brands b ON b.id = a.brand_id
     WHERE a.detached_at IS NULL AND a.auto_remind
       AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND f.status <> 'draft'
       AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = a.event_id
                    AND d.start_at > now() + interval '46 hours' AND d.start_at <= now() + interval '48 hours'
                   UNION ALL
                   SELECT 1 FROM public.orders o
                    WHERE o.event_id = a.event_id AND o.booked_start_at > now() + interval '46 hours'
                      AND o.booked_start_at <= now() + interval '48 hours')
     ORDER BY a.id
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    -- Push waits for the Explorer /form route: text and email only.
    v_ch := ARRAY(SELECT c FROM unnest(v_a.auto_remind_channels) c WHERE c IN ('sms', 'email'));
    FOR v_d IN
      SELECT DISTINCT d.at AS starts_at
        FROM public.brand_form_request_guests(v_a.form_id, v_a.event_id, NULL) g
        CROSS JOIN LATERAL public.brand_form_guest_dates(g.g_kind, g.g_id, v_a.event_id) d(at)
       WHERE d.at > now() + interval '46 hours' AND d.at <= now() + interval '48 hours'
       ORDER BY 1
    LOOP
      IF v_a.form_status <> 'live' THEN
        INSERT INTO public.brand_form_auto_reminder_runs (attachment_id, form_id, event_id, starts_at, outcome, settled_at)
        VALUES (v_a.attachment_id, v_a.form_id, v_a.event_id, v_d.starts_at, 'held_form_closed', now())
        ON CONFLICT (attachment_id, starts_at) DO NOTHING;
        IF FOUND THEN
          v_held := v_held + 1;
          IF v_a.host_id IS NOT NULL THEN
            INSERT INTO public.notification_outbox (category_key, user_id, brand_id, payload, idempotency_key)
            VALUES ('business.brand_form_reminder_held', v_a.host_id, v_a.brand_id,
                    jsonb_build_object('form_id', v_a.form_id, 'event_id', v_a.event_id, 'brand_id', v_a.brand_id,
                                       'form_name', v_a.form_name, 'event_title', v_a.event_title,
                                       'deep_link', 'mingla-business://marketing/forms/' || v_a.form_id::text || '/responses'),
                    'brand_form_reminder_held:' || v_a.attachment_id::text || ':'
                      || extract(epoch FROM v_d.starts_at)::bigint::text)
            ON CONFLICT (idempotency_key) DO NOTHING;
          END IF;
        END IF;
        CONTINUE;
      END IF;
      INSERT INTO public.brand_form_auto_reminder_runs (attachment_id, form_id, event_id, starts_at, outcome)
      VALUES (v_a.attachment_id, v_a.form_id, v_a.event_id, v_d.starts_at, 'sending')
      ON CONFLICT (attachment_id, starts_at) DO NOTHING
      RETURNING id INTO v_run;
      IF v_run IS NULL THEN
        SELECT r.id INTO v_run FROM public.brand_form_auto_reminder_runs r
         WHERE r.attachment_id = v_a.attachment_id AND r.starts_at = v_d.starts_at AND r.outcome <> 'held_form_closed';
        IF v_run IS NULL THEN CONTINUE; END IF;
      ELSE
        v_runs := v_runs + 1;
      END IF;
      -- The brand lock (the one brand_form_request_enqueue takes), then the
      -- texts left today, read under it.
      PERFORM pg_advisory_xact_lock(hashtextextended('brand_form_request:' || v_a.brand_id::text, 4514));
      v_left := GREATEST(public.brand_form_request_text_cap() - public.brand_form_request_texts_today(v_a.brand_id), 0);
      WITH due AS (
        SELECT DISTINCT ON (g.g_person_key) g.*
          FROM public.brand_form_request_guests(v_a.form_id, v_a.event_id, NULL) g
         WHERE EXISTS (SELECT 1 FROM public.brand_form_guest_dates(g.g_kind, g.g_id, v_a.event_id) d(at)
                        WHERE d.at = v_d.starts_at)
         ORDER BY g.g_person_key, g.g_answered DESC, g.g_kind, g.g_id
      ), ins AS (
        INSERT INTO public.brand_form_request_sends (form_id, attachment_id, event_id, brand_id, rsvp_id, order_id,
               run_id, person_key, kind, route, status, safe_reason, starts_at, not_before, settled_at)
        SELECT v_a.form_id, v_a.attachment_id, v_a.event_id, v_a.brand_id,
               CASE WHEN y.g_kind = 'rsvp' THEN y.g_id END, CASE WHEN y.g_kind = 'order' THEN y.g_id END,
               -- A skipped guest keeps the text route, so the log shows the text that did not go.
               v_run, y.g_person_key, 'auto', CASE WHEN cardinality(y.sent_route) = 0 THEN y.route ELSE y.sent_route END,
               CASE WHEN cardinality(y.route) = 0 THEN 'unreachable'
                    WHEN cardinality(y.sent_route) = 0 THEN 'skipped' ELSE 'queued' END,
               CASE WHEN cardinality(y.route) = 0 THEN 'no_contact' WHEN y.capped THEN 'text_cap' END,
               v_d.starts_at,
               CASE WHEN y.sent_route[1] = 'sms' THEN public.brand_form_text_window(v_a.tz, now()) ELSE now() END,
               CASE WHEN cardinality(y.sent_route) = 0 THEN now() END
          FROM (SELECT z.*, z.route[1] = 'sms' AND z.text_n > v_left AS capped,
                       CASE WHEN z.route[1] = 'sms' AND z.text_n > v_left THEN array_remove(z.route, 'sms')
                            ELSE z.route END AS sent_route
                  FROM (SELECT x.*, row_number() OVER (PARTITION BY x.route[1] = 'sms'
                                                       ORDER BY x.g_kind, x.g_id) AS text_n
                          FROM (SELECT due.*, public.brand_form_request_route(due.g_phone, due.g_email, v_ch) AS route
                                  FROM due) x
                         WHERE NOT x.g_answered
                           AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                            WHERE s.form_id = v_a.form_id AND s.person_key = x.g_person_key
                                              AND s.status IN ('queued', 'claimed', 'sent')
                                              AND s.created_at > now() - interval '24 hours')
                           AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s
                                            WHERE s.run_id = v_run AND s.person_key = x.g_person_key)) z) y
        ON CONFLICT (run_id, person_key) WHERE run_id IS NOT NULL DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::integer INTO v_n FROM ins;
      v_queued := v_queued + v_n;
      IF v_n > 0 THEN
        UPDATE public.brand_form_auto_reminder_runs SET outcome = 'sending', settled_at = NULL
         WHERE id = v_run AND outcome IN ('sent', 'failed');
      END IF;
      v_run := NULL;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('runs', v_runs, 'queued', v_queued, 'held', v_held);
END;
$fn$;

-- The host's delivery log for one form on one page (event manager and up, C5):
-- each request with its guest, how it went out (or why not) and the automatic
-- reminder runs. Optionally one guest. Never the link or the contact.
CREATE FUNCTION public.biz_brand_form_request_log(
  p_form_id uuid, p_event_id uuid, p_subject jsonb DEFAULT NULL, p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_brand uuid;
  v_kind text;
  v_id uuid;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_subject IS NOT NULL THEN
    IF jsonb_typeof(p_subject) <> 'object' OR COALESCE(p_subject->>'kind', '') NOT IN ('rsvp', 'order')
       OR COALESCE(p_subject->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
      RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
    END IF;
    v_kind := p_subject->>'kind';
    v_id := (p_subject->>'id')::uuid;
  END IF;
  -- The role first (the page's brand, else the form's): a caller below event
  -- manager learns nothing about which forms or pages exist.
  v_brand := COALESCE((SELECT e.brand_id FROM public.events e WHERE e.id = p_event_id),
                      (SELECT f.brand_id FROM public.brand_forms f WHERE f.id = p_form_id));
  PERFORM public.brand_form_require_rank(v_brand, 'event_manager');
  IF NOT EXISTS (SELECT 1 FROM public.brand_forms f WHERE f.id = p_form_id AND f.brand_id = v_brand)
     OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.brand_id = v_brand) THEN
    RAISE EXCEPTION 'form_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'sends', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'kind', s.kind, 'subjectKind', CASE WHEN s.rsvp_id IS NOT NULL THEN 'rsvp' ELSE 'order' END,
               'subjectId', COALESCE(s.rsvp_id, s.order_id),
               'name', public.brand_form_short_name(COALESCE(x.guest_name, o.buyer_name)),
               'channel', COALESCE(s.channel, s.route[1]), 'status', s.status, 'reason', s.safe_reason,
               'notBefore', s.not_before, 'createdAt', s.created_at, 'settledAt', s.settled_at)
             ORDER BY s.created_at DESC, s.id)
        FROM (SELECT * FROM public.brand_form_request_sends s0
               WHERE s0.form_id = p_form_id AND s0.event_id = p_event_id
                 AND (v_kind IS NULL OR (v_kind = 'rsvp' AND s0.rsvp_id = v_id) OR (v_kind = 'order' AND s0.order_id = v_id))
               ORDER BY s0.created_at DESC, s0.id LIMIT p_limit) s
        LEFT JOIN public.event_rsvps x ON x.id = s.rsvp_id
        LEFT JOIN public.orders o ON o.id = s.order_id), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
                 'queued', count(*) FILTER (WHERE s.status IN ('queued', 'claimed')),
                 'sent', count(*) FILTER (WHERE s.status = 'sent'),
                 'failed', count(*) FILTER (WHERE s.status = 'failed'),
                 'unreachable', count(*) FILTER (WHERE s.status = 'unreachable'),
                 'skipped', count(*) FILTER (WHERE s.status = 'skipped'))
                 FROM public.brand_form_request_sends s
                WHERE s.form_id = p_form_id AND s.event_id = p_event_id
                  AND (v_kind IS NULL OR (v_kind = 'rsvp' AND s.rsvp_id = v_id) OR (v_kind = 'order' AND s.order_id = v_id))),
    'runs', CASE WHEN v_kind IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('startsAt', r.starts_at, 'outcome', r.outcome,
               'createdAt', r.created_at, 'settledAt', r.settled_at) ORDER BY r.starts_at DESC)
        FROM public.brand_form_auto_reminder_runs r
       WHERE r.form_id = p_form_id AND r.event_id = p_event_id), '[]'::jsonb) END);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.brand_forms_switched_off(),
  public.brand_form_definition_errors(jsonb),
  public.validate_brand_form_definition(jsonb),
  public.brand_form_check_answers(jsonb, jsonb),
  public.brand_form_can_read_brand(uuid),
  public.brand_form_token_hash(text),
  public.brand_form_brand_header(uuid),
  public.brand_form_short_name(text),
  public.brand_form_subject_event(text, uuid),
  public.brand_form_find_response(uuid, text, uuid),
  public.brand_form_person_response(uuid, text, uuid, uuid),
  public.brand_form_person_lock_key(uuid, text, uuid),
  public.brand_form_event_public(uuid),
  public.brand_form_active_for_event(uuid),
  public.brand_form_answer_text(jsonb, jsonb),
  public.brand_form_cut(text, integer),
  public.brand_form_validate_answers(uuid, jsonb),
  public.brand_form_require_rank(uuid, text),
  public.biz_brand_form_create(uuid, text, jsonb),
  public.biz_brand_form_save_draft(uuid, jsonb, integer, text),
  public.biz_brand_form_publish(uuid, integer),
  public.biz_brand_form_close(uuid),
  public.biz_brand_form_reopen(uuid),
  public.biz_brand_form_archive(uuid),
  public.biz_brand_form_set_door_full_answers(uuid, boolean),
  public.biz_brand_form_attach(uuid, uuid, text, boolean, uuid),
  public.biz_brand_form_detach(uuid),
  public.brand_form_event_responses(uuid, uuid),
  public.biz_brand_form_responses(uuid, uuid, text, integer, integer),
  public.biz_brand_form_responses_export(uuid, uuid),
  public.brand_form_page_form(uuid),
  public.public_brand_form_for_event(uuid),
  public.brand_form_code_grant_ok(uuid, uuid),
  public.brand_form_link_by_token(text),
  public.brand_form_link_subject(public.brand_form_links),
  public.brand_form_subject_contact(text, uuid),
  public.brand_form_my_response(uuid, uuid, text, uuid),
  public.brand_forms_my_pending(),
  public.brand_form_link_issue(uuid, uuid, jsonb, uuid, integer),
  public.brand_form_link_resolve(text),
  public.brand_form_code_begin(uuid, text, text, text, text),
  public.brand_form_submit_core(jsonb),
  public.brand_form_door_authority(uuid, uuid),
  public.brand_form_door_order_header(uuid, uuid),
  public.brand_form_door_answers(uuid, uuid, jsonb),
  public.brand_form_door_full_answers(uuid, uuid, jsonb, text),
  public.brand_form_unanswered_count(uuid, uuid),
  public.brand_form_code_challenge(uuid, text),
  public.brand_form_code_settle(uuid, text, text, boolean),
  public.biz_brand_form_counts(uuid),
  public.brand_form_earlier_guests(uuid, uuid),
  public.brand_form_roster_export_answers(uuid),
  public.brand_form_request_text_cap(),
  public.brand_form_request_texts_today(uuid),
  public.brand_form_person_key(uuid, text, uuid),
  public.brand_form_request_route(text, text, text[]),
  public.brand_form_text_window(text, timestamptz),
  public.brand_form_request_guests(uuid, uuid, jsonb),
  public.brand_form_guest_dates(text, uuid, uuid),
  public.brand_form_request_audience(uuid, uuid, uuid, text, jsonb, text[]),
  public.brand_form_request_enqueue(uuid, uuid, uuid, text, text, jsonb, text[]),
  public.brand_form_request_claim_batch(integer, uuid, uuid),
  public.brand_form_request_settle(uuid, text, text, text),
  public.biz_brand_form_set_auto_remind(uuid, boolean, text[]),
  public.brand_form_auto_reminders_due(),
  public.biz_brand_form_request_log(uuid, uuid, jsonb, integer)
FROM PUBLIC, anon, authenticated;

-- Pure validators: the builder may check a draft before saving.
GRANT EXECUTE ON FUNCTION public.brand_form_definition_errors(jsonb), public.validate_brand_form_definition(jsonb),
  public.brand_form_check_answers(jsonb, jsonb) TO authenticated, service_role;
-- RLS helper used inside policies.
GRANT EXECUTE ON FUNCTION public.brand_form_can_read_brand(uuid) TO authenticated, service_role;
-- Host RPCs.
GRANT EXECUTE ON FUNCTION
  public.biz_brand_form_create(uuid, text, jsonb),
  public.biz_brand_form_save_draft(uuid, jsonb, integer, text),
  public.biz_brand_form_publish(uuid, integer),
  public.biz_brand_form_close(uuid),
  public.biz_brand_form_reopen(uuid),
  public.biz_brand_form_archive(uuid),
  public.biz_brand_form_set_door_full_answers(uuid, boolean),
  public.biz_brand_form_attach(uuid, uuid, text, boolean, uuid),
  public.biz_brand_form_detach(uuid),
  public.biz_brand_form_responses(uuid, uuid, text, integer, integer),
  public.biz_brand_form_responses_export(uuid, uuid),
  public.biz_brand_form_counts(uuid),
  public.biz_brand_form_set_auto_remind(uuid, boolean, text[]),
  public.biz_brand_form_request_log(uuid, uuid, jsonb, integer)
TO authenticated, service_role;
-- Public and guest reads.
GRANT EXECUTE ON FUNCTION public.public_brand_form_for_event(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.brand_form_my_response(uuid, uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.brand_forms_my_pending() TO authenticated, service_role;
-- Service role only: the submit core, links, codes, door reads and their helpers.
GRANT EXECUTE ON FUNCTION
  public.brand_forms_switched_off(),
  public.brand_form_token_hash(text),
  public.brand_form_brand_header(uuid),
  public.brand_form_short_name(text),
  public.brand_form_subject_event(text, uuid),
  public.brand_form_find_response(uuid, text, uuid),
  public.brand_form_person_response(uuid, text, uuid, uuid),
  public.brand_form_person_lock_key(uuid, text, uuid),
  public.brand_form_event_public(uuid),
  public.brand_form_active_for_event(uuid),
  public.brand_form_answer_text(jsonb, jsonb),
  public.brand_form_cut(text, integer),
  public.brand_form_validate_answers(uuid, jsonb),
  public.brand_form_require_rank(uuid, text),
  public.brand_form_event_responses(uuid, uuid),
  public.brand_form_code_grant_ok(uuid, uuid),
  public.brand_form_link_by_token(text),
  public.brand_form_link_subject(public.brand_form_links),
  public.brand_form_subject_contact(text, uuid),
  public.brand_form_link_issue(uuid, uuid, jsonb, uuid, integer),
  public.brand_form_link_resolve(text),
  public.brand_form_code_begin(uuid, text, text, text, text),
  public.brand_form_submit_core(jsonb),
  public.brand_form_door_authority(uuid, uuid),
  public.brand_form_door_order_header(uuid, uuid),
  public.brand_form_door_answers(uuid, uuid, jsonb),
  public.brand_form_door_full_answers(uuid, uuid, jsonb, text),
  public.brand_form_unanswered_count(uuid, uuid),
  public.brand_form_code_challenge(uuid, text),
  public.brand_form_code_settle(uuid, text, text, boolean),
  public.brand_form_earlier_guests(uuid, uuid),
  public.brand_form_roster_export_answers(uuid),
  public.brand_form_request_text_cap(),
  public.brand_form_request_texts_today(uuid),
  public.brand_form_person_key(uuid, text, uuid),
  public.brand_form_request_route(text, text, text[]),
  public.brand_form_text_window(text, timestamptz),
  public.brand_form_request_guests(uuid, uuid, jsonb),
  public.brand_form_guest_dates(text, uuid, uuid),
  public.brand_form_request_audience(uuid, uuid, uuid, text, jsonb, text[]),
  public.brand_form_request_enqueue(uuid, uuid, uuid, text, text, jsonb, text[]),
  public.brand_form_request_claim_batch(integer, uuid, uuid),
  public.brand_form_request_settle(uuid, text, text, text),
  public.brand_form_auto_reminders_due()
TO service_role;

COMMENT ON FUNCTION public.brand_form_submit_core(jsonb) IS '#4514: the only RPC writer of brand_form_responses (service role; brand-form-submit); checkout answers arrive through the brand_form_finalize_checkout_answers trigger. See BUILD CONTRACT v2 §3.5 and the wave 1 implementation report on #4514 for codes.';
COMMENT ON FUNCTION public.brand_form_door_answers(uuid, uuid, jsonb) IS '#4514 §6: the door line (marked questions in both the answered and the live version), at most 3; null when there is nothing to show.';
COMMENT ON FUNCTION public.brand_form_door_full_answers(uuid, uuid, jsonb, text) IS '#4514 C4: one current guest (going RSVP, paid or partly refunded order) of this event per call, logged in brand_form_door_reads, 60 per actor per 10 minutes under a per-actor lock. Wave 6: an optional scanned ticketId (a ticket of this order at this event; a transferred ticket reads not_answered), the order header, and the answered definition with its stored answers for the read-only renderer.';
COMMENT ON FUNCTION public.brand_form_door_order_header(uuid, uuid) IS '#4514 §6 decision 15: the "From {first name} {initial}.''s order" header for a scanned ticket that is not the buyer''s own; null otherwise.';

-- ---------------------------------------------------------------------------
-- Wave 5: the checkout Questions step (tickets and experiences) and the
-- server-side required-answers check (BUILD CONTRACT v2 §3.6 "Ticket and
-- experience checkout"; C1 capability marker; C8 off switch; C9 door sales).
-- ---------------------------------------------------------------------------
-- ticket-checkout-create checks the answers BEFORE the checkout session exists
-- (brand_form_checkout_check) and, once the session row exists and before any
-- quote bind, free finalization or provider call, stashes them against that
-- session (brand_form_checkout_stash). The order row does not exist yet, so the
-- answers cannot be a response yet. They become the order's response inside the
-- SAME transaction that gives the session its order (the paid webhook / confirm
-- finalize and the free finalize all set ticket_checkout_sessions.order_id), by
-- the trigger below, beside #3859's issue_3859_finalize_intake_snapshot. So the
-- order and its response commit together or not at all; a payment that fails or
-- is abandoned never sets order_id and leaves no response; a replayed webhook
-- does not change order_id and the trigger does nothing.
--
-- No marker (an older client that cannot show the step): the order completes and
-- the buyer is "to answer" (C1). Door sales send no marker and are exempt (C9).
-- Off switch on: nothing is checked or stashed (OP-7 / C8).

-- MINGLA-INVARIANT: I-4514-CHECKOUT-FORM-BEFORE-PAYMENT | issue #4514 | with a required, live form on the page and the capability marker, ticket-checkout-create refuses missing or invalid answers before any session, payment-provider object or free order exists, and the answers become the order's response only in the transaction that gives the session its order (pg17 T-CHECKOUT; Deno issue_4514_checkout_form in ticket-checkout-create).
CREATE TABLE public.brand_form_checkout_answers (
  checkout_session_id uuid PRIMARY KEY REFERENCES public.ticket_checkout_sessions(id) ON DELETE CASCADE,
  event_id            uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  -- CASCADE, not RESTRICT: a stash is short-lived scratch for one checkout and
  -- must never be what stops a form, its versions or its brand being removed.
  form_id             uuid NOT NULL REFERENCES public.brand_forms(id) ON DELETE CASCADE,
  version_id          uuid NOT NULL REFERENCES public.brand_form_versions(id) ON DELETE CASCADE,
  attachment_id       uuid REFERENCES public.brand_form_attachments(id) ON DELETE SET NULL,
  answers             jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_form_checkout_answers_created_idx ON public.brand_form_checkout_answers (created_at);
ALTER TABLE public.brand_form_checkout_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_form_checkout_answers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_form_checkout_answers TO service_role;
COMMENT ON TABLE public.brand_form_checkout_answers IS '#4514 wave 5: checkout answers stashed per checkout session before payment; moved into brand_form_responses by brand_form_finalize_checkout_answers when the session gets its order. Service role only.';

-- MINGLA-INVARIANT: I-4514-CHECKOUT-FORM-ONE-VISIBILITY-RULE | issue #4514 | the checkout form read (brand_form_checkout_form) and the required-answers check (brand_form_checkout_check / _stash) decide whether the page's form applies with this ONE rule, from the credential the buyer already presents to ticket-checkout-create, so a buyer is never refused for a form they cannot see (pg17 T-CHECKOUT-VIS).
-- Whether this buyer may see the page's form at checkout. A publicly readable
-- page (brand_form_event_public: public or hidden, scheduled or live, not
-- deleted, not read-blocked) needs no credential. A private page (#1931) needs
-- the credential checkout itself would take for it: the signed-in buyer's
-- active, current-epoch access grant while private access is switched on. A
-- private ticket link (#3827), when presented, must be live for THIS event; a
-- link that is not (wrong event, revoked, expired, full) gives nothing. Absent
-- or invalid credential: false, and both the read and the check then treat the
-- page as having no enforceable form ("to answer").
CREATE FUNCTION public.brand_form_checkout_visible(
  p_event_id uuid, p_buyer_user_id uuid, p_ticket_link_hash text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_e record;
  v_link public.ticket_type_links;
BEGIN
  SELECT e.id, e.visibility, e.status, e.deleted_at, b.deleted_at AS brand_deleted_at INTO v_e
    FROM public.events e JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = p_event_id;
  IF NOT FOUND OR v_e.deleted_at IS NOT NULL OR v_e.brand_deleted_at IS NOT NULL
     OR v_e.status NOT IN ('scheduled', 'live')
     OR public.issue_1931_event_ordinary_read_blocked(p_event_id) THEN
    RETURN false;
  END IF;
  IF p_ticket_link_hash IS NOT NULL THEN
    IF p_ticket_link_hash !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
    SELECT l.* INTO v_link FROM public.ticket_type_links l
     WHERE l.token_hash = p_ticket_link_hash AND l.event_id = p_event_id AND l.kind = 'private_ticket';
    IF NOT FOUND OR public.issue_3827_link_state(v_link, now()) <> 'active' THEN RETURN false; END IF;
  END IF;
  IF v_e.visibility IN ('public', 'hidden') THEN RETURN true; END IF;
  IF v_e.visibility <> 'private' OR p_buyer_user_id IS NULL
     OR NOT public.issue_1931_private_event_access_ready() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.private_event_access_state st
      JOIN public.private_event_access_grants g ON g.event_id = st.event_id AND g.epoch = st.epoch
     WHERE st.event_id = p_event_id AND st.active
       AND g.principal_kind = 'authenticated_user' AND g.bound_user_id = p_buyer_user_id
       AND g.state = 'active' AND g.revoked_at IS NULL AND g.expires_at > now());
END;
$fn$;

-- The checkout's form read (service role; brand-form-submit {op:"checkout_form"},
-- which derives the buyer from the bearer and hashes the ticket link). The same
-- shape as the public read and nothing more (title, questions, brand header),
-- under the shared visibility rule. OP-5: a signed-in buyer who has already
-- answered this form gets `answered: true` and no step.
CREATE FUNCTION public.brand_form_checkout_form(
  p_event_id uuid, p_buyer_user_id uuid, p_ticket_link_hash text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.brand_form_checkout_visible(p_event_id, p_buyer_user_id, p_ticket_link_hash) THEN
    RETURN jsonb_build_object('active', false);
  END IF;
  v_out := public.brand_form_page_form(p_event_id);
  IF (v_out->>'active')::boolean AND p_buyer_user_id IS NOT NULL
     AND (public.brand_form_find_response((v_out->>'formId')::uuid, 'user', p_buyer_user_id)).id IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('answered', true);
  END IF;
  RETURN v_out;
END;
$fn$;

-- The check. Pure read: raises form_answers_required / form_answers_invalid /
-- form_changed, or returns {outcome}: 'off' (switch on), 'none' (nothing to keep),
-- 'to_answer' (required form, no marker or no credential to see it: the order
-- completes unanswered), 'answered' (OP-5: the signed-in buyer already answered
-- this form; nothing is asked or kept and the order shows as answered through
-- brand_form_find_response) or 'stash' (valid answers, cleaned by the validator).
CREATE FUNCTION public.brand_form_checkout_check(
  p_event_id uuid, p_capable boolean, p_form jsonb, p_buyer_user_id uuid, p_ticket_link_hash text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_a record;
  v_required boolean;
  v_check jsonb;
  v_has_answers boolean;
BEGIN
  IF public.brand_forms_switched_off() THEN RETURN jsonb_build_object('outcome', 'off'); END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(p_event_id);
  -- No form, a closed form (§3.6: closed mid-flow lets the purchase through) or
  -- one asked after purchase: nothing is checked here.
  IF NOT FOUND OR v_a.form_status <> 'live' OR v_a.mode NOT IN ('required_step', 'optional_on_page') THEN
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  v_required := v_a.mode = 'required_step';
  -- The ONE visibility rule the checkout read uses: a buyer is never refused for
  -- a form they cannot see.
  IF NOT public.brand_form_checkout_visible(p_event_id, p_buyer_user_id, p_ticket_link_hash) THEN
    RETURN jsonb_build_object('outcome', CASE WHEN v_required THEN 'to_answer' ELSE 'none' END,
                              'formId', v_a.form_id, 'reason', 'not_visible');
  END IF;
  -- OP-5 (§3.6 step 2): the same person already has a response to this form.
  IF p_buyer_user_id IS NOT NULL
     AND (public.brand_form_find_response(v_a.form_id, 'user', p_buyer_user_id)).id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'answered', 'formId', v_a.form_id);
  END IF;
  IF NOT COALESCE(p_capable, false) THEN
    RETURN jsonb_build_object('outcome', CASE WHEN v_required THEN 'to_answer' ELSE 'none' END,
                              'formId', v_a.form_id);
  END IF;
  v_has_answers := COALESCE(jsonb_typeof(p_form) = 'object' AND jsonb_typeof(p_form->'answers') = 'object', false);
  IF NOT v_has_answers THEN
    IF v_required THEN
      RAISE EXCEPTION 'form_answers_required' USING ERRCODE = '22023',
        DETAIL = jsonb_build_object('formId', v_a.form_id, 'versionId', v_a.live_version_id)::text;
    END IF;
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  -- Answers for another form, or for a version that is no longer live.
  IF (p_form->>'formId') IS DISTINCT FROM v_a.form_id::text
     OR (p_form->>'versionId') IS DISTINCT FROM v_a.live_version_id::text THEN
    IF v_required THEN
      RAISE EXCEPTION 'form_changed' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('formId', v_a.form_id, 'versionId', v_a.live_version_id)::text;
    END IF;
    -- An optional form never blocks a purchase: stale optional answers are not kept.
    RETURN jsonb_build_object('outcome', 'none', 'reason', 'form_changed');
  END IF;
  BEGIN
    v_check := public.brand_form_validate_answers(v_a.live_version_id, p_form->'answers');
  EXCEPTION WHEN data_exception THEN
    v_check := jsonb_build_object('ok', false,
      'errors', jsonb_build_array(jsonb_build_object('questionId', NULL, 'code', 'type')));
  END;
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'form_answers_invalid' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
  END IF;
  RETURN jsonb_build_object('outcome', 'stash', 'formId', v_a.form_id, 'versionId', v_a.live_version_id,
                            'attachmentId', v_a.attachment_id, 'answers', v_check->'answers');
END;
$fn$;

-- The stash: re-runs the check (authoritative) and keeps valid answers against
-- the session. A session that already has its order is left alone (a replay).
CREATE FUNCTION public.brand_form_checkout_stash(
  p_checkout_session_id uuid, p_event_id uuid, p_capable boolean, p_form jsonb,
  p_buyer_user_id uuid, p_ticket_link_hash text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_session record;
  v_out jsonb;
BEGIN
  SELECT s.id, s.event_id, s.order_id INTO v_session
    FROM public.ticket_checkout_sessions s
   WHERE s.id = p_checkout_session_id AND s.event_id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_session_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_session.order_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'finalized');
  END IF;
  v_out := public.brand_form_checkout_check(p_event_id, p_capable, p_form, p_buyer_user_id, p_ticket_link_hash);
  IF v_out->>'outcome' <> 'stash' THEN
    -- A retry of this session without answers keeps nothing from an earlier try.
    DELETE FROM public.brand_form_checkout_answers WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_out;
  END IF;
  INSERT INTO public.brand_form_checkout_answers AS c
    (checkout_session_id, event_id, form_id, version_id, attachment_id, answers)
  VALUES (p_checkout_session_id, p_event_id, (v_out->>'formId')::uuid, (v_out->>'versionId')::uuid,
          (v_out->>'attachmentId')::uuid, v_out->'answers')
  ON CONFLICT (checkout_session_id) DO UPDATE
    SET form_id = EXCLUDED.form_id, version_id = EXCLUDED.version_id,
        attachment_id = EXCLUDED.attachment_id, answers = EXCLUDED.answers, updated_at = now();
  RETURN jsonb_build_object('outcome', 'stash', 'formId', v_out->'formId', 'versionId', v_out->'versionId');
END;
$fn$;

-- The promotion, in the transaction that sets the session's order (paid and free).
CREATE FUNCTION public.brand_form_finalize_checkout_answers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_s public.brand_form_checkout_answers;
  v_brand uuid;
BEGIN
  IF NEW.order_id IS NULL OR NEW.order_id IS NOT DISTINCT FROM OLD.order_id THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_s FROM public.brand_form_checkout_answers
   WHERE checkout_session_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT f.brand_id INTO v_brand FROM public.brand_forms f WHERE f.id = v_s.form_id;
  -- One response per order per form: a second finalize of the same order keeps the first.
  INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, attachment_id, event_id,
                                           order_id, answers, source)
  VALUES (v_s.form_id, v_s.version_id, v_brand, v_s.attachment_id, v_s.event_id,
          NEW.order_id, v_s.answers, 'page')
  ON CONFLICT (form_id, order_id) WHERE order_id IS NOT NULL DO NOTHING;
  DELETE FROM public.brand_form_checkout_answers WHERE checkout_session_id = NEW.id;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_form_finalize_checkout_answers() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER brand_form_finalize_checkout_answers
AFTER UPDATE OF order_id ON public.ticket_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.brand_form_finalize_checkout_answers();

-- SC-35: stashed answers of an abandoned checkout (no order) are purged 7 days
-- after the session expired. Run daily by the EXISTING forms retention job
-- (issue_4452_forms_retention, 03:17 UTC); no new cron.
CREATE FUNCTION public.brand_form_checkout_answers_purge() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.brand_form_checkout_answers c
   USING public.ticket_checkout_sessions s
   WHERE s.id = c.checkout_session_id AND s.order_id IS NULL
     AND s.expires_at < now() - interval '7 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- Hook the purge into the existing daily forms retention job: its command keeps
-- every statement it has and gains one line. Skipped loudly when pg_cron or that
-- job is missing; a new job is never scheduled here.
DO $cron$
DECLARE
  v_job bigint;
  v_cmd text;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '#4514: pg_cron unavailable; checkout answer purge not hooked'; RETURN;
  END IF;
  SELECT jobid, command INTO v_job, v_cmd FROM cron.job WHERE jobname = 'issue_4452_forms_retention';
  IF v_job IS NULL THEN
    RAISE NOTICE '#4514: issue_4452_forms_retention missing; checkout answer purge not hooked'; RETURN;
  END IF;
  IF position('brand_form_checkout_answers_purge' IN v_cmd) = 0 THEN
    PERFORM cron.alter_job(v_job, command := rtrim(v_cmd, E' \n') || E'\n    SELECT public.brand_form_checkout_answers_purge();\n  ');
  END IF;
END;
$cron$;

-- "After they purchase" (§5.5): the buyer's success screen asks for a personal
-- link for their own order. Possession is the checkout session's buyer status
-- token (its SHA-256 hex, as attendance-claim-link checks it). Never an invite
-- (decision 17): this mints a brand form link through brand_form_link_issue.
CREATE FUNCTION public.brand_form_purchase_link(p_checkout_session_id uuid, p_buyer_status_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_session record;
  v_a record;
  v_resp public.brand_form_responses;
  v_link jsonb;
BEGIN
  SELECT s.id, s.event_id, s.order_id INTO v_session
    FROM public.ticket_checkout_sessions s
   WHERE s.id = p_checkout_session_id
     AND p_buyer_status_token_hash ~ '^[0-9a-f]{64}$'
     AND s.buyer_status_token_hash = p_buyer_status_token_hash
     AND s.status IN ('paid_completed', 'free_completed')
     AND s.order_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_invalid' USING ERRCODE = '42501'; END IF;
  IF public.brand_forms_switched_off() THEN RETURN jsonb_build_object('outcome', 'none'); END IF;
  SELECT * INTO v_a FROM public.brand_form_active_for_event(v_session.event_id);
  IF NOT FOUND OR v_a.form_status <> 'live' OR v_a.mode <> 'after_purchase' THEN
    RETURN jsonb_build_object('outcome', 'none');
  END IF;
  v_resp := public.brand_form_person_response(v_a.form_id, 'order', v_session.order_id, v_session.event_id);
  IF v_resp.id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'answered', 'formId', v_a.form_id);
  END IF;
  PERFORM pg_advisory_xact_lock(public.brand_form_person_lock_key(v_a.form_id, 'order', v_session.order_id));
  -- A reload mints a fresh link; ten a day per order is plenty and bounds a loop.
  IF (SELECT count(*) FROM public.brand_form_links l
       WHERE l.form_id = v_a.form_id AND l.order_id = v_session.order_id AND l.created_by IS NULL
         AND l.created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;
  v_link := public.brand_form_link_issue(v_a.form_id, v_session.event_id,
              jsonb_build_object('kind', 'order', 'id', v_session.order_id), NULL, 30);
  RETURN jsonb_build_object('outcome', 'link', 'formId', v_a.form_id, 'token', v_link->>'token');
END;
$fn$;

REVOKE ALL ON FUNCTION
  public.brand_form_checkout_visible(uuid, uuid, text),
  public.brand_form_checkout_form(uuid, uuid, text),
  public.brand_form_checkout_check(uuid, boolean, jsonb, uuid, text),
  public.brand_form_checkout_stash(uuid, uuid, boolean, jsonb, uuid, text),
  public.brand_form_checkout_answers_purge(),
  public.brand_form_purchase_link(uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.brand_form_checkout_visible(uuid, uuid, text),
  public.brand_form_checkout_form(uuid, uuid, text),
  public.brand_form_checkout_check(uuid, boolean, jsonb, uuid, text),
  public.brand_form_checkout_stash(uuid, uuid, boolean, jsonb, uuid, text),
  public.brand_form_checkout_answers_purge(),
  public.brand_form_purchase_link(uuid, text)
TO service_role;


COMMIT;
