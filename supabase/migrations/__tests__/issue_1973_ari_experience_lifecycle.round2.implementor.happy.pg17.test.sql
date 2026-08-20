\set ON_ERROR_STOP on

-- #1973 round-2 implementor happy proof: this is intentionally distinct from
-- the tester-owned immutable-receipt attack. It executes the authorized Snap
-- proposal boundary, both timezone contracts, and the safe unpublish path.
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('19730000-0000-4000-8000-000000000301','issue1973-r2-owner@example.com'),
  ('19730000-0000-4000-8000-000000000302','issue1973-r2-manager@example.com'),
  ('19730000-0000-4000-8000-000000000303','issue1973-r2-outsider@example.com');

INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('19730000-0000-4000-8000-000000000301','issue1973-r2-owner@example.com','Issue 1973 r2 owner'),
  ('19730000-0000-4000-8000-000000000302','issue1973-r2-manager@example.com','Issue 1973 r2 manager'),
  ('19730000-0000-4000-8000-000000000303','issue1973-r2-outsider@example.com','Issue 1973 r2 outsider');

INSERT INTO public.brands(
  id,account_id,name,slug,kind,has_physical_location,default_currency
)
VALUES (
  '19730000-0000-4000-8000-000000000304',
  '19730000-0000-4000-8000-000000000301',
  'Issue 1973 Round Two',
  'issue-1973-round-two',
  'physical',
  true,
  'USD'
);

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES (
  '19730000-0000-4000-8000-000000000304',
  '19730000-0000-4000-8000-000000000302',
  'event_manager',
  now()
);

DO $$
BEGIN
  IF has_table_privilege('authenticated','public.agent_pending_actions','INSERT') THEN
    RAISE EXCEPTION '#1973 r2 authenticated unexpectedly has direct pending INSERT';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000302',true);
SET LOCAL ROLE authenticated;

SELECT public.issue_1973_create_snap_proposals(
  '19730000-0000-4000-8000-000000000304',
  '[
    {"brand_id":"19730000-0000-4000-8000-000000000304","title":"Snap proposal one","narrative":"First proposal"},
    {"brand_id":"19730000-0000-4000-8000-000000000304","title":"Snap proposal two","narrative":"Second proposal"}
  ]'::jsonb
);

SELECT public.business_create_experience_graph(
  '19730000-0000-4000-8000-000000000304',
  '{"title":"Unknown timezone draft","description":"Timezone intentionally unknown","currency":"USD","is_free":true}'::jsonb
);

SELECT public.business_create_experience_graph(
  '19730000-0000-4000-8000-000000000304',
  '{"title":"Known timezone draft","description":"Timezone supplied explicitly","currency":"USD","is_free":true,"timezone":"America/New_York"}'::jsonb
);

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.agent_pending_actions
      WHERE user_id='19730000-0000-4000-8000-000000000302'
        AND related_brand_id='19730000-0000-4000-8000-000000000304'
        AND source='hub_experience' AND status='pending') <> 2 THEN
    RAISE EXCEPTION '#1973 r2 server proposal batch was not atomic and caller-bound';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE user_id='19730000-0000-4000-8000-000000000302'
      AND (server_proposed_at IS NULL OR expires_at <= server_proposed_at)
  ) THEN
    RAISE EXCEPTION '#1973 r2 server did not own proposal timestamps';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.events
    WHERE title='Unknown timezone draft'
      AND (timezone IS NOT NULL OR theme#>>'{experience_meta,when_draft,timezone}' IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '#1973 r2 omitted timezone was fabricated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events
    WHERE title='Known timezone draft'
      AND timezone='America/New_York'
      AND theme#>>'{experience_meta,when_draft,timezone}'='America/New_York'
  ) THEN
    RAISE EXCEPTION '#1973 r2 explicit IANA timezone did not round-trip';
  END IF;
END;
$$;

-- An unrelated authenticated caller cannot use the server boundary.
SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000303',true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.issue_1973_create_snap_proposals(
    '19730000-0000-4000-8000-000000000304',
    '[{"brand_id":"19730000-0000-4000-8000-000000000304","title":"Must not persist"}]'::jsonb
  );
  RAISE EXCEPTION '#1973 r2 outsider unexpectedly created a proposal';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%insufficient_event_permission%' THEN RAISE; END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title='Known timezone draft';
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES (
    v_event_id,
    now()+interval '30 days',
    now()+interval '30 days 2 hours',
    'America/New_York',
    true
  );
  UPDATE public.events
  SET status='scheduled',visibility='public',published_at=now(),
      show_on_discover=true,show_in_swipeable_deck=true
  WHERE id=v_event_id;
END;
$$;

SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000302',true);
SET LOCAL ROLE authenticated;
SELECT public.business_unpublish_experience_to_draft(
  (SELECT id FROM public.events WHERE title='Known timezone draft'),
  NULL
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.title='Known timezone draft'
      AND e.status='draft' AND e.visibility='draft'
      AND e.published_at IS NULL
      AND e.show_on_discover=false
      AND e.show_in_swipeable_deck=false
      AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id=e.id)
  ) THEN
    RAISE EXCEPTION '#1973 r2 safe unpublish did not clear every public exposure';
  END IF;
END;
$$;

ROLLBACK;
