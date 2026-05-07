import { startBrandStripeOnboarding } from "../../services/brandStripeService";
import { supabase } from "../../services/supabase";

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const invokeMock = supabase.functions.invoke as jest.Mock;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    data: {
      client_secret: "cs_test",
      account_id: "acct_test",
      onboarding_url: "https://business.mingla.com/connect-onboarding",
    },
    error: null,
  });
});

it("sends GB country by default for backwards-compatible onboarding callers", async () => {
  await startBrandStripeOnboarding(
    "11111111-1111-4111-8111-111111111111",
    "mingla-business://return",
  );

  expect(invokeMock).toHaveBeenCalledWith("brand-stripe-onboard", {
    body: {
      brand_id: "11111111-1111-4111-8111-111111111111",
      return_url: "mingla-business://return",
      country: "GB",
    },
  });
});

it("sends selected country for multi-country onboarding and reactivation", async () => {
  await startBrandStripeOnboarding(
    "22222222-2222-4222-8222-222222222222",
    "https://business.mingla.com/return",
    "US",
  );

  expect(invokeMock).toHaveBeenCalledWith("brand-stripe-onboard", {
    body: {
      brand_id: "22222222-2222-4222-8222-222222222222",
      return_url: "https://business.mingla.com/return",
      country: "US",
    },
  });
});
