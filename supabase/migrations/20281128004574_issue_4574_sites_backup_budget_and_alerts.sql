-- #4574: new websites could not go live for hours every day.
--
-- The first publish of a NEW site needs recent recovery evidence
-- (public.brand_site_authorize_operation). The database part of that evidence
-- is the PROVIDER's own backup time (about 10:00 UTC daily), and the gate
-- allowed 26 hours from it, so it closed at about 12:00 UTC every day until the
-- delayed morning GitHub run recorded the next provider backup (12:04-17:38 UTC
-- in practice). Closed 31 of 31 days, 107.7 h in total (investigation on #4574).
--
-- Seth approved D2 + alerts on #4574 (2026-11-23):
--   1. The first-publish database-backup budget is 48 hours, defined ONCE here
--      in public.brand_site_database_backup_budget(). The gate and the new
--      alert lane both read it, so they cannot drift. With a daily provider
--      backup, one missed or late morning run no longer closes the gate.
--   2. The object-manifest budget stays 26 hours. Its stamp is the backup
--      job's own completion time (scripts/sites/backup-sites-cms.mjs
--      `object_manifest_verified_at: generatedAt`), renewed by BOTH daily runs,
--      so it does not cause the daily closure. It moves into
--      public.brand_site_object_manifest_budget() (value unchanged) so the
--      alert lane computes the same closing time as the gate.
--   3. A watch on Supabase's own scheduler (pg_cron, not GitHub's): every 15
--      minutes api-health-probe runs {"mode":"sites_recovery"} and emails the
--      existing api_health recipients at 2 h left, 0.5 h left, on expiry, and
--      on recovery, plus a heartbeat when no backup has completed in 18 h.
--
-- Unchanged on purpose:
--   * brand_site_record_readiness_evidence keeps its 26-hour WRITE-time check:
--     that rule says "the evidence being submitted is a current daily provider
--     backup", the same rule the brand-site-cms-callback edge function applies
--     in front of it (frozen by the #3381 hold) and MAX_BACKUP_AGE_MS in
--     scripts/sites/lib/sites-ops.mjs. It is not the first-publish budget.
--   * No brand-site-* edge function changes.
--
-- Release order: merge FIRST (deploys api-health-probe with the
-- sites_recovery lane), then apply this migration. As a second guard the cron
-- posts only while public.brand_site_recovery_watch_state has its row, and
-- only the new function code (or this lane) writes that row: applied early,
-- the job posts nothing, so an older deploy never runs its full vendor probe
-- every 15 minutes.
--
-- Rollback: SELECT cron.unschedule('issue_4574_sites_recovery_watch'); then
-- re-create brand_site_authorize_operation from
-- 20280119012829_issue_2829_sites_multi_brand_w1.sql (the helpers and the
-- one-row table can stay).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Drift guard: the gate must still be exactly the #2829 W1 body this file
--    patches (md5 of prosrc, read from production on 2026-11-23).
-- ---------------------------------------------------------------------------
DO $drift_guard$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid = 'public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)'::regprocedure)
     IS DISTINCT FROM '06956f65c9d27612919a982340f16681' THEN
    RAISE EXCEPTION 'issue #4574 drift: public.brand_site_authorize_operation no longer matches its #2829 W1 definition';
  END IF;
END;
$drift_guard$;

-- ---------------------------------------------------------------------------
-- 1. The budgets, defined once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_site_database_backup_budget()
RETURNS interval
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT interval '48 hours'
$function$;
COMMENT ON FUNCTION public.brand_site_database_backup_budget() IS
  '#4574: how old the provider database backup may be for a NEW site''s first publish. The one owner of this number: brand_site_authorize_operation and brand_site_recovery_watch_snapshot read it.';
REVOKE ALL ON FUNCTION public.brand_site_database_backup_budget() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_database_backup_budget() TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_object_manifest_budget()
RETURNS interval
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT interval '26 hours'
$function$;
COMMENT ON FUNCTION public.brand_site_object_manifest_budget() IS
  '#4574: how old the object manifest (stamped at backup-job completion, renewed by both daily runs) may be for a NEW site''s first publish. Read by brand_site_authorize_operation and brand_site_recovery_watch_snapshot.';
REVOKE ALL ON FUNCTION public.brand_site_object_manifest_budget() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_object_manifest_budget() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The gate. Re-emitted from 20280119012829_issue_2829_sites_multi_brand_w1.sql
--    (9.4) byte for byte except the two freshness lines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_site_authorize_operation(
  p_site_id uuid, p_operation_id uuid, p_kind text, p_arguments_digest text,
  p_expected_revision text, p_source_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_publication_id uuid;
  v_rollback_source_id uuid;
  v_rank integer;
  v_config public.brand_site_service_config%ROWTYPE;
  v_latest_source text;
  v_generated_at timestamptz;
BEGIN
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, v_actor);
  -- #2829 — publish and rollback need brand admin (rank 50); a marketing
  -- manager (20) can preview and edit drafts but never change what is live.
  IF v_actor IS NULL OR v_rank < 20
    OR (p_kind IN ('publish','rollback') AND v_rank < 50)
    OR NOT public.brand_site_entitled(v_site.brand_id) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_kind NOT IN ('preview','publish','rollback') OR
     p_arguments_digest !~ '^[0-9a-f]{64}$' OR
     p_source_digest !~ '^[0-9a-f]{64}$' OR
     length(p_expected_revision) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> p_arguments_digest OR
       v_receipt.site_id <> p_site_id OR
       v_receipt.brand_id <> v_site.brand_id OR
       v_receipt.user_id <> v_actor OR
       v_receipt.kind <> p_kind THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN COALESCE(v_receipt.result_summary, '{}'::jsonb) || jsonb_build_object(
      'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank
    );
  END IF;
  IF p_kind IN ('publish','rollback') THEN
    IF p_kind = 'publish' AND v_site.last_successful_publication_id IS NULL THEN
      -- A NEW site's first publish still needs recorded recovery evidence.
      -- #4574 — the budgets live in one place each (the helpers below).
      SELECT * INTO v_config
      FROM public.brand_site_service_config config
      WHERE config.config_key = 'sites_v1';
      SELECT receipt.evidence_source INTO v_latest_source
      FROM public.brand_site_readiness_receipts receipt
      WHERE receipt.evidence_kind IN ('nightly_backup','restore_drill')
      ORDER BY receipt.accepted_at DESC LIMIT 1;
      IF v_config.config_key IS NULL OR NOT (
        (COALESCE(v_config.backup_retention_days, 0) >= 7
          AND v_config.backup_entitlement_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at > clock_timestamp() - public.brand_site_database_backup_budget()
          AND v_config.object_manifest_verified_at IS NOT NULL
          AND v_config.object_manifest_verified_at > clock_timestamp() - public.brand_site_object_manifest_budget()
          AND v_config.restore_drill_verified_at IS NOT NULL
          AND v_config.restore_drill_verified_at > clock_timestamp() - interval '100 days'
          AND v_config.restore_drill_evidence_digest IS NOT NULL)
        OR (v_config.environment = 'local' AND v_latest_source = 'local_synthetic')
      ) THEN
        RAISE EXCEPTION 'sites_readiness_blocked';
      END IF;
    END IF;
    IF p_kind = 'rollback' THEN
      SELECT publication.id INTO STRICT v_rollback_source_id
      FROM public.brand_site_publications publication
      WHERE publication.site_id = p_site_id
        AND publication.status = 'published'
        AND publication.source_revision_id = p_expected_revision
        AND publication.source_digest = p_source_digest;
    END IF;
    v_publication_id := gen_random_uuid();
    INSERT INTO public.brand_site_publications(
      id, site_id, operation_id, source_revision_id, source_digest,
      previous_publication_id, rollback_source_publication_id, requested_by
    ) VALUES (
      v_publication_id, p_site_id, p_operation_id, p_expected_revision,
      p_source_digest, v_site.active_publication_id,
      v_rollback_source_id,
      v_actor
    ) RETURNING requested_at INTO v_generated_at;
    IF p_kind = 'publish' AND v_site.active_publication_id IS NULL THEN
      UPDATE public.brand_sites
      SET status = 'publishing', provisioning_error_code = NULL
      WHERE id = p_site_id;
    END IF;
  END IF;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, p_kind,
    p_arguments_digest, 'authorized', jsonb_build_object(
      'site_id', p_site_id, 'status', 'authorized',
      'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank,
      'revision_id', p_expected_revision,
      'publication_id', v_publication_id,
      'generated_at', v_generated_at,
      'rollback_source_publication_id', v_rollback_source_id
    )
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user',
    CASE WHEN p_kind = 'rollback' THEN 'publication.rollback_requested'
         WHEN p_kind = 'preview' THEN 'preview.requested'
         ELSE 'publication.requested' END,
    p_kind, COALESCE(v_publication_id::text, p_expected_revision), p_operation_id,
    jsonb_build_object('status', 'authorized')
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'status', 'authorized',
    'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank,
    'revision_id', p_expected_revision, 'publication_id', v_publication_id,
    'generated_at', v_generated_at,
    'rollback_source_publication_id', v_rollback_source_id
  );
END;
$function$;
-- CREATE OR REPLACE keeps the existing grants (authenticated, service_role).

-- ---------------------------------------------------------------------------
-- 3. Watch state: one row, service_role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_site_recovery_watch_state (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  level              text CHECK (level IN ('ok','watch','warn','critical','expired','unproven')),
  incident_closes_at timestamptz,
  last_sent_level    text CHECK (last_sent_level IN ('warn','critical','expired','recovered')),
  last_sent_at       timestamptz,
  heartbeat_for      timestamptz,
  unproven_sent_at   timestamptz,
  last_checked_at    timestamptz
);
ALTER TABLE public.brand_site_recovery_watch_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_recovery_watch_state FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.brand_site_recovery_watch_state IS
  '#4574: one row. What the Sites recovery watch last saw and which alert it last sent for which closing time, so each level emails once per incident.';

-- ---------------------------------------------------------------------------
-- 4. Snapshot: when the first-publish gate closes, from the same helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_site_recovery_watch_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'config_present', config.config_key IS NOT NULL,
    'gate_budget_h', extract(epoch FROM public.brand_site_database_backup_budget()) / 3600,
    'manifest_budget_h', extract(epoch FROM public.brand_site_object_manifest_budget()) / 3600,
    'database_backup_verified_at', config.database_backup_verified_at,
    'object_manifest_verified_at', config.object_manifest_verified_at,
    'closes_at', LEAST(
      config.database_backup_verified_at + public.brand_site_database_backup_budget(),
      config.object_manifest_verified_at + public.brand_site_object_manifest_budget()),
    'last_completion_at', (
      SELECT max(receipt.accepted_at) FROM public.brand_site_readiness_receipts receipt
      WHERE receipt.evidence_kind = 'nightly_backup'),
    'state', (SELECT to_jsonb(state) - 'id' FROM public.brand_site_recovery_watch_state state),
    'at', clock_timestamp())
  FROM (SELECT 1) one
  LEFT JOIN public.brand_site_service_config config ON config.config_key = 'sites_v1'
$function$;
COMMENT ON FUNCTION public.brand_site_recovery_watch_snapshot() IS
  '#4574: the Sites recovery watch input: when a new site''s first publish stops being allowed (closes_at, from the gate''s own budget helpers), the newest completed backup, and the stored watch state. service_role only.';
REVOKE ALL ON FUNCTION public.brand_site_recovery_watch_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_recovery_watch_snapshot() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Record: one call per check. p_sent_level / p_heartbeat_for /
--    p_unproven_sent are set only when that email was actually delivered.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_site_recovery_watch_record(
  p_level text,
  p_incident_closes_at timestamptz,
  p_sent_level text,
  p_heartbeat_for timestamptz,
  p_unproven_sent boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE r public.brand_site_recovery_watch_state;
BEGIN
  IF p_level IS NULL OR p_level NOT IN ('ok','watch','warn','critical','expired','unproven')
    OR (p_sent_level IS NOT NULL AND p_sent_level NOT IN ('warn','critical','expired','recovered')) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  INSERT INTO public.brand_site_recovery_watch_state AS s (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.brand_site_recovery_watch_state AS s SET
    level = p_level,
    last_checked_at = clock_timestamp(),
    incident_closes_at = CASE WHEN p_sent_level IS NOT NULL THEN p_incident_closes_at ELSE s.incident_closes_at END,
    last_sent_level = COALESCE(p_sent_level, s.last_sent_level),
    last_sent_at = CASE WHEN p_sent_level IS NOT NULL THEN clock_timestamp() ELSE s.last_sent_at END,
    heartbeat_for = COALESCE(p_heartbeat_for, s.heartbeat_for),
    unproven_sent_at = CASE WHEN COALESCE(p_unproven_sent, false) THEN clock_timestamp() ELSE s.unproven_sent_at END
  WHERE s.id
  RETURNING * INTO r;
  RETURN to_jsonb(r) - 'id';
END;
$function$;
COMMENT ON FUNCTION public.brand_site_recovery_watch_record(text, timestamptz, text, timestamptz, boolean) IS
  '#4574: record one Sites recovery watch check and any alert it delivered. service_role only.';
REVOKE ALL ON FUNCTION public.brand_site_recovery_watch_record(text, timestamptz, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_recovery_watch_record(text, timestamptz, text, timestamptz, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 5b. Claim before send (#4574 rework). Two overlapping runs (a manual call
--     during a tick) must not both email, and an unreadable snapshot must not
--     email every 15 minutes. The probe claims each email here BEFORE sending:
--     the row lock serialises concurrent claims, the second sees the first's
--     write and is refused. A send that reaches nobody releases its claim.
--       warn/critical/expired: once per closing time, escalation always sends;
--       recovered: only after a warn/critical/expired was claimed;
--       heartbeat: once per last completion time;
--       unproven: at most once per 2 hours (the one owner of that cadence).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_site_recovery_watch_claim(
  p_kind text,
  p_closes_at timestamptz,
  p_heartbeat_for timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_old public.brand_site_recovery_watch_state;
  v_rank_old integer;
  v_rank_new integer;
  v_ok boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('warn','critical','expired','recovered','heartbeat','unproven')
    OR (p_kind IN ('warn','critical','expired','recovered') AND p_closes_at IS NULL)
    OR (p_kind = 'heartbeat' AND p_heartbeat_for IS NULL) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  INSERT INTO public.brand_site_recovery_watch_state (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO STRICT v_old FROM public.brand_site_recovery_watch_state WHERE id FOR UPDATE;

  IF p_kind IN ('warn','critical','expired') THEN
    v_rank_new := CASE p_kind WHEN 'warn' THEN 1 WHEN 'critical' THEN 2 ELSE 3 END;
    v_rank_old := CASE v_old.last_sent_level WHEN 'warn' THEN 1 WHEN 'critical' THEN 2 WHEN 'expired' THEN 3 ELSE 0 END;
    v_ok := NOT (v_old.incident_closes_at IS NOT DISTINCT FROM p_closes_at AND v_rank_old >= v_rank_new);
    IF v_ok THEN
      UPDATE public.brand_site_recovery_watch_state SET
        last_sent_level = p_kind, incident_closes_at = p_closes_at, last_sent_at = clock_timestamp()
      WHERE id;
    END IF;
  ELSIF p_kind = 'recovered' THEN
    v_ok := v_old.last_sent_level IN ('warn','critical','expired');
    IF v_ok THEN
      UPDATE public.brand_site_recovery_watch_state SET
        last_sent_level = 'recovered', incident_closes_at = p_closes_at, last_sent_at = clock_timestamp()
      WHERE id;
    END IF;
  ELSIF p_kind = 'heartbeat' THEN
    v_ok := v_old.heartbeat_for IS DISTINCT FROM p_heartbeat_for;
    IF v_ok THEN
      UPDATE public.brand_site_recovery_watch_state SET heartbeat_for = p_heartbeat_for WHERE id;
    END IF;
  ELSE
    v_ok := v_old.unproven_sent_at IS NULL
      OR v_old.unproven_sent_at <= clock_timestamp() - interval '2 hours';
    IF v_ok THEN
      UPDATE public.brand_site_recovery_watch_state SET unproven_sent_at = v_now WHERE id;
    END IF;
  END IF;
  -- prior.claim_written_at lets the release of an unproven claim restore only
  -- the value THIS claim wrote (#4574 retest P3-A).
  RETURN jsonb_build_object('claimed', v_ok,
    'prior', (to_jsonb(v_old) - 'id') || jsonb_build_object('claim_written_at', CASE WHEN v_ok AND p_kind = 'unproven' THEN v_now END));
END;
$function$;
COMMENT ON FUNCTION public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz) IS
  '#4574: atomically claim one Sites recovery email before it is sent (row lock; the second of two concurrent claims is refused). service_role only.';
REVOKE ALL ON FUNCTION public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz) TO service_role;

-- Undo one claim whose email reached nobody, so the next check retries. Only
-- the fields that claim wrote are restored, and only while they still hold
-- what that claim wrote.
CREATE OR REPLACE FUNCTION public.brand_site_recovery_watch_release(
  p_kind text,
  p_closes_at timestamptz,
  p_heartbeat_for timestamptz,
  p_prior jsonb
) RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('warn','critical','expired','recovered','heartbeat','unproven')
    OR p_prior IS NULL OR jsonb_typeof(p_prior) <> 'object' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF p_kind IN ('warn','critical','expired','recovered') THEN
    UPDATE public.brand_site_recovery_watch_state SET
      last_sent_level = p_prior->>'last_sent_level',
      incident_closes_at = (p_prior->>'incident_closes_at')::timestamptz,
      last_sent_at = (p_prior->>'last_sent_at')::timestamptz
    WHERE id AND last_sent_level = p_kind AND incident_closes_at = p_closes_at;
  ELSIF p_kind = 'heartbeat' THEN
    UPDATE public.brand_site_recovery_watch_state SET
      heartbeat_for = (p_prior->>'heartbeat_for')::timestamptz
    WHERE id AND heartbeat_for = p_heartbeat_for;
  ELSE
    UPDATE public.brand_site_recovery_watch_state SET
      unproven_sent_at = (p_prior->>'unproven_sent_at')::timestamptz
    WHERE id AND unproven_sent_at = (p_prior->>'claim_written_at')::timestamptz;
  END IF;
END;
$function$;
COMMENT ON FUNCTION public.brand_site_recovery_watch_release(text, timestamptz, timestamptz, jsonb) IS
  '#4574: release a Sites recovery email claim whose send reached nobody. service_role only.';
REVOKE ALL ON FUNCTION public.brand_site_recovery_watch_release(text, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_recovery_watch_release(text, timestamptz, timestamptz, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Every 15 minutes on Supabase's scheduler (minute offset 4 keeps it off
--    the hourly vendor tick at :00 and the 5-minute db check at :02).
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'issue_4574_sites_recovery_watch',
  '4-59/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/api-health-probe',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'content-type', 'application/json'
    ),
    body := '{"mode":"sites_recovery"}'::jsonb,
    timeout_milliseconds := 30000
  )
  WHERE EXISTS (SELECT 1 FROM public.brand_site_recovery_watch_state)
  $cron$
);

COMMIT;
