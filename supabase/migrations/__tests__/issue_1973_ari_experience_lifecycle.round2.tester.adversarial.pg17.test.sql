\set ON_ERROR_STOP on

-- #1973 round-2 tester proof: an attendance-delivery dependency is a durable
-- buyer commitment. Unpublish must leave the scheduled/public graph and both
-- exposure flags byte-for-byte intact until that dependency is absent.
BEGIN;

INSERT INTO auth.users(id,email)
VALUES ('19730000-0000-4000-8000-000000000401','issue1973-r2-tester@example.com');

INSERT INTO public.creator_accounts(id,email,display_name)
VALUES (
  '19730000-0000-4000-8000-000000000401',
  'issue1973-r2-tester@example.com',
  'Issue 1973 round-two tester'
);

INSERT INTO public.brands(
  id,account_id,name,slug,kind,has_physical_location,default_currency
) VALUES (
  '19730000-0000-4000-8000-000000000402',
  '19730000-0000-4000-8000-000000000401',
  'Issue 1973 Attendance Boundary',
  'issue-1973-attendance-boundary',
  'physical',
  true,
  'USD'
);

SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000401',true);
SET LOCAL ROLE authenticated;

SELECT public.business_create_experience_graph(
  '19730000-0000-4000-8000-000000000402',
  '{"title":"Attendance-bound experience","description":"Must stay published while delivery exists","currency":"USD","is_free":true,"timezone":"America/New_York"}'::jsonb
);

RESET ROLE;

DO $$
DECLARE v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id
  FROM public.events
  WHERE title='Attendance-bound experience';

  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES (
    v_event_id,
    now()+interval '45 days',
    now()+interval '45 days 2 hours',
    'America/New_York',
    true
  );

  UPDATE public.events
  SET status='scheduled',visibility='public',published_at=now(),
      show_on_discover=true,show_in_swipeable_deck=true
  WHERE id=v_event_id;

  INSERT INTO public.attendance_claim_deliveries(
    id,kind,source_id,event_id,status
  ) VALUES (
    '19730000-0000-4000-8000-000000000403',
    'order',
    '19730000-0000-4000-8000-000000000404',
    v_event_id,
    'pending'
  );
END;
$$;

SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000401',true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id
  FROM public.events
  WHERE title='Attendance-bound experience';

  BEGIN
    PERFORM public.business_unpublish_experience_to_draft(v_event_id,NULL);
    RAISE EXCEPTION '#1973 tester accepted an attendance-bound unpublish';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '#1973 tester accepted an attendance-bound unpublish%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%experience_has_buyer_dependencies%' THEN
      RAISE;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id=v_event_id
      AND e.status='scheduled'
      AND e.visibility='public'
      AND e.published_at IS NOT NULL
      AND e.show_on_discover=true
      AND e.show_in_swipeable_deck=true
      AND EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id=e.id)
  ) THEN
    RAISE EXCEPTION '#1973 tester denial changed the public graph';
  END IF;
END;
$$;

RESET ROLE;

DELETE FROM public.attendance_claim_deliveries
WHERE id='19730000-0000-4000-8000-000000000403';

SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000401',true);
SET LOCAL ROLE authenticated;

SELECT public.business_unpublish_experience_to_draft(
  (SELECT id FROM public.events WHERE title='Attendance-bound experience'),
  NULL
);

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.title='Attendance-bound experience'
      AND e.status='draft'
      AND e.visibility='draft'
      AND e.published_at IS NULL
      AND e.show_on_discover=false
      AND e.show_in_swipeable_deck=false
      AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id=e.id)
  ) THEN
    RAISE EXCEPTION '#1973 tester dependency-free unpublish did not clear exposure';
  END IF;
END;
$$;

ROLLBACK;
