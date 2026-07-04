-- ORCH-1298 [chip-in-receipt-emails] — SQL contract tests for the ENQUEUE path.
--
-- Fails-on-revert artifact for migration
--   20261223000000_orch_1298_chip_in_receipt_enqueue.sql
-- which teaches finalize_rsvp_contribution to enqueue, on the NON-REPLAY branch
-- ONLY, a guest gift-receipt + host gift-received into notification_outbox
-- (exception-safe, ON CONFLICT DO NOTHING), covering BOTH rails from one write.
--
-- PAIRED GUARD (SPEC §9):
--   T-1 = a first paid finalize enqueues the GUEST receipt row. Reverting the
--         enqueue block → 0 guest rows → T-1 FAIL.
--   T-4 = a REPLAYED finalize (2nd call on the now-`paid` row) returns
--         idempotent_replay:true and enqueues ZERO new rows. Reverting the
--         `status='paid'` early-return guard → the replay returns
--         idempotent_replay:false → T-4 FAIL.
--
-- USAGE (repo SQL-probe convention — hand-run against the linked remote AFTER the
-- orchestrator applies the migration; NOT run by the implementor):
--
--   cat supabase/migrations/__tests__/orch_1298_chip_in_receipt_enqueue.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- Each block is BEGIN; … ROLLBACK; so it leaves NO fixture rows (incl. auth.users).
-- RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL (non-zero exit in CI/scripts).
-- The seeded categories (buyer_contribution_receipt / business.rsvp_contribution_received)
-- must already exist from the applied migration (outbox FK: category_key).

-- ===========================================================================
-- T-1 (happy, GUEST) — a first Stripe contribution finalize enqueues exactly ONE
-- guest receipt row keyed `chip_in_receipt:{id}:guest`. Reverting the enqueue
-- block → 0 rows → FAIL.  (Brand has NO team + no contact_email so ONLY the guest
-- row is created, isolating the guest assertion.)
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();     -- brand account owner (not a team row)
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_contr  uuid := gen_random_uuid();
  v_guest  integer;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1298-t1-brand', 'ORCH1298 T1', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'T1 Party', 'orch1298-t1-party',
    'Vibes.', 'scheduled', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, true, now(), now(), '{}'::jsonb);

  -- Anon guest (user_id NULL, guest_email set), pending.
  INSERT INTO public.event_rsvp_contributions
    (id, event_id, brand_id, user_id, guest_name, guest_email, provider, currency,
     amount_cents, buyer_total_cents, pricing_breakdown, status)
  VALUES (v_contr, v_event, v_brand, NULL, 'Ada', 'ada-t1@guest.test', 'stripe', 'USD',
     2500, 2500, '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'pending');

  PERFORM public.finalize_rsvp_contribution(v_contr, 'pi_orch1298_t1', 'ch_orch1298_t1', 'card');

  SELECT count(*) INTO v_guest FROM public.notification_outbox
   WHERE category_key = 'buyer_contribution_receipt'
     AND idempotency_key = 'chip_in_receipt:' || v_contr || ':guest';
  IF v_guest <> 1 THEN
    RAISE EXCEPTION 'T-1 FAIL: expected 1 guest receipt outbox row, got % (enqueue reverted?)', v_guest;
  END IF;
  RAISE NOTICE 'T-1 PASS: first paid finalize enqueued exactly one guest receipt row';
END$$;
ROLLBACK;

-- ===========================================================================
-- T-2 (happy, HOST) — brand with accepted owner+admin+finance + a contact_email:
-- 3 host rows keyed `…:host:{uid}` + 1 `…:host_email`. Team members are REAL
-- auth.users rows (notification_outbox.user_id FKs auth.users).
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_owner   uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_fin     uuid := gen_random_uuid();
  v_scanner uuid := gen_random_uuid();     -- NON-payments role → must NOT be notified
  v_brand   uuid := gen_random_uuid();
  v_event   uuid := gen_random_uuid();
  v_contr   uuid := gen_random_uuid();
  v_host_push  integer;
  v_host_email integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_owner,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-t2@tester.com',   now(), now()),
    (v_admin,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-t2@tester.com',   now(), now()),
    (v_fin,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fin-t2@tester.com',     now(), now()),
    (v_scanner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scanner-t2@tester.com', now(), now());

  INSERT INTO public.brands (id, account_id, slug, name, default_currency, contact_email, created_at, updated_at)
  VALUES (v_brand, v_owner, 'orch1298-t2-brand', 'ORCH1298 T2', 'USD', 'host-t2@brand.test', now(), now());

  INSERT INTO public.brand_team_members (id, brand_id, user_id, role, invited_at, accepted_at, removed_at) VALUES
    (gen_random_uuid(), v_brand, v_owner,   'brand_owner',     now(), now(), NULL),
    (gen_random_uuid(), v_brand, v_admin,   'brand_admin',     now(), now(), NULL),
    (gen_random_uuid(), v_brand, v_fin,     'finance_manager', now(), now(), NULL),
    (gen_random_uuid(), v_brand, v_scanner, 'scanner',         now(), now(), NULL);

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_owner, 'rsvp', 'T2 Party', 'orch1298-t2-party',
    'Vibes.', 'scheduled', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, true, now(), now(), '{}'::jsonb);

  INSERT INTO public.event_rsvp_contributions
    (id, event_id, brand_id, user_id, guest_name, guest_email, provider, currency,
     amount_cents, buyer_total_cents, pricing_breakdown, status)
  VALUES (v_contr, v_event, v_brand, NULL, 'Ada', 'ada-t2@guest.test', 'stripe', 'USD',
     5000, 5000, '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'pending');

  PERFORM public.finalize_rsvp_contribution(v_contr, 'pi_orch1298_t2', 'ch_orch1298_t2', 'card');

  SELECT count(*) INTO v_host_push FROM public.notification_outbox
   WHERE category_key = 'business.rsvp_contribution_received'
     AND idempotency_key LIKE 'chip_in_receipt:' || v_contr || ':host:%';
  SELECT count(*) INTO v_host_email FROM public.notification_outbox
   WHERE category_key = 'business.rsvp_contribution_received'
     AND idempotency_key = 'chip_in_receipt:' || v_contr || ':host_email';

  IF v_host_push <> 3 THEN
    RAISE EXCEPTION 'T-2 FAIL: expected 3 host push/in-app rows (owner/admin/finance, scanner EXCLUDED), got %', v_host_push;
  END IF;
  IF v_host_email <> 1 THEN
    RAISE EXCEPTION 'T-2 FAIL: expected 1 host_email row (contact_email present), got %', v_host_email;
  END IF;
  RAISE NOTICE 'T-2 PASS: host fan-out = 3 payments-role rows + 1 brand-contact email (scanner excluded)';
END$$;
ROLLBACK;

-- ===========================================================================
-- T-3 (DUAL-RAIL) — a Paystack contribution (provider=paystack, NGN) finalized
-- enqueues the SAME guest + host rows (finalize is provider-agnostic → one RPC,
-- both rails). Amount currency = NGN (rendered downstream).
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_contr uuid := gen_random_uuid();
  v_guest integer;
  v_host  integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-t3@tester.com', now(), now());

  INSERT INTO public.brands (id, account_id, slug, name, default_currency,
    payment_provider, payment_country, paystack_subaccount_code, contact_email, created_at, updated_at)
  VALUES (v_brand, v_owner, 'orch1298-t3-brand', 'ORCH1298 T3', 'NGN',
    'paystack', 'NG', 'ACCT_orch1298t3', 'host-t3@brand.test', now(), now());

  INSERT INTO public.brand_team_members (id, brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES (gen_random_uuid(), v_brand, v_owner, 'brand_owner', now(), now(), NULL);

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_owner, 'rsvp', 'Lagos Chip-in', 'orch1298-t3-lagos',
    'Owambe.', 'scheduled', 'public', 'NGN', 'UTC',
    ARRAY['house-party'], 'auto', false, true, now(), now(), '{}'::jsonb);

  INSERT INTO public.event_rsvp_contributions
    (id, event_id, brand_id, user_id, guest_name, guest_email, provider, currency,
     amount_cents, buyer_total_cents, pricing_breakdown, status)
  VALUES (v_contr, v_event, v_brand, NULL, 'Chidi', 'chidi-t3@guest.test', 'paystack', 'NGN',
     500000, 500000, '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'pending');

  PERFORM public.finalize_rsvp_contribution(v_contr, 'ref_orch1298_t3', 'txn_orch1298_t3', NULL);

  SELECT count(*) INTO v_guest FROM public.notification_outbox
   WHERE idempotency_key = 'chip_in_receipt:' || v_contr || ':guest';
  SELECT count(*) INTO v_host FROM public.notification_outbox
   WHERE idempotency_key LIKE 'chip_in_receipt:' || v_contr || ':host%';
  IF v_guest <> 1 OR v_host <> 2 THEN
    RAISE EXCEPTION 'T-3 FAIL (Paystack rail): expected guest=1 host=2 (owner push + host_email), got guest=% host=%', v_guest, v_host;
  END IF;
  -- Confirm the payload carries the NGN currency (amount rendering is currency-aware).
  IF NOT EXISTS (
    SELECT 1 FROM public.notification_outbox
     WHERE idempotency_key = 'chip_in_receipt:' || v_contr || ':guest'
       AND payload->>'currency' = 'NGN'
       AND (payload->>'amount_cents')::int = 500000
  ) THEN
    RAISE EXCEPTION 'T-3 FAIL: guest payload did not carry NGN/amount_cents=500000';
  END IF;
  RAISE NOTICE 'T-3 PASS: Paystack (NGN) rail enqueues identical guest+host rows with NGN payload';
END$$;
ROLLBACK;

-- ===========================================================================
-- T-4 (ADVERSARIAL — replay enqueues NOTHING) — call finalize a SECOND time on
-- the now-`paid` row. It returns idempotent_replay:true and creates ZERO new
-- outbox rows. Reverting the `status='paid'` early-return guard → the 2nd call
-- returns idempotent_replay:false → FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_contr uuid := gen_random_uuid();
  v_first  jsonb;
  v_replay jsonb;
  v_before integer;
  v_after  integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-t4@tester.com', now(), now());

  INSERT INTO public.brands (id, account_id, slug, name, default_currency, contact_email, created_at, updated_at)
  VALUES (v_brand, v_owner, 'orch1298-t4-brand', 'ORCH1298 T4', 'USD', 'host-t4@brand.test', now(), now());

  INSERT INTO public.brand_team_members (id, brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES (gen_random_uuid(), v_brand, v_owner, 'brand_owner', now(), now(), NULL);

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_owner, 'rsvp', 'T4 Party', 'orch1298-t4-party',
    'Vibes.', 'scheduled', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, true, now(), now(), '{}'::jsonb);

  INSERT INTO public.event_rsvp_contributions
    (id, event_id, brand_id, user_id, guest_name, guest_email, provider, currency,
     amount_cents, buyer_total_cents, pricing_breakdown, status)
  VALUES (v_contr, v_event, v_brand, NULL, 'Ada', 'ada-t4@guest.test', 'stripe', 'USD',
     2500, 2500, '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'pending');

  -- First finalize (non-replay) — enqueues.
  SELECT public.finalize_rsvp_contribution(v_contr, 'pi_orch1298_t4', 'ch_orch1298_t4', 'card') INTO v_first;
  IF (v_first->>'idempotent_replay') <> 'false' THEN
    RAISE EXCEPTION 'T-4 FAIL: first finalize should report idempotent_replay:false, got %', v_first->>'idempotent_replay';
  END IF;

  SELECT count(*) INTO v_before FROM public.notification_outbox
   WHERE idempotency_key LIKE 'chip_in_receipt:' || v_contr || ':%';

  -- Replay (same args on the now-paid row) — MUST enqueue nothing.
  SELECT public.finalize_rsvp_contribution(v_contr, 'pi_orch1298_t4', 'ch_orch1298_t4', 'card') INTO v_replay;

  SELECT count(*) INTO v_after FROM public.notification_outbox
   WHERE idempotency_key LIKE 'chip_in_receipt:' || v_contr || ':%';

  IF (v_replay->>'idempotent_replay') <> 'true' THEN
    RAISE EXCEPTION 'T-4 FAIL: replay finalize should report idempotent_replay:true, got % (early-return guard reverted?)', v_replay->>'idempotent_replay';
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'T-4 FAIL: replay created % new outbox rows (expected 0); before=% after=%', v_after - v_before, v_before, v_after;
  END IF;
  RAISE NOTICE 'T-4 PASS: replay returns idempotent_replay:true and enqueues ZERO new rows (before=after=%)', v_after;
END$$;
ROLLBACK;

-- ===========================================================================
-- T-5 (anon reachability / logged-in NULL guest_email) — a logged-in guest whose
-- guest_email is NULL resolves the guest `contact` to the account email via the
-- auth.users COALESCE. Reverting the COALESCE → contact NULL → FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_guest_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_contr uuid := gen_random_uuid();
  v_contact text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_owner,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-t5@tester.com',      now(), now()),
    (v_guest_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'loggedin-guest-t5@acct.test', now(), now());

  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_owner, 'orch1298-t5-brand', 'ORCH1298 T5', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_owner, 'rsvp', 'T5 Party', 'orch1298-t5-party',
    'Vibes.', 'scheduled', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, true, now(), now(), '{}'::jsonb);

  -- Logged-in guest, guest_email NULL → COALESCE resolves auth.users.email.
  INSERT INTO public.event_rsvp_contributions
    (id, event_id, brand_id, user_id, guest_name, guest_email, provider, currency,
     amount_cents, buyer_total_cents, pricing_breakdown, status)
  VALUES (v_contr, v_event, v_brand, v_guest_user, NULL, NULL, 'stripe', 'USD',
     3000, 3000, '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'pending');

  PERFORM public.finalize_rsvp_contribution(v_contr, 'pi_orch1298_t5', 'ch_orch1298_t5', 'card');

  SELECT contact INTO v_contact FROM public.notification_outbox
   WHERE idempotency_key = 'chip_in_receipt:' || v_contr || ':guest';
  IF v_contact IS DISTINCT FROM 'loggedin-guest-t5@acct.test' THEN
    RAISE EXCEPTION 'T-5 FAIL: guest contact should COALESCE to auth.users.email, got %', COALESCE(v_contact, '<null>');
  END IF;
  RAISE NOTICE 'T-5 PASS: logged-in guest with null guest_email resolves contact to the account email';
END$$;
ROLLBACK;

-- ===========================================================================
-- T-8 (FAIL-SOFT) — brand with NO contact_email and NO team members: the
-- paid-flip still commits, the guest row is present, ZERO host rows, and NO
-- error is raised (the enqueue never aborts the finalize).
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_contr uuid := gen_random_uuid();
  v_status text;
  v_guest integer;
  v_host  integer;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1298-t8-brand', 'ORCH1298 T8', 'USD', now(), now());
  -- No contact_email, no brand_team_members rows.

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'T8 Party', 'orch1298-t8-party',
    'Vibes.', 'scheduled', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, true, now(), now(), '{}'::jsonb);

  INSERT INTO public.event_rsvp_contributions
    (id, event_id, brand_id, user_id, guest_name, guest_email, provider, currency,
     amount_cents, buyer_total_cents, pricing_breakdown, status)
  VALUES (v_contr, v_event, v_brand, NULL, 'Ada', 'ada-t8@guest.test', 'stripe', 'USD',
     2500, 2500, '{"tax_basis":"voluntary_contribution","tax_cents":0}'::jsonb, 'pending');

  PERFORM public.finalize_rsvp_contribution(v_contr, 'pi_orch1298_t8', 'ch_orch1298_t8', 'card');

  SELECT status INTO v_status FROM public.event_rsvp_contributions WHERE id = v_contr;
  IF v_status <> 'paid' THEN
    RAISE EXCEPTION 'T-8 FAIL: paid-flip did not commit (status=%)', v_status;
  END IF;

  SELECT count(*) INTO v_guest FROM public.notification_outbox
   WHERE idempotency_key = 'chip_in_receipt:' || v_contr || ':guest';
  SELECT count(*) INTO v_host FROM public.notification_outbox
   WHERE idempotency_key LIKE 'chip_in_receipt:' || v_contr || ':host%';
  IF v_guest <> 1 THEN
    RAISE EXCEPTION 'T-8 FAIL: expected 1 guest row, got %', v_guest;
  END IF;
  IF v_host <> 0 THEN
    RAISE EXCEPTION 'T-8 FAIL: expected 0 host rows (no team, no contact_email), got %', v_host;
  END IF;
  RAISE NOTICE 'T-8 PASS: fail-soft — paid commits, guest row present, zero host rows, no error';
END$$;
ROLLBACK;
