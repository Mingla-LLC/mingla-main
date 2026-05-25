import { fetchBrandStripeAccountSession } from "../brandStripeAccountSessionService";
import { businessWebOriginOverrideBody } from "../businessWebOriginOverride";
import { supabase } from "../supabase";

jest.mock("../businessWebOriginOverride", () => ({
  businessWebOriginOverrideBody: jest.fn(() => ({})),
}));

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const invokeMock = supabase.functions.invoke as jest.Mock;
const originOverrideBodyMock = businessWebOriginOverrideBody as jest.Mock;

beforeEach(() => {
  invokeMock.mockReset();
  originOverrideBodyMock.mockReset();
  originOverrideBodyMock.mockReturnValue({});
  invokeMock.mockResolvedValue({
    data: {
      client_secret: "acs_test_secret",
      account_id: "acct_test",
      target_url: "https://business.usemingla.com/connect-account-management",
    },
    error: null,
  });
});

it("passes preview business origin override to account-session edge function", async () => {
  originOverrideBodyMock.mockReturnValue({
    business_web_origin_override:
      "https://mingla-business-orch-0954.vercel.app",
  });

  await fetchBrandStripeAccountSession(
    "66666666-6666-4666-8666-666666666666",
    "account_management",
  );

  expect(invokeMock).toHaveBeenCalledWith("brand-stripe-account-session", {
    body: {
      brand_id: "66666666-6666-4666-8666-666666666666",
      surface: "account_management",
      business_web_origin_override:
        "https://mingla-business-orch-0954.vercel.app",
    },
  });
});
