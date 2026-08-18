import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  interpretOtaPolicyRow,
  isOtaUpdateMode,
  isSupportedRuntimeVersion,
  OTA_POLICY_REQUEST_HEADERS,
  silentPolicy,
} from "./appOtaPolicy.ts";

const row = (overrides: Record<string, unknown> = {}) => ({
  app_id: "explorer",
  platform: "ios",
  runtime_version: "1.1.4",
  mode: "acknowledge",
  message: "A required update is ready.",
  updated_at: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

Deno.test("#2107 an absent row is a healthy silent lane, not an outage", () => {
  const policy = interpretOtaPolicyRow(null, "explorer", "ios", "1.1.2");
  assertEquals(policy?.mode, "silent");
  assertEquals(policy?.runtimeVersion, "1.1.2");
  assertEquals(silentPolicy("business", "android", "1.1.4").mode, "silent");
});

Deno.test("#2107 a well-formed row is returned verbatim", () => {
  const policy = interpretOtaPolicyRow(row(), "explorer", "ios", "1.1.4");
  assertEquals(policy?.mode, "acknowledge");
  assertEquals(policy?.appId, "explorer");
  assertEquals(policy?.platform, "ios");
});

Deno.test("#2107 force_restart is expressible so the emergency lever exists before the emergency", () => {
  assertEquals(
    interpretOtaPolicyRow(row({ mode: "force_restart" }), "explorer", "ios", "1.1.4")
      ?.mode,
    "force_restart",
  );
  assertEquals(isOtaUpdateMode("force_restart"), true);
});

Deno.test("#2107 a malformed or mismatched row is rejected outright", () => {
  for (
    const bad of [
      row({ mode: "required" }),
      row({ mode: null }),
      row({ runtime_version: "1.1.2" }),
      row({ app_id: "business" }),
      row({ platform: "android" }),
      row({ updated_at: "not-a-date" }),
      row({ message: 7 }),
      [],
      "policy",
    ]
  ) {
    assertEquals(interpretOtaPolicyRow(bad, "explorer", "ios", "1.1.4"), null);
  }
});

Deno.test("#2107 only real semantic runtime versions are addressable", () => {
  assertEquals(isSupportedRuntimeVersion("1.1.4"), true);
  assertEquals(isSupportedRuntimeVersion("1.1"), false);
  assertEquals(isSupportedRuntimeVersion("v1.1.4"), false);
  assertEquals(isSupportedRuntimeVersion("01.1.4"), false);
  assertEquals(isSupportedRuntimeVersion(null), false);
});

Deno.test("#2107 the runtime-version header is accepted by CORS preflight", () => {
  assertStringIncludes(
    OTA_POLICY_REQUEST_HEADERS,
    "x-mingla-app-runtime-version",
  );
});
