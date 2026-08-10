\set ON_ERROR_STOP on

-- Independent tester guard: PostgreSQL NULL is neither IN nor NOT IN an
-- allowlist. Every nullable enum-like argument must therefore be rejected
-- explicitly instead of falling through to authorization or job creation.
DO $test$
DECLARE
  v_case text;
BEGIN
  FOREACH v_case IN ARRAY ARRAY['scope', 'filter', 'sort'] LOOP
    BEGIN
      PERFORM public.biz_export_brand_people(
        CASE WHEN v_case = 'scope' THEN NULL ELSE 'offering_guest_roster' END,
        '18100000-0000-4000-8000-000000000001'::uuid,
        CASE WHEN v_case = 'filter' THEN NULL ELSE 'all' END,
        NULL,
        CASE WHEN v_case = 'sort' THEN NULL ELSE 'action_priority' END,
        '{}'::jsonb,
        gen_random_uuid()
      );
      RAISE EXCEPTION 'issue_1810_null_%_accepted', v_case;
    EXCEPTION
      WHEN invalid_parameter_value THEN
        NULL;
    END;
  END LOOP;
END;
$test$;

SELECT 'issue_1810_guest_roster_export_filter_compat_tester_adversarial: PASS' AS result;
