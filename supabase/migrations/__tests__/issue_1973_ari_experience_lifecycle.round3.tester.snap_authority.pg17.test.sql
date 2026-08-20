\set ON_ERROR_STOP on

-- #1973 independent tester proof: Snap proposal identity and lifecycle fields
-- are server-owned. A mixed batch containing one otherwise-valid proposal and
-- one field-forging proposal must fail atomically; a clean retry is caller-
-- bound and persists only canonical pending-action state.
BEGIN;

INSERT INTO auth.users(id,email)
VALUES ('19730000-0000-4000-8000-000000000501','issue1973-r3-owner@example.com');

INSERT INTO public.creator_accounts(id,email,display_name)
VALUES (
  '19730000-0000-4000-8000-000000000501',
  'issue1973-r3-owner@example.com',
  'Issue 1973 round-three owner'
);

INSERT INTO public.brands(
  id,account_id,name,slug,kind,has_physical_location,default_currency
) VALUES (
  '19730000-0000-4000-8000-000000000502',
  '19730000-0000-4000-8000-000000000501',
  'Issue 1973 Snap Authority',
  'issue-1973-snap-authority',
  'physical',
  true,
  'USD'
);

SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000501',true);
SET LOCAL ROLE authenticated;

DO $tester$
BEGIN
  BEGIN
    PERFORM public.issue_1973_create_snap_proposals(
      '19730000-0000-4000-8000-000000000502',
      '[
        {"brand_id":"19730000-0000-4000-8000-000000000502","title":"Valid first proposal"},
        {
          "brand_id":"19730000-0000-4000-8000-000000000502",
          "title":"Forged second proposal",
          "user_id":"19730000-0000-4000-8000-000000000599",
          "conversation_id":"19730000-0000-4000-8000-000000000598",
          "source":"agent_chat",
          "status":"executed",
          "expires_at":"2099-01-01T00:00:00Z"
        }
      ]'::jsonb
    );
    RAISE EXCEPTION '#1973 tester accepted client-owned Snap lifecycle fields';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '#1973 tester accepted client-owned Snap lifecycle fields%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%snap_proposals_invalid%' THEN
      RAISE;
    END IF;
  END;
END;
$tester$;

RESET ROLE;

DO $tester$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE related_brand_id='19730000-0000-4000-8000-000000000502'
  ) THEN
    RAISE EXCEPTION '#1973 tester mixed invalid Snap batch was not atomic';
  END IF;
END;
$tester$;

SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000501',true);
SET LOCAL ROLE authenticated;

SELECT public.issue_1973_create_snap_proposals(
  '19730000-0000-4000-8000-000000000502',
  '[
    {"brand_id":"19730000-0000-4000-8000-000000000502","title":"Canonical proposal one"},
    {"brand_id":"19730000-0000-4000-8000-000000000502","title":"Canonical proposal two"}
  ]'::jsonb
);

RESET ROLE;

DO $tester$
BEGIN
  IF (
    SELECT count(*) FROM public.agent_pending_actions
    WHERE related_brand_id='19730000-0000-4000-8000-000000000502'
      AND user_id='19730000-0000-4000-8000-000000000501'
      AND conversation_id IS NULL
      AND source='hub_experience'
      AND tool_name='create_experience'
      AND status='pending'
      AND server_proposed_at IS NOT NULL
      AND expires_at=server_proposed_at+interval '7 days'
      AND NOT (tool_args ?| ARRAY[
        'user_id','conversation_id','source','status','expires_at'
      ])
  ) <> 2 THEN
    RAISE EXCEPTION '#1973 tester Snap retry did not preserve server-owned canonical state';
  END IF;
END;
$tester$;

ROLLBACK;
