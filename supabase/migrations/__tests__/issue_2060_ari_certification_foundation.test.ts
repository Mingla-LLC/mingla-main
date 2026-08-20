import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270504002060_issue_2060_ari_certification_foundation.sql",
    import.meta.url,
  ),
);

Deno.test("#2060 migration records exact-release evidence and every cleanup fixture", () => {
  for (
    const table of [
      "ari_cert_runs",
      "ari_cert_evidence",
      "ari_cert_release_artifacts",
      "ari_cert_fixtures",
    ]
  ) {
    assertStringIncludes(
      migration,
      `CREATE TABLE IF NOT EXISTS public.${table}`,
    );
    assertStringIncludes(
      migration,
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    );
    assertStringIncludes(
      migration,
      `ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
    );
    assertStringIncludes(
      migration,
      `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`,
    );
  }
  assertStringIncludes(migration, "capability_id text NOT NULL");
  assertStringIncludes(migration, "requirements_digest text NOT NULL");
  assertStringIncludes(migration, "cleanup_state <> 'removed'");
  assertStringIncludes(migration, "v_capability_count <> 116");
  assertStringIncludes(migration, "v_artifact_count <> 7");
  assertStringIncludes(
    migration,
    "v_run.stranded_operation_count IS DISTINCT FROM 0",
  );
  assertStringIncludes(
    migration,
    "NULLIF(btrim(v_run.prior_compatible_pair), '') IS NULL",
  );
});

Deno.test("#2060 evidence and release artifacts are immutable", () => {
  const triggerCalls = migration.match(
    /EXECUTE FUNCTION public\.ari_cert_evidence_immutable\(\)/g,
  ) ?? [];
  assertEquals(triggerCalls.length, 4);
  assertStringIncludes(
    migration,
    "RAISE EXCEPTION 'ari_cert_evidence_is_immutable'",
  );
  assertFalse(
    migration.includes(
      "GRANT UPDATE ON TABLE public.ari_cert_evidence TO authenticated",
    ),
  );
  assertFalse(
    migration.includes(
      "GRANT DELETE ON TABLE public.ari_cert_evidence TO authenticated",
    ),
  );
});

Deno.test("#2060 migration preserves #1972 and #1985 single owners", () => {
  assertFalse(
    migration.includes("CREATE TABLE public.agent_operation_receipts"),
  );
  assertFalse(migration.includes("CREATE TABLE public.agent_task_state"));
  assertFalse(migration.includes("ALTER TABLE public.agent_messages"));
  assertStringIncludes(
    migration,
    "does NOT redefine #1985 client-turn/task state",
  );
  assertStringIncludes(migration, "or #1972 atomic operation receipts");
});

Deno.test("#2060 certification is bound to canonical inventory and server-owned evidence", () => {
  for (const required of [
    "CREATE TABLE IF NOT EXISTS public.ari_cert_capability_requirements",
    "INSERT INTO public.ari_cert_capability_requirements",
    "CREATE TABLE IF NOT EXISTS private.ari_cert_finalize_authorizations",
    "CREATE TABLE IF NOT EXISTS private.ari_cert_verified_provenance",
    "ari_cert_unverified_provenance",
    "ari_cert_terminal_status_requires_finalizer",
    "CREATE OR REPLACE FUNCTION public.ari_cert_record_evidence",
    "ari_cert_missing_matrix_evidence",
    "ari_cert_unknown_capabilities",
    "ari_cert_invalid_evidence_digest",
    "jsonb_object_keys(e.safe_evidence)",
    "extensions.digest",
    "private.ari_cert_canonical_tuple_v1",
    "private.ari_cert_digest_v1",
    "private.ari_cert_native_artifacts_valid",
    "ari_cert_invalid_native_artifacts",
  ]) assertStringIncludes(migration, required);
  assertFalse(
    migration.includes("GRANT ALL ON TABLE public.ari_cert_evidence TO service_role"),
  );
});
