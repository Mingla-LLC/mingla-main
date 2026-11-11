-- #4382 Support Desk redesign, Wave 1, part 3 of 3: the Product pipeline.
--
-- Stages: new -> triaged -> planned -> shipped -> told, plus wont_do.
-- Old states map (no message is sent by the mapping):
--   needs_review                  -> new
--   waiting_details, ready_product -> triaged
--   linked, update_due            -> planned
--   released                      -> shipped
--   closed                        -> told when an approved "Live" customer
--                                    update exists for it, otherwise wont_do
--                                    (reason: "Closed before the Product
--                                    pipeline redesign")
--
-- Moves are checked in the database by a trigger for every writer. Allowed:
-- new->triaged, triaged->planned, planned->triaged, planned->shipped,
-- shipped->told, and any state other than told -> wont_do (with a reason).
-- planned needs a GitHub link, shipped needs the verified release record,
-- told happens only inside issue_4382_tell_reporters. A refused move raises
-- PT409, never 40001.
--
-- Who (D3): is_product_operator (an active admin seat: owner, admin or
-- Founding partner) triages, links to GitHub, verifies, approves wording and
-- tells reporters. Any Support staff member sends to Product and links
-- tickets. product-avengers-sync checks the same function.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Who runs Product.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_product_operator(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM auth.users identity
    JOIN public.admin_users seat ON seat.email = identity.email
    WHERE identity.id = p_user_id
      AND seat.status = 'active'
      AND seat.role IN ('owner', 'admin', 'partner')
  );
$$;
REVOKE ALL ON FUNCTION public.is_product_operator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_product_operator(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. New stages.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.support_product_signals
  ADD COLUMN wont_do_reason text,
  ADD COLUMN told_at timestamptz,
  ADD COLUMN told_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN told_ticket_count integer;

ALTER TABLE public.support_product_signals
  DROP CONSTRAINT support_product_signals_state_check;
ALTER TABLE public.support_product_signals ALTER COLUMN state DROP DEFAULT;

-- The old alert trigger reacts to state = 'released'; none of the new
-- values is that, and owners do not change here, so it stays silent.
UPDATE public.support_product_signals signal
   SET state = CASE signal.state
     WHEN 'needs_review' THEN 'new'
     WHEN 'waiting_details' THEN 'triaged'
     WHEN 'ready_product' THEN 'triaged'
     WHEN 'linked' THEN 'planned'
     WHEN 'update_due' THEN 'planned'
     WHEN 'released' THEN 'shipped'
     WHEN 'closed' THEN CASE WHEN EXISTS (
       SELECT 1 FROM public.product_customer_update_drafts draft
       WHERE draft.signal_id = signal.id
         AND draft.state = 'product_approved'
         AND draft.customer_status = 'Live'
     ) THEN 'told' ELSE 'wont_do' END
     ELSE signal.state
   END,
       wont_do_reason = CASE
         WHEN signal.state = 'closed' AND NOT EXISTS (
           SELECT 1 FROM public.product_customer_update_drafts draft
           WHERE draft.signal_id = signal.id
             AND draft.state = 'product_approved'
             AND draft.customer_status = 'Live'
         ) THEN 'Closed before the Product pipeline redesign'
         ELSE signal.wont_do_reason
       END
 WHERE signal.state IN ('needs_review', 'waiting_details', 'ready_product', 'linked', 'update_due', 'released', 'closed');

ALTER TABLE public.support_product_signals
  ALTER COLUMN state SET DEFAULT 'new',
  ADD CONSTRAINT support_product_signals_state_check
    CHECK (state IN ('new', 'triaged', 'planned', 'shipped', 'told', 'wont_do')),
  ADD CONSTRAINT support_product_signals_wont_do_reason
    CHECK (state <> 'wont_do' OR char_length(btrim(COALESCE(wont_do_reason, ''))) BETWEEN 3 AND 1000);

-- Customer drafts: 'sent' once Told has delivered them.
ALTER TABLE public.product_customer_update_drafts
  DROP CONSTRAINT product_customer_update_drafts_state_check;
ALTER TABLE public.product_customer_update_drafts
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT product_customer_update_drafts_state_check
    CHECK (state IN ('draft', 'product_approved', 'sent'));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Transition rule.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_signal_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_from = p_to
    OR (p_from, p_to) IN (
      ('new', 'triaged'),
      ('triaged', 'planned'),
      ('planned', 'triaged'),
      ('planned', 'shipped'),
      ('shipped', 'told')
    )
    OR (p_to = 'wont_do' AND p_from <> 'told');
$$;
GRANT EXECUTE ON FUNCTION public.issue_4382_signal_transition_allowed(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4382_guard_signal_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;
  IF NOT public.issue_4382_signal_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'illegal_signal_transition: % -> %', OLD.state, NEW.state
      USING ERRCODE = 'PT409';
  END IF;
  IF NEW.state = 'wont_do' AND char_length(btrim(COALESCE(NEW.wont_do_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'wont_do_reason_required' USING ERRCODE = '22023';
  END IF;
  IF NEW.state = 'planned' AND NOT EXISTS (
    SELECT 1 FROM public.product_signal_avengers_links l WHERE l.signal_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'planned_needs_github_link' USING ERRCODE = 'PT409';
  END IF;
  IF NEW.state = 'shipped' AND NOT EXISTS (
    SELECT 1
    FROM public.product_signal_avengers_links l
    JOIN public.product_avengers_items i ON i.id = l.item_id
    WHERE l.signal_id = NEW.id AND i.release_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'shipped_needs_verified_release' USING ERRCODE = 'PT409';
  END IF;
  IF NEW.state = 'told' AND COALESCE(current_setting('mingla.signal_telling', true), '') <> 'on' THEN
    RAISE EXCEPTION 'told_only_by_tell_reporters' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issue_4382_guard_signal_transition
  BEFORE UPDATE OF state ON public.support_product_signals
  FOR EACH ROW EXECUTE FUNCTION public.issue_4382_guard_signal_transition();

-- The "it's released" note to whoever raised the item now fires on shipped.
CREATE OR REPLACE FUNCTION public.issue_3988_signal_changed_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_user_id IS NOT NULL
     AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     AND NEW.owner_user_id IS DISTINCT FROM auth.uid() THEN
    PERFORM public.issue_3988_enqueue_alert(
      'admin.product_signal_assigned',
      NEW.owner_user_id,
      'admin.product_signal_assigned:' || NEW.id::text || ':' || NEW.owner_user_id::text
        || ':' || NEW.revision::text,
      public.issue_3988_signal_payload(NEW)
    );
  END IF;
  IF NEW.state = 'shipped' AND OLD.state IS DISTINCT FROM 'shipped' THEN
    PERFORM public.issue_3988_signal_progress_note(
      NEW.id, 'released', 'released:' || NEW.id::text, auth.uid(), NULL
    );
  END IF;
  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Product RPCs: new states, one "who" rule.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3720_update_product_signal(
  p_signal_id uuid,
  p_expected_revision integer,
  p_state text,
  p_priority text,
  p_next_update_at timestamptz,
  p_next_step text,
  p_customer_reply_draft text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_current text;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  -- planned, shipped and told have their own doors (GitHub link apply,
  -- verified release, Tell reporters); wont_do has issue_4382_set_wont_do.
  IF p_state NOT IN ('new', 'triaged', 'planned', 'shipped', 'told', 'wont_do')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_step, '')) = '' OR btrim(coalesce(p_customer_reply_draft, '')) = '' THEN
    RAISE EXCEPTION 'product_fields_required' USING ERRCODE = '22023';
  END IF;

  SELECT state, jsonb_build_object(
    'state', state, 'priority', priority, 'next_update_at', next_update_at, 'revision', revision
  ) INTO v_current, v_before
    FROM public.support_product_signals
   WHERE id = p_signal_id;
  IF v_current IS NOT NULL AND v_current IS DISTINCT FROM p_state THEN
    IF NOT public.is_product_operator(v_actor) THEN
      RAISE EXCEPTION 'product_operator_required' USING ERRCODE = '42501';
    END IF;
    IF p_state IN ('planned', 'shipped', 'told', 'wont_do') THEN
      RAISE EXCEPTION 'use_the_stage_action' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  UPDATE public.support_product_signals
     SET state = p_state,
         priority = p_priority,
         next_update_at = p_next_update_at,
         next_step = left(btrim(p_next_step), 1000),
         customer_reply_draft = left(btrim(p_customer_reply_draft), 4000),
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_updated', 'product_signal', p_signal_id, v_before,
    jsonb_build_object(
      'state', p_state, 'priority', p_priority,
      'next_update_at', p_next_update_at, 'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_4382_set_wont_do(
  p_signal_id uuid,
  p_expected_revision integer,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
  v_before text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_product_operator(v_actor) THEN
    RAISE EXCEPTION 'product_operator_required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'wont_do_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT state INTO v_before FROM public.support_product_signals WHERE id = p_signal_id;
  UPDATE public.support_product_signals
     SET state = 'wont_do',
         wont_do_reason = btrim(p_reason),
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;
  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_wont_do', 'product_signal', p_signal_id,
    jsonb_build_object('state', v_before),
    jsonb_build_object('state', 'wont_do', 'reason', btrim(p_reason), 'revision', v_revision)
  );
  RETURN v_revision;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_set_wont_do(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_set_wont_do(uuid, integer, text) TO authenticated, service_role;

-- The public review, the queue and the release check move to the D3 rule.
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
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_kind text;
  v_revision integer;
  v_work_type text;
  v_criteria text[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_product_operator(v_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_expected_revision' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision = 0
     AND EXISTS (SELECT 1 FROM public.product_avengers_reviews r WHERE r.signal_id = p_signal_id) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_revision > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.product_avengers_reviews r
        WHERE r.signal_id = p_signal_id AND r.revision = p_expected_revision
     ) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
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
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  -- Writing the public wording is the Triage step.
  UPDATE public.support_product_signals
     SET state = 'triaged', updated_at = now(), revision = revision + 1
   WHERE id = p_signal_id AND state = 'new';
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'save_public_review', 'product_signal', p_signal_id::text,
    jsonb_build_object('revision', v_revision, 'work_type', v_work_type));
  RETURN v_revision;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_queue_product_avengers_command(
  p_signal_id uuid,
  p_action text,
  p_payload jsonb,
  p_request_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_review public.product_avengers_reviews%ROWTYPE;
  v_issue integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_product_operator(v_actor) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_approve_product_customer_draft(p_draft_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_product_operator(v_actor) THEN
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
$function$;

-- Verified live: the release record moves every linked item to shipped.
CREATE OR REPLACE FUNCTION public.issue_3720_verify_product_release(p_signal_id uuid, p_release_evidence_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_item_id uuid;
  v_revision integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_product_operator(v_actor) THEN
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
  UPDATE public.support_product_signals s
     SET state = 'shipped', updated_at = now(), revision = s.revision + 1
    FROM public.product_signal_avengers_links l
   WHERE l.item_id = v_item_id AND l.signal_id = s.id AND s.state = 'planned';
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'verify_release_evidence', 'avengers_item', v_item_id::text,
    jsonb_build_object('evidence_url', p_release_evidence_url));
END;
$function$;

-- The GitHub link apply is what moves an item to planned.
CREATE OR REPLACE FUNCTION public.issue_3720_apply_product_avengers_snapshot(
  p_command_id uuid,
  p_signal_id uuid,
  p_link_kind text,
  p_snapshot jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
    -- Linking is the end of Triage: new and triaged items become planned.
    UPDATE public.support_product_signals
       SET state = 'triaged', updated_at = now(), revision = revision + 1
     WHERE id = p_signal_id AND state = 'new';
    UPDATE public.support_product_signals
       SET state = 'planned', updated_at = now(), revision = revision + 1
     WHERE id = p_signal_id AND state = 'triaged';
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Told (D2): one tap, once, each reporter one message.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4382_tell_reporters(p_signal_id uuid, p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_signal public.support_product_signals%ROWTYPE;
  v_draft public.product_customer_update_drafts%ROWTYPE;
  v_ticket record;
  v_sent integer := 0;
  v_display text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_product_operator(v_actor) THEN
    RAISE EXCEPTION 'product_operator_required' USING ERRCODE = '42501';
  END IF;
  -- The lock plus the state check make a second tap (or a second operator)
  -- wait and then refuse.
  SELECT * INTO v_signal FROM public.support_product_signals WHERE id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_signal.state = 'told' THEN
    RAISE EXCEPTION 'already_told' USING ERRCODE = 'PT409';
  END IF;
  IF v_signal.state <> 'shipped' THEN
    RAISE EXCEPTION 'tell_needs_shipped' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_draft FROM public.product_customer_update_drafts
   WHERE id = p_draft_id AND signal_id = p_signal_id FOR UPDATE;
  IF NOT FOUND OR v_draft.state <> 'product_approved' OR v_draft.customer_status <> 'Live' THEN
    RAISE EXCEPTION 'approved_live_wording_required' USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(NULLIF(btrim(s.display_name), ''), 'Mingla Support') INTO v_display
    FROM public.support_staff s WHERE s.user_id = v_actor;
  v_display := COALESCE(v_display, 'Mingla Support');

  -- Every linked ticket a customer can see. Community idea voters hear from
  -- the Community idea update (issue_3720_admin_update_idea), not from here.
  FOR v_ticket IN
    SELECT t.id, t.status
    FROM public.support_product_signal_sources source
    JOIN public.support_tickets t ON t.id = source.source_id
    WHERE source.signal_id = p_signal_id
      AND source.source_kind = 'support_ticket'
      AND t.visibility IN ('person', 'brand')
    ORDER BY t.created_at, t.id
  LOOP
    PERFORM public.issue_4382_post_support_message(
      v_ticket.id, v_actor, true, v_draft.body, ARRAY[]::uuid[], false,
      NULL, NULL, v_display, true, 'product_update'
    );
    -- Resolved quietly: the "it's live" push already went out.
    IF v_ticket.status <> 'closed' THEN
      PERFORM set_config('mingla.support_quiet', 'on', true);
      UPDATE public.support_tickets
         SET status = 'resolved', resolved_at = COALESCE(resolved_at, now())
       WHERE id = v_ticket.id;
      PERFORM set_config('mingla.support_quiet', '', true);
    END IF;
    v_sent := v_sent + 1;
  END LOOP;

  UPDATE public.product_customer_update_drafts
     SET state = 'sent', sent_at = now(), sent_by = v_actor
   WHERE id = v_draft.id;

  PERFORM set_config('mingla.signal_telling', 'on', true);
  UPDATE public.support_product_signals
     SET state = 'told', told_at = now(), told_by = v_actor,
         told_ticket_count = v_sent, updated_at = now(), revision = revision + 1
   WHERE id = p_signal_id;
  PERFORM set_config('mingla.signal_telling', '', true);

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_told', 'product_signal', p_signal_id,
    jsonb_build_object('state', 'shipped'),
    jsonb_build_object('state', 'told', 'draft_id', v_draft.id, 'tickets', v_sent)
  );
  RETURN jsonb_build_object('signal_id', p_signal_id, 'tickets_told', v_sent, 'draft_id', v_draft.id);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4382_tell_reporters(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4382_tell_reporters(uuid, uuid) TO authenticated, service_role;

COMMIT;
