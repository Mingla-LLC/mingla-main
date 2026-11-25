// [TRANSITIONAL] #4490 spec 08 O2 fix 1 (O2-T5) — deploy order.
//
// Merging auto-deploys supabase/functions to production, and the #4490
// migrations (venue_orders.till_payment_id from 20281203504490,
// door_tap_intents.till_payment_id from 20281203564490) may land after the
// functions. Shared paths that LIVE guest ordering runs (the Paystack
// venue-order charge, the "new order" push) and the door tap sweep read that
// column; until it exists PostgREST answers 42703 "column ... does not exist".
// Those reads retry without the column and treat the row as "not a Till
// carrier", so guest orders confirm and alert exactly as before O2. Any OTHER
// error is unchanged (thrown, logged or counted by its caller).
//
// Exit: the #4490 migrations applied in production (venue_orders and
// door_tap_intents both have till_payment_id); then delete this module and its
// callers' fallback branches.

/** PostgreSQL "undefined column" (42703) naming till_payment_id, and only that. */
export function isMissingTillPaymentColumn(
  error: { code?: unknown; message?: unknown } | null | undefined,
): boolean {
  return error?.code === "42703" &&
    /till_payment_id/.test(String(error?.message ?? ""));
}
