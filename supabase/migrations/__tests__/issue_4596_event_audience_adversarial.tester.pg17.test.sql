-- #4596 tester (adversarial): the event audience owner under hostile fixtures
-- the implementor suite does not build. Runs on the fully applied chain and
-- rolls back.
--   T1 de-dup by PHONE only (buyer order phone = guest's Book phone)
--   T2 de-dup by ACCOUNT only (buyer_user_id = guest's linked account)
--   T3 one Book person with two going RSVPs to the same event counts once
--   T4 cross-brand links: brand B2's Book person linked to brand B1's RSVP is
--      never in either brand's event audience; B2 asking for B1's event is refused
--   (one live link per RSVP is enforced by brand_person_source_links_active_source_uniq)
--   T6 maybe / waitlisted / cancelled(not_going) flip: a guest who moves from
--      going to maybe leaves the audience on the next read (no cache in SQL)
--   T7 legacy event_buyers delegate == combined reach for email AND sms on a
--      mixed event, one row per address, case-insensitive email
--   T8 discovery: deleted event hidden; anon cannot execute; a stranger is refused
--   T9 rank: marketing_manager is admitted by discovery but the event source is
--      refused by the reach RPC (documents the picker-vs-quote gap)
--   T10 source_name: paid-type event with only RSVP guests is "Guests of"
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4596x_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4596x_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('45961111-0000-4000-8000-' || lpad(p, 12, '0'))::uuid
$f$;
CREATE FUNCTION pg_temp.ev(p text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array('event:' || pg_temp.u(p)::text)
$f$;
CREATE FUNCTION pg_temp.people(p_brand uuid, p text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(DISTINCT i.person_key)::integer FROM public.issue_4273_combined_identities(p_brand, pg_temp.ev(p)) i
$f$;

SET LOCAL session_replication_role = replica;

-- 01 owner of b1+b2; 02 marketing_manager of b1; 03 stranger; 41 guest account
-- who also buys (T2).
INSERT INTO auth.users(id, email)
SELECT pg_temp.u(x), 't4596x-' || x || '@example.test' FROM unnest(ARRAY['01', '02', '03', '41']) x;
INSERT INTO public.creator_accounts(id, email) VALUES (pg_temp.u('01'), 't4596x-01@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('01'), 'Adv One', 'issue-4596x-one', 'USD', now(), now()),
  (pg_temp.u('b2'), pg_temp.u('01'), 'Adv Two', 'issue-4596x-two', 'USD', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('02'), 'marketing_manager', now());
-- e1 mixed (paid type, buyers + guests); e2 paid-type event with RSVP guests only;
-- e3 a deleted RSVP event with a going guest.
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme, deleted_at) VALUES
  (pg_temp.u('e1'), pg_temp.u('b1'), pg_temp.u('01'), 'Adv Mixed', 't4596x-m', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb, NULL),
  (pg_temp.u('e2'), pg_temp.u('b1'), pg_temp.u('01'), 'Adv Free Door', 't4596x-f', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb, NULL),
  (pg_temp.u('e3'), pg_temp.u('b1'), pg_temp.u('01'), 'Adv Deleted', 't4596x-d', 'rsvp', 'scheduled', 'public', 'UTC', '{}'::jsonb, now());

-- Book (b1): a1 phone-twin of buyer o1; a2 account-twin of buyer o2 (account 41);
-- a3 RSVPs twice; a4 flips to maybe; a5 guest on e2; a6 guest on deleted e3.
-- Book (b2): z1 linked (wrongly) to b1's RSVP r7.
INSERT INTO public.brand_people(id, brand_id, display_name, record_status, linked_user_id) VALUES
  (pg_temp.u('a1'), pg_temp.u('b1'), 'Phone Twin', 'active', NULL),
  (pg_temp.u('a2'), pg_temp.u('b1'), 'Account Twin', 'active', pg_temp.u('41')),
  (pg_temp.u('a3'), pg_temp.u('b1'), 'Double RSVP', 'active', NULL),
  (pg_temp.u('a4'), pg_temp.u('b1'), 'Flipper', 'active', NULL),
  (pg_temp.u('a5'), pg_temp.u('b1'), 'Free Door Guest', 'active', NULL),
  (pg_temp.u('a6'), pg_temp.u('b1'), 'Deleted Event Guest', 'active', NULL),
  (pg_temp.u('ff1'), pg_temp.u('b2'), 'Other Brand Book', 'active', NULL);
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  (pg_temp.u('b1'), pg_temp.u('a1'), 'email', 'phonetwin-book@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a1'), 'phone', '+2348031250001', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a2'), 'email', 'acct-book@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a3'), 'email', 'Double@Example.test', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a4'), 'email', 'flip@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a5'), 'email', 'free@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a6'), 'email', 'gone@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b2'), pg_temp.u('ff1'), 'email', 'otherbook@example.test', 'brand_owned', true, true, 'active', 'unknown');
INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status) VALUES
  (pg_temp.u('dd01'), pg_temp.u('e1'), 'Phone Twin', 'phonetwin-book@example.test', '+2348031250001', 'going', 'approved'),
  (pg_temp.u('dd02'), pg_temp.u('e1'), 'Account Twin', 'acct-book@example.test', '+2348031250002', 'going', 'approved'),
  (pg_temp.u('dd03'), pg_temp.u('e1'), 'Double RSVP', 'double@example.test', '+2348031250003', 'going', 'approved'),
  (pg_temp.u('dd04'), pg_temp.u('e1'), 'Double RSVP', 'double-alt@example.test', '+2348031250003', 'going', 'approved'),
  (pg_temp.u('dd05'), pg_temp.u('e1'), 'Flipper', 'flip@example.test', '+2348031250005', 'going', 'approved'),
  (pg_temp.u('dd06'), pg_temp.u('e2'), 'Free Door Guest', 'free@example.test', '+2348031250006', 'going', 'approved'),
  (pg_temp.u('dd07'), pg_temp.u('e1'), 'Cross Linked', 'cross@example.test', '+2348031250007', 'going', 'approved'),
  (pg_temp.u('dd08'), pg_temp.u('e3'), 'Deleted Event Guest', 'gone@example.test', '+2348031250008', 'going', 'approved');
INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('a1'), 'event_rsvp', pg_temp.u('dd01'), 'normalized_address', now()),
  (pg_temp.u('b1'), pg_temp.u('a2'), 'event_rsvp', pg_temp.u('dd02'), 'normalized_address', now()),
  (pg_temp.u('b1'), pg_temp.u('a3'), 'event_rsvp', pg_temp.u('dd03'), 'normalized_address', now()),
  (pg_temp.u('b1'), pg_temp.u('a3'), 'event_rsvp', pg_temp.u('dd04'), 'normalized_address', now()),
  (pg_temp.u('b1'), pg_temp.u('a4'), 'event_rsvp', pg_temp.u('dd05'), 'normalized_address', now()),
  (pg_temp.u('b1'), pg_temp.u('a5'), 'event_rsvp', pg_temp.u('dd06'), 'normalized_address', now()),
  (pg_temp.u('b1'), pg_temp.u('a6'), 'event_rsvp', pg_temp.u('dd08'), 'normalized_address', now()),
  -- T4: brand b2's link to brand b1's RSVP.
  (pg_temp.u('b2'), pg_temp.u('ff1'), 'event_rsvp', pg_temp.u('dd07'), 'normalized_address', now());
-- o1 shares ONLY the phone with a1 (different email); o2 shares ONLY the account
-- with a2 (different email and phone); o3 a plain buyer, upper-case email.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, buyer_user_id, total_cents, currency, payment_status, source, confirmed_at) VALUES
  (pg_temp.u('ee01'), pg_temp.u('e1'), 'phonetwin-order@example.test', '+2348031250001', 'Phone Twin', NULL, 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('ee02'), pg_temp.u('e1'), 'acct-order@example.test', '+2348031259999', 'Account Twin', pg_temp.u('41'), 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('ee03'), pg_temp.u('e1'), 'PLAIN@Example.test', '+2348031250010', 'Plain Buyer', NULL, 1000, 'USD', 'paid', 'legacy', now());

SET LOCAL session_replication_role = origin;
UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
SELECT set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true);

-- e1 people: {a1,o1} {a2,o2} {a3} {a4} {o3} = 5.
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); s jsonb; n integer;
BEGIN
  PERFORM pg_temp.chk('T1 a buyer and a guest sharing only a phone are one person',
    (SELECT count(DISTINCT i.person_key) FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i
      WHERE i.brand_person_id = pg_temp.u('a1') OR i.buyer_email = 'phonetwin-order@example.test') = 1, '');
  PERFORM pg_temp.chk('T2 a buyer and a guest sharing only an account are one person',
    (SELECT count(DISTINCT i.person_key) FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i
      WHERE i.brand_person_id = pg_temp.u('a2') OR i.buyer_email = 'acct-order@example.test') = 1, '');
  PERFORM pg_temp.chk('T3 two going RSVPs of one Book person are one node',
    (SELECT count(*) FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i
      WHERE i.brand_person_id = pg_temp.u('a3')) = 1, '');
  n := pg_temp.people(b, 'e1');
  PERFORM pg_temp.chk('T1-3 mixed event is 5 people', n = 5, n::text);
  s := public.biz_marketing_combined_audience_summary_v1(o, b, pg_temp.ev('e1'));
  PERFORM pg_temp.chk('T1-3 summary peopleCount = 5', (s ->> 'peopleCount')::integer = 5, s::text);
  PERFORM pg_temp.chk('T4/T5 no other-brand Book person in b1''s event audience',
    NOT EXISTS (SELECT 1 FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i
                 WHERE i.brand_person_id = pg_temp.u('ff1')), '');
  PERFORM pg_temp.chk('T4 b2 asking identities for b1''s event gets nobody',
    NOT EXISTS (SELECT 1 FROM public.issue_4273_combined_identities(pg_temp.u('b2'), pg_temp.ev('e1'))), '');
  BEGIN
    PERFORM public.biz_marketing_combined_audience_summary_v1(o, pg_temp.u('b2'), pg_temp.ev('e1'));
    PERFORM pg_temp.chk('T4 b2 summary on b1''s event refused', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('T4 b2 summary on b1''s event refused', SQLERRM = 'book_blast_audience_not_found', SQLERRM);
  END;
END $t$;

-- T6: going -> maybe -> not_going: out of the audience on the next read.
DO $t$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.event_rsvps SET rsvp_status = 'maybe' WHERE id = pg_temp.u('dd05');
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.chk('T6 a guest who moves to maybe leaves the audience',
    NOT EXISTS (SELECT 1 FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i
                 WHERE i.brand_person_id = pg_temp.u('a4')) AND pg_temp.people(b, 'e1') = 4, pg_temp.people(b, 'e1')::text);
  SET LOCAL session_replication_role = replica;
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = pg_temp.u('dd05');
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.chk('T6 a cancelled (not_going) guest stays out', pg_temp.people(b, 'e1') = 4, '');
END $t$;

-- T7: the legacy event_buyers delegate equals the combined reach on both channels.
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); a uuid; r jsonb; reach integer; ch text;
BEGIN
  INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
  VALUES (pg_temp.u('d1'), o, b, 'Buyers of Adv Mixed',
          jsonb_build_object('kind', 'event_buyers', 'event_id', pg_temp.u('e1')::text), true) RETURNING id INTO a;
  FOREACH ch IN ARRAY ARRAY['email', 'sms'] LOOP
    INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
    VALUES (CASE ch WHEN 'email' THEN pg_temp.u('c1') ELSE pg_temp.u('c2') END, o, b, a, 'Legacy ' || ch, ch,
            CASE ch WHEN 'email' THEN '{"kind":"email","subject":"Hi","body_html":"<p>Hi</p>"}'::jsonb
                    ELSE '{"kind":"sms","body":"Hi"}'::jsonb END, 'draft');
    r := public.biz_marketing_event_send_audience_v1(CASE ch WHEN 'email' THEN pg_temp.u('c1') ELSE pg_temp.u('c2') END);
    reach := public.biz_marketing_combined_audience_reach_v1(o, b, pg_temp.ev('e1'), ch);
    PERFORM pg_temp.chk('T7 legacy rows = combined reach on ' || ch,
      jsonb_array_length(r -> 'rows') = reach AND reach > 0, jsonb_array_length(r -> 'rows')::text || ' vs ' || reach::text);
    PERFORM pg_temp.chk('T7 one row per address on ' || ch,
      (SELECT count(*) FROM jsonb_array_elements(r -> 'rows') x)
      = (SELECT count(DISTINCT lower(COALESCE(x ->> 'raw_email', x ->> 'raw_phone'))) FROM jsonb_array_elements(r -> 'rows') x),
      r::text);
    PERFORM pg_temp.chk('T7 no other-brand contact on ' || ch,
      NOT (r::text LIKE '%otherbook@example.test%' OR r::text LIKE '%cross@example.test%'), r::text);
  END LOOP;
  PERFORM pg_temp.chk('T7 email rows include the RSVP-only guest and the plain buyer (case-folded)',
    (r IS NOT NULL) AND (SELECT (public.biz_marketing_event_send_audience_v1(pg_temp.u('c1')) -> 'rows')
       @> '[{"raw_email":"plain@example.test"}]'::jsonb), '');
END $t$;

-- T8 / T9 / T10: discovery, grants, rank, naming.
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); d jsonb; ok boolean;
BEGIN
  d := public.biz_marketing_event_audiences_v1(o, b);
  PERFORM pg_temp.chk('T8 deleted event is not discovered',
    NOT (d @> jsonb_build_array(jsonb_build_object('eventId', pg_temp.u('e3')))), d::text);
  PERFORM pg_temp.chk('T8 discovery people for the mixed event = summary (4 after T6)',
    d @> jsonb_build_array(jsonb_build_object('eventId', pg_temp.u('e1'), 'peopleCount', 4)), d::text);
  PERFORM pg_temp.chk('T10 paid-type event with RSVP guests only is discovered with guestCount 1, buyerCount 0',
    d @> jsonb_build_array(jsonb_build_object('eventId', pg_temp.u('e2'), 'guestCount', 1, 'buyerCount', 0)), d::text);
  PERFORM pg_temp.chk('T10 its name is "Guests of"',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e2')::text) = 'Guests of Adv Free Door', '');
  PERFORM pg_temp.chk('T10 mixed event name is "People at"',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e1')::text) = 'People at Adv Mixed', '');
  PERFORM pg_temp.chk('T8 anon cannot execute discovery',
    NOT has_function_privilege('anon', 'public.biz_marketing_event_audiences_v1(uuid, uuid)', 'EXECUTE'), '');
  PERFORM pg_temp.chk('T8 identities stays service-only (no authenticated/anon execute)',
    NOT has_function_privilege('authenticated', 'public.issue_4273_combined_identities(uuid, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_combined_identities(uuid, jsonb)', 'EXECUTE'), '');
  -- stranger
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('03')::text, true);
  BEGIN
    PERFORM public.biz_marketing_event_audiences_v1(pg_temp.u('03'), b);
    PERFORM pg_temp.chk('T8 stranger refused', false, 'no error');
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.chk('T8 stranger refused', SQLSTATE = '42501', SQLERRM); END;
  -- spoofed actor: auth.uid() is the stranger, p_actor_id is the owner
  BEGIN
    PERFORM public.biz_marketing_event_audiences_v1(o, b);
    PERFORM pg_temp.chk('T8 spoofed actor refused', false, 'no error');
  EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.chk('T8 spoofed actor refused', SQLSTATE = '42501', SQLERRM); END;
  -- T9 marketing_manager
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('02')::text, true);
  d := public.biz_marketing_event_audiences_v1(pg_temp.u('02'), b);
  PERFORM pg_temp.chk('T9 marketing_manager sees event rows in discovery', jsonb_array_length(d) >= 2, d::text);
  ok := false;
  BEGIN
    PERFORM public.biz_marketing_combined_audience_reach_v1(pg_temp.u('02'), b, pg_temp.ev('e1'), 'email');
  EXCEPTION WHEN OTHERS THEN ok := (SQLSTATE = '42501');
  END;
  -- Recorded as an observation in the verdict, not a failure: discovery admits
  -- marketing_manager (spec §5.3) while the event source itself needs event_manager (#4273).
  RAISE NOTICE 'T9 observation: marketing_manager event reach refused = %', ok;
  PERFORM set_config('request.jwt.claim.sub', o::text, true);
END $t$;

DO $done$
DECLARE r record; n integer;
BEGIN
  SELECT count(*) INTO n FROM t4596x_fail;
  FOR r IN SELECT line FROM t4596x_fail ORDER BY id LOOP RAISE WARNING 'FAIL %', r.line; END LOOP;
  IF n > 0 THEN RAISE EXCEPTION 'issue_4596 tester adversarial suite: % failure(s)', n; END IF;
  RAISE NOTICE 'issue_4596 tester adversarial suite: all checks passed';
END $done$;

ROLLBACK;
