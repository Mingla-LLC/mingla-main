import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../20270402002015_issue_2015_app_network_appsflyer_bindings.sql",
    import.meta.url,
  ),
);

Deno.test("#2015 schema owns exact provider contracts, measurement, canary, and immutable audit state", () => {
  assertStringIncludes(
    sql,
    "provider_contract_kind IN ('mobile_asset','app_link','campaign_store_binding')",
  );
  assertStringIncludes(
    sql,
    "provider='google' AND provider_contract_kind='app_link'",
  );
  assertStringIncludes(
    sql,
    "provider='reddit' AND provider_contract_kind='campaign_store_binding'",
  );
  for (
    const table of [
      "ad_app_measurement_configurations",
      "ad_app_acquisition_canaries",
      "ad_app_binding_audit",
    ]
  ) {
    assertStringIncludes(sql, `CREATE TABLE public.${table}`);
    assertStringIncludes(
      sql,
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    );
  }
  assertStringIncludes(
    sql,
    "BEFORE UPDATE OR DELETE ON public.ad_app_binding_audit",
  );
  assertStringIncludes(
    sql,
    "public.is_safe_ad_app_canary_evidence(safe_evidence)",
  );
  assertStringIncludes(sql, "(p_evidence - ARRAY[");
  for (
    const forbidden of [
      "appsflyer_uid",
      "advertising_id",
      "ip_address",
      "email",
    ]
  ) {
    assertEquals(sql.includes(`'${forbidden}'`), false);
  }
});

Deno.test("#2015 safe-binding writer is service-only, optimistic, idempotent, audited, and invalidates dependent proof", () => {
  assertStringIncludes(
    sql,
    "CREATE OR REPLACE FUNCTION public.set_ad_app_safe_binding(p_change jsonb)",
  );
  assertStringIncludes(sql, "SECURITY DEFINER SET search_path=''");
  assertStringIncludes(sql, "v_row.binding_version<>v_expected");
  assertStringIncludes(sql, "WHERE idempotency_key=v_key");
  assertStringIncludes(sql, "'safe_binding_replaced'");
  assertStringIncludes(sql, "readiness_invalidated_at=clock_timestamp()");
  assertStringIncludes(sql, "native_binding_attested_at=NULL");
  assertStringIncludes(sql, "measurement_attested_at=NULL");
  assertStringIncludes(sql, "status='not_started'");
  assertStringIncludes(
    sql,
    "REVOKE ALL ON FUNCTION public.set_ad_app_safe_binding(jsonb) FROM PUBLIC,anon,authenticated",
  );
  assertStringIncludes(
    sql,
    "GRANT EXECUTE ON FUNCTION public.set_ad_app_safe_binding(jsonb) TO service_role",
  );
  assertMatch(sql, /p_change - ARRAY\[[^\]]*'idempotency_key'[^\]]*\]/s);
});

Deno.test("#2015 native campaign authority is default OFF and independently requires fresh exact readiness plus a paused passed canary", () => {
  assertStringIncludes(
    sql,
    "VALUES ('enable_native_app_campaign_creation','false'::jsonb)",
  );
  assertEquals(
    sql.includes(
      "VALUES ('enable_native_app_campaign_creation','true'::jsonb)",
    ),
    false,
  );
  assertStringIncludes(
    sql,
    "CREATE OR REPLACE FUNCTION public.can_create_native_app_campaign",
  );
  assertStringIncludes(sql, "latest.checked_at>b.readiness_invalidated_at");
  assertStringIncludes(sql, "latest.stale_at>clock_timestamp()");
  assertStringIncludes(sql, "result.verdict='ready'");
  assertStringIncludes(sql, "canary.status='passed'");
  assertStringIncludes(sql, "canary.paused_at IS NOT NULL");
  assertStringIncludes(sql, "canary.evidence_expires_at>clock_timestamp()");
  assertStringIncludes(
    sql,
    "REVOKE ALL ON FUNCTION public.can_create_native_app_campaign(text,text,text) FROM PUBLIC,anon,authenticated",
  );
});
