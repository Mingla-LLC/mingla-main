import {
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseRuntimeConfig, resolveRuntimeBoolean } from "./runtimeConfig.ts";
import { type SecretEnvGetter } from "./secretBundle.ts";

const baseConfig = {
  schema_version: 1,
  bunny_storage_cap_bytes: 1000,
  bunny_traffic_cap_bytes: 2000,
  event_cover_video_provider: "bunny",
  google_ads_api_version: "v24",
  meta_api_version: "v25.0",
  mingla_footer_address: "Mingla legal address",
  mingla_logo_url: "https://usemingla.com/brand/email/logo.png",
  termii_base_url: "https://v3.api.termii.com",
};

function env(values: Record<string, string>): SecretEnvGetter {
  return (name: string): string | undefined => values[name];
}

function bundled(value: unknown): string {
  return JSON.stringify({
    ...baseConfig,
    content_share_v1_create_enabled: value,
  });
}

Deno.test("issue #1808: parser keeps old bundles valid and accepts only JSON booleans", () => {
  assertStrictEquals(parseRuntimeConfig(JSON.stringify(baseConfig)).ok, true);
  assertStrictEquals(parseRuntimeConfig(bundled(true)).ok, true);
  assertStrictEquals(parseRuntimeConfig(bundled(false)).ok, true);

  for (const invalid of ["true", "TRUE", 1, 0, null, [], {}]) {
    const result = parseRuntimeConfig(bundled(invalid));
    assertEquals(result, {
      ok: false,
      reason: "wrong_type",
      field: "content_share_v1_create_enabled",
    });
  }
});

Deno.test("issue #1808: bundled boolean wins over the transition name", () => {
  assertStrictEquals(
    resolveRuntimeBoolean(
      "content_share_v1_create_enabled",
      "CONTENT_SHARE_V1_CREATE_ENABLED",
      env({
        MINGLA_RUNTIME_CONFIG_JSON: bundled(true),
        CONTENT_SHARE_V1_CREATE_ENABLED: "false",
      }),
    ),
    true,
  );
  assertStrictEquals(
    resolveRuntimeBoolean(
      "content_share_v1_create_enabled",
      "CONTENT_SHARE_V1_CREATE_ENABLED",
      env({
        MINGLA_RUNTIME_CONFIG_JSON: bundled(false),
        CONTENT_SHARE_V1_CREATE_ENABLED: "true",
      }),
    ),
    false,
  );
});

Deno.test("issue #1808: old or invalid bundles use only exact legacy true", () => {
  for (const bundle of [JSON.stringify(baseConfig), "{", ""] as const) {
    assertStrictEquals(
      resolveRuntimeBoolean(
        "content_share_v1_create_enabled",
        "CONTENT_SHARE_V1_CREATE_ENABLED",
        env({
          MINGLA_RUNTIME_CONFIG_JSON: bundle,
          CONTENT_SHARE_V1_CREATE_ENABLED: "true",
        }),
      ),
      true,
    );
  }
  for (const legacy of ["TRUE", "1", "yes", " true ", "false", ""] as const) {
    assertStrictEquals(
      resolveRuntimeBoolean(
        "content_share_v1_create_enabled",
        "CONTENT_SHARE_V1_CREATE_ENABLED",
        env({ CONTENT_SHARE_V1_CREATE_ENABLED: legacy }),
      ),
      false,
    );
  }
});

Deno.test("issue #1808: retired-name absence makes every bad state fail closed", () => {
  for (const bundle of [undefined, "{", bundled("true")] as const) {
    const values: Record<string, string> = {};
    if (bundle !== undefined) values.MINGLA_RUNTIME_CONFIG_JSON = bundle;
    assertStrictEquals(
      resolveRuntimeBoolean(
        "content_share_v1_create_enabled",
        "CONTENT_SHARE_V1_CREATE_ENABLED",
        env(values),
      ),
      false,
    );
  }
  assertThrows(
    () =>
      resolveRuntimeBoolean(
        "content_share_v1_create_enabled",
        "WRONG_DIRECT_NAME",
        env({}),
      ),
    Error,
    "runtime_config_legacy_mapping_invalid",
  );
});
