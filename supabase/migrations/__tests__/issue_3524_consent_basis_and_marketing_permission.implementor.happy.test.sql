-- issue #3524 — IMPLEMENTOR HAPPY PATH for the consent-basis migration
-- ("option B, small", Seth's decision 6).
--
-- WHAT THIS PROVES:
--
--   1. A consent record now names WHICH HOST it was given to, under WHICH
--      WORDING, and whether the brand was known at the moment of the grant
--      ('captured') or attributed afterwards ('derived').
--   2. A contact the order/ticket rail graded 'granted' is reachable by a
--      marketing blast; one it graded 'withheld' is REFUSED, and the refusal
--      says `consent_missing` rather than `channel_unavailable`, because the
--      contact exists and only the permission is missing.
--   3. THE SAME 'withheld' PERSON IS STILL ON THE EVENT'S GUEST ROSTER and is
--      still reachable for `offering_invitation`. Attendance, permission and
--      withdrawal are three separate rows: a host who may not market to someone
--      can still run the event they bought a ticket for.
--   4. A `brand_book` export omits the withheld contact; the
--      `offering_guest_roster` arm is untouched and keeps every attendee.
--   5. 'unknown' — everything the order/ticket rail never graded — behaves
--      EXACTLY as it did before. That is what keeps "option B" small.
--   6. The audit table gains no brand-read policy: the host-facing answer to
--      "may I market to this person" is the permission on the contact method,
--      never the legal record.
--
-- Runs inside one transaction and ROLLBACKs, so it is re-runnable.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.c3524_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('consent3524:'||seed),1,8)||'-'||substr(md5('consent3524:'||seed),9,4)
       ||'-4'||substr(md5('consent3524:'||seed),14,3)||'-8'||substr(md5('consent3524:'||seed),18,3)
       ||'-'||substr(md5('consent3524:'||seed),21,12))::uuid
$$;

CREATE OR REPLACE FUNCTION pg_temp.c3524_ok(claim boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF claim IS NOT TRUE THEN RAISE EXCEPTION 'issue_3524 consent FAILED: %', label; END IF;
END;
$$;

SET session_replication_role = replica;

INSERT INTO auth.users(id) VALUES (pg_temp.c3524_uuid('creator'));
INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.c3524_uuid('creator'), 'issue3524-consent-creator@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('creator'),
        'Issue 3524 Consent', 'issue-3524-consent-basis');
INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme
) VALUES (
  pg_temp.c3524_uuid('event'), pg_temp.c3524_uuid('brand'),
  pg_temp.c3524_uuid('creator'), 'Issue 3524 Consent Event',
  'issue-3524-consent-event', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total)
VALUES (pg_temp.c3524_uuid('tier'), pg_temp.c3524_uuid('event'), 'General', 1000, 'USD', 50);

-- Three guests of the same host:
--   granted  — a marketing consent row for THIS brand is on file
--   withheld — an order with NO consent row (the fail-closed case)
--   ungraded — never touched by the order/ticket rail; must behave as before
INSERT INTO public.brand_people(id, brand_id, display_name) VALUES
  (pg_temp.c3524_uuid('p-granted'),  pg_temp.c3524_uuid('brand'), 'Granted Guest'),
  (pg_temp.c3524_uuid('p-withheld'), pg_temp.c3524_uuid('brand'), 'Withheld Guest'),
  (pg_temp.c3524_uuid('p-ungraded'), pg_temp.c3524_uuid('brand'), 'Ungraded Contact');

INSERT INTO public.brand_person_contact_methods(
  id, brand_id, brand_person_id, channel, normalized_value, provenance_scope,
  is_exportable, is_primary, marketing_consent_state, marketing_consent_graded_at
) VALUES
  (pg_temp.c3524_uuid('m-granted'), pg_temp.c3524_uuid('brand'),
   pg_temp.c3524_uuid('p-granted'), 'email', 'granted@example.test',
   'brand_owned', true, true, 'granted', now()),
  (pg_temp.c3524_uuid('m-withheld'), pg_temp.c3524_uuid('brand'),
   pg_temp.c3524_uuid('p-withheld'), 'email', 'withheld@example.test',
   'brand_owned', true, true, 'withheld', now()),
  -- No grading ever happened here. The DEFAULT is what it must keep.
  (pg_temp.c3524_uuid('m-ungraded'), pg_temp.c3524_uuid('brand'),
   pg_temp.c3524_uuid('p-ungraded'), 'email', 'ungraded@example.test',
   'brand_owned', true, true, DEFAULT, NULL);

-- Both ticket buyers are on the roster through an order source link. The
-- roster reads THIS, and must keep reading only this.
-- `marketing_opt_in` lives on the CHECKOUT SESSION, not the order, and it is
-- structurally `true` on every completed ticket order: buyer.tsx:302-309 binds
-- it to the MANDATORY terms checkbox. It therefore carries no discriminating
-- signal, and assertion (6) below pins that the grader never reads it.
INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency,
  payment_status, source
) VALUES
  (pg_temp.c3524_uuid('o-granted'), pg_temp.c3524_uuid('event'),
   'granted@example.test', '+15550100201', 'Granted Guest', 1000, 'USD',
   'paid', 'online_checkout'),
  (pg_temp.c3524_uuid('o-withheld'), pg_temp.c3524_uuid('event'),
   'withheld@example.test', '+15550100202', 'Withheld Guest', 1000, 'USD',
   'paid', 'online_checkout');

INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
VALUES
  (pg_temp.c3524_uuid('t-granted'), pg_temp.c3524_uuid('o-granted'),
   pg_temp.c3524_uuid('tier'), pg_temp.c3524_uuid('event'), 'c3524-granted', 'valid', 'auto'),
  (pg_temp.c3524_uuid('t-withheld'), pg_temp.c3524_uuid('o-withheld'),
   pg_temp.c3524_uuid('tier'), pg_temp.c3524_uuid('event'), 'c3524-withheld', 'valid', 'auto');

INSERT INTO public.brand_person_source_links(
  brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at
) VALUES
  (pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('p-granted'),
   'order', pg_temp.c3524_uuid('o-granted'), 'normalized_address', now()),
  (pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('p-withheld'),
   'order', pg_temp.c3524_uuid('o-withheld'), 'normalized_address', now());

-- The grant that makes 'granted' granted — recorded AGAINST THIS BRAND, with
-- the wording version that was actually shown.
INSERT INTO public.consent_records(
  contact, channel, scope, action, source, disclosure_text,
  brand_id, event_id, disclosure_version, brand_attribution
) VALUES (
  'granted@example.test', 'email', 'marketing', 'granted', 'checkout',
  'By continuing you agree to receive updates from this host.',
  pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('event'),
  '2026-06-19', 'captured');

INSERT INTO public.brand_people_export_jobs(
  id, brand_id, export_kind, filter_json, filter_hash, client_request_id,
  requested_by, status
) VALUES (
  pg_temp.c3524_uuid('job-book'), pg_temp.c3524_uuid('brand'), 'brand_book',
  '{"filter":"all","search":"","sort":"name_asc"}'::jsonb,
  'issue3524hash', pg_temp.c3524_uuid('req'), pg_temp.c3524_uuid('creator'), 'queued');

SET session_replication_role = origin;

-- ═══════════════════════════════════════════════════════════════════════════
DO $t$
DECLARE
  v_brand uuid := pg_temp.c3524_uuid('brand');
  v_event uuid := pg_temp.c3524_uuid('event');
  v_reason text;
  v_allowed boolean;
  v_rows jsonb;
  v_n integer;
BEGIN
  -- ── (1) THE CONSENT RECORD NAMES THE HOST AND THE WORDING ────────────────
  PERFORM pg_temp.c3524_ok(
    (SELECT brand_id = v_brand AND event_id = v_event
        AND disclosure_version = '2026-06-19'
        AND brand_attribution = 'captured'
       FROM public.consent_records WHERE contact = 'granted@example.test'),
    'a grant records its brand, its event, the wording version and that the '
      || 'brand was known at the moment of consent');

  -- `disclosure_version` was already being SENT by checkout and silently
  -- dropped. It is a column now, and it is nullable, because pre-migration
  -- rows genuinely have no recorded version and inventing one would falsify a
  -- legal record.
  PERFORM pg_temp.c3524_ok(
    (SELECT is_nullable = 'YES' FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'consent_records'
        AND column_name = 'disclosure_version'),
    'disclosure_version is nullable — no retrofitted guesses');

  -- ── (2) MARKETING FAILS CLOSED ON 'withheld' ─────────────────────────────
  SELECT allowed, reason INTO v_allowed, v_reason
    FROM public.biz_brand_person_authorized_contact_v2(
      v_brand, pg_temp.c3524_uuid('p-granted'), 'email', 'marketing_blast');
  PERFORM pg_temp.c3524_ok(v_allowed AND v_reason = 'allowed',
    'a graded-granted contact passes a marketing blast');

  SELECT allowed, reason INTO v_allowed, v_reason
    FROM public.biz_brand_person_authorized_contact_v2(
      v_brand, pg_temp.c3524_uuid('p-withheld'), 'email', 'marketing_blast');
  PERFORM pg_temp.c3524_ok(NOT v_allowed, 'a withheld contact is refused');
  PERFORM pg_temp.c3524_ok(v_reason = 'consent_missing',
    'and the refusal says consent_missing, not channel_unavailable — the '
      || 'contact exists, only the permission is absent');

  -- The older reader takes the same rule on its own marketing arm.
  SELECT allowed, reason INTO v_allowed, v_reason
    FROM public.biz_brand_person_authorized_contact(
      v_brand, pg_temp.c3524_uuid('p-withheld'), 'email', 'marketing');
  PERFORM pg_temp.c3524_ok(NOT v_allowed AND v_reason = 'consent_missing',
    'the v1-shaped reader fails closed identically — no fourth reader, no '
      || 'second rule');

  -- ── (3) …AND ATTENDANCE IS UNTOUCHED ─────────────────────────────────────
  SELECT allowed, reason INTO v_allowed, v_reason
    FROM public.biz_brand_person_authorized_contact_v2(
      v_brand, pg_temp.c3524_uuid('p-withheld'), 'email', 'offering_invitation');
  PERFORM pg_temp.c3524_ok(v_allowed AND v_reason = 'allowed',
    'the SAME withheld person is still reachable for an offering invitation — '
      || 'the host still has to run the event');

  SELECT allowed INTO v_allowed
    FROM public.biz_brand_person_authorized_contact(
      v_brand, pg_temp.c3524_uuid('p-withheld'), 'email', 'transactional');
  PERFORM pg_temp.c3524_ok(v_allowed,
    'transactional reach is unaffected by marketing permission');

  -- THE ROSTER. This is the property Seth's decision 6 turns on: withdrawing
  -- marketing must never destroy the event's attendee list.
  SELECT count(*) INTO v_n
    FROM public.biz_guest_roster_project(v_event) r
   WHERE (r.row_data->>'personId')::uuid = pg_temp.c3524_uuid('p-withheld');
  PERFORM pg_temp.c3524_ok(v_n = 1,
    'the withheld guest is STILL on the event roster');
  SELECT count(*) INTO v_n
    FROM public.biz_guest_roster_project(v_event) r
   WHERE (r.row_data->>'personId')::uuid = pg_temp.c3524_uuid('p-granted');
  PERFORM pg_temp.c3524_ok(v_n = 1, 'and so is the granted one');
  -- The roster even still shows the host the contact label for the person it
  -- may not market to, because that is how the host runs the event.
  PERFORM pg_temp.c3524_ok(
    (SELECT r.row_data->>'contactLabel' = 'withheld@example.test'
       FROM public.biz_guest_roster_project(v_event) r
      WHERE (r.row_data->>'personId')::uuid = pg_temp.c3524_uuid('p-withheld')),
    'and the roster still shows their contact — permission gates MARKETING, '
      || 'never attendance');

  PERFORM pg_temp.c3524_ok(
    pg_get_functiondef('public.biz_guest_roster_project(uuid)'::regprocedure)
      NOT LIKE '%marketing_consent%',
    'the roster projection does not read permission at all, and must not learn to');
  PERFORM pg_temp.c3524_ok(
    pg_get_functiondef('public.biz_offering_guest_roster_export_rows(uuid)'::regprocedure)
      NOT LIKE '%marketing_consent%',
    'nor does the guest-roster export arm');

  -- ── (4) THE BRAND-BOOK EXPORT OMITS, THE ROSTER EXPORT DOES NOT ──────────
  SELECT jsonb_agg(row_data) INTO v_rows
    FROM public.biz_brand_people_export_rows(pg_temp.c3524_uuid('job-book'));
  PERFORM pg_temp.c3524_ok(v_rows IS NOT NULL, 'the brand_book export produced rows');
  PERFORM pg_temp.c3524_ok(
    NOT (v_rows::text LIKE '%withheld@example.test%'),
    'the brand_book export omits the withheld email address');
  PERFORM pg_temp.c3524_ok(
    v_rows::text LIKE '%granted@example.test%',
    'and still carries the granted one');
  -- The PERSON is not deleted from the book; only the contact they never
  -- granted is withheld.
  PERFORM pg_temp.c3524_ok(
    v_rows::text LIKE '%Withheld Guest%',
    'the withheld PERSON is still in the book — it is the contact that is held '
      || 'back, not the human');

  -- ── (5) 'unknown' BEHAVES EXACTLY AS BEFORE ──────────────────────────────
  PERFORM pg_temp.c3524_ok(
    (SELECT marketing_consent_state = 'unknown'
       FROM public.brand_person_contact_methods
      WHERE id = pg_temp.c3524_uuid('m-ungraded')),
    'a contact method the order rail never graded defaults to unknown');
  SELECT allowed, reason INTO v_allowed, v_reason
    FROM public.biz_brand_person_authorized_contact_v2(
      v_brand, pg_temp.c3524_uuid('p-ungraded'), 'email', 'marketing_blast');
  PERFORM pg_temp.c3524_ok(v_allowed AND v_reason = 'allowed',
    'and an unknown contact is reachable exactly as it was before this '
      || 'migration — CSV imports, digests and manual adds do not change');

  -- ── (6) GRADING IS AT INGEST, AND KEYS ON THE CONSENT ROW ────────────────
  PERFORM pg_temp.c3524_ok(
    (SELECT state FROM public.issue_3524_grade_marketing_consent(
       'order', v_brand, 'email', 'granted@example.test')) = 'granted',
    'the grader finds the on-file grant for this brand');
  PERFORM pg_temp.c3524_ok(
    (SELECT state FROM public.issue_3524_grade_marketing_consent(
       'order', v_brand, 'email', 'withheld@example.test')) = 'withheld',
    'and grades a contact with no such row withheld — fail closed');
  PERFORM pg_temp.c3524_ok(
    (SELECT state FROM public.issue_3524_grade_marketing_consent(
       'event_rsvp', v_brand, 'email', 'withheld@example.test')) = 'unknown',
    'the rsvp, reservation and stay arms are NOT graded — a different rail');
  -- A grant to one host is not a grant to another.
  PERFORM pg_temp.c3524_ok(
    (SELECT state FROM public.issue_3524_grade_marketing_consent(
       'order', pg_temp.c3524_uuid('other-brand'), 'email', 'granted@example.test'))
      = 'withheld',
    'a grant given to ONE host does not make the contact marketable by another');

  PERFORM pg_temp.c3524_ok(
    pg_get_functiondef(
      'public.issue_3524_grade_marketing_consent(text,uuid,text,text)'::regprocedure)
      NOT LIKE '%marketing_opt_in%',
    'the grader keys on the consent ROW and never on marketing_opt_in, which is '
      || 'structurally true on every ticket order and so can never drive a '
      || 'fail-closed rule');
  PERFORM pg_temp.c3524_ok(
    pg_get_functiondef(
      'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)
      LIKE '%issue_3524_grade_marketing_consent%',
    'the order/ticket ingest rail grades what it writes');
  PERFORM pg_temp.c3524_ok(
    pg_get_functiondef(
      'public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure)
      LIKE '%superseded_at IS NULL%',
    'and #1772''s separation patch survived the re-declaration');

  -- ── (7) THE AUDIT TABLE IS NOT A HOST-FACING SURFACE ─────────────────────
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'consent_records';
  PERFORM pg_temp.c3524_ok(v_n = 1,
    'consent_records still has exactly ONE policy — no brand-read policy was '
      || 'added; the host-facing answer is the permission on the contact method');
  PERFORM pg_temp.c3524_ok(
    (SELECT policyname = 'consent_records_read_own' FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'consent_records'),
    'and it is still the read-your-own policy');

  RAISE NOTICE 'issue #3524 consent-basis implementor happy path: PASS';
END
$t$;

ROLLBACK;
