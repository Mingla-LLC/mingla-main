-- Issue #2510 — organisers can finally see whether a campaign worked.
--
-- Until now there was NO open rate anywhere in Mingla, and both surfaces
-- reported a "Delivered" figure they had not earned:
--
--   * marketingOverviewService counted `status IN ('delivered','clicked')` —
--     but nothing ever wrote `delivered`, so that tile was just the click
--     count wearing a Delivered label. The We Go Again organiser was shown
--     "DELIVERED 3 (1.5%)" for a campaign where 189 emails were accepted.
--   * The campaign report labelled the ACCEPTED count "Delivered", which
--     `docs/INVARIANT_REGISTRY.md:401` already forbids in as many words:
--     a provider message id is "never delivery/read/response truth".
--
-- Bounces and spam complaints were invisible too, so a dead or hostile
-- address stayed on the list forever — the quiet way a sending domain dies.
--
-- Resend has always been willing to tell us. Nothing was listening.
--   https://resend.com/docs/dashboard/webhooks/event-types

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns the event stream needs.
-- ---------------------------------------------------------------------------
-- `delivered_at` / `opened_at` / `last_clicked_at` / `click_count` already
-- exist (ORCH-0815 Phase A) and were simply never written for email.
ALTER TABLE public.marketing_messages
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS complained_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_kind text;

-- `complained` is a real terminal outcome and needs to be sayable.
ALTER TABLE public.marketing_messages
  DROP CONSTRAINT IF EXISTS marketing_messages_status_check;
ALTER TABLE public.marketing_messages
  ADD CONSTRAINT marketing_messages_status_check CHECK (status = ANY (ARRAY[
    'queued','sent','delivered','opened','clicked','bounced','failed',
    'unsubscribed','preview_skipped','deferred','complained'
  ]));

-- ---------------------------------------------------------------------------
-- 2. Idempotent inbox. Resend RETRIES on any non-2xx.
-- ---------------------------------------------------------------------------
-- Keyed on the Svix message id, which is stable across retries of the SAME
-- event. Without this, one retried `email.opened` would count twice and the
-- open rate would drift upward forever — a metric that only ever inflates is
-- worse than no metric, because it looks like it is working.
CREATE TABLE IF NOT EXISTS public.marketing_email_events (
  svix_id text PRIMARY KEY,
  event_type text NOT NULL,
  provider_message_id text,
  message_id uuid REFERENCES public.marketing_messages(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_2510_email_events_by_message
  ON public.marketing_email_events (message_id, event_type);

ALTER TABLE public.marketing_email_events ENABLE ROW LEVEL SECURITY;
-- Supabase grants `anon` and `authenticated` full DML on new public tables by
-- default. RLS-with-no-policy already denies reads, but the GRANT itself is the
-- problem: `anon` holding INSERT means an unauthenticated caller could write
-- events straight through PostgREST, bypassing the Svix signature that is the
-- only thing making this data trustworthy. Caught by the #1856 grants gate.
REVOKE ALL ON public.marketing_email_events FROM anon, authenticated;
GRANT ALL ON public.marketing_email_events TO service_role;
-- No policy: service-role only. The webhook writes it; nothing reads it from a
-- client. An RLS-enabled table with no policy denies every authenticated read,
-- which is the intent — this is a raw provider log, not organiser-facing data.

-- Status ladder. Separate so both the ingest and its tests read the SAME order.
CREATE OR REPLACE FUNCTION public.mkt_email_status_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO public, pg_temp
AS $$
  SELECT CASE p_status
    WHEN 'queued' THEN 0
    WHEN 'deferred' THEN 0
    WHEN 'preview_skipped' THEN 0
    WHEN 'failed' THEN 1
    WHEN 'sent' THEN 2
    WHEN 'delivered' THEN 3
    WHEN 'opened' THEN 4
    WHEN 'clicked' THEN 5
    WHEN 'unsubscribed' THEN 6
    WHEN 'bounced' THEN 7
    WHEN 'complained' THEN 8
    ELSE 0
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The ingest itself — MONOTONIC by construction.
-- ---------------------------------------------------------------------------
-- Webhooks arrive OUT OF ORDER. `opened` can land before `delivered`. The same
-- rule already governs SMS in `termii-delivery-status` (never null a
-- `delivered_at` that is already set); this applies it to email.
--
-- The status ladder only ever climbs. A late `delivered` after a `clicked`
-- must not demote the row, or a campaign report would go backwards while an
-- organiser watched it.
CREATE OR REPLACE FUNCTION public.mkt_ingest_email_event(
  p_svix_id text,
  p_event_type text,
  p_provider_message_id text,
  p_payload jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_msg public.marketing_messages%ROWTYPE;
  v_rank_current integer;
  v_rank_new integer;
  v_new_status text;
  v_occurred timestamptz := COALESCE(
    NULLIF(p_payload->>'created_at','')::timestamptz, now());
BEGIN
  -- Idempotency FIRST. A duplicate delivery is a no-op, not a double count.
  INSERT INTO public.marketing_email_events
    (svix_id, event_type, provider_message_id, payload)
  VALUES (p_svix_id, p_event_type, p_provider_message_id, p_payload)
  ON CONFLICT (svix_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  SELECT * INTO v_msg FROM public.marketing_messages
   WHERE provider_message_id = p_provider_message_id
   LIMIT 1;
  IF NOT FOUND THEN
    -- Transactional mail (OTP, receipts) shares this Resend account and has no
    -- marketing_messages row. Recording and ignoring is correct; erroring would
    -- make Resend retry forever on events that will never match.
    RETURN 'unmatched';
  END IF;

  UPDATE public.marketing_email_events
     SET message_id = v_msg.id WHERE svix_id = p_svix_id;

  v_rank_current := public.mkt_email_status_rank(v_msg.status);
  v_new_status := v_msg.status;

  IF p_event_type = 'email.delivered' THEN
    v_new_status := 'delivered';
  ELSIF p_event_type = 'email.opened' THEN
    v_new_status := 'opened';
  ELSIF p_event_type = 'email.clicked' THEN
    v_new_status := 'clicked';
  ELSIF p_event_type = 'email.bounced' THEN
    v_new_status := 'bounced';
  ELSIF p_event_type = 'email.complained' THEN
    v_new_status := 'complained';
  END IF;

  v_rank_new := public.mkt_email_status_rank(v_new_status);
  -- bounced/complained are terminal FAILURES and always win, regardless of
  -- rank: an address that bounced did not "open" in any sense worth counting.
  IF p_event_type NOT IN ('email.bounced','email.complained')
     AND v_rank_new <= v_rank_current THEN
    v_new_status := v_msg.status;
  END IF;

  UPDATE public.marketing_messages
     SET status = v_new_status,
         -- Never null a timestamp that is already set (out-of-order arrival).
         delivered_at = CASE
           WHEN p_event_type = 'email.delivered'
             THEN COALESCE(delivered_at, v_occurred) ELSE delivered_at END,
         opened_at = CASE
           WHEN p_event_type = 'email.opened'
             THEN COALESCE(opened_at, v_occurred) ELSE opened_at END,
         open_count = CASE
           WHEN p_event_type = 'email.opened'
             THEN open_count + 1 ELSE open_count END,
         complained_at = CASE
           WHEN p_event_type = 'email.complained'
             THEN COALESCE(complained_at, v_occurred) ELSE complained_at END,
         bounce_kind = CASE
           WHEN p_event_type = 'email.bounced'
             THEN COALESCE(bounce_kind, p_payload->'data'->'bounce'->>'type')
           ELSE bounce_kind END,
         failure_reason = CASE
           WHEN p_event_type = 'email.bounced'
             THEN COALESCE(failure_reason,
                  'resend_bounce:' ||
                  COALESCE(p_payload->'data'->'bounce'->>'subType','unknown'))
           ELSE failure_reason END
   WHERE id = v_msg.id;

  -- SUPPRESSION. A hard bounce or a spam complaint must stop the next campaign
  -- reaching that address. Nothing suppressed anything before this, so every
  -- blast re-hit dead and hostile addresses — the fastest way to lose a
  -- sending domain.
  IF p_event_type = 'email.complained'
     OR (p_event_type = 'email.bounced'
         AND COALESCE(p_payload->'data'->'bounce'->>'type','') = 'Permanent')
  THEN
    -- NOT EXISTS rather than ON CONFLICT: `marketing_unsubscribes` carries no
    -- unique constraint, so ON CONFLICT DO NOTHING would never fire and every
    -- repeat bounce would append another identical suppression row.
    INSERT INTO public.marketing_unsubscribes
      (contact_email, channel, scope, brand_id, reason, unsubscribed_at)
    SELECT v_msg.recipient_email, 'email', 'brand', c.brand_id,
           CASE WHEN p_event_type = 'email.complained'
                THEN 'spam_complaint' ELSE 'hard_bounce' END,
           v_occurred
      FROM public.marketing_campaigns c
     WHERE c.id = v_msg.campaign_id
       AND v_msg.recipient_email IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.marketing_unsubscribes u
              WHERE lower(u.contact_email) = lower(v_msg.recipient_email)
                AND u.channel = 'email'
                AND (u.scope = 'global'
                     OR (u.scope = 'brand' AND u.brand_id = c.brand_id))
           );
  END IF;

  RETURN v_new_status;
END;
$fn$;

REVOKE ALL ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  TO service_role;

COMMIT;
