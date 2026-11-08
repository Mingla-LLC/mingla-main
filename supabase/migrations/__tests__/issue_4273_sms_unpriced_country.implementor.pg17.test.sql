-- #4273 — a phone whose country has no SMS rate is skipped, never texted.
-- The edge quote (smsRateForPhone) gives such a candidate 0 segments and keeps
-- the Book's verdict; the seal writes it as suppressed / sms_unpriced_country,
-- so the send audience never returns it. Runs on the fully applied migration
-- chain and rolls back.
--
-- MINGLA-INVARIANT: I-4273-UNPRICED-SEALED-AS-SKIPPED | issue #4273 | A sealed SMS Blast target the quote could not price (0 segments) is written as suppressed with reason sms_unpriced_country, so no send audience ever returns it.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273u_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273u_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;

INSERT INTO auth.users(id, email) VALUES ('4273d000-0000-4000-8000-000000000001', 'u01@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('4273d000-0000-4000-8000-000000000001', 'u01@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4273d000-0000-4000-8000-0000000000b1', '4273d000-0000-4000-8000-000000000001', 'Unpriced', 'issue-4273u-unpriced', 'USD', now(), now());
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('4273d000-1000-4000-8000-000000000001', '4273d000-0000-4000-8000-0000000000b1', '4273d000-0000-4000-8000-000000000001',
   'Night', 't4273u-night', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
-- Two buyers who said nothing either way, so both phones are opted in (#4297):
-- one US number (priced) and one Belgian number (no rate in the book).
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  ('4273d000-1100-4000-8000-000000000001', '4273d000-1000-4000-8000-000000000001', 'us@example.test', '+12025550142', 'Us', 1000, 'USD', 'paid', 'legacy', now()),
  ('4273d000-1100-4000-8000-000000000002', '4273d000-1000-4000-8000-000000000001', 'be@example.test', '+32470123456', 'Be', 1000, 'USD', 'paid', 'legacy', now());

SELECT set_config('request.jwt.claim.sub', '4273d000-0000-4000-8000-000000000001', true);

DO $unpriced$
DECLARE
  o1 uuid := '4273d000-0000-4000-8000-000000000001'; b uuid := '4273d000-0000-4000-8000-0000000000b1';
  r uuid; a uuid; c uuid; e jsonb; snap jsonb; send jsonb; x uuid; v jsonb;
BEGIN
  FOREACH r IN ARRAY ARRAY['4273d000-1100-4000-8000-000000000001', '4273d000-1100-4000-8000-000000000002']::uuid[] LOOP
    SELECT public.biz_resolve_brand_person_source(b, o.event_id, 'order', r, NULL, NULL,
             o.buyer_email, o.buyer_phone_e164, o.created_at) INTO v
      FROM public.orders o WHERE o.id = r;
  END LOOP;

  a := (public.biz_get_or_create_marketing_combined_audience_v1(o1, b, '["book"]'::jsonb) ->> 'audienceId')::uuid;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273d000-3000-4000-8000-000000000001', o1, b, a, 'U sms', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_combined_quote_candidates_v1(o1, c);
  PERFORM pg_temp.chk('U-00 fixture: the Book allows both phones',
    (SELECT count(*) FROM jsonb_array_elements(e -> 'candidates') x2
      WHERE (x2 ->> 'allowed')::boolean AND x2 ->> 'normalizedContact' IN ('+12025550142', '+32470123456')) = 2, e::text);

  -- The quote exactly as the edge builds it: the US phone priced (1 segment),
  -- the Belgian phone unpriced (0 segments, no cost, out of reachableCount).
  snap := jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('a', 64), 'contentHash', repeat('b', 64),
    'quotedAt', now(), 'brandId', e -> 'brandId', 'content', e -> 'content',
    'audienceId', e -> 'audienceId', 'audienceKind', e -> 'audienceKind',
    'audienceVersion', e -> 'audienceVersion', 'selectedCount', e -> 'selectedCount',
    'reachableCount', 1, 'suppressedCount', 0, 'unavailableCount',
      (SELECT count(*) FROM jsonb_array_elements(e -> 'candidates') x2 WHERE x2 ->> 'normalizedContact' IS NULL),
    'unpricedCount', 1, 'smsSegments', 1, 'costKind', 'provider_estimate',
    'estimatedCostMinor', 1, 'currency', 'USD',
    'candidates', (SELECT jsonb_agg(x2 || CASE
        WHEN x2 ->> 'normalizedContact' = '+12025550142'
          THEN '{"segments":1,"allocatedCostMinor":1,"smsUnpriced":false}'::jsonb
        ELSE '{"segments":0,"allocatedCostMinor":null,"smsUnpriced":true}'::jsonb END)
      FROM jsonb_array_elements(e -> 'candidates') x2));
  PERFORM public.biz_confirm_marketing_combined_send_v1(o1, c, '4273d000-4000-4000-8000-000000000001', snap, now() + interval '1 hour');
  SELECT id INTO x FROM public.marketing_book_send_executions WHERE campaign_id = c;

  PERFORM pg_temp.chk('U-01 the Belgian phone is sealed as suppressed / sms_unpriced_country',
    EXISTS (SELECT 1 FROM public.marketing_book_send_targets t WHERE t.execution_id = x
             AND t.contact_value_digest = encode(extensions.digest(convert_to('+32470123456', 'UTF8'), 'sha256'), 'hex')
             AND t.outcome = 'suppressed' AND t.reason = 'sms_unpriced_country' AND t.allocated_cost_minor IS NULL),
    (SELECT string_agg(outcome || '/' || reason || '/' || segment_count, ',') FROM public.marketing_book_send_targets WHERE execution_id = x));
  PERFORM pg_temp.chk('U-02 the priced US phone stays queued with its segment',
    EXISTS (SELECT 1 FROM public.marketing_book_send_targets t WHERE t.execution_id = x
             AND t.contact_value_digest = encode(extensions.digest(convert_to('+12025550142', 'UTF8'), 'sha256'), 'hex')
             AND t.outcome = 'queued' AND t.reason = 'allowed' AND t.segment_count = 1), '');

  send := public.biz_marketing_combined_send_audience_v1(c);
  PERFORM pg_temp.chk('U-03 the send texts exactly what the quote priced: the US phone only',
    jsonb_array_length(send -> 'rows') = 1 AND send -> 'rows' -> 0 ->> 'raw_phone' = '+12025550142'
    AND (SELECT reachable_count FROM public.marketing_book_send_executions WHERE id = x) = 1, send::text);
  PERFORM pg_temp.chk('U-04 the unpriced phone is not a send-time skip either (it was never queued)',
    NOT EXISTS (SELECT 1 FROM public.marketing_combined_send_skips s WHERE s.execution_id = x), '');

  -- An email target with 0 segments is ordinary (email is never metered).
  PERFORM pg_temp.chk('U-05 the seal touches SMS only',
    pg_get_functiondef('public.issue_4273_seal_unpriced_sms_target()'::regprocedure) ~ 'NEW\.channel = ''sms''', '');
  PERFORM pg_temp.chk('U-06 the seal helper is not callable by app roles',
    NOT has_function_privilege('authenticated', 'public.issue_4273_seal_unpriced_sms_target()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_seal_unpriced_sms_target()', 'EXECUTE'), '');
END;
$unpriced$;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273u_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 unpriced country FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 unpriced country: PASS';
END;
$report$;

ROLLBACK;
