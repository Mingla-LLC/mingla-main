-- #4063 Wave 2 — buyer live-edit messages seed one SMS per distinct phone.
-- MINGLA-INVARIANT: I-4063-EVENT-EDIT-ONE-SMS-PER-PHONE | issue #4063 | With messages_v2 enabled, paid-order live-edit fan-out emits at most one SMS-seeding row per distinct canonical buyer phone while switch-off payloads remain unchanged.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i4063_edit_assert(
  p_ok boolean,
  p_message text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#4063 event edit FAIL: %', p_message;
  END IF;
END
$$;

BEGIN;
DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_off_notice uuid := gen_random_uuid();
  v_on_notice uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email)
  VALUES (v_owner, 'first-event-edit-4063@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'first-event-edit-4063@example.test');
  INSERT INTO public.account_claim_contacts(
    user_id, channel, value, verified_via
  ) VALUES (
    v_owner, 'email', 'first-event-edit-4063@example.test', 'email_code'
  );
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 4063 Event Edit',
    'issue-4063-event-edit-' || v_brand, 'stripe', 'US', 'USD', 'USD'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, published_at
  ) VALUES (
    v_event, v_brand, v_owner, 'Issue 4063 Edited Event',
    'issue-4063-edited-event-' || v_event, 'event', 'scheduled', 'public',
    'America/New_York', 'USD', now()
  );

  INSERT INTO public.orders(
    event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source,
    notification_status, confirmed_at
  ) VALUES
    (v_event, v_owner, 'first-event-edit-4063@example.test', 'First Buyer',
     '+14155550150', 0, 'USD', 'free', 'paid', 'legacy', 'sent', now()),
    (v_event, NULL, 'second-event-edit-4063@example.test', 'Second Buyer',
     '+14155550150', 0, 'USD', 'free', 'paid', 'legacy', 'sent', now());

  UPDATE public.feature_flags SET is_enabled = true
   WHERE flag_key IN (
     'event_update_buyer_email',
     'event_update_buyer_email_all_brands'
   );
  UPDATE public.feature_flags SET is_enabled = false
   WHERE flag_key = 'event_update_buyer_email_allowlist_only';

  UPDATE public.issue_4063_switches
     SET enabled = false, changed_at = NULL
   WHERE name = 'messages_v2';
  INSERT INTO public.event_edit_notices(
    id, event_id, brand_id, edited_by, source, reason, changes,
    notice_changes, state, send_after, base_snapshot, after_snapshot
  ) VALUES (
    v_off_notice, v_event, v_brand, v_owner, 'event', 'Switch off fixture',
    '[{"field":"venue"}]'::jsonb, '[{"field":"venue"}]'::jsonb,
    'scheduled', now() - interval '1 second', '{}'::jsonb, '{}'::jsonb
  );
  PERFORM public.event_edit_notice_fanout(20);

  PERFORM pg_temp.i4063_edit_assert((
    SELECT count(*) = 2
      FROM public.rsvp_notifications
     WHERE payload->>'noticeId' = v_off_notice::text
       AND template_key = 'buyer_event_updated'
       AND payload ? 'recipientEmail'
       AND NOT (payload ? 'recipientPhone')
       AND NOT (payload ? 'claimed')
       AND NOT (payload ? 'kind')
  ), 'switch-off fan-out must preserve the two original email-only payloads');
  PERFORM pg_temp.i4063_edit_assert((
    SELECT count(*) = 2
      FROM public.rsvp_notification_deliveries AS delivery
      JOIN public.rsvp_notifications AS notification
        ON notification.id = delivery.notification_id
     WHERE notification.payload->>'noticeId' = v_off_notice::text
       AND delivery.channel = 'email'
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.rsvp_notification_deliveries AS delivery
      JOIN public.rsvp_notifications AS notification
        ON notification.id = delivery.notification_id
     WHERE notification.payload->>'noticeId' = v_off_notice::text
       AND delivery.channel = 'sms'
  ), 'switch-off fan-out must seed only the established email deliveries');

  UPDATE public.issue_4063_switches
     SET enabled = true, changed_at = now()
   WHERE name = 'messages_v2';
  UPDATE public.notification_categories
     SET default_channels = ARRAY['email', 'sms']::text[]
   WHERE key = 'buyer_event_updated';
  INSERT INTO public.event_edit_notices(
    id, event_id, brand_id, edited_by, source, reason, changes,
    notice_changes, state, send_after, base_snapshot, after_snapshot
  ) VALUES (
    v_on_notice, v_event, v_brand, v_owner, 'event', 'Switch on fixture',
    '[{"field":"venue"}]'::jsonb, '[{"field":"venue"}]'::jsonb,
    'scheduled', now() - interval '1 second', '{}'::jsonb, '{}'::jsonb
  );
  PERFORM public.event_edit_notice_fanout(20);

  PERFORM pg_temp.i4063_edit_assert((
    SELECT count(*) = 3
      FROM public.rsvp_notifications
     WHERE payload->>'noticeId' = v_on_notice::text
       AND template_key = 'buyer_event_updated'
  ), 'switch-on fan-out must keep two email rows and add one deduped phone row');
  PERFORM pg_temp.i4063_edit_assert((
    SELECT count(*) = 1
      FROM public.rsvp_notifications
     WHERE payload->>'noticeId' = v_on_notice::text
       AND payload->>'recipientPhone' = '+14155550150'
       AND NOT (payload ? 'recipientEmail')
       AND payload->>'claimed' = 'true'
       AND payload->>'kind' = 'event'
       AND idempotency_key =
         'event_edit:' || v_on_notice::text || ':phone:' || md5('+14155550150')
  ), 'one phone-only row must carry the canonical phone, claimed state and kind');
  PERFORM pg_temp.i4063_edit_assert((
    SELECT count(*) = 2
      FROM public.rsvp_notification_deliveries AS delivery
      JOIN public.rsvp_notifications AS notification
        ON notification.id = delivery.notification_id
     WHERE notification.payload->>'noticeId' = v_on_notice::text
       AND delivery.channel = 'email'
  ) AND (
    SELECT count(*) = 1
      FROM public.rsvp_notification_deliveries AS delivery
      JOIN public.rsvp_notifications AS notification
        ON notification.id = delivery.notification_id
     WHERE notification.payload->>'noticeId' = v_on_notice::text
       AND delivery.channel = 'sms'
  ), 'the delivery ledger must contain two emails and one deduped SMS');
END
$test$;
ROLLBACK;
