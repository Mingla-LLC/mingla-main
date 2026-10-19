// #2107 B4 — the server half of "the kill switch is ON by default".
//
// I-2107-OTA-ABSENT-ROW-MARKER (machine-readable invariant, enforced here and by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs):
//   an absent app_ota_policies row is served as mode `silent` with updatedAt
//   exactly ABSENT_POLICY_ROW_UPDATED_AT, and NO real row may carry that
//   timestamp. Redesigned clients read that marker as "no row => enforce
//   critical updates"; a real `silent` row is the only off switch.
//
// FAILS ON REVERT: changing the absent-row timestamp, or letting a real row
// echo it, breaks the assertions below.

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ABSENT_POLICY_ROW_UPDATED_AT,
  interpretOtaPolicyRow,
  silentPolicy,
} from "./appOtaPolicy.ts";

Deno.test("#2107 B4 happy — an absent row carries the exact client-visible marker", () => {
  assertEquals(ABSENT_POLICY_ROW_UPDATED_AT, "1970-01-01T00:00:00.000Z");
  for (const runtime of ["1.1.6", "1.1.7", "2.0.0"]) {
    const policy = interpretOtaPolicyRow(null, "explorer", "ios", runtime);
    assertEquals(policy?.mode, "silent");
    assertEquals(policy?.updatedAt, ABSENT_POLICY_ROW_UPDATED_AT);
    assertEquals(policy?.runtimeVersion, runtime);
  }
  assertEquals(
    silentPolicy("business", "android", "1.1.6").updatedAt,
    ABSENT_POLICY_ROW_UPDATED_AT,
  );
});

Deno.test("#2107 B4 adversarial — a real silent row (the off switch) never looks like an absent row", () => {
  const policy = interpretOtaPolicyRow(
    {
      app_id: "business",
      platform: "ios",
      runtime_version: "1.1.6",
      mode: "silent",
      message: "",
      updated_at: "2026-10-19T12:00:00.000Z",
    },
    "business",
    "ios",
    "1.1.6",
  );
  assertEquals(policy?.mode, "silent");
  assertNotEquals(policy?.updatedAt, ABSENT_POLICY_ROW_UPDATED_AT);
});

Deno.test("#2107 B4 adversarial — a real row stamped with the marker is refused, not passed off as absent", () => {
  for (const stamp of ["1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00+00:00"]) {
    assertEquals(
      interpretOtaPolicyRow(
        {
          app_id: "explorer",
          platform: "ios",
          runtime_version: "1.1.6",
          mode: "silent",
          message: "",
          updated_at: stamp,
        },
        "explorer",
        "ios",
        "1.1.6",
      ),
      null,
    );
  }
});

Deno.test("#2107 B4 adversarial — the response shape every shipped client validates is unchanged", () => {
  const policy = interpretOtaPolicyRow(null, "explorer", "android", "1.1.6");
  assertEquals(
    Object.keys(policy ?? {}).sort(),
    ["appId", "message", "mode", "platform", "runtimeVersion", "updatedAt"],
  );
});
