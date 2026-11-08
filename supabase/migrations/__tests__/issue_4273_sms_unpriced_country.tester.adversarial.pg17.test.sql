-- #4273 — tester adversarial: the unpriced-country seal on the confirm paths
-- the implementor's suite does not walk (Book and Manual group, through
-- biz_confirm_marketing_book_send_v1 / biz_confirm_marketing_people_send_v2),
-- circle- and buyer-shaped targets, and everything the trigger must NOT touch:
-- email targets, already-suppressed or unavailable SMS targets, priced SMS
-- targets, every older reason code, the immutability guard and the execution
-- sum check. It also pins the merge-before-migration state: without the
-- trigger the host's sealed counts are unchanged and the only extra queued row
-- is the 0-segment one the edge send guard skips. Runs on the fully applied
-- migration chain and rolls back.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273a_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273a_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.digest(p text) RETURNS text LANGUAGE sql AS $f$
  SELECT encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex')
$f$;
-- The quote exactly as the edge builds it for a set of candidates: the phones
-- in p_priced get 2 segments and a cost; every other allowed phone is unpriced
-- (0 segments, no cost) and counted in suppressedCount.
CREATE FUNCTION pg_temp.snapshot(e jsonb, p_priced text[]) RETURNS jsonb LANGUAGE sql AS $f$
  WITH c AS (
    SELECT x,
      (x ->> 'contactMethodId') IS NOT NULL AS has_identity,
      COALESCE((x ->> 'allowed')::boolean, false) AS allowed,
      (x ->> 'normalizedContact') = ANY (p_priced) AS priced
    FROM jsonb_array_elements(e -> 'candidates') x
  )
  SELECT e || jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('a', 64), 'contentHash', repeat('b', 64),
    'quotedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reachableCount', (SELECT count(*) FROM c WHERE has_identity AND allowed AND priced),
    'suppressedCount', (SELECT count(*) FROM c WHERE has_identity AND (NOT allowed OR NOT priced)),
    'unavailableCount', (e ->> 'selectedCount')::int - (SELECT count(*) FROM c WHERE has_identity),
    'unpricedCount', (SELECT count(*) FROM c WHERE has_identity AND allowed AND NOT priced),
    'smsSegments', 2 * (SELECT count(*) FROM c WHERE has_identity AND allowed AND priced),
    'costKind', 'provider_estimate',
    'estimatedCostMinor', 158 * (SELECT count(*) FROM c WHERE has_identity AND allowed AND priced),
    'currency', 'USD', 'rateIds', '["twilio-us"]'::jsonb, 'sourceReferences', '["twilio-us-card"]'::jsonb,
    'candidates', (SELECT COALESCE(jsonb_agg(c.x || CASE
        WHEN c.has_identity AND c.allowed AND c.priced
          THEN '{"segments":2,"allocatedCostMinor":158,"rateId":"twilio-us","sourceReference":"twilio-us-card","smsUnpriced":false}'::jsonb
        WHEN c.has_identity AND c.allowed
          THEN '{"segments":0,"allocatedCostMinor":null,"rateId":null,"sourceReference":null,"smsUnpriced":true}'::jsonb
        ELSE '{"segments":0,"allocatedCostMinor":null,"rateId":null,"sourceReference":null,"smsUnpriced":false}'::jsonb END), '[]'::jsonb)
      FROM c))
$f$;

INSERT INTO auth.users(id, email) VALUES
  ('4273a000-0000-4000-8000-000000000001', 'owner-a@example.test'),
  ('4273a000-0000-4000-8000-000000000002', 'circle-a@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('4273a000-0000-4000-8000-000000000001', 'owner-a@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4273a000-0000-4000-8000-0000000000b1', '4273a000-0000-4000-8000-000000000001', 'Unpriced Adv', 'issue-4273a-unpriced', 'USD', now(), now());
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('4273a000-1000-4000-8000-000000000001', '4273a000-0000-4000-8000-0000000000b1', '4273a000-0000-4000-8000-000000000001',
   'Night', 't4273a-night', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
-- Buyers who said nothing either way, so every phone is opted in (#4297):
-- US (priced), Belgium and the UK (no rate), and one buyer with no phone.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  ('4273a000-1100-4000-8000-000000000001', '4273a000-1000-4000-8000-000000000001', 'us-a@example.test', '+12025550142', 'Us', 1000, 'USD', 'paid', 'legacy', now()),
  ('4273a000-1100-4000-8000-000000000002', '4273a000-1000-4000-8000-000000000001', 'be-a@example.test', '+32470123456', 'Be', 1000, 'USD', 'paid', 'legacy', now()),
  ('4273a000-1100-4000-8000-000000000003', '4273a000-1000-4000-8000-000000000001', 'gb-a@example.test', '+447700900123', 'Gb', 1000, 'USD', 'paid', 'legacy', now()),
  ('4273a000-1100-4000-8000-000000000004', '4273a000-1000-4000-8000-000000000001', 'np-a@example.test', NULL, 'NoPhone', 1000, 'USD', 'paid', 'legacy', now());

SELECT set_config('request.jwt.claim.sub', '4273a000-0000-4000-8000-000000000001', true);

DO $adv$
DECLARE
  o1 uuid := '4273a000-0000-4000-8000-000000000001'; b uuid := '4273a000-0000-4000-8000-0000000000b1';
  r uuid; v jsonb; book uuid := '4273a000-2000-4000-8000-000000000001'; grp uuid;
  c uuid; e jsonb; snap jsonb; x uuid; send jsonb; ok boolean;
  p_us uuid; p_be uuid; p_gb uuid; m_us uuid; m_be uuid;
  priced text[] := ARRAY['+12025550142'];
BEGIN
  FOREACH r IN ARRAY ARRAY['4273a000-1100-4000-8000-000000000001', '4273a000-1100-4000-8000-000000000002',
                           '4273a000-1100-4000-8000-000000000003', '4273a000-1100-4000-8000-000000000004']::uuid[] LOOP
    SELECT public.biz_resolve_brand_person_source(b, o.event_id, 'order', r, NULL, NULL,
             o.buyer_email, o.buyer_phone_e164, o.created_at) INTO v
      FROM public.orders o WHERE o.id = r;
  END LOOP;
  SELECT brand_person_id, id INTO p_us, m_us FROM public.brand_person_contact_methods WHERE brand_id = b AND normalized_value = '+12025550142';
  SELECT brand_person_id, id INTO p_be, m_be FROM public.brand_person_contact_methods WHERE brand_id = b AND normalized_value = '+32470123456';
  SELECT brand_person_id INTO p_gb FROM public.brand_person_contact_methods WHERE brand_id = b AND normalized_value = '+447700900123';

  -- ── A. Book (Your Book) through biz_confirm_marketing_book_send_v1 ───────
  INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
  VALUES (book, o1, b, 'Your Book', jsonb_build_object('kind', 'all_brand_people', 'brand_id', b::text), true);
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273a000-3000-4000-8000-000000000001', o1, b, book, 'A sms', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_book_quote_candidates(o1, c);
  PERFORM pg_temp.chk('A-00 fixture: the Book allows the three phones',
    (SELECT count(*) FROM jsonb_array_elements(e -> 'candidates') y
      WHERE (y ->> 'allowed')::boolean AND y ->> 'normalizedContact' IN ('+12025550142', '+32470123456', '+447700900123')) = 3, e::text);
  snap := pg_temp.snapshot(e, priced);
  PERFORM public.biz_confirm_marketing_book_send_v1(o1, c, '4273a000-4000-4000-8000-000000000001', snap, now() + interval '1 hour');
  SELECT id INTO x FROM public.marketing_book_send_executions WHERE campaign_id = c;
  PERFORM pg_temp.chk('A-01 Book: both unpriced phones sealed suppressed / sms_unpriced_country, no cost',
    (SELECT count(*) FROM public.marketing_book_send_targets t WHERE t.execution_id = x
      AND t.contact_value_digest IN (pg_temp.digest('+32470123456'), pg_temp.digest('+447700900123'))
      AND t.outcome = 'suppressed' AND t.reason = 'sms_unpriced_country' AND t.allocated_cost_minor IS NULL
      AND t.segment_count = 0) = 2,
    (SELECT string_agg(outcome || '/' || reason || '/' || segment_count, ',') FROM public.marketing_book_send_targets WHERE execution_id = x));
  PERFORM pg_temp.chk('A-02 Book: the priced phone stays queued with its segments and cost',
    EXISTS (SELECT 1 FROM public.marketing_book_send_targets t WHERE t.execution_id = x
      AND t.contact_value_digest = pg_temp.digest('+12025550142')
      AND t.outcome = 'queued' AND t.reason = 'allowed' AND t.segment_count = 2 AND t.allocated_cost_minor = 158), '');
  PERFORM pg_temp.chk('A-03 Book: sealed queued targets = sealed reachable, and the execution sum holds',
    (SELECT e2.reachable_count = (SELECT count(*) FROM public.marketing_book_send_targets t WHERE t.execution_id = x AND t.outcome = 'queued')
        AND e2.selected_count = e2.reachable_count + e2.suppressed_count + e2.unavailable_count
        AND e2.reachable_count = 1
        AND e2.suppressed_count = (SELECT count(*) FROM public.marketing_book_send_targets t WHERE t.execution_id = x AND t.outcome = 'suppressed')
      FROM public.marketing_book_send_executions e2 WHERE e2.id = x),
    (SELECT row_to_json(e2)::text FROM public.marketing_book_send_executions e2 WHERE e2.id = x));
  send := public.biz_marketing_book_send_audience(c);
  PERFORM pg_temp.chk('A-04 Book: the send audience returns the priced phone only',
    jsonb_array_length(send -> 'rows') = 1 AND send -> 'rows' -> 0 ->> 'raw_phone' = '+12025550142', send::text);

  -- ── B. Manual group through biz_confirm_marketing_people_send_v2 ─────────
  v := public.biz_create_manual_group_v1(b, 'Mixed numbers', ARRAY[p_us, p_be], '{}', '4273a000-5000-4000-8000-000000000001');
  grp := (v -> 'group' ->> 'groupId')::uuid;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273a000-3000-4000-8000-000000000002', o1, b, grp, 'B sms', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_book_quote_candidates(o1, c);
  snap := pg_temp.snapshot(e, priced);
  PERFORM public.biz_confirm_marketing_people_send_v2(o1, c, '4273a000-4000-4000-8000-000000000002', snap, now() + interval '1 hour');
  SELECT id INTO x FROM public.marketing_book_send_executions WHERE campaign_id = c;
  PERFORM pg_temp.chk('B-01 Manual group: the Belgian phone sealed suppressed / sms_unpriced_country',
    EXISTS (SELECT 1 FROM public.marketing_book_send_targets t WHERE t.execution_id = x
      AND t.brand_person_id = p_be AND t.outcome = 'suppressed' AND t.reason = 'sms_unpriced_country'), '');
  send := public.biz_marketing_people_send_audience_v2(c);
  PERFORM pg_temp.chk('B-02 Manual group: the send audience returns the priced phone only',
    jsonb_array_length(send -> 'rows') = 1 AND send -> 'rows' -> 0 ->> 'raw_phone' = '+12025550142', send::text);

  -- ── C. Everyone unpriced: reach 0 is refused at confirm, nothing sealed ──
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273a000-3000-4000-8000-000000000003', o1, b, book, 'C sms', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_book_quote_candidates(o1, c);
  snap := pg_temp.snapshot(e, ARRAY[]::text[]);
  ok := false;
  BEGIN
    PERFORM public.biz_confirm_marketing_book_send_v1(o1, c, '4273a000-4000-4000-8000-000000000003', snap, now() + interval '1 hour');
  EXCEPTION WHEN check_violation THEN ok := SQLERRM LIKE '%book_blast_zero_recipients%';
  END;
  PERFORM pg_temp.chk('C-01 all unpriced: confirm refuses zero recipients and seals nothing',
    ok AND NOT EXISTS (SELECT 1 FROM public.marketing_book_send_executions WHERE campaign_id = c), '');

  -- ── D. What the trigger must and must not touch, row by row ───────────────
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273a000-3000-4000-8000-000000000004', o1, b, book, 'D shapes', 'sms', '{"kind":"sms","body":"x"}'::jsonb, 'draft')
  RETURNING id INTO c;
  INSERT INTO public.marketing_book_send_executions(
    brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
    selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
    estimated_cost_minor, currency, cost_kind, ratebook_ids, source_references, quoted_at, scheduled_for, send_mode)
  VALUES (b, c, o1, '4273a000-4000-4000-8000-000000000004', 1, repeat('c', 64), repeat('d', 64),
    9, 3, 5, 1, 4, 10, 'USD', 'provider_estimate', '[]', '[]', now(), now() + interval '1 hour', 'scheduled')
  RETURNING id INTO x;
  DECLARE
    pp uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 6));
    mm uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 6));
  BEGIN
    INSERT INTO public.brand_people(id, brand_id, display_name) SELECT pp[i], b, 'Shape ' || i FROM generate_series(1, 6) i;
    INSERT INTO public.brand_person_contact_methods(id, brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state)
    SELECT mm[i], b, pp[i], CASE WHEN i = 1 THEN 'email' ELSE 'phone' END,
           CASE WHEN i = 1 THEN 'shape1@example.test' ELSE '+1202555' || lpad(i::text, 4, '0') END,
           'brand_owned', true, true, 'active'
      FROM generate_series(1, 6) i;
    INSERT INTO public.marketing_book_send_targets(execution_id, brand_person_id, contact_method_id, contact_value_digest, channel, outcome, reason, segment_count, allocated_cost_minor) VALUES
      (x, pp[1], mm[1], pg_temp.digest('shape1@example.test'), 'email', 'queued', 'allowed', 0, NULL),
      (x, pp[2], mm[2], pg_temp.digest('+12025550002'), 'sms', 'queued', 'allowed', 2, 5),
      (x, pp[3], mm[3], pg_temp.digest('+12025550003'), 'sms', 'suppressed', 'can_send_denied', 0, NULL),
      (x, pp[4], mm[4], pg_temp.digest('+12025550004'), 'sms', 'suppressed', 'delivery_denied', 0, NULL),
      (x, pp[5], mm[5], pg_temp.digest('+12025550005'), 'sms', 'suppressed', 'suppressed', 0, NULL),
      (x, pp[6], NULL, NULL, 'sms', 'unavailable', 'channel_unavailable', 0, NULL);
    PERFORM pg_temp.chk('D-01 an email target with 0 segments stays queued / allowed',
      EXISTS (SELECT 1 FROM public.marketing_book_send_targets WHERE execution_id = x AND brand_person_id = pp[1] AND outcome = 'queued' AND reason = 'allowed'), '');
    PERFORM pg_temp.chk('D-02 a priced SMS target stays queued with its cost',
      EXISTS (SELECT 1 FROM public.marketing_book_send_targets WHERE execution_id = x AND brand_person_id = pp[2] AND outcome = 'queued' AND segment_count = 2 AND allocated_cost_minor = 5), '');
    PERFORM pg_temp.chk('D-03 an already-suppressed SMS target keeps its own reason (no relabel)',
      (SELECT array_agg(reason ORDER BY reason) FROM public.marketing_book_send_targets WHERE execution_id = x AND brand_person_id IN (pp[3], pp[4], pp[5]))
        = ARRAY['can_send_denied', 'delivery_denied', 'suppressed'], '');
    PERFORM pg_temp.chk('D-04 an unavailable SMS target stays unavailable / channel_unavailable',
      EXISTS (SELECT 1 FROM public.marketing_book_send_targets WHERE execution_id = x AND brand_person_id = pp[6] AND outcome = 'unavailable' AND reason = 'channel_unavailable'), '');
    -- Circle- and buyer-shaped SMS targets go through the same seal.
    INSERT INTO public.marketing_book_send_targets(execution_id, brand_person_id, recipient_user_id, ring, circle_snapshot_version, contact_method_id, contact_value_digest, channel, outcome, reason, segment_count, allocated_cost_minor) VALUES
      (x, NULL, '4273a000-0000-4000-8000-000000000002', 'follower', 1, NULL, pg_temp.digest('+32470999888'), 'sms', 'queued', 'allowed', 0, 7);
    INSERT INTO public.marketing_book_send_targets(execution_id, buyer_contact_key, contact_value_digest, channel, outcome, reason, segment_count, allocated_cost_minor) VALUES
      (x, repeat('e', 64), pg_temp.digest('+447700900999'), 'sms', 'queued', 'allowed', 0, NULL);
    PERFORM pg_temp.chk('D-05 a circle-shaped queued SMS target with 0 segments is sealed unpriced, cost cleared',
      EXISTS (SELECT 1 FROM public.marketing_book_send_targets WHERE execution_id = x AND recipient_user_id = '4273a000-0000-4000-8000-000000000002'
        AND outcome = 'suppressed' AND reason = 'sms_unpriced_country' AND allocated_cost_minor IS NULL), '');
    PERFORM pg_temp.chk('D-06 a buyer-shaped queued SMS target with 0 segments is sealed unpriced',
      EXISTS (SELECT 1 FROM public.marketing_book_send_targets WHERE execution_id = x AND buyer_contact_key = repeat('e', 64)
        AND outcome = 'suppressed' AND reason = 'sms_unpriced_country'), '');

    -- The sealed rows stay immutable.
    ok := false;
    BEGIN
      UPDATE public.marketing_book_send_targets SET outcome = 'queued' WHERE execution_id = x AND reason = 'sms_unpriced_country';
    EXCEPTION WHEN insufficient_privilege THEN ok := SQLERRM LIKE '%book_blast_execution_immutable%';
    END;
    PERFORM pg_temp.chk('D-07 an unpriced target cannot be flipped back to queued', ok, '');
  END;

  -- The widened reason list keeps every older reason and refuses an unknown one.
  ok := false;
  BEGIN
    INSERT INTO public.marketing_book_send_targets(execution_id, brand_person_id, contact_method_id, contact_value_digest, channel, outcome, reason, segment_count)
    VALUES (x, p_us, m_us, pg_temp.digest('+12025550142'), 'sms', 'suppressed', 'sms_rate_unavailable', 0);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  PERFORM pg_temp.chk('D-08 an unknown reason is still refused', ok, '');

  -- The execution sum check still bites.
  ok := false;
  BEGIN
    INSERT INTO public.marketing_book_send_executions(
      brand_id, campaign_id, actor_id, client_request_id, quote_version, quote_hash, content_hash,
      selected_count, reachable_count, suppressed_count, unavailable_count, sms_segment_count,
      estimated_cost_minor, currency, cost_kind, ratebook_ids, source_references, quoted_at, scheduled_for, send_mode)
    VALUES (b, '4273a000-3000-4000-8000-000000000003', o1, '4273a000-4000-4000-8000-000000000005', 1, repeat('c', 64), repeat('d', 64),
      3, 2, 0, 0, 2, 10, 'USD', 'provider_estimate', '[]', '[]', now(), now(), 'now');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  PERFORM pg_temp.chk('D-09 selected = reachable + suppressed + unavailable is still enforced', ok, '');
END;
$adv$;

-- ── E. Merge before migration: no trigger. The host's sealed counts are the
-- quote's; the only extra queued row is the 0-segment unpriced one, which the
-- edge send guard (smsRateForPhone) is then the only thing holding back. ─────
SAVEPOINT before_merge_first;
ALTER TABLE public.marketing_book_send_targets DISABLE TRIGGER issue_4273_seal_unpriced_sms_target;
DO $merge_first$
DECLARE
  o1 uuid := '4273a000-0000-4000-8000-000000000001'; b uuid := '4273a000-0000-4000-8000-0000000000b1';
  c uuid; e jsonb; x uuid; send jsonb;
BEGIN
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES ('4273a000-3000-4000-8000-000000000005', o1, b, '4273a000-2000-4000-8000-000000000001', 'E sms', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_book_quote_candidates(o1, c);
  PERFORM public.biz_confirm_marketing_book_send_v1(o1, c, '4273a000-4000-4000-8000-000000000006',
    pg_temp.snapshot(e, ARRAY['+12025550142']), now() + interval '1 hour');
  SELECT id INTO x FROM public.marketing_book_send_executions WHERE campaign_id = c;
  PERFORM pg_temp.chk('E-01 merge-first: the confirm still succeeds and the sealed reach is the quote''s (1)',
    (SELECT reachable_count FROM public.marketing_book_send_executions WHERE id = x) = 1, '');
  PERFORM pg_temp.chk('E-02 merge-first: every extra queued SMS target is a 0-segment (unpriced) one',
    NOT EXISTS (SELECT 1 FROM public.marketing_book_send_targets t WHERE t.execution_id = x AND t.outcome = 'queued'
                  AND t.contact_value_digest <> pg_temp.digest('+12025550142') AND t.segment_count <> 0)
    AND (SELECT count(*) FROM public.marketing_book_send_targets t WHERE t.execution_id = x AND t.outcome = 'queued') = 3,
    (SELECT string_agg(outcome || '/' || segment_count, ',') FROM public.marketing_book_send_targets WHERE execution_id = x));
  send := public.biz_marketing_book_send_audience(c);
  PERFORM pg_temp.chk('E-03 merge-first: the send audience hands the unpriced phones to the edge (its guard must hold)',
    jsonb_array_length(send -> 'rows') = 3, send::text);
END;
$merge_first$;
ROLLBACK TO SAVEPOINT before_merge_first;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273a_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 unpriced country (tester adversarial) FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 unpriced country (tester adversarial): PASS';
END;
$report$;

ROLLBACK;
