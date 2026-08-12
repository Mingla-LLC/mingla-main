import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const sql = await Deno.readTextFile(
  new URL(
    "../20270324001950_issue_1950_app_download_readiness.sql",
    import.meta.url,
  ),
);

Deno.test("#1950 migration creates four targets and seeds all twenty isolated bindings", () => {
  for (
    const table of [
      "ad_app_targets",
      "ad_app_provider_bindings",
      "ad_app_readiness_runs",
      "ad_app_readiness_results",
      "ad_app_readiness_events",
    ]
  ) {
    assert(sql.includes(`CREATE TABLE IF NOT EXISTS public.${table}`));
    assert(
      sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
    );
  }
  assertEquals(
    (sql.match(/\('(?:explorer|business)','(?:ios|android)','Mingla/g) ?? [])
      .length,
    4,
  );
  assert(
    sql.includes(
      "CROSS JOIN (VALUES ('meta'),('tiktok'),('snapchat'),('google'),('reddit'))",
    ),
  );
  assert(sql.includes("UNIQUE (app_key,os,provider)"));
  assert(
    sql.includes("provider_count smallint NOT NULL CHECK (provider_count=5)"),
  );
});

Deno.test("#1950 migration keeps evidence immutable and persistence atomic/service-only", () => {
  assert(sql.includes("readiness_evidence_immutable"));
  assertEquals(
    (sql.match(/BEFORE UPDATE OR DELETE ON public\.ad_app_readiness_/g) ?? [])
      .length,
    3,
  );
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.persist_ad_app_readiness_run",
    ),
  );
  assert(sql.includes("SECURITY DEFINER SET search_path=''"));
  assert(sql.includes("jsonb_array_length(p_results)<>5"));
  assert(
    sql.includes("checked_at+interval '15 minutes'") ||
      sql.includes("v_checked+interval '15 minutes'"),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.persist_ad_app_readiness_run(jsonb,jsonb) FROM PUBLIC,anon,authenticated",
    ),
  );
});

Deno.test("#1950 authenticated users can only read registries and evidence", () => {
  assert(sql.includes("GRANT SELECT ON public.%I TO authenticated"));
  assert(
    sql.includes(
      "REVOKE ALL ON public.ad_app_readiness_events FROM anon, authenticated",
    ),
  );
  assert(
    !sql.includes(
      "GRANT INSERT ON public.ad_app_readiness_runs TO authenticated",
    ),
  );
  assert(
    !sql.includes(
      "GRANT UPDATE ON public.ad_app_readiness_results TO authenticated",
    ),
  );
});

Deno.test("#1950 persistence strips unknown evidence keys and enforces exact safe registries", () => {
  assertMatch(sql, /normalize_ad_app_readiness_evidence/);
  assertMatch(sql, /jsonb_strip_nulls\(jsonb_build_object/);
  assertMatch(
    sql,
    /provider_api','appsflyer_api','canonical_registry','dashboard_attestation/,
  );
  assertMatch(
    sql,
    /p_evidence \?& ARRAY\['status','summary','source_class','source_checked_at'\]/,
  );
  assertMatch(
    sql,
    /r - ARRAY\['provider','reason_code','payer','identity','binding','measurement','funding'\]/,
  );
  assertMatch(
    sql,
    /target_missing_or_inactive'.*binding_missing'.*payer_missing/s,
  );
  assertMatch(sql, /regexp_replace\(v_safe_url,'\[\?#\]\.\*\$',''\)/);
});

Deno.test("#1950 current attestations have exact provenance, fifteen-minute expiry, and a service-only writer", () => {
  assertStringIncludes(
    sql,
    "native_binding_attestation_expires_at=native_binding_attested_at+interval '15 minutes'",
  );
  assertStringIncludes(
    sql,
    "native_binding_attestation_safe_id=provider_app_id",
  );
  assertStringIncludes(
    sql,
    "measurement_attestation_safe_id=provider_measurement_id",
  );
  assertStringIncludes(
    sql,
    "native_binding_attestation_provenance='provider_dashboard'",
  );
  assertStringIncludes(
    sql,
    "measurement_attestation_provenance='appsflyer_dashboard'",
  );
  assertStringIncludes(
    sql,
    "CREATE OR REPLACE FUNCTION public.attest_ad_app_readiness_dimension",
  );
  assertStringIncludes(
    sql,
    "REVOKE ALL ON FUNCTION public.attest_ad_app_readiness_dimension(text,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated",
  );
  assertStringIncludes(
    sql,
    "GRANT EXECUTE ON FUNCTION public.attest_ad_app_readiness_dimension(text,text,text,text,text,uuid) TO service_role",
  );
  assertStringIncludes(
    sql,
    "JOIN public.admin_users au ON lower(au.email)=lower(u.email)",
  );
  assertStringIncludes(sql, "au.status='active'");
  assertStringIncludes(sql, "au.role IN ('owner','admin')");
  assertEquals(
    sql.includes("SELECT 1 FROM auth.users WHERE id=p_attested_by"),
    false,
  );
});
