-- #3720 Support -> Product bridge, slice 1.
-- Keeps customer conversations, staff-created internal tickets, and private
-- product signals separate while preserving an auditable link between them.
--
-- INVARIANT: {"id":"I-3720-SUPPORT-PRODUCT-PRIVATE","rule":"Internal support tickets and product signals are readable only by enabled support staff or admin users and mutate only through gated RPCs."}
-- INVARIANT: {"id":"I-3720-NEXT-UPDATE-HONEST","rule":"A staff-created ticket and every product signal have a future next-update promise; live-chat promises are explicit and create a customer-visible system event."}
-- INVARIANT: {"id":"I-3720-PRODUCT-SIGNAL-NO-GITHUB-WRITE","rule":"This slice stores private signals only and exposes no GitHub mutation function or browser grant."}

BEGIN;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS next_update_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_update_note text,
  ADD COLUMN IF NOT EXISTS support_workflow_revision integer NOT NULL DEFAULT 1;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_next_update_pair;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_next_update_pair CHECK (
    (next_update_at IS NULL AND next_update_note IS NULL)
    OR
    (next_update_at IS NOT NULL AND btrim(coalesce(next_update_note, '')) <> '')
  );

-- Existing support status/priority writes already use service-role edge
-- functions. Keep the new promise fields out of broad browser UPDATE grants.
REVOKE UPDATE ON public.support_tickets FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS support_tickets_next_update_due_idx
  ON public.support_tickets(next_update_at)
  WHERE next_update_at IS NOT NULL AND status NOT IN ('resolved', 'closed');

CREATE TABLE IF NOT EXISTS public.support_internal_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL,
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  details text NOT NULL CHECK (char_length(btrim(details)) BETWEEN 1 AND 8000),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'open', 'pending', 'resolved', 'closed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  brand_group_context text CHECK (
    brand_group_context IS NULL OR char_length(btrim(brand_group_context)) BETWEEN 1 AND 500
  ),
  assigned_staff_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  next_update_at timestamptz NOT NULL,
  next_update_note text NOT NULL CHECK (char_length(btrim(next_update_note)) BETWEEN 1 AND 500),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (created_by, client_request_id),
  CHECK (next_update_at > created_at - interval '1 minute')
);

CREATE INDEX IF NOT EXISTS support_internal_threads_queue_idx
  ON public.support_internal_threads(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_internal_threads_next_update_due_idx
  ON public.support_internal_threads(next_update_at)
  WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX IF NOT EXISTS support_internal_threads_linked_user_idx
  ON public.support_internal_threads(linked_user_id)
  WHERE linked_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.support_product_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL,
  signal_kind text NOT NULL
    CHECK (signal_kind IN ('question', 'account', 'bug', 'feature', 'trust_safety')),
  state text NOT NULL DEFAULT 'needs_review'
    CHECK (state IN ('needs_review', 'waiting_details', 'ready_product', 'linked', 'update_due', 'released', 'closed')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  problem_statement text NOT NULL CHECK (char_length(btrim(problem_statement)) BETWEEN 1 AND 8000),
  product_area text NOT NULL CHECK (char_length(btrim(product_area)) BETWEEN 1 AND 120),
  user_journey text NOT NULL CHECK (char_length(btrim(user_journey)) BETWEEN 1 AND 1000),
  impact_summary text NOT NULL CHECK (char_length(btrim(impact_summary)) BETWEEN 1 AND 1000),
  affected_people integer NOT NULL DEFAULT 1 CHECK (affected_people > 0),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  next_update_at timestamptz NOT NULL,
  next_step text NOT NULL CHECK (char_length(btrim(next_step)) BETWEEN 1 AND 1000),
  customer_reply_draft text NOT NULL CHECK (char_length(btrim(customer_reply_draft)) BETWEEN 1 AND 4000),
  duplicate_of_signal_id uuid REFERENCES public.support_product_signals(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (created_by, client_request_id),
  CHECK (duplicate_of_signal_id IS NULL OR duplicate_of_signal_id <> id),
  CHECK (next_update_at > created_at - interval '1 minute')
);

CREATE INDEX IF NOT EXISTS support_product_signals_inbox_idx
  ON public.support_product_signals(state, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_product_signals_next_update_due_idx
  ON public.support_product_signals(next_update_at)
  WHERE state NOT IN ('released', 'closed');

CREATE TABLE IF NOT EXISTS public.support_product_signal_sources (
  signal_id uuid NOT NULL REFERENCES public.support_product_signals(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('support_ticket', 'internal_thread')),
  source_id uuid NOT NULL,
  linked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, source_kind, source_id),
  UNIQUE (source_kind, source_id)
);

CREATE TABLE IF NOT EXISTS public.support_product_workflow_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('support_ticket', 'internal_thread', 'product_signal')),
  entity_id uuid NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_product_workflow_audit_entity_idx
  ON public.support_product_workflow_audit(entity_kind, entity_id, created_at DESC);

-- Keep every operator's Support inbox and private Product inbox synchronized.
-- The guarded block is safe on a local database that has no realtime
-- publication and idempotent when a table was already registered.
DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'support_internal_threads'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.support_internal_threads;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'support_product_signals'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.support_product_signals;
    END IF;
  END IF;
END;
$realtime$;

ALTER TABLE public.support_internal_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_product_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_product_signal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_product_workflow_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_internal_threads_operator_read ON public.support_internal_threads;
CREATE POLICY support_internal_threads_operator_read
  ON public.support_internal_threads FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());

DROP POLICY IF EXISTS support_product_signals_operator_read ON public.support_product_signals;
CREATE POLICY support_product_signals_operator_read
  ON public.support_product_signals FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());

DROP POLICY IF EXISTS support_product_signal_sources_operator_read ON public.support_product_signal_sources;
CREATE POLICY support_product_signal_sources_operator_read
  ON public.support_product_signal_sources FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());

DROP POLICY IF EXISTS support_product_workflow_audit_operator_read ON public.support_product_workflow_audit;
CREATE POLICY support_product_workflow_audit_operator_read
  ON public.support_product_workflow_audit FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());

-- Supabase's default privileges give authenticated broad access to new public
-- tables. Remove those defaults before restoring the deliberate read-only
-- surface; every mutation stays behind the operator-gated RPCs below.
REVOKE ALL ON public.support_internal_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.support_product_signals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.support_product_signal_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.support_product_workflow_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_internal_threads TO authenticated, service_role;
GRANT SELECT ON public.support_product_signals TO authenticated, service_role;
GRANT SELECT ON public.support_product_signal_sources TO authenticated, service_role;
GRANT SELECT ON public.support_product_workflow_audit TO authenticated, service_role;
GRANT ALL ON public.support_internal_threads TO service_role;
GRANT ALL ON public.support_product_signals TO service_role;
GRANT ALL ON public.support_product_signal_sources TO service_role;
GRANT ALL ON public.support_product_workflow_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.support_product_workflow_audit_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_support_operator_required()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_support_staff(auth.uid()) OR public.is_admin_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3720_support_operator_required() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_support_operator_required() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_create_internal_thread(
  p_client_request_id uuid,
  p_subject text,
  p_details text,
  p_customer_email text,
  p_brand_id uuid,
  p_brand_group_context text,
  p_priority text,
  p_next_update_at timestamptz,
  p_next_update_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_linked_user uuid;
  v_existing uuid;
  v_id uuid;
BEGIN
  PERFORM public.issue_3720_support_operator_required();

  SELECT id INTO v_existing
    FROM public.support_internal_threads
   WHERE created_by = v_actor AND client_request_id = p_client_request_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id_required' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_subject, '')) = '' OR btrim(coalesce(p_details, '')) = '' THEN
    RAISE EXCEPTION 'subject_and_details_required' USING ERRCODE = '22023';
  END IF;
  IF p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_priority' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_update_note, '')) = '' THEN
    RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023';
  END IF;

  IF btrim(coalesce(p_customer_email, '')) <> '' THEN
    SELECT p.id INTO v_linked_user
      FROM public.profiles p
     WHERE lower(p.email) = lower(btrim(p_customer_email))
     ORDER BY p.id
     LIMIT 1;
    IF v_linked_user IS NULL THEN
      RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brands b WHERE b.id = p_brand_id
  ) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.support_internal_threads(
    client_request_id, subject, details, priority, linked_user_id, brand_id,
    brand_group_context, assigned_staff_id, next_update_at, next_update_note, created_by
  ) VALUES (
    p_client_request_id, left(btrim(p_subject), 200), left(btrim(p_details), 8000),
    p_priority, v_linked_user, p_brand_id,
    nullif(left(btrim(coalesce(p_brand_group_context, '')), 500), ''),
    v_actor, p_next_update_at, left(btrim(p_next_update_note), 500), v_actor
  )
  RETURNING id INTO v_id;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, after_snapshot
  ) VALUES (
    v_actor, 'internal_thread_created', 'internal_thread', v_id,
    jsonb_build_object(
      'status', 'new', 'priority', p_priority,
      'linked_user', v_linked_user IS NOT NULL,
      'brand_linked', p_brand_id IS NOT NULL,
      'next_update_at', p_next_update_at
    )
  );

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_set_next_update(
  p_source_kind text,
  p_source_id uuid,
  p_expected_revision integer,
  p_next_update_at timestamptz,
  p_next_update_note text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
  v_conversation uuid;
  v_before jsonb;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_source_kind NOT IN ('support_ticket', 'internal_thread') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_update_note, '')) = '' THEN
    RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023';
  END IF;

  IF p_source_kind = 'support_ticket' THEN
    SELECT conversation_id,
           jsonb_build_object('next_update_at', next_update_at, 'revision', support_workflow_revision)
      INTO v_conversation, v_before
      FROM public.support_tickets
     WHERE id = p_source_id;

    UPDATE public.support_tickets
       SET next_update_at = p_next_update_at,
           next_update_note = left(btrim(p_next_update_note), 500),
           last_message_at = now(),
           support_workflow_revision = support_workflow_revision + 1
     WHERE id = p_source_id
       AND support_workflow_revision = p_expected_revision
    RETURNING support_workflow_revision INTO v_revision;

    IF v_revision IS NULL THEN
      IF v_conversation IS NULL THEN
        RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
      END IF;
      RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    VALUES (
      v_conversation,
      NULL,
      'Mingla will update you by ' || to_char(p_next_update_at AT TIME ZONE 'UTC', 'FMDay, FMMonth DD at HH12:MI AM') || ' UTC. ' || left(btrim(p_next_update_note), 500),
      'system'
    );
  ELSE
    SELECT jsonb_build_object('next_update_at', next_update_at, 'revision', revision)
      INTO v_before
      FROM public.support_internal_threads
     WHERE id = p_source_id;

    UPDATE public.support_internal_threads
       SET next_update_at = p_next_update_at,
           next_update_note = left(btrim(p_next_update_note), 500),
           updated_at = now(),
           revision = revision + 1
     WHERE id = p_source_id
       AND revision = p_expected_revision
    RETURNING revision INTO v_revision;

    IF v_revision IS NULL THEN
      IF v_before IS NULL THEN
        RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
      END IF;
      RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor,
    'next_update_set',
    CASE WHEN p_source_kind = 'support_ticket' THEN 'support_ticket' ELSE 'internal_thread' END,
    p_source_id,
    v_before,
    jsonb_build_object('next_update_at', p_next_update_at, 'revision', v_revision)
  );

  RETURN v_revision;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_update_internal_thread(
  p_thread_id uuid,
  p_expected_revision integer,
  p_status text,
  p_priority text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_status NOT IN ('new', 'open', 'pending', 'resolved', 'closed')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object('status', status, 'priority', priority, 'revision', revision)
    INTO v_before
    FROM public.support_internal_threads
   WHERE id = p_thread_id;

  UPDATE public.support_internal_threads
     SET status = p_status,
         priority = p_priority,
         resolved_at = CASE
           WHEN p_status IN ('resolved', 'closed') THEN coalesce(resolved_at, now())
           ELSE NULL
         END,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_thread_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'internal_thread_updated', 'internal_thread', p_thread_id, v_before,
    jsonb_build_object('status', p_status, 'priority', p_priority, 'revision', v_revision)
  );

  RETURN v_revision;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_create_product_signal(
  p_client_request_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_signal_kind text,
  p_title text,
  p_problem_statement text,
  p_product_area text,
  p_user_journey text,
  p_impact_summary text,
  p_affected_people integer,
  p_priority text,
  p_next_update_at timestamptz,
  p_next_step text,
  p_customer_reply_draft text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_existing uuid;
  v_id uuid;
BEGIN
  PERFORM public.issue_3720_support_operator_required();

  SELECT id INTO v_existing
    FROM public.support_product_signals
   WHERE created_by = v_actor AND client_request_id = p_client_request_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF p_source_kind NOT IN ('support_ticket', 'internal_thread') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_source_kind = 'support_ticket'
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_source_kind = 'internal_thread'
     AND NOT EXISTS (SELECT 1 FROM public.support_internal_threads WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.support_product_signal_sources
     WHERE source_kind = p_source_kind AND source_id = p_source_id
  ) THEN
    RAISE EXCEPTION 'source_already_linked' USING ERRCODE = '23505';
  END IF;
  IF p_signal_kind NOT IN ('question', 'account', 'bug', 'feature', 'trust_safety')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_classification' USING ERRCODE = '22023';
  END IF;
  IF p_affected_people IS NULL OR p_affected_people < 1 THEN
    RAISE EXCEPTION 'affected_people_required' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_title, '')) = ''
     OR btrim(coalesce(p_problem_statement, '')) = ''
     OR btrim(coalesce(p_product_area, '')) = ''
     OR btrim(coalesce(p_user_journey, '')) = ''
     OR btrim(coalesce(p_impact_summary, '')) = ''
     OR btrim(coalesce(p_next_step, '')) = ''
     OR btrim(coalesce(p_customer_reply_draft, '')) = '' THEN
    RAISE EXCEPTION 'signal_fields_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.support_product_signals(
    client_request_id, signal_kind, title, problem_statement, product_area,
    user_journey, impact_summary, affected_people, priority, owner_user_id,
    next_update_at, next_step, customer_reply_draft, created_by
  ) VALUES (
    p_client_request_id, p_signal_kind, left(btrim(p_title), 200),
    left(btrim(p_problem_statement), 8000), left(btrim(p_product_area), 120),
    left(btrim(p_user_journey), 1000), left(btrim(p_impact_summary), 1000),
    p_affected_people, p_priority, v_actor, p_next_update_at,
    left(btrim(p_next_step), 1000), left(btrim(p_customer_reply_draft), 4000), v_actor
  )
  RETURNING id INTO v_id;

  INSERT INTO public.support_product_signal_sources(signal_id, source_kind, source_id, linked_by)
  VALUES (v_id, p_source_kind, p_source_id, v_actor);

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_created', 'product_signal', v_id,
    jsonb_build_object(
      'signal_kind', p_signal_kind,
      'priority', p_priority,
      'source_kind', p_source_kind,
      'next_update_at', p_next_update_at
    )
  );

  RETURN v_id;
END;
$function$;

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
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_state NOT IN ('needs_review', 'waiting_details', 'ready_product', 'linked', 'update_due', 'released', 'closed')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_step, '')) = '' OR btrim(coalesce(p_customer_reply_draft, '')) = '' THEN
    RAISE EXCEPTION 'product_fields_required' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'state', state, 'priority', priority, 'next_update_at', next_update_at, 'revision', revision
  ) INTO v_before
    FROM public.support_product_signals
   WHERE id = p_signal_id;

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
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
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
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_link_product_signal_source(
  p_signal_id uuid,
  p_expected_revision integer,
  p_source_kind text,
  p_source_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_source_kind NOT IN ('support_ticket', 'internal_thread') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_source_kind = 'support_ticket'
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_source_kind = 'internal_thread'
     AND NOT EXISTS (SELECT 1 FROM public.support_internal_threads WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.support_product_signals
     SET affected_people = affected_people + 1,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.support_product_signals WHERE id = p_signal_id) THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = '40001';
  END IF;

  BEGIN
    INSERT INTO public.support_product_signal_sources(signal_id, source_kind, source_id, linked_by)
    VALUES (p_signal_id, p_source_kind, p_source_id, v_actor);
  EXCEPTION WHEN unique_violation THEN
    -- Keep the counter and link atomic if another operator linked the source.
    RAISE;
  END;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_source_linked', 'product_signal', p_signal_id,
    jsonb_build_object(
      'source_kind', p_source_kind,
      'source_id', p_source_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3720_create_internal_thread(uuid, text, text, text, uuid, text, text, timestamptz, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_3720_set_next_update(text, uuid, integer, timestamptz, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_3720_update_internal_thread(uuid, integer, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_3720_create_product_signal(uuid, text, uuid, text, text, text, text, text, text, integer, text, timestamptz, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_3720_update_product_signal(uuid, integer, text, text, timestamptz, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_3720_link_product_signal_source(uuid, integer, text, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.issue_3720_create_internal_thread(uuid, text, text, text, uuid, text, text, timestamptz, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_set_next_update(text, uuid, integer, timestamptz, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_update_internal_thread(uuid, integer, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_create_product_signal(uuid, text, uuid, text, text, text, text, text, text, integer, text, timestamptz, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_update_product_signal(uuid, integer, text, text, timestamptz, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_link_product_signal_source(uuid, integer, text, uuid)
  TO authenticated, service_role;

COMMIT;
