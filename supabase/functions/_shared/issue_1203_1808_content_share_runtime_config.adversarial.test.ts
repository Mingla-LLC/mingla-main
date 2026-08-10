import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveRuntimeBoolean } from "./runtimeConfig.ts";
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

Deno.test("issue #1808 adversarial: valid bundled false never consults the retired authority", () => {
  const reads: string[] = [];
  const getEnv: SecretEnvGetter = (name) => {
    reads.push(name);
    if (name === "MINGLA_RUNTIME_CONFIG_JSON") {
      return JSON.stringify({
        ...baseConfig,
        content_share_v1_create_enabled: false,
      });
    }
    throw new Error(`retired_authority_read:${name}`);
  };

  assertFalse(
    resolveRuntimeBoolean(
      "content_share_v1_create_enabled",
      "CONTENT_SHARE_V1_CREATE_ENABLED",
      getEnv,
    ),
  );
  assertEquals(reads, ["MINGLA_RUNTIME_CONFIG_JSON"]);
});

Deno.test("issue #1808 adversarial: invalid bundle diagnostics are useful but value-blind", () => {
  const marker = "MUST_NOT_ESCAPE_RUNTIME_BUNDLE_VALUE";
  const bundle = JSON.stringify({
    ...baseConfig,
    schema_version: 777777,
    mingla_footer_address: marker,
  });
  const messages: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...values: unknown[]) => messages.push(values.join(" "));
  console.warn = (...values: unknown[]) => messages.push(values.join(" "));
  try {
    const enabled = resolveRuntimeBoolean(
      "content_share_v1_create_enabled",
      "CONTENT_SHARE_V1_CREATE_ENABLED",
      (name) => name === "MINGLA_RUNTIME_CONFIG_JSON" ? bundle : undefined,
    );
    assertFalse(enabled);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assertEquals(messages.length, 2);
  const diagnostic = messages.join("\n");
  assertStringIncludes(diagnostic, '"event":"secret_bundle_invalid"');
  assertStringIncludes(diagnostic, '"event":"secret_bundle_legacy_fallback"');
  assertStringIncludes(diagnostic, '"reason":"schema_version"');
  assertStringIncludes(
    diagnostic,
    '"field":"content_share_v1_create_enabled"',
  );
  assertStringIncludes(diagnostic, '"schema_version":777777');
  assert(!diagnostic.includes(marker));
  assert(!diagnostic.includes(bundle));
});
