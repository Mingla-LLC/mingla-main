/**
 * Unified Stripe mode resolver (ORCH-1056).
 *
 * Single source of truth for which Stripe mode the Supabase edge fns operate
 * in. Reads `MINGLA_STRIPE_MODE` ("test" | "live") and resolves per-role
 * restricted API keys from a duplicated `STRIPE_RAK_{ROLE}_{TEST|LIVE}`
 * scheme. Validates that the key prefix matches the declared mode, throwing
 * on any drift (preventing the silent "pk_live_ + rk_test_" mismatch that
 * collapsed the Stripe Connect embedded iframe to 1px on 2026-06-02 — see
 * commit history `77f1b8219..8cd547a9a`).
 *
 * Stripe docs:
 *   - https://docs.stripe.com/keys (key prefixes documented under "API keys" — pk_/sk_/rk_ each have _test_ or _live_ infix)
 *   - https://docs.stripe.com/keys/restricted (restricted API key shape: rk_test_… / rk_live_…)
 *
 * Migration: every consumer of `STRIPE_RAK_*` (unsuffixed) MUST migrate to
 * `resolveStripeKey(role)`. The unsuffixed secrets are kept transitionally
 * (see Mingla_Artifacts/STRIPE_MODE_FLIP_RUNBOOK.md) but the helpers under
 * _shared/stripe.ts + _shared/stripeBlueprintClient.ts route exclusively
 * through this module.
 */

export type StripeMode = "test" | "live";

export type StripeRole =
  | "ONBOARD"
  | "TICKET_CHECKOUT"
  | "TICKET_REFUND"
  | "WEBHOOK"
  | "DETACH"
  | "BALANCES"
  | "REFRESH_STATUS"
  | "KYC_REMINDER"
  | "TAX_DASHBOARD";

const MODE_ENV_VAR = "MINGLA_STRIPE_MODE";

function readMode(): StripeMode {
  const raw = Deno.env.get(MODE_ENV_VAR);
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    throw new Error(
      `${MODE_ENV_VAR} is not set in Supabase Edge Function secrets. ` +
        `Expected "test" or "live". See Mingla_Artifacts/STRIPE_MODE_FLIP_RUNBOOK.md.`,
    );
  }
  if (raw !== "test" && raw !== "live") {
    throw new Error(
      `${MODE_ENV_VAR} must be "test" or "live"; got "${raw}".`,
    );
  }
  return raw;
}

/**
 * Resolve the current Stripe mode from environment. Idempotent and pure
 * (re-reads each call so test code can mutate Deno.env between assertions).
 */
export function resolveStripeMode(): StripeMode {
  return readMode();
}

/**
 * Resolve a per-role restricted API key for the current Stripe mode.
 *
 * Lookup order:
 *   1. Read `MINGLA_STRIPE_MODE` to pick suffix (`_TEST` or `_LIVE`).
 *   2. Read `STRIPE_RAK_{role}_{suffix}` — throw if unset.
 *   3. Validate the key prefix matches the mode (`rk_test_` vs `rk_live_`).
 *      Throws on mismatch — prevents the silent cross-mode misroute.
 *
 * @param role canonical role name (matches existing `_shared/stripe.ts` helpers)
 */
export function resolveStripeKey(role: StripeRole): string {
  const mode = readMode();
  const suffix = mode === "live" ? "LIVE" : "TEST";
  const envVarName = `STRIPE_RAK_${role}_${suffix}`;
  const value = Deno.env.get(envVarName);
  if (value === undefined || value === null || value.trim().length === 0) {
    throw new Error(
      `${envVarName} is not set in Supabase Edge Function secrets. ` +
        `Required for Stripe role ${role} in ${mode} mode. ` +
        `See Mingla_Artifacts/STRIPE_MODE_FLIP_RUNBOOK.md.`,
    );
  }
  const requiredPrefix = mode === "live" ? "rk_live_" : "rk_test_";
  if (!value.startsWith(requiredPrefix)) {
    throw new Error(
      `${envVarName} must be a ${requiredPrefix} value when ` +
        `MINGLA_STRIPE_MODE=${mode}. Got prefix ` +
        `"${value.slice(0, 8)}…". Refusing to call Stripe with a mismatched key.`,
    );
  }
  return value;
}

/**
 * Resolve the publishable-key prefix for the current mode. Used by the
 * `stripe-mode` public edge fn so clients can hand-shake their bundled pk
 * against the backend mode at boot.
 */
export function resolvePublishablePrefix(): "pk_test_" | "pk_live_" {
  return readMode() === "live" ? "pk_live_" : "pk_test_";
}
