-- #3682 closeout wave 2 (A) — invite ANY follower at creation.
--
-- A follower (or, once switched on, a friend of a follower) who is NOT in
-- Your Book becomes an ACCOUNT-ONLY invite recipient. They are never written
-- into brand_people, never promoted into the Book, and their contact details
-- never reach the host: the host sees counts, names and avatars only (#876
-- ring contract). Book people keep the sealed #1770 lane unchanged.
--
--   selection  biz_replace_offering_invite_plan_v1 stores account recipients
--              in private.brand_offering_invite_plan_accounts (user_id, ring).
--   quote      issue_3682_quote_wizard_account_invites_v1 counts per channel
--              (push free, email within the monthly cap).
--   sealing    enqueue_wizard_invites_on_publish_v1 seals them on the
--              selection (account_recipients) next to brand_person_ids.
--   dispatch   issue_3682_build_wizard_account_invites_v1 decides each
--              (user, channel) at SEND time — unfollow, mute, follower
--              channel prefs, circle exits, can_send, Book dedupe, monthly
--              email cap — and returns the worklist (email resolved here,
--              only to the service-role dispatcher).
--   host view  biz_get_offering_account_invites_v1 — names, avatars, states.
--
-- Backward compatibility: plan.selectedCount and brandPersonIds stay Book-only
-- (older Host clients parse them strictly); accountRecipientCount is added.
-- A Book-empty plan published WITHOUT confirmation (an older client that never
-- saw the account recipients) locks empty, exactly as before.
--
-- Invariant (declared in the pg17 test): I-3682-ACCOUNT-INVITE-NEVER-BOOK | issue #3682 | An account-only invite recipient is never inserted into brand_people and its email/phone is never returned by an authenticated RPC.

BEGIN;

INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('brand_offering_invite', 'Marketing', false, 'low',
    ARRAY['inapp', 'push', 'email']::text[], 'reach_once', true)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE private.brand_offering_invite_plan_accounts (
  plan_id uuid NOT NULL REFERENCES private.brand_offering_invite_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ring text NOT NULL CHECK (ring IN ('follower', 'extended')),
  added_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, user_id)
);

ALTER TABLE private.brand_offering_invite_selections
  ADD COLUMN account_recipients jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE private.brand_offering_invite_selections
  DROP CONSTRAINT brand_offering_invite_selections_brand_person_ids_check;
ALTER TABLE private.brand_offering_invite_selections
  ADD CONSTRAINT brand_offering_invite_selections_brand_person_ids_check
    CHECK (cardinality(brand_person_ids) BETWEEN 0 AND 500),
  ADD CONSTRAINT issue_3682_selection_account_recipients_shape
    CHECK (jsonb_typeof(account_recipients) = 'array'),
  ADD CONSTRAINT issue_3682_selection_total_size
    CHECK (cardinality(brand_person_ids) + jsonb_array_length(account_recipients) BETWEEN 1 AND 500);

CREATE TABLE private.brand_offering_account_invite_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_job_id uuid NOT NULL REFERENCES private.brand_offering_invite_outbox(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  ring text NOT NULL CHECK (ring IN ('follower', 'extended')),
  channel text NOT NULL CHECK (channel IN ('push', 'email')),
  state text NOT NULL CHECK (state IN ('queued', 'sent', 'skipped', 'failed')),
  reason text NOT NULL CHECK (reason ~ '^[a-z_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE (outbox_job_id, user_id, channel),
  CONSTRAINT issue_3682_account_delivery_completion_shape CHECK (
    (state = 'queued' AND completed_at IS NULL)
    OR (state <> 'queued' AND completed_at IS NOT NULL)
  )
);
CREATE INDEX issue_3682_account_delivery_event_idx
  ON private.brand_offering_account_invite_deliveries (event_id);
CREATE INDEX issue_3682_account_delivery_brand_month_idx
  ON private.brand_offering_account_invite_deliveries (brand_id, channel, created_at);

ALTER TABLE private.brand_offering_invite_plan_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_plan_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_account_invite_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_account_invite_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.brand_offering_invite_plan_accounts,
  private.brand_offering_account_invite_deliveries FROM PUBLIC, anon, authenticated;

-- ── Who is an account-only recipient ────────────────────────────────────────
-- Followers who are not muted and have not left the brand's circle, plus (ring
-- 'extended') friends of followers from the #1777 resolver. Anyone linked to
-- an active Book person is excluded: they travel the Book lane (dedupe).
CREATE OR REPLACE FUNCTION private.issue_3682_account_invite_members(
  p_brand_id uuid, p_rings text[]
) RETURNS TABLE(user_id uuid, ring text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT DISTINCT ON (c.user_id) c.user_id, c.ring
  FROM (
    SELECT bf.user_id, 'follower'::text AS ring, 0 AS priority
      FROM public.brand_follows bf
      JOIN public.profiles p ON p.id = bf.user_id
       AND p.active IS TRUE AND p.explorer_deleted_at IS NULL
     WHERE 'follower' = ANY (p_rings)
       AND bf.brand_id = p_brand_id
       AND (bf.muted_until IS NULL OR bf.muted_until <= now())
       AND NOT EXISTS (
         SELECT 1 FROM public.brand_circle_exits bx
          WHERE bx.brand_id = p_brand_id AND bx.user_id = bf.user_id
            AND (bx.visibility_exited_at IS NOT NULL OR bx.delivery_exited_at IS NOT NULL))
    UNION ALL
    SELECT r.user_id, 'extended'::text, 1
      FROM public.issue_1777_resolve_brand_circle_members(p_brand_id, 'extended', NULL) r
     WHERE 'extended' = ANY (p_rings)
       AND NOT EXISTS (
         SELECT 1 FROM public.brand_circle_exits bx
          WHERE bx.brand_id = p_brand_id AND bx.user_id = r.user_id
            AND (bx.visibility_exited_at IS NOT NULL OR bx.delivery_exited_at IS NOT NULL))
  ) c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.brand_people bp
     WHERE bp.brand_id = p_brand_id AND bp.record_status = 'active'
       AND bp.linked_user_id = c.user_id)
  ORDER BY c.user_id, c.priority
$fn$;

-- ── Per (user, channel) decision, evaluated at quote AND at send time ───────
CREATE OR REPLACE FUNCTION private.issue_3682_account_invite_channel_reason(
  p_brand_id uuid, p_user_id uuid, p_ring text, p_channel text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_contact text; v_allowed boolean; v_reason text;
BEGIN
  IF p_channel NOT IN ('push', 'email') OR p_ring NOT IN ('follower', 'extended') THEN
    RETURN 'channel_unavailable';
  END IF;
  IF p_ring = 'follower' THEN
    IF NOT EXISTS (SELECT 1 FROM public.brand_follows bf
                    WHERE bf.brand_id = p_brand_id AND bf.user_id = p_user_id) THEN
      RETURN 'unfollowed';
    END IF;
    -- Mute + the follower's own per-brand channel switch + unsubscribes.
    IF NOT public.biz_brand_follow_channel_ok(p_user_id, p_brand_id, p_channel) THEN
      RETURN 'muted_or_off';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.issue_1777_resolve_brand_circle_members(
      p_brand_id, 'extended', ARRAY[p_user_id]) r WHERE r.user_id = p_user_id) THEN
    RETURN 'left_circle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_circle_exits bx
              WHERE bx.brand_id = p_brand_id AND bx.user_id = p_user_id
                AND (bx.visibility_exited_at IS NOT NULL OR bx.delivery_exited_at IS NOT NULL)) THEN
    RETURN 'delivery_denied';
  END IF;
  IF p_channel = 'email' THEN
    SELECT a.normalized_contact, a.allowed, a.reason INTO v_contact, v_allowed, v_reason
      FROM public.issue_1778_circle_authorized_contact(p_brand_id, p_user_id, 'email') a;
    IF v_contact IS NULL THEN RETURN 'channel_unavailable'; END IF;
    IF v_allowed IS NOT TRUE THEN RETURN COALESCE(v_reason, 'can_send_denied'); END IF;
  END IF;
  IF NOT public.can_send(p_user_id, 'brand_offering_invite', p_channel, v_contact) THEN
    RETURN 'can_send_denied';
  END IF;
  RETURN 'allowed';
END;
$fn$;

-- Email left this month for the brand: the same monthly cap Blast uses
-- (brand_messaging_effective_limits), shared with campaign email and with
-- account invite emails already queued or sent this month.
CREATE OR REPLACE FUNCTION private.issue_3682_account_invite_email_used(p_brand_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT count(*)::integer
    FROM private.brand_offering_account_invite_deliveries d
   WHERE d.brand_id = p_brand_id AND d.channel = 'email'
     AND d.state IN ('queued', 'sent')
     AND d.created_at >= date_trunc('month', timezone('utc', now()))
$fn$;

CREATE OR REPLACE FUNCTION private.issue_3682_account_invite_email_remaining(p_brand_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_cap integer; v_used integer;
BEGIN
  SELECT l.email_monthly INTO v_cap FROM public.brand_messaging_effective_limits(p_brand_id) l;
  SELECT COALESCE(SUM(e.reachable_count), 0)::integer INTO v_used
    FROM public.marketing_book_send_executions e
    JOIN public.marketing_campaigns c ON c.id = e.campaign_id
   WHERE e.brand_id = p_brand_id AND c.channel = 'email'
     AND e.confirmed_at >= date_trunc('month', timezone('utc', now()));
  v_used := v_used + private.issue_3682_account_invite_email_used(p_brand_id);
  RETURN GREATEST(COALESCE(v_cap, 1000) - v_used, 0);
END;
$fn$;

-- ── Plan response: Book-only selectedCount + accountRecipientCount ──────────
CREATE OR REPLACE FUNCTION private.issue_1780_plan_response(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
  SELECT jsonb_build_object(
    'eventId', p.event_id,
    'eventType', p.event_type,
    'selectionRevision', p.selection_revision,
    'selectedCount', count(m.brand_person_id),
    'brandPersonIds', COALESCE(
      jsonb_agg(m.brand_person_id ORDER BY m.brand_person_id)
        FILTER (WHERE m.brand_person_id IS NOT NULL), '[]'::jsonb),
    'accountRecipientCount', (SELECT count(*) FROM private.brand_offering_invite_plan_accounts a
                               WHERE a.plan_id = p.id),
    'selectionHash', p.selection_hash,
    'state', p.state,
    'publishedSelectionRevision', p.published_selection_revision,
    'updatedAt', p.updated_at
  )
  FROM private.brand_offering_invite_plans p
  LEFT JOIN private.brand_offering_invite_plan_members m ON m.plan_id = p.id
  WHERE p.event_id = p_event_id
  GROUP BY p.id, p.event_id, p.event_type, p.selection_revision, p.selection_hash,
    p.state, p.published_selection_revision, p.updated_at
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
    'selectedCount', count(m.brand_person_id),
    'brandPersonIds', COALESCE(
      jsonb_agg(m.brand_person_id ORDER BY m.brand_person_id)
        FILTER (WHERE m.brand_person_id IS NOT NULL), '[]'::jsonb),
    'accountRecipientCount', (SELECT count(*) FROM private.brand_offering_invite_plan_accounts a
                               WHERE a.plan_id = p.id),
    'selectionHash', p.selection_hash, 'state', p.state,
    'publishedSelectionRevision', p.published_selection_revision,
    'updatedAt', p.updated_at)
  INTO v_result
  FROM private.brand_offering_invite_plans p
  LEFT JOIN private.brand_offering_invite_plan_members m ON m.plan_id = p.id
  WHERE p.event_id = p_event_id
  GROUP BY p.id, p.event_id, p.event_type, p.selection_revision, p.selection_hash,
    p.state, p.published_selection_revision, p.updated_at;
  RETURN COALESCE(v_result, jsonb_build_object(
    'eventId', p_event_id, 'eventType', v_scope.event_type, 'selectionRevision', 0,
    'selectedCount', 0, 'brandPersonIds', '[]'::jsonb, 'accountRecipientCount', 0,
    'selectionHash', private.issue_1780_selection_hash('{}'::uuid[]),
    'state', 'draft', 'publishedSelectionRevision', NULL, 'updatedAt', NULL));
END;
$fn$;

-- ── Selection: the 20271231204134 body + account recipients ─────────────────
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
  -- recipients (never brand_people rows, never auto-promoted).
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
    event_id, brand_id, event_type, selection_revision, selection_hash, created_by, updated_by)
  VALUES (p_event_id, v_scope.brand_id, v_scope.event_type, p_expected_revision + 1,
    private.issue_1780_selection_hash(v_ids), v_actor, v_actor)
  ON CONFLICT (event_id) DO UPDATE SET
    selection_revision = EXCLUDED.selection_revision,
    selection_hash = EXCLUDED.selection_hash, updated_by = EXCLUDED.updated_by, updated_at = now()
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

-- ── Publish: the 20271231204134 body + sealed account recipients ────────────
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
    account_recipients)
  VALUES (p_event_id, v_plan.brand_id, v_plan.event_type, v_plan.selection_revision,
    v_ids, v_plan.selection_hash, v_plan.updated_by, v_accounts)
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

-- ── Worker claim: the 20270712001780 body + accountRecipientCount ───────────
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

-- ── Quote (wizard preview) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3682_quote_wizard_account_invites_v1(
  p_actor_id uuid, p_event_id uuid, p_selection_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_scope record; v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_total integer := 0; v_push integer := 0; v_email integer := 0; v_can integer := 0;
  v_remaining integer;
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
  v_remaining := private.issue_3682_account_invite_email_remaining(v_plan.brand_id);
  WITH decided AS MATERIALIZED (
    SELECT a.user_id,
      private.issue_3682_account_invite_channel_reason(v_plan.brand_id, a.user_id, a.ring, 'push') = 'allowed' AS push_ok,
      private.issue_3682_account_invite_channel_reason(v_plan.brand_id, a.user_id, a.ring, 'email') = 'allowed' AS email_ok
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

-- ── Dispatch: decide at send time, return the worklist ──────────────────────
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
      v_reason := CASE WHEN v_in_book THEN 'in_book'
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

CREATE OR REPLACE FUNCTION public.issue_3682_record_wizard_account_invite_v1(
  p_outbox_job_id uuid, p_lease_token uuid, p_delivery_id uuid, p_state text, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_state NOT IN ('sent', 'failed', 'skipped') OR p_reason IS NULL OR p_reason !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'wizard_invite_worker_error_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.brand_offering_invite_outbox o
                  WHERE o.id = p_outbox_job_id AND o.state = 'leased'
                    AND o.lease_token = p_lease_token AND o.lease_expires_at > now()) THEN
    RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE = 'PT409';
  END IF;
  UPDATE private.brand_offering_account_invite_deliveries SET
    state = p_state, reason = p_reason, completed_at = now(), updated_at = now()
  WHERE id = p_delivery_id AND outbox_job_id = p_outbox_job_id AND state = 'queued';
  RETURN FOUND;
END;
$fn$;

-- Completes a job that had ONLY account recipients, once none is still queued.
CREATE OR REPLACE FUNCTION public.issue_3682_complete_wizard_account_outbox_v1(
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
                  WHERE s.id = p_sealed_selection_id AND cardinality(s.brand_person_ids) = 0
                    AND jsonb_array_length(s.account_recipients) > 0)
     OR EXISTS (SELECT 1 FROM private.brand_offering_account_invite_deliveries d
                 WHERE d.outbox_job_id = v_job.id AND d.state = 'queued') THEN
    RAISE EXCEPTION 'wizard_invite_account_completion_invalid' USING ERRCODE = 'PT409';
  END IF;
  UPDATE private.brand_offering_invite_outbox SET
    state = 'succeeded', lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL,
    completed_at = now(), updated_at = now()
  WHERE id = v_job.id;
  RETURN jsonb_build_object('outboxJobId', v_job.id, 'status', 'succeeded');
END;
$fn$;

-- ── Host delivery view: names, avatars and states only ──────────────────────
CREATE OR REPLACE FUNCTION public.biz_get_offering_account_invites_v1(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
DECLARE v_scope record; v_rows jsonb; v_counts jsonb;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id, auth.uid());
  WITH per_user AS (
    SELECT d.user_id, min(d.ring) AS ring,
      max(d.state) FILTER (WHERE d.channel = 'push') AS push_state,
      max(d.state) FILTER (WHERE d.channel = 'email') AS email_state,
      bool_or(d.state = 'sent') AS reached,
      bool_or(d.state = 'queued') AS pending
    FROM private.brand_offering_account_invite_deliveries d
    WHERE d.event_id = p_event_id
    GROUP BY d.user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'displayName', COALESCE(NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        NULLIF(btrim(p.username), ''), 'Mingla guest'),
      'avatarUrl', p.avatar_url,
      'reason', u.ring,
      'push', COALESCE(u.push_state, 'skipped'),
      'email', COALESCE(u.email_state, 'skipped'))
      ORDER BY u.reached DESC, lower(COALESCE(p.display_name, p.first_name, '')), u.user_id), '[]'::jsonb),
    jsonb_build_object(
      'invited', count(*),
      'reached', count(*) FILTER (WHERE u.reached),
      'pending', count(*) FILTER (WHERE u.pending AND NOT u.reached),
      'notReached', count(*) FILTER (WHERE NOT u.reached AND NOT u.pending))
    INTO v_rows, v_counts
  FROM per_user u
  LEFT JOIN public.profiles p ON p.id = u.user_id;
  RETURN jsonb_build_object('eventId', p_event_id, 'counts', v_counts, 'recipients', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION private.issue_3682_account_invite_members(uuid, text[]),
  private.issue_3682_account_invite_channel_reason(uuid, uuid, text, text),
  private.issue_3682_account_invite_email_used(uuid),
  private.issue_3682_account_invite_email_remaining(uuid),
  private.issue_1780_plan_response(uuid),
  private.enqueue_wizard_invites_on_publish_v1(uuid, bigint, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(integer),
  public.issue_3682_quote_wizard_account_invites_v1(uuid, uuid, bigint),
  public.issue_3682_build_wizard_account_invites_v1(uuid, uuid, uuid),
  public.issue_3682_record_wizard_account_invite_v1(uuid, uuid, uuid, text, text),
  public.issue_3682_complete_wizard_account_outbox_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(integer),
  public.issue_3682_quote_wizard_account_invites_v1(uuid, uuid, bigint),
  public.issue_3682_build_wizard_account_invites_v1(uuid, uuid, uuid),
  public.issue_3682_record_wizard_account_invite_v1(uuid, uuid, uuid, text, text),
  public.issue_3682_complete_wizard_account_outbox_v1(uuid, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.biz_get_offering_invite_plan_v1(uuid),
  public.biz_replace_offering_invite_plan_v1(uuid, jsonb, bigint, uuid),
  public.biz_get_offering_account_invites_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_get_offering_invite_plan_v1(uuid),
  public.biz_replace_offering_invite_plan_v1(uuid, jsonb, bigint, uuid),
  public.biz_get_offering_account_invites_v1(uuid)
  TO authenticated, service_role;

COMMIT;
