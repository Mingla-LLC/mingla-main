/**
 * #3872 — shared outcome type for paying a creator fee (hire or top-up).
 */

export type GigHirePayOutcome =
  | { outcome: "redirected" }
  | { outcome: "succeeded" }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string };
