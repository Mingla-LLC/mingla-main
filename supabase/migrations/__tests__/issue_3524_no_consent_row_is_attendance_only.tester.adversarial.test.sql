-- ===========================================================================
-- issue #3524 — TESTER ADVERSARIAL: an order with no consent row is
-- ATTENDANCE, and attendance only.
--
-- Seth's decision 6: record which brand the consent was for, fail closed for
-- marketing, and leave attendance alone. The three rows must stay three rows.
--
--   A. an order ingest with NO marketing consent row grades 'withheld';
--   B. both marketing authorisers refuse it, and say consent_missing rather
--      than channel_unavailable — a host reading the latter would go hunting
--      for a contact that is right there;
--   C. 'offering_invitation' and 'transactional' still reach them, because the
--      host still has an event to run;
--   D. a matching brand-attributed consent row grades 'granted' and reaches;
--   E. a 'granted' contact is NEVER downgraded by a later re-ingest that finds
--      no row — a revocation is a suppression, not an ungrant;
--   F. a NON-order source kind (event_rsvp) leaves 'unknown' untouched, which
--      is what keeps "option B" small;
--   G. the guest roster still contains the withheld person, and the
--      offering_guest_roster export still carries them;
--   H. the brand_book export omits them;
--   I. marketing_opt_in = true on the order changes none of it;
--   J. no policy was added to consent_records, and brand staff still cannot
--      read the legal audit table.
--
-- FAILS ON REVERT: drop the marketing_consent_state predicate from either
-- authoriser and B goes red; drop it from the brand_book export arm and H goes
-- red; drop the grade patch from biz_resolve_brand_person_source and A goes
-- red; drop the NOT (granted AND withheld) guard and E goes red.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.c3524_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3524-consent:'||seed),1,8)||'-'
       || substr(md5('issue3524-consent:'||seed),9,4)||'-4'
       || substr(md5('issue3524-consent:'||seed),14,3)||'-8'
       || substr(md5('issue3524-consent:'||seed),18,3)||'-'
       || substr(md5('issue3524-consent:'||seed),21,12))::uuid
$$;

CREATE TEMP TABLE c3524_failures(message text NOT NULL);

CREATE OR REPLACE FUNCTION pg_temp.c3524_expect(
  p_ok boolean, p_message text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    INSERT INTO c3524_failures(message) VALUES (p_message);
  END IF;
END;
$$;

SET session_replication_role = replica;

INSERT INTO auth.users(id) VALUES (pg_temp.c3524_uuid('creator'));
INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.c3524_uuid('creator'), 'issue3524-consent@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('creator'),
        'Issue 3524 Consent', 'issue-3524-consent');
INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES (
  pg_temp.c3524_uuid('event'), pg_temp.c3524_uuid('brand'),
  pg_temp.c3524_uuid('creator'), 'Consent Event', 'issue-3524-consent-event',
  'event', 'scheduled', 'public', 'UTC', '{}'::jsonb
);
INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total
) VALUES (
  pg_temp.c3524_uuid('tier'), pg_temp.c3524_uuid('event'),
  'General', 1000, 'USD', 50
);
INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_name, total_cents, currency,
  payment_status, source, checkout_session_id, confirmed_at
) VALUES
  (pg_temp.c3524_uuid('order-no'), pg_temp.c3524_uuid('event'),
   'nopermission@example.test', 'No Permission', 1000, 'USD', 'paid',
   'legacy', pg_temp.c3524_uuid('cs-no'), now()),
  (pg_temp.c3524_uuid('order-yes'), pg_temp.c3524_uuid('event'),
   'gavepermission@example.test', 'Gave Permission', 1000, 'USD', 'paid',
   'legacy', NULL, now()),
  (pg_temp.c3524_uuid('order-yes2'), pg_temp.c3524_uuid('event'),
   'gavepermission@example.test', 'Gave Permission', 1000, 'USD', 'paid',
   'legacy', NULL, now());
-- The guest-roster export is rollout-gated. It is turned on HERE, for this
-- transaction only, so the "attendance keeps everyone" half of the rule is
-- actually executed rather than skipped behind a flag — an assertion that
-- cannot run is an assertion that carries no information.
INSERT INTO public.guest_roster_brand_rollouts(brand_id, phase)
VALUES (pg_temp.c3524_uuid('brand'), 'ga')
ON CONFLICT (brand_id) DO UPDATE SET phase = 'ga';
INSERT INTO public.feature_flags(flag_key, is_enabled)
VALUES ('guest_roster_read_enabled', true),
       ('guest_roster_single_actions_enabled', true),
       ('guest_roster_bulk_actions_enabled', true),
       ('guest_roster_export_enabled', true)
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- A separate rsvp-type event with a real RSVP, so the NON-graded source kind is
-- exercised against the arm that actually resolves it.
INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES (
  pg_temp.c3524_uuid('rsvp-event'), pg_temp.c3524_uuid('brand'),
  pg_temp.c3524_uuid('creator'), 'Consent RSVP', 'issue-3524-consent-rsvp',
  'rsvp', 'scheduled', 'public', 'UTC', '{}'::jsonb
);
INSERT INTO public.event_rsvps(
  id, event_id, guest_name, guest_email, guest_phone, rsvp_status,
  approval_status
) VALUES (
  pg_temp.c3524_uuid('rsvp'), pg_temp.c3524_uuid('rsvp-event'),
  'RSVP Only', 'rsvponly@example.test', '+2349099999999', 'going', 'approved'
);
INSERT INTO public.ticket_checkout_sessions(
  id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
  marketing_opt_in, idempotency_key, expires_at
) VALUES (
  pg_temp.c3524_uuid('cs-no'), pg_temp.c3524_uuid('event'),
  pg_temp.c3524_uuid('brand'), 'No Permission', 'nopermission@example.test',
  '+2348012345678', true, 'issue-3524-consent-cs-no', now() + interval '1 hour'
);
INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status
) VALUES
  (pg_temp.c3524_uuid('t-no'), pg_temp.c3524_uuid('order-no'),
   pg_temp.c3524_uuid('tier'), pg_temp.c3524_uuid('event'),
   'c3524-no', 'valid', 'auto'),
  (pg_temp.c3524_uuid('t-yes'), pg_temp.c3524_uuid('order-yes'),
   pg_temp.c3524_uuid('tier'), pg_temp.c3524_uuid('event'),
   'c3524-yes', 'valid', 'auto'),
  (pg_temp.c3524_uuid('t-yes2'), pg_temp.c3524_uuid('order-yes2'),
   pg_temp.c3524_uuid('tier'), pg_temp.c3524_uuid('event'),
   'c3524-yes2', 'valid', 'auto');

-- The buyer who DID consent, recorded the way record-consent now records it:
-- brand-attributed, at the moment of the grant.
INSERT INTO public.consent_records(
  contact, channel, scope, action, source, brand_id, event_id,
  disclosure_version, brand_attribution
) VALUES (
  'gavepermission@example.test', 'email', 'marketing', 'granted', 'checkout',
  pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('event'),
  '2026-06-19', 'captured'
);
-- A pre-#3524 consent row: real, but with no brand on it. It must NOT grade
-- anybody 'granted', because nobody can tell which brand it was given to.
INSERT INTO public.consent_records(
  contact, channel, scope, action, source
) VALUES (
  'nopermission@example.test', 'email', 'marketing', 'granted', 'checkout'
);

SET session_replication_role = origin;

DO $harness$
DECLARE
  v_no uuid;
  v_yes uuid;
  v_rsvp uuid;
  v_state text;
  r record;
  v_rows integer;
BEGIN
  -- ── A. the ingest grades ─────────────────────────────────────────────────
  SELECT (public.biz_resolve_brand_person_source(
    pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('event'), 'order',
    pg_temp.c3524_uuid('order-no'), NULL, NULL,
    'nopermission@example.test', NULL, now())->>'personId')::uuid INTO v_no;
  SELECT (public.biz_resolve_brand_person_source(
    pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('event'), 'order',
    pg_temp.c3524_uuid('order-yes'), NULL, NULL,
    'gavepermission@example.test', NULL, now())->>'personId')::uuid INTO v_yes;
  SELECT (public.biz_resolve_brand_person_source(
    pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('rsvp-event'), 'event_rsvp',
    pg_temp.c3524_uuid('rsvp'), NULL, NULL,
    'rsvponly@example.test', '+2349099999999', now())->>'personId')::uuid
    INTO v_rsvp;

  PERFORM pg_temp.c3524_expect(v_no IS NOT NULL AND v_yes IS NOT NULL
    AND v_rsvp IS NOT NULL, 'PRECONDITION: all three ingests must resolve');

  SELECT marketing_consent_state INTO v_state
    FROM public.brand_person_contact_methods
   WHERE brand_person_id = v_no AND channel = 'email';
  PERFORM pg_temp.c3524_expect(v_state = 'withheld',
    'A: an order ingest with no BRAND-ATTRIBUTED consent row must grade '
      || 'withheld — a row with brand_id NULL cannot name the brand it was '
      || 'given to. Got ' || coalesce(v_state, '(null)'));

  SELECT marketing_consent_state INTO v_state
    FROM public.brand_person_contact_methods
   WHERE brand_person_id = v_yes AND channel = 'email';
  PERFORM pg_temp.c3524_expect(v_state = 'granted',
    'D: a matching brand-attributed consent row must grade granted, got '
      || coalesce(v_state, '(null)'));

  -- ── F. a non-order kind is untouched ─────────────────────────────────────
  SELECT marketing_consent_state INTO v_state
    FROM public.brand_person_contact_methods
   WHERE brand_person_id = v_rsvp AND channel = 'email';
  PERFORM pg_temp.c3524_expect(v_state = 'unknown',
    'F: event_rsvp is a different consent story and must stay unknown, got '
      || coalesce(v_state, '(null)'));

  -- ── B. both marketing authorisers refuse, and name the reason ────────────
  SELECT * INTO r FROM public.biz_brand_person_authorized_contact_v2(
    pg_temp.c3524_uuid('brand'), v_no, 'email', 'marketing_blast');
  PERFORM pg_temp.c3524_expect(r.allowed = false,
    'B: marketing_blast must be refused for a withheld contact');
  PERFORM pg_temp.c3524_expect(r.reason = 'consent_missing',
    'B: the reason must be consent_missing, not channel_unavailable — the '
      || 'contact EXISTS and the host must not go hunting for it. Got '
      || coalesce(r.reason, '(null)'));
  SELECT * INTO r FROM public.biz_brand_person_authorized_contact(
    pg_temp.c3524_uuid('brand'), v_no, 'email', 'marketing');
  PERFORM pg_temp.c3524_expect(
    r.allowed = false AND r.reason = 'consent_missing',
    'B: the purpose-shaped authoriser must refuse marketing identically, got '
      || coalesce(r.reason, '(null)'));

  -- ── C. the event still runs ──────────────────────────────────────────────
  SELECT * INTO r FROM public.biz_brand_person_authorized_contact_v2(
    pg_temp.c3524_uuid('brand'), v_no, 'email', 'offering_invitation');
  PERFORM pg_temp.c3524_expect(r.reason <> 'consent_missing'
    AND r.contact_method_id IS NOT NULL,
    'C: offering_invitation is NOT marketing — the host still has to reach '
      || 'their attendee. Got ' || coalesce(r.reason, '(null)'));
  SELECT * INTO r FROM public.biz_brand_person_authorized_contact(
    pg_temp.c3524_uuid('brand'), v_no, 'email', 'transactional');
  PERFORM pg_temp.c3524_expect(r.reason <> 'consent_missing'
    AND r.contact_method_id IS NOT NULL,
    'C: transactional must be unaffected, got ' || coalesce(r.reason, '(null)'));

  -- ── D(cont). the granted contact reaches ─────────────────────────────────
  SELECT * INTO r FROM public.biz_brand_person_authorized_contact_v2(
    pg_temp.c3524_uuid('brand'), v_yes, 'email', 'marketing_blast');
  PERFORM pg_temp.c3524_expect(r.contact_method_id IS NOT NULL
    AND r.reason <> 'consent_missing',
    'D: a granted contact must still be marketable, got '
      || coalesce(r.reason, '(null)'));

  -- ── E. a grant is never un-granted by a re-ingest ────────────────────────
  DELETE FROM public.consent_records
   WHERE contact = 'gavepermission@example.test'
     AND brand_id = pg_temp.c3524_uuid('brand');
  -- A SECOND order, not a re-run of the first: biz_resolve_brand_person_source
  -- returns 'already_linked' before it reaches the contact-method write, so
  -- re-calling it for the same source id would prove nothing at all.
  PERFORM public.biz_resolve_brand_person_source(
    pg_temp.c3524_uuid('brand'), pg_temp.c3524_uuid('event'), 'order',
    pg_temp.c3524_uuid('order-yes2'), NULL, NULL,
    'gavepermission@example.test', NULL, now());
  SELECT marketing_consent_state INTO v_state
    FROM public.brand_person_contact_methods
   WHERE brand_person_id = v_yes AND channel = 'email';
  PERFORM pg_temp.c3524_expect(v_state = 'granted',
    'E: a re-ingest that finds no row must NOT downgrade granted -> withheld. '
      || 'A revocation is expressed as a suppression, not as an ungrant. Got '
      || coalesce(v_state, '(null)'));

  -- ── I. marketing_opt_in carries no weight ────────────────────────────────
  --
  -- It lives on ticket_checkout_sessions, and buyer.tsx binds it to the
  -- MANDATORY terms checkbox (lines 304-313: `setBuyer({ termsAccepted: next,
  -- marketingOptIn: next })`), so it is structurally true on every completed
  -- ticket order and carries no discriminating signal at all. The fail-closed
  -- rule must key on the CONSENT ROW and nothing else.
  PERFORM pg_temp.c3524_expect(
    EXISTS (SELECT 1 FROM public.ticket_checkout_sessions
             WHERE id = pg_temp.c3524_uuid('cs-no') AND marketing_opt_in),
    'PRECONDITION: the withheld buyer''s checkout session says opted-in');
  SELECT * INTO r FROM public.biz_brand_person_authorized_contact_v2(
    pg_temp.c3524_uuid('brand'), v_no, 'email', 'marketing_blast');
  PERFORM pg_temp.c3524_expect(r.reason = 'consent_missing',
    'I: marketing_opt_in is structurally true on every completed ticket order '
      || '(buyer.tsx binds it to the mandatory terms checkbox), so it must not '
      || 'rescue a withheld contact. Got ' || coalesce(r.reason, '(null)'));

  -- ── G. attendance is untouched — the roster still has them ───────────────
  SELECT count(*) INTO v_rows FROM public.biz_guest_roster_project(
    pg_temp.c3524_uuid('event')) g
   WHERE g::text ILIKE '%' || v_no::text || '%';
  PERFORM pg_temp.c3524_expect(v_rows >= 1,
    'G: the guest roster is ATTENDANCE and must still contain the person '
      || 'whose marketing permission is withheld. Rows: ' || v_rows);

  -- ── H. the brand_book export omits them; the guest roster export does NOT ─
  INSERT INTO public.brand_people_export_jobs(
    id, brand_id, export_kind, scope_id, filter_json, filter_hash,
    client_request_id, requested_by, status, storage_path, row_count
  ) VALUES (
    pg_temp.c3524_uuid('job-book'), pg_temp.c3524_uuid('brand'),
    'brand_book', NULL, '{"filter":"all","search":""}'::jsonb, 'c3524book',
    pg_temp.c3524_uuid('job-book'), pg_temp.c3524_uuid('creator'),
    'queued', 'issue-3524/book.csv', 0
  ), (
    pg_temp.c3524_uuid('job-roster'), pg_temp.c3524_uuid('brand'),
    'offering_guest_roster', pg_temp.c3524_uuid('event'),
    '{"filter":"all","search":""}'::jsonb, 'c3524roster', pg_temp.c3524_uuid('job-roster'),
    pg_temp.c3524_uuid('creator'), 'queued', 'issue-3524/roster.csv', 0
  );
  SELECT count(*) INTO v_rows
    FROM public.biz_brand_people_export_rows(pg_temp.c3524_uuid('job-book')) b
   WHERE b::text ILIKE '%nopermission@example.test%';
  PERFORM pg_temp.c3524_expect(v_rows = 0,
    'H: the brand_book export is the MARKETING book and must omit a withheld '
      || 'contact. Rows carrying that address: ' || v_rows);
  SELECT count(*) INTO v_rows
    FROM public.biz_brand_people_export_rows(pg_temp.c3524_uuid('job-book')) b
   WHERE b::text ILIKE '%gavepermission@example.test%';
  PERFORM pg_temp.c3524_expect(v_rows >= 1,
    'H: the granted contact must still be in the brand_book export — the rule '
      || 'must subtract the withheld, not the book. Rows: ' || v_rows);
  SELECT count(*) INTO v_rows
    FROM public.biz_brand_people_export_rows(pg_temp.c3524_uuid('job-roster')) b
   WHERE b::text ILIKE '%nopermission@example.test%';
  PERFORM pg_temp.c3524_expect(v_rows >= 1,
    'H: the offering_guest_roster export is ATTENDANCE and must still carry '
      || 'the withheld person — that is the list the host runs the event from. '
      || 'Rows: ' || v_rows);

  -- ── J. no brand-read policy crept onto the legal audit table ─────────────
  PERFORM pg_temp.c3524_expect(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'consent_records') = 1,
    'J: consent_records must keep exactly ONE policy (read-own). The '
      || 'host-facing answer is marketing_consent_state, never the audit table.');
  PERFORM pg_temp.c3524_expect(
    (SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.consent_records'::regclass),
    'J: RLS must stay enabled on consent_records');
  PERFORM pg_temp.c3524_expect(
    (SELECT roles::text FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'consent_records')
      = '{authenticated}',
    'J: the one policy must remain the authenticated read-own policy. Brand '
      || 'staff must NOT reach the legal audit table through brand_id — the '
      || 'host-facing answer is marketing_consent_state on the contact method, '
      || 'which they already reach through biz_list_brand_people.');
END;
$harness$;

DO $verdict$
DECLARE v_count integer; v_all text;
BEGIN
  SELECT count(*), string_agg(message, E'\n  - ') INTO v_count, v_all
    FROM c3524_failures;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'issue #3524 tester adversarial (consent): % failure(s):%  - %',
      v_count, E'\n', v_all;
  END IF;
  RAISE NOTICE 'issue #3524 tester adversarial (consent): all assertions passed';
END;
$verdict$;

ROLLBACK;
