/**
 * ORCH-1056 — unit tests for the unified Stripe mode helper.
 *
 * Validates:
 *   - resolveStripeMode throws when MINGLA_STRIPE_MODE is unset/invalid
 *   - resolveStripeMode returns "test" | "live"
 *   - resolveStripeKey throws on missing per-role env var
 *   - resolveStripeKey throws on prefix-vs-mode mismatch
 *   - resolveStripeKey returns the value when mode + prefix align
 *   - resolvePublishablePrefix tracks the mode
 */

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  resolvePublishablePrefix,
  resolveStripeKey,
  resolveStripeMode,
} from "../stripeMode.ts";

interface EnvSnapshot {
  mode: string | undefined;
  testKey: string | undefined;
  liveKey: string | undefined;
}

function snapshotEnv(): EnvSnapshot {
  return {
    mode: Deno.env.get("MINGLA_STRIPE_MODE"),
    testKey: Deno.env.get("STRIPE_RAK_ONBOARD_TEST"),
    liveKey: Deno.env.get("STRIPE_RAK_ONBOARD_LIVE"),
  };
}

function restoreEnv(snap: EnvSnapshot): void {
  if (snap.mode === undefined) Deno.env.delete("MINGLA_STRIPE_MODE");
  else Deno.env.set("MINGLA_STRIPE_MODE", snap.mode);
  if (snap.testKey === undefined) Deno.env.delete("STRIPE_RAK_ONBOARD_TEST");
  else Deno.env.set("STRIPE_RAK_ONBOARD_TEST", snap.testKey);
  if (snap.liveKey === undefined) Deno.env.delete("STRIPE_RAK_ONBOARD_LIVE");
  else Deno.env.set("STRIPE_RAK_ONBOARD_LIVE", snap.liveKey);
}

Deno.test("resolveStripeMode throws when MINGLA_STRIPE_MODE is unset", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.delete("MINGLA_STRIPE_MODE");
    assertThrows(
      () => resolveStripeMode(),
      Error,
      "MINGLA_STRIPE_MODE",
    );
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeMode throws when MINGLA_STRIPE_MODE is invalid", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "staging");
    assertThrows(
      () => resolveStripeMode(),
      Error,
      'must be "test" or "live"',
    );
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeMode returns test", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    assertEquals(resolveStripeMode(), "test");
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeMode returns live", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "live");
    assertEquals(resolveStripeMode(), "live");
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeKey throws on missing per-role env", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    Deno.env.delete("STRIPE_RAK_ONBOARD_TEST");
    assertThrows(
      () => resolveStripeKey("ONBOARD"),
      Error,
      "STRIPE_RAK_ONBOARD_TEST",
    );
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeKey throws when test mode but live-prefixed key", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    Deno.env.set("STRIPE_RAK_ONBOARD_TEST", "rk_live_pretend_live_in_test_slot");
    assertThrows(
      () => resolveStripeKey("ONBOARD"),
      Error,
      "rk_test_",
    );
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeKey throws when live mode but test-prefixed key", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "live");
    Deno.env.set("STRIPE_RAK_ONBOARD_LIVE", "rk_test_pretend_test_in_live_slot");
    assertThrows(
      () => resolveStripeKey("ONBOARD"),
      Error,
      "rk_live_",
    );
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeKey returns test value when mode aligns", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    Deno.env.set("STRIPE_RAK_ONBOARD_TEST", "rk_test_abc123");
    assertEquals(resolveStripeKey("ONBOARD"), "rk_test_abc123");
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolveStripeKey returns live value when mode aligns", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "live");
    Deno.env.set("STRIPE_RAK_ONBOARD_LIVE", "rk_live_abc123");
    assertEquals(resolveStripeKey("ONBOARD"), "rk_live_abc123");
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("resolvePublishablePrefix tracks mode", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    assertEquals(resolvePublishablePrefix(), "pk_test_");
    Deno.env.set("MINGLA_STRIPE_MODE", "live");
    assertEquals(resolvePublishablePrefix(), "pk_live_");
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("StripeRole exhaustive coverage — every role resolves", () => {
  const snap = snapshotEnv();
  try {
    Deno.env.set("MINGLA_STRIPE_MODE", "test");
    const roles = [
      "ONBOARD",
      "TICKET_CHECKOUT",
      "TICKET_REFUND",
      "WEBHOOK",
      "DETACH",
      "BALANCES",
      "REFRESH_STATUS",
      "KYC_REMINDER",
      "TAX_DASHBOARD",
    ] as const;
    for (const role of roles) {
      const envName = `STRIPE_RAK_${role}_TEST`;
      Deno.env.set(envName, `rk_test_${role.toLowerCase()}`);
      assertEquals(resolveStripeKey(role), `rk_test_${role.toLowerCase()}`);
      Deno.env.delete(envName);
    }
    assert(true);
  } finally {
    restoreEnv(snap);
  }
});
