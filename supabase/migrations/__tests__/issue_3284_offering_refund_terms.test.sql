-- Issue #3284 — refund terms on events and experiences: the server contract.
--
-- WHAT IS PROVED (spec S6, R-01 … R-15). EVERY CASE EXECUTES THE REAL OBJECT against
-- the full applied migration chain, in its own transaction, and rolls back:
--
--   the gated writer `business_patch_offering_refund_policy`
--     R-01  a draft event is written with no reason and no gate
--     R-02  a scheduled event with no paid orders takes a downgrade (reason given)
--     R-03  one paid order: Standard -> Strict is refused, count 1, row unchanged
--     R-04  one paid order: Standard -> Flexible is written
--     R-05  one paid order: NULL -> Strict is written (null counts as 0%)
--     R-06  one paid order: Standard -> NULL is refused
--     R-07  only a FREE order (total_cents = 0): the downgrade is allowed
--     R-08  a trip is refused as offering_type_not_supported and left untouched
--     R-09  a cancelled event is refused as offering_not_editable_status
--     R-10  a scheduled event with reason "short" is refused as invalid_edit_reason
--     R-11  a caller below event_manager raises insufficient_event_permission
--     R-14  a live experience edit writes exactly one experience_edit_log row
--   the readers
--     R-12  the event bundle carries refundPolicy equal to the row; JSON null when unset
--     R-13  the experience reader carries refundPolicy
--     R-15  ADDITIVE ONLY: every key either reader emitted before is still emitted,
--           with an identical value, in the same order, and refundPolicy is last.
--
-- HOW R-15 SEES "BEFORE" WITHOUT A SECOND DATABASE. It reads the installed body of
-- each reader from the catalog, removes exactly the two lines #3284 added, installs
-- that as a pg_temp function, and compares both outputs for the same fixture. If the
-- two added lines are not found verbatim, or anything else in the body moved, the
-- reconstruction assertion fails first.
--
-- FAILS-ON-REVERT:
--   delete the downgrade block from the writer   -> R-03 and R-06 fail
--   delete the paid-orders filter total_cents > 0 -> R-07 fails
--   drop the refundPolicy key from either reader  -> R-12 / R-13 / R-15 fail
--   delete the migration                          -> every case fails (no function)
--
-- Run after the full migration chain on fresh PostgreSQL 17, as the database owner.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.r3284_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3284 refund-terms FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$assert$;

-- The event/experience presets, exactly as the client ships them (spec C1).
CREATE OR REPLACE FUNCTION pg_temp.r3284_policy(p_name text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $policy$
  SELECT CASE p_name
    WHEN 'flexible' THEN '{"kind":"flexible","tiers":[{"days_before_start":7,"refund_pct":100},{"days_before_start":2,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'::jsonb
    WHEN 'standard' THEN '{"kind":"standard","tiers":[{"days_before_start":14,"refund_pct":100},{"days_before_start":7,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'::jsonb
    WHEN 'strict'   THEN '{"kind":"strict","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":0,"refund_pct":0}]}'::jsonb
    WHEN 'none'     THEN '{"kind":"custom","tiers":[{"days_before_start":0,"refund_pct":0}]}'::jsonb
  END
$policy$;

-- A brand owned by a fresh user, and that user signed in as the caller.
CREATE OR REPLACE FUNCTION pg_temp.r3284_brand(p_tag text, OUT o_user uuid, OUT o_brand uuid, OUT o_brand_slug text)
LANGUAGE plpgsql AS $brand$
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_brand_slug := 'issue-3284-' || p_tag || '-' || o_brand;
  INSERT INTO auth.users(id, email) VALUES (o_user, 'issue-3284-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (o_brand, o_user, 'Issue 3284 ' || p_tag, o_brand_slug, 'stripe', 'US', 'USD', 'USD');
  PERFORM set_config('request.jwt.claim.sub', o_user::text, true);
END
$brand$;

-- One offering row with a master date. Drafts carry the draft visibility; every
-- published status is public so the readers can serve it.
CREATE OR REPLACE FUNCTION pg_temp.r3284_offering(
  p_brand uuid, p_tag text, p_type text, p_status text, p_policy jsonb,
  OUT o_event uuid, OUT o_slug text
) LANGUAGE plpgsql AS $offering$
BEGIN
  o_event := gen_random_uuid();
  o_slug := 'issue-3284-' || p_tag || '-' || o_event;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, refund_policy)
    VALUES (o_event, p_brand, 'Issue 3284 ' || p_tag, o_slug, p_type, p_status,
            CASE WHEN p_status = 'draft' THEN 'draft' ELSE 'public' END,
            'UTC', 'USD',
            CASE WHEN p_status = 'draft' THEN NULL ELSE now() END,
            p_policy);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
END
$offering$;

CREATE OR REPLACE FUNCTION pg_temp.r3284_order(p_event uuid, p_total_cents int)
RETURNS void LANGUAGE plpgsql AS $order$
DECLARE v_tag text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status,
                            stripe_payment_intent_id, stripe_charge_id, source)
    VALUES (gen_random_uuid(), p_event, p_total_cents, 'USD', 'paid',
            CASE WHEN p_total_cents > 0 THEN 'pi_3284_' || v_tag END,
            CASE WHEN p_total_cents > 0 THEN 'ch_3284_' || v_tag END,
            'legacy');
END
$order$;

CREATE OR REPLACE FUNCTION pg_temp.r3284_row_policy(p_event uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $row$
  SELECT refund_policy FROM public.events WHERE id = p_event
$row$;

-- ─── R-00: the writer's security contract ──────────────────────────────────────────
BEGIN;
DO $r00$
DECLARE
  v_fn constant text := 'public.business_patch_offering_refund_policy(uuid,jsonb,text)';
  v_secdef boolean;
  v_config text[];
BEGIN
  PERFORM pg_temp.r3284_assert(to_regprocedure(v_fn) IS NOT NULL,
    'R-00a the gated writer exists with signature (uuid, jsonb, text)');
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config
    FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn);
  PERFORM pg_temp.r3284_assert(v_secdef, 'R-00b the writer is SECURITY DEFINER');
  PERFORM pg_temp.r3284_assert(v_config IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(v_config) c WHERE c LIKE 'search_path=%public%'),
    'R-00c the writer pins its search_path');
  PERFORM pg_temp.r3284_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
    'R-00d anon cannot execute the writer');
  PERFORM pg_temp.r3284_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'),
    'R-00e authenticated can execute the writer');
  PERFORM pg_temp.r3284_assert(has_function_privilege('service_role', v_fn, 'EXECUTE'),
    'R-00f service_role can execute the writer');
  PERFORM pg_temp.r3284_assert(
    has_function_privilege('anon', 'public.pg_direct_event_checkout_bundle(uuid,text,text)', 'EXECUTE')
    AND has_function_privilege('anon', 'public.pg_public_experience_by_slug(text,text)', 'EXECUTE'),
    'R-00g anon still executes both public readers');
  PERFORM pg_temp.r3284_assert(
    (SELECT p.prosecdef AND p.provolatile = 's'
            AND (p.proconfig = ARRAY['search_path=']::text[] OR p.proconfig = ARRAY['search_path=""']::text[])
       FROM pg_proc p WHERE p.oid = 'public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure),
    'R-00h the event bundle stays STABLE SECURITY DEFINER with search_path pinned to empty');
  PERFORM pg_temp.r3284_assert(
    (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public']::text[]
       FROM pg_proc p WHERE p.oid = 'public.pg_public_experience_by_slug(text,text)'::regprocedure),
    'R-00i the experience reader stays STABLE SECURITY DEFINER with search_path public');
END
$r00$;
ROLLBACK;

-- ─── R-01: a draft is written with no reason and no gate ───────────────────────────
BEGIN;
DO $r01$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r01');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r01', 'event', 'draft', NULL);
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('standard'), NULL);
  PERFORM pg_temp.r3284_assert((v_r->>'ok')::boolean AND (v_r->>'changed')::boolean,
    'R-01a a draft event accepts terms with no reason (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('standard'),
    'R-01b the draft row now holds the Standard terms');
  PERFORM pg_temp.r3284_assert(v_r->'refundPolicy' = pg_temp.r3284_policy('standard'),
    'R-01c the result echoes the written terms');
END
$r01$;
ROLLBACK;

-- ─── R-02: scheduled, no paid orders, Standard -> Strict with a reason ─────────────
BEGIN;
DO $r02$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r02');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r02', 'event', 'scheduled', pg_temp.r3284_policy('standard'));
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('strict'),
    'No tickets sold yet, tightening the terms');
  PERFORM pg_temp.r3284_assert((v_r->>'ok')::boolean,
    'R-02a with no paid orders a downgrade is written (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('strict'),
    'R-02b the row now holds the Strict terms');
END
$r02$;
ROLLBACK;

-- ─── R-03: one paid order, Standard -> Strict is refused ───────────────────────────
BEGIN;
DO $r03$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r03');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r03', 'event', 'scheduled', pg_temp.r3284_policy('standard'));
  PERFORM pg_temp.r3284_order(o.o_event, 5000);
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('strict'),
    'Trying to tighten terms after sales');
  PERFORM pg_temp.r3284_assert(
    (v_r->>'ok')::boolean = false AND v_r->>'reason' = 'refund_policy_downgrade_with_sales',
    'R-03a a downgrade after a paid order is refused as refund_policy_downgrade_with_sales (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert((v_r->>'affected_order_count')::int = 1,
    'R-03b the refusal names affected_order_count = 1');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('standard'),
    'R-03c the row still holds the Standard terms — nothing was written');
END
$r03$;
ROLLBACK;

-- ─── R-04: one paid order, Standard -> Flexible is written ─────────────────────────
BEGIN;
DO $r04$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r04');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r04', 'event', 'scheduled', pg_temp.r3284_policy('standard'));
  PERFORM pg_temp.r3284_order(o.o_event, 5000);
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('flexible'),
    'Making refunds more generous for guests');
  PERFORM pg_temp.r3284_assert((v_r->>'ok')::boolean,
    'R-04a a more generous change after a paid order is written (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('flexible'),
    'R-04b the row now holds the Flexible terms');
END
$r04$;
ROLLBACK;

-- ─── R-05: one paid order, NULL -> Strict is written (null counts as 0%) ───────────
BEGIN;
DO $r05$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r05');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r05', 'event', 'scheduled', NULL);
  PERFORM pg_temp.r3284_order(o.o_event, 5000);
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('strict'),
    'Publishing terms for the first time');
  PERFORM pg_temp.r3284_assert((v_r->>'ok')::boolean,
    'R-05a adding terms to an event with sales and no terms is written (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('strict'),
    'R-05b the row now holds the Strict terms');

  -- The explicit JSON null spelling reads as "no policy" too: from NULL to JSON null
  -- is not a downgrade, and the row stays SQL NULL rather than a jsonb 'null'.
  UPDATE public.events SET refund_policy = NULL WHERE id = o.o_event;
  v_r := public.business_patch_offering_refund_policy(o.o_event, 'null'::jsonb,
    'Confirming there are still no terms');
  PERFORM pg_temp.r3284_assert((v_r->>'ok')::boolean AND (v_r->>'changed')::boolean = false
      AND pg_temp.r3284_row_policy(o.o_event) IS NULL,
    'R-05c a JSON null policy is stored as SQL NULL and counts as unchanged (got ' || v_r::text || ')');
END
$r05$;
ROLLBACK;

-- ─── R-06: one paid order, Standard -> NULL is refused ─────────────────────────────
BEGIN;
DO $r06$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r06');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r06', 'event', 'scheduled', pg_temp.r3284_policy('standard'));
  PERFORM pg_temp.r3284_order(o.o_event, 5000);
  v_r := public.business_patch_offering_refund_policy(o.o_event, NULL,
    'Removing the refund terms after sales');
  PERFORM pg_temp.r3284_assert(
    (v_r->>'ok')::boolean = false AND v_r->>'reason' = 'refund_policy_downgrade_with_sales'
      AND (v_r->>'affected_order_count')::int = 1,
    'R-06a clearing terms after a paid order is refused (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('standard'),
    'R-06b the row still holds the Standard terms');

  -- The "No refunds" preset is the same downgrade in a different spelling.
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('none'),
    'Switching to no refunds after sales');
  PERFORM pg_temp.r3284_assert(v_r->>'reason' = 'refund_policy_downgrade_with_sales',
    'R-06c switching to No refunds after a paid order is refused too (got ' || v_r::text || ')');
END
$r06$;
ROLLBACK;

-- ─── R-07: only a free order, the downgrade is allowed ─────────────────────────────
BEGIN;
DO $r07$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r07');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r07', 'event', 'scheduled', pg_temp.r3284_policy('standard'));
  PERFORM pg_temp.r3284_order(o.o_event, 0);
  PERFORM pg_temp.r3284_assert(
    (SELECT count(*) FROM public.orders WHERE event_id = o.o_event AND payment_status = 'paid') = 1,
    'R-07 fixture: the event really has one paid-status order, worth 0');
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('strict'),
    'Only free guests so far, tightening terms');
  PERFORM pg_temp.r3284_assert((v_r->>'ok')::boolean,
    'R-07a a free order does not lock the terms (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('strict'),
    'R-07b the row now holds the Strict terms');
END
$r07$;
ROLLBACK;

-- ─── R-08: a trip is refused and left untouched ────────────────────────────────────
BEGIN;
DO $r08$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r08');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r08', 'trip', 'draft', pg_temp.r3284_policy('standard'));
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('strict'), NULL);
  PERFORM pg_temp.r3284_assert(
    (v_r->>'ok')::boolean = false AND v_r->>'reason' = 'offering_type_not_supported',
    'R-08a a trip is refused as offering_type_not_supported (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('standard'),
    'R-08b the trip row is untouched');
END
$r08$;
ROLLBACK;

-- ─── R-09: a cancelled event is refused ────────────────────────────────────────────
BEGIN;
DO $r09$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r09');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r09', 'event', 'cancelled', pg_temp.r3284_policy('standard'));
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('flexible'),
    'Changing terms on a cancelled event');
  PERFORM pg_temp.r3284_assert(
    (v_r->>'ok')::boolean = false AND v_r->>'reason' = 'offering_not_editable_status',
    'R-09a a cancelled event is refused as offering_not_editable_status (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('standard'),
    'R-09b the cancelled row is untouched');

  -- An unknown id is not found rather than anything more informative.
  v_r := public.business_patch_offering_refund_policy(gen_random_uuid(), NULL, NULL);
  PERFORM pg_temp.r3284_assert(v_r->>'reason' = 'offering_not_found',
    'R-09c an unknown offering id is offering_not_found (got ' || v_r::text || ')');
END
$r09$;
ROLLBACK;

-- ─── R-10: a scheduled event with a too-short reason ───────────────────────────────
BEGIN;
DO $r10$
DECLARE b record; o record; v_r jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r10');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r10', 'event', 'scheduled', pg_temp.r3284_policy('standard'));
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('flexible'), 'short');
  PERFORM pg_temp.r3284_assert(
    (v_r->>'ok')::boolean = false AND v_r->>'reason' = 'invalid_edit_reason',
    'R-10a reason "short" is refused as invalid_edit_reason (got ' || v_r::text || ')');
  v_r := public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('flexible'), '   ');
  PERFORM pg_temp.r3284_assert(v_r->>'reason' = 'missing_edit_reason',
    'R-10b a blank reason is refused as missing_edit_reason (got ' || v_r::text || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) = pg_temp.r3284_policy('standard'),
    'R-10c the row is untouched by both refusals');
END
$r10$;
ROLLBACK;

-- ─── R-11: a caller below event_manager raises ─────────────────────────────────────
BEGIN;
DO $r11$
DECLARE b record; o record; v_err text; v_stranger uuid := gen_random_uuid();
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r11');
  SELECT * INTO o FROM pg_temp.r3284_offering(b.o_brand, 'r11', 'event', 'draft', NULL);
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'issue-3284-stranger-' || v_stranger || '@example.test');
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  BEGIN
    PERFORM public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('standard'), NULL);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.r3284_assert(v_err LIKE '%insufficient_event_permission%',
    'R-11a a user with no role on the brand raises insufficient_event_permission (got '
    || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.r3284_assert(pg_temp.r3284_row_policy(o.o_event) IS NULL,
    'R-11b the row is untouched');

  -- And nobody signed in at all.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.business_patch_offering_refund_policy(o.o_event, pg_temp.r3284_policy('standard'), NULL);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.r3284_assert(v_err LIKE '%authentication_required%',
    'R-11c no signed-in caller raises authentication_required (got ' || COALESCE(v_err, 'NO ERROR') || ')');
END
$r11$;
ROLLBACK;

-- ─── R-12: the event bundle carries refundPolicy ───────────────────────────────────
BEGIN;
DO $r12$
DECLARE b record; o_set record; o_none record; v_b jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r12');
  SELECT * INTO o_set FROM pg_temp.r3284_offering(b.o_brand, 'r12-set', 'event', 'scheduled', pg_temp.r3284_policy('flexible'));
  SELECT * INTO o_none FROM pg_temp.r3284_offering(b.o_brand, 'r12-none', 'event', 'scheduled', NULL);

  v_b := public.pg_direct_event_checkout_bundle(o_set.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.r3284_assert(v_b IS NOT NULL, 'R-12 fixture: the bundle serves the public scheduled event');
  PERFORM pg_temp.r3284_assert(v_b ? 'refundPolicy', 'R-12a the bundle carries a refundPolicy key');
  PERFORM pg_temp.r3284_assert(v_b->'refundPolicy' = pg_temp.r3284_row_policy(o_set.o_event),
    'R-12b refundPolicy equals the row (got ' || COALESCE(v_b->>'refundPolicy', 'NULL') || ')');
  PERFORM pg_temp.r3284_assert(
    v_b = public.pg_direct_event_checkout_bundle(NULL, b.o_brand_slug, o_set.o_slug)::jsonb,
    'R-12c the slug read carries the identical payload, refundPolicy included');

  v_b := public.pg_direct_event_checkout_bundle(o_none.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.r3284_assert(v_b ? 'refundPolicy' AND jsonb_typeof(v_b->'refundPolicy') = 'null',
    'R-12d with no terms the key is PRESENT and JSON null — unknown is never confused with none');

  -- The anonymous caller the public page actually uses sees the same key.
  SET LOCAL ROLE anon;
  v_b := public.pg_direct_event_checkout_bundle(o_set.o_event, NULL, NULL)::jsonb;
  RESET ROLE;
  PERFORM pg_temp.r3284_assert(v_b->'refundPolicy' = pg_temp.r3284_policy('flexible'),
    'R-12e anon reads the same refundPolicy');
END
$r12$;
ROLLBACK;

-- ─── R-13: the experience reader carries refundPolicy ──────────────────────────────
BEGIN;
DO $r13$
DECLARE b record; o_set record; o_none record; v_x jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r13');
  SELECT * INTO o_set FROM pg_temp.r3284_offering(b.o_brand, 'r13-set', 'experience', 'scheduled', pg_temp.r3284_policy('strict'));
  SELECT * INTO o_none FROM pg_temp.r3284_offering(b.o_brand, 'r13-none', 'experience', 'scheduled', NULL);

  v_x := public.pg_public_experience_by_slug(b.o_brand_slug, o_set.o_slug)::jsonb;
  PERFORM pg_temp.r3284_assert(v_x IS NOT NULL, 'R-13 fixture: the reader serves the public scheduled experience');
  PERFORM pg_temp.r3284_assert(v_x ? 'refundPolicy' AND v_x->'refundPolicy' = pg_temp.r3284_policy('strict'),
    'R-13a the experience reader emits refundPolicy equal to the row (got '
    || COALESCE(v_x->>'refundPolicy', 'ABSENT') || ')');

  v_x := public.pg_public_experience_by_slug(b.o_brand_slug, o_none.o_slug)::jsonb;
  PERFORM pg_temp.r3284_assert(v_x ? 'refundPolicy' AND jsonb_typeof(v_x->'refundPolicy') = 'null',
    'R-13b with no terms the experience key is PRESENT and JSON null');
END
$r13$;
ROLLBACK;

-- ─── R-14: a live experience edit writes exactly one audit row ─────────────────────
BEGIN;
DO $r14$
DECLARE b record; x record; ev record; v_r jsonb; v_log public.experience_edit_log%ROWTYPE; v_n int;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r14');
  SELECT * INTO x FROM pg_temp.r3284_offering(b.o_brand, 'r14-exp', 'experience', 'live', pg_temp.r3284_policy('standard'));
  v_r := public.business_patch_offering_refund_policy(x.o_event, pg_temp.r3284_policy('flexible'),
    'Guests asked for more flexible refund terms');
  PERFORM pg_temp.r3284_assert((v_r->>'ok')::boolean AND (v_r->>'changed')::boolean,
    'R-14a the live experience edit is written (got ' || v_r::text || ')');

  SELECT count(*) INTO v_n FROM public.experience_edit_log WHERE event_id = x.o_event;
  PERFORM pg_temp.r3284_assert(v_n = 1, 'R-14b exactly one experience_edit_log row (got ' || v_n || ')');
  SELECT * INTO v_log FROM public.experience_edit_log WHERE event_id = x.o_event;
  PERFORM pg_temp.r3284_assert(v_log.changed_field_keys = ARRAY['refund_policy']::text[],
    'R-14c changed_field_keys = {refund_policy} (got ' || v_log.changed_field_keys::text || ')');
  PERFORM pg_temp.r3284_assert(v_log.severity = 'material' AND v_log.brand_id = b.o_brand
      AND v_log.edited_by = b.o_user AND v_log.reason = 'Guests asked for more flexible refund terms',
    'R-14d the row records material severity, the brand, the editor and the reason');
  PERFORM pg_temp.r3284_assert(
    v_log.diff_summary #> '{refund_policy,before}' = pg_temp.r3284_policy('standard')
      AND v_log.diff_summary #> '{refund_policy,after}' = pg_temp.r3284_policy('flexible'),
    'R-14e diff_summary carries before and after');

  -- Re-saving identical terms is not a change and writes no second row.
  v_r := public.business_patch_offering_refund_policy(x.o_event, pg_temp.r3284_policy('flexible'),
    'Saving the same terms again');
  SELECT count(*) INTO v_n FROM public.experience_edit_log WHERE event_id = x.o_event;
  PERFORM pg_temp.r3284_assert((v_r->>'changed')::boolean = false AND v_n = 1,
    'R-14f an unchanged save reports changed=false and writes no second row');

  -- Events have no edit-log table: an event live edit leaves experience_edit_log alone.
  SELECT * INTO ev FROM pg_temp.r3284_offering(b.o_brand, 'r14-event', 'event', 'live', pg_temp.r3284_policy('standard'));
  PERFORM public.business_patch_offering_refund_policy(ev.o_event, pg_temp.r3284_policy('flexible'),
    'Guests asked for more flexible refund terms');
  SELECT count(*) INTO v_n FROM public.experience_edit_log WHERE event_id = ev.o_event;
  PERFORM pg_temp.r3284_assert(v_n = 0, 'R-14g an event live edit writes no experience_edit_log row');

  -- A draft experience is not a live edit and writes no audit row.
  SELECT * INTO x FROM pg_temp.r3284_offering(b.o_brand, 'r14-draft', 'experience', 'draft', NULL);
  PERFORM public.business_patch_offering_refund_policy(x.o_event, pg_temp.r3284_policy('flexible'), NULL);
  SELECT count(*) INTO v_n FROM public.experience_edit_log WHERE event_id = x.o_event;
  PERFORM pg_temp.r3284_assert(v_n = 0, 'R-14h a draft experience edit writes no audit row');
END
$r14$;
ROLLBACK;

-- ─── R-15: both readers are additive only ──────────────────────────────────────────
BEGIN;
DO $r15$
DECLARE
  b record; o_set record; o_none record; x_set record;
  v_src text; v_before_src text;
  v_cte_line constant text := E'      e.refund_policy,\n';
  v_bundle_key constant text := E',\n      ''refundPolicy'', ev.refund_policy\n';
  v_exp_key constant text := E',\n      ''refundPolicy'', ex.refund_policy\n';
  v_now json; v_before json; v_expected text; v_event uuid;
BEGIN
  SELECT * INTO b FROM pg_temp.r3284_brand('r15');
  SELECT * INTO o_set FROM pg_temp.r3284_offering(b.o_brand, 'r15-set', 'event', 'scheduled', pg_temp.r3284_policy('standard'));
  SELECT * INTO o_none FROM pg_temp.r3284_offering(b.o_brand, 'r15-none', 'event', 'scheduled', NULL);
  SELECT * INTO x_set FROM pg_temp.r3284_offering(b.o_brand, 'r15-exp', 'experience', 'scheduled', pg_temp.r3284_policy('flexible'));
  -- A priced ticket so the tickets array, the all-in price and remaining capacity are
  -- part of what is compared, not an empty list.
  INSERT INTO public.ticket_types(event_id, name, price_cents, quantity_total, currency)
    VALUES (o_set.o_event, 'GA', 2500, 100, 'USD');
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_unlimited, is_free,
                                  available_online, available_in_person, display_order)
    VALUES (x_set.o_event, 'Standard', 4000, 'USD', true, false, true, false, 0);

  -- ── The event bundle ──
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.pg_direct_event_checkout_bundle(uuid,text,text)'::regprocedure;
  PERFORM pg_temp.r3284_assert(
    (length(v_src) - length(replace(v_src, v_cte_line, ''))) = length(v_cte_line)
      AND (length(v_src) - length(replace(v_src, v_bundle_key, ''))) = length(v_bundle_key),
    'R-15a the installed bundle carries each #3284 line exactly once');
  v_before_src := replace(replace(v_src, v_cte_line, ''), v_bundle_key, E'\n');
  EXECUTE format(
    'CREATE FUNCTION pg_temp.r3284_bundle_before(p_event_id uuid, p_brand_slug text, p_event_slug text) '
    'RETURNS json LANGUAGE sql STABLE SET search_path TO '''' AS %L', v_before_src);

  FOREACH v_event IN ARRAY ARRAY[o_set.o_event, o_none.o_event] LOOP
    v_now := public.pg_direct_event_checkout_bundle(v_event, NULL, NULL);
    EXECUTE 'SELECT pg_temp.r3284_bundle_before($1, NULL, NULL)' INTO v_before USING v_event;
    PERFORM pg_temp.r3284_assert(v_before IS NOT NULL AND v_now IS NOT NULL,
      'R-15b fixture: both bodies serve the event');
    PERFORM pg_temp.r3284_assert((v_now::jsonb - 'refundPolicy') = v_before::jsonb,
      'R-15c the bundle minus refundPolicy equals the pre-#3284 body, value for value');
    v_expected := left(v_before::text, length(v_before::text) - 1)
      || ', "refundPolicy" : ' || COALESCE(pg_temp.r3284_row_policy(v_event)::text, 'null') || '}';
    PERFORM pg_temp.r3284_assert(v_now::text = v_expected,
      'R-15d the bundle is the pre-#3284 text with refundPolicy appended LAST — every key keeps its order');
  END LOOP;
  PERFORM pg_temp.r3284_assert(
    jsonb_array_length(public.pg_direct_event_checkout_bundle(o_set.o_event, NULL, NULL)::jsonb -> 'tickets') = 1,
    'R-15e fixture: the compared bundle really carried a ticket');

  -- ── The experience reader ──
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.pg_public_experience_by_slug(text,text)'::regprocedure;
  PERFORM pg_temp.r3284_assert(
    (length(v_src) - length(replace(v_src, v_cte_line, ''))) = length(v_cte_line)
      AND (length(v_src) - length(replace(v_src, v_exp_key, ''))) = length(v_exp_key),
    'R-15f the installed experience reader carries each #3284 line exactly once');
  v_before_src := replace(replace(v_src, v_cte_line, ''), v_exp_key, E'\n');
  EXECUTE format(
    'CREATE FUNCTION pg_temp.r3284_experience_before(p_brand_slug text, p_experience_slug text) '
    'RETURNS json LANGUAGE sql STABLE SET search_path TO ''public'' AS %L', v_before_src);

  v_now := public.pg_public_experience_by_slug(b.o_brand_slug, x_set.o_slug);
  EXECUTE 'SELECT pg_temp.r3284_experience_before($1, $2)' INTO v_before USING b.o_brand_slug, x_set.o_slug;
  PERFORM pg_temp.r3284_assert(v_before IS NOT NULL AND v_now IS NOT NULL,
    'R-15g fixture: both experience bodies serve the experience');
  PERFORM pg_temp.r3284_assert((v_now::jsonb - 'refundPolicy') = v_before::jsonb,
    'R-15h the experience payload minus refundPolicy equals the pre-#3284 body');
  v_expected := left(v_before::text, length(v_before::text) - 1)
    || ', "refundPolicy" : ' || pg_temp.r3284_row_policy(x_set.o_event)::text || '}';
  PERFORM pg_temp.r3284_assert(v_now::text = v_expected,
    'R-15i the experience payload is the pre-#3284 text with refundPolicy appended LAST');
END
$r15$;
ROLLBACK;

SELECT 'issue_3284_offering_refund_terms: PASS' AS result;
