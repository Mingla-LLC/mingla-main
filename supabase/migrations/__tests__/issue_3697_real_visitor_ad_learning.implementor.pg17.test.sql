-- toward #3697: checkout match data + attribution detail schema contract.
-- MINGLA-INVARIANT: I-3697-REAL-VISITOR-AD-LEARNING | issue #3697 | Checkout match keys and provider ad detail survive the browser-to-server handoff so provider learning can optimize against real arrivals and buyers.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing
  FROM (VALUES
    ('fbp'), ('fbc'), ('scid'), ('client_ip'), ('client_user_agent'),
    ('ad_checkout_start_sent_at'), ('ad_checkout_start_provider_response')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'ticket_checkout_sessions'
      AND c.column_name = required.column_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ticket_checkout_sessions_missing:%', v_missing;
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing
  FROM (VALUES ('ad_set_id'), ('ad_id')) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'ad_attribution_touches'
      AND c.column_name = required.column_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ad_attribution_touches_missing:%', v_missing;
  END IF;
END;
$test$;

ROLLBACK;
