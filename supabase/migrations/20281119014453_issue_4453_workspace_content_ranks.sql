-- #4453 Website workspace: Core ranks, the audit allow-list and Ari's step events
-- (build contract sections A, E and F).
--
--   1. brand_site_content_min_rank re-issued (from 20280807104453) with the
--      workspace content actions at the content minimum (20): workspace,
--      page_sections, section_catalog, edit_section, move_section,
--      remove_section, add_section, set_section_media, set_look,
--      set_page_enabled, history, undo, redo. Every other action keeps its
--      rank.
--   2. brand_site_content_record re-issued (from 20280119112829) with the
--      collections pages and site-settings added, so the audit row of a
--      section change or a look change is accepted. The audit actions are
--      unchanged (Studio records these as content.updated). Nothing is removed.
--   3. Ari's activity events accept site_step_started, site_step_done and
--      site_step_failed (the table CHECK and append_agent_activity_event,
--      re-issued from 20280209003355), and an event can carry a small detail
--      object (which step of the plan it is): a new nullable column and a new
--      last parameter p_detail DEFAULT NULL. The five-argument function is
--      replaced by the six-argument one, so a call without p_detail still
--      resolves to exactly one function.
--
-- Static SQL only; no data is changed.

-- ── 1. Workspace content actions (content minimum) ─────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_content_min_rank(p_action text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_action IN (
      'list','get','create','update','reorder','set_visibility','delete',
      'categories','create_category','rename_category','reorder_categories',
      'delete_category','media_upload_grant','media_complete','media_status',
      'media_library','offerings','past_trips','font_search','font_previews','draft_changes','pages','set_menu','cover','set_cover',
      -- #2829 W9b — "Why it looks like this" and the six design checks.
      'work_log','design_checks',
      -- #4453 — "N sections to review" and "Looks right" (spec v1 §4.3).
      'review_status','mark_reviewed',
      -- #4453 milestone 11 — answer Ari's question, publish or remove a Draft page from Ari (spec v2.1 §3.2-§3.3).
      'ari_page_answer','ari_page_accept','ari_page_remove',
      -- #4453 Website workspace — the owner's Edit and Design panels, and undo / redo (build contract section A).
      'workspace','page_sections','section_catalog','edit_section','move_section',
      'remove_section','add_section','set_section_media','set_look','set_page_enabled',
      'history','undo','redo'
    ) THEN 20
    -- Only brand admins and owners confirm a review is real (§37 answer 2)
    -- and hide a past trip from the website (§37 answer 3).
    WHEN p_action IN ('confirm_review','set_offering_visibility') THEN 50
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_min_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_content_min_rank(text) TO authenticated, service_role;

-- ── 2. The audit row of a workspace change ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_content_record(
  p_site_id uuid,
  p_actor uuid,
  p_action text,
  p_collection text,
  p_entry text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand uuid;
  v_meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_action NOT IN (
    'content.created','content.updated','content.reordered','content.visibility',
    'content.deleted','content.review_confirmed','content.review_unconfirmed',
    'content.offering_visibility','media.upload_requested'
  ) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF p_collection IS NOT NULL AND p_collection NOT IN (
    'destinations','stories','testimonials','categories','media','offerings','navigation',
    -- #4453 Website workspace — a page's sections and the site's look.
    'pages','site-settings'
  ) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF p_entry IS NOT NULL AND p_entry !~ '^[A-Za-z0-9-]{1,64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT brand_id INTO v_brand FROM public.brand_sites WHERE id = p_site_id;
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES (p_site_id, v_brand, p_actor, 'user', p_action, 'site_content',
    left(COALESCE(p_collection, 'site') || ':' || COALESCE(p_entry, '-'), 128),
    v_meta
      || CASE WHEN p_collection IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('collection', p_collection) END
      || CASE WHEN p_entry IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('entry', p_entry) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_record(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_content_record(uuid, uuid, text, text, text, jsonb) TO service_role;

-- ── 3. Ari's step events ───────────────────────────────────────────────────
ALTER TABLE public.agent_activity_events
  DROP CONSTRAINT IF EXISTS agent_activity_events_event_type_check;
ALTER TABLE public.agent_activity_events
  ADD CONSTRAINT agent_activity_events_event_type_check CHECK (
    event_type IN (
      'accepted', 'attachments_processing_started', 'model_started',
      'planning_started', 'research_started', 'verification_started',
      'workspace_read_started', 'approved_action_started',
      'automated_retry_started', 'finalizing_started', 'response_ready',
      'reconciliation_started', 'reconciliation_finished', 'stopped', 'failed',
      'site_step_started', 'site_step_done', 'site_step_failed'
    )
  );

ALTER TABLE public.agent_activity_events
  ADD COLUMN IF NOT EXISTS detail jsonb;
ALTER TABLE public.agent_activity_events
  DROP CONSTRAINT IF EXISTS agent_activity_events_detail_ck;
ALTER TABLE public.agent_activity_events
  ADD CONSTRAINT agent_activity_events_detail_ck CHECK (
    detail IS NULL
    OR (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 2048)
  );
COMMENT ON COLUMN public.agent_activity_events.detail IS
  '#4453: optional small object (at most 2 KB) about the event; a website change step carries { group_id, index, total, label } and, on a failure, reason and rolled_back.';

-- Same body as 20280209003355 with the three site_step_* events and p_detail
-- added. Dropped first: adding a parameter makes a new function, and two
-- overloads would make a call without p_detail ambiguous.
DROP FUNCTION IF EXISTS public.append_agent_activity_event(uuid, uuid, integer, text, timestamptz);
CREATE FUNCTION public.append_agent_activity_event(
  p_attempt_id uuid,
  p_user_id uuid,
  p_attempt_number integer,
  p_event_type text,
  p_now timestamptz DEFAULT now(),
  p_detail jsonb DEFAULT NULL
)
RETURNS public.agent_activity_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.agent_turn_attempts%ROWTYPE;
  v_sequence integer;
  v_event public.agent_activity_events%ROWTYPE;
BEGIN
  IF p_event_type NOT IN (
    'accepted', 'attachments_processing_started', 'model_started',
    'planning_started', 'research_started', 'verification_started',
    'workspace_read_started', 'approved_action_started',
    'automated_retry_started', 'finalizing_started', 'response_ready',
    'reconciliation_started', 'reconciliation_finished', 'stopped', 'failed',
    'site_step_started', 'site_step_done', 'site_step_failed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported activity event';
  END IF;
  -- #4453: an optional small object of detail (a website change step's place in its plan).
  IF p_detail IS NOT NULL AND (
    jsonb_typeof(p_detail) <> 'object' OR octet_length(p_detail::text) > 2048
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'activity detail must be a small object';
  END IF;

  SELECT * INTO v_attempt
  FROM public.agent_turn_attempts
  WHERE id = p_attempt_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.attempt_number <> p_attempt_number THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'attempt authority denied';
  END IF;

  SELECT COALESCE(max(event.sequence), 0) + 1 INTO v_sequence
  FROM public.agent_activity_events event
  WHERE event.attempt_id = p_attempt_id
    AND event.attempt_number = p_attempt_number;

  INSERT INTO public.agent_activity_events(
    attempt_id, user_id, conversation_id, client_turn_id,
    attempt_number, sequence, event_type, created_at, expires_at, detail
  ) VALUES (
    v_attempt.id, v_attempt.user_id, v_attempt.conversation_id,
    v_attempt.client_turn_id, p_attempt_number, v_sequence, p_event_type,
    p_now, p_now + interval '7 days', p_detail
  ) RETURNING * INTO v_event;
  RETURN v_event;
END;
$function$;

REVOKE ALL ON FUNCTION public.append_agent_activity_event(
  uuid, uuid, integer, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_activity_event(
  uuid, uuid, integer, text, timestamptz, jsonb
) TO service_role;
