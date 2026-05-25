// ORCH-0953 §8 — Tester-written adversarial regression test (per ORCH-0840 Step 0.5 gate).
// Attacks different angles than the implementor's happy-path nativePaidRegionGate.test.ts:
// case-sensitivity, whitespace handling, malformed env strings, null/undefined country inputs.

import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  getNativePaidAllowedRegions,
  isNativePaidAllowedForBrand,
} from "../../_shared/stripeTax.ts";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prior = Deno.env.get("NATIVE_PAID_ALLOWED_REGIONS");
  try {
    if (value === undefined) Deno.env.delete("NATIVE_PAID_ALLOWED_REGIONS");
    else Deno.env.set("NATIVE_PAID_ALLOWED_REGIONS", value);
    return fn();
  } finally {
    if (prior === undefined) Deno.env.delete("NATIVE_PAID_ALLOWED_REGIONS");
    else Deno.env.set("NATIVE_PAID_ALLOWED_REGIONS", prior);
  }
}

Deno.test("ORCH-0953 §8 adversarial — lowercase 'us' in env still admits 'US' brand (helper uppercases)", () => {
  withEnv("us,gb", () => {
    assertEquals(isNativePaidAllowedForBrand("US"), true);
    assertEquals(isNativePaidAllowedForBrand("GB"), true);
  });
});

Deno.test("ORCH-0953 §8 adversarial — mixed-case brand country still matches uppercase env entry", () => {
  withEnv("US", () => {
    assertEquals(isNativePaidAllowedForBrand("us"), true);
    assertEquals(isNativePaidAllowedForBrand("Us"), true);
    assertEquals(isNativePaidAllowedForBrand("uS"), true);
  });
});

Deno.test("ORCH-0953 §8 adversarial — whitespace in env entries does not produce false negatives", () => {
  withEnv(" US , GB , BE ", () => {
    assertEquals(isNativePaidAllowedForBrand("US"), true);
    assertEquals(isNativePaidAllowedForBrand("GB"), true);
    assertEquals(isNativePaidAllowedForBrand("BE"), true);
    assertEquals(isNativePaidAllowedForBrand("FR"), false);
  });
});

Deno.test("ORCH-0953 §8 adversarial — comma-only env is treated as empty allowlist", () => {
  withEnv(",,,", () => {
    assertEquals(getNativePaidAllowedRegions(), []);
    assertEquals(isNativePaidAllowedForBrand("US"), false);
  });
});

Deno.test("ORCH-0953 §8 adversarial — null brand country is blocked", () => {
  withEnv("US,GB", () => {
    assertEquals(isNativePaidAllowedForBrand(null), false);
  });
});

Deno.test("ORCH-0953 §8 adversarial — undefined brand country is blocked", () => {
  withEnv("US,GB", () => {
    assertEquals(isNativePaidAllowedForBrand(undefined), false);
  });
});

Deno.test("ORCH-0953 §8 adversarial — empty-string brand country is blocked", () => {
  withEnv("US,GB", () => {
    assertEquals(isNativePaidAllowedForBrand(""), false);
  });
});

Deno.test("ORCH-0953 §8 adversarial — whitespace-only brand country is blocked", () => {
  withEnv("US,GB", () => {
    assertEquals(isNativePaidAllowedForBrand("   "), false);
  });
});

Deno.test("ORCH-0953 §8 adversarial — partial-match country code (US vs USA) does not leak through", () => {
  withEnv("US", () => {
    assertEquals(isNativePaidAllowedForBrand("USA"), false);
    assertEquals(isNativePaidAllowedForBrand("U"), false);
  });
});
