-- MINGLA-INVARIANT: I-4522-N8-EXACT | issue #4522 | Custom plan amounts under a discount scale by exact integer arithmetic (one integer division, truncating), so issue_4522_plan_v2_schedule and computeTripPlanV2Schedule return identical rows at every magnitude up to 9e15.
\set ON_ERROR_STOP on

-- issue #4522 (rework N8). The SAME inputs and expected rows as
-- packages/offering-rendering/__tests__/issue_4522_custom_discount_exact.implementor.test.ts.
-- FAILS-ON-REVERT: restore floor(c::numeric * v_t / v_t_list / c_unit) -> the
-- retester's boundary case comes back 100 minor units high on row 1 -> red.

DO $t$
DECLARE r jsonb;
BEGIN
  r := public.issue_4522_plan_v2_schedule(124981992650, 1,
    '{"v":2,"deposit":{"mode":"amount","amount_minor":515951},"count":3,"final_due_days_before_start":0,"auto_adjust":true,"custom_amounts_minor":[129724499901,199462308800]}',
    '2027-05-07T18:48:00Z', 'Asia/Kathmandu', '2026-04-13T07:28:00Z', 0, 428879, 528649633633);
  IF (SELECT jsonb_agg(jsonb_build_array((x->>'amount_minor')::bigint, (x->>'addon_portion_minor')::bigint) ORDER BY o)
        FROM jsonb_array_elements(r->'rows') WITH ORDINALITY t(x, o))
     <> '[[30669180200,142900],[47156362500,142900],[47156362878,143079]]'::jsonb THEN
    RAISE EXCEPTION 'N8 retester boundary case differs from TypeScript: %', r->'rows';
  END IF;
  r := public.issue_4522_plan_v2_schedule(8999999999999937, 1,
    '{"v":2,"deposit":{"mode":"percent","pct":33.5},"count":3,"final_due_days_before_start":0,"auto_adjust":true,"custom_amounts_minor":[1999999999999901,2000000000000099]}',
    '2027-05-07T12:00:00Z', 'UTC', '2026-04-13T12:00:00Z', 0, 0, 8999999999999999);
  IF (r->>'deposit_minor')::bigint <> 3014999999999978
     OR (SELECT jsonb_agg((x->>'amount_minor')::bigint ORDER BY o) FROM jsonb_array_elements(r->'rows') WITH ORDINALITY t(x, o))
        <> '[1999999999999800,2000000000000000,1985000000000159]'::jsonb THEN
    RAISE EXCEPTION 'N8 9e15 case differs from TypeScript: % %', r->>'deposit_minor', r->'rows';
  END IF;
  RAISE NOTICE 'PASS N8 SQL equals TypeScript at the boundary and at 9e15';
END
$t$;
