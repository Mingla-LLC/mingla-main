-- Issue #2509 — a blast that is interrupted must be able to finish.
--
-- On 2026-08-24 two `We Go Again` campaigns died mid-send and wedged at
-- `status='sending'` forever. 21 recipients were burned and 2 were never
-- attempted, with no path back for any of them. Three defects compounded:
--
--   1. The dispatcher is one serial loop with no wall-clock budget. Both runs
--      terminated at ~196s — the runtime killing the isolate, not the work
--      completing.
--   2. `mkt_finalize_campaign` runs AFTER the loop, so it never fired, and the
--      claim predicate only ever matched `status='scheduled'`. A campaign left
--      at `sending` was invisible to every subsequent cron pass.
--   3. `marketing_messages.attempt_count` / `next_attempt_at` were never
--      written on the email path, so a 429'd recipient was terminal.
--
-- This migration supplies the two DATABASE halves: a real uniqueness
-- guarantee, and a claim predicate that can reclaim a stalled run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Uniqueness — make the code comment true.
-- ---------------------------------------------------------------------------
-- `marketing-send/index.ts` claimed "marketing_messages uniqueness make a
-- repeated request provider-idempotent". No such constraint existed: the only
-- unique key was the PRIMARY KEY on a client-generated `id`. A re-run
-- therefore INSERTed a second row per recipient and re-sent to everyone —
-- which is why recovering the 8 stranded recipients of `f770996f` by replay
-- would have emailed the 189 who already had it a second time.
--
-- Verified before writing: zero violating pairs in production on either
-- channel, so both indexes build clean.
--
-- Partial + lower() on email because addresses are case-insensitive in
-- practice and the sender lower-cases nothing.
CREATE UNIQUE INDEX IF NOT EXISTS issue_2509_one_email_row_per_campaign
  ON public.marketing_messages (campaign_id, lower(recipient_email))
  WHERE channel = 'email' AND recipient_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS issue_2509_one_sms_row_per_campaign
  ON public.marketing_messages (campaign_id, recipient_phone)
  WHERE channel = 'sms' AND recipient_phone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Reclaim — a stalled run must become claimable again.
-- ---------------------------------------------------------------------------
-- The reclaim window is deliberately LONGER than the runtime's own ceiling.
-- A campaign whose `updated_at` has not moved for this long cannot still be
-- running: the isolate that owned it is gone. The dispatcher heartbeats
-- `updated_at` as it works, so a healthy long run is never stolen from
-- itself — that heartbeat is what makes this predicate safe, and removing it
-- would turn this into a double-send.
CREATE OR REPLACE FUNCTION public.mkt_claim_campaigns(
  p_limit integer DEFAULT 10,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  account_id uuid,
  brand_id uuid,
  audience_id uuid,
  channel text,
  channel_payload jsonb,
  name text,
  scheduled_for timestamptz
)
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $$
DECLARE
  -- 10 minutes: ~3x the observed ~196s death point, so an isolate that is
  -- merely slow is never mistaken for one that is dead.
  v_stale interval := interval '10 minutes';
BEGIN
  RETURN QUERY
  UPDATE public.marketing_campaigns mc
     SET status = 'sending',
         updated_at = now()
   WHERE mc.id IN (
     SELECT inner_mc.id
       FROM public.marketing_campaigns inner_mc
      WHERE (
              (inner_mc.status = 'scheduled' AND inner_mc.scheduled_for <= now())
              -- #2509 — reclaim a run whose owner died mid-flight.
              OR (inner_mc.status = 'sending'
                  AND inner_mc.updated_at < now() - v_stale)
            )
        AND (p_campaign_id IS NULL OR inner_mc.id = p_campaign_id)
      ORDER BY inner_mc.scheduled_for ASC NULLS LAST
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING
     mc.id,
     mc.account_id,
     mc.brand_id,
     mc.audience_id,
     mc.channel,
     mc.channel_payload,
     mc.name,
     mc.scheduled_for;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Heartbeat — cheap, so the dispatcher can prove it is alive.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mkt_heartbeat_campaign(p_campaign_id uuid)
RETURNS void
LANGUAGE sql
SET search_path TO public, pg_temp
AS $$
  UPDATE public.marketing_campaigns
     SET updated_at = now()
   WHERE id = p_campaign_id AND status = 'sending';
$$;

COMMIT;
