\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4541-CHECKOUT-ANSWER-INSERT-ONLY | issue #4541 | checkout finalize and its retry sweep only insert the order's own response when the buyer has none at this event; they never update a stored response (T-1, T-5).
-- MINGLA-INVARIANT: I-4541-ONE-CURRENT-HOLDER-RULE | issue #4541 | approved Going and Maybe RSVPs, claimed plus-ones of them and paid or partly refunded orders are the only subjects counted, asked, shown at the door or able to answer; pending, denied, waitlisted, refunded and Can't go are not (T-2).
-- MINGLA-INVARIANT: I-4541-NEWEST-LINK-ONLY | issue #4541 | issuing a personal form link revokes the same person's earlier links for that form and page (T-9).
-- MINGLA-INVARIANT: I-4541-ATOMIC-SUBMIT-ADMISSION | issue #4541 | per-address form submit admission counts and records under one advisory lock, so concurrent submits never exceed the limit (T-11).
-- MINGLA-INVARIANT: I-4541-NO-ANON-FORMS-GRANT | issue #4541 | every function M-A adds is executable by service_role (and host/admin RPCs by authenticated, checked inside); none by anon or PUBLIC (T-13, T-42).
-- #4541 M-A (20281122004541_issue_4541_forms_fixes.sql): PostgreSQL 17 proof after the full replay.
-- Run as supabase_admin (the T-11 race opens two dblink sessions, as issue_0871 does).
--
-- T-1   finalize insert-only (SC-1, SC-2), a failing insert never aborts the order
-- T-2   one current-holder rule in every reader (SC-5, SC-6), ended events kept 30 days
-- T-3   comp orders are added by the host (SC-7)
-- T-4   erase (SC-8) and retention (SC-9), the #4452 job gains exactly one line
-- T-5   retry sweep promotes a stuck stash insert-only; stuck count (SC-10, SQL part)
-- T-6   the off switch stops enqueue, claim and the automatic reminder (SC-11)
-- T-7   duplicating an event copies its form attachment (SC-13)
-- T-8   signed-in answers follow the read rule (SC-45)
-- T-9   a new link revokes the earlier one (SC-46)
-- T-10  door: invited staff line only by default, switch, team, per-guest cap, host log (SC-47)
-- T-11  atomic admission (SC-48, SQL part): sequential limit, then a two-session race
-- T-12  not asked yet and counts (SC-3, server)
-- T-13  grants; the admin read refuses non-admins and carries no answers (SC-43)
-- T-42  every client-called RPC called the way a browser or app calls it
-- T-RH  after-RSVP hand-off link (R1.3); T-GA guest answers (R1.9); T-OPS alert claim (R7.2)
--
-- FAILS-ON-REVERT: restoring the #4514 UPDATE branch in finalize fails T-1a; dropping the
-- brand_form_subject_current call from any reader fails its T-2 line; dropping 'comp' from
-- brand_form_added_by_host fails T-3; dropping the order delete in brand_form_erase_person
-- fails T-4a; dropping the 12-month predicate fails T-4b; dropping the retry insert fails
-- T-5; dropping the switch guard in claim fails T-6; dropping the PERFORM copy line fails
-- T-7; dropping the holder-or-public check fails T-8; dropping the revoke UPDATE fails T-9;
-- dropping the invited branch or the per-subject cap fails T-10; dropping the advisory lock
-- in brand_form_attempt_admit fails T-11 race; dropping notAsked fails T-12; a grant line to
-- anon/authenticated fails T-13/T-42.

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4541 M-A FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END;
$fn$;

-- A stable uuid per tag.
CREATE OR REPLACE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4541ma:' || p_tag)::uuid $fn$;

BEGIN;

DO $fixture$
DECLARE
  v_def jsonb := '{"schema":"mingla.brand_form.v1","title":"Guest questions","intro":"One question","questions":[{"id":"45419000-0000-4000-8000-000000000101","position":0,"type":"short_text","label":"Dietary needs","required":true,"show_at_door":true,"door_label":"Diet"}]}'::jsonb;
  v_tag text;
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['owner','em','mm','tsc','inv','b1','b2','b3','b4','s','um','up','uw','ud','un','ug1','ugst',
                               'ue','uegst','adm','uh1','uh2','na1','na2','na3','ee1','ee2'] LOOP
    INSERT INTO auth.users(id, email) VALUES (pg_temp.u(v_tag), 'i4541ma-' || v_tag || '@example.test');
    INSERT INTO public.profiles(id, email, display_name, first_name, last_name)
    VALUES (pg_temp.u(v_tag), 'i4541ma-' || v_tag || '@example.test', initcap(v_tag) || ' Person', initcap(v_tag), 'Person')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'Issue 4541 MA', 'i4541ma-brand', 'USD'),
         (pg_temp.u('brand_del'), pg_temp.u('owner'), 'Issue 4541 MA gone', 'i4541ma-gone', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'brand_owner', now()),
         (pg_temp.u('brand'), pg_temp.u('em'), 'event_manager', now()),
         (pg_temp.u('brand'), pg_temp.u('mm'), 'marketing_manager', now()),
         (pg_temp.u('brand'), pg_temp.u('tsc'), 'scanner', now());
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (pg_temp.u('e1'), pg_temp.u('brand'), 'MA one', 'i4541ma-e1', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (pg_temp.u('e2'), pg_temp.u('brand'), 'MA two', 'i4541ma-e2', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (pg_temp.u('er'), pg_temp.u('brand'), 'MA RSVP', 'i4541ma-er', 'rsvp', 'scheduled', 'public', 'UTC', 'USD'),
         (pg_temp.u('eo'), pg_temp.u('brand'), 'MA optional', 'i4541ma-eo', 'event', 'scheduled', 'public', 'UTC', 'USD'),
         (pg_temp.u('eh'), pg_temp.u('brand'), 'MA after RSVP', 'i4541ma-eh', 'rsvp', 'scheduled', 'public', 'UTC', 'USD'),
         (pg_temp.u('en'), pg_temp.u('brand'), 'MA not asked', 'i4541ma-en', 'rsvp', 'scheduled', 'public', 'UTC', 'USD'),
         (pg_temp.u('ee'), pg_temp.u('brand'), 'MA ended', 'i4541ma-ee', 'rsvp', 'ended', 'public', 'UTC', 'USD'),
         (pg_temp.u('eeold'), pg_temp.u('brand'), 'MA ended long ago', 'i4541ma-eeold', 'rsvp', 'ended', 'public', 'UTC', 'USD'),
         (pg_temp.u('e13'), pg_temp.u('brand'), 'MA 13 months', 'i4541ma-e13', 'event', 'ended', 'public', 'UTC', 'USD'),
         (pg_temp.u('e11'), pg_temp.u('brand'), 'MA 11 months', 'i4541ma-e11', 'event', 'ended', 'public', 'UTC', 'USD'),
         (pg_temp.u('edel'), pg_temp.u('brand_del'), 'MA gone brand', 'i4541ma-edel', 'event', 'scheduled', 'public', 'UTC', 'USD');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (pg_temp.u('e1'), now() + interval '5 days', now() + interval '5 days 4 hours', 'UTC', true),
         (pg_temp.u('e2'), now() + interval '6 days', now() + interval '6 days 4 hours', 'UTC', true),
         (pg_temp.u('er'), now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true),
         (pg_temp.u('ee'), now() - interval '10 days 4 hours', now() - interval '10 days', 'UTC', true),
         (pg_temp.u('eeold'), now() - interval '40 days 4 hours', now() - interval '40 days', 'UTC', true),
         (pg_temp.u('e13'), now() - interval '12 months 2 days', now() - interval '12 months 1 day', 'UTC', true),
         (pg_temp.u('e11'), now() - interval '11 months 1 day', now() - interval '11 months', 'UTC', true);
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (pg_temp.u('er'), pg_temp.u('inv'));
  -- RSVPs at er: going, maybe (approved), maybe pending, waitlisted, denied, can't go.
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (pg_temp.u('r_go'), pg_temp.u('er'), pg_temp.u('ug1'), 'Gia Going', 'i4541ma-go@example.test', '+12025559001', 'going', 'approved'),
         (pg_temp.u('r_maybe'), pg_temp.u('er'), pg_temp.u('um'), 'May Maybe', 'i4541ma-maybe@example.test', '+12025559002', 'maybe', 'approved'),
         (pg_temp.u('r_pend'), pg_temp.u('er'), pg_temp.u('up'), 'Pen Pending', 'i4541ma-pend@example.test', '+12025559003', 'maybe', 'pending'),
         (pg_temp.u('r_wait'), pg_temp.u('er'), pg_temp.u('uw'), 'Wes Wait', 'i4541ma-wait@example.test', '+12025559004', 'waitlisted', 'approved'),
         (pg_temp.u('r_deny'), pg_temp.u('er'), pg_temp.u('ud'), 'Den Denied', 'i4541ma-deny@example.test', '+12025559005', 'going', 'denied'),
         (pg_temp.u('r_no'), pg_temp.u('er'), pg_temp.u('un'), 'Nan Nope', 'i4541ma-no@example.test', '+12025559006', 'not_going', 'approved'),
         (pg_temp.u('r_b2'), pg_temp.u('e2'), pg_temp.u('b2'), 'Bea Two', 'i4541ma-b2@example.test', '+12025559007', 'going', 'approved'),
         (pg_temp.u('r_ended'), pg_temp.u('ee'), pg_temp.u('um'), 'May Maybe', 'i4541ma-maybe@example.test', '+12025559002', 'going', 'approved'),
         (pg_temp.u('r_old'), pg_temp.u('eeold'), pg_temp.u('um'), 'May Maybe', 'i4541ma-maybe@example.test', '+12025559002', 'going', 'approved'),
         (pg_temp.u('r_h1'), pg_temp.u('eh'), pg_temp.u('uh1'), 'Hal One', 'i4541ma-h1@example.test', '+12025559008', 'going', 'approved'),
         (pg_temp.u('r_h2'), pg_temp.u('eh'), pg_temp.u('uh2'), 'Hal Two', 'i4541ma-h2@example.test', '+12025559009', 'going', 'pending'),
         (pg_temp.u('r_na1'), pg_temp.u('en'), pg_temp.u('na1'), 'Nia One', 'i4541ma-na1@example.test', '+12025559010', 'going', 'approved'),
         (pg_temp.u('r_na2'), pg_temp.u('en'), pg_temp.u('na2'), 'Nia Two', 'i4541ma-na2@example.test', '+12025559011', 'going', 'approved'),
         (pg_temp.u('r_na3'), pg_temp.u('en'), pg_temp.u('na3'), 'Nia Three', 'i4541ma-na3@example.test', '+12025559012', 'maybe', 'approved'),
         (pg_temp.u('r_e'), pg_temp.u('er'), pg_temp.u('ue'), 'Eve Erase', 'i4541ma-e@example.test', '+12025559013', 'going', 'approved');
  INSERT INTO public.event_rsvp_guests(id, rsvp_id, name, email, phone, matched_user_id, invited_by_user_id, claimed_at)
  VALUES (pg_temp.u('g_maybe'), pg_temp.u('r_maybe'), 'Gus Guest', 'i4541ma-gst@example.test', '+12025559020',
          pg_temp.u('ugst'), pg_temp.u('um'), now()),
         (pg_temp.u('g_e'), pg_temp.u('r_go'), 'Egg Guest', 'i4541ma-egst@example.test', '+12025559021',
          pg_temp.u('ue'), pg_temp.u('ug1'), now());
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source, is_door_sale, comp_request_key)
  VALUES (pg_temp.u('o1'), pg_temp.u('e1'), pg_temp.u('b1'), 'Bo One', 'i4541ma-b1@example.test', '+12025559101', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('o2'), pg_temp.u('e2'), pg_temp.u('b1'), 'Bo One', 'i4541ma-b1@example.test', '+12025559101', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('o_b2'), pg_temp.u('e2'), pg_temp.u('b2'), 'Bea Two', 'i4541ma-b2@example.test', '+12025559007', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('o3'), pg_temp.u('e1'), pg_temp.u('b3'), 'Cy Three', 'i4541ma-b3@example.test', '+12025559103', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('o4'), pg_temp.u('e1'), pg_temp.u('b4'), 'Di Four', 'i4541ma-b4@example.test', '+12025559104', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('o_ref'), pg_temp.u('e1'), pg_temp.u('s'), 'Rae Refund', 'i4541ma-ref@example.test', '+12025559105', 1000, 'USD', 'online_card', 'refunded', 'online_checkout', false, NULL),
         (pg_temp.u('o_comp'), pg_temp.u('e1'), NULL, 'Cam Comp', 'i4541ma-comp@example.test', '+12025559106', 0, 'USD', 'free', 'paid', 'comp', false, 'i4541ma-comp-1'),
         (pg_temp.u('o_e'), pg_temp.u('e1'), pg_temp.u('ue'), 'Eve Erase', 'i4541ma-e@example.test', '+12025559013', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('o13'), pg_temp.u('e13'), NULL, 'Old Order', 'i4541ma-o13@example.test', '+12025559107', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('o11'), pg_temp.u('e11'), NULL, 'Recent Order', 'i4541ma-o11@example.test', '+12025559108', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL),
         (pg_temp.u('odel'), pg_temp.u('edel'), NULL, 'Gone Brand Order', 'i4541ma-odel@example.test', '+12025559109', 1000, 'USD', 'online_card', 'paid', 'online_checkout', false, NULL);
  INSERT INTO public.ticket_checkout_sessions(id, event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
    idempotency_key, expires_at, status, total_cents, currency, buyer_user_id)
  VALUES (pg_temp.u('s1'), pg_temp.u('e1'), pg_temp.u('brand'), 'Bo One', 'i4541ma-b1@example.test', '+12025559101', 'i4541ma-s1', now() + interval '1 hour', 'requires_payment', 1000, 'USD', pg_temp.u('b1')),
         (pg_temp.u('s2'), pg_temp.u('e2'), pg_temp.u('brand'), 'Bo One', 'i4541ma-b1@example.test', '+12025559101', 'i4541ma-s2', now() + interval '1 hour', 'requires_payment', 1000, 'USD', pg_temp.u('b1')),
         (pg_temp.u('s_b2'), pg_temp.u('e2'), pg_temp.u('brand'), 'Bea Two', 'i4541ma-b2@example.test', '+12025559007', 'i4541ma-sb2', now() + interval '1 hour', 'requires_payment', 1000, 'USD', pg_temp.u('b2')),
         (pg_temp.u('s3'), pg_temp.u('e1'), pg_temp.u('brand'), 'Cy Three', 'i4541ma-b3@example.test', '+12025559103', 'i4541ma-s3', now() + interval '1 hour', 'requires_payment', 1000, 'USD', pg_temp.u('b3')),
         (pg_temp.u('s4'), pg_temp.u('e1'), pg_temp.u('brand'), 'Di Four', 'i4541ma-b4@example.test', '+12025559104', 'i4541ma-s4', now() + interval '1 hour', 'requires_payment', 1000, 'USD', pg_temp.u('b4')),
         (pg_temp.u('s_e'), pg_temp.u('e1'), pg_temp.u('brand'), 'Eve Erase', 'i4541ma-e@example.test', '+12025559013', 'i4541ma-se', now() + interval '1 hour', 'requires_payment', 1000, 'USD', pg_temp.u('ue'));
  -- Forms: F (required) on e1, e2, er, ee, eeold, e13, e11; optional on eo; H after-RSVP on eh; N on en;
  -- D for the soft-deleted brand.
  INSERT INTO public.brand_forms(id, brand_id, name, status, draft, created_by, updated_by, door_full_answers)
  VALUES (pg_temp.u('F'), pg_temp.u('brand'), 'MA questions', 'draft', v_def, pg_temp.u('owner'), pg_temp.u('owner'), true),
         (pg_temp.u('H'), pg_temp.u('brand'), 'MA after', 'draft', v_def, pg_temp.u('owner'), pg_temp.u('owner'), false),
         (pg_temp.u('N'), pg_temp.u('brand'), 'MA not asked', 'draft', v_def, pg_temp.u('owner'), pg_temp.u('owner'), false),
         (pg_temp.u('D'), pg_temp.u('brand_del'), 'MA gone', 'draft', v_def, pg_temp.u('owner'), pg_temp.u('owner'), false);
  INSERT INTO public.brand_form_versions(id, form_id, version, definition, definition_sha256, published_by)
  VALUES (pg_temp.u('Fv'), pg_temp.u('F'), 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), pg_temp.u('owner')),
         (pg_temp.u('Hv'), pg_temp.u('H'), 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), pg_temp.u('owner')),
         (pg_temp.u('Nv'), pg_temp.u('N'), 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), pg_temp.u('owner')),
         (pg_temp.u('Dv'), pg_temp.u('D'), 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), pg_temp.u('owner'));
  UPDATE public.brand_forms SET status = 'live',
         live_version_id = CASE id WHEN pg_temp.u('F') THEN pg_temp.u('Fv') WHEN pg_temp.u('H') THEN pg_temp.u('Hv')
                                   WHEN pg_temp.u('N') THEN pg_temp.u('Nv') ELSE pg_temp.u('Dv') END
   WHERE id IN (pg_temp.u('F'), pg_temp.u('H'), pg_temp.u('N'), pg_temp.u('D'));
  INSERT INTO public.brand_form_attachments(id, form_id, brand_id, event_id, mode, created_by)
  VALUES (pg_temp.u('a_e1'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('e1'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_e2'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('e2'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_er'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('er'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_eo'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('eo'), 'optional_on_page', pg_temp.u('owner')),
         (pg_temp.u('a_ee'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('ee'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_eeold'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('eeold'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_e13'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('e13'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_e11'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('e11'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_eh'), pg_temp.u('H'), pg_temp.u('brand'), pg_temp.u('eh'), 'after_purchase', pg_temp.u('owner')),
         (pg_temp.u('a_en'), pg_temp.u('N'), pg_temp.u('brand'), pg_temp.u('en'), 'required_step', pg_temp.u('owner')),
         (pg_temp.u('a_edel'), pg_temp.u('D'), pg_temp.u('brand_del'), pg_temp.u('edel'), 'required_step', pg_temp.u('owner'));
  INSERT INTO public.admin_users(email, role, status) VALUES ('i4541ma-adm@example.test', 'admin', 'active');
  PERFORM set_config('session_replication_role', 'origin', true);
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.ans(p_text text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
$fn$ SELECT jsonb_build_object('45419000-0000-4000-8000-000000000101', p_text) $fn$;

CREATE OR REPLACE FUNCTION pg_temp.form_payload(p_form uuid, p_ver uuid, p_text text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
$fn$ SELECT jsonb_build_object('formId', p_form, 'versionId', p_ver, 'answers', pg_temp.ans(p_text)) $fn$;

-- A direct response row (service role path), for fixtures.
CREATE OR REPLACE FUNCTION pg_temp.resp(p_form uuid, p_ver uuid, p_event uuid, p_kind text, p_id uuid, p_text text)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.brand_form_responses (form_id, version_id, brand_id, event_id, rsvp_id, rsvp_guest_id, order_id, user_id, answers, source)
  VALUES (p_form, p_ver, (SELECT brand_id FROM public.brand_forms WHERE id = p_form), p_event,
          CASE WHEN p_kind = 'rsvp' THEN p_id END, CASE WHEN p_kind = 'rsvp_guest' THEN p_id END,
          CASE WHEN p_kind = 'order' THEN p_id END, CASE WHEN p_kind = 'user' THEN p_id END,
          pg_temp.ans(p_text), 'page')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- ═══ T-1 finalize insert-only (SC-1, SC-2) ═══════════════════════════════════════
DO $t$
DECLARE
  v jsonb; v_r1 record; v_r1_after record; v_n integer; v_src text; v_ok boolean;
BEGIN
  -- Buyer B1 answers F at E1's checkout.
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_stash(pg_temp.u('s1'), pg_temp.u('e1'), true,
         pg_temp.form_payload(pg_temp.u('F'), pg_temp.u('Fv'), 'Vegan'), pg_temp.u('b1'), NULL);
  RESET ROLE;
  PERFORM pg_temp.ok(v->>'outcome' = 'stash', 'T-1 E1 answers are stashed (' || v::text || ')');
  UPDATE public.ticket_checkout_sessions SET order_id = pg_temp.u('o1'), status = 'paid_completed' WHERE id = pg_temp.u('s1');
  SELECT r.id, r.answers, r.event_id, r.edit_count, r.updated_at INTO v_r1
    FROM public.brand_form_responses r WHERE r.form_id = pg_temp.u('F') AND r.order_id = pg_temp.u('o1');
  PERFORM pg_temp.ok(v_r1.id IS NOT NULL AND v_r1.answers = pg_temp.ans('Vegan') AND v_r1.event_id = pg_temp.u('e1'),
    'T-1 finalize inserts E1''s order response');
  -- Then buys E2 (same form) with different answers.
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_check(pg_temp.u('e2'), true,
         pg_temp.form_payload(pg_temp.u('F'), pg_temp.u('Fv'), 'Halal'), pg_temp.u('b1'), NULL);
  PERFORM pg_temp.ok(v->>'outcome' = 'stash', 'T-1 an answer at another event is not "answered" here (' || v::text || ')');
  v := public.brand_form_checkout_form(pg_temp.u('e2'), pg_temp.u('b1'), NULL);
  PERFORM pg_temp.ok((v->>'answered')::boolean IS FALSE AND (v->>'answeredHere')::boolean IS FALSE
      AND v->'prefill'->'answers' = pg_temp.ans('Vegan'),
    'T-1 the E2 read is not answered here, prefilled (editable) from E1 (' || v::text || ')');
  v := public.brand_form_checkout_stash(pg_temp.u('s2'), pg_temp.u('e2'), true,
         pg_temp.form_payload(pg_temp.u('F'), pg_temp.u('Fv'), 'Halal'), pg_temp.u('b1'), NULL);
  RESET ROLE;
  UPDATE public.ticket_checkout_sessions SET order_id = pg_temp.u('o2'), status = 'paid_completed' WHERE id = pg_temp.u('s2');
  SELECT r.id, r.answers, r.event_id, r.edit_count, r.updated_at INTO v_r1_after
    FROM public.brand_form_responses r WHERE r.id = v_r1.id;
  PERFORM pg_temp.ok(v_r1_after.answers = v_r1.answers AND v_r1_after.event_id = v_r1.event_id
      AND v_r1_after.edit_count = v_r1.edit_count AND v_r1_after.updated_at = v_r1.updated_at,
    'T-1a SC-1 E1''s response is unchanged (answers, event, edit count) after the E2 purchase');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_form_responses r
                              WHERE r.order_id = pg_temp.u('o2') AND r.answers = pg_temp.ans('Halal') AND r.event_id = pg_temp.u('e2')),
    'T-1a SC-1 E2 has its own new response on the E2 order');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_form_event_responses(pg_temp.u('F'), pg_temp.u('e1')) x WHERE x.order_id = pg_temp.u('o1'))
      AND EXISTS (SELECT 1 FROM public.brand_form_event_responses(pg_temp.u('F'), pg_temp.u('e2')) x WHERE x.order_id = pg_temp.u('o2')),
    'T-1 SC-1 the buyer is answered in both events'' Responses');

  -- SC-2: a buyer with a response on an RSVP at E2 checks out E2.
  PERFORM pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('e2'), 'rsvp', pg_temp.u('r_b2'), 'Kosher');
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_check(pg_temp.u('e2'), true,
         pg_temp.form_payload(pg_temp.u('F'), pg_temp.u('Fv'), 'Something else'), pg_temp.u('b2'), NULL);
  PERFORM pg_temp.ok(v->>'outcome' = 'answered' AND v->>'responseId' IS NOT NULL,
    'T-1 SC-2 answered at this event: the check says answered whatever was sent (' || v::text || ')');
  v := public.brand_form_checkout_stash(pg_temp.u('s_b2'), pg_temp.u('e2'), true,
         pg_temp.form_payload(pg_temp.u('F'), pg_temp.u('Fv'), 'Something else'), pg_temp.u('b2'), NULL);
  PERFORM pg_temp.ok(v->>'outcome' = 'answered'
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = pg_temp.u('s_b2')),
    'T-1 SC-2 nothing is stashed');
  v := public.brand_form_checkout_form(pg_temp.u('e2'), pg_temp.u('b2'), NULL);
  PERFORM pg_temp.ok((v->>'answered')::boolean AND (v->>'answeredHere')::boolean
      AND v->'prefill'->'answers' = pg_temp.ans('Kosher'),
    'T-1 SC-2 the read says answered here with the buyer''s own answers read-only');
  RESET ROLE;
  UPDATE public.ticket_checkout_sessions SET order_id = pg_temp.u('o_b2'), status = 'paid_completed' WHERE id = pg_temp.u('s_b2');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE order_id = pg_temp.u('o_b2'))
      AND (SELECT count(*) FROM public.brand_form_responses r WHERE r.form_id = pg_temp.u('F')
             AND (r.rsvp_id = pg_temp.u('r_b2') OR r.order_id = pg_temp.u('o_b2'))) = 1,
    'T-1 SC-2 no second row exists');

  -- A failing insert inside finalize never aborts the order; the stash stays.
  SET LOCAL ROLE service_role;
  PERFORM public.brand_form_checkout_stash(pg_temp.u('s4'), pg_temp.u('e1'), true,
         pg_temp.form_payload(pg_temp.u('F'), pg_temp.u('Fv'), 'Nuts'), pg_temp.u('b4'), NULL);
  RESET ROLE;
  CREATE FUNCTION pg_temp.ma_boom() RETURNS trigger LANGUAGE plpgsql AS $b$
  BEGIN RAISE EXCEPTION 'ma_forced_response_failure' USING ERRCODE = '23514'; END; $b$;
  EXECUTE 'CREATE TRIGGER ma_boom BEFORE INSERT ON public.brand_form_responses FOR EACH ROW EXECUTE FUNCTION pg_temp.ma_boom()';
  v_ok := true;
  BEGIN
    UPDATE public.ticket_checkout_sessions SET order_id = pg_temp.u('o4'), status = 'paid_completed' WHERE id = pg_temp.u('s4');
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  EXECUTE 'DROP TRIGGER ma_boom ON public.brand_form_responses';
  PERFORM pg_temp.ok(v_ok AND (SELECT order_id FROM public.ticket_checkout_sessions WHERE id = pg_temp.u('s4')) = pg_temp.u('o4')
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE order_id = pg_temp.u('o4'))
      AND EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = pg_temp.u('s4')),
    'T-1 a constraint failure is caught: the order is finalized and the stash stays for the sweep');

  -- I-4541-CHECKOUT-ANSWER-INSERT-ONLY: no response UPDATE anywhere on the finalize path.
  SELECT string_agg(p.prosrc, E'\n') INTO v_src FROM pg_proc p
   WHERE p.oid IN ('public.brand_form_finalize_checkout_answers()'::regprocedure,
                   'public.brand_form_promote_stash(uuid)'::regprocedure,
                   'public.brand_form_checkout_answers_retry(integer)'::regprocedure);
  PERFORM pg_temp.ok(v_src !~* 'UPDATE\s+public\.brand_form_responses',
    'T-1 I-4541-CHECKOUT-ANSWER-INSERT-ONLY no UPDATE of brand_form_responses on the finalize path');
  PERFORM pg_temp.ok((SELECT prosrc FROM pg_proc WHERE oid = 'public.brand_form_promote_stash(uuid)'::regprocedure) ~ 'NOWAIT'
      AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.brand_form_promote_stash(uuid)'::regprocedure) ~ 'pg_try_advisory_xact_lock'
      AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.brand_form_promote_stash(uuid)'::regprocedure) !~ 'pg_advisory_xact_lock\(',
    'T-1 payment safety: only non-waiting locks on the finalize path');
END;
$t$;

-- ═══ T-5 retry sweep (SC-10, SQL part) ══════════════════════════════════════════
DO $t$
DECLARE v jsonb;
BEGIN
  UPDATE public.brand_form_checkout_answers SET updated_at = now() - interval '3 minutes'
   WHERE checkout_session_id = pg_temp.u('s4');
  CREATE FUNCTION pg_temp.ma_boom2() RETURNS trigger LANGUAGE plpgsql AS $b$
  BEGIN RAISE EXCEPTION 'ma_forced_retry_failure'; END; $b$;
  EXECUTE 'CREATE TRIGGER ma_boom2 BEFORE INSERT ON public.brand_form_responses FOR EACH ROW EXECUTE FUNCTION pg_temp.ma_boom2()';
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_answers_retry(50);
  RESET ROLE;
  EXECUTE 'DROP TRIGGER ma_boom2 ON public.brand_form_responses';
  PERFORM pg_temp.ok((v->>'failed')::integer = 1 AND (v->>'promoted')::integer = 0
      AND (SELECT retry_count FROM public.brand_form_checkout_answers WHERE checkout_session_id = pg_temp.u('s4')) = 1
      AND (SELECT last_error FROM public.brand_form_checkout_answers WHERE checkout_session_id = pg_temp.u('s4')) LIKE '%ma_forced_retry_failure%',
    'T-5 a failing retry is counted and recorded on the stash row (' || v::text || ')');
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_answers_retry(50);
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'promoted')::integer = 1
      AND EXISTS (SELECT 1 FROM public.brand_form_responses WHERE order_id = pg_temp.u('o4') AND answers = pg_temp.ans('Nuts'))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers WHERE checkout_session_id = pg_temp.u('s4')),
    'T-5 the next sweep promotes the stash insert-only (' || v::text || ')');
  -- A stash tried five times is stuck (the alert's signal).
  INSERT INTO public.brand_form_checkout_answers (checkout_session_id, event_id, form_id, version_id, answers, retry_count, updated_at)
  VALUES (pg_temp.u('s3'), pg_temp.u('e1'), pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.ans('Stuck'), 5, now());
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.ticket_checkout_sessions SET order_id = pg_temp.u('o3') WHERE id = pg_temp.u('s3');
  PERFORM set_config('session_replication_role', 'origin', true);
  SET LOCAL ROLE service_role;
  v := public.brand_form_checkout_answers_retry(50);
  PERFORM pg_temp.ok((v->>'stuck')::integer >= 1 AND (public.brand_form_queue_health()->>'stashStuck')::integer >= 1,
    'T-5 stuck stash rows are counted by the sweep and the queue health (' || v::text || ')');
  RESET ROLE;
  DELETE FROM public.brand_form_checkout_answers WHERE checkout_session_id = pg_temp.u('s3');
END;
$t$;

-- ═══ T-2 one current-holder rule (SC-5, SC-6) ══════════════════════════════════
DO $t$
DECLARE
  v jsonb; v_r text; v_pend_resp uuid; v_ref_resp uuid; v_names text[];
BEGIN
  -- A pending Maybe and a refunded order each have a stored answer.
  v_pend_resp := pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('er'), 'rsvp', pg_temp.u('r_pend'), 'Pending answer');
  v_ref_resp := pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('e1'), 'order', pg_temp.u('o_ref'), 'Refunded answer');

  -- brand_form_my_response: the approved Maybe opens the form; the pending one does not.
  PERFORM pg_temp.as_user(pg_temp.u('um'));
  SET LOCAL ROLE authenticated;
  v := public.brand_form_my_response(pg_temp.u('F'), pg_temp.u('er'));
  PERFORM pg_temp.ok(v->>'state' = 'unanswered', 'T-2 brand_form_my_response opens the form for an approved Maybe');
  v := public.brand_forms_my_pending();
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v) p
      WHERE (p->>'eventId')::uuid = pg_temp.u('er') AND p->'subject'->>'kind' = 'rsvp'),
    'T-2 brand_forms_my_pending lists the approved Maybe');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v) p
      WHERE (p->>'eventId')::uuid = pg_temp.u('ee') AND p->>'eventStatus' = 'ended')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) p WHERE (p->>'eventId')::uuid = pg_temp.u('eeold')),
    'T-2 brand_forms_my_pending keeps an event that ended 10 days ago (with its status) and drops one 40 days ago');
  RESET ROLE;
  -- (A person with a stored answer may always read their own answer, R8.1; these have none.)
  PERFORM pg_temp.as_user(pg_temp.u('uw'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.brand_form_my_response(%L, %L)$$, pg_temp.u('F'), pg_temp.u('er')));
  PERFORM pg_temp.ok(v_r LIKE 'P0002:form_not_found%', 'T-2 a waitlisted guest cannot open the form (' || v_r || ')');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('ud'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.brand_form_my_response(%L, %L)$$, pg_temp.u('F'), pg_temp.u('er')));
  PERFORM pg_temp.ok(v_r LIKE 'P0002:form_not_found%', 'T-2 a denied guest cannot open the form (' || v_r || ')');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('up'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_forms_my_pending()) p
      WHERE (p->>'eventId')::uuid = pg_temp.u('er')),
    'T-2 brand_forms_my_pending leaves out a pending Maybe');
  RESET ROLE;

  -- brand_form_submit_core: the Maybe saves; pending, waitlisted and denied are not current.
  SET LOCAL ROLE service_role;
  v := public.brand_form_submit_core(jsonb_build_object('formId', pg_temp.u('F'), 'answers', pg_temp.ans('Maybe answer'),
         'credential', jsonb_build_object('kind', 'user', 'userId', pg_temp.u('um'), 'rsvpId', pg_temp.u('r_maybe'))));
  PERFORM pg_temp.ok(v->>'created' = 'true', 'T-2 brand_form_submit_core saves for an approved Maybe (rsvpId)');
  v_r := pg_temp.err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', pg_temp.u('F'),
           'answers', pg_temp.ans('x'), 'credential', jsonb_build_object('kind', 'user', 'userId', pg_temp.u('up'), 'rsvpId', pg_temp.u('r_pend')))));
  PERFORM pg_temp.ok(v_r LIKE '42501:not_current%', 'T-2 a pending RSVP is not current (' || v_r || ')');
  v_r := pg_temp.err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', pg_temp.u('F'),
           'answers', pg_temp.ans('x'), 'credential', jsonb_build_object('kind', 'user', 'userId', pg_temp.u('uw'), 'rsvpId', pg_temp.u('r_wait')))));
  PERFORM pg_temp.ok(v_r LIKE '42501:not_current%', 'T-2 a waitlisted RSVP is not current');
  v_r := pg_temp.err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', pg_temp.u('F'),
           'answers', pg_temp.ans('x'), 'credential', jsonb_build_object('kind', 'user', 'userId', pg_temp.u('ud'), 'rsvpId', pg_temp.u('r_deny')))));
  PERFORM pg_temp.ok(v_r LIKE '42501:not_current%', 'T-2 a denied RSVP is not current');
  -- The claimed plus-one of the Maybe answers too.
  v := public.brand_form_submit_core(jsonb_build_object('formId', pg_temp.u('F'), 'answers', pg_temp.ans('Guest answer'),
         'credential', jsonb_build_object('kind', 'user', 'userId', pg_temp.u('ugst'), 'rsvpGuestId', pg_temp.u('g_maybe'))));
  PERFORM pg_temp.ok(v->>'created' = 'true', 'T-2 brand_form_submit_core saves for a claimed plus-one of an approved Maybe');

  -- The door: line and full answers for the Maybe; nothing for the pending one.
  v := public.brand_form_door_answers(pg_temp.u('em'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')));
  PERFORM pg_temp.ok(v->>'state' = 'answered', 'T-2 brand_form_door_answers draws the Maybe''s line');
  v := public.brand_form_door_answers(pg_temp.u('em'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_pend')));
  PERFORM pg_temp.ok(v IS NULL, 'T-2 brand_form_door_answers draws nothing for a pending RSVP with an answer');
  v := public.brand_form_door_full_answers(pg_temp.u('em'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')), 'search');
  PERFORM pg_temp.ok(v->>'state' = 'answered', 'T-2 brand_form_door_full_answers opens the Maybe''s full answers');
  v_r := pg_temp.err(format($$SELECT public.brand_form_door_full_answers(%L, %L, %L::jsonb, 'search')$$,
           pg_temp.u('em'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_pend'))));
  PERFORM pg_temp.ok(v_r LIKE '42501:subject_not_current%', 'T-2 the door refuses a pending RSVP''s full answers');

  -- Asked, counted and listed.
  SELECT array_agg(g.g_kind || ':' || g.g_id ORDER BY g.g_kind, g.g_id) INTO v_names
    FROM public.brand_form_request_guests(pg_temp.u('F'), pg_temp.u('er'), NULL) g;
  PERFORM pg_temp.ok(('rsvp:' || pg_temp.u('r_maybe')) = ANY (v_names) AND ('rsvp_guest:' || pg_temp.u('g_maybe')) = ANY (v_names)
      AND ('rsvp:' || pg_temp.u('r_go')) = ANY (v_names)
      AND NOT (('rsvp:' || pg_temp.u('r_pend')) = ANY (v_names)) AND NOT (('rsvp:' || pg_temp.u('r_wait')) = ANY (v_names))
      AND NOT (('rsvp:' || pg_temp.u('r_deny')) = ANY (v_names)) AND NOT (('rsvp:' || pg_temp.u('r_no')) = ANY (v_names)),
    'T-2 brand_form_request_guests asks Going, approved Maybe and its plus-one only (' || array_to_string(v_names, ',') || ')');
  -- Current and unanswered at er: Gia (going), Eve (going), Eve's claimed plus-one of Gia's RSVP.
  PERFORM pg_temp.ok(public.brand_form_unanswered_count(pg_temp.u('F'), pg_temp.u('er')) = 3,
    'T-2 brand_form_unanswered_count counts current holders only (' || public.brand_form_unanswered_count(pg_temp.u('F'), pg_temp.u('er')) || ')');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_event_responses(pg_temp.u('F'), pg_temp.u('er')) x WHERE x.id = v_pend_resp)
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_event_responses(pg_temp.u('F'), pg_temp.u('e1')) x WHERE x.id = v_ref_resp)
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_event_responses(pg_temp.u('F'), NULL) x WHERE x.id IN (v_pend_resp, v_ref_resp))
      AND EXISTS (SELECT 1 FROM public.brand_form_event_responses(pg_temp.u('F'), pg_temp.u('er')) x WHERE x.rsvp_id = pg_temp.u('r_maybe')),
    'T-2 brand_form_event_responses keeps the Maybe and drops pending and refunded rows (page and All pages)');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_form_responses WHERE id IN (v_pend_resp, v_ref_resp) HAVING count(*) = 2),
    'T-2 SC-5 the non-current rows are still stored');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_responses(pg_temp.u('F'), pg_temp.u('er'), 'all', 50, 0);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'notAnswered') n
                              WHERE n->>'kind' = 'rsvp_guest' AND (n->>'id')::uuid = pg_temp.u('g_e'))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'notAnswered') n WHERE (n->>'id')::uuid IN
                       (pg_temp.u('r_pend'), pg_temp.u('r_wait'), pg_temp.u('r_deny'), pg_temp.u('r_no')))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'rows') x WHERE (x->>'responseId')::uuid = v_pend_resp),
    'T-2 biz_brand_form_responses: not-answered lists claimed plus-ones and current holders only');
  RESET ROLE;

  -- A claimed send for a guest who stopped being current is skipped at claim.
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status)
  VALUES (pg_temp.u('F'), pg_temp.u('er'), pg_temp.u('brand'), pg_temp.u('r_pend'), 'rsvp:' || pg_temp.u('r_pend'), 'ask', ARRAY['email'], 'queued');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(25, pg_temp.u('F'), pg_temp.u('er'));
  RESET ROLE;
  PERFORM pg_temp.ok((SELECT status || ':' || safe_reason FROM public.brand_form_request_sends WHERE rsvp_id = pg_temp.u('r_pend')) = 'skipped:not_current'
      AND jsonb_array_length(v) = 0,
    'T-2 brand_form_request_claim_batch skips a non-current guest with reason not_current');
END;
$t$;

-- ═══ T-3 comp orders are added by the host (SC-7) ═══════════════════════════════
DO $t$
DECLARE v jsonb; v_with integer;
BEGIN
  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_responses(pg_temp.u('F'), pg_temp.u('e1'), 'all', 50, 0);
  RESET ROLE;
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'notAnswered') n
      WHERE (n->>'id')::uuid = pg_temp.u('o_comp') AND (n->>'addedByHost')::boolean),
    'T-3 a comp is "Added by you"');
  SET LOCAL ROLE service_role;
  -- e1 current orders: o1 (answered), o3 (none), o4 (answered), o_comp (comp), o_e (none).
  v_with := (SELECT count(*) FROM public.orders o WHERE o.event_id = pg_temp.u('e1') AND o.payment_status IN ('paid', 'partial_refund')
              AND (public.brand_form_find_response(pg_temp.u('F'), 'order', o.id)).id IS NULL)::integer;
  PERFORM pg_temp.ok(public.brand_form_unanswered_count(pg_temp.u('F'), pg_temp.u('e1')) = v_with - 1,
    'T-3 a comp is not counted "to answer"');
  v := public.brand_form_door_answers(pg_temp.u('em'), pg_temp.u('e1'), jsonb_build_object('kind', 'order', 'id', pg_temp.u('o_comp')));
  PERFORM pg_temp.ok(v IS NULL, 'T-3 a comp shows no "Questions not answered" at the door');
  v := public.brand_form_request_audience(pg_temp.u('em'), pg_temp.u('F'), pg_temp.u('e1'), 'unanswered', NULL, ARRAY['email']);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'id')::uuid = pg_temp.u('o_comp')),
    'T-3 a comp is not in the "Hasn''t answered" audience');
  v := public.brand_form_request_audience(pg_temp.u('em'), pg_temp.u('F'), pg_temp.u('e1'), 'everyone', NULL, ARRAY['email']);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'recipients') r WHERE (r->>'id')::uuid = pg_temp.u('o_comp')),
    'T-3 a comp is still in "Everyone going"');
  RESET ROLE;
END;
$t$;

-- ═══ T-4 erase (SC-8) and retention (SC-9) ═══════════════════════════════════════
DO $t$
DECLARE v jsonb; v_old uuid; v_new uuid; v_del uuid; v_cmd text;
BEGIN
  PERFORM pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('e1'), 'order', pg_temp.u('o_e'), 'Erase order');
  PERFORM pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('er'), 'rsvp', pg_temp.u('r_e'), 'Erase rsvp');
  PERFORM pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('er'), 'rsvp_guest', pg_temp.u('g_e'), 'Erase guest');
  PERFORM pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('eo'), 'user', pg_temp.u('ue'), 'Erase user');
  SET LOCAL ROLE service_role;
  PERFORM public.brand_form_link_issue(pg_temp.u('F'), pg_temp.u('e1'), jsonb_build_object('kind', 'order', 'id', pg_temp.u('o_e')));
  PERFORM public.brand_form_checkout_stash(pg_temp.u('s_e'), pg_temp.u('e1'), true,
         pg_temp.form_payload(pg_temp.u('F'), pg_temp.u('Fv'), 'Erase stash'), NULL, NULL);
  RESET ROLE;
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status)
  VALUES (pg_temp.u('F'), pg_temp.u('er'), pg_temp.u('brand'), pg_temp.u('r_e'), 'rsvp:' || pg_temp.u('r_e'), 'ask', ARRAY['email'], 'sent');
  SET LOCAL ROLE service_role;
  v := public.brand_form_erase_person(pg_temp.u('ue'));
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'responses')::integer = 4 AND (v->>'links')::integer = 1
      AND (v->>'requestSends')::integer = 1 AND (v->>'checkoutStash')::integer = 1,
    'T-4a erase counts (' || v::text || ')');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_responses r
                                  WHERE r.order_id = pg_temp.u('o_e') OR r.rsvp_id = pg_temp.u('r_e')
                                     OR r.rsvp_guest_id = pg_temp.u('g_e') OR r.user_id = pg_temp.u('ue'))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_links l WHERE l.order_id = pg_temp.u('o_e'))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends s WHERE s.rsvp_id = pg_temp.u('r_e'))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_checkout_answers c WHERE c.checkout_session_id = pg_temp.u('s_e')),
    'T-4a SC-8 no answer, link, request send or stash remains for the person''s own, order, RSVP or plus-one subjects');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.orders WHERE id = pg_temp.u('o_e'))
      AND EXISTS (SELECT 1 FROM public.event_rsvps WHERE id = pg_temp.u('r_e'))
      AND EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE id = pg_temp.u('g_e')),
    'T-4a the erase never deletes orders, RSVPs or plus-ones');

  -- Retention.
  v_old := pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('e13'), 'order', pg_temp.u('o13'), 'Old');
  v_new := pg_temp.resp(pg_temp.u('F'), pg_temp.u('Fv'), pg_temp.u('e11'), 'order', pg_temp.u('o11'), 'Recent');
  v_del := pg_temp.resp(pg_temp.u('D'), pg_temp.u('Dv'), pg_temp.u('edel'), 'order', pg_temp.u('odel'), 'Gone brand');
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.brands SET deleted_at = now() WHERE id = pg_temp.u('brand_del');
  PERFORM set_config('session_replication_role', 'origin', true);
  INSERT INTO public.brand_form_submit_attempts (ip_hash, form_id, outcome, created_at)
  VALUES (repeat('a', 64), NULL, 'accepted', now() - interval '31 days'),
         (repeat('b', 64), NULL, 'accepted', now() - interval '29 days');
  INSERT INTO public.brand_form_door_reads (actor_id, event_id, subject_kind, subject_id, via, result, created_at)
  VALUES (pg_temp.u('em'), pg_temp.u('e1'), 'order', pg_temp.u('o1'), 'scan', 'full', now() - interval '13 months');
  SET LOCAL ROLE service_role;
  v := public.brand_form_retention_purge();
  RESET ROLE;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE id = v_old)
      AND EXISTS (SELECT 1 FROM public.brand_form_responses WHERE id = v_new),
    'T-4b SC-9 an event that ended 12 months and a day ago is purged; 11 months is kept (' || v::text || ')');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_responses WHERE id = v_del)
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_submit_attempts WHERE ip_hash = repeat('a', 64))
      AND EXISTS (SELECT 1 FROM public.brand_form_submit_attempts WHERE ip_hash = repeat('b', 64))
      AND NOT EXISTS (SELECT 1 FROM public.brand_form_door_reads WHERE created_at < now() - interval '12 months'),
    'T-4b SC-9 a deleted brand''s answers, 30-day attempts and a 12-month door read are purged');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_each_text(v) x WHERE x.value = '-1'),
    'T-4b every retention step ran');
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'issue_4452_forms_retention';
  PERFORM pg_temp.ok(v_cmd IS NOT NULL
      AND (SELECT count(*) FROM regexp_matches(v_cmd, 'brand_form_retention_purge', 'g')) = 1
      AND rtrim(v_cmd, E' \n') LIKE '%SELECT public.brand_form_checkout_answers_purge();' || E'\n' || '    SELECT public.brand_form_retention_purge();'
      AND (SELECT count(*) FROM cron.job WHERE command LIKE '%brand_form_retention_purge%') = 1,
    'T-4 the #4452 job gains exactly one line; no new job');
END;
$t$;

-- ═══ T-6 the off switch stops request sends (SC-11) ═══════════════════════════════
DO $t$
DECLARE v jsonb; v_r text; v_id uuid;
BEGIN
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status)
  VALUES (pg_temp.u('F'), pg_temp.u('er'), pg_temp.u('brand'), pg_temp.u('r_go'), 'rsvp:' || pg_temp.u('r_go'), 'ask', ARRAY['email'], 'queued')
  RETURNING id INTO v_id;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';
  SET LOCAL ROLE service_role;
  v_r := pg_temp.err(format($$SELECT public.brand_form_request_enqueue(%L, %L, %L, 'ask', 'everyone', NULL, ARRAY['email'])$$,
           pg_temp.u('em'), pg_temp.u('F'), pg_temp.u('er')));
  PERFORM pg_temp.ok(v_r LIKE '55000:forms_paused%', 'T-6 enqueue raises forms_paused (' || v_r || ')');
  v := public.brand_form_request_claim_batch(25, NULL, NULL);
  PERFORM pg_temp.ok(v = '[]'::jsonb AND (SELECT status FROM public.brand_form_request_sends WHERE id = v_id) = 'queued',
    'T-6 claim returns no rows and the row stays queued');
  PERFORM pg_temp.ok(public.brand_form_auto_reminders_due() = '[]'::jsonb, 'T-6 the automatic reminder returns []');
  RESET ROLE;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'BRAND_FORMS_KILL_SWITCH';
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_claim_batch(25, pg_temp.u('F'), pg_temp.u('er'));
  RESET ROLE;
  PERFORM pg_temp.ok((SELECT status FROM public.brand_form_request_sends WHERE id = v_id) = 'claimed',
    'T-6 once the switch is off the queued row is claimed');
END;
$t$;

-- ═══ T-7 duplicate copies the attachment (SC-13) ══════════════════════════════════
DO $t$
DECLARE v jsonb; v_new uuid;
BEGIN
  PERFORM pg_temp.as_user(pg_temp.u('em'));
  SET LOCAL ROLE authenticated;
  v := public.business_duplicate_event_as_draft(pg_temp.u('e1'));
  RESET ROLE;
  v_new := (v#>>'{event,id}')::uuid;
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.brand_form_attachments a
      WHERE a.event_id = v_new AND a.form_id = pg_temp.u('F') AND a.mode = 'required_step' AND a.detached_at IS NULL),
    'T-7 the draft copy has the same form and mode attached');
END;
$t$;

-- ═══ T-8 signed-in answers follow the read rule (SC-45) ═══════════════════════════
DO $t$
DECLARE v jsonb; v_r text;
BEGIN
  SET LOCAL ROLE service_role;
  v_r := pg_temp.err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', pg_temp.u('F'),
           'eventId', pg_temp.u('e1'), 'answers', pg_temp.ans('x'), 'credential', jsonb_build_object('kind', 'user', 'userId', pg_temp.u('ee1')))));
  PERFORM pg_temp.ok(v_r LIKE '42501:not_holder%', 'T-8 a stranger cannot answer a required form (' || v_r || ')');
  v := public.brand_form_submit_core(jsonb_build_object('formId', pg_temp.u('F'), 'eventId', pg_temp.u('eo'),
         'answers', pg_temp.ans('Public'), 'credential', jsonb_build_object('kind', 'user', 'userId', pg_temp.u('ee1'))));
  PERFORM pg_temp.ok(v->>'created' = 'true', 'T-8 a stranger can answer an optional form on a public page');
  RESET ROLE;
END;
$t$;

-- ═══ T-9 a new link revokes the earlier one (SC-46) ═══════════════════════════════
DO $t$
DECLARE v1 jsonb; v2 jsonb; v_r text;
BEGIN
  SET LOCAL ROLE service_role;
  v1 := public.brand_form_link_issue(pg_temp.u('F'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_go')));
  v2 := public.brand_form_link_issue(pg_temp.u('F'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_go')));
  PERFORM pg_temp.ok((SELECT revoked_at FROM public.brand_form_links WHERE id = (v1->>'linkId')::uuid) IS NOT NULL
      AND (SELECT revoked_at FROM public.brand_form_links WHERE id = (v2->>'linkId')::uuid) IS NULL,
    'T-9 issuing a second link revokes the first');
  v_r := pg_temp.err(format($$SELECT public.brand_form_submit_core(%L::jsonb)$$, jsonb_build_object('formId', pg_temp.u('F'),
           'answers', pg_temp.ans('x'), 'credential', jsonb_build_object('kind', 'link', 'token', v1->>'token'))));
  PERFORM pg_temp.ok(v_r LIKE '42501:link_revoked%', 'T-9 the first link is refused on submit (' || v_r || ')');
  v_r := pg_temp.err(format($$SELECT public.brand_form_my_response(%L, NULL, %L)$$, pg_temp.u('F'), v1->>'token'));
  PERFORM pg_temp.ok(v_r LIKE '42501:link_revoked%', 'T-9 the first link is refused on read');
  v_r := pg_temp.err(format($$SELECT public.brand_form_my_response(%L, NULL, %L)$$, pg_temp.u('F'), v2->>'token'));
  PERFORM pg_temp.ok(v_r = 'ok', 'T-9 the newest link still reads');
  RESET ROLE;
END;
$t$;

-- ═══ T-10 door scope, cap and host log (SC-47) ════════════════════════════════════
DO $t$
DECLARE v jsonb; v_r text; i integer; v_states text[] := '{}';
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_door_full_answers(pg_temp.u('inv'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')), 'scan');
  PERFORM pg_temp.ok(v->>'state' = 'line_only', 'T-10 invited scan-only staff get the line only by default (' || v::text || ')');
  PERFORM pg_temp.ok((public.brand_form_door_answers(pg_temp.u('inv'), pg_temp.u('er'),
      jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')))->>'fullAnswers')::boolean IS FALSE,
    'T-10 the invited scanner''s line does not offer the full view');
  v := public.brand_form_door_full_answers(pg_temp.u('tsc'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')), 'scan');
  PERFORM pg_temp.ok(v->>'state' = 'answered', 'T-10 the brand team''s scanner reads in full when the form allows');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.biz_brand_form_set_door_invited(%L, true)$$, pg_temp.u('F')));
  PERFORM pg_temp.ok(v_r LIKE '42501:brand_form_forbidden%', 'T-10 a marketing manager cannot switch invited staff on');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('em'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_set_door_invited(pg_temp.u('F'), true);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  v := public.brand_form_door_full_answers(pg_temp.u('inv'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')), 'scan');
  PERFORM pg_temp.ok(v->>'state' = 'answered', 'T-10 with "Invited door staff can too" on, the invited scanner reads in full');
  -- The per-guest cap: inv has 1 full read of the Maybe; two more pass, the 4th is refused.
  FOR i IN 1..3 LOOP
    v := public.brand_form_door_full_answers(pg_temp.u('inv'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')), 'search');
    v_states := v_states || (v->>'state');
  END LOOP;
  PERFORM pg_temp.ok(v_states = ARRAY['answered', 'answered', 'rate_limited'],
    'T-10 the 4th full read of the same guest in a day is rate_limited (' || array_to_string(v_states, ',') || ')');
  -- Team scanners and invited staff: 20 reads per 10 minutes (managers keep 60).
  INSERT INTO public.brand_form_door_reads (actor_id, event_id, subject_kind, subject_id, via, result)
  SELECT pg_temp.u('tsc'), pg_temp.u('er'), 'rsvp', gen_random_uuid(), 'scan', 'line_only' FROM generate_series(1, 19);
  v := public.brand_form_door_full_answers(pg_temp.u('tsc'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_go')), 'search');
  PERFORM pg_temp.ok(v->>'state' = 'rate_limited', 'T-10 a team scanner''s 21st read in 10 minutes is rate_limited (' || v::text || ')');
  -- Switched off for the team: line only; managers still read.
  RESET ROLE;
  UPDATE public.brand_forms SET door_full_answers = false WHERE id = pg_temp.u('F');
  SET LOCAL ROLE service_role;
  v := public.brand_form_door_full_answers(pg_temp.u('em'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')), 'search');
  PERFORM pg_temp.ok(v->>'state' = 'answered', 'T-10 event managers read in full with the switch off');
  v := public.brand_form_door_full_answers(pg_temp.u('inv'), pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_go')), 'search');
  PERFORM pg_temp.ok(v->>'state' IN ('line_only', 'not_answered'), 'T-10 the form switch off returns invited staff to the line');
  RESET ROLE;
  UPDATE public.brand_forms SET door_full_answers = true WHERE id = pg_temp.u('F');
  -- The host's door-read log.
  PERFORM pg_temp.as_user(pg_temp.u('em'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_door_reads(pg_temp.u('er'), 50, NULL);
  PERFORM pg_temp.ok(jsonb_array_length(v) > 0 AND EXISTS (SELECT 1 FROM jsonb_array_elements(v) x
      WHERE x->>'actorName' = 'Inv P.' AND x->>'guestName' = 'May M.' AND x->>'result' = 'full'),
    'T-10 the Door log lists who opened whose answers (' || left(v::text, 200) || ')');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.biz_brand_form_door_reads(%L, 50, NULL)$$, pg_temp.u('er')));
  PERFORM pg_temp.ok(v_r LIKE '42501:brand_form_forbidden%', 'T-10 the Door log is event managers only');
  RESET ROLE;
END;
$t$;

-- ═══ T-11 admission (SC-48, sequential part; the race runs after ROLLBACK) ════════
DO $t$
DECLARE v jsonb; i integer; v_allowed integer := 0; v_r text;
BEGIN
  SET LOCAL ROLE service_role;
  FOR i IN 1..21 LOOP
    v := public.brand_form_attempt_admit(repeat('c', 64), pg_temp.u('F'), 'submit');
    IF (v->>'allowed')::boolean THEN v_allowed := v_allowed + 1; END IF;
  END LOOP;
  PERFORM pg_temp.ok(v_allowed = 20, 'T-11 twenty-one submits from one address admit exactly 20 (' || v_allowed || ')');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.brand_form_submit_attempts WHERE ip_hash = repeat('c', 64)) = 21
      AND (SELECT count(*) FROM public.brand_form_submit_attempts WHERE ip_hash = repeat('c', 64) AND outcome = 'rate_limited') = 1,
    'T-11 every request writes one row, refused ones included');
  PERFORM pg_temp.ok((public.brand_form_attempt_admit(repeat('c', 64), NULL, 'read')->>'allowed')::boolean,
    'T-11 the read bucket is counted separately');
  v_r := pg_temp.err(format($$SELECT public.brand_form_attempt_admit(%L, NULL, 'other')$$, repeat('c', 64)));
  PERFORM pg_temp.ok(v_r LIKE '22023:attempt_invalid%', 'T-11 an unknown bucket is refused');
  RESET ROLE;
END;
$t$;

-- ═══ T-12 not asked yet and counts (SC-3, server) ═════════════════════════════════
DO $t$
DECLARE v jsonb; v_page jsonb;
BEGIN
  -- en: three current holders; one answered, one of the other two was sent a request.
  PERFORM pg_temp.resp(pg_temp.u('N'), pg_temp.u('Nv'), pg_temp.u('en'), 'rsvp', pg_temp.u('r_na1'), 'Answered');
  INSERT INTO public.brand_form_request_sends (form_id, event_id, brand_id, rsvp_id, person_key, kind, route, status)
  VALUES (pg_temp.u('N'), pg_temp.u('en'), pg_temp.u('brand'), pg_temp.u('r_na2'), 'rsvp:' || pg_temp.u('r_na2'), 'ask', ARRAY['email'], 'sent');
  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_counts(pg_temp.u('brand'));
  RESET ROLE;
  SELECT p INTO v_page FROM jsonb_array_elements(v->'pages') p WHERE (p->>'eventId')::uuid = pg_temp.u('en');
  PERFORM pg_temp.ok((v_page->>'toAnswer')::integer = 2 AND (v_page->>'notAsked')::integer = 1,
    'T-12 SC-3 "2 to answer · 1 not asked yet" (' || COALESCE(v_page::text, 'null') || ')');
  UPDATE public.brand_forms SET status = 'closed', closed_at = now() WHERE id = pg_temp.u('N');
  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_counts(pg_temp.u('brand'));
  RESET ROLE;
  SELECT p INTO v_page FROM jsonb_array_elements(v->'pages') p WHERE (p->>'eventId')::uuid = pg_temp.u('en');
  PERFORM pg_temp.ok(NOT (v_page ? 'notAsked'), 'T-12 notAsked is only present for live forms');
  UPDATE public.brand_forms SET status = 'live', closed_at = NULL WHERE id = pg_temp.u('N');
END;
$t$;

-- ═══ T-RH after-RSVP hand-off (R1.3), T-GA guest answers (R1.9), T-OPS (R7.2) ═════
DO $t$
DECLARE v jsonb; v_r text; i integer;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.brand_form_rsvp_handoff_link(pg_temp.u('r_h1'), pg_temp.u('eh'));
  PERFORM pg_temp.ok(v->>'outcome' = 'link' AND (v->>'formId')::uuid = pg_temp.u('H') AND length(v->>'token') = 64,
    'T-RH an approved RSVP on an "After they RSVP" page gets a personal link');
  v := public.brand_form_rsvp_handoff_link(pg_temp.u('r_h2'), pg_temp.u('eh'));
  PERFORM pg_temp.ok(v->>'outcome' = 'none', 'T-RH an RSVP pending approval gets no hand-off');
  v := public.brand_form_rsvp_handoff_link(pg_temp.u('r_go'), pg_temp.u('er'));
  PERFORM pg_temp.ok(v->>'outcome' = 'none', 'T-RH a required (not after) form gets no hand-off');
  FOR i IN 1..9 LOOP PERFORM public.brand_form_rsvp_handoff_link(pg_temp.u('r_h1'), pg_temp.u('eh')); END LOOP;
  v_r := pg_temp.err(format($$SELECT public.brand_form_rsvp_handoff_link(%L, %L)$$, pg_temp.u('r_h1'), pg_temp.u('eh')));
  PERFORM pg_temp.ok(v_r LIKE '54000:rate_limited%', 'T-RH at most 10 hand-off links per RSVP per day (' || v_r || ')');
  PERFORM pg_temp.resp(pg_temp.u('H'), pg_temp.u('Hv'), pg_temp.u('eh'), 'rsvp', pg_temp.u('r_h1'), 'Done');
  v := public.brand_form_rsvp_handoff_link(pg_temp.u('r_h1'), pg_temp.u('eh'));
  PERFORM pg_temp.ok(v->>'outcome' = 'answered', 'T-RH an answered RSVP gets "answered"');
  -- R7.2: once per kind per day.
  PERFORM pg_temp.ok(public.brand_form_ops_alert_claim('form_drain_error') AND NOT public.brand_form_ops_alert_claim('form_drain_error'),
    'T-OPS an alert kind is claimed once per day');
  v_r := pg_temp.err($$SELECT public.brand_form_ops_alert_claim('anything')$$);
  PERFORM pg_temp.ok(v_r LIKE '22023:kind_invalid%', 'T-OPS unknown kinds are refused');
  RESET ROLE;

  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  v := public.biz_brand_form_guest_answers(pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_maybe')));
  PERFORM pg_temp.ok(v->>'state' = 'answered' AND v->>'formName' = 'MA questions' AND v->>'versionLabel' = 'v1'
      AND v->'items'->0->>'label' = 'Dietary needs' AND v->'items'->0->>'value' = 'Maybe answer',
    'T-GA guest detail shows the guest''s answers (' || v::text || ')');
  v := public.biz_brand_form_guest_answers(pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_pend')));
  PERFORM pg_temp.ok(v->>'state' = 'not_answered', 'T-GA a non-current guest''s stored answer is not shown');
  v := public.biz_brand_form_guest_answers(pg_temp.u('e1'), jsonb_build_object('kind', 'order', 'id', pg_temp.u('o3')));
  PERFORM pg_temp.ok(v->>'state' = 'not_answered', 'T-GA an unanswered order shows "Not answered"');
  RESET ROLE;
END;
$t$;

-- ═══ T-13 grants and the admin read (SC-43) ════════════════════════════════════════
DO $t$
DECLARE v jsonb; v_r text; v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.brand_form_subject_current(text,uuid,uuid)', 'public.brand_form_added_by_host(text,uuid)',
    'public.brand_form_person_row_at_event(uuid,uuid,uuid)', 'public.brand_form_answers_empty(jsonb)',
    'public.brand_form_door_full_scope(uuid,uuid,integer,boolean,boolean)', 'public.brand_form_not_asked_count(uuid,uuid)',
    'public.brand_form_promote_stash(uuid)', 'public.brand_form_checkout_answers_retry(integer)',
    'public.brand_form_rsvp_handoff_link(uuid,uuid)', 'public.brand_form_erase_person(uuid)',
    'public.brand_form_retention_purge()', 'public.brand_form_copy_attachment(uuid,uuid)',
    'public.brand_form_attempt_admit(text,uuid,text)', 'public.brand_form_ops_alert_claim(text)',
    'public.brand_form_queue_health()'] LOOP
    PERFORM pg_temp.ok(has_function_privilege('service_role', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', v_sig, 'EXECUTE'),
      'T-13 service role only: ' || v_sig);
    PERFORM pg_temp.ok((SELECT p.prosecdef OR p.provolatile = 'i' FROM pg_proc p WHERE p.oid = v_sig::regprocedure)
        AND (SELECT p.proconfig FROM pg_proc p WHERE p.oid = v_sig::regprocedure) = ARRAY['search_path=""'],
      'T-13 definer with an empty search path: ' || v_sig);
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.biz_brand_form_set_door_invited(uuid,boolean)', 'public.biz_brand_form_door_reads(uuid,integer,timestamp with time zone)',
    'public.biz_brand_form_guest_answers(uuid,jsonb)', 'public.admin_brand_forms_support(uuid,uuid)'] LOOP
    PERFORM pg_temp.ok(has_function_privilege('authenticated', v_sig, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_sig, 'EXECUTE'),
      'T-13 host or admin RPC (authenticated, never anon): ' || v_sig);
  END LOOP;
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.brand_form_ops_alerts', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.brand_form_ops_alerts', 'SELECT'),
    'T-13 the ops alert ledger has no client grant');
  -- The admin read: refused for a host, allowed for an admin, no answers or contacts.
  PERFORM pg_temp.as_user(pg_temp.u('owner'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.admin_brand_forms_support(%L)$$, pg_temp.u('brand')));
  PERFORM pg_temp.ok(v_r LIKE '42501:forbidden%', 'T-13 SC-43 the admin read refuses a non-admin (' || v_r || ')');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('adm'));
  SET LOCAL ROLE authenticated;
  v := public.admin_brand_forms_support(pg_temp.u('brand'));
  RESET ROLE;
  PERFORM pg_temp.ok(jsonb_array_length(v->'forms') >= 3 AND jsonb_array_length(v->'pages') >= 5
      AND v->'switches' ? 'BRAND_FORMS_KILL_SWITCH'
      AND strpos(v::text, 'Maybe answer') = 0 AND strpos(v::text, 'Vegan') = 0
      AND strpos(v::text, '@example.test') = 0 AND strpos(v::text, '+1202') = 0,
    'T-13 SC-43 the admin read loads with counts and switches, and no answers or contacts');
END;
$t$;

-- ═══ T-42 client-called RPCs, called the way a browser or app calls them ════════════
DO $t$
DECLARE v jsonb; v_r text; v_call text;
BEGIN
  -- The right caller succeeds.
  PERFORM pg_temp.as_user(pg_temp.u('um'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok(public.brand_form_my_response(pg_temp.u('F'), pg_temp.u('er'))->>'state' IS NOT NULL,
    'T-42 brand_form_my_response as the signed-in guest');
  PERFORM pg_temp.ok(jsonb_typeof(public.brand_forms_my_pending()) = 'array', 'T-42 brand_forms_my_pending as the signed-in guest');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('mm'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok(public.biz_brand_form_guest_answers(pg_temp.u('er'), jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_go'))) ? 'state',
    'T-42 biz_brand_form_guest_answers as a marketing manager');
  PERFORM pg_temp.ok(public.biz_brand_form_counts(pg_temp.u('brand')) ? 'pages', 'T-42 biz_brand_form_counts as a marketing manager');
  PERFORM pg_temp.ok(public.biz_brand_form_responses(p_form_id => pg_temp.u('F'), p_event_id => pg_temp.u('er'),
      p_filter => 'all', p_limit => 50, p_offset => 0) ? 'rows',
    'T-42 biz_brand_form_responses with the five named arguments old Host builds send');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('em'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok(public.biz_brand_form_set_door_invited(pg_temp.u('F'), false) ? 'doorFullAnswersInvited',
    'T-42 biz_brand_form_set_door_invited as an event manager');
  PERFORM pg_temp.ok(jsonb_typeof(public.biz_brand_form_door_reads(pg_temp.u('er'))) = 'array',
    'T-42 biz_brand_form_door_reads as an event manager');
  RESET ROLE;
  PERFORM pg_temp.as_user(pg_temp.u('adm'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok(public.admin_brand_forms_support(pg_temp.u('brand')) ? 'forms', 'T-42 admin_brand_forms_support as an admin');
  RESET ROLE;
  -- The wrong caller is refused: a stranger for host RPCs, anon for everything.
  PERFORM pg_temp.as_user(pg_temp.u('s'));
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.err(format($$SELECT public.biz_brand_form_guest_answers(%L, %L::jsonb)$$, pg_temp.u('er'),
           jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u('r_go'))));
  PERFORM pg_temp.ok(v_r LIKE '42501:brand_form_forbidden%', 'T-42 a stranger cannot read guest answers');
  FOREACH v_call IN ARRAY ARRAY[
    format($$SELECT public.brand_form_attempt_admit(%L, NULL, 'submit')$$, repeat('d', 64)),
    format($$SELECT public.brand_form_rsvp_handoff_link(%L, %L)$$, pg_temp.u('r_h1'), pg_temp.u('eh')),
    format($$SELECT public.brand_form_erase_person(%L)$$, pg_temp.u('s')),
    $$SELECT public.brand_form_retention_purge()$$,
    $$SELECT public.brand_form_checkout_answers_retry(1)$$,
    $$SELECT public.brand_form_queue_health()$$,
    $$SELECT public.brand_form_ops_alert_claim('form_queue_stuck')$$,
    format($$SELECT public.brand_form_subject_current('rsvp', %L, %L)$$, pg_temp.u('r_go'), pg_temp.u('er'))] LOOP
    v_r := pg_temp.err(v_call);
    PERFORM pg_temp.ok(v_r LIKE '42501:permission denied%', 'T-42 authenticated is refused: ' || left(v_call, 60));
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.as_user(NULL);
  SET LOCAL ROLE anon;
  FOREACH v_call IN ARRAY ARRAY[
    format($$SELECT public.brand_form_my_response(%L, %L)$$, pg_temp.u('F'), pg_temp.u('er')),
    $$SELECT public.brand_forms_my_pending()$$,
    format($$SELECT public.biz_brand_form_guest_answers(%L, '{}'::jsonb)$$, pg_temp.u('er')),
    format($$SELECT public.biz_brand_form_counts(%L)$$, pg_temp.u('brand')),
    format($$SELECT public.biz_brand_form_responses(%L)$$, pg_temp.u('F')),
    format($$SELECT public.biz_brand_form_set_door_invited(%L, true)$$, pg_temp.u('F')),
    format($$SELECT public.biz_brand_form_door_reads(%L)$$, pg_temp.u('er')),
    format($$SELECT public.admin_brand_forms_support(%L)$$, pg_temp.u('brand')),
    format($$SELECT public.brand_form_attempt_admit(%L, NULL, 'submit')$$, repeat('d', 64)),
    format($$SELECT public.public_brand_form_for_event(%L)$$, pg_temp.u('er'))] LOOP
    v_r := pg_temp.err(v_call);
    PERFORM pg_temp.ok(v_r LIKE '42501:permission denied%', 'T-42 anon is refused: ' || left(v_call, 60));
  END LOOP;
  RESET ROLE;
END;
$t$;

ROLLBACK;

-- ═══ T-11 race: two real sessions take the admission under one lock ════════════════
-- Session A admits the 20th request inside an open transaction (holding the
-- per-address lock); session B's request must wait for it and then be refused.
-- Without the advisory lock, B would see only the 19 committed rows and be admitted.
SELECT dblink_connect('i4541ma_a', 'dbname=' || current_database());
SELECT dblink_connect('i4541ma_b', 'dbname=' || current_database());
SELECT dblink_exec('i4541ma_a', $$DELETE FROM public.brand_form_submit_attempts WHERE ip_hash = repeat('e', 64)$$);
SELECT dblink_exec('i4541ma_a', $$INSERT INTO public.brand_form_submit_attempts (ip_hash, outcome, bucket)
                                  SELECT repeat('e', 64), 'admitted', 'submit' FROM generate_series(1, 19)$$);
SELECT dblink_exec('i4541ma_a', 'BEGIN');
SELECT * FROM dblink('i4541ma_a', $$SELECT (public.brand_form_attempt_admit(repeat('e', 64), NULL, 'submit')->>'allowed')$$)
  AS t(allowed text);
SELECT dblink_send_query('i4541ma_b', $$SELECT (public.brand_form_attempt_admit(repeat('e', 64), NULL, 'submit')->>'allowed')$$);
SELECT pg_sleep(0.5);
DO $race$
BEGIN
  PERFORM pg_temp.ok(dblink_is_busy('i4541ma_b') = 1,
    'T-11 race: the second session waits on the per-address lock while the first is open');
END;
$race$;
SELECT dblink_exec('i4541ma_a', 'COMMIT');
CREATE TEMP TABLE i4541ma_race AS SELECT * FROM dblink_get_result('i4541ma_b') AS t(allowed text);
DO $race$
BEGIN
  PERFORM pg_temp.ok((SELECT allowed FROM i4541ma_race) = 'false'
      AND (SELECT count(*) FROM public.brand_form_submit_attempts WHERE ip_hash = repeat('e', 64) AND outcome = 'admitted') = 20,
    'T-11 race: concurrent submits never exceed the limit (20 admitted, the 21st refused)');
END;
$race$;
SELECT dblink_exec('i4541ma_a', $$DELETE FROM public.brand_form_submit_attempts WHERE ip_hash = repeat('e', 64)$$);
SELECT dblink_disconnect('i4541ma_a');
SELECT dblink_disconnect('i4541ma_b');
