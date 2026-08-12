import {
  assert,
  assertEquals,
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
