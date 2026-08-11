export interface BrandStripeStatusAuthGateInput {
  brandId: string | null;
  authLoading: boolean;
  user: unknown | null;
  session: unknown | null;
  /**
   * #1863 [error-toast-covers-bank-field] §4.2 — the client mirror of
   * `biz_can_manage_payments_for_brand`, from `useCanManageBrandPayments`.
   *
   * REQUIRED, never `?:`. An optional field would default to `undefined` and
   * silently re-open the hole for the next caller; a required field makes
   * omission a TypeScript compile error. That is the structural half of
   * "cannot be undone silently" (§4.5.3 lock 1, SC-11).
   *
   * Both `brand-stripe-refresh-status` and `brand-stripe-balances` refuse a
   * caller who fails this predicate with `403 permission_denied` at
   * `requirePaymentsManager`. Firing the query anyway produced ~2,650 futile
   * edge invocations in eight idle hours on one device.
   */
  canManagePayments: boolean;
}

export function shouldEnableBrandStripeStatusQuery({
  brandId,
  authLoading,
  user,
  session,
  canManagePayments,
}: BrandStripeStatusAuthGateInput): boolean {
  return (
    brandId !== null &&
    !authLoading &&
    user !== null &&
    session !== null &&
    canManagePayments === true
  );
}
