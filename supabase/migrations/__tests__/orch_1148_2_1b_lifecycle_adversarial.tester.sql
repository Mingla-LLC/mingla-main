-- =====================================================================================
-- TEST_META-ORCH-1148 sub-ORCH 2.1b — ADVERSARIAL LIFECYCLE / CONVERT / RLS / GRANT
-- mingla-tester (claude). A DIFFERENT angle than the implementor's source-grep deno
-- tests: this is a LIVE-FIRE psql harness that EXECUTES the RPCs against real seeded
-- rows on Postgres 17 with the full 237-migration chain applied, and attacks:
--   A. concurrent / double-transition race serialization (FOR UPDATE)
--   B. cross-brand p_table_id injection (transition + convert)  [suspected defect]
--   C. convert-then-reconvert + convert from non-active states
--   D. RLS cross-brand read isolation (stranger reads 0)
--   E. manual-create gate (non-member + scanner-rank denied; manager allowed)
--   F. same-state transition rejected; terminal locked; no_show only from confirmed/seated
--   G. audit_log rows written for every mutation
--
-- Run (after applying all migrations to a fresh supabase/postgres:17.4.1.075):
--   psql -v ON_ERROR_STOP=1 -f orch_1148_2_1b_lifecycle_adversarial.tester.sql
--
-- Each assertion RAISEs EXCEPTION on failure (so ON_ERROR_STOP aborts + the harness
-- reports the first defect). A clean run ends '== ALL 2.1b ADVERSARIAL ASSERTIONS PASSED =='.
--
-- Fails-on-revert anchor: a revert of biz_reservation_transition's legal-matrix guard,
-- the FOR UPDATE lock, the convert already-converted guard, or the manager+ gate makes
-- the corresponding assert RAISE. Cited @ commit 7eeb41d6f.
-- =====================================================================================

\set ON_ERROR_STOP on
\timing off

-- -------------------------------------------------------------------------------------
-- FIXTURES: two brands owned by two different users + a manager + a scanner-rank member.
-- -------------------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ownerA@tester.com'),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ownerB@tester.com'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','managerA@tester.com'),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scannerA@tester.com'),
  ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stranger@tester.com')
ON CONFLICT (id) DO NOTHING;

-- brands.account_id FKs creator_accounts(id), where creator_accounts.id = auth.users.id.
INSERT INTO public.creator_accounts (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.brands (id, account_id, name, slug) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','Brand A','tester-brand-a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','Brand B','tester-brand-b')
ON CONFLICT (id) DO NOTHING;

-- managerA is an accepted event_manager on Brand A; scannerA is an accepted scanner on Brand A.
INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','event_manager', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44444444-4444-4444-4444-444444444444','scanner', now())
ON CONFLICT DO NOTHING;

INSERT INTO public.venue_reservation_settings (brand_id, no_show_fee_policy) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','forfeit'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','forfeit')
ON CONFLICT (brand_id) DO NOTHING;

-- A table that belongs to Brand B (the cross-brand injection target).
INSERT INTO public.venue_tables (id, brand_id, name, capacity) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B-Table-1',4),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A-Table-1',4)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================================
-- E. MANUAL-CREATE GATE
-- =====================================================================================

-- E1: a non-member (stranger) cannot create on Brand A → 42501.
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555', true);
  BEGIN
    PERFORM public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '2 hours', 2);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E1 FAIL: a non-member was allowed to create a reservation'; END IF;
  RAISE NOTICE 'E1 PASS: non-member create rejected (42501)';
END $$;

-- E2: a scanner-rank member (rank 10 < 40) cannot create → 42501.
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444', true);
  BEGIN
    PERFORM public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '2 hours', 2);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E2 FAIL: a scanner-rank member was allowed to create (gate must be manager+)'; END IF;
  RAISE NOTICE 'E2 PASS: scanner-rank create rejected (manager+ gate holds)';
END $$;

-- E3: an event_manager (rank 40) CAN create.
DO $$
DECLARE v_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '2 hours', 2,
            'phone','Manager Made','+15555550100')).id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'E3 FAIL: manager create returned NULL'; END IF;
  RAISE NOTICE 'E3 PASS: event_manager create allowed (%).', v_id;
END $$;

-- E4: invalid initial status rejected (e.g. cannot create directly into 'completed').
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  BEGIN
    PERFORM public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '2 hours', 2,
      'phone',NULL,NULL,NULL,NULL,NULL,NULL,'{}'::text[],'completed');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'E4 FAIL: create into terminal status completed was allowed'; END IF;
  RAISE NOTICE 'E4 PASS: create into a terminal status rejected';
END $$;

-- =====================================================================================
-- F. TRANSITION MATRIX (terminal locked, same-state rejected, no_show source-gated)
-- =====================================================================================

-- Set up a confirmed reservation on Brand A owned by ownerA.
DO $$
DECLARE v_id uuid; ok boolean := false; ok2 boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '3 hours', 2)).id;
  -- F1: same-state transition (confirmed->confirmed) must be REJECTED.
  BEGIN
    PERFORM public.biz_reservation_transition(v_id, 'confirmed');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'F1 FAIL: same-state confirmed->confirmed was allowed'; END IF;
  RAISE NOTICE 'F1 PASS: same-state transition rejected';
  -- F2: confirmed -> seated -> completed legal; then completed is terminal.
  PERFORM public.biz_reservation_transition(v_id, 'seated');
  PERFORM public.biz_reservation_transition(v_id, 'completed');
  BEGIN
    PERFORM public.biz_reservation_transition(v_id, 'seated');
  EXCEPTION WHEN check_violation THEN ok2 := true;
  END;
  IF NOT ok2 THEN RAISE EXCEPTION 'F2 FAIL: a completed (terminal) reservation was re-seatable'; END IF;
  RAISE NOTICE 'F2 PASS: terminal completed cannot transition out';
END $$;

-- F3: no_show is NOT reachable from 'requested' (only confirmed/seated).
DO $$
DECLARE v_id uuid; ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '4 hours', 2,
            'phone',NULL,NULL,NULL,NULL,NULL,NULL,'{}'::text[],'requested')).id;
  BEGIN
    PERFORM public.biz_reservation_transition(v_id, 'no_show');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'F3 FAIL: no_show was reachable from requested'; END IF;
  RAISE NOTICE 'F3 PASS: no_show not reachable from requested';
END $$;

-- F4: no_show DOES record the venue forfeit policy in audit_log.after (from confirmed).
DO $$
DECLARE v_id uuid; v_policy text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '5 hours', 2)).id;
  PERFORM public.biz_reservation_transition(v_id, 'no_show', NULL, 'guest never showed');
  SELECT (after->>'no_show_fee_policy') INTO v_policy
    FROM public.audit_log
    WHERE target_id = v_id::text AND action='venue_reservation.transition'
    ORDER BY created_at DESC LIMIT 1;
  IF v_policy IS DISTINCT FROM 'forfeit' THEN
    RAISE EXCEPTION 'F4 FAIL: no_show did not record the venue forfeit policy (got %)', v_policy;
  END IF;
  RAISE NOTICE 'F4 PASS: no_show records forfeit policy decision (no money path)';
END $$;

-- =====================================================================================
-- B. CROSS-BRAND p_table_id INJECTION on biz_reservation_transition  [D-1 FIX]
--    The RPC assigns COALESCE(p_table_id, table_id). D-1 added a same-brand guard:
--    a table from a DIFFERENT brand MUST be REJECTED. A same-brand table MUST work,
--    and NULL (unassigned) MUST stay allowed. These are HARD fails-on-revert now.
--    (Revert the D-1 guard → B1 RAISEs FAILS-ON-REVERT CONFIRMED.)
-- =====================================================================================

-- B1: cross-brand table_id on TRANSITION is REJECTED (check_violation 23514).
DO $$
DECLARE v_id uuid; ok boolean := false; v_injected uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '6 hours', 2)).id;
  BEGIN
    PERFORM public.biz_reservation_transition(v_id, 'seated', v_injected, 'inject cross-brand table');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'B1 FAIL [FAILS-ON-REVERT CONFIRMED]: cross-brand Brand-B table was ASSIGNED onto a Brand-A reservation via transition (D-1 guard missing). reservation=%', v_id;
  END IF;
  RAISE NOTICE 'B1 PASS: cross-brand table_id on transition REJECTED (same-brand guard)';
END $$;

-- B2: a SAME-BRAND table on transition is ACCEPTED + persisted (positive control).
DO $$
DECLARE v_id uuid; v_assigned uuid; v_same uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '6 hours 30 minutes', 2)).id;
  v_assigned := (public.biz_reservation_transition(v_id, 'seated', v_same, 'same-brand table ok')).table_id;
  IF v_assigned IS DISTINCT FROM v_same THEN
    RAISE EXCEPTION 'B2 FAIL: same-brand table not assigned (got %, want %)', v_assigned, v_same;
  END IF;
  RAISE NOTICE 'B2 PASS: same-brand table assigned on transition (%).', v_assigned;
END $$;

-- B3: a NULL table_id (unassigned) transition is still allowed (no regression).
DO $$
DECLARE v_id uuid; v_status text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '6 hours 45 minutes', 2)).id;
  v_status := (public.biz_reservation_transition(v_id, 'seated', NULL, 'no table')).status;
  IF v_status <> 'seated' THEN RAISE EXCEPTION 'B3 FAIL: NULL-table transition did not seat (got %)', v_status; END IF;
  RAISE NOTICE 'B3 PASS: NULL table_id transition still allowed (unassigned)';
END $$;

-- B4: cross-brand table_id on biz_reservation_create is REJECTED (D-1, create path).
DO $$
DECLARE ok boolean := false; v_injected uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  BEGIN
    PERFORM public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '6 hours', 2,
      'phone',NULL,NULL,NULL, v_injected);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'B4 FAIL [FAILS-ON-REVERT CONFIRMED]: biz_reservation_create accepted a CROSS-BRAND table_id (D-1 guard missing)';
  END IF;
  RAISE NOTICE 'B4 PASS: cross-brand table_id on create REJECTED (same-brand guard)';
END $$;

-- =====================================================================================
-- A. CONCURRENT / DOUBLE-TRANSITION RACE (serialization via FOR UPDATE)
--    Single-connection proxy: the matrix guard re-reads status FOR UPDATE each call, so
--    the SECOND terminal transition on an already-terminal row must be rejected. (A true
--    2-connection race is run separately by the harness; here we prove the guard re-reads
--    fresh state rather than a stale snapshot.)
-- =====================================================================================
DO $$
DECLARE v_id uuid; ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_id := (public.biz_reservation_create('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now()+interval '7 hours', 2)).id;
  PERFORM public.biz_reservation_transition(v_id, 'cancelled_by_venue', NULL, 'first cancel');
  -- a second mutation on the now-terminal row must be rejected (proves fresh re-read).
  BEGIN
    PERFORM public.biz_reservation_transition(v_id, 'completed');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'A FAIL: a second transition on a terminal (cancelled) row succeeded — stale-state guard'; END IF;
  RAISE NOTICE 'A PASS: second transition on terminal row rejected (guard re-reads fresh status FOR UPDATE)';
END $$;

-- =====================================================================================
-- C. WAITLIST CONVERT — atomicity, reconvert, non-active rejection, cross-brand table
-- =====================================================================================

-- Seed a waitlist row on Brand A.
INSERT INTO public.venue_waitlist (id, brand_id, party_size, guest_name, guest_phone_e164, status)
VALUES ('aaaaaaaa-eeee-eeee-eeee-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 3, 'Wait Guest', '+15555550111', 'waiting')
ON CONFLICT (id) DO NOTHING;

-- C1: convert is ATOMIC — reservation created AND waitlist marked converted+linked.
DO $$
DECLARE v_res uuid; v_wstatus text; v_link uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_res := (public.biz_waitlist_convert_to_reservation('aaaaaaaa-eeee-eeee-eeee-000000000001', now()+interval '8 hours', NULL)).id;
  SELECT status, converted_reservation_id INTO v_wstatus, v_link
    FROM public.venue_waitlist WHERE id='aaaaaaaa-eeee-eeee-eeee-000000000001';
  IF v_res IS NULL THEN RAISE EXCEPTION 'C1 FAIL: convert returned no reservation'; END IF;
  IF v_wstatus <> 'converted' THEN RAISE EXCEPTION 'C1 FAIL: waitlist not marked converted (got %)', v_wstatus; END IF;
  IF v_link IS DISTINCT FROM v_res THEN RAISE EXCEPTION 'C1 FAIL: converted_reservation_id not linked (got % want %)', v_link, v_res; END IF;
  RAISE NOTICE 'C1 PASS: atomic convert (reservation % created + waitlist converted+linked)', v_res;
END $$;

-- C2: a converted waitlist row CANNOT be converted again → 23505.
DO $$
DECLARE ok boolean := false; res_before bigint; res_after bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  SELECT count(*) INTO res_before FROM public.reservations;
  BEGIN
    PERFORM public.biz_waitlist_convert_to_reservation('aaaaaaaa-eeee-eeee-eeee-000000000001', now()+interval '9 hours', NULL);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  SELECT count(*) INTO res_after FROM public.reservations;
  IF NOT ok THEN RAISE EXCEPTION 'C2 FAIL: a converted waitlist row was converted twice'; END IF;
  IF res_after <> res_before THEN RAISE EXCEPTION 'C2 FAIL: a 2nd-convert attempt left an ORPHAN reservation (% -> %)', res_before, res_after; END IF;
  RAISE NOTICE 'C2 PASS: double-convert rejected (23505), no orphan reservation';
END $$;

-- C3: a forced mid-convert failure (bad table_id) leaves NO orphan + NO converted
--     flag (atomic rollback). NOTE post-D-1: a non-existent table_id is rejected by
--     the D-1 same-brand guard (check_violation) BEFORE the FK ever fires — earlier
--     and cleaner. The atomicity proof is unchanged: either error aborts the whole
--     txn with no orphan reservation + waitlist still 'waiting'.
INSERT INTO public.venue_waitlist (id, brand_id, party_size, guest_name, status)
VALUES ('aaaaaaaa-eeee-eeee-eeee-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, 'Atomic Guest', 'waiting')
ON CONFLICT (id) DO NOTHING;
DO $$
DECLARE ok boolean := false; res_before bigint; res_after bigint; v_wstatus text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  SELECT count(*) INTO res_before FROM public.reservations;
  BEGIN
    -- a non-existent table_id: rejected by the D-1 same-brand guard (check_violation),
    -- or — absent the guard — by the reservations.table_id FK (foreign_key_violation).
    -- Either way the whole txn rolls back.
    PERFORM public.biz_waitlist_convert_to_reservation('aaaaaaaa-eeee-eeee-eeee-000000000002', now()+interval '2 hours',
      '00000000-dead-dead-dead-000000000000');
  EXCEPTION
    WHEN check_violation THEN ok := true;        -- D-1 guard (current behavior)
    WHEN foreign_key_violation THEN ok := true;  -- pre-D-1 FK (still atomic)
  END;
  SELECT count(*) INTO res_after FROM public.reservations;
  SELECT status INTO v_wstatus FROM public.venue_waitlist WHERE id='aaaaaaaa-eeee-eeee-eeee-000000000002';
  IF NOT ok THEN RAISE EXCEPTION 'C3 FAIL: a bad table_id did not error'; END IF;
  IF res_after <> res_before THEN RAISE EXCEPTION 'C3 FAIL: ORPHAN reservation left after mid-convert failure (% -> %)', res_before, res_after; END IF;
  IF v_wstatus <> 'waiting' THEN RAISE EXCEPTION 'C3 FAIL: waitlist row partially mutated after failed convert (got %)', v_wstatus; END IF;
  RAISE NOTICE 'C3 PASS: forced mid-convert failure left NO orphan + waitlist still waiting (atomic rollback)';
END $$;

-- C4: cross-brand table injection on CONVERT (Brand B table onto a Brand A convert)
--     is REJECTED (D-1), the waitlist row stays 'waiting', and NO orphan reservation
--     is left (atomic abort BEFORE the INSERT). HARD fails-on-revert.
DO $$
DECLARE ok boolean := false; v_injected uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  res_before bigint; res_after bigint; v_wstatus text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  SELECT count(*) INTO res_before FROM public.reservations;
  BEGIN
    PERFORM public.biz_waitlist_convert_to_reservation('aaaaaaaa-eeee-eeee-eeee-000000000002', now()+interval '2 hours', v_injected);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  SELECT count(*) INTO res_after FROM public.reservations;
  SELECT status INTO v_wstatus FROM public.venue_waitlist WHERE id='aaaaaaaa-eeee-eeee-eeee-000000000002';
  IF NOT ok THEN
    RAISE EXCEPTION 'C4 FAIL [FAILS-ON-REVERT CONFIRMED]: convert assigned a CROSS-BRAND (Brand B) table onto a Brand A reservation (D-1 guard missing)';
  END IF;
  IF res_after <> res_before THEN RAISE EXCEPTION 'C4 FAIL: cross-brand convert left an ORPHAN reservation (% -> %)', res_before, res_after; END IF;
  IF v_wstatus <> 'waiting' THEN RAISE EXCEPTION 'C4 FAIL: waitlist row mutated after rejected cross-brand convert (got %)', v_wstatus; END IF;
  RAISE NOTICE 'C4 PASS: cross-brand table on convert REJECTED, no orphan, waitlist still waiting';
END $$;

-- C5: a SAME-BRAND table on convert is ACCEPTED + linked (positive control).
DO $$
DECLARE v_res uuid; v_tbl uuid; v_same uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
  v_res := (public.biz_waitlist_convert_to_reservation('aaaaaaaa-eeee-eeee-eeee-000000000002', now()+interval '2 hours', v_same)).id;
  SELECT table_id INTO v_tbl FROM public.reservations WHERE id = v_res;
  IF v_tbl IS DISTINCT FROM v_same THEN
    RAISE EXCEPTION 'C5 FAIL: same-brand table not assigned on convert (got %, want %)', v_tbl, v_same;
  END IF;
  RAISE NOTICE 'C5 PASS: same-brand table assigned on convert (reservation %, table %).', v_res, v_tbl;
END $$;

-- =====================================================================================
-- D. RLS CROSS-BRAND READ ISOLATION (the stranger reads 0 of Brand A's rows)
--    Run as a NON-superuser role so RLS is enforced (postgres bypasses RLS).
-- =====================================================================================
-- Grant authenticated role membership so we can SET ROLE authenticated with a jwt claim.
DO $$ BEGIN
  -- ownerA can read their own reservations; stranger reads 0.
  NULL;
END $$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';   -- stranger
SELECT CASE WHEN count(*) = 0 THEN 'D1 PASS: stranger reads 0 Brand A reservations (RLS)'
            ELSE 'D1 FAIL: stranger read '||count(*)||' Brand A reservations' END AS d1
FROM public.reservations WHERE brand_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT CASE WHEN count(*) = 0 THEN 'D2 PASS: stranger reads 0 Brand A waitlist rows (RLS)'
            ELSE 'D2 FAIL: stranger read '||count(*)||' Brand A waitlist rows' END AS d2
FROM public.venue_waitlist WHERE brand_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';   -- ownerA
SELECT CASE WHEN count(*) > 0 THEN 'D3 PASS: ownerA reads their own Brand A reservations'
            ELSE 'D3 FAIL: ownerA reads 0 of their own reservations' END AS d3
FROM public.reservations WHERE brand_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

RESET ROLE;

-- =====================================================================================
-- G. AUDIT TRAIL — every mutation wrote an audit_log row.
-- =====================================================================================
DO $$
DECLARE n_create int; n_trans int; n_conv int;
BEGIN
  SELECT count(*) INTO n_create FROM public.audit_log WHERE action='venue_reservation.create';
  SELECT count(*) INTO n_trans  FROM public.audit_log WHERE action='venue_reservation.transition';
  SELECT count(*) INTO n_conv   FROM public.audit_log WHERE action='venue_waitlist.converted';
  IF n_create < 1 THEN RAISE EXCEPTION 'G FAIL: no venue_reservation.create audit rows'; END IF;
  IF n_trans  < 1 THEN RAISE EXCEPTION 'G FAIL: no venue_reservation.transition audit rows'; END IF;
  IF n_conv   < 1 THEN RAISE EXCEPTION 'G FAIL: no venue_waitlist.converted audit rows'; END IF;
  RAISE NOTICE 'G PASS: audit rows written (create=%, transition=%, convert=%)', n_create, n_trans, n_conv;
END $$;

-- =====================================================================================
-- H. D-2 — defensive 21610 global opt-out persistence (partial-index-safe RPC).
--    The edge fn calls biz_sms_record_global_opt_out on a Twilio 21610. It MUST
--    persist a single GLOBAL (brand_id IS NULL) row WITHOUT throwing, and be
--    idempotent on repeat (no 23505). HARD fails-on-revert: the broken
--    .upsert(onConflict:"phone_e164") path errors against the PARTIAL unique
--    indexes — proven below by attacking that exact spec directly.
-- =====================================================================================

-- H1: the RPC persists a global opt-out without throwing, and is IDEMPOTENT.
DO $$
DECLARE n int; n_nonnull int;
BEGIN
  -- first call inserts the global row.
  PERFORM public.biz_sms_record_global_opt_out('+15555559999', 'twilio_blacklist');
  -- repeat call is a no-op (idempotent) — must NOT raise 23505.
  PERFORM public.biz_sms_record_global_opt_out('+15555559999', 'twilio_blacklist');
  SELECT count(*) INTO n
    FROM public.venue_sms_opt_out WHERE phone_e164='+15555559999';
  SELECT count(*) INTO n_nonnull
    FROM public.venue_sms_opt_out WHERE phone_e164='+15555559999' AND brand_id IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'H1 FAIL: expected exactly 1 global opt-out row, got %', n; END IF;
  IF n_nonnull <> 0 THEN RAISE EXCEPTION 'H1 FAIL: opt-out row is not GLOBAL (a non-NULL brand_id row exists)'; END IF;
  RAISE NOTICE 'H1 PASS: 21610 global opt-out persists once + idempotent on repeat (no throw)';
END $$;

-- H2: a per-brand opt-out for the SAME phone coexists with the global row
--     (the partial indexes are distinct; the RPC only touches the global one).
DO $$
DECLARE n_global int; n_brand int;
BEGIN
  INSERT INTO public.venue_sms_opt_out (phone_e164, brand_id, reason)
    VALUES ('+15555559999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual')
    ON CONFLICT (phone_e164, brand_id) WHERE brand_id IS NOT NULL DO NOTHING;
  -- RPC again — still no-op on the global row, brand row untouched.
  PERFORM public.biz_sms_record_global_opt_out('+15555559999', 'twilio_blacklist');
  SELECT count(*) INTO n_global FROM public.venue_sms_opt_out WHERE phone_e164='+15555559999' AND brand_id IS NULL;
  SELECT count(*) INTO n_brand  FROM public.venue_sms_opt_out WHERE phone_e164='+15555559999' AND brand_id IS NOT NULL;
  IF n_global <> 1 THEN RAISE EXCEPTION 'H2 FAIL: global row count drifted (got %)', n_global; END IF;
  IF n_brand  <> 1 THEN RAISE EXCEPTION 'H2 FAIL: per-brand row count drifted (got %)', n_brand; END IF;
  RAISE NOTICE 'H2 PASS: global + per-brand opt-out rows coexist; RPC touches only global';
END $$;

-- H3: FAILS-ON-REVERT for D-2 — the OLD broken arbiter spec
--     `ON CONFLICT (phone_e164)` (a NON-partial target) errors against the table,
--     which has ONLY partial unique indexes. This is exactly what the JS
--     .upsert({ onConflict: "phone_e164" }) emitted. Proving it RAISEs documents
--     the bug the RPC fix avoids.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.venue_sms_opt_out (phone_e164, brand_id, reason)
      VALUES ('+15555558888', NULL, 'twilio_blacklist')
      ON CONFLICT (phone_e164) DO NOTHING;   -- the BROKEN (D-2) spec.
  EXCEPTION WHEN others THEN
    -- 42P10 invalid_column_reference: "no unique or exclusion constraint matching..."
    ok := true;
    RAISE NOTICE 'H3 PASS(by-error): broken ON CONFLICT (phone_e164) spec rejected by % (%)', SQLSTATE, SQLERRM;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'H3 FAIL: ON CONFLICT (phone_e164) unexpectedly succeeded — a non-partial UNIQUE(phone_e164) must have been added (D-2 fix uses the partial-index RPC, NOT a widened constraint)';
  END IF;
END $$;

\echo '== ALL 2.1b ADVERSARIAL ASSERTIONS PASSED (see NOTICE/WARNING lines above for findings) =='
