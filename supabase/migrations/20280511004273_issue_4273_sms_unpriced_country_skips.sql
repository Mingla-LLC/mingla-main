-- #4273 — a phone whose country has no SMS rate is skipped, not a failed quote.
--
-- WHY. The Blast quote used to throw `cost_unavailable:sms_rate_unavailable`
-- when ANY recipient's phone had no rate (production 2026-11-08: one Belgian
-- number in Harmattan Club's audience, opted in by #4297; the rate book prices
-- twilio-US and termii-NG only). One such number failed the whole SMS quote.
--
-- WHERE THE REASON IS DECIDED. The rate book lives in the edge runtime config,
-- so the edge decides: `smsRateForPhone` (supabase/functions/_shared/
-- smsPriceBook.ts) is the one rule. The Blast quote leaves an unpriced
-- candidate's verdict as the Book's (allowed, reason unchanged — the confirm
-- RPCs compare both against the live candidate list) and gives it 0 SMS
-- segments and no cost, and keeps it out of reachableCount, the cost and the
-- segment total. Every reachable SMS candidate the quote prices has >= 1
-- segment, so "allowed SMS with 0 segments" is exactly "unpriced".
--
-- This migration SEALS that decision: every confirm path (book, people, manual
-- group, circle, combined) inserts its sealed targets into
-- marketing_book_send_targets with segment_count from the quote, and every
-- send audience reads only outcome = 'queued'. A queued SMS target with 0
-- segments is turned into a suppressed target with reason
-- 'sms_unpriced_country' as it is written, so the send never sees it.
--
-- Static SQL only. No backfill: no target was ever sealed this way (the quote
-- threw instead), and sealed targets are immutable.
--
-- MINGLA-INVARIANT: I-4273-UNPRICED-SEALED-AS-SKIPPED | issue #4273 | A sealed SMS Blast target the quote could not price (0 segments) is written as suppressed with reason sms_unpriced_country, so no send audience ever returns it.

BEGIN;

ALTER TABLE public.marketing_book_send_targets
  DROP CONSTRAINT IF EXISTS issue_1778_target_reason;
ALTER TABLE public.marketing_book_send_targets
  ADD CONSTRAINT issue_1778_target_reason CHECK (reason IN (
    'allowed', 'suppressed', 'can_send_denied', 'channel_unavailable',
    'delivery_denied', 'sms_unpriced_country'
  ));

CREATE OR REPLACE FUNCTION public.issue_4273_seal_unpriced_sms_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.channel = 'sms' AND NEW.outcome = 'queued' AND NEW.segment_count = 0 THEN
    NEW.outcome := 'suppressed';
    NEW.reason := 'sms_unpriced_country';
    NEW.allocated_cost_minor := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_4273_seal_unpriced_sms_target() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4273_seal_unpriced_sms_target ON public.marketing_book_send_targets;
CREATE TRIGGER issue_4273_seal_unpriced_sms_target
  BEFORE INSERT ON public.marketing_book_send_targets
  FOR EACH ROW EXECUTE FUNCTION public.issue_4273_seal_unpriced_sms_target();

COMMENT ON FUNCTION public.issue_4273_seal_unpriced_sms_target() IS
  '#4273: a queued SMS target sealed with 0 segments is one the quote could not price (no rate for the phone''s country); it is written as suppressed / sms_unpriced_country so the send never attempts it.';

COMMIT;
