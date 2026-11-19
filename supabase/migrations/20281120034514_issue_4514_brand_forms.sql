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
-- Not here (later waves): the RSVP wrapper submit_event_rsvp_with_form (after
-- #4508 merges), the checkout answer stash (slice 2), the form_request send
-- purpose (C6), the ticket_id subject (OP-6).
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
CREATE FUNCTION public.public_brand_form_for_event(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_e record;
  v_a record;
  v_def jsonb;
BEGIN
  -- Nothing for a page that is not publicly visible (private, draft, deleted, ended).
  IF NOT public.brand_form_event_public(p_event_id) THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT e.id, e.brand_id INTO v_e FROM public.events e WHERE e.id = p_event_id;
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
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  PERFORM public.brand_form_door_authority(p_actor_id, p_event_id);
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
  -- "From {first name} {initial}.'s order". The buyer's own ticket is the one whose
  -- holder is the buyer (by user, else by holder or attendee email); with no holder
  -- on the ticket, the order's first ticket. A ticket sent to a friend (#4063,
  -- transfer_state 'claimed') is another ticket of the order; a ticket moved by the
  -- older transfer (status 'transferred' or transferred_at) shows none of the order's answers.
  IF v_ticket IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
        WHERE t.id = v_ticket
          AND CASE
                WHEN t.holder_user_id IS NOT NULL THEN t.holder_user_id = o.buyer_user_id
                WHEN NULLIF(btrim(COALESCE(t.holder_email, t.attendee_email)), '') IS NOT NULL
                  THEN lower(btrim(COALESCE(t.holder_email, t.attendee_email))) = lower(btrim(COALESCE(o.buyer_email, '')))
                ELSE t.id = (SELECT t2.id FROM public.tickets t2 WHERE t2.order_id = o.id
                              ORDER BY t2.created_at, t2.id LIMIT 1)
              END) THEN
    SELECT public.brand_form_short_name(o.buyer_name) INTO v_from FROM public.orders o WHERE o.id = v_sid;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('state', 'answered', 'formName', v_a.form_name,
    'fromOrderOf', v_from,
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
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_rank := public.brand_form_door_authority(p_actor_id, p_event_id);
  IF COALESCE(v_kind, '') NOT IN ('rsvp', 'order') OR COALESCE(p_subject->>'id', '') !~ v_uuid
     OR COALESCE(p_via, '') NOT IN ('scan', 'search') THEN
    RAISE EXCEPTION 'subject_invalid' USING ERRCODE = '22023';
  END IF;
  v_sid := (p_subject->>'id')::uuid;
  IF public.brand_form_subject_event(v_kind, v_sid) IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'subject_other_event' USING ERRCODE = '42501';
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
      v_out := jsonb_build_object('state', 'answered', 'formName', v_a.form_name,
                 'brand', public.brand_form_brand_header(v_a.brand_id),
                 'answeredAt', v_resp.updated_at, 'isCurrentVersion', v_resp.version_id = v_a.live_version_id,
                 'questions', v_questions);
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
-- "Not answered" list, counted).
CREATE FUNCTION public.brand_form_unanswered_count(p_form_id uuid, p_event_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT (SELECT count(*) FROM public.event_rsvps x
           WHERE x.event_id = p_event_id AND x.rsvp_status = 'going'
             AND (public.brand_form_find_response(p_form_id, 'rsvp', x.id)).id IS NULL)::integer
       + (SELECT count(*) FROM public.orders o
           WHERE o.event_id = p_event_id AND o.payment_status IN ('paid', 'partial_refund')
             AND (public.brand_form_find_response(p_form_id, 'order', o.id)).id IS NULL)::integer;
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
-- an offering_guest_roster job, whose rank gate (event_manager+, C5) already ran
-- when the job was created. The page's active form (live or closed); none: no
-- columns. A person's answer is found from their RSVP, then their order, at this
-- page, by the one person rule.
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
  public.brand_form_door_answers(uuid, uuid, jsonb),
  public.brand_form_door_full_answers(uuid, uuid, jsonb, text),
  public.brand_form_unanswered_count(uuid, uuid),
  public.brand_form_code_challenge(uuid, text),
  public.brand_form_code_settle(uuid, text, text, boolean),
  public.biz_brand_form_counts(uuid),
  public.brand_form_earlier_guests(uuid, uuid),
  public.brand_form_roster_export_answers(uuid)
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
  public.biz_brand_form_counts(uuid)
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
  public.brand_form_door_answers(uuid, uuid, jsonb),
  public.brand_form_door_full_answers(uuid, uuid, jsonb, text),
  public.brand_form_unanswered_count(uuid, uuid),
  public.brand_form_code_challenge(uuid, text),
  public.brand_form_code_settle(uuid, text, text, boolean),
  public.brand_form_earlier_guests(uuid, uuid),
  public.brand_form_roster_export_answers(uuid)
TO service_role;

COMMENT ON FUNCTION public.brand_form_submit_core(jsonb) IS '#4514: the only writer of brand_form_responses (service role; brand-form-submit). See BUILD CONTRACT v2 §3.5 and the wave 1 implementation report on #4514 for codes.';
COMMENT ON FUNCTION public.brand_form_door_answers(uuid, uuid, jsonb) IS '#4514 §6: the door line (marked questions in both the answered and the live version), at most 3; null when there is nothing to show.';
COMMENT ON FUNCTION public.brand_form_door_full_answers(uuid, uuid, jsonb, text) IS '#4514 C4: one current guest (going RSVP, paid or partly refunded order) of this event per call, logged in brand_form_door_reads, 60 per actor per 10 minutes under a per-actor lock.';

COMMIT;
