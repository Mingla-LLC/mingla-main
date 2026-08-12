import type { VerifyContext } from "./common.ts";
import { verifyCanonicalBinding } from "./common.ts";
export async function verify(ctx: VerifyContext) {
  const base = verifyCanonicalBinding("google", ctx);
  // Google Ads customer search is a POST, even though its GAQL is read-only.
  // #1950 permits no Google POST, so this verifier fails closed instead of
  // claiming payer, binding, measurement, or billing authority.
  base.reason_code = "capability_unsupported";
  return base;
}
