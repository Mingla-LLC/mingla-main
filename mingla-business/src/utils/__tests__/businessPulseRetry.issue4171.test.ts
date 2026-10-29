import { businessPulseHasRetryableError } from "../businessPulse";

const healthy = {
  canViewMoney: true,
  payoutError: false,
  payoutDataState: "present" as const,
  trafficError: false,
  trafficDataPresent: true,
  followersError: false,
  followersDataPresent: true,
};

describe("#4171 Business Pulse retry policy", () => {
  it("does not offer Retry for terminal traffic authorization", () => {
    expect(
      businessPulseHasRetryableError({
        ...healthy,
        trafficAuthorized: false,
      }),
    ).toBe(false);
  });

  it.each([
    { payoutError: true, payoutDataState: "present" as const },
    { trafficError: true, trafficDataPresent: true },
    { followersError: true, followersDataPresent: true },
  ])("keeps cached values without a global Retry during a refetch error", (state) => {
    expect(
      businessPulseHasRetryableError({
        ...healthy,
        trafficAuthorized: true,
        ...state,
      }),
    ).toBe(false);
  });

  it.each([
    { payoutError: true, payoutDataState: "missing" as const },
    { payoutDataState: "null" as const },
    { trafficError: true, trafficDataPresent: false },
    { followersError: true, followersDataPresent: false },
  ])("keeps Retry for an unavailable first-load data source", (state) => {
    expect(
      businessPulseHasRetryableError({
        ...healthy,
        trafficAuthorized: true,
        ...state,
      }),
    ).toBe(true);
  });
});
