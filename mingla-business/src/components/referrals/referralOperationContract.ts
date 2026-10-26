export const REFERRALS_OPERATION_COPY = Object.freeze({
  label: "Referrals",
  sub: "Offers, promoters, tracking links and rewards",
});

export const canShowReferralsOperation = (
  rank: number,
  accessEnabled: boolean,
  onReferrals: ((brandId: string) => void) | undefined,
): boolean => rank >= 20 && accessEnabled && onReferrals !== undefined;
