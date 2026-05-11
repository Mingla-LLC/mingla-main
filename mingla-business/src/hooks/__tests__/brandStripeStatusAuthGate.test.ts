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
      }),
    ).toBe(false);
  });
});
