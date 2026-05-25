/**
 * ORCH-0955 [Native Stripe Tax for Platforms] — region gate decommissioned.
 *
 * Original purpose (ORCH-0953 §3.8 happy-path): assert that
 * `NATIVE_PAID_ALLOWED_REGIONS` env-var-driven country allowlist blocked
 * native paid PIs from unsupported countries via `isNativePaidAllowedForBrand`.
 *
 * Per ORCH-0955 CLOSE 2026-05-25 + I-PROPOSED-REGION-GATE-DELETED: the
 * region gate is entirely deleted. `_shared/stripeTax.ts` no longer exists;
 * `isNativePaidAllowedForBrand` is no longer referenced; native paid is
 * universal across all Stripe-supported countries via Stripe Tax for
 * Platforms 3-step (calc/commit/reverse).
 *
 * Preserved per append-only policy; rewritten to assert the DELETED state.
 * [TEST-MOD-APPROVED ORCH-0955]
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const REPO_ROOT = new URL("../../../..", import.meta.url).pathname;
const STRIPE_TAX_HELPER_PATH = `${REPO_ROOT}supabase/functions/_shared/stripeTax.ts`;
const CHECKOUT_INDEX_PATH = `${REPO_ROOT}supabase/functions/ticket-checkout-create/index.ts`;

Deno.test("ORCH-0955: _shared/stripeTax.ts helper file is DELETED", async () => {
  let exists = true;
  try {
    await Deno.stat(STRIPE_TAX_HELPER_PATH);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) exists = false;
    else throw err;
  }
  assertEquals(exists, false, "_shared/stripeTax.ts must not exist post-ORCH-0955");
});

Deno.test("ORCH-0955: ticket-checkout-create does not import region-gate helper", async () => {
  const src = await Deno.readTextFile(CHECKOUT_INDEX_PATH);
  assert(!src.includes("isNativePaidAllowedForBrand"), "isNativePaidAllowedForBrand must not appear in ticket-checkout-create");
  assert(!src.includes("getNativePaidAllowedRegions"), "getNativePaidAllowedRegions must not appear in ticket-checkout-create");
  assert(!src.includes("../_shared/stripeTax.ts"), "_shared/stripeTax.ts import must not appear");
  assert(!src.includes("native_paid_not_allowed_in_region"), "native_paid_not_allowed_in_region error code must not be returned");
});

Deno.test("ORCH-0955: NATIVE_PAID_ALLOWED_REGIONS env var is not referenced", async () => {
  const src = await Deno.readTextFile(CHECKOUT_INDEX_PATH);
  assert(!src.includes("NATIVE_PAID_ALLOWED_REGIONS"), "NATIVE_PAID_ALLOWED_REGIONS env var must not appear in ticket-checkout-create");
});
