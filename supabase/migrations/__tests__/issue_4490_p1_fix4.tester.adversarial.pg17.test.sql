-- Issue #4490 08-O5 fix 4 retest 2, P1-A, tester adversarial (independent angle).
-- The implementor's X-7 checks the all-zero case. This attacks the edges of the
-- restored #3645 2C guard inside #4490's re-emit of issue_3281_apply_experience_price_options:
-- AP-1 one priced option among zeros is accepted (the guard is not over-broad);
-- AP-2 an option with NO price_cents key on a paid whole price is refused (missing = 0);
-- AP-3 a refused call leaves the saved options untouched (atomic);
-- AP-4 a free whole price (total 0) with all-zero options is still accepted.
-- FAILS-ON-REVERT: delete the 2C block from the re-emit -> AP-2 (no raise).
-- Fixture copied from the implementor suite (event created by its owner).
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;


CREATE TEMP TABLE x_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON x_ids TO authenticated;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44903000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x1-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44903000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('44903000-0000-4000-9000-000000000010', '44903000-0000-4000-8000-000000000001', 'Exp 4490', 'exp-4490', 'NGN', now(), now());

SELECT public.t4490_as('44903000-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  v_day text := to_char(now() + interval '14 days', 'YYYY-MM-DD');
  v_res jsonb;
BEGIN
  v_res := public.biz_create_experience('44903000-0000-4000-9000-000000000010', jsonb_build_object(
    'title', 'Paint and Play',
    'description', 'A paint party in the garden.',
    'currency', 'NGN',
    'is_free', true,
    'pricing_mode', 'whole',
    'whole_price_cents', 0,
    'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'Africa/Lagos',
    'whenMode', 'single',
    'when', jsonb_build_object('date', v_day, 'doorsOpen', '12:00', 'endsAt', '23:59'),
    'stops', jsonb_build_array(jsonb_build_object(
      'stop_order', 0, 'place_name', 'Garden', 'ai_description', 'Where the paint happens.',
      'address', '1 Garden Rd', 'place_id', 'x4490-place-1', 'lat', 6.45, 'lng', 3.39)),
    'price_options', jsonb_build_array(
      jsonb_build_object('name', 'Solo', 'price_cents', 0, 'price_basis', 'person'),
      jsonb_build_object('name', 'Squad', 'price_cents', 0, 'price_basis', 'group', 'group_max', 150),
      jsonb_build_object('name', 'Lane hire', 'price_cents', 0, 'price_basis', 'block',
        'block_minutes', 120, 'min_blocks', 1, 'max_blocks', 3))
  ), false);
  INSERT INTO x_ids VALUES ('event', (v_res->'event'->>'id')::uuid);
END
$setup$;
SELECT public.t4490_reset();

CREATE TEMP TABLE ap_before ON COMMIT DROP AS
  SELECT id, name, price_cents, deleted_at FROM public.ticket_types
   WHERE event_id = (SELECT v FROM x_ids WHERE k = 'event');

SELECT public.t4490_expect(
  format($$SELECT public.issue_3281_apply_experience_price_options(%L, 'NGN', 'whole', 500000, NULL,
    '[{"name":"Solo","price_basis":"person"},{"name":"Pair","price_basis":"person"}]'::jsonb, false)$$, (SELECT v FROM x_ids WHERE k = 'event')),
  'P0001', 'experience_price_invalid', 'AP-2 a paid whole price whose options carry no price_cents at all is refused');

SELECT public.t4490_ok(
  (SELECT count(*) FROM public.ticket_types t JOIN ap_before b ON b.id = t.id
    WHERE t.name = b.name AND t.price_cents IS NOT DISTINCT FROM b.price_cents
      AND t.deleted_at IS NOT DISTINCT FROM b.deleted_at) = (SELECT count(*) FROM ap_before)
  AND (SELECT count(*) FROM public.ticket_types WHERE event_id = (SELECT v FROM x_ids WHERE k = 'event'))
      = (SELECT count(*) FROM ap_before),
  'AP-3 the refused call changed no saved option');

DO $ap1$
BEGIN
  PERFORM public.issue_3281_apply_experience_price_options((SELECT v FROM x_ids WHERE k = 'event'), 'NGN', 'whole', 500000, NULL,
    '[{"name":"Solo","price_cents":0,"price_basis":"person"},{"name":"Pair","price_cents":250000,"price_basis":"person"}]'::jsonb, false);
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = (SELECT v FROM x_ids WHERE k = 'event')
      AND name = 'Pair' AND price_cents = 250000 AND deleted_at IS NULL),
    'AP-1 one priced option among zero ones saves (the guard only refuses when nothing is priced)');
END
$ap1$;

DO $ap4$
BEGIN
  PERFORM public.issue_3281_apply_experience_price_options((SELECT v FROM x_ids WHERE k = 'event'), 'NGN', 'whole', 0, NULL,
    '[{"name":"Solo","price_cents":0,"price_basis":"person"},{"name":"Pair","price_cents":0,"price_basis":"person"}]'::jsonb, false);
  PERFORM public.t4490_ok(true, 'AP-4 a free whole price with all-zero options is still accepted');
END
$ap4$;

ROLLBACK;
\echo 'issue #4490 fix 4 P1-A tester adversarial: all cases passed'
