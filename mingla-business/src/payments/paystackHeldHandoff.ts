/**
 * issue #3281 — the Host app's handle on the shared held-Paystack-page store
 * (`packages/payments-native/paystackHeldHandoff.ts`, bundle 6d moved it there
 * so Explorer uses the same implementation).
 *
 * Every held page is dropped on sign-out (Constitution #6): this module loads
 * on demand with checkout, so it registers with the sign-out cleanup registry.
 */

import { clearAllHeldHandoffs } from "@mingla/payments-native/paystackHeldHandoff";

import { registerSignOutCleanup } from "../utils/signOutCleanups";

export * from "@mingla/payments-native/paystackHeldHandoff";

registerSignOutCleanup(clearAllHeldHandoffs);
