-- MINGLA-INVARIANT: I-3697-AD-READ-MODEL-GRANTS | issue #3697 | Authenticated clients can select ad configuration and reporting read models but cannot mutate them.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_relation regclass;
  v_name text;
  v_privilege text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.ad_region_config'::regclass,
    'public.ad_event_stage_summary_daily'::regclass
  ]
  LOOP
    v_name := v_relation::text;

    IF NOT has_table_privilege('authenticated', v_relation, 'SELECT') THEN
      RAISE EXCEPTION '#3697 authenticated lost SELECT on %', v_name;
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]
    LOOP
      IF has_table_privilege('authenticated', v_relation, v_privilege) THEN
        RAISE EXCEPTION '#1856 authenticated has forbidden % on %', v_privilege, v_name;
      END IF;
    END LOOP;
  END LOOP;
END
$test$;

ROLLBACK;
