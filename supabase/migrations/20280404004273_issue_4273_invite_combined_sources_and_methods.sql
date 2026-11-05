-- #4273 wave A — the creation-wizard "Invite people" step combines its sources
-- and lets the host pick how invites travel.
--
--   sources   Everyone in Your Book, Followers, Friends of followers, saved
--             groups and chosen people are independent ticks that combine in
--             one selection. The plan already resolved one de-duplicated set
--             from all of them (a follower in Your Book is one Book person and
--             never also an account recipient); it now also REMEMBERS which
--             sources were ticked, so the Host can show and untick each one.
--   methods   "How to reach them": push, email and/or SMS (at least one). The
--             plan stores the chosen methods; publish seals them on the
--             selection; the quote and both dispatch lanes skip a method the
--             host did not pick.
--
-- Backward compatibility:
--   * The 4-key and 6-key selection shapes still save. They store no methods
--     (delivery_channels NULL) and keep today's automatic behaviour: every
--     live method, decided per person by Mingla.
--   * A plan saved before this migration has no stored sources; the response
--     derives them (explicit people = the saved Book people, Followers /
--     Friends of followers ticked when such account recipients exist).
--   * Receipt replays return the stored response unchanged; the Host parser
--     treats a missing "sources" / "deliveryChannels" exactly like a legacy plan.
--
-- Static SQL only; conflicts raise PT409 (never 40001).
--
-- Invariant (declared in the pg17 test): I-4273-INVITE-METHODS-HONOURED | issue #4273 | A wizard invite never travels by a method the host did not tick; a plan with no stored methods keeps the automatic behaviour.

BEGIN;

ALTER TABLE private.brand_offering_invite_plans
  ADD COLUMN IF NOT EXISTS selection_sources jsonb NULL,
  ADD COLUMN IF NOT EXISTS delivery_channels text[] NULL;
ALTER TABLE private.brand_offering_invite_plans
  DROP CONSTRAINT IF EXISTS issue_4273_plan_selection_sources_shape,
  DROP CONSTRAINT IF EXISTS issue_4273_plan_delivery_channels_shape;
ALTER TABLE private.brand_offering_invite_plans
  ADD CONSTRAINT issue_4273_plan_selection_sources_shape
    CHECK (selection_sources IS NULL OR jsonb_typeof(selection_sources) = 'object'),
  ADD CONSTRAINT issue_4273_plan_delivery_channels_shape
    CHECK (delivery_channels IS NULL OR (
      cardinality(delivery_channels) BETWEEN 1 AND 3
      AND delivery_channels <@ ARRAY['email', 'push', 'sms']::text[]));

ALTER TABLE private.brand_offering_invite_selections
  ADD COLUMN IF NOT EXISTS delivery_channels text[] NULL;
ALTER TABLE private.brand_offering_invite_selections
  DROP CONSTRAINT IF EXISTS issue_4273_selection_delivery_channels_shape;
ALTER TABLE private.brand_offering_invite_selections
  ADD CONSTRAINT issue_4273_selection_delivery_channels_shape
    CHECK (delivery_channels IS NULL OR (
      cardinality(delivery_channels) BETWEEN 1 AND 3
      AND delivery_channels <@ ARRAY['email', 'push', 'sms']::text[]));

-- ── Which sources a plan holds (stored, or derived for a legacy plan) ────────
CREATE OR REPLACE FUNCTION private.issue_4273_plan_sources(p_plan_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT COALESCE(p.selection_sources, jsonb_build_object(
    'includeEveryone', false,
    'includeFollowers', EXISTS (SELECT 1 FROM private.brand_offering_invite_plan_accounts a
                                 WHERE a.plan_id = p.id AND a.ring = 'follower'),
    'includeFriendsOfFollowers', EXISTS (SELECT 1 FROM private.brand_offering_invite_plan_accounts a
                                          WHERE a.plan_id = p.id AND a.ring = 'extended'),
    'manualGroupIds', '[]'::jsonb,
    'personIds', COALESCE((SELECT jsonb_agg(m.brand_person_id ORDER BY m.brand_person_id)
                             FROM private.brand_offering_invite_plan_members m
                            WHERE m.plan_id = p.id), '[]'::jsonb),
    'excludedPersonIds', '[]'::jsonb))
  FROM private.brand_offering_invite_plans p
  WHERE p.id = p_plan_id
$fn$;

-- ── Plan response: the 20280401033682 shape + sources + deliveryChannels ─────
CREATE OR REPLACE FUNCTION private.issue_1780_plan_response(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT jsonb_build_object(
    'eventId', p.event_id,
    'eventType', p.event_type,
    'selectionRevision', p.selection_revision,
    'selectedCount', (SELECT count(*) FROM private.brand_offering_invite_plan_members m
                       WHERE m.plan_id = p.id),
    'brandPersonIds', COALESCE((SELECT jsonb_agg(m.brand_person_id ORDER BY m.brand_person_id)
                                  FROM private.brand_offering_invite_plan_members m
                                 WHERE m.plan_id = p.id), '[]'::jsonb),
    'accountRecipientCount', (SELECT count(*) FROM private.brand_offering_invite_plan_accounts a
                               WHERE a.plan_id = p.id),
    'selectionHash', p.selection_hash,
    'state', p.state,
    'publishedSelectionRevision', p.published_selection_revision,
    'updatedAt', p.updated_at,
    'sources', private.issue_4273_plan_sources(p.id),
    'deliveryChannels', to_jsonb(p.delivery_channels)
  )
  FROM private.brand_offering_invite_plans p
  WHERE p.event_id = p_event_id
$fn$;

CREATE OR REPLACE FUNCTION public.biz_get_offering_invite_plan_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_actor uuid := auth.uid(); v_scope record; v_result jsonb;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id, v_actor);
  IF v_scope.event_deleted THEN
    RAISE EXCEPTION 'wizard_invite_not_found_or_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Same normalized row authority as replace/seal (#1780 T-1780-MEM-00).
  SELECT jsonb_build_object(
    'eventId', p.event_id, 'eventType', p.event_type,
    'selectionRevision', p.selection_revision,
    'selectedCount', (SELECT count(*) FROM private.brand_offering_invite_plan_members m
                       WHERE m.plan_id = p.id),
    'brandPersonIds', COALESCE((SELECT jsonb_agg(m.brand_person_id ORDER BY m.brand_person_id)
                                  FROM private.brand_offering_invite_plan_members m
                                 WHERE m.plan_id = p.id), '[]'::jsonb),
    'accountRecipientCount', (SELECT count(*) FROM private.brand_offering_invite_plan_accounts a
                               WHERE a.plan_id = p.id),
    'selectionHash', p.selection_hash, 'state', p.state,
    'publishedSelectionRevision', p.published_selection_revision,
    'updatedAt', p.updated_at,
    'sources', private.issue_4273_plan_sources(p.id),
    'deliveryChannels', to_jsonb(p.delivery_channels))
  INTO v_result
  FROM private.brand_offering_invite_plans p
  WHERE p.event_id = p_event_id;
  RETURN COALESCE(v_result, jsonb_build_object(
    'eventId', p_event_id, 'eventType', v_scope.event_type, 'selectionRevision', 0,
    'selectedCount', 0, 'brandPersonIds', '[]'::jsonb, 'accountRecipientCount', 0,
    'selectionHash', private.issue_1780_selection_hash('{}'::uuid[]),
    'state', 'draft', 'publishedSelectionRevision', NULL, 'updatedAt', NULL,
    'sources', jsonb_build_object(
      'includeEveryone', false, 'includeFollowers', false,
      'includeFriendsOfFollowers', false, 'manualGroupIds', '[]'::jsonb,
      'personIds', '[]'::jsonb, 'excludedPersonIds', '[]'::jsonb),
    'deliveryChannels', NULL));
END;
$fn$;

-- ── Selection: the 20280401033682 body + stored sources + delivery methods ───
CREATE OR REPLACE FUNCTION public.biz_replace_offering_invite_plan_v1(
  p_event_id uuid, p_selection jsonb, p_expected_revision bigint, p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor uuid := auth.uid(); v_scope record; v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_plan_id uuid;
  v_ids uuid[] := '{}'; v_explicit uuid[] := '{}'; v_excluded uuid[] := '{}';
  v_groups uuid[] := '{}'; v_everyone boolean; v_followers boolean; v_friends boolean;
  v_request_hash text; v_legacy_hash text;
  v_prior private.brand_offering_invite_mutation_receipts%ROWTYPE; v_result jsonb;
  v_rings text[] := '{}'; v_keys text[]; v_flags boolean;
  v_raw_selection jsonb; v_legacy_shape boolean := false;
  v_accounts jsonb := '[]'::jsonb;
  v_channels text[] := NULL; v_channel_count integer; v_sources jsonb;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id, v_actor);
  IF p_client_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR jsonb_typeof(p_selection) <> 'object' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  v_raw_selection := p_selection;
  v_keys := ARRAY(SELECT jsonb_object_keys(p_selection) ORDER BY 1);
  IF v_keys = ARRAY[
       'excludedPersonIds', 'includeEveryone', 'manualGroupIds', 'personIds'
     ]::text[] THEN
    v_legacy_shape := true;
    p_selection := p_selection || jsonb_build_object(
      'includeFollowers', false,
      'includeFriendsOfFollowers', false);
  ELSIF v_keys = ARRAY[
       'deliveryChannels',
       'excludedPersonIds',
       'includeEveryone',
       'includeFollowers',
       'includeFriendsOfFollowers',
       'manualGroupIds',
       'personIds'
     ]::text[] THEN
    -- #4273: "How to reach them". One to three distinct methods.
    IF jsonb_typeof(p_selection -> 'deliveryChannels') <> 'array'
       OR jsonb_array_length(p_selection -> 'deliveryChannels') NOT BETWEEN 1 AND 3
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_selection -> 'deliveryChannels') c
                   WHERE jsonb_typeof(c) <> 'string'
                      OR (c #>> '{}') NOT IN ('email', 'push', 'sms')) THEN
      RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT c ORDER BY c), count(*)
      INTO v_channels, v_channel_count
      FROM jsonb_array_elements_text(p_selection -> 'deliveryChannels') c;
    IF cardinality(v_channels) <> v_channel_count THEN
      RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF v_keys <> ARRAY[
       'excludedPersonIds',
       'includeEveryone',
       'includeFollowers',
       'includeFriendsOfFollowers',
       'manualGroupIds',
       'personIds'
     ]::text[] THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_selection -> 'manualGroupIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'personIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'excludedPersonIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'includeEveryone') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFollowers') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFriendsOfFollowers') <> 'boolean' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_explicit
      FROM jsonb_array_elements_text(p_selection -> 'personIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_groups
      FROM jsonb_array_elements_text(p_selection -> 'manualGroupIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_excluded
      FROM jsonb_array_elements_text(p_selection -> 'excludedPersonIds') x;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END;
  v_everyone := (p_selection ->> 'includeEveryone')::boolean;
  v_followers := (p_selection ->> 'includeFollowers')::boolean;
  v_friends := (p_selection ->> 'includeFriendsOfFollowers')::boolean;
  IF v_followers THEN
    v_rings := array_append(v_rings, 'follower');
  END IF;
  IF v_friends THEN
    v_rings := array_append(v_rings, 'extended');
  END IF;
  v_sources := jsonb_build_object(
    'includeEveryone', v_everyone,
    'includeFollowers', v_followers,
    'includeFriendsOfFollowers', v_friends,
    'manualGroupIds', to_jsonb(v_groups),
    'personIds', to_jsonb(v_explicit),
    'excludedPersonIds', to_jsonb(v_excluded));
  v_request_hash := encode(extensions.digest(convert_to(
    jsonb_build_object('expectedRevision', p_expected_revision, 'selection', p_selection)::text, 'UTF8'), 'sha256'), 'hex');
  IF v_legacy_shape THEN
    v_legacy_hash := encode(extensions.digest(convert_to(
      jsonb_build_object('expectedRevision', p_expected_revision, 'selection', v_raw_selection)::text, 'UTF8'), 'sha256'), 'hex');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 1780));
  SELECT * INTO v_prior FROM private.brand_offering_invite_mutation_receipts
    WHERE event_id = p_event_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_prior.actor_id = v_actor AND (
         v_prior.request_hash = v_request_hash
         OR (v_legacy_shape AND v_prior.request_hash = v_legacy_hash)
       ) THEN
      RETURN v_prior.response_json || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'wizard_invite_idempotency_conflict' USING ERRCODE = '23505';
  END IF;
  IF v_scope.event_deleted OR v_scope.event_status <> 'draft' OR v_scope.event_visibility <> 'draft' THEN
    RAISE EXCEPTION 'wizard_invite_offering_not_draft' USING ERRCODE = '55000';
  END IF;
  IF NOT COALESCE((SELECT is_enabled FROM public.feature_flags
      WHERE flag_key = 'business_wizard_invite_selection_v1'), false) THEN
    RAISE EXCEPTION 'wizard_invite_feature_disabled' USING ERRCODE = '55000';
  END IF;
  IF v_followers THEN
    SELECT count(*) = 1 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags WHERE flag_key = 'brand_circle_followers_v1';
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_friends THEN
    SELECT count(*) = 3 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags
     WHERE flag_key IN (
       'brand_circle_extended_v1',
       'brand_circle_extended_controls_ios_v1',
       'brand_circle_extended_controls_android_v1');
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_groups) gid LEFT JOIN public.marketing_audiences a
      ON a.id = gid AND a.brand_id = v_scope.brand_id AND a.deleted_at IS NULL
      AND NOT a.is_system_generated AND a.query_definition = '{"kind":"manual_group"}'::jsonb
      WHERE a.id IS NULL)
     OR EXISTS(SELECT 1 FROM unnest(v_explicit || v_excluded) pid LEFT JOIN public.brand_people bp
      ON bp.id = pid AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active' WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE = 'PT409';
  END IF;
  -- One de-duplicated Book set across every ticked source (UNION).
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_ids FROM (
    SELECT bp.id FROM public.brand_people bp
      WHERE v_everyone AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM unnest(v_explicit) requested(id)
      JOIN public.brand_people bp ON bp.id = requested.id AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM public.marketing_manual_group_memberships gm
      JOIN public.brand_people bp ON bp.id = gm.brand_person_id AND bp.brand_id = gm.brand_id AND bp.record_status = 'active'
      WHERE gm.audience_id = ANY (v_groups) AND gm.brand_id = v_scope.brand_id AND gm.state = 'active'
    UNION
    SELECT person_id FROM private.issue_3682_circle_invite_person_ids(v_scope.brand_id, v_rings) person_id
  ) selected WHERE NOT (id = ANY (v_excluded));
  -- #3682 wave 2: circle members who are NOT in Your Book ride as account-only
  -- recipients (never brand_people rows, never auto-promoted). The members
  -- helper excludes anyone linked to an active Book person, so nobody is in
  -- both lanes.
  IF cardinality(v_rings) > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', a.user_id, 'ring', a.ring)
             ORDER BY a.user_id), '[]'::jsonb)
      INTO v_accounts
      FROM private.issue_3682_account_invite_members(v_scope.brand_id, v_rings) a;
  END IF;
  IF cardinality(v_ids) + jsonb_array_length(v_accounts) > 500 THEN
    RAISE EXCEPTION 'wizard_invite_selection_too_large' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans WHERE event_id = p_event_id FOR UPDATE;
  IF FOUND AND v_plan.state = 'locked' THEN RAISE EXCEPTION 'wizard_invite_plan_locked' USING ERRCODE = '55000'; END IF;
  IF COALESCE(v_plan.selection_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'wizard_invite_revision_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('currentRevision', COALESCE(v_plan.selection_revision, 0))::text;
  END IF;
  INSERT INTO private.brand_offering_invite_plans(
    event_id, brand_id, event_type, selection_revision, selection_hash, created_by, updated_by,
    selection_sources, delivery_channels)
  VALUES (p_event_id, v_scope.brand_id, v_scope.event_type, p_expected_revision + 1,
    private.issue_1780_selection_hash(v_ids), v_actor, v_actor, v_sources, v_channels)
  ON CONFLICT (event_id) DO UPDATE SET
    selection_revision = EXCLUDED.selection_revision,
    selection_hash = EXCLUDED.selection_hash, updated_by = EXCLUDED.updated_by, updated_at = now(),
    selection_sources = EXCLUDED.selection_sources,
    delivery_channels = EXCLUDED.delivery_channels
  RETURNING id INTO v_plan_id;
  DELETE FROM private.brand_offering_invite_plan_members
  WHERE plan_id = v_plan_id;
  INSERT INTO private.brand_offering_invite_plan_members(
    plan_id, brand_person_id, added_by)
  SELECT v_plan_id, id, v_actor FROM unnest(v_ids) selected(id);
  DELETE FROM private.brand_offering_invite_plan_accounts
  WHERE plan_id = v_plan_id;
  INSERT INTO private.brand_offering_invite_plan_accounts(plan_id, user_id, ring, added_by)
  SELECT v_plan_id, (x ->> 'userId')::uuid, x ->> 'ring', v_actor
    FROM jsonb_array_elements(v_accounts) x;
  v_result := private.issue_1780_plan_response(p_event_id) || jsonb_build_object('replayed', false);
  INSERT INTO private.brand_offering_invite_mutation_receipts(event_id, client_request_id, actor_id, request_hash, response_json)
    VALUES (p_event_id, p_client_request_id, v_actor, v_request_hash, v_result);
  RETURN v_result;
END;
$fn$;

-- ── Publish: the 20280401033682 body + sealed delivery methods ──────────────
CREATE OR REPLACE FUNCTION private.enqueue_wizard_invites_on_publish_v1(
  p_event_id uuid, p_expected_revision bigint, p_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_selection_id uuid; v_outbox_id uuid; v_outbox_state text;
  v_selected_count integer; v_ids uuid[]; v_accounts jsonb; v_account_count integer;
BEGIN
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans
    WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inviteDelivery', jsonb_build_object(
      'planned', false, 'selectedCount', 0, 'status', 'not_requested'));
  END IF;
  SELECT COALESCE(array_agg(m.brand_person_id ORDER BY m.brand_person_id), '{}'::uuid[])
    INTO v_ids
  FROM private.brand_offering_invite_plan_members m
  WHERE m.plan_id = v_plan.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', a.user_id, 'ring', a.ring)
           ORDER BY a.user_id), '[]'::jsonb)
    INTO v_accounts
  FROM private.brand_offering_invite_plan_accounts a
  WHERE a.plan_id = v_plan.id;
  v_account_count := jsonb_array_length(v_accounts);
  v_selected_count := cardinality(v_ids) + v_account_count;
  IF v_plan.state = 'locked' THEN
    SELECT o.id, o.state, cardinality(s.brand_person_ids) + jsonb_array_length(s.account_recipients)
      INTO v_outbox_id, v_outbox_state, v_selected_count
    FROM private.brand_offering_invite_selections s
    LEFT JOIN private.brand_offering_invite_outbox o ON o.plan_id = v_plan.id
      AND o.selection_revision = s.selection_revision
    WHERE s.event_id = p_event_id AND s.selection_revision = v_plan.published_selection_revision;
    v_selected_count := COALESCE(v_selected_count, 0);
    RETURN jsonb_build_object('inviteDelivery', jsonb_build_object(
      'planned', v_selected_count > 0,
      'selectedCount', v_selected_count,
      'selectionRevision', v_plan.published_selection_revision,
      'outboxJobId', v_outbox_id, 'status', COALESCE(v_outbox_state, 'empty')));
  END IF;
  -- A Book-empty plan published without confirmation comes from a client that
  -- never showed its account recipients: lock it empty, as before #3682 wave 2.
  IF v_selected_count = 0 OR (cardinality(v_ids) = 0 AND NOT COALESCE(p_confirmed, false)) THEN
    UPDATE private.brand_offering_invite_plans SET
      state = 'locked', published_selection_revision = selection_revision, locked_at = now(), updated_at = now()
    WHERE event_id = p_event_id;
    RETURN jsonb_build_object('inviteDelivery', jsonb_build_object(
      'planned', false, 'selectedCount', 0, 'selectionRevision', v_plan.selection_revision, 'status', 'empty'));
  END IF;
  IF NOT COALESCE(p_confirmed, false) OR p_expected_revision IS NULL
     OR p_expected_revision <> v_plan.selection_revision THEN
    RAISE EXCEPTION 'wizard_invite_publish_confirmation_required' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_ids) pid
    LEFT JOIN public.brand_people bp ON bp.id = pid AND bp.brand_id = v_plan.brand_id AND bp.record_status = 'active'
    WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO private.brand_offering_invite_selections(
    event_id, brand_id, event_type, selection_revision, brand_person_ids, selection_hash, actor_id,
    account_recipients, delivery_channels)
  VALUES (p_event_id, v_plan.brand_id, v_plan.event_type, v_plan.selection_revision,
    v_ids, v_plan.selection_hash, v_plan.updated_by, v_accounts, v_plan.delivery_channels)
  ON CONFLICT (event_id, selection_revision) DO UPDATE SET event_id = EXCLUDED.event_id
  RETURNING id INTO v_selection_id;
  INSERT INTO private.brand_offering_invite_outbox(
    plan_id, brand_id, event_id, event_type, selection_revision, operation_key, sealed_selection_id)
  VALUES (v_plan.id, v_plan.brand_id, p_event_id, v_plan.event_type, v_plan.selection_revision,
    'wizard:v1:' || v_plan.event_type || ':' || p_event_id::text || ':' || v_plan.selection_revision::text,
    v_selection_id)
  ON CONFLICT (event_id, selection_revision) DO UPDATE
    SET operation_key = EXCLUDED.operation_key
  RETURNING id, state INTO v_outbox_id, v_outbox_state;
  INSERT INTO private.brand_offering_invite_observability_events(
    event_name, outbox_job_id, offering_kind, selection_revision, selected_count, job_state)
  VALUES ('wizard_invite_outbox_enqueued', v_outbox_id, v_plan.event_type,
    v_plan.selection_revision, v_selected_count, v_outbox_state)
  ON CONFLICT (outbox_job_id) DO NOTHING;
  UPDATE private.brand_offering_invite_plans SET
    state = 'locked', published_selection_revision = selection_revision, locked_at = now(), updated_at = now()
  WHERE event_id = p_event_id;
  RETURN jsonb_build_object('inviteDelivery', jsonb_build_object(
    'planned', true, 'selectedCount', v_selected_count,
    'selectionRevision', v_plan.selection_revision, 'outboxJobId', v_outbox_id, 'status', v_outbox_state));
END;
$fn$;

-- ── Worker claim: the 20280401033682 body + sealed deliveryChannels ─────────
CREATE OR REPLACE FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'wizard_invite_worker_limit_invalid' USING ERRCODE = '22023'; END IF;
  -- Dispatch rollback is checked before any row is locked or mutated.
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags f
    WHERE f.flag_key = 'business_wizard_invite_dispatch_v1' AND f.is_enabled) THEN
    RETURN '[]'::jsonb;
  END IF;
  WITH candidates AS (
    SELECT o.id FROM private.brand_offering_invite_outbox o
    WHERE ((o.state IN ('pending', 'retryable') AND o.next_attempt_at <= now())
      OR (o.state = 'leased' AND o.lease_expires_at <= now()))
    ORDER BY o.next_attempt_at, o.created_at, o.id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE private.brand_offering_invite_outbox o SET
      state = 'leased', attempt_count = o.attempt_count + 1, lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '4 minutes', updated_at = now(), last_error_code = NULL
    FROM candidates c WHERE o.id = c.id
    RETURNING o.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'outboxJobId', c.id, 'sealedSelectionId', s.id, 'eventId', c.event_id,
    'eventType', s.event_type, 'actorId', s.actor_id, 'brandPersonIds', to_jsonb(s.brand_person_ids),
    'accountRecipientCount', jsonb_array_length(s.account_recipients),
    'deliveryChannels', to_jsonb(s.delivery_channels),
    'selectionHash', s.selection_hash, 'selectionRevision', s.selection_revision,
    'leaseToken', c.lease_token, 'attemptCount', c.attempt_count,
    'executionSealed', xs.id IS NOT NULL,
    'sealedQueuedCount', xs.queued_count,
    'committedGroupId', g.id, 'committedChannels', to_jsonb(g.channels))
    ORDER BY c.created_at, c.id), '[]'::jsonb) INTO v_rows
  FROM claimed c
  JOIN private.brand_offering_invite_selections s ON s.id = c.sealed_selection_id
  LEFT JOIN private.brand_offering_invite_execution_seals xs ON xs.outbox_job_id = c.id
  LEFT JOIN public.marketing_send_groups g
    ON g.brand_id = c.brand_id AND g.client_request_id = c.id;
  RETURN v_rows;
END;
$fn$;

-- ── Quote (wizard preview): the 20280401033682 body, honouring the methods ──
CREATE OR REPLACE FUNCTION public.issue_3682_quote_wizard_account_invites_v1(
  p_actor_id uuid, p_event_id uuid, p_selection_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_scope record; v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_total integer := 0; v_push integer := 0; v_email integer := 0; v_can integer := 0;
  v_remaining integer; v_push_chosen boolean; v_email_chosen boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id, p_actor_id);
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    IF COALESCE(p_selection_revision, 0) <> 0 THEN
      RAISE EXCEPTION 'wizard_invite_revision_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('accountRecipientCount', 0, 'canReceiveCount', 0, 'push', 0, 'email', 0);
  END IF;
  IF v_plan.selection_revision <> p_selection_revision THEN
    RAISE EXCEPTION 'wizard_invite_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  -- #4273: NULL methods = automatic (every method); otherwise only ticked ones.
  v_push_chosen := v_plan.delivery_channels IS NULL OR 'push' = ANY (v_plan.delivery_channels);
  v_email_chosen := v_plan.delivery_channels IS NULL OR 'email' = ANY (v_plan.delivery_channels);
  v_remaining := private.issue_3682_account_invite_email_remaining(v_plan.brand_id);
  WITH decided AS MATERIALIZED (
    SELECT a.user_id,
      CASE WHEN v_push_chosen THEN
        private.issue_3682_account_invite_channel_reason(v_plan.brand_id, a.user_id, a.ring, 'push') = 'allowed'
      ELSE false END AS push_ok,
      CASE WHEN v_email_chosen THEN
        private.issue_3682_account_invite_channel_reason(v_plan.brand_id, a.user_id, a.ring, 'email') = 'allowed'
      ELSE false END AS email_ok
    FROM private.brand_offering_invite_plan_accounts a
    WHERE a.plan_id = v_plan.id
  ), ranked AS (
    SELECT d.*, CASE WHEN d.email_ok
      THEN row_number() OVER (PARTITION BY d.email_ok ORDER BY d.user_id) <= v_remaining
      ELSE false END AS email_queued
    FROM decided d
  )
  SELECT count(*)::integer, count(*) FILTER (WHERE push_ok)::integer,
    count(*) FILTER (WHERE email_queued)::integer,
    count(*) FILTER (WHERE push_ok OR email_queued)::integer
    INTO v_total, v_push, v_email, v_can
  FROM ranked;
  RETURN jsonb_build_object('accountRecipientCount', v_total, 'canReceiveCount', v_can,
    'push', v_push, 'email', v_email);
END;
$fn$;

-- ── Dispatch: the 20280401033682 body; an unticked method is skipped ────────
CREATE OR REPLACE FUNCTION public.issue_3682_build_wizard_account_invites_v1(
  p_outbox_job_id uuid, p_sealed_selection_id uuid, p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
  v_selection private.brand_offering_invite_selections%ROWTYPE;
  v_row record; v_channel text; v_reason text; v_remaining integer; v_in_book boolean;
  v_work jsonb; v_context jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
    WHERE id = p_outbox_job_id AND sealed_selection_id = p_sealed_selection_id
      AND state = 'leased' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE = 'PT409'; END IF;
  SELECT * INTO v_selection FROM private.brand_offering_invite_selections
    WHERE id = p_sealed_selection_id AND event_id = v_job.event_id AND brand_id = v_job.brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_seal_invalid' USING ERRCODE = '22023'; END IF;
  -- Serialize with campaign confirms on the same brand x email cap.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('blast_cap:' || v_job.brand_id::text || ':email', 3682));
  v_remaining := private.issue_3682_account_invite_email_remaining(v_job.brand_id);
  FOR v_row IN
    SELECT (x ->> 'userId')::uuid AS user_id, x ->> 'ring' AS ring
      FROM jsonb_array_elements(v_selection.account_recipients) x
     ORDER BY 1
  LOOP
    v_in_book := EXISTS (SELECT 1 FROM public.brand_people bp
      WHERE bp.id = ANY (v_selection.brand_person_ids) AND bp.linked_user_id = v_row.user_id);
    FOREACH v_channel IN ARRAY ARRAY['push', 'email']::text[] LOOP
      IF EXISTS (SELECT 1 FROM private.brand_offering_account_invite_deliveries d
                  WHERE d.outbox_job_id = v_job.id AND d.user_id = v_row.user_id
                    AND d.channel = v_channel) THEN
        CONTINUE;
      END IF;
      v_reason := CASE
        WHEN v_in_book THEN 'in_book'
        WHEN v_selection.delivery_channels IS NOT NULL
             AND NOT (v_channel = ANY (v_selection.delivery_channels)) THEN 'method_not_chosen'
        ELSE private.issue_3682_account_invite_channel_reason(
          v_job.brand_id, v_row.user_id, v_row.ring, v_channel) END;
      IF v_channel = 'email' AND v_reason = 'allowed' THEN
        IF v_remaining <= 0 THEN
          v_reason := 'email_cap';
        ELSE
          v_remaining := v_remaining - 1;
        END IF;
      END IF;
      INSERT INTO private.brand_offering_account_invite_deliveries(
        outbox_job_id, event_id, brand_id, user_id, ring, channel, state, reason, completed_at)
      VALUES (v_job.id, v_job.event_id, v_job.brand_id, v_row.user_id, v_row.ring, v_channel,
        CASE WHEN v_reason = 'allowed' THEN 'queued' ELSE 'skipped' END, v_reason,
        CASE WHEN v_reason = 'allowed' THEN NULL ELSE now() END);
    END LOOP;
  END LOOP;
  SELECT jsonb_build_object(
      'brandName', b.name, 'brandSlug', b.slug,
      'eventTitle', e.title, 'eventSlug', e.slug, 'eventType', e.event_type)
    INTO v_context
    FROM public.events e JOIN public.brands b ON b.id = e.brand_id
   WHERE e.id = v_job.event_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'deliveryId', d.id, 'userId', d.user_id, 'ring', d.ring, 'channel', d.channel,
      'email', CASE WHEN d.channel = 'email' THEN (
        SELECT i.value FROM public.verified_account_identifiers(d.user_id) i
         WHERE i.kind = 'email' ORDER BY i.value LIMIT 1) END)
      ORDER BY d.user_id, d.channel), '[]'::jsonb)
    INTO v_work
    FROM private.brand_offering_account_invite_deliveries d
   WHERE d.outbox_job_id = v_job.id AND d.state = 'queued';
  RETURN jsonb_build_object('context', v_context, 'work', v_work);
END;
$fn$;

-- ── Completion when the host's methods leave the Book lane nothing to use ───
-- Push is always live in the dispatcher, so this can only happen when the host
-- ticked email and/or SMS and those are switched off at send time. The job
-- must not have sealed or committed any Book-lane delivery, and its account
-- lane must be finished.
CREATE OR REPLACE FUNCTION public.issue_4273_complete_wizard_invite_outbox_no_methods_v1(
  p_outbox_job_id uuid, p_sealed_selection_id uuid, p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
    WHERE id = p_outbox_job_id AND sealed_selection_id = p_sealed_selection_id
      AND state = 'leased' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE = 'PT409'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.brand_offering_invite_selections s
                  WHERE s.id = p_sealed_selection_id
                    AND s.delivery_channels IS NOT NULL
                    AND NOT ('push' = ANY (s.delivery_channels)))
     OR EXISTS (SELECT 1 FROM private.brand_offering_invite_execution_seals xs
                 WHERE xs.outbox_job_id = v_job.id AND xs.queued_count > 0)
     OR EXISTS (SELECT 1 FROM public.marketing_send_groups g
                 WHERE g.brand_id = v_job.brand_id AND g.client_request_id = v_job.id)
     OR EXISTS (SELECT 1 FROM private.brand_offering_account_invite_deliveries d
                 WHERE d.outbox_job_id = v_job.id AND d.state = 'queued') THEN
    RAISE EXCEPTION 'wizard_invite_no_methods_completion_invalid' USING ERRCODE = 'PT409';
  END IF;
  UPDATE private.brand_offering_invite_outbox SET
    state = 'succeeded', lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL,
    completed_at = now(), updated_at = now()
  WHERE id = v_job.id;
  RETURN jsonb_build_object('outboxJobId', v_job.id, 'status', 'succeeded', 'providerIo', false);
END;
$fn$;

REVOKE ALL ON FUNCTION private.issue_4273_plan_sources(uuid),
  private.issue_1780_plan_response(uuid),
  private.enqueue_wizard_invites_on_publish_v1(uuid, bigint, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(integer),
  public.issue_3682_quote_wizard_account_invites_v1(uuid, uuid, bigint),
  public.issue_3682_build_wizard_account_invites_v1(uuid, uuid, uuid),
  public.issue_4273_complete_wizard_invite_outbox_no_methods_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(integer),
  public.issue_3682_quote_wizard_account_invites_v1(uuid, uuid, bigint),
  public.issue_3682_build_wizard_account_invites_v1(uuid, uuid, uuid),
  public.issue_4273_complete_wizard_invite_outbox_no_methods_v1(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.biz_get_offering_invite_plan_v1(uuid),
  public.biz_replace_offering_invite_plan_v1(uuid, jsonb, bigint, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_get_offering_invite_plan_v1(uuid),
  public.biz_replace_offering_invite_plan_v1(uuid, jsonb, bigint, uuid)
  TO authenticated, service_role;

COMMIT;
