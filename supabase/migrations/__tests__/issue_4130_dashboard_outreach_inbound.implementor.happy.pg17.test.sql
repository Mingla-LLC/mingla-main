\set ON_ERROR_STOP on

-- Issue #4130 (Wave 4a) — Dashboard, Notifications, Hosts and creators,
-- Inbound leads. Run after the full migration chain on PostgreSQL 17.
--
--   C-01  Every client RPC: exists, SECURITY DEFINER, anon cannot run it,
--         signed-in may call it; the helpers are not callable from a browser.
--   D-01  admin_dashboard_summary is admin-only.
--   D-02  Sign-ups: last 7 days vs the 7 before; seed and staff/test accounts
--         are left out; the weekly series has 8 weeks.
--   D-03  Paid tickets: tickets of paid orders with money; a free order's
--         ticket is not a paid ticket.
--   D-04  A Live host card with nothing coming up counts as "no next event".
--   D-05  A support ticket with no first reply counts as waiting.
--   D-06  The last inbound lead is the newest NON-test beta or WEB tool lead;
--         an app-lane tool run is never a lead.
--   I-01  admin_inbound_leads: app-lane runs never listed or counted; a test
--         row is hidden unless asked for; a beta lead turned host shows its
--         host; never returns an email address.
--   I-02  A growth teammate sees beta leads but not web tool leads (the old
--         Tool leads page was admin-only); an outsider is refused.
--   O-01  outreach_summary counts due today, this week, stale (not Lost) and
--         replied over every card.
--   O-02  outreach_reset_stale_due: admin-only; changes only the listed cards
--         that are still stale; audits each change; a second run changes
--         nothing.
--   N-01  team_inbox: own rows only; a comment mention is a mention, a work
--         card change is a Work update with who did it; an alert whose ticket
--         is resolved is never unread.
--   N-02  team_inbox_mark_read marks only the asked tab, then everything.
--
-- FAILS-ON-REVERT: dropping `AND NOT public.admin_account_is_internal(p.id)`
-- from admin_dashboard_summary makes D-02 count the staff sign-up; dropping
-- `l.lane = 'web'` from admin_inbound_leads lists the app run (I-01); dropping
-- `c.due_on < p_today` from outreach_reset_stale_due resets the card due today
-- (O-02); dropping `NOT ticket_resolved` from team_inbox's unread count makes
-- the resolved ticket's alert unread (N-01).
-- MINGLA-INVARIANT: I-4130-DASHBOARD-ADMIN-AGGREGATES | issue #4130 | proved by C-01/D-01..D-06 here.
-- MINGLA-INVARIANT: I-4130-INBOUND-EXCLUDES-APP-RUNS | issue #4130 | proved by D-06/I-01 here.

CREATE OR REPLACE FUNCTION pg_temp.w4a_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4130 wave 4a FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.w4a_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END
$a$;

BEGIN;
DO $c01$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_dashboard_summary(date)',
    'public.admin_inbound_leads(boolean,integer)',
    'public.outreach_summary(date)',
    'public.outreach_reset_stale_due(text,uuid[],date,date)',
    'public.team_inbox(text[],integer)',
    'public.team_inbox_mark_read(text,text[])'
  ] LOOP
    PERFORM pg_temp.w4a_assert(to_regprocedure(v_fn) IS NOT NULL, 'C-01 exists ' || v_fn);
    PERFORM pg_temp.w4a_assert((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn::regprocedure), 'C-01 definer ' || v_fn);
    PERFORM pg_temp.w4a_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'C-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.w4a_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'C-01 signed-in may call ' || v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.inbound_lead_is_test(text,text)',
    'public.team_inbox_alert_types(text[])',
    'public.team_inbox_kind(text,text)',
    'public.team_inbox_ticket_resolved(jsonb)'
  ] LOOP
    PERFORM pg_temp.w4a_assert(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'C-01 helper not callable ' || v_fn);
  END LOOP;
  PERFORM pg_temp.w4a_assert(public.team_inbox_kind('work_card', 'note') = 'mention', 'C-01 a note on a work card is a mention');
  PERFORM pg_temp.w4a_assert(public.team_inbox_kind('work_card', 'updated') = 'work_update', 'C-01 a card change is a Work update');
  PERFORM pg_temp.w4a_assert(public.team_inbox_kind('content_calendar_comment', NULL) = 'mention', 'C-01 a comment mention is a mention');
  PERFORM pg_temp.w4a_assert(
    public.team_inbox_alert_types(ARRAY['business.support_new_ticket', 'admin.team_mention', 'x; drop']) = ARRAY['business.support_new_ticket'],
    'C-01 only support and product alert types are read');
END
$c01$;
ROLLBACK;

BEGIN;
-- The replayed schema's auth.users may lack the confirmation column the team
-- gate reads (other suites add it the same way).
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $main$
DECLARE
  v_admin    constant uuid := '41300000-0000-4000-a400-000000000001';
  v_outsider constant uuid := '41300000-0000-4000-a400-000000000002';
  v_growth   constant uuid := '41300000-0000-4000-a400-000000000003';
  v_new1     constant uuid := '41300000-0000-4000-a400-000000000010';
  v_new2     constant uuid := '41300000-0000-4000-a400-000000000011';
  v_staff    constant uuid := '41300000-0000-4000-a400-000000000012';
  v_seed     constant uuid := '41300000-0000-4000-a400-000000000013';
  v_owner    constant uuid := '41300000-0000-4000-a400-000000000014';
  v_brand    constant uuid := '41300000-0000-4000-a400-000000000100';
  v_event    constant uuid := '41300000-0000-4000-a400-000000000200';
  v_tt       constant uuid := '41300000-0000-4000-a400-000000000201';
  v_o_paid   constant uuid := '41300000-0000-4000-a400-000000000300';
  v_o_free   constant uuid := '41300000-0000-4000-a400-000000000301';
  v_beta     constant uuid := '41300000-0000-4000-a400-000000000400';
  v_beta_t   constant uuid := '41300000-0000-4000-a400-000000000401';
  v_tool     constant uuid := '41300000-0000-4000-a400-000000000402';
  v_tool_app constant uuid := '41300000-0000-4000-a400-000000000403';
  v_tool_t   constant uuid := '41300000-0000-4000-a400-000000000404';
  v_h_live   constant uuid := '41300000-0000-4000-a400-000000000500';
  v_h_today  constant uuid := '41300000-0000-4000-a400-000000000501';
  v_h_week   constant uuid := '41300000-0000-4000-a400-000000000502';
  v_h_stale  constant uuid := '41300000-0000-4000-a400-000000000503';
  v_h_lost   constant uuid := '41300000-0000-4000-a400-000000000504';
  v_h_beta   constant uuid := '41300000-0000-4000-a400-000000000505';
  v_conv1    constant uuid := '41300000-0000-4000-a400-000000000600';
  v_conv2    constant uuid := '41300000-0000-4000-a400-000000000601';
  v_tk_open  constant uuid := '41300000-0000-4000-a400-000000000610';
  v_tk_done  constant uuid := '41300000-0000-4000-a400-000000000611';
  v_today    constant date := (now() AT TIME ZONE 'UTC')::date;
  v_d0 jsonb; v_d1 jsonb;
  v_o0 jsonb; v_o1 jsonb;
  v jsonb; v_rows jsonb; v_err text; v_n bigint;
  v_types constant text[] := ARRAY['business.support_new_ticket', 'business.support_ticket_reply'];
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
    (v_admin,    'w4a-admin@mingla-fixture.org', now()),
    (v_outsider, 'w4a-outsider@mingla-fixture.org', now()),
    (v_growth,   'w4a-growth@mingla-fixture.org', now()),
    (v_new1,     'w4a-new1@mingla-fixture.org', now()),
    (v_new2,     'w4a-new2@mingla-fixture.org', now()),
    (v_staff,    'w4a-staff@usemingla.com', now()),
    (v_seed,     'w4a-seed@mingla-fixture.org', now()),
    (v_owner,    'w4a-owner@mingla-fixture.org', now());
  INSERT INTO public.admin_users(email, role, status) VALUES ('w4a-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
  INSERT INTO public.admin_team_members(email, role, status) VALUES ('w4a-growth@mingla-fixture.org', 'growth', 'active');

  -- ── Baselines ─────────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v_d0 := public.admin_dashboard_summary(v_today);
  v_o0 := public.outreach_summary(v_today);
  RESET ROLE;

  -- ── D-01 admin-only ───────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_outsider);
  BEGIN
    PERFORM public.admin_dashboard_summary(v_today);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.w4a_assert(v_err = 'not_authorized', 'D-01 an outsider is refused the dashboard (' || v_err || ')');

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO public.profiles(id, email, display_name, is_seed, created_at) VALUES
    (v_new1,  'w4a-new1@mingla-fixture.org',  'W4a New',    false, now() - interval '1 day'),
    (v_new2,  'w4a-new2@mingla-fixture.org',  'W4a Older',  false, now() - interval '10 days'),
    (v_staff, 'w4a-staff@usemingla.com',      'W4a Staff',  false, now() - interval '1 day'),
    (v_seed,  'w4a-seed@mingla-fixture.org',  'W4a Seed',   true,  now() - interval '1 day')
  ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at, is_seed = EXCLUDED.is_seed, email = EXCLUDED.email;

  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'w4a-owner@mingla-fixture.org');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'W4a Brand', 'w4a-4130-brand', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency) VALUES
    (v_event, v_brand, 'W4a Night', 'w4a-4130-night', 'draft', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name) VALUES (v_tt, v_event, 'General');
  INSERT INTO public.orders(id, event_id, total_cents, buyer_total_cents, net_subtotal_cents, currency,
    payment_status, payment_method, source, created_at, confirmed_at,
    list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source)
  VALUES
    (v_o_paid, v_event, 2000, 2000, 1910, 'USD', 'paid', 'online_card', 'legacy', now() - interval '2 days', now() - interval '2 days',
      1910, 0, 90, 0, 'computed_at_checkout'),
    (v_o_free, v_event, 0, 0, 0, 'USD', 'paid', 'free', 'legacy', now() - interval '2 days', now() - interval '2 days',
      0, 0, 0, 0, 'computed_at_checkout');
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code) VALUES
    (v_o_paid, v_tt, v_event, 'w4a-qr-1'),
    (v_o_paid, v_tt, v_event, 'w4a-qr-2'),
    (v_o_free, v_tt, v_event, 'w4a-qr-3');

  INSERT INTO public.crm_records(id, pipeline, name, stage, stage_reason, due_on, created_by, updated_by, beta_lead_id) VALUES
    (v_h_live,  'hosts', 'W4a Live Host',   'live',      NULL, NULL,                 'w4a', 'w4a', NULL),
    (v_h_today, 'hosts', 'W4a Today Host',  'contacted', NULL, v_today,              'w4a', 'w4a', NULL),
    (v_h_week,  'hosts', 'W4a Week Host',   'replied',   NULL, v_today + 3,          'w4a', 'w4a', NULL),
    (v_h_stale, 'hosts', 'W4a Stale Host',  'contacted', NULL, v_today - 5,          'w4a', 'w4a', NULL),
    (v_h_lost,  'hosts', 'W4a Lost Host',   'lost',      'Not a fit', v_today - 5,   'w4a', 'w4a', NULL);

  INSERT INTO public.beta_access_leads(id, created_at, brand_type, brand_name, contact_name, city, email, source) VALUES
    (v_beta,   now() - interval '3 days', ARRAY['restaurant'], 'W4a Real Kitchen', 'Ada', 'Lagos', 'ada@w4a-kitchen.org', 'organiser_marketing'),
    (v_beta_t, now() - interval '1 hour', ARRAY['restaurant'], 'Test Kitchen',     'Tess', 'Lagos', 'tess@usemingla.com', 'organiser_marketing');
  INSERT INTO public.crm_records(id, pipeline, name, stage, created_by, updated_by, beta_lead_id) VALUES
    (v_h_beta, 'hosts', 'W4a Real Kitchen Host', 'prospect', 'w4a', 'w4a', v_beta);

  INSERT INTO public.tool_leads(id, tool, input, email, lane, created_at, user_id, brand_id) VALUES
    (v_tool,     'venues', '{"name":"W4a Rooftop","city":"Lagos"}', 'owner@w4a-rooftop.org', 'web', now() - interval '2 hours', NULL, NULL),
    (v_tool_t,   'venues', '{"name":"Demo Bar","city":"Lagos"}',    NULL,                    'web', now() - interval '30 minutes', NULL, NULL);
  INSERT INTO public.tool_leads(id, tool, input, lane, created_at, user_id, brand_id, subject_ref)
  VALUES (v_tool_app, 'events', '{"city":"Lagos"}', 'app', now() - interval '5 minutes', v_owner, v_brand, NULL);

  INSERT INTO public.conversations(id) VALUES (v_conv1), (v_conv2);
  INSERT INTO public.support_tickets(id, requester_user_id, subject, status, conversation_id, created_at) VALUES
    (v_tk_open, v_owner, 'W4a cannot add bank', 'new', v_conv1, now() - interval '1 hour'),
    (v_tk_done, v_owner, 'W4a solved', 'resolved', v_conv2, now() - interval '3 days');

  -- ── D-02 .. D-06 ──────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v_d1 := public.admin_dashboard_summary(v_today);
  RESET ROLE;

  PERFORM pg_temp.w4a_assert((v_d1 #>> '{signups,last7}')::int - (v_d0 #>> '{signups,last7}')::int = 1,
    'D-02 one new sign-up this week (seed and staff left out)');
  PERFORM pg_temp.w4a_assert((v_d1 #>> '{signups,prev7}')::int - (v_d0 #>> '{signups,prev7}')::int = 1,
    'D-02 one sign-up in the 7 days before');
  PERFORM pg_temp.w4a_assert(jsonb_array_length(v_d1 -> 'weekly') = 8, 'D-02 eight weeks in the series');
  PERFORM pg_temp.w4a_assert((v_d1 #>> '{paid_tickets,last7}')::int - (v_d0 #>> '{paid_tickets,last7}')::int = 2,
    'D-03 two paid tickets; the free ticket is not counted');
  PERFORM pg_temp.w4a_assert((v_d1 #>> '{hosts,without_next}')::int - (v_d0 #>> '{hosts,without_next}')::int = 2,
    'D-04 the Live host and the Replied host with nothing coming up count as no next event');
  PERFORM pg_temp.w4a_assert((v_d1 #>> '{support,waiting_first_reply}')::int - (v_d0 #>> '{support,waiting_first_reply}')::int = 1,
    'D-05 the new ticket waits for a first reply; the resolved one does not');
  PERFORM pg_temp.w4a_assert((v_d1 #>> '{inbound,last_lead_at}')::timestamptz
      = (SELECT created_at FROM public.tool_leads WHERE id = v_tool),
    'D-06 the last lead is the newest non-test web lead (not the app run, not the test rows)');

  -- ── I-01 inbound list as the admin ────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v := public.admin_inbound_leads(false, 500);
  RESET ROLE;
  v_rows := v -> 'rows';
  PERFORM pg_temp.w4a_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_tool_app::text),
    'I-01 an app-lane tool run is never a lead');
  PERFORM pg_temp.w4a_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_tool::text AND r ->> 'source' = 'tool'),
    'I-01 the web tool lead is listed');
  PERFORM pg_temp.w4a_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' IN (v_tool_t::text, v_beta_t::text)),
    'I-01 test rows are hidden by default');
  PERFORM pg_temp.w4a_assert((SELECT r #>> '{host,id}' FROM jsonb_array_elements(v_rows) r WHERE r ->> 'id' = v_beta::text) = v_h_beta::text,
    'I-01 the beta lead shows the host it became');
  PERFORM pg_temp.w4a_assert(position('@' IN v_rows::text) = 0, 'I-01 no email address is returned');
  PERFORM pg_temp.w4a_assert((v #>> '{summary,test_hidden}')::int >= 2, 'I-01 the hidden test rows are counted');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v := public.admin_inbound_leads(true, 500);
  RESET ROLE;
  PERFORM pg_temp.w4a_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'rows') r WHERE r ->> 'id' = v_tool_t::text AND (r ->> 'is_test')::boolean),
    'I-01 test rows show when asked for, marked as test');

  -- ── I-02 growth and outsider ──────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_growth);
  v := public.admin_inbound_leads(false, 500);
  RESET ROLE;
  PERFORM pg_temp.w4a_assert((v #>> '{can_see,tools}')::boolean = false AND (v #>> '{can_see,beta}')::boolean,
    'I-02 a growth teammate may see beta leads only');
  PERFORM pg_temp.w4a_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'rows') r WHERE r ->> 'source' = 'tool'),
    'I-02 no web tool lead reaches a growth teammate');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_outsider);
  BEGIN
    PERFORM public.admin_inbound_leads(false, 500);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.w4a_assert(v_err = 'not_authorized', 'I-02 an outsider is refused inbound leads');

  -- ── O-01 the chips over every card ────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v_o1 := public.outreach_summary(v_today);
  RESET ROLE;
  PERFORM pg_temp.w4a_assert(COALESCE((v_o1 #>> '{pipelines,hosts,due_today}')::int, 0) - COALESCE((v_o0 #>> '{pipelines,hosts,due_today}')::int, 0) = 1, 'O-01 due today');
  PERFORM pg_temp.w4a_assert(COALESCE((v_o1 #>> '{pipelines,hosts,due_week}')::int, 0) - COALESCE((v_o0 #>> '{pipelines,hosts,due_week}')::int, 0) = 2, 'O-01 this week includes today');
  PERFORM pg_temp.w4a_assert(COALESCE((v_o1 #>> '{pipelines,hosts,stale}')::int, 0) - COALESCE((v_o0 #>> '{pipelines,hosts,stale}')::int, 0) = 1, 'O-01 stale leaves out Lost');
  PERFORM pg_temp.w4a_assert(COALESCE((v_o1 #>> '{pipelines,hosts,replied}')::int, 0) - COALESCE((v_o0 #>> '{pipelines,hosts,replied}')::int, 0) = 1, 'O-01 replied, waiting on us');
  PERFORM pg_temp.w4a_assert(COALESCE((v_o1 #>> '{pipelines,hosts,stages,lost}')::int, 0) - COALESCE((v_o0 #>> '{pipelines,hosts,stages,lost}')::int, 0) = 1, 'O-01 stage counts');

  -- ── O-02 bulk reset ───────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_growth);
  BEGIN
    PERFORM public.outreach_reset_stale_due('hosts', ARRAY[v_h_stale], v_today + 7, v_today);
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.w4a_assert(v_err LIKE 'forbidden:%', 'O-02 a growth teammate cannot bulk reset (' || v_err || ')');
  PERFORM pg_temp.w4a_assert((SELECT due_on FROM public.crm_records WHERE id = v_h_stale) = v_today - 5, 'O-02 nothing changed on a refusal');

  SELECT count(*) INTO v_n FROM public.admin_audit_log WHERE target_id = v_h_stale::text AND metadata ->> 'bulk' = 'stale_due_reset';
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v := public.outreach_reset_stale_due('hosts', ARRAY[v_h_stale, v_h_lost, v_h_today], v_today + 7, v_today);
  RESET ROLE;
  PERFORM pg_temp.w4a_assert((v ->> 'reset')::int = 1 AND (v ->> 'skipped')::int = 2, 'O-02 only the stale card is reset (' || v::text || ')');
  PERFORM pg_temp.w4a_assert((SELECT due_on FROM public.crm_records WHERE id = v_h_stale) = v_today + 7, 'O-02 the stale card has its new date');
  PERFORM pg_temp.w4a_assert((SELECT due_on FROM public.crm_records WHERE id = v_h_today) = v_today, 'O-02 the card due today is untouched');
  PERFORM pg_temp.w4a_assert((SELECT due_on FROM public.crm_records WHERE id = v_h_lost) = v_today - 5, 'O-02 the Lost card is untouched');
  PERFORM pg_temp.w4a_assert((SELECT count(*) FROM public.admin_audit_log WHERE target_id = v_h_stale::text AND metadata ->> 'bulk' = 'stale_due_reset') = v_n + 1,
    'O-02 the change is audited');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v := public.outreach_reset_stale_due('hosts', ARRAY[v_h_stale], v_today + 7, v_today);
  RESET ROLE;
  PERFORM pg_temp.w4a_assert((v ->> 'reset')::int = 0, 'O-02 a second run changes nothing');

  -- ── N-01 / N-02 inbox ─────────────────────────────────────────────────────
  INSERT INTO public.team_mentions(source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link) VALUES
    ('content_calendar_comment', gen_random_uuid(), v_growth, v_admin, 'Can you approve the giveaway?', 'https://admin.usemingla.com/#/content-calendar'),
    ('work_card', gen_random_uuid(), NULL, v_admin, 'A work card changed.', 'https://admin.usemingla.com/#/work-board'),
    ('work_card', gen_random_uuid(), NULL, v_admin, 'Another card changed.', 'https://admin.usemingla.com/#/work-board'),
    ('work_card', gen_random_uuid(), NULL, v_growth, 'Not yours.', 'https://admin.usemingla.com/#/work-board');
  INSERT INTO public.notifications(user_id, type, title, body, data, created_at) VALUES
    (v_admin, 'business.support_new_ticket', 'New ticket', 'Open one', jsonb_build_object('ticket_id', v_tk_open), now()),
    (v_admin, 'business.support_new_ticket', 'New ticket', 'Solved one', jsonb_build_object('ticketId', v_tk_done), now() - interval '1 day'),
    (v_growth, 'business.support_new_ticket', 'New ticket', 'Not yours', jsonb_build_object('ticket_id', v_tk_open), now());

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v := public.team_inbox(v_types, 100);
  RESET ROLE;
  PERFORM pg_temp.w4a_assert(position('Not yours' IN v::text) = 0, 'N-01 only my own rows');
  PERFORM pg_temp.w4a_assert((v #>> '{unread,mentions}')::int = 1, 'N-01 one real mention');
  PERFORM pg_temp.w4a_assert((v #>> '{unread,work_updates}')::int = 2, 'N-01 two Work updates');
  PERFORM pg_temp.w4a_assert((v #>> '{unread,support}')::int = 1, 'N-01 the resolved ticket''s alert is not unread');
  PERFORM pg_temp.w4a_assert((SELECT (a ->> 'ticket_resolved')::boolean FROM jsonb_array_elements(v -> 'alerts') a WHERE a ->> 'body' = 'Solved one'),
    'N-01 the alert says its ticket is resolved');
  PERFORM pg_temp.w4a_assert((SELECT m ->> 'actor_name' FROM jsonb_array_elements(v -> 'mentions') m WHERE m ->> 'kind' = 'mention') IS NOT NULL,
    'N-01 a mention names who made it');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.w4a_as(v_admin);
  v := public.team_inbox_mark_read('work_updates', v_types);
  PERFORM pg_temp.w4a_assert((v ->> 'mentions')::int = 2 AND (v ->> 'alerts')::int = 0, 'N-02 only the Work updates were marked');
  v := public.team_inbox(v_types, 100);
  PERFORM pg_temp.w4a_assert((v #>> '{unread,mentions}')::int = 1 AND (v #>> '{unread,work_updates}')::int = 0, 'N-02 the mention is still unread');
  v := public.team_inbox_mark_read('all', v_types);
  v := public.team_inbox(v_types, 100);
  RESET ROLE;
  PERFORM pg_temp.w4a_assert((v #>> '{unread,mentions}')::int = 0 AND (v #>> '{unread,support}')::int = 0, 'N-02 Mark all read clears the rest');
  PERFORM pg_temp.w4a_assert((SELECT read_at IS NULL FROM public.notifications WHERE user_id = v_growth AND body = 'Not yours'),
    'N-02 another teammate''s alert is untouched');
END
$main$;
ROLLBACK;
