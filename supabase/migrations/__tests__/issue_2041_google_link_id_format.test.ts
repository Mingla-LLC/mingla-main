import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL("../20270402002041_issue_2041_google_link_id_format.sql", import.meta.url),
);

Deno.test("#2041 safe binding accepts exact Google hexadecimal Link IDs", () => {
  assertStringIncludes(
    migration,
    "v_measurement_id !~ '^[A-Fa-f0-9]{32}$'",
  );
  assertStringIncludes(migration, "RAISE EXCEPTION 'invalid_google_link_id'");
  assert(!migration.includes("v_measurement_id !~ '^[0-9]{4,32}$'"));
});

Deno.test("#2041 replacement preserves audited service-only safe-binding authority", () => {
  for (const invariant of [
    "SECURITY DEFINER SET search_path=''",
    "public.ad_app_binding_audit",
    "binding_version_conflict",
    "idempotency_key_conflict",
    "provider_measurement_identity_mismatch",
    "REVOKE ALL ON FUNCTION public.set_ad_app_safe_binding(jsonb) FROM PUBLIC,anon,authenticated",
    "GRANT EXECUTE ON FUNCTION public.set_ad_app_safe_binding(jsonb) TO service_role",
  ]) {
    assertStringIncludes(migration, invariant);
  }
});
