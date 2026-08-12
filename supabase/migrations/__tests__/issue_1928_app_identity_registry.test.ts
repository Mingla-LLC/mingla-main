import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270324001928_issue_1928_app_identity_registry.sql",
    import.meta.url,
  ),
);
const normalized = migration.replace(/\s+/g, " ");

Deno.test("#1928 migration creates strict typed registry and exact four canonical seeds", () => {
  assertStringIncludes(
    normalized,
    "CREATE TABLE IF NOT EXISTS public.ad_advertising_apps",
  );
  assertStringIncludes(
    normalized,
    "CHECK (app_key IN ('explorer', 'business'))",
  );
  assertStringIncludes(normalized, "UNIQUE (app_key, provider)");
  assertStringIncludes(
    normalized,
    "CONSTRAINT ad_app_provider_identity_shape CHECK",
  );
  for (
    const value of [
      "797406353459597",
      "17841477287060530",
      "1223994124127087",
      "17841422359567322",
      "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5",
      "5ee9bdcb-7520-554d-8452-b32e2f9f43ea",
      "TT_USER",
      "BC_AUTH_TT",
    ]
  ) assertStringIncludes(migration, value);
  assertEquals(
    (migration.match(/\('(?:explorer|business)', '(?:meta|tiktok)'/g) ?? [])
      .length,
    4,
  );
  assertStringIncludes(
    normalized,
    "ON CONFLICT (app_key, provider) DO UPDATE SET payer_lane = EXCLUDED.payer_lane",
  );
});

Deno.test("#1928 migration grants admin read only and service role full access", () => {
  assertEquals((migration.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 2);
  assertEquals(
    (migration.match(/FOR SELECT TO authenticated/g) ?? []).length,
    2,
  );
  assertEquals(
    (migration.match(/USING \(public\.is_admin_user\(\)\)/g) ?? []).length,
    2,
  );
  assertStringIncludes(
    migration,
    "REVOKE ALL ON public.ad_advertising_apps FROM anon, authenticated",
  );
  assertStringIncludes(
    migration,
    "GRANT ALL ON public.ad_app_provider_identities TO service_role",
  );
  assert(
    !/GRANT (INSERT|UPDATE|DELETE|ALL).* TO authenticated/.test(migration),
  );
});

Deno.test("#1928 migration stores no credentials and never mutates ad_connections", () => {
  assert(
    !/access_token|refresh_token|auth_code|secret|env_var/i.test(migration),
  );
  assert(
    !/(INSERT INTO|UPDATE|DELETE FROM) public\.ad_connections/i.test(migration),
  );
});
