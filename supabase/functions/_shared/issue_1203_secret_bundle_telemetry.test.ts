import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolvePaymentModeValue,
  type SecretEnvGetter,
} from "./secretBundle.ts";
import { resolveRuntimeString } from "./runtimeConfig.ts";

function env(values: Record<string, string>): SecretEnvGetter {
  return (name: string): string | undefined => values[name];
}

Deno.test("issue #1203: repeated semantic fallback emits once per isolate identity", () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    const getEnv = env({ MINGLA_STRIPE_MODE: "live" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assertEquals(
        resolvePaymentModeValue("stripe_mode", "MINGLA_STRIPE_MODE", getEnv),
        "live",
      );
    }
  } finally {
    console.warn = originalWarn;
  }

  assertEquals(warnings.length, 1);
  assertEquals(JSON.parse(warnings[0]), {
    event: "secret_bundle_legacy_fallback",
    bundle: "MINGLA_PAYMENT_MODES_JSON",
    reason: "missing",
    field: "stripe_mode",
  });
});

Deno.test("issue #1203: repeated invalid runtime bundle logs each event once and keeps fallback", () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (message?: unknown) => errors.push(String(message));
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    const getEnv = env({
      MINGLA_RUNTIME_CONFIG_JSON: '{"schema_version":2}',
      META_API_VERSION: "v24.0",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assertStrictEquals(
        resolveRuntimeString("meta_api_version", "META_API_VERSION", getEnv),
        "v24.0",
      );
    }
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }

  assertEquals(errors.length, 1);
  assertEquals(warnings.length, 1);
  assertEquals(JSON.parse(errors[0]).event, "secret_bundle_invalid");
  assertEquals(JSON.parse(warnings[0]).event, "secret_bundle_legacy_fallback");
});
