-- #4596 — an event audience is its paid buyers plus its going RSVP guests,
-- answered by one owner, de-duplicated, with the Book's consent rules; the
-- discovery list shows RSVP events; the legacy event_buyers lane delegates to
-- the same owner; zero reachable is refused at confirm; failed campaigns that
-- reached nobody carry a reason. Runs on the fully applied chain and rolls back.
--
-- INVARIANT I-4596-EVENT-AUDIENCE-ONE-OWNER: every count and send for an event:<id> audience comes from issue_4273_combined_identities; paid buyers plus going+approved RSVP guests via the Book, de-duplicated.
-- MINGLA-INVARIANT: I-4596-EVENT-AUDIENCE-ONE-OWNER | issue #4596 | Every count and send for an event:<id> audience (combined lane and the legacy event_buyers lane) comes from issue_4273_combined_identities: paid buyers plus going+approved RSVP guests via the Book, de-duplicated.
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4596_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4596_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('45960000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid
$f$;
CREATE FUNCTION pg_temp.ev(p text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array('event:' || pg_temp.u(p)::text)
$f$;
-- The quote snapshot the edge would seal (same shape as the #4273 suites).
CREATE FUNCTION pg_temp.snap(p_env jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('a', 64), 'contentHash', repeat('b', 64),
    'quotedAt', now(), 'brandId', p_env -> 'brandId', 'content', p_env -> 'content',
    'audienceId', p_env -> 'audienceId', 'audienceKind', p_env -> 'audienceKind',
    'audienceVersion', p_env -> 'audienceVersion', 'selectedCount', p_env -> 'selectedCount',
    'reachableCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                        WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'suppressedCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                         WHERE NOT (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'unavailableCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                          WHERE x ->> 'normalizedContact' IS NULL),
    'smsSegments', 0, 'costKind', 'not_metered', 'estimatedCostMinor', NULL, 'currency', NULL,
    'candidates', p_env -> 'candidates')
$f$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Fixture rows go in with triggers off: the RSVP approval / ingest triggers
-- would otherwise rewrite the statuses and links this suite pins.
SET LOCAL session_replication_role = replica;

-- 01 owner of b1 and b2. 09 a stranger. 31 a guest with an account.
INSERT INTO auth.users(id, email)
SELECT pg_temp.u(x), 't4596-' || x || '@example.test' FROM unnest(ARRAY['01', '07', '08', '09', '31']) x;
INSERT INTO public.creator_accounts(id, email) VALUES (pg_temp.u('01'), 't4596-01@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('01'), 'Guests One', 'issue-4596-one', 'USD', now(), now()),
  (pg_temp.u('b2'), pg_temp.u('01'), 'Guests Two', 'issue-4596-two', 'USD', now(), now());
-- eR an RSVP event, eP a paid event, eM a mixed event, eZ an RSVP event whose
-- only guest opted out, eE an RSVP event with no guests, eX another brand's RSVP.
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  (pg_temp.u('e1'), pg_temp.u('b1'), pg_temp.u('01'), 'Rooftop RSVP', 't4596-r', 'rsvp', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.u('e2'), pg_temp.u('b1'), pg_temp.u('01'), 'Paid Night', 't4596-p', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.u('e3'), pg_temp.u('b1'), pg_temp.u('01'), 'Mixed Party', 't4596-m', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.u('e4'), pg_temp.u('b1'), pg_temp.u('01'), 'Opted Out', 't4596-z', 'rsvp', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.u('e5'), pg_temp.u('b1'), pg_temp.u('01'), 'No Guests', 't4596-e', 'rsvp', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.u('e6'), pg_temp.u('b2'), pg_temp.u('01'), 'Other Brand', 't4596-x', 'rsvp', 'scheduled', 'public', 'UTC', '{}'::jsonb);

-- Book people (brand b1 unless noted). p10 merged into p01, p11 deleted.
INSERT INTO public.brand_people(id, brand_id, display_name, record_status, merged_into_person_id, deleted_at, linked_user_id) VALUES
  (pg_temp.u('a01'), pg_temp.u('b1'), 'Ada Guest', 'active', NULL, NULL, pg_temp.u('31')),
  (pg_temp.u('a02'), pg_temp.u('b1'), 'Bo Unsub', 'active', NULL, NULL, NULL),
  (pg_temp.u('a03'), pg_temp.u('b1'), 'Cy Stop', 'active', NULL, NULL, NULL),
  (pg_temp.u('a04'), pg_temp.u('b1'), 'Maybe Guest', 'active', NULL, NULL, NULL),
  (pg_temp.u('a05'), pg_temp.u('b1'), 'Waitlisted Guest', 'active', NULL, NULL, NULL),
  (pg_temp.u('a06'), pg_temp.u('b1'), 'Pending Guest', 'active', NULL, NULL, NULL),
  (pg_temp.u('a07'), pg_temp.u('b1'), 'Denied Guest', 'active', NULL, NULL, NULL),
  (pg_temp.u('a08'), pg_temp.u('b1'), 'Not Going', 'active', NULL, NULL, NULL),
  (pg_temp.u('a09'), pg_temp.u('b1'), 'Detached Link', 'active', NULL, NULL, NULL),
  (pg_temp.u('a10'), pg_temp.u('b1'), 'Merged Away', 'merged', pg_temp.u('a01'), NULL, NULL),
  (pg_temp.u('a11'), pg_temp.u('b1'), 'Deleted Person', 'deleted', NULL, now(), NULL),
  (pg_temp.u('a13'), pg_temp.u('b1'), 'Plus One', 'active', NULL, NULL, NULL),
  (pg_temp.u('a21'), pg_temp.u('b1'), 'Mix Shared', 'active', NULL, NULL, NULL),
  (pg_temp.u('a22'), pg_temp.u('b1'), 'Mix Guest Only', 'active', NULL, NULL, NULL),
  (pg_temp.u('a41'), pg_temp.u('b1'), 'Zed Optout', 'active', NULL, NULL, NULL),
  (pg_temp.u('a61'), pg_temp.u('b2'), 'Other Brand Guest', 'active', NULL, NULL, NULL);
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state)
SELECT CASE WHEN x = '61' THEN pg_temp.u('b2') ELSE pg_temp.u('b1') END, pg_temp.u('a' || x), 'email',
       'g' || x || '@example.test', 'brand_owned', true, true, 'active', 'unknown'
  FROM unnest(ARRAY['01', '02', '03', '04', '05', '06', '07', '08', '09', '13', '21', '22', '41', '61']) x;
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  (pg_temp.u('b1'), pg_temp.u('a01'), 'phone', '+2348031259601', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a03'), 'phone', '+2348031259603', 'brand_owned', true, true, 'active', 'unknown');
-- The shared mixed person: the Book holds the buyer's email.
UPDATE public.brand_person_contact_methods SET normalized_value = 'mix@example.test'
 WHERE brand_person_id = pg_temp.u('a21') AND channel = 'email';

-- RSVPs. r01..r03 going/approved and linked; r04..r08 excluded statuses;
-- r09 detached link; r10 linked to a merged person; r11 to a deleted person;
-- r12 going/approved with no link (waiting on a duplicate check).
INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status) VALUES
  (pg_temp.u('ee01'), pg_temp.u('e1'), 'Ada Guest', 'g01@example.test', '+2348031259601', 'going', 'approved'),
  (pg_temp.u('ee02'), pg_temp.u('e1'), 'Bo Unsub', 'g02@example.test', '+2348031259602', 'going', 'approved'),
  (pg_temp.u('ee03'), pg_temp.u('e1'), 'Cy Stop', 'g03@example.test', '+2348031259603', 'going', 'approved'),
  (pg_temp.u('ee04'), pg_temp.u('e1'), 'Maybe Guest', 'g04@example.test', '+2348031259604', 'maybe', 'approved'),
  (pg_temp.u('ee05'), pg_temp.u('e1'), 'Waitlisted Guest', 'g05@example.test', '+2348031259605', 'waitlisted', 'approved'),
  (pg_temp.u('ee06'), pg_temp.u('e1'), 'Pending Guest', 'g06@example.test', '+2348031259606', 'going', 'pending'),
  (pg_temp.u('ee07'), pg_temp.u('e1'), 'Denied Guest', 'g07@example.test', '+2348031259607', 'going', 'denied'),
  (pg_temp.u('ee08'), pg_temp.u('e1'), 'Not Going', 'g08@example.test', '+2348031259608', 'not_going', 'approved'),
  (pg_temp.u('ee09'), pg_temp.u('e1'), 'Detached Link', 'g09@example.test', '+2348031259609', 'going', 'approved'),
  (pg_temp.u('ee10'), pg_temp.u('e1'), 'Merged Away', 'g10@example.test', '+2348031259610', 'going', 'approved'),
  (pg_temp.u('ee11'), pg_temp.u('e1'), 'Deleted Person', 'g11@example.test', '+2348031259611', 'going', 'approved'),
  (pg_temp.u('ee12'), pg_temp.u('e1'), 'Unlinked Guest', 'g12@example.test', '+2348031259612', 'going', 'approved'),
  (pg_temp.u('ee21'), pg_temp.u('e3'), 'Mix Shared', 'mix@example.test', '+2348031259621', 'going', 'approved'),
  (pg_temp.u('ee22'), pg_temp.u('e3'), 'Mix Guest Only', 'g22@example.test', '+2348031259622', 'going', 'approved'),
  (pg_temp.u('ee41'), pg_temp.u('e4'), 'Zed Optout', 'g41@example.test', '+2348031259641', 'going', 'approved'),
  (pg_temp.u('ee61'), pg_temp.u('e6'), 'Other Brand Guest', 'g61@example.test', '+2348031259661', 'going', 'approved');
INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at, detached_at)
SELECT CASE WHEN x = '61' THEN pg_temp.u('b2') ELSE pg_temp.u('b1') END, pg_temp.u('a' || x), 'event_rsvp', pg_temp.u('ee' || x),
       'normalized_address', now(), CASE WHEN x = '09' THEN now() END
  FROM unnest(ARRAY['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '21', '22', '41', '61']) x;
-- A plus-one of r01 is never a guest of the event audience.
INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at)
VALUES (pg_temp.u('b1'), pg_temp.u('a13'), 'rsvp_plus_one', pg_temp.u('ee01'), 'normalized_address', now());

-- Paid orders: eP has two buyers; eM has the shared person plus one buyer only.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  (pg_temp.u('dd01'), pg_temp.u('e2'), 'p1@example.test', '+2348031259701', 'Paid One', 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('dd02'), pg_temp.u('e2'), 'p2@example.test', '+2348031259702', 'Paid Two', 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('dd03'), pg_temp.u('e3'), 'MIX@example.test', '+2348031259621', 'Mix Shared', 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('dd04'), pg_temp.u('e3'), 'buyonly@example.test', '+2348031259704', 'Buyer Only', 1000, 'USD', 'paid', 'legacy', now());

-- Opt-outs: g02 brand unsubscribe on email; g03's phone is STOPped; g41 global.
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, brand_id, reason) VALUES
  ('g02@example.test', 'email', 'brand', pg_temp.u('b1'), 't'),
  ('g41@example.test', 'all', 'global', NULL, 't');
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (NULL, '+2348031259603', 'sms', 'all', 'stop_keyword');

-- Fix pass 1: 07 an event_manager of b1 (reads the event Blasts roster
-- under event_rsvps_host_read); 08 a scanner of b1 (does not).
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('07'), 'event_manager', now()),
  (pg_temp.u('b1'), pg_temp.u('08'), 'scanner', now());

SET LOCAL session_replication_role = origin;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
SELECT set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true);

-- ── SC-1 / SC-3: who is in an RSVP event's audience ─────────────────────────
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); s jsonb; ids text;
BEGIN
  SELECT string_agg(i.brand_person_id::text, ',' ORDER BY i.brand_person_id) INTO ids
    FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i;
  PERFORM pg_temp.chk('SC-1 identities hold exactly the three linked going+approved active guests',
    ids = concat_ws(',', pg_temp.u('a01'), pg_temp.u('a02'), pg_temp.u('a03')), ids);
  PERFORM pg_temp.chk('SC-1 every RSVP identity is a Book node under the event key',
    NOT EXISTS (SELECT 1 FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i
                 WHERE i.subject <> 'book' OR i.source_key <> 'event:' || pg_temp.u('e1')::text), '');
  s := public.biz_marketing_combined_audience_summary_v1(o, b, pg_temp.ev('e1'));
  PERFORM pg_temp.chk('SC-1 summary peopleCount = 3', (s ->> 'peopleCount')::integer = 3, s::text);
  PERFORM pg_temp.chk('SC-3 maybe, waitlisted, pending, denied, not_going, detached, merged, deleted and plus-ones are out',
    NOT EXISTS (SELECT 1 FROM public.issue_4273_combined_identities(b, pg_temp.ev('e1')) i
                 WHERE i.brand_person_id IN (pg_temp.u('a04'), pg_temp.u('a05'), pg_temp.u('a06'), pg_temp.u('a07'),
                   pg_temp.u('a08'), pg_temp.u('a09'), pg_temp.u('a10'), pg_temp.u('a11'), pg_temp.u('a13'))), '');
  PERFORM pg_temp.chk('SC-3 another brand''s event yields nobody for this brand',
    NOT EXISTS (SELECT 1 FROM public.issue_4273_combined_identities(b, pg_temp.ev('e6'))), '');
  BEGIN
    PERFORM public.biz_marketing_combined_audience_summary_v1(o, b, pg_temp.ev('e6'));
    PERFORM pg_temp.chk('SC-3 another brand''s event key is refused', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('SC-3 another brand''s event key is refused', SQLERRM = 'book_blast_audience_not_found', SQLERRM);
  END;
  -- Paid buyers are unchanged.
  s := public.biz_marketing_combined_audience_summary_v1(o, b, pg_temp.ev('e2'));
  PERFORM pg_temp.chk('paid event keeps its two buyers', (s ->> 'peopleCount')::integer = 2, s::text);
END $t$;

-- ── SC-2: a buyer and a guest who share an email are one person ─────────────
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); s jsonb; v integer;
BEGIN
  s := public.biz_marketing_combined_audience_summary_v1(o, b, pg_temp.ev('e3'));
  PERFORM pg_temp.chk('SC-2 mixed event counts shared + buyer-only + guest-only = 3', (s ->> 'peopleCount')::integer = 3, s::text);
  v := public.biz_marketing_combined_audience_reach_v1(o, b, pg_temp.ev('e3'), 'email');
  PERFORM pg_temp.chk('SC-2 email reach counts the shared address once', v = 3, v::text);
END $t$;

-- ── SC-4: opted-out guests count but are not reachable ──────────────────────
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); em integer; sm integer; d text;
BEGIN
  em := public.biz_marketing_combined_audience_reach_v1(o, b, pg_temp.ev('e1'), 'email');
  sm := public.biz_marketing_combined_audience_reach_v1(o, b, pg_temp.ev('e1'), 'sms');
  SELECT string_agg(x.normalized_contact || '=' || x.allowed, ',' ORDER BY x.normalized_contact) INTO d
    FROM public.issue_4273_decided_people(o, b, pg_temp.ev('e1'), 'email') x;
  PERFORM pg_temp.chk('SC-4 email: the brand unsubscribe leaves 2 of 3 reachable', em = 2, em::text || ' ' || COALESCE(d, ''));
  PERFORM pg_temp.chk('SC-4 email: the unsubscribed guest is decided not allowed',
    d LIKE '%g02@example.test=false%', COALESCE(d, ''));
  PERFORM pg_temp.chk('SC-4 sms: the STOPped phone and the guest with no phone leave 1 reachable', sm = 1, sm::text);
END $t$;

-- ── Discovery (SC-8) and its actor check ────────────────────────────────────
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); d jsonb; r jsonb;
BEGIN
  d := public.biz_marketing_event_audiences_v1(o, b);
  SELECT x INTO r FROM jsonb_array_elements(d) x WHERE x ->> 'eventId' = pg_temp.u('e1')::text;
  PERFORM pg_temp.chk('SC-8 an RSVP-only event is discovered with its guests',
    r IS NOT NULL AND r ->> 'eventType' = 'rsvp' AND (r ->> 'guestCount')::integer = 3
    AND r ->> 'name' = 'Guests of Rooftop RSVP'
    AND (r ->> 'buyerCount')::integer = 0 AND (r ->> 'peopleCount')::integer = 3, COALESCE(r::text, d::text));
  PERFORM pg_temp.chk('D6 unlinked, detached, merged and deleted going guests are pending review',
    (r ->> 'pendingReviewCount')::integer = 4, COALESCE(r::text, ''));
  SELECT x INTO r FROM jsonb_array_elements(d) x WHERE x ->> 'eventId' = pg_temp.u('e3')::text;
  PERFORM pg_temp.chk('mixed event: 2 buyers, 2 guests, 3 people',
    (r ->> 'buyerCount')::integer = 2 AND (r ->> 'guestCount')::integer = 2 AND (r ->> 'peopleCount')::integer = 3,
    COALESCE(r::text, ''));
  PERFORM pg_temp.chk('discovery peopleCount = source_totals peopleCount',
    (r ->> 'peopleCount')::integer = (public.issue_4273_source_totals(b, pg_temp.ev('e3')) ->> 'peopleCount')::integer, '');
  PERFORM pg_temp.chk('an event with no buyers and no going guests is not listed',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d) x WHERE x ->> 'eventId' = pg_temp.u('e5')::text), d::text);
  PERFORM pg_temp.chk('another brand''s event is not listed',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d) x WHERE x ->> 'eventId' = pg_temp.u('e6')::text), d::text);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('09')::text, true);
  BEGIN
    PERFORM public.biz_marketing_event_audiences_v1(pg_temp.u('09'), b);
    PERFORM pg_temp.chk('discovery refuses a non-member', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('discovery refuses a non-member', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    PERFORM public.biz_marketing_event_audiences_v1(o, b);
    PERFORM pg_temp.chk('discovery refuses an actor who is not the caller', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('discovery refuses an actor who is not the caller', SQLSTATE = '42501', SQLERRM);
  END;
  PERFORM set_config('request.jwt.claim.sub', o::text, true);
END $t$;

-- ── SC-5 server half: summary = reach = quote = sealed send rows ────────────
DO $t$
DECLARE
  b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); a uuid; c uuid; q jsonb; sent jsonb;
  reach integer; quoted integer;
BEGIN
  a := (public.biz_get_or_create_marketing_combined_audience_v1(o, b, pg_temp.ev('e1')) ->> 'audienceId')::uuid;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (pg_temp.u('c1'), o, b, a, 'Guests', 'email',
          '{"kind":"email","subject":"Hi","body_html":"<p>Doors at 9.</p>"}'::jsonb, 'draft') RETURNING id INTO c;
  reach := public.biz_marketing_combined_audience_reach_v1(o, b, pg_temp.ev('e1'), 'email');
  q := public.biz_marketing_combined_quote_candidates_v1(o, c);
  SELECT count(*)::integer INTO quoted FROM jsonb_array_elements(q -> 'candidates') x
   WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL;
  PERFORM pg_temp.chk('SC-5 quote reachable = reach', quoted = reach AND reach = 2, quoted || '/' || reach);
  PERFORM public.biz_confirm_marketing_combined_send_v1(o, c, pg_temp.u('f1'), pg_temp.snap(q), NULL);
  sent := public.biz_marketing_combined_send_audience_v1(c);
  PERFORM pg_temp.chk('SC-5 sealed send rows = quote reachable', jsonb_array_length(sent -> 'rows') = quoted, sent::text);
  PERFORM pg_temp.chk('SC-5 the opted-out guest is not sent to',
    NOT (sent -> 'rows') @> '[{"raw_email":"g02@example.test"}]'::jsonb, sent::text);
END $t$;

-- ── SC-6: an all-opted-out RSVP event is refused at confirm ─────────────────
DO $t$
DECLARE b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); a uuid; c uuid; q jsonb;
BEGIN
  a := (public.biz_get_or_create_marketing_combined_audience_v1(o, b, pg_temp.ev('e4')) ->> 'audienceId')::uuid;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (pg_temp.u('c2'), o, b, a, 'Nobody', 'email',
          '{"kind":"email","subject":"Hi","body_html":"<p>Hi</p>"}'::jsonb, 'draft') RETURNING id INTO c;
  q := public.biz_marketing_combined_quote_candidates_v1(o, c);
  BEGIN
    PERFORM public.biz_confirm_marketing_combined_send_v1(o, c, pg_temp.u('f2'), pg_temp.snap(q), NULL);
    PERFORM pg_temp.chk('SC-6 confirm refuses zero reachable', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('SC-6 confirm refuses zero reachable', SQLERRM = 'book_blast_zero_recipients', SQLERRM);
  END;
  PERFORM pg_temp.chk('SC-6 the campaign never turned scheduled',
    (SELECT status FROM public.marketing_campaigns WHERE id = c) = 'draft', '');
END $t$;

-- ── A2 Q4: the legacy event_buyers lane delegates to the same owner ─────────
DO $t$
DECLARE
  b uuid := pg_temp.u('b1'); o uuid := pg_temp.u('01'); a uuid; c uuid; r jsonb; reach integer;
BEGIN
  INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
  VALUES (pg_temp.u('d3'), o, b, 'Buyers of Mixed Party',
          jsonb_build_object('kind', 'event_buyers', 'event_id', pg_temp.u('e3')::text), true) RETURNING id INTO a;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (pg_temp.u('c3'), o, b, a, 'Legacy', 'email',
          '{"kind":"email","subject":"Hi","body_html":"<p>Hi</p>"}'::jsonb, 'draft') RETURNING id INTO c;
  -- A2: an older build schedules this directly. Nothing refuses it.
  UPDATE public.marketing_campaigns SET status = 'scheduled', scheduled_for = now() WHERE id = c;
  PERFORM pg_temp.chk('A2 an event_buyers campaign still schedules directly',
    (SELECT status FROM public.marketing_campaigns WHERE id = c) = 'scheduled', '');
  r := public.biz_marketing_event_send_audience_v1(c);
  reach := public.biz_marketing_combined_audience_reach_v1(o, b, pg_temp.ev('e3'), 'email');
  PERFORM pg_temp.chk('A2 event_buyers sends to buyers plus going guests, the shared one once',
    jsonb_array_length(r -> 'rows') = 3 AND jsonb_array_length(r -> 'rows') = reach
    AND (r -> 'rows') @> '[{"raw_email":"mix@example.test"},{"raw_email":"buyonly@example.test"},{"raw_email":"g22@example.test"}]'::jsonb,
    r::text);
  PERFORM pg_temp.chk('A2 the delegate answers with the event''s brand', r ->> 'brand_id' = b::text, r::text);
  PERFORM pg_temp.chk('A2 an RSVP guest row says rsvp, a buyer row says bought',
    (r -> 'rows') @> '[{"raw_email":"g22@example.test","receive_reason":"rsvp"},{"raw_email":"buyonly@example.test","receive_reason":"bought"}]'::jsonb,
    r::text);
  -- An RSVP-only event (the Kano shape): the old resolver found nobody.
  INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
  VALUES (pg_temp.u('d1'), o, b, 'Buyers of Rooftop RSVP',
          jsonb_build_object('kind', 'event_buyers', 'event_id', pg_temp.u('e1')::text), true);
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (pg_temp.u('c4'), o, b, pg_temp.u('d1'), 'Legacy RSVP', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft');
  r := public.biz_marketing_event_send_audience_v1(pg_temp.u('c4'));
  PERFORM pg_temp.chk('A2 an RSVP-only event_buyers SMS reaches its one textable guest',
    jsonb_array_length(r -> 'rows') = 1 AND (r -> 'rows') @> '[{"raw_phone":"+2348031259601"}]'::jsonb, r::text);
  -- Another brand's campaign pointing at this event is refused.
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (pg_temp.u('c5'), o, pg_temp.u('b2'), pg_temp.u('d1'), 'Wrong brand', 'email',
          '{"kind":"email","subject":"Hi","body_html":"<p>Hi</p>"}'::jsonb, 'draft');
  BEGIN
    PERFORM public.biz_marketing_event_send_audience_v1(pg_temp.u('c5'));
    PERFORM pg_temp.chk('A2 a campaign of another brand is refused', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('A2 a campaign of another brand is refused', SQLERRM = 'audience_brand_mismatch', SQLERRM);
  END;
  PERFORM pg_temp.chk('A2 the delegate is service-only',
    NOT has_function_privilege('authenticated', 'public.biz_marketing_event_send_audience_v1(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.biz_marketing_event_send_audience_v1(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.biz_marketing_event_send_audience_v1(uuid)', 'EXECUTE'), '');
  PERFORM pg_temp.chk('discovery is for signed-in hosts only',
    has_function_privilege('authenticated', 'public.biz_marketing_event_audiences_v1(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.biz_marketing_event_audiences_v1(uuid, uuid)', 'EXECUTE'), '');
END $t$;

-- ── Fix pass 1: an event manager sees the server count, a scanner does not ──
DO $t$
DECLARE b uuid := pg_temp.u('b1'); m uuid := pg_temp.u('07'); d jsonb; r jsonb; v integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m::text, true);
  d := public.biz_marketing_event_audiences_v1(m, b);
  SELECT x INTO r FROM jsonb_array_elements(d) x WHERE x ->> 'eventId' = pg_temp.u('e1')::text;
  PERFORM pg_temp.chk('FP1 an event_manager gets the RSVP event''s guest count',
    (r ->> 'guestCount')::integer = 3 AND (r ->> 'peopleCount')::integer = 3, COALESCE(r::text, d::text));
  v := public.biz_marketing_combined_audience_reach_v1(m, b, pg_temp.ev('e1'), 'email');
  PERFORM pg_temp.chk('FP1 an event_manager gets the event''s email reach', v = 2, v::text);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('08')::text, true);
  BEGIN
    PERFORM public.biz_marketing_event_audiences_v1(pg_temp.u('08'), b);
    PERFORM pg_temp.chk('FP1 a scanner is refused', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('FP1 a scanner is refused', SQLSTATE = '42501', SQLERRM);
  END;
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true);
END $t$;

-- ── Fix pass 1: an event source is named for who it holds ──────────────────
DO $t$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  PERFORM pg_temp.chk('FP4 an RSVP-only event is "Guests of"',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e1')::text) = 'Guests of Rooftop RSVP',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e1')::text));
  PERFORM pg_temp.chk('FP4 a paid event stays "Buyers of"',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e2')::text) = 'Buyers of Paid Night',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e2')::text));
  PERFORM pg_temp.chk('FP4 a mixed event is "People at"',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e3')::text) = 'People at Mixed Party',
    public.issue_4273_source_name(b, 'event:' || pg_temp.u('e3')::text));
  PERFORM pg_temp.chk('FP4 the combined audience for an RSVP event is created as "Guests of"',
    (SELECT a.name FROM public.marketing_audiences a
      WHERE a.brand_id = b AND a.query_definition ->> 'kind' = 'combined_sources'
        AND a.query_definition -> 'sources' = pg_temp.ev('e1')) = 'Guests of Rooftop RSVP', '');
END $t$;

-- ── Fix pass 3: the roster lists every person the count includes ───────────
DO $t$
DECLARE b uuid := pg_temp.u('b1'); m uuid := pg_temp.u('07'); r jsonb; rows jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m::text, true);
  r := public.biz_marketing_event_roster_v1(m, b, pg_temp.u('e3'));
  rows := r -> 'rows';
  PERFORM pg_temp.chk('FP3 mixed roster lists all 3 people the count includes',
    jsonb_array_length(rows) = 3
    AND (SELECT count(*) FROM jsonb_array_elements(rows) x WHERE x ->> 'role' <> 'pending')
        = (public.issue_4273_source_totals(b, pg_temp.ev('e3')) ->> 'peopleCount')::integer, rows::text);
  PERFORM pg_temp.chk('FP3 the shared person is both, with their buyer line',
    rows @> '[{"name":"Mix Shared","role":"both","orderCount":1,"totalSpendMinor":1000}]'::jsonb, rows::text);
  PERFORM pg_temp.chk('FP3 a guest-only row carries no order or money',
    rows @> '[{"name":"Mix Guest Only","role":"guest","orderCount":null,"totalSpendMinor":null,"currency":null}]'::jsonb, rows::text);
  rows := public.biz_marketing_event_roster_v1(m, b, pg_temp.u('e1')) -> 'rows';
  PERFORM pg_temp.chk('FP3 RSVP roster: 3 guests then 4 pending going guests',
    (SELECT count(*) FROM jsonb_array_elements(rows) x WHERE x ->> 'role' = 'guest') = 3
    AND (SELECT count(*) FROM jsonb_array_elements(rows) x WHERE x ->> 'role' = 'pending') = 4, rows::text);
  PERFORM pg_temp.chk('FP3 a pending guest is never marketing OK',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rows) x
                 WHERE x ->> 'role' = 'pending' AND ((x ->> 'emailOk')::boolean OR (x ->> 'smsOk')::boolean)), rows::text);
  PERFORM pg_temp.chk('FP3 consent is the Book''s decision (unsubscribed guest refused, others allowed)',
    rows @> '[{"name":"Bo Unsub","emailOk":false,"emailRefused":true},{"name":"Ada Guest","emailOk":true,"smsOk":true}]'::jsonb,
    rows::text);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('08')::text, true);
  BEGIN
    PERFORM public.biz_marketing_event_roster_v1(pg_temp.u('08'), b, pg_temp.u('e1'));
    PERFORM pg_temp.chk('FP3 a scanner cannot read the roster', false, 'no error');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.chk('FP3 a scanner cannot read the roster', SQLSTATE = '42501', SQLERRM);
  END;
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true);
END $t$;

-- ── A1 repair: no failed campaign that reached nobody keeps a null reason ───
DO $t$
BEGIN
  PERFORM pg_temp.chk('A1 after the migration, no 0-recipient failed campaign has a null reason',
    NOT EXISTS (SELECT 1 FROM public.marketing_campaigns
                 WHERE status = 'failed' AND failure_reason IS NULL AND COALESCE(recipient_count, 0) = 0), '');
END $t$;

DO $done$
DECLARE r record; n integer;
BEGIN
  SELECT count(*) INTO n FROM t4596_fail;
  FOR r IN SELECT line FROM t4596_fail ORDER BY id LOOP RAISE WARNING 'FAIL %', r.line; END LOOP;
  IF n > 0 THEN RAISE EXCEPTION 'issue_4596 event audience suite: % failure(s)', n; END IF;
  RAISE NOTICE 'issue_4596 event audience suite: all checks passed';
END $done$;

ROLLBACK;
