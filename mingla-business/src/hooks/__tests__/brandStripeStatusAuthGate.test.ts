import { shouldEnableBrandStripeStatusQuery } from "../brandStripeStatusAuthGate";

describe("shouldEnableBrandStripeStatusQuery", () => {
  const brandId = "brand_123";
  const user = { id: "user_123" };
  const session = { access_token: "token_123" };

  it("does not enable while auth is loading", () => {
    expect(
      shouldEnableBrandStripeStatusQuery({
        brandId,
        authLoading: true,
        user,
        session,
        canManagePayments: true,
      }),
    ).toBe(false);
  });

  it("does not enable when there is no authenticated user", () => {
    expect(
      shouldEnableBrandStripeStatusQuery({
        brandId,
        authLoading: false,
        user: null,
        session,
        canManagePayments: true,
      }),
    ).toBe(false);
  });

  it("does not enable when there is no authenticated session", () => {
    expect(
      shouldEnableBrandStripeStatusQuery({
        brandId,
        authLoading: false,
        user,
        session: null,
        canManagePayments: true,
      }),
    ).toBe(false);
  });

  it("enables when auth is ready and a user session exists", () => {
    expect(
      shouldEnableBrandStripeStatusQuery({
        brandId,
        authLoading: false,
        user,
        session,
        canManagePayments: true,
      }),
    ).toBe(true);
  });

  it("does not enable without a brand id", () => {
    expect(
      shouldEnableBrandStripeStatusQuery({
        brandId: null,
        authLoading: false,
        user,
        session,
        canManagePayments: true,
      }),
    ).toBe(false);
  });

  // #1863 [error-toast-covers-bank-field] — the added conjunct. Both
  // `brand-stripe-refresh-status` and `brand-stripe-balances` return
  // 403 permission_denied at `requirePaymentsManager` for any role outside
  // {brand_owner, brand_admin, finance_manager}; firing the query anyway
  // produced ~2,650 unanswerable edge invocations in eight idle hours.
  it("#1863 does not enable when the caller cannot manage payments", () => {
    expect(
      shouldEnableBrandStripeStatusQuery({
        brandId,
        authLoading: false,
        user,
        session,
        canManagePayments: false,
      }),
    ).toBe(false);
  });

  it("#1863 the payments conjunct cannot rescue a failing auth conjunct", () => {
    expect(
      shouldEnableBrandStripeStatusQuery({
        brandId: null,
        authLoading: false,
        user,
        session,
        canManagePayments: true,
      }),
    ).toBe(false);
  });
});
