// ORCH-1238 — resolvePublishableKey() contract tests.
//
// Pins the fail-closed, mode-validated publishable-key resolver that the two
// checkout edge fns (ticket-checkout-create + venue-reservation-create) return
// to the mobile app on requires_payment. The prefix-guard here is what would
// have caught the 2026-06-22 outage: live mode was flipped on, but the
// EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY secret was left a pk_test_ key, so the
// mobile Stripe SDK got a live PaymentIntent + a test pk = "There was an
// unexpected error" and zero working live checkouts.
//
// The resolver re-reads Deno.env each call, so we mutate env between asserts.
//
// Run with:
//   deno test --allow-env supabase/functions/_shared/stripeMode.test.ts

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { resolvePublishableKey } from "./stripeMode.ts";

const PK_ENV_VARS = [
  "MINGLA_STRIPE_MODE",
  "STRIPE_PUBLISHABLE_KEY_LIVE",
  "STRIPE_PUBLISHABLE_KEY_TEST",
  "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PUBLISHABLE_KEY",
];

function clearPkEnv() {
  for (const k of PK_ENV_VARS) Deno.env.delete(k);
}

Deno.test("live mode + pk_live_ key → returns it", () => {
  clearPkEnv();
  Deno.env.set("MINGLA_STRIPE_MODE", "live");
  Deno.env.set("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_realkey123");
  assertEquals(resolvePublishableKey(), "pk_live_realkey123");
  clearPkEnv();
});

Deno.test("live mode + pk_test_ key → THROWS (the 2026-06-22 outage guard)", () => {
  clearPkEnv();
  Deno.env.set("MINGLA_STRIPE_MODE", "live");
  Deno.env.set("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_leftbehind");
  assertThrows(
    () => resolvePublishableKey(),
    Error,
    "Refusing to return a mismatched publishable key",
  );
  clearPkEnv();
});

Deno.test("test mode + pk_live_ key → THROWS (mismatch both directions)", () => {
  clearPkEnv();
  Deno.env.set("MINGLA_STRIPE_MODE", "test");
  Deno.env.set("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_wrongmode");
  assertThrows(
    () => resolvePublishableKey(),
    Error,
    "Refusing to return a mismatched publishable key",
  );
  clearPkEnv();
});

Deno.test("missing publishable key env → THROWS", () => {
  clearPkEnv();
  Deno.env.set("MINGLA_STRIPE_MODE", "live");
  assertThrows(
    () => resolvePublishableKey(),
    Error,
    "No Stripe publishable key set",
  );
  clearPkEnv();
});

Deno.test("empty publishable key value → THROWS", () => {
  clearPkEnv();
  Deno.env.set("MINGLA_STRIPE_MODE", "live");
  Deno.env.set("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", "   ");
  assertThrows(
    () => resolvePublishableKey(),
    Error,
    "No Stripe publishable key set",
  );
  clearPkEnv();
});

Deno.test("mode-suffixed STRIPE_PUBLISHABLE_KEY_LIVE wins over legacy", () => {
  clearPkEnv();
  Deno.env.set("MINGLA_STRIPE_MODE", "live");
  Deno.env.set("STRIPE_PUBLISHABLE_KEY_LIVE", "pk_live_suffixed");
  // Legacy is present too, but the suffixed secret must take precedence.
  Deno.env.set("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_legacy");
  Deno.env.set("STRIPE_PUBLISHABLE_KEY", "pk_live_oldlegacy");
  assertEquals(resolvePublishableKey(), "pk_live_suffixed");
  clearPkEnv();
});

Deno.test("test mode falls back to legacy EXPO_PUBLIC when no suffixed secret", () => {
  clearPkEnv();
  Deno.env.set("MINGLA_STRIPE_MODE", "test");
  Deno.env.set("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_legacyok");
  assertEquals(resolvePublishableKey(), "pk_test_legacyok");
  clearPkEnv();
});
