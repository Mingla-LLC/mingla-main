\set ON_ERROR_STOP on

-- #1973 round-2 implementor happy proof: this is intentionally distinct from
-- the tester-owned immutable-receipt attack. It executes the authorized Snap
-- proposal boundary, both timezone contracts, and the safe unpublish path.
BEGIN;

-- Latest-main certification integration: #1973 registered capability 117.
-- [TEST-MOD-APPROVED #2830] The twelve approved Website tools bring the
-- certification requirement set to 132; this still isolates the one missing
-- #1973 unpublish capability at 131 rows.
-- Reject an incomplete evidence set that omits ari.experience.unpublish.
DO $certification$
DECLARE
  v_run_id uuid;
  v_error text;
BEGIN
  IF (SELECT count(*) FROM public.ari_cert_capability_requirements) <> 132 THEN
    RAISE EXCEPTION '#1973/#2830 expected exactly 132 certification requirements';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.experience.unpublish' AND evidence_mode = 'write'
  ) THEN
    RAISE EXCEPTION '#1973 unpublish certification requirement missing';
  END IF;

  INSERT INTO public.ari_cert_runs (
    release_sha, requirements_digest, function_versions, web_deployment_id,
    native_artifacts, status, tester_verdict, rollback_rehearsed_at,
    prior_compatible_pair, stranded_operation_count
  ) VALUES (
    repeat('7', 40),
    '0de714ca5cf4f3a78dea892dabaadde8c22d09407d939ec366a239b6d63953ad',
    '{"agent_chat":"v1973","agent_confirm_action":"v1973"}'::jsonb,
    'business-web-1973',
    '[
      {"surface":"business_ios_simulator","artifact_id":"ios-sim-1973","runtime_version":"1.1.3","device":"iPhone simulator"},
      {"surface":"business_ios_physical","artifact_id":"ios-device-1973","runtime_version":"1.1.3","device":"Physical iPhone"},
      {"surface":"business_android","artifact_id":"android-1973","runtime_version":"1.1.3","device":"Pixel 7"}
    ]'::jsonb,
    'running', 'PASS', now(), 'v1972+v1973', 0
  ) RETURNING id INTO v_run_id;

  INSERT INTO public.ari_cert_release_artifacts (
    run_id, artifact_type, artifact_id, release_sha, sha256
  ) VALUES
    (v_run_id, 'business_ios_simulator', 'ios-sim-1973', repeat('7', 40), repeat('8', 64)),
    (v_run_id, 'business_ios_physical', 'ios-device-1973', repeat('7', 40), repeat('8', 64)),
    (v_run_id, 'business_android', 'android-1973', repeat('7', 40), repeat('8', 64));

  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    outcome, safe_evidence, evidence_digest
  )
  SELECT v_run_id, capability_id, 'backend', 'owner_tenant', 'owner',
         'confirm_one_side_effect', 'passed', '{}'::jsonb, repeat('9', 64)
  FROM public.ari_cert_capability_requirements
  WHERE capability_id <> 'ari.experience.unpublish';

  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
    RAISE EXCEPTION '#1973/#2830 finalizer accepted incomplete evidence missing unpublish';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'ari_cert_missing_capabilities:131' THEN
      RAISE EXCEPTION '#1973/#2830 expected 131-row rejection, received %', v_error;
    END IF;
  END;
END;
$certification$;

INSERT INTO auth.users(id,email) VALUES
  ('19730000-0000-4000-8000-000000000301','issue1973-r2-owner@example.com'),
  ('19730000-0000-4000-8000-000000000302','issue1973-r2-manager@example.com'),
  ('19730000-0000-4000-8000-000000000303','issue1973-r2-outsider@example.com');

INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('19730000-0000-4000-8000-000000000301','issue1973-r2-owner@example.com','Issue 1973 r2 owner'),
  ('19730000-0000-4000-8000-000000000302','issue1973-r2-manager@example.com','Issue 1973 r2 manager'),
  ('19730000-0000-4000-8000-000000000303','issue1973-r2-outsider@example.com','Issue 1973 r2 outsider');

INSERT INTO public.brands(
  id,account_id,name,slug,kind,has_physical_location,default_currency
)
VALUES (
  '19730000-0000-4000-8000-000000000304',
  '19730000-0000-4000-8000-000000000301',
  'Issue 1973 Round Two',
  'issue-1973-round-two',
  'physical',
  true,
  'USD'
);

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES (
  '19730000-0000-4000-8000-000000000304',
  '19730000-0000-4000-8000-000000000302',
  'event_manager',
  now()
);

DO $$
BEGIN
  IF has_table_privilege('authenticated','public.agent_pending_actions','INSERT') THEN
    RAISE EXCEPTION '#1973 r2 authenticated unexpectedly has direct pending INSERT';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000302',true);
SET LOCAL ROLE authenticated;

SELECT public.issue_1973_create_snap_proposals(
  '19730000-0000-4000-8000-000000000304',
  '[
    {"brand_id":"19730000-0000-4000-8000-000000000304","title":"Snap proposal one","narrative":"First proposal"},
    {"brand_id":"19730000-0000-4000-8000-000000000304","title":"Snap proposal two","narrative":"Second proposal"}
  ]'::jsonb
);

SELECT public.business_create_experience_graph(
  '19730000-0000-4000-8000-000000000304',
  '{"title":"Unknown timezone draft","description":"Timezone intentionally unknown","currency":"USD","is_free":true}'::jsonb
);

SELECT public.business_create_experience_graph(
  '19730000-0000-4000-8000-000000000304',
  '{"title":"Known timezone draft","description":"Timezone supplied explicitly","currency":"USD","is_free":true,"timezone":"America/New_York"}'::jsonb
);

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.agent_pending_actions
      WHERE user_id='19730000-0000-4000-8000-000000000302'
        AND related_brand_id='19730000-0000-4000-8000-000000000304'
        AND source='hub_experience' AND status='pending') <> 2 THEN
    RAISE EXCEPTION '#1973 r2 server proposal batch was not atomic and caller-bound';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE user_id='19730000-0000-4000-8000-000000000302'
      AND (server_proposed_at IS NULL OR expires_at <= server_proposed_at)
  ) THEN
    RAISE EXCEPTION '#1973 r2 server did not own proposal timestamps';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.events
    WHERE title='Unknown timezone draft'
      AND (timezone IS NOT NULL OR theme#>>'{experience_meta,when_draft,timezone}' IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '#1973 r2 omitted timezone was fabricated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE title='Known timezone draft'
      AND timezone='America/New_York'
      AND theme#>>'{experience_meta,when_draft,timezone}'='America/New_York'
  ) THEN
    RAISE EXCEPTION '#1973 r2 explicit IANA timezone did not round-trip';
  END IF;
END;
$$;

-- An unrelated authenticated caller cannot use the server boundary.
SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000303',true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.issue_1973_create_snap_proposals(
    '19730000-0000-4000-8000-000000000304',
    '[{"brand_id":"19730000-0000-4000-8000-000000000304","title":"Must not persist"}]'::jsonb
  );
  RAISE EXCEPTION '#1973 r2 outsider unexpectedly created a proposal';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%insufficient_event_permission%' THEN RAISE; END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title='Known timezone draft';
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES (
    v_event_id,
    now()+interval '30 days',
    now()+interval '30 days 2 hours',
    'America/New_York',
    true
  );
  UPDATE public.events
  SET status='scheduled',visibility='public',published_at=now(),
      show_on_discover=true,show_in_swipeable_deck=true
  WHERE id=v_event_id;
END;
$$;

SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000302',true);
SET LOCAL ROLE authenticated;
SELECT public.business_unpublish_experience_to_draft(
  (SELECT id FROM public.events WHERE title='Known timezone draft'),
  NULL
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.title='Known timezone draft'
      AND e.status='draft' AND e.visibility='draft'
      AND e.published_at IS NULL
      AND e.show_on_discover=false
      AND e.show_in_swipeable_deck=false
      AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id=e.id)
  ) THEN
    RAISE EXCEPTION '#1973 r2 safe unpublish did not clear every public exposure';
  END IF;
END;
$$;

ROLLBACK;
