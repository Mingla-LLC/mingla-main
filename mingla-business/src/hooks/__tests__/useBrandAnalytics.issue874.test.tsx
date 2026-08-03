const useQueryMock = jest.fn((options: Record<string, unknown>) => options);
const useAuthMock = jest.fn(() => ({ isAuthReady: true }));

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => useQueryMock(options),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

import {
  brandAnalyticsKeys,
  useBrandCustomerPatternsRollup,
  useBrandMinglaDroveRollup,
  useBrandRegularsRollup,
} from "../useBrandAnalytics";

describe("issue #874 brand-keyed auth-ready hooks", () => {
  beforeEach(() => {
    useQueryMock.mockClear();
    useAuthMock.mockReturnValue({ isAuthReady: true });
  });

  it("uses independent brand and module query keys", () => {
    useBrandMinglaDroveRollup("brand-a", true);
    useBrandRegularsRollup("brand-a", true);
    useBrandCustomerPatternsRollup("brand-a", true);
    expect(useQueryMock.mock.calls.map(([input]) => input.queryKey)).toEqual([
      brandAnalyticsKeys.minglaDrove("brand-a"),
      brandAnalyticsKeys.regulars("brand-a"),
      brandAnalyticsKeys.patterns("brand-a"),
    ]);
  });

  it.each([
    { ready: false, brandId: "brand-a", callerEnabled: true },
    { ready: true, brandId: null, callerEnabled: true },
    { ready: true, brandId: "brand-a", callerEnabled: false },
  ])("never enables an RPC before every auth/brand/caller gate", (input) => {
    useAuthMock.mockReturnValue({ isAuthReady: input.ready });
    useBrandMinglaDroveRollup(input.brandId, input.callerEnabled);
    expect(useQueryMock.mock.calls[0][0].enabled).toBe(false);
    expect(useQueryMock.mock.calls[0][0].queryKey).toEqual(
      brandAnalyticsKeys.disabledMinglaDrove,
    );
  });

  it("switches cache identity without placeholder data when the brand changes", () => {
    useBrandMinglaDroveRollup("brand-a", true);
    useBrandMinglaDroveRollup("brand-b", true);
    expect(useQueryMock.mock.calls[0][0].queryKey).not.toEqual(
      useQueryMock.mock.calls[1][0].queryKey,
    );
    expect(useQueryMock.mock.calls[1][0]).not.toHaveProperty("placeholderData");
    expect(useQueryMock.mock.calls[1][0].staleTime).toBe(60_000);
  });
});
