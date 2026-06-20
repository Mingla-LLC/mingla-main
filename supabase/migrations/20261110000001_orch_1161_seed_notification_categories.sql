-- META-ORCH-1161 Sub-A (thin slice) — seed notification_categories per SPEC §5.2.
--
-- ALL rows are seeded so the closed SMS set is correct from day one (DC-3): only
-- rows with urgency='high' AND 'sms' in default_channels can EVER reach SMS.
-- The thin slice only WIRES buyer_reservation_changed end-to-end; the other rows
-- exist so can_send() and the strict-grep gate evaluate against the full matrix.
--
-- Idempotent: ON CONFLICT (key) DO UPDATE keeps the seed authoritative.

INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES
  -- Sub-C buyer reservation moments (the thin slice wires `changed`).
  ('buyer_reservation_confirmed', 'Reservations', true, 'high',
     ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('buyer_reservation_changed',   'Reservations', true, 'high',
     ARRAY['inapp','push','email','sms'], 'reach_once'),
  ('buyer_reservation_cancelled', 'Reservations', true, 'high',
     ARRAY['inapp','push','email','sms'], 'reach_once'),
  -- Sub-C reminders.
  ('buyer_event_reminder',        'Reminders', true, 'high',
     ARRAY['inapp','push','email','sms'], 'escalate_on_no_engagement'),
  ('buyer_reservation_reminder',  'Reminders', true, 'high',
     ARRAY['inapp','push','email','sms'], 'escalate_on_no_engagement'),
  -- Purchase confirmation: per DEC-185 SMS is REMOVED for purchases (COPY §3.11);
  -- push+email only. NOT SMS-eligible.
  ('buyer_purchase_confirmation', 'Purchases', true, 'high',
     ARRAY['inapp','push','email'], 'reach_once'),
  -- Refund / order-cancelled (existing email-shaped moments; no SMS in the seed).
  ('buyer_refund_issued',         'Purchases', true, 'normal',
     ARRAY['inapp','push','email'], 'reach_once'),
  ('buyer_order_cancelled',       'Purchases', true, 'normal',
     ARRAY['inapp','push','email'], 'reach_once'),
  -- Waitlist spot open (SMS-eligible high-urgency).
  ('waitlist_spot_open',          'Purchases', true, 'high',
     ARRAY['inapp','push','email','sms'], 'reach_once'),
  -- Sub-B marketing blast (per-campaign channel; off-by-default, low urgency).
  ('marketing_blast',             'Marketing', false, 'low',
     ARRAY['email','sms'], 'reach_once'),
  -- The single BUSINESS SMS per DEC-185 / COPY §3.12 (payout). high-urgency.
  ('payout_paid',                 'Payouts', true, 'high',
     ARRAY['inapp','push','sms'], 'reach_once'),
  -- Existing consumer-social categories (mapped so the v2 gate is a no-op for
  -- the legacy path; channels = what they use today, no SMS).
  ('friend_requests',             'Social', true, 'low',
     ARRAY['inapp','push'], 'reach_once'),
  ('messages',                    'Social', true, 'normal',
     ARRAY['inapp','push'], 'reach_once'),
  ('collaboration_invites',       'Social', true, 'normal',
     ARRAY['inapp','push'], 'reach_once'),
  ('reminders',                   'Social', true, 'low',
     ARRAY['inapp','push'], 'reach_once'),
  ('marketing',                   'Marketing', false, 'low',
     ARRAY['inapp','push','email'], 'reach_once')
ON CONFLICT (key) DO UPDATE SET
  section          = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency          = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode       = EXCLUDED.reach_mode,
  active           = true;
