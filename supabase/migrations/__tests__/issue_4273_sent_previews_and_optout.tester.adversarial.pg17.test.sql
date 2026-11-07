-- #4273 polish — independent tester, adversarial angles the implementor's two
-- suites do not take. Runs on the fully applied migration chain, rolls back.
--
--   L   the lock, field by field and status by status, as the host's own
--       authenticated role: every column a caller could PATCH, every status
--       transition out of every status, and the server paths that must still
--       move a campaign (finalize as service_role, a SECURITY DEFINER caller).
--   G   the group view: a team member of ANOTHER brand, a venue_staff member of
--       this brand, the same error for missing and not-yours (code + message),
--       a group whose members sit under two brands is never merged.
--   P   phone keys over the formats hosts and carriers actually store
--       (+234 / 0-prefixed / spaces / dashes / US with and without 1 / 00) and
--       the over-match the old digit compare made, in every phone ledger.
--   H   one host's account-scope unsubscribe never blocks another host, by
--       SMS as well as email, in the five #4273 readers and the two Q1b ones.
--   X   the freed slot (extra b): cancelled frees it too; a second failure in
--       the same slot is allowed; a live duplicate is still refused.
--
-- MINGLA-INVARIANT-REF: I-4273-SENT-CAMPAIGN-READ-ONLY, I-4273-SENT-VIEW-NO-CONTACTS,
-- I-4273-PHONE-MATCH-E164, I-4273-ACCOUNT-SCOPE-IS-THE-SENDING-HOST,
-- I-4273-FAILED-METHOD-FREES-ITS-SLOT (declared in the implementor suites).
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS auth.identities(
  user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL,
  provider_id text NOT NULL);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273x_fail(id serial, line text) ON COMMIT DROP;
GRANT ALL ON t4273x_fail TO PUBLIC;
GRANT ALL ON SEQUENCE t4273x_fail_id_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273x_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('4273a000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid
$f$;
CREATE FUNCTION pg_temp.r(p_key text) RETURNS text LANGUAGE sql AS $f$
  SELECT current_setting('t4273x.' || p_key, true)
$f$;
-- Run one statement as the current role; remember 'ok' or the error text.
CREATE FUNCTION pg_temp.try(p_key text, p_sql text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  PERFORM set_config('t4273x.' || p_key, 'ok', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('t4273x.' || p_key, SQLSTATE || ':' || SQLERRM, true);
END; $f$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.u(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.r(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.chk(text, boolean, text) TO PUBLIC;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- 01 host of b1 + b2. 05 host of b3. 06 marketing_manager on b3 only.
-- 07 venue_staff on b1. 40 a follower of b1 and b3.
INSERT INTO auth.users(id, email)
SELECT pg_temp.u(x), 't4273x-' || x || '@example.test'
  FROM unnest(ARRAY['01', '05', '06', '07', '40']) x;
INSERT INTO public.creator_accounts(id, email) VALUES
  (pg_temp.u('01'), 't4273x-01@example.test'), (pg_temp.u('05'), 't4273x-05@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('01'), 'Adv One', 'issue-4273x-one', 'USD', now(), now()),
  (pg_temp.u('b2'), pg_temp.u('01'), 'Adv Two', 'issue-4273x-two', 'USD', now(), now()),
  (pg_temp.u('b3'), pg_temp.u('05'), 'Adv Three', 'issue-4273x-three', 'USD', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  (pg_temp.u('b3'), pg_temp.u('06'), 'marketing_manager', now()),
  (pg_temp.u('b1'), pg_temp.u('07'), 'venue_staff', now());
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition) VALUES
  (pg_temp.u('a1'), pg_temp.u('01'), pg_temp.u('b1'), 'Buyers',
   jsonb_build_object('kind', 'brand_buyers', 'brand_id', pg_temp.u('b1'))),
  (pg_temp.u('a2'), pg_temp.u('01'), pg_temp.u('b1'), 'Buyers 2',
   jsonb_build_object('kind', 'brand_buyers', 'brand_id', pg_temp.u('b1')));

-- One campaign per status the lock must treat differently.
--   s_sent   sent              s_send  sending          s_fail  failed
--   s_canc   cancelled         s_due   scheduled, due   s_fut   scheduled, future
--   s_part   scheduled, future, partly sent (snapshot)  s_drft  draft
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count)
SELECT pg_temp.u(k), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'L ' || k, 'email',
       '{"kind":"email","subject":"S","body_html":"<p>B</p>","body_text":"B"}'::jsonb, st, sf, sa, rc
  FROM (VALUES
    ('51', 'sent',      NULL::timestamptz,              now() - interval '1 hour', 3),
    ('52', 'sending',   now() - interval '5 minutes',   NULL, NULL),
    ('53', 'failed',    NULL,                           NULL, 0),
    ('54', 'cancelled', now() + interval '1 day',       NULL, NULL),
    ('55', 'scheduled', now() - interval '1 minute',    NULL, NULL),
    ('56', 'scheduled', now() + interval '1 day',       NULL, NULL),
    ('57', 'scheduled', now() + interval '6 hours',     NULL, 2),
    ('58', 'draft',     NULL,                           NULL, NULL),
    ('5a', 'draft',     NULL,                           NULL, NULL)
  ) v(k, st, sf, sa, rc);
-- s_part carries the snapshot the send wrote before its first recipient.
UPDATE public.marketing_campaigns
   SET sent_snapshot = '{"v":1,"kind":"email","subject":"S"}'
 WHERE id = pg_temp.u('57');

SELECT set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true),
       set_config('request.jwt.claims', json_build_object('sub', pg_temp.u('01'), 'role', 'authenticated')::text, true);

-- ── L: every field, every locked status, as the host ────────────────────────
SET LOCAL ROLE authenticated;
DO $l$
DECLARE
  k text;
  f record;
BEGIN
  FOREACH k IN ARRAY ARRAY['51', '52', '53', '54', '55', '57'] LOOP
    FOR f IN SELECT * FROM (VALUES
        ('name',     'name = ''renamed'''),
        ('payload',  'channel_payload = ''{"kind":"email","subject":"X","body_html":"<p>X</p>","body_text":"X"}'''),
        ('channel',  'channel = ''sms'', channel_payload = ''{"kind":"sms","body":"X"}'''),
        ('audience', 'audience_id = ''' || pg_temp.u('a2') || ''''),
        ('when',     'scheduled_for = now() + interval ''2 days'''),
        ('draft',    'status = ''draft'''),
        ('sched',    'status = ''scheduled'', scheduled_for = now() + interval ''2 days'''),
        ('cancel',   'status = ''cancelled'''),
        ('sent',     'status = ''sent'''),
        ('count',    'recipient_count = 999'),
        ('sentat',   'sent_at = now()')
      ) v(tag, setsql) LOOP
      PERFORM pg_temp.try('L' || k || f.tag,
        'UPDATE public.marketing_campaigns SET ' || f.setsql || ' WHERE id = ''' || pg_temp.u(k) || '''');
    END LOOP;
  END LOOP;
  -- the open statuses
  PERFORM pg_temp.try('L58todraftsent', 'UPDATE public.marketing_campaigns SET status = ''sending'' WHERE id = ''' || pg_temp.u('58') || '''');
  PERFORM pg_temp.try('L58tocancel', 'UPDATE public.marketing_campaigns SET status = ''cancelled'' WHERE id = ''' || pg_temp.u('58') || '''');
  PERFORM pg_temp.try('L58sentat', 'UPDATE public.marketing_campaigns SET status = ''scheduled'', scheduled_for = now(), sent_at = now() WHERE id = ''' || pg_temp.u('58') || '''');
  PERFORM pg_temp.try('L56todraft', 'UPDATE public.marketing_campaigns SET status = ''draft'' WHERE id = ''' || pg_temp.u('56') || '''');
  PERFORM pg_temp.try('L56tosending', 'UPDATE public.marketing_campaigns SET status = ''sending'' WHERE id = ''' || pg_temp.u('56') || '''');
  PERFORM pg_temp.try('L56edit', 'UPDATE public.marketing_campaigns SET name = ''moved'', scheduled_for = now() + interval ''3 days'' WHERE id = ''' || pg_temp.u('56') || '''');
  PERFORM pg_temp.try('L56cancel', 'UPDATE public.marketing_campaigns SET status = ''cancelled'' WHERE id = ''' || pg_temp.u('56') || '''');
  PERFORM pg_temp.try('L58edit', 'UPDATE public.marketing_campaigns SET name = ''still a draft'' WHERE id = ''' || pg_temp.u('58') || '''');
  PERFORM pg_temp.try('L58sched', 'UPDATE public.marketing_campaigns SET status = ''scheduled'', scheduled_for = now() WHERE id = ''' || pg_temp.u('58') || '''');
  -- a no-op touch of a locked row (heartbeat-shaped) is still fine
  PERFORM pg_temp.try('L51touch', 'UPDATE public.marketing_campaigns SET updated_at = now() WHERE id = ''' || pg_temp.u('51') || '''');
  -- the snapshot itself, on an unlocked draft and a locked row
  PERFORM pg_temp.try('L58snap', 'UPDATE public.marketing_campaigns SET sent_snapshot = ''{"v":1,"kind":"email"}'' WHERE id = ''' || pg_temp.u('5a') || '''');
  PERFORM pg_temp.try('L57snapnull', 'UPDATE public.marketing_campaigns SET sent_snapshot = NULL WHERE id = ''' || pg_temp.u('57') || '''');
END $l$;
RESET ROLE;

DO $lc$
DECLARE
  k text; tag text; got text;
  bad text := '';
BEGIN
  FOREACH k IN ARRAY ARRAY['51', '52', '53', '54', '55', '57'] LOOP
    FOREACH tag IN ARRAY ARRAY['name', 'payload', 'channel', 'audience', 'when', 'draft', 'sched', 'cancel', 'sent', 'count', 'sentat'] LOOP
      got := pg_temp.r('L' || k || tag);
      -- A same-value write (sent -> sent, cancelled -> cancelled) is a no-op
      -- touch and may pass; every real change must be refused as locked.
      IF NOT (got LIKE '42501:campaign_locked%'
              OR (got = 'ok' AND ((k = '51' AND tag = 'sent') OR (k = '54' AND tag = 'cancel')))) THEN
        bad := bad || ' ' || k || '/' || tag || '=' || COALESCE(got, 'null');
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.chk('L-1 sent, sending, failed, cancelled, due and partly-sent rows refuse every field and every transition', bad = '', bad);
  PERFORM pg_temp.chk('L-2 nothing on a locked row moved',
    NOT EXISTS (SELECT 1 FROM public.marketing_campaigns
                 WHERE id IN (pg_temp.u('51'), pg_temp.u('52'), pg_temp.u('53'), pg_temp.u('54'), pg_temp.u('55'), pg_temp.u('57'))
                   AND (name <> 'L ' || right(id::text, 2) OR audience_id <> pg_temp.u('a1') OR channel <> 'email'
                        OR recipient_count = 999)), '');
  PERFORM pg_temp.chk('L-3 a draft cannot jump to sending or cancelled',
    pg_temp.r('L58todraftsent') LIKE '42501:campaign_status_transition_refused%'
    AND pg_temp.r('L58tocancel') LIKE '42501:campaign_status_transition_refused%',
    pg_temp.r('L58todraftsent') || ' / ' || pg_temp.r('L58tocancel'));
  PERFORM pg_temp.chk('L-4 scheduling cannot smuggle sent_at', pg_temp.r('L58sentat') LIKE '42501:campaign_server_field%', pg_temp.r('L58sentat'));
  PERFORM pg_temp.chk('L-5 a future send cannot go back to draft or forward to sending',
    pg_temp.r('L56todraft') LIKE '42501:campaign_status_transition_refused%'
    AND pg_temp.r('L56tosending') LIKE '42501:campaign_status_transition_refused%',
    pg_temp.r('L56todraft') || ' / ' || pg_temp.r('L56tosending'));
  PERFORM pg_temp.chk('L-6 the app''s own moves still work: edit+reschedule, cancel, draft edit, draft->scheduled',
    pg_temp.r('L56edit') = 'ok' AND pg_temp.r('L56cancel') = 'ok' AND pg_temp.r('L58edit') = 'ok' AND pg_temp.r('L58sched') = 'ok',
    concat_ws(' / ', pg_temp.r('L56edit'), pg_temp.r('L56cancel'), pg_temp.r('L58edit'), pg_temp.r('L58sched')));
  PERFORM pg_temp.chk('L-7 a heartbeat-shaped touch of a locked row is accepted', pg_temp.r('L51touch') = 'ok', pg_temp.r('L51touch'));
  PERFORM pg_temp.chk('L-8 the host can neither write nor clear a snapshot',
    pg_temp.r('L58snap') LIKE '42501:sent_snapshot_server_only%' AND pg_temp.r('L57snapnull') LIKE '42501:%',
    pg_temp.r('L58snap') || ' / ' || pg_temp.r('L57snapnull'));
END $lc$;

-- ── L (server): service_role finalizes and fails a locked row; a SECURITY
-- DEFINER caller (postgres) moves one; the claim picks up a due send.
SET LOCAL ROLE service_role;
SELECT pg_temp.try('S1', 'SELECT public.mkt_finalize_campaign(''' || pg_temp.u('52') || ''')');
SELECT pg_temp.try('S2', 'UPDATE public.marketing_campaigns SET status = ''failed'' WHERE id = ''' || pg_temp.u('57') || '''');
SELECT pg_temp.try('S3', 'SELECT count(*) FROM public.mkt_claim_campaigns(10, ''' || pg_temp.u('55') || ''')');
RESET ROLE;
DO $sc$ BEGIN
  PERFORM pg_temp.chk('L-9 finalize (service_role) still moves a sending campaign',
    pg_temp.r('S1') = 'ok' AND (SELECT status FROM public.marketing_campaigns WHERE id = pg_temp.u('52')) <> 'sending', pg_temp.r('S1'));
  PERFORM pg_temp.chk('L-10 the server can still fail a partly-sent campaign',
    pg_temp.r('S2') = 'ok' AND (SELECT status FROM public.marketing_campaigns WHERE id = pg_temp.u('57')) = 'failed', pg_temp.r('S2'));
  PERFORM pg_temp.chk('L-11 the claim still picks up a due send',
    pg_temp.r('S3') = 'ok' AND (SELECT status FROM public.marketing_campaigns WHERE id = pg_temp.u('55')) = 'sending', pg_temp.r('S3'));
END $sc$;

-- ── G: the group view's door ────────────────────────────────────────────────
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
VALUES (pg_temp.u('59'), pg_temp.u('01'), pg_temp.u('b1'), pg_temp.u('a1'), 'L 59', 'sms', '{"kind":"sms","body":"B"}', 'draft', pg_temp.u('51'));

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid) TO PUBLIC;

SELECT pg_temp.as_user(pg_temp.u('06'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.try('G1', 'SELECT public.biz_marketing_campaign_group_view_v1(''' || pg_temp.u('51') || ''')');
SELECT pg_temp.try('G2', 'SELECT public.biz_marketing_campaign_group_view_v1(''' || pg_temp.u('ff') || ''')');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.u('07'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.try('G3', 'SELECT public.biz_marketing_campaign_group_view_v1(''' || pg_temp.u('51') || ''')');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.u('01'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.try('G4', 'SELECT set_config(''t4273x.g4v'', public.biz_marketing_campaign_group_view_v1(''' || pg_temp.u('59') || ''')::text, true)');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.try('G5', 'SELECT public.biz_marketing_campaign_group_view_v1(''' || pg_temp.u('51') || ''')');
RESET ROLE;
DO $g$ BEGIN
  PERFORM pg_temp.chk('G-1 a manager of ANOTHER brand gets campaign_not_found', pg_temp.r('G1') = 'P0002:campaign_not_found', pg_temp.r('G1'));
  PERFORM pg_temp.chk('G-2 missing reads byte-identical to not-yours', pg_temp.r('G2') = pg_temp.r('G1'), pg_temp.r('G2'));
  PERFORM pg_temp.chk('G-3 venue_staff (below brand_member) on this brand is refused the same way', pg_temp.r('G3') = 'P0002:campaign_not_found', pg_temp.r('G3'));
  PERFORM pg_temp.chk('G-4 the host reaches the head''s group from a sibling, members in one brand only',
    pg_temp.r('G4') = 'ok'
    AND (pg_temp.r('g4v')::jsonb ->> 'groupId') = pg_temp.u('51')::text
    AND jsonb_array_length(pg_temp.r('g4v')::jsonb -> 'members') = 2, pg_temp.r('G4'));
  PERFORM pg_temp.chk('G-5 anon cannot execute it', pg_temp.r('G5') LIKE '42501:%', pg_temp.r('G5'));
  PERFORM pg_temp.chk('G-6 no recipient value travels: no @ outside the saved message, no phone digits',
    (pg_temp.r('g4v')::jsonb - 'brand') #>> '{}' !~ '\+[0-9]{8,}', '');
END $g$;

-- ── P: phone keys over real-world stored formats ────────────────────────────
DO $p$
DECLARE r record; got text; bad text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('+234 803 110 0043',   '+2348031100043'),
      ('+234-803-110-0043',   '+2348031100043'),
      ('234-803-110-0043',    '+2348031100043'),
      ('0803 110 0043',       NULL),
      ('(0803) 110-0043',     NULL),
      ('+1 202-555-0199',     '+12025550199'),
      ('1 (202) 555-0199',    '+12025550199'),
      ('202.555.0199',        '+12025550199'),
      ('001 202 555 0199',    '+12025550199'),
      (' +12025550199 ',      '+12025550199'),
      ('1202555019',          '+1202555019'),
      ('+44 7911 123456',     '+447911123456'),
      ('447911123456',        '+447911123456'),
      ('07911 123456',        NULL),
      ('+1234567890123456',   NULL),
      ('tel:+2348031100043',  '+2348031100043'),
      ('a@b',                 NULL)
    ) v(input, want) LOOP
    got := public.issue_4273_phone_key(r.input);
    IF got IS DISTINCT FROM r.want THEN bad := bad || ' [' || r.input || '=>' || COALESCE(got, 'NULL') || ']'; END IF;
  END LOOP;
  PERFORM pg_temp.chk('P-1 phone keys over stored formats', bad = '', bad);
END $p$;

-- Each ledger holds ONE stored opt-out in a messy format; the send asks in E.164.
INSERT INTO public.consent_records(contact, channel, scope, action, source, brand_id)
VALUES ('+234 803 110 7001', 'sms', 'marketing', 'revoked', 'manual', pg_temp.u('b1'));
INSERT INTO public.marketing_unsubscribes(contact_phone, channel, scope, brand_id, reason)
VALUES ('234-803-110-7002', 'sms', 'brand', pg_temp.u('b1'), 't');
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (NULL, '1 (415) 555-0107', 'sms', 'all', 'stop_keyword');
INSERT INTO public.venue_sms_opt_out(phone_e164, brand_id) VALUES ('00234 803 110 7004', pg_temp.u('b1'));
DO $pl$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  PERFORM pg_temp.chk('P-2 consent revocation stored with spaces withholds its E.164',
    public.issue_4273_marketing_opted_out(b, 'sms', '+2348031107001', NULL), '');
  PERFORM pg_temp.chk('P-3 brand unsubscribe stored with dashes and no + withholds its E.164',
    public.issue_4273_marketing_opted_out(b, 'sms', '+2348031107002', NULL), '');
  PERFORM pg_temp.chk('P-4 STOP stored as a dressed-up US national withholds +1',
    public.issue_4273_marketing_opted_out(b, 'sms', '+14155550107', NULL), '');
  PERFORM pg_temp.chk('P-5 and never the same digits under another country (the old over-match)',
    NOT public.issue_4273_marketing_opted_out(b, 'sms', '+4155550107', NULL)
    AND NOT public.issue_4273_marketing_opted_out(b, 'sms', '+214155550107', NULL), '');
  PERFORM pg_temp.chk('P-6 venue opt-out stored as 00 + country withholds its E.164',
    public.issue_4273_marketing_opted_out(b, 'sms', '+2348031107004', NULL), '');
  PERFORM pg_temp.chk('P-7 a phone opt-out never leaks onto email, and an email-shaped contact never matches a phone',
    NOT public.issue_4273_marketing_opted_out(b, 'email', '+2348031107001', NULL)
    AND NOT public.issue_4273_marketing_opted_out(b, 'sms', 'x@example.test', NULL), '');
  PERFORM pg_temp.chk('P-8 a trunk-0 asker matches nothing (no country to compare)',
    NOT public.issue_4273_marketing_opted_out(b, 'sms', '08031107001', NULL), '');
  PERFORM pg_temp.chk('P-9 the brand-scoped rows stay on their brand',
    NOT public.issue_4273_marketing_opted_out(pg_temp.u('b3'), 'sms', '+2348031107002', NULL)
    AND NOT public.issue_4273_marketing_opted_out(pg_temp.u('b3'), 'sms', '+2348031107004', NULL), '');
END $pl$;

-- ── H: one host's account scope never blocks another host (SMS too) ─────────
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (pg_temp.u('40'), '+2348031107040');
INSERT INTO auth.identities(user_id, provider, identity_data, provider_id)
VALUES (pg_temp.u('40'), 'email', '{"email":"adv40@example.test"}', pg_temp.u('40')::text);
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
VALUES (pg_temp.u('40'), 'F', 'F', 't4273x-40', true, true, 'friends');
INSERT INTO public.brand_follows(user_id, brand_id) VALUES (pg_temp.u('40'), pg_temp.u('b1')), (pg_temp.u('40'), pg_temp.u('b3'));
-- Host 05 (b3) blocks this follower everywhere it sends, SMS stored with no +.
INSERT INTO public.marketing_unsubscribes(contact_phone, channel, scope, account_id, reason)
VALUES ('2348031107040', 'sms', 'account', pg_temp.u('05'), 't');
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, account_id, reason)
VALUES ('ADV40@example.test', 'all', 'account', pg_temp.u('05'), 't');
-- Host 05 is ALSO a team member of b1: membership is not ownership.
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES (pg_temp.u('b1'), pg_temp.u('05'), 'brand_admin', now());
DO $h$ BEGIN
  PERFORM pg_temp.chk('H-1 host 05''s account row withholds on host 05''s brand (sms + email)',
    public.issue_4273_marketing_opted_out(pg_temp.u('b3'), 'sms', '+2348031107040', NULL)
    AND public.issue_4273_marketing_opted_out(pg_temp.u('b3'), 'email', 'adv40@example.test', NULL), '');
  PERFORM pg_temp.chk('H-2 and never on host 01''s brands, though host 05 helps run b1',
    NOT public.issue_4273_marketing_opted_out(pg_temp.u('b1'), 'sms', '+2348031107040', pg_temp.u('40'))
    AND NOT public.issue_4273_marketing_opted_out(pg_temp.u('b1'), 'email', 'adv40@example.test', pg_temp.u('40'))
    AND NOT public.issue_4273_marketing_opted_out(pg_temp.u('b2'), 'email', 'adv40@example.test', NULL), '');
  PERFORM pg_temp.chk('H-3 the address check agrees on both hosts',
    public.issue_4273_address_denied(pg_temp.u('b3'), 'email', 'adv40@example.test', NULL) = 'suppressed'
    AND public.issue_4273_address_denied(pg_temp.u('b1'), 'email', 'adv40@example.test', pg_temp.u('40')) IS DISTINCT FROM 'suppressed', '');
  PERFORM pg_temp.chk('H-4 (Q1b) follow gate: blocked on b3, open on b1',
    NOT public.biz_brand_follow_channel_ok(pg_temp.u('40'), pg_temp.u('b3'), 'email')
    AND public.biz_brand_follow_channel_ok(pg_temp.u('40'), pg_temp.u('b1'), 'email'), '');
  PERFORM pg_temp.chk('H-5 (Q1b) circle authoriser: unsubscribed on b3 only',
    (SELECT c.reason FROM public.issue_1778_circle_authorized_contact(pg_temp.u('b3'), pg_temp.u('40'), 'email') c) = 'unsubscribed'
    AND (SELECT c.reason FROM public.issue_1778_circle_authorized_contact(pg_temp.u('b1'), pg_temp.u('40'), 'email') c) <> 'unsubscribed', '');
  PERFORM pg_temp.chk('H-6 the contact-less account arm is gone: the follower''s own id never withholds on b1',
    NOT public.issue_4273_marketing_opted_out(pg_temp.u('b1'), 'sms', '+2348031109999', pg_temp.u('05'))
    AND NOT public.issue_4273_marketing_opted_out(pg_temp.u('b1'), 'sms', '+2348031109999', pg_temp.u('40')), '');
  PERFORM pg_temp.chk('H-7 a guest phone stored with spaces still finds the verified account (3a)',
    EXISTS (SELECT 1 FROM public.issue_4273_contact_accounts(pg_temp.u('b1'), 'phone', '+234 803 110 7040') a WHERE a = pg_temp.u('40')), '');
END $h$;

-- ── X: the freed slot ───────────────────────────────────────────────────────
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
VALUES (pg_temp.u('60'), pg_temp.u('01'), pg_temp.u('b2'), pg_temp.u('a1'), 'Head', 'email',
        '{"kind":"email","subject":"S","body_html":"<p>B</p>","body_text":"B"}', 'cancelled');
DO $x$
DECLARE g uuid := pg_temp.u('60');
BEGIN
  -- cancelled head's method is free: a new email joins
  PERFORM pg_temp.try('X1', format('INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id) VALUES (%L, %L, %L, %L, ''Again'', ''email'', ''{"kind":"email","subject":"S","body_html":"<p>B</p>","body_text":"B"}'', ''failed'', %L)',
    pg_temp.u('61'), pg_temp.u('01'), pg_temp.u('b2'), pg_temp.u('a1'), g));
  -- a second dead email in the same slot is fine, a live one too, a second live one is not
  PERFORM pg_temp.try('X2', format('INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id) VALUES (%L, %L, %L, %L, ''Live'', ''email'', ''{"kind":"email","subject":"S","body_html":"<p>B</p>","body_text":"B"}'', ''draft'', %L)',
    pg_temp.u('62'), pg_temp.u('01'), pg_temp.u('b2'), pg_temp.u('a1'), g));
  PERFORM pg_temp.try('X3', format('INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id) VALUES (%L, %L, %L, %L, ''Live2'', ''email'', ''{"kind":"email","subject":"S","body_html":"<p>B</p>","body_text":"B"}'', ''draft'', %L)',
    pg_temp.u('63'), pg_temp.u('01'), pg_temp.u('b2'), pg_temp.u('a1'), g));
  PERFORM pg_temp.chk('X-1 a cancelled method frees its slot, and a second dead one fits too', pg_temp.r('X1') = 'ok', pg_temp.r('X1'));
  PERFORM pg_temp.chk('X-2 one live method joins', pg_temp.r('X2') = 'ok', pg_temp.r('X2'));
  PERFORM pg_temp.chk('X-3 a second live method on the same slot is still refused', pg_temp.r('X3') LIKE '23505:%', pg_temp.r('X3'));
END $x$;

DO $r$ DECLARE v text; BEGIN SELECT string_agg(line, E'\n') INTO v FROM t4273x_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 polish tester adversarial FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 polish tester adversarial: PASS'; END $r$;
ROLLBACK;
