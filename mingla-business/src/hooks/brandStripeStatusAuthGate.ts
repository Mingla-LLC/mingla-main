export interface BrandStripeStatusAuthGateInput {
  brandId: string | null;
  authLoading: boolean;
  user: unknown | null;
  session: unknown | null;
}

export function shouldEnableBrandStripeStatusQuery({
  brandId,
  authLoading,
  user,
  session,
}: BrandStripeStatusAuthGateInput): boolean {
  return (
    brandId !== null &&
    !authLoading &&
    user !== null &&
    session !== null
  );
}
