-- META-ORCH-1161 Sub-A.2 (consent-capture slice) — seed corrections per DEC-185.
--
-- The thin-slice seed (20261110000001_orch_1161_seed_notification_categories.sql)
-- omitted three SMS/email channels that the confirmed DEC-185 matrix (SPEC §5.2)
-- requires for the closed SMS-eligible set:
--   - buyer_refund_issued   : ADD 'sms'   (was {inapp,push,email})  → SPEC §5.2
--   - buyer_order_cancelled : ADD 'sms'   (was {inapp,push,email})  → SPEC §5.2
--   - payout_paid           : ADD 'email' (was {inapp,push,sms})    → SPEC §5.2
--
-- This brings the live seed into parity with the SPEC §5.2 matrix + the closed
-- SMS-eligible set in §5.2 ("buyer_refund_issued, buyer_order_cancelled, ...,
-- payout_paid"). These categories were already in the SMS-eligible enumeration;
-- only the seed rows themselves lagged.
--
-- IDEMPOTENT: each statement is an UPDATE that re-derives default_channels from
-- the current value, adding the missing channel ONLY when absent (array_append
-- guarded by NOT (... = ANY(...))). Re-running is a no-op once corrected.
--
-- Cross-refs:
--   SPEC:    Mingla_Artifacts/specs/SPEC_META-ORCH-1161_NOTIFICATION_MESSAGING_SYSTEM.md §5.2
--   Decision: DEC-185 (channel matrix) in Mingla_Artifacts/DECISION_LOG.md
--   Invariant: I-PROPOSED-1161-SMS-ONLY-FOR-POLICY-ELIGIBLE-CATEGORIES (the seed IS the closed set)

-- buyer_refund_issued → ensure 'sms' is present.
UPDATE public.notification_categories
   SET default_channels = array_append(default_channels, 'sms')
 WHERE key = 'buyer_refund_issued'
   AND NOT ('sms' = ANY(default_channels));

-- buyer_order_cancelled → ensure 'sms' is present.
UPDATE public.notification_categories
   SET default_channels = array_append(default_channels, 'sms')
 WHERE key = 'buyer_order_cancelled'
   AND NOT ('sms' = ANY(default_channels));

-- payout_paid → ensure 'email' is present (the single brand SMS already has sms).
UPDATE public.notification_categories
   SET default_channels = array_append(default_channels, 'email')
 WHERE key = 'payout_paid'
   AND NOT ('email' = ANY(default_channels));
