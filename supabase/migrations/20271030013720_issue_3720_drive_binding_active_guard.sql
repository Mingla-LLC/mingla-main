-- #3720 Completion Wave 3 release repair — deleted brands never enter Drive provisioning.
--
-- The Wave 3 provisioner deliberately retries failed active bindings, but the
-- original claim query did not join back to brands. A deleted brand begins in
-- the same `failed` state and would therefore become retryable after two
-- minutes. Keep those terminal rows explicit, narrow every claim to an active
-- brand, and only then restore the reviewed minute worker.

BEGIN;

DO $guard$
DECLARE v_before text;
BEGIN
  SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure) INTO v_before;
  PERFORM set_config('issue_3720.is_admin_user_before', md5(v_before), true);
END;
$guard$;

UPDATE public.brand_group_drive_bindings binding
SET state='failed',
    lease_expires_at=NULL,
    last_error_code='BRAND_REMOVED',
    updated_at=now()
FROM public.brands brand
WHERE brand.id=binding.brand_id
  AND brand.deleted_at IS NOT NULL
  AND (
    binding.state<>'failed'
    OR binding.lease_expires_at IS NOT NULL
    OR binding.last_error_code IS DISTINCT FROM 'BRAND_REMOVED'
  );

CREATE OR REPLACE FUNCTION public.issue_3720_claim_drive_binding()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_row public.brand_group_drive_bindings%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT binding.* INTO v_row
  FROM public.brand_group_drive_bindings binding
  JOIN public.brands brand
    ON brand.id=binding.brand_id
   AND brand.deleted_at IS NULL
  WHERE (
    binding.state='pending'
    OR (binding.state='failed' AND binding.attempt_count<8 AND binding.updated_at<now()-interval '2 minutes')
    OR (binding.state='provisioning' AND binding.lease_expires_at<now())
  )
  ORDER BY CASE binding.state WHEN 'pending' THEN 0 WHEN 'provisioning' THEN 1 ELSE 2 END,
    binding.updated_at,binding.conversation_id
  FOR UPDATE OF binding SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.brand_group_drive_bindings SET
    state='provisioning',attempt_count=attempt_count+1,lease_expires_at=now()+interval '5 minutes',
    last_error_code=NULL,updated_at=now()
  WHERE conversation_id=v_row.conversation_id;
  RETURN jsonb_build_object(
    'conversation_id',v_row.conversation_id,'brand_id',v_row.brand_id,
    'canonical_host_folder_name',v_row.canonical_host_folder_name,
    'host_folder_id',v_row.host_folder_id,'media_packet_folder_id',v_row.media_packet_folder_id,
    'host_uploads_folder_id',v_row.host_uploads_folder_id,'staff_sharing_folder_id',v_row.staff_sharing_folder_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_claim_drive_binding() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_claim_drive_binding() TO service_role;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#3720: pg_cron/pg_net unavailable; Drive binding provisioner not scheduled';
    RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url')
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE '#3720: runtime vault rows unavailable; Drive binding provisioner not scheduled';
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='issue_3720_brand_group_drive_provision') THEN
    PERFORM cron.unschedule('issue_3720_brand_group_drive_provision');
  END IF;
  PERFORM cron.schedule(
    'issue_3720_brand_group_drive_provision','* * * * *',
    $job$SELECT net.http_post(
      url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/brand-group-files',
      headers:=jsonb_build_object(
        'content-type','application/json',
        'authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)
      ),
      body:='{"action":"provision_pending"}'::jsonb,
      timeout_milliseconds:=25000
    )$job$
  );
END;
$cron$;

DO $guard$
DECLARE v_after text;v_before_md5 text:=current_setting('issue_3720.is_admin_user_before',true);
BEGIN
  SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure) INTO v_after;
  IF v_before_md5 IS NULL OR md5(v_after)<>v_before_md5 THEN RAISE EXCEPTION 'is_admin_user_changed'; END IF;
END;
$guard$;

COMMIT;
