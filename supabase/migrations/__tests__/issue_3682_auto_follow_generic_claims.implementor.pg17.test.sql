-- #3682 closeout — generic (source_kind, source_id) auto-follow claims for
-- standalone RSVPs and venue bookings; order claims unchanged; unfollow
-- survives replay for every kind. Runs on the fully applied migration chain.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('36829000-0000-4000-8000-000000000001'),
  ('36829000-0000-4000-8000-000000000002'),
  ('36829000-0000-4000-8000-000000000003');
INSERT INTO public.creator_accounts(id, email)
VALUES ('36829000-0000-4000-8000-000000000001', 'owner-3682g@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES
  ('36829000-0000-4000-8000-000000000010', '36829000-0000-4000-8000-000000000001',
   'Generic Claim Brand', 'issue-3682-generic-claim', 'USD', now(), now()),
  ('36829000-0000-4000-8000-000000000011', '36829000-0000-4000-8000-000000000001',
   'Other Brand', 'issue-3682-generic-claim-other', 'USD', now(), now());
INSERT INTO public.profiles(
  id, first_name, last_name, display_name, username, active,
  has_completed_onboarding, visibility_mode
) VALUES
  ('36829000-0000-4000-8000-000000000002', 'Rsvp', 'Guest', 'Rsvp Guest',
   'rsvp-3682g', true, true, 'friends'),
  ('36829000-0000-4000-8000-000000000003', 'Book', 'Guest', 'Book Guest',
   'book-3682g', true, true, 'friends');
INSERT INTO public.events(id, brand_id, title, slug, status, event_type)
VALUES ('36829000-1000-4000-8000-000000000001', '36829000-0000-4000-8000-000000000010',
        'Generic claim RSVP', 'issue-3682-generic-claim-rsvp', 'scheduled', 'rsvp');
INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, rsvp_status)
VALUES ('36829000-3000-4000-8000-000000000001', '36829000-1000-4000-8000-000000000001',
        '36829000-0000-4000-8000-000000000002', 'Rsvp Guest', 'going');

-- Reservation fixture: venue graph is irrelevant here, so FK/trigger checks are
-- skipped for this one insert only.
SET LOCAL session_replication_role = replica;
INSERT INTO public.reservations(
  id, brand_id, venue_id, reserved_for, party_size, status, source,
  created_via, consumer_user_id
) VALUES (
  '36829000-4000-4000-8000-000000000001', '36829000-0000-4000-8000-000000000010',
  '36829000-5000-4000-8000-000000000001', now() + interval '2 days', 2,
  'confirmed', 'mingla', 'consumer', '36829000-0000-4000-8000-000000000003'
);
SET LOCAL session_replication_role = origin;

-- G-01: RSVP auto-follow claims (rsvp, rsvpId) and follows.
SELECT public.biz_auto_follow_brand(
  '36829000-0000-4000-8000-000000000002', '36829000-0000-4000-8000-000000000010',
  'rsvp', NULL, 'rsvp', '36829000-3000-4000-8000-000000000001');

DO $g1$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brand_follows
    WHERE user_id = '36829000-0000-4000-8000-000000000002'
      AND brand_id = '36829000-0000-4000-8000-000000000010' AND source = 'rsvp') THEN
    RAISE EXCEPTION 'issue-3682 G-01: rsvp follow missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_follow_auto_claims
    WHERE source_kind = 'rsvp' AND source_id = '36829000-3000-4000-8000-000000000001'
      AND order_id IS NULL) THEN
    RAISE EXCEPTION 'issue-3682 G-01: rsvp claim missing';
  END IF;
END
$g1$;

-- G-02: unfollow, then replay the RSVP → stays unfollowed.
DELETE FROM public.brand_follows
WHERE user_id = '36829000-0000-4000-8000-000000000002'
  AND brand_id = '36829000-0000-4000-8000-000000000010';
DO $g2$
DECLARE v jsonb;
BEGIN
  v := public.biz_auto_follow_brand(
    '36829000-0000-4000-8000-000000000002', '36829000-0000-4000-8000-000000000010',
    'rsvp', NULL, 'rsvp', '36829000-3000-4000-8000-000000000001');
  IF v->>'skipped' IS DISTINCT FROM 'already_claimed' THEN
    RAISE EXCEPTION 'issue-3682 G-02: replay not skipped: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_follows
    WHERE user_id = '36829000-0000-4000-8000-000000000002'
      AND brand_id = '36829000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'issue-3682 G-02: unfollow undone by RSVP replay';
  END IF;
END
$g2$;

-- G-03: booking auto-follow claims (reservation, id), replay is a no-op.
DO $g3$
DECLARE v jsonb; v_claims int;
BEGIN
  v := public.biz_auto_follow_brand(
    '36829000-0000-4000-8000-000000000003', '36829000-0000-4000-8000-000000000010',
    'booking', NULL, 'reservation', '36829000-4000-4000-8000-000000000001');
  IF (v->>'followed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue-3682 G-03: booking follow failed: %', v;
  END IF;
  v := public.biz_auto_follow_brand(
    '36829000-0000-4000-8000-000000000003', '36829000-0000-4000-8000-000000000010',
    'booking', NULL, 'reservation', '36829000-4000-4000-8000-000000000001');
  SELECT count(*) INTO v_claims FROM public.brand_follow_auto_claims
  WHERE source_kind = 'reservation' AND source_id = '36829000-4000-4000-8000-000000000001';
  IF v_claims <> 1 OR v->>'skipped' IS DISTINCT FROM 'already_claimed' THEN
    RAISE EXCEPTION 'issue-3682 G-03: reservation replay drift (claims=%, v=%)', v_claims, v;
  END IF;
END
$g3$;

-- G-04: a claim key that does not belong to this person/brand is refused.
DO $g4$
BEGIN
  BEGIN
    PERFORM public.biz_auto_follow_brand(
      '36829000-0000-4000-8000-000000000002', '36829000-0000-4000-8000-000000000011',
      'booking', NULL, 'reservation', '36829000-4000-4000-8000-000000000001');
    RAISE EXCEPTION 'issue-3682 G-04: mismatched reservation accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%auto_follow_source_mismatch%' THEN
      RAISE EXCEPTION 'issue-3682 G-04: unexpected error %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.biz_auto_follow_brand(
      '36829000-0000-4000-8000-000000000002', '36829000-0000-4000-8000-000000000010',
      'rsvp', NULL, 'bogus', '36829000-3000-4000-8000-000000000001');
    RAISE EXCEPTION 'issue-3682 G-04: bogus source_kind accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%auto_follow_source_kind_invalid%' THEN
      RAISE EXCEPTION 'issue-3682 G-04: unexpected error %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.biz_auto_follow_brand(
      '36829000-0000-4000-8000-000000000002', '36829000-0000-4000-8000-000000000010',
      'rsvp', NULL, NULL, NULL);
    RAISE EXCEPTION 'issue-3682 G-04: rsvp without claim key accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%auto_follow_order_required%' THEN
      RAISE EXCEPTION 'issue-3682 G-04: unexpected error %', SQLERRM;
    END IF;
  END;
END
$g4$;

-- G-05: shape + grants. Old 4-arg signature gone; one function; service_role
-- only; SECURITY DEFINER; replay-safe unique key exists.
DO $g5$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'biz_auto_follow_brand') <> 1 THEN
    RAISE EXCEPTION 'issue-3682 G-05: expected exactly one biz_auto_follow_brand';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid =
      'public.biz_auto_follow_brand(uuid,uuid,text,uuid,text,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'issue-3682 G-05: not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon',
       'public.biz_auto_follow_brand(uuid,uuid,text,uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.biz_auto_follow_brand(uuid,uuid,text,uuid,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.biz_auto_follow_brand(uuid,uuid,text,uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3682 G-05: grants drifted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'brand_follow_auto_claims_source_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'issue-3682 G-05: replay-safe unique key missing';
  END IF;
END
$g5$;

-- G-06: #4111 subscribe callers (positional 4 args, no claim) still work.
DO $g6$
DECLARE v jsonb;
BEGIN
  v := public.biz_auto_follow_brand(
    '36829000-0000-4000-8000-000000000002', '36829000-0000-4000-8000-000000000011',
    'web_subscribe', NULL);
  IF (v->>'followed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue-3682 G-06: web_subscribe follow failed: %', v;
  END IF;
END
$g6$;

ROLLBACK;
SELECT 'issue_3682_auto_follow_generic_claims: PASS' AS result;
