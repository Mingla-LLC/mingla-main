\set ON_ERROR_STOP on

-- Issue #3645 bundle 2A — a paid per-stop experience whose stops total 0 is
-- refused instead of silently publishing free.
-- Migration 20280726003645_issue_3645_per_stop_paid_price.sql.
-- Run after the full migration chain on PostgreSQL 17. Everything rolls back.
--
-- MINGLA-INVARIANT: I-3645-PAID-EXPERIENCE-HAS-A-PRICE | issue #3645 | biz_create_experience (publishing), biz_publish_experience and biz_update_live_experience refuse a paid experience whose one ticket resolves to 0, in whole-price and per-stop mode alike (experience_price_invalid); marking it free is the way to make it free.
--
-- Red before green: on the previous bodies, P1, P5 and L1 fail (a paid
-- per-stop experience at 0 goes through with a free ticket).

BEGIN;

INSERT INTO auth.users(id) VALUES ('3645a2a0-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('3645a2a0-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.as_host() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '3645a2a0-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', '3645a2a0-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
END $$;

-- A brand that can take money, Organiser Terms accepted.
CREATE FUNCTION pg_temp.brand(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code)
  VALUES (p_id, '3645a2a0-0000-4000-8000-000000000001', 'B ' || p_id, 'b2a-' || p_id,
    'NGN', 'paystack', 'NG', 'ACCT_b2a_' || right(p_id::text, 4));
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = p_id AND user_id = '3645a2a0-0000-4000-8000-000000000001';
END $$;

-- What the wizard sends for a two-stop experience. p_pricing 'per_stop': each
-- stop carries its own price_cents (NULL = the stop's price was left empty).
CREATE FUNCTION pg_temp.payload(p_free boolean, p_pricing text, p_whole integer,
  p_stop1 integer, p_stop2 integer, p_description text DEFAULT 'A walk through two good places.')
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title', 'B2a experience', 'description', p_description,
    'currency', 'NGN', 'is_free', p_free, 'pricing_mode', p_pricing,
    'whole_price_cents', CASE WHEN p_pricing = 'whole' THEN p_whole END,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'UTC', 'whenMode', 'single',
    'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
      'doorsOpen', '18:00', 'endsAt', '20:00'),
    'stops', jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object('place_name', 'First', 'ai_description', 'The first stop',
        'address', '1 First St', 'place_id', 'b2a-place-1', 'lat', 6.5, 'lng', 3.4, 'stop_order', 0,
        'price_cents', p_stop1)),
      jsonb_strip_nulls(jsonb_build_object('place_name', 'Second', 'ai_description', 'The second stop',
        'address', '2 Second St', 'place_id', 'b2a-place-2', 'lat', 6.6, 'lng', 3.5, 'stop_order', 1,
        'price_cents', p_stop2)))))
$$;

-- NULL when the call went through, else its refusal. Each call is its own
-- subtransaction, so a refusal leaves nothing behind.
CREATE FUNCTION pg_temp.try_publish(p_event uuid, p_payload jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  PERFORM public.biz_publish_experience(p_event, p_payload, true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.try_live(p_event uuid, p_payload jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  PERFORM public.biz_update_live_experience(p_event, p_payload, 'Updating the experience for guests');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.draft(p_brand uuid, p_payload jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_host();
  RETURN (public.biz_create_experience(p_brand, p_payload, false)->'event'->>'id')::uuid;
END $$;

CREATE FUNCTION pg_temp.live_ticket(p_event uuid) RETURNS public.ticket_types LANGUAGE sql STABLE AS $$
  SELECT * FROM public.ticket_types WHERE event_id = p_event AND deleted_at IS NULL
   ORDER BY display_order LIMIT 1
$$;

-- ─── P1  publish: a paid per-stop experience at 0 is refused ───────────────
DO $p1$
DECLARE
  v_brand uuid := '3645a2a0-0000-4000-8000-0000000000b1';
  v_event uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  -- A draft may hold it (P4): only publishing asks for a price.
  v_event := pg_temp.draft(v_brand, pg_temp.payload(false, 'per_stop', NULL, 0, NULL));

  FOR v_res IN SELECT pg_temp.try_publish(v_event, p) FROM unnest(ARRAY[
    pg_temp.payload(false, 'per_stop', NULL, 0, 0),
    pg_temp.payload(false, 'per_stop', NULL, NULL, NULL),
    pg_temp.payload(false, 'per_stop', NULL, 0, NULL)
  ]) AS p LOOP
    IF v_res IS DISTINCT FROM 'experience_price_invalid' THEN
      RAISE EXCEPTION 'P1 FAIL: paid per-stop at 0 (%)', coalesce(v_res, 'published');
    END IF;
  END LOOP;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft'
     OR (SELECT published_at FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'P1 FAIL: a refused publish moved the experience out of draft';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2A P1 PASS: a paid per-stop experience whose stops total 0 cannot publish';
END $p1$;

-- ─── P2  publish: one priced stop is a price; free stays free; whole unchanged
DO $p2$
DECLARE
  v_brand uuid := '3645a2a0-0000-4000-8000-0000000000b2';
  v_paid uuid;
  v_free uuid;
  v_whole uuid;
  v_res text;
  v_tt public.ticket_types;
BEGIN
  PERFORM pg_temp.brand(v_brand);

  v_paid := pg_temp.draft(v_brand, pg_temp.payload(false, 'per_stop', NULL, 0, 150000));
  v_res := pg_temp.try_publish(v_paid, pg_temp.payload(false, 'per_stop', NULL, 0, 150000));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'P2 FAIL: priced per-stop refused: %', v_res; END IF;
  v_tt := pg_temp.live_ticket(v_paid);
  IF v_tt.price_cents IS DISTINCT FROM 150000 OR v_tt.is_free THEN
    RAISE EXCEPTION 'P2 FAIL: priced per-stop ticket is % free=%', v_tt.price_cents, v_tt.is_free;
  END IF;

  v_free := pg_temp.draft(v_brand, pg_temp.payload(true, 'per_stop', NULL, 0, 0));
  v_res := pg_temp.try_publish(v_free, pg_temp.payload(true, 'per_stop', NULL, 0, 0));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'P2 FAIL: free per-stop refused: %', v_res; END IF;
  v_tt := pg_temp.live_ticket(v_free);
  IF v_tt.price_cents IS DISTINCT FROM 0 OR NOT v_tt.is_free THEN
    RAISE EXCEPTION 'P2 FAIL: free per-stop ticket is % free=%', v_tt.price_cents, v_tt.is_free;
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_free) <> 'scheduled' THEN
    RAISE EXCEPTION 'P2 FAIL: free per-stop did not publish';
  END IF;

  -- Whole price, as before: 0 and not free is refused; a price publishes.
  v_whole := pg_temp.draft(v_brand, pg_temp.payload(false, 'whole', 0, NULL, NULL));
  v_res := pg_temp.try_publish(v_whole, pg_temp.payload(false, 'whole', 0, NULL, NULL));
  IF v_res IS DISTINCT FROM 'experience_price_invalid' THEN
    RAISE EXCEPTION 'P2 FAIL: whole at 0 (%)', coalesce(v_res, 'published');
  END IF;
  v_res := pg_temp.try_publish(v_whole, pg_temp.payload(false, 'whole', 250000, NULL, NULL));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'P2 FAIL: priced whole refused: %', v_res; END IF;
  RAISE NOTICE 'ISSUE-3645-2A P2 PASS: one priced stop publishes paid; free per-stop and whole price behave as before';
END $p2$;

-- ─── P3  publish: the refusal comes before money-readiness answers ─────────
DO $p3$
DECLARE
  v_brand uuid := '3645a2a0-0000-4000-8000-0000000000b3';
  v_event uuid;
  v_res text;
BEGIN
  -- A brand that cannot take money and has not accepted the Organiser Terms.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, '3645a2a0-0000-4000-8000-000000000001', 'B nomoney', 'b2a-nomoney', 'NGN');
  v_event := pg_temp.draft(v_brand, pg_temp.payload(false, 'per_stop', NULL, 0, 0));
  v_res := pg_temp.try_publish(v_event, pg_temp.payload(false, 'per_stop', NULL, 0, 0));
  IF v_res IS DISTINCT FROM 'experience_price_invalid' THEN
    RAISE EXCEPTION 'P3 FAIL: expected the price refusal first, got %', coalesce(v_res, 'published');
  END IF;
  RAISE NOTICE 'ISSUE-3645-2A P3 PASS: the price refusal is the first answer, as for whole price';
END $p3$;

-- ─── P4  a draft save without publishing is unchanged ──────────────────────
DO $p4$
DECLARE
  v_brand uuid := '3645a2a0-0000-4000-8000-0000000000b4';
  v_event uuid;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  v_event := pg_temp.draft(v_brand, pg_temp.payload(false, 'per_stop', NULL, 0, 0));
  PERFORM pg_temp.as_host();
  PERFORM public.biz_publish_experience(v_event, pg_temp.payload(false, 'per_stop', NULL, 0, 0), false);
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'P4 FAIL: a draft save is no longer a draft';
  END IF;
  RAISE NOTICE 'ISSUE-3645-2A P4 PASS: a draft may hold a per-stop price of 0 until it publishes';
END $p4$;

-- ─── P5  creating straight to published follows the same rule ──────────────
DO $p5$
DECLARE
  v_brand uuid := '3645a2a0-0000-4000-8000-0000000000b5';
  v_err text;
  v_before bigint;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  PERFORM pg_temp.as_host();
  v_before := (SELECT count(*) FROM public.events WHERE brand_id = v_brand);
  BEGIN
    PERFORM public.biz_create_experience(v_brand, pg_temp.payload(false, 'per_stop', NULL, 0, 0), true);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS DISTINCT FROM 'experience_price_invalid' THEN
    RAISE EXCEPTION 'P5 FAIL: create+publish per-stop at 0 (%)', coalesce(v_err, 'published');
  END IF;
  IF (SELECT count(*) FROM public.events WHERE brand_id = v_brand) <> v_before THEN
    RAISE EXCEPTION 'P5 FAIL: a refused create left an event behind';
  END IF;
  -- Priced, it publishes; as a draft, 0 is fine.
  PERFORM public.biz_create_experience(v_brand, pg_temp.payload(false, 'per_stop', NULL, 70000, 0), true);
  PERFORM public.biz_create_experience(v_brand, pg_temp.payload(false, 'per_stop', NULL, 0, 0), false);
  RAISE NOTICE 'ISSUE-3645-2A P5 PASS: creating straight to published refuses a paid per-stop experience at 0';
END $p5$;

-- ─── L1  live edit: a paid per-stop experience cannot be cut to 0 ──────────
DO $l1$
DECLARE
  v_brand uuid := '3645a2a0-0000-4000-8000-0000000000c1';
  v_event uuid;
  v_res text;
  v_tt public.ticket_types;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  PERFORM pg_temp.as_host();
  v_event := (public.biz_create_experience(v_brand,
    pg_temp.payload(false, 'per_stop', NULL, 100000, 0), true)->'event'->>'id')::uuid;

  v_res := pg_temp.try_live(v_event, pg_temp.payload(false, 'per_stop', NULL, 0, 0));
  IF v_res IS DISTINCT FROM 'experience_price_invalid' THEN
    RAISE EXCEPTION 'L1 FAIL: live paid per-stop cut to 0 (%)', coalesce(v_res, 'accepted');
  END IF;
  v_tt := pg_temp.live_ticket(v_event);
  IF v_tt.price_cents IS DISTINCT FROM 100000 OR v_tt.is_free THEN
    RAISE EXCEPTION 'L1 FAIL: the refused edit changed the ticket (% free=%)', v_tt.price_cents, v_tt.is_free;
  END IF;

  -- Re-pricing works; marking it free makes the ticket free.
  v_res := pg_temp.try_live(v_event, pg_temp.payload(false, 'per_stop', NULL, 60000, 60000));
  IF v_res IS NOT NULL OR (pg_temp.live_ticket(v_event)).price_cents IS DISTINCT FROM 120000 THEN
    RAISE EXCEPTION 'L1 FAIL: re-pricing (%)', coalesce(v_res, 'ticket not 120000');
  END IF;
  v_res := pg_temp.try_live(v_event, pg_temp.payload(true, 'per_stop', NULL, 0, 0));
  v_tt := pg_temp.live_ticket(v_event);
  IF v_res IS NOT NULL OR NOT v_tt.is_free OR v_tt.price_cents <> 0 THEN
    RAISE EXCEPTION 'L1 FAIL: marking it free (%)', coalesce(v_res, 'ticket not free');
  END IF;
  RAISE NOTICE 'ISSUE-3645-2A L1 PASS: a live paid per-stop experience cannot be cut to 0; re-pricing and marking free work';
END $l1$;

-- ─── L2  an existing free per-stop experience saves as it reads back ───────
-- Before this fix a paid per-stop experience at 0 was stored with a free
-- ticket. Both the wizard (edit.tsx) and Ari (current_experience_payload)
-- read is_free from that ticket, so their next save sends is_free true and
-- goes through; only a save that claims "paid" at 0 is refused.
DO $l2$
DECLARE
  v_brand uuid := '3645a2a0-0000-4000-8000-0000000000c2';
  v_event uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  PERFORM pg_temp.as_host();
  v_event := (public.biz_create_experience(v_brand,
    pg_temp.payload(true, 'per_stop', NULL, 0, 0), true)->'event'->>'id')::uuid;
  IF NOT (pg_temp.live_ticket(v_event)).is_free THEN
    RAISE EXCEPTION 'L2 fixture FAIL: ticket is not free';
  END IF;
  v_res := pg_temp.try_live(v_event, pg_temp.payload(true, 'per_stop', NULL, 0, 0, 'A longer walk.'));
  IF v_res IS NOT NULL THEN RAISE EXCEPTION 'L2 FAIL: saving as read back refused: %', v_res; END IF;
  v_res := pg_temp.try_live(v_event, pg_temp.payload(false, 'per_stop', NULL, 0, 0, 'A longer walk.'));
  IF v_res IS DISTINCT FROM 'experience_price_invalid' THEN
    RAISE EXCEPTION 'L2 FAIL: paid at 0 (%)', coalesce(v_res, 'accepted');
  END IF;
  RAISE NOTICE 'ISSUE-3645-2A L2 PASS: an existing free per-stop experience keeps saving; paid at 0 never does';
END $l2$;

ROLLBACK;
