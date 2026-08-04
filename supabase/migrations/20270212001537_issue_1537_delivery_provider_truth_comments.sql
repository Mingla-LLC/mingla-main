-- Issue #1537 — delivery-ledger provider truth: correct the SCHEMA DOCUMENTATION
-- that #1537 makes stale. COMMENT ON only.
--
-- NO schema change, NO data change, NO backfill, NO constraint. Two COMMENT ON
-- COLUMN statements. It is idempotent and order-independent, so it is safe to
-- apply out of sequence and safe to re-apply.
--
-- WHY IT EXISTS. `notification_deliveries.provider` was written from a per-channel
-- constant in notifyV2 (`sms: "twilio"`) rather than from the provider that
-- handled the send. Nigeria routes to Termii, so every Nigerian text was
-- recorded as Twilio and the table held zero `termii` rows. Two facts a future
-- reader querying this table during a Nigerian incident needs from the schema
-- itself:
--
--   1. `provider` is now DERIVED, and `termii` is an expected value. Anyone
--      reading rows written before the #1537 cutover must know they are
--      uniformly mislabelled — those rows were NOT rewritten (deliberately: an
--      audit trail that is retro-stamped is worse than one with a documented
--      cutover), so `provider` on a pre-cutover SMS row means "unknown", not
--      "Twilio".
--   2. `contact` is no longer guest-only. An authenticated row skipped with
--      failed_reason='no_contact' now records the contact that was REJECTED;
--      before #1537 those rows carried NULL and the missed recipient was
--      unrecoverable.
--
-- Neither delivery webhook filters on `provider` (twilio-message-status and
-- termii-delivery-status both reconcile by provider_message_id + channel), so
-- widening the set of observed values breaks no reader.

COMMENT ON COLUMN public.notification_deliveries.provider IS
  'Issue #1537 — the provider that ACTUALLY handled this attempt, reported by the '
  'adapter that ran; on a skip/suppression, the provider that WOULD have handled '
  'it. SMS is dual-provider and country-routed: ''termii'' for NG destinations, '
  '''twilio'' for US/RoW (see supabase/functions/_shared/adapters/smsAdapter.ts). '
  'NULL means no provider was ever selected (unroutable destination, or a channel '
  'with no contact) — never "assume Twilio". CUTOVER: rows written BEFORE #1537 '
  'were stamped from a per-channel constant and record ''twilio'' for EVERY sms '
  'row including Nigerian ones; they were deliberately NOT rewritten, so treat '
  'provider on a pre-#1537 sms row as unknown. Other channels: ''onesignal'' '
  '(push), ''resend'' (email), ''inapp''.';

COMMENT ON COLUMN public.notification_deliveries.contact IS
  'META-ORCH-1161 §5.1 (rework) — guest/anon contact (E.164/lowercased email) for '
  'a delivery row with no notification_id. Webhook reconciles by '
  'provider_message_id either way. Issue #1537 WIDENED this: an AUTHENTICATED row '
  '(notification_id NOT NULL) skipped with failed_reason=''no_contact'' also '
  'records the contact that was rejected for that channel, so the recipient who '
  'was not reached is recoverable; those rows previously carried NULL. Stored raw '
  'and lowercased, the same convention the guest path uses for this column.';
