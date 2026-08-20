-- [TEST-MOD-APPROVED #2060]
-- Independent UTF-8/canonical-boundary attack. This is intentionally distinct
-- from the implementor's ASCII kind-segment revert proof: composed/decomposed
-- Unicode, astral code points, embedded tab/newline/delimiters, NULL and empty
-- values must hash byte-for-byte with Node, and every field must remain bound.
BEGIN;

DO $test$
DECLARE
  v_kind constant text := 'unicode-🧪';
  v_values text[] := ARRAY[
    'é', U&'e\0301', '🙂', E'line\nbreak', E'tab\tbyte', 'a:b|c', NULL, ''
  ];
  v_expected constant text := '66c54dfc26d80f3404087af0311329800b786ce6fc659a98839998b536f4b182';
  v_actual text;
  v_changed text[];
  v_index integer;
BEGIN
  v_actual := private.ari_cert_digest_v1(v_kind, v_values);
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'issue_2060_unicode_node_pg_digest_mismatch: expected=%, actual=%',
      v_expected, v_actual;
  END IF;
  IF private.ari_cert_digest_v1(v_kind || '-changed', v_values) = v_actual THEN
    RAISE EXCEPTION 'issue_2060_unicode_kind_not_bound';
  END IF;

  FOR v_index IN 1..cardinality(v_values) LOOP
    v_changed := v_values;
    v_changed[v_index] := coalesce(v_values[v_index], 'not-null') || 'Δ';
    IF private.ari_cert_digest_v1(v_kind, v_changed) = v_actual THEN
      RAISE EXCEPTION 'issue_2060_unicode_value_not_bound:%', v_index;
    END IF;
  END LOOP;
END;
$test$;

DO $test$
DECLARE
  v_valid constant jsonb := '[
    {"surface":"business_ios_simulator","artifact_id":"ios-sim-1","runtime_version":"1.1.3","device":"Owned iOS simulator"},
    {"surface":"business_ios_physical","artifact_id":"ios-device-1","runtime_version":"1.1.3","device":"Owned physical iPhone"},
    {"surface":"business_android","artifact_id":"android-1","runtime_version":"1.1.3","device":"Owned Android emulator"}
  ]'::jsonb;
  v_attack jsonb;
  v_run_id uuid;
  v_begin_rejected boolean;
  v_finalize_rejected boolean;
BEGIN
  FOREACH v_attack IN ARRAY ARRAY[
    '[]'::jsonb,
    '{}'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"ios-sim-1","runtime_version":"1.1.3","device":"x"}]'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"ios-sim-1","runtime_version":"1.1.3","device":"x"},{"surface":"business_ios_simulator","artifact_id":"ios-sim-2","runtime_version":"1.1.3","device":"x"},{"surface":"business_android","artifact_id":"android-1","runtime_version":"1.1.3","device":"x"}]'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"ios-sim-1","runtime_version":"1.1.3","device":"x"},{"surface":"business_ios_physical","artifact_id":"ios-device-1","runtime_version":"1.1.3","device":"x"},{"surface":"business_web","artifact_id":"web-1","runtime_version":"1.1.3","device":"x"}]'::jsonb
  ] LOOP
    v_begin_rejected := false;
    SET LOCAL ROLE service_role;
    BEGIN
      PERFORM public.ari_cert_begin_run(
        repeat('a', 40),
        '{"agent_chat":"v500","agent_confirm_action":"v501"}'::jsonb,
        'business-web-1', v_attack, '{}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      v_begin_rejected := true;
    END;
    RESET ROLE;
    IF NOT v_begin_rejected THEN
      RAISE EXCEPTION 'issue_2060_invalid_native_begin_accepted:%', v_attack;
    END IF;
  END LOOP;

  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(
    repeat('a', 40),
    '{"agent_chat":"v500","agent_confirm_action":"v501"}'::jsonb,
    'business-web-1', v_valid, '{}'::jsonb
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_simulator', 'ios-sim-1', repeat('a', 40), repeat('b', 64)
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_physical', 'ios-device-1', repeat('a', 40), repeat('b', 64)
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_android', 'android-1', repeat('a', 40), repeat('b', 64)
  );
  RESET ROLE;

  FOREACH v_attack IN ARRAY ARRAY[
    '[]'::jsonb,
    '{}'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"ios-sim-1","runtime_version":"1.1.3","device":"x"}]'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"ios-sim-1","runtime_version":"1.1.3","device":"x"},{"surface":"business_ios_simulator","artifact_id":"ios-sim-2","runtime_version":"1.1.3","device":"x"},{"surface":"business_android","artifact_id":"android-1","runtime_version":"1.1.3","device":"x"}]'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"ios-sim-1","runtime_version":"1.1.3","device":"x"},{"surface":"business_ios_physical","artifact_id":"ios-device-1","runtime_version":"1.1.3","device":"x"},{"surface":"business_web","artifact_id":"web-1","runtime_version":"1.1.3","device":"x"}]'::jsonb
  ] LOOP
    v_finalize_rejected := false;
    BEGIN
      UPDATE public.ari_cert_runs SET native_artifacts = v_attack WHERE id = v_run_id;
      PERFORM public.ari_cert_finalize_run(v_run_id);
    EXCEPTION WHEN OTHERS THEN
      v_finalize_rejected := true;
    END;
    IF NOT v_finalize_rejected THEN
      RAISE EXCEPTION 'issue_2060_invalid_native_finalize_accepted:%', v_attack;
    END IF;
  END LOOP;
END;
$test$;

ROLLBACK;
