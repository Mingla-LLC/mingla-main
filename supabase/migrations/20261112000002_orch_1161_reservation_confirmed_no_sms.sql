-- META-ORCH-1161 Sub-C — seed correction: buyer_reservation_confirmed is NO-TEXT.
--
-- Per DEC-185's confirmed matrix, "reservation confirmed" is push+inapp+email but
-- NOT SMS (Explorer NO-text set = ticket purchase confirmation, RESERVATION
-- CONFIRMED, payment failed, social). The thin-slice seed
-- (20261110000001_orch_1161_seed_notification_categories.sql) erroneously included
-- 'sms' in buyer_reservation_confirmed's default_channels; the Sub-A.2 correction
-- (20261110000005) fixed refund/order/payout but missed this one.
--
-- Without this, once SMS_LIVE_ENABLED_* is flipped a guest would get a confirmation
-- TEXT on a reservation confirm — contrary to DEC-185. SMS is text-dark today so
-- there is zero live blast radius; this aligns the seed before any go-live.
--
-- IDEMPOTENT: array_remove is a no-op once 'sms' is gone. Re-runnable.
--
-- Cross-refs: DEC-185 (channel matrix); SPEC §5.2; the closed SMS-eligible set
-- (I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES) — confirmed leaves it.

UPDATE public.notification_categories
   SET default_channels = array_remove(default_channels, 'sms')
 WHERE key = 'buyer_reservation_confirmed'
   AND 'sms' = ANY(default_channels);
