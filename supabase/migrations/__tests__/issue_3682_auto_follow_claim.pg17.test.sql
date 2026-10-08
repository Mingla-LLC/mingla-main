-- #3682 — purchase auto-follow claim survives unfollow + replay.
-- Runs against the fully applied migration chain (migrations-apply lane).
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('36820000-0000-4000-8000-000000000001'),
  ('36820000-0000-4000-8000-000000000002');
INSERT INTO public.creator_accounts(id, email)
VALUES ('36820000-0000-4000-8000-000000000001', 'owner-3682@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES (
  '36820000-0000-4000-8000-000000000010',
  '36820000-0000-4000-8000-000000000001',
  'Auto Follow Brand',
  'issue-3682-auto-follow',
  'USD',
  now(),
  now()
);
INSERT INTO public.profiles(
  id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode
) VALUES (
  '36820000-0000-4000-8000-000000000002',
  'Buyer',
  'Follow',
  'Buyer Follow',
  'buyer-3682',
  true,
  true,
  'friends'
);
INSERT INTO public.events(id, brand_id, title, slug, status, event_type)
VALUES (
  '36820000-1000-4000-8000-000000000001',
  '36820000-0000-4000-8000-000000000010',
  'Auto follow event',
  'issue-3682-auto-follow-event',
  'scheduled',
  'event'
);
INSERT INTO public.orders(id, event_id, buyer_user_id, payment_status, source, total_cents, currency)
VALUES (
  '36820000-2000-4000-8000-000000000001',
  '36820000-1000-4000-8000-000000000001',
  '36820000-0000-4000-8000-000000000002',
  'paid',
  'online_checkout',
  1000,
  'USD'
);

-- T-01: first purchase follow lands + claim row.
SELECT public.biz_auto_follow_brand(
  '36820000-0000-4000-8000-000000000002',
  '36820000-0000-4000-8000-000000000010',
  'purchase',
  '36820000-2000-4000-8000-000000000001'
);

DO $t1$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_follows
    WHERE user_id = '36820000-0000-4000-8000-000000000002'
      AND brand_id = '36820000-0000-4000-8000-000000000010'
  ) THEN
    RAISE EXCEPTION 'issue-3682 T-01: follow row missing after first auto-follow';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_follow_auto_claims
    WHERE order_id = '36820000-2000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'issue-3682 T-01: claim row missing after first auto-follow';
  END IF;
  IF NOT (
    SELECT c.relrowsecurity
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname = 'brand_follow_auto_claims'
  ) THEN
    RAISE EXCEPTION 'issue-3682 T-01: brand_follow_auto_claims RLS is disabled';
  END IF;
END
$t1$;

-- T-02: deliberate unfollow (hard delete) then same-order replay must NOT recreate.
DELETE FROM public.brand_follows
WHERE user_id = '36820000-0000-4000-8000-000000000002'
  AND brand_id = '36820000-0000-4000-8000-000000000010';

SELECT public.biz_auto_follow_brand(
  '36820000-0000-4000-8000-000000000002',
  '36820000-0000-4000-8000-000000000010',
  'purchase',
  '36820000-2000-4000-8000-000000000001'
);

DO $t2$
DECLARE
  v_follows integer;
  v_claims integer;
BEGIN
  SELECT count(*) INTO v_follows FROM public.brand_follows
  WHERE user_id = '36820000-0000-4000-8000-000000000002'
    AND brand_id = '36820000-0000-4000-8000-000000000010';
  SELECT count(*) INTO v_claims FROM public.brand_follow_auto_claims
  WHERE order_id = '36820000-2000-4000-8000-000000000001';
  IF v_follows <> 0 THEN
    RAISE EXCEPTION 'issue-3682 T-02: unfollow undone by same-order replay (follows=%)', v_follows;
  END IF;
  IF v_claims <> 1 THEN
    RAISE EXCEPTION 'issue-3682 T-02: claim row drift after replay (claims=%)', v_claims;
  END IF;
END
$t2$;

-- T-03: purchase without order_id is rejected before any insert.
DO $t3$
DECLARE
  v_threw boolean := false;
BEGIN
  BEGIN
    PERFORM public.biz_auto_follow_brand(
      '36820000-0000-4000-8000-000000000002',
      '36820000-0000-4000-8000-000000000010',
      'purchase',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%auto_follow_order_required%' THEN
      RAISE EXCEPTION 'issue-3682 T-03: unexpected error: %', SQLERRM;
    END IF;
    v_threw := true;
  END;
  IF NOT v_threw THEN
    RAISE EXCEPTION 'issue-3682 T-03: purchase without order_id was accepted';
  END IF;
END
$t3$;

ROLLBACK;
SELECT 'issue_3682_auto_follow_claim: PASS' AS result;
