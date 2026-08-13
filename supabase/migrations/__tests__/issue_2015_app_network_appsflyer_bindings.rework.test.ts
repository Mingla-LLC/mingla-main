import {
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../20270402002015_issue_2015_app_network_appsflyer_bindings.sql",
    import.meta.url,
  ),
);

Deno.test("#2015 rework scopes idempotency after the exact target lock", () => {
  const lockAt = sql.indexOf("provider=v_provider AND active=true FOR UPDATE");
  const replayAt = sql.indexOf(
    "SELECT * INTO v_existing_audit FROM public.ad_app_binding_audit WHERE idempotency_key=v_key",
  );
  assertMatch(sql, /expected_binding_version bigint NOT NULL/);
  assertMatch(sql, /request_fingerprint text NOT NULL/);
  if (lockAt < 0 || replayAt <= lockAt) {
    throw new Error(
      "idempotency lookup must occur after the exact target lock",
    );
  }
  assertStringIncludes(sql, "v_existing_audit.actor=v_actor");
  assertStringIncludes(sql, "v_existing_audit.app_key=v_app");
  assertStringIncludes(
    sql,
    "v_existing_audit.expected_binding_version=v_expected",
  );
  assertStringIncludes(
    sql,
    "v_existing_audit.request_fingerprint=v_fingerprint",
  );
  assertStringIncludes(sql, "EXCEPTION WHEN unique_violation THEN");
  assertStringIncludes(sql, "RAISE EXCEPTION 'idempotency_key_conflict'");
});

Deno.test("#2015 rework enforces provider identity equality and strict canary linkage", () => {
  assertStringIncludes(
    sql,
    "v_provider IN ('meta','snapchat') AND v_app_id IS DISTINCT FROM v_measurement_id",
  );
  for (
    const clause of [
      "canary.safe_evidence->>'result'='passed'",
      "canary.safe_evidence->>'store_identifier'=t.store_identifier",
      "canary.safe_evidence->>'device_os'=p_os",
      "canary.safe_evidence->>'campaign_id'=canary.safe_provider_campaign_id",
      "canary.safe_evidence->>'install_timestamp')::timestamptz>=canary.started_at",
      "canary.safe_evidence->>'install_timestamp')::timestamptz<=canary.completed_at",
      "canary.safe_evidence->>'install_timestamp')::timestamptz<canary.evidence_expires_at",
    ]
  ) assertStringIncludes(sql, clause);
  for (
    const mediaSource of [
      "facebook_int",
      "tiktokglobal_int",
      "snapchat_int",
      "googleadwords_int",
      "reddit_int",
    ]
  ) assertStringIncludes(sql, mediaSource);
});
