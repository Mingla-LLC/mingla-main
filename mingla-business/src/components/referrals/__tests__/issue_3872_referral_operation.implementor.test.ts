import {
  canShowReferralsOperation,
  REFERRALS_OPERATION_COPY,
} from "../referralOperationContract";

describe("#3872 referral operation entry", () => {
  test("stays absent unless pilot access, rank and navigation are all present", () => {
    const navigate = jest.fn();
    expect(canShowReferralsOperation(20, true, navigate)).toBe(true);
    expect(canShowReferralsOperation(19, true, navigate)).toBe(false);
    expect(canShowReferralsOperation(40, false, navigate)).toBe(false);
    expect(canShowReferralsOperation(40, true, undefined)).toBe(false);
  });

  test("describes the buyer-facing outcome instead of an internal milestone", () => {
    expect(REFERRALS_OPERATION_COPY).toEqual({
      label: "Referrals",
      sub: "Offers, promoters, tracking links and rewards",
    });
  });
});
