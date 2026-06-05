-- META-ORCH-1076 [Paystack Africa] — Phase 1b: admit NGN to events.currency.
--
-- Caught at the Phase 1 live test (2026-06-04): `events_currency_supported_check`
-- is a Western-currency-only allowlist (GBP/USD/CAD/CHF/EUR + European), so an
-- NGN event cannot be created — which blocks Nigerian Paystack brands entirely.
-- Phase 1's main migration widened the BRAND pricing CHECKs (region) but missed
-- the EVENT currency check. This widens it to ALSO admit NGN (Ghana/GHS deferred).
--
-- Additive + idempotent: DROP IF EXISTS then re-ADD as a strict superset of the
-- prior 14 currencies + NGN → no existing event row can violate it.
--   https://www.postgresql.org/docs/current/ddl-constraints.html

BEGIN;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_currency_supported_check;
ALTER TABLE public.events ADD CONSTRAINT events_currency_supported_check
  CHECK (currency = ANY (ARRAY[
    'GBP','USD','CAD','CHF','EUR','BGN','CZK','DKK','HUF','ISK','NOK','PLN','RON','SEK',
    'NGN'
  ]::bpchar[]));

COMMIT;
