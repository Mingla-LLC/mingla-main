-- #4273 — SMS to every payout country, honestly.
--   (1) a phone whose country has no SMS rate is skipped, not a failed quote;
--   (2) every payout country (34 Stripe + NG) maps from its calling code, in
--       the SQL twin of _shared/e164Country.ts (Canada split from +1);
--   (3) SMS prices are automatic: public.sms_country_prices, refreshed daily
--       from Twilio's Pricing API, NG fixed, seeded so US/NG price at once.
--
-- (1) a phone whose country has no SMS rate is skipped, not a failed quote.
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
-- Invariant I-4273-UNPRICED-SEALED-AS-SKIPPED is declared beside its proof:
-- supabase/migrations/__tests__/issue_4273_sms_unpriced_country.implementor.pg17.test.sql

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


-- ── (2) Every payout country maps from its calling code ─────────────────────
-- #4273 (Seth, 2026-11-08): the 35 payout countries (34 Stripe + NG), and only
-- those: Ghana, South Africa, the Philippines and Kenya stay unmapped ("can't
-- text their country yet"). Canada splits from +1 by area code. This is the
-- SQL twin of supabase/functions/_shared/e164Country.ts; the parity fixtures
-- in __tests__/issue_1529_e164_parity.test.sql keep the two identical.
CREATE OR REPLACE FUNCTION public.mingla_e164_country(p_contact text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_e164 text;
BEGIN
  v_e164 := public.mingla_e164_normalize(p_contact);
  IF v_e164 IS NULL THEN
    RETURN NULL;
  END IF;
  -- #1529 P3-1 — fewer than 7 digits is a calling code, not a handset.
  IF pg_catalog.length(v_e164) - 1 < 7 THEN
    RETURN NULL;
  END IF;
  -- Longest prefix first.
  IF pg_catalog.left(v_e164, 4) = '+234' THEN RETURN 'NG'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+351' THEN RETURN 'PT'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+352' THEN RETURN 'LU'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+353' THEN RETURN 'IE'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+354' THEN RETURN 'IS'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+356' THEN RETURN 'MT'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+357' THEN RETURN 'CY'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+358' THEN RETURN 'FI'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+359' THEN RETURN 'BG'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+370' THEN RETURN 'LT'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+371' THEN RETURN 'LV'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+372' THEN RETURN 'EE'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+385' THEN RETURN 'HR'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+386' THEN RETURN 'SI'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+420' THEN RETURN 'CZ'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+421' THEN RETURN 'SK'; END IF;
  IF pg_catalog.left(v_e164, 4) = '+423' THEN RETURN 'LI'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+30' THEN RETURN 'GR'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+31' THEN RETURN 'NL'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+32' THEN RETURN 'BE'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+33' THEN RETURN 'FR'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+34' THEN RETURN 'ES'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+36' THEN RETURN 'HU'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+39' THEN RETURN 'IT'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+40' THEN RETURN 'RO'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+41' THEN RETURN 'CH'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+43' THEN RETURN 'AT'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+44' THEN RETURN 'GB'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+45' THEN RETURN 'DK'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+46' THEN RETURN 'SE'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+47' THEN RETURN 'NO'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+48' THEN RETURN 'PL'; END IF;
  IF pg_catalog.left(v_e164, 3) = '+49' THEN RETURN 'DE'; END IF;
  IF pg_catalog.left(v_e164, 2) = '+1' THEN
    IF pg_catalog.substr(v_e164, 3, 3) = ANY (ARRAY['204','226','236','249','250','257','263','289','306','343','354','365','367','368','382','403','416','418','428','431','437','438','450','468','474','506','514','519','548','579','581','584','587','604','613','639','647','672','683','705','709','742','753','778','780','782','807','819','825','867','873','879','902','905','942']) THEN
      RETURN 'CA';
    END IF;
    RETURN 'US';
  END IF;
  -- Unmapped calling code — honest unknown. NEVER default to a country.
  RETURN NULL;
END;
$function$;

-- ── (3) SMS prices are automatic ────────────────────────────────────────────
-- #4273 item 10. One row per country, read only by the edge (service role).
--   twilio_pricing_api  refreshed daily by the sms-price-refresh edge function
--                       from GET https://pricing.twilio.com/v1/Messaging/Countries/{ISO}
--                       (the highest outbound price, sanity-guarded).
--   termii_fixed        Nigeria, NGN 5.00 per segment (#4080), no expiry.
--   seed_4080           US, USD 0.0083 per segment (#4080), so the US is priced
--                       before the first fetch; the first fetch replaces it.
-- A price never expires: the last good price keeps quoting and the
-- api-health-probe alerts after 7 days without a refresh.
CREATE TABLE IF NOT EXISTS public.sms_country_prices (
  country text PRIMARY KEY CHECK (country ~ '^[A-Z]{2}$'),
  provider text NOT NULL CHECK (provider IN ('twilio', 'termii')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  minor_numerator bigint NOT NULL CHECK (minor_numerator > 0),
  minor_denominator bigint NOT NULL CHECK (minor_denominator > 0),
  source text NOT NULL CHECK (source IN ('twilio_pricing_api', 'termii_fixed', 'seed_4080')),
  source_reference text NOT NULL CHECK (length(source_reference) > 0),
  fetched_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((country = 'NG') = (provider = 'termii'))
);

ALTER TABLE public.sms_country_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_country_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sms_country_prices TO service_role;

COMMENT ON TABLE public.sms_country_prices IS
  '#4273: live SMS price per segment per country (minor units = minor_numerator / minor_denominator). Twilio rows refreshed daily by sms-price-refresh; NG fixed (Termii NGN 5.00). Service role only.';

INSERT INTO public.sms_country_prices
  (country, provider, currency, minor_numerator, minor_denominator, source, source_reference, fetched_at)
VALUES
  ('US', 'twilio', 'USD', 83, 100, 'seed_4080',
   'Twilio US USD 0.0083/segment (#4080, 2026-10-23); replaced by the first daily fetch',
   '2026-10-23T00:00:00Z'),
  ('NG', 'termii', 'NGN', 500, 1, 'termii_fixed',
   'Termii NG NGN 5.00/segment (#4080 account evidence); fixed, no expiry',
   '2026-10-23T00:00:00Z')
ON CONFLICT (country) DO NOTHING;

-- Daily refresh at 06:17 UTC (the repo's pg_cron + pg_net pattern).
DO $cron$
DECLARE v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Issue #4273: pg_cron/pg_net unavailable; SMS price refresh not scheduled.';
    RETURN;
  END IF;
  SELECT jobid INTO v_job_id FROM cron.job
  WHERE jobname = 'issue_4273_sms_price_refresh' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'issue_4273_sms_price_refresh',
    '17 6 * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name='supabase_url' LIMIT 1) || '/functions/v1/sms-price-refresh',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT decrypted_secret
            FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $command$
  );
END
$cron$;

COMMIT;
