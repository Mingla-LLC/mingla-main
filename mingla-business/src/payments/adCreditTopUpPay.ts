/**
 * toward #3697 Wave 7b — shared outcome type for Ads credit top-up pay.
 */

export type AdCreditTopUpPayOutcome =
  | { outcome: "redirected" }
  | { outcome: "succeeded"; paymentIntentId: string }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string };
