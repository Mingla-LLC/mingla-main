-- Issue #3720 Completion Wave 4 — private Product Inbox ↔ Mingla Avengers.
--
-- Product signals remain private Mingla records. Only separately reviewed,
-- public-safe fields can cross the server-owned GitHub boundary. GitHub owns
-- engineering status and roadmap fields; Mingla owns customer wording and
-- never sends it automatically.
--
-- INVARIANT: {"id":"I-3720-AVENGERS-SERVER-ONLY","rule":"Authenticated browsers can queue bounded Product commands but cannot mutate GitHub-backed snapshots or bridge tables directly."}
-- INVARIANT: {"id":"I-3720-AVENGERS-EXISTING-FIRST","rule":"A new Avengers issue requires a completed candidate search and a written no-fit reason; linking requires a reviewed selected candidate."}
-- INVARIANT: {"id":"I-3720-AVENGERS-PRIVATE-EVIDENCE","rule":"Only explicit public-safe review fields are eligible for GitHub writes; Product signal sources and private evidence never enter a bridge command."}
-- INVARIANT: {"id":"I-3720-AVENGERS-DRAFT-ONLY","rule":"Engineering movement creates customer-safe drafts only; a person must approve roadmap wording and customer copy, and this wave exposes no customer-send function."}

BEGIN;
SET LOCAL lock_timeout = '10s';

SELECT set_config(
  'issue3720_wave4.is_admin_user_md5',
  (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.is_admin_user()'::regprocedure),
  true
);

DO $foundation$
BEGIN
  IF to_regclass('public.support_product_signals') IS NULL
     OR to_regclass('public.community_roadmap_cards') IS NULL THEN
    RAISE EXCEPTION 'issue3720_wave4_foundation_missing';
  END IF;
END;
$foundation$;

CREATE TABLE public.product_avengers_reviews (
  signal_id uuid PRIMARY KEY
    REFERENCES public.support_product_signals(id) ON DELETE CASCADE,
  public_title text NOT NULL
    CHECK (char_length(btrim(public_title)) BETWEEN 4 AND 200),
  public_problem_statement text NOT NULL
    CHECK (char_length(btrim(public_problem_statement)) BETWEEN 20 AND 8000),
  public_outcome text NOT NULL
    CHECK (char_length(btrim(public_outcome)) BETWEEN 10 AND 4000),
  public_acceptance_criteria text[] NOT NULL
    CHECK (cardinality(public_acceptance_criteria) BETWEEN 1 AND 20),
  board_work_type text NOT NULL
    CHECK (board_work_type IN ('Bug', 'Initiative')),
  board_product text NOT NULL
    CHECK (board_product IN ('Business', 'Explorer', 'Both', 'Platform')),
  board_theme text NOT NULL
    CHECK (char_length(btrim(board_theme)) BETWEEN 2 AND 80),
  board_priority text NOT NULL
    CHECK (board_priority IN ('P0', 'P1', 'P2', 'P3')),
  board_estimate text NOT NULL
    CHECK (board_estimate IN ('1', '2', '3', '5', '8', '13')),
  board_horizon text NOT NULL
    CHECK (board_horizon IN ('Now', 'Next', 'Later')),
  board_quarter text NOT NULL
    CHECK (board_quarter ~ '^Q[1-4] [0-9]{4}$'),
  candidates_checked_at timestamptz,
  no_fit_reason text
    CHECK (no_fit_reason IS NULL OR char_length(btrim(no_fit_reason)) BETWEEN 20 AND 2000),
  reviewed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_avengers_candidates (
  signal_id uuid NOT NULL
    REFERENCES public.support_product_signals(id) ON DELETE CASCADE,
  issue_number integer NOT NULL CHECK (issue_number > 0),
  issue_title text NOT NULL CHECK (char_length(btrim(issue_title)) BETWEEN 1 AND 300),
  issue_url text NOT NULL CHECK (issue_url ~ '^https://github[.]com/Mingla-LLC/mingla-main/issues/[0-9]+$'),
  issue_state text NOT NULL CHECK (issue_state IN ('OPEN', 'CLOSED')),
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'not_fit', 'selected')),
  decision_reason text
    CHECK (decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 10 AND 1000),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, issue_number)
);
CREATE UNIQUE INDEX product_avengers_candidates_one_selected
  ON public.product_avengers_candidates(signal_id)
  WHERE decision = 'selected';

CREATE TABLE public.product_avengers_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository text NOT NULL DEFAULT 'Mingla-LLC/mingla-main'
    CHECK (repository = 'Mingla-LLC/mingla-main'),
  issue_number integer NOT NULL CHECK (issue_number > 0),
  issue_node_id text NOT NULL CHECK (char_length(issue_node_id) BETWEEN 4 AND 200),
  project_item_id text NOT NULL CHECK (char_length(project_item_id) BETWEEN 4 AND 200),
  issue_url text NOT NULL CHECK (issue_url ~ '^https://github[.]com/Mingla-LLC/mingla-main/issues/[0-9]+$'),
  issue_title text NOT NULL CHECK (char_length(btrim(issue_title)) BETWEEN 1 AND 300),
  issue_state text NOT NULL CHECK (issue_state IN ('OPEN', 'CLOSED')),
  board_status text CHECK (board_status IN ('Todo', 'In Progress', 'In Review', 'Done')),
  board_work_type text,
  board_product text,
  board_theme text,
  board_priority text,
  board_estimate text,
  board_horizon text CHECK (board_horizon IS NULL OR board_horizon IN ('Now', 'Next', 'Later')),
  board_quarter text,
  board_refined text CHECK (board_refined IS NULL OR board_refined IN ('No', 'Yes')),
  board_sprint text,
  customer_status text NOT NULL DEFAULT 'Planned'
    CHECK (customer_status IN ('Planned', 'Being built', 'Final checks', 'Live')),
  issue_updated_at timestamptz,
  sync_state text NOT NULL DEFAULT 'synced'
    CHECK (sync_state IN ('syncing', 'synced', 'conflict', 'failed')),
  sync_error_code text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  release_evidence_url text,
  release_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  release_verified_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository, issue_number),
  UNIQUE (issue_node_id),
  UNIQUE (project_item_id)
);

CREATE TABLE public.product_signal_avengers_links (
  signal_id uuid PRIMARY KEY
    REFERENCES public.support_product_signals(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.product_avengers_items(id) ON DELETE CASCADE,
  link_kind text NOT NULL CHECK (link_kind IN ('existing', 'created')),
  linked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_signal_avengers_links_item_idx
  ON public.product_signal_avengers_links(item_id, linked_at);

CREATE TABLE public.product_avengers_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL
    REFERENCES public.support_product_signals(id) ON DELETE CASCADE,
  action text NOT NULL
    CHECK (action IN ('search', 'link_existing', 'create_issue', 'update_board', 'refresh')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'running', 'succeeded', 'failed')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_code text,
  request_key uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  UNIQUE (requested_by, request_key)
);
CREATE INDEX product_avengers_commands_pending_idx
  ON public.product_avengers_commands(requested_at, id)
  WHERE state IN ('pending', 'running');
CREATE UNIQUE INDEX product_avengers_commands_one_inflight_per_signal
  ON public.product_avengers_commands(signal_id)
  WHERE state IN ('pending', 'running');

CREATE TABLE public.product_customer_update_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL
    REFERENCES public.support_product_signals(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.product_avengers_items(id) ON DELETE CASCADE,
  customer_status text NOT NULL
    CHECK (customer_status IN ('Planned', 'Being built', 'Final checks', 'Live')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 20 AND 4000),
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'product_approved')),
  source_item_revision integer NOT NULL CHECK (source_item_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  UNIQUE (signal_id, item_id, customer_status, source_item_revision)
);
CREATE INDEX product_customer_update_drafts_signal_idx
  ON public.product_customer_update_drafts(signal_id, created_at DESC);

CREATE TABLE public.product_avengers_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN ('product_signal', 'avengers_item', 'command', 'roadmap_card', 'customer_draft')),
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_avengers_audit_entity_idx
  ON public.product_avengers_audit(entity_type, entity_id, created_at DESC);

ALTER TABLE public.community_roadmap_cards
  ADD COLUMN avengers_item_id uuid REFERENCES public.product_avengers_items(id) ON DELETE SET NULL,
  ADD COLUMN source_signal_id uuid REFERENCES public.support_product_signals(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX community_roadmap_cards_avengers_item_unique
  ON public.community_roadmap_cards(avengers_item_id)
  WHERE avengers_item_id IS NOT NULL;

DO $relations$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'product_avengers_reviews',
    'product_avengers_candidates',
    'product_avengers_items',
    'product_signal_avengers_links',
    'product_avengers_commands',
    'product_customer_update_drafts',
    'product_avengers_audit'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$relations$;

CREATE POLICY product_avengers_reviews_operator_read
  ON public.product_avengers_reviews FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());
CREATE POLICY product_avengers_candidates_product_read
  ON public.product_avengers_candidates FOR SELECT TO authenticated
  USING (public.is_admin_user());
CREATE POLICY product_avengers_items_operator_read
  ON public.product_avengers_items FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());
CREATE POLICY product_signal_avengers_links_operator_read
  ON public.product_signal_avengers_links FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());
CREATE POLICY product_avengers_commands_product_read
  ON public.product_avengers_commands FOR SELECT TO authenticated
  USING (public.is_admin_user());
CREATE POLICY product_customer_update_drafts_operator_read
  ON public.product_customer_update_drafts FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());
CREATE POLICY product_avengers_audit_product_read
  ON public.product_avengers_audit FOR SELECT TO authenticated
  USING (public.is_admin_user());

CREATE OR REPLACE FUNCTION public.issue_3720_save_product_avengers_review(
  p_signal_id uuid,
  p_expected_revision integer,
  p_public_title text,
  p_public_problem_statement text,
  p_public_outcome text,
  p_public_acceptance_criteria text[],
  p_board_product text,
  p_board_theme text,
  p_board_priority text,
  p_board_estimate text,
  p_board_horizon text,
  p_board_quarter text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_kind text;
  v_revision integer;
  v_work_type text;
  v_criteria text[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_expected_revision' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision = 0
     AND EXISTS (SELECT 1 FROM public.product_avengers_reviews r WHERE r.signal_id = p_signal_id) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
  END IF;
  IF p_expected_revision > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.product_avengers_reviews r
        WHERE r.signal_id = p_signal_id AND r.revision = p_expected_revision
     ) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
  END IF;
  SELECT s.signal_kind INTO v_kind
    FROM public.support_product_signals s WHERE s.id = p_signal_id FOR UPDATE;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_kind NOT IN ('bug', 'feature') THEN
    RAISE EXCEPTION 'signal_not_product_work' USING ERRCODE = '22023';
  END IF;
  v_work_type := CASE v_kind WHEN 'bug' THEN 'Bug' ELSE 'Initiative' END;
  SELECT array_agg(btrim(value)) INTO v_criteria
    FROM unnest(COALESCE(p_public_acceptance_criteria, ARRAY[]::text[])) value
   WHERE char_length(btrim(value)) BETWEEN 4 AND 1000;
  IF cardinality(COALESCE(v_criteria, ARRAY[]::text[])) = 0 THEN
    RAISE EXCEPTION 'acceptance_criteria_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.product_avengers_reviews (
    signal_id, public_title, public_problem_statement, public_outcome,
    public_acceptance_criteria, board_work_type, board_product, board_theme,
    board_priority, board_estimate, board_horizon, board_quarter,
    reviewed_by, reviewed_at
  ) VALUES (
    p_signal_id, btrim(p_public_title), btrim(p_public_problem_statement),
    btrim(p_public_outcome), v_criteria, v_work_type, p_board_product,
    btrim(p_board_theme), p_board_priority, p_board_estimate,
    p_board_horizon, p_board_quarter, v_actor, now()
  )
  ON CONFLICT (signal_id) DO UPDATE
    SET public_title = EXCLUDED.public_title,
        public_problem_statement = EXCLUDED.public_problem_statement,
        public_outcome = EXCLUDED.public_outcome,
        public_acceptance_criteria = EXCLUDED.public_acceptance_criteria,
        board_work_type = EXCLUDED.board_work_type,
        board_product = EXCLUDED.board_product,
        board_theme = EXCLUDED.board_theme,
        board_priority = EXCLUDED.board_priority,
        board_estimate = EXCLUDED.board_estimate,
        board_horizon = EXCLUDED.board_horizon,
        board_quarter = EXCLUDED.board_quarter,
        reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = now(),
        revision = public.product_avengers_reviews.revision + 1,
        updated_at = now()
    WHERE public.product_avengers_reviews.revision = p_expected_revision
  RETURNING revision INTO v_revision;
  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'save_public_review', 'product_signal', p_signal_id::text,
    jsonb_build_object('revision', v_revision, 'work_type', v_work_type));
  RETURN v_revision;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_record_product_avengers_candidate(
  p_signal_id uuid,
  p_issue_number integer,
  p_decision text,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('not_fit', 'selected') THEN
    RAISE EXCEPTION 'invalid_candidate_decision' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'not_fit' AND char_length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'candidate_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'selected' THEN
    UPDATE public.product_avengers_candidates
       SET decision = 'pending', decision_reason = NULL,
           reviewed_by = NULL, reviewed_at = NULL
     WHERE signal_id = p_signal_id AND decision = 'selected';
  END IF;
  UPDATE public.product_avengers_candidates
     SET decision = p_decision,
         decision_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         reviewed_by = v_actor,
         reviewed_at = now()
   WHERE signal_id = p_signal_id AND issue_number = p_issue_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'review_candidate', 'product_signal', p_signal_id::text,
    jsonb_build_object('issue_number', p_issue_number, 'decision', p_decision));
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_set_product_avengers_no_fit(
  p_signal_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 20 THEN
    RAISE EXCEPTION 'no_fit_reason_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_avengers_reviews
     SET no_fit_reason = btrim(p_reason), reviewed_by = v_actor,
         reviewed_at = now(), revision = revision + 1, updated_at = now()
   WHERE signal_id = p_signal_id AND candidates_checked_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_search_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'confirm_no_accurate_match', 'product_signal', p_signal_id::text, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_queue_product_avengers_command(
  p_signal_id uuid,
  p_action text,
  p_payload jsonb,
  p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_review public.product_avengers_reviews%ROWTYPE;
  v_issue integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('search', 'link_existing', 'create_issue', 'update_board', 'refresh')
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_command' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_review FROM public.product_avengers_reviews r WHERE r.signal_id = p_signal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'public_review_required' USING ERRCODE = '22023'; END IF;

  IF p_action = 'search' THEN
    IF COALESCE(p_payload, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'search_uses_reviewed_fields_only' USING ERRCODE = '22023';
    END IF;
  ELSIF p_action = 'link_existing' THEN
    IF (COALESCE(p_payload, '{}'::jsonb) - 'issue_number') <> '{}'::jsonb THEN
      RAISE EXCEPTION 'link_payload_invalid' USING ERRCODE = '22023';
    END IF;
    v_issue := NULLIF(p_payload->>'issue_number', '')::integer;
    IF NOT EXISTS (
      SELECT 1 FROM public.product_avengers_candidates c
       WHERE c.signal_id = p_signal_id AND c.issue_number = v_issue AND c.decision = 'selected'
    ) THEN RAISE EXCEPTION 'selected_candidate_required' USING ERRCODE = '22023'; END IF;
  ELSIF p_action = 'create_issue' THEN
    IF COALESCE(p_payload, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'create_uses_reviewed_fields_only' USING ERRCODE = '22023';
    END IF;
    IF v_review.candidates_checked_at IS NULL
       OR char_length(btrim(COALESCE(v_review.no_fit_reason, ''))) < 20 THEN
      RAISE EXCEPTION 'candidate_search_and_no_fit_reason_required' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_avengers_candidates c
       WHERE c.signal_id = p_signal_id AND c.decision = 'selected'
    ) THEN RAISE EXCEPTION 'selected_candidate_must_be_linked' USING ERRCODE = '22023'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_avengers_candidates c
       WHERE c.signal_id = p_signal_id AND c.decision <> 'not_fit'
    ) THEN RAISE EXCEPTION 'candidate_decisions_required' USING ERRCODE = '22023'; END IF;
  ELSE
    IF COALESCE(p_payload, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'sync_payload_invalid' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.product_signal_avengers_links l WHERE l.signal_id = p_signal_id) THEN
      RAISE EXCEPTION 'avengers_link_required' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.product_avengers_commands(signal_id, action, payload, request_key, requested_by)
  VALUES (p_signal_id, p_action, COALESCE(p_payload, '{}'::jsonb), p_request_key, v_actor)
  ON CONFLICT (requested_by, request_key) DO UPDATE
    SET requested_by = EXCLUDED.requested_by
  RETURNING id INTO v_id;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'queue_' || p_action, 'command', v_id::text,
    jsonb_build_object('signal_id', p_signal_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_claim_product_avengers_command(
  p_command_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_command public.product_avengers_commands%ROWTYPE;
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.product_avengers_commands
     SET state = 'running', claimed_at = now(), attempt_count = attempt_count + 1,
         error_code = NULL
   WHERE id = p_command_id
     AND (state = 'pending' OR (state = 'running' AND claimed_at < now() - interval '10 minutes'))
  RETURNING * INTO v_command;
  IF v_command.id IS NULL THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_command);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_complete_product_avengers_search(
  p_command_id uuid,
  p_candidates jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_signal_id uuid;
  v_candidate jsonb;
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_candidates, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_candidates' USING ERRCODE = '22023';
  END IF;
  SELECT signal_id INTO v_signal_id FROM public.product_avengers_commands
   WHERE id = p_command_id AND state = 'running' AND action = 'search' FOR UPDATE;
  IF v_signal_id IS NULL THEN RAISE EXCEPTION 'command_not_running' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM public.product_avengers_candidates WHERE signal_id = v_signal_id;
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
    INSERT INTO public.product_avengers_candidates(
      signal_id, issue_number, issue_title, issue_url, issue_state
    ) VALUES (
      v_signal_id,
      (v_candidate->>'number')::integer,
      btrim(v_candidate->>'title'),
      v_candidate->>'url',
      upper(v_candidate->>'state')
    )
    ON CONFLICT (signal_id, issue_number) DO UPDATE
      SET issue_title = EXCLUDED.issue_title,
          issue_url = EXCLUDED.issue_url,
          issue_state = EXCLUDED.issue_state,
          last_seen_at = now();
  END LOOP;
  UPDATE public.product_avengers_reviews
     SET candidates_checked_at = now(), no_fit_reason = NULL,
         revision = revision + 1, updated_at = now()
   WHERE signal_id = v_signal_id;
  UPDATE public.product_avengers_commands
     SET state = 'succeeded', result = jsonb_build_object('candidates', p_candidates),
         completed_at = now()
   WHERE id = p_command_id;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  SELECT requested_by, 'candidate_search_completed', 'command', id::text,
         jsonb_build_object('candidate_count', jsonb_array_length(p_candidates))
    FROM public.product_avengers_commands WHERE id = p_command_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_apply_product_avengers_snapshot(
  p_command_id uuid,
  p_signal_id uuid,
  p_link_kind text,
  p_snapshot jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item_id uuid;
  v_old_status text;
  v_new_status text;
  v_revision integer;
  v_issue_number integer := NULLIF(p_snapshot->>'issue_number', '')::integer;
  v_actor uuid;
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_issue_number IS NULL OR p_snapshot->>'repository' <> 'Mingla-LLC/mingla-main' THEN
    RAISE EXCEPTION 'invalid_snapshot' USING ERRCODE = '22023';
  END IF;
  SELECT customer_status INTO v_old_status FROM public.product_avengers_items
   WHERE repository = 'Mingla-LLC/mingla-main' AND issue_number = v_issue_number FOR UPDATE;
  v_new_status := CASE p_snapshot->>'board_status'
    WHEN 'In Progress' THEN 'Being built'
    WHEN 'In Review' THEN 'Final checks'
    WHEN 'Done' THEN CASE WHEN EXISTS (
      SELECT 1 FROM public.product_avengers_items i
       WHERE i.repository = 'Mingla-LLC/mingla-main' AND i.issue_number = v_issue_number
         AND i.release_verified_at IS NOT NULL
    ) THEN 'Live' ELSE 'Final checks' END
    ELSE 'Planned'
  END;

  INSERT INTO public.product_avengers_items(
    repository, issue_number, issue_node_id, project_item_id, issue_url,
    issue_title, issue_state, board_status, board_work_type, board_product,
    board_theme, board_priority, board_estimate, board_horizon, board_quarter,
    board_refined, board_sprint, customer_status, issue_updated_at,
    sync_state, synced_at
  ) VALUES (
    'Mingla-LLC/mingla-main', v_issue_number, p_snapshot->>'issue_node_id',
    p_snapshot->>'project_item_id', p_snapshot->>'issue_url', p_snapshot->>'issue_title',
    upper(p_snapshot->>'issue_state'), NULLIF(p_snapshot->>'board_status', ''),
    NULLIF(p_snapshot->>'board_work_type', ''), NULLIF(p_snapshot->>'board_product', ''),
    NULLIF(p_snapshot->>'board_theme', ''), NULLIF(p_snapshot->>'board_priority', ''),
    NULLIF(p_snapshot->>'board_estimate', ''), NULLIF(p_snapshot->>'board_horizon', ''),
    NULLIF(p_snapshot->>'board_quarter', ''), NULLIF(p_snapshot->>'board_refined', ''),
    NULLIF(p_snapshot->>'board_sprint', ''), v_new_status,
    NULLIF(p_snapshot->>'issue_updated_at', '')::timestamptz, 'synced', now()
  )
  ON CONFLICT (repository, issue_number) DO UPDATE
    SET issue_node_id = EXCLUDED.issue_node_id,
        project_item_id = EXCLUDED.project_item_id,
        issue_url = EXCLUDED.issue_url,
        issue_title = EXCLUDED.issue_title,
        issue_state = EXCLUDED.issue_state,
        board_status = EXCLUDED.board_status,
        board_work_type = EXCLUDED.board_work_type,
        board_product = EXCLUDED.board_product,
        board_theme = EXCLUDED.board_theme,
        board_priority = EXCLUDED.board_priority,
        board_estimate = EXCLUDED.board_estimate,
        board_horizon = EXCLUDED.board_horizon,
        board_quarter = EXCLUDED.board_quarter,
        board_refined = EXCLUDED.board_refined,
        board_sprint = EXCLUDED.board_sprint,
        customer_status = EXCLUDED.customer_status,
        issue_updated_at = EXCLUDED.issue_updated_at,
        sync_state = 'synced', sync_error_code = NULL,
        synced_at = now(), revision = public.product_avengers_items.revision + 1,
        updated_at = now()
  RETURNING id, revision INTO v_item_id, v_revision;

  IF p_command_id IS NOT NULL THEN
    SELECT requested_by INTO v_actor FROM public.product_avengers_commands WHERE id = p_command_id;
  END IF;
  IF p_signal_id IS NOT NULL AND p_link_kind IN ('existing', 'created') THEN
    INSERT INTO public.product_signal_avengers_links(signal_id, item_id, link_kind, linked_by)
    VALUES (p_signal_id, v_item_id, p_link_kind, v_actor)
    ON CONFLICT (signal_id) DO UPDATE
      SET item_id = EXCLUDED.item_id, link_kind = EXCLUDED.link_kind,
          linked_by = EXCLUDED.linked_by, linked_at = now();
    UPDATE public.support_product_signals
       SET state = 'linked', updated_at = now(), revision = revision + 1
     WHERE id = p_signal_id AND state NOT IN ('released', 'closed');
  END IF;

  IF v_old_status IS DISTINCT FROM v_new_status
     OR (p_signal_id IS NOT NULL AND p_link_kind IN ('existing', 'created')) THEN
    INSERT INTO public.product_customer_update_drafts(
      signal_id, item_id, customer_status, body, source_item_revision
    )
    SELECT l.signal_id, v_item_id, v_new_status,
      CASE v_new_status
        WHEN 'Planned' THEN format('We have added “%s” to Mingla''s plans. It is in %s, which is a priority horizon—not a delivery-date promise.', i.issue_title, COALESCE(i.board_horizon, 'the roadmap'))
        WHEN 'Being built' THEN format('The team is now building “%s”. We will share another useful update by the time shown in your Support conversation.', i.issue_title)
        WHEN 'Final checks' THEN format('“%s” is in final checks. It is not confirmed live yet, and we will update you after production verification.', i.issue_title)
        ELSE format('“%s” is now verified live. Thank you for helping Mingla improve it.', i.issue_title)
      END,
      v_revision
      FROM public.product_signal_avengers_links l
      JOIN public.product_avengers_items i ON i.id = l.item_id
     WHERE l.item_id = v_item_id
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.community_roadmap_cards
     SET lane = CASE lower(COALESCE(p_snapshot->>'board_horizon', 'later'))
                  WHEN 'now' THEN 'now' WHEN 'next' THEN 'next' ELSE 'later' END,
         updated_at = now()
   WHERE avengers_item_id = v_item_id;

  IF p_command_id IS NOT NULL THEN
    UPDATE public.product_avengers_commands
       SET state = 'succeeded', result = jsonb_build_object(
         'item_id', v_item_id, 'issue_number', v_issue_number,
         'customer_status', v_new_status
       ), completed_at = now()
     WHERE id = p_command_id AND state = 'running';
  END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'apply_github_snapshot', 'avengers_item', v_item_id::text,
    jsonb_build_object('issue_number', v_issue_number, 'customer_status', v_new_status));
  RETURN v_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_fail_product_avengers_command(
  p_command_id uuid,
  p_error_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.product_avengers_commands
     SET state = 'failed', error_code = left(upper(COALESCE(p_error_code, 'SYNC_FAILED')), 80),
         completed_at = now()
   WHERE id = p_command_id AND state = 'running';
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  SELECT requested_by, 'command_failed', 'command', id::text,
         jsonb_build_object('error_code', error_code)
    FROM public.product_avengers_commands WHERE id = p_command_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_save_product_roadmap_wording(
  p_signal_id uuid,
  p_public_title text,
  p_public_body text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item public.product_avengers_items%ROWTYPE;
  v_card_id uuid;
  v_lane text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT i.* INTO v_item
    FROM public.product_signal_avengers_links l
    JOIN public.product_avengers_items i ON i.id = l.item_id
   WHERE l.signal_id = p_signal_id FOR UPDATE OF i;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'avengers_link_required' USING ERRCODE = '22023'; END IF;
  IF char_length(btrim(COALESCE(p_public_title, ''))) NOT BETWEEN 4 AND 200
     OR char_length(btrim(COALESCE(p_public_body, ''))) NOT BETWEEN 20 AND 4000 THEN
    RAISE EXCEPTION 'roadmap_wording_invalid' USING ERRCODE = '22023';
  END IF;
  v_lane := CASE lower(COALESCE(v_item.board_horizon, 'later'))
    WHEN 'now' THEN 'now' WHEN 'next' THEN 'next' ELSE 'later' END;
  SELECT id INTO v_card_id FROM public.community_roadmap_cards
   WHERE avengers_item_id = v_item.id FOR UPDATE;
  IF v_card_id IS NULL THEN
    INSERT INTO public.community_roadmap_cards(
      public_title, public_body, internal_note, lane, status, sort_order,
      avengers_item_id, source_signal_id
    ) VALUES (
      btrim(p_public_title), btrim(p_public_body),
      format('Avengers #%s · %s · %s', v_item.issue_number,
        COALESCE(v_item.board_status, 'Todo'), COALESCE(v_item.board_priority, 'Unprioritized')),
      v_lane, 'draft',
      COALESCE((SELECT max(sort_order) + 1 FROM public.community_roadmap_cards), 0),
      v_item.id, p_signal_id
    ) RETURNING id INTO v_card_id;
  ELSE
    UPDATE public.community_roadmap_cards
       SET public_title = btrim(p_public_title), public_body = btrim(p_public_body),
           internal_note = format('Avengers #%s · %s · %s', v_item.issue_number,
             COALESCE(v_item.board_status, 'Todo'), COALESCE(v_item.board_priority, 'Unprioritized')),
           lane = v_lane, source_signal_id = p_signal_id, updated_at = now()
     WHERE id = v_card_id;
  END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'save_roadmap_wording', 'roadmap_card', v_card_id::text,
    jsonb_build_object('issue_number', v_item.issue_number, 'status', 'draft_or_existing'));
  RETURN v_card_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_approve_product_customer_draft(
  p_draft_id uuid,
  p_body text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_body, ''))) NOT BETWEEN 20 AND 4000 THEN
    RAISE EXCEPTION 'customer_wording_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_customer_update_drafts
     SET body = btrim(p_body), state = 'product_approved',
         approved_by = v_actor, approved_at = now()
   WHERE id = p_draft_id AND state = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'draft_not_available' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'approve_customer_draft', 'customer_draft', p_draft_id::text, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_verify_product_release(
  p_signal_id uuid,
  p_release_evidence_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_item_id uuid;
  v_revision integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_release_evidence_url, '') !~ '^https://github[.]com/Mingla-LLC/mingla-main/issues/[0-9]+#issuecomment-[0-9]+$' THEN
    RAISE EXCEPTION 'release_evidence_url_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT l.item_id INTO v_item_id FROM public.product_signal_avengers_links l
   JOIN public.product_avengers_items i ON i.id = l.item_id
   WHERE l.signal_id = p_signal_id AND i.board_status = 'Done' FOR UPDATE OF i;
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'done_item_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.product_avengers_items
     SET release_evidence_url = p_release_evidence_url,
         release_verified_by = v_actor, release_verified_at = now(),
         customer_status = 'Live', revision = revision + 1, updated_at = now()
   WHERE id = v_item_id RETURNING revision INTO v_revision;
  INSERT INTO public.product_customer_update_drafts(
    signal_id, item_id, customer_status, body, source_item_revision
  )
  SELECT l.signal_id, v_item_id, 'Live',
         format('“%s” is now verified live. Thank you for helping Mingla improve it.', i.issue_title),
         v_revision
    FROM public.product_signal_avengers_links l
    JOIN public.product_avengers_items i ON i.id = l.item_id
   WHERE l.item_id = v_item_id
  ON CONFLICT DO NOTHING;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'verify_release_evidence', 'avengers_item', v_item_id::text,
    jsonb_build_object('evidence_url', p_release_evidence_url));
END;
$$;

DO $functions$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.issue_3720_save_product_avengers_review(uuid,integer,text,text,text,text[],text,text,text,text,text,text)',
    'public.issue_3720_record_product_avengers_candidate(uuid,integer,text,text)',
    'public.issue_3720_set_product_avengers_no_fit(uuid,text)',
    'public.issue_3720_queue_product_avengers_command(uuid,text,jsonb,uuid)',
    'public.issue_3720_save_product_roadmap_wording(uuid,text,text)',
    'public.issue_3720_approve_product_customer_draft(uuid,text)',
    'public.issue_3720_verify_product_release(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_signature);
  END LOOP;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.issue_3720_claim_product_avengers_command(uuid)',
    'public.issue_3720_complete_product_avengers_search(uuid,jsonb)',
    'public.issue_3720_apply_product_avengers_snapshot(uuid,uuid,text,jsonb)',
    'public.issue_3720_fail_product_avengers_command(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$functions$;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'issue3720_wave4_reconcile_cron_not_registered';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'issue_3720_product_avengers_reconcile';
  PERFORM cron.schedule(
    'issue_3720_product_avengers_reconcile',
    '*/5 * * * *',
    $job$SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
        || '/functions/v1/product-avengers-sync',
      headers := jsonb_build_object(
        'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),
        'content-type', 'application/json'
      ),
      body := '{"mode":"reconcile"}'::jsonb,
      timeout_milliseconds := 55000
    )$job$
  );
END;
$cron$;

DO $guard$
DECLARE
  v_table text;
BEGIN
  IF current_setting('issue3720_wave4.is_admin_user_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.is_admin_user()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_is_admin_user_changed';
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'product_avengers_reviews', 'product_avengers_candidates',
    'product_avengers_items', 'product_signal_avengers_links',
    'product_avengers_commands', 'product_customer_update_drafts',
    'product_avengers_audit'
  ] LOOP
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'issue3720_wave4_relation_acl_invalid:%', v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.issue_3720_queue_product_avengers_command(uuid,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3720_claim_product_avengers_command(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3720_wave4_function_acl_invalid';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
COMMIT;
