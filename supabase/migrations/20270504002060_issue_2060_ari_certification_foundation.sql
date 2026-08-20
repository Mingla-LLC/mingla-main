-- Issue #2060 — exact-release Ari certification evidence and cleanup ledger.
--
-- This migration intentionally does NOT redefine #1985 client-turn/task state
-- or #1972 atomic operation receipts. It is additive and forward-compatible;
-- deployment waits for those two dependencies and uses the surgical migration
-- lane because the linked production history has known reverse drift.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.ari_cert_canonical_tuple_v1(
  p_kind text,
  p_values text[]
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT convert_to(
    'ARI-CERT-TUPLE-V1' || E'\n' ||
    octet_length(p_kind)::text || ':' || p_kind || E'\n' ||
    cardinality(p_values)::text ||
    CASE WHEN cardinality(p_values) = 0 THEN '' ELSE E'\n' || coalesce((
      SELECT string_agg(
        CASE WHEN value IS NULL THEN '-1:'
             ELSE octet_length(value)::text || ':' || value END,
        E'\n' ORDER BY ordinal
      )
      FROM unnest(p_values) WITH ORDINALITY AS item(value, ordinal)
    ), '') END,
    'UTF8'
  );
$function$;

CREATE OR REPLACE FUNCTION private.ari_cert_digest_v1(
  p_kind text,
  p_values text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = extensions, pg_catalog, pg_temp
AS $function$
  SELECT encode(
    extensions.digest(private.ari_cert_canonical_tuple_v1(p_kind, p_values), 'sha256'),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION private.ari_cert_native_artifacts_valid(
  p_native_artifacts jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_shape_valid boolean;
  v_surface_count integer;
BEGIN
  IF jsonb_typeof(p_native_artifacts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_native_artifacts) <> 3 THEN
    RETURN false;
  END IF;

  SELECT coalesce(bool_and(
    jsonb_typeof(item) = 'object'
    AND item ?& ARRAY['surface','artifact_id','runtime_version','device']
    AND (SELECT count(*) FROM jsonb_object_keys(item)) = 4
    AND jsonb_typeof(item -> 'surface') = 'string'
    AND jsonb_typeof(item -> 'artifact_id') = 'string'
    AND jsonb_typeof(item -> 'runtime_version') = 'string'
    AND jsonb_typeof(item -> 'device') = 'string'
    AND item ->> 'surface' IN (
      'business_ios_simulator','business_ios_physical','business_android'
    )
    AND NULLIF(btrim(item ->> 'artifact_id'), '') IS NOT NULL
    AND octet_length(item ->> 'artifact_id') <= 256
    AND NULLIF(btrim(item ->> 'runtime_version'), '') IS NOT NULL
    AND octet_length(item ->> 'runtime_version') <= 128
    AND NULLIF(btrim(item ->> 'device'), '') IS NOT NULL
    AND octet_length(item ->> 'device') <= 256
  ), false)
  INTO v_shape_valid
  FROM jsonb_array_elements(p_native_artifacts) item;

  IF NOT v_shape_valid THEN RETURN false; END IF;

  SELECT count(DISTINCT item ->> 'surface') INTO v_surface_count
  FROM jsonb_array_elements(p_native_artifacts) item;
  RETURN v_surface_count = 3;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.ari_cert_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40,64}$'),
  requirements_digest text NOT NULL CHECK (requirements_digest ~ '^[0-9a-f]{64}$'),
  function_versions jsonb NOT NULL CHECK (
    jsonb_typeof(function_versions) = 'object'
    AND NULLIF(function_versions ->> 'agent_chat', '') IS NOT NULL
    AND NULLIF(function_versions ->> 'agent_confirm_action', '') IS NOT NULL
  ),
  web_deployment_id text NOT NULL CHECK (btrim(web_deployment_id) <> ''),
  native_artifacts jsonb NOT NULL CHECK (jsonb_typeof(native_artifacts) = 'array'),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN (
    'planning', 'running', 'cleanup_required', 'failed', 'passed', 'rolled_back'
  )),
  tester_verdict text CHECK (tester_verdict IN ('PASS', 'FAIL', 'BLOCKED')),
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(baseline) = 'object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  cleanup_verified_at timestamptz,
  rollback_rehearsed_at timestamptz,
  prior_compatible_pair text,
  stranded_operation_count integer CHECK (stranded_operation_count >= 0),
  cleanup_manifest_digest text CHECK (cleanup_manifest_digest ~ '^[0-9a-f]{64}$'),
  attestation_key_id text CHECK (attestation_key_id ~ '^[a-zA-Z0-9_.:-]{1,64}$'),
  evidence_set_digest text CHECK (evidence_set_digest ~ '^[0-9a-f]{64}$'),
  artifact_set_digest text CHECK (artifact_set_digest ~ '^[0-9a-f]{64}$'),
  capability_set_digest text CHECK (capability_set_digest ~ '^[0-9a-f]{64}$'),
  native_artifact_set_digest text CHECK (native_artifact_set_digest ~ '^[0-9a-f]{64}$'),
  cleanup_digest text CHECK (cleanup_digest ~ '^[0-9a-f]{64}$'),
  rollback_digest text CHECK (rollback_digest ~ '^[0-9a-f]{64}$'),
  run_manifest_digest text CHECK (run_manifest_digest ~ '^[0-9a-f]{64}$'),
  attestation_signature text CHECK (attestation_signature ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ari_cert_runs_terminal_shape CHECK (
    status NOT IN ('passed', 'rolled_back')
    OR (
      tester_verdict = 'PASS'
      AND cleanup_verified_at IS NOT NULL
      AND rollback_rehearsed_at IS NOT NULL
      AND stranded_operation_count = 0
      AND attestation_key_id IS NOT NULL
      AND evidence_set_digest IS NOT NULL
      AND artifact_set_digest IS NOT NULL
      AND capability_set_digest IS NOT NULL
      AND native_artifact_set_digest IS NOT NULL
      AND cleanup_digest IS NOT NULL
      AND rollback_digest IS NOT NULL
      AND run_manifest_digest IS NOT NULL
      AND attestation_signature IS NOT NULL
    )
  )
);

ALTER TABLE public.ari_cert_runs
  ADD COLUMN IF NOT EXISTS attestation_key_id text CHECK (attestation_key_id ~ '^[a-zA-Z0-9_.:-]{1,64}$'),
  ADD COLUMN IF NOT EXISTS evidence_set_digest text CHECK (evidence_set_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS artifact_set_digest text CHECK (artifact_set_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS cleanup_manifest_digest text CHECK (cleanup_manifest_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS capability_set_digest text CHECK (capability_set_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS native_artifact_set_digest text CHECK (native_artifact_set_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS cleanup_digest text CHECK (cleanup_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS rollback_digest text CHECK (rollback_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS run_manifest_digest text CHECK (run_manifest_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS attestation_signature text CHECK (attestation_signature ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS public.ari_cert_capability_requirements (
  capability_id text PRIMARY KEY CHECK (capability_id ~ '^ari[.]'),
  evidence_mode text NOT NULL CHECK (evidence_mode IN ('read', 'write', 'guided_handoff', 'unsupported'))
);

INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
SELECT capability_id, 'write'
FROM unnest(ARRAY[
  'ari.brand.create','ari.brand.list','ari.brand.update','ari.brand.delete','ari.event.create','ari.event.list','ari.event.update','ari.experience.create','ari.event.publish','ari.event.unpublish','ari.event.cancel','ari.event.end_sales','ari.event.duplicate','ari.event.patch_when','ari.event.cover','ari.event.guest_privacy','ari.ticket.upsert_tier','ari.ticket.pricing_switches','ari.experience.publish','ari.experience.update','ari.experience.delete','ari.trip.create','ari.trip.update','ari.trip.publish','ari.trip.delete','ari.rsvp.create','ari.rsvp.publish','ari.rsvp.bulk_status','ari.rsvp.refund_contribution','ari.stay.quote','ari.stay.create_reservation','ari.stay.transition','ari.venue.create_reservation','ari.venue.transition_reservation','ari.venue.create_listing','ari.venue.submit_claim','ari.venue.mark_claim_feedback','ari.venue.ops','ari.venue.send_sms','ari.marketing.draft_campaign','ari.marketing.schedule_campaign','ari.marketing.send_now','ari.marketing.cancel_campaign','ari.growth.run_tool','ari.payout.status','ari.partner.status','ari.partner.disconnect','ari.tax.status_guidance','ari.order.refund','ari.order.cancel','ari.trip.cancel_booking','ari.installment.retry','ari.analytics.brand','ari.team.invite_member','ari.team.invite_scanner','ari.team.revoke_member','ari.guests.list_roster','ari.guests.set_approval','ari.people.export','ari.settings.preferences','ari.settings.notifications','ari.support.create_ticket','ari.account.delete','ari.operator.snapshot','ari.brand.hours','ari.brand.pricing_defaults','ari.event.discard_draft','ari.event.group_chat','ari.event.scan_ticket','ari.media.pick_cover','ari.trip.manage_days','ari.trip.manage_inclusions','ari.trip.manage_tiers','ari.trip.quote_builder','ari.trip.quote_to_draft','ari.intelligence.four_tools','ari.venue.intelligence','ari.stay.manage_inventory','ari.stay.publish_offering','ari.stay.manage_policy_price_media','ari.venue.manage_availability','ari.venue.manage_menu','ari.venue.manage_waitlist','ari.marketing.manage_audiences','ari.marketing.manage_templates','ari.people.list_detail_add','ari.people.import_contacts','ari.payments.stripe_kyc','ari.payments.paystack_kyc','ari.payments.read_balances_reports','ari.team.list_manage_roles','ari.team.revoke_scanner','ari.account.edit_profile_avatar','ari.account.manage_ari_history','ari.notifications.read_manage','ari.support.read_reply','ari.analytics.orders_reconciliation','ari.venue.organic_insights','ari.marketing.campaign_reports','ari.brand.audit_log','ari.brand.discovery_currency','ari.event.door_sale','ari.event.order_management','ari.event.waitlist','ari.event.scanner_admin','ari.experience.snap_generation','ari.experience.manage_stops','ari.rsvp.scan_pass','ari.rsvp.contribution_settings','ari.trip.traveler_intake','ari.installment.charge_now','ari.installment.send_reminder','ari.trip.order_money','ari.venue.gallery','ari.partner.brand_links','ari.partner.splits'
]::text[]) AS capability_id
ON CONFLICT (capability_id) DO NOTHING;

UPDATE public.ari_cert_capability_requirements SET evidence_mode = 'read'
WHERE capability_id = ANY (ARRAY['ari.brand.list','ari.event.list','ari.stay.quote','ari.payout.status','ari.partner.status','ari.analytics.brand','ari.guests.list_roster','ari.operator.snapshot','ari.trip.quote_builder','ari.intelligence.four_tools','ari.venue.intelligence']::text[])
  AND evidence_mode <> 'read';
UPDATE public.ari_cert_capability_requirements SET evidence_mode = 'guided_handoff'
WHERE capability_id = ANY (ARRAY['ari.tax.status_guidance','ari.event.scan_ticket','ari.media.pick_cover','ari.people.import_contacts','ari.payments.stripe_kyc','ari.payments.paystack_kyc','ari.rsvp.scan_pass']::text[])
  AND evidence_mode <> 'guided_handoff';
UPDATE public.ari_cert_capability_requirements SET evidence_mode = 'unsupported'
WHERE capability_id = ANY (ARRAY['ari.brand.hours','ari.brand.pricing_defaults','ari.event.discard_draft','ari.event.group_chat','ari.trip.manage_days','ari.trip.manage_inclusions','ari.trip.manage_tiers','ari.stay.manage_inventory','ari.stay.publish_offering','ari.stay.manage_policy_price_media','ari.venue.manage_availability','ari.venue.manage_menu','ari.venue.manage_waitlist','ari.marketing.manage_audiences','ari.marketing.manage_templates','ari.people.list_detail_add','ari.payments.read_balances_reports','ari.team.list_manage_roles','ari.team.revoke_scanner','ari.account.edit_profile_avatar','ari.account.manage_ari_history','ari.notifications.read_manage','ari.support.read_reply','ari.analytics.orders_reconciliation','ari.venue.organic_insights','ari.marketing.campaign_reports','ari.brand.audit_log','ari.brand.discovery_currency','ari.event.door_sale','ari.event.order_management','ari.event.waitlist','ari.event.scanner_admin','ari.experience.snap_generation','ari.experience.manage_stops','ari.rsvp.contribution_settings','ari.trip.traveler_intake','ari.installment.charge_now','ari.installment.send_reminder','ari.trip.order_money','ari.venue.gallery','ari.partner.brand_links','ari.partner.splits']::text[])
  AND evidence_mode <> 'unsupported';

CREATE TABLE IF NOT EXISTS public.ari_cert_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ari_cert_runs(id) ON DELETE RESTRICT,
  capability_id text NOT NULL CHECK (capability_id ~ '^ari[.]'),
  surface text NOT NULL CHECK (surface IN ('business_ios', 'business_android', 'business_web', 'backend')),
  tenant_case text NOT NULL CHECK (btrim(tenant_case) <> ''),
  role_case text NOT NULL CHECK (btrim(role_case) <> ''),
  scenario text NOT NULL CHECK (btrim(scenario) <> ''),
  operation_id uuid,
  request_id uuid,
  client_turn_id uuid,
  execution_id uuid,
  canonical_readback_reference text,
  artifact_type text CHECK (artifact_type IN (
    'source', 'agent_chat_bundle', 'agent_confirm_bundle', 'business_web',
    'business_ios_simulator', 'business_ios_physical', 'business_android'
  )),
  artifact_id text,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'failed', 'blocked')),
  safe_evidence jsonb NOT NULL CHECK (jsonb_typeof(safe_evidence) = 'object'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, capability_id, surface, artifact_type, tenant_case, role_case, scenario)
);

CREATE TABLE IF NOT EXISTS public.ari_cert_release_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ari_cert_runs(id) ON DELETE RESTRICT,
  artifact_type text NOT NULL CHECK (artifact_type IN (
    'source', 'agent_chat_bundle', 'agent_confirm_bundle', 'business_web',
    'business_ios_simulator', 'business_ios_physical', 'business_android'
  )),
  artifact_id text NOT NULL CHECK (btrim(artifact_id) <> ''),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40,64}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, artifact_type)
);

CREATE TABLE IF NOT EXISTS public.ari_cert_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ari_cert_runs(id) ON DELETE RESTRICT,
  owner_kind text NOT NULL CHECK (btrim(owner_kind) <> ''),
  owner_id text NOT NULL CHECK (btrim(owner_id) <> ''),
  cleanup_state text NOT NULL DEFAULT 'created' CHECK (cleanup_state IN (
    'created', 'cleanup_started', 'removed', 'residue_detected', 'cleanup_blocked'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  cleanup_started_at timestamptz,
  removed_at timestamptz,
  verification_reference text,
  UNIQUE (run_id, owner_kind, owner_id),
  CONSTRAINT ari_cert_fixtures_removed_shape CHECK (
    cleanup_state <> 'removed' OR (removed_at IS NOT NULL AND verification_reference IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ari_cert_evidence_run_capability_idx
  ON public.ari_cert_evidence(run_id, capability_id, surface);
CREATE INDEX IF NOT EXISTS ari_cert_fixtures_cleanup_idx
  ON public.ari_cert_fixtures(run_id, cleanup_state, owner_kind);

ALTER TABLE public.ari_cert_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_capability_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_capability_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_release_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_release_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ari_cert_fixtures FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ari_cert_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ari_cert_capability_requirements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ari_cert_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ari_cert_release_artifacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ari_cert_fixtures FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ari_cert_runs FROM service_role;
REVOKE ALL ON TABLE public.ari_cert_capability_requirements FROM service_role;
REVOKE ALL ON TABLE public.ari_cert_evidence FROM service_role;
REVOKE ALL ON TABLE public.ari_cert_release_artifacts FROM service_role;
REVOKE ALL ON TABLE public.ari_cert_fixtures FROM service_role;
GRANT SELECT ON TABLE public.ari_cert_runs TO service_role;
GRANT SELECT ON TABLE public.ari_cert_capability_requirements TO service_role;
GRANT SELECT ON TABLE public.ari_cert_evidence TO service_role;
GRANT SELECT ON TABLE public.ari_cert_release_artifacts TO service_role;
GRANT SELECT ON TABLE public.ari_cert_fixtures TO service_role;

CREATE OR REPLACE FUNCTION public.ari_cert_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'ari_cert_evidence_is_immutable' USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE TRIGGER ari_cert_evidence_immutable_trigger
BEFORE UPDATE OR DELETE ON public.ari_cert_evidence
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_evidence_immutable();

CREATE OR REPLACE TRIGGER ari_cert_release_artifacts_immutable_trigger
BEFORE UPDATE OR DELETE ON public.ari_cert_release_artifacts
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_evidence_immutable();

CREATE OR REPLACE TRIGGER ari_cert_capability_requirements_immutable_trigger
BEFORE UPDATE OR DELETE ON public.ari_cert_capability_requirements
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_evidence_immutable();

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS private.ari_cert_verified_provenance (
  run_id uuid NOT NULL REFERENCES public.ari_cert_runs(id) ON DELETE RESTRICT,
  capability_id text NOT NULL,
  surface text NOT NULL,
  tenant_case text NOT NULL,
  role_case text NOT NULL,
  scenario text NOT NULL,
  operation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  client_turn_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  canonical_readback_reference text NOT NULL,
  artifact_type text NOT NULL,
  artifact_id text NOT NULL,
  receipt_id uuid NOT NULL,
  readback_digest text NOT NULL CHECK (readback_digest ~ '^[0-9a-f]{64}$'),
  telemetry_event_id uuid NOT NULL,
  canonical_source text NOT NULL CHECK (btrim(canonical_source) <> ''),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    run_id, capability_id, surface, artifact_type, tenant_case, role_case,
    scenario
  )
);
REVOKE ALL ON TABLE private.ari_cert_verified_provenance
FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS private.ari_cert_finalize_authorizations (
  run_id uuid PRIMARY KEY,
  transaction_id bigint NOT NULL
);
REVOKE ALL ON TABLE private.ari_cert_finalize_authorizations
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER ari_cert_verified_provenance_immutable_trigger
BEFORE UPDATE OR DELETE ON private.ari_cert_verified_provenance
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_evidence_immutable();

CREATE OR REPLACE FUNCTION public.ari_cert_guard_terminal_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $function$
BEGIN
  IF NEW.status IN ('passed', 'rolled_back')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM private.ari_cert_finalize_authorizations
      WHERE run_id = NEW.id AND transaction_id = txid_current()
    ) THEN
      RAISE EXCEPTION 'ari_cert_terminal_status_requires_finalizer' USING ERRCODE = '55000';
    END IF;
    DELETE FROM private.ari_cert_finalize_authorizations
    WHERE run_id = NEW.id AND transaction_id = txid_current();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER ari_cert_guard_terminal_status_trigger
BEFORE UPDATE OF status ON public.ari_cert_runs
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_guard_terminal_status();

CREATE OR REPLACE FUNCTION public.ari_cert_required_scenarios(p_mode text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
  SELECT CASE p_mode
    WHEN 'read' THEN ARRAY[
      'valid_result','empty_result','not_found','malformed_args','dependency_failure',
      'outsider_denial','below_role_denial','revoked_role_denial','canonical_source_comparison'
    ]::text[]
    WHEN 'guided_handoff' THEN ARRAY[
      'accepted_wording','concrete_route','zero_side_effect','no_fake_execution'
    ]::text[]
    WHEN 'unsupported' THEN ARRAY[
      'accepted_wording','zero_side_effect','no_fake_execution'
    ]::text[]
    ELSE ARRAY[
      'proposal_zero_side_effect','edit_exact_final_args','cancel_zero_side_effect',
      'confirm_one_side_effect','duplicate_confirm_no_second_side_effect',
      'concurrent_confirm_no_second_side_effect','lost_ack_retry_no_second_side_effect',
      'canonical_readback_match','cache_owner_refresh','outsider_zero_side_effect',
      'below_role_zero_side_effect','revoked_role_zero_side_effect',
      'revoked_after_proposal_zero_side_effect','revoked_during_retry_zero_new_side_effect',
      'failure_or_unknown_is_honest'
    ]::text[]
  END;
$function$;

CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(
  p_release_sha text,
  p_function_versions jsonb,
  p_web_deployment_id text,
  p_native_artifacts jsonb,
  p_baseline jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_run_id uuid;
BEGIN
  IF p_release_sha !~ '^[0-9a-f]{40,64}$'
     OR jsonb_typeof(p_function_versions) <> 'object'
     OR NULLIF(p_function_versions ->> 'agent_chat', '') IS NULL
     OR NULLIF(p_function_versions ->> 'agent_confirm_action', '') IS NULL
     OR NULLIF(btrim(p_web_deployment_id), '') IS NULL
     OR NOT private.ari_cert_native_artifacts_valid(p_native_artifacts)
     OR jsonb_typeof(p_baseline) <> 'object' THEN
    RAISE EXCEPTION 'ari_cert_invalid_release_manifest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ari_cert_runs (
    release_sha, requirements_digest, function_versions,
    web_deployment_id, native_artifacts, baseline, status
  ) VALUES (
    p_release_sha,
    '29b71dbe5ed78fe31fe9518ab27251bcaf961b6cf48a20688a7fb6736eae90d1',
    p_function_versions, p_web_deployment_id, p_native_artifacts, p_baseline, 'running'
  ) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ari_cert_record_completion(
  p_run_id uuid,
  p_tester_verdict text,
  p_cleanup_manifest_digest text,
  p_prior_compatible_pair text,
  p_stranded_operation_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_tester_verdict NOT IN ('PASS', 'FAIL', 'BLOCKED')
     OR p_cleanup_manifest_digest !~ '^[0-9a-f]{64}$'
     OR NULLIF(btrim(p_prior_compatible_pair), '') IS NULL
     OR p_stranded_operation_count IS NULL
     OR p_stranded_operation_count < 0 THEN
    RAISE EXCEPTION 'ari_cert_invalid_completion_evidence' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ari_cert_runs
  SET tester_verdict = p_tester_verdict,
      cleanup_manifest_digest = p_cleanup_manifest_digest,
      rollback_rehearsed_at = now(),
      prior_compatible_pair = p_prior_compatible_pair,
      stranded_operation_count = p_stranded_operation_count
  WHERE id = p_run_id AND status = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ari_cert_run_not_recordable' USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ari_cert_record_release_artifact(
  p_run_id uuid,
  p_artifact_type text,
  p_artifact_id text,
  p_release_sha text,
  p_sha256 text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_expected_sha text;
BEGIN
  SELECT release_sha INTO v_expected_sha FROM public.ari_cert_runs
  WHERE id = p_run_id AND status IN ('planning', 'running') FOR UPDATE;
  IF NOT FOUND OR p_release_sha IS DISTINCT FROM v_expected_sha THEN
    RAISE EXCEPTION 'ari_cert_artifact_release_mismatch' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ari_cert_release_artifacts (
    run_id, artifact_type, artifact_id, release_sha, sha256
  ) VALUES (p_run_id, p_artifact_type, p_artifact_id, p_release_sha, p_sha256)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ari_cert_record_evidence(
  p_run_id uuid,
  p_capability_id text,
  p_surface text,
  p_tenant_case text,
  p_role_case text,
  p_scenario text,
  p_operation_id uuid,
  p_request_id uuid,
  p_client_turn_id uuid,
  p_execution_id uuid,
  p_canonical_readback_reference text,
  p_artifact_type text,
  p_artifact_id text,
  p_receipt_id uuid,
  p_readback_digest text,
  p_telemetry_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions, pg_temp
AS $function$
DECLARE
  v_mode text;
  v_safe_evidence jsonb;
  v_digest text;
BEGIN
  SELECT evidence_mode INTO v_mode
  FROM public.ari_cert_capability_requirements
  WHERE capability_id = p_capability_id;
  IF NOT FOUND
     OR NOT (p_scenario = ANY(public.ari_cert_required_scenarios(v_mode)))
     OR p_surface NOT IN ('business_ios','business_android','business_web')
     OR (p_surface = 'business_ios' AND p_artifact_type NOT IN ('business_ios_simulator','business_ios_physical'))
     OR (p_surface = 'business_android' AND p_artifact_type <> 'business_android')
     OR (p_surface = 'business_web' AND p_artifact_type <> 'business_web')
     OR p_role_case NOT IN ('owner','applicable_member','below_threshold','revoked','outsider')
     OR p_tenant_case IS DISTINCT FROM (CASE WHEN p_role_case = 'outsider' THEN 'outsider_tenant' ELSE 'owner_tenant' END)
     OR NULLIF(btrim(p_canonical_readback_reference), '') IS NULL
     OR p_operation_id IS NULL OR p_request_id IS NULL OR p_client_turn_id IS NULL
     OR p_execution_id IS NULL OR p_receipt_id IS NULL OR p_telemetry_event_id IS NULL
     OR p_readback_digest !~ '^[0-9a-f]{64}$'
     OR NOT EXISTS (
       SELECT 1 FROM public.ari_cert_release_artifacts a
       JOIN public.ari_cert_runs r ON r.id = a.run_id AND r.release_sha = a.release_sha
       WHERE a.run_id = p_run_id AND a.artifact_type = p_artifact_type AND a.artifact_id = p_artifact_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM private.ari_cert_verified_provenance p
       WHERE p.run_id = p_run_id
         AND p.capability_id = p_capability_id
         AND p.surface = p_surface
         AND p.tenant_case = p_tenant_case
         AND p.role_case = p_role_case
         AND p.scenario = p_scenario
         AND p.operation_id = p_operation_id
         AND p.request_id = p_request_id
         AND p.client_turn_id = p_client_turn_id
         AND p.execution_id = p_execution_id
         AND p.canonical_readback_reference = p_canonical_readback_reference
         AND p.artifact_type = p_artifact_type
         AND p.artifact_id = p_artifact_id
         AND p.receipt_id = p_receipt_id
         AND p.readback_digest = p_readback_digest
         AND p.telemetry_event_id = p_telemetry_event_id
     ) THEN
    RAISE EXCEPTION 'ari_cert_evidence_not_canonical' USING ERRCODE = '22023';
  END IF;
  v_safe_evidence := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'readback_digest', p_readback_digest,
    'telemetry_event_id', p_telemetry_event_id
  );
  v_digest := private.ari_cert_digest_v1('scenario-evidence', ARRAY[
    p_run_id::text,
    p_capability_id,
    p_scenario,
    p_surface,
    p_tenant_case,
    p_role_case,
    p_operation_id::text,
    p_request_id::text,
    p_client_turn_id::text,
    p_execution_id::text,
    p_artifact_type,
    p_artifact_id,
    p_canonical_readback_reference,
    'passed',
    p_receipt_id::text,
    p_readback_digest,
    p_telemetry_event_id::text
  ]);
  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    operation_id, request_id, client_turn_id, execution_id,
    canonical_readback_reference, artifact_type, artifact_id,
    outcome, safe_evidence, evidence_digest
  ) VALUES (
    p_run_id, p_capability_id, p_surface, p_tenant_case, p_role_case, p_scenario,
    p_operation_id, p_request_id, p_client_turn_id, p_execution_id,
    p_canonical_readback_reference, p_artifact_type, p_artifact_id,
    'passed', v_safe_evidence, v_digest
  );
  RETURN jsonb_build_object('run_id', p_run_id, 'capability_id', p_capability_id, 'evidence_digest', v_digest);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_run public.ari_cert_runs%ROWTYPE;
  v_capability_count integer;
  v_failed_count integer;
  v_artifact_count integer;
  v_residue_count integer;
  v_missing_matrix_count integer;
  v_unknown_count integer;
  v_invalid_digest_count integer;
  v_unverified_provenance_count integer;
  v_invalid_native_count integer;
  v_evidence_set_digest text;
  v_artifact_set_digest text;
  v_capability_set_digest text;
  v_native_artifact_set_digest text;
  v_cleanup_digest text;
  v_rollback_digest text;
  v_run_manifest_digest text;
  v_attestation_key text;
  v_attestation_key_id text;
  v_attestation_payload bytea;
  v_attestation_signature text;
BEGIN
  SELECT * INTO v_run FROM public.ari_cert_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ari_cert_run_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT count(DISTINCT capability_id), count(*) FILTER (WHERE outcome <> 'passed')
    INTO v_capability_count, v_failed_count
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;
  SELECT count(DISTINCT artifact_type) INTO v_artifact_count
  FROM public.ari_cert_release_artifacts
  WHERE run_id = p_run_id AND release_sha = v_run.release_sha;
  SELECT count(*) INTO v_residue_count FROM public.ari_cert_fixtures
  WHERE run_id = p_run_id AND cleanup_state <> 'removed';

  SELECT count(*) INTO v_unknown_count
  FROM public.ari_cert_evidence e
  LEFT JOIN public.ari_cert_capability_requirements r
    ON r.capability_id = e.capability_id
  WHERE e.run_id = p_run_id AND r.capability_id IS NULL;

  WITH expected AS (
    SELECT
      r.capability_id,
      scenario,
      target.surface,
      target.artifact_type,
      role_case,
      CASE WHEN role_case = 'outsider' THEN 'outsider_tenant' ELSE 'owner_tenant' END AS tenant_case
    FROM public.ari_cert_capability_requirements r
    CROSS JOIN LATERAL unnest(public.ari_cert_required_scenarios(r.evidence_mode)) AS scenario
    CROSS JOIN (VALUES
      ('business_ios', 'business_ios_simulator'),
      ('business_ios', 'business_ios_physical'),
      ('business_android', 'business_android'),
      ('business_web', 'business_web')
    ) AS target(surface, artifact_type)
    CROSS JOIN unnest(ARRAY['owner','applicable_member','below_threshold','revoked','outsider']::text[]) AS role_case
  )
  SELECT count(*) INTO v_missing_matrix_count
  FROM expected x
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_release_artifacts a
      ON a.run_id = e.run_id
     AND a.artifact_type = e.artifact_type
     AND a.artifact_id = e.artifact_id
     AND a.release_sha = v_run.release_sha
    WHERE e.run_id = p_run_id
      AND e.capability_id = x.capability_id
      AND e.scenario = x.scenario
      AND e.surface = x.surface
      AND e.artifact_type = x.artifact_type
      AND e.role_case = x.role_case
      AND e.tenant_case = x.tenant_case
      AND e.outcome = 'passed'
      AND e.operation_id IS NOT NULL
      AND e.request_id IS NOT NULL
      AND e.client_turn_id IS NOT NULL
      AND e.execution_id IS NOT NULL
      AND NULLIF(btrim(e.canonical_readback_reference), '') IS NOT NULL
      AND jsonb_typeof(e.safe_evidence) = 'object'
      AND e.safe_evidence ?& ARRAY['receipt_id','readback_digest','telemetry_event_id']
      AND (SELECT count(*) FROM jsonb_object_keys(e.safe_evidence)) = 3
      AND (e.safe_evidence ->> 'receipt_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'telemetry_event_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'readback_digest') ~ '^[0-9a-f]{64}$'
  );

  SELECT count(*) INTO v_invalid_digest_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND e.evidence_digest <> private.ari_cert_digest_v1('scenario-evidence', ARRAY[
      e.run_id::text,
      e.capability_id,
      e.scenario,
      e.surface,
      e.tenant_case,
      e.role_case,
      e.operation_id::text,
      e.request_id::text,
      e.client_turn_id::text,
      e.execution_id::text,
      e.artifact_type,
      e.artifact_id,
      e.canonical_readback_reference,
      e.outcome,
      e.safe_evidence ->> 'receipt_id',
      e.safe_evidence ->> 'readback_digest',
      e.safe_evidence ->> 'telemetry_event_id'
    ]);

  SELECT count(*) INTO v_unverified_provenance_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM private.ari_cert_verified_provenance p
      WHERE p.run_id = e.run_id
        AND p.capability_id = e.capability_id
        AND p.surface = e.surface
        AND p.tenant_case = e.tenant_case
        AND p.role_case = e.role_case
        AND p.scenario = e.scenario
        AND p.operation_id = e.operation_id
        AND p.request_id = e.request_id
        AND p.client_turn_id = e.client_turn_id
        AND p.execution_id = e.execution_id
        AND p.canonical_readback_reference = e.canonical_readback_reference
        AND p.artifact_type = e.artifact_type
        AND p.artifact_id = e.artifact_id
        AND p.receipt_id = (e.safe_evidence ->> 'receipt_id')::uuid
        AND p.readback_digest = e.safe_evidence ->> 'readback_digest'
        AND p.telemetry_event_id = (e.safe_evidence ->> 'telemetry_event_id')::uuid
    );

  SELECT count(*) INTO v_invalid_native_count
  FROM jsonb_array_elements(v_run.native_artifacts) item
  LEFT JOIN public.ari_cert_release_artifacts artifact
    ON artifact.run_id = p_run_id
   AND artifact.artifact_type = item ->> 'surface'
   AND artifact.artifact_id = item ->> 'artifact_id'
   AND artifact.release_sha = v_run.release_sha
  WHERE artifact.id IS NULL;

  IF NOT private.ari_cert_native_artifacts_valid(v_run.native_artifacts)
     OR v_invalid_native_count <> 0 THEN
    RAISE EXCEPTION 'ari_cert_invalid_native_artifacts' USING ERRCODE = '22023';
  END IF;
  IF v_capability_count <> 116 THEN RAISE EXCEPTION 'ari_cert_missing_capabilities:%', v_capability_count; END IF;
  IF v_run.requirements_digest <> '29b71dbe5ed78fe31fe9518ab27251bcaf961b6cf48a20688a7fb6736eae90d1' THEN
    RAISE EXCEPTION 'ari_cert_requirements_digest_mismatch';
  END IF;
  IF v_unknown_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unknown_capabilities:%', v_unknown_count; END IF;
  IF v_missing_matrix_count <> 0 THEN RAISE EXCEPTION 'ari_cert_missing_matrix_evidence:%', v_missing_matrix_count; END IF;
  IF v_invalid_digest_count <> 0 THEN RAISE EXCEPTION 'ari_cert_invalid_evidence_digest:%', v_invalid_digest_count; END IF;
  IF v_unverified_provenance_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unverified_provenance:%', v_unverified_provenance_count; END IF;
  IF v_failed_count <> 0 THEN RAISE EXCEPTION 'ari_cert_nonpassing_evidence:%', v_failed_count; END IF;
  IF v_artifact_count <> 7 THEN RAISE EXCEPTION 'ari_cert_release_artifact_mismatch:%', v_artifact_count; END IF;
  IF v_residue_count <> 0 THEN RAISE EXCEPTION 'ari_cert_fixture_residue:%', v_residue_count; END IF;
  IF v_run.tester_verdict <> 'PASS' OR v_run.cleanup_manifest_digest IS NULL
     OR v_run.rollback_rehearsed_at IS NULL
     OR NULLIF(btrim(v_run.prior_compatible_pair), '') IS NULL
     OR v_run.stranded_operation_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ari_cert_test_or_rollback_incomplete';
  END IF;

  v_attestation_key := current_setting('app.settings.ari_certification_attestation_key', true);
  v_attestation_key_id := current_setting('app.settings.ari_certification_attestation_key_id', true);
  IF length(coalesce(v_attestation_key, '')) < 32
     OR coalesce(v_attestation_key_id, '') !~ '^[a-zA-Z0-9_.:-]{1,64}$' THEN
    RAISE EXCEPTION 'ari_cert_server_attestation_not_configured';
  END IF;
  SELECT private.ari_cert_digest_v1(
    'evidence-set',
    coalesce(array_agg(
      evidence_digest ORDER BY capability_id, surface, artifact_type, scenario, role_case
    ), ARRAY[]::text[])
  )
  INTO v_evidence_set_digest
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;

  SELECT private.ari_cert_digest_v1(
    'artifact-set',
    coalesce(array_agg(private.ari_cert_digest_v1('release-artifact', ARRAY[
      artifact_type, artifact_id, release_sha, sha256
    ]) ORDER BY artifact_type), ARRAY[]::text[])
  )
  INTO v_artifact_set_digest
  FROM public.ari_cert_release_artifacts WHERE run_id = p_run_id;

  WITH per_capability AS (
    SELECT e.capability_id, private.ari_cert_digest_v1(
      'capability-evidence',
      ARRAY[
        p_run_id::text,
        e.capability_id,
        CASE r.evidence_mode
          WHEN 'guided_handoff' THEN 'guided_handoff'
          WHEN 'unsupported' THEN 'unsupported'
          ELSE 'verified'
        END,
        'business_android', 'business_ios', 'business_web'
      ] || ARRAY(
        SELECT required_scenario
        FROM unnest(public.ari_cert_required_scenarios(r.evidence_mode)) required_scenario
        ORDER BY required_scenario
      ) || ARRAY[
        CASE WHEN r.evidence_mode IN ('guided_handoff','unsupported')
          THEN NULL ELSE min(e.canonical_readback_reference) END,
        'owner|applicable_member|below_threshold|revoked|outsider'
      ] || array_agg(
        e.evidence_digest ORDER BY e.surface, e.artifact_type, e.scenario, e.role_case
      )
    ) AS capability_digest
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_capability_requirements r
      ON r.capability_id = e.capability_id
    WHERE e.run_id = p_run_id
    GROUP BY e.capability_id, r.evidence_mode
  ), flattened AS (
    SELECT capability_id, value, ordinal
    FROM per_capability
    CROSS JOIN LATERAL unnest(ARRAY[capability_id, capability_digest])
      WITH ORDINALITY AS item(value, ordinal)
  )
  SELECT private.ari_cert_digest_v1(
    'capability-set',
    array_agg(value ORDER BY capability_id, ordinal)
  )
  INTO v_capability_set_digest
  FROM flattened;

  SELECT private.ari_cert_digest_v1(
    'native-artifact-set',
    array_agg(private.ari_cert_digest_v1('native-artifact', ARRAY[
      item ->> 'surface', item ->> 'artifact_id',
      item ->> 'runtime_version', item ->> 'device'
    ]) ORDER BY item ->> 'surface')
  )
  INTO v_native_artifact_set_digest
  FROM jsonb_array_elements(v_run.native_artifacts) item;

  v_cleanup_digest := private.ari_cert_digest_v1(
    'cleanup', ARRAY['true', v_run.cleanup_manifest_digest]
  );
  v_rollback_digest := private.ari_cert_digest_v1(
    'rollback', ARRAY['true', v_run.prior_compatible_pair, v_run.stranded_operation_count::text]
  );
  v_run_manifest_digest := private.ari_cert_digest_v1('run-manifest', ARRAY[
    v_run.function_versions ->> 'agent_chat',
    v_run.function_versions ->> 'agent_confirm_action',
    v_run.web_deployment_id,
    v_run.tester_verdict,
    v_native_artifact_set_digest,
    v_capability_set_digest,
    v_cleanup_digest,
    v_rollback_digest
  ]);
  v_attestation_payload := private.ari_cert_canonical_tuple_v1('attestation', ARRAY[
    v_attestation_key_id,
    p_run_id::text,
    v_run.release_sha,
    v_run.requirements_digest,
    v_evidence_set_digest,
    v_artifact_set_digest,
    v_capability_set_digest,
    v_native_artifact_set_digest,
    v_cleanup_digest,
    v_rollback_digest,
    v_run_manifest_digest
  ]);
  v_attestation_signature := encode(extensions.hmac(
    v_attestation_payload,
    convert_to(v_attestation_key, 'UTF8'),
    'sha256'
  ), 'hex');

  INSERT INTO private.ari_cert_finalize_authorizations (run_id, transaction_id)
  VALUES (p_run_id, txid_current())
  ON CONFLICT (run_id) DO UPDATE SET transaction_id = EXCLUDED.transaction_id;

  UPDATE public.ari_cert_runs
  SET status = 'passed', cleanup_verified_at = now(), finished_at = now(),
      attestation_key_id = v_attestation_key_id,
      evidence_set_digest = v_evidence_set_digest,
      artifact_set_digest = v_artifact_set_digest,
      capability_set_digest = v_capability_set_digest,
      native_artifact_set_digest = v_native_artifact_set_digest,
      cleanup_digest = v_cleanup_digest,
      rollback_digest = v_rollback_digest,
      run_manifest_digest = v_run_manifest_digest,
      attestation_signature = v_attestation_signature
  WHERE id = p_run_id;
  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'passed',
    'capability_count', 116,
    'server_attestation', jsonb_build_object(
      'algorithm', 'HMAC-SHA256',
      'canonicalization', 'ARI-CERT-TUPLE-V1',
      'key_id', v_attestation_key_id,
      'evidence_set_digest', v_evidence_set_digest,
      'artifact_set_digest', v_artifact_set_digest,
      'capability_set_digest', v_capability_set_digest,
      'native_artifact_set_digest', v_native_artifact_set_digest,
      'cleanup_digest', v_cleanup_digest,
      'rollback_digest', v_rollback_digest,
      'run_manifest_digest', v_run_manifest_digest,
      'signature', v_attestation_signature
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_cert_evidence_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ari_cert_guard_terminal_status() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ari_cert_required_scenarios(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ari_cert_record_completion(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ari_cert_record_release_artifact(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ari_cert_record_evidence(uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, text, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ari_cert_finalize_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ari_cert_record_release_artifact(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ari_cert_record_evidence(uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, text, text, text, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ari_cert_finalize_run(uuid) TO service_role;

COMMENT ON TABLE public.ari_cert_runs IS
  'Issue #2060: exact-release certification run. A run cannot pass without independent PASS, zero residue, and rollback rehearsal.';
COMMENT ON TABLE public.ari_cert_evidence IS
  'Issue #2060: immutable row/scenario evidence keyed to one of the canonical 116 Ari capabilities.';
COMMENT ON TABLE public.ari_cert_release_artifacts IS
  'Issue #2060: immutable source/backend/web/native hash attestation for one certification run.';
COMMENT ON TABLE public.ari_cert_fixtures IS
  'Issue #2060: reverse-order cleanup ledger for every fixture or provider object created by a certification run.';
COMMENT ON TABLE private.ari_cert_verified_provenance IS
  'Issue #2060: immutable evidence admitted only after a database-owner adapter proves every referenced canonical operation, receipt, readback, and telemetry row; no client or service role can populate it.';
COMMENT ON FUNCTION public.ari_cert_finalize_run(uuid) IS
  'Issue #2060: the sole terminal-status writer; fails closed unless the canonical 116 IDs, complete scenario/surface/role matrix, server-owned digests, seven exact-release artifacts, cleanup, tester PASS, and rollback proof are complete.';

COMMIT;
