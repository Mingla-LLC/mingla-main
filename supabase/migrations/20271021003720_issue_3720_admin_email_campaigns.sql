-- #3720 — durable admin email campaigns, recipient delivery ledger, scheduling,
-- and the dedicated composer asset bucket.
--
-- The Admin composer may target every eligible profile. There is deliberately
-- no product-level daily or campaign-size ceiling: work is snapshotted into a
-- recipient ledger and drained in bounded, retryable batches instead.

BEGIN;

DO $block$
BEGIN
  IF to_regnamespace('cron') IS NULL
     OR to_regnamespace('net') IS NULL
     OR to_regnamespace('vault') IS NULL THEN
    RAISE EXCEPTION 'issue_3720_admin_email_campaign_dependencies_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'issue-3720 advisory: vault secret "supabase_url" is missing; the Admin email drain is registered but cannot call its Edge function yet.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'issue-3720 advisory: vault secret "service_role_key" is missing; the Admin email drain is registered but cannot authenticate yet.';
  END IF;
END;
$block$;

ALTER TABLE public.admin_email_log
  DROP CONSTRAINT IF EXISTS admin_email_log_status_check;

ALTER TABLE public.admin_email_log
  ADD COLUMN IF NOT EXISTS body_document jsonb,
  ADD COLUMN IF NOT EXISTS audience jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_contact_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.admin_email_log
  ADD CONSTRAINT admin_email_log_status_check
  CHECK (status IN (
    'pending', 'draft', 'scheduled', 'queued', 'sending', 'sent', 'completed', 'partial', 'failed', 'cancelled'
  ));

COMMENT ON COLUMN public.admin_email_log.body_document IS
  '#3720 validated structured document used by Admin composer; arbitrary HTML is not accepted.';
COMMENT ON COLUMN public.admin_email_log.audience IS
  '#3720 audience mode and AND-combined filter snapshot shown in campaign history.';
COMMENT ON COLUMN public.admin_email_log.scheduled_for IS
  '#3720 UTC instant selected by the admin; null means send as soon as queued.';
COMMENT ON COLUMN public.admin_email_log.sent_count IS
  '#3720 legacy column name: for durable campaigns this counts provider-accepted messages, never proven delivery.';

CREATE TABLE IF NOT EXISTS public.admin_email_recipient_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.admin_email_log(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  personalization jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'retrying', 'accepted', 'failed', 'skipped_opt_out')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_admin_email_delivery_claim
  ON public.admin_email_recipient_deliveries (campaign_id, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_email_log_due
  ON public.admin_email_log (status, scheduled_for, created_at);

ALTER TABLE public.admin_email_recipient_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_read_email_deliveries ON public.admin_email_recipient_deliveries;
CREATE POLICY admin_read_email_deliveries
  ON public.admin_email_recipient_deliveries
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

REVOKE ALL ON public.admin_email_recipient_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_email_recipient_deliveries TO authenticated;
GRANT ALL ON public.admin_email_recipient_deliveries TO service_role;

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS body_document jsonb;

-- Production's Supabase-managed buckets table carries the visibility, size,
-- and MIME columns below. The migration replay image intentionally exposes a
-- minimal id/name shape, so keep the bucket declaration portable while still
-- applying every restriction in production.
DO $bucket$
DECLARE
  has_public boolean;
  has_file_size_limit boolean;
  has_allowed_mime_types boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public'
  ) INTO has_public;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit'
  ) INTO has_file_size_limit;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) INTO has_allowed_mime_types;

  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'admin-email-assets',
      'admin-email-assets',
      true,
      5242880,
      ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('admin-email-assets', 'admin-email-assets', true)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name)
    VALUES ('admin-email-assets', 'admin-email-assets')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  END IF;
END
$bucket$;

DROP POLICY IF EXISTS admin_email_assets_public_read ON storage.objects;
CREATE POLICY admin_email_assets_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'admin-email-assets');

DROP POLICY IF EXISTS admin_email_assets_admin_insert ON storage.objects;
CREATE POLICY admin_email_assets_admin_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'admin-email-assets' AND public.is_admin_user());

DROP POLICY IF EXISTS admin_email_assets_admin_update ON storage.objects;
CREATE POLICY admin_email_assets_admin_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'admin-email-assets' AND public.is_admin_user())
  WITH CHECK (bucket_id = 'admin-email-assets' AND public.is_admin_user());

DROP POLICY IF EXISTS admin_email_assets_admin_delete ON storage.objects;
CREATE POLICY admin_email_assets_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'admin-email-assets' AND public.is_admin_user());

CREATE OR REPLACE FUNCTION public.claim_due_admin_email_campaign()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  UPDATE public.admin_email_log AS campaign
     SET status = 'sending',
         started_at = COALESCE(campaign.started_at, now()),
         processing_started_at = now()
   WHERE campaign.id = (
     SELECT candidate.id
       FROM public.admin_email_log AS candidate
      WHERE (
        candidate.status IN ('queued', 'scheduled')
        AND COALESCE(candidate.scheduled_for, now()) <= now()
      ) OR (
        candidate.status = 'sending'
        AND candidate.processing_started_at < now() - interval '10 minutes'
      )
      ORDER BY COALESCE(candidate.scheduled_for, candidate.created_at), candidate.created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
  RETURNING campaign.id INTO claimed_id;

  RETURN claimed_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_admin_email_delivery_batch(
  p_campaign_id uuid,
  p_limit integer DEFAULT 40
)
RETURNS SETOF public.admin_email_recipient_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.admin_email_recipient_deliveries AS delivery
     SET status = 'sending',
         attempts = CASE
           WHEN delivery.status = 'sending' THEN delivery.attempts
           ELSE delivery.attempts + 1
         END,
         last_attempt_at = now(),
         updated_at = now()
   WHERE delivery.id IN (
     SELECT candidate.id
       FROM public.admin_email_recipient_deliveries AS candidate
      WHERE candidate.campaign_id = p_campaign_id
        AND candidate.next_attempt_at <= now()
        AND (
          (candidate.status IN ('pending', 'retrying') AND candidate.attempts < 3)
          OR (
            candidate.status = 'sending'
            AND candidate.last_attempt_at < now() - interval '10 minutes'
          )
        )
      ORDER BY candidate.created_at
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING delivery.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_admin_email_campaign() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_admin_email_delivery_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_admin_email_campaign() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_admin_email_delivery_batch(uuid, integer) TO service_role;

SELECT cron.unschedule('issue_3720_admin_email_campaign_drain')
 WHERE EXISTS (
   SELECT 1 FROM cron.job WHERE jobname = 'issue_3720_admin_email_campaign_drain'
 );

SELECT cron.schedule(
  'issue_3720_admin_email_campaign_drain',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
        || '/functions/v1/admin-send-email',
      headers := jsonb_build_object(
        'authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),
        'content-type','application/json'
      ),
      body := '{"action":"process_due"}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

COMMIT;
