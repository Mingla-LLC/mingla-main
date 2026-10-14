\set ON_ERROR_STOP on

-- Issue #3827 — tester RETEST for the buyer email on a live edit (migration
-- 20271014103827), after the first tester round failed on a privacy defect.
-- Run after the full migration chain on PostgreSQL 17.
--
-- Each case attacks one rework claim from a different angle than the
-- implementor's suite:
--   RM-01..05  (M1) the address hidden AFTER an email was recorded: while it
--              waits (plain table write, the live editor, the same edit as a
--              venue change), after the fan-out with copies still pending or
--              waiting on a retry, together with the taxonomy leaf in one
--              transaction, for a venue known only through its label, on an
--              RSVP, and hidden then shown again before the send (the waiting
--              email stays scrubbed: it says the address changed and points
--              to the page; the street is never put back).
--   RF-01..02  (F1) pilot plus allowlist-only on an RSVP: off-list guests get
--              exactly the legacy row main queues (template, key shape,
--              payload, channels), the allowlisted guest only the new message,
--              nobody twice; allowlist-only switched off mid-flight still
--              gives one message per guest.
--   RS-01      (F4) the send check after fan-out: master switch off or
--              missing, pilot removal, allowlist removal and allowlist-only
--              switched back on all hold; the host reads held, not failed;
--              no client role can call it.
--   RC-01      (F2/F3) the status counts emailable people and those without an
--              email apart; the count equals the emails the fan-out queues;
--              the testing phase is reported.
--   RU-01      unpublish, re-publish, cancel and delete record nothing, even
--              in the same write as an edit; a waiting email is held.
--
-- WHAT A LOGGED OR HELD NOTICE KEEPS. A notice that is logged or held is
-- history and is never sent; by design it keeps the values it recorded, so the
-- street checks below read only notices that can still be sent and the queued
-- copies.
--
-- FAILS ON REVERT (product files at 93265d8e7, the first tester round's
-- head, migration md5 51541efbfff92200aeb41be4be057144 applied on main's
-- chain): RM-01, RM-02, RM-03, RM-05 (a street stays in the waiting or
-- fanned-out notice), RM-04 (the street is still in the waiting email),
-- RF-01 (off-list guests get no legacy alert), RS-01
-- (event_edit_notice_send_check does not exist), RC-01 (no noEmail or
-- allowlistOnly in the status; audience counted people without an email) and
-- RU-01 (an unpublish in the same write as an edit is recorded). RF-02 passes
-- on both: it guards the new legacy de-duplication against a double send.
--
-- Every case rolls back. Nothing here sends anything.

-- ── fixtures (copied from the first tester suite, renamed) ──────────────────
CREATE OR REPLACE FUNCTION pg_temp.t3827r_settle() RETURNS void
LANGUAGE plpgsql AS $settle$
BEGIN
  -- Fires every deferred trigger now, as COMMIT would, then goes back to
  -- deferring so the next statement behaves as in production.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
END;
$settle$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_publish_payload(p_hide_address boolean, p_revision integer)
RETURNS jsonb LANGUAGE sql STABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'T3827R night',
    'timezone', 'America/New_York',
    'is_online', false,
    'city', 'Brooklyn',
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'in_person',
      'requestedVisibility', 'public',
      'clientRevision', p_revision,
      'city', 'Brooklyn',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn'),
      'hideAddressUntilTicket', p_hide_address,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Free entry', 'isFree', true, 'price', 0, 'capacity', 100)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char(now() + interval '12 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))))
$payload$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_event(p_tag text, p_hide_address boolean DEFAULT false)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_tier uuid, v_revision integer)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827r-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827R ' || p_tag, 't3827r-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (v_event, v_brand, v_user, 'T3827R draft', 't3827r-draft-' || v_event, 'event', 'draft',
    'draft', 'America/New_York');
  PERFORM public.issue_1719_publish_event_with_poster(v_event,
    pg_temp.t3827r_publish_payload(p_hide_address, 1), 1);
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS DISTINCT FROM 'scheduled'
     OR v_row.theme #>> '{business_event,location,address}' IS DISTINCT FROM '61 Wythe Avenue, Brooklyn' THEN
    RAISE EXCEPTION 'fixture: the published event is not the shape the suite assumes (status %, theme %)',
      v_row.status, v_row.theme -> 'business_event';
  END IF;
  SELECT tt.id INTO v_tier FROM public.ticket_types AS tt
   WHERE tt.event_id = v_event AND tt.deleted_at IS NULL LIMIT 1;
  v_revision := COALESCE((v_row.theme #>> '{business_event,clientRevision}')::integer, 0);
  PERFORM pg_temp.t3827r_settle();
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_buyer(p_event uuid, p_tier uuid, p_email text, p_name text DEFAULT 'T3827R Buyer')
RETURNS uuid LANGUAGE plpgsql AS $buyer$
DECLARE
  v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
                            payment_method, payment_status, source)
  VALUES (v_order, p_event, p_email, p_name, '+15550003827', 0, 'free', 'paid', 'online_checkout');
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
  VALUES (gen_random_uuid(), v_order, p_tier, p_event, 'mingla:v1:ticket:' || gen_random_uuid()::text,
          md5(gen_random_uuid()::text), 'valid', 'auto');
  RETURN v_order;
END;
$buyer$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_go_live(p_brand uuid, p_allowlist_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $live$
BEGIN
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (p_brand) ON CONFLICT DO NOTHING;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email';
  UPDATE public.feature_flags SET is_enabled = p_allowlist_only
   WHERE flag_key = 'event_update_buyer_email_allowlist_only';
END;
$live$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_rsvp(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_guest uuid)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_row public.events%ROWTYPE;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_guest := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827r-rsvp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827R RSVP ' || p_tag, 't3827r-rsvp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (v_event, v_brand, v_user, 'T3827R RSVP', 't3827r-rsvp-draft-' || v_event, 'rsvp', 'draft',
    'draft', 'America/New_York', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'clientRevision', 0)));
  PERFORM public.business_update_rsvp_graph(v_event, jsonb_build_object(
    '__expectedClientRevision', 1,
    'title', 'T3827R RSVP',
    'description', NULL,
    'location_text', 'Lantern Room · 61 Wythe Avenue, Brooklyn',
    'online_url', NULL,
    'currency', 'USD',
    'is_online', false,
    'timezone', 'America/New_York',
    'city', 'Brooklyn',
    'theme', jsonb_build_object('coverHue', 25, 'business_draft', jsonb_build_object(
      'format', 'in_person',
      'partyTypes', jsonb_build_array('house-party'),
      'vibeTags', '[]'::jsonb,
      'musicGenres', '[]'::jsonb,
      'city', 'Brooklyn',
      'requestedVisibility', 'public',
      'whenMode', 'single',
      'when', jsonb_build_object(
        'date', to_char((now() + interval '30 days')::date, 'YYYY-MM-DD'),
        'doorsOpen', '19:00', 'endsAt', '23:00', 'timezone', 'America/New_York'),
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '61 Wythe Avenue, Brooklyn'),
      'hideAddressUntilTicket', false,
      'tickets', '[]'::jsonb,
      'isRsvp', true,
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', false,
      'rsvpContributionSuggestedCents', NULL,
      'rsvpContributionMinCents', NULL,
      'clientRevision', 1))), NULL, NULL);
  PERFORM public.business_publish_rsvp_graph(v_event, gen_random_uuid());
  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.status IS NULL OR v_row.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'fixture: the RSVP did not publish (status %)', v_row.status;
  END IF;
  -- Publishing (draft to scheduled) is not a live edit.
  PERFORM pg_temp.t3827r_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices AS n WHERE n.event_id = v_event)
     OR EXISTS (SELECT 1 FROM public.event_edit_notice_pending AS p WHERE p.event_id = v_event) THEN
    RAISE EXCEPTION 'fixture: publishing an RSVP recorded an edit notice or left a capture behind';
  END IF;
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_guest, v_event, 'T3827R Guest', 't3827r-guest-' || v_guest || '@example.test', '+15550003827',
          'going', 'approved');
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_experience(p_tag text)
RETURNS TABLE(v_user uuid, v_brand uuid, v_event uuid, v_tier uuid, v_date text)
LANGUAGE plpgsql AS $fixture$
DECLARE
  v_start timestamptz;
BEGIN
  v_user := gen_random_uuid();
  v_brand := gen_random_uuid();
  v_event := gen_random_uuid();
  v_tier := gen_random_uuid();
  v_date := to_char((now() + interval '20 days')::date, 'YYYY-MM-DD');
  v_start := (v_date || ' 18:00:00')::timestamp AT TIME ZONE 'America/New_York';
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827r-exp-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'T3827R Exp ' || p_tag, 't3827r-exp-' || p_tag || '-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, description, slug, event_type, status,
    visibility, timezone, currency, location_mode, pricing_mode, experience_intents, experience_intent)
  VALUES (v_event, v_brand, v_user, 'T3827R walk', 'A walk through two rooms for the suite.',
    't3827r-exp-' || v_event, 'experience', 'draft', 'draft', 'America/New_York', 'USD',
    'per_stop', 'whole', ARRAY['group-fun'], 'group-fun');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, v_start, v_start + interval '3 hours', 'America/New_York', true);
  INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, lat, lng, start_time)
  VALUES (v_event, 0, 'place-one', 'Velvet Cellar', '11 Secret Lane, Brooklyn', 40.71001, -73.95001, '18:00'),
         (v_event, 1, 'place-two', 'Glasshouse Loft', '22 Hidden Row, Brooklyn', 40.72002, -73.96002, '19:30');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, is_free, display_order)
  VALUES (v_tier, v_event, 'Spot', 0, true, 0);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = v_event;
  PERFORM pg_temp.t3827r_settle();
  RETURN NEXT;
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_experience_payload(
  p_date text, p_second_address text DEFAULT '22 Hidden Row, Brooklyn',
  p_second_time text DEFAULT '19:30', p_second_name text DEFAULT 'Glasshouse Loft')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'title', 'T3827R walk',
    'description', 'A walk through two rooms for the suite.',
    'experience_intents', jsonb_build_array('group-fun'),
    'location_mode', 'per_stop',
    'pricing_mode', 'whole',
    'is_free', true,
    'timezone', 'America/New_York',
    'whenMode', 'single',
    'when', jsonb_build_object('date', p_date, 'doorsOpen', '18:00', 'endsAt', '21:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('place_id', 'place-one', 'place_name', 'Velvet Cellar',
        'address', '11 Secret Lane, Brooklyn', 'lat', 40.71001, 'lng', -73.95001, 'start_time', '18:00'),
      jsonb_build_object('place_id', 'place-two', 'place_name', p_second_name,
        'address', p_second_address, 'lat', 40.72002, 'lng', -73.96002, 'start_time', p_second_time)))
$payload$;

-- Everything the feature stores or queues about one event, as one string.
CREATE OR REPLACE FUNCTION pg_temp.t3827r_everything(p_event uuid)
RETURNS text LANGUAGE sql AS $all$
  SELECT COALESCE((SELECT string_agg(row_to_json(n)::text, ' ') FROM public.event_edit_notices AS n
                    WHERE n.event_id = p_event), '')
      || ' ' || COALESCE((SELECT string_agg(row_to_json(p)::text, ' ') FROM public.event_edit_notice_pending AS p
                    WHERE p.event_id = p_event), '')
      || ' ' || COALESCE((SELECT string_agg(row_to_json(r)::text, ' ') FROM public.rsvp_notifications AS r
                    WHERE r.event_id = p_event AND r.payload ? 'noticeId'), '')
$all$;

-- ── helpers for the retest ─────────────────────────────────────────────────
-- Probe: M1 paths
CREATE OR REPLACE FUNCTION pg_temp.t3827r_wait_addr(p_event uuid) RETURNS void LANGUAGE plpgsql AS $w$
BEGIN
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,location,address}', '"250 Bedford Avenue, Brooklyn"'::jsonb)
   WHERE id = p_event;
  PERFORM pg_temp.t3827r_settle();
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = p_event AND state = 'scheduled'
                  AND notice_changes::text ~ 'Bedford') THEN
    RAISE EXCEPTION 'fixture: no waiting notice carrying the street (%)',
      (SELECT jsonb_agg(to_jsonb(n) - 'base_snapshot' - 'after_snapshot') FROM public.event_edit_notices n WHERE event_id = p_event);
  END IF;
END $w$;
CREATE OR REPLACE FUNCTION pg_temp.t3827r_hide(p_event uuid, p_on boolean) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  UPDATE public.events
     SET theme = jsonb_set(theme, '{business_event,hideAddressUntilTicket}', to_jsonb(p_on))
   WHERE id = p_event;
  PERFORM pg_temp.t3827r_settle();
END $h$;
CREATE OR REPLACE FUNCTION pg_temp.t3827r_assert_no_street(p_case text, p_event uuid) RETURNS void LANGUAGE plpgsql AS $a$
DECLARE v_all text :=
  -- Every notice that can still be sent, and every queued copy. A notice that
  -- is logged or held is history and is never sent (by design it keeps what
  -- it recorded); it is not part of what an email can read.
  COALESCE((SELECT string_agg(row_to_json(n)::text, ' ') FROM public.event_edit_notices AS n
             WHERE n.event_id = p_event AND n.state IN ('scheduled', 'superseded', 'fanned_out')), '')
  || ' ' || COALESCE((SELECT string_agg(row_to_json(p)::text, ' ') FROM public.event_edit_notice_pending AS p
             WHERE p.event_id = p_event), '')
  || ' ' || COALESCE((SELECT string_agg(row_to_json(r)::text, ' ') FROM public.rsvp_notifications AS r
             WHERE r.event_id = p_event AND r.payload ? 'noticeId'), '');
BEGIN
  IF v_all ~* 'Wythe|Bedford|Kent Avenue|Berry Street|Lorimer|Havemeyer' THEN
    RAISE EXCEPTION '% FAIL: a street of a now-hidden event is still stored where an email can read it: %', p_case, v_all;
  END IF;
END $a$;

-- ─── RM-01 (M1): hide switched on while an email is waiting ─────────────────
-- (a) by a plain table write that changes nothing else, (b) through the live
-- editor with a reason, (c) by the same edit that renames the venue.
BEGIN;
DO $rm01$
DECLARE
  f record; g record; h record;
  v_n public.event_edit_notices%ROWTYPE;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('rm01a');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand);
  PERFORM pg_temp.t3827r_wait_addr(f.v_event);
  PERFORM pg_temp.t3827r_hide(f.v_event, true);
  PERFORM pg_temp.t3827r_assert_no_street('RM-01 (a)', f.v_event);
  SELECT * INTO v_n FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled';
  IF NOT FOUND OR v_n.notice_changes IS DISTINCT FROM '[{"field":"address","withheld":true}]'::jsonb THEN
    RAISE EXCEPTION 'RM-01 FAIL (a): the waiting email should still go, saying only that the address changed (%)',
      (SELECT jsonb_agg(jsonb_build_object('s', state, 'nc', notice_changes)) FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second' WHERE id = v_n.id;
  PERFORM public.event_edit_notice_fanout(20);
  PERFORM pg_temp.t3827r_assert_no_street('RM-01 (a) after fan-out', f.v_event);

  SELECT * INTO g FROM pg_temp.t3827r_event('rm01b');
  PERFORM pg_temp.t3827r_buyer(g.v_event, g.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(g.v_brand);
  PERFORM pg_temp.t3827r_wait_addr(g.v_event);
  PERFORM public.business_update_live_event_atomic(g.v_event,
    jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', true)),
    'Hiding the address until a ticket', g.v_revision + 1);
  PERFORM pg_temp.t3827r_settle();
  PERFORM pg_temp.t3827r_assert_no_street('RM-01 (b)', g.v_event);

  SELECT * INTO h FROM pg_temp.t3827r_event('rm01c');
  PERFORM pg_temp.t3827r_buyer(h.v_event, h.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(h.v_brand);
  PERFORM pg_temp.t3827r_wait_addr(h.v_event);
  PERFORM public.business_update_live_event_atomic(h.v_event,
    jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', true, 'venueName', 'Room Two')),
    'New room, and the address is hidden now', h.v_revision + 1);
  PERFORM pg_temp.t3827r_settle();
  PERFORM pg_temp.t3827r_assert_no_street('RM-01 (c)', h.v_event);
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = h.v_event AND state = 'scheduled'
                  AND notice_changes @> '[{"field":"venue","new":"Room Two"}]'::jsonb
                  AND notice_changes @> '[{"field":"address","withheld":true}]'::jsonb) THEN
    RAISE EXCEPTION 'RM-01 FAIL (c): the merged email lost the venue name or the withheld address (%)',
      (SELECT jsonb_agg(jsonb_build_object('s', state, 'nc', notice_changes)) FROM public.event_edit_notices WHERE event_id = h.v_event);
  END IF;
  RAISE NOTICE 'RM-01 PASS: hide switched on while an email waits (table write, live editor, same edit as a venue change) leaves no street anywhere';
END $rm01$;
ROLLBACK;

-- ─── RM-02 (M1): fanned out, not yet sent; and a copy waiting on a retry ────
BEGIN;
DO $rm02$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('rm02');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'bo@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand);
  PERFORM pg_temp.t3827r_wait_addr(f.v_event);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  -- One copy failed once and waits for a retry; the other is still pending.
  UPDATE public.rsvp_notification_deliveries AS d SET status = 'failed_retryable'
    FROM public.rsvp_notifications AS r
   WHERE d.notification_id = r.id AND r.event_id = f.v_event AND r.payload ->> 'recipientEmail' = 'bo@example.test';
  PERFORM pg_temp.t3827r_hide(f.v_event, true);
  PERFORM pg_temp.t3827r_assert_no_street('RM-02', f.v_event);
  RAISE NOTICE 'RM-02 PASS: a notice fanned out but not fully sent loses its street when the address is hidden';
END $rm02$;
ROLLBACK;

-- ─── RM-03 (M1): hidden by a direct write, then the taxonomy leaf moves the
-- address in the same transaction; and a label-only venue hidden later ─────
BEGIN;
DO $rm03$
DECLARE
  f record; g record;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('rm03a');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand);
  PERFORM pg_temp.t3827r_wait_addr(f.v_event);
  UPDATE public.events SET theme = jsonb_set(theme, '{business_event,hideAddressUntilTicket}', 'true'::jsonb)
   WHERE id = f.v_event;
  PERFORM public.business_patch_event_taxonomy(f.v_event, 'Brooklyn', ARRAY['festival'], ARRAY['social'],
    ARRAY[]::text[], 40.7081, -73.9571, '77 Kent Avenue, Brooklyn', 'approximate');
  PERFORM pg_temp.t3827r_settle();
  PERFORM pg_temp.t3827r_assert_no_street('RM-03 (a)', f.v_event);

  -- Label only: the venue IS the label, which holds a street.
  SELECT * INTO g FROM pg_temp.t3827r_event('rm03b');
  PERFORM pg_temp.t3827r_buyer(g.v_event, g.v_tier, 'ada@example.test');
  UPDATE public.events SET theme = theme #- '{business_event,location}', location_text = 'Speakeasy · 9 Lorimer Street'
   WHERE id = g.v_event;
  PERFORM pg_temp.t3827r_settle();
  PERFORM pg_temp.t3827r_go_live(g.v_brand);
  UPDATE public.events SET location_text = 'Speakeasy · 14 Havemeyer Street' WHERE id = g.v_event;
  PERFORM pg_temp.t3827r_settle();
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = g.v_event AND state = 'scheduled'
                  AND notice_changes::text ~ 'Havemeyer') THEN
    RAISE EXCEPTION 'RM-03 fixture: the label change did not wait as an email';
  END IF;
  PERFORM pg_temp.t3827r_hide(g.v_event, true);
  PERFORM pg_temp.t3827r_assert_no_street('RM-03 (b)', g.v_event);
  RAISE NOTICE 'RM-03 PASS: hide plus a taxonomy-leaf move in one transaction, and a label-only venue hidden later, store no street';
END $rm03$;
ROLLBACK;

-- ─── RM-04 (M1): hidden, then shown again before the send ────────────────────
-- Chosen behaviour (consistent, never leaks): the waiting email stays
-- scrubbed. It says the address changed and points to the page; the street is
-- not put back.
BEGIN;
DO $rm04$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('rm04');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand);
  PERFORM pg_temp.t3827r_wait_addr(f.v_event);
  PERFORM pg_temp.t3827r_hide(f.v_event, true);
  PERFORM pg_temp.t3827r_hide(f.v_event, false);
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled'
                     AND notice_changes = '[{"field":"address","withheld":true}]'::jsonb) THEN
    RAISE EXCEPTION 'RM-04 FAIL: after hide on then off, expected one waiting email that says only "the address changed" (%)',
      (SELECT jsonb_agg(jsonb_build_object('s', state, 'nc', notice_changes)) FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  PERFORM pg_temp.t3827r_assert_no_street('RM-04', f.v_event);
  RAISE NOTICE 'RM-04 PASS: hide on then off before the send keeps the waiting email scrubbed (address changed, see the page)';
END $rm04$;
ROLLBACK;

-- ─── RM-05 (M1): an RSVP hidden through its live editor while an email waits ─
BEGIN;
DO $rm05$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_rsvp('rm05');
  PERFORM pg_temp.t3827r_go_live(f.v_brand);
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827R RSVP',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', '250 Bedford Avenue, Brooklyn')),
    'Moving to the bigger room', NULL);
  PERFORM pg_temp.t3827r_settle();
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'scheduled') THEN
    RAISE EXCEPTION 'RM-05 fixture: the RSVP edit did not wait as an email (%)',
      (SELECT jsonb_agg(jsonb_build_object('s', state, 'h', hold_code, 'nc', notice_changes)) FROM public.event_edit_notices WHERE event_id = f.v_event);
  END IF;
  PERFORM public.business_update_rsvp_graph(f.v_event,
    jsonb_build_object('title', 'T3827R RSVP', 'hideAddressUntilTicket', true),
    'Hiding the address from now on', NULL);
  PERFORM pg_temp.t3827r_settle();
  IF (SELECT theme #>> '{business_event,hideAddressUntilTicket}' FROM public.events WHERE id = f.v_event) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'RM-05 fixture: the RSVP did not hide its address';
  END IF;
  PERFORM pg_temp.t3827r_assert_no_street('RM-05', f.v_event);
  RAISE NOTICE 'RM-05 PASS: an RSVP hidden through its live editor leaves no street in the waiting email';
END $rm05$;
ROLLBACK;

-- ─── RF-01 (F1): pilot plus allowlist-only on an RSVP ────────────────────────
-- Three going guests: one off the allowlist (email and phone), one on it, one
-- with a phone and no email. The off-list guests get exactly the legacy alert
-- main queues today; the allowlisted guest gets only the new message; nobody
-- is told twice. Then the same with allowlist-only switched OFF before the
-- fan-out: still exactly one message per guest.
CREATE OR REPLACE FUNCTION pg_temp.t3827r_rsvp_trio(p_tag text)
RETURNS TABLE(v_event uuid, v_brand uuid, v_off uuid, v_on uuid, v_phone uuid)
LANGUAGE plpgsql AS $trio$
DECLARE f record; v_member uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_rsvp(p_tag);
  -- A signed-in guest who gave a phone and no email.
  INSERT INTO auth.users(id, email) VALUES (v_member, 't3827r-member-' || v_member || '@example.test');
  v_event := f.v_event; v_brand := f.v_brand; v_off := f.v_guest;
  v_on := gen_random_uuid(); v_phone := gen_random_uuid();
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_on, f.v_event, 'Listed Guest', 'Tester.' || p_tag || '@Example.test', '+15550003828', 'going', 'approved');
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_phone, f.v_event, v_member, 'Phone Guest', NULL, '+15550003829', 'going', 'approved');
  INSERT INTO public.event_update_email_allowlist(email) VALUES (lower('tester.' || p_tag || '@example.test'));
  RETURN NEXT;
END $trio$;

CREATE OR REPLACE FUNCTION pg_temp.t3827r_rsvp_move(p_event uuid, p_address text)
RETURNS void LANGUAGE plpgsql AS $mv$
BEGIN
  PERFORM public.business_update_rsvp_graph(p_event,
    jsonb_build_object('title', 'T3827R RSVP',
      'location', jsonb_build_object('venueName', 'Lantern Room', 'address', p_address)),
    'Moving to the bigger room', NULL);
  PERFORM pg_temp.t3827r_settle();
END $mv$;

BEGIN;
DO $rf01$
DECLARE
  t record;
  v_legacy jsonb;
  v_new jsonb;
  v_notice public.event_edit_notices%ROWTYPE;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('rf01');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');

  SELECT jsonb_agg(r.rsvp_id ORDER BY r.rsvp_id) INTO v_legacy FROM public.rsvp_notifications AS r
   WHERE r.event_id = t.v_event AND r.template_key = 'rsvp_event_updated' AND NOT (r.payload ? 'noticeId');
  IF v_legacy IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x) FROM unnest(ARRAY[t.v_off, t.v_phone]) AS x) THEN
    RAISE EXCEPTION 'RF-01 FAIL: the legacy alert must go to exactly the two off-list guests (got %)', v_legacy;
  END IF;
  -- The legacy row is the row main queues: same template, key shape, payload
  -- keys and channels.
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications AS r
              WHERE r.event_id = t.v_event AND NOT (r.payload ? 'noticeId')
                AND (r.idempotency_key !~ ('^rsvp_update:' || t.v_event::text || ':[0-9]+:' || r.rsvp_id::text || '$')
                     OR r.channel IS NOT NULL OR r.recipient IS NOT NULL OR r.status <> 'pending'
                     OR (r.payload - ARRAY['entityId','recipientName','recipientEmail','recipientPhone',
                                           'primaryUserId','recoveryCreatedAt'])
                        IS DISTINCT FROM jsonb_build_object('template_key', 'rsvp_event_updated',
                                                            'rsvp_id', r.rsvp_id, 'event_id', t.v_event))) THEN
    RAISE EXCEPTION 'RF-01 FAIL: a legacy row differs from the row main queues';
  END IF;
  IF (SELECT array_agg(d.channel ORDER BY d.channel) FROM public.rsvp_notification_deliveries AS d
        JOIN public.rsvp_notifications AS r ON r.id = d.notification_id
       WHERE r.rsvp_id = t.v_off AND NOT (r.payload ? 'noticeId')) IS DISTINCT FROM ARRAY['email','sms']
     OR (SELECT array_agg(d.channel ORDER BY d.channel) FROM public.rsvp_notification_deliveries AS d
        JOIN public.rsvp_notifications AS r ON r.id = d.notification_id
       WHERE r.rsvp_id = t.v_phone AND NOT (r.payload ? 'noticeId')) IS DISTINCT FROM ARRAY['in_app','push','sms'] THEN
    RAISE EXCEPTION 'RF-01 FAIL: the legacy alert did not seed the channels it seeds today';
  END IF;

  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = t.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  SELECT jsonb_agg(r.rsvp_id) INTO v_new FROM public.rsvp_notifications AS r
   WHERE r.event_id = t.v_event AND r.payload ? 'noticeId';
  SELECT * INTO v_notice FROM public.event_edit_notices WHERE event_id = t.v_event AND state = 'fanned_out';
  IF v_new IS DISTINCT FROM jsonb_build_array(t.v_on) OR v_notice.held_count <> 2 THEN
    RAISE EXCEPTION 'RF-01 FAIL: the new message must reach only the allowlisted guest, two held (got %, held %)',
      v_new, v_notice.held_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = t.v_event
              GROUP BY rsvp_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'RF-01 FAIL: a guest was told twice';
  END IF;
  RAISE NOTICE 'RF-01 PASS: allowlist-only keeps the legacy alert for off-list guests (row for row), the new message for the listed guest, nobody twice';
END $rf01$;
ROLLBACK;

BEGIN;
DO $rf02$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('rf02');
  PERFORM pg_temp.t3827r_go_live(t.v_brand, true);
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  -- Testing ends while the email waits.
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = t.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  IF (SELECT count(*) FROM public.rsvp_notifications WHERE event_id = t.v_event) <> 3
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = t.v_event
                 GROUP BY rsvp_id HAVING count(*) <> 1)
     OR NOT EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = t.v_event
                     AND rsvp_id = t.v_on AND payload ? 'noticeId') THEN
    RAISE EXCEPTION 'RF-02 FAIL: switching allowlist-only off mid-flight must leave exactly one message per guest (%)',
      (SELECT jsonb_agg(jsonb_build_object('rsvp', rsvp_id, 'notice', payload ? 'noticeId'))
         FROM public.rsvp_notifications WHERE event_id = t.v_event);
  END IF;
  RAISE NOTICE 'RF-02 PASS: allowlist-only switched off before the fan-out: one message per guest, none dropped, none doubled';
END $rf02$;
ROLLBACK;

-- ─── RS-01 (F4): the send check, after fan-out ───────────────────────────────
BEGIN;
DO $rs01$
DECLARE
  f record;
  v_notice uuid;
  v_status jsonb;
  c record;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('rs01');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'listed@example.test');
  INSERT INTO public.event_update_email_allowlist(email) VALUES ('listed@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand, false);
  PERFORM pg_temp.t3827r_wait_addr(f.v_event);
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  SELECT id INTO v_notice FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'fanned_out';
  IF public.event_edit_notice_send_check(v_notice, 'ada@example.test') <> 'ok'
     OR public.event_edit_notice_send_check(v_notice, 'listed@example.test') <> 'ok' THEN
    RAISE EXCEPTION 'RS-01 FAIL: with everything on, both copies must be allowed';
  END IF;
  -- Allowlist-only switched back on: only the listed address may go.
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  IF public.event_edit_notice_send_check(v_notice, 'ada@example.test') <> 'held_allowlist'
     OR public.event_edit_notice_send_check(v_notice, ' LISTED@example.test ') <> 'ok'
     OR public.event_edit_notice_send_check(v_notice, NULL) <> 'held_allowlist' THEN
    RAISE EXCEPTION 'RS-01 FAIL: allowlist-only switched on after the fan-out did not hold the off-list copy';
  END IF;
  -- The address leaves the allowlist.
  DELETE FROM public.event_update_email_allowlist WHERE email = 'listed@example.test';
  IF public.event_edit_notice_send_check(v_notice, 'listed@example.test') <> 'held_allowlist' THEN
    RAISE EXCEPTION 'RS-01 FAIL: an address removed from the allowlist may still be sent';
  END IF;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  -- The brand leaves the pilot.
  DELETE FROM public.event_update_email_pilot_brands WHERE brand_id = f.v_brand;
  IF public.event_edit_notice_send_check(v_notice, 'ada@example.test') <> 'held_feature_off' THEN
    RAISE EXCEPTION 'RS-01 FAIL: a brand removed from the pilot may still be sent';
  END IF;
  INSERT INTO public.event_update_email_pilot_brands(brand_id) VALUES (f.v_brand);
  -- The master switch off, and the switch row missing entirely.
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'event_update_buyer_email';
  IF public.event_edit_notice_send_check(v_notice, 'ada@example.test') <> 'held_feature_off' THEN
    RAISE EXCEPTION 'RS-01 FAIL: the master switch off does not stop a fanned-out copy';
  END IF;
  DELETE FROM public.feature_flags WHERE flag_key = 'event_update_buyer_email';
  IF public.event_edit_notice_send_check(v_notice, 'ada@example.test') <> 'held_feature_off' THEN
    RAISE EXCEPTION 'RS-01 FAIL: a missing master switch row does not fail closed';
  END IF;
  IF public.event_edit_notice_send_check(gen_random_uuid(), 'ada@example.test') <> 'notice_missing' THEN
    RAISE EXCEPTION 'RS-01 FAIL: an unknown notice is not "notice_missing"';
  END IF;

  -- The worker completes both copies as held, as rsvp-notify does: the host
  -- reads two held, none failed, none pending.
  FOR c IN SELECT * FROM public.claim_rsvp_notification_deliveries(NULL, 100) WHERE notification_id IN (
             SELECT id FROM public.rsvp_notifications WHERE event_id = f.v_event) LOOP
    PERFORM public.finish_rsvp_notification_delivery(c.delivery_id, c.lease_id, 'failed_terminal', NULL, 'held_feature_off');
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', f.v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_status := public.business_event_buyer_notice_status(f.v_event);
  IF (v_status #>> '{last,held}')::int <> 2 OR (v_status #>> '{last,failed}')::int <> 0
     OR (v_status #>> '{last,pending}')::int <> 0 OR (v_status #>> '{last,sent}')::int <> 0 THEN
    RAISE EXCEPTION 'RS-01 FAIL: copies held at send must read as held, not failed (%)', v_status -> 'last';
  END IF;
  -- Revoke grants: no client role may ask the send check.
  IF has_function_privilege('authenticated', 'public.event_edit_notice_send_check(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.event_edit_notice_send_check(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.event_edit_notice_withhold_unsent(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RS-01 FAIL: a client role can call an internal function';
  END IF;
  RAISE NOTICE 'RS-01 PASS: master off, missing switch, pilot removal, allowlist removal and allowlist-only on all hold a fanned-out copy; held reads as held';
END $rs01$;
ROLLBACK;

-- ─── RC-01 (F2/F3): the counts the host is shown equal what is emailed ──────
BEGIN;
DO $rc01$
DECLARE
  t record;
  v_status jsonb;
  v_user uuid;
  v_rows integer;
BEGIN
  SELECT * INTO t FROM pg_temp.t3827r_rsvp_trio('rc01');
  SELECT account_id INTO v_user FROM public.brands WHERE id = t.v_brand;
  PERFORM pg_temp.t3827r_go_live(t.v_brand, false);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_status := public.business_event_buyer_notice_status(t.v_event);
  IF (v_status ->> 'audience')::int <> 2 OR (v_status ->> 'noEmail')::int <> 1
     OR (v_status ->> 'allowlistOnly')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'RC-01 FAIL: status must say 2 emailable, 1 without email, not testing (%)', v_status;
  END IF;
  PERFORM pg_temp.t3827r_rsvp_move(t.v_event, '250 Bedford Avenue, Brooklyn');
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = t.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  SELECT count(*) INTO v_rows FROM public.rsvp_notification_deliveries AS d
    JOIN public.rsvp_notifications AS r ON r.id = d.notification_id
   WHERE r.event_id = t.v_event AND r.payload ? 'noticeId' AND d.channel = 'email';
  IF v_rows <> (v_status ->> 'audience')::int THEN
    RAISE EXCEPTION 'RC-01 FAIL: the host was told % people would be emailed, the server queued % emails',
      v_status ->> 'audience', v_rows;
  END IF;
  -- Testing on: the status says so.
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'event_update_buyer_email_allowlist_only';
  v_status := public.business_event_buyer_notice_status(t.v_event);
  IF (v_status ->> 'allowlistOnly')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RC-01 FAIL: the status does not say emails are being tested (%)', v_status;
  END IF;
  RAISE NOTICE 'RC-01 PASS: status counts emailable people and those with no email apart, equal to the emails queued; testing is reported';
END $rc01$;
ROLLBACK;

-- ─── RU-01: unpublish, cancel and delete record nothing, even with an edit ──
BEGIN;
DO $ru01$
DECLARE
  f record; g record; h record;
  v_before integer;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827r_event('ru01a');
  PERFORM pg_temp.t3827r_buyer(f.v_event, f.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(f.v_brand);
  PERFORM pg_temp.t3827r_wait_addr(f.v_event);
  SELECT count(*) INTO v_before FROM public.event_edit_notices WHERE event_id = f.v_event;
  -- Unpublish and move the address in the same write.
  UPDATE public.events SET status = 'draft',
         theme = jsonb_set(theme, '{business_event,location,address}', '"77 Kent Avenue, Brooklyn"'::jsonb)
   WHERE id = f.v_event;
  PERFORM pg_temp.t3827r_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> v_before
     OR EXISTS (SELECT 1 FROM public.event_edit_notice_pending WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'RU-01 FAIL: an unpublish recorded an edit or left a capture';
  END IF;
  UPDATE public.event_edit_notices SET send_after = now() - interval '1 second'
   WHERE event_id = f.v_event AND state = 'scheduled';
  PERFORM public.event_edit_notice_fanout(20);
  IF NOT EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = f.v_event AND state = 'held'
                  AND hold_code = 'event_not_live')
     OR EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE event_id = f.v_event) THEN
    RAISE EXCEPTION 'RU-01 FAIL: the email waiting when the listing was unpublished was not held';
  END IF;
  -- Publish again: not an edit.
  UPDATE public.events SET status = 'scheduled' WHERE id = f.v_event;
  PERFORM pg_temp.t3827r_settle();
  IF (SELECT count(*) FROM public.event_edit_notices WHERE event_id = f.v_event) <> v_before THEN
    RAISE EXCEPTION 'RU-01 FAIL: re-publishing recorded an edit';
  END IF;

  SELECT * INTO g FROM pg_temp.t3827r_event('ru01b');
  PERFORM pg_temp.t3827r_buyer(g.v_event, g.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(g.v_brand);
  UPDATE public.events SET timezone = 'America/Chicago' WHERE id = g.v_event;
  UPDATE public.events SET status = 'cancelled' WHERE id = g.v_event;
  PERFORM pg_temp.t3827r_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = g.v_event) THEN
    RAISE EXCEPTION 'RU-01 FAIL: an edit then a cancel in one transaction recorded an edit';
  END IF;

  SELECT * INTO h FROM pg_temp.t3827r_event('ru01c');
  PERFORM pg_temp.t3827r_buyer(h.v_event, h.v_tier, 'ada@example.test');
  PERFORM pg_temp.t3827r_go_live(h.v_brand);
  UPDATE public.events SET timezone = 'America/Chicago', deleted_at = now() WHERE id = h.v_event;
  PERFORM pg_temp.t3827r_settle();
  IF EXISTS (SELECT 1 FROM public.event_edit_notices WHERE event_id = h.v_event) THEN
    RAISE EXCEPTION 'RU-01 FAIL: an edit in the same write as a delete recorded an edit';
  END IF;
  RAISE NOTICE 'RU-01 PASS: unpublish, re-publish, cancel and delete record nothing; a waiting email is held';
END $ru01$;
ROLLBACK;
