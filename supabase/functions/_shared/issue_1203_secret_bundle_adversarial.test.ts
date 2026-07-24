import {
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveDeliveryFlagValue,
  resolvePaymentModeValue,
  type SecretEnvGetter,
} from "./secretBundle.ts";
import { resolveRuntimeString } from "./runtimeConfig.ts";

function env(values: Record<string, string>): SecretEnvGetter {
  return (name: string): string | undefined => values[name];
}

Deno.test("issue #1203 ADV: wrong-version diagnostics preserve the parseable version without leaking input", () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (message?: unknown) => errors.push(String(message));
  console.warn = (message?: unknown) => warnings.push(String(message));
  let resolved: string | undefined;
  try {
    resolved = resolvePaymentModeValue(
      "paystack_mode",
      "PAYSTACK_MODE",
      env({
        MINGLA_PAYMENT_MODES_JSON: JSON.stringify({
          schema_version: 7,
          stripe_mode: "live",
          paystack_mode: "test",
          synthetic_marker: "SYNTHETIC_SECRET_CANARY_1203",
        }),
        PAYSTACK_MODE: "live",
      }),
    );
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assertEquals(resolved, "live");
  assertEquals(errors.length, 1);
  assertEquals(warnings.length, 1);
  assertEquals(JSON.parse(errors[0]), {
    event: "secret_bundle_invalid",
    bundle: "MINGLA_PAYMENT_MODES_JSON",
    reason: "schema_version",
    schema_version: 7,
  });
  assertStrictEquals(
    [...errors, ...warnings].some((line) =>
      line.includes("SYNTHETIC_SECRET_CANARY_1203")
    ),
    false,
  );
});

Deno.test("issue #1203 ADV: all eight delivery-switch combinations remain independent", () => {
  for (const marketing of [false, true]) {
    for (const ng of [false, true]) {
      for (const us of [false, true]) {
        const getEnv = env({
          MINGLA_DELIVERY_FLAGS_JSON: JSON.stringify({
            schema_version: 1,
            marketing_send_live_enabled: marketing,
            sms_live_enabled: { ng, us },
          }),
        });
        assertStrictEquals(
          resolveDeliveryFlagValue(
            "marketing_send_live_enabled",
            "MARKETING_SEND_LIVE_ENABLED",
            getEnv,
          ),
          marketing,
        );
        assertStrictEquals(
          resolveDeliveryFlagValue(
            "sms_live_enabled.ng",
            "SMS_LIVE_ENABLED_NG",
            getEnv,
          ),
          ng,
        );
        assertStrictEquals(
          resolveDeliveryFlagValue(
            "sms_live_enabled.us",
            "SMS_LIVE_ENABLED_US",
            getEnv,
          ),
          us,
        );
      }
    }
  }
});

Deno.test("issue #1203 ADV: B-5 rejects field smuggling, redacts the canary, and fabricates no fallback", () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (message?: unknown) => errors.push(String(message));
  console.warn = (message?: unknown) => warnings.push(String(message));
  let resolved: string | undefined;
  try {
    resolved = resolveRuntimeString(
      "google_ads_api_version",
      "GOOGLE_ADS_API_VERSION",
      env({
        MINGLA_RUNTIME_CONFIG_JSON: JSON.stringify({
          schema_version: 1,
          bunny_storage_cap_bytes: 1000,
          bunny_traffic_cap_bytes: 2000,
          event_cover_video_provider: "bunny",
          google_ads_api_version: "v24",
          meta_api_version: "v25.0",
          mingla_footer_address: "Mingla legal address",
          mingla_logo_url:
            "https://usemingla.com/brand/email/mingla-wordmark-email.png",
          termii_base_url: "https://v3.api.termii.com",
          api_key: "SYNTHETIC_SECRET_CANARY_1203",
        }),
      }),
    );
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assertEquals(resolved, undefined);
  assertEquals(JSON.parse(errors[0]).reason, "unknown_field");
  assertEquals(JSON.parse(warnings[0]).reason, "unknown_field");
  assertStrictEquals(
    [...errors, ...warnings].some((line) =>
      line.includes("SYNTHETIC_SECRET_CANARY_1203")
    ),
    false,
  );
});

Deno.test("issue #1203 ADV: callers cannot redirect a field to another legacy name", () => {
  assertThrows(
    () =>
      resolvePaymentModeValue(
        "stripe_mode",
        "PAYSTACK_MODE",
        env({ PAYSTACK_MODE: "test" }),
      ),
    Error,
    "secret_bundle_legacy_mapping_invalid:stripe_mode",
  );
  assertThrows(
    () =>
      resolveRuntimeString(
        "meta_api_version",
        "GOOGLE_ADS_API_VERSION",
        env({ GOOGLE_ADS_API_VERSION: "v24" }),
      ),
    Error,
    "runtime_config_legacy_mapping_invalid:meta_api_version",
  );
});
